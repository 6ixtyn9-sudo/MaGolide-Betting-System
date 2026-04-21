# Gold Universe — State Snapshot
**Generated:** 2026-04-15  
**Status:** Active build — Orchestrator running, Google auth pending secret injection

---

## 1. Repository & Directory Map

```
/ (project root)
├── app.py                          Flask web server — all API routes + background job threading
├── index.html                      Static doc viewer (superseded by Flask dashboard)
├── replit.md                       Project memory / architecture notes
├── GOLD_UNIVERSE_STATE.md          THIS FILE — state snapshot
├── orchestrator_backup.py          Single-file backup of all Orchestrator logic
├── SESSION_START_INSTRUCTIONS.txt  Paste into new session to resume build
│
├── auth/
│   ├── __init__.py
│   └── google_auth.py              Service Account auth via gspread. Reads
│                                   GOOGLE_SERVICE_ACCOUNT_JSON from env.
│                                   Caches the gspread client after first auth.
│
├── registry/
│   ├── __init__.py
│   ├── satellite_registry.py       JSON-based CRUD registry for all satellite sheets.
│   │                               Keyed by UUID. Stores: sheet_id, date, league,
│   │                               format, status, row_counts, assay_summary.
│   └── registry.json               AUTO-CREATED at runtime. Persists satellite list.
│                                   Not committed to git (add to .gitignore if needed).
│
├── fetcher/
│   ├── __init__.py
│   └── sheet_fetcher.py            Rate-limited gspread fetcher (1.1s delay between
│                                   sheets). Detects gold_universe vs legacy format.
│                                   Pulls: Side, Totals, ResultsClean, UpcomingClean.
│
├── assayer/
│   ├── __init__.py
│   └── assayer_engine.py           Python port of Ma Assayer GAS logic.
│                                   Wilson CI + shrinkage + lift scoring.
│                                   Outputs edges classified as BANKER/ROBBER/NEUTRAL.
│
├── templates/
│   └── dashboard.html              Flask Jinja2 dashboard. Dark-theme UI with:
│                                   - Stats bar (total sats, assayed, gold_universe, legacy)
│                                   - Satellite registry table with per-row Fetch/Assay buttons
│                                   - Bulk "Fetch All" and "Run Full Assay on All" buttons
│                                   - Job log (polls /api/job/<id> every 2s)
│                                   - Inline assay result panel (Bankers, Robbers, League Purity)
│                                   - Add satellite form + bulk JSON import
│
├── docs/                           Ma Golide SATELLITE .gs scripts (11 files)
│   ├── Sheet_Setup.gs              Module 1 — bootstrapper (run first in GAS)
│   ├── Config_Ledger_Satellite.gs  Module 2 — sport config + ledger
│   ├── Signal_Processor.gs         Module 3 — raw data cleaning
│   ├── Data_Parser.gs              Module 4 — concatenated string parsing
│   ├── Margin_Analyzer.gs          Module 5 — spread predictions
│   ├── Forecaster.gs               Module 6 — trend forecasting
│   ├── Game_Processor.gs           Module 7 — O/U + quarter predictions
│   ├── Inventory_Manager.gs        Module 8 — game inventory
│   ├── Accumulator_Builder.gs      Module 9 — parlay/acca assembly
│   ├── Contract_Enforcer.gs        Audit — integrity enforcement
│   └── Contract_Enforcement.gs     Audit — full audit trail
│
├── ma_assayer/docs/                Ma Assayer .gs scripts (11 files, v4.3.0)
│   ├── Main_Orchestrator.gs        M2 — GAS controller ("Run Full Assay" trigger)
│   ├── Config_ConfigurationAndConstants.gs  M5 — sheet names, thresholds, grades
│   ├── ConfigLedger_Reader.gs      Config stamp drift detection
│   ├── ColResolver_ColumnMatching.gs  M6 — fuzzy column matching (Levenshtein)
│   ├── Discovery_Edge.gs           M4 — edge discovery engine
│   ├── Flagger_FlagsSourceSheets.gs  M3 — writes grades back to source sheets
│   ├── Output_Writers.gs           M1 — writes ASSAYER_EDGES + ASSAYER_LEAGUE_PURITY
│   ├── Parser_DataParsing.gs       M7 — row parsing
│   ├── Stats_StatsCalculations.gs  M8 — Wilson CI, shrinkage, Brier
│   ├── Utils_UtilityFunctions.gs   M9 — helpers
│   └── Log_LoggingSystem.gs        M10 — structured logging
│
├── ma_golide_mothership/doc/       Mothership .gs scripts (11 files)
│   ├── Mothership_Genesis.gs       Setup bootstrapper
│   ├── Mothership_Menu.gs          GAS custom menu
│   ├── Mothership_ Intelligence_Core.gs  MIC — Bayesian learning, BET/CAUTION/BLOCK
│   ├── Mothership_AccaEngine.gs    Standard acca assembly
│   ├── Mothership_AssayerBridge.gs Multi-satellite bridge
│   ├── Mothership_HiveMind.gs      Cross-satellite intelligence synthesis
│   ├── Mothership_RiskyAccaBuilder.gs  Risky (Robbers) acca builder
│   ├── Mothership_RiskyAnalyzer.gs Risky acca performance analysis
│   ├── Performance_Analyzer.gs     Win rates, ROI, trend direction
│   ├── Systems Audit.gs            End-to-end integrity check
│   └── ConfigLedger_Mothership.gs  Config stamp drift gating for accas
│
└── attached_assets/                Source packed .git.md files (read-only reference)
    ├── Ma_Assayer.git_*.md
    └── Ma_Golide_Mothership.git_*.md
```

---

## 2. Google Service Account Integration Status

| Item | Status |
|---|---|
| Secret name | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Secret set? | **NOT YET** — pending user action |
| Auth method | `google.oauth2.service_account.Credentials` via `gspread.authorize()` |
| Scopes | `spreadsheets.readonly` + `drive.readonly` |
| Client caching | Module-level `_client_cache` — initialized once, reused across requests |
| Reset endpoint | `POST /api/reset-auth` clears cache to force re-auth |
| Graceful fallback | Dashboard loads and registry works without auth; all fetch/assay buttons disabled |

**To activate:** Go to Replit Secrets → add `GOOGLE_SERVICE_ACCOUNT_JSON` with the full JSON content of a Google Service Account key. Then share each satellite spreadsheet (or the parent Drive folder) with the service account email (`...@....iam.gserviceaccount.com`).

---

## 3. Bankers vs Robbers Classification Logic

Defined in `assayer/assayer_engine.py` → `classify_tier(win_rate, lower_bound, n)`:

```
BANKER  = safe tier (reliable positive edge)
ROBBER  = risky tier (opposite of bankers — avoid or use as fades)
NEUTRAL = insufficient evidence either way
```

### Exact decision tree:

```python
def classify_tier(win_rate, lower_bound, n):
    # Step 1: Minimum sample gate
    if n < 10:
        return "ROBBER"           # Too few samples — unsafe

    # Step 2: Strong BANKER — Gold+ grade with tight lower bound
    if lower_bound >= 0.60 and win_rate >= 0.72:
        return "BANKER"           # High confidence, Gold+ win rate

    # Step 3: Moderate BANKER — Silver grade with decent lower bound  
    if lower_bound >= 0.55 and win_rate >= 0.62:
        return "BANKER"           # Reliable Silver-tier edge

    # Step 4: Negative edge — ROBBER
    if win_rate < 0.50:
        return "ROBBER"           # Below coinflip = fade candidate

    # Step 5: Positive but uncertain
    return "NEUTRAL"              # Needs more data
```

### Supporting statistics:
- **Wilson Lower Bound** (80% one-sided CI, z=1.645): Conservative estimate of true win rate
- **Shrinkage rate**: `(wins + 2) / (n + 4)` — Bayesian smoothing toward 50%
- **Minimum lift gate**: `|win_rate - 0.50| >= 0.03` — edges smaller than 3% are discarded
- **Reliable flag**: `n >= 30 AND lower_bound > 0`

### Grade scale (used alongside tier):
| Grade | Min Win Rate | Symbol |
|---|---|---|
| PLATINUM | 85% | ⬡ |
| GOLD | 72% | Au |
| SILVER | 62% | Ag |
| BRONZE | 55% | Cu |
| ROCK | 50% | ite |
| CHARCOAL | 0% | 🜃 |

---

## 4. API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Dashboard (Jinja2) |
| GET | `/api/status` | Health check + registry count |
| GET | `/api/satellites` | List registry (filters: date, league, format) |
| POST | `/api/satellites/add` | Add one satellite |
| POST | `/api/satellites/bulk-add` | Bulk add from JSON array |
| DELETE | `/api/satellites/<id>` | Remove from registry |
| GET | `/api/satellites/<id>` | Get one satellite |
| POST | `/api/fetch/<id>` | Fetch one satellite's sheet data |
| POST | `/api/assay/<id>` | Fetch + full assay on one satellite |
| POST | `/api/fetch-all` | Background batch fetch all (threaded) |
| POST | `/api/assay-all` | Background batch assay all (threaded) |
| GET | `/api/job/<job_id>` | Poll background job progress |
| POST | `/api/reset-auth` | Clear gspread client cache |

---

## 5. Key Design Rules (Phase 1)

- **Manual control only** — no cron jobs, no auto-triggers
- **No audit logs** in Phase 1
- **No automated rollback**
- Rate limit: **1.1 seconds** between Google API calls
- Registry persists to `registry/registry.json` (JSON flat file, no DB)
- Background jobs use Python `threading.Thread(daemon=True)`
- Job progress polled by frontend every 2 seconds via `/api/job/<id>`
- Satellite format auto-detected: `gold_universe` (≥2 MA_ sheets) vs `legacy`

---

## 6. Satellite Sheet Data Contract

Sheets pulled from each satellite:
| Sheet name variants | Purpose | Format |
|---|---|---|
| `Bet_Slips` / `BetSlips` | Consolidated picks (Bankers, Snipers, Robbers, 1H, FT_OU) | Gold Universe / Unified |
| `ResultsClean` / `Results` | Settled results / ground truth | Both |
| `UpcomingClean` / `Upcoming` | Upcoming games and derived metrics | Both |
| `Side` / `side` | Side bets (1X2, H/A picks) | Legacy (Deprecated) |
| `Totals` / `totals` | Over/Under bets | Legacy (Deprecated) |
