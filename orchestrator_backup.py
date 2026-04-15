"""
Gold Universe Orchestrator — Single-File Backup
================================================
Complete Flask + gspread logic consolidated into one file.
Generated: 2026-04-15

To run standalone:
    pip install flask gspread google-auth google-auth-oauthlib google-auth-httplib2
    GOOGLE_SERVICE_ACCOUNT_JSON='...' python3 orchestrator_backup.py

Modules consolidated here:
  - auth/google_auth.py
  - registry/satellite_registry.py
  - fetcher/sheet_fetcher.py
  - assayer/assayer_engine.py
  - app.py (Flask routes)

Note: The dashboard template (templates/dashboard.html) is NOT included here
because it is a large Jinja2 HTML file. Run from the project root to use it.
"""

# ==============================================================================
# MODULE: auth/google_auth.py — Google Service Account Authentication
# ==============================================================================

import os
import json
import math
import time
import uuid
import threading
import logging
from collections import defaultdict
from datetime import datetime

try:
    import gspread
    from google.oauth2.service_account import Credentials
    GSPREAD_AVAILABLE = True
except ImportError:
    GSPREAD_AVAILABLE = False

from flask import Flask, render_template, request, jsonify

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

_client_cache = None


def get_client():
    global _client_cache
    if _client_cache is not None:
        return _client_cache, None

    if not GSPREAD_AVAILABLE:
        return None, "gspread not installed. Run: pip install gspread google-auth"

    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return None, "GOOGLE_SERVICE_ACCOUNT_JSON secret not set."

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, f"Invalid JSON in GOOGLE_SERVICE_ACCOUNT_JSON: {e}"

    try:
        creds = Credentials.from_service_account_info(info, scopes=GOOGLE_SCOPES)
        client = gspread.authorize(creds)
        _client_cache = client
        return client, None
    except Exception as e:
        return None, f"Google auth failed: {e}"


def reset_client():
    global _client_cache
    _client_cache = None


def is_configured():
    return bool(os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip())


# ==============================================================================
# MODULE: registry/satellite_registry.py — Satellite Registry Manager
# ==============================================================================

REGISTRY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "registry", "registry.json")
_EMPTY = {"satellites": []}


def _reg_load():
    if not os.path.exists(REGISTRY_PATH):
        return _EMPTY.copy()
    with open(REGISTRY_PATH, "r") as f:
        try:
            return json.load(f)
        except Exception:
            return _EMPTY.copy()


def _reg_save(data):
    os.makedirs(os.path.dirname(REGISTRY_PATH), exist_ok=True)
    with open(REGISTRY_PATH, "w") as f:
        json.dump(data, f, indent=2, default=str)


def list_satellites(date=None, league=None, fmt=None):
    rows = _reg_load().get("satellites", [])
    if date:
        rows = [r for r in rows if r.get("date") == date]
    if league:
        rows = [r for r in rows if r.get("league", "").lower() == league.lower()]
    if fmt:
        rows = [r for r in rows if r.get("format") == fmt]
    return rows


def get_satellite(sat_id):
    for s in _reg_load().get("satellites", []):
        if s.get("id") == sat_id:
            return s
    return None


def add_satellite(sheet_id, sheet_name, date, league, notes=""):
    data = _reg_load()
    for s in data["satellites"]:
        if s.get("sheet_id") == sheet_id:
            return s, "already_exists"
    sat = {
        "id": str(uuid.uuid4()),
        "sheet_id": sheet_id,
        "sheet_name": sheet_name or "",
        "date": date,
        "league": league,
        "notes": notes,
        "format": "unknown",
        "added_at": datetime.utcnow().isoformat(),
        "last_fetched": None,
        "last_assayed": None,
        "status": "pending",
        "row_counts": {},
        "assay_summary": None,
    }
    data["satellites"].append(sat)
    _reg_save(data)
    return sat, "created"


def update_satellite(sat_id, **kwargs):
    data = _reg_load()
    for s in data["satellites"]:
        if s.get("id") == sat_id:
            for k, v in kwargs.items():
                s[k] = v
            _reg_save(data)
            return s
    return None


def remove_satellite(sat_id):
    data = _reg_load()
    before = len(data["satellites"])
    data["satellites"] = [s for s in data["satellites"] if s.get("id") != sat_id]
    if len(data["satellites"]) < before:
        _reg_save(data)
        return True
    return False


def bulk_add(entries):
    results = []
    for e in entries:
        sat, status = add_satellite(
            sheet_id=e.get("sheet_id", ""),
            sheet_name=e.get("sheet_name", ""),
            date=e.get("date", ""),
            league=e.get("league", ""),
            notes=e.get("notes", ""),
        )
        results.append({"satellite": sat, "status": status})
    return results


def summary_stats():
    sats = list_satellites()
    by_format, by_status, by_league = {}, {}, {}
    assayed = 0
    for s in sats:
        fmt = s.get("format", "unknown")
        sta = s.get("status", "pending")
        lg = s.get("league", "Unknown")
        by_format[fmt] = by_format.get(fmt, 0) + 1
        by_status[sta] = by_status.get(sta, 0) + 1
        by_league[lg] = by_league.get(lg, 0) + 1
        if s.get("last_assayed"):
            assayed += 1
    return {
        "total": len(sats),
        "assayed": assayed,
        "by_format": by_format,
        "by_status": by_status,
        "by_league": by_league,
    }


# ==============================================================================
# MODULE: fetcher/sheet_fetcher.py — Rate-Limited Batch Fetcher
# ==============================================================================

GOLD_UNIVERSE_SHEETS = {"Side", "Totals", "MA_Vault", "MA_Discovery",
                         "ASSAYER_EDGES", "ASSAYER_LEAGUE_PURITY", "MA_Config"}
LEGACY_SHEETS = {"Predictions", "Results", "BetSlips", "Accuracy"}
SIDE_NAMES = {"Side", "side"}
TOTALS_NAMES = {"Totals", "totals"}
RESULTS_NAMES = {"ResultsClean", "Results", "results"}
UPCOMING_NAMES = {"UpcomingClean", "Upcoming", "upcoming"}
RATE_LIMIT_DELAY = 1.1


def detect_format(sheet_names_set):
    if len(sheet_names_set & GOLD_UNIVERSE_SHEETS) >= 2:
        return "gold_universe"
    if len(sheet_names_set & LEGACY_SHEETS) >= 1:
        return "legacy"
    return "unknown"


def _safe_get_sheet(ss, name_candidates):
    for name in name_candidates:
        try:
            return ss.worksheet(name)
        except Exception:
            pass
    return None


def _ws_to_records(ws):
    if ws is None:
        return []
    try:
        return ws.get_all_records(default_blank="")
    except Exception as e:
        logger.warning(f"Failed to read worksheet: {e}")
        return []


def fetch_satellite(client, sat):
    sheet_id = sat.get("sheet_id", "")
    if not sheet_id:
        return None, "No sheet_id"
    try:
        ss = client.open_by_key(sheet_id)
    except Exception as e:
        return None, f"Cannot open sheet: {e}"
    try:
        all_names = {ws.title for ws in ss.worksheets()}
    except Exception as e:
        return None, f"Cannot list worksheets: {e}"

    fmt = detect_format(all_names)
    side_data    = _ws_to_records(_safe_get_sheet(ss, SIDE_NAMES))
    totals_data  = _ws_to_records(_safe_get_sheet(ss, TOTALS_NAMES))
    results_data = _ws_to_records(_safe_get_sheet(ss, RESULTS_NAMES))
    upcoming_data= _ws_to_records(_safe_get_sheet(ss, UPCOMING_NAMES))

    payload = {
        "satellite_id": sat.get("id"),
        "sheet_id": sheet_id,
        "sheet_name": ss.title,
        "detected_format": fmt,
        "sheet_names": sorted(all_names),
        "fetched_at": datetime.utcnow().isoformat(),
        "data": {
            "side": side_data, "totals": totals_data,
            "results": results_data, "upcoming": upcoming_data,
        },
        "row_counts": {
            "side": len(side_data), "totals": len(totals_data),
            "results": len(results_data), "upcoming": len(upcoming_data),
        },
    }
    return payload, None


def batch_fetch(client, satellites, on_progress=None, delay=RATE_LIMIT_DELAY):
    results = []
    total = len(satellites)
    for i, sat in enumerate(satellites):
        logger.info(f"Fetching [{i+1}/{total}] {sat.get('league')} {sat.get('date')}")
        payload, err = fetch_satellite(client, sat)
        results.append({"satellite": sat, "payload": payload, "error": err})
        if on_progress:
            on_progress(i + 1, total, sat, err)
        if i < total - 1:
            time.sleep(delay)
    return results


# ==============================================================================
# MODULE: assayer/assayer_engine.py — Ma Assayer Python Port
# ==============================================================================

GRADES = [
    ("PLATINUM", 0.85, "⬡"),
    ("GOLD",     0.72, "Au"),
    ("SILVER",   0.62, "Ag"),
    ("BRONZE",   0.55, "Cu"),
    ("ROCK",     0.50, "ite"),
    ("CHARCOAL", 0.00, "🜃"),
]
WILSON_Z = 1.645
MIN_N = 10
MIN_N_RELIABLE = 30
MIN_LIFT = 0.03


def wilson_lower_bound(wins, n, z=WILSON_Z):
    if n == 0:
        return 0.0
    p = wins / n
    denom = 1 + (z * z / n)
    center = p + (z * z) / (2 * n)
    spread = z * math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n)))
    return max(0.0, (center - spread) / denom)


def shrink_rate(wins, n, alpha=2, beta=2):
    return (wins + alpha) / (n + alpha + beta)


def assign_grade(wr):
    for name, threshold, symbol in GRADES:
        if wr >= threshold:
            return name, symbol
    return "CHARCOAL", "🜃"


def classify_tier(win_rate, lower_bound, n):
    """
    BANKER  = safe tier  (positive edge, statistically reliable)
    ROBBER  = risky tier (opposite of bankers — avoid or use as fades)
    NEUTRAL = positive but insufficient confidence

    Decision tree:
      n < 10                                    → ROBBER  (too few samples)
      lower_bound >= 0.60 AND win_rate >= 0.72  → BANKER  (Gold+ grade)
      lower_bound >= 0.55 AND win_rate >= 0.62  → BANKER  (Silver grade)
      win_rate < 0.50                           → ROBBER  (below coinflip)
      else                                      → NEUTRAL
    """
    if n < MIN_N:
        return "ROBBER"
    if lower_bound >= 0.60 and win_rate >= 0.72:
        return "BANKER"
    if lower_bound >= 0.55 and win_rate >= 0.62:
        return "BANKER"
    if win_rate < 0.50:
        return "ROBBER"
    return "NEUTRAL"


def _norm(val):
    return str(val).strip().lower() if val is not None else ""


def _parse_outcome(val):
    v = _norm(val)
    if v in ("win", "w", "1", "hit", "yes", "correct", "✓", "won"):
        return "win"
    if v in ("loss", "l", "0", "miss", "no", "incorrect", "✗", "lost", "lose"):
        return "loss"
    return None


def _parse_float(val):
    try:
        return float(str(val).replace("%", "").strip())
    except Exception:
        return None


def _conf_bucket(conf):
    if conf is None:
        return "unknown"
    if conf >= 0.80: return "80+"
    if conf >= 0.70: return "70-79"
    if conf >= 0.60: return "60-69"
    if conf >= 0.50: return "50-59"
    return "<50"


def _build_edges(segments):
    edges = []
    for key, counts in segments.items():
        wins, losses = counts["wins"], counts["losses"]
        n = wins + losses
        if n < MIN_N:
            continue
        wr = wins / n
        lb = wilson_lower_bound(wins, n)
        grade, symbol = assign_grade(wr)
        tier = classify_tier(wr, lb, n)
        lift = wr - 0.50
        if abs(lift) < MIN_LIFT:
            continue
        edges.append({
            "key": "|".join(str(k) for k in key),
            "segment": key,
            "n": n, "wins": wins, "losses": losses,
            "win_rate": round(wr, 4),
            "shrunk_rate": round(shrink_rate(wins, n), 4),
            "lower_bound": round(lb, 4),
            "lift": round(lift, 4),
            "grade": grade, "symbol": symbol,
            "tier": tier,
            "reliable": n >= MIN_N_RELIABLE and lb > 0,
        })
    edges.sort(key=lambda e: (-e["win_rate"], -e["n"]))
    return edges


def assay_side_data(side_rows, source_label="Side"):
    segments = defaultdict(lambda: {"wins": 0, "losses": 0})
    for row in side_rows:
        outcome = _parse_outcome(row.get("outcome") or row.get("result") or
                                  row.get("Outcome") or row.get("Result") or "")
        if outcome is None:
            continue
        league  = _norm(row.get("league")     or row.get("League")     or "unknown")
        quarter = _norm(row.get("quarter")    or row.get("Quarter")    or "all")
        tier    = _norm(row.get("tier")       or row.get("Tier")       or "unknown")
        side    = _norm(row.get("side")       or row.get("Side")       or "unknown")
        conf_raw = _parse_float(row.get("confidence") or row.get("Confidence") or 0)
        if conf_raw and conf_raw > 1:
            conf_raw /= 100
        key = (league, quarter, tier, side, _conf_bucket(conf_raw), source_label)
        segments[key]["wins" if outcome == "win" else "losses"] += 1
    return _build_edges(segments)


def assay_totals_data(totals_rows, source_label="Totals"):
    segments = defaultdict(lambda: {"wins": 0, "losses": 0})
    for row in totals_rows:
        outcome = _parse_outcome(row.get("result") or row.get("Result") or
                                  row.get("outcome") or row.get("Outcome") or "")
        if outcome is None:
            continue
        league    = _norm(row.get("league")    or row.get("League")    or "unknown")
        quarter   = _norm(row.get("quarter")   or row.get("Quarter")   or "all")
        direction = _norm(row.get("direction") or row.get("Direction") or "unknown")
        bet_type  = _norm(row.get("type")      or row.get("Type")      or "ou")
        conf_raw  = _parse_float(row.get("confidence") or row.get("Confidence") or 0)
        if conf_raw and conf_raw > 1:
            conf_raw /= 100
        key = (league, quarter, direction, bet_type, _conf_bucket(conf_raw), source_label)
        segments[key]["wins" if outcome == "win" else "losses"] += 1
    return _build_edges(segments)


def compute_league_purity(edges):
    by_league = defaultdict(lambda: {"wins": 0, "n": 0, "grades": defaultdict(int)})
    for edge in edges:
        seg = edge.get("segment", ())
        league = seg[0] if seg else "unknown"
        by_league[league]["wins"] += edge["wins"]
        by_league[league]["n"]    += edge["n"]
        by_league[league]["grades"][edge["grade"]] += 1
    purity = []
    for league, stats in by_league.items():
        n, wins = stats["n"], stats["wins"]
        if n == 0:
            continue
        wr = wins / n
        lb = wilson_lower_bound(wins, n)
        grade, symbol = assign_grade(wr)
        purity.append({
            "league": league, "n": n,
            "win_rate": round(wr, 4),
            "lower_bound": round(lb, 4),
            "grade": grade, "symbol": symbol,
            "grade_counts": dict(stats["grades"]),
        })
    purity.sort(key=lambda p: -p["win_rate"])
    return purity


def run_full_assay(satellite_payload):
    data = satellite_payload.get("data", {})
    side_rows   = data.get("side", [])
    totals_rows = data.get("totals", [])
    all_edges   = assay_side_data(side_rows) + assay_totals_data(totals_rows)
    league_purity = compute_league_purity(all_edges)
    bankers  = [e for e in all_edges if e["tier"] == "BANKER"]
    robbers  = [e for e in all_edges if e["tier"] == "ROBBER"]
    neutrals = [e for e in all_edges if e["tier"] == "NEUTRAL"]
    grade_breakdown = defaultdict(int)
    for e in all_edges:
        grade_breakdown[e["grade"]] += 1
    total_n = sum(e["n"] for e in all_edges)
    summary = {
        "satellite_id":    satellite_payload.get("satellite_id"),
        "sheet_id":        satellite_payload.get("sheet_id"),
        "sheet_name":      satellite_payload.get("sheet_name"),
        "total_rows":      len(side_rows) + len(totals_rows),
        "total_edges":     len(all_edges),
        "bankers_count":   len(bankers),
        "robbers_count":   len(robbers),
        "neutrals_count":  len(neutrals),
        "gold_count":      sum(1 for e in all_edges if e["grade"] in ("GOLD", "PLATINUM")),
        "grade_breakdown": dict(grade_breakdown),
        "overall_win_rate": round(
            sum(e["win_rate"] * e["n"] for e in all_edges) / max(1, total_n), 4
        ) if all_edges else 0,
        "assayed_at": satellite_payload.get("fetched_at"),
    }
    return {
        "summary": summary, "edges": all_edges,
        "bankers": bankers, "robbers": robbers,
        "league_purity": league_purity,
    }


# ==============================================================================
# MODULE: app.py — Flask Web Server + All API Routes
# ==============================================================================

app = Flask(__name__, template_folder="templates")

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
    sats  = list_satellites()
    return render_template("dashboard.html",
                           stats=stats, satellites=sats,
                           configured=is_configured(),
                           now=datetime.utcnow().isoformat()[:16].replace("T", " ") + " UTC")


@app.route("/api/status")
def api_status():
    return jsonify({"google_configured": is_configured(),
                    "registry_count": len(list_satellites()),
                    "stats": summary_stats()})


@app.route("/api/satellites", methods=["GET"])
def api_satellites():
    return jsonify(list_satellites(
        date=request.args.get("date"),
        league=request.args.get("league"),
        fmt=request.args.get("format"),
    ))


@app.route("/api/satellites/add", methods=["POST"])
def api_add_satellite():
    body = request.json or {}
    sheet_id = body.get("sheet_id", "").strip()
    date     = body.get("date", "").strip()
    league   = body.get("league", "").strip()
    if not sheet_id:
        return jsonify({"error": "sheet_id is required"}), 400
    if not date or not league:
        return jsonify({"error": "date and league are required"}), 400
    sat, status = add_satellite(sheet_id, body.get("sheet_name","").strip(),
                                date, league, body.get("notes","").strip())
    return jsonify({"satellite": sat, "status": status})


@app.route("/api/satellites/bulk-add", methods=["POST"])
def api_bulk_add():
    entries = (request.json or {}).get("entries", [])
    if not isinstance(entries, list) or not entries:
        return jsonify({"error": "entries must be a non-empty list"}), 400
    return jsonify({"results": bulk_add(entries)})


@app.route("/api/satellites/<sat_id>", methods=["DELETE"])
def api_delete_satellite(sat_id):
    return jsonify({"removed": remove_satellite(sat_id)})


@app.route("/api/satellites/<sat_id>", methods=["GET"])
def api_get_satellite(sat_id):
    sat = get_satellite(sat_id)
    return jsonify(sat) if sat else (jsonify({"error": "Not found"}), 404)


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
    update_satellite(sat_id, status="fetched", format=payload["detected_format"],
                     sheet_name=payload["sheet_name"], row_counts=payload["row_counts"],
                     last_fetched=payload["fetched_at"])
    return jsonify({"payload_meta": {k: v for k, v in payload.items() if k != "data"},
                    "status": "fetched"})


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
    update_satellite(sat_id, status="fetched", format=payload["detected_format"],
                     sheet_name=payload["sheet_name"], row_counts=payload["row_counts"],
                     last_fetched=payload["fetched_at"])
    result = run_full_assay(payload)
    update_satellite(sat_id, status="assayed",
                     last_assayed=datetime.utcnow().isoformat(),
                     assay_summary=result["summary"])
    return jsonify({"summary": result["summary"],
                    "bankers": result["bankers"][:20],
                    "robbers": result["robbers"][:20],
                    "league_purity": result["league_purity"],
                    "top_edges": result["edges"][:30]})


def _run_batch_job(job_id, client, sats, do_assay=False):
    results = batch_fetch(client, sats,
                          on_progress=lambda d, t, s, e:
                              _set_job(job_id, "running",
                                       f"[{d}/{t}] {s.get('league')} {s.get('date')}"
                                       + (f" — ERROR: {e}" if e else "")))
    success = 0
    for r in results:
        sat = r["satellite"]
        sat_id = sat["id"]
        if r["error"]:
            update_satellite(sat_id, status="error", last_fetched=datetime.utcnow().isoformat())
            continue
        p = r["payload"]
        update_satellite(sat_id, status="fetched", format=p["detected_format"],
                         sheet_name=p["sheet_name"], row_counts=p["row_counts"],
                         last_fetched=p["fetched_at"])
        if do_assay:
            try:
                res = run_full_assay(p)
                update_satellite(sat_id, status="assayed",
                                 last_assayed=datetime.utcnow().isoformat(),
                                 assay_summary=res["summary"])
                _set_job(job_id, "running",
                         f"Assayed {sat.get('league')} {sat.get('date')} — "
                         f"{res['summary']['bankers_count']}B / {res['summary']['robbers_count']}R")
            except Exception as e:
                _set_job(job_id, "running", f"Assay ERROR {sat.get('league')}: {e}")
                continue
        success += 1
    _set_job(job_id, "done", f"Complete: {success}/{len(sats)} {'assayed' if do_assay else 'fetched'}")


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
    threading.Thread(target=_run_batch_job, args=(job_id, client, sats, False), daemon=True).start()
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
    threading.Thread(target=_run_batch_job, args=(job_id, client, sats, True), daemon=True).start()
    return jsonify({"job_id": job_id, "satellites": len(sats)})


@app.route("/api/job/<job_id>")
def api_job_status(job_id):
    status = _get_job(job_id)
    return jsonify(status) if status else (jsonify({"error": "Unknown job"}), 404)


@app.route("/api/reset-auth", methods=["POST"])
def api_reset_auth():
    reset_client()
    return jsonify({"status": "Auth cache cleared"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
