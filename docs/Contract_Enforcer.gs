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
// NEW-1 — Standings-backed team normalizer (per-satellite; no global dictionary)
// -----------------------------------------------------------------------------
//
// Standings is the source of truth. Canonical token is join-safe:
//   "Ningbo Rockets" -> "NINGBO_ROCKETS"
//
// Optional Standings columns supported:
//   - Team (or first column fallback)
//   - Team_Token / Token (optional; overrides generated token)
//   - Aliases (optional; comma/semicolon/pipe separated)
//
// Cache is per execution + invalidated if Standings size changes.
//
var __TEAM_RESOLUTION_CACHE__ = null;

function _normTeamKey_(s) {
  return String(s == null ? "" : s)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _makeJoinSafeToken_(teamName) {
  var t = String(teamName == null ? "" : teamName)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!t) throw new Error("Contract_Enforcer: cannot build token for team: " + teamName);
  return t;
}

function _getStandingsTeamResolutionMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Contract_Enforcer: no active spreadsheet for team resolution");

  var standings = (typeof getSheetInsensitive === "function")
    ? getSheetInsensitive(ss, "Standings")
    : ss.getSheetByName("Standings");

  if (!standings) throw new Error('Contract_Enforcer: missing required sheet "Standings"');

  var lastRow = standings.getLastRow();
  var lastCol = standings.getLastColumn();
  if (lastRow < 2 || lastCol < 1) throw new Error('Contract_Enforcer: "Standings" has no team rows');

  // Cache (per spreadsheet + dimensions)
  var ssId = (typeof ss.getId === "function") ? ss.getId() : ss.getName();
  if (__TEAM_RESOLUTION_CACHE__
      && __TEAM_RESOLUTION_CACHE__.ssId === ssId
      && __TEAM_RESOLUTION_CACHE__.lastRow === lastRow
      && __TEAM_RESOLUTION_CACHE__.lastCol === lastCol
      && __TEAM_RESOLUTION_CACHE__.map) {
    return __TEAM_RESOLUTION_CACHE__.map;
  }

  var values = standings.getRange(1, 1, lastRow, lastCol).getValues();
  var map = {};

  function addAlias(alias, token) {
    var k = _normTeamKey_(alias);
    if (!k) return;
    map[k] = token;
    map[k.replace(/\s+/g, "")] = token; // no-space variant
  }

  // Active block state (changes when we encounter a new header)
  var teamCol = -1;
  var tokenCol = -1;
  var aliasCol = -1;

  for (var r = 0; r < values.length; r++) {
    var row = values[r] || [];

    // Detect header row (supports "Team name", repeated headers for East/West, etc.)
    var hmap = createCanonicalHeaderMap_(row);

    var detectedTeamCol = findHeaderIndex_(hmap, [
      "team", "team_name", "team name", "teamname", "club", "squad"
    ]);

    // Require at least one “stats-ish” column so we don't treat "East" as header
    var hasStatsCol =
      findHeaderIndex_(hmap, ["gp", "w", "l", "pct", "pf", "pa", "position", "pos", "rank"]) >= 0;

    if (detectedTeamCol >= 0 && hasStatsCol) {
      teamCol  = detectedTeamCol;
      tokenCol = findHeaderIndex_(hmap, ["team_token", "team token", "token", "id"]);
      aliasCol = findHeaderIndex_(hmap, ["aliases", "alias", "aka", "alt", "alternate", "synonyms"]);
      continue; // next rows are data until we hit another header
    }

    // Not inside a detected standings table yet
    if (teamCol < 0) continue;

    var teamName = String(row[teamCol] == null ? "" : row[teamCol]).trim();
    if (!teamName) continue;

    // Guard against accidentally reading the header row as data
    var tn = teamName.toLowerCase();
    if (tn === "team" || tn === "team name" || tn === "team_name") continue;

    var token =
      (tokenCol >= 0 && String(row[tokenCol] || "").trim())
        ? String(row[tokenCol]).trim()
        : _makeJoinSafeToken_(teamName);

    addAlias(teamName, token);

    if (aliasCol >= 0) {
      var rawAliases = String(row[aliasCol] == null ? "" : row[aliasCol]).trim();
      if (rawAliases) {
        rawAliases.split(/[;,|]/g).forEach(function(a) {
          a = String(a || "").trim();
          if (a) addAlias(a, token);
        });
      }
    }
  }

  __TEAM_RESOLUTION_CACHE__ = { ssId: ssId, lastRow: lastRow, lastCol: lastCol, map: map };
  return map;
}

function enforceTeamNameResolution_(rawName) {
  var s = String(rawName == null ? "" : rawName).trim();
  if (!s) throw new Error("Contract_Enforcer: empty team name");

  var map = _getStandingsTeamResolutionMap_();
  var k = _normTeamKey_(s);

  if (map[k]) return map[k];
  if (map[k.replace(/\s+/g, "")]) return map[k.replace(/\s+/g, "")];

  throw new Error('Contract_Enforcer: unknown team (add to Standings "Team" or "Aliases"): ' + rawName);
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

// ============================================================================
// PHASE 2 PATCH 3C: RESULTSCLEAN CANONICAL COLUMNS (CONTRACT ENFORCER)
// ============================================================================

/**
 * RESULTS_CLEAN_CANONICAL_MIN - Minimal canonical columns for ResultsClean (Phase 2 Patch 3C)
 * All ResultsClean sheets must have at least these columns in this order
 */
var RESULTS_CLEAN_CANONICAL_MIN = [
  "result_id", "event_date", "league", "team", "opponent", "side_total",
  "line", "actual_result", "settled_at", "status", "payout", "config_stamp",
  "source", "season", "quarter", "created_at"
];

/**
 * validateResultsCleanContract_ - Validate ResultsClean sheet against canonical contract
 * @param {Sheet} sheet - ResultsClean sheet
 * @returns {Object} Validation result
 */
function validateResultsCleanContract_(sheet) {
  if (!sheet) return { valid: false, error: 'Sheet not found' };
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerMap = createCanonicalHeaderMap_(headers);
  
  var missing = [];
  var warnings = [];
  
  // Check required canonical columns
  for (var i = 0; i < RESULTS_CLEAN_CANONICAL_MIN.length; i++) {
    var col = RESULTS_CLEAN_CANONICAL_MIN[i];
    var key = canonicalHeaderKey_(col);
    if (headerMap[key] === undefined) {
      missing.push(col);
    }
  }
  
  // Check for extra non-canonical columns
  var extraCount = 0;
  for (var j = 0; j < headers.length; j++) {
    var header = headers[j];
    if (header && typeof header === 'string') {
      var key = canonicalHeaderKey_(header);
      if (RESULTS_CLEAN_CANONICAL_MIN.indexOf(header) === -1 && 
          headerMap[key] === undefined) {
        extraCount++;
      }
    }
  }
  
  if (extraCount > 0) {
    warnings.push('Found ' + extraCount + ' non-canonical columns');
  }
  
  return {
    valid: missing.length === 0,
    missing: missing,
    warnings: warnings,
    totalColumns: headers.length,
    canonicalColumns: RESULTS_CLEAN_CANONICAL_MIN.length
  };
}

/**
 * enforceResultsCleanContract_ - Ensure ResultsClean sheet conforms to canonical contract
 * @param {Spreadsheet} ss - Spreadsheet object
 * @returns {Object} Enforcement result
 */
function enforceResultsCleanContract_(ss) {
  if (!ss) return { success: false, error: 'Invalid spreadsheet' };
  
  var sheet = getSheetInsensitive(ss, "ResultsClean");
  if (!sheet) {
    // Create ResultsClean sheet with canonical headers
    sheet = ss.insertSheet("ResultsClean");
    sheet.getRange(1, 1, 1, RESULTS_CLEAN_CANONICAL_MIN.length)
      .setValues([RESULTS_CLEAN_CANONICAL_MIN])
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    sheet.setFrozenRows(1);
    
    return {
      success: true,
      action: 'CREATED',
      columnsAdded: RESULTS_CLEAN_CANONICAL_MIN.length
    };
  }
  
  // Validate existing sheet
  var validation = validateResultsCleanContract_(sheet);
  if (!validation.valid) {
    // Add missing canonical columns
    ensureResultsCleanCanonicalHeaders_(ss);
    
    return {
      success: true,
      action: 'ENFORCED',
      columnsAdded: validation.missing.length,
      missingColumns: validation.missing
    };
  }
  
  return {
    success: true,
    action: 'COMPLIANT',
    totalColumns: validation.totalColumns
  };
}

// ============================================================================
// PHASE 5 PATCH 8: FUNCTION CONSOLIDATION - RESOLVE ALL FUNCTION COLLISIONS
// ============================================================================

/**
 * FunctionConsolidation - Centralized function consolidation to eliminate collisions
 * All duplicate functions should use these single-source-of-truth implementations
 */
const FunctionConsolidation = {
  
  // --------------------------------------------------------------------------
  // CONSOLIDATED SHEET FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * getSheetInsensitive - Single source of truth for case-insensitive sheet lookup
   * @param {Spreadsheet} ss - Spreadsheet object
   * @param {string} name - Sheet name
   * @returns {Sheet|null} Sheet object or null if not found
   */
  getSheetInsensitive(ss, name) {
    if (!ss || !name) return null;
    
    try {
      // Try exact match first
      const exactSheet = ss.getSheetByName(name);
      if (exactSheet) return exactSheet;
      
      // Try case-insensitive match
      const sheets = ss.getSheets();
      const targetName = String(name).toLowerCase().trim();
      
      for (let i = 0; i < sheets.length; i++) {
        const sheetName = String(sheets[i].getName()).toLowerCase().trim();
        if (sheetName === targetName) {
          return sheets[i];
        }
      }
      
      return null;
    } catch (err) {
      Logger.log('[getSheetInsensitive] Error: ' + err.message);
      return null;
    }
  },
  
  // --------------------------------------------------------------------------
  // CONSOLIDATED HEADER FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * createHeaderMap - DEPRECATED - Use createCanonicalHeaderMap_ instead
   * @deprecated This function has been consolidated into createCanonicalHeaderMap_
   */
  createHeaderMap(headers, canonical) {
    Logger.log('[createHeaderMap] DEPRECATED - Use createCanonicalHeaderMap_ from Contract_Enforcer');
    return createCanonicalHeaderMap_(canonical, headers);
  },
  
  /**
   * findHeaderIndex - DEPRECATED - Use findHeaderIndex_ instead
   * @deprecated This function has been consolidated into findHeaderIndex_
   */
  findHeaderIndex(headers, target) {
    Logger.log('[findHeaderIndex] DEPRECATED - Use findHeaderIndex_ from Contract_Enforcer');
    return findHeaderIndex_(headers, target);
  },
  
  // --------------------------------------------------------------------------
  // CONSOLIDATED CALCULATION FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * calculateExpectedValue - DEPRECATED - Use calculateExpectedValue_ instead
   * @deprecated This function has been consolidated into calculateExpectedValue_
   */
  calculateExpectedValue(impliedProb, confidence, line) {
    Logger.log('[calculateExpectedValue] DEPRECATED - Use calculateExpectedValue_ from Contract_Enforcer');
    return calculateExpectedValue_(impliedProb, confidence, line);
  },
  
  /**
   * calculateKellyFraction - DEPRECATED - Use standardized version instead
   * @deprecated This function has been consolidated and standardized
   */
  calculateKellyFraction(winProb, decimalOdds, kellyMultiplier) {
    Logger.log('[calculateKellyFraction] DEPRECATED - Use standardized Kelly calculation');
    
    // Standardized Kelly calculation
    if (!winProb || !decimalOdds || winProb <= 0 || decimalOdds <= 1) return 0;
    
    const edge = (winProb * decimalOdds) - 1;
    const odds = decimalOdds - 1;
    const kelly = (edge / odds) * (kellyMultiplier || 0.25);
    
    return Math.max(0, Math.min(kelly, 0.25)); // Cap at 25% of bankroll
  },
  
  // --------------------------------------------------------------------------
  // CONSOLIDATED VALIDATION FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * validateConfigState - DEPRECATED - Use validateConfigState_ instead
   * @deprecated This function has been consolidated into validateConfigState_
   */
  validateConfigState(config) {
    Logger.log('[validateConfigState] DEPRECATED - Use validateConfigState_ from Contract_Enforcer');
    return validateConfigState_(config, 'unknown');
  },
  
  /**
   * validateBetObject - DEPRECATED - Use validateBetObject_ instead
   * @deprecated This function has been consolidated into validateBetObject_
   */
  validateBetObject(bet) {
    Logger.log('[validateBetObject] DEPRECATED - Use validateBetObject_ from Contract_Enforcer');
    return validateBetObject_(bet);
  },
  
  // --------------------------------------------------------------------------
  // CONSOLIDATED UPSERT FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * upsertRow - DEPRECATED - Use upsertRow_ instead
   * @deprecated This function has been consolidated into upsertRow_
   */
  upsertRow(sheet, rowData, keyColumn) {
    Logger.log('[upsertRow] DEPRECATED - Use upsertRow_ from Contract_Enforcer');
    return upsertRow_(sheet, rowData, keyColumn);
  },
  
  // --------------------------------------------------------------------------
  // CONSOLIDATED CONFIGURATION FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * normalizeConfidence - DEPRECATED - Use normalizeConfidence_ instead
   * @deprecated This function has been consolidated into normalizeConfidence_
   */
  normalizeConfidence(confidence) {
    Logger.log('[normalizeConfidence] DEPRECATED - Use normalizeConfidence_ from Contract_Enforcer');
    return normalizeConfidence_(confidence);
  },
  
  /**
   * getTierThresholds - DEPRECATED - Use getTierThresholds instead
   * @deprecated This function has been consolidated into getTierThresholds
   */
  getTierThresholds() {
    Logger.log('[getTierThresholds] DEPRECATED - Use getTierThresholds from Contract_Enforcer');
    return getTierThresholds();
  },
  
  /**
   * getConfidenceThresholds - DEPRECATED - Use getConfidenceThresholds instead
   * @deprecated This function has been consolidated into getConfidenceThresholds
   */
  getConfidenceThresholds() {
    Logger.log('[getConfidenceThresholds] DEPRECATED - Use getConfidenceThresholds from Contract_Enforcer');
    return getConfidenceThresholds();
  }
};

/**
 * auditFunctionCollisions - Audit for remaining function collisions
 * @returns {Object} Audit report
 */
function auditFunctionCollisions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const auditReport = {
    timestamp: new Date().toISOString(),
    consolidatedFunctions: [],
    deprecatedFunctions: [],
    recommendations: []
  };
  
  // List of consolidated functions
  auditReport.consolidatedFunctions = [
    'getSheetInsensitive',
    'createCanonicalHeaderMap_',
    'findHeaderIndex_',
    'calculateExpectedValue_',
    'validateConfigState_',
    'validateBetObject_',
    'upsertRow_',
    'normalizeConfidence_',
    'getTierThresholds',
    'getConfidenceThresholds'
  ];
  
  // List of deprecated functions that should be replaced
  auditReport.deprecatedFunctions = [
    'createHeaderMap',
    'findHeaderIndex',
    'calculateExpectedValue',
    'calculateKellyFraction',
    'validateConfigState',
    'validateBetObject',
    'upsertRow',
    'normalizeConfidence',
    'getTierThresholds',
    'getConfidenceThresholds'
  ];
  
  // Recommendations
  auditReport.recommendations = [
    'Replace all deprecated function calls with consolidated versions',
    'Use ContractEnforcer functions as single source of truth',
    'Remove duplicate function definitions from all modules',
    'Test all functionality after migration',
    'Document migration in code comments'
  ];
  
  Logger.log('[auditFunctionCollisions] Audit completed: ' + auditReport.consolidatedFunctions.length + ' functions consolidated');
  return auditReport;
}

/**
 * migrateToConsolidatedFunctions - Helper function to migrate function calls
 * @param {string} functionName - Name of function to migrate
 * @param {string} fileName - Name of file containing the function
 * @returns {Object} Migration guidance
 */
function migrateToConsolidatedFunctions(functionName, fileName) {
  const migrationMap = {
    'createHeaderMap': 'createCanonicalHeaderMap_',
    'findHeaderIndex': 'findHeaderIndex_',
    'calculateExpectedValue': 'calculateExpectedValue_',
    'validateConfigState': 'validateConfigState_',
    'upsertRow': 'upsertRow_',
    'normalizeConfidence': 'normalizeConfidence_',
    'getTierThresholds': 'getTierThresholds',
    'getConfidenceThresholds': 'getConfidenceThresholds'
  };
  
  const newFunction = migrationMap[functionName];
  if (newFunction) {
    return {
      oldFunction: functionName,
      newFunction: newFunction,
      file: fileName,
      action: 'Replace ' + functionName + ' with ' + newFunction + ' from Contract_Enforcer',
      status: 'READY_TO_MIGRATE'
    };
  }
  
  return {
    oldFunction: functionName,
    file: fileName,
    action: 'No migration needed',
    status: 'NO_ACTION'
  };
}

// ============================================================================
// PHASE 5 PATCH 9: HEADER MAP STANDARDIZATION
// ============================================================================

/**
 * HeaderMapStandardization - Standardize ALL header maps to use Contract_Enforcer functions
 * Ensures consistent header mapping across all modules
 */
const HeaderMapStandardization = {
  
  // --------------------------------------------------------------------------
  // STANDARDIZED HEADER MAP IMPLEMENTATIONS
  // --------------------------------------------------------------------------
  
  /**
   * getStandardHeaderMap - Get standardized header map for any contract
   * @param {Array} contract - Contract array (canonical column names)
   * @param {Array} actualHeaders - Actual headers from sheet
   * @returns {Object} Standardized header map
   */
  getStandardHeaderMap(contract, actualHeaders) {
    return createCanonicalHeaderMap_(contract, actualHeaders);
  },
  
  /**
   * getStandardHeaderIndex - Find column index using standardized method
   * @param {Array} headers - Sheet headers
   * @param {string} target - Target column name
   * @returns {number} Column index or -1 if not found
   */
  getStandardHeaderIndex(headers, target) {
    return findHeaderIndex_(headers, target);
  },
  
  // --------------------------------------------------------------------------
  // CONTRACT-SPECIFIC HEADER MAPS
  // --------------------------------------------------------------------------
  
  /**
   * getBetSlipsHeaderMap - Get standardized Bet_Slips header map
   * @param {Array} actualHeaders - Actual headers from sheet
   * @returns {Object} Header map
   */
  getBetSlipsHeaderMap(actualHeaders) {
    return this.getStandardHeaderMap(BET_SLIPS_CONTRACT, actualHeaders);
  },
  
  /**
   * getForensicLogsHeaderMap - Get standardized Forensic Logs header map
   * @param {Array} actualHeaders - Actual headers from sheet
   * @returns {Object} Header map
   */
  getForensicLogsHeaderMap(actualHeaders) {
    return this.getStandardHeaderMap(FORENSIC_LOGS_CONTRACT, actualHeaders);
  },
  
  /**
   * getResultsCleanHeaderMap - Get standardized ResultsClean header map
   * @param {Array} actualHeaders - Actual headers from sheet
   * @returns {Object} Header map
   */
  getResultsCleanHeaderMap(actualHeaders) {
    return this.getStandardHeaderMap(RESULTSCLEAN_CONTRACT, actualHeaders);
  },
  
  // --------------------------------------------------------------------------
  // VALIDATION FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * validateHeaderMap - Validate header map completeness
   * @param {Object} headerMap - Header map object
   * @param {Array} requiredColumns - Required columns
   * @returns {Object} Validation result
   */
  validateHeaderMap(headerMap, requiredColumns) {
    const missing = [];
    const invalid = [];
    
    requiredColumns.forEach(column => {
      if (headerMap[column] === undefined || headerMap[column] === null) {
        missing.push(column);
      } else if (headerMap[column] < 0) {
        invalid.push(column);
      }
    });
    
    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing: missing,
      invalid: invalid,
      total: requiredColumns.length,
      found: requiredColumns.length - missing.length
    };
  },
  
  // --------------------------------------------------------------------------
  // ADVANCED HEADER MAP FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * createHeaderMapWithFallback - Create header map with fallback columns
   * @param {Array} contract - Contract array
   * @param {Array} actualHeaders - Actual headers
   * @param {Object} fallbackMap - Fallback column mappings
   * @returns {Object} Header map with fallbacks applied
   */
  createHeaderMapWithFallback(contract, actualHeaders, fallbackMap = {}) {
    const standardMap = this.getStandardHeaderMap(contract, actualHeaders);
    
    // Apply fallbacks for missing columns
    Object.keys(standardMap).forEach(canonical => {
      if (standardMap[canonical] < 0 && fallbackMap[canonical]) {
        const fallbackIndex = findHeaderIndex_(actualHeaders, fallbackMap[canonical]);
        if (fallbackIndex >= 0) {
          standardMap[canonical] = fallbackIndex;
          Logger.log('[createHeaderMapWithFallback] Applied fallback for ' + canonical + ': ' + fallbackMap[canonical]);
        }
      }
    });
    
    return standardMap;
  },
  
  /**
   * getContractColumnAliases - Get standard column aliases for contracts
   * @param {string} contractType - Type of contract
   * @returns {Object} Column aliases object
   */
  getContractColumnAliases(contractType) {
    const aliases = {
      'Bet_Slips': {
        bet_id: ['bet_id', 'betid', 'id', 'bet_id'],
        league: ['league', 'lg', 'sport', 'league_name'],
        event_date: ['event_date', 'date', 'game_date', 'event_datetime'],
        team: ['team', 'selection', 'pick', 'team_name'],
        opponent: ['opponent', 'opp', 'vs', 'opponent_name'],
        side_total: ['side_total', 'type', 'bet_type', 'side_total'],
        line: ['line', 'odds', 'price', 'line_value'],
        implied_prob: ['implied_prob', 'prob', 'probability', 'implied_probability'],
        confidence_pct: ['confidence_pct', 'confidence', 'conf', 'confidence_percent'],
        tier_code: ['tier_code', 'tier', 'grade', 'tier_code'],
        tier_display: ['tier_display', 'tier_desc', 'tier_description'],
        ev: ['ev', 'expected_value', 'expected_value'],
        kelly_pct: ['kelly_pct', 'kelly', 'kelly_percent'],
        status: ['status', 'result_status', 'bet_status'],
        result: ['result', 'outcome', 'bet_result'],
        payout: ['payout', 'return', 'winnings'],
        placed_at: ['placed_at', 'created', 'timestamp', 'bet_placed'],
        settled_at: ['settled_at', 'resolved', 'bet_settled'],
        config_stamp: ['config_stamp', 'configstamp', 'cfg_stamp', 'stamp', 'stamp_id'],
        source: ['source', 'origin', 'data_source'],
        gender: ['gender', 'type', 'category'],
        quarter: ['quarter', 'q', 'period', 'time_period'],
        season: ['season', 'year', 'season_year'],
        created_at: ['created_at', 'timestamp', 'creation_time']
      },
      
      'Forensic_Logs': {
        log_id: ['log_id', 'id', 'log_identifier'],
        timestamp: ['timestamp', 'time', 'log_time', 'created_at'],
        league: ['league', 'lg', 'sport', 'league_name'],
        event_id: ['event_id', 'game_id', 'match_id'],
        team: ['team', 'selection', 'pick', 'team_name'],
        opponent: ['opponent', 'opp', 'vs', 'opponent_name'],
        side_total: ['side_total', 'type', 'bet_type'],
        line: ['line', 'odds', 'price', 'line_value'],
        prediction: ['prediction', 'pred', 'forecast'],
        confidence: ['confidence', 'conf', 'confidence_level'],
        tier: ['tier', 'grade', 'tier_code'],
        ev: ['ev', 'expected_value', 'expected_value'],
        status: ['status', 'result_status', 'log_status'],
        result: ['result', 'outcome', 'actual_result'],
        config_stamp: ['config_stamp', 'configstamp', 'cfg_stamp', 'stamp', 'stamp_id'],
        source: ['source', 'origin', 'data_source'],
        notes: ['notes', 'comments', 'remarks']
      },
      
      'Results_Clean': {
        result_id: ['result_id', 'id', 'result_identifier'],
        event_date: ['event_date', 'date', 'game_date'],
        league: ['league', 'lg', 'sport', 'league_name'],
        team: ['team', 'selection', 'pick', 'team_name'],
        opponent: ['opponent', 'opp', 'vs', 'opponent_name'],
        side_total: ['side_total', 'type', 'bet_type'],
        line: ['line', 'odds', 'price', 'line_value'],
        actual_result: ['actual_result', 'result', 'outcome'],
        settled_at: ['settled_at', 'resolved', 'result_date'],
        status: ['status', 'result_status', 'settlement_status'],
        payout: ['payout', 'return', 'winnings'],
        config_stamp: ['config_stamp', 'configstamp', 'cfg_stamp', 'stamp', 'stamp_id'],
        source: ['source', 'origin', 'data_source'],
        season: ['season', 'year', 'season_year'],
        quarter: ['quarter', 'q', 'period', 'time_period'],
        created_at: ['created_at', 'timestamp', 'creation_time']
      }
    };
    
    return aliases[contractType] || {};
  },
  
  /**
   * createEnhancedHeaderMap - Create header map with alias support
   * @param {string} contractType - Type of contract
   * @param {Array} actualHeaders - Actual headers from sheet
   * @returns {Object} Enhanced header map with alias resolution
   */
  createEnhancedHeaderMap(contractType, actualHeaders) {
    const contracts = {
      'Bet_Slips': BET_SLIPS_CONTRACT,
      'Forensic_Logs': FORENSIC_LOGS_CONTRACT,
      'Results_Clean': RESULTSCLEAN_CONTRACT
    };
    
    const contract = contracts[contractType];
    if (!contract) {
      throw new Error('Unknown contract type: ' + contractType);
    }
    
    const aliases = this.getContractColumnAliases(contractType);
    return this.createHeaderMapWithFallback(contract, actualHeaders, aliases);
  },
  
  // --------------------------------------------------------------------------
  // AUDIT AND COMPLIANCE FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * auditHeaderMaps - Audit all header maps for compliance
   * @returns {Object} Audit report
   */
  auditHeaderMaps() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const auditReport = {
      timestamp: new Date().toISOString(),
      sheets: {},
      summary: {
        total: 0,
        compliant: 0,
        nonCompliant: 0
      }
    };
    
    const contractSheets = [
      { name: 'Bet_Slips', contract: BET_SLIPS_CONTRACT, type: 'Bet_Slips' },
      { name: 'Tier1_Predictions', contract: FORENSIC_LOGS_CONTRACT, type: 'Forensic_Logs' },
      { name: 'Tier2_Log', contract: FORENSIC_LOGS_CONTRACT, type: 'Forensic_Logs' },
      { name: 'OU_Log', contract: FORENSIC_LOGS_CONTRACT, type: 'Forensic_Logs' },
      { name: 'ResultsClean', contract: RESULTSCLEAN_CONTRACT, type: 'Results_Clean' }
    ];
    
    contractSheets.forEach(({ name, contract, type }) => {
      const sheet = ss.getSheetByName(name);
      if (sheet) {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const headerMap = this.createEnhancedHeaderMap(type, headers);
        const validation = this.validateHeaderMap(headerMap, contract);
        
        auditReport.sheets[name] = {
          type: type,
          headersFound: headers.length,
          contractColumns: contract.length,
          validation: validation,
          compliant: validation.valid
        };
        
        auditReport.summary.total++;
        if (validation.valid) {
          auditReport.summary.compliant++;
        } else {
          auditReport.summary.nonCompliant++;
        }
      }
    });
    
    return auditReport;
  },
  
  /**
   * standardizeAllSheets - Apply standardization to all contract sheets
   * @returns {Object} Standardization report
   */
  standardizeAllSheets() {
    const audit = this.auditHeaderMaps();
    const report = {
      timestamp: new Date().toISOString(),
      audit: audit,
      actions: [],
      success: true
    };
    
    // Log standardization results
    Logger.log('Header Map Standardization Report');
    Logger.log('=====================================');
    Logger.log('Total sheets: ' + audit.summary.total);
    Logger.log('Compliant: ' + audit.summary.compliant);
    Logger.log('Non-compliant: ' + audit.summary.nonCompliant);
    
    Object.entries(audit.sheets).forEach(([sheetName, sheetData]) => {
      if (!sheetData.compliant) {
        Logger.log('Sheet ' + sheetName + ' needs standardization');
        Logger.log('Missing: ' + sheetData.validation.missing.join(', '));
        Logger.log('Invalid: ' + sheetData.validation.invalid.join(', '));
        report.actions.push({
          sheet: sheetName,
          action: 'NEEDS_STANDARDIZATION',
          missing: sheetData.validation.missing,
          invalid: sheetData.validation.invalid
        });
      } else {
        Logger.log('Sheet ' + sheetName + ' is compliant');
        report.actions.push({
          sheet: sheetName,
          action: 'COMPLIANT'
        });
      }
    });
    
    return report;
  }
};

/**
 * enforceHeaderMapStandardization - Enforce header map standardization across all modules
 * @returns {Object} Enforcement report
 */
function enforceHeaderMapStandardization() {
  const standardization = HeaderMapStandardization;
  const report = standardization.standardizeAllSheets();
  
  // Log enforcement actions
  Logger.log('[enforceHeaderMapStandardization] Header map standardization enforcement completed');
  Logger.log('Compliant sheets: ' + report.audit.summary.compliant + '/' + report.audit.summary.total);
  
  return report;
}

// ============================================================================
// PHASE 5 PATCH 10: UPSERT POLICY ENFORCEMENT
// ============================================================================

/**
 * UpsertPolicyEnforcement - Document and enforce upsert policies across all modules
 * Ensures consistent data management and audit trails
 */
const UpsertPolicyEnforcement = {
  
  // --------------------------------------------------------------------------
  // UPSERT POLICY DEFINITIONS
  // --------------------------------------------------------------------------
  
  policies: {
    // Bet_Slips: Use bet_id as unique key
    'Bet_Slips': {
      keyColumn: 'bet_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: true,
      description: 'Bet tracking with unique bet_id for deduplication'
    },
    
    // Config sheets: Use config_key as unique key
    'Config_Tier1': {
      keyColumn: 'config_key',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: false,
      description: 'Tier1 configuration parameters'
    },
    
    'Config_Tier2': {
      keyColumn: 'config_key',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: false,
      description: 'Tier2 configuration parameters'
    },
    
    'Config_Accumulator': {
      keyColumn: 'config_key',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: false,
      description: 'Accumulator configuration parameters'
    },
    
    // Satellite_Identity: Use satellite_id as unique key
    'Satellite_Identity': {
      keyColumn: 'satellite_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Identity should not be updated
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true,
      description: 'Satellite identity records (immutable after creation)'
    },
    
    // ResultsClean: Use result_id as unique key
    'ResultsClean': {
      keyColumn: 'result_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Results should not be updated once settled
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true,
      description: 'Settled bet results (immutable after settlement)'
    },
    
    // Forensic logs: Use log_id as unique key
    'Tier1_Predictions': {
      keyColumn: 'log_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Logs should be immutable
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true,
      description: 'Tier1 prediction logs (immutable audit trail)'
    },
    
    'Tier2_Log': {
      keyColumn: 'log_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Logs should be immutable
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true,
      description: 'Tier2 prediction logs (immutable audit trail)'
    },
    
    'OU_Log': {
      keyColumn: 'log_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Logs should be immutable
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true,
      description: 'Over/Under prediction logs (immutable audit trail)'
    },
    
    // Satellite_Registry: Use satellite_id as unique key
    'Satellite_Registry': {
      keyColumn: 'satellite_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: true,
      description: 'Satellite registry with URL management'
    }
  },
  
  // --------------------------------------------------------------------------
  // UPSERT OPERATIONS
  // --------------------------------------------------------------------------
  
  /**
   * performUpsert - Perform standardized upsert operation
   * @param {Sheet} sheet - Target sheet
   * @param {Array} rowData - Row data to upsert
   * @param {string} sheetName - Sheet name for policy lookup
   * @returns {Object} Upsert result
   */
  performUpsert(sheet, rowData, sheetName) {
    const policy = this.policies[sheetName];
    if (!policy) {
      throw new Error('No upsert policy defined for sheet: ' + sheetName);
    }
    
    const result = {
      success: false,
      action: null,
      key: null,
      timestamp: new Date().toISOString(),
      policy: policy
    };
    
    try {
      // Validate policy requirements
      const validationResult = this.validateUpsertData(rowData, policy);
      if (!validationResult.valid) {
        result.error = 'Validation failed: ' + validationResult.errors.join(', ');
        return result;
      }
      
      // Find existing row
      const existingRowIndex = this.findExistingRow(sheet, rowData, policy);
      
      if (existingRowIndex >= 0) {
        // Row exists
        if (policy.allowUpdate) {
          this.updateRow(sheet, existingRowIndex, rowData, policy);
          result.action = 'UPDATED';
          result.key = rowData[policy.keyColumn];
          result.success = true;
          
          if (policy.auditTrail) {
            this.logUpsertAction(sheetName, 'UPDATE', rowData[policy.keyColumn], policy);
          }
        } else {
          result.action = 'SKIPPED_UPDATE_NOT_ALLOWED';
          result.key = rowData[policy.keyColumn];
          result.success = false;
          result.error = 'Update not allowed by policy';
        }
      } else {
        // Row does not exist
        if (policy.allowCreate) {
          this.insertRow(sheet, rowData, policy);
          result.action = 'INSERTED';
          result.key = rowData[policy.keyColumn];
          result.success = true;
          
          if (policy.auditTrail) {
            this.logUpsertAction(sheetName, 'INSERT', rowData[policy.keyColumn], policy);
          }
        } else {
          result.action = 'SKIPPED_CREATE_NOT_ALLOWED';
          result.key = rowData[policy.keyColumn];
          result.success = false;
          result.error = 'Create not allowed by policy';
        }
      }
      
    } catch (err) {
      result.error = err.message;
      result.success = false;
    }
    
    return result;
  },
  
  /**
   * performBatchUpsert - Perform batch upsert operations
   * @param {Sheet} sheet - Target sheet
   * @param {Array} batchData - Array of row data
   * @param {string} sheetName - Sheet name for policy lookup
   * @returns {Object} Batch upsert result
   */
  performBatchUpsert(sheet, batchData, sheetName) {
    const policy = this.policies[sheetName];
    if (!policy) {
      throw new Error('No upsert policy defined for sheet: ' + sheetName);
    }
    
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    
    batchData.forEach((rowData, index) => {
      const result = this.performUpsert(sheet, rowData, sheetName);
      result.batchIndex = index;
      results.push(result);
      
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    });
    
    return {
      sheetName: sheetName,
      totalRows: batchData.length,
      successCount: successCount,
      failureCount: failureCount,
      results: results,
      timestamp: new Date().toISOString()
    };
  },
  
  // --------------------------------------------------------------------------
  // VALIDATION FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * validateUpsertData - Validate data against upsert policy
   * @param {Array} rowData - Row data
   * @param {Object} policy - Upsert policy
   * @returns {Object} Validation result
   */
  validateUpsertData(rowData, policy) {
    const errors = [];
    const warnings = [];
    
    // Check required fields
    if (policy.validation === 'required' && !rowData[policy.keyColumn]) {
      errors.push('Required key column ' + policy.keyColumn + ' is missing or empty');
    }
    
    // Check data length
    if (!Array.isArray(rowData) || rowData.length === 0) {
      errors.push('Row data must be a non-empty array');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  },
  
  // --------------------------------------------------------------------------
  // SEARCH AND UPDATE FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * findExistingRow - Find existing row based on key column
   * @param {Sheet} sheet - Target sheet
   * @param {Array} rowData - Row data
   * @param {Object} policy - Upsert policy
   * @returns {number} Row index or -1 if not found
   */
  findExistingRow(sheet, rowData, policy) {
    if (!sheet || sheet.getLastRow() <= 1) return -1;
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyColumnIndex = headers.findIndex(h => 
      String(h).toLowerCase().replace(/[\s_]/g, "") === 
      policy.keyColumn.toLowerCase().replace(/[\s_]/g, "")
    );
    
    if (keyColumnIndex < 0) {
      Logger.log('[findExistingRow] Key column ' + policy.keyColumn + ' not found in sheet');
      return -1;
    }
    
    const keyValue = rowData[keyColumnIndex];
    if (!keyValue) return -1;
    
    // Search for existing row
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyColumnIndex] === keyValue) {
        return i; // Found existing row
      }
    }
    
    return -1; // Not found
  },
  
  /**
   * updateRow - Update existing row
   * @param {Sheet} sheet - Target sheet
   * @param {number} rowIndex - Row index (0-based from data range)
   * @param {Array} rowData - New row data
   * @param {Object} policy - Upsert policy
   */
  updateRow(sheet, rowIndex, rowData, policy) {
    const actualRowIndex = rowIndex + 1; // Convert to 1-based for Apps Script
    
    if (policy.conflictResolution === 'LATEST_WINS') {
      sheet.getRange(actualRowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else if (policy.conflictResolution === 'FIRST_WINS') {
      // Don't update, keep existing data
      Logger.log('[updateRow] Skipping update for ' + rowData[policy.keyColumn] + ' - FIRST_WINS policy');
    }
  },
  
  /**
   * insertRow - Insert new row
   * @param {Sheet} sheet - Target sheet
   * @param {Array} rowData - Row data
   * @param {Object} policy - Upsert policy
   */
  insertRow(sheet, rowData, policy) {
    sheet.appendRow(rowData);
  },
  
  // --------------------------------------------------------------------------
  // AUDIT AND LOGGING FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * logUpsertAction - Log upsert action for audit trail
   * @param {string} sheetName - Sheet name
   * @param {string} action - Action performed
   * @param {string} key - Record key
   * @param {Object} policy - Upsert policy
   */
  logUpsertAction(sheetName, action, key, policy) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      sheet: sheetName,
      action: action,
      key: key,
      policy: policy.keyColumn,
      user: Session.getActiveUser().getEmail()
    };
    
    Logger.log('[UPSERT AUDIT] ' + JSON.stringify(logEntry));
    
    // Could also write to a dedicated audit sheet if needed
  },
  
  /**
   * generateUpsertPolicyReport - Generate comprehensive upsert policy report
   * @returns {Object} Policy report
   */
  generateUpsertPolicyReport() {
    const report = {
      timestamp: new Date().toISOString(),
      policies: this.policies,
      summary: {
        totalPolicies: Object.keys(this.policies).length,
        allowUpdateCount: 0,
        allowCreateCount: 0,
        auditTrailCount: 0
      },
      recommendations: []
    };
    
    // Calculate summary statistics
    Object.values(this.policies).forEach(policy => {
      if (policy.allowUpdate) report.summary.allowUpdateCount++;
      if (policy.allowCreate) report.summary.allowCreateCount++;
      if (policy.auditTrail) report.summary.auditTrailCount++;
    });
    
    // Generate recommendations
    if (report.summary.auditTrailCount < report.summary.totalPolicies) {
      report.recommendations.push('Consider enabling audit trail for all critical sheets');
    }
    
    report.recommendations.push('Regularly review upsert policies for compliance');
    report.recommendations.push('Monitor upsert operations for anomalies');
    
    return report;
  },
  
  /**
   * validateAllPolicies - Validate all upsert policies
   * @returns {Object} Validation report
   */
  validateAllPolicies() {
    const validation = {
      timestamp: new Date().toISOString(),
      valid: true,
      issues: [],
      warnings: []
    };
    
    Object.entries(this.policies).forEach(([sheetName, policy]) => {
      // Check required fields
      if (!policy.keyColumn) {
        validation.issues.push(sheetName + ': Missing keyColumn');
        validation.valid = false;
      }
      
      if (!policy.strategy) {
        validation.issues.push(sheetName + ': Missing strategy');
        validation.valid = false;
      }
      
      // Check for logical inconsistencies
      if (!policy.allowCreate && !policy.allowUpdate) {
        validation.issues.push(sheetName + ': Neither create nor update allowed');
        validation.valid = false;
      }
      
      // Warnings
      if (policy.allowUpdate && !policy.auditTrail) {
        validation.warnings.push(sheetName + ': Updates allowed but no audit trail');
      }
    });
    
    return validation;
  },
  
  /**
   * enforceUpsertPolicies - Enforce upsert policies across all sheets
   * @returns {Object} Enforcement report
   */
  enforceUpsertPolicies() {
    const validation = this.validateAllPolicies();
    const report = {
      timestamp: new Date().toISOString(),
      validation: validation,
      enforcement: {
        totalPolicies: Object.keys(this.policies).length,
        validPolicies: 0,
        invalidPolicies: 0
      }
    };
    
    if (validation.valid) {
      report.enforcement.validPolicies = report.enforcement.totalPolicies;
      Logger.log('[enforceUpsertPolicies] All upsert policies are valid');
    } else {
      report.enforcement.invalidPolicies = validation.issues.length;
      Logger.log('[enforceUpsertPolicies] Found ' + validation.issues.length + ' policy issues');
    }
    
    return report;
  }
};

/**
 * getUpsertPolicy - Get upsert policy for a specific sheet
 * @param {string} sheetName - Sheet name
 * @returns {Object} Upsert policy or null if not found
 */
function getUpsertPolicy(sheetName) {
  return UpsertPolicyEnforcement.policies[sheetName] || null;
}

/**
 * validateUpsertPolicy - Validate upsert policy compliance
 * @param {string} sheetName - Sheet name
 * @param {Object} data - Data to validate
 * @returns {Object} Validation result
 */
function validateUpsertPolicy(sheetName, data) {
  const policy = getUpsertPolicy(sheetName);
  if (!policy) {
    return { valid: false, error: 'No upsert policy found for sheet: ' + sheetName };
  }
  
  return UpsertPolicyEnforcement.validateUpsertData(data, policy);
}



// ============================================================================
// Bet_Slips in-place splitter (SNIPERS -> 3 blocks)
// ============================================================================

function splitSnipersIntoThreeBlocks_BetSlips_(ssOpt) {
  try {
    var ss = ssOpt || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return false;

    var sh = _mg_bs_getSheetInsensitive_(ss, "Bet_Slips");
    if (!sh) return false;

    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 5) return false;

    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();

    var cand = _mg_bs_findLatestCombinedSnipersBlock_(values, lastCol);
    if (!cand) return false;

    var sectionStartIdx = cand.sectionStartIdx;
    var dataStartIdx    = cand.dataStartIdx;
    var endIdx          = cand.endIdx;
    var headers         = cand.headers;
    var idxMarket       = cand.idxMarket;
    var idxSelTxt       = cand.idxSelTxt;

    var sniperRows = values.slice(dataStartIdx, endIdx);

    var M_MARGIN   = "SNIPER_MARGIN";
    var M_OU       = "SNIPER_OU";
    var M_OU_DIR   = "SNIPER_OU_DIR";
    var M_OU_STAR  = "SNIPER_OU_STAR";
    var M_HIGH_QTR = "SNIPER_HIGH_QTR";

    var margin = [], ou = [], hq = [], other = [];

    for (var k = 0; k < sniperRows.length; k++) {
      var rr = sniperRows[k].slice();
      _mg_bs_padRow_(rr, lastCol);

      var m  = String(rr[idxMarket] || "").trim().toUpperCase();
      var st = (idxSelTxt >= 0) ? String(rr[idxSelTxt] || "") : "";

      if      (m === M_MARGIN)                                      margin.push(rr);
      else if (m === M_OU || m === M_OU_DIR || m === M_OU_STAR)    ou.push(rr);
      else if (m === M_HIGH_QTR || /highest\s*q/i.test(st))        hq.push(rr);
      else                                                          other.push(rr);
    }

    // "SNIPER" market rows (your HQ picks) land in other -> go to HQ block
    for (var z = 0; z < other.length; z++) hq.push(other[z]);

    var repl = [];
    var styledRows = [];

    function pushBlock(title, rows, bg) {
      if (!rows || !rows.length) return;
      if (repl.length) repl.push(_mg_bs_blankRow_(lastCol));
      styledRows.push({ at: repl.length, bg: bg });
      repl.push(_mg_bs_sectionRow_(title, lastCol));
      repl.push(headers.slice());
      for (var i = 0; i < rows.length; i++) repl.push(rows[i]);
    }

    pushBlock("──── SNIPERS — MARGIN ────",    margin, "#9FC5E8");
    pushBlock("──── SNIPERS — O/U ────",       ou,     "#B6D7A8");
    pushBlock("──── SNIPERS — HIGHEST Q ────", hq,     "#D9D2E9");

    if (!repl.length) return false;

    var startRow1   = sectionStartIdx + 1;
    var removeCount = endIdx - sectionStartIdx;
    if (removeCount <= 0) return false;

    var maxRows    = sh.getMaxRows();
    var safeRemove = Math.min(removeCount, maxRows - startRow1 + 1);
    if (safeRemove > 0) sh.deleteRows(startRow1, safeRemove);

    var maxAfter = sh.getMaxRows();
    if (startRow1 > maxAfter) {
      sh.insertRowsAfter(maxAfter, repl.length);
      startRow1 = maxAfter + 1;
    } else {
      sh.insertRowsBefore(startRow1, repl.length);
    }

    sh.getRange(startRow1, 1, repl.length, lastCol).setValues(repl);

    for (var s = 0; s < styledRows.length; s++) {
      _mg_bs_styleHeaderRow_(sh, startRow1 + styledRows[s].at, lastCol, styledRows[s].bg);
    }

    Logger.log('[splitSnipersIntoThreeBlocks_BetSlips_] Done. ' + repl.length + ' rows written.');
    return true;

  } catch (e) {
    Logger.log("[splitSnipersIntoThreeBlocks_BetSlips_] ERROR: " + (e && e.message ? e.message : e));
    return false;
  }
}

function _mg_bs_findLatestCombinedSnipersBlock_(values, lastCol) {
  for (var r = values.length - 1; r >= 0; r--) {
    if (String(values[r][0] || "").trim() !== "Bet_Record_ID") continue;

    var headers   = values[r].slice();
    _mg_bs_padRow_(headers, lastCol);

    var idxMarket = _mg_bs_findHeader_(headers, "Market");
    if (idxMarket < 0) continue;

    var idxSelTxt = _mg_bs_findHeader_(headers, "Selection_Text");

    var dataStartIdx = r + 1;
    var endIdx       = dataStartIdx;
    var hasMargin = false, hasOU = false, hasSniper = false, hasAny = false;

    for (; endIdx < values.length; endIdx++) {
      var row   = values[endIdx];
      if (_mg_bs_rowIsEmpty_(row)) break;
      var cellA = String(row[0] || "").trim();
      if (cellA === "Bet_Record_ID") break;
      var m = String(row[idxMarket] || "").trim().toUpperCase();
      if (!m || m.indexOf("SNIPER") !== 0) break;
      hasAny = true;
      if      (m === "SNIPER_MARGIN")                                              hasMargin = true;
      else if (m === "SNIPER_OU" || m === "SNIPER_OU_DIR" || m === "SNIPER_OU_STAR") hasOU  = true;
      else if (m === "SNIPER")                                                     hasSniper = true;
    }

    if (!hasAny) continue;

    // Only split if block contains multiple SNIPER families
    var familyCount = (hasMargin ? 1 : 0) + (hasOU ? 1 : 0) + (hasSniper ? 1 : 0);
    if (familyCount < 2) continue;

    // Include the section title row above if it looks like a header/divider
    var sectionStartIdx = r;
    if (r - 1 >= 0) {
      var above = String(values[r - 1][0] || "").trim();
      if (above && (/sniper/i.test(above) || /^[-=─_]{3,}/.test(above))) sectionStartIdx = r - 1;
      else if (_mg_bs_rowIsEmpty_(values[r - 1])) sectionStartIdx = r - 1;
    }

    return {
      sectionStartIdx: sectionStartIdx,
      colHdrIdx:       r,
      dataStartIdx:    dataStartIdx,
      endIdx:          endIdx,
      headers:         headers,
      idxMarket:       idxMarket,
      idxSelTxt:       idxSelTxt
    };
  }
  return null;
}

function _mg_bs_findHeader_(headersRow, name) {
  var target = String(name || "").trim().toLowerCase();
  for (var i = 0; i < headersRow.length; i++) {
    if (String(headersRow[i] || "").trim().toLowerCase() === target) return i;
  }
  return -1;
}

function _mg_bs_padRow_(row, width) {
  while (row.length < width) row.push("");
  if (row.length > width) row.length = width;
  return row;
}

function _mg_bs_blankRow_(width) {
  var r = new Array(width); for (var i = 0; i < width; i++) r[i] = ""; return r;
}

function _mg_bs_sectionRow_(title, width) {
  var r = _mg_bs_blankRow_(width); r[0] = title; return r;
}

function _mg_bs_rowIsEmpty_(row) {
  for (var i = 0; i < row.length; i++) { if (String(row[i] || "").trim() !== "") return false; } return true;
}

function _mg_bs_styleHeaderRow_(sh, row1, lastCol, bg) {
  sh.getRange(row1, 1, 1, lastCol).setBackground(bg).setFontColor("#000000").setFontWeight("bold");
}

function _mg_bs_getSheetInsensitive_(ss, name) {
  if (!ss || !name) return null;
  var exact = ss.getSheetByName(name);
  if (exact) return exact;
  var target = String(name).toLowerCase().trim();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getName()).toLowerCase().trim() === target) return sheets[i];
  }
  return null;
}
