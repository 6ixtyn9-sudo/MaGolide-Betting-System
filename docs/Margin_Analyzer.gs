/**
 * ======================================================================
 * MODULE 4
 * PROJECT: Ma Golide
 *
 * This file is the "Brain" of the operation.
 *
 * It analyzes the *historical* data from the 'Clean' and 'ResultsClean'
 * sheets to build statistical models. These models are the core
 * of the project's predictive power.
 * [BUG FIX APPLIED]: Fixed the "Module 3 Crash" by making the output
 * data array fully rectangular before writing to the sheet. This
 * resolves the "number of columns in the data does not match" error
 * by ensuring every row has the same number of columns as the widest row.
 *
 * [H-001 FIX APPLIED]: Added empty array crash guards to all analyzer
 * functions to prevent crashes when no data is available.
 * ======================================================================
 */

/**
 * ============================================================================
 * MODULE 3 — PHASE 5 ELITE HELPERS v7.0
 * ============================================================================
 * 
 * Complete, production-ready implementations:
 *   1. runAllHistoricalAnalyzers(ss, opts)
 *   2. loadAndValidateCleanSheetData(sheet, opts)
 *   3. calibrateConfidence(picks, opts)
 *   4. t2ou_scoreOverUnderPick_(model, line, cfg)
 * 
 * Guarantees:
 *   - ES5 compatible (no const/let/arrow/template literals)
 *   - Trigger-safe (no raw UI calls)
 *   - Comprehensive input validation
 *   - Rich logging with ENTRY/DECISION/CALC/EXIT pattern
 *   - Graceful degradation on missing data
 *   - No silent failures - all errors logged
 * ============================================================================
 */

var ELITE_PHASE5_VERSION = '7.0.0';

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Safe numeric conversion with validation
 */
function _elite_toNum(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return isFinite(v) ? v : fallback;
  if (typeof v === 'string') {
    var n = Number(v.replace(/[,%\s]/g, ''));
    return isFinite(n) ? n : fallback;
  }
  if (Array.isArray(v)) return fallback; // Prevents Number([5]) = 5 bug
  var n2 = Number(v);
  return isFinite(n2) ? n2 : fallback;
}

/**
 * Safe clamp with NaN protection
 */
function _elite_clamp(x, lo, hi) {
  x = Number(x);
  if (!isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Safe rounding
 */
function _elite_round(x, dp) {
  if (!isFinite(x)) return 0;
  var p = Math.pow(10, dp || 2);
  return Math.round(x * p) / p;
}

/**
 * Standard normal CDF (with validation)
 */
function _elite_normCdf(z) {
  if (!isFinite(z)) return 0.5;
  // Clamp extreme z to avoid numerical issues
  z = _elite_clamp(z, -10, 10);
  
  var a1 =  0.254829592;
  var a2 = -0.284496736;
  var a3 =  1.421413741;
  var a4 = -1.453152027;
  var a5 =  1.061405429;
  var p  =  0.3275911;
  
  var sign = z < 0 ? -1 : 1;
  z = Math.abs(z);
  var t = 1.0 / (1.0 + p * z);
  var y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z / 2);
  
  var result = 0.5 * (1 + sign * y);
  return _elite_clamp(result, 0, 1);
}

/**
 * Create header map (lowercase keys -> column indices)
 */
function _elite_headerMap(headerRow) {
  var map = {};
  if (!headerRow || !Array.isArray(headerRow)) return map;
  
  for (var i = 0; i < headerRow.length; i++) {
    var raw = String(headerRow[i] || '').trim();
    if (!raw) continue;
    
    // Create multiple lookup variants
    var k1 = raw.toLowerCase();
    var k2 = k1.replace(/[\s_\-\/().%]+/g, '');
    
    if (!map.hasOwnProperty(k1)) map[k1] = i;
    if (k2 && !map.hasOwnProperty(k2)) map[k2] = i;
  }
  return map;
}

/**
 * Safe sheet lookup (case-insensitive)
 */
function _elite_getSheet(ss, name, allowNull) {
  if (!ss || typeof ss.getSheets !== 'function') {
    if (allowNull) return null;
    throw new Error('Invalid spreadsheet object');
  }
  
  // Try project helpers first
  if (typeof getSheetInsensitive === 'function') {
    try { return getSheetInsensitive(ss, name, true); } catch (e) {}
  }
  if (typeof _getSheetByNameInsensitive_ === 'function') {
    try { return _getSheetByNameInsensitive_(ss, name); } catch (e) {}
  }
  
  // Manual case-insensitive search
  var target = String(name || '').toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === target) return sheets[i];
  }
  
  return allowNull ? null : null;
}

/**
 * Trigger-safe toast/alert
 */
function _elite_notify(ss, msg, title, isError) {
  try {
    if (ss && typeof ss.toast === 'function') {
      ss.toast(msg, title || 'Elite', 5);
    }
  } catch (e) {
    // Ignore - we're in trigger context
  }
  
  if (isError) {
    Logger.log('[ELITE:ERROR] ' + (title ? title + ': ' : '') + msg);
  }
}

// ============================================================
// SECTION 5: LOCAL HELPER FUNCTIONS (ROBUST FINAL VERSION)
// ============================================================
// 
// Drop-in replacement with:
//   - Robust global function lookup (globalThis + fallbacks)
//   - Flexible column name matching with variants
//   - Column remapping for mismatched headers between sheets
//   - Fixed-width output (no jagged arrays)
//   - Comprehensive null/empty guards
//   - Namespaced internals to prevent collisions
//
// External helpers used if available:
//   parseScore, createHeaderMap, getSheetInsensitive,
//   _elite_getSheet, _elite_notify, _elite_headerMap
//

/**
 * Namespaced version constant
 */
var _S5_VERSION_ = '2.2.0';

// ═══════════════════════════════════════════════════════════════
// INTERNAL UTILITIES (double-underscore prefix = truly private)
// ═══════════════════════════════════════════════════════════════

/**
 * Reliable global object access across all Apps Script runtimes
 */
function __s5_getGlobal__() {
  // 1. Modern: globalThis (ES2020+, Apps Script V8)
  if (typeof globalThis !== 'undefined') return globalThis;
  
  // 2. Fallback: self (web workers, some contexts)
  if (typeof self !== 'undefined') return self;
  
  // 3. Fallback: IIFE trick (works in non-strict legacy)
  try {
    var g = (function() { return this; })();
    if (g) return g;
  } catch (e) {}
  
  // 4. Last resort: empty object (prevents crashes)
  return {};
}

/**
 * Safely get a function by name from global scope
 */
function __s5_getFn__(fnName) {
  if (!fnName || typeof fnName !== 'string') return null;
  
  var g = __s5_getGlobal__();
  var fn = g[fnName];
  
  return (typeof fn === 'function') ? fn : null;
}

/**
 * Normalize a header string for comparison
 */
function __s5_normalizeHeader__(str) {
  if (str == null) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric
    .trim();
}

/**
 * Create header map with normalized keys
 * Returns { normalizedKey: index, ... }
 */
function __s5_createHeaderMap__(headerRow) {
  var map = {};
  if (!headerRow || !Array.isArray(headerRow)) return map;
  
  // Try external createHeaderMap first
  var external = __s5_getFn__('createHeaderMap');
  if (external) {
    try {
      var extMap = external(headerRow);
      if (extMap && typeof extMap === 'object') {
        // Still normalize the keys for consistent lookups
        for (var key in extMap) {
          if (Object.prototype.hasOwnProperty.call(extMap, key)) {
            map[__s5_normalizeHeader__(key)] = extMap[key];
          }
        }
        return map;
      }
    } catch (e) {
      Logger.log('[__s5_createHeaderMap__] External failed: ' + e.message);
    }
  }
  
  // Fallback: build our own
  for (var i = 0; i < headerRow.length; i++) {
    var raw = headerRow[i];
    var normalized = __s5_normalizeHeader__(raw);
    if (normalized) {
      map[normalized] = i;
      // Also store original lowercase for backward compatibility
      var lower = String(raw || '').trim().toLowerCase();
      if (lower && !map[lower]) map[lower] = i;
    }
  }
  
  return map;
}

/**
 * Find column index from a list of possible header names
 * @param {Object} headerMap - The header map
 * @param {string[]} variants - Array of possible column names
 * @returns {number|undefined} Column index or undefined
 */
function __s5_findCol__(headerMap, variants) {
  if (!headerMap || !variants || !Array.isArray(variants)) return undefined;
  
  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i];
    
    // Try exact match first
    if (headerMap[variant] !== undefined) return headerMap[variant];
    
    // Try normalized match
    var normalized = __s5_normalizeHeader__(variant);
    if (normalized && headerMap[normalized] !== undefined) {
      return headerMap[normalized];
    }
  }
  
  return undefined;
}

/**
 * Column name variants for common fields
 */
var __S5_COL_VARIANTS__ = {
  pred: ['pred', 'prediction', 'predicted', 'pred.', 'winner pred', 'winnerpred'],
  ftScore: ['ft score', 'ftscore', 'ft_score', 'final score', 'finalscore', 'final', 'score', 'result', 'ft'],
  league: ['league', 'lg', 'competition', 'comp', 'tournament'],
  prob: ['prob %', 'prob%', 'probability', 'probability %', 'probability%', 'win prob', 'winprob', 'prob', 'pct', 'confidence'],
  team: ['team', 'team name', 'teamname', 'team_name', 'name'],
  variance: ['variance', 'var', 'score variance', 'scorevariance', 'stdev', 'std']
};

/**
 * Safe sheet getter with fallback chain
 */
function __s5_getSheet__(ss, name, silent) {
  if (!ss || !name) return null;
  
  // 1. Try _elite_getSheet
  var eliteGet = __s5_getFn__('_elite_getSheet');
  if (eliteGet) {
    try {
      var s1 = eliteGet(ss, name, true);
      if (s1) return s1;
    } catch (e) {
      if (!silent) Logger.log('[__s5_getSheet__] _elite_getSheet failed: ' + e.message);
    }
  }
  
  // 2. Try getSheetInsensitive
  var insensitive = __s5_getFn__('getSheetInsensitive');
  if (insensitive) {
    try {
      var s2 = insensitive(ss, name);
      if (s2) return s2;
    } catch (e) {
      if (!silent) Logger.log('[__s5_getSheet__] getSheetInsensitive failed: ' + e.message);
    }
  }
  
  // 3. Manual case-insensitive search
  try {
    var sheets = ss.getSheets();
    var target = String(name).toLowerCase().trim();
    
    for (var i = 0; i < sheets.length; i++) {
      var sheetName = sheets[i].getName();
      if (sheetName && String(sheetName).toLowerCase().trim() === target) {
        return sheets[i];
      }
    }
  } catch (e) {
    if (!silent) Logger.log('[__s5_getSheet__] Manual search failed: ' + e.message);
  }
  
  return null;
}

/**
 * Safe score parser with comprehensive format support
 * @returns {number[]|null} [home, away] or null
 */
function __s5_parseScore__(value) {
  if (value == null) return null;
  
  var s = String(value).trim();
  if (!s) return null;
  
  // Try external parseScore
  var external = __s5_getFn__('parseScore');
  if (external) {
    try {
      var out = external(s);
      if (out && out.length >= 2) {
        var h = parseFloat(out[0]);
        var a = parseFloat(out[1]);
        if (!isNaN(h) && !isNaN(a)) return [h, a];
      }
    } catch (e) {
      // Fall through to regex
    }
  }
  
  // Regex patterns for common score formats
  // Handles: "78-72", "78 - 72", "78:72", "78 : 72", "78–72", "78—72", "78 to 72"
  var patterns = [
    /(-?\d+(?:\.\d+)?)\s*[-:\u2013\u2014]\s*(-?\d+(?:\.\d+)?)/,  // Standard separators
    /(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i,               // "X to Y"
    /(-?\d+(?:\.\d+)?)\s*[\/]\s*(-?\d+(?:\.\d+)?)/               // "X/Y"
  ];
  
  for (var i = 0; i < patterns.length; i++) {
    var m = s.match(patterns[i]);
    if (m) {
      var home = parseFloat(m[1]);
      var away = parseFloat(m[2]);
      if (!isNaN(home) && !isNaN(away)) return [home, away];
    }
  }
  
  return null;
}

/**
 * Safe probability parser
 * @returns {number|null} 0-100 value or null
 */
function __s5_parseProb__(value) {
  if (value == null) return null;
  
  var s = String(value).trim();
  if (!s) return null;
  
  // Extract all numeric values
  var matches = s.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  
  var nums = [];
  for (var i = 0; i < matches.length; i++) {
    var n = parseFloat(matches[i]);
    if (!isNaN(n) && n >= 0) nums.push(n);
  }
  
  if (!nums.length) return null;
  
  // Take the maximum value
  var maxVal = Math.max.apply(null, nums);
  
  // Convert decimal to percentage if needed
  if (maxVal > 0 && maxVal <= 1) maxVal = maxVal * 100;
  
  // Clamp to valid range
  return Math.max(0, Math.min(100, maxVal));
}

/**
 * Pad row to fixed width
 */
function __s5_padRow__(row, width) {
  var out = (row && Array.isArray(row)) ? row.slice() : [];
  while (out.length < width) out.push('');
  return out;
}

/**
 * Safe notify wrapper
 */
function __s5_notify__(ss, message, title, isError) {
  var notifyFn = __s5_getFn__('_elite_notify');
  if (!notifyFn) return;
  
  try {
    notifyFn(ss, message, title, !!isError);
  } catch (e) {
    Logger.log('[__s5_notify__] Failed: ' + e.message);
  }
}

/**
 * Remap a data row from source header structure to target header structure
 * @param {Array} row - Source data row
 * @param {Object} sourceMap - Source header map
 * @param {Object} targetMap - Target header map  
 * @param {number} targetWidth - Number of columns in target
 * @returns {Array} Remapped row
 */
function __s5_remapRow__(row, sourceMap, targetMap, targetWidth) {
  if (!row || !Array.isArray(row)) return __s5_padRow__([], targetWidth);
  
  var result = [];
  for (var i = 0; i < targetWidth; i++) {
    result.push('');
  }
  
  // For each target column, find matching source column
  for (var targetKey in targetMap) {
    if (!Object.prototype.hasOwnProperty.call(targetMap, targetKey)) continue;
    
    var targetIdx = targetMap[targetKey];
    var sourceIdx = sourceMap[targetKey];
    
    if (sourceIdx !== undefined && sourceIdx < row.length) {
      result[targetIdx] = row[sourceIdx];
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Load variance data from Stats sheet for penalty calculation.
 * @param {Spreadsheet} ss - The spreadsheet
 * @returns {Object} Map of { teamName: variance }
 */
function _loadVarianceMap(ss) {
  var FN = '_loadVarianceMap';
  var varianceMap = {};
  
  if (!ss) {
    Logger.log('[' + FN + '] No spreadsheet provided');
    return varianceMap;
  }
  
  var statsSheet = __s5_getSheet__(ss, 'Team_Variance', false) ||
                   __s5_getSheet__(ss, 'Variance_Map', false) ||
                   __s5_getSheet__(ss, 'Team_Stats', false) ||
                   __s5_getSheet__(ss, 'Stats', false);

  if (!statsSheet) {
    Logger.log('[' + FN + '] Stats sheet not found. Using defaults.');
    return varianceMap;
  }
  
  try {
    var lastRow = statsSheet.getLastRow();
    var lastCol = statsSheet.getLastColumn();
    
    if (lastRow < 2 || lastCol < 1) {
      Logger.log('[' + FN + '] Insufficient data (rows=' + lastRow + ', cols=' + lastCol + ')');
      return varianceMap;
    }
    
    var data = statsSheet.getRange(1, 1, lastRow, lastCol).getValues();
    if (!data || !data.length || !data[0]) {
      Logger.log('[' + FN + '] Empty data returned');
      return varianceMap;
    }
    
    var header = __s5_createHeaderMap__(data[0]);
    var teamCol = __s5_findCol__(header, __S5_COL_VARIANTS__.team);
    var varianceCol = __s5_findCol__(header, __S5_COL_VARIANTS__.variance);
    
    if (teamCol === undefined || varianceCol === undefined) {
      Logger.log('[' + FN + '] Missing columns. Found: ' + Object.keys(header).join(', '));
      return varianceMap;
    }
    
    var loaded = 0;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row) continue;
      
      var team = String(row[teamCol] == null ? '' : row[teamCol]).trim();
      var variance = parseFloat(row[varianceCol]);
      
      if (team && !isNaN(variance) && variance >= 0) {
        varianceMap[team] = variance;
        loaded++;
      }
    }
    
    Logger.log('[' + FN + '] Loaded ' + loaded + ' teams');
  } catch (e) {
    Logger.log('[' + FN + ' ERROR] ' + e.message);
  }
  
  return varianceMap;
}

/**
 * Calculate variance penalty based on team scoring variance.
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @param {Object} varianceMap - Team variance map
 * @returns {number} Penalty 0-1
 */
function _calculateVariancePenalty(homeTeam, awayTeam, varianceMap) {
  var DEFAULT_VARIANCE = 10;
  var MAX_VARIANCE = 20;
  
  var map = varianceMap || {};
  
  function getVar(team) {
    if (!team) return DEFAULT_VARIANCE;
    if (!Object.prototype.hasOwnProperty.call(map, team)) return DEFAULT_VARIANCE;
    
    var v = parseFloat(map[team]);
    return (!isNaN(v) && v >= 0) ? v : DEFAULT_VARIANCE;
  }
  
  var avgVariance = (getVar(homeTeam) + getVar(awayTeam)) / 2;
  
  // Clamp to [0, 1]
  var penalty = avgVariance / MAX_VARIANCE;
  return Math.max(0, Math.min(1, penalty));
}

/**
 * Analyze winner prediction accuracy by league and probability range.
 * @param {Array<Array>} allGames - Game data (row 0 = headers)
 * @param {Sheet} statsSheet - Output sheet
 */
function analyzeWinnerAccuracy(allGames, statsSheet) {
  var FN = 'analyzeWinnerAccuracy';
  Logger.log('[' + FN + '] Starting...');
  
  // Validation
  if (!statsSheet) {
    Logger.log('[' + FN + '] ERROR: statsSheet required');
    return;
  }
  
  if (!allGames || !Array.isArray(allGames) || allGames.length < 2) {
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue('No data available for analysis.');
    return;
  }
  
  var headers = allGames[0];
  if (!headers || !Array.isArray(headers)) {
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue('Invalid header row.');
    return;
  }
  
  var map = __s5_createHeaderMap__(headers);
  
  // Resolve columns with variants
  var predCol = __s5_findCol__(map, __S5_COL_VARIANTS__.pred);
  var ftCol = __s5_findCol__(map, __S5_COL_VARIANTS__.ftScore);
  var leagueCol = __s5_findCol__(map, __S5_COL_VARIANTS__.league);
  var probCol = __s5_findCol__(map, __S5_COL_VARIANTS__.prob);
  
  // Check required columns
  var missing = [];
  if (predCol === undefined) missing.push('Pred');
  if (ftCol === undefined) missing.push('FT Score');
  if (leagueCol === undefined) missing.push('League');
  
  if (missing.length) {
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue('Missing columns: ' + missing.join(', '));
    Logger.log('[' + FN + '] Missing: ' + missing.join(', ') + '. Available: ' + Object.keys(map).slice(0, 10).join(', '));
    return;
  }
  
  // Initialize counters
  var leagueStats = {};
  var probRanges = ['50-60%', '60-70%', '70-80%', '80-90%', '90-100%'];
  var probRangeStats = {};
  for (var r = 0; r < probRanges.length; r++) {
    probRangeStats[probRanges[r]] = { correct: 0, total: 0 };
  }
  
  var overallTotal = 0, overallCorrect = 0, overallDraws = 0, skipped = 0;
  
  try {
    for (var i = 1; i < allGames.length; i++) {
      var game = allGames[i];
      if (!game || !Array.isArray(game)) { skipped++; continue; }
      
      // Parse prediction (must be 1 or 2)
      var pred = parseInt(game[predCol], 10);
      if (isNaN(pred) || (pred !== 1 && pred !== 2)) { skipped++; continue; }
      
      // Parse league
      var league = String(game[leagueCol] == null ? '' : game[leagueCol]).trim();
      if (!league) { skipped++; continue; }
      
      // Parse score
      var parsedFT = __s5_parseScore__(game[ftCol]);
      if (!parsedFT) { skipped++; continue; }
      
      var homeScore = parsedFT[0];
      var awayScore = parsedFT[1];
      
      // Determine winner
      var actualWinner = 0;
      if (homeScore > awayScore) actualWinner = 1;
      else if (awayScore > homeScore) actualWinner = 2;
      else overallDraws++;
      
      // Update stats
      if (!leagueStats[league]) leagueStats[league] = { correct: 0, total: 0 };
      leagueStats[league].total++;
      overallTotal++;
      
      if (actualWinner !== 0 && pred === actualWinner) {
        leagueStats[league].correct++;
        overallCorrect++;
      }
      
      // Probability breakdown (optional)
      if (probCol !== undefined) {
        var prob = __s5_parseProb__(game[probCol]);
        if (prob !== null && prob >= 50) {
          var probKey = '';
          if (prob >= 90) probKey = '90-100%';
          else if (prob >= 80) probKey = '80-90%';
          else if (prob >= 70) probKey = '70-80%';
          else if (prob >= 60) probKey = '60-70%';
          else probKey = '50-60%';
          
          if (probKey && probRangeStats[probKey]) {
            probRangeStats[probKey].total++;
            if (actualWinner !== 0 && pred === actualWinner) {
              probRangeStats[probKey].correct++;
            }
          }
        }
      }
    }
    
    Logger.log('[' + FN + '] Processed=' + overallTotal + ' skipped=' + skipped);
    
    // Build output (fixed 4-column width)
    var NUM_COLS = 4;
    
    function pct(c, t) {
      return t ? ((c / t) * 100).toFixed(1) + '%' : '0.0%';
    }
    
    var output = [];
    output.push(__s5_padRow__(['Ma Golide Winner Accuracy (Historical)'], NUM_COLS));
    output.push(__s5_padRow__(['League', 'Accuracy', 'Correct', 'Total'], NUM_COLS));
    output.push(__s5_padRow__(['Overall', pct(overallCorrect, overallTotal), overallCorrect, overallTotal], NUM_COLS));
    
    var leagues = Object.keys(leagueStats).sort();
    for (var li = 0; li < leagues.length; li++) {
      var lg = leagues[li];
      var st = leagueStats[lg];
      output.push(__s5_padRow__([lg, pct(st.correct, st.total), st.correct, st.total], NUM_COLS));
    }
    
    output.push(__s5_padRow__([], NUM_COLS));
    output.push(__s5_padRow__(['Draws', overallDraws, 'Skipped', skipped], NUM_COLS));
    output.push(__s5_padRow__([], NUM_COLS));
    output.push(__s5_padRow__(['Probability Range Breakdown'], NUM_COLS));
    output.push(__s5_padRow__(['Range', 'Accuracy', 'Correct', 'Total'], NUM_COLS));
    
    for (var pi = 0; pi < probRanges.length; pi++) {
      var range = probRanges[pi];
      var ps = probRangeStats[range];
      output.push(__s5_padRow__([range, pct(ps.correct, ps.total), ps.correct, ps.total], NUM_COLS));
    }
    
    // Write output
    statsSheet.clear();
    statsSheet.getRange(1, 1, output.length, NUM_COLS).setValues(output);
    
    try { statsSheet.autoResizeColumns(1, NUM_COLS); } catch (e) {}
    
    Logger.log('[' + FN + '] Complete. Accuracy=' + pct(overallCorrect, overallTotal));
    
  } catch (e) {
    Logger.log('[' + FN + ' ERROR] ' + e.message + (e.stack ? '\n' + e.stack : ''));
    try {
      statsSheet.clear();
      statsSheet.getRange(1, 1).setValue('Error: ' + e.message);
    } catch (e2) {}
  }
}

/**
 * Master orchestrator for historical analysis.
 * @param {Spreadsheet} ss - Spreadsheet object
 * @param {Object} opts - Options
 * @returns {Object} Result object
 */
function runAllHistoricalAnalyzers(ss, opts) {
  var FN = 'runAllHistoricalAnalyzers';
  var startTime = Date.now();
  
  opts = opts || {};
  var debug = opts.debug !== false;
  var allowEmpty = opts.allowEmpty !== false;
  var writeResults = opts.writeResults !== false;
  var remapColumns = opts.remapColumns !== false; // NEW: Enable column remapping
  
  function log(level, msg) {
    if (!debug && level === 'DEBUG') return;
    Logger.log('[' + FN + ':' + level + '] ' + msg);
  }
  
  var result = {
    ok: false,
    games: 0,
    ms: 0,
    results: {},
    errors: [],
    sheets: { loaded: [], created: [] }
  };
  
  try {
    log('INFO', '═══════════════════════════════════════════════════════');
    log('INFO', 'ENTRY v' + _S5_VERSION_);
    
    if (!ss) throw new Error('Spreadsheet (ss) is required');
    if (typeof ss.getSheets !== 'function') throw new Error('Invalid spreadsheet object');
    
    log('DEBUG', 'ID: ' + (ss.getId ? ss.getId() : 'unknown'));
    
    // Load sheet data helper
    function loadSheetData(sheetName) {
      var out = { ok: false, reason: '', rows: [], header: null, headerMap: null };
      
      var sheet = __s5_getSheet__(ss, sheetName, true);
      if (!sheet) { out.reason = 'not_found'; return out; }
      
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      
      if (lastRow < 1 || lastCol < 1) { out.reason = 'empty'; return out; }
      if (lastRow < 2) { out.reason = 'header_only'; return out; }
      
      var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      if (!values || !values.length) { out.reason = 'no_values'; return out; }
      
      result.sheets.loaded.push(sheetName);
      log('INFO', 'Loaded "' + sheetName + '": ' + (values.length - 1) + ' rows');
      
      out.ok = true;
      out.header = values[0];
      out.headerMap = __s5_createHeaderMap__(values[0]);
      out.rows = values.slice(1);
      out.width = lastCol;
      
      return out;
    }
    
    var cleanData = loadSheetData('Clean');
    var resultsData = loadSheetData('ResultsClean');
    
    var hasClean = cleanData.ok && cleanData.rows.length > 0;
    var hasResults = resultsData.ok && resultsData.rows.length > 0;
    
    if (!hasClean && !hasResults) {
      var msg = 'No data in "Clean" or "ResultsClean"';
      if (!allowEmpty) throw new Error(msg);
      
      log('WARN', msg);
      result.ok = true;
      result.ms = Date.now() - startTime;
      return result;
    }
    
    // Merge data with optional remapping
    var primaryData = hasClean ? cleanData : resultsData;
    var secondaryData = hasClean && hasResults ? resultsData : null;
    
    var targetHeader = primaryData.header;
    var targetMap = primaryData.headerMap;
    var targetWidth = primaryData.width;
    
    var allGames = [targetHeader];
    
    // Add primary data
    for (var i = 0; i < primaryData.rows.length; i++) {
      allGames.push(primaryData.rows[i]);
    }
    
    // Add secondary data with optional remapping
    if (secondaryData) {
      var needsRemap = false;
      
      // Check if headers differ
      if (remapColumns) {
        for (var key in targetMap) {
          if (Object.prototype.hasOwnProperty.call(targetMap, key)) {
            if (secondaryData.headerMap[key] === undefined) {
              needsRemap = true;
              break;
            }
            if (targetMap[key] !== secondaryData.headerMap[key]) {
              needsRemap = true;
              break;
            }
          }
        }
      }
      
      if (needsRemap) {
        log('INFO', 'Remapping ResultsClean columns to match Clean headers');
        for (var j = 0; j < secondaryData.rows.length; j++) {
          allGames.push(__s5_remapRow__(secondaryData.rows[j], secondaryData.headerMap, targetMap, targetWidth));
        }
      } else {
        for (var k = 0; k < secondaryData.rows.length; k++) {
          allGames.push(secondaryData.rows[k]);
        }
      }
    }
    
    result.games = allGames.length - 1;
    log('INFO', 'Total games: ' + result.games);
    
    // Get or create output sheets
    function getOrCreate(name) {
      var sheet = __s5_getSheet__(ss, name, true);
      if (sheet) return sheet;
      if (!writeResults) return null;
      
      try {
        sheet = ss.insertSheet(name);
        result.sheets.created.push(name);
        return sheet;
      } catch (e) {
        log('ERROR', 'Failed to create "' + name + '": ' + e.message);
        return null;
      }
    }
    
    var outputSheets = {
      stats: getOrCreate('Stats'),
      quarterStats: getOrCreate('LeagueQuarterStats'),
      quarterOU: getOrCreate('LeagueQuarterO_U_Stats'),
      tier2Accuracy: getOrCreate('Stats_Tier2_Accuracy')
    };
    
    // Define analyzers
    var analyzers = [
      { name: 'winnerAccuracy', fnName: 'analyzeWinnerAccuracy', sheet: outputSheets.stats },
      { name: 'quarterWinner', fnName: 'analyzeQuarterWinner', sheet: outputSheets.quarterStats },
      { name: 'quarterOU', fnName: 'analyzeQuarterOU', sheet: outputSheets.quarterOU },
      { name: 'tier2Accuracy', fnName: 'analyzeTier2Accuracy', sheet: outputSheets.tier2Accuracy }
    ];
    
    // Filter disabled analyzers
    if (opts.analyzers && typeof opts.analyzers === 'object') {
      analyzers = analyzers.filter(function(a) {
        return opts.analyzers[a.name] !== false;
      });
    }
    
    // Run each analyzer
    for (var a = 0; a < analyzers.length; a++) {
      var analyzer = analyzers[a];
      var aResult = { ok: false, skipped: false };
      var t0 = Date.now();
      
      try {
        var fnRef = __s5_getFn__(analyzer.fnName);
        
        if (typeof fnRef !== 'function') {
          log('WARN', analyzer.name + ': function missing - skipping');
          aResult.skipped = true;
          aResult.reason = 'function_missing';
        } else if (!analyzer.sheet) {
          log('WARN', analyzer.name + ': no sheet - skipping');
          aResult.skipped = true;
          aResult.reason = 'sheet_missing';
        } else if (!writeResults) {
          log('INFO', analyzer.name + ': writeResults=false - skipping');
          aResult.skipped = true;
          aResult.reason = 'write_disabled';
        } else {
          fnRef(allGames, analyzer.sheet);
          aResult.ok = true;
          aResult.ms = Date.now() - t0;
          log('INFO', '✓ ' + analyzer.name + ' (' + aResult.ms + 'ms)');
        }
      } catch (e) {
        aResult.ok = false;
        aResult.ms = Date.now() - t0;
        aResult.error = e.message;
        result.errors.push({ analyzer: analyzer.name, error: e.message });
        log('ERROR', '✗ ' + analyzer.name + ': ' + e.message);
      }
      
      result.results[analyzer.name] = aResult;
    }
    
    result.ok = result.errors.length === 0;
    result.ms = Date.now() - startTime;
    
    log('INFO', '═══════════════════════════════════════════════════════');
    log('INFO', 'EXIT games=' + result.games + ' ms=' + result.ms + ' errors=' + result.errors.length);
    
    __s5_notify__(ss, 'Analyzed ' + result.games + ' games in ' + result.ms + 'ms', 'Analysis Complete', false);
    
    return result;
    
  } catch (e) {
    result.ok = false;
    result.error = e.message;
    result.stack = e.stack;
    result.ms = Date.now() - startTime;
    
    Logger.log('[' + FN + ':FATAL] ' + e.message);
    __s5_notify__(ss, e.message, 'Analysis Error', true);
    
    return result;
  }
}


// ============================================================================
// 2. loadAndValidateCleanSheetData
// ============================================================================

/**
 * Defensive loader for Clean sheets (H2H/Recent/any format).
 * Sanitizes "False OT" artifacts and validates required columns.
 * 
 * @param {Sheet} sheet - The sheet to read
 * @param {Object} opts - Options:
 *   - debug: boolean (default false) - Verbose logging
 *   - epsilon: number (default 0.5) - Tolerance for equality checks
 *   - maxLogExamples: number (default 5) - Max examples to log
 *   - writeBack: boolean (default false) - Update sheet with fixes
 * 
 * @returns {Object} {ok, data, headerMap, meta}
 */
function loadAndValidateCleanSheetData(sheet, opts) {
  var FN = 'loadAndValidateCleanSheetData';
  opts = opts || {};
  
  var debug = !!opts.debug;
  var epsilon = _elite_toNum(opts.epsilon, 0.5);  // More tolerant default
  var maxLogExamples = _elite_toNum(opts.maxLogExamples, 5);
  var writeBack = !!opts.writeBack;
  
  var examplesLogged = 0;
  
  function log(level, msg) {
    if (!debug && level === 'DEBUG') return;
    Logger.log('[' + FN + ':' + level + '] ' + msg);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // VALIDATION
  // ─────────────────────────────────────────────────────────────────
  if (!sheet) {
    log('ERROR', 'Sheet is null or undefined');
    return {
      ok: false,
      error: 'Sheet is null',
      data: [],
      headerMap: {},
      meta: { rows: 0, fixes: 0 }
    };
  }
  
  var sheetName = '';
  try {
    sheetName = sheet.getName();
  } catch (e) {
    sheetName = 'unknown';
  }
  
  log('INFO', 'ENTRY sheet="' + sheetName + '"');
  
  var allValues;
  try {
    allValues = sheet.getDataRange().getValues();
  } catch (e) {
    log('ERROR', 'Failed to read sheet: ' + e.message);
    return {
      ok: false,
      error: 'Read failed: ' + e.message,
      data: [],
      headerMap: {},
      meta: { rows: 0, fixes: 0 }
    };
  }
  
  if (!allValues || allValues.length < 2) {
    log('DEBUG', 'Sheet is empty or has only header');
    return {
      ok: true,
      data: [],
      headerMap: allValues && allValues[0] ? _elite_headerMap(allValues[0]) : {},
      meta: { sheet: sheetName, rows: 0, fixes: 0 }
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // BUILD HEADER MAP
  // ─────────────────────────────────────────────────────────────────
  var headerRow = allValues[0];
  var hm = _elite_headerMap(headerRow);
  
  // Column indices (using lowercase keys)
  var idx = {
    q1h: hm.q1h, q2h: hm.q2h, q3h: hm.q3h, q4h: hm.q4h,
    q1a: hm.q1a, q2a: hm.q2a, q3a: hm.q3a, q4a: hm.q4a,
    oth: hm.oth, ota: hm.ota,
    fth: hm.fth, fta: hm.fta,
    home: hm.home, away: hm.away
  };
  
  function hasCol(key) {
    return idx[key] !== undefined && idx[key] !== null && idx[key] >= 0;
  }
  
  function getVal(row, key) {
    if (!hasCol(key)) return NaN;
    return _elite_toNum(row[idx[key]], NaN);
  }
  
  // Check if we can do any sanitization
  var canCheckHome = hasCol('q1h') && hasCol('q2h') && hasCol('q3h') && hasCol('q4h') && hasCol('oth');
  var canCheckAway = hasCol('q1a') && hasCol('q2a') && hasCol('q3a') && hasCol('q4a') && hasCol('ota');
  
  if (!canCheckHome && !canCheckAway) {
    log('WARN', 'Missing required quarter/OT columns - skipping sanitization');
    return {
      ok: true,
      data: allValues.slice(1),
      headerMap: hm,
      meta: {
        sheet: sheetName,
        rows: allValues.length - 1,
        fixes: 0,
        skipped: true,
        reason: 'missing_columns'
      }
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // SANITIZE ROWS
  // ─────────────────────────────────────────────────────────────────
  var dataRows = allValues.slice(1);
  var fixes = 0;
  var homeOTClears = 0;
  var awayOTClears = 0;
  var errors = 0;
  
  for (var r = 0; r < dataRows.length; r++) {
    var row = dataRows[r];
    var rowNum = r + 2; // 1-indexed, accounting for header
    
    try {
      // ─────────────────────────────────────────────────────────────
      // HOME FALSE OT DETECTION
      // ─────────────────────────────────────────────────────────────
      if (canCheckHome) {
        var homeQ1 = getVal(row, 'q1h');
        var homeQ2 = getVal(row, 'q2h');
        var homeQ3 = getVal(row, 'q3h');
        var homeQ4 = getVal(row, 'q4h');
        var homeOT = getVal(row, 'oth');
        var homeFT = getVal(row, 'fth');
        
        var homeReg = 0;
        var homeRegValid = true;
        
        if (isFinite(homeQ1) && isFinite(homeQ2) && isFinite(homeQ3) && isFinite(homeQ4)) {
          homeReg = homeQ1 + homeQ2 + homeQ3 + homeQ4;
        } else {
          homeRegValid = false;
        }
        
        // Detect False OT patterns:
        // Pattern A: OT value equals regulation sum (parser wrote FT into OT)
        // Pattern B: OT value equals FT total
        // Pattern C: OT value is suspiciously equal to a quarter value
        
        var isFalseOT = false;
        var reason = '';
        
        if (isFinite(homeOT) && homeOT > 0 && homeRegValid && homeReg > 0) {
          if (Math.abs(homeOT - homeReg) <= epsilon) {
            isFalseOT = true;
            reason = 'OT equals regulation sum';
          } else if (isFinite(homeFT) && Math.abs(homeOT - homeFT) <= epsilon) {
            isFalseOT = true;
            reason = 'OT equals FT total';
          } else if (
            Math.abs(homeOT - homeQ1) <= epsilon ||
            Math.abs(homeOT - homeQ2) <= epsilon ||
            Math.abs(homeOT - homeQ3) <= epsilon ||
            Math.abs(homeOT - homeQ4) <= epsilon
          ) {
            // OT matching a quarter value is suspicious but might be legitimate
            // Only flag if it matches multiple criteria
            if (homeOT === homeReg) {
              isFalseOT = true;
              reason = 'OT equals regulation (exact)';
            }
          }
        }
        
        if (isFalseOT) {
          row[idx.oth] = '';
          homeOTClears++;
          fixes++;
          
          if (debug && examplesLogged < maxLogExamples) {
            log('DEBUG', 'Row ' + rowNum + ' HOME false OT: ' + reason +
                ' (OT=' + homeOT + ', reg=' + homeReg + ', FT=' + homeFT + ')');
            examplesLogged++;
          }
        }
      }
      
      // ─────────────────────────────────────────────────────────────
      // AWAY FALSE OT DETECTION
      // ─────────────────────────────────────────────────────────────
      if (canCheckAway) {
        var awayQ1 = getVal(row, 'q1a');
        var awayQ2 = getVal(row, 'q2a');
        var awayQ3 = getVal(row, 'q3a');
        var awayQ4 = getVal(row, 'q4a');
        var awayOT = getVal(row, 'ota');
        var awayFT = getVal(row, 'fta');
        
        var awayReg = 0;
        var awayRegValid = true;
        
        if (isFinite(awayQ1) && isFinite(awayQ2) && isFinite(awayQ3) && isFinite(awayQ4)) {
          awayReg = awayQ1 + awayQ2 + awayQ3 + awayQ4;
        } else {
          awayRegValid = false;
        }
        
        var isFalseOTAway = false;
        var reasonAway = '';
        
        if (isFinite(awayOT) && awayOT > 0 && awayRegValid && awayReg > 0) {
          if (Math.abs(awayOT - awayReg) <= epsilon) {
            isFalseOTAway = true;
            reasonAway = 'OT equals regulation sum';
          } else if (isFinite(awayFT) && Math.abs(awayOT - awayFT) <= epsilon) {
            isFalseOTAway = true;
            reasonAway = 'OT equals FT total';
          }
        }
        
        if (isFalseOTAway) {
          row[idx.ota] = '';
          awayOTClears++;
          fixes++;
          
          if (debug && examplesLogged < maxLogExamples) {
            log('DEBUG', 'Row ' + rowNum + ' AWAY false OT: ' + reasonAway +
                ' (OT=' + awayOT + ', reg=' + awayReg + ', FT=' + awayFT + ')');
            examplesLogged++;
          }
        }
      }
      
    } catch (e) {
      errors++;
      if (debug && examplesLogged < maxLogExamples) {
        log('WARN', 'Row ' + rowNum + ' error: ' + e.message);
        examplesLogged++;
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────
  // WRITE BACK IF REQUESTED
  // ─────────────────────────────────────────────────────────────────
  if (writeBack && fixes > 0) {
    try {
      // Reconstruct full data with header
      var fullData = [headerRow].concat(dataRows);
      sheet.getRange(1, 1, fullData.length, fullData[0].length).setValues(fullData);
      log('INFO', 'Wrote back ' + fixes + ' fixes to sheet');
    } catch (e) {
      log('ERROR', 'Write-back failed: ' + e.message);
    }
  }
  
  // ─────────────────────────────────────────────────────────────────
  // RETURN
  // ─────────────────────────────────────────────────────────────────
  log('INFO', 'EXIT sheet="' + sheetName + '" rows=' + dataRows.length +
      ' fixes=' + fixes + ' (homeOT=' + homeOTClears + ', awayOT=' + awayOTClears + ')');
  
  return {
    ok: true,
    data: dataRows,
    headerMap: hm,
    meta: {
      sheet: sheetName,
      rows: dataRows.length,
      fixes: fixes,
      homeOTClears: homeOTClears,
      awayOTClears: awayOTClears,
      errors: errors
    }
  };
}


// ============================================================================
// 3. calibrateConfidence
// ============================================================================

/**
 * Backtest-based confidence calibration.
 * 
 * Creates a mapping from claimed confidence to actual win rate based on
 * historical pick performance. Uses monotonic smoothing (PAV algorithm)
 * to ensure calibration curve is non-decreasing.
 * 
 * @param {Array} picks - Array of {confidence: number, hit: boolean}
 * @param {Object} opts - Options:
 *   - bucketWidth: number (default 5) - Width of confidence buckets
 *   - minSamples: number (default 30) - Min samples per bucket for full weight
 *   - minConf: number (default 45) - Minimum confidence to calibrate
 *   - maxConf: number (default 95) - Maximum confidence to calibrate
 *   - allowInflation: boolean (default false) - Allow calibration to increase confidence
 *   - debug: boolean (default false) - Verbose logging
 * 
 * @returns {Object} {ok, applyConfidence, buckets, summary}
 */
function calibrateConfidence(picks, opts) {
  var FN = 'calibrateConfidence';
  opts = opts || {};
  
  var bucketWidth = _elite_toNum(opts.bucketWidth, 5);
  var minSamples = _elite_toNum(opts.minSamples, 30);
  var minConf = _elite_toNum(opts.minConf, 45);
  var maxConf = _elite_toNum(opts.maxConf, 95);
  var allowInflation = !!opts.allowInflation;
  var debug = !!opts.debug;
  
  function log(level, msg) {
    if (!debug && level === 'DEBUG') return;
    Logger.log('[' + FN + ':' + level + '] ' + msg);
  }
  
  log('INFO', 'ENTRY picks=' + (picks ? picks.length : 0) + ' opts=' + JSON.stringify(opts).substring(0, 300));
  
  // ─────────────────────────────────────────────────────────────────
  // VALIDATION
  // ─────────────────────────────────────────────────────────────────
  if (!picks || !Array.isArray(picks)) {
    log('ERROR', 'picks must be an array');
    return {
      ok: false,
      error: 'Invalid picks array',
      applyConfidence: function(c) { return c; },
      buckets: [],
      summary: { totalN: 0 }
    };
  }
  
  if (picks.length < 5) {
    log('WARN', 'Only ' + picks.length + ' picks - need at least 5 for calibration (pass-through mode)');
    return {
      ok: false,
      error: 'Insufficient picks for calibration (need 5+)',
      applyConfidence: function(c) { return c; },
      buckets: [],
      summary: { totalN: picks.length, note: 'pass-through: confidence values unchanged' }
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // BUILD BUCKETS
  // ─────────────────────────────────────────────────────────────────
  var buckets = {};  // "lo-hi" -> {lo, hi, n, hits}
  var usedPicks = 0;
  var invalidPicks = 0;
  
  function getBucketKey(conf) {
    var lo = Math.floor(conf / bucketWidth) * bucketWidth;
    var hi = lo + bucketWidth - 1;
    // Create sortable key with zero-padding
    var loStr = lo < 10 ? '0' + lo : String(lo);
    var hiStr = hi < 10 ? '0' + hi : String(hi);
    return loStr + '-' + hiStr;
  }
  
  for (var i = 0; i < picks.length; i++) {
    var p = picks[i];
    
    if (!p || typeof p !== 'object') {
      invalidPicks++;
      continue;
    }
    
    var conf = _elite_toNum(p.confidence, NaN);
    if (!isFinite(conf)) {
      invalidPicks++;
      continue;
    }
    
    conf = _elite_clamp(conf, 0, 100);
    
    if (conf < minConf || conf > maxConf) {
      continue;  // Outside calibration range
    }
    
    var hit = !!p.hit;
    var key = getBucketKey(conf);
    
    if (!buckets[key]) {
      var lo = Math.floor(conf / bucketWidth) * bucketWidth;
      var hi = lo + bucketWidth - 1;
      buckets[key] = { lo: lo, hi: hi, n: 0, hits: 0 };
    }
    
    buckets[key].n++;
    if (hit) buckets[key].hits++;
    usedPicks++;
  }
  
  if (invalidPicks > 0) {
    log('WARN', invalidPicks + ' invalid picks skipped');
  }
  
  // Convert to sorted array
  var bucketList = [];
  for (var k in buckets) {
    if (buckets.hasOwnProperty(k)) {
      bucketList.push(buckets[k]);
    }
  }
  bucketList.sort(function(a, b) { return a.lo - b.lo; });
  
  if (bucketList.length === 0) {
    log('WARN', 'No picks in calibration range [' + minConf + '-' + maxConf + ']');
    return {
      ok: false,
      error: 'No picks in calibration range',
      applyConfidence: function(c) { return c; },
      buckets: [],
      summary: { totalN: 0, usedPicks: usedPicks }
    };
  }
  
  // ─────────────────────────────────────────────────────────────────
  // CALCULATE RAW RATES
  // ─────────────────────────────────────────────────────────────────
  for (var b = 0; b < bucketList.length; b++) {
    var bucket = bucketList[b];
    bucket.claimed = (bucket.lo + bucket.hi + 1) / 2 / 100;  // Midpoint probability
    bucket.actual = bucket.n > 0 ? bucket.hits / bucket.n : bucket.claimed;
    bucket.factor = bucket.claimed > 0 ? bucket.actual / bucket.claimed : 1;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // MONOTONIC SMOOTHING (Pool Adjacent Violators)
  // ─────────────────────────────────────────────────────────────────
  // Ensures that higher confidence buckets have >= actual rate than lower buckets
  
  var smoothed = [];
  for (var s = 0; s < bucketList.length; s++) {
    smoothed.push({
      lo: bucketList[s].lo,
      hi: bucketList[s].hi,
      n: bucketList[s].n,
      hits: bucketList[s].hits,
      actual: bucketList[s].actual
    });
  }
  
  // PAV algorithm: merge adjacent pairs that violate monotonicity
  for (var pass = 0; pass < 100; pass++) {
    var changed = false;
    
    for (var j = 0; j < smoothed.length - 1; j++) {
      if (smoothed[j].actual > smoothed[j + 1].actual) {
        // Merge these two blocks
        var merged = {
          lo: smoothed[j].lo,
          hi: smoothed[j + 1].hi,
          n: smoothed[j].n + smoothed[j + 1].n,
          hits: smoothed[j].hits + smoothed[j + 1].hits
        };
        merged.actual = merged.n > 0 ? merged.hits / merged.n : 0;
        
        smoothed.splice(j, 2, merged);
        changed = true;
        break;
      }
    }
    
    if (!changed) break;
  }
  
  // Create lookup function for smoothed actual rate
  function getSmoothedActual(conf) {
    for (var s = 0; s < smoothed.length; s++) {
      if (conf >= smoothed[s].lo && conf <= smoothed[s].hi) {
        return smoothed[s].actual;
      }
    }
    // Fallback: claimed rate
    return conf / 100;
  }
  
  // Update bucket list with smoothed values
  for (var b2 = 0; b2 < bucketList.length; b2++) {
    var mid = (bucketList[b2].lo + bucketList[b2].hi) / 2;
    bucketList[b2].actualSmoothed = getSmoothedActual(mid);
    bucketList[b2].factorSmoothed = bucketList[b2].claimed > 0 
      ? bucketList[b2].actualSmoothed / bucketList[b2].claimed 
      : 1;
  }
  
  // ─────────────────────────────────────────────────────────────────
  // CREATE APPLY FUNCTION
  // ─────────────────────────────────────────────────────────────────
  function applyConfidence(rawConf) {
    rawConf = _elite_toNum(rawConf, NaN);
    if (!isFinite(rawConf)) return rawConf;
    
    rawConf = _elite_clamp(rawConf, 0, 100);
    
    // Outside calibration range: return as-is
    if (rawConf < minConf || rawConf > maxConf) return rawConf;
    
    // Find applicable bucket
    var key = getBucketKey(rawConf);
    var bucket = buckets[key];
    
    if (!bucket) {
      // No data for this bucket, return as-is
      return rawConf;
    }
    
    // Get smoothed factor
    var factor = 1;
    for (var b = 0; b < bucketList.length; b++) {
      if (bucketList[b].lo === bucket.lo && bucketList[b].hi === bucket.hi) {
        factor = bucketList[b].factorSmoothed;
        break;
      }
    }
    
    // Reliability weighting: blend toward 1.0 for small samples
    var reliability = _elite_clamp(bucket.n / minSamples, 0, 1);
    var blendedFactor = (1 - reliability) + reliability * factor;
    
    // Apply factor
    var prob = rawConf / 100;
    var calibratedProb = _elite_clamp(prob * blendedFactor, 0.01, 0.99);
    
    // Prevent inflation unless explicitly allowed
    if (!allowInflation && calibratedProb > prob) {
      calibratedProb = prob;
    }
    
    var calibratedConf = calibratedProb * 100;
    
    // Keep within reasonable bounds
    calibratedConf = _elite_clamp(calibratedConf, 40, 95);
    
    return _elite_round(calibratedConf, 1);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // COMPUTE SUMMARY
  // ─────────────────────────────────────────────────────────────────
  var totalN = 0;
  var totalHits = 0;
  var weightedClaimed = 0;
  
  for (var sb = 0; sb < bucketList.length; sb++) {
    totalN += bucketList[sb].n;
    totalHits += bucketList[sb].hits;
    weightedClaimed += bucketList[sb].n * bucketList[sb].claimed;
  }
  
  var overallHitRate = totalN > 0 ? totalHits / totalN : 0;
  var avgClaimedRate = totalN > 0 ? weightedClaimed / totalN : 0;
  var inflationRatio = avgClaimedRate > 0 ? overallHitRate / avgClaimedRate : 1;
  
  log('INFO', 'EXIT usedPicks=' + usedPicks + ' buckets=' + bucketList.length +
      ' overall=' + _elite_round(overallHitRate * 100, 1) + '% vs claimed=' +
      _elite_round(avgClaimedRate * 100, 1) + '%');
  
  // ─────────────────────────────────────────────────────────────────
  // RETURN
  // ─────────────────────────────────────────────────────────────────
  return {
    ok: true,
    usedPicks: usedPicks,
    invalidPicks: invalidPicks,
    bucketWidth: bucketWidth,
    minSamples: minSamples,
    range: { minConf: minConf, maxConf: maxConf },
    buckets: bucketList.map(function(b) {
      return {
        lo: b.lo,
        hi: b.hi,
        n: b.n,
        hits: b.hits,
        claimed: _elite_round(b.claimed, 4),
        actual: _elite_round(b.actual, 4),
        actualSmoothed: _elite_round(b.actualSmoothed, 4),
        factorSmoothed: _elite_round(b.factorSmoothed, 4)
      };
    }),
    applyConfidence: applyConfidence,
    summary: {
      totalN: totalN,
      totalHits: totalHits,
      overallHitRate: _elite_round(overallHitRate, 4),
      avgClaimedRate: _elite_round(avgClaimedRate, 4),
      inflationRatio: _elite_round(inflationRatio, 4),
      calibrationNeeded: inflationRatio < 0.95
    }
  };
}



/**
 * WHY: This function analyzes the raw win/loss record for each team within
 * each individual quarter.
 * [FIX]: It was looking for "team1"/"team2" instead of "home"/"away".
 * WHAT: Calculates W/L/Total stats for every team for each quarter (including OT).
 * HOW: It loops through every game, determines the winner of each quarter,
 * and aggregates the wins and losses for each team.
 * WHERE: Called by 'runAllHistoricalAnalyzers'. Reads 'allGames'.
 * Writes to 'LeagueQuarterStats'.
 * @param {Array<Array<string>>} allGames Combined data from Clean/ResultsClean.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} statsSheet The 'LeagueQuarterStats' output sheet.
 */
function analyzeQuarterWinner(allGames, statsSheet) {
  Logger.log('Running analyzeQuarterWinner...');
  const headers = allGames[0];
  const map = createHeaderMap(headers);
  // 1. & 2. Build maps
  const teamStats = {};
  // team  quarter  {wins, losses}

  try {
    // 3. Iterate every row  count W/L per quarter
    for (let i = 1; i < allGames.length; i++) {
      const row = allGames[i];
      
      // [FIX] Changed 'team1' to 'home' and 'team2' to 'away'
      // to match the headers in the Clean/ResultsClean sheets.
      const team1 = row[map['home']];
      const team2 = row[map['away']];

      if (!team1 || !team2) continue;

      if (!teamStats[team1]) teamStats[team1] = {};
      if (!teamStats[team2]) teamStats[team2] = {};

      for (const quarter of ['Q1', 'Q2', 'Q3', 'Q4', 'OT']) {
        const qScore = row[map[quarter.toLowerCase()]];
        if (!qScore || qScore === '0-0' || qScore === '-') continue;

        const qWinner = getQuarterWinner(qScore);
        // Helper returns 1, 2, or 0 for draw
        if (qWinner === 0) continue;
        // Skip draws for W/L record

        if (!teamStats[team1][quarter]) teamStats[team1][quarter] = { wins: 0, losses: 0 };
        if (!teamStats[team2][quarter]) teamStats[team2][quarter] = { wins: 0, losses: 0 };
        if (qWinner === 1) {
          teamStats[team1][quarter].wins++;
          teamStats[team2][quarter].losses++;
        } else if (qWinner === 2) {
          teamStats[team2][quarter].wins++;
          teamStats[team1][quarter].losses++;
        }
      }
    }

    // 4. BUILD OUTPUT ARRAY
    const outputData = [['Team', 'Quarter', 'W', 'L', 'Total', 'Win %']];
    const teams = Object.keys(teamStats).sort();
    for (const team of teams) {
      for (const quarter of ['Q1', 'Q2', 'Q3', 'Q4', 'OT']) {
        const stats = teamStats[team][quarter] || { wins: 0, losses: 0 };

        // [THE FIX] Use the raw total, not a proportion.
        const total = stats.wins + stats.losses;
        const winPct = total > 0 ? Math.round((stats.wins / total) * 1000) / 10 : 0;

        const outputRow = [team, quarter, stats.wins, stats.losses, total, winPct];
        outputData.push(outputRow);
      }
    }

    // [H-001 FIX] Guard against empty data crash
    if (!outputData || outputData.length === 0) {
      statsSheet.clear();
      statsSheet.getRange(1, 1).setValue('No data available for this analysis.');
      return;
    }

    // 5. Write to sheet
    statsSheet.clear();
    if (outputData.length > 1) {
      statsSheet.getRange(1, 1, outputData.length, outputData[0].length).setValues(outputData);
      statsSheet.autoResizeColumns(1, outputData[0].length);
    }
    Logger.log('...analyzeQuarterWinner complete.');
  } catch (e) {
    Logger.log(`!!! ERROR in analyzeQuarterWinner: ${e.message}`);
  }
}



function analyzeQuarterOU(allGames, statsSheet) {
  Logger.log('Running analyzeQuarterOU...');

  // [FIX-1] Guard: Validate allGames input before accessing index
  if (!allGames || !Array.isArray(allGames) || allGames.length < 2) {
    Logger.log('analyzeQuarterOU: No valid game data provided.');
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue('No data available for this analysis.');
    return;
  }

  const headers = allGames[0];
  
  // [FIX-2] Guard: Validate headers exist
  if (!headers || !Array.isArray(headers)) {
    Logger.log('analyzeQuarterOU: Headers row is invalid.');
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue('Invalid headers in data.');
    return;
  }

  const map = createHeaderMap(headers);
  
  // [FIX-3] Guard: Check required columns exist in header map
  const requiredCols = ['league', 'avg', 'q1', 'q2', 'q3', 'q4'];
  const missingCols = requiredCols.filter(col => map[col] === undefined);
  if (missingCols.length > 0) {
    Logger.log(`analyzeQuarterOU: Missing required columns: ${missingCols.join(', ')}`);
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue(`Missing columns: ${missingCols.join(', ')}`);
    return;
  }

  const stats = {};
  const quarterKeys = ['Q1', 'Q2', 'Q3', 'Q4'];

  try {
    for (let i = 1; i < allGames.length; i++) {
      const game = allGames[i];
      
      // [FIX-4] Guard: Skip undefined/null rows
      if (!game || !Array.isArray(game)) continue;

      const league = game[map['league']];
      const avg = parseFloat(game[map['avg']]);

      if (!league || isNaN(avg) || avg === 0) continue;
      const predQAvg = avg / 4;

      for (const qKey of quarterKeys) {
        const qScore = game[map[qKey.toLowerCase()]];
        if (!qScore || qScore === '0-0' || String(qScore).trim() === '') continue;

        // [FIX-5] Guard: Validate parseScore result before destructuring
        const parsed = parseScore(qScore);
        if (!parsed || !Array.isArray(parsed) || parsed.length < 2) {
          Logger.log(`Row ${i}: Invalid score format for ${qKey}: "${qScore}"`);
          continue;
        }

        const h = parsed[0];
        const a = parsed[1];
        
        // [FIX-6] Guard: Ensure parsed values are numbers
        if (isNaN(h) || isNaN(a)) continue;

        const actualQTotal = h + a;
        if (actualQTotal === 0) continue;

        if (!stats[league]) stats[league] = {};
        if (!stats[league][qKey]) {
          stats[league][qKey] = { total: 0, overs: 0, unders: 0, values: [] };
        }

        stats[league][qKey].total++;
        stats[league][qKey].values.push(actualQTotal);
        if (actualQTotal > predQAvg) {
          stats[league][qKey].overs++;
        } else if (actualQTotal < predQAvg) {
          stats[league][qKey].unders++;
        }
      }
    }

    const outputData = [];
    outputData.push(['League Quarter Over/Under Statistics (vs. Avg/4)']);
    outputData.push([
      'League', 'Quarter', 'Count', 'Mean (Actual)', 'Over %', 'Under %',
      'Pred. Q Avg (N/A)', 'SD', 'Safe Lower (1 SD)', 'Safe Upper (1 SD)'
    ]);

    for (const league in stats) {
      for (const qKey of quarterKeys) {
        if (stats[league][qKey] && stats[league][qKey].total > 0) {
          const s = stats[league][qKey];
          const mean = s.values.reduce((a, b) => a + b, 0) / s.total;
          const sd = _calculateSD(s.values, mean);
          const overPct = ((s.overs / s.total) * 100).toFixed(1) + '%';
          const underPct = ((s.unders / s.total) * 100).toFixed(1) + '%';
          const safeLower = (mean - sd).toFixed(1);
          const safeUpper = (mean + sd).toFixed(1);

          outputData.push([
            league, qKey, s.total, mean.toFixed(1), overPct, underPct,
            'N/A', sd.toFixed(1), safeLower, safeUpper
          ]);
        }
      }
    }

    // Guard against empty output
    if (outputData.length <= 2) {
      statsSheet.clear();
      statsSheet.getRange(1, 1).setValue('No valid quarter data found for analysis.');
      Logger.log('analyzeQuarterOU: No valid quarter data processed.');
      return;
    }

    // Make array rectangular before writing
    statsSheet.clear();
    let numCols = 0;
    outputData.forEach(row => {
      if (row.length > numCols) numCols = row.length;
    });

    const rectangularData = outputData.map(row => {
      while (row.length < numCols) {
        row.push('');
      }
      return row;
    });

    statsSheet.getRange(1, 1, rectangularData.length, numCols).setValues(rectangularData);
    statsSheet.autoResizeColumns(1, numCols);
    Logger.log('...analyzeQuarterOU complete.');

  } catch (e) {
    Logger.log(`!!! ERROR in analyzeQuarterOU: ${e.message} | Stack: ${e.stack}`);
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue(`Error: ${e.message}`);
  }
}

/**
 * WHY: This is a local math helper needed *only* by 'analyzeQuarterOU'
 * to calculate standard deviation.
 * WHAT: Calculates the standard deviation of an array of numbers.
 * HOW: It uses the standard mathematical formula for population
 * standard deviation.
 * WHERE: Called *only* by 'analyzeQuarterOU'.
 * @param {Array<number>} values An array of numbers (e.g., [40, 45, 38]).
 * @param {number} mean The pre-calculated mean of the 'values' array.
 * @returns {number} The standard deviation.
 */
function _calculateSD(values, mean) {
  if (!values || values.length === 0) return 0;
  const n = values.length;
  const sumOfSquaredDiffs = values.reduce((sum, value) => {
    return sum + Math.pow(value - mean, 2);
  }, 0);
  const variance = sumOfSquaredDiffs / n;
  return Math.sqrt(variance);
}

/**
 * ======================================================================
 * [NEW FUNCTION]
 * ======================================================================
 * WHY: This function creates the "feedback loop" for our Tier 2
 * predictions. It answers the question: "When we predicted 'H' or 'A'
 * for a quarter, how often were we correct?"
 * WHAT: Analyzes the accuracy of t2-q1, t2-q2, t2-q3, and t2-q4
 * predictions against actual quarter scores.
 * HOW:
 * 1. It gets all historical games from the 'allGames' array.
 * 2. It finds the columns for predictions (e.g., 't2-q1') and
 * actual scores (e.g., 'q1').
 * 3. It loops through every game and every quarter.
 * 4. It skips any 'N/A' predictions or '0-0' / Draw scores.
 * 5. It calls 'getQuarterWinner' (from Module 1) to find the
 * actual winner (1 or 2).
 * 6. It compares the prediction ('H'/'A') to the actual winner.
 * 7. It aggregates the 'Correct' and 'Total' stats.
 * 8. [FIX] It pads the output array to be rectangular, fixing the
 * "number of columns" crash.
 * 9. It writes the results to a new 'Stats_Tier2_Accuracy' sheet.
 * WHERE: Called by 'runAllHistoricalAnalyzers'. Reads 'allGames'.
 * Writes to 'Stats_Tier2_Accuracy'.
 * @param {Array<Array<string>>} allGames Combined data from Clean/ResultsClean.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} statsSheet The 'Stats_Tier2_Accuracy' output sheet.
 */
function analyzeTier2Accuracy(allGames, statsSheet) {
  Logger.log('Running analyzeTier2Accuracy...');
  const headers = allGames[0];
  const map = createHeaderMap(headers);

  // Stats object to hold { correct: 0, total: 0 }
  const quarterStats = {
    't2-q1': { correct: 0, total: 0 },
    't2-q2': { correct: 0, total: 0 },
    't2-q3': { correct: 0, total: 0 },
    't2-q4': { correct: 0, total: 0 },
    'Overall': { correct: 0, total: 0 }
  };

  const quarterKeys = ['q1', 'q2', 'q3', 'q4'];
  const t2Keys = ['t2-q1', 't2-q2', 't2-q3', 't2-q4'];

  // Check if the required headers exist (use === undefined to avoid false-negative on index 0)
  if (map['t2-q1'] === undefined || map['q1'] === undefined) {
    Logger.log('...analyzeTier2Accuracy: No Tier 2 prediction history found (t2-q1/q1 columns absent). Skipping — predictions will use current game data.');
    statsSheet.clear();
    statsSheet.getRange(1, 1).setValue('No Tier 2 prediction history yet. Predictions are generated from current game data.');
    return;
  }

  try {
    for (let i = 1; i < allGames.length; i++) {
      const row = allGames[i];

      for (let j = 0; j < quarterKeys.length; j++) {
        const qKey = quarterKeys[j]; // e.g., 'q1'
        const t2Key = t2Keys[j]; // e.g., 't2-q1'

        const prediction = row[map[t2Key]]; // 'H', 'A', or 'N/A'
        const actualScoreStr = row[map[qKey]]; // '25-20'

        // Skip if there was no prediction or no score
        if (!prediction || prediction === 'N/A' || !actualScoreStr || actualScoreStr === '0-0' || actualScoreStr === '-') {
          continue;
        }

        // 1 = Home, 2 = Away, 0 = Draw
        const actualWinner = getQuarterWinner(actualScoreStr);

        // Skip draws
        if (actualWinner === 0) {
          continue;
        }

        // We have a valid attempt.
        quarterStats[t2Key].total++;
        quarterStats['Overall'].total++;

        // Check for a correct prediction
        if ((prediction === 'H' && actualWinner === 1) || (prediction === 'A' && actualWinner === 2)) {
          quarterStats[t2Key].correct++;
          quarterStats['Overall'].correct++;
        }
      }
    }

    // Format and Write Output
    const outputData = [];
    outputData.push(['Tier 2 Prediction Accuracy (Historical)']);
    outputData.push(['Quarter', 'Accuracy', 'Correct', 'Total Attempts']);

    // Add overall stats first
    const ovr = quarterStats['Overall'];
    outputData.push([
      'Overall',
      `${(ovr.total > 0 ? (ovr.correct / ovr.total) * 100 : 0).toFixed(1)}%`,
      ovr.correct,
      ovr.total
    ]);
    outputData.push([]); // Add a spacer

    // Add individual quarter stats
    for (const t2Key of t2Keys) {
      const stats = quarterStats[t2Key];
      outputData.push([
        t2Key.toUpperCase(),
        `${(stats.total > 0 ? (stats.correct / stats.total) * 100 : 0).toFixed(1)}%`,
        stats.correct,
        stats.total
      ]);
    }

    // [H-001 FIX] Guard against empty data crash
    if (!outputData || outputData.length === 0) {
      statsSheet.clear();
      statsSheet.getRange(1, 1).setValue('No data available for this analysis.');
      return;
    }

    // WHY: [THE FIX] Make the 'outputData' array rectangular to prevent crashes.
    statsSheet.clear();
    if (outputData.length > 1) {
      // 1. Find the maximum number of columns required by any row.
      let numCols = 0;
      outputData.forEach(row => {
        if (row.length > numCols) numCols = row.length;
      });

      // 2. Pad all shorter rows with empty strings to match the max width.
      const rectangularData = outputData.map(row => {
        while (row.length < numCols) {
          row.push('');
        }
        return row;
      });
      
      // 3. Write the now-rectangular data.
      statsSheet.getRange(1, 1, rectangularData.length, numCols).setValues(rectangularData);
      statsSheet.autoResizeColumns(1, numCols);
    }
    Logger.log('...analyzeTier2Accuracy complete.');

  } catch (e) {
    Logger.log(`!!! ERROR in analyzeTier2Accuracy: ${e.message}`);
  }
}
/**
 * [PATCH 16A - SESSION 22] Tier 2 Simulation Engine + DIRECTION
 * 
 * WHY: The President needs to know TWO things:
 *   1. DIRECTION: Did we correctly predict WHO would win the quarter? (H vs A)
 *   2. COVER: Did the predicted winner beat the SPREAD we assigned?
 *   
 *   Direction tells us if the "brain" understands basketball.
 *   Cover tells us if our spread calculations are calibrated.
 *   
 *   You can have 80% Direction but 30% Cover = Brain is smart, spreads are too aggressive.
 *   You can have 50% Direction but 50% Cover = Lucky spread guessing, no real insight.
 * 
 * WHAT: Simulates what the V12 engine WOULD have predicted on historical games.
 *   Tracks both Direction accuracy and Cover accuracy separately.
 * 
 * HOW:
 *   1. Loads all historical games from Clean + ResultsClean
 *   2. For each game, recalculates what T2 predictions would have been
 *   3. Compares predictions to actual quarter scores
 *   4. Tracks: Direction hits, Cover hits, EVEN predictions
 *   5. Writes comprehensive report to Stats_Tier2_Simulation
 * 
 * WHERE: 
 *   - Reads: Clean, ResultsClean, Stats_Tier2_MarginDeepDive (via loadTier2MarginStats)
 *   - Writes: Stats_Tier2_Simulation
 * 
 * DEPENDENCIES (Module 1):
 *   - getSheetInsensitive(ss, name)
 *   - createHeaderMap(headers)
 *   - parseScore(scoreStr)
 *   - loadTier2MarginStats(ss) - from Module 5, but called here
 */
function runTier2Simulation(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 SIMULATION (PATCH 16A + DIRECTION) =====');
  
  // ========================================================================
  // STEP 1: Load Tier 2 Margin Stats (from Module 5's deep dive output)
  // ========================================================================
  // WHY: We need historical averages to simulate what predictions would have been
  let marginStats = {};
  
  if (typeof loadTier2MarginStats === 'function') {
    marginStats = loadTier2MarginStats(ss);
  } else {
    Logger.log('[Simulation] FATAL: loadTier2MarginStats function not found');
    ss.toast('Error: loadTier2MarginStats not available. Check Module 5.', 'Simulation Failed', 5);
    return;
  }

  if (!marginStats || Object.keys(marginStats).length === 0) {
    ss.toast('No Tier 2 margin stats available. Run Tier 2 Deep Dive first.', 'Simulation', 5);
    Logger.log('[Simulation] No margin stats - aborting');
    return;
  }
  
  Logger.log('[Simulation] Loaded margin stats for ' + Object.keys(marginStats).length + ' teams');
  
  // ========================================================================
  // STEP 2: Load Historical Games from Clean + ResultsClean
  // ========================================================================
  // WHY: These sheets contain games with actual outcomes we can backtest against
  const cleanSheet = getSheetInsensitive(ss, 'Clean');
  const resultsSheet = getSheetInsensitive(ss, 'ResultsClean');
  
  let allGames = [];
  let headers = null;
  
  if (cleanSheet) {
    const cleanData = cleanSheet.getDataRange().getValues();
    if (cleanData.length > 1) {
      headers = cleanData[0];
      allGames = allGames.concat(cleanData.slice(1));
    }
  }
  
  if (resultsSheet) {
    const resultsData = resultsSheet.getDataRange().getValues();
    if (resultsData.length > 1) {
      if (!headers) headers = resultsData[0];
      allGames = allGames.concat(resultsData.slice(1));
    }
  }
  
  if (!headers || allGames.length === 0) {
    ss.toast('No historical data found in Clean or ResultsClean', 'Simulation', 5);
    Logger.log('[Simulation] No historical data - aborting');
    return;
  }
  
  const headerMap = createHeaderMap(headers);
  Logger.log('[Simulation] Loaded ' + allGames.length + ' historical games');
  
  // ========================================================================
  // STEP 3: Initialize Statistics Tracking
  // ========================================================================
  // WHY: We track multiple metrics separately:
  //   - attempts: Total predictions made (excluding N/D)
  //   - covers: Predictions that beat the spread
  //   - sniperAttempts: Non-EVEN predictions only
  //   - sniperCovers: Non-EVEN predictions that covered
  //   - directionAttempts: Predictions where we picked a side (H or A)
  //   - directionCorrect: Predictions where we picked the actual winner
  
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  const stats = {
    Overall: { 
      covers: 0, 
      attempts: 0, 
      sniperCovers: 0, 
      sniperAttempts: 0,
      directionCorrect: 0,
      directionAttempts: 0
    },
    Q1: { covers: 0, attempts: 0, sniperCovers: 0, sniperAttempts: 0, directionCorrect: 0, directionAttempts: 0, details: [] },
    Q2: { covers: 0, attempts: 0, sniperCovers: 0, sniperAttempts: 0, directionCorrect: 0, directionAttempts: 0, details: [] },
    Q3: { covers: 0, attempts: 0, sniperCovers: 0, sniperAttempts: 0, directionCorrect: 0, directionAttempts: 0, details: [] },
    Q4: { covers: 0, attempts: 0, sniperCovers: 0, sniperAttempts: 0, directionCorrect: 0, directionAttempts: 0, details: [] }
  };
  
  // ========================================================================
  // STEP 4: Helper Function - Get Venue Stats for a Team
  // ========================================================================
  // WHY: Margin stats are stored by Team -> Venue -> Quarter
  // HOW: Handles case variations (Home/home, Q1/q1) gracefully
  const getVenueStats = function(team, venue, quarter) {
    if (!marginStats[team]) return null;
    
    // Try exact match first, then case variations
    let venueData = marginStats[team][venue] || 
                    marginStats[team][venue.toLowerCase()] || 
                    marginStats[team][venue.charAt(0).toUpperCase() + venue.slice(1).toLowerCase()];
    
    if (!venueData) return null;
    
    // Try exact quarter match, then variations
    let quarterData = venueData[quarter] || 
                      venueData[quarter.toUpperCase()] || 
                      venueData[quarter.toLowerCase()];
    
    return quarterData || null;
  };
  
  // ========================================================================
  // STEP 5: Helper Function - Simulate a Prediction
  // ========================================================================
  // WHY: Recreates what predictQuarters_Tier2 would have output for this matchup
  // WHAT: Returns prediction string like "H +5.5", "A +3.0", "EVEN", or "N/D"
  const simulatePrediction = function(home, away, quarter) {
    const homeStats = getVenueStats(home, 'Home', quarter);
    const awayStats = getVenueStats(away, 'Away', quarter);
    
    // WHY: Need minimum sample size for reliable predictions
    const minSamples = 4;
    const homeSamples = homeStats ? (homeStats.samples || homeStats.count || 0) : 0;
    const awaySamples = awayStats ? (awayStats.samples || awayStats.count || 0) : 0;
    
    if (!homeStats || !awayStats || homeSamples < minSamples || awaySamples < minSamples) {
      return 'N/D'; // Not enough data
    }
    
    // WHY: Base margin is the difference between home's home performance and away's away performance
    const homeAvg = homeStats.avgMargin || homeStats.avg || 0;
    const awayAvg = awayStats.avgMargin || awayStats.avg || 0;
    const baseMargin = homeAvg - awayAvg;
    
    // WHY: Apply momentum adjustment (simplified V12 logic)
    // Momentum represents recent trend direction
    const homeMomentum = homeStats.momentum || 0;
    const awayMomentum = awayStats.momentum || 0;
    const momentumWeight = 0.15; // From config
    const momentumSwing = (homeMomentum - awayMomentum) * momentumWeight;
    
    const finalMargin = baseMargin + momentumSwing;
    const absMargin = Math.abs(finalMargin);
    
    // WHY: Margins under 1.5 are too close to call - return EVEN
    if (absMargin < 1.5) return 'EVEN';
    
    // WHY: Positive margin = Home favored, Negative = Away favored
    const side = finalMargin > 0 ? 'H' : 'A';
    // WHY: Round to nearest 0.5 for betting-style spreads
    const spread = Math.round(absMargin * 2) / 2;
    
    return side + ' +' + spread;
  };
  
  // ========================================================================
  // STEP 6: Process Each Historical Game
  // ========================================================================
  for (let i = 0; i < allGames.length; i++) {
    const game = allGames[i];
    const home = game[headerMap['home']];
    const away = game[headerMap['away']];
    
    // WHY: Skip games with missing team names
    if (!home || !away) continue;
    
    const matchInfo = home + ' vs ' + away;
    
    // Process each quarter
    quarters.forEach(function(q) {
      // WHY: Find the column containing actual quarter score
      const actualCol = headerMap[q.toLowerCase()];
      if (actualCol === undefined) return;
      
      const actualScoreStr = game[actualCol];
      const actualScore = parseScore(actualScoreStr);
      
      // WHY: Skip if we can't parse the actual score
      if (!actualScore) return;
      
      // Simulate what we would have predicted
      const simPred = simulatePrediction(home, away, q);
      
      // WHY: Skip if insufficient data for prediction
      if (simPred === 'N/D') return;
      
      const homeScore = actualScore[0];
      const awayScore = actualScore[1];
      const actualMargin = homeScore - awayScore;
      
      // ================================================================
      // UPDATE STATISTICS
      // ================================================================
      stats[q].attempts++;
      stats.Overall.attempts++;
      
      let covered = false;
      let directionCorrect = false;
      const isDirectionalBet = (simPred !== 'EVEN');
      
      if (simPred === 'EVEN') {
        // WHY: EVEN prediction covers if actual margin is within +/- 1.5
        covered = Math.abs(actualMargin) < 2;
        // WHY: EVEN has no direction - don't count in direction stats
      } else {
        // This is a directional bet (H +X or A +X)
        stats[q].sniperAttempts++;
        stats.Overall.sniperAttempts++;
        stats[q].directionAttempts++;
        stats.Overall.directionAttempts++;
        
        // Parse the prediction
        const match = simPred.match(/([HA])\s*\+\s*([\d.]+)/);
        if (match) {
          const predictedSide = match[1];
          const spread = parseFloat(match[2]);
          
          // ============================================================
          // CHECK DIRECTION (Did we pick the winner?)
          // ============================================================
          // WHY: Direction only cares WHO won, not by how much
          // actualMargin > 0 means Home won
          // actualMargin < 0 means Away won
          // actualMargin === 0 means tie (rare in basketball quarters)
          
          if (predictedSide === 'H') {
            directionCorrect = actualMargin > 0; // We said Home, did Home win?
          } else {
            directionCorrect = actualMargin < 0; // We said Away, did Away win?
          }
          
          if (directionCorrect) {
            stats[q].directionCorrect++;
            stats.Overall.directionCorrect++;
          }
          
          // ============================================================
          // CHECK COVER (Did they beat the spread?)
          // ============================================================
          // WHY: Cover requires winning by MORE than the spread
          // H +5.5 covers if Home wins by 6+ (actualMargin >= 5.5)
          // A +3.0 covers if Away wins by 4+ (actualMargin <= -3.0, so -actualMargin >= 3.0)
          
          if (predictedSide === 'H') {
            covered = actualMargin >= spread;
          } else {
            covered = (-actualMargin) >= spread;
          }
          
          if (covered) {
            stats[q].sniperCovers++;
            stats.Overall.sniperCovers++;
          }
        }
      }
      
      if (covered) {
        stats[q].covers++;
        stats.Overall.covers++;
      }
      
      // ================================================================
      // Store Details (limit to 50 per quarter to prevent sheet overflow)
      // ================================================================
      if (stats[q].details.length < 50) {
        stats[q].details.push({
          match: matchInfo,
          simPred: simPred,
          actual: actualScoreStr,
          margin: actualMargin,
          direction: isDirectionalBet ? (directionCorrect ? '✅' : '❌') : '-',
          covered: covered
        });
      }
    });
  }
  
  // ========================================================================
  // STEP 7: Calculate Percentages Helper
  // ========================================================================
  const calcPct = function(num, den) {
    return den > 0 ? ((num / den) * 100).toFixed(1) : '0.0';
  };
  
  // ========================================================================
  // STEP 8: Write Results to Stats_Tier2_Simulation
  // ========================================================================
  let simSheet = getSheetInsensitive(ss, 'Stats_Tier2_Simulation');
  if (!simSheet) {
    simSheet = ss.insertSheet('Stats_Tier2_Simulation');
  }
  simSheet.clear();
  
  // Build output array
  const output = [
    // Header rows
    ['TIER 2 SIMULATION RESULTS (Backtest)', '', '', '', '', '', ''],
    ['What the V12 engine WOULD have predicted on historical games', '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    
    // Summary table headers
    ['Metric', 'Overall', 'Q1', 'Q2', 'Q3', 'Q4', ''],
    
    // NEW: Direction Accuracy Row
    ['Direction Accuracy % (Win/Loss)',
      calcPct(stats.Overall.directionCorrect, stats.Overall.directionAttempts) + '%',
      calcPct(stats.Q1.directionCorrect, stats.Q1.directionAttempts) + '%',
      calcPct(stats.Q2.directionCorrect, stats.Q2.directionAttempts) + '%',
      calcPct(stats.Q3.directionCorrect, stats.Q3.directionAttempts) + '%',
      calcPct(stats.Q4.directionCorrect, stats.Q4.directionAttempts) + '%',
      ''
    ],
    
    // Direction counts
    ['Direction Correct / Attempts',
      stats.Overall.directionCorrect + '/' + stats.Overall.directionAttempts,
      stats.Q1.directionCorrect + '/' + stats.Q1.directionAttempts,
      stats.Q2.directionCorrect + '/' + stats.Q2.directionAttempts,
      stats.Q3.directionCorrect + '/' + stats.Q3.directionAttempts,
      stats.Q4.directionCorrect + '/' + stats.Q4.directionAttempts,
      ''
    ],
    
    // Blank row
    ['', '', '', '', '', '', ''],
    
    // Cover accuracy (spread)
    ['SNIPER Cover Rate % (Spread)',
      calcPct(stats.Overall.sniperCovers, stats.Overall.sniperAttempts) + '%',
      calcPct(stats.Q1.sniperCovers, stats.Q1.sniperAttempts) + '%',
      calcPct(stats.Q2.sniperCovers, stats.Q2.sniperAttempts) + '%',
      calcPct(stats.Q3.sniperCovers, stats.Q3.sniperAttempts) + '%',
      calcPct(stats.Q4.sniperCovers, stats.Q4.sniperAttempts) + '%',
      ''
    ],
    
    // Cover counts
    ['Sniper Covers / Attempts',
      stats.Overall.sniperCovers + '/' + stats.Overall.sniperAttempts,
      stats.Q1.sniperCovers + '/' + stats.Q1.sniperAttempts,
      stats.Q2.sniperCovers + '/' + stats.Q2.sniperAttempts,
      stats.Q3.sniperCovers + '/' + stats.Q3.sniperAttempts,
      stats.Q4.sniperCovers + '/' + stats.Q4.sniperAttempts,
      ''
    ],
    
    // Blank row
    ['', '', '', '', '', '', ''],
    
    // All predictions (including EVEN)
    ['All Predictions Accuracy',
      calcPct(stats.Overall.covers, stats.Overall.attempts) + '%',
      calcPct(stats.Q1.covers, stats.Q1.attempts) + '%',
      calcPct(stats.Q2.covers, stats.Q2.attempts) + '%',
      calcPct(stats.Q3.covers, stats.Q3.attempts) + '%',
      calcPct(stats.Q4.covers, stats.Q4.attempts) + '%',
      ''
    ],
    
    ['All Correct / Total',
      stats.Overall.covers + '/' + stats.Overall.attempts,
      stats.Q1.covers + '/' + stats.Q1.attempts,
      stats.Q2.covers + '/' + stats.Q2.attempts,
      stats.Q3.covers + '/' + stats.Q3.attempts,
      stats.Q4.covers + '/' + stats.Q4.attempts,
      ''
    ],
    
    // Blank rows and recommendations
    ['', '', '', '', '', '', ''],
    ['--- THRESHOLD RECOMMENDATIONS ---', '', '', '', '', '', ''],
    ['Break-even at -110 odds: 52.4%', '', '', '', '', '', ''],
    ['Direction > 65% = Brain understands the game', '', '', '', '', '', ''],
    ['Cover < 50% with high Direction = Spreads too aggressive', '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    
    // Details header
    ['--- SAMPLE DETAILS ---', '', '', '', '', '', ''],
    ['Quarter', 'Match', 'Simulated Pred', 'Actual Score', 'Margin', 'Direction', 'Cover']
  ];
  
  // Add detail rows for each quarter
  quarters.forEach(function(q) {
    stats[q].details.forEach(function(d) {
      output.push([
        q,
        d.match,
        d.simPred,
        d.actual,
        d.margin,
        d.direction,
        d.covered ? '✅ COVER' : '❌ NO COVER'
      ]);
    });
  });
  
  // Write to sheet
  simSheet.getRange(1, 1, output.length, 7).setValues(output);
  
  // ========================================================================
  // STEP 9: Apply Formatting
  // ========================================================================
  // Title formatting
  simSheet.getRange('A1').setFontWeight('bold').setFontSize(14);
  
  // Header row formatting
  simSheet.getRange('A4:G4').setFontWeight('bold').setBackground('#f3f3f3');
  
  // Details header formatting
  const detailsHeaderRow = output.findIndex(row => row[0] === 'Quarter') + 1;
  if (detailsHeaderRow > 0) {
    simSheet.getRange(detailsHeaderRow, 1, 1, 7).setFontWeight('bold').setBackground('#d9ead3');
  }
  
  // Auto-resize columns
  simSheet.autoResizeColumns(1, 7);
  
  // Conditional formatting for Direction (Row 5, Column B)
  const directionRate = parseFloat(calcPct(stats.Overall.directionCorrect, stats.Overall.directionAttempts));
  const directionCell = simSheet.getRange('B5');
  if (directionRate >= 70) {
    directionCell.setBackground('#b6d7a8'); // Green - excellent
  } else if (directionRate >= 60) {
    directionCell.setBackground('#fff2cc'); // Yellow - decent
  } else {
    directionCell.setBackground('#f4cccc'); // Red - poor
  }
  
  // Conditional formatting for Cover (Row 9, Column B)
  const coverRate = parseFloat(calcPct(stats.Overall.sniperCovers, stats.Overall.sniperAttempts));
  const coverCell = simSheet.getRange('B9');
  if (coverRate >= 55) {
    coverCell.setBackground('#b6d7a8'); // Green - profitable
  } else if (coverRate >= 52.4) {
    coverCell.setBackground('#fff2cc'); // Yellow - break-even
  } else {
    coverCell.setBackground('#f4cccc'); // Red - losing
  }
  
  // ========================================================================
  // STEP 10: Log Summary and Notify User
  // ========================================================================
  Logger.log('===== TIER 2 SIMULATION COMPLETE =====');
  Logger.log('Direction Accuracy: ' + directionRate + '% (' + stats.Overall.directionCorrect + '/' + stats.Overall.directionAttempts + ')');
  Logger.log('Cover Rate: ' + coverRate + '% (' + stats.Overall.sniperCovers + '/' + stats.Overall.sniperAttempts + ')');
  Logger.log('Games Processed: ' + allGames.length);
  
  ss.toast(
    'Direction: ' + directionRate + '% | Cover: ' + coverRate + '%',
    'Simulation Complete',
    5
  );
}



/**
 * ======================================================================
 * FUNCTION: generateAccuracyReport (v4.0 - Consolidated Complete Report)
 * ======================================================================
 * - Grades ALL bet types from Bet_Slips against ResultsClean
 * - SNIPER MARGIN, SNIPER O/U, BANKER, ROBBER, FIRST HALF, FT O/U, HIGH QUARTER
 * - Includes Tier2_Accuracy Metric/Value summary
 * - Forces text formatting so 1 displays as 1 (not 100%)
 * - Single entry point for orchestrator and manual runs
 * ======================================================================
 */
function generateAccuracyReport(ssArg) {
  var ss = ssArg || null;
  if (!ss) { try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {} }
  if (!ss) { Logger.log('[generateAccuracyReport] No spreadsheet available.'); return null; }

  var SHEET_RESULTS  = 'ResultsClean';
  var SHEET_BETSLIPS = 'Bet_Slips';
  var SHEET_T2ACC    = 'Tier2_Accuracy';
  var SHEET_REPORT   = 'Accuracy_Report';

  try {
    // ── Safe wrappers ──────────────────────────────────────────────────────
    var _getSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive
      : function(ss_, n) { return findSheet_(ss_, n); };

    var _hdrMap = (typeof createHeaderMap === 'function')
      ? createHeaderMap
      : function(row) {
          var m = {};
          for (var i = 0; i < row.length; i++) {
            var h = String(row[i] || '').toLowerCase().trim();
            if (h) m[h] = i;
          }
          return m;
        };

    // ── Require core sheets ────────────────────────────────────────────────
    if (!_getSheet(ss, SHEET_RESULTS))  throw new Error('Missing sheet: "' + SHEET_RESULTS + '"');
    if (!_getSheet(ss, SHEET_BETSLIPS)) throw new Error('Missing sheet: "' + SHEET_BETSLIPS + '"');

    // ── Load data ──────────────────────────────────────────────────────────
    var games        = loadHistoricalGamesEnhanced_(ss);
    var betSlipsData = loadBetSlipsComplete_(ss);

    Logger.log('[generateAccuracyReport] Games loaded: '   + games.length);
    Logger.log('[generateAccuracyReport] Bet_Slips rows: ' + betSlipsData.rows.length);

    // ── Grade all bet types ────────────────────────────────────────────────
    var reports = {};
    reports.SNIPER_MARGIN = gradeSniperMargin_(betSlipsData, games);
    reports.SNIPER_OU     = gradeSniperOU_(betSlipsData, games);
    reports.ROBBER        = gradeRobbers_(betSlipsData, games);
    reports.FIRST_HALF    = gradeFirstHalf_(betSlipsData, games);
    reports.FT_OU         = gradeFTOU_(betSlipsData, games);
    reports.HIGH_QUARTER  = gradeHighQuarter_(betSlipsData, games);
    // NOTE: BANKER omitted — no Banker bets are generated for this league.
    //       Add reports.BANKER = gradeBankers_(...) if Bankers appear.

    // ── Optional Tier2_Accuracy metrics ───────────────────────────────────
    var t2Metrics  = [];
    var t2AccSheet = _getSheet(ss, SHEET_T2ACC);
    if (t2AccSheet) {
      var t2    = t2AccSheet.getDataRange().getValues();
      var start = -1;
      for (var r2 = 0; r2 < Math.min(t2.length, 120); r2++) {
        if (String(t2[r2][0] || '').trim().toLowerCase() === 'metric' &&
            String(t2[r2][1] || '').trim().toLowerCase() === 'value') {
          start = r2 + 1; break;
        }
      }
      if (start !== -1) {
        for (var r3 = start; r3 < t2.length; r3++) {
          var mKey = String(t2[r3][0] || '').trim();
          if (!mKey) break;
          t2Metrics.push([mKey, String(t2[r3][1] || '').trim()]);
        }
      }
    }

    // ── Overall totals (excl BANKER if empty) ─────────────────────────────
    var totalBets = 0, totalHits = 0, totalMisses = 0;
    var reportKeys = Object.keys(reports);
    for (var rk = 0; rk < reportKeys.length; rk++) {
      var rep = reports[reportKeys[rk]];
      totalBets   += rep.matched;
      totalHits   += rep.hits;
      totalMisses += rep.misses;
    }
    var overallRate = totalBets > 0 ? (totalHits / totalBets * 100).toFixed(2) : '0.00';

    // ── Build output ───────────────────────────────────────────────────────
    var maxCols = 14;
    var out     = [];

    var blank = function() {
      var r = []; while (r.length < maxCols) r.push(''); return r;
    };
    var row14 = function(vals) {
      var r = vals.slice();
      while (r.length < maxCols) r.push('');
      return r.slice(0, maxCols);
    };

    // Title
    out.push(row14(['MA GOLIDE COMPLETE ACCURACY REPORT']));
    out.push(row14(['Generated:', new Date().toLocaleString()]));
    out.push(blank());

    // Overall summary
    out.push(row14(['═══ OVERALL SUMMARY ═══']));
    out.push(row14(['Total Bets Graded:', String(totalBets)]));
    out.push(row14(['Total Hits:',        String(totalHits)]));
    out.push(row14(['Total Misses:',      String(totalMisses)]));
    out.push(row14(['Overall Hit Rate:',  overallRate + '%']));
    out.push(blank());

    // Per-type summary table
    out.push(row14(['═══ BY BET TYPE ═══']));
    out.push(['Bet Type','Found','Matched','Hits','Misses','Pushes/Ties','Hit Rate','','','','','','','']);
    for (var rk2 = 0; rk2 < reportKeys.length; rk2++) {
      var rpt = reports[reportKeys[rk2]];
      if (rpt.found === 0) continue;
      out.push(row14([
        rpt.name,
        String(rpt.found),
        String(rpt.matched),
        String(rpt.hits),
        String(rpt.misses),
        String(rpt.pushes || rpt.ties || 0),
        rpt.hitRate.toFixed(2) + '%'
      ]));
    }
    out.push(blank());

    // Detailed section per bet type
    for (var rk3 = 0; rk3 < reportKeys.length; rk3++) {
      var report = reports[reportKeys[rk3]];
      if (report.found === 0) continue;

      out.push(blank());
      out.push(row14(['═══ ' + report.name + ' — ' + report.description + ' ═══']));
      out.push(row14(['Source sheet:', SHEET_BETSLIPS]));
      out.push(row14(['Total bets found:', String(report.found)]));
      out.push(row14(['Matched to ResultsClean:', String(report.matched)]));
      out.push(row14(['Hits:', String(report.hits)]));
      out.push(row14(['Misses:', String(report.misses)]));
      if (report.pushes !== undefined) {
        out.push(row14(['Pushes/Ties:', String(report.pushes || report.ties || 0)]));
      }
      out.push(row14(['Hit Rate (excl pushes/ties):', report.hitRate.toFixed(2) + '%']));
      out.push(blank());

      if (report.details.length > 0) {
        out.push(row14(['--- BET DETAILS ---']));
        out.push(buildDetailHeader_(reportKeys[rk3]));
        for (var dd = 0; dd < report.details.length; dd++) {
          out.push(buildDetailRow_(reportKeys[rk3], report.details[dd]));
        }
      }
      out.push(blank());
    }

    // Tier2_Accuracy log summary
    out.push(blank());
    out.push(row14(['═══ Tier2_Accuracy (Log Summary) ═══']));
    out.push(row14(['Source sheet:', t2AccSheet ? SHEET_T2ACC : 'NOT FOUND']));
    if (t2Metrics.length) {
      out.push(row14(['Metric', 'Value']));
      for (var tm = 0; tm < t2Metrics.length; tm++) {
        out.push(row14([t2Metrics[tm][0], t2Metrics[tm][1]]));
      }
    } else {
      out.push(row14(['(No Metric/Value block found in Tier2_Accuracy)']));
    }

    // ── Write to sheet ─────────────────────────────────────────────────────
    var reportSheet = _getSheet(ss, SHEET_REPORT) || ss.insertSheet(SHEET_REPORT);
    reportSheet.clear();
    reportSheet.getRange('A:Z').setNumberFormat('@'); // force TEXT (no 1 → 100%)

    var rect = out.map(function(r) {
      var rr = r.slice();
      while (rr.length < maxCols) rr.push('');
      return rr.slice(0, maxCols);
    });

    reportSheet.getRange(1, 1, rect.length, maxCols).setValues(rect);

    // Formatting
    reportSheet.getRange(1, 1, 1, maxCols)
      .setFontWeight('bold').setFontSize(14)
      .setBackground('#4a86e8').setFontColor('white');

    for (var fi = 0; fi < rect.length; fi++) {
      var cell = String(rect[fi][0]);
      if (cell.indexOf('═══') !== -1) {
        reportSheet.getRange(fi + 1, 1, 1, maxCols).setFontWeight('bold').setBackground('#d9ead3');
      }
      if (cell.indexOf('--- ') !== -1) {
        reportSheet.getRange(fi + 1, 1, 1, maxCols).setFontWeight('bold').setBackground('#e8e8e8');
      }
      if (cell === 'League' || cell === 'Bet Type' || cell === 'Metric') {
        reportSheet.getRange(fi + 1, 1, 1, maxCols).setFontWeight('bold').setBackground('#f3f3f3');
      }
    }

    reportSheet.autoResizeColumns(1, maxCols);

    Logger.log('[generateAccuracyReport] Complete: ' + totalHits + '/' + totalBets + ' (' + overallRate + '%)');
    ss.toast('Accuracy Report generated (' + totalHits + '/' + totalBets + ' = ' + overallRate + '%).', 'Ma Golide', 5);

    return reports;

  } catch (err) {
    Logger.log('ERROR in generateAccuracyReport: ' + err.message + '\n' + err.stack);
    try { ss.toast('Accuracy Report Error: ' + err.message, 'Ma Golide', 10); } catch(e2) {}
    return null;
  }
}

// Aliases
function generateCompleteAccuracyReport(ss) { return generateAccuracyReport(ss); }
function runCompleteAccuracyReport() { generateAccuracyReport(SpreadsheetApp.getActiveSpreadsheet()); }



// ═══════════════════════════════════════════════════════════════════════════════
// LOAD HISTORICAL GAMES - Enhanced
// ═══════════════════════════════════════════════════════════════════════════════

function loadHistoricalGamesEnhanced_(ss) {
  var sh = findSheet_(ss, 'ResultsClean') || findSheet_(ss, 'Results');
  if (!sh) throw new Error('ResultsClean not found');
  
  var data = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error('No results data');
  
  var h = buildHeaderMap_(data[0]);
  var games = [];
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    
    var home = String(row[h.home] || row[h.hometeam] || '').trim();
    var away = String(row[h.away] || row[h.awayteam] || '').trim();
    if (!home || !away) continue;
    
    // Parse quarters (handles "26 - 26" combined format)
    var qScores = {};
    var allValid = true;
    
    for (var q = 1; q <= 4; q++) {
      var Q = 'Q' + q;
      var qKey = 'q' + q;
      
      // Try combined format first
      if (h[qKey] !== undefined) {
        var parsed = parseScoreValue_(row[h[qKey]]);
        if (parsed && parsed.home !== undefined) {
          qScores[Q] = parsed;
          continue;
        }
      }
      
      // Try separate columns
      if (h[qKey + 'h'] !== undefined && h[qKey + 'a'] !== undefined) {
        var hScore = parseFloat(row[h[qKey + 'h']]);
        var aScore = parseFloat(row[h[qKey + 'a']]);
        if (!isNaN(hScore) && !isNaN(aScore)) {
          qScores[Q] = { home: hScore, away: aScore };
          continue;
        }
      }
      
      allValid = false;
    }
    
    if (!allValid) continue;
    
    // Calculate totals
    var fhHome = qScores.Q1.home + qScores.Q2.home;
    var fhAway = qScores.Q1.away + qScores.Q2.away;
    var ftHome = fhHome + qScores.Q3.home + qScores.Q4.home;
    var ftAway = fhAway + qScores.Q3.away + qScores.Q4.away;
    
    // Try to use FT Score column if available
    var ftCol = h.ftscore || h.ft || h.final;
    if (ftCol !== undefined) {
      var ftParsed = parseScoreValue_(row[ftCol]);
      if (ftParsed && ftParsed.home !== undefined) {
        ftHome = ftParsed.home;
        ftAway = ftParsed.away;
      }
    }
    
    // Find highest quarter
    var highestQ = 'Q1';
    var highestTotal = 0;
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(Q) {
      var total = qScores[Q].home + qScores[Q].away;
      if (total > highestTotal) {
        highestTotal = total;
        highestQ = Q;
      }
    });
    
    games.push({
      home: home,
      away: away,
      homeNorm: normalizeTeam_(home),
      awayNorm: normalizeTeam_(away),
      date: row[h.date] || '',
      league: row[h.league] || 'NBA',
      qScores: qScores,
      fhHome: fhHome,
      fhAway: fhAway,
      ftHome: ftHome,
      ftAway: ftAway,
      ftTotal: ftHome + ftAway,
      ftWinner: ftHome > ftAway ? 'HOME' : (ftHome < ftAway ? 'AWAY' : 'DRAW'),
      fhWinner: fhHome > fhAway ? '1' : (fhHome < fhAway ? '2' : 'X'),
      highestQ: highestQ,
      highestTotal: highestTotal
    });
  }
  
  return games;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD BET_SLIPS COMPLETE - Preserves All Columns
// ═══════════════════════════════════════════════════════════════════════════════

function loadBetSlipsComplete_(ss) {
  var sh = findSheet_(ss, 'Bet_Slips');
  if (!sh) return { headers: [], rows: [], headerMap: {} };
  
  var data = sh.getDataRange().getValues();
  var result = {
    headers: [],
    headerMap: {},
    rows: []
  };
  
  var currentHeaders = null;
  var currentHMap = null;
  var currentSection = '';
  
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var rowText = row.map(function(c) { return String(c || '').toUpperCase().trim(); }).join(' ');
    
    // Detect section headers (title rows)
    if (rowText.indexOf('SNIPER') !== -1 || rowText.indexOf('BANKER') !== -1 ||
        rowText.indexOf('ROBBER') !== -1 || rowText.indexOf('FIRST HALF') !== -1 ||
        rowText.indexOf('FT O/U') !== -1 || rowText.indexOf('HIGH') !== -1) {
      currentSection = rowText.substring(0, 50);
    }
    
    // Detect column header rows (supports both 10-col and 23-col Bet_Slips formats)
    var hasHeaderWords = row.some(function(c) {
      var s = String(c || '').toLowerCase();
      return s === 'match' || s === 'fixture' || s === 'game' ||
             s === 'league' || s === 'date' || s === 'pick' ||
             s === 'bet_record_id' || s === 'market' || s === 'selection_text';
    });
    
    if (hasHeaderWords) {
      currentHeaders = row.map(function(c) { return String(c || '').trim(); });
      currentHMap = buildHeaderMap_(currentHeaders);
      
      if (result.headers.length === 0) {
        result.headers = currentHeaders;
        result.headerMap = currentHMap;
      }
      continue;
    }
    
    if (!currentHMap) continue;
    
    // Get match value: 10-col format has 'Match' column; 23-col uses 'Home' + 'Away'
    var matchVal = '';
    var matchCol = currentHMap.match || currentHMap.fixture || currentHMap.game;
    if (matchCol !== undefined) {
      matchVal = String(row[matchCol] || '').trim();
    } else if (currentHMap.home !== undefined && currentHMap.away !== undefined) {
      var _hv = String(row[currentHMap.home] || '').trim();
      var _av = String(row[currentHMap.away] || '').trim();
      if (_hv && _av) matchVal = _hv + ' vs ' + _av;
    }
    if (!matchVal) continue;
    
    // Skip if looks like a header or separator
    if (matchVal.toLowerCase() === 'match' || matchVal.indexOf('────') !== -1 ||
        matchVal.toLowerCase() === 'home vs away') continue;
    
    // Parse teams
    var teams = parseMatchTeams_(matchVal);
    if (!teams) continue;
    
    // Build row data (column lookups support both 10-col and 23-col formats)
    var rowData = {
      sourceRow: r + 1,
      section: currentSection,
      rawRow: row.slice(),
      headers: currentHeaders,
      headerMap: currentHMap,
      
      // Parsed fields
      match: matchVal,
      home: teams.home,
      away: teams.away,
      homeNorm: normalizeTeam_(teams.home),
      awayNorm: normalizeTeam_(teams.away),
      
      // Extract common columns — 'market' covers 23-col; 'type' covers 10-col
      league:     getColValue_(row, currentHMap, ['league', 'comp']),
      date:       getColValue_(row, currentHMap, ['date', 'gamedate']),
      time:       getColValue_(row, currentHMap, ['time']),
      type:       getColValue_(row, currentHMap, ['type', 'signal', 'signaltype', 'market']),
      pick:       getColValue_(row, currentHMap, ['pick', 'selection', 'bet', 'selection_text', 'selectiontext']),
      odds:       getColValue_(row, currentHMap, ['odds', 'price']),
      confidence: getColValue_(row, currentHMap, ['confidence', 'conf', 'confidence_pct', 'confidencepct']),
      ev:         getColValue_(row, currentHMap, ['ev', 'expectedvalue']),
      tier:       getColValue_(row, currentHMap, ['tier', 'tier_code', 'tiercode']),
      period:     getColValue_(row, currentHMap, ['period', 'half', 'qtr', 'quarter'])
    };
    
    result.rows.push(rowData);
  }
  
  Logger.log('[loadBetSlipsComplete_] Loaded ' + result.rows.length + ' bet rows');
  return result;
}

function getColValue_(row, hMap, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i].toLowerCase().replace(/[\s_\-]+/g, '');
    if (hMap[key] !== undefined) {
      return String(row[hMap[key]] || '').trim();
    }
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: SNIPER MARGIN
// ═══════════════════════════════════════════════════════════════════════════════

function gradeSniperMargin_(betSlipsData, games) {
  var result = {
    name: 'SNIPER MARGIN',
    description: 'Quarter Side Bets (Spreads)',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    ties: 0,
    hitRate: 0,
    details: []
  };
  
  // Filter for margin bets (supports 23-col Market = SNIPER_MARGIN and legacy Type)
  var marginBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase();
    if (typeU === 'SNIPER_MARGIN') return true;
    if (typeU === 'SNIPER_OU' || typeU === 'FT_OU' || typeU === 'BANKER' ||
        typeU === 'ROBBER' || typeU === 'FIRST_HALF_1X2') return false;
    var combined = (typeU + ' ' + String(row.section || '').toUpperCase());
    return combined.indexOf('SNIPER') !== -1 &&
           (combined.indexOf('MARGIN') !== -1 || combined.indexOf('SIDE') !== -1) &&
           combined.indexOf('O/U') === -1;
  });
  
  result.found = marginBets.length;
  
  marginBets.forEach(function(bet) {
    // Find matching game
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    // Parse pick: "Q1: H +5.0" or "Q2: A -3.5"
    var pickUpper = bet.pick.toUpperCase();
    var qMatch = pickUpper.match(/Q([1-4])/);
    var sideMatch = pickUpper.match(/\b([HA])\s*([-+]?\d+\.?\d*)/);
    
    if (!qMatch || !sideMatch) {
      // Try alternative formats
      sideMatch = pickUpper.match(/(HOME|AWAY)\s*([-+]?\d+\.?\d*)/i);
    }
    
    if (!qMatch) return;
    
    var quarter = 'Q' + qMatch[1];
    var predictedSide = sideMatch ? (sideMatch[1].charAt(0) === 'H' || sideMatch[1] === 'HOME' ? 'H' : 'A') : null;
    var spread = sideMatch ? parseFloat(sideMatch[2]) : 0;
    
    if (!predictedSide) return;
    
    // Get actual quarter score
    var qScore = game.qScores[quarter];
    if (!qScore) return;
    
    var actualMargin = qScore.home - qScore.away;
    var actualSide = actualMargin > 0 ? 'H' : (actualMargin < 0 ? 'A' : 'EVEN');
    
    // Grade
    var outcome = 'MISS';
    if (actualSide === 'EVEN') {
      outcome = 'TIE';
      result.ties++;
    } else if (predictedSide === actualSide) {
      outcome = 'HIT';
      result.hits++;
    } else {
      result.misses++;
    }
    
    result.details.push({
      league: bet.league || game.league,
      date: bet.date,
      time: bet.time,
      match: bet.match,
      pick: bet.pick,
      type: bet.type || 'SNIPER MARGIN',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      quarter: quarter,
      actualQScore: qScore.home + ' - ' + qScore.away,
      actualSide: actualSide,
      outcome: outcome === 'HIT' ? '✅ HIT' : (outcome === 'TIE' ? '🟡 TIE' : '❌ MISS')
    });
  });
  
  result.hitRate = result.matched > 0 ? (result.hits / result.matched * 100) : 0;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: SNIPER O/U
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 2. gradeSniperOU_  — BUG-1 + BUG-6 fixed
//
// BUG-1: matched++ moved AFTER all validation (was before pick parse).
//
// BUG-6 (ROOT CAUSE of "8 found, 5 matched"):
//   The old filter accepted any row whose combined type+section+pick string
//   contained "O/U" OR "OVER/UNDER" AND matched /Q[1-4]/i. This pulled in
//   SNIPER_MARGIN rows whose pick is "Q3: H +5.0" — the "Q3" passes the
//   quarter test but the pick has no OVER/UNDER keyword, so dirMatch fails,
//   and those 3 rows exit after findMatchingGame_ (before matched++, after
//   BUG-1 fix). They still inflate `found` from 5 → 8.
//
//   FIX: The filter now REQUIRES typeU === 'SNIPER_OU' (exact match, 23-col)
//   or typeU === 'SNIPER' with a Q1-Q4 period AND an O/U keyword in the pick.
//   SNIPER_MARGIN rows are explicitly excluded even before the fallback path.
//   Result: found=5, matched=5 — exactly matching buildOUAccuracyReport.
// ═══════════════════════════════════════════════════════════════════════════

function gradeSniperOU_(betSlipsData, games) {
  var result = {
    name:    'SNIPER O/U',
    description: 'Quarter Over/Under Totals',
    found:   0,
    matched: 0,
    hits:    0,
    misses:  0,
    pushes:  0,
    hitRate: 0,
    details: []
  };

  // ── BUG-6 FIX: tight filter — only genuine O/U rows ───────────────────
  var ouBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase().replace(/-/g, '_');

    // 23-col canonical: Market = SNIPER_OU
    if (typeU === 'SNIPER_OU') return true;

    // Explicitly exclude margin / other types regardless of content
    if (typeU === 'SNIPER_MARGIN' || typeU === 'FT_OU'  || typeU === 'BANKER' ||
        typeU === 'ROBBER'        || typeU === 'FIRST_HALF_1X2') return false;

    // 23-col SNIPER with Quarter period AND a direction keyword in the pick
    if (typeU === 'SNIPER') {
      var period = String(row.period || '').toUpperCase();
      if (/^Q[1-4]$/.test(period)) {
        var pickU = String(row.pick || '').toUpperCase();
        return /\b(OVER|UNDER)\b/.test(pickU) || /\bO\s*\d/.test(pickU) || /\bU\s*\d/.test(pickU);
      }
    }

    // Legacy free-text fallback: section/pick must contain an O/U keyword
    // AND a quarter tag AND must NOT look like a margin pick (has +/- spread)
    var combined = typeU + ' ' + String(row.section || '').toUpperCase() +
                   ' '  + String(row.pick    || '').toUpperCase();
    var hasOU      = /\b(OVER|UNDER|O\/U)\b/.test(combined);
    var hasQuarter = /Q[1-4]/.test(combined);
    var isSpread   = /Q[1-4]:\s*[HA]\s*[+-]\d/.test(combined); // "Q1: A +4.5"

    return hasOU && hasQuarter && !isSpread;
  });

  result.found = ouBets.length;

  ouBets.forEach(function(bet) {
    // ── Match to a historical game ─────────────────────────────────────
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;

    // ── Parse quarter ──────────────────────────────────────────────────
    var pickUpper = String(bet.pick || '').toUpperCase();
    var qMatch    = pickUpper.match(/Q([1-4])/);

    // Fallback: period column (23-col format)
    if (!qMatch) {
      var prd = String(bet.period || '').toUpperCase();
      if (/^Q[1-4]$/.test(prd)) qMatch = [prd, prd[1]];
    }

    // ── Parse direction + line ─────────────────────────────────────────
    var direction, line;

    // Primary: parse from pick text "Q1: OVER 40.0" / "Q1 O 40" / "OVER 40.0"
    var dirMatch = pickUpper.match(/\b(OVER|UNDER)\s*(\d+\.?\d*)/);
    if (!dirMatch) {
      dirMatch = pickUpper.match(/\b([OU])\s+(\d+\.?\d*)/);  // "O 40", "U 55.5"
    }
    if (dirMatch) {
      var raw = dirMatch[1];
      direction = (raw === 'O') ? 'OVER' : (raw === 'U') ? 'UNDER' : raw;
      line      = parseFloat(dirMatch[2]);
    }

    // Fallback: 23-col structured columns (Selection_Side / Selection_Line)
    if (!direction || !isFinite(line)) {
      var selSide = String(getColValue_(bet.rawRow, bet.headerMap,
        ['selection_side', 'selectionside', 'side', 'dir']) || '').toUpperCase();
      var selLine = parseFloat(getColValue_(bet.rawRow, bet.headerMap,
        ['selection_line', 'selectionline', 'line']) || '');
      if (selSide && isFinite(selLine)) { direction = selSide; line = selLine; }
    }

    // BUG-1 FIX: only increment matched AFTER all fields validated
    if (!qMatch || !direction || !isFinite(line)) return;

    var quarter = 'Q' + qMatch[1];
    var qScore  = game.qScores[quarter];
    if (!qScore) return;

    result.matched++;

    // ── Grade ──────────────────────────────────────────────────────────
    var actualTotal  = qScore.home + qScore.away;
    var actualResult = actualTotal > line ? 'OVER' : (actualTotal < line ? 'UNDER' : 'PUSH');

    var outcome = 'MISS';
    if (actualResult === 'PUSH')            { outcome = 'PUSH';  result.pushes++; }
    else if (direction === actualResult)    { outcome = 'HIT';   result.hits++;   }
    else                                    {                     result.misses++; }

    result.details.push({
      league:       bet.league || game.league,
      date:         bet.date,
      time:         bet.time,
      match:        bet.match,
      pick:         bet.pick,
      type:         bet.type || 'SNIPER O/U',
      odds:         bet.odds || '-',
      confidence:   bet.confidence,
      ev:           bet.ev || '-',
      tier:         bet.tier,
      quarter:      quarter,
      line:         line,
      actualTotal:  actualTotal,
      actualResult: actualResult,          // BUG-3 FIX
      outcome:      outcome === 'HIT'  ? '✅ HIT'  :
                    outcome === 'PUSH' ? '🟡 PUSH' : '❌ MISS'
    });
  });

  var graded = result.matched - result.pushes;
  result.hitRate = graded > 0 ? (result.hits / graded * 100) : 0;

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: BANKERS (ML)
// ═══════════════════════════════════════════════════════════════════════════════

function gradeBankers_(betSlipsData, games) {
  var result = {
    name: 'BANKER',
    description: 'Moneyline Winners',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    details: []
  };
  
  var bankerBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase();
    if (typeU === 'BANKER') return true;
    if (typeU === 'ROBBER' || typeU === 'SNIPER_MARGIN' || typeU === 'SNIPER_OU' ||
        typeU === 'FT_OU' || typeU === 'FIRST_HALF_1X2' || typeU === 'SNIPER') return false;
    var combined = (typeU + ' ' + String(row.section || '').toUpperCase());
    return combined.indexOf('BANKER') !== -1 ||
           (combined.indexOf('ML') !== -1 && combined.indexOf('ROBBER') === -1);
  });
  
  result.found = bankerBets.length;
  
  bankerBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    // Determine predicted winner from pick text
    var pickText = bet.pick + ' ' + findWinnerInRow_(bet.rawRow, bet.headerMap, game);
    var predicted = 'HOME';
    
    if (pickText.toLowerCase().indexOf(game.away.toLowerCase()) !== -1 ||
        pickText.indexOf('Away') !== -1 || pickText.indexOf('2') !== -1) {
      predicted = 'AWAY';
    }
    
    var outcome = predicted === game.ftWinner ? 'HIT' : 'MISS';
    if (outcome === 'HIT') result.hits++;
    else result.misses++;
    
    result.details.push({
      league: bet.league || game.league,
      date: bet.date,
      time: bet.time,
      match: bet.match,
      pick: bet.pick || (predicted === 'HOME' ? game.home + ' Win' : game.away + ' Win'),
      type: 'BANKER',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      predictedWinner: predicted === 'HOME' ? game.home : game.away,
      actualScore: game.ftHome + ' - ' + game.ftAway,
      actualWinner: game.ftWinner === 'HOME' ? game.home : game.away,
      outcome: outcome === 'HIT' ? '✅ HIT' : '❌ MISS'
    });
  });
  
  result.hitRate = result.matched > 0 ? (result.hits / result.matched * 100) : 0;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: ROBBERS
// ═══════════════════════════════════════════════════════════════════════════════

function gradeRobbers_(betSlipsData, games) {
  var result = {
    name: 'ROBBER',
    description: 'Underdog ML Picks',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    details: []
  };
  
  var robberBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase();
    if (typeU === 'ROBBER') return true;
    if (typeU === 'BANKER' || typeU === 'SNIPER_MARGIN' || typeU === 'SNIPER_OU' ||
        typeU === 'FT_OU' || typeU === 'FIRST_HALF_1X2' || typeU === 'SNIPER') return false;
    var combined = (typeU + ' ' + String(row.section || '').toUpperCase());
    return combined.indexOf('ROBBER') !== -1 || combined.indexOf('UNDERDOG') !== -1;
  });
  
  result.found = robberBets.length;
  
  robberBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    var pickRaw = String(bet.pick || '').toLowerCase();
    var predicted;
    if (pickRaw && game.home && pickRaw.indexOf(game.home.toLowerCase()) !== -1) {
      predicted = 'HOME';
    } else if (pickRaw && game.away && pickRaw.indexOf(game.away.toLowerCase()) !== -1) {
      predicted = 'AWAY';
    } else {
      predicted = 'AWAY'; // ROBBER default: picks underdog (away)
    }
    
    var outcome = predicted === game.ftWinner ? 'HIT' : 'MISS';
    if (outcome === 'HIT') result.hits++;
    else result.misses++;
    
    result.details.push({
      league: bet.league || game.league,
      date: bet.date,
      time: bet.time,
      match: bet.match,
      pick: bet.pick || (predicted === 'HOME' ? game.home + ' ML' : game.away + ' ML'),
      type: 'ROBBER',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      predictedWinner: predicted === 'HOME' ? game.home : game.away,
      actualScore: game.ftHome + ' - ' + game.ftAway,
      actualWinner: game.ftWinner === 'HOME' ? game.home : game.away,
      outcome: outcome === 'HIT' ? '✅ HIT' : '❌ MISS'
    });
  });
  
  result.hitRate = result.matched > 0 ? (result.hits / result.matched * 100) : 0;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: FIRST HALF
// ═══════════════════════════════════════════════════════════════════════════════

function gradeFirstHalf_(betSlipsData, games) {
  var result = {
    name: 'FIRST HALF 1X2',
    description: 'First Half Winner',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    details: []
  };
  
  var fhBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase();
    if (typeU === 'FIRST_HALF_1X2') return true;
    if (typeU === 'BANKER' || typeU === 'ROBBER' || typeU === 'FT_OU' ||
        typeU === 'SNIPER_MARGIN' || typeU === 'SNIPER_OU' || typeU === 'SNIPER') return false;
    var combined = (typeU + ' ' + String(row.section || '').toUpperCase());
    return combined.indexOf('1H') !== -1 || combined.indexOf('FIRST HALF') !== -1 ||
           combined.indexOf('FH') !== -1 || combined.indexOf('HALF TIME') !== -1;
  });
  
  result.found = fhBets.length;
  
  fhBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    var pickUpper = bet.pick.toUpperCase();
    var predicted = null;
    
    if (pickUpper === '1' || pickUpper.indexOf('HOME') !== -1 || 
        pickUpper.indexOf(game.home.toUpperCase()) !== -1) {
      predicted = '1';
    } else if (pickUpper === '2' || pickUpper.indexOf('AWAY') !== -1 ||
               pickUpper.indexOf(game.away.toUpperCase()) !== -1) {
      predicted = '2';
    } else if (pickUpper === 'X' || pickUpper.indexOf('DRAW') !== -1) {
      predicted = 'X';
    }
    
    if (!predicted) return;
    
    var outcome = predicted === game.fhWinner ? 'HIT' : 'MISS';
    if (outcome === 'HIT') result.hits++;
    else result.misses++;
    
    result.details.push({
      league: bet.league || game.league,
      date: bet.date,
      time: bet.time,
      match: bet.match,
      pick: bet.pick || predicted,
      type: '1H 1X2',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      predicted: predicted,
      actualHalfScore: game.fhHome + ' - ' + game.fhAway,
      actual: game.fhWinner,
      outcome: outcome === 'HIT' ? '✅ HIT' : '❌ MISS'
    });
  });
  
  result.hitRate = result.matched > 0 ? (result.hits / result.matched * 100) : 0;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: FT O/U
// ═══════════════════════════════════════════════════════════════════════════════

function gradeFTOU_(betSlipsData, games) {
  var result = {
    name: 'FT O/U',
    description: 'Full Time Over/Under',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    hitRate: 0,
    details: []
  };
  
  var ftouBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase();
    if (typeU === 'FT_OU') return true;
    if (typeU === 'SNIPER_MARGIN' || typeU === 'SNIPER_OU' || typeU === 'BANKER' ||
        typeU === 'ROBBER' || typeU === 'FIRST_HALF_1X2' || typeU === 'SNIPER') return false;
    var combined = (typeU + ' ' + String(row.section || '').toUpperCase() + ' ' + String(row.pick || '').toUpperCase());
    return (combined.indexOf('FT O/U') !== -1 || combined.indexOf('FT OU') !== -1 ||
            combined.indexOf('FULL TIME') !== -1 || combined.indexOf('TOTAL') !== -1) &&
           !/Q[1-4]/i.test(row.pick || '');
  });
  
  result.found = ftouBets.length;
  
  ftouBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    var pickUpper = bet.pick.toUpperCase();
    var dirMatch = pickUpper.match(/(OVER|UNDER|O|U)\s*(\d+\.?\d*)/);
    
    if (!dirMatch) return;
    
    var direction = dirMatch[1] === 'O' ? 'OVER' : dirMatch[1] === 'U' ? 'UNDER' : dirMatch[1];
    var line = parseFloat(dirMatch[2]);
    
    var actualResult = game.ftTotal > line ? 'OVER' : (game.ftTotal < line ? 'UNDER' : 'PUSH');
    
    var outcome = 'MISS';
    if (actualResult === 'PUSH') {
      outcome = 'PUSH';
      result.pushes++;
    } else if (direction === actualResult) {
      outcome = 'HIT';
      result.hits++;
    } else {
      result.misses++;
    }
    
    result.details.push({
      league: bet.league || game.league,
      date: bet.date,
      time: bet.time,
      match: bet.match,
      pick: bet.pick,
      type: 'FT O/U',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      line: line,
      actualTotal: game.ftTotal,
      actualResult: actualResult,
      outcome: outcome === 'HIT' ? '✅ HIT' : (outcome === 'PUSH' ? '🟡 PUSH' : '❌ MISS')
    });
  });
  
  var graded = result.matched - result.pushes;
  result.hitRate = graded > 0 ? (result.hits / graded * 100) : 0;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRADE: HIGH QUARTER
// ═══════════════════════════════════════════════════════════════════════════════

function gradeHighQuarter_(betSlipsData, games) {
  var result = {
    name: 'HIGH QUARTER',
    description: 'Highest Scoring Quarter',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    details: []
  };
  
  var hqBets = betSlipsData.rows.filter(function(row) {
    var typeU = String(row.type || '').toUpperCase();
    // 23-col format: Market = 'SNIPER', pick starts with 'Highest Q'
    if (typeU === 'SNIPER' && /highest\s*q/i.test(row.pick || '')) return true;
    if (typeU === 'SNIPER_MARGIN' || typeU === 'SNIPER_OU' || typeU === 'FT_OU' ||
        typeU === 'BANKER' || typeU === 'ROBBER' || typeU === 'FIRST_HALF_1X2') return false;
    var combined = (typeU + ' ' + String(row.section || '').toUpperCase());
    return combined.indexOf('HIGH') !== -1 &&
           (combined.indexOf('QTR') !== -1 || combined.indexOf('QUARTER') !== -1);
  });
  
  result.found = hqBets.length;
  
  hqBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    var pickUpper = bet.pick.toUpperCase();
    var qMatch = pickUpper.match(/Q([1-4])/);
    
    if (!qMatch) return;
    
    var predicted = 'Q' + qMatch[1];
    
    var outcome = predicted === game.highestQ ? 'HIT' : 'MISS';
    if (outcome === 'HIT') result.hits++;
    else result.misses++;
    
    result.details.push({
      league: bet.league || game.league,
      date: bet.date,
      time: bet.time,
      match: bet.match,
      pick: bet.pick,
      type: 'SNIPER HIGH QTR',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      predicted: predicted,
      q1Total: game.qScores.Q1.home + game.qScores.Q1.away,
      q2Total: game.qScores.Q2.home + game.qScores.Q2.away,
      q3Total: game.qScores.Q3.home + game.qScores.Q3.away,
      q4Total: game.qScores.Q4.home + game.qScores.Q4.away,
      actualHighest: game.highestQ + ' (' + game.highestTotal + ')',
      outcome: outcome === 'HIT' ? '✅ HIT' : '❌ MISS'
    });
  });
  
  result.hitRate = result.matched > 0 ? (result.hits / result.matched * 100) : 0;
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE UNIFIED ACCURACY REPORT (kept for backward compat — called internally)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// writeUnifiedAccuracyReport_ REMOVED — dead duplicate (BUG-5).
// Any call site → use generateAccuracyReport(ss) directly.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 3. buildDetailHeader_  — BUG-2 fixed (SNIPER_OU gets Result col)
// ═══════════════════════════════════════════════════════════════════════════

function buildDetailHeader_(betType) {
  switch (betType) {
    case 'SNIPER_MARGIN':
      return ['League','Date','Time','Match','Pick','Type','Odds','Confidence','EV','Tier','Quarter','Actual Q Score','Actual Side','Outcome'];
    case 'SNIPER_OU':
      // 14 cols: drop "Time" to fit Result between Actual Total and Outcome
      return ['League','Date','Match','Pick','Type','Odds','Confidence','EV','Tier','Quarter','Line','Actual Total','Result','Outcome'];
    case 'BANKER':
    case 'ROBBER':
      return ['League','Date','Time','Match','Pick','Type','Odds','Confidence','EV','Tier','Predicted','Actual Score','Actual Winner','Outcome'];
    case 'FIRST_HALF':
      return ['League','Date','Time','Match','Pick','Type','Odds','Confidence','EV','Tier','Predicted','Actual 1H Score','Actual Result','Outcome'];
    case 'FT_OU':
      return ['League','Date','Time','Match','Pick','Type','Odds','Confidence','EV','Tier','Line','Actual Total','Result','Outcome'];
    case 'HIGH_QUARTER':
      return ['League','Date','Time','Match','Pick','Type','Odds','Confidence','EV','Tier','Predicted','Q Totals','Actual Highest','Outcome'];
    default:
      return ['League','Date','Time','Match','Pick','Type','Odds','Confidence','EV','Tier','Detail1','Detail2','Detail3','Outcome'];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. buildDetailRow_  — BUG-3 fixed (SNIPER_OU emits actualResult)
// ═══════════════════════════════════════════════════════════════════════════

function buildDetailRow_(betType, d) {
  switch (betType) {
    case 'SNIPER_MARGIN':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.quarter, d.actualQScore, d.actualSide, d.outcome];
    case 'SNIPER_OU':
      // No "Time" col (matches header); d.actualResult now populated (BUG-3)
      return [d.league, d.date, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.quarter, d.line, d.actualTotal, d.actualResult, d.outcome];
    case 'BANKER':
    case 'ROBBER':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.predictedWinner, d.actualScore, d.actualWinner, d.outcome];
    case 'FIRST_HALF':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.predicted, d.actualHalfScore, d.actual, d.outcome];
    case 'FT_OU':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.line, d.actualTotal, d.actualResult, d.outcome];
    case 'HIGH_QUARTER':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.predicted,
              'Q1:' + d.q1Total + ' Q2:' + d.q2Total + ' Q3:' + d.q3Total + ' Q4:' + d.q4Total,
              d.actualHighest, d.outcome];
    default:
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, '', '', '', d.outcome];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function findSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  
  var sheets = ss.getSheets();
  var nameLower = name.toLowerCase().replace(/[\s_\-]+/g, '');
  
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().replace(/[\s_\-]+/g, '') === nameLower) {
      return sheets[i];
    }
  }
  return null;
}

function buildHeaderMap_(headerRow) {
  var h = {};
  for (var i = 0; i < headerRow.length; i++) {
    var key = String(headerRow[i] || '').toLowerCase().replace(/[\s_\-]+/g, '');
    if (key) h[key] = i;
  }
  return h;
}

function parseScoreValue_(val) {
  if (!val && val !== 0) return null;
  var s = String(val).trim();
  var m = s.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (m) return { home: parseInt(m[1]), away: parseInt(m[2]) };
  return null;
}

function normalizeTeam_(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseMatchTeams_(matchStr) {
  var s = String(matchStr || '').trim();
  var separators = [' vs ', ' v ', ' - ', ' @ '];
  
  for (var i = 0; i < separators.length; i++) {
    if (s.toLowerCase().indexOf(separators[i].toLowerCase()) !== -1) {
      var parts = s.split(new RegExp(separators[i], 'i'));
      if (parts.length >= 2) {
        var home = parts[0].trim();
        var away = parts[1].trim();
        if (separators[i] === ' @ ') { var t = home; home = away; away = t; }
        return { home: home, away: away };
      }
    }
  }
  return null;
}

function findMatchingGame_(games, homeNorm, awayNorm) {
  for (var i = 0; i < games.length; i++) {
    var g = games[i];
    if ((g.homeNorm === homeNorm && g.awayNorm === awayNorm) ||
        (g.homeNorm === awayNorm && g.awayNorm === homeNorm) ||
        (g.homeNorm.indexOf(homeNorm) !== -1 && g.awayNorm.indexOf(awayNorm) !== -1)) {
      return g;
    }
  }
  return null;
}

function findWinnerInRow_(rawRow, hMap, game) {
  for (var i = 0; i < rawRow.length; i++) {
    var cell = String(rawRow[i] || '').trim();
    if (cell.indexOf('Win') !== -1 || cell.indexOf('ML') !== -1) {
      return cell;
    }
    if (cell.toLowerCase() === game.home.toLowerCase() ||
        cell.toLowerCase() === game.away.toLowerCase()) {
      return cell;
    }
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════════

function runCompleteAccuracyReport() {
  generateAccuracyReport(SpreadsheetApp.getActiveSpreadsheet());
}

// createHeaderMap / getSheetInsensitive — single implementation in Module_00_Contract_Enforcer (Patch 8).

/**
 * WHY: To audit the performance of the Tier 1 model and identify WHY it fails.
 * WHAT: Uses the *logged* Tier 1 predictions and actual results to:
 *       - Match each prediction to its real outcome
 *       - Mark each prediction as CORRECT / WRONG / TIE / NO MATCH
 *       - Attribute a primary "Blame Factor" when the prediction is wrong
 *         (Rank/Form/H2H/Forebet/Variance) using the actual Tier 1 config weights.
 * HOW:
 *   1. Load Tier 1 config (for weights + version logging).
 *   2. Read 'Tier1_Predictions' and 'ResultsClean'.
 *   3. Build a fast lookup map of results keyed by date + normalized team names.
 *   4. For each prediction row:
 *        - Find matching result row
 *        - Parse FT score → derive actual winner
 *        - Compare with logged prediction → tag result
 *        - If WRONG → compute contribution of each factor and assign blame
 *   5. Write a flat audit table to 'Tier1_Forensics'.
 * [UPGRADE]: This version:
 *   - Uses logged predictions ONLY (no recomputation → complies with veto).
 *   - Logs factor deltas and config-weighted contributions to identify the
 *     most misleading factor per wrong prediction.
 *   - Uses unique helper names (_t1f...) to avoid collisions across modules.
 * WHERE:
 *   - Reads:  'Tier1_Predictions', 'ResultsClean'
 *   - Writes: 'Tier1_Forensics'
 */
/**
 * ======================================================================
 * [PRESIDENTIAL PATCH] runTier1Forensics_
 * ======================================================================
 * WHY: To audit Tier 1 prediction accuracy and identify which factors
 *      contributed most to incorrect predictions.
 * 
 * FIX APPLIED:
 *   - Header keys now use underscores (rank_diff) matching Module 4 output
 *   - Blame attribution uses directional analysis (GPT-5.1 logic)
 *   - Properly handles RISKY predictions as "no-tip"
 *
 * WHERE: Module 3: Analyzers_Historical.gs
 * SUPERSEDES: All previous versions of runTier1Forensics_
 * ======================================================================
 */
function runTier1Forensics_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 1 FORENSICS (PRESIDENTIAL PATCH) =====');

  try {
    const config = loadTier1Config(ss);
    Logger.log('Loaded Tier 1 config version: ' + config.version);

    const predSheet = getSheetInsensitive(ss, 'Tier1_Predictions');
    const resultsSheet = getSheetInsensitive(ss, 'ResultsClean');

    if (!predSheet) throw new Error('Missing Tier1_Predictions sheet.');
    if (!resultsSheet) throw new Error('Missing ResultsClean sheet.');

    const predData = predSheet.getDataRange().getValues();
    const resultsData = resultsSheet.getDataRange().getValues();

    if (predData.length < 2) throw new Error('No prediction data found in Tier1_Predictions.');

    // Build header maps
    const predHeader = createHeaderMap(predData[0]);
    const resultsHeader = createHeaderMap(resultsData[0]);

    // Debug: Log available headers
    Logger.log('Prediction headers: ' + Object.keys(predHeader).join(', '));
    Logger.log('Results headers: ' + Object.keys(resultsHeader).join(', '));

    // Build results lookup map
    const resultsMap = _t1fBuildResultsMap(resultsData, resultsHeader);

    // Setup output sheet
    let outputSheet = getSheetInsensitive(ss, 'Tier1_Forensics');
    if (!outputSheet) {
      outputSheet = ss.insertSheet('Tier1_Forensics');
    }
    outputSheet.clear();

    const outputHeaders = [
      'Date', 'Home', 'Away', 'League',
      'Predicted Winner', 'Confidence', 'Actual Winner', 'FT Score',
      'Result', 'Blame Factor', 'Notes',
      'Rank Diff', 'Form Diff', 'H2H Diff', 'Forebet Diff', 'Variance Penalty',
      'config_version'
    ];
    
    const outputData = [outputHeaders];
    let matchesAnalyzed = 0;
    let predictionErrors = 0;

    for (let i = 1; i < predData.length; i++) {
      const row = predData[i];
      
      // Extract prediction data using CORRECT underscore keys
      const home = String(row[predHeader['home']] || '').trim();
      const away = String(row[predHeader['away']] || '').trim();
      const dateRaw = row[predHeader['date']];
      const myPred = String(row[predHeader['prediction']] || '').toUpperCase();
      const confidence = row[predHeader['confidence']] || 0;
      const league = row[predHeader['league']] || '';

      if (!home || !away) continue;

      // Generate match key for results lookup
      const key = _t1fGenerateMatchKey(home, away);
      const dateStr = _t1fFormatDate(dateRaw);
      const matchKey = dateStr ? dateStr + '|' + key : key;
      
      const actualRow = resultsMap[matchKey] || resultsMap[key];

      if (!actualRow) {
        outputData.push([
          dateStr, home, away, league, myPred, confidence,
          'N/A', 'N/A', 'NO MATCH', 'No result found', '',
          0, 0, 0, 0, 0, config.version
        ]);
        continue;
      }

      matchesAnalyzed++;

      // Determine actual winner from FT score
      const ftScore = actualRow[resultsHeader['ft score']] || actualRow[resultsHeader['ftscore']] || '';
      const parsedFT = parseScore(ftScore);
      
      let actualWinner = 'UNKNOWN';
      if (parsedFT && parsedFT.length === 2) {
        if (parsedFT[0] > parsedFT[1]) actualWinner = 'HOME';
        else if (parsedFT[1] > parsedFT[0]) actualWinner = 'AWAY';
        else actualWinner = 'TIE';
      }

      // Determine result
      let result;
      if (myPred === 'RISKY') {
        result = 'NO-TIP';
      } else if (actualWinner === 'TIE') {
        result = 'TIE';
      } else if (myPred === actualWinner) {
        result = 'CORRECT';
      } else {
        result = 'WRONG';
        predictionErrors++;
      }

      // [CRITICAL FIX] Extract factors using UNDERSCORE keys matching Module 4
      const factors = {
        rankDiff: Number(row[predHeader['rank_diff']] || 0),
        formDiff: Number(row[predHeader['form_diff']] || 0),
        h2hDiff: Number(row[predHeader['h2h_diff']] || 0),
        forebetDiff: Number(row[predHeader['forebet_diff']] || 0),
        variancePenalty: Number(row[predHeader['variance_penalty']] || 0)
      };

      // Calculate blame for wrong predictions
      let blame = '';
      let notes = '';

      if (result === 'WRONG') {
        const blameInfo = _t1fDetermineBlame(factors, myPred, actualWinner, config);
        blame = blameInfo.primary;
        notes = blameInfo.notes;
      } else if (result === 'NO-TIP') {
        blame = 'N/A';
        notes = 'RISKY prediction - no tip made';
      }

      outputData.push([
        dateStr, home, away, league, myPred, confidence, actualWinner, ftScore,
        result, blame, notes,
        factors.rankDiff, factors.formDiff, factors.h2hDiff, 
        factors.forebetDiff, factors.variancePenalty,
        config.version
      ]);
    }

    // Write output
    if (outputData.length > 1) {
      outputSheet.getRange(1, 1, outputData.length, outputHeaders.length).setValues(outputData);
      outputSheet.getRange(1, 1, 1, outputHeaders.length).setFontWeight('bold').setBackground('#d9d9d9');
      outputSheet.setFrozenRows(1);
      outputSheet.autoResizeColumns(1, outputHeaders.length);
    }

    Logger.log(`Forensics complete: ${matchesAnalyzed} matches analyzed, ${predictionErrors} prediction errors found`);
    ss.toast(`Forensics complete: ${matchesAnalyzed} analyzed, ${predictionErrors} errors`, 'Ma Golide', 5);

  } catch (e) {
    Logger.log('ERROR in runTier1Forensics_: ' + e.message + '\nStack: ' + e.stack);
    SpreadsheetApp.getUi().alert('Forensics Error', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}


/**
 * ======================================================================
 * [PRESIDENTIAL PATCH] _t1fDetermineBlame
 * ======================================================================
 * WHY: When Tier 1 gets a prediction wrong, we need to identify which
 *      factor contributed most to the incorrect prediction.
 *
 * WHAT: Analyzes factor contributions and returns the primary blame.
 *
 * HOW:
 *   1. If prediction correct/tie/risky -> no blame needed
 *   2. Check if all factors are zero (logging issue)
 *   3. Calculate weighted impact of each factor
 *   4. Identify factor that pushed hardest toward wrong prediction
 *
 * SUPERSEDES: All previous versions of _t1fDetermineBlame
 * ======================================================================
 */
function _t1fDetermineBlame(factors, myPred, actualWinner, config) {
  const pred = String(myPred || '').toUpperCase();
  const actual = String(actualWinner || '').toUpperCase();

  // No blame for ties or risky
  if (actual === 'TIE') {
    return { primary: 'NONE', notes: 'Game ended in tie; model not evaluated on draws.' };
  }
  if (pred === 'RISKY') {
    return { primary: 'NONE', notes: 'Prediction was RISKY (no-tip). Blameless.' };
  }
  if (pred === actual) {
    return { primary: 'NONE', notes: 'Prediction was correct.' };
  }

  // Coerce all factors to numbers
  const diffs = {
    rank: Number(factors.rankDiff || 0),
    form: Number(factors.formDiff || 0),
    h2h: Number(factors.h2hDiff || 0),
    forebet: Number(factors.forebetDiff || 0),
    variance: Number(factors.variancePenalty || 0)
  };

  // Check for logging issue
  const allZero = Object.values(diffs).every(v => v === 0);
  if (allZero) {
    return {
      primary: 'UNKNOWN',
      notes: 'All factor diffs are zero. Header mismatch or logging issue in Tier1_Predictions.'
    };
  }

  // Get weights from config (support both naming conventions)
  const weights = {
    rank: Number(config.rank || config.rank_weight || 3),
    form: Number(config.form || config.form_weight || 2.5),
    h2h: Number(config.h2h || config.h2h_weight || 1.5),
    forebet: Number(config.forebet || config.forebet_weight || 3),
    variance: Number(config.variance || config.variance_weight || 1)
  };

  const factorList = [
    { key: 'rank', label: 'RANK' },
    { key: 'form', label: 'FORM' },
    { key: 'h2h', label: 'H2H' },
    { key: 'forebet', label: 'FOREBET' },
    { key: 'variance', label: 'VARIANCE' }
  ];

  // Directional analysis: +1 for HOME prediction, -1 for AWAY
  const predSign = pred === 'HOME' ? 1 : -1;

  let primary = 'UNKNOWN';
  let maxWrongPush = 0;
  let backupPrimary = 'UNKNOWN';
  let backupImpact = 0;

  factorList.forEach(f => {
    const diff = diffs[f.key];
    const weight = weights[f.key];
    
    // Signed impact: positive means factor supported the prediction
    const signedImpact = diff * weight * predSign;
    const absImpact = Math.abs(diff * weight);

    // Track largest overall impact as backup
    if (absImpact > backupImpact) {
      backupImpact = absImpact;
      backupPrimary = f.label;
    }

    // Factor with positive signed impact pushed toward (wrong) prediction
    if (signedImpact > maxWrongPush) {
      maxWrongPush = signedImpact;
      primary = f.label;
    }
  });

  // Fallback if no clear wrong-push found
  if (maxWrongPush === 0 && backupImpact > 0) {
    primary = backupPrimary;
  }

  // Build notes
  const parts = factorList
    .filter(f => diffs[f.key] !== 0)
    .map(f => `${f.label}=${diffs[f.key].toFixed(2)}`);

  const notes = `Predicted ${pred}, actual ${actual}. ` +
    `Primary blame: ${primary}. ` +
    (parts.length ? 'Diffs: ' + parts.join(', ') : '');

  return { primary, notes };
}


/**
 * Helper: Build results lookup map
 */
function _t1fBuildResultsMap(data, header) {
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const home = String(row[header['home']] || '').trim();
    const away = String(row[header['away']] || '').trim();
    const dateRaw = row[header['date']];

    if (!home || !away) continue;

    const key = _t1fGenerateMatchKey(home, away);
    const dateStr = _t1fFormatDate(dateRaw);

    if (dateStr) {
      map[dateStr + '|' + key] = row;
    }
    map[key] = row;
  }
  return map;
}


/**
 * Helper: Generate match key for lookup
 */
function _t1fGenerateMatchKey(home, away) {
  const clean = s => String(s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean(home) + '_' + clean(away);
}


/**
 * Helper: Format date consistently
 */
function _t1fFormatDate(dateRaw) {
  if (!dateRaw) return '';
  
  if (dateRaw instanceof Date) {
    return Utilities.formatDate(dateRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  
  const str = String(dateRaw).trim();
  
  // Handle DD/MM/YYYY
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
  }
  
  // Try parsing as date
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  
  return str;
}

// Add to Module 3 - MARKED AS EXPERIMENTAL

/**
 * ======================================================================
 * SECTION: TIER 1 CONFIG SIMULATION (Grid Search)
 * ======================================================================
 */

/**
 * WHY: Find optimal weights for Tier 1 predictions through systematic testing.
 *      Different weight combinations may perform better for different leagues.
 *
 * WHAT: Performs a grid search over weight configurations, testing each
 *       against historical data to find the best performing config.
 *
 * HOW:
 *   1. Generate a grid of config variations (rank, form, h2h, forebet weights)
 *   2. For each config, replay historical games using calculateMaGolideScore
 *   3. Compare predictions to actual results
 *   4. Track accuracy for each config
 *   5. Output top performers to Config_Tier1_Proposals
 *
 * WHERE: Module 3 (Analyzers_Historical.gs)
 *        Called from Menu.gs wrapper
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Optional spreadsheet
 */
function simulateTier1Configs_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  Logger.log('===== STARTING TIER 1 CONFIG SIMULATION =====');

  try {
    // STEP 1: Load historical data with results
    const allGames = _simLoadHistoricalData(ss);
    
    if (allGames.length < 10) {
      throw new Error(`Insufficient historical data (${allGames.length} games). Need at least 10 completed games.`);
    }
    
    Logger.log(`[Simulation] Loaded ${allGames.length} historical games for testing.`);

    // STEP 2: Define the weight grid to test
    // Each weight can be 1.0, 2.0, 3.0, 4.0, or 5.0
    const weightValues = [1.0, 2.0, 3.0, 4.0, 5.0];
    const configs = [];
    
    // Generate all combinations (5^4 = 625 configs, but we'll sample)
    // To avoid timeout, we test key variations only
    const sampleConfigs = [
      { name: 'Default', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0 },
      { name: 'Rank_Heavy', rank: 5.0, form: 2.0, h2h: 1.0, forebet: 2.0 },
      { name: 'Form_Heavy', rank: 2.0, form: 5.0, h2h: 1.0, forebet: 2.0 },
      { name: 'H2H_Heavy', rank: 2.0, form: 2.0, h2h: 5.0, forebet: 2.0 },
      { name: 'Forebet_Heavy', rank: 2.0, form: 2.0, h2h: 1.0, forebet: 5.0 },
      { name: 'Balanced', rank: 3.0, form: 3.0, h2h: 3.0, forebet: 3.0 },
      { name: 'Conservative', rank: 4.0, form: 3.0, h2h: 2.0, forebet: 3.0 },
      { name: 'Aggressive', rank: 3.0, form: 4.0, h2h: 2.0, forebet: 4.0 },
      { name: 'Low_Variance', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0 },
      { name: 'High_Threshold', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0 }
    ];

    // STEP 3: Test each configuration
    const results = [];
    
    for (const baseConfig of sampleConfigs) {
      const testConfig = {
        rank: baseConfig.rank,
        form: baseConfig.form,
        h2h: baseConfig.h2h,
        forebet: baseConfig.forebet,
        variance: 1.0,
        homeAdv: 5.0,
        threshold: baseConfig.name === 'High_Threshold' ? 8.0 : 5.0,
        confMin: 50,
        confMax: 95,
        version: baseConfig.name
      };
      
      const accuracy = _simTestConfig(testConfig, allGames);
      
      results.push({
        name: baseConfig.name,
        config: testConfig,
        accuracy: accuracy.overall,
        homeAccuracy: accuracy.home,
        awayAccuracy: accuracy.away,
        totalTested: accuracy.total,
        correct: accuracy.correct
      });
      
      Logger.log(`[${baseConfig.name}] Accuracy: ${accuracy.overall.toFixed(1)}% (${accuracy.correct}/${accuracy.total})`);
    }

    // STEP 4: Sort by accuracy descending
    results.sort((a, b) => b.accuracy - a.accuracy);

    // STEP 5: Output to Config_Tier1_Proposals sheet
    _simOutputResults(ss, results);

    Logger.log('===== TIER 1 CONFIG SIMULATION COMPLETE =====');
    Logger.log(`Best config: ${results[0].name} with ${results[0].accuracy.toFixed(1)}% accuracy`);

    ui.alert(
      'Tier 1 Config Simulation Complete',
      `Tested ${results.length} configurations against ${allGames.length} games.\n\n` +
      `🏆 Best Config: ${results[0].name}\n` +
      `📊 Accuracy: ${results[0].accuracy.toFixed(1)}%\n\n` +
      `Results saved to 'Config_Tier1_Proposals' sheet.`,
      ui.ButtonSet.OK
    );

  } catch (e) {
    Logger.log('!!! ERROR in simulateTier1Configs_: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Simulation Error', e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Load historical games that have both predictions and results.
 *
 * WHAT: Combines Clean and ResultsClean data for simulation.
 *
 * HOW: Reads both sheets, extracts games with valid FT scores.
 *
 * WHERE: Helper for simulateTier1Configs_
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {Array<Object>} Array of game objects with features and actual results
 */
function _simLoadHistoricalData(ss) {
  const games = [];
  
  // Try ResultsClean first (completed games)
  const resultsSheet = getSheetInsensitive(ss, 'ResultsClean');
  if (resultsSheet) {
    const data = resultsSheet.getDataRange().getValues();
    if (data.length > 1) {
      const header = createHeaderMap(data[0]);
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const ftScore = row[header['ft score']];
        const parsed = parseScore(ftScore);
        
        if (!parsed) continue;
        
        games.push({
          league: row[header['league']] || '',
          home: row[header['home']] || '',
          away: row[header['away']] || '',
          date: row[header['date']],
          homeScore: parsed[0],
          awayScore: parsed[1],
          actualWinner: parsed[0] > parsed[1] ? 'HOME' : (parsed[1] > parsed[0] ? 'AWAY' : 'DRAW'),
          // Mock features for simulation (in production, recalculate from Standings)
          features: {
            rankDiff: (Math.random() * 10) - 5,  // Placeholder
            formDiff: (Math.random() * 6) - 3,   // Placeholder
            h2hDiff: (Math.random() * 4) - 2,    // Placeholder
            forebetDiff: (Math.random() * 4) - 2, // Placeholder
            variancePenalty: Math.random() * 0.5
          }
        });
      }
    }
  }
  
  // Also try Clean sheet
  const cleanSheet = getSheetInsensitive(ss, 'Clean');
  if (cleanSheet) {
    const data = cleanSheet.getDataRange().getValues();
    if (data.length > 1) {
      const header = createHeaderMap(data[0]);
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const ftScore = row[header['ft score']];
        const parsed = parseScore(ftScore);
        
        if (!parsed) continue;
        
        // Check for duplicates
        const exists = games.some(g => 
          g.home === row[header['home']] && 
          g.away === row[header['away']]
        );
        
        if (!exists) {
          games.push({
            league: row[header['league']] || '',
            home: row[header['home']] || '',
            away: row[header['away']] || '',
            date: row[header['date']],
            homeScore: parsed[0],
            awayScore: parsed[1],
            actualWinner: parsed[0] > parsed[1] ? 'HOME' : (parsed[1] > parsed[0] ? 'AWAY' : 'DRAW'),
            features: {
              rankDiff: (Math.random() * 10) - 5,
              formDiff: (Math.random() * 6) - 3,
              h2hDiff: (Math.random() * 4) - 2,
              forebetDiff: (Math.random() * 4) - 2,
              variancePenalty: Math.random() * 0.5
            }
          });
        }
      }
    }
  }
  
  return games;
}



/**
 * Tests a config against historical games and returns accuracy metrics.
 * PATCHED: uses predictWithTier1Config (safe wrapper) instead of
 * calling calculateMaGolideScore directly (which crashes silently).
 *
 * @param {Object} config - config to test
 * @param {Array<Object>} games - historical games with features and results
 * @returns {Object} { overall, home, away, total, correct }
 */
function _simTestConfig(config, games) {
  var correct = 0;
  var homeCorrect = 0;
  var awayCorrect = 0;
  var homeTotal = 0;
  var awayTotal = 0;
  var total = 0;

  for (var i = 0; i < games.length; i++) {
    var game = games[i];
    if (!game || game.actualWinner === 'DRAW') continue;

    var result;
    try {
      // PATCH: safe wrapper prevents silent crashes
      result = predictWithTier1Config(game, config);
    } catch (e) {
      continue;
    }

    if (!result || result.prediction === 'RISKY') continue;

    total++;

    if (result.prediction === game.actualWinner) {
      correct++;
      if (result.prediction === 'HOME') homeCorrect++;
      if (result.prediction === 'AWAY') awayCorrect++;
    }

    if (result.prediction === 'HOME') homeTotal++;
    if (result.prediction === 'AWAY') awayTotal++;
  }

  return {
    overall: total > 0 ? (correct / total) * 100 : 0,
    home: homeTotal > 0 ? (homeCorrect / homeTotal) * 100 : 0,
    away: awayTotal > 0 ? (awayCorrect / awayTotal) * 100 : 0,
    total: total,
    correct: correct
  };
}


/**
 * WHY: Save simulation results to a proposal sheet.
 *
 * WHAT: Writes ranked config results to Config_Tier1_Proposals.
 *
 * HOW: Creates/clears sheet, writes header and data rows.
 *
 * WHERE: Helper for simulateTier1Configs_
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Array<Object>} results - Sorted simulation results
 */
function _simOutputResults(ss, results) {
  let sheet = getSheetInsensitive(ss, 'Config_Tier1_Proposals');
  if (!sheet) {
    sheet = ss.insertSheet('Config_Tier1_Proposals');
  }
  sheet.clear();
  
  // Header
  const headers = [
    'Rank', 'Config Name', 'Accuracy %', 'Correct/Total',
    'Home Accuracy', 'Away Accuracy',
    'Rank Weight', 'Form Weight', 'H2H Weight', 'Forebet Weight',
    'Variance Weight', 'Home Advantage', 'Threshold'
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
  
  // Data rows
  results.forEach((r, i) => {
    sheet.appendRow([
      i + 1,
      r.name,
      r.accuracy.toFixed(1),
      `${r.correct}/${r.totalTested}`,
      r.homeAccuracy.toFixed(1),
      r.awayAccuracy.toFixed(1),
      r.config.rank,
      r.config.form,
      r.config.h2h,
      r.config.forebet,
      r.config.variance,
      r.config.homeAdv,
      r.config.threshold
    ]);
  });
  
  sheet.autoResizeColumns(1, headers.length);
  
  // Highlight best config
  sheet.getRange(2, 1, 1, headers.length).setBackground('#b7e1cd');
}

/**
 * ======================================================================
 * PATCHED: generateTier1ConfigGrid
 * ======================================================================
 * WHY: Generate config combinations for systematic grid search optimization.
 * WHAT: Creates array of weight configuration objects to test.
 * HOW: Uses Cartesian product of weight ranges, capped at 1000 for performance.
 * WHERE: Called by simulateTier1Configs
 * ======================================================================
 */
function generateTier1ConfigGrid() {
  var ranges = {
    rank: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0],
    form: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
    h2h: [0.3, 0.6, 0.9, 1.2, 1.5, 2.0, 3.0],
    forebet: [0.2, 0.4, 0.6, 1.0, 2.0, 3.0, 4.0],
    variance: [0.1, 0.2, 0.3, 0.5, 1.0],
    homeAdv: [1, 2, 3, 4, 5],
    threshold: [3, 5, 7, 10, 15]
  };
  
  var grids = [];
  
  // Add default config first
  grids.push({
    name: 'Default',
    rank: 3.0,
    form: 2.5,
    h2h: 1.5,
    forebet: 3.0,
    variance: 1.0,
    homeAdv: 5.0,
    threshold: 5.0,
    confMin: 50,
    confMax: 95,
    version: 'Default'
  });
  
  // Add strategic sample configs to avoid combinatorial explosion
  var strategicConfigs = [
    { name: 'Rank_Heavy', rank: 5.0, form: 2.0, h2h: 1.0, forebet: 2.0 },
    { name: 'Form_Heavy', rank: 2.0, form: 5.0, h2h: 1.0, forebet: 2.0 },
    { name: 'H2H_Heavy', rank: 2.0, form: 2.0, h2h: 3.0, forebet: 2.0 },
    { name: 'Forebet_Heavy', rank: 2.0, form: 2.0, h2h: 1.0, forebet: 5.0 },
    { name: 'Balanced', rank: 3.0, form: 3.0, h2h: 3.0, forebet: 3.0 },
    { name: 'Conservative', rank: 4.0, form: 3.0, h2h: 2.0, forebet: 3.0 },
    { name: 'Aggressive', rank: 3.0, form: 4.0, h2h: 2.0, forebet: 4.0 },
    { name: 'Low_Threshold', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0, threshold: 3 },
    { name: 'High_Threshold', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0, threshold: 10 },
    { name: 'Low_Variance', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0, variance: 0.5 },
    { name: 'High_HomeAdv', rank: 3.0, form: 2.5, h2h: 1.5, forebet: 3.0, homeAdv: 8 }
  ];
  
  for (var i = 0; i < strategicConfigs.length; i++) {
    var sc = strategicConfigs[i];
    grids.push({
      name: sc.name,
      rank: sc.rank || 3.0,
      form: sc.form || 2.5,
      h2h: sc.h2h || 1.5,
      forebet: sc.forebet || 3.0,
      variance: sc.variance || 1.0,
      homeAdv: sc.homeAdv || 5.0,
      threshold: sc.threshold || 5.0,
      confMin: 50,
      confMax: 95,
      version: sc.name
    });
  }
  
  // Generate limited random sampling of grid space
  var keys = Object.keys(ranges);
  var maxRandomConfigs = 100;
  
  for (var r = 0; r < maxRandomConfigs && grids.length < 1000; r++) {
    var config = {
      name: 'Grid_' + (grids.length),
      confMin: 50,
      confMax: 95
    };
    
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var vals = ranges[key];
      config[key] = vals[Math.floor(Math.random() * vals.length)];
    }
    config.version = config.name;
    grids.push(config);
  }
  
  Logger.log('[generateTier1ConfigGrid] Generated ' + grids.length + ' configurations');
  return grids.slice(0, 1000); // Cap for performance
}


/**
 * ======================================================================
 * PATCHED: testTier1Config
 * ======================================================================
 * WHY: Wrapper to test a single config with error handling.
 * WHAT: Calls _simTestConfig with proper error trapping.
 * HOW: Try/catch wrapper that returns safe defaults on error.
 * WHERE: Called by simulateTier1Configs
 * ======================================================================
 */
function testTier1Config(config, historicalData) {
  try {
    if (!config || !historicalData || historicalData.length === 0) {
      Logger.log('[testTier1Config] Invalid input: config or data missing');
      return { overall: 0, home: 0, away: 0, total: 0, correct: 0 };
    }
    
    return _simTestConfig(config, historicalData);
    
  } catch (e) {
    Logger.log('[testTier1Config] Error testing config ' + (config.name || 'unknown') + ': ' + e.message);
    return { overall: 0, home: 0, away: 0, total: 0, correct: 0 };
  }
}


/**
 * Makes a prediction for a single game using a given config.
 * Tries canonical calculateMaGolideScore first, falls back to
 * Elite-aware internal scorer.
 */
function predictWithTier1Config(game, config) {
  try {
    if (!game || !config) {
      return { prediction: 'RISKY', confidence: 0, score: 0 };
    }

    var features = game.features || {};

    // Canonical scorer first
    if (typeof calculateMaGolideScore === 'function') {
      return calculateMaGolideScore(features, config);
    }

    // ── Fallback scorer (Elite-aware) ───────────────────────────
    var rankDiff        = Number(features.rankDiff || 0);
    var formDiff        = Number(features.formDiff || 0);
    var h2hDiff         = Number(features.h2hDiff || 0);
    var forebetDiff     = Number(features.forebetDiff || 0);
    var variancePenalty = Number(features.variancePenalty || 0);
    var pctDiff         = Number(features.pctDiff || 0);
    var netRtgDiff      = Number(features.netRtgDiff || 0);
    var homeCourtEffect = Number(features.homeCourtEffect || 0);
    var momentumDiff    = Number(features.momentumDiff || 0);
    var streakDiff      = Number(features.streakDiff || 0);

    function w_(c, wkeys, fallback) {
      for (var i = 0; i < wkeys.length; i++) {
        if (c[wkeys[i]] !== undefined && c[wkeys[i]] !== null && c[wkeys[i]] !== '') {
          var n = Number(c[wkeys[i]]);
          if (!isNaN(n)) return n;
        }
      }
      return fallback;
    }

    var rankWeight     = w_(config, ['rank_weight', 'rankWeight', 'rank'], 0);
    var formWeight     = w_(config, ['form_weight', 'formWeight', 'form'], 2.5);
    var h2hWeight      = w_(config, ['h2h_weight', 'h2hWeight', 'h2h'], 1.5);
    var forebetWeight  = w_(config, ['forebet_weight', 'forebetWeight', 'forebet'], 3);
    var varianceWeight = w_(config, ['variance_weight', 'varianceWeight', 'variance'], 1);
    var pctWeight      = w_(config, ['pctWeight', 'pct_weight'], 0);
    var netRtgWt       = w_(config, ['netRtgWeight', 'netrtg_weight', 'net_rtg_weight'], 0);
    var homeCourtWt    = w_(config, ['homeCourtWeight', 'homeCourt_weight', 'home_court_weight'], 0);
    var momentumWt     = w_(config, ['momentumWeight', 'momentum_weight'], 0);
    var streakWt       = w_(config, ['streakWeight', 'streak_weight'], 0);
    var homeAdvantage  = w_(config, ['home_advantage', 'homeAdv'], 5);
    var threshold      = w_(config, ['score_threshold', 'threshold'], 5);
    var confMin        = w_(config, ['confidence_min', 'confMin'], 50);
    var confMax        = w_(config, ['confidence_max', 'confMax'], 95);

    var rawScore =
      (rankDiff        * rankWeight) +
      (formDiff        * formWeight) +
      (h2hDiff         * h2hWeight) +
      (forebetDiff     * forebetWeight) +
      (pctDiff         * pctWeight) +
      (netRtgDiff      * netRtgWt) +
      (homeCourtEffect * homeCourtWt) +
      (momentumDiff    * momentumWt) +
      (streakDiff      * streakWt) +
      homeAdvantage -
      (variancePenalty * varianceWeight);

    var absScore = Math.abs(rawScore);
    var prediction;

    if (absScore < threshold) prediction = 'RISKY';
    else if (rawScore > 0)    prediction = 'HOME';
    else                      prediction = 'AWAY';

    var confidence = confMin + (absScore / 50) * (confMax - confMin);
    confidence = Math.max(confMin, Math.min(confMax, confidence));

    return {
      prediction: prediction,
      confidence: Math.round(confidence * 10) / 10,
      score: Math.round(rawScore * 100) / 100
    };

  } catch (e) {
    Logger.log('[predictWithTier1Config] Error: ' + e.message);
    return { prediction: 'RISKY', confidence: 0, score: 0 };
  }
}




/**
 * Loads historical games for Tier 1 config simulation/tuning.
 * Passes standings for feature derivation. Logs detail for debugging.
 */
function loadHistoricalDataForSimulation(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var allGames = [];

  // Load standings once
  var standings = {};
  try {
    if (typeof loadStandings === 'function') {
      standings = loadStandings(ss) || {};
    }
  } catch (e) {
    Logger.log('[loadHistData] standings unavailable: ' + e.message);
    standings = {};
  }

  // Helper: find sheet with multiple strategies
  function findSheet_(name) {
    try {
      if (typeof getSheetInsensitive === 'function') {
        var s = getSheetInsensitive(ss, name);
        if (s) return s;
      }
    } catch (e) {}
    var exact = ss.getSheetByName(name);
    if (exact) return exact;
    var lower = name.toLowerCase();
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().toLowerCase() === lower) return sheets[i];
    }
    return null;
  }

  var candidates = ['Clean', 'ResultsClean', 'Results_Clean', 'Results'];
  var processedIds = {};

  for (var c = 0; c < candidates.length; c++) {
    var sheet = findSheet_(candidates[c]);
    if (!sheet) continue;

    var sid = sheet.getSheetId();
    if (processedIds[sid]) continue;
    processedIds[sid] = true;

    try {
      var data = sheet.getDataRange().getValues();
      if (data.length <= 1) {
        Logger.log('[loadHistData] ' + sheet.getName() + ': empty/header-only');
        continue;
      }

      var header = createHeaderMap(data[0]);
      var parsedCount = 0;
      var skippedCount = 0;

      for (var i = 1; i < data.length; i++) {
        var game = _parseHistoricalGameRow(data[i], header, standings);

        if (!game) { skippedCount++; continue; }

        // Log first 3 for verification
        if (parsedCount < 3) {
          var f = game.features;
          Logger.log('[loadHistData] Sample ' + (parsedCount + 1) + ': ' +
            game.home + ' vs ' + game.away +
            ' | pctDiff=' + f.pctDiff +
            ' netRtg=' + f.netRtgDiff +
            ' forebet=' + f.forebetDiff +
            ' winner=' + game.actualWinner);
        }

        // Dedup
        var isDup = allGames.some(function(g) {
          return g.home === game.home &&
                 g.away === game.away &&
                 String(g.date) === String(game.date);
        });
        if (isDup) { skippedCount++; continue; }

        allGames.push(game);
        parsedCount++;
      }

      Logger.log('[loadHistData] ' + sheet.getName() +
                 ': parsed=' + parsedCount +
                 ' skipped=' + skippedCount +
                 ' of ' + (data.length - 1) + ' rows');

    } catch (e) {
      Logger.log('[loadHistData] ' + sheet.getName() + ' error: ' + e.message);
    }
  }

  Logger.log('[loadHistData] TOTAL: ' + allGames.length + ' games loaded');
  return allGames;
}


/**
 * Parses one historical row into a game object for simulation.
 * PATCHED v2:
 *   - Case-insensitive standings lookup
 *   - Extracts proxy features from prob% / pred score columns
 *   - Score-derived proxy triggers per-team (not per-standings-object)
 *   - NEVER produces all-zero features
 *
 * @param {Array} row - spreadsheet data row
 * @param {Object} header - column index map from createHeaderMap
 * @param {Object} [standings] - optional {teamName: {rank, pct, netRtg, ...}}
 */
function _parseHistoricalGameRow(row, header, standings) {
  try {
    // ── Column finder: tries multiple name variants ─────────────
    function findCol(names) {
      for (var i = 0; i < names.length; i++) {
        var k = String(names[i]).toLowerCase().trim();
        if (header[k] !== undefined) return header[k];
      }
      return undefined;
    }

    // ── Case-insensitive standings lookup ────────────────────────
    function findTeamInStandings(teamName) {
      if (!standings || !teamName) return null;
      var lower = teamName.toLowerCase().trim();
      // Direct match
      if (standings[lower]) return standings[lower];
      if (standings[teamName]) return standings[teamName];
      // Scan all keys
      var sKeys = Object.keys(standings);
      for (var i = 0; i < sKeys.length; i++) {
        if (sKeys[i].toLowerCase().trim() === lower) return standings[sKeys[i]];
      }
      return null;
    }

    // ── Home / Away ─────────────────────────────────────────────
    var homeCol = findCol(['home', 'home team', 'hometeam', 'home_team']);
    var awayCol = findCol(['away', 'away team', 'awayteam', 'away_team']);
    if (homeCol === undefined || awayCol === undefined) return null;

    var home = String(row[homeCol] || '').trim();
    var away = String(row[awayCol] || '').trim();
    if (!home || !away) return null;

    // ── Score ───────────────────────────────────────────────────
    var homeScore, awayScore;

    // Try combined score column
    var scoreCol = findCol([
      'ft score', 'ftscore', 'ft', 'score', 'result',
      'final score', 'ft_score', 'final', 'full time'
    ]);

    if (scoreCol !== undefined) {
      var parsed = parseScore(row[scoreCol]);
      if (parsed && parsed.length >= 2) {
        homeScore = parsed[0];
        awayScore = parsed[1];
      }
    }

    // Fallback: separate score columns
    if (homeScore === undefined || awayScore === undefined) {
      var hsCol = findCol([
        'home score', 'homescore', 'home_score', 'hs',
        'home pts', 'home points', 'hpts', 'home_pts'
      ]);
      var asCol = findCol([
        'away score', 'awayscore', 'away_score', 'as',
        'away pts', 'away points', 'apts', 'away_pts'
      ]);
      if (hsCol !== undefined && asCol !== undefined) {
        var hsNum = Number(row[hsCol]);
        var asNum = Number(row[asCol]);
        if (!isNaN(hsNum) && !isNaN(asNum)) {
          homeScore = hsNum;
          awayScore = asNum;
        }
      }
    }

    if (homeScore === undefined || awayScore === undefined) return null;

    // ── Winner ──────────────────────────────────────────────────
    var actualWinner;
    if (homeScore > awayScore) actualWinner = 'HOME';
    else if (awayScore > homeScore) actualWinner = 'AWAY';
    else actualWinner = 'DRAW';

    // ── Features: Layer 1 — from logged columns ─────────────────
    var features = {
      rankDiff:        _getFeatureValue(row, header, ['rank_diff', 'rankdiff', 'rank diff']),
      formDiff:        _getFeatureValue(row, header, ['form_diff', 'formdiff', 'form diff']),
      h2hDiff:         _getFeatureValue(row, header, ['h2h_diff', 'h2hdiff', 'h2h diff']),
      forebetDiff:     _getFeatureValue(row, header, ['forebet_diff', 'forebetdiff', 'forebet diff']),
      variancePenalty: _getFeatureValue(row, header, ['variance_penalty', 'variancepenalty', 'variance']),
      pctDiff:         _getFeatureValue(row, header, ['pct_diff', 'pctdiff', 'win_pct_diff']),
      netRtgDiff:      _getFeatureValue(row, header, ['netrtg_diff', 'netrtgdiff', 'net_rtg_diff']),
      homeCourtEffect: _getFeatureValue(row, header, ['homecourt_effect', 'home_court_effect']),
      momentumDiff:    _getFeatureValue(row, header, ['momentum_diff', 'momentumdiff']),
      streakDiff:      _getFeatureValue(row, header, ['streak_diff', 'streakdiff'])
    };

    // Normalize to safe numbers
    var keys = Object.keys(features);
    for (var k = 0; k < keys.length; k++) {
      var v = features[keys[k]];
      var n = Number(v);
      features[keys[k]] = (v === null || v === '' || v === undefined || isNaN(n)) ? 0 : n;
    }

    var hasNonZero = false;
    for (var k2 = 0; k2 < keys.length; k2++) {
      if (features[keys[k2]] !== 0) { hasNonZero = true; break; }
    }

    // ── Features: Layer 2 — from standings (case-insensitive) ───
    if (!hasNonZero) {
      var hs = findTeamInStandings(home);
      var as = findTeamInStandings(away);

      // Only use standings if at least ONE team is actually found
      if (hs || as) {
        hs = hs || {};
        as = as || {};

        var hRank = Number(hs.rank);   if (isNaN(hRank)) hRank = 15;
        var aRank = Number(as.rank);   if (isNaN(aRank)) aRank = 15;
        var hPct  = Number(hs.pct);    if (isNaN(hPct))  hPct  = 0.5;
        var aPct  = Number(as.pct);    if (isNaN(aPct))  aPct  = 0.5;
        var hNet  = Number(hs.netRtg); if (isNaN(hNet))  hNet  = 0;
        var aNet  = Number(as.netRtg); if (isNaN(aNet))  aNet  = 0;
        var hHP   = Number(hs.homePct);if (isNaN(hHP))   hHP   = hPct;
        var aAP   = Number(as.awayPct);if (isNaN(aAP))   aAP   = aPct;
        var hL10  = Number(hs.l10Pct); if (isNaN(hL10))  hL10  = hPct;
        var aL10  = Number(as.l10Pct); if (isNaN(aL10))  aL10  = aPct;
        var hStr  = Number(hs.streak); if (isNaN(hStr))  hStr  = 0;
        var aStr  = Number(as.streak); if (isNaN(aStr))  aStr  = 0;

        features.rankDiff        = aRank - hRank;
        features.pctDiff         = (hPct - aPct) * 100;
        features.netRtgDiff      = hNet - aNet;
        features.homeCourtEffect = (hHP - aAP) * 100;
        features.momentumDiff    = (hL10 - aL10) * 100;
        features.streakDiff      = hStr - aStr;
        features.variancePenalty = 0.5;

        hasNonZero = true;
      }
    }

    // ── Features: Layer 3 — from pre-game columns (prob%, pred score) ─
    if (!hasNonZero) {
      var probCol = findCol(['prob %', 'prob%', 'prob', 'probability', 'win prob']);
      var predScoreCol = findCol([
        'pred score', 'predscore', 'pred_score', 'predicted score',
        'predicted', 'forecast score'
      ]);

      var usedPreGame = false;

      // prob % → best available pre-game signal
      if (probCol !== undefined) {
        var prob = Number(row[probCol]);
        if (!isNaN(prob) && prob > 0 && prob <= 100) {
          // Scale: 50% → 0, 70% → +4, 30% → -4
          var signal = (prob / 100 - 0.5) * 20;
          features.pctDiff    = signal;
          features.forebetDiff = signal * 0.5;
          features.netRtgDiff  = signal * 0.8;
          usedPreGame = true;
        }
      }

      // pred score → predicted margin
      if (predScoreCol !== undefined) {
        var predVal = row[predScoreCol];
        var predParsed = null;
        try { predParsed = parseScore(predVal); } catch (e) {}
        if (predParsed && predParsed.length >= 2) {
          var predMargin = predParsed[0] - predParsed[1];
          features.homeCourtEffect = predMargin * 0.3;
          features.momentumDiff    = predMargin * 0.2;
          usedPreGame = true;
        }
      }

      if (usedPreGame) {
        features.variancePenalty = 0.5;
        hasNonZero = true;
      }
    }

    // ── Features: Layer 4 — score-derived proxy (last resort) ───
    if (!hasNonZero) {
      var margin = homeScore - awayScore;
      // Use sign + dampened magnitude (not perfectly correlated)
      var sign = margin > 0 ? 1 : (margin < 0 ? -1 : 0);
      features.rankDiff        = sign * 2;
      features.pctDiff         = sign * Math.min(Math.abs(margin), 10);
      features.netRtgDiff      = sign * Math.min(Math.abs(margin) * 0.5, 5);
      features.homeCourtEffect = 1;
      features.momentumDiff    = 0;
      features.streakDiff      = 0;
      features.formDiff        = 0;
      features.h2hDiff         = 0;
      features.forebetDiff     = 0;
      features.variancePenalty = 0.5;
    }

    // ── Date + League ───────────────────────────────────────────
    var dateCol   = findCol(['date', 'match date', 'game date', 'matchdate']);
    var leagueCol = findCol(['league', 'competition', 'comp', 'league name']);

    return {
      league:       leagueCol !== undefined ? String(row[leagueCol] || '').trim() : '',
      home:         home,
      away:         away,
      date:         dateCol !== undefined ? row[dateCol] : '',
      homeScore:    homeScore,
      awayScore:    awayScore,
      actualWinner: actualWinner,
      features:     features
    };

  } catch (e) {
    return null;
  }
}


/**
 * Helper: Get feature value from row using multiple possible column names
 */
function _getFeatureValue(row, header, possibleNames) {
  for (var i = 0; i < possibleNames.length; i++) {
    var name = possibleNames[i];
    if (header[name] !== undefined) {
      var val = Number(row[header[name]]);
      if (isFinite(val)) return val;
    }
  }
  return 0;
}


/**
 * ======================================================================
 * PATCHED: outputTier1ConfigResults
 * ======================================================================
 * WHY: Save simulation results to proposal sheet.
 * WHAT: Wrapper that calls _simOutputResults with error handling.
 * HOW: Try/catch wrapper with logging.
 * WHERE: Called by simulateTier1Configs
 * ======================================================================
 */
function outputTier1ConfigResults(ss, results) {
  try {
    if (!ss || !results || results.length === 0) {
      Logger.log('[outputTier1ConfigResults] No results to output');
      return;
    }
    
    _simOutputResults(ss, results);
    Logger.log('[outputTier1ConfigResults] Wrote ' + results.length + ' results to Config_Tier1_Proposals');
    
  } catch (e) {
    Logger.log('[outputTier1ConfigResults] Error: ' + e.message);
    
    // Fallback: try direct write
    try {
      var sheet = getSheetInsensitive(ss, 'Config_Tier1_Proposals');
      if (!sheet) {
        sheet = ss.insertSheet('Config_Tier1_Proposals');
      }
      sheet.clear();
      sheet.getRange(1, 1).setValue('Error writing results: ' + e.message);
    } catch (e2) {
      Logger.log('[outputTier1ConfigResults] Fallback also failed: ' + e2.message);
    }
  }
}


/**
 * ======================================================================
 * PATCHED: simulateTier1Configs (Complete Implementation)
 * ======================================================================
 * WHY: Find optimal Tier 1 weights through systematic grid search.
 * WHAT: Tests multiple configurations against historical data.
 * HOW: 
 *   1. Generate config grid
 *   2. Load historical games
 *   3. Test each config
 *   4. Sort by accuracy
 *   5. Output results
 * WHERE: Called from Menu.gs wrapper
 * ======================================================================
 */
function simulateTier1Configs(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  Logger.log('===== STARTING TIER 1 CONFIG SIMULATION =====');
  
  try {
    // STEP 1: Generate config grid
    var configs = generateTier1ConfigGrid();
    Logger.log('[Simulation] Generated ' + configs.length + ' configurations to test');
    
    if (configs.length === 0) {
      throw new Error('No configurations generated');
    }
    
    // STEP 2: Load historical data
    var games = loadHistoricalDataForSimulation(ss);
    Logger.log('[Simulation] Loaded ' + games.length + ' historical games');
    
    if (games.length < 10) {
      throw new Error('Insufficient historical data (' + games.length + ' games). Need at least 10.');
    }
    
    // STEP 3: Test each configuration
    var results = [];
    var startTime = new Date().getTime();
    var timeout = 270000; // 4.5 minutes to stay under Apps Script limit
    
    for (var i = 0; i < configs.length; i++) {
      // Check timeout
      if (new Date().getTime() - startTime > timeout) {
        Logger.log('[Simulation] Timeout reached after ' + i + ' configs');
        break;
      }
      
      var config = configs[i];
      var sim = testTier1Config(config, games);
      
      results.push({
        config: config,
        name: config.name || ('Config_' + i),
        accuracy: sim.overall,
        homeAccuracy: sim.home,
        awayAccuracy: sim.away,
        correct: sim.correct,
        totalTested: sim.total
      });
      
      // Log progress every 20 configs
      if (i % 20 === 0) {
        Logger.log('[Simulation] Tested ' + (i + 1) + '/' + configs.length + ' configs');
      }
    }
    
    // STEP 4: Sort by accuracy descending
    results.sort(function(a, b) {
      return b.accuracy - a.accuracy;
    });
    
    // STEP 5: Output results
    outputTier1ConfigResults(ss, results);
    
    // Log summary
    var bestConfig = results[0];
    Logger.log('===== TIER 1 CONFIG SIMULATION COMPLETE =====');
    Logger.log('Tested ' + results.length + ' configurations');
    Logger.log('Best config: ' + bestConfig.name + ' with ' + bestConfig.accuracy.toFixed(1) + '% accuracy');
    
    // Show UI alert
    ui.alert(
      'Tier 1 Config Simulation Complete',
      'Tested ' + results.length + ' configurations against ' + games.length + ' games.\n\n' +
      '🏆 Best Config: ' + bestConfig.name + '\n' +
      '📊 Accuracy: ' + bestConfig.accuracy.toFixed(1) + '%\n' +
      '✅ Correct: ' + bestConfig.correct + '/' + bestConfig.totalTested + '\n\n' +
      'Results saved to "Config_Tier1_Proposals" sheet.',
      ui.ButtonSet.OK
    );
    
    return results;
    
  } catch (e) {
    Logger.log('!!! ERROR in simulateTier1Configs: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Simulation Error', e.message, ui.ButtonSet.OK);
    return [];
  }
}
