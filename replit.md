# Ma Golide — Betting System

## Overview
Ma Golide is an advanced sports betting prediction and analysis system built with **Google Apps Script**. It runs entirely inside **Google Sheets** and is not a traditional web application.

## Project Type
- **Language:** JavaScript (Google Apps Script `.gs` files)
- **Platform:** Google Workspace (Google Sheets)
- **No build system or package manager** — scripts are deployed directly to Google Sheets via the Apps Script editor or using Clasp.

## Project Layout
```
docs/                         # All Google Apps Script modules
  Sheet_Setup.gs              # Module 1: Infrastructure setup (run first)
  Config_Ledger_Satellite.gs  # Module 2: Configuration & ledger
  Signal_Processor.gs         # Module 3: Raw data cleaning
  Data_Parser.gs              # Module 4: Advanced string parsing
  Margin_Analyzer.gs          # Module 5: Margin & spread predictions
  Forecaster.gs               # Module 6: Trend forecasting
  Game_Processor.gs           # Module 7: Over/Under & quarter predictions
  Inventory_Manager.gs        # Module 8: Game inventory tracking
  Accumulator_Builder.gs      # Module 9: Parlay/accumulator assembly
  Contract_Enforcer.gs        # Audit: Data integrity enforcement
  Contract_Enforcement.gs     # Audit: Full audit trail & accuracy reporting
index.html                    # Documentation viewer served in Replit preview
```

## Replit Setup
Since this is a Google Apps Script project (no web server), a static HTML documentation viewer (`index.html`) is served via Python's HTTP server on port 5000.

- **Workflow:** `Start application` runs `python3 -m http.server 5000 --bind 0.0.0.0`
- **Deployment:** Configured as static site serving the root directory

## How to Deploy the Scripts to Google Sheets
1. Open your Google Sheet and go to **Extensions → Apps Script**
2. Copy each `.gs` file from the `docs/` folder into the editor
3. Run `Sheet_Setup` first to initialize the spreadsheet structure
4. Use the custom menus to interact with each module

Or use **Clasp** for CLI-based deployment: `clasp push`

## Key Features
- Resilient parsing of concatenated sports data strings
- Multi-sport support: NBA, NFL, Volleyball
- Advanced analytics: shrinkage, continuity correction, conditional win rates
- Confidence tiers: Elite / Strong / Medium / Weak
- ROBBERS upset detection engine
- Full audit trail: Predictions → Bet Slips → Results → Accuracy Reports
