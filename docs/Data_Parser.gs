/**
======================================================================
MODULE 2
PROJECT: Ma Golide
This file is the "Toolbox" for your analysis engine.
It contains all the small, reusable helper functions that the
other modules (Parsers, Analyzers) will call to perform
common tasks, like parsing scores or loading stats from sheets.
This file is the "Single Source of Truth" (SSoT) for all
reusable logic, per the Project Charter.

[TYPE-SAFE & UPGRADED - 2025 UNIVERSAL EDITION]
FIXES APPLIED:
- parseScore, splitConcatenated, isNumericConcat: Force inputs to String to prevent type-related crashes.
- Data Loaders: Use String() for safety with null/undefined values.
- [NEW] splitScore: Replaced with robust version to handle concatenated final scores (e.g., "99111") and reject garbage (e.g., "356").
- [NEW] loadAndValidateCleanSheetData: Added to fix the "False OT" data corruption bug.
- [FIX] loadTier2MarginStats: Fixed globalTeamNames reference error by loading standings data internally.
UPGRADES:
- splitTeams: Added a "CamelCase" fallback to robustly split teams that are not present in the 'Standings' sheet.
- [UNIVERSAL]: Added SportConfig to handle NBA, NFL, and Volleyball logic dynamically.
======================================================================
*/

function diagnoseQuarterOU() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Check TeamQuarterStats_Tier2
  var tqs = ss.getSheetByName('TeamQuarterStats_Tier2');
  Logger.log('TeamQuarterStats_Tier2: ' + (tqs ? tqs.getLastRow() + ' rows' : 'NOT FOUND'));
  
  // Check LeagueQuarterO_U_Stats
  var lqs = ss.getSheetByName('LeagueQuarterO_U_Stats');
  if (lqs) {
    var data = lqs.getDataRange().getValues();
    Logger.log('LeagueQuarterO_U_Stats: ' + data.length + ' rows');
    Logger.log('Headers: ' + JSON.stringify(data[0]));
    if (data.length > 1) Logger.log('Sample: ' + JSON.stringify(data[1]));
  } else {
    Logger.log('LeagueQuarterO_U_Stats: NOT FOUND');
  }
  
  // Check UpcomingClean Q1-Q4 columns
  var uc = ss.getSheetByName('UpcomingClean');
  if (uc) {
    var headers = uc.getRange(1, 1, 1, uc.getLastColumn()).getValues()[0];
    var qCols = headers.filter(function(h) { return /^q[1-4]$/i.test(String(h)); });
    Logger.log('UpcomingClean Q columns: ' + JSON.stringify(qCols));
    
    if (uc.getLastRow() > 1) {
      var row = uc.getRange(2, 1, 1, uc.getLastColumn()).getValues()[0];
      var qIdx = headers.map(function(h,i) { return /^q[1-4]$/i.test(String(h)) ? i : -1; }).filter(function(i) { return i >= 0; });
      Logger.log('Sample Q values: ' + qIdx.map(function(i) { return headers[i] + '=' + row[i]; }).join(', '));
    }
  }
}

// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 1: SHARED UTILITY FUNCTIONS (_elite_*)                                                   ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝

/**
 * Parses Forebet "Pred Score" value into structured data.
 * Handles: "124-119", "124–119" (en-dash), "124:119", "243" (total only)
 * 
 * @param {*} value - Raw value from Pred Score column
 * @return {Object} { home, away, total, valid, source }
 */
function _elite_parseForebetScore(value) {
  var result = { home: 0, away: 0, total: 0, valid: false, source: 'none', raw: '' };
  
  if (value === null || value === undefined) return result;
  
  var str = String(value).trim();
  result.raw = str;
  
  if (!str || str === '-' || str === '0') return result;
  
  // Method 1: Use existing splitScore if available (reuse existing code)
  if (typeof splitScore === 'function') {
    try {
      var parsed = splitScore(str);
      if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
        var h = Number(parsed[0]);
        var a = Number(parsed[1]);
        if (_elite_isValidBasketballScore_(h, a)) {
          result.home = h;
          result.away = a;
          result.total = h + a;
          result.valid = true;
          result.source = 'splitScore';
          return result;
        }
      }
    } catch (e) { /* fallback below */ }
  }
  
  // Method 2: Normalize separators and parse with regex
  var normalized = str.replace(/[–—]/g, '-'); // en-dash, em-dash → hyphen
  var match = normalized.match(/^(\d{2,3})\s*[-:]\s*(\d{2,3})$/);
  if (match) {
    var home = parseInt(match[1], 10);
    var away = parseInt(match[2], 10);
    if (_elite_isValidBasketballScore_(home, away)) {
      result.home = home;
      result.away = away;
      result.total = home + away;
      result.valid = true;
      result.source = 'regex';
      return result;
    }
  }
  
  // Method 3: Single number (total only) - e.g., "243"
  var singleMatch = str.match(/^(\d{3})(?:\.\d+)?$/);
  if (singleMatch) {
    var total = parseFloat(singleMatch[1]);
    if (total >= 150 && total <= 350) {
      result.total = total;
      result.valid = true;
      result.source = 'total_only';
      return result;
    }
  }
  
  return result;
}

/**
 * Validates basketball scores are reasonable.
 * @private
 */
function _elite_isValidBasketballScore_(home, away) {
  if (!isFinite(home) || !isFinite(away)) return false;
  if (home < 50 || home > 180) return false;
  if (away < 50 || away > 180) return false;
  var total = home + away;
  return total >= 150 && total <= 350;
}

/**
 * Blends historical model value with Forebet prediction.
 * Returns historical value when Forebet invalid or weight is 0.
 * 
 * @param {number} historical - Value from historical model
 * @param {number} forebet - Value from Forebet prediction
 * @param {number} weight - Forebet weight (0.0 to 1.0)
 * @param {number} [minV] - Optional minimum value clamp
 * @param {number} [maxV] - Optional maximum value clamp
 * @return {number} Blended value
 */
function _elite_blendWithForebet(historical, forebet, weight, minV, maxV) {
  var h = Number(historical);
  var f = Number(forebet);
  var w = Number(weight);
  
  // Validate historical - use default if invalid
  if (!isFinite(h) || h <= 0) h = 220;
  
  // If Forebet invalid or weight invalid, return historical
  if (!isFinite(f) || f <= 0) return h;
  if (!isFinite(w) || w <= 0) return h;
  
  // Clamp weight to [0, 1]
  w = Math.max(0, Math.min(1, w));
  
  var blended = (h * (1 - w)) + (f * w);
  
  // Optional clamping
  if (isFinite(minV) && blended < minV) blended = minV;
  if (isFinite(maxV) && blended > maxV) blended = maxV;
  
  return blended;
}

/**
 * Finds Forebet column index in header row.
 * Supports config override via forebet_predscore_col.
 * 
 * @param {Object} headerMap - Map of lowercase header names to indices
 * @param {Array} [headerRow] - Original header row for fallback
 * @param {Object} [config] - Config object with optional forebet_predscore_col override
 * @return {number|undefined} Column index or undefined
 */
function _elite_findForebetColumn(headerMap, headerRow, config) {
  headerMap = headerMap || {};
  config = config || {};
  
  // Check for config override
  var override = config.forebet_predscore_col || config.predscore_col || config.pred_score_col;
  if (override) {
    var target = String(override).toLowerCase().trim();
    if (headerRow && Array.isArray(headerRow)) {
      for (var i = 0; i < headerRow.length; i++) {
        var h = String(headerRow[i] || '').toLowerCase().trim();
        if (h === target) return i;
      }
    }
  }
  
  // Priority patterns (most specific first)
  var patterns = [
    'predscore', 'pred score', 'pred-score', 'pred_score',
    'predictedscore', 'predicted score',
    'forebet', 'forebetscore', 'forebet score',
    'fbscore', 'fb score', 'fb-score'
  ];
  
  // Check header map (try both with and without spaces)
  for (var j = 0; j < patterns.length; j++) {
    var key = patterns[j].toLowerCase().replace(/[\s_\-]+/g, '');
    if (headerMap[key] !== undefined) return headerMap[key];
    
    var keySpaced = patterns[j].toLowerCase();
    if (headerMap[keySpaced] !== undefined) return headerMap[keySpaced];
  }
  
  // Fallback: scan original header row
  if (headerRow && Array.isArray(headerRow)) {
    for (var k = 0; k < headerRow.length; k++) {
      var hdr = String(headerRow[k] || '').toLowerCase();
      if (hdr.indexOf('pred') > -1 && hdr.indexOf('score') > -1) return k;
      if (hdr === 'forebet') return k;
    }
  }
  
  return undefined;
}

/**
 * Gets Forebet config with safe defaults.
 * 
 * @param {Object} config - Raw config object (lowercase keys preferred)
 * @return {Object} { enabled, weightQtr, weightFT }
 */
function _elite_getForebetConfig(config) {
  config = config || {};
  
  // Check enabled (default true unless explicitly disabled)
  var enabledRaw = config.forebet_blend_enabled;
  var enabled = enabledRaw !== false && 
                enabledRaw !== 'FALSE' && 
                enabledRaw !== '0' &&
                enabledRaw !== 0;
  
  // Quarter weight (default 0.25)
  var weightQtr = Number(config.forebet_ou_weight_qtr);
  if (!isFinite(weightQtr)) {
    weightQtr = Number(config.forebet_ou_weight);
  }
  if (!isFinite(weightQtr) || weightQtr < 0 || weightQtr > 1) {
    weightQtr = 0.25;
  }
  
  // FT weight (default 0.35 - typically higher than quarter)
  var weightFT = Number(config.forebet_ou_weight_ft);
  if (!isFinite(weightFT)) {
    weightFT = Number(config.forebet_ou_weight);
  }
  if (!isFinite(weightFT) || weightFT < 0 || weightFT > 1) {
    weightFT = 0.35;
  }
  
  return {
    enabled: enabled,
    weightQtr: weightQtr,
    weightFT: weightFT
  };
}

/**
 * Resolves ties between quarters. ALWAYS returns single quarter index.
 * 
 * @param {Array} candidates - Array of tied quarter indices (0-based: 0=Q1, 3=Q4)
 * @param {Array} [scores] - Array of quarter scores (optional, for future use)
 * @param {string} [policy] - 'first' | 'last' | 'random'
 * @return {number} Winning quarter index (0-based)
 */
function _elite_resolveQuarterTie(candidates, scores, policy) {
  // Safety: if no candidates, default to Q1 (index 0)
  if (!candidates || candidates.length === 0) return 0;
  
  // No tie: return the single candidate
  if (candidates.length === 1) return candidates[0];
  
  policy = String(policy || 'first').toLowerCase();
  
  switch (policy) {
    case 'last':
      // Prefer later quarter (Q4 > Q3 > Q2 > Q1)
      return Math.max.apply(null, candidates);
      
    case 'random':
      // Random selection (for testing/variety)
      return candidates[Math.floor(Math.random() * candidates.length)];
      
    case 'first':
    default:
      // Prefer earlier quarter (Q1 > Q2 > Q3 > Q4) - most common
      return Math.min.apply(null, candidates);
  }
}

/**
 * CRITICAL: Sanitizes quarter output to ensure single Q1-Q4 value.
 * Handles: "Q1 or Q3", "Q1/Q3", "TIE Q2,Q4", "Q1 & Q3", etc.
 * Use as FINAL gate before writing to sheets.
 * 
 * @param {string} value - Raw quarter value
 * @return {string} Single quarter ("Q1"|"Q2"|"Q3"|"Q4") or "N/A"
 */
function _elite_sanitizeQuarterOutput(value) {
  if (!value) return 'N/A';
  
  var str = String(value).trim().toUpperCase();
  
  // Already valid single quarter?
  if (/^Q[1-4]$/.test(str)) return str;
  
  // Extract FIRST valid quarter from compound values
  var match = str.match(/Q([1-4])/);
  if (match) {
    var sanitized = 'Q' + match[1];
    Logger.log('[_elite_sanitizeQuarterOutput] Fixed: "' + value + '" → "' + sanitized + '"');
    return sanitized;
  }
  
  return 'N/A';
}

/**
 * Standard normal CDF (for probability calculations).
 * @param {number} z - Z-score
 * @return {number} Cumulative probability
 */
function _elite_normCdf(z) {
  var sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);

  var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;

  var t = 1 / (1 + p * z);
  var erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/**
 * Clamp value to range.
 */
function _elite_clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Safe number conversion with fallback.
 */
function _elite_toNum(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : (isFinite(fallback) ? fallback : 0);
}

/**
 * Boolean parser (tolerant of string values).
 */
function _elite_toBool(value, defaultValue) {
  if (value === null || value === undefined || value === '') return !!defaultValue;
  if (typeof value === 'boolean') return value;
  var s = String(value).trim().toUpperCase();
  if (s === 'TRUE' || s === 'YES' || s === '1' || s === 'ON' || s === 'ENABLED') return true;
  if (s === 'FALSE' || s === 'NO' || s === '0' || s === 'OFF' || s === 'DISABLED') return false;
  return !!defaultValue;
}

/**
 * ============================================================================
 * clearAllCaches v6.1 ELITE
 * ============================================================================
 * Clears all known global/module caches without eval().
 * Includes Module 9, O/U caches, and config caches.
 */
function clearAllCaches(opts) {
  var FN = 'clearAllCaches';
  opts = opts || {};
  var doToast = opts.toast !== false;
  
  var cleared = [];
  var errors = [];
  
  // Helper to safely reset a global
  function tryReset_(name, resetFn, description) {
    try {
      resetFn();
      cleared.push(description || name);
    } catch (e) {
      // Variable doesn't exist or can't be reset - that's fine
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // TIER 2 MARGIN CACHES
  // ─────────────────────────────────────────────────────────────────────
  tryReset_('TIER2_MARGIN_STATS_CACHE', function() {
    if (typeof TIER2_MARGIN_STATS_CACHE !== 'undefined') TIER2_MARGIN_STATS_CACHE = null;
  });
  
  tryReset_('CONFIG_TIER2', function() {
    if (typeof CONFIG_TIER2 !== 'undefined') CONFIG_TIER2 = null;
  });
  
  tryReset_('CONFIG_TIER2_META', function() {
    if (typeof CONFIG_TIER2_META !== 'undefined') {
      CONFIG_TIER2_META = { loadedAt: 0, source: null, league: null };
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // TIER 2 O/U CACHES
  // ─────────────────────────────────────────────────────────────────────
  tryReset_('T2OU_CACHE', function() {
    if (typeof T2OU_CACHE !== 'undefined') {
      T2OU_CACHE = { teamStats: null, league: null, builtAt: null };
    }
  });
  
  tryReset_('T2OU_CONFIG_CACHE', function() {
    if (typeof T2OU_CONFIG_CACHE !== 'undefined') T2OU_CONFIG_CACHE = null;
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // MODULE 9 / ENHANCEMENT CACHES
  // ─────────────────────────────────────────────────────────────────────
  tryReset_('resetModule9Cache()', function() {
    if (typeof resetModule9Cache === 'function') resetModule9Cache();
  });
  
  tryReset_('_M9.reset()', function() {
    if (typeof _M9 !== 'undefined' && _M9 && typeof _M9.reset === 'function') _M9.reset();
  });
  
  tryReset_('ENH_LQ_CACHE', function() {
    if (typeof ENH_LQ_CACHE !== 'undefined') ENH_LQ_CACHE = null;
  });
  
  tryReset_('ENH_TQ_CACHE', function() {
    if (typeof ENH_TQ_CACHE !== 'undefined') ENH_TQ_CACHE = null;
  });
  
  tryReset_('ENH_LOG_STATE', function() {
    if (typeof ENH_LOG_STATE !== 'undefined') ENH_LOG_STATE = null;
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // ACCUMULATOR / DEBUG STATE
  // ─────────────────────────────────────────────────────────────────────
  tryReset_('ACC_LOG_STATE', function() {
    if (typeof ACC_LOG_STATE !== 'undefined') ACC_LOG_STATE = null;
  });
  
  tryReset_('ACC_DEBUG', function() {
    if (typeof ACC_DEBUG !== 'undefined') ACC_DEBUG = false;
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // O/U SPECIFIC CACHE FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────
  tryReset_('clearO_U_Cache()', function() {
    if (typeof clearO_U_Cache === 'function') clearO_U_Cache();
  });
  
  tryReset_('t2ou_clearCache_()', function() {
    if (typeof t2ou_clearCache_ === 'function') t2ou_clearCache_();
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // CALIBRATION CACHES
  // ─────────────────────────────────────────────────────────────────────
  tryReset_('CALIBRATION_MAP_CACHE', function() {
    if (typeof CALIBRATION_MAP_CACHE !== 'undefined') CALIBRATION_MAP_CACHE = null;
  });
  
  tryReset_('OU_CALIB_CACHE', function() {
    if (typeof OU_CALIB_CACHE !== 'undefined') OU_CALIB_CACHE = null;
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // LOGGING & RESULT
  // ─────────────────────────────────────────────────────────────────────
  Logger.log('[' + FN + '] Cleared: ' + (cleared.length ? cleared.join(', ') : '(none)'));
  
  if (doToast) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) ss.toast('Cleared ' + cleared.length + ' caches', 'Cache Manager', 3);
    } catch (e) { /* UI not available */ }
  }
  
  return { ok: true, cleared: cleared, count: cleared.length };
}

/** Tier 2 Margin Stats Cache */
var TIER2_MARGIN_STATS_CACHE = null;

/** Tier 2 O/U Cache */
var T2OU_CACHE = {
  teamStats: null,
  league: null,
  builtAt: null
};

/** Dynamic Config Cache - NO HARDCODED DEFAULTS */
var CONFIG_TIER2 = null;
var CONFIG_TIER2_META = {
  loadedAt: 0,
  source: null,
  league: null
};

/** Audit Constants */
var AUDIT_FINAL = {
  INVENTORY_SHEET: 'SheetInventory',
  REPORT_SHEET: 'AuditReport'
};

// ============================================================================
// CORE UTILITY FUNCTIONS
// ============================================================================
/**
 * =====================================================================
 * HELPER DEPENDENCIES
 * =====================================================================
 */

// Ensure spreadsheet is available
function _ensureSpreadsheet_(ss) {
  if (ss && typeof ss.getSheets === 'function') return ss;
  if (ss && typeof ss.getParent === 'function') return ss.getParent();
  return SpreadsheetApp.getActiveSpreadsheet();
}


// Global cache declarations (if not already defined)
var TIER2_MARGIN_STATS_CACHE = null;
var TIER2_VENUE_STATS_CACHE = null;
var CONFIG_TIER2 = null;
var CONFIG_TIER2_META = {};
var T2OU_CACHE = { teamStats: null, league: null, builtAt: null };
var t2_lastEvalResults = null;

// Required config keys (for validation)
var REQUIRED_CONFIG_KEYS = [
  'threshold',
  'ou_edge_threshold'
];

/**
 * Safe toast notification with fallback to logging
 * 
 * @param {Spreadsheet|Sheet|null} ssOrSheet - Context
 * @param {string} message - Toast message
 * @param {string} title - Toast title (default: 'Ma Golide')
 * @param {number} duration - Duration in seconds (default: 5)
 * @returns {boolean} True if toast shown, false if logged
 */
function _safeToast_(ssOrSheet, message, title, duration) {
  var t = title || 'Ma Golide';
  var m = String(message || '');
  var d = duration || 5;
  
  try {
    var ss = _ensureSpreadsheet_(ssOrSheet);
    if (ss && typeof ss.toast === 'function') {
      ss.toast(m, t, d);
      return true;
    }
  } catch (e) { 
    // Fall through to logging
  }
  
  Logger.log('[Toast] ' + t + ': ' + m);
  return false;
}

/**
 * Safe alert with fallback to logging
 * 
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @returns {boolean} True if alert shown, false if logged
 */
function _safeAlert_(title, message) {
  var t = String(title || 'Ma Golide');
  var m = String(message || '');
  
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(t, m, ui.ButtonSet.OK);
    return true;
  } catch (e) {
    Logger.log('[Alert] ' + t + ': ' + m);
    return false;
  }
}

/**
 * Case-insensitive sheet lookup with fallbacks
 * 
 * @param {Spreadsheet|Sheet|null} ssOrSheet - Context
 * @param {string} sheetName - Sheet name to find
 * @returns {Sheet|null} Found sheet or null
 */
function _getSheetByNameInsensitive_(ssOrSheet, sheetName) {
  var ss = _ensureSpreadsheet_(ssOrSheet);
  if (!ss) return null;
  
  var target = String(sheetName || '').toLowerCase().trim();
  if (!target) return null;
  
  // Try project helpers first
  try {
    if (typeof t2ou_getSheetInsensitive_ === 'function') {
      var r = t2ou_getSheetInsensitive_(ss, sheetName);
      if (r) return r;
    }
  } catch (e) {}
  
  try {
    if (typeof getSheetInsensitive === 'function') {
      var r = getSheetInsensitive(ss, sheetName);
      if (r) return r;
    }
  } catch (e) {}
  
  // Exact match first (fastest)
  try {
    var exact = ss.getSheetByName(sheetName);
    if (exact) return exact;
  } catch (e) {}
  
  // Case-insensitive search
  try {
    var sheets = ss.getSheets() || [];
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName();
      if (String(name || '').toLowerCase().trim() === target) {
        return sheets[i];
      }
    }
  } catch (e) {}
  
  return null;
}

/**
 * Create header map from header row
 * 
 * @param {Array} headers - Header row array
 * @returns {Object} Map of normalized header name to column index
 */
function _createHeaderMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    if (key && map[key] === undefined) {
      map[key] = i;
    }
  }
  return map;
}

/**
 * Calculate standard deviation of array
 * 
 * @param {Array<number>} arr - Numeric array
 * @returns {number} Standard deviation (0 if < 2 elements)
 */
function _calculateStdDev_(arr) {
  if (!arr || arr.length < 2) return 0;
  
  var sum = 0;
  for (var i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  var mean = sum / arr.length;
  
  var squaredDiffs = 0;
  for (var j = 0; j < arr.length; j++) {
    var diff = arr[j] - mean;
    squaredDiffs += diff * diff;
  }
  
  return Math.sqrt(squaredDiffs / arr.length);
}

/**
 * Validate historical data quality for tuning
 * 
 * @param {Array} games - Array of game objects
 * @param {number} minValidRatio - Minimum valid ratio (default: 0.8)
 * @returns {Object} { ok, valid, total, ratio }
 */
function _validateHistoricalDataQuality_(games, minValidRatio) {
  var threshold = (minValidRatio !== undefined) ? minValidRatio : 0.8;
  
  if (!games || !Array.isArray(games) || games.length === 0) {
    return { ok: false, valid: 0, total: 0, ratio: 0 };
  }
  
  var valid = 0;
  for (var i = 0; i < games.length; i++) {
    var g = games[i] || {};
    
    // Flexible field detection for team names
    var hasTeams = !!(g.home || g.homeTeam || g.Home) && 
                   !!(g.away || g.awayTeam || g.Away);
    
    // Flexible field detection for total score
    var total = g.actualTotal !== undefined ? Number(g.actualTotal) :
                g.total !== undefined ? Number(g.total) :
                g.ftTotal !== undefined ? Number(g.ftTotal) : NaN;
    var hasTotal = isFinite(total) && total >= 0 && total <= 400;
    
    // Sample count check
    var samples = Number(g.samples || g.n || 1);
    var hasSamples = samples >= 1;
    
    if (hasTeams && hasTotal && hasSamples) valid++;
  }
  
  var ratio = games.length > 0 ? (valid / games.length) : 0;
  return { 
    ok: ratio >= threshold, 
    valid: valid, 
    total: games.length, 
    ratio: ratio 
  };
}

/**
 * Convert value to boolean (loose parsing)
 * 
 * @param {*} v - Value to convert
 * @param {boolean} defaultVal - Default if blank/null
 * @returns {boolean}
 */
function _toBool_(v, defaultVal) {
  if (v === null || v === undefined || v === '') {
    return defaultVal !== undefined ? defaultVal : false;
  }
  if (typeof v === 'boolean') return v;
  
  var s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].indexOf(s) >= 0) return true;
  if (['false', '0', 'no', 'n', 'off'].indexOf(s) >= 0) return false;
  
  return defaultVal !== undefined ? defaultVal : false;
}

/**
 * Get first defined value from header map
 * 
 * @param {Object} map - Header map
 * @param {Array<string>} keys - Keys to try in order
 * @returns {number|undefined} Column index or undefined
 */
function _firstDefined_(map, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (map[keys[i]] !== undefined) return map[keys[i]];
  }
  return undefined;
}

/**
 * ============================================================================
 * MA GOLIDE - DYNAMIC CONFIGURATION SYSTEM
 * ============================================================================
 * Version: Production v4.0
 * Purpose: Load config from sheet - NO HARDCODED DEFAULTS
 * 
 * Sheet Format: Config_Tier2
 * Headers: key, value, [type], [league], [enabled]
 * 
 * FAILS FAST if required keys missing - no silent fallbacks
 * ============================================================================
 */

/**
 * Required config keys - system fails if these are missing
 */
var REQUIRED_CONFIG_KEYS = [
  'ou_edge_threshold',
  'ou_min_ev', 
  'ou_min_samples',
  'ou_confidence_scale',
  'ou_american_odds',
  'ou_push_width'
];


/**
 * Load Tier 2 config dynamically from sheet
 * NO HARDCODED DEFAULTS - fails if required keys missing
 * 
 * @param {Spreadsheet|Sheet|null} ss - Spreadsheet context
 * @param {string|null} league - Optional league for overrides
 * @param {boolean} forceRefresh - Force reload from sheet
 * @returns {Object} Config object
 * @throws {Error} If sheet missing or required keys absent
 */
function loadTier2Config(ss, league, forceRefresh) {
  ss = _ensureSpreadsheet_(ss);
  if (!ss) {
    throw new Error('loadTier2Config: Spreadsheet not available');
  }
  
  // Normalize league
  var targetLeague = league ? String(league).trim().toLowerCase() : null;
  
  // Check cache validity (5 minute TTL)
  if (!forceRefresh && CONFIG_TIER2 && CONFIG_TIER2_META.loadedAt) {
    var age = Date.now() - CONFIG_TIER2_META.loadedAt;
    var sameLeague = CONFIG_TIER2_META.league === targetLeague;
    if (age < 300000 && sameLeague) {
      return CONFIG_TIER2;
    }
  }
  
  // Find config sheet
  var configSheetNames = [
    'Config_Tier2', 'ConfigTier2', 'Tier2Config', 
    'Config', 'Settings', 'Configuration'
  ];
  
  var sh = null;
  var sheetName = null;
  for (var i = 0; i < configSheetNames.length; i++) {
    sh = _getSheetByNameInsensitive_(ss, configSheetNames[i]);
    if (sh) {
      sheetName = configSheetNames[i];
      break;
    }
  }
  
  if (!sh) {
    throw new Error('Missing required sheet: Config_Tier2 (or similar). Create it with required keys.');
  }
  
  // Read sheet data
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) {
    throw new Error('Config sheet "' + sheetName + '" has no data rows. Add config keys.');
  }
  
  // Build header map
  var headers = values[0].map(function(h) {
    return String(h || '').toLowerCase().trim();
  });
  var hMap = {};
  for (var h = 0; h < headers.length; h++) {
    if (headers[h]) hMap[headers[h]] = h;
  }
  
  // Find columns (flexible naming)
  var keyCol = _firstDefined_(hMap, ['key', 'setting', 'parameter', 'name', 'param']);
  var valCol = _firstDefined_(hMap, ['value', 'val', 'setting_value']);
  var typeCol = _firstDefined_(hMap, ['type', 'datatype', 'valuetype']);
  var leagueCol = _firstDefined_(hMap, ['league', 'competition', 'sport']);
  var enabledCol = _firstDefined_(hMap, ['enabled', 'active', 'on']);
  
  // Default to columns A and B if no headers match
  if (keyCol === undefined) keyCol = 0;
  if (valCol === undefined) valCol = 1;
  
  // Parse config rows
  var baseConfig = {};
  var overrideConfig = {};
  var loadedCount = 0;
  
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var key = String(row[keyCol] || '').trim();
    
    // Skip blanks, comments
    if (!key || key.charAt(0) === '#' || key.substring(0, 2) === '//') {
      continue;
    }
    
    // Check enabled flag
    if (enabledCol !== undefined) {
      var enabled = _toBool_(row[enabledCol], true);
      if (!enabled) continue;
    }
    
    // Parse value
    var rawVal = row[valCol];
    var typeHint = typeCol !== undefined ? String(row[typeCol] || '').toLowerCase().trim() : '';
    var parsedVal = _parseConfigValue_(rawVal, typeHint, key);
    
    if (parsedVal === undefined) continue;
    
    // Normalize key
    var normalizedKey = _normalizeConfigKey_(key);
    
    // Determine if global or league-specific
    var rowLeague = leagueCol !== undefined ? 
      String(row[leagueCol] || '').trim().toLowerCase() : '';
    
    if (!rowLeague) {
      baseConfig[normalizedKey] = parsedVal;
      loadedCount++;
    } else if (targetLeague && rowLeague === targetLeague) {
      overrideConfig[normalizedKey] = parsedVal;
      loadedCount++;
    }
  }
  
  // Merge base + overrides
  var config = {};
  for (var bk in baseConfig) {
    config[bk] = baseConfig[bk];
  }
  for (var ok in overrideConfig) {
    config[ok] = overrideConfig[ok];
  }
  
  // Validate required keys
  var missing = [];
  for (var j = 0; j < REQUIRED_CONFIG_KEYS.length; j++) {
    var reqKey = REQUIRED_CONFIG_KEYS[j];
    if (config[reqKey] === undefined || config[reqKey] === null || config[reqKey] === '') {
      missing.push(reqKey);
    }
  }
  
  if (missing.length > 0) {
    throw new Error('Config missing required keys: ' + missing.join(', ') + 
                    '\nAdd these to Config_Tier2 sheet.');
  }
  
  // Type validation for numeric thresholds
  var numericKeys = ['ou_edge_threshold', 'ou_min_ev', 'ou_min_samples', 
                     'ou_confidence_scale', 'ou_american_odds', 'ou_push_width'];
  for (var nk = 0; nk < numericKeys.length; nk++) {
    var numKey = numericKeys[nk];
    if (config[numKey] !== undefined && typeof config[numKey] !== 'number') {
      var parsed = Number(config[numKey]);
      if (!isFinite(parsed)) {
        throw new Error('Config key "' + numKey + '" must be a number. Got: ' + config[numKey]);
      }
      config[numKey] = parsed;
    }
  }
  
  // Cache the config
  CONFIG_TIER2 = config;
  CONFIG_TIER2_META = {
    loadedAt: Date.now(),
    source: sheetName,
    league: targetLeague
  };
  
  Logger.log('[loadTier2Config] Loaded ' + loadedCount + ' settings from "' + 
             sheetName + '" for league: ' + (targetLeague || 'global'));
  
  return config;
}

function _normalizeConfigKey_(key) {
  if (!key) return '';
  var s = String(key).trim();
  
  // Convert camelCase to snake_case: "highQtrTieMargin" → "high_qtr_tie_margin"
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  
  // Lowercase everything
  s = s.toLowerCase();
  
  // Collapse any non-alphanumeric to single underscore
  s = s.replace(/[^a-z0-9]+/g, '_');
  
  // Trim leading/trailing underscores
  s = s.replace(/^_+|_+$/g, '');
  
  return s;
}

/**
 * Safely read a config value, trying multiple key formats.
 * Usage: _cfgGet_(config, 'hqSoftmaxTemperature', 6)
 */
function _cfgGet_(cfg, key, defaultVal) {
  if (!cfg || typeof cfg !== 'object') return defaultVal;
  
  // Try exact key first
  if (cfg[key] !== undefined && cfg[key] !== null && cfg[key] !== '') return cfg[key];
  
  // Try snake_case
  var snake = String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (cfg[snake] !== undefined && cfg[snake] !== null && cfg[snake] !== '') return cfg[snake];
  
  // Try all-lowercase (no separators)
  var flat = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cfg[flat] !== undefined && cfg[flat] !== null && cfg[flat] !== '') return cfg[flat];
  
  // Try camelCase from snake
  var camel = snake.replace(/_([a-z])/g, function(_, c) { return c.toUpperCase(); });
  if (cfg[camel] !== undefined && cfg[camel] !== null && cfg[camel] !== '') return cfg[camel];
  
  return defaultVal;
}


// Parse config value with type hints
function _parseConfigValue_(rawVal, typeHint, key) {
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return undefined;
  }
  
  // Type-based parsing
  if (typeHint === 'boolean' || typeHint === 'bool') {
    return _toBool_(rawVal, false);
  }
  if (typeHint === 'number' || typeHint === 'int' || typeHint === 'float') {
    var n = Number(rawVal);
    return isFinite(n) ? n : undefined;
  }
  if (typeHint === 'string') {
    return String(rawVal);
  }
  
  // Auto-detect type
  if (typeof rawVal === 'boolean') return rawVal;
  if (typeof rawVal === 'number') return rawVal;
  
  var s = String(rawVal).trim();
  
  // Boolean detection
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  
  // Number detection
  var num = Number(s);
  if (isFinite(num) && s !== '') return num;
  
  return s;
}

/**
 * Get config value with optional fallback
 * 
 * @param {string} key - Config key
 * @param {*} fallback - Fallback if not found (optional)
 * @returns {*} Config value
 */
function getConfigValue(key, fallback) {
  if (!CONFIG_TIER2) {
    try {
      loadTier2Config();
    } catch (e) {
      Logger.log('[getConfigValue] Config load failed: ' + e.message);
      return fallback;
    }
  }
  
  var normalized = _normalizeConfigKey_(key);
  var val = CONFIG_TIER2[normalized];
  
  return (val !== undefined) ? val : fallback;
}

/**
 * Force refresh config from sheet
 */
function refreshConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Clear cache
  CONFIG_TIER2 = null;
  CONFIG_TIER2_META = { loadedAt: 0, source: null, league: null };
  
  try {
    var config = loadTier2Config(ss, null, true);
    _safeToast_(ss, 'Config reloaded: ' + Object.keys(config).length + ' settings', 'Config', 3);
    return config;
  } catch (e) {
    _safeAlert_('Config Error', e.message);
    throw e;
  }
}

/**
 * Show current config (for debugging)
 */
function showCurrentConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    var config = loadTier2Config(ss);
    var lines = ['CURRENT CONFIG:\n'];
    
    var keys = Object.keys(config).sort();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      lines.push(k + ': ' + JSON.stringify(config[k]));
    }
    
    lines.push('\nSource: ' + (CONFIG_TIER2_META.source || 'unknown'));
    lines.push('League: ' + (CONFIG_TIER2_META.league || 'global'));
    lines.push('Loaded: ' + (CONFIG_TIER2_META.loadedAt ? 
      new Date(CONFIG_TIER2_META.loadedAt).toISOString() : 'never'));
    
    _safeAlert_('Config', lines.join('\n'));
    Logger.log(lines.join('\n'));
    
    return config;
  } catch (e) {
    _safeAlert_('Config Error', e.message);
    throw e;
  }
}

/**
 * Create config sheet template (if missing)
 */
function createConfigSheetTemplate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var existing = _getSheetByNameInsensitive_(ss, 'Config_Tier2');
  if (existing) {
    _safeAlert_('Config', 'Config_Tier2 already exists. Edit values there.');
    return;
  }
  
  var sh = ss.insertSheet('Config_Tier2');
  
  var template = [
    ['key', 'value', 'type', 'league', 'enabled', 'description'],
    ['# REQUIRED THRESHOLDS', '', '', '', '', ''],
    ['ou_edge_threshold', 0.03, 'number', '', 'TRUE', 'Min edge % to trigger pick (0.01-0.5)'],
    ['ou_min_ev', 0.01, 'number', '', 'TRUE', 'Min expected value (0-0.5)'],
    ['ou_min_samples', 5, 'number', '', 'TRUE', 'Min games required (1-100)'],
    ['ou_confidence_scale', 30, 'number', '', 'TRUE', 'Confidence scaling factor (1-100)'],
    ['ou_american_odds', -110, 'number', '', 'TRUE', 'Standard vig American odds (-200 to -100)'],
    ['ou_push_width', 0.5, 'number', '', 'TRUE', 'Push zone width (0-2)'],
    ['', '', '', '', '', ''],
    ['# FEATURE TOGGLES', '', '', '', '', ''],
    ['enableRobbers', 'FALSE', 'bool', '', 'TRUE', 'Enable robber quarter detection'],
    ['enableFirstHalf', 'FALSE', 'bool', '', 'TRUE', 'Enable 1H predictions'],
    ['enableFTOU', 'TRUE', 'bool', '', 'TRUE', 'Enable full-time O/U'],
    ['enableEnhancedHighestQ', 'TRUE', 'bool', '', 'TRUE', 'Enhanced highest quarter'],
    ['', '', '', '', '', ''],
    ['# OPTIONAL ADVANCED', '', '', '', '', ''],
    ['recency_weight', 1.5, 'number', '', 'TRUE', 'Weight for recent games (1.0-3.0)'],
    ['home_advantage', 2.5, 'number', '', 'TRUE', 'Home court points bonus (0-5)'],
    ['min_confidence', 55, 'number', '', 'TRUE', 'Min confidence to show pick (50-80)'],
    ['', '', '', '', '', ''],
    ['# LEAGUE OVERRIDES (example)', '', '', '', '', ''],
    ['ou_edge_threshold', 0.04, 'number', 'NBA', 'TRUE', 'NBA-specific edge threshold']
  ];
  
  sh.getRange(1, 1, template.length, 6).setValues(template);
  
  // Format header row
  sh.getRange(1, 1, 1, 6)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('white');
  
  // Format section headers
  for (var r = 0; r < template.length; r++) {
    if (String(template[r][0]).charAt(0) === '#') {
      sh.getRange(r + 1, 1, 1, 6)
        .setFontWeight('bold')
        .setBackground('#f3f3f3');
    }
  }
  
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 6);
  sh.setColumnWidth(6, 300);
  
  _safeToast_(ss, 'Config_Tier2 created! Edit values and refresh.', 'Config', 5);
  Logger.log('[createConfigSheetTemplate] Created Config_Tier2');
}

/**
 * WHY: This is a debugging tool. Its logic is to wrap another function
 * and log when it starts, what arguments it received, and when it
 * finishes, making it easier to trace errors.
 * WHAT: A wrapper to log function execution details.
 * HOW: It returns a new function that, when called:
 * Logs an "Entering..." message with the function's name and arguments.
 * Calls the original function using fn.apply().
 * Logs an "Exiting..." message.
 * Uses a try...catch block to log any errors that occur.
 * WHERE: This is a utility that can be wrapped around any function
 * in any module for debugging (e.g., myFunction = debugWrap(myFunction);).
 */
function debugWrap(fn) {
  return function(...args) {
    const functionName = fn.name || 'anonymous';
    try {
      // Logger.log(`--> Entering ${functionName}`); // Uncomment for verbose logs
      const result = fn.apply(this, args);
      // Logger.log(`<-- Exiting ${functionName}`); // Uncomment for verbose logs
      return result;
    } catch (e) {
      Logger.log(`!!! ERROR in ${functionName}: ${e.message}\nStack: ${e.stack}`);
      throw e; // Re-throw the error so the application knows something went wrong
    }
  };
}

/**
 * parseScore
 * WHY: Standardize how we turn messy score text into clean numbers for analyzers.
 * WHAT: Takes a string like "102-99", "86–74 OT", or "90 - 88 (OT)" and returns [home, away].
 *       If the string is empty, garbage, or has no valid "X-Y" score, it returns null.
 * HOW: 
 *   1) Normalizes dash characters and trims "OT" or extra notes.
 *   2) Looks for a "digit - digit" pattern.
 *   3) If found, parses the last such pattern into [home, away].
 *   4) If parsing fails or numbers are NaN, returns null instead of faking a score.
 * [UPGRADE]: Implements the M-003 Amendment:
 *   - Old behavior: would sometimes fall back to [0, 0].
 *   - New behavior: uses null to signal "invalid/unparseable" to calling code.
 * WHERE: Used wherever we read scores from:
 *   - Raw → Clean
 *   - ResultsRaw → ResultsClean
 *   - H2H / Recent loop sheets
 */
function parseScore(scoreStr) {
  // Guard against missing or non-string input early.
  if (scoreStr === null || scoreStr === undefined) {
    return null;
  }
  if (typeof scoreStr !== 'string') {
    scoreStr = String(scoreStr);
  }

  let s = scoreStr.trim();
  if (s === '') {
    return null;
  }

  // Normalize fancy dashes (en-dash, em-dash) to a normal "-" so regex works consistently.
  s = s.replace(/[–—]/g, '-');

  // Strip out "OT" or "OT + something" at the end, we only care about the base score.
  s = s.replace(/\bOT\b.*$/i, '').trim();

  // Some sites use "+" noise like "FT 102-99 +123" or similar.
  if (s.includes('+')) {
    const plusParts = s.split('+');
    s = plusParts[plusParts.length - 1].trim();
  }

  // Strategy 1: Split by whitespace and scan pieces from right to left for "X-Y".
  const segments = s.split(/\s+/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.includes('-')) {
      const parts = seg.split('-');
      if (parts.length >= 2) {
        const home = parseInt(parts[0].trim(), 10);
        const away = parseInt(parts.slice(1).join('').trim(), 10);

        if (!isNaN(home) && !isNaN(away) && home >= 0 && away >= 0) {
          return [home, away];
        }
      }
    }
  }

  // Strategy 2: Search the entire string for any "digits - digits" pattern.
  const allMatches = s.match(/\d+\s*-\s*\d+/g);
  if (allMatches && allMatches.length > 0) {
    const last = allMatches[allMatches.length - 1];
    const parts = last.split('-');
    const home = parseInt(parts[0].replace(/\D/g, ''), 10);
    const away = parseInt(parts[1].replace(/\D/g, ''), 10);

    if (!isNaN(home) && !isNaN(away) && home >= 0 && away >= 0) {
      return [home, away];
    }
  }

  // M-003: Explicitly signal failure with null (not [0, 0] and never [NaN, NaN]).
  return null;
}

/**
 * WHY: To determine if a game went to Overtime based on the raw string.
 * WHAT: Returns true if 'OT', 'Overtime', or '+' is found, or if >4 quarters exist.
 * HOW: Regex checks and segment counting.
 * WHERE: Used by Parsers to populate the 'Status' column.
 */
function hasOvertime(scoreStr) {
  if (!scoreStr || typeof scoreStr !== 'string') return false;
  const lower = scoreStr.toLowerCase();
  if (lower.includes('ot') || lower.includes('overtime') || lower.includes('+')) return true;

  // Count the number of quarter segments – if more than 4, it's OT
  const clean = scoreStr.replace(/\bOT\b.*$/i, '').trim();
  const segments = clean.split(/\s+/).filter(seg => /\d+\s*-\s*\d+/.test(seg));
  return segments.length > 4;
}

/**
 * =====================================================================
 * HELPER: getSheetInsensitive (PATCHED)
 * =====================================================================
 * WHY:
 *   Case-insensitive sheet lookup with empty-sheet detection.
 *
 * PATCH:
 *   - Returns null for empty or header-only sheets
 *   - Logs skipped sheets for debugging
 *   - Prevents downstream processing of empty data
 *
 * @param {Spreadsheet} ss - The spreadsheet
 * @param {string} name - Sheet name to find
 * @param {boolean} allowEmpty - If true, returns sheet even if empty (default: false)
 * @returns {Sheet|null} The sheet or null if not found/empty
 * =====================================================================
 */
function getSheetInsensitive(ss, name, allowEmpty) {
  if (!ss || !name) {
    return null;
  }
  
  // Default: don't allow empty sheets
  if (allowEmpty === undefined) {
    allowEmpty = false;
  }
  
  var targetName = String(name).toLowerCase().trim();
  var sheets = ss.getSheets();
  var sheet = null;
  
  // Find sheet by case-insensitive name match
  for (var i = 0; i < sheets.length; i++) {
    var sheetName = String(sheets[i].getName()).toLowerCase().trim();
    if (sheetName === targetName) {
      sheet = sheets[i];
      break;
    }
  }
  
  if (!sheet) {
    Logger.log('[getSheetInsensitive] Sheet "' + name + '" not found - returning null');
    return null;
  }
  
  // PATCH: Skip empty/header-only sheets unless explicitly allowed
  if (!allowEmpty) {
    try {
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      
      // No data at all
      if (lastRow === 0 || lastCol === 0) {
        Logger.log('[getSheetInsensitive] Sheet "' + name + '" is completely empty - skipping');
        return null;
      }
      
      // Only header row (1 row)
      if (lastRow === 1) {
        Logger.log('[getSheetInsensitive] Sheet "' + name + '" has only header row - skipping');
        return null;
      }
      
      // Check if all data rows are empty (header + empty rows)
      if (lastRow <= 2) {
        var data = sheet.getDataRange().getValues();
        
        // Single row that might be header
        if (data.length === 1) {
          var allEmpty = data[0].every(function(cell) {
            return cell === '' || cell === null || cell === undefined;
          });
          if (allEmpty) {
            Logger.log('[getSheetInsensitive] Sheet "' + name + '" has only empty cells - skipping');
            return null;
          }
        }
        
        // Two rows: check if second row is all empty
        if (data.length === 2) {
          var secondRowEmpty = data[1].every(function(cell) {
            return cell === '' || cell === null || cell === undefined;
          });
          if (secondRowEmpty) {
            Logger.log('[getSheetInsensitive] Sheet "' + name + '" has header but no data rows - skipping');
            return null;
          }
        }
      }
      
    } catch (e) {
      // If we can't check emptiness, log and return the sheet anyway
      Logger.log('[getSheetInsensitive] Could not check if "' + name + '" is empty: ' + e.message);
    }
  }
  
  return sheet;
}

/**
 * =====================================================================
 * HELPER: getSheetInsensitiveAllowEmpty
 * =====================================================================
 * Convenience function to get a sheet even if empty (for writing).
 * =====================================================================
 */
function getSheetInsensitiveAllowEmpty(ss, name) {
  return getSheetInsensitive(ss, name, true);
}


/**
 * WHY: This is the SSoT helper for reading headers. Its logic is to
 * create a "map" that links a header name (like "Home") to its
 * column index (like 5). This makes parsers and analyzers robust
 * to changes in column order.
 * WHAT: Creates a case-insensitive map of header names to their
 * column index (0-based).
 * HOW: It loops through a header row array (e.g., ['Date', 'Home', 'Away']).
 * For each header, it stores the lowercase version as the key
 * and the index (i) as the value (e.g., {'date': 0, 'home': 1, 'away': 2}).
 * WHERE: Used by all parsers (Module 2) and analyzers (Module 3, 4, 5).
 * @param {Array<string>} headerRow A 1D array of header names.
 * @returns {Object<string, number>} A header map object.
 */
function createHeaderMap(headerRow) {
  if (typeof createCanonicalHeaderMap_ === 'function') {
    return createCanonicalHeaderMap_(headerRow);
  }
  const map = {};
  if (!headerRow || !Array.isArray(headerRow)) return map;

  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i];
    if (header && typeof header === 'string') {
      map[header.trim().toLowerCase()] = i;
    }
  }
  return map;
}

/**
 * WHY: This is an advanced SSoT helper for analyzers. Its logic is to
 * create a "smart" header map that understands aliases (e.g.,
 * that "Prediction" and "Pred" mean the same thing). This makes the
 * analyzers even more robust to changes in source sheet headers.
 * WHAT: Creates a "smart" column index map that handles aliases.
 * HOW: It uses a predefined 'aliases' object. It loops through the
 * headers, finds the index, and stores it under both the original
 * name (e.g., 'Prediction') and the standard key (e.g., 'Pred').
 * WHERE: Used by Analyzers (Modules 3, 4, 5).
 * @param {Array<string>} headers A 1D array of header names.
 * @returns {Object<string, number>} A header map object with aliases.
 */
function getColumnIndexMap(headers) {
  const map = {};
  const aliases = {
    'Pred': ['Prediction', 'Pred'],
    'Prob %': ['Probability %', 'Prob %'],
    'Home': ['Home', 'Home Team'],
    'Away': ['Away', 'Away Team'],
    'League': ['League'],
    'Avg': ['Avg', 'O/U', 'Avg. points'],
    'FT Score': ['FT Score', 'Score', 'FT']
  };

  const reverseAliasMap = {};
  for (const standardKey in aliases) {
    for (const alias of aliases[standardKey]) {
      reverseAliasMap[alias.toLowerCase()] = standardKey;
    }
  }

  headers.forEach((header, i) => {
    const cleanHeader = String(header).trim();
    if (cleanHeader) {
      const lowerHeader = cleanHeader.toLowerCase();
      map[lowerHeader] = i; // Map the actual header
      const standardKey = reverseAliasMap[lowerHeader];
      if (standardKey && !map.hasOwnProperty(standardKey)) {
        map[standardKey] = i; // Also map the standard alias if not already set
      }
    }
  });
  return map;
}

/**
 * WHY: Robust split for concatenated quarters (e.g., "2119" -> ["21", "19"]).
 * WHAT: Splits a string into chunks of 2 characters.
 * HOW: It forces the input to a string, then loops through it, slicing
 * off 2 characters at a time.
 * FIX: Forces input to String to prevent ".length" crashes.
 * WHERE: Used by parsers to handle quarter scores that are typed without a separator.
 * @param {string|number} str The concatenated string.
 * @returns {Array<string>} An array of 2-character strings.
 */
function splitConcatenated(str) {
  if (str === null || str === undefined) return [];
  const s = String(str).trim();
  const result = [];
  for (let i = 0; i < s.length; i += 2) {
    result.push(s.slice(i, i + 2));
  }
  return result;
}

/**
 * [UPGRADED] parseScore logic to handle 3-digit and 2-digit "short" scores.
 * Fixes the "713" -> 71-3 issue (now 7-13) and "14" -> 1-4 issue.
 *
 * WHAT: Parses "Home-Away" (hyphen) or "HomeAway" (concatenated) scores.
 * WHERE: Called by Parsers (Module 2).
 */
function splitScore(scoreStr) {
  try {
    // 1. Handle null/undefined/empty
    if (scoreStr === null || scoreStr === undefined) return [];
    const s = String(scoreStr).replace(/\s/g, ''); // Force to string & strip spaces
    if (s === '') return [];

    // 2. Case 1: Standard score (e.g., "102-100")
    if (s.includes('-')) {
      const parts = s.split('-');
      const home = parseInt(parts[0], 10);
      const away = parseInt(parts[1], 10);
      // Check for invalid parts like "100-" or "-90"
      if (isNaN(home) || isNaN(away)) return [];
      return [home, away];
    }

    // 3. Case 2: Concatenated score – must be numeric only
    if (!/^\d+$/.test(s)) return [];

    let homeScoreStr, awayScoreStr;
    
    switch (s.length) {
      case 6: // e.g., "102110" -> 102, 110
        homeScoreStr = s.substring(0, 3);
        awayScoreStr = s.substring(3);
        break;

      case 5: // e.g., "99110" -> 99, 110 OR "11099" -> 110, 99
        // Heuristic: If it starts with '1', '2', or '3', first score is likely 3 digits.
        if (['1', '2', '3'].includes(s[0])) {
          homeScoreStr = s.substring(0, 3);
          awayScoreStr = s.substring(3);
        } else {
          homeScoreStr = s.substring(0, 2);
          awayScoreStr = s.substring(2);
        }
        break;

      case 4: // e.g., "8090" -> 80, 90
        homeScoreStr = s.substring(0, 2);
        awayScoreStr = s.substring(2);
        break;

      // [CRITICAL FIX] Handle 3-digit scores (e.g. "713")
      case 3:
        // Try split 1-2 (e.g., 7-13) vs 2-1 (e.g., 71-3)
        const h1 = parseInt(s.substring(0, 1), 10);
        const a1 = parseInt(s.substring(1), 10);
        
        const h2 = parseInt(s.substring(0, 2), 10);
        const a2 = parseInt(s.substring(2), 10);

        // Heuristic: Quarter scores are rarely > 50 in NFL/Basketball quarters
        // If 2-1 split produces a huge number (71), and 1-2 produces normal numbers (7, 13), pick 1-2.
        if (h2 > 50 && h1 <= 50) {
           return [h1, a1];
        } 
        // Default to 2-1 if ambiguous, OR standard logic
        // But for "713", h2=71 (too high), h1=7. Return 7-13.
        return [h2, a2];

      // [CRITICAL FIX] Handle 2-digit scores (e.g. "70" -> 7-0, "14" -> 1-4)
      case 2:
        homeScoreStr = s.substring(0, 1);
        awayScoreStr = s.substring(1);
        break;

      default:
        return []; // Return empty to signal failure
    }

    const homeNum = parseInt(homeScoreStr, 10);
    const awayNum = parseInt(awayScoreStr, 10);

    if (isNaN(homeNum) || isNaN(awayNum)) return [];

    return [homeNum, awayNum];

  } catch (e) {
    return [];
  }
}

/**
 * WHY: SSoT for validating raw number strings before parsing.
 * WHAT: Checks if a string contains only digits and meets a minimum length.
 * HOW: It uses a regular expression /^\d+$/ to test for digits.
 * FIX: Forces input to String to prevent ".test" crashes.
 * WHERE: Used by parsers to identify score types.
 * @param {string|number} str The string to check.
 * @param {number} minLen The minimum required length.
 * @returns {boolean}
 */
function isNumericConcat(str, minLen = 1) {
  if (str === null || str === undefined) return false;
  const s = String(str).trim();
  return /^\d+$/.test(s) && s.length >= minLen;
}


/**
 * WHY: This is the SSoT helper for finding the winner of a single
 * period. Its logic is needed by the "Brain" (Module 3) to analyze
 * quarter-by-quarter performance.
 * WHAT: Checks a 'home-away' score string and returns who won.
 * HOW: It calls parseScore (from this module) to get [home, away]
 * numbers. It compares the numbers and returns 1 for a home win,
 * 2 for an away win, or 0 for a draw.
 * WHERE: Used by analyzeQuarterWinnerAccuracy in Module 3.
 * @param {string} scoreStr The score string (e.g., '32-21').
 * @returns {number} 1 (home win), 2 (away win), or 0 (draw/invalid).
 */
function getQuarterWinner(scoreStr) {
  const parsed = parseScore(scoreStr);
  if (!parsed) return 0; // Return 0 (draw/invalid) if parsing fails
  const [homeScore, awayScore] = parsed;
  if (homeScore > awayScore) return 1;
  if (awayScore > homeScore) return 2;
  return 0; // Draw
}

/**
 * ======================================================================
 * loadOptimizedTier2Config
 * ======================================================================
 * WHY: 
 *   Module 5 (getTunedConfig_) and Module 7 (getTunedThresholds) both need
 *   the optimized parameters that achieved 86.5% direction accuracy.
 *   This function is the SSoT for reading those values.
 *
 * WHAT:
 *   Reads CONFIG_KEY/VALUE pairs from Stats_Tier2_Optimization sheet
 *   and returns a configuration object with:
 *   - threshold: 3.5 (min margin for profitable bets)
 *   - decay: 0.8 (recency weight factor)
 *   - h2hBoost: 0.8 (head-to-head weighting)
 *   - momentumSwingFactor: 0.05
 *   - variancePenaltyFactor: 0.1
 *
 * HOW:
 *   1. Opens Stats_Tier2_Optimization sheet (case-insensitive)
 *   2. Scans rows for BestThreshold, BestDecay, etc.
 *   3. Returns merged config with sensible defaults
 *
 * WHERE:
 *   - Sheet: 'Stats_Tier2_Optimization'
 *   - Called by: getTunedConfig_() in Module 5, getTunedThresholds() in Module 7
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Active spreadsheet
 * @returns {Object} Configuration object with optimized parameters
 */
function loadOptimizedTier2Config(ss) {
  // WHY: Defaults match the 86.5% optimization result from your logs
  var defaults = {
    threshold: 3.5,
    decay: 0.8,
    h2hBoost: 0.8,
    momentumSwingFactor: 0.05,
    variancePenaltyFactor: 0.1
  };
  
  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    
    // WHERE: Read from Stats_Tier2_Optimization sheet
    var sheet = getSheetInsensitive(ss, 'Stats_Tier2_Optimization');
    if (!sheet) {
      Logger.log('[loadOptimizedTier2Config] No optimization sheet found, using 86.5% defaults');
      return defaults;
    }
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log('[loadOptimizedTier2Config] Optimization sheet empty, using defaults');
      return defaults;
    }
    
    // HOW: Scan for CONFIG_KEY / VALUE pairs in column A and B
    var config = {};
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][0] || '').trim();
      var val = data[i][1];
      
      // Skip empty or invalid rows
      if (val === '' || val === null || val === undefined) continue;
      
      // WHY: Map sheet keys to config properties
      switch (key) {
        case 'BestThreshold':
          config.threshold = parseFloat(val);
          break;
        case 'BestDecay':
          config.decay = parseFloat(val);
          break;
        case 'BestH2HBoost':
          config.h2hBoost = parseFloat(val);
          break;
        case 'BestMomentumFactor':
          config.momentumSwingFactor = parseFloat(val);
          break;
        case 'BestVarianceFactor':
          config.variancePenaltyFactor = parseFloat(val);
          break;
      }
    }
    
    // WHY: Merge with defaults to ensure no undefined values
    var result = {
      threshold: !isNaN(config.threshold) ? config.threshold : defaults.threshold,
      decay: !isNaN(config.decay) ? config.decay : defaults.decay,
      h2hBoost: !isNaN(config.h2hBoost) ? config.h2hBoost : defaults.h2hBoost,
      momentumSwingFactor: !isNaN(config.momentumSwingFactor) ? config.momentumSwingFactor : defaults.momentumSwingFactor,
      variancePenaltyFactor: !isNaN(config.variancePenaltyFactor) ? config.variancePenaltyFactor : defaults.variancePenaltyFactor
    };
    
    Logger.log('[loadOptimizedTier2Config] Loaded config: ' + JSON.stringify(result));
    return result;
    
  } catch (e) {
    Logger.log('[loadOptimizedTier2Config] Error: ' + e.message + ', using defaults');
    return defaults;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FUNCTION 2: loadTeamNamesFromStandings
// ═══════════════════════════════════════════════════════════════

/**
 * WHY: SSoT helper for loading team names from the Standings sheet.
 *
 * FIXES:
 *  1. Uses findStandingsSheet_ — matches "Standing", "Standings", or fuzzy.
 *  2. Uses findTeamColumnInStandings_ — skips "Group A" rows, finds "Team name".
 *  3. Heuristic fallback: picks the column with the most text values.
 *  4. Handles multiple groups (Group A, Group B) in the same sheet.
 *  5. Skips sub-header rows that reappear between groups.
 *
 * @param {Spreadsheet} ss
 * @returns {Set<string>} Set of clean team names.
 */
function loadTeamNamesFromStandings(ss) {
  const sheet = findStandingsSheet_(ss);
  if (!sheet) {
    Logger.log('loadTeamNamesFromStandings: No Standings sheet found.');
    return new Set();
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return new Set();

  const result = findTeamColumnInStandings_(data);
  if (!result) {
    Logger.log('loadTeamNamesFromStandings: Could not determine team name column.');
    return new Set();
  }

  const { headerRowIndex, teamNameIdx } = result;
  const teamNames = new Set();

  // Build a set of "header-like" words to skip if they reappear (multi-group sheets)
  const headerWords = new Set(['team', 'team name', 'position', 'rank', 'gp', 'w', 'l', 'pf', 'pa']);

  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    let rawVal = row[teamNameIdx];

    // Handle numbers in the team column (skip position numbers)
    if (typeof rawVal === 'number') continue;
    if (!rawVal || typeof rawVal !== 'string') continue;

    const name = cleanTeamName_(rawVal);

    // Skip empty, too-short, group labels, or repeated headers
    if (name.length <= 2) continue;
    if (headerWords.has(name.toLowerCase())) continue;
    if (/^group\s/i.test(name)) continue;
    if (/^conference\s/i.test(name)) continue;
    if (/^division\s/i.test(name)) continue;

    teamNames.add(name);
  }

  Logger.log(`loadTeamNamesFromStandings: Loaded ${teamNames.size} teams from "${sheet.getName()}"`);
  return teamNames;
}


// ═══════════════════════════════════════════════════════════════
//  FUNCTION 3: splitTeams
// ═══════════════════════════════════════════════════════════════

/**
 * WHY: Splits a concatenated "HomeAway" string into { home, away }.
 *
 * STRATEGY (priority order):
 *  1. "Gold Standard" — brute-force prefix match against Standings set.
 *     Sorted longest-first to prevent partial matches
 *     (e.g., "Maccabi" won't steal from "Maccabi Ramat Gan W").
 *  2. "Silver Standard" — brute-force suffix match (away team at end).
 *  3. "Bronze Standard" — CamelCase regex split at midpoint.
 *  4. Partial match — if only one team found in set, split there.
 *  5. Last resort — return full string as home, "Unknown" as away.
 *
 * @param {string} teamsStr  Concatenated team string.
 * @param {Set<string>} teamNamesSet  Team names from Standings.
 * @returns {{ home: string, away: string }}
 */
function splitTeams(teamsStr, teamNamesSet) {
  if (!teamsStr) return { home: '', away: '' };
  const s = String(teamsStr).trim();
  if (!s) return { home: '', away: '' };

  // ──── STEP 1: BRUTE FORCE AGAINST STANDINGS (Gold Standard) ────
  if (teamNamesSet && teamNamesSet.size > 0) {
    // Sort longest first → prevents "Hapoel" from stealing "Hapoel Jerusalem W"
    const sorted = [...teamNamesSet].sort((a, b) => b.length - a.length);

    // 1a. Try HOME prefix: each known team as the start of the string
    for (const team of sorted) {
      if (s.startsWith(team) && s.length > team.length) {
        const remainder = s.substring(team.length).trim();
        if (teamNamesSet.has(remainder)) {
          // BOTH halves are known teams — perfect split
          return { home: team, away: remainder };
        }
      }
    }

    // 1b. Try AWAY suffix: each known team as the end of the string
    for (const team of sorted) {
      if (s.endsWith(team) && s.length > team.length) {
        const prefix = s.substring(0, s.length - team.length).trim();
        if (teamNamesSet.has(prefix)) {
          return { home: prefix, away: team };
        }
      }
    }

    // 1c. PARTIAL match: one half is known, the other isn't
    //     (handles cases where one team is misspelled or missing from standings)
    for (const team of sorted) {
      if (s.startsWith(team) && s.length > team.length) {
        const remainder = s.substring(team.length).trim();
        if (remainder.length > 1) {
          return { home: team, away: remainder };
        }
      }
    }

    // 1d. PARTIAL suffix match
    for (const team of sorted) {
      if (s.endsWith(team) && s.length > team.length) {
        const prefix = s.substring(0, s.length - team.length).trim();
        if (prefix.length > 1) {
          return { home: prefix, away: team };
        }
      }
    }
  }

  // ──── STEP 2: CAMELCASE FALLBACK (Silver Standard) ────
  const splitRegex = /(?<=[a-z\d])(?=[A-Z])/g;
  const matches = [...s.matchAll(splitRegex)];

  if (matches.length > 0) {
    let bestSplitIndex;

    if (matches.length === 1) {
      bestSplitIndex = matches[0].index;
    } else {
      // Pick split closest to the middle
      const midPoint = s.length / 2;
      let minDistance = Infinity;
      for (const match of matches) {
        const distance = Math.abs(match.index - midPoint);
        if (distance < minDistance) {
          minDistance = distance;
          bestSplitIndex = match.index;
        }
      }
    }

    if (bestSplitIndex !== undefined) {
      const home = s.substring(0, bestSplitIndex).trim();
      const away = s.substring(bestSplitIndex).trim();

      // Validate: neither half should be trivially small
      if (home.length > 1 && away.length > 1) {
        return { home, away };
      }
    }
  }

  // ──── STEP 3: LAST RESORT ────
  return { home: s, away: 'Unknown' };
}

// ═══════════════════════════════════════════════════════════════
//  FUNCTION 4: loadTeamRankings
// ═══════════════════════════════════════════════════════════════

/**
 * WHY: Load team rankings from Standings for opponent strength adjustment.
 *
 * FIXES: Same robustness as loadTeamNamesFromStandings —
 *   findStandingsSheet_, findTeamColumnInStandings_, cleanTeamName_.
 *
 * @param {Spreadsheet} ss
 * @returns {Object} Map of teamName → { rank: number }
 */
function loadTeamRankings(ss) {
  const rankings = {};
  const sheet = findStandingsSheet_(ss);
  if (!sheet) return rankings;

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return rankings;

  const result = findTeamColumnInStandings_(data);
  if (!result) return rankings;

  const { headerRowIndex, teamNameIdx } = result;

  // Find position/rank column
  let positionIdx = -1;
  const headerRow = data[headerRowIndex];
  if (headerRow) {
    for (let j = 0; j < headerRow.length; j++) {
      const cell = String(headerRow[j] || '').trim().toLowerCase();
      if (cell === 'position' || cell === 'pos' || cell === 'rank' || cell === '#') {
        positionIdx = j;
        break;
      }
    }
  }

  // If no position column header found, assume column A if it has numbers
  if (positionIdx === -1) {
    const testRow = data[headerRowIndex + 1];
    if (testRow) {
      for (let j = 0; j < testRow.length; j++) {
        if (j === teamNameIdx) continue; // skip the team name column
        const val = testRow[j];
        if (typeof val === 'number' && val >= 1 && val <= 100) {
          positionIdx = j;
          break;
        }
      }
    }
  }

  const headerWords = new Set(['team', 'team name', 'position', 'rank', 'gp', 'w', 'l']);
  let autoRank = 0;

  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    const rawVal = row[teamNameIdx];
    if (typeof rawVal === 'number') continue;
    if (!rawVal || typeof rawVal !== 'string') continue;

    const name = cleanTeamName_(rawVal);
    if (name.length <= 2) continue;
    if (headerWords.has(name.toLowerCase())) continue;
    if (/^group\s/i.test(name)) continue;
    if (/^conference\s/i.test(name)) continue;

    autoRank++;
    let rank = autoRank;
    if (positionIdx !== -1) {
      const parsed = parseInt(row[positionIdx], 10);
      if (!isNaN(parsed) && parsed > 0) rank = parsed;
    }

    rankings[name] = { rank: rank };
  }

  Logger.log(`loadTeamRankings: Loaded ${Object.keys(rankings).length} rankings`);
  return rankings;
}

/**
 * WHY: This is the SSoT helper for parsing the "anchor" rows.
 * [UPGRADE]: Added regex support for NFL, NCAA, and other leagues.
 *
 * WHAT: Detects game type, league, teams, date, and time from a raw anchor string.
 * HOW:
 * 1. Finds 'League' prefix (NBA, NFL, PLI, etc.).
 * 2. Finds 'Game Type' (Final, Cup, etc.).
 * 3. Finds 'Date' using regex.
 * 4. Isolates 'teamsStr' and calls splitTeams().
 * WHERE: Called by parseFullGameSheet (Module 2).
 */
function detectGameType(rawLine, teamNamesSet) {
  if (!rawLine) return null;
  const line = String(rawLine).trim();

  let gameType = 'League';
  const gameTypeKeywords = {
    'Final': /final/i,
    'Semi-finals': /semi-finals/i,
    'Quarter-finals': /quarter-finals/i,
    '3rd place': /3rd place/i,
    '5th place': /5th place/i,
    '7th place': /7th place/i,
    'Cup': /cup/i,
    'Round': /round/i,
  };

  for (const type in gameTypeKeywords) {
    if (gameTypeKeywords[type].test(line)) {
      gameType = type;
      break;
    }
  }

  // [UPGRADE] Added NFL and NCAA to regex
  const leagueMatch = line.match(/^(NBA|NBB|ARW|PLI|USG|LNC|INC|NFL|NCAA)/i);
  const league = leagueMatch ? leagueMatch[0].toUpperCase() : 'UNKNOWN';

  // Sequentially strip known parts to isolate team names
  let remainder = line;
  if (leagueMatch) {
    remainder = remainder.substring(leagueMatch[0].length).trim();
  }
  if (gameType !== 'League') {
    remainder = remainder.replace(gameTypeKeywords[gameType], '').trim();
  }
  remainder = remainder.replace(/^-/, '').trim(); // Remove leading hyphen if present

  const dateRegex = /\d{1,2}[/.]\d{1,2}[/.]\d{4}/;
  const dateMatch = remainder.match(dateRegex);
  if (!dateMatch) return null;

  const teamsStr = remainder.substring(0, dateMatch.index).trim();
  if (!teamsStr) return null;

  const { home, away } = splitTeams(teamsStr, teamNamesSet);
  if (!home || !away || away === 'Unknown') return null;

  const afterDate = remainder.substring(dateMatch.index + dateMatch[0].length).trim();
  const timeMatch = afterDate.match(/\d{1,2}:\d{2}/);
  const time = timeMatch ? timeMatch[0] : '';

  return {
    league: league,
    home: home,
    away: away,
    dateStr: dateMatch[0],
    time: time,
    gameType: gameType,
    raw: rawLine
  };
}


/**
 * WHY: Standardize date format to YYYY-MM-DD for consistency.
 * WHAT: Parses a DD.MM.YYYY or DD/MM/YYYY string.
 * HOW: Splits the string by '.' or '/' and rearranges the parts.
 * WHERE: Used by parsers to normalize dates.
 * @param {string} rawDateStr The raw date string.
 * @returns {string} The formatted YYYY-MM-DD string or original if format is unknown.
 */
function parseRawDate(rawDateStr) {
  if (!rawDateStr) return "";
  const s = String(rawDateStr).trim();
  const parts = s.split(/[./]/);
  if (parts.length === 3) {
    // Assume DD-MM-YYYY
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return s; // Return original if not in expected format
}

/**
 * [NEW] WHY: Helper to parse NFL records like "8-2-0" or "8-2".
 * WHAT: Converts a record string into an object {w, l, t}.
 * HOW: Splits by hyphen or dash, parses integers.
 */
function parseRecord(recordStr) {
  const parts = String(recordStr).split(/[-–]/); // Split by hyphen
  const w = parseInt(parts[0]) || 0;
  const l = parseInt(parts[1]) || 0;
  const t = parseInt(parts[2]) || 0;
  return { w, l, t };
}

/**
 * WHY: This is the SSoT helper for loading the "Brain's" main
 * statistical output (from Module 3). Its logic is to load the
 * 'Stats' sheet into a structured object for the "Forecaster" (Module 4).
 * WHAT: Loads the high-level stats from the 'Stats' sheet.
 * HOW: It reads the 'Stats' sheet. It loops through the rows,
 * looking for specific headers (like "League" or "Probability Range")
 * to find the data blocks, then parses that data into a nested object.
 * WHERE: Called by analyzeTier1 in Module 4.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The 'Stats' sheet object.
 * @returns {Object} A nested object of stats.
 */
function loadStatsFromSheet(sheet) {
  const res = {
    league: {},
    probRange: {}
  };
  if (!sheet) return res;

  try {
    const values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return res;

    // This parser assumes a specific but common layout in the Stats sheet
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const firstCol = row[0] ? String(row[0]).trim() : '';
      if (!firstCol) continue;

      // Check if it's a probability range (e.g., "70-80%")
      if (firstCol.match(/^\d{1,2}-\d{1,2}%$/)) {
        res.probRange[firstCol] = {
          accuracy: row[3] || 'N/A',
          raw: row
        };
      }
      // Check if it's a league accuracy row (heuristic: second column has a %)
      else if (String(row[1]).includes('%')) {
        res.league[firstCol] = {
          winnerAccuracy: String(row[1]),
          raw: row
        };
      }
    }
  } catch (e) {
    Logger.log('loadStatsFromSheet Error: ' + e.message);
  }
  return res;
}

/**
 * WHY: This is the SSoT helper for loading the "Brain's" quarter
 * stats. Its logic is to load the 'LeagueQuarterStats' sheet into
 * a fast, nested lookup object for the "Forecaster" (Module 4).
 * WHAT: Loads quarter-specific winner stats.
 * HOW: It reads the 'LeagueQuarterStats' sheet. It loops (starting
 * at row 1) and uses the 'League' (col 0) and 'Quarter' (col 1)
 * as keys to build a nested object (e.g., out['NBA']['Q1'] = ...).
 * WHERE: Called by analyzeTier1 in Module 4.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The 'LeagueQuarterStats' sheet.
 * @returns {Object} A nested object of quarter stats.
 */
function loadQuarterWinnerStats(sheet) {
  const out = {};
  if (!sheet) return out;
  try {
    const data = sheet.getDataRange().getValues();
    // Start from 1 to skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const league = row[0] ? String(row[0]).trim() : '';
      const qKey = row[1] ? String(row[1]).trim() : '';

      if (league && qKey) {
        out[league] = out[league] || {};
        out[league][qKey] = {
          total: parseInt(row[2], 10) || 0,
          accuracy: row[3] || 'N/A',
          drawRate: row[4] || 'N/A',
          highestPct: row[5] || 'N/A'
        };
      }
    }
  } catch (e) {
    Logger.log('loadQuarterWinnerStats Error: ' + e.message);
  }
  return out;
}


/**
 * WHY: This is the SSoT helper for loading the "Brain's" quarter
 * O/U stats. Its logic is to load the 'LeagueQuarterO_U_Stats' sheet
 * into a fast, nested lookup object.
 * WHAT: Loads quarter-specific Over/Under (O/U) stats.
 * HOW: It reads the 'LeagueQuarterO_U_Stats' sheet. It loops
 * (starting at row 1) and uses the 'League' (col 0) and 'Quarter'
 * (col 1) as keys to build a nested object.
 * WHERE: Called by analyzeTier1 in Module 4.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The 'LeagueQuarterO_U_Stats' sheet.
 * @returns {Object} A nested object of O/U stats.
 */
function loadQuarterOUStats(sheet) {
  const out = {};
  if (!sheet) return out;
  try {
    const data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) return out;

    // ── Header normalization helpers ──
    function normHead_(s) {
      return String(s || '')
        .toLowerCase()
        .trim()
        .replace(/\u00A0/g, ' ')
        .replace(/[%]/g, ' pct ')
        .replace(/[()]/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function headerMap_(row) {
      var hm = {};
      for (var c = 0; c < row.length; c++) {
        var key = normHead_(row[c]);
        if (!key) continue;
        if (hm[key] === undefined) hm[key] = c;
      }
      return hm;
    }

    function findCol_(hm, names) {
      for (var i = 0; i < names.length; i++) {
        var k = normHead_(names[i]);
        if (hm[k] !== undefined) return hm[k];
      }
      return undefined;
    }

    function toNum_(v, fallback) {
      var s = String(v || '').trim().replace(/%/g, '');
      if (!s) return fallback;
      var n = Number(s);
      return isFinite(n) ? n : fallback;
    }

    // ── Detect whether long or wide format ──
    // Check if row[1] of the first data row looks like a quarter key (Q1–Q4)
    var firstDataRow = data[1];
    var col1Val = String(firstDataRow[1] || '').trim().toUpperCase();
    var isLongFormat = /^Q[1-4]$/.test(col1Val);

    if (isLongFormat) {
      // ── Original long-format parsing ──
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const league = row[0] ? String(row[0]).trim() : '';
        const qKey = row[1] ? String(row[1]).trim() : '';

        if (league && qKey) {
          out[league] = out[league] || {};
          out[league][qKey] = {
            count: parseInt(row[2], 10) || 0,
            mean: parseFloat(row[3]) || 0,
            overPct: row[4] || 'N/A',
            underPct: row[5] || 'N/A',
            sd: parseFloat(row[7]) || 0,
            safeLower: row[8] || 'N/A',
            safeUpper: row[9] || 'N/A'
          };
        }
      }
    } else {
      // ── Wide-format parsing ──
      var hm = headerMap_(data[0]);
      var cLeague = findCol_(hm, ['league', 'competition', 'comp']);
      if (cLeague === undefined) cLeague = 0; // fallback to first column

      var wideQuarters = ['Q1', 'Q2', 'Q3', 'Q4'];
      var wideCols = {};
      var anyWideFound = false;

      for (var qi = 0; qi < wideQuarters.length; qi++) {
        var qLabel = wideQuarters[qi];
        var ql = qLabel.toLowerCase();
        var qEntry = {
          mean:      findCol_(hm, [ql + ' mean', ql + 'mean', ql + '_mean', ql + ' avg', ql + ' average', ql + ' mean actual']),
          sd:        findCol_(hm, [ql + ' sd', ql + 'sd', ql + '_sd', ql + ' stddev', ql + ' stdev']),
          overPct:   findCol_(hm, [ql + ' over pct', ql + ' over', ql + 'over', ql + '_over']),
          underPct:  findCol_(hm, [ql + ' under pct', ql + ' under', ql + 'under', ql + '_under']),
          count:     findCol_(hm, [ql + ' count', ql + ' games', ql + ' n', ql + 'count', ql + '_count', ql + ' total']),
          safeLower: findCol_(hm, [ql + ' safe lower', ql + ' safelower', ql + '_safe_lower', ql + ' lower']),
          safeUpper: findCol_(hm, [ql + ' safe upper', ql + ' safeupper', ql + '_safe_upper', ql + ' upper'])
        };
        if (qEntry.mean !== undefined || qEntry.sd !== undefined) {
          anyWideFound = true;
        }
        wideCols[qLabel] = qEntry;
      }

      // Shared games/count column (not per-quarter)
      var cGamesShared = findCol_(hm, ['games', 'count', 'n', 'total']);

      if (!anyWideFound) {
        // Neither long nor wide detected — fall back to original long-format attempt
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const league = row[0] ? String(row[0]).trim() : '';
          const qKey = row[1] ? String(row[1]).trim() : '';

          if (league && qKey) {
            out[league] = out[league] || {};
            out[league][qKey] = {
              count: parseInt(row[2], 10) || 0,
              mean: parseFloat(row[3]) || 0,
              overPct: row[4] || 'N/A',
              underPct: row[5] || 'N/A',
              sd: parseFloat(row[7]) || 0,
              safeLower: row[8] || 'N/A',
              safeUpper: row[9] || 'N/A'
            };
          }
        }
      } else {
        // Parse wide-format rows
        for (var rw = 1; rw < data.length; rw++) {
          var row = data[rw];
          var league = String(row[cLeague] || '').trim();
          if (!league) continue;

          out[league] = out[league] || {};

          for (var qj = 0; qj < wideQuarters.length; qj++) {
            var qk = wideQuarters[qj];
            var wc = wideCols[qk];
            if (wc.mean === undefined && wc.sd === undefined) continue;

            var qCount = wc.count !== undefined ? toNum_(row[wc.count], 0) : (cGamesShared !== undefined ? toNum_(row[cGamesShared], 0) : 0);

            out[league][qk] = {
              count:     parseInt(qCount, 10) || 0,
              mean:      wc.mean      !== undefined ? toNum_(row[wc.mean], 0) : 0,
              overPct:   wc.overPct   !== undefined ? (row[wc.overPct] || 'N/A') : 'N/A',
              underPct:  wc.underPct  !== undefined ? (row[wc.underPct] || 'N/A') : 'N/A',
              sd:        wc.sd        !== undefined ? toNum_(row[wc.sd], 0) : 0,
              safeLower: wc.safeLower !== undefined ? (row[wc.safeLower] || 'N/A') : 'N/A',
              safeUpper: wc.safeUpper !== undefined ? (row[wc.safeUpper] || 'N/A') : 'N/A'
            };
          }
        }
        Logger.log('loadQuarterOUStats: Wide-format parsed ' + Object.keys(out).length + ' leagues');
      }
    }
  } catch (e) {
    Logger.log('loadQuarterOUStats Error: ' + e.message);
  }
  return out;
}

/**
 * WHY: This is the SSoT helper for loading the Tier 2 team-specific
 * stats. [FIXED]
 * Its logic is to load the 'TeamQuarterStats_Tier2' sheet
 * into a fast, nested lookup object for the Tier 2 predictor.
 * WHAT: Loads the team-specific quarter stats (from Module 5's output).
 * HOW: It reads the 'TeamQuarterStats_Tier2' sheet.
 * It loops (starting at row 1) and uses the 'Team' (col 0) and 'Quarter'
 * (col 1) as keys to build a nested object.
 * [CRITICAL FIX] This function is now aligned with the 6 columns
 * written by `analyzeTier2Stats` in Module 5. It correctly loads
 * the 'accuracy' property from the 'Win %' column (Col F, row[5])
 * instead of the 'L' column (Col D, row[3]).
 * WHERE: Called by predictQuarters_Tier2 in Module 5.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The 'TeamQuarterStats_Tier2' sheet.
 * @returns {Object} A nested object of team stats.
 */
function loadTeamQuarterStats(sheet) {
  const out = {};
  if (!sheet) return out;
  try {
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return out;

    // Start from 1 to skip header row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const teamName = row[0] ? String(row[0]).trim() : '';
      const quarter = row[1] ? String(row[1]).trim() : '';
      if (teamName && quarter) {
        if (!out[teamName]) out[teamName] = {};

        // [FIX] This object now correctly maps the 6 columns
        // from analyzeTier2Stats
        out[teamName][quarter] = {
          W: parseInt(row[2], 10) || 0, // 'W' (Col C)
          L: parseInt(row[3], 10) || 0, // 'L' (Col D)
          Total: parseInt(row[4], 10) || 0, // 'Total' (Col E)
          'Win %': row[5] || '0.0', // 'Win %' (Col F)

          // [CRITICAL FIX] This is the property Module 5
          // actually requests . It must be loaded
          // from row[5] ('Win %') not row[3] ('L').
          accuracy: parseFloat(row[5]) || 0
        };
      }
    }
  } catch (e) {
    Logger.log('loadTeamQuarterStats Error: ' + e.message);
  }
  return out;
}



/**
 * Helper function to prevent division by zero errors.
 * @param {number} numerator The numerator.
 * @param {number} denominator The denominator.
 * @return {number} The result of the division, or 0 if denominator is 0.
 */
function safeDivide(numerator, denominator) {
  if (denominator === 0 || denominator === null || isNaN(denominator)) {
    return 0;
  }
  return numerator / denominator;
}

/**
 * Applies formatting to the Tier 2 aggregate analysis sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet to format.
 */
function applyTier2AggregateFormatting(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow <= 1 || lastCol === 0) {
    // Logger.log('Skipping formatting for empty sheet.');
    return;
  }

  // Bold and freeze header row
  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f3f3f3');
  sheet.setFrozenRows(1);

  // Center headers
  headerRange.setHorizontalAlignment('center');

  // Format the Win % column (Column E) as a percentage
  if (lastRow > 1) {
    const winPctColumn = sheet.getRange(2, 5, lastRow - 1, 1);
    winPctColumn.setNumberFormat('0.0%');
  }

  // Auto-resize all columns
  for (let i = 1; i <= lastCol; i++) {
    sheet.autoResizeColumn(i);
  }

  // Apply alternating row colors
  if (lastRow > 1) {
    const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    dataRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false);
  }

  // Logger.log(`Formatting applied to ${sheet.getName()}.`);
}

/**
 * ======================================================================
 * [REVISED FUNCTION] - AUTOMATIC ARCHIVER
 * ======================================================================
 * WHY: To automate the "feedback loop" for Tier 2 accuracy tracking.
 * Its logic is to watch for games being marked "FT" (Full Time) in the
 * 'UpcomingClean' sheet and automatically move them to 'ResultsClean'.
 *
 * WHAT: An onEdit(e) simple trigger that moves a row on a status change.
 *
 * HOW:
 * 1. It runs automatically when any cell is edited.
 * 2. It checks if the edit was on the "UpcomingClean" sheet.
 * 3. It gets the sheet's headers to find the "Status" column.
 * 4. [FIX] It gets the TOTAL number of columns from the header row's
 * length, not from the unreliable getLastColumn() method.
 * 5. It checks if the edited cell was in the "Status" column AND
 * if the new value is "FT".
 * 6. If all conditions are met:
 * a. It gets the target 'ResultsClean' sheet.
 * b. It copies the entire row (using the correct column count)
 * and appends it to 'ResultsClean'.
 * c. It deletes the original row from 'UpcomingClean'.
 *
 * WHERE: This function MUST live in Module 1 to access the helper
 * functions (createHeaderMap, getSheetInsensitive).
 *
 * @param {Object} e The event object passed by the onEdit trigger.
 */
function onEdit(e) {
  try {
    const sourceSheetName = "UpcomingClean";
    const targetSheetName = "ResultsClean";
    const triggerValue = "FT";
    const triggerColumnName = "status";

    const range = e.range;
    const sheet = range.getSheet();
    const editedRow = range.getRow();

    // 1. Check if the edit was on the correct sheet
    if (sheet.getName().toLowerCase() !== sourceSheetName.toLowerCase()) {
      return;
    }

    // 2. Get headers to find the trigger column
    // [FIX] Get the full header row to determine the *exact* number of columns.
    const headerRange = sheet.getRange(1, 1, 1, sheet.getMaxColumns());
    const headerRow = headerRange.getValues()[0];
    const map = createHeaderMap(headerRow);
    const statusColIndex = map[triggerColumnName]; // 0-based index

    // [FIX] Find the last *actual* column with a header.
    // This is more robust than getLastColumn().
    let numCols = headerRow.lastIndexOf('') + 1;
    if (numCols === 0) numCols = headerRow.length;

    // Check if the map was created and the column was found
    if (statusColIndex === undefined) {
      Logger.log('onEdit: Could not find "Status" column in ' + sourceSheetName);
      return;
    }

    const editedCol = range.getColumn();
    // Use getValue() for edited cell to handle all data types
    const newValue = String(range.getValue()).trim().toUpperCase();

    // 3. Check if the correct cell was edited with the correct value
    // (statusColIndex is 0-based, editedCol is 1-based)
    if (editedCol === (statusColIndex + 1) && newValue === triggerValue) {

      // 4. Get Target Sheet
      const ss = e.source;
      const targetSheet = getSheetInsensitive(ss, targetSheetName);

      if (!targetSheet) {
        Logger.log('onEdit: Target sheet "' + targetSheetName + '" not found.');
        return;
      }

      // 5. Get the full row to move
      // [FIX] Use our robust 'numCols' variable instead of getLastColumn()
      const rowData = sheet.getRange(editedRow, 1, 1, numCols).getValues();

      // 6. Append row to target sheet
      targetSheet.appendRow(rowData[0]);

      // 7. Delete row from source sheet
      sheet.deleteRow(editedRow);

      Logger.log('onEdit: Moved row ' + editedRow + ' from ' + sourceSheetName + ' to ' + targetSheetName + '.');
    }

  } catch (err) {
    Logger.log('onEdit Error: ' + err.message + ' Stack: ' + err.stack);
  }
}

/**
 * ======================================================================
 * UNIVERSAL COMBAT SPORTS UPGRADE — 2025 EDITION
 * PROJECT: Ma Golide
 * MODULE: 1/6 — Helpers.gs (The Toolbox)
 * 
 * WHY WE ARE ADDING THIS:
 *   - To make Ma Golide universal (NBA + NFL + Volleyball) with ZERO risk.
 *   - This section allows the script to "know" what sport it is playing
 *     simply by the file name.
 * 
 * WHAT THIS DOES:
 *   - Adds SportConfig loader.
 *   - Adds sport detection via file name (your rule).
 *   - Adds universal match winner logic (points OR sets).
 *   - Adds "was this period played?" check (critical for volleyball).
 * 
 * WHERE:
 *   - Called by all Modules.
 * ======================================================================
 */

const SPORT_CONFIG_SHEET_NAME = 'SportConfig';
let CACHED_SPORT_CONFIGS = null;

/**
 * WHY: Load all sport rules once and cache them.
 * WHAT: Returns object with NBA, NFL, VLB configs.
 * HOW: Reads hidden SportConfig sheet → builds JS object.
 */
function loadAllSportConfigs() {
  if (CACHED_SPORT_CONFIGS) return CACHED_SPORT_CONFIGS;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SPORT_CONFIG_SHEET_NAME);
  
  if (!sheet) {
    // Logger.log('SportConfig sheet missing — using NBA defaults');
    CACHED_SPORT_CONFIGS = {
      NBA: { sport:'NBA', maxPeriods:4, minPeriods:4, scoringMode:'points', drawPossible:false, thresholds:[null,72,70,70,72,80] }
    };
    return CACHED_SPORT_CONFIGS;
  }

  const data = sheet.getDataRange().getValues();
  const configs = {};

  // Start from row 2 (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    configs[row[0]] = {
      sport: row[0],
      maxPeriods: Number(row[1]),
      minPeriods: Number(row[2]),
      scoringMode: row[3].trim(),
      drawPossible: row[4] === 'Yes',
      thresholds: row.slice(5,10).map(n => n ? Number(n) : null)
    };
  }

  CACHED_SPORT_CONFIGS = configs;
  return configs;
}

/**
 * WHY: You said "I'll just name the files" — this respects that 100%.
 * WHAT: Returns 'NBA', 'NFL', or 'VLB'.
 * HOW: Looks at file name only — no header scanning, no guessing.
 */
function detectCurrentSport() {
  const fileName = SpreadsheetApp.getActiveSpreadsheet().getName().toUpperCase();
  
  if (fileName.includes('NFL'))     return 'NFL';
  if (fileName.includes('VLB') || fileName.includes('VOLLEY')) return 'VLB';
  
  return 'NBA'; // default
}

/**
 * WHY: Single entry point for all modules to get current sport rules.
 * WHAT: Returns config object for current file.
 * HOW: detectCurrentSport() + loadAllSportConfigs().
 */
function getSportConfig() {
  const all = loadAllSportConfigs();
  const key = detectCurrentSport();
  const config = all[key] || all.NBA;
  return config;
}

/**
 * WHY: Volleyball sets 4 & 5 are often blank — must not count as 0-0.
 * WHAT: Returns true if period was actually played.
 * HOW: For periods > minPeriods, checks if both scores exist.
 */
function isPeriodPlayed(row, periodIndex) {
  const config = getSportConfig();
  if (periodIndex > config.maxPeriods) return false;
  if (periodIndex <= config.minPeriods) return true;

  const hKeys = [`P${periodIndex}_H`, `Q${periodIndex}_H`, `Set ${periodIndex}_H`, `Set${periodIndex}_H`];
  const aKeys = [`P${periodIndex}_A`, `Q${periodIndex}_A`, `Set ${periodIndex}_A`, `Set${periodIndex}_A`];
  
  let hScore = null, aScore = null;
  for (const k of hKeys) if (row[k] !== undefined && row[k] !== '' && row[k] !== null) { hScore = row[k]; break; }
  for (const k of aKeys) if (row[k] !== undefined && row[k] !== '' && row[k] !== null) { aScore = row[k]; break; }
  
  return hScore !== null && aScore !== null;
}

/**
 * WHY: NBA/NFL win by total points — Volleyball wins by sets won.
 * WHAT: Universal winner decider — returns 'H', 'A', 'D', or 'ERROR'.
 * HOW: Uses config.scoringMode to choose logic.
 */
function calculateMatchWinner(homeScoresArray, awayScoresArray) {
  const config = getSportConfig();

  if (config.scoringMode === 'points') {
    const homeTotal = homeScoresArray.reduce((sum, s) => sum + (s || 0), 0);
    const awayTotal = awayScoresArray.reduce((sum, s) => sum + (s || 0), 0);
    
    if (homeTotal > awayTotal) return 'H';
    if (awayTotal > homeTotal) return 'A';
    return config.drawPossible ? 'D' : 'ERROR';
  }

  // sets mode (volleyball)
  let homeSets = 0, awaySets = 0;
  for (let i = 0; i < config.maxPeriods; i++) {
    const h = homeScoresArray[i];
    const a = awayScoresArray[i];
    if (h === null || a === null) continue; // not played
    if (h > a) homeSets++;
    else if (a > h) awaySets++;
  }

  if (homeSets >= config.minPeriods) return 'H';
  if (awaySets >= config.minPeriods) return 'A';
  return 'ERROR';
}


// ═══════════════════════════════════════════════════════════════
//  FUNCTION 1: loadTeamNameMap
// ═══════════════════════════════════════════════════════════════

/**
 * INTERNAL HELPER: Finds the Standings sheet with flexible name matching.
 * Tries: "Standings", "Standing", or any sheet containing "standing".
 */
function findStandingsSheet_(ss) {
  // Try exact names first (case-insensitive)
  let sheet = getSheetInsensitive(ss, 'Standings');
  if (sheet) return sheet;

  sheet = getSheetInsensitive(ss, 'Standing');
  if (sheet) return sheet;

  // Fuzzy fallback: any sheet whose name contains "standing"
  const allSheets = ss.getSheets();
  for (const s of allSheets) {
    if (s.getName().toLowerCase().includes('standing')) {
      Logger.log(`findStandingsSheet_: Fuzzy matched sheet "${s.getName()}"`);
      return s;
    }
  }

  return null;
}

/**
 * INTERNAL HELPER: Finds the header row and team-name column index.
 * Skips group headers like "Group A", "Conference X", etc.
 * Returns { headerRowIndex, teamNameIdx } or null if not found.
 */
function findTeamColumnInStandings_(data) {
  // Scan first 15 rows for a header containing "team"
  const scanLimit = Math.min(data.length, 15);

  for (let i = 0; i < scanLimit; i++) {
    const row = data[i];
    if (!row) continue;

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').trim().toLowerCase();
      // Exact matches — prioritize "team name", fall back to "team"
      if (cell === 'team name') {
        return { headerRowIndex: i, teamNameIdx: j };
      }
    }

    // Second pass: accept bare "team" (but NOT "team" as part of another word 
    // in a group label like "Group A")
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').trim().toLowerCase();
      if (cell === 'team') {
        return { headerRowIndex: i, teamNameIdx: j };
      }
    }
  }

  // HEURISTIC FALLBACK: No header found.
  // Detect which column holds long text strings (team names) vs numbers.
  // Check rows 1–5 and pick the column with the most string values > 2 chars.
  let bestCol = -1;
  let bestCount = 0;

  for (let j = 0; j < (data[0] || []).length; j++) {
    let textCount = 0;
    for (let i = 1; i < Math.min(data.length, 6); i++) {
      const val = data[i] && data[i][j];
      if (val && typeof val === 'string' && val.trim().length > 2 && isNaN(val)) {
        textCount++;
      }
    }
    if (textCount > bestCount) {
      bestCount = textCount;
      bestCol = j;
    }
  }

  if (bestCol !== -1 && bestCount >= 2) {
    Logger.log(`findTeamColumnInStandings_: No header found. Using column ${bestCol} (heuristic)`);
    return { headerRowIndex: 0, teamNameIdx: bestCol };
  }

  return null;
}

/**
 * Cleans a raw team name string from Standings.
 * Removes rank prefixes ("1. "), duplicate suffixes ("(2)"), and trims.
 */
function cleanTeamName_(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let name = raw.trim();
  name = name.replace(/^\d+\.\s*/, '');   // "1. Eagles" → "Eagles"
  name = name.replace(/\s*\(\d+\)$/, ''); // "Eagles (2)" → "Eagles"
  return name;
}

/**
 * Loads team names from "Standings" into a lookup map { teamName: true }.
 * Used by Tier 2 parsers to detect which two teams are concatenated.
 *
 * FIX: Now delegates to loadTeamNamesFromStandings (SSoT) instead of
 *      hardcoding column A (which holds Position numbers, not names).
 */
function loadTeamNameMap(ss) {
  const teamSet = loadTeamNamesFromStandings(ss);
  const teamMap = {};
  for (const name of teamSet) {
    teamMap[name] = true;
  }
  Logger.log(`loadTeamNameMap: Loaded ${Object.keys(teamMap).length} teams from Standings`);
  return teamMap;
}

// ======================================================================
// MARGIN PREDICTION UPGRADE – 2025 ELITE EDITION
// ======================================================================

let TIER2_MARGIN_CACHE = null;



/**
 * Load Tier 2 margin stats from clean sheets
 * 
 * STRUCTURE: marginStats[team][venue][quarter] = {
 *   avgMargin, avgTotal, samples, rawMargins, stdDev
 * }
 * 
 * ALWAYS initializes Q1-Q4 with 0 values if no data (fixes CONTRACTS FAIL)
 * 
 * @param {Spreadsheet|Sheet|null} ss - Spreadsheet context
 * @returns {Object} Margin stats object
 */
/**
 * Load Tier 2 margin stats from clean sheets
 *
 * STRUCTURE:
 * marginStats[canonicalTeam][venue][quarter] = {
 *   avgMargin, avgTotal, samples, rawMargins, stdDev
 * }
 *
 * ✅ Canonical team keys (lowercase)
 * ✅ Numeric-safe (no NaN cascades)
 * ✅ Contract-safe (always initializes Q1–Q4)
 */
function loadTier2MarginStats(ss) {
  ss = _ensureSpreadsheet_(ss);

  if (TIER2_MARGIN_STATS_CACHE !== null) {
    Logger.log(
      'loadTier2MarginStats: Using cache (' +
      Object.keys(TIER2_MARGIN_STATS_CACHE).length + ' teams)'
    );
    return TIER2_MARGIN_STATS_CACHE;
  }

  Logger.log('loadTier2MarginStats: Building margin stats from Tier 2 clean sheets...');

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  function canonicalTeamKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function stdDev(arr) {
    if (!arr || arr.length < 2) return NaN;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v =
      arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
      (arr.length - 1);
    return Math.sqrt(v);
  }

  function initTeam() {
    const blankQ = () => ({
      sumMargin: 0,
      sumTotal: 0,
      count: 0,
      margins: []
    });
    return {
      Home: { Q1: blankQ(), Q2: blankQ(), Q3: blankQ(), Q4: blankQ() },
      Away: { Q1: blankQ(), Q2: blankQ(), Q3: blankQ(), Q4: blankQ() }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Load data
  // ─────────────────────────────────────────────────────────────

  const marginData = {};
  let games = 0;
  let sheetsUsed = 0;

  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (!/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i.test(name)) return;

    const values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return;

    const headers = _createHeaderMap_(values[0]);
    if (
      headers.home === undefined ||
      headers.away === undefined ||
      headers.q1h === undefined
    ) {
      return;
    }

    sheetsUsed++;

    for (let r = 1; r < values.length; r++) {
      const row = values[r];

      const homeRaw = row[headers.home];
      const awayRaw = row[headers.away];
      if (!homeRaw || !awayRaw) continue;

      const home = canonicalTeamKey(homeRaw);
      const away = canonicalTeamKey(awayRaw);

      if (!marginData[home]) marginData[home] = initTeam();
      if (!marginData[away]) marginData[away] = initTeam();

      const quarters = [
        ['Q1', headers.q1h, headers.q1a],
        ['Q2', headers.q2h, headers.q2a],
        ['Q3', headers.q3h, headers.q3a],
        ['Q4', headers.q4h, headers.q4a]
      ];

      let valid = 0;

      quarters.forEach(([Q, hCol, aCol]) => {
        if (hCol === undefined || aCol === undefined) return;

        const h = toNum(row[hCol]);
        const a = toNum(row[aCol]);
        if (!Number.isFinite(h) || !Number.isFinite(a)) return;
        if (h < 0 || a < 0 || h > 80 || a > 80) return;

        const margin = h - a;
        const total = h + a;

        const hNode = marginData[home].Home[Q];
        const aNode = marginData[away].Away[Q];

        hNode.sumMargin += margin;
        hNode.sumTotal += total;
        hNode.count++;
        hNode.margins.push(margin);

        aNode.sumMargin += -margin;
        aNode.sumTotal += total;
        aNode.count++;
        aNode.margins.push(-margin);

        valid++;
      });

      if (valid > 0) games++;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Finalize stats (NO NaN)
  // ─────────────────────────────────────────────────────────────

  const finalStats = {};

  Object.keys(marginData).forEach(team => {
    finalStats[team] = { Home: {}, Away: {} };

    ['Home', 'Away'].forEach(venue => {
      ['Q1', 'Q2', 'Q3', 'Q4'].forEach(Q => {
        const d = marginData[team][venue][Q];
        const samples = d.count;

        finalStats[team][venue][Q] = {
          avgMargin: samples ? d.sumMargin / samples : 0,
          avgTotal: samples ? d.sumTotal / samples : 0,
          samples: samples,
          rawMargins: d.margins.slice(),
          stdDev: stdDev(d.margins)
        };
      });
    });
  });

  TIER2_MARGIN_STATS_CACHE = finalStats;

  Logger.log(
    'loadTier2MarginStats: Complete. ' +
    sheetsUsed + ' sheets, ' +
    games + ' games, ' +
    Object.keys(finalStats).length + ' teams.'
  );

  return finalStats;
}

/**
 * Initialize team margin structure with all quarters
 * Ensures Q1-Q4 always exist with required fields
 */
function _initTeamMarginStructure_() {
  var structure = {
    Home: {},
    Away: {}
  };
  
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var venues = ['Home', 'Away'];
  
  for (var v = 0; v < venues.length; v++) {
    for (var q = 0; q < quarters.length; q++) {
      structure[venues[v]][quarters[q]] = {
        sum: 0,
        totalSum: 0,
        count: 0,
        margins: []
      };
    }
  }
  
  return structure;
}

/**
 * Clear margin stats cache
 */
function clearTier2MarginStatsCache() {
  TIER2_MARGIN_STATS_CACHE = null;
  _safeToast_(null, 'Margin stats cache cleared', 'Ma Golide', 3);
  Logger.log('Tier2 margin stats cache cleared');
}

/**
 * Clears the Tier 2 margin cache to force recalculation.
 */
function clearMarginCache() {
  TIER2_MARGIN_CACHE = null;
  Logger.log('Margin cache cleared');
}

/**
 * Rounds a number to the nearest half (0.5).
 * @param {number} n The number to round.
 * @returns {number} The rounded number.
 */
function roundToHalf(n) {
  return Math.round(n * 2) / 2;
}

/**
 * Formats a margin prediction for display.
 * @param {number} margin The predicted margin.
 * @param {number} samples The number of samples used for the prediction.
 * @returns {string} Formatted margin string (e.g., "H +3.5", "A +2", "EVEN", "N/A").
 */
function formatMarginPrediction(margin, samples) {
  samples = samples || 0;
  if (samples < 2) return 'N/A';                // only 2+ games needed
  if (Math.abs(margin) < 0.35) return 'EVEN';   // 0.35pt edge is real in NBA
  const sign = margin > 0 ? 'H' : 'A';
  const abs = roundToHalf(Math.abs(margin));
  return sign + ' +' + abs;
}

/**
 * Determines confidence level for a margin prediction.
 * @param {number} samples Number of data samples.
 * @param {number} totalStdDev Standard deviation (currently unused but kept for future use).
 * @param {number} margin The predicted margin.
 * @returns {string} Confidence level: 'strong', 'med', 'weak', or 'na'.
 */
function getMarginConfidence(samples, totalStdDev, margin) {
  if (samples < 2) return 'na';
  const strength = Math.abs(margin);
  if (samples >= 10 && strength >= 3.0) return 'strong';
  if (samples >= 6  && strength >= 2.0) return 'strong';
  if (samples >= 4  && strength >= 1.2) return 'med';
  if (samples >= 2  && strength >= 0.6) return 'med';
  return 'weak';  // still color it, just lighter
}

/**
 * WHY: Standardizes time formatting across all sheets
 * WHAT: Converts any time value to readable HH:mm format
 * HOW: Handles Date objects, serial numbers, strings
 * WHERE: Called by parsers before writing to Clean sheets
 */
function formatGameTime(rawTime) {
  if (!rawTime && rawTime !== 0) return 'TBD';
  if (rawTime instanceof Date) {
    return Utilities.formatDate(rawTime, Session.getScriptTimeZone(), 'HH:mm');
  }
  if (typeof rawTime === 'number' && rawTime < 1) {
    // It's a time-only serial (fraction of day)
    const hours = Math.floor(rawTime * 24);
    const mins = Math.round((rawTime * 24 - hours) * 60);
    return `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
  }
  return String(rawTime).trim() || 'TBD';
}

/**
 * ======================================================================
 * PHASE 2 CANONICAL UPGRADE: V12 PHYSICS ENGINE
 * AUTHORIZED BY: Presidential Decree, Session #7
 * SYNTHESIZED BY: GPT-5.1 (The Architect)
 * DATE: November 26, 2025
 * ======================================================================
 */

/**
 * WHY: To quantify if a team is on a "hot streak" or "cold slump."
 * WHAT: Calculates a weighted momentum score from recent game margins.
 * HOW: Iterates through recent games, applying exponential decay so newest games matter most.
 *      Positive margins add to momentum, negative margins subtract.
 * WHERE: Called by predictQuarters_Tier2() in Module 5.
 * 
 * @param {Array<number>} margins - Array of recent margin values (positive = win, negative = loss)
 * @returns {number} Momentum score capped between -5 and +5
 */
function calculateMomentum(margins) {
  // WHY: Guard against empty or too-small datasets
  if (!margins || margins.length < 3) return 0;
  
  let momentum = 0;
  let weight = 1.0;
  const decay = 0.85; // Standardized decay factor (newer games = higher weight)

  // HOW: Process up to 8 most recent games (assume array is sorted newest-first)
  const recentMargins = margins.slice(0, 8);
  
  recentMargins.forEach(margin => {
    // WHY: Direct weighting of margin value
    momentum += margin * weight;
    weight *= decay; // Each older game matters less
  });

  // WHY: Normalize to prevent extreme swings (capped at ±5 point influence)
  return Math.max(-5, Math.min(5, parseFloat(momentum.toFixed(2))));
}

/**
 * WHY: To measure team consistency. High variance = risky bet.
 * WHAT: Calculates standard deviation of margin values.
 * HOW: Standard statistical formula for standard deviation.
 * WHERE: Called by predictQuarters_Tier2() in Module 5 to penalize volatile teams.
 * 
 * @param {Array<number>} margins - Array of recent margin values
 * @returns {number} Standard deviation (higher = more volatile/risky)
 */
function calculateVariance(margins) {
  // WHY: Guard against insufficient data
  if (!margins || margins.length < 2) return 0;
  
  const n = margins.length;
  const mean = margins.reduce((a, b) => a + b, 0) / n;
  const variance = margins.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  
  // WHY: Return standard deviation (sqrt of variance) for interpretability
  return parseFloat(Math.sqrt(variance).toFixed(2));
}

/**
 * WHY: Normalize team names for reliable matching across data sources.
 * WHAT: Removes special characters and standardizes casing.
 * HOW: Lowercase + strip non-alphanumeric characters.
 * WHERE: Used in Module 5 and 7 for team lookups.
 * [UPGRADE]: Phase 2 addition for Hive Mind cross-league matching.
 * 
 * @param {string} name - Raw team name (e.g., "L.A. Lakers")
 * @returns {string} Normalized key (e.g., "lalakers")
 */
function normalizeTeamKey(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * WHY: Standardize time formatting to prevent the "1899 date" bug.
 * WHAT: Converts any raw time value to 'HH:mm' string or 'TBD'.
 * HOW: Handles Date objects, Excel serial numbers, and strings.
 * WHERE: Called by Module 2 parsers before writing to Clean sheets.
 * [UPGRADE]: Phase 2 robustness addition.
 * 
 * @param {any} rawTime - Raw time value from spreadsheet
 * @returns {string} Formatted time string (e.g., "14:30") or "TBD"
 */
function formatGameTime(rawTime) {
  if (rawTime === '' || rawTime === null || rawTime === undefined) return 'TBD';

  if (rawTime instanceof Date) {
    return Utilities.formatDate(rawTime, Session.getScriptTimeZone(), 'HH:mm');
  }

  // WHY: Handle Excel serial time (fraction of day where 0.5 = 12:00)
  if (typeof rawTime === 'number' && rawTime < 1) {
    const totalMinutes = Math.round(rawTime * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }

  const str = String(rawTime).trim();
  return str || 'TBD';
}

/**
 * WHY: Load all historical games from Clean + ResultsClean for simulation.
 * WHAT: Combines data from both sheets into a single array.
 * HOW: Reads both sheets, validates data integrity, concatenates rows.
 * [UPGRADE]: Added defensive array validation to prevent downstream TypeError crashes.
 * WHERE: Reads from 'Clean' and 'ResultsClean' sheets.
 */
function loadAllHistoricalGames_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  
  // WHY: Initialize with empty array to GUARANTEE return type is always an array
  var allGames = [];
  var headerRow = null;
  
  // HOW: Load Clean sheet first (includes header)
  var cleanSheet = getSheetInsensitive(ss, 'Clean');
  if (cleanSheet) {
    var cleanData = cleanSheet.getDataRange().getValues();
    // [UPGRADE]: Validate it's actually an array with content
    if (Array.isArray(cleanData) && cleanData.length > 0) {
      headerRow = cleanData[0];
      allGames = cleanData;
      Logger.log('loadAllHistoricalGames_: Loaded ' + (cleanData.length - 1) + ' games from Clean.');
    }
  }
  
  // HOW: Append ResultsClean (skip its header to avoid duplicate)
  var resultsSheet = getSheetInsensitive(ss, 'ResultsClean');
  if (resultsSheet) {
    var resultsData = resultsSheet.getDataRange().getValues();
    // [UPGRADE]: Validate before concatenating
    if (Array.isArray(resultsData) && resultsData.length > 1) {
      if (!headerRow) {
        // If Clean was empty, use ResultsClean as base
        headerRow = resultsData[0];
        allGames = resultsData;
        Logger.log('loadAllHistoricalGames_: Loaded ' + (resultsData.length - 1) + ' games from ResultsClean (Clean was empty).');
      } else {
        // Skip header row when concatenating
        allGames = allGames.concat(resultsData.slice(1));
        Logger.log('loadAllHistoricalGames_: Added ' + (resultsData.length - 1) + ' games from ResultsClean.');
      }
    }
  }
  
  // WHY: Final safety check - ALWAYS return an array, even if empty
  // WHAT: Prevents downstream functions from receiving null/undefined
  // HOW: Explicit type check before return
  if (!Array.isArray(allGames)) {
    Logger.log('WARNING: loadAllHistoricalGames_ data was not an array - returning empty array');
    return [];
  }
  
  Logger.log('loadAllHistoricalGames_: Total games loaded: ' + (allGames.length > 0 ? allGames.length - 1 : 0));
  return allGames;
}

/**
 * WHY: Calculate variance for consistency penalty in predictions.
 * WHAT: Returns statistical variance of margin array.
 * HOW: Standard variance formula: avg of squared differences from mean.
 * WHERE: Used by Tier 2 prediction functions.
 */
function calculateVariance(margins) {
  if (!margins || margins.length < 2) return 0;
  
  var sum = 0;
  for (var i = 0; i < margins.length; i++) {
    sum += margins[i];
  }
  var mean = sum / margins.length;
  
  var sqDiffSum = 0;
  for (var j = 0; j < margins.length; j++) {
    sqDiffSum += Math.pow(margins[j] - mean, 2);
  }
  
  return sqDiffSum / margins.length;
}

/**
 * WHY: Round margin to nearest 0.5 for betting line display.
 * WHAT: Converts 3.7 -> 3.5, 4.3 -> 4.5, etc.
 * HOW: Multiply by 2, round, divide by 2.
 * WHERE: Used when formatting prediction output.
 */
function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

/**
 * WHY: Load the optimized Tier 2 configuration from the dedicated optimization sheet.
 * WHAT: Reads BestThreshold, BestDecay, etc. from 'Stats_Tier2_Optimization' and returns as config object.
 * HOW: Scans the sheet for CONFIG_KEY/VALUE pairs, falls back to safe defaults if sheet missing.
 * WHERE: Reads from 'Stats_Tier2_Optimization' sheet (separate from simulation results).
 * [UPGRADE]: Enables simulation and predictions to use optimized parameters instead of hardcoded defaults.
 */
function loadOptimizedTier2Config(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  
  // WHY: Safe defaults if optimization hasn't run yet
  // WHAT: Provides fallback values matching historical baseline performance
  var defaultConfig = {
    threshold: 2.5,
    decay: 0.90,
    h2hBoost: 1.0,
    momentumSwingFactor: 0.15,
    variancePenaltyFactor: 0.20
  };
  
  // WHY: Read from the OPTIMIZATION sheet (not Simulation!)
  // WHERE: 'Stats_Tier2_Optimization' is the dedicated output from runTier2ConfigOptimization
  var sheet = getSheetInsensitive(ss, 'Stats_Tier2_Optimization');
  
  if (!sheet) {
    Logger.log('loadOptimizedTier2Config: No optimization sheet found, using defaults.');
    return defaultConfig;
  }
  
  var data = sheet.getDataRange().getValues();
  var config = {
    threshold: defaultConfig.threshold,
    decay: defaultConfig.decay,
    h2hBoost: defaultConfig.h2hBoost,
    momentumSwingFactor: defaultConfig.momentumSwingFactor,
    variancePenaltyFactor: defaultConfig.variancePenaltyFactor
  };
  
  // WHY: Scan for config keys in the sheet
  // HOW: Loop through rows, match key names (case-insensitive), extract values
  for (var r = 0; r < data.length; r++) {
    var key = String(data[r][0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var val = data[r][1];
    
    if (val === '' || val === null || val === undefined) continue;
    
    if (key === 'bestthreshold') config.threshold = parseFloat(val);
    else if (key === 'bestdecay') config.decay = parseFloat(val);
    else if (key === 'besth2hboost') config.h2hBoost = parseFloat(val);
    else if (key === 'bestmomentumfactor') config.momentumSwingFactor = parseFloat(val);
    else if (key === 'bestvariancefactor') config.variancePenaltyFactor = parseFloat(val);
  }
  
  Logger.log('loadOptimizedTier2Config: Loaded config: ' + JSON.stringify(config));
  return config;
}
/**
 * WHY: Module 5 needs to extract team stats for a specific venue and quarter.
 * WHAT: Returns { avgMargin, stdDev, samples, rawMargins } for a team/venue/quarter combo.
 * HOW: Looks up the marginStats object with defensive fallbacks.
 * [FIX]: Now correctly maps 'count' to 'samples' from loadTier2MarginStats output.
 * WHERE: Called by predictQuarters_Tier2() in Module 5.
 */
function _getVenueStats_(marginStats, team, venue, quarter) {
  // WHY: Safe default when data is missing
  const empty = { avgMargin: 0, stdDev: 0, samples: 0, rawMargins: [] };
  
  if (!marginStats || !team || !venue || !quarter) return empty;
  
  const teamData = marginStats[team];
  if (!teamData) return empty;
  
  const venueData = teamData[venue];
  if (!venueData) return empty;
  
  const quarterData = venueData[quarter];
  if (!quarterData) return empty;
  
  // [FIX]: loadTier2MarginStats uses 'count', not 'samples'
  // Also check rawMargins.length as backup
  const sampleCount = quarterData.count || 
                      quarterData.samples || 
                      (quarterData.rawMargins ? quarterData.rawMargins.length : 0);
  
  // [FIX]: Calculate stdDev from variance if not directly available
  let stdDev = quarterData.stdDev || 0;
  if (stdDev === 0 && quarterData.variance) {
    stdDev = Math.sqrt(quarterData.variance);
  }
  
  return {
    avgMargin: quarterData.avg || quarterData.avgMargin || 0,
    stdDev: stdDev,
    samples: sampleCount,  // [CRITICAL FIX] Now correctly populated
    rawMargins: quarterData.rawMargins || []
  };
}

/**
 * WHY: Gemini's adaptive threshold formula requires per-match volatility calculation.
 * WHAT: Computes a match-specific betting threshold based on team volatility.
 * HOW: Uses formula: threshold = BASE + (avgVolatility × VOLATILITY_FACTOR)
 * WHERE: Called by predictQuarters_Tier2() in Module 5.
 * 
 * @param {Object} homeStats - Stats object from _getVenueStats_ for home team
 * @param {Object} awayStats - Stats object from _getVenueStats_ for away team
 * @param {Object} config - Base config from loadOptimizedTier2Config()
 * @returns {Object} { threshold, volatility, method }
 */
function computeAdaptiveThreshold_(homeStats, awayStats, config) {
  const BASE_THRESHOLD = 1.5;
  const VOLATILITY_FACTOR = 0.6;
  
  // WHY: If either team lacks data, fall back to higher fixed threshold
  if (homeStats.samples < 3 || awayStats.samples < 3) {
    return {
      threshold: config.threshold || 3.5,
      volatility: 0,
      method: 'FIXED_FALLBACK'
    };
  }
  
  // HOW: Average the standard deviations of both teams
  const avgVolatility = (homeStats.stdDev + awayStats.stdDev) / 2;
  
  // WHY: Dynamic threshold calculation per Gemini's approved formula
  const adaptiveThreshold = BASE_THRESHOLD + (avgVolatility * VOLATILITY_FACTOR);
  
  return {
    threshold: Math.max(2.0, Math.min(8.0, adaptiveThreshold)), // Cap between 2.0 and 8.0
    volatility: avgVolatility,
    method: 'ADAPTIVE'
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: loadStandings (SUPER ROBUST VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Standings data provides PCT, NetRtg, and other rich metrics needed
 *      for prediction models. The sheet may have multiple sections 
 *      (Western/Eastern Conference) with headers repeated.
 *
 * WHAT: Extracts ALL teams from Standings sheet into a unified lookup map,
 *       handling multi-section layouts, various header formats, and
 *       different data representations.
 *
 * HOW:
 *   1. Scans for header rows (containing "Team" column)
 *   2. Builds column mapping for each section
 *   3. Processes data rows until next header or section break
 *   4. Calculates derived metrics (netRtg, pct) when not available
 *   5. Returns lowercase-keyed map for case-insensitive lookup
 *
 * FEATURES:
 *   - Multi-section support (West/East conferences)
 *   - Flexible header detection (various column name formats)
 *   - Robust numeric parsing (handles commas, percentages, empty)
 *   - Win-Loss record parsing (e.g., "7-3", "7–3")
 *   - Streak parsing (e.g., "W3", "L2", "Won 3")
 *   - Derived metric calculation (netRtg from PF/PA)
 *   - Comprehensive logging with sample output
 *
 * WHERE: Module 1 (Helpers.gs) - SSoT for standings data
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Spreadsheet (optional)
 * @returns {Object} Map of teamName(lowercase) → standings metrics object
 * ═══════════════════════════════════════════════════════════════════════════
 */
function loadStandings(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════
  var SHEET_NAME = 'Standings';
  var DEFAULT_RANK = 15;
  var DEFAULT_PCT = 0.5;

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalize header text for matching (lowercase, alphanumeric only)
   */
  function normalizeHeader(str) {
    if (str === null || str === undefined) return '';
    return String(str).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Normalize team name for map key (lowercase, trimmed)
   */
  function normalizeTeamName(str) {
    if (str === null || str === undefined) return '';
    return String(str).toLowerCase().trim();
  }

  /**
   * Parse a value to number safely. Returns fallback if invalid.
   * Handles: empty, null, commas, percentages
   */
  function parseNumber(val, fallback) {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val === 'number') return isFinite(val) ? val : fallback;
    
    var str = String(val).trim().replace(/,/g, '').replace(/%$/, '');
    var num = parseFloat(str);
    return isFinite(num) ? num : fallback;
  }

  /**
   * Parse a win-loss record string (e.g., "7-3", "7–3") 
   * Returns { wins, losses, pct }
   */
  function parseWinLossRecord(str) {
    if (!str) return null;
    
    var match = String(str).trim().match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!match) return null;
    
    var wins = parseInt(match[1], 10) || 0;
    var losses = parseInt(match[2], 10) || 0;
    var total = wins + losses;
    
    return {
      wins: wins,
      losses: losses,
      pct: total > 0 ? wins / total : DEFAULT_PCT
    };
  }

  /**
   * Parse a streak string (e.g., "W3", "L2", "Won 3", "Lost 2")
   * Returns positive for wins, negative for losses
   */
  function parseStreak(str) {
    if (!str) return 0;
    
    var streakStr = String(str).trim().toUpperCase();
    
    // Match patterns: "W3", "L2", "WON 3", "LOST 2", "W 3", etc.
    var match = streakStr.match(/^(W|WON|L|LOST)\s*(\d+)$/i);
    if (match) {
      var count = parseInt(match[2], 10) || 0;
      var isWin = match[1].charAt(0) === 'W';
      return isWin ? count : -count;
    }
    
    return 0;
  }

  /**
   * Check if a row is a header row (contains team column + other stat columns)
   */
  function isHeaderRow(row) {
    var hasTeamCol = false;
    var hasStatCol = false;
    
    for (var i = 0; i < row.length; i++) {
      var h = normalizeHeader(row[i]);
      if (h === 'team' || h === 'teamname') hasTeamCol = true;
      if (h === 'w' || h === 'wins' || h === 'gp' || h === 'games' || h === 'pct') hasStatCol = true;
    }
    
    return hasTeamCol && hasStatCol;
  }

  /**
   * Check if a row is a section label (West, East, Conference, etc.)
   */
  function isSectionLabel(row) {
    var firstCell = normalizeHeader(row[0]);
    var sectionLabels = [
      'west', 'east', 'western', 'eastern',
      'westernconference', 'easternconference',
      'atlantic', 'central', 'southeast', 'northwest', 'pacific', 'southwest',
      'conference', 'division'
    ];
    return sectionLabels.indexOf(firstCell) !== -1;
  }

  /**
   * Check if a row is empty or contains only whitespace
   */
  function isEmptyRow(row) {
    for (var i = 0; i < row.length; i++) {
      if (row[i] !== null && row[i] !== undefined && String(row[i]).trim() !== '') {
        return false;
      }
    }
    return true;
  }

  /**
   * Build column index mapping from a header row
   */
  function buildColumnMap(headerRow) {
    var colMap = {};
    
    // Define column name aliases for each field
    var columnAliases = {
      rank:   ['position', 'pos', 'rank', 'rk', '#'],
      team:   ['teamname', 'team', 'name', 'club'],
      gp:     ['gp', 'games', 'gamesplayed', 'g', 'mp'],
      wins:   ['w', 'wins', 'win'],
      losses: ['l', 'losses', 'loss'],
      pf:     ['pf', 'pts', 'pointsfor', 'ppg', 'ptsfor'],
      pa:     ['pa', 'ptsagainst', 'pointsagainst', 'papg', 'opp'],
      pct:    ['pct', 'winpct', 'wpct', 'percentage'],
      streak: ['streak', 'strk', 'str'],
      l10:    ['l10', 'last10', 'lasttenl10'],
      home:   ['home', 'homerec', 'homerecord'],
      away:   ['away', 'road', 'awayrec', 'roadrec', 'awayrecord']
    };
    
    for (var c = 0; c < headerRow.length; c++) {
      var header = normalizeHeader(headerRow[c]);
      if (!header) continue;
      
      // Check each field's aliases
      for (var field in columnAliases) {
        if (!columnAliases.hasOwnProperty(field)) continue;
        
        var aliases = columnAliases[field];
        for (var a = 0; a < aliases.length; a++) {
          if (header === aliases[a]) {
            colMap[field] = c;
            break;
          }
        }
      }
    }
    
    return colMap;
  }

  /**
   * Parse a team data row into a standings object
   */
  function parseTeamRow(row, colMap) {
    // Must have team column mapped
    if (colMap.team === undefined) return null;
    
    var teamRaw = row[colMap.team];
    if (!teamRaw || String(teamRaw).trim() === '') return null;
    
    var teamName = String(teamRaw).trim();
    
    // Skip if looks like a header or label
    var teamLower = teamName.toLowerCase();
    if (teamLower === 'team' || teamLower === 'team name' || teamLower === 'teamname') {
      return null;
    }
    
    // ─────────────────────────────────────────────────────────────
    // EXTRACT RAW VALUES
    // ─────────────────────────────────────────────────────────────
    var gp = parseNumber(row[colMap.gp], 0);
    var wins = parseNumber(row[colMap.wins], 0);
    var losses = parseNumber(row[colMap.losses], 0);
    var pf = parseNumber(row[colMap.pf], 0);
    var pa = parseNumber(row[colMap.pa], 0);
    var rank = parseNumber(row[colMap.rank], DEFAULT_RANK);
    
    // ─────────────────────────────────────────────────────────────
    // CALCULATE PCT
    // Try to read from sheet first, then calculate if needed
    // ─────────────────────────────────────────────────────────────
    var pct = DEFAULT_PCT;
    
    if (colMap.pct !== undefined && row[colMap.pct] !== '' && row[colMap.pct] !== null) {
      var rawPct = parseNumber(row[colMap.pct], -1);
      if (rawPct >= 0 && rawPct <= 1) {
        // Already a decimal (0.xxx)
        pct = rawPct;
      } else if (rawPct > 1 && rawPct <= 100) {
        // Percentage format (xx.x)
        pct = rawPct / 100;
      }
    }
    
    // Fallback: calculate from W/L
    if (pct === DEFAULT_PCT && (wins > 0 || losses > 0)) {
      var totalGames = wins + losses;
      if (totalGames > 0) {
        pct = wins / totalGames;
      }
    }
    
    // ─────────────────────────────────────────────────────────────
    // CALCULATE NET RATING
    // (Points For - Points Against) / Games Played
    // ─────────────────────────────────────────────────────────────
    var netRtg = 0;
    if (gp > 0 && (pf > 0 || pa > 0)) {
      netRtg = (pf - pa) / gp;
    }
    
    // ─────────────────────────────────────────────────────────────
    // PARSE STREAK
    // ─────────────────────────────────────────────────────────────
    var streak = 0;
    if (colMap.streak !== undefined) {
      streak = parseStreak(row[colMap.streak]);
    }
    
    // ─────────────────────────────────────────────────────────────
    // PARSE LAST 10 GAMES
    // ─────────────────────────────────────────────────────────────
    var l10Pct = pct; // Default to overall PCT
    if (colMap.l10 !== undefined && row[colMap.l10]) {
      var l10Record = parseWinLossRecord(row[colMap.l10]);
      if (l10Record) {
        l10Pct = l10Record.pct;
      }
    }
    
    // ─────────────────────────────────────────────────────────────
    // PARSE HOME RECORD
    // ─────────────────────────────────────────────────────────────
    var homePct = pct; // Default to overall PCT
    if (colMap.home !== undefined && row[colMap.home]) {
      var homeRecord = parseWinLossRecord(row[colMap.home]);
      if (homeRecord) {
        homePct = homeRecord.pct;
      }
    }
    
    // ─────────────────────────────────────────────────────────────
    // PARSE AWAY RECORD
    // ─────────────────────────────────────────────────────────────
    var awayPct = pct; // Default to overall PCT
    if (colMap.away !== undefined && row[colMap.away]) {
      var awayRecord = parseWinLossRecord(row[colMap.away]);
      if (awayRecord) {
        awayPct = awayRecord.pct;
      }
    }
    
    // ─────────────────────────────────────────────────────────────
    // BUILD RESULT OBJECT
    // ─────────────────────────────────────────────────────────────
    return {
      teamName: teamName,
      rank: rank,
      pct: pct,
      netRtg: netRtg,
      wl: wins + '-' + losses,
      wins: wins,
      losses: losses,
      homePct: homePct,
      awayPct: awayPct,
      l10Pct: l10Pct,
      streak: streak,
      gp: gp,
      pf: pf,
      pa: pa
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN LOGIC
  // ═══════════════════════════════════════════════════════════════════════════
  var standings = {};

  // Get the Standings sheet (case-insensitive)
  var sheet = getSheetInsensitive(ss, SHEET_NAME);
  if (!sheet) {
    Logger.log('[loadStandings] ❌ ERROR: "' + SHEET_NAME + '" sheet not found');
    return standings;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('[loadStandings] ⚠️ WARNING: "' + SHEET_NAME + '" sheet has insufficient data');
    return standings;
  }

  Logger.log('[loadStandings] Processing ' + data.length + ' rows from "' + SHEET_NAME + '"');

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAN THROUGH ALL ROWS
  // Handle multiple sections (e.g., Western/Eastern Conference)
  // ═══════════════════════════════════════════════════════════════════════════
  var currentColMap = null;
  var teamsLoaded = 0;
  var sectionsFound = 0;
  var warnings = [];

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    
    // ─────────────────────────────────────────────────────────────
    // SKIP EMPTY ROWS
    // ─────────────────────────────────────────────────────────────
    if (isEmptyRow(row)) {
      continue;
    }
    
    // ─────────────────────────────────────────────────────────────
    // SKIP SECTION LABELS (West, East, Conference, etc.)
    // ─────────────────────────────────────────────────────────────
    if (isSectionLabel(row)) {
      Logger.log('[loadStandings] Skipping section label at row ' + (r + 1) + ': "' + row[0] + '"');
      continue;
    }
    
    // ─────────────────────────────────────────────────────────────
    // CHECK FOR HEADER ROW
    // If found, create new column mapping for this section
    // ─────────────────────────────────────────────────────────────
    if (isHeaderRow(row)) {
      currentColMap = buildColumnMap(row);
      sectionsFound++;
      
      if (currentColMap.team === undefined) {
        warnings.push('Header row at ' + (r + 1) + ' missing team column');
        currentColMap = null;
      } else {
        Logger.log('[loadStandings] Found header row at ' + (r + 1) + 
                   ' (Section ' + sectionsFound + ')' +
                   ' - Columns: team=' + currentColMap.team + 
                   ', gp=' + currentColMap.gp + 
                   ', pct=' + currentColMap.pct);
      }
      continue;
    }
    
    // ─────────────────────────────────────────────────────────────
    // SKIP IF NO HEADER FOUND YET
    // ─────────────────────────────────────────────────────────────
    if (!currentColMap) {
      continue;
    }
    
    // ─────────────────────────────────────────────────────────────
    // PARSE TEAM DATA ROW
    // ─────────────────────────────────────────────────────────────
    var teamData = parseTeamRow(row, currentColMap);
    
    if (teamData) {
      var key = normalizeTeamName(teamData.teamName);
      
      // Check for duplicates (shouldn't happen, but log if it does)
      if (standings[key]) {
        warnings.push('Duplicate team: "' + key + '" at row ' + (r + 1));
      }
      
      standings[key] = teamData;
      teamsLoaded++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOG RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (teamsLoaded === 0) {
    Logger.log('[loadStandings] ⚠️ WARNING: No teams loaded from Standings sheet');
    if (sectionsFound === 0) {
      Logger.log('[loadStandings] No valid header rows found. Expected columns: Team, W, L, PCT, etc.');
    }
  } else {
    Logger.log('[loadStandings] ✓ SUCCESS: Loaded ' + teamsLoaded + ' teams from ' + sectionsFound + ' section(s)');
    
    // Log sample teams for verification
    var teamKeys = Object.keys(standings);
    var sampleCount = Math.min(3, teamKeys.length);
    Logger.log('[loadStandings] Sample teams:');
    for (var t = 0; t < sampleCount; t++) {
      var sampleKey = teamKeys[t];
      var sampleData = standings[sampleKey];
      Logger.log('  "' + sampleKey + '" → Rank: ' + sampleData.rank + 
                 ', PCT: ' + sampleData.pct.toFixed(3) + 
                 ', NetRtg: ' + sampleData.netRtg.toFixed(2) +
                 ', W-L: ' + sampleData.wl);
    }
  }
  
  // Log any warnings
  if (warnings.length > 0) {
    Logger.log('[loadStandings] ⚠️ Warnings (' + warnings.length + '):');
    for (var w = 0; w < warnings.length; w++) {
      Logger.log('  - ' + warnings[w]);
    }
  }

  return standings;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: loadStandingsAsRankings_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: When Tier 2 data is insufficient, we fall back to ranking-based predictions.
 * WHAT: Loads standings data in a format compatible with ranking-based models.
 * HOW: Wraps loadStandings() - DRY principle.
 * WHERE: Called by predictQuarters_Tier2() in Module 5 as fallback.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Active spreadsheet
 * @returns {Object} Map of team name to standings/ranking data
 */
function loadStandingsAsRankings_(ss) {
  return loadStandings(ss);
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: getTeamStanding
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Provides a convenient lookup for a single team's standings data.
 * WHAT: Retrieves standings for a specific team with fallback defaults.
 * HOW: Uses cached standings or loads fresh, then looks up team.
 *
 * @param {Object} standingsMap - Pre-loaded standings map (or null to load)
 * @param {string} teamName - Team name to look up
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Spreadsheet (if loading)
 * @returns {Object} Team standings object with defaults for missing data
 */
function getTeamStanding(standingsMap, teamName, ss) {
  // Load standings if not provided
  if (!standingsMap) {
    standingsMap = loadStandings(ss);
  }
  
  // Normalize team name for lookup
  var key = String(teamName || '').toLowerCase().trim();
  
  // Return team data or defaults
  if (standingsMap[key]) {
    return standingsMap[key];
  }
  
  // Try partial match (team name might be abbreviated)
  for (var mapKey in standingsMap) {
    if (standingsMap.hasOwnProperty(mapKey)) {
      if (mapKey.indexOf(key) !== -1 || key.indexOf(mapKey) !== -1) {
        Logger.log('[getTeamStanding] Partial match: "' + key + '" → "' + mapKey + '"');
        return standingsMap[mapKey];
      }
    }
  }
  
  // Return defaults if not found
  Logger.log('[getTeamStanding] Team not found: "' + key + '"');
  return {
    rank: 15,
    pct: 0.5,
    netRtg: 0,
    wl: '0-0',
    wins: 0,
    losses: 0,
    homePct: 0.5,
    awayPct: 0.5,
    l10Pct: 0.5,
    streak: 0,
    gp: 0,
    pf: 0,
    pa: 0,
    teamName: teamName
  };
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: validateStandingsData
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Helps diagnose issues with standings data before using in predictions.
 * WHAT: Validates standings map and returns a diagnostic report.
 *
 * @param {Object} standingsMap - Standings map to validate
 * @returns {Object} Validation report
 */
function validateStandingsData(standingsMap) {
  var report = {
    valid: true,
    teamCount: 0,
    issues: [],
    summary: {}
  };
  
  if (!standingsMap || typeof standingsMap !== 'object') {
    report.valid = false;
    report.issues.push('Standings map is null or not an object');
    return report;
  }
  
  var teamKeys = Object.keys(standingsMap);
  report.teamCount = teamKeys.length;
  
  if (report.teamCount === 0) {
    report.valid = false;
    report.issues.push('No teams in standings map');
    return report;
  }
  
  // Expected team count for NBA
  if (report.teamCount < 30) {
    report.issues.push('Expected 30 teams, found ' + report.teamCount);
  }
  
  // Validate each team
  var pctSum = 0;
  var netRtgSum = 0;
  
  for (var i = 0; i < teamKeys.length; i++) {
    var key = teamKeys[i];
    var team = standingsMap[key];
    
    // Check required fields
    if (typeof team.pct !== 'number' || team.pct < 0 || team.pct > 1) {
      report.issues.push('Invalid PCT for "' + key + '": ' + team.pct);
    } else {
      pctSum += team.pct;
    }
    
    if (typeof team.netRtg !== 'number') {
      report.issues.push('Invalid netRtg for "' + key + '": ' + team.netRtg);
    } else {
      netRtgSum += team.netRtg;
    }
    
    if (typeof team.rank !== 'number' || team.rank < 1 || team.rank > 30) {
      report.issues.push('Unusual rank for "' + key + '": ' + team.rank);
    }
  }
  
  // Summary stats
  report.summary = {
    avgPct: pctSum / report.teamCount,
    avgNetRtg: netRtgSum / report.teamCount,
    issueCount: report.issues.length
  };
  
  if (report.issues.length > 5) {
    report.valid = false;
  }
  
  return report;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: logStandingsSummary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Useful for debugging and verifying standings data loaded correctly.
 * WHAT: Logs a formatted summary of standings data.
 *
 * @param {Object} standingsMap - Standings map to summarize
 */
function logStandingsSummary(standingsMap) {
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('STANDINGS DATA SUMMARY');
  Logger.log('═══════════════════════════════════════════════════════════════');
  
  if (!standingsMap || typeof standingsMap !== 'object') {
    Logger.log('ERROR: Invalid standings map');
    return;
  }
  
  var teamKeys = Object.keys(standingsMap);
  Logger.log('Total teams: ' + teamKeys.length);
  Logger.log('');
  
  // Sort by rank
  var sortedTeams = teamKeys.slice().sort(function(a, b) {
    return (standingsMap[a].rank || 99) - (standingsMap[b].rank || 99);
  });
  
  Logger.log('Top 10 teams by rank:');
  for (var i = 0; i < Math.min(10, sortedTeams.length); i++) {
    var key = sortedTeams[i];
    var team = standingsMap[key];
    Logger.log(
      '  ' + (i + 1) + '. ' + key + 
      ' | Rank: ' + team.rank +
      ' | PCT: ' + team.pct.toFixed(3) +
      ' | NetRtg: ' + (team.netRtg >= 0 ? '+' : '') + team.netRtg.toFixed(2) +
      ' | W-L: ' + team.wl
    );
  }
  
  Logger.log('═══════════════════════════════════════════════════════════════');
}


/**
 * WHY: Calculate a team's win streak with exponential decay for older games
 * WHAT: Sums weighted wins, resetting on losses; weights decay backwards in time
 * HOW: Iterates historical games, applies decay factor to older results
 * WHERE: Called by analyzeTier1 in Module 4
 */
function calculateDecayedStreak(team, allHistoricalGames, header, decay = 0.95) {
  // [GROK'S FULL IMPLEMENTATION - APPROVED AS-IS]
}

/**
 * WHY: Penalize prediction confidence based on teams' historical variance
 * WHAT: Averages variance of two teams and scales to a penalty factor (0-1)
 * HOW: Uses leagueStatsMap for lookup; defaults to safe value if missing
 * WHERE: Called by analyzeTier1 in Module 4
 */
function calculateVariancePenalty(homeTeam, awayTeam, leagueStatsMap, scale = 20) {
  // [GROK'S FULL IMPLEMENTATION - APPROVED AS-IS]
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: loadTier1Config (SUPER ROBUST VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *  - Case-insensitive key matching with flexible key normalization
 *  - Robust numeric parsing (handles 0, empty, commas, percentages)
 *  - Range validation with sensible guardrails
 *  - Boolean parsing (TRUE/FALSE/YES/NO/1/0)
 *  - MODULE 9 enhancement flags (FT O/U, Enhanced Highest Q, First Half, Robbers)
 *  - Comprehensive defaults with sanity checks
 *  - Debug logging for invalid/out-of-range values
 *  - Raw data preserved for debugging
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Spreadsheet (optional)
 * @returns {Object} Normalized Tier 1 configuration object
 * ═══════════════════════════════════════════════════════════════════════════
 */
function loadTier1Config(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULTS - Single source of truth
  // ═══════════════════════════════════════════════════════════════════════════
  var DEFAULTS = {
    // Meta
    version: 'v1.0.0',

    // Legacy weights
    rank: 0,
    form: 2.5,
    h2h: 1.5,
    forebet: 3,
    variance: 1,

    // New weights
    pctWeight: 3,
    netRtgWeight: 2,
    homeCourtWeight: 1,
    momentumWeight: 1,
    streakWeight: 1,

    // Common parameters
    homeAdv: 5,
    threshold: 25,

    // Confidence bounds
    confMin: 50,
    confMax: 95,

    // Elite parameters
    minSamples: 3,
    confidenceScale: 30,

    // Booleans
    bayesianBlending: false,
    showAllTiers: false,
    useLegacySigmoid: false,

    // Tier thresholds
    tierStrongMinScore: 65,
    tierMediumMinScore: 50,
    tierWeakMinScore: 35,

    // MODULE 9: Enhancement flags
    enableFirstHalf: true,
    enableRobbers: true,
    enableFTOU: true,
    enableEnhancedHighestQ: true,

    // MODULE 9: Robbers configuration
    robberMinOdds: 2.5,
    robberMaxOdds: 8.0,
    robberMinScore: 55,
    robberMinEdge: 0.08,
    robberMaxConf: 70,

    // MODULE 9: First Half configuration
    firstHalfDrawThreshold: 0.30,
    firstHalfHomeAdvantage: 0.03,
    firstHalfMinEdge: 0.05,
    firstHalfConfScale: 0.85,

    // MODULE 9: FT O/U configuration
    ftouSigmaFloor: 0.08,
    ftouSigmaScale: 1.2,
    ftouShrinkK: 15,
    ftouEdgeThreshold: 0.05,
    ftouMinEV: 0.02,

    // MODULE 9: Enhanced Highest Q configuration
    highestQRecentWeight: 0.40,
    highestQPaceWeight: 0.25,
    highestQH2HWeight: 0.20,
    highestQDistWeight: 0.15
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // KEY MAPPING: Sheet Key -> Config Property + Type
  // ═══════════════════════════════════════════════════════════════════════════
  var KEY_MAP = {
    // Meta
    'config_version':               { prop: 'version',              type: 'string' },

    // Legacy weights
    'rank_weight':                  { prop: 'rank',                 type: 'number' },
    'form_weight':                  { prop: 'form',                 type: 'number' },
    'h2h_weight':                   { prop: 'h2h',                  type: 'number' },
    'forebet_weight':               { prop: 'forebet',              type: 'number' },
    'variance_weight':              { prop: 'variance',             type: 'number' },

    // New weights
    'pctweight':                    { prop: 'pctWeight',            type: 'number' },
    'pct_weight':                   { prop: 'pctWeight',            type: 'number' },
    'netrtgweight':                 { prop: 'netRtgWeight',         type: 'number' },
    'net_rtg_weight':               { prop: 'netRtgWeight',         type: 'number' },
    'homecourtweight':              { prop: 'homeCourtWeight',      type: 'number' },
    'home_court_weight':            { prop: 'homeCourtWeight',      type: 'number' },
    'momentumweight':               { prop: 'momentumWeight',       type: 'number' },
    'momentum_weight':              { prop: 'momentumWeight',       type: 'number' },
    'streakweight':                 { prop: 'streakWeight',         type: 'number' },
    'streak_weight':                { prop: 'streakWeight',         type: 'number' },

    // Common parameters
    'home_advantage':               { prop: 'homeAdv',              type: 'number' },
    'homeadv':                      { prop: 'homeAdv',              type: 'number' },
    'score_threshold':              { prop: 'threshold',            type: 'number' },
    'threshold':                    { prop: 'threshold',            type: 'number' },

    // Confidence bounds
    'confidence_min':               { prop: 'confMin',              type: 'number', min: 0, max: 100 },
    'conf_min':                     { prop: 'confMin',              type: 'number', min: 0, max: 100 },
    'confidence_max':               { prop: 'confMax',              type: 'number', min: 0, max: 100 },
    'conf_max':                     { prop: 'confMax',              type: 'number', min: 0, max: 100 },

    // Elite parameters
    'min_samples':                  { prop: 'minSamples',           type: 'integer', min: 1 },
    'confidence_scale':             { prop: 'confidenceScale',      type: 'number' },

    // Booleans
    'bayesian_blending':            { prop: 'bayesianBlending',     type: 'boolean' },
    'show_all_tiers':               { prop: 'showAllTiers',         type: 'boolean' },
    'use_legacy_sigmoid':           { prop: 'useLegacySigmoid',     type: 'boolean' },

    // Tier thresholds
    'tier_strong_min_score':        { prop: 'tierStrongMinScore',   type: 'number', min: 0, max: 100 },
    'tier_medium_min_score':        { prop: 'tierMediumMinScore',   type: 'number', min: 0, max: 100 },
    'tier_weak_min_score':          { prop: 'tierWeakMinScore',     type: 'number', min: 0, max: 100 },

    // MODULE 9: Enhancement flags
    'enable_first_half':            { prop: 'enableFirstHalf',      type: 'boolean' },
    'enable_robbers':               { prop: 'enableRobbers',        type: 'boolean' },
    'enable_ft_ou':                 { prop: 'enableFTOU',           type: 'boolean' },
    'enable_enhanced_highest_q':    { prop: 'enableEnhancedHighestQ', type: 'boolean' },

    // MODULE 9: Robbers configuration
    'robber_min_odds':              { prop: 'robberMinOdds',        type: 'number', min: 1 },
    'robber_max_odds':              { prop: 'robberMaxOdds',        type: 'number', min: 1 },
    'robber_min_score':             { prop: 'robberMinScore',       type: 'number', min: 0, max: 100 },
    'robber_min_edge':              { prop: 'robberMinEdge',        type: 'number', min: 0, max: 1 },
    'robber_max_conf':              { prop: 'robberMaxConf',        type: 'number', min: 0, max: 100 },

    // MODULE 9: First Half configuration
    'first_half_draw_threshold':    { prop: 'firstHalfDrawThreshold', type: 'number', min: 0, max: 1 },
    'first_half_home_advantage':    { prop: 'firstHalfHomeAdvantage', type: 'number', min: 0, max: 1 },
    'first_half_min_edge':          { prop: 'firstHalfMinEdge',     type: 'number', min: 0, max: 1 },
    'first_half_conf_scale':        { prop: 'firstHalfConfScale',   type: 'number', min: 0, max: 2 },

    // MODULE 9: FT O/U configuration
    'ftou_sigma_floor':             { prop: 'ftouSigmaFloor',       type: 'number', min: 0 },
    'ftou_sigma_scale':             { prop: 'ftouSigmaScale',       type: 'number', min: 0 },
    'ftou_shrink_k':                { prop: 'ftouShrinkK',          type: 'number', min: 0 },
    'ftou_edge_threshold':          { prop: 'ftouEdgeThreshold',    type: 'number', min: 0, max: 1 },
    'ftou_min_ev':                  { prop: 'ftouMinEV',            type: 'number', min: 0, max: 1 },

    // MODULE 9: Enhanced Highest Q configuration
    'highest_q_recent_weight':      { prop: 'highestQRecentWeight', type: 'number', min: 0, max: 1 },
    'highest_q_pace_weight':        { prop: 'highestQPaceWeight',   type: 'number', min: 0, max: 1 },
    'highest_q_h2h_weight':         { prop: 'highestQH2HWeight',    type: 'number', min: 0, max: 1 },
    'highest_q_dist_weight':        { prop: 'highestQDistWeight',   type: 'number', min: 0, max: 1 }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalize a key: lowercase, trim, replace spaces/hyphens with underscores
   */
  function normalizeKey(key) {
    if (key === null || key === undefined) return '';
    return String(key)
      .toLowerCase()
      .trim()
      .replace(/[\s\-]+/g, '_')
      .replace(/^_+|_+$/g, '');  // trim leading/trailing underscores
  }

  /**
   * Parse a value to number. Returns NaN if not a valid finite number.
   * Handles: empty, null, undefined, strings with commas/percentages
   */
  function toNumber(val) {
    if (val === '' || val === null || val === undefined) return NaN;
    if (typeof val === 'number') return isFinite(val) ? val : NaN;
    
    var str = String(val).trim();
    if (str === '') return NaN;
    
    // Remove commas and percentage signs
    str = str.replace(/,/g, '').replace(/%$/, '');
    
    var num = parseFloat(str);
    return isFinite(num) ? num : NaN;
  }

  /**
   * Get number or default. Correctly handles 0 values.
   */
  function numOrDefault(val, def) {
    var n = toNumber(val);
    return isNaN(n) ? def : n;
  }

  /**
   * Get number within range or default
   */
  function numInRangeOrDefault(val, def, min, max) {
    var n = toNumber(val);
    if (isNaN(n)) return def;
    if (min !== undefined && n < min) return def;
    if (max !== undefined && n > max) return def;
    return n;
  }

  /**
   * Get integer or default
   */
  function intOrDefault(val, def, min, max) {
    var n = toNumber(val);
    if (isNaN(n)) return def;
    n = Math.floor(n);
    if (min !== undefined && n < min) return def;
    if (max !== undefined && n > max) return def;
    return n;
  }

  /**
   * Parse boolean value. Handles TRUE/FALSE/YES/NO/1/0
   */
  function parseBoolean(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (val === null || val === undefined || val === '') return false;
    
    var str = String(val).trim().toUpperCase();
    return str === 'TRUE' || str === 'YES' || str === '1' || str === 'ON' || str === 'ENABLED';
  }

  /**
   * Get boolean or default
   */
  function boolOrDefault(val, def) {
    if (val === null || val === undefined || val === '') return def;
    return parseBoolean(val);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD SHEET DATA
  // ═══════════════════════════════════════════════════════════════════════════
  var cfgSheet = getSheetInsensitive(ss, 'Config_Tier1');
  if (!cfgSheet) {
    Logger.log('[loadTier1Config] Config_Tier1 sheet not found, using all defaults');
    return Object.assign({}, DEFAULTS, { _raw: {}, _source: 'defaults' });
  }

  var data = cfgSheet.getDataRange().getValues();
  var raw = {};

  // Build raw key->value map (normalized keys)
  for (var i = 0; i < data.length; i++) {
    var rawKey = data[i][0];
    var rawVal = data[i][1];
    
    // Skip empty rows and section headers (---)
    if (!rawKey || String(rawKey).trim().startsWith('---')) continue;
    
    var normKey = normalizeKey(rawKey);
    if (normKey) {
      raw[normKey] = rawVal;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD CONFIG FROM RAW VALUES
  // ═══════════════════════════════════════════════════════════════════════════
  var config = {};
  var warnings = [];

  // Process each key in KEY_MAP
  for (var sheetKey in KEY_MAP) {
    if (!KEY_MAP.hasOwnProperty(sheetKey)) continue;
    
    var mapping = KEY_MAP[sheetKey];
    var prop = mapping.prop;
    var type = mapping.type;
    var def = DEFAULTS[prop];
    var rawVal = raw[sheetKey];

    // Skip if already set (allows first match priority for aliases)
    if (config.hasOwnProperty(prop)) continue;

    switch (type) {
      case 'string':
        config[prop] = (rawVal !== undefined && rawVal !== null && rawVal !== '') 
          ? String(rawVal) 
          : def;
        break;

      case 'number':
        if (mapping.min !== undefined || mapping.max !== undefined) {
          config[prop] = numInRangeOrDefault(rawVal, def, mapping.min, mapping.max);
          if (rawVal !== undefined && config[prop] !== toNumber(rawVal) && !isNaN(toNumber(rawVal))) {
            warnings.push(sheetKey + ': ' + rawVal + ' out of range [' + mapping.min + ',' + mapping.max + '] -> using ' + config[prop]);
          }
        } else {
          config[prop] = numOrDefault(rawVal, def);
        }
        break;

      case 'integer':
        config[prop] = intOrDefault(rawVal, def, mapping.min, mapping.max);
        break;

      case 'boolean':
        config[prop] = boolOrDefault(rawVal, def);
        break;

      default:
        config[prop] = def;
    }
  }

  // Fill any missing defaults
  for (var defKey in DEFAULTS) {
    if (!config.hasOwnProperty(defKey)) {
      config[defKey] = DEFAULTS[defKey];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SANITY CHECKS & GUARDRAILS
  // ═══════════════════════════════════════════════════════════════════════════

  // Confidence bounds sanity
  if (config.confMax < 50 || config.confMax > 99) {
    warnings.push('confidence_max (' + config.confMax + ') outside sane range [50,99] -> using ' + DEFAULTS.confMax);
    config.confMax = DEFAULTS.confMax;
  }
  if (config.confMin < 20 || config.confMin > 80) {
    warnings.push('confidence_min (' + config.confMin + ') outside sane range [20,80] -> using ' + DEFAULTS.confMin);
    config.confMin = DEFAULTS.confMin;
  }
  if (config.confMin >= config.confMax) {
    warnings.push('confidence_min >= confidence_max (' + config.confMin + ' >= ' + config.confMax + ') -> resetting both to defaults');
    config.confMin = DEFAULTS.confMin;
    config.confMax = DEFAULTS.confMax;
  }

  // Tier threshold sanity
  if (config.tierStrongMinScore <= config.tierMediumMinScore) {
    warnings.push('tier_strong_min_score <= tier_medium_min_score -> resetting tiers to defaults');
    config.tierStrongMinScore = DEFAULTS.tierStrongMinScore;
    config.tierMediumMinScore = DEFAULTS.tierMediumMinScore;
    config.tierWeakMinScore = DEFAULTS.tierWeakMinScore;
  }
  if (config.tierMediumMinScore <= config.tierWeakMinScore) {
    warnings.push('tier_medium_min_score <= tier_weak_min_score -> resetting tiers to defaults');
    config.tierMediumMinScore = DEFAULTS.tierMediumMinScore;
    config.tierWeakMinScore = DEFAULTS.tierWeakMinScore;
  }

  // Robber odds sanity
  if (config.robberMaxOdds <= config.robberMinOdds) {
    warnings.push('robber_max_odds <= robber_min_odds -> resetting to defaults');
    config.robberMinOdds = DEFAULTS.robberMinOdds;
    config.robberMaxOdds = DEFAULTS.robberMaxOdds;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOG WARNINGS
  // ═══════════════════════════════════════════════════════════════════════════
  if (warnings.length > 0) {
    Logger.log('[loadTier1Config] ⚠️ Config warnings:');
    for (var w = 0; w < warnings.length; w++) {
      Logger.log('  - ' + warnings[w]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTACH METADATA
  // ═══════════════════════════════════════════════════════════════════════════
  config._raw = raw;
  config._source = 'sheet';
  config._warnings = warnings;
  config._loadedAt = new Date().toISOString();

  Logger.log('[loadTier1Config] ✓ Loaded config version: ' + config.version + 
             ' | Confidence: [' + config.confMin + '-' + config.confMax + ']' +
             ' | Modules: FH=' + config.enableFirstHalf + 
             ', ROB=' + config.enableRobbers + 
             ', FTOU=' + config.enableFTOU + 
             ', EHQ=' + config.enableEnhancedHighestQ);

  return config;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HELPER: getSheetInsensitive
 * ═══════════════════════════════════════════════════════════════════════════
 * Case-insensitive sheet lookup
 */
function getSheetInsensitive(ss, name) {
  if (!ss || !name) return null;
  
  var targetLower = name.toLowerCase().trim();
  var sheets = ss.getSheets();
  
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().trim() === targetLower) {
      return sheets[i];
    }
  }
  return null;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UTILITY: validateTier1Config
 * ═══════════════════════════════════════════════════════════════════════════
 * Validates a config object and returns a report
 */
function validateTier1Config(config) {
  var issues = [];
  
  // Required numeric fields
  var numericFields = ['rank', 'form', 'h2h', 'forebet', 'variance', 
                       'homeAdv', 'threshold', 'confMin', 'confMax'];
  
  for (var i = 0; i < numericFields.length; i++) {
    var field = numericFields[i];
    if (typeof config[field] !== 'number' || !isFinite(config[field])) {
      issues.push(field + ' is not a valid number: ' + config[field]);
    }
  }
  
  // Confidence bounds
  if (config.confMin >= config.confMax) {
    issues.push('confMin (' + config.confMin + ') must be less than confMax (' + config.confMax + ')');
  }
  
  // Boolean fields
  var boolFields = ['enableFirstHalf', 'enableRobbers', 'enableFTOU', 'enableEnhancedHighestQ'];
  for (var j = 0; j < boolFields.length; j++) {
    var bf = boolFields[j];
    if (typeof config[bf] !== 'boolean') {
      issues.push(bf + ' is not a boolean: ' + config[bf]);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues: issues,
    config: config
  };
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UTILITY: logTier1ConfigSummary
 * ═══════════════════════════════════════════════════════════════════════════
 * Logs a formatted summary of the current config
 */
function logTier1ConfigSummary(config) {
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('TIER 1 CONFIGURATION SUMMARY');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('Version: ' + config.version);
  Logger.log('Source: ' + (config._source || 'unknown'));
  Logger.log('Loaded: ' + (config._loadedAt || 'unknown'));
  Logger.log('');
  Logger.log('WEIGHTS:');
  Logger.log('  Legacy: rank=' + config.rank + ', form=' + config.form + 
             ', h2h=' + config.h2h + ', forebet=' + config.forebet + 
             ', variance=' + config.variance);
  Logger.log('  New: pct=' + config.pctWeight + ', netRtg=' + config.netRtgWeight + 
             ', homeCourt=' + config.homeCourtWeight + ', momentum=' + config.momentumWeight + 
             ', streak=' + config.streakWeight);
  Logger.log('');
  Logger.log('CONFIDENCE: [' + config.confMin + ' - ' + config.confMax + ']');
  Logger.log('');
  Logger.log('MODULE 9 FLAGS:');
  Logger.log('  First Half: ' + config.enableFirstHalf);
  Logger.log('  Robbers: ' + config.enableRobbers);
  Logger.log('  FT O/U: ' + config.enableFTOU);
  Logger.log('  Enhanced Highest Q: ' + config.enableEnhancedHighestQ);
  Logger.log('═══════════════════════════════════════════════════════════════');
  
  if (config._warnings && config._warnings.length > 0) {
    Logger.log('WARNINGS (' + config._warnings.length + '):');
    for (var i = 0; i < config._warnings.length; i++) {
      Logger.log('  ⚠️ ' + config._warnings[i]);
    }
  }
}


/**
 * getTier1Defaults_ - COMBINED
 * ══════════════════════════════════════════════════════════════════════════════
 * Default configuration values for Tier 1, including MODULE 9 enhancements.
 * ══════════════════════════════════════════════════════════════════════════════
 */
function getTier1Defaults_() {
  return {
    // ─────────────────────────────────────────────────────────────────────────
    // VERSION
    // ─────────────────────────────────────────────────────────────────────────
    version: 'default',
    
    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY WEIGHTS
    // ─────────────────────────────────────────────────────────────────────────
    rank: 0,
    form: 2.5,
    h2h: 1.5,
    forebet: 3,
    variance: 1,
    
    // ─────────────────────────────────────────────────────────────────────────
    // NEW WEIGHTS
    // ─────────────────────────────────────────────────────────────────────────
    pctWeight: 3,
    netRtgWeight: 2,
    homeCourtWeight: 1,
    momentumWeight: 1,
    streakWeight: 1,
    
    // ─────────────────────────────────────────────────────────────────────────
    // COMMON PARAMETERS
    // ─────────────────────────────────────────────────────────────────────────
    homeAdv: 5,
    threshold: 25,
    confMin: 50,
    confMax: 95,
    
    // ─────────────────────────────────────────────────────────────────────────
    // ELITE PARAMETERS
    // ─────────────────────────────────────────────────────────────────────────
    min_samples: 1,
    confidence_scale: 30,
    bayesian_blending: true,
    show_all_tiers: true,
    tier_strong_min_score: 75,
    tier_medium_min_score: 60,
    tier_weak_min_score: 50,
    
    // ─────────────────────────────────────────────────────────────────────────
    // MODULE 9: ENHANCEMENT FLAGS
    // ─────────────────────────────────────────────────────────────────────────
    enableFirstHalf: true,
    enableRobbers: true,
    enableFTOU: true,
    enableEnhancedHighestQ: true,
    
    // ─────────────────────────────────────────────────────────────────────────
    // MODULE 9: ROBBERS CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    robberMinOdds: 2.20,
    robberMaxOdds: 8.00,
    robberMinScore: 35,
    robberMinEdge: 0.08,
    robberMaxConf: 45,
    
    // ─────────────────────────────────────────────────────────────────────────
    // MODULE 9: FIRST HALF CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    firstHalfDrawThreshold: 3,
    firstHalfHomeAdvantage: 1.5,
    firstHalfMinEdge: 0.03,
    firstHalfConfScale: 25,
    
    // ─────────────────────────────────────────────────────────────────────────
    // MODULE 9: FT O/U CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    ftouSigmaFloor: 15,
    ftouSigmaScale: 1.0,
    ftouShrinkK: 8,
    ftouEdgeThreshold: 0.02,
    ftouMinEV: 0.005,
    
    // ─────────────────────────────────────────────────────────────────────────
    // MODULE 9: ENHANCED HIGHEST Q CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    highestQRecentWeight: 0.30,
    highestQPaceWeight: 0.20,
    highestQH2HWeight: 0.25,
    highestQDistWeight: 0.25
  };
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HELPER: _parseConfigNumber
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Config keys may have different naming conventions across files.
 *      This helper tries multiple key variations and returns the first match.
 * 
 * WHAT: Searches configMap for any of the provided key variations,
 *       returns parsed number or default value.
 * 
 * @param {Object} configMap - The key→value map from Config_Tier1
 * @param {string[]} keyVariations - Array of possible key names to check
 * @param {number} defaultValue - Default if no key found or value invalid
 * @returns {number} The parsed config value or default
 */
function _parseConfigNumber(configMap, keyVariations, defaultValue) {
  for (const key of keyVariations) {
    const normalizedKey = key.toLowerCase().trim();
    if (configMap[normalizedKey] !== undefined) {
      const parsed = parseFloat(configMap[normalizedKey]);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return defaultValue;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HELPER: _getDefaultTier1Config
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Fallback when Config_Tier1 sheet is missing or empty.
 *      Prevents crashes and allows system to function with sensible defaults.
 * 
 * @returns {Object} Default Tier 1 configuration
 */
function _getDefaultTier1Config() {
  return {
    version: 'default',
    
    // Legacy weights
    rank: 0,
    form: 2.5,
    h2h: 1.5,
    forebet: 3.0,
    variance: 1.0,
    
    // [NEW 2025] Rich standings weights
    pctWeight: 3.5,
    netRtgWeight: 4.0,
    homeCourtWeight: 2.0,
    momentumWeight: 2.5,
    streakWeight: 1.0,
    
    // Common parameters
    homeAdv: 5.0,
    threshold: 5.0,
    confMin: 50,
    confMax: 95,
    
    // Aliases
    home_advantage: 5.0,
    score_threshold: 5.0,
    confidence_min: 50,
    confidence_max: 95
  };
}

/**
 * Converts a Google Sheets Date object that actually represents a numeric serial
 * (common when a cell is formatted as Date but you typed 0.02) back into a number.
 * Serial 0 in Sheets is 1899-12-30.
 */
function _sheetDateToSerialNumber_(d) {
  if (!(d instanceof Date) || isNaN(d)) return NaN;
  // Use UTC to reduce timezone drift.
  var base = Date.UTC(1899, 11, 30, 0, 0, 0); // 1899-12-30
  var ms = d.getTime();
  return (ms - base) / 86400000; // ms per day
}

function _coerceBool_(v, fallback) {
  if (v === true || v === false) return v;
  var s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'TRUE' || s === 'YES' || s === '1') return true;
  if (s === 'FALSE' || s === 'NO' || s === '0') return false;
  return fallback === undefined ? false : fallback;
}

function _coerceNumber_(v, fallback) {
  if (typeof v === 'number' && !isNaN(v)) return v;

  if (v instanceof Date) {
    var serial = _sheetDateToSerialNumber_(v);
    if (!isNaN(serial)) return serial;
    return fallback;
  }

  var s = String(v == null ? '' : v).trim();
  if (!s) return fallback;
  // Allow commas as decimal separators just in case
  s = s.replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

/**
 * Reads a simple 2-column key/value sheet like Config_Tier2.
 * IMPORTANT: does NOT skip row 1 (your config_version is in row 1).
 */
function _readKeyValueSheetMap_(sheet) {
  var map = {};
  if (!sheet) return map;

  var values = sheet.getDataRange().getValues();
  for (var r = 0; r < values.length; r++) {
    var key = String(values[r][0] || '').trim();
    if (!key) continue;

    // Skip section headers like --- CORE PARAMS ---
    if (key.indexOf('---') === 0) continue;

    map[key.toLowerCase()] = values[r][1];
  }
  return map;
}

/**
 * =====================================================================
 * Load Tier 2 config dynamically from sheet (PATCHED)
 * =====================================================================
 * PATCH:
 *   - Falls back to getEliteDefaults_() if sheet load fails
 *   - Handles empty/missing Config_Tier2 sheet gracefully
 *   - Prevents CONFIG_TIER2 from staying null
 *
 * @param {Spreadsheet|Sheet|null} ss - Spreadsheet context
 * @param {string|null} league - Optional league for overrides
 * @param {boolean} forceRefresh - Force reload from sheet
 * @returns {Object} Config object
 */
function loadTier2Config(ss, league, forceRefresh) {
  // PATCH: Return cached if valid (prevents repeated failures)
  if (!forceRefresh && CONFIG_TIER2 !== null && CONFIG_TIER2_META.loadedAt) {
    var age = Date.now() - CONFIG_TIER2_META.loadedAt;
    var targetLeague = league ? String(league).trim().toLowerCase() : null;
    var sameLeague = CONFIG_TIER2_META.league === targetLeague;
    if (age < 300000 && sameLeague) {
      return CONFIG_TIER2;
    }
  }

  try {
    ss = _ensureSpreadsheet_(ss);
    if (!ss) {
      throw new Error('Spreadsheet not available');
    }
    
    // Normalize league
    var targetLeague = league ? String(league).trim().toLowerCase() : null;
    
    // Find config sheet
    var configSheetNames = [
      'Config_Tier2', 'ConfigTier2', 'Tier2Config', 
      'Config', 'Settings', 'Configuration'
    ];
    
    var sh = null;
    var sheetName = null;
    for (var i = 0; i < configSheetNames.length; i++) {
      sh = _getSheetByNameInsensitive_(ss, configSheetNames[i]);
      if (sh) {
        sheetName = configSheetNames[i];
        break;
      }
    }
    
    if (!sh) {
      throw new Error('Config sheet not found');
    }
    
    // Read sheet data
    var values = sh.getDataRange().getValues();
    if (!values || values.length < 2) {
      throw new Error('Config sheet has no data rows');
    }
    
    // Build header map
    var headers = values[0].map(function(h) {
      return String(h || '').toLowerCase().trim();
    });
    var hMap = {};
    for (var h = 0; h < headers.length; h++) {
      if (headers[h]) hMap[headers[h]] = h;
    }
    
    // Find columns (flexible naming)
    var keyCol = _firstDefined_(hMap, ['key', 'setting', 'parameter', 'name', 'param']);
    var valCol = _firstDefined_(hMap, ['value', 'val', 'setting_value']);
    var typeCol = _firstDefined_(hMap, ['type', 'datatype', 'valuetype']);
    var leagueCol = _firstDefined_(hMap, ['league', 'competition', 'sport']);
    var enabledCol = _firstDefined_(hMap, ['enabled', 'active', 'on']);
    
    // Default to columns A and B if no headers match
    if (keyCol === undefined) keyCol = 0;
    if (valCol === undefined) valCol = 1;
    
    // Parse config rows
    var baseConfig = {};
    var overrideConfig = {};
    var loadedCount = 0;
    
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var key = String(row[keyCol] || '').trim();
      
      // Skip blanks, comments
      if (!key || key.charAt(0) === '#' || key.substring(0, 2) === '//') {
        continue;
      }
      
      // Check enabled flag
      if (enabledCol !== undefined) {
        var enabled = _toBool_(row[enabledCol], true);
        if (!enabled) continue;
      }
      
      // Parse value
      var rawVal = row[valCol];
      var typeHint = typeCol !== undefined ? String(row[typeCol] || '').toLowerCase().trim() : '';
      var parsedVal = _parseConfigValue_(rawVal, typeHint, key);
      
      if (parsedVal === undefined) continue;
      
      // Normalize key
      var normalizedKey = _normalizeConfigKey_(key);
      
      // Determine if global or league-specific
      var rowLeague = leagueCol !== undefined ? 
        String(row[leagueCol] || '').trim().toLowerCase() : '';
      
      if (!rowLeague) {
        baseConfig[normalizedKey] = parsedVal;
        loadedCount++;
      } else if (targetLeague && rowLeague === targetLeague) {
        overrideConfig[normalizedKey] = parsedVal;
        loadedCount++;
      }
    }
    
    // Merge base + overrides
    var config = {};
    for (var bk in baseConfig) {
      config[bk] = baseConfig[bk];
    }
    for (var ok in overrideConfig) {
      config[ok] = overrideConfig[ok];
    }
    
    // PATCH: Check if config is effectively empty
    if (Object.keys(config).length === 0) {
      throw new Error('Config sheet produced empty config');
    }
    
    // Merge with elite defaults to fill any gaps
    var defaults = getEliteDefaults_();
    for (var dk in defaults) {
      if (config[dk] === undefined || config[dk] === null || config[dk] === '') {
        config[dk] = defaults[dk];
      }
    }
    
    // Type validation for numeric thresholds
    var numericKeys = ['ou_edge_threshold', 'ou_min_ev', 'ou_min_samples', 
                       'ou_confidence_scale', 'ou_american_odds', 'ou_push_width',
                       'threshold', 'momentum_swing_factor', 'variance_penalty_factor',
                       'confidence_scale', 'strong_target', 'medium_target', 'even_target'];
    for (var nk = 0; nk < numericKeys.length; nk++) {
      var numKey = numericKeys[nk];
      if (config[numKey] !== undefined && typeof config[numKey] !== 'number') {
        var parsed = Number(config[numKey]);
        if (isFinite(parsed)) {
          config[numKey] = parsed;
        }
      }
    }
    
    // Canonicalize config keys before caching
    if (typeof t2_canonicalizeConfig_ === 'function') {
      config = t2_canonicalizeConfig_(config);
    }
    
    // Cache the config
    CONFIG_TIER2 = config;
    CONFIG_TIER2_META = {
      loadedAt: Date.now(),
      source: sheetName,
      league: targetLeague
    };
    
    Logger.log('[loadTier2Config] Loaded ' + loadedCount + ' settings from "' + 
               sheetName + '" for league: ' + (targetLeague || 'global'));
    
    return config;
    
  } catch (e) {
    // PATCH: Fall back to elite defaults on ANY error
    Logger.log('[loadTier2Config] Error: ' + e.message + ' - Falling back to elite defaults');
    
    var defaults = getEliteDefaults_();
    
    CONFIG_TIER2 = defaults;
    CONFIG_TIER2_META = {
      loadedAt: Date.now(),
      source: 'ELITE_DEFAULTS_FALLBACK',
      league: null,
      error: e.message
    };
    
    return CONFIG_TIER2;
  }
}




/**
 * ============================================================================
 * getEliteDefaults_ v6.1 ELITE
 * ============================================================================
 * Complete defaults for all phases. Non-breaking: new keys are additive.
 * Organized by module/phase for clarity.
 */
function getEliteDefaults_() {
  return {
    // ═══════════════════════════════════════════════════════════════════
    // META
    // ═══════════════════════════════════════════════════════════════════
    version: 'elite_defaults_v6.1',
    config_version: 'elite_defaults_v6.1',
    
    // ═══════════════════════════════════════════════════════════════════
    // TIER 2 MARGIN ENGINE (Core)
    // ═══════════════════════════════════════════════════════════════════
    threshold: 3.0,
    momentum_swing_factor: 0.15,
    variance_penalty_factor: 0.20,
    decay: 0.9,
    h2h_boost: 1,
    
    // Quarter flip patterns
    q1_flip: false,
    q2_flip: false,
    q3_flip: false,
    q4_flip: false,
    
    // Tier classification targets
    strong_target: 0.75,
    medium_target: 0.65,
    even_target: 0.55,
    max_target: 0.90,
    
    // Confidence scaling
    confidence_scale: 30,
    min_confidence: 0.15,
    max_confidence: 0.95,
    
    // ═══════════════════════════════════════════════════════════════════
    // TIER 2 O/U ENGINE
    // ═══════════════════════════════════════════════════════════════════
    ou_edge_threshold: 0.02,
    ou_min_samples: 3,              // Safer than 1; prevents false confidence
    ou_min_ev: 0.005,               // 0.5%
    ou_min_conf: 55,                // Gate for accumulators
    ou_confidence_scale: 25,
    ou_preferred_samples: 30,       // Visual indicator threshold
    ou_sigma_floor: 6,
    ou_sigma_scale: 1.0,
    ou_shrink_k: 8,
    debug_ou_logging: false,
    
    // ═══════════════════════════════════════════════════════════════════
    // BAYESIAN / ADAPTIVE (Phase 2)
    // ═══════════════════════════════════════════════════════════════════
    margin_shrink_k: 8,
    momentum_cap_frac: 0.40,
    
    adapt_enabled: true,
    adapt_min_samples: 6,
    adapt_low_sample_boost_max: 0.55,
    adapt_volatility_boost_max: 0.45,
    adapt_margin_boost_max: 0.20,
    adapt_volatility_pivot: 10,
    adapt_confidence_floor: 0.20,
    
    // ═══════════════════════════════════════════════════════════════════
    // HIGHEST QUARTER / ACCUMULATOR (Module 9)
    // ═══════════════════════════════════════════════════════════════════
    includeHighestQuarter: true,
    enableEnhancedHighestQ: true,
    highQtrWinnerMargin: 1.5,
    highQtrTieMargin: 2.0,
    
    highQtrEnhConfig: {
      recentWeight: 0.25,
      paceWeight: 0.15,
      h2hWeight: 0.25,
      distributionWeight: 0.30,
      teamWinWeight: 0.10,
      tieMarginPts: 1.25,
      forceWinnerPts: 1.75
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // FIRST HALF PREDICTIONS
    // ═══════════════════════════════════════════════════════════════════
    enableFirstHalf: true,
    firstHalfMinConf: 58,
    homeAdvantage: 1.5,
    drawThreshold: 3.0,
    confPerPoint: 3.0,
    
    // ═══════════════════════════════════════════════════════════════════
    // CALIBRATION (Phase 5/6)
    // ═══════════════════════════════════════════════════════════════════
    calib_enabled: true,
    calib_bucket_size: 5,
    calib_min_per_bucket: 30,
    calib_min_conf: 45,
    calib_max_conf: 90,
    calib_allow_inflation: false,   // Safer: only deflate
    
    // O/U specific calibration
    ou_calibration_enabled: true,
    ou_calibration_bucket_size: 5,
    ou_calibration_min_per_bucket: 30,
    ou_calibration_min_conf: 45,
    ou_calibration_max_conf: 90,
    ou_calibration_allow_inflation: false,
    
    // ═══════════════════════════════════════════════════════════════════
    // TIER DISPLAY THRESHOLDS
    // ═══════════════════════════════════════════════════════════════════
    tier_elite_min_conf: 70,
    tier_elite_min_ev: 0.05,
    tier_strong_min_conf: 62,
    tier_strong_min_ev: 0.03,
    tier_medium_min_conf: 55,
    tier_medium_min_ev: 0.015,
    tier_weak_min_conf: 52.4,
    tier_weak_min_ev: 0.005,
    
    // ═══════════════════════════════════════════════════════════════════
    // DATA QUALITY / PARSER (Phase 6)
    // ═══════════════════════════════════════════════════════════════════
    dq_parser_debug: false,
    dq_include_audit_columns: false,    // Opt-in for debugging
    dq_max_scan_ahead: 12,
    dq_mismatch_log_limit: 15,
    dq_drop_mismatched_games: false,    // If true, aggregators skip MISMATCH rows
    dq_false_ot_enabled: true,          // Enable sanitizer OT validation
    dq_false_ot_eps: 0.01               // Tolerance for equality checks
  };
}


/**
 * =====================================================================
 * HELPER: parseGameDate
 * =====================================================================
 * WHY:
 *   Normalize various date formats into a JavaScript Date object.
 *
 * WHAT:
 *   Handles: Date objects, "DD/MM/YYYY", "YYYY-MM-DD", epoch numbers.
 *
 * WHERE:
 *   Module 1: Helpers.gs
 * =====================================================================
 */
function parseGameDate(val) {
  if (!val) return null;
  
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  
  if (typeof val === 'number') {
    // WHY: Could be epoch or Excel serial date
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  
  const str = String(val).trim();
  
  // WHY: Try DD/MM/YYYY format first (common in European data)
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const d = new Date(
      parseInt(ddmmyyyy[3], 10),
      parseInt(ddmmyyyy[2], 10) - 1,
      parseInt(ddmmyyyy[1], 10)
    );
    return isNaN(d.getTime()) ? null : d;
  }
  
  // WHY: Try ISO format YYYY-MM-DD
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10) - 1,
      parseInt(iso[3], 10)
    );
    return isNaN(d.getTime()) ? null : d;
  }
  
  // WHY: Last resort - let JavaScript try to parse it
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
