# Gold Universe Orchestrator

## Overview
A Python/Flask web backend that connects to hundreds of Google Sheets satellite spreadsheets, runs the Ma Assayer purity engine, and displays results in a live dashboard.

## Architecture
```
Satellites (Google Sheets) → Fetcher → Assayer Engine → Dashboard
    rate-limited gspread        Python port     Flask + HTML
```

## Three-Repo Gold Universe (GAS scripts stored in project)
```
docs/                            # Ma Golide Satellite scripts (11 .gs files)
ma_assayer/docs/                 # Ma Assayer scripts (11 .gs files)
ma_golide_mothership/doc/        # Mothership scripts (11 .gs files)
```

## Python Backend (the Orchestrator)
```
app.py                           # Flask web server + all API routes
auth/google_auth.py              # Service account auth via gspread
registry/satellite_registry.py  # JSON-based satellite registry (CRUD)
registry/registry.json          # Auto-created: satellite data store
fetcher/sheet_fetcher.py         # Rate-limited batch fetcher (1.1s delay)
assayer/assayer_engine.py        # Ma Assayer Python port (Wilson CI, grades)
templates/dashboard.html         # Live dashboard UI
```

## Secrets Required
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Full JSON content of a Google Service Account key file.
  Share your satellites root Drive folder with the service account email address.

## Key Design Decisions (Phase 1)
- **Manual control only** — no automated triggers or scheduled runs
- **Bankers** = safe tier (win rate ≥ 62%, lower bound ≥ 55%)
- **Robbers** = risky tier (opposite of bankers — avoid)
- **No audit logs or auto-rollback** in Phase 1
- Registry stored as `registry/registry.json` (portable, no DB needed)
- Rate limiting: 1.1s between Google API calls to avoid quota errors
- Background threading for bulk operations (non-blocking UI)

## API Endpoints
- `GET /` — Dashboard
- `GET /api/satellites` — List registry (filters: date, league, format)
- `POST /api/satellites/add` — Add one satellite
- `POST /api/satellites/bulk-add` — Bulk add from JSON array
- `DELETE /api/satellites/<id>` — Remove from registry
- `POST /api/fetch/<id>` — Fetch one satellite's sheet data
- `POST /api/assay/<id>` — Fetch + run full assay on one satellite
- `POST /api/fetch-all` — Background batch fetch all satellites
- `POST /api/assay-all` — Background batch assay all satellites
- `GET /api/job/<job_id>` — Poll background job status

## Purity Grades
Platinum (≥85%) → Gold (≥72%) → Silver (≥62%) → Bronze (≥55%) → Rock (≥50%) → Charcoal (<50%)

## Workflow
`Start application` — `python3 app.py` on port 5000
