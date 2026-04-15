import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

GOLD_UNIVERSE_SHEETS = {"Side", "Totals", "MA_Vault", "MA_Discovery",
                         "ASSAYER_EDGES", "ASSAYER_LEAGUE_PURITY", "MA_Config"}
LEGACY_SHEETS = {"Predictions", "Results", "BetSlips", "Accuracy"}
SIDE_NAMES = {"Side", "side"}
TOTALS_NAMES = {"Totals", "totals"}
RESULTS_NAMES = {"ResultsClean", "Results", "results"}
UPCOMING_NAMES = {"UpcomingClean", "Upcoming", "upcoming"}

RATE_LIMIT_DELAY = 1.1


def _sheet_names(spreadsheet):
    return {ws.title for ws in spreadsheet.worksheets()}


def detect_format(sheet_names_set):
    gu_matches = sheet_names_set & GOLD_UNIVERSE_SHEETS
    legacy_matches = sheet_names_set & LEGACY_SHEETS
    if len(gu_matches) >= 2:
        return "gold_universe"
    if len(legacy_matches) >= 1:
        return "legacy"
    return "unknown"


def _safe_get_sheet(spreadsheet, name_candidates):
    for name in name_candidates:
        try:
            ws = spreadsheet.worksheet(name)
            return ws
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
        all_names = _sheet_names(ss)
    except Exception as e:
        return None, f"Cannot list worksheets: {e}"

    fmt = detect_format(all_names)

    side_ws = _safe_get_sheet(ss, SIDE_NAMES)
    totals_ws = _safe_get_sheet(ss, TOTALS_NAMES)
    results_ws = _safe_get_sheet(ss, RESULTS_NAMES)
    upcoming_ws = _safe_get_sheet(ss, UPCOMING_NAMES)

    side_data = _ws_to_records(side_ws)
    totals_data = _ws_to_records(totals_ws)
    results_data = _ws_to_records(results_ws)
    upcoming_data = _ws_to_records(upcoming_ws)

    payload = {
        "satellite_id": sat.get("id"),
        "sheet_id": sheet_id,
        "sheet_name": ss.title,
        "detected_format": fmt,
        "sheet_names": sorted(all_names),
        "fetched_at": datetime.utcnow().isoformat(),
        "data": {
            "side": side_data,
            "totals": totals_data,
            "results": results_data,
            "upcoming": upcoming_data,
        },
        "row_counts": {
            "side": len(side_data),
            "totals": len(totals_data),
            "results": len(results_data),
            "upcoming": len(upcoming_data),
        },
    }
    return payload, None


def batch_fetch(client, satellites, on_progress=None, delay=RATE_LIMIT_DELAY):
    results = []
    total = len(satellites)
    for i, sat in enumerate(satellites):
        sat_id = sat.get("id", "?")
        league = sat.get("league", "?")
        date = sat.get("date", "?")
        logger.info(f"Fetching [{i+1}/{total}] {league} {date} ({sat_id})")

        payload, err = fetch_satellite(client, sat)
        results.append({
            "satellite": sat,
            "payload": payload,
            "error": err,
        })

        if on_progress:
            on_progress(i + 1, total, sat, err)

        if i < total - 1:
            time.sleep(delay)

    return results
