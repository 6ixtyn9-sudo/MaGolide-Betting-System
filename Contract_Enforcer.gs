/******************************************************************************
 * CONTRACT ENFORCER - Multi-League-Strict-2.0
 * Core contract enforcement and validation functions
 ******************************************************************************/

// ============================================================================
// GLOBAL CONSTANTS & CONFIGURATION
// ============================================================================
const CONTRACT_VERSION = "MULTI-LEAGUE-STRICT-2.0";
const CONTRACT_BUILD_DATE = "2025-04-13";

// Configuration cache
let _configCache = {
  tier1: null,
  tier2: null,
  accumulator: null,
  lastLoaded: null
};

// ============================================================================
// CONFIGURATION LOADING FUNCTIONS
// ============================================================================

/**
 * getConfig - Get configuration from appropriate manager
 * @param {string} tier - Configuration tier ('tier1', 'tier2', 'accumulator')
 * @returns {Object} Configuration object
 */
function getConfig(tier) {
  const now = Date.now();
  
  // Refresh cache if needed (5 minute TTL)
  if (!_configCache.lastLoaded || (now - _configCache.lastLoaded) > 300000) {
    _configCache.lastLoaded = now;
    _configCache.tier1 = null;
    _configCache.tier2 = null;
    _configCache.accumulator = null;
  }
  
  // Load from appropriate manager
  if (tier === 'tier1') {
    if (!_configCache.tier1) {
      _configCache.tier1 = ConfigManager_Tier1.loadConfig();
      validateConfigState_(_configCache.tier1, 'tier1');
    }
    return _configCache.tier1;
  } else if (tier === 'tier2') {
    if (!_configCache.tier2) {
      _configCache.tier2 = ConfigManager_Tier2.loadConfig();
      validateConfigState_(_configCache.tier2, 'tier2');
    }
    return _configCache.tier2;
  } else if (tier === 'accumulator') {
    if (!_configCache.accumulator) {
      _configCache.accumulator = ConfigManager_Accumulator.loadConfig();
      validateConfigState_(_configCache.accumulator, 'accumulator');
    }
    return _configCache.accumulator;
  }
  
  return {};
}

/**
 * getTier1Config - Get Tier1 configuration
 */
function getTier1Config() {
  return getConfig('tier1');
}

/**
 * getTier2Config - Get Tier2 configuration
 */
function getTier2Config() {
  return getConfig('tier2');
}

/**
 * getAccumulatorConfig - Get Accumulator configuration
 */
function getAccumulatorConfig() {
  return getConfig('accumulator');
}

// ============================================================================
// LEGACY COMPATIBILITY (for backward compatibility)
// ============================================================================

/**
 * getBreakevenProb - Get breakeven probability from Tier1 config
 */
function getBreakevenProb() {
  return getTier1Config().BREAKEVEN_PROB || 0.5238;
}

/**
 * getJuice - Get juice from Tier1 config
 */
function getJuice() {
  return getTier1Config().JUICE || 0.05;
}

/**
 * getFallbackSd - Get fallback SD from Tier1 config
 */
function getFallbackSd() {
  return getTier1Config().FALLBACK_SD || 0.12;
}

/**
 * getTierThresholds - Get tier thresholds from Tier1 config
 */
function getTierThresholds() {
  const config = getTier1Config();
  return {
    strong: config.TIER_STRONG_MIN || 0.65,
    medium: config.TIER_MEDIUM_MIN || 0.55,
    weak: config.TIER_WEAK_MIN || 0.45
  };
}

/**
 * getConfidenceThresholds - Get confidence thresholds from Tier1 config
 */
function getConfidenceThresholds() {
  const config = getTier1Config();
  return {
    min: config.CONF_MIN || 0.60,
    elite: config.CONF_ELITE || 0.85
  };
}

/**
 * getSpreadBuckets - Get spread buckets from Tier2 config
 */
function getSpreadBuckets() {
  return getTier2Config().SPREAD_BUCKETS || [-10, -7, -4, -3, -2, -1, 0, 1, 2, 3, 4, 7, 10];
}

/**
 * getLineBuckets - Get line buckets from Tier2 config
 */
function getLineBuckets() {
  return getTier2Config().LINE_BUCKETS || [195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 245, 250];
}

/**
 * getConfBuckets - Get confidence buckets from Tier2 config
 */
function getConfBuckets() {
  return getTier2Config().CONF_BUCKETS || [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
}

/**
 * getActiveLeagues - Get active leagues from Tier1 config
 */
function getActiveLeagues() {
  const leagues = getTier1Config().ACTIVE_LEAGUES;
  if (typeof leagues === 'string') {
    try {
      return JSON.parse(leagues);
    } catch (e) {
      return ["NBA", "NFL", "MLB", "NHL", "NCAAF", "NCAAB"];
    }
  }
  return leagues || ["NBA", "NFL", "MLB", "NHL", "NCAAF", "NCAAB"];
}

/**
 * getEnforcementFlags - Get enforcement flags from Tier1 config
 */
function getEnforcementFlags() {
  const config = getTier1Config();
  return {
    strict_side: config.ENFORCE_STRICT_SIDE !== false,
    outright_only: config.OUTRIGHT_ONLY !== false
  };
}

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
 * @param {string} tier - Configuration tier
 * @returns {boolean} True if valid
 */
function validateConfigState_(config, tier = 'unknown') {
  try {
    if (!config) {
      console.warn(`No configuration provided for tier: ${tier}`);
      return false;
    }
    
    // Use appropriate validator based on tier
    if (tier === 'tier1') {
      return ConfigManager_Tier1.validateConfigState(config);
    } else if (tier === 'tier2') {
      return ConfigManager_Tier2.validateConfigState(config);
    } else if (tier === 'accumulator') {
      return ConfigManager_Accumulator.validateConfigState(config);
    } else {
      // Generic validation for unknown tier
      const required = ['version', 'LAST_UPDATED'];
      for (const field of required) {
        if (!config[field]) {
          console.warn(`Missing required config field: ${field}`);
          return false;
        }
      }
      return true;
    }
  } catch (err) {
    console.error(`Config validation failed for tier ${tier}: ${err.message}`);
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
  
  // Get thresholds from config
  const confThresholds = getConfidenceThresholds();
  const tierThresholds = getTierThresholds();
  
  // Determine tier
  let tierCode, tierDisplay;
  if (pct >= confThresholds.elite) {
    tierCode = "ELITE";
    tierDisplay = "Elite (85%+)";
  } else if (pct >= tierThresholds.strong) {
    tierCode = "STRONG";
    tierDisplay = "Strong (65-84%)";
  } else if (pct >= tierThresholds.medium) {
    tierCode = "MEDIUM";
    tierDisplay = "Medium (55-64%)";
  } else if (pct >= tierThresholds.weak) {
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
  
  // Initialize all configuration sheets
  console.log("Initializing Tier1 configuration...");
  const tier1Config = ConfigManager_Tier1.initializeDefaultConfig();
  validateConfigState_(tier1Config, 'tier1');
  
  console.log("Initializing Tier2 configuration...");
  const tier2Config = ConfigManager_Tier2.initializeDefaultConfig();
  validateConfigState_(tier2Config, 'tier2');
  
  console.log("Initializing Accumulator configuration...");
  const accumulatorConfig = ConfigManager_Accumulator.initializeDefaultConfig();
  validateConfigState_(accumulatorConfig, 'accumulator');
  
  // Clear configuration cache to force reload
  _configCache.lastLoaded = null;
  
  console.log("Genesis complete: Satellite initialized with contract sheets and configurations");
}
