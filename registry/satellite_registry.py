import json
import os
import uuid
from datetime import datetime

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "registry.json")

_EMPTY = {"satellites": []}


def _load():
    if not os.path.exists(REGISTRY_PATH):
        return _EMPTY.copy()
    with open(REGISTRY_PATH, "r") as f:
        try:
            return json.load(f)
        except Exception:
            return _EMPTY.copy()


def _save(data):
    os.makedirs(os.path.dirname(REGISTRY_PATH), exist_ok=True)
    with open(REGISTRY_PATH, "w") as f:
        json.dump(data, f, indent=2, default=str)


def list_satellites(date=None, league=None, fmt=None):
    data = _load()
    rows = data.get("satellites", [])
    if date:
        rows = [r for r in rows if r.get("date") == date]
    if league:
        rows = [r for r in rows if r.get("league", "").lower() == league.lower()]
    if fmt:
        rows = [r for r in rows if r.get("format") == fmt]
    return rows


def get_satellite(sat_id):
    data = _load()
    for s in data.get("satellites", []):
        if s.get("id") == sat_id:
            return s
    return None


def add_satellite(sheet_id, sheet_name, date, league, notes=""):
    data = _load()
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
    _save(data)
    return sat, "created"


def update_satellite(sat_id, **kwargs):
    data = _load()
    for s in data["satellites"]:
        if s.get("id") == sat_id:
            for k, v in kwargs.items():
                s[k] = v
            _save(data)
            return s
    return None


def remove_satellite(sat_id):
    data = _load()
    before = len(data["satellites"])
    data["satellites"] = [s for s in data["satellites"] if s.get("id") != sat_id]
    if len(data["satellites"]) < before:
        _save(data)
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
    total = len(sats)
    by_format = {}
    by_status = {}
    by_league = {}
    assayed = 0
    for s in sats:
        by_format[s.get("format", "unknown")] = by_format.get(s.get("format", "unknown"), 0) + 1
        by_status[s.get("status", "pending")] = by_status.get(s.get("status", "pending"), 0) + 1
        league = s.get("league", "Unknown")
        by_league[league] = by_league.get(league, 0) + 1
        if s.get("last_assayed"):
            assayed += 1
    return {
        "total": total,
        "assayed": assayed,
        "by_format": by_format,
        "by_status": by_status,
        "by_league": by_league,
    }
