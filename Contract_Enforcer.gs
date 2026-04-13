/******************************************************************************
 * CONTRACT ENFORCER - Multi-League-Strict-2.0
 * Core contract enforcement and validation functions
 ******************************************************************************/

// ============================================================================
// GLOBAL CONSTANTS & CONFIGURATION
// ============================================================================
const CONTRACT_VERSION = "MULTI-LEAGUE-STRICT-2.0";
const CONTRACT_BUILD_DATE = "2025-04-13";

// Hardcoded constants (to be extracted in Phase 3)
const BREAKEVEN_PROB = 0.5238;
const JUICE = 0.05;
const FALLBACK_SD = 0.12;

// Tier thresholds (to be extracted in Phase 3)
const TIER_THRESHOLDS = {
  strong: 0.65,
  medium: 0.55,
  weak: 0.45
};

// Confidence thresholds (to be extracted in Phase 3)
const CONFIDENCE_THRESHOLDS = {
  min: 0.60,
  elite: 0.85
};

// Bucket boundaries (to be extracted in Phase 3)
const SPREAD_BUCKETS = [-10, -7, -4, -3, -2, -1, 0, 1, 2, 3, 4, 7, 10];
const LINE_BUCKETS = [195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 245, 250];
const CONF_BUCKETS = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];

// League scope
const ACTIVE_LEAGUES = ["NBA", "NFL", "MLB", "NHL", "NCAAF", "NCAAB"];

// Enforcement flags
const ENFORCE_STRICT_SIDE = true;
const OUTRIGHT_ONLY = true;

// ============================================================================
// CANONICAL HEADER MAPS
// ============================================================================

// 23-column Bet_Slips contract (Phase 2 Patch 3)
const BET_SLIPS_CONTRACT = [
  "bet_id", "league", "event_date", "team", "opponent", "side_total",
  "line", "implied_prob", "confidence_pct", "tier_code", "tier_display",
  "ev", "kelly_pct", "status", "result", "payout", "placed_at",
  "settled_at", "config_stamp", "source", "gender", "quarter", "season",
  "created_at"
];

// 17-column forensic logs contract (Phase 2 Patch 6)
const FORENSIC_LOGS_CONTRACT = [
  "log_id", "timestamp", "league", "event_id", "team", "opponent",
  "side_total", "line", "prediction", "confidence", "tier", "ev",
  "status", "result", "config_stamp", "source", "notes"
];

// ResultsClean canonical columns
const RESULTSCLEAN_CONTRACT = [
  "result_id", "event_date", "league", "team", "opponent", "side_total",
  "line", "actual_result", "settled_at", "status", "payout", "config_stamp",
  "source", "season", "quarter", "created_at"
];

// ============================================================================
// CORE CONTRACT FUNCTIONS
// ============================================================================

/**
 * createCanonicalHeaderMap_ - Creates standardized header mapping
 * @param {Array} contract - Array of column names in canonical order
 * @param {Array} actualHeaders - Actual headers from sheet
 * @returns {Object} Map of canonical names to column indices
 */
function createCanonicalHeaderMap_(contract, actualHeaders) {
  const map = {};
  const normalizedActual = actualHeaders.map(h => 
    String(h).toLowerCase().replace(/[\s_]/g, "")
  );
  
  contract.forEach((canonical, idx) => {
    const normalized = canonical.toLowerCase().replace(/[\s_]/g, "");
    const actualIdx = normalizedActual.indexOf(normalized);
    map[canonical] = actualIdx >= 0 ? actualIdx : idx;
  });
  
  return map;
}

/**
 * findHeaderIndex_ - Finds column index for a header name
 * @param {Array} headers - Sheet headers
 * @param {string} target - Target header name
 * @returns {number} Column index or -1 if not found
 */
function findHeaderIndex_(headers, target) {
  const normalizedTarget = target.toLowerCase().replace(/[\s_]/g, "");
  return headers.findIndex(h => 
    String(h).toLowerCase().replace(/[\s_]/g, "") === normalizedTarget
  );
}

/**
 * getSheetInsensitive - Get sheet by name (case-insensitive)
 * @param {Spreadsheet} ss - Spreadsheet object
 * @param {string} name - Sheet name
 * @returns {Sheet|null} Sheet object or null
 */
function getSheetInsensitive(ss, name) {
  const sheets = ss.getSheets();
  const target = name.toLowerCase();
  return sheets.find(sheet => sheet.getName().toLowerCase() === target) || null;
}

/**
 * calculateExpectedValue_ - Calculate EV for a bet
 * @param {number} impliedProb - Implied probability from odds
 * @param {number} confidence - Model confidence
 * @param {number} line - Line value
 * @returns {number} Expected value
 */
function calculateExpectedValue_(impliedProb, confidence, line) {
  if (!impliedProb || !confidence) return 0;
  
  // Adjust confidence for line movement
  const adjustedConfidence = Math.max(0, Math.min(1, confidence - (Math.abs(line) - 1) * 0.01));
  
  // Calculate EV
  const winProb = adjustedConfidence;
  const loseProb = 1 - winProb;
  const payout = (1 / impliedProb) - 1;
  
  return (winProb * payout) - loseProb;
}

/**
 * validateConfigState_ - Validate configuration state
 * @param {Object} config - Configuration object
 * @returns {boolean} True if valid
 */
function validateConfigState_(config) {
  try {
    // Check required fields
    const required = ['version', 'active_leagues', 'tier_thresholds', 'confidence_thresholds'];
    for (const field of required) {
      if (!config[field]) {
        console.warn(`Missing required config field: ${field}`);
        return false;
      }
    }
    
    // Validate thresholds
    if (config.tier_thresholds.strong <= config.tier_thresholds.medium ||
        config.tier_thresholds.medium <= config.tier_thresholds.weak) {
      console.warn('Invalid tier thresholds: must be strictly decreasing');
      return false;
    }
    
    return true;
  } catch (err) {
    console.error(`Config validation failed: ${err.message}`);
    return false;
  }
}

/**
 * normalizeConfidence_ - Normalize confidence to standard format
 * @param {number} confidence - Raw confidence value
 * @returns {Object} Normalized confidence object
 */
function normalizeConfidence_(confidence) {
  const pct = Math.max(0, Math.min(1, confidence));
  const prob = pct;
  
  // Determine tier
  let tierCode, tierDisplay;
  if (pct >= CONFIDENCE_THRESHOLDS.elite) {
    tierCode = "ELITE";
    tierDisplay = "Elite (85%+)";
  } else if (pct >= TIER_THRESHOLDS.strong) {
    tierCode = "STRONG";
    tierDisplay = "Strong (65-84%)";
  } else if (pct >= TIER_THRESHOLDS.medium) {
    tierCode = "MEDIUM";
    tierDisplay = "Medium (55-64%)";
  } else if (pct >= TIER_THRESHOLDS.weak) {
    tierCode = "WEAK";
    tierDisplay = "Weak (45-54%)";
  } else {
    tierCode = "AVOID";
    tierDisplay = "Avoid (<45%)";
  }
  
  return {
    pct: pct,
    prob: prob,
    tier_code: tierCode,
    tier_display: tierDisplay
  };
}

/**
 * upsertRow_ - Insert or update a row based on unique key
 * @param {Sheet} sheet - Target sheet
 * @param {Array} rowData - Row data to insert/update
 * @param {number} keyColumn - Column index of unique key
 * @returns {boolean} True if successful
 */
function upsertRow_(sheet, rowData, keyColumn) {
  try {
    const data = sheet.getDataRange().getValues();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const key = rowData[keyColumn];
    
    // Search for existing row
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyColumn] === key) {
        // Update existing row
        sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        return true;
      }
    }
    
    // Insert new row
    sheet.appendRow(rowData);
    return true;
  } catch (err) {
    console.error(`Upsert failed: ${err.message}`);
    return false;
  }
}

// ============================================================================
// SHEET SETUP FUNCTIONS
// ============================================================================

/**
 * setupAllSheets - Initialize all contract sheets
 * @param {Spreadsheet} ss - Spreadsheet object
 */
function setupAllSheets(ss) {
  const sheets = [
    { name: "Bet_Slips", contract: BET_SLIPS_CONTRACT },
    { name: "Tier1_Predictions", contract: FORENSIC_LOGS_CONTRACT },
    { name: "Tier2_Log", contract: FORENSIC_LOGS_CONTRACT },
    { name: "OU_Log", contract: FORENSIC_LOGS_CONTRACT },
    { name: "ResultsClean", contract: RESULTSCLEAN_CONTRACT },
    { name: "Satellite_Identity", contract: ["satellite_id", "name", "version", "created_at", "last_active", "status"] },
    { name: "Config_Tier1", contract: ["config_key", "config_value", "description", "updated_at"] },
    { name: "Config_Tier2", contract: ["config_key", "config_value", "description", "updated_at"] },
    { name: "Config_Accumulator", contract: ["config_key", "config_value", "description", "updated_at"] }
  ];
  
  sheets.forEach(({ name, contract }) => {
    let sheet = getSheetInsensitive(ss, name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, contract.length).setValues([contract])
        .setFontWeight("bold")
        .setBackground("#1a1a2e")
        .setFontColor("#FFD700");
      sheet.setFrozenRows(1);
    }
  });
}

/**
 * runGenesis - Initialize satellite identity and config sheets
 */
function runGenesis() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupAllSheets(ss);
  
  // Create Satellite Identity record
  const identitySheet = ss.getSheetByName("Satellite_Identity");
  if (identitySheet && identitySheet.getLastRow() === 1) {
    const satelliteId = Utilities.getUuid();
    identitySheet.appendRow([
      satelliteId,
      ss.getName(),
      CONTRACT_VERSION,
      new Date().toISOString(),
      new Date().toISOString(),
      "ACTIVE"
    ]);
  }
  
  console.log("Genesis complete: Satellite initialized with contract sheets");
}
