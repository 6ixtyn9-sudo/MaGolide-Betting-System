# Ma Golide Betting System

## Overview
An advanced sports betting prediction and audit system built for Google Apps Script (GAS), integrated with Google Sheets.

## Project Structure
- `docs/` — All Google Apps Script (.gs) modules
  - `Sheet_Setup.gs` — Module 1: Creates the full sheet infrastructure
  - `Config_Ledger_Satellite.gs` — Configuration snapshots and version tracking
  - `Game_Processor.gs` — Core probability models and scoring logic
  - `Forecaster.gs` — Betting signal generation
  - `Signal_Processor.gs` — Trend analysis
  - `Accumulator_Builder.gs` — Multi-bet parlay/accumulator creation
  - `Data_Parser.gs` — External sports data cleaning and formatting
  - `Contract_Enforcer.gs` / `Contract_Enforcement.gs` — Data validation between modules
  - `Inventory_Manager.gs` — Betting asset management
  - `Margin_Analyzer.gs` — Bookmaker margin and edge analysis
- `server.js` — Simple Node.js web viewer for browsing the .gs source files

## Tech Stack
- **Platform:** Google Apps Script (Google Sheets integration)
- **Language:** JavaScript (.gs files)
- **Viewer:** Node.js HTTP server (no external dependencies)

## Running Locally
The project runs a lightweight web viewer on port 5000 to browse the .gs scripts:
```
node server.js
```

## Deployment
- Target: Autoscale
- Run command: `node server.js`
- Port: 5000

## Usage
The `.gs` files are meant to be copied into a Google Apps Script project linked to Google Sheets. The entry point is `Sheet_Setup.gs → setupAllSheets()`.
