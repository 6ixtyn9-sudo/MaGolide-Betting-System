/******************************************************************************
 * GOLD UNIVERSE — Contract_Enforcer (Phase 0 / P0B)
 * Ma_Golide_Satellites — paste as its own Apps Script file BEFORE other modules.
 *
 * Single place for: canonical IDs, date normalization, team dictionary,
 * header maps, and config validation. Downstream patches call these helpers
 * instead of reimplementing string math.
 ******************************************************************************/

/** @NotOnlyCurrentDoc */

// -----------------------------------------------------------------------------
// P0 — Contract primitives (enums / semantics are documentation + constants)
// -----------------------------------------------------------------------------
var CONTRACT_VERSION = "GOLD-UNIVERSE-CONTRACT-1.0";
var CONTRACT_BUILD_DATE = "2026-04-12";

/** IANA timezone used when turning Dates / serials into calendar dates */
var SATELLITE_TIMEZONE = "Africa/Johannesburg";

/**
 * Uppercase alias → canonical team token (no spaces; Assayer join-safe).
 * Expand per league. Unknown inputs cause enforceTeamNameResolution_ to throw.
 */
var TEAM_DICTIONARY = {
  "LA LAKERS": "LAKERS",
  "LOS ANGELES LAKERS": "LAKERS",
  "L.A. LAKERS": "LAKERS",
  "LAKERS": "LAKERS",
  "NY KNICKS": "KNICKS",
  "NEW YORK KNICKS": "KNICKS",
  "KNICKS": "KNICKS",
  "BOSTON CELTICS": "CELTICS",
  "CELTICS": "CELTICS"
};

var ContractMarket = {
  BANKER: "BANKER",
  SNIPER_MARGIN: "SNIPER_MARGIN",
  SNIPER_OU: "SNIPER_OU",
  SNIPER_OU_DIR: "SNIPER_OU_DIR",
  SNIPER_OU_STAR: "SNIPER_OU_STAR",
  SNIPER_HIGH_QTR: "SNIPER_HIGH_QTR",
  ROBBER: "ROBBER",
  FIRST_HALF_1X2: "FIRST_HALF_1X2",
  FT_OU: "FT_OU"
};

var ContractMatchQuality = {
  EXACT: "EXACT",
  DATE_FUZZY: "DATE_FUZZY",
  NO_DATE_UNIQUE: "NO_DATE_UNIQUE",
  TEAM_FUZZY: "TEAM_FUZZY",
  NO_MATCH: "NO_MATCH"
};

// -----------------------------------------------------------------------------
// NEW-1 — Dictionary-backed team normalizer (throws if unknown)
// -----------------------------------------------------------------------------
function enforceTeamNameResolution_(rawName) {
  var s = String(rawName == null ? "" : rawName).trim();
  if (!s) {
    throw new Error("Contract_Enforcer: empty team name");
  }
  var upper = s.toUpperCase().replace(/\s+/g, " ");
  if (TEAM_DICTIONARY[upper]) {
    return TEAM_DICTIONARY[upper];
  }
  var collapsed = upper.replace(/[^A-Z0-9\s]/g, "").replace(/\s+/g, " ");
  var keys = Object.keys(TEAM_DICTIONARY);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.replace(/[^A-Z0-9\s]/g, "").replace(/\s+/g, " ") === collapsed) {
      return TEAM_DICTIONARY[k];
    }
  }
  throw new Error("Contract_Enforcer: unknown team (add to TEAM_DICTIONARY): " + rawName);
}

// -----------------------------------------------------------------------------
// NEW-5 — Calendar date in YYYY-MM-DD (timezone-stable)
// -----------------------------------------------------------------------------
function standardizeDate_(dateInput, tzOpt) {
  var tz = tzOpt || SATELLITE_TIMEZONE || Session.getScriptTimeZone() || "UTC";
  var diag = buildDateParseDiagnostics_(dateInput);
  if (!diag.matchFlag) {
    Logger.log("Contract_Enforcer.standardizeDate_: unparseable input: " + JSON.stringify(diag));
    return "";
  }

  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return Utilities.formatDate(dateInput, tz, "yyyy-MM-dd");
  }

  if (typeof dateInput === "number" && isFinite(dateInput)) {
    var epoch = new Date(1899, 11, 30);
    var ms = epoch.getTime() + dateInput * 86400000;
    var d = new Date(ms);
    return Utilities.formatDate(d, tz, "yyyy-MM-dd");
  }

  var str = String(dateInput).trim();
  if (!str) {
    return "";
  }

  // ISO YYYY-MM-DD
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return iso[1] + "-" + iso[2] + "-" + iso[3];
  }

  // DD/MM/YYYY or MM/DD/YYYY (prefer day-first if first token > 12)
  var m1 = str.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m1) {
    var a = parseInt(m1[1], 10);
    var b = parseInt(m1[2], 10);
    var y = parseInt(m1[3], 10);
    if (y < 100) {
      y += 2000;
    }
    var day;
    var month;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      day = b;
      month = a;
    } else {
      day = b;
      month = a;
    }
    var yyyy = String(y);
    var mm = (month < 10 ? "0" : "") + month;
    var dd = (day < 10 ? "0" : "") + day;
    return yyyy + "-" + mm + "-" + dd;
  }

  Logger.log("Contract_Enforcer.standardizeDate_: failed for: " + str);
  return "";
}

// -----------------------------------------------------------------------------
// NEW-12 — Parse diagnostics
// -----------------------------------------------------------------------------
function buildDateParseDiagnostics_(input) {
  var out = {
    source: input,
    detectedFormat: "NONE",
    matchFlag: false
  };

  if (input == null || input === "") {
    return out;
  }

  if (input instanceof Date && !isNaN(input.getTime())) {
    out.detectedFormat = "DATE_OBJECT";
    out.matchFlag = true;
    return out;
  }

  if (typeof input === "number" && isFinite(input)) {
    out.detectedFormat = "SHEET_SERIAL";
    out.matchFlag = true;
    return out;
  }

  var str = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    out.detectedFormat = "ISO_DATE";
    out.matchFlag = true;
    return out;
  }

  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(str)) {
    out.detectedFormat = "DELIMITED_DMY_OR_MDY";
    out.matchFlag = true;
    return out;
  }

  return out;
}

// -----------------------------------------------------------------------------
// NEW-2 — Universal_Game_ID: YYYYMMDD__HOME__AWAY
// -----------------------------------------------------------------------------
function buildUniversalGameID_(date, home, away) {
  var ymd = standardizeDate_(date);
  if (!ymd) {
    throw new Error("Contract_Enforcer: invalid date for Universal_Game_ID");
  }
  var compact = ymd.replace(/-/g, "");
  var h = enforceTeamNameResolution_(home);
  var a = enforceTeamNameResolution_(away);
  return compact + "__" + h + "__" + a;
}

// -----------------------------------------------------------------------------
// NEW-3 — Prediction_Record_ID
// -----------------------------------------------------------------------------
function buildPredictionRecordID_(gameID, market, period, configVersion) {
  var enc = function (s) {
    return String(s == null ? "" : s)
      .trim()
      .replace(/__/g, "_")
      .replace(/\s+/g, "_");
  };
  return enc(gameID) + "__" + enc(market) + "__" + enc(period) + "__" + enc(configVersion);
}

// -----------------------------------------------------------------------------
// NEW-4 — Bet_Record_ID
// -----------------------------------------------------------------------------
function buildBetRecordID_(predictionRecordID, slipIndex) {
  return String(predictionRecordID) + "__SLIP_" + String(slipIndex);
}

// -----------------------------------------------------------------------------
// NEW-6
// -----------------------------------------------------------------------------
function enforceFloatNumber_(value) {
  if (value == null || value === "") {
    return 0.0;
  }
  if (typeof value === "number" && isFinite(value)) {
    return value;
  }
  var s = String(value).replace(/,/g, "");
  var m = s.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  if (!m) {
    return 0.0;
  }
  var n = parseFloat(m[0]);
  return isFinite(n) ? n : 0.0;
}

// -----------------------------------------------------------------------------
// NEW-7
// -----------------------------------------------------------------------------
function validateConfigState_(configObj, requiredKeys) {
  if (!configObj || typeof configObj !== "object") {
    throw new Error("Contract_Enforcer: config object required");
  }
  for (var i = 0; i < requiredKeys.length; i++) {
    var k = requiredKeys[i];
    if (!(k in configObj)) {
      throw new Error("Contract_Enforcer: missing config key: " + k);
    }
    var v = configObj[k];
    if (v === undefined || v === null) {
      throw new Error("Contract_Enforcer: missing config key: " + k);
    }
    if (typeof v === "string" && v.trim() === "") {
      throw new Error("Contract_Enforcer: empty config key: " + k);
    }
  }
}

// -----------------------------------------------------------------------------
// NEW-8 — Single canonical header token
// -----------------------------------------------------------------------------
function canonicalHeaderKey_(headerString) {
  return String(headerString == null ? "" : headerString)
    .trim()
    .toLowerCase()
    .replace(/[\s\-\.]+/g, "_")
    .replace(/[^\w_]/g, "");
}

// -----------------------------------------------------------------------------
// NEW-9
// -----------------------------------------------------------------------------
function createCanonicalHeaderMap_(headerRow) {
  var map = {};
  if (!headerRow || !headerRow.length) {
    return map;
  }
  for (var i = 0; i < headerRow.length; i++) {
    var key = canonicalHeaderKey_(headerRow[i]);
    if (key && map[key] === undefined) {
      map[key] = i;
    }
  }
  return map;
}

// -----------------------------------------------------------------------------
// NEW-10 — aliases: array of header strings; returns 0-based column index or -1
// -----------------------------------------------------------------------------
function findHeaderIndex_(map, aliases) {
  if (!map || !aliases || !aliases.length) {
    return -1;
  }
  for (var i = 0; i < aliases.length; i++) {
    var k = canonicalHeaderKey_(aliases[i]);
    if (Object.prototype.hasOwnProperty.call(map, k)) {
      return map[k];
    }
  }
  return -1;
}

// -----------------------------------------------------------------------------
// NEW-11 — Sorted pair for fallback matching only
// -----------------------------------------------------------------------------
function buildSortedMatchupKey_(home, away) {
  var h = enforceTeamNameResolution_(home);
  var a = enforceTeamNameResolution_(away);
  var pair = [h, a].sort();
  return pair[0] + "||" + pair[1];
}

// -----------------------------------------------------------------------------
// Phase 2 — Forensic log common contract (first 17 columns, exact order)
// -----------------------------------------------------------------------------
var FORENSIC_CORE_17 = [
  "Prediction_Record_ID",
  "Universal_Game_ID",
  "Config_Version",
  "Timestamp_UTC",
  "League",
  "Date",
  "Home",
  "Away",
  "Market",
  "Period",
  "Pick_Code",
  "Pick_Text",
  "Confidence_Pct",
  "Confidence_Prob",
  "Tier_Code",
  "EV",
  "Edge_Score"
];

/** Bet_Slips machine contract (23 columns) — Phase 2 Patch 3B */
var BET_SLIPS_CONTRACT_23 = [
  "Bet_Record_ID",
  "Universal_Game_ID",
  "Source_Prediction_Record_ID",
  "League",
  "Date",
  "Home",
  "Away",
  "Market",
  "Period",
  "Selection_Side",
  "Selection_Line",
  "Selection_Team",
  "Selection_Text",
  "Odds",
  "Confidence_Pct",
  "Confidence_Prob",
  "EV",
  "Tier_Code",
  "Tier_Display",
  "Config_Version_T1",
  "Config_Version_T2",
  "Config_Version_Acc",
  "Source_Module"
];

/** ResultsClean canonical machine columns (append-only header upgrade) */
var RESULTS_CLEAN_CANONICAL_MIN = [
  "Universal_Game_ID",
  "Date",
  "Home",
  "Away",
  "Q1_Home",
  "Q1_Away",
  "Q2_Home",
  "Q2_Away",
  "Q3_Home",
  "Q3_Away",
  "Q4_Home",
  "Q4_Away",
  "FT_Home",
  "FT_Away"
];

function tierCodeFromPct_(pct) {
  var p = Number(pct);
  if (!isFinite(p)) return "SKIP";
  if (p > 1 && p <= 100) { /* ok */ } else if (p > 0 && p <= 1) { p = p * 100; }
  if (p >= 75) return "ELITE";
  if (p >= 65) return "STRONG";
  if (p >= 55) return "MEDIUM";
  if (p >= 50) return "WEAK";
  return "SKIP";
}

function buildTierDisplayFromPct_(pct) {
  var p = Number(pct);
  if (!isFinite(p)) return "★ (0%) ★";
  if (p > 0 && p <= 1) p = p * 100;
  p = Math.max(0, Math.min(100, p));
  return "★ (" + p.toFixed(0) + "%) ★";
}

/**
 * Patch 3 — returns numeric confidencePct 0–100, prob 0–1, tier codes, display string.
 */
function normalizeConfidenceBundle_(raw) {
  var n = enforceFloatNumber_(raw);
  if (n > 0 && n <= 1 && n !== 0) {
    n = n * 100;
  }
  if (!isFinite(n)) n = 0;
  n = Math.max(0, Math.min(100, n));
  var prob = n / 100;
  var tierCode = tierCodeFromPct_(n);
  var tierDisplay = buildTierDisplayFromPct_(n);
  return {
    confidencePct: n,
    confidenceProb: prob,
    tierCode: tierCode,
    tierDisplay: tierDisplay
  };
}

/** Delegates to createCanonicalHeaderMap_ — use everywhere (Patch 9). */
function createHeaderMap(headerRow) {
  return createCanonicalHeaderMap_(headerRow);
}

/** Canonical sheet lookup — single owner (Patch 8). */
function getSheetInsensitive(ss, name) {
  if (!ss || !name) return null;
  var targetLower = String(name).toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === targetLower) {
      return sheets[i];
    }
  }
  return null;
}

/**
 * Merge Config_Tier2 key/value breakeven_prob, juice into a copy of unified OU defaults.
 */
function mergeUnifiedOuConfigWithSheet_(ss, baseConfig) {
  var cfg = {};
  var k;
  for (k in baseConfig) {
    if (Object.prototype.hasOwnProperty.call(baseConfig, k)) {
      cfg[k] = baseConfig[k];
    }
  }
  try {
    var sh = getSheetInsensitive(ss, "Config_Tier2");
    if (!sh || sh.getLastRow() < 2) return cfg;
    var rows = sh.getDataRange().getValues();
    var map = {};
    for (var r = 1; r < rows.length; r++) {
      var key = String(rows[r][0] || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]/g, "");
      map[key] = rows[r][1];
    }
    if (map.breakevenprob != null && isFinite(parseFloat(map.breakevenprob))) {
      cfg.BREAKEVEN_PROB = parseFloat(map.breakevenprob);
    }
    if (map.juice != null && isFinite(parseFloat(map.juice))) {
      cfg.JUICE = parseFloat(map.juice);
    }
    if (map.fallbacksd != null && isFinite(parseFloat(map.fallbacksd))) {
      cfg.fallbackSd = parseFloat(map.fallbacksd);
    }
  } catch (e) {
    Logger.log("mergeUnifiedOuConfigWithSheet_: " + e.message);
  }
  return cfg;
}

/**
 * Append-only: ensure ResultsClean row 1 has RESULTS_CLEAN_CANONICAL_MIN columns (in order).
 */
function ensureResultsCleanCanonicalHeaders_(ss) {
  if (!ss) return;
  var sh = getSheetInsensitive(ss, "ResultsClean");
  if (!sh || sh.getLastRow() < 1) return;
  var want = (typeof RESULTS_CLEAN_CANONICAL_MIN !== "undefined")
    ? RESULTS_CLEAN_CANONICAL_MIN
    : [];
  if (!want || !want.length) return;
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0] || [];
  var map = createCanonicalHeaderMap_(cur);
  var need = [];
  for (var i = 0; i < want.length; i++) {
    var ck = canonicalHeaderKey_(want[i]);
    if (map[ck] === undefined) {
      need.push(want[i]);
    }
  }
  if (!need.length) return;
  var next = cur.slice();
  for (var j = 0; j < need.length; j++) {
    next.push(need[j]);
  }
  sh.getRange(1, 1, 1, next.length).setValues([next]);
}

/** Phase 5 — upsert policy reference (documented; sheets enforce in code paths). */
var UPSERT_POLICY = {
  Tier1_Predictions: "UPSERT by Prediction_Record_ID",
  Tier2_Log: "APPEND row; Prediction_Record_ID unique per logical pick",
  OU_Log: "APPEND row",
  Bet_Slips: "APPEND new run block (no full-sheet clear)",
  Analysis_Tier1: "FULL REBUILD per Tier1 run",
  Ma_Golide_Report: "FULL REBUILD per report run",
  Config_Tier1: "MANUAL + Genesis backfill only",
  Config_Tier2: "MANUAL + Genesis backfill only",
  Config_Accumulator: "MANUAL + Genesis backfill only"
};

/**
 * Optional: run from the Apps Script editor once after deploying Phases 0–5 modules.
 */
function logPhase5ContractComplete_() {
  Logger.log("[PHASE 5 COMPLETE] Contract_Enforcer: canonical headers (createCanonicalHeaderMap_/findHeaderIndex_), getSheetInsensitive, UPSERT_POLICY, collision resolution");
}
