import os
import json
import threading
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for

from auth.google_auth import get_client, get_write_client, is_configured, reset_client
from registry.satellite_registry import (
    list_satellites, get_satellite, add_satellite, update_satellite,
    remove_satellite, bulk_add, summary_stats,
)
from fetcher.sheet_fetcher import (
    fetch_satellite, batch_fetch,
    read_bet_slips, read_results_clean, count_bet_slips_rows,
)
from assayer.assayer_engine import run_full_assay
from assayer.accuracy_engine import run_accuracy_report
from assayer.highest_quarter import run_hq_pipeline
from assayer.pipeline_writer import write_bet_records, count_bet_slips

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

_job_status = {}
_job_lock = threading.Lock()


def _set_job(job_id, state, detail=""):
    with _job_lock:
        _job_status[job_id] = {"state": state, "detail": detail,
                                "updated": datetime.utcnow().isoformat()}


def _get_job(job_id):
    with _job_lock:
        return _job_status.get(job_id)


@app.route("/")
def dashboard():
    stats = summary_stats()
    sats = list_satellites()
    configured = is_configured()
    return render_template("dashboard.html",
                           stats=stats,
                           satellites=sats,
                           configured=configured,
                           now=datetime.utcnow().isoformat()[:16].replace("T", " ") + " UTC")


@app.route("/api/status")
def api_status():
    return jsonify({
        "google_configured": is_configured(),
        "registry_count": len(list_satellites()),
        "stats": summary_stats(),
    })


@app.route("/api/satellites", methods=["GET"])
def api_satellites():
    date = request.args.get("date")
    league = request.args.get("league")
    fmt = request.args.get("format")
    return jsonify(list_satellites(date=date, league=league, fmt=fmt))


@app.route("/api/satellites/add", methods=["POST"])
def api_add_satellite():
    body = request.json or {}
    sheet_id = body.get("sheet_id", "").strip()
    sheet_name = body.get("sheet_name", "").strip()
    date = body.get("date", "").strip()
    league = body.get("league", "").strip()
    notes = body.get("notes", "").strip()

    if not sheet_id:
        return jsonify({"error": "sheet_id is required"}), 400
    if not date or not league:
        return jsonify({"error": "date and league are required"}), 400

    sat, status = add_satellite(sheet_id, sheet_name, date, league, notes)
    return jsonify({"satellite": sat, "status": status})


@app.route("/api/satellites/bulk-add", methods=["POST"])
def api_bulk_add():
    body = request.json or {}
    entries = body.get("entries", [])
    if not isinstance(entries, list) or not entries:
        return jsonify({"error": "entries must be a non-empty list"}), 400
    results = bulk_add(entries)
    return jsonify({"results": results})


@app.route("/api/satellites/<sat_id>", methods=["DELETE"])
def api_delete_satellite(sat_id):
    removed = remove_satellite(sat_id)
    return jsonify({"removed": removed})


@app.route("/api/satellites/<sat_id>", methods=["GET"])
def api_get_satellite(sat_id):
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "Not found"}), 404
    return jsonify(sat)


@app.route("/api/fetch/<sat_id>", methods=["POST"])
def api_fetch_one(sat_id):
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "Satellite not found"}), 404

    client, err = get_client()
    if err:
        return jsonify({"error": err}), 503

    payload, fetch_err = fetch_satellite(client, sat)
    if fetch_err:
        update_satellite(sat_id, status="error", last_fetched=datetime.utcnow().isoformat())
        return jsonify({"error": fetch_err}), 500

    update_satellite(sat_id,
                     status="fetched",
                     format=payload["detected_format"],
                     sheet_name=payload["sheet_name"],
                     row_counts=payload["row_counts"],
                     last_fetched=payload["fetched_at"])

    payload_trimmed = {k: v for k, v in payload.items() if k != "data"}
    return jsonify({"payload_meta": payload_trimmed, "status": "fetched"})


@app.route("/api/assay/<sat_id>", methods=["POST"])
def api_assay_one(sat_id):
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "Satellite not found"}), 404

    client, err = get_client()
    if err:
        return jsonify({"error": err}), 503

    payload, fetch_err = fetch_satellite(client, sat)
    if fetch_err:
        update_satellite(sat_id, status="error")
        return jsonify({"error": fetch_err}), 500

    update_satellite(sat_id,
                     status="fetched",
                     format=payload["detected_format"],
                     sheet_name=payload["sheet_name"],
                     row_counts=payload["row_counts"],
                     last_fetched=payload["fetched_at"])

    result = run_full_assay(payload)
    summary = result["summary"]

    update_satellite(sat_id,
                     status="assayed",
                     last_assayed=datetime.utcnow().isoformat(),
                     assay_summary=summary)

    return jsonify({
        "summary": summary,
        "bankers": result["bankers"][:20],
        "robbers": result["robbers"][:20],
        "league_purity": result["league_purity"],
        "top_edges": result["edges"][:30],
    })


@app.route("/api/fetch-all", methods=["POST"])
def api_fetch_all():
    sats = list_satellites()
    if not sats:
        return jsonify({"error": "No satellites in registry"}), 400

    client, err = get_client()
    if err:
        return jsonify({"error": err}), 503

    job_id = f"fetch_all_{datetime.utcnow().strftime('%H%M%S')}"
    _set_job(job_id, "running", f"Starting batch fetch for {len(sats)} satellites")

    def _run():
        def on_progress(done, total, sat, error):
            msg = f"[{done}/{total}] {sat.get('league')} {sat.get('date')}"
            if error:
                msg += f" — ERROR: {error}"
            _set_job(job_id, "running", msg)

        results = batch_fetch(client, sats, on_progress=on_progress)
        success = 0
        for r in results:
            sat = r["satellite"]
            sat_id = sat["id"]
            if r["error"]:
                update_satellite(sat_id, status="error",
                                 last_fetched=datetime.utcnow().isoformat())
            else:
                p = r["payload"]
                update_satellite(sat_id,
                                 status="fetched",
                                 format=p["detected_format"],
                                 sheet_name=p["sheet_name"],
                                 row_counts=p["row_counts"],
                                 last_fetched=p["fetched_at"])
                success += 1

        _set_job(job_id, "done",
                 f"Complete: {success}/{len(sats)} fetched successfully")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"job_id": job_id, "satellites": len(sats)})


@app.route("/api/assay-all", methods=["POST"])
def api_assay_all():
    sats = list_satellites()
    if not sats:
        return jsonify({"error": "No satellites in registry"}), 400

    client, err = get_client()
    if err:
        return jsonify({"error": err}), 503

    job_id = f"assay_all_{datetime.utcnow().strftime('%H%M%S')}"
    _set_job(job_id, "running", f"Starting full assay for {len(sats)} satellites")

    def _run():
        results = batch_fetch(client, sats)
        success = 0
        for r in results:
            sat = r["satellite"]
            sat_id = sat["id"]
            if r["error"]:
                update_satellite(sat_id, status="error",
                                 last_fetched=datetime.utcnow().isoformat())
                _set_job(job_id, "running",
                         f"ERROR {sat.get('league')}: {r['error']}")
                continue
            p = r["payload"]
            update_satellite(sat_id,
                             status="fetched",
                             format=p["detected_format"],
                             sheet_name=p["sheet_name"],
                             row_counts=p["row_counts"],
                             last_fetched=p["fetched_at"])
            try:
                result = run_full_assay(p)
                update_satellite(sat_id,
                                 status="assayed",
                                 last_assayed=datetime.utcnow().isoformat(),
                                 assay_summary=result["summary"])
                success += 1
                _set_job(job_id, "running",
                         f"Assayed {sat.get('league')} {sat.get('date')} — "
                         f"{result['summary']['bankers_count']} bankers, "
                         f"{result['summary']['robbers_count']} robbers")
            except Exception as e:
                _set_job(job_id, "running",
                         f"Assay ERROR {sat.get('league')}: {e}")

        _set_job(job_id, "done",
                 f"Complete: {success}/{len(sats)} assayed successfully")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"job_id": job_id, "satellites": len(sats)})


@app.route("/api/sync-scripts", methods=["POST"])
def api_sync_scripts():
    """
    Push local .gs files to all satellite sheets.
    """
    sats = list_satellites()
    if not sats:
        return jsonify({"error": "No satellites in registry"}), 400

    job_id = f"sync_scripts_{datetime.utcnow().strftime('%H%M%S')}"
    _set_job(job_id, "running", f"Starting script sync for {len(sats)} satellites")

    def _run():
        try:
            from fetcher.script_api_client import ScriptApiClient
            from scripts.deploy_gs_to_satellites import load_local_gs_files, deploy_to_satellite
            from pathlib import Path

            client = ScriptApiClient()
            docs_dir = Path(os.path.dirname(__file__)) / "docs"
            files = load_local_gs_files(docs_dir)
            
            success = 0
            for i, sat in enumerate(sats):
                try:
                    deploy_to_satellite(client, sat["id"], files, dry_run=False)
                    success += 1
                    _set_job(job_id, "running", f"[{i+1}/{len(sats)}] Synced {sat.get('league')} {sat.get('date')}")
                    time.sleep(1.5) # Rate limit safety
                except Exception as e:
                    logger.error(f"Sync error for {sat['id']}: {e}")
                    _set_job(job_id, "running", f"[{i+1}/{len(sats)}] FAILED {sat.get('league')}: {e}")

            _set_job(job_id, "done", f"Script sync complete: {success}/{len(sats)} successful")
        except Exception as e:
            logger.exception("Sync job fatal error")
            _set_job(job_id, "error", str(e))

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"job_id": job_id, "satellites": len(sats)})


@app.route("/api/job/<job_id>")
def api_job_status(job_id):
    status = _get_job(job_id)
    if not status:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify(status)


@app.route("/api/reset-auth", methods=["POST"])
def api_reset_auth():
    reset_client()
    return jsonify({"status": "Auth cache cleared"})


@app.route("/api/accuracy-report/<sat_id>", methods=["POST"])
def api_accuracy_report(sat_id):
    """
    MA GOLIDE COMPLETE ACCURACY REPORT.
    Reads Bet_Slips + ResultsClean. Optionally filter by origin_config.
    """
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "Satellite not found"}), 404

    origin_filter = request.args.get("origin_config") or (request.json or {}).get("origin_config")

    client, err = get_client()
    if err:
        return jsonify({"error": err}), 503

    sheet_id = sat.get("sheet_id", "")

    bet_slip_rows, bs_err = read_bet_slips(client, sheet_id)
    if bs_err:
        return jsonify({"error": f"Could not read Bet_Slips: {bs_err}"}), 500

    results_rows, rc_err = read_results_clean(client, sheet_id)
    if rc_err:
        logger.warning(f"ResultsClean read warning: {rc_err}")

    report = run_accuracy_report(
        bet_slip_rows=bet_slip_rows,
        results_rows=results_rows,
        origin_config_filter=origin_filter,
    )

    report["satellite_id"] = sat_id
    report["sheet_name"] = sat.get("sheet_name", "")
    report["bet_slips_count"] = len(bet_slip_rows)
    report["results_count"] = len(results_rows)

    return jsonify(report)


@app.route("/api/run-hq/<sat_id>", methods=["POST"])
def api_run_hq(sat_id):
    """
    Run the elite Highest Quarter pipeline and write accepted bets to Bet_Slips.
    """
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "Satellite not found"}), 404

    body = request.json or {}
    custom_config = body.get("config", {})

    read_client, err = get_client()
    if err:
        return jsonify({"error": err}), 503

    write_client, w_err = get_write_client()
    if w_err:
        logger.warning(f"Write client not available: {w_err}. HQ bets will not be saved.")

    sheet_id = sat.get("sheet_id", "")
    payload, fetch_err = fetch_satellite(read_client, sat)
    if fetch_err:
        return jsonify({"error": f"Could not fetch satellite: {fetch_err}"}), 500

    upcoming_rows = payload.get("data", {}).get("upcoming", [])
    if not upcoming_rows:
        upcoming_rows = payload.get("data", {}).get("side", [])

    accepted_records, total_generated = run_hq_pipeline(
        game_rows=upcoming_rows,
        config=custom_config,
        origin_config="TIER2",
        tier_level="TIER2",
        source_module="HQ_Pipeline_v2",
    )

    coverage_summary = {
        "predictions_generated": total_generated,
        "predictions_written": 0,
        "pipeline_coverage_pct": 0.0,
        "write_error": None,
    }

    if accepted_records and write_client:
        write_summary, write_err = write_bet_records(
            write_client, sheet_id, accepted_records, total_generated
        )
        coverage_summary.update(write_summary)
        if write_err:
            coverage_summary["write_error"] = write_err
    elif not write_client:
        coverage_summary["write_error"] = "Write client unavailable — check service account permissions"

    return jsonify({
        "satellite_id": sat_id,
        "sheet_name": sat.get("sheet_name", ""),
        "hq_bets_accepted": len(accepted_records),
        "predictions_generated": total_generated,
        "pipeline_coverage_pct": coverage_summary.get("pipeline_coverage_pct", 0.0),
        "write_summary": coverage_summary,
        "bets": [r.to_dict() for r in accepted_records],
    })


@app.route("/api/bet-slips-count/<sat_id>")
def api_bet_slips_count(sat_id):
    sat = get_satellite(sat_id)
    if not sat:
        return jsonify({"error": "Not found"}), 404
    client, err = get_client()
    if err:
        return jsonify({"error": err}), 503
    count = count_bet_slips_rows(client, sat.get("sheet_id", ""))
    return jsonify({"sat_id": sat_id, "bet_slips_count": count})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
