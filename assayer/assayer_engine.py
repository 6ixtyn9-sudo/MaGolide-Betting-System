"""
Ma Assayer — Python port of the core purity engine.
Separates Gold from Charcoal using Wilson confidence intervals,
shrinkage estimators, and lift scoring.
Tier system: Bankers (safe) / Robbers (risky — the opposite of bankers).
"""

import math
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

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


def shrink_rate(wins, n, prior_alpha=2, prior_beta=2):
    return (wins + prior_alpha) / (n + prior_alpha + prior_beta)


def assign_grade(win_rate):
    for name, threshold, symbol in GRADES:
        if win_rate >= threshold:
            return name, symbol
    return "CHARCOAL", "🜃"


def classify_tier(win_rate, lower_bound, n):
    if n < MIN_N:
        return "ROBBER"
    if lower_bound >= 0.60 and win_rate >= 0.72:
        return "BANKER"
    if lower_bound >= 0.55 and win_rate >= 0.62:
        return "BANKER"
    if win_rate < 0.50:
        return "ROBBER"
    return "NEUTRAL"


def _normalise(val):
    if val is None:
        return ""
    return str(val).strip().lower()


def _parse_outcome(val):
    v = _normalise(val)
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


def assay_side_data(side_rows, source_label="Side"):
    segments = defaultdict(lambda: {"wins": 0, "losses": 0})

    for row in side_rows:
        outcome = _parse_outcome(row.get("outcome") or row.get("result") or
                                  row.get("Outcome") or row.get("Result") or "")
        if outcome is None:
            continue

        league = _normalise(row.get("league") or row.get("League") or "unknown")
        quarter = _normalise(row.get("quarter") or row.get("Quarter") or "all")
        tier = _normalise(row.get("tier") or row.get("Tier") or "unknown")
        side = _normalise(row.get("side") or row.get("Side") or "unknown")

        conf_raw = _parse_float(row.get("confidence") or row.get("Confidence") or 0)
        if conf_raw is not None and conf_raw > 1:
            conf_raw /= 100
        conf_bucket = _conf_bucket(conf_raw)

        key = (league, quarter, tier, side, conf_bucket, source_label)
        segments[key]["wins" if outcome == "win" else "losses"] += 1

    return _build_edges(segments)


def assay_totals_data(totals_rows, source_label="Totals"):
    segments = defaultdict(lambda: {"wins": 0, "losses": 0})

    for row in totals_rows:
        outcome = _parse_outcome(row.get("result") or row.get("Result") or
                                  row.get("outcome") or row.get("Outcome") or "")
        if outcome is None:
            continue

        league = _normalise(row.get("league") or row.get("League") or "unknown")
        quarter = _normalise(row.get("quarter") or row.get("Quarter") or "all")
        direction = _normalise(row.get("direction") or row.get("Direction") or "unknown")
        bet_type = _normalise(row.get("type") or row.get("Type") or "ou")

        conf_raw = _parse_float(row.get("confidence") or row.get("Confidence") or 0)
        if conf_raw is not None and conf_raw > 1:
            conf_raw /= 100
        conf_bucket = _conf_bucket(conf_raw)

        key = (league, quarter, direction, bet_type, conf_bucket, source_label)
        segments[key]["wins" if outcome == "win" else "losses"] += 1

    return _build_edges(segments)


def _conf_bucket(conf):
    if conf is None:
        return "unknown"
    if conf >= 0.80:
        return "80+"
    if conf >= 0.70:
        return "70-79"
    if conf >= 0.60:
        return "60-69"
    if conf >= 0.50:
        return "50-59"
    return "<50"


def _build_edges(segments):
    edges = []
    for key, counts in segments.items():
        wins = counts["wins"]
        losses = counts["losses"]
        n = wins + losses
        if n < MIN_N:
            continue

        win_rate = wins / n
        shrunk = shrink_rate(wins, n)
        lb = wilson_lower_bound(wins, n)
        grade, symbol = assign_grade(win_rate)
        tier = classify_tier(win_rate, lb, n)
        reliable = n >= MIN_N_RELIABLE and lb > 0
        lift = win_rate - 0.50

        if abs(lift) < MIN_LIFT:
            continue

        edge = {
            "key": "|".join(str(k) for k in key),
            "segment": key,
            "n": n,
            "wins": wins,
            "losses": losses,
            "win_rate": round(win_rate, 4),
            "shrunk_rate": round(shrunk, 4),
            "lower_bound": round(lb, 4),
            "lift": round(lift, 4),
            "grade": grade,
            "symbol": symbol,
            "tier": tier,
            "reliable": reliable,
        }
        edges.append(edge)

    edges.sort(key=lambda e: (-e["win_rate"], -e["n"]))
    return edges


def compute_league_purity(edges):
    by_league = defaultdict(lambda: {"wins": 0, "n": 0, "grades": defaultdict(int)})
    for edge in edges:
        seg = edge.get("segment", ())
        league = seg[0] if seg else "unknown"
        by_league[league]["wins"] += edge["wins"]
        by_league[league]["n"] += edge["n"]
        by_league[league]["grades"][edge["grade"]] += 1

    purity = []
    for league, stats in by_league.items():
        n = stats["n"]
        wins = stats["wins"]
        if n == 0:
            continue
        wr = wins / n
        lb = wilson_lower_bound(wins, n)
        grade, symbol = assign_grade(wr)
        purity.append({
            "league": league,
            "n": n,
            "win_rate": round(wr, 4),
            "lower_bound": round(lb, 4),
            "grade": grade,
            "symbol": symbol,
            "grade_counts": dict(stats["grades"]),
        })

    purity.sort(key=lambda p: -p["win_rate"])
    return purity


def run_full_assay(satellite_payload):
    data = satellite_payload.get("data", {})
    side_rows = data.get("side", [])
    totals_rows = data.get("totals", [])

    side_edges = assay_side_data(side_rows, source_label="Side")
    totals_edges = assay_totals_data(totals_rows, source_label="Totals")
    all_edges = side_edges + totals_edges

    league_purity = compute_league_purity(all_edges)

    bankers = [e for e in all_edges if e["tier"] == "BANKER"]
    robbers = [e for e in all_edges if e["tier"] == "ROBBER"]
    neutrals = [e for e in all_edges if e["tier"] == "NEUTRAL"]

    gold_count = sum(1 for e in all_edges if e["grade"] in ("GOLD", "PLATINUM"))
    total_edges = len(all_edges)

    grade_breakdown = defaultdict(int)
    for e in all_edges:
        grade_breakdown[e["grade"]] += 1

    summary = {
        "satellite_id": satellite_payload.get("satellite_id"),
        "sheet_id": satellite_payload.get("sheet_id"),
        "sheet_name": satellite_payload.get("sheet_name"),
        "total_rows": len(side_rows) + len(totals_rows),
        "total_edges": total_edges,
        "bankers_count": len(bankers),
        "robbers_count": len(robbers),
        "neutrals_count": len(neutrals),
        "gold_count": gold_count,
        "grade_breakdown": dict(grade_breakdown),
        "overall_win_rate": round(
            sum(e["win_rate"] * e["n"] for e in all_edges) / max(1, sum(e["n"] for e in all_edges)), 4
        ) if all_edges else 0,
        "assayed_at": satellite_payload.get("fetched_at"),
    }

    return {
        "summary": summary,
        "edges": all_edges,
        "bankers": bankers,
        "robbers": robbers,
        "league_purity": league_purity,
    }
