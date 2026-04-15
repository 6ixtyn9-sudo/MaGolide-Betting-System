import os
import json
import threading
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for

from auth.google_auth import get_client, is_configured, reset_client
from registry.satellite_registry import (
    list_satellites, get_satellite, add_satellite, update_satellite,
    remove_satellite, bulk_add, summary_stats,
)
from fetcher.sheet_fetcher import fetch_satellite, batch_fetch
from assayer.assayer_engine import run_full_assay

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
    payload_trimmed["row_counts"] = payload["row_counts"]
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
