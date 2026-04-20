/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  MODULE 9                                                                 ║
 * ║  PROJECT: Ma Golide Basketball Betting System                             ║
 * ║  VERSION: 1.1.0 DIAGNOSTIC EDITION                                        ║
 * ║                                                                           ║
 * ║  FEATURES:                                                                ║
 * ║  1. Unified Confidence Tier System (Elite/Strong/Medium/Weak)             ║
 * ║  2. ROBBERS Engine (Upset Detection)                                      ║
 * ║  3. First Half 1x2 Prediction                                             ║
 * ║  4. Full Time Over/Under                                                  ║
 * ║  5. Enhanced Highest Quarter Prediction                                   ║
 * ║  6. Standardized Output Formatter                                         ║
 * ║                                                                           ║
 * ║  DIAGNOSTIC: All functions include detailed logging for troubleshooting   ║
 * ║  INTEGRATES WITH: MOD1 (Helpers), MOD5 (Margins), MOD6 (O/U), MOD8 (Acca) ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */


// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC CONTROL - Set to true for verbose logging
// ═══════════════════════════════════════════════════════════════════════════
var ENH_DEBUG = true;  // Set to false in production to reduce log volume

/**
 * Diagnostic logger - only logs when ENH_DEBUG is true
 * @param {string} fn - Function name
 * @param {string} msg - Message to log
 */
function _enh_log(fn, msg) {
  if (ENH_DEBUG) {
    Logger.log('[' + fn + '] ' + msg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: UNIFIED CONFIDENCE TIER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps confidence percentage to tier display with visual symbols
 * @param {number} confPct - Confidence percentage (0-100)
 * @return {string} Formatted display: "★ (76%) ★"
 */
function getOUTierDisplay(confPct) {
  var fn = 'getOUTierDisplay';
  _enh_log(fn, 'ENTER: confPct=' + confPct + ' (type: ' + typeof confPct + ')');
  
  if (!isFinite(confPct) || confPct === null || confPct === undefined) {
    _enh_log(fn, 'EXIT: Invalid confPct, returning N/A');
    return 'N/A';
  }
  
  var pct = Math.round(confPct);
  _enh_log(fn, 'Rounded pct=' + pct);
  
  var result;
  if (pct >= 75) {
    result = '★ (' + pct + '%) ★';
    _enh_log(fn, 'EXIT: ELITE tier → ' + result);
  } else if (pct >= 70) {
    result = '★ (' + pct + '%) ●';
    _enh_log(fn, 'EXIT: STRONG tier → ' + result);
  } else if (pct >= 58) {
    result = '● (' + pct + '%) ○';
    _enh_log(fn, 'EXIT: MEDIUM tier → ' + result);
  } else if (pct >= 50) {
    result = '○ (' + pct + '%)';
    _enh_log(fn, 'EXIT: WEAK tier → ' + result);
  } else {
    result = '(' + pct + '%)';
    _enh_log(fn, 'EXIT: Below threshold → ' + result);
  }
  
  return result;
}

/**
 * Returns tier name based on confidence percentage
 * @param {number} confPct - Confidence percentage
 * @return {string} ELITE|STRONG|MEDIUM|WEAK|SKIP
 */
function getOUTier(confPct) {
  var fn = 'getOUTier';
  _enh_log(fn, 'ENTER: confPct=' + confPct);
  
  if (!isFinite(confPct)) {
    _enh_log(fn, 'EXIT: Not finite, returning SKIP');
    return 'SKIP';
  }
  
  var tier;
  if (confPct >= 75) {
    tier = 'ELITE';
  } else if (confPct >= 70) {
    tier = 'STRONG';
  } else if (confPct >= 58) {
    tier = 'MEDIUM';
  } else if (confPct >= 50) {
    tier = 'WEAK';
  } else {
    tier = 'SKIP';
  }
  
  _enh_log(fn, 'EXIT: ' + confPct + '% → ' + tier);
  return tier;
}

/**
 * PATCHED: Strict-mode safe + no forbidden reflective access.
 * - Does NOT rely on _enh_log (which may use caller/callee/arguments introspection in your project).
 * - Clamps + normalizes confidence safely.
 *
 * @param {number} confPct - Confidence percentage
 * @return {Object} {tier, symbol, display, color, weight}
 */
function getTierObject(confPct) {
  var fn = 'getTierObject';

  function safeLog_(msg) {
    try {
      // Avoid _enh_log entirely (common source of strict-mode caller/callee crashes)
      Logger.log('[' + fn + '] ' + msg);
    } catch (e) {}
  }

  var n = Number(confPct);
  if (!isFinite(n)) n = 0;

  // normalize
  n = Math.round(n);
  if (n < 0) n = 0;
  if (n > 100) n = 100;

  safeLog_('ENTER: confPct=' + confPct + ' → pct=' + n);

  var result;
  if (n >= 75) {
    result = {
      tier: 'ELITE',
      symbol: '★★',
      display: '★ (' + n + '%) ★',
      color: '#006400',
      weight: 1.0
    };
  } else if (n >= 70) {
    result = {
      tier: 'STRONG',
      symbol: '★●',
      display: '★ (' + n + '%) ●',
      color: '#228B22',
      weight: 0.85
    };
  } else if (n >= 58) {
    result = {
      tier: 'MEDIUM',
      symbol: '●○',
      display: '● (' + n + '%) ○',
      color: '#FFD700',
      weight: 0.65
    };
  } else if (n >= 50) {
    result = {
      tier: 'WEAK',
      symbol: '○',
      display: '○ (' + n + '%)',
      color: '#FFA500',
      weight: 0.45
    };
  } else {
    result = {
      tier: 'SKIP',
      symbol: '',
      display: '(' + n + '%)',
      color: '#CCCCCC',
      weight: 0.0
    };
  }

  safeLog_('EXIT: tier=' + result.tier + ', weight=' + result.weight);
  return result;
}

/**
 * Gets tier thresholds from config or returns defaults
 * @param {Object} config - Configuration object
 * @return {Object} {elite, strong, medium, Weak}
 */
function getTierThresholds(config) {
  var fn = 'getTierThresholds';
  _enh_log(fn, 'ENTER: config=' + (config ? 'provided' : 'null/undefined'));
  
  config = config || {};
  
  var thresholds = {
    elite: _enh_toNum(config.tier_elite_min, 75),
    strong: _enh_toNum(config.tier_strong_min, 70),
    medium: _enh_toNum(config.tier_medium_min, 58),
    Weak: _enh_toNum(config.tier_Weak_min, 50)
  };
  
  _enh_log(fn, 'EXIT: elite=' + thresholds.elite + ', strong=' + thresholds.strong + 
           ', medium=' + thresholds.medium + ', Weak=' + thresholds.Weak);
  return thresholds;
}

// ─────────────────────────────────────────────────────────────────────────────
// KEEP THESE — Required dependencies not redefined in new code
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize header/key string for matching
 */
function _robbers_normKey_(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[%#@!]/g, '')
    .replace(/[\s\-_]+/g, '');
}

/**
 * Parse score string like "105-98" or "105:98"
 */
function _robbers_parseScore_(scoreStr) {
  if (!scoreStr) return null;
  var m = String(scoreStr).match(/(\d+)\s*[-:]\s*(\d+)/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

/**
 * Parse prediction value - supports multiple formats
 */
function _robbers_parsePick_(v) {
  if (v === 1 || v === '1') return 1;
  if (v === 2 || v === '2') return 2;
  
  var s = String(v || '').trim().toLowerCase();
  if (s === 'home' || s === 'h' || s === '1') return 1;
  if (s === 'away' || s === 'a' || s === 'visitor' || s === '2') return 2;
  
  return 0;
}

/**
 * Parse prediction for specific game - also matches team names
 */
function _robbers_parsePickForGame_(predRaw, home, away) {
  var pick = _robbers_parsePick_(predRaw);
  if (pick === 1 || pick === 2) return pick;
  
  var pred = String(predRaw || '').trim().toLowerCase();
  if (!pred) return 0;
  
  var homeNorm = String(home || '').trim().toLowerCase();
  var awayNorm = String(away || '').trim().toLowerCase();
  
  if (pred === homeNorm) return 1;
  if (pred === awayNorm) return 2;
  if (homeNorm && (pred.indexOf(homeNorm) !== -1 || homeNorm.indexOf(pred) !== -1)) return 1;
  if (awayNorm && (pred.indexOf(awayNorm) !== -1 || awayNorm.indexOf(pred) !== -1)) return 2;
  
  return 0;
}

/**
 * Infer opponent odds from known odds using overround assumption
 */
function _robbers_inferOtherOdds_(knownOdds, config) {
  var fn = '_robbers_inferOtherOdds_';
  
  knownOdds = _robbers_toNum_(knownOdds, 0);
  if (knownOdds <= 1.01) {
    _robbers_log_(fn, 'Invalid knownOdds: ' + knownOdds);
    return 0;
  }
  
  var overround = _robbers_toNum_(config.inferOverround, 0.06);
  var floor = _robbers_toNum_(config.inferProbFloor, 0.06);
  var ceil = _robbers_toNum_(config.inferProbCeil, 0.94);
  
  var pKnown = Math.max(floor, Math.min(ceil, 1 / knownOdds));
  var pOther = (1 + overround) - pKnown;
  
  if (pOther <= 0 || pOther >= 1) {
    pOther = Math.max(floor, Math.min(1 - floor, 1 - pKnown - 0.03));
  }
  
  var otherOdds = 1 / pOther;
  var dp = Math.max(0, parseInt(config.inferRoundTo, 10) || 2);
  var pow = Math.pow(10, dp);
  otherOdds = Math.round(otherOdds * pow) / pow;
  otherOdds = Math.max(1.01, Math.min(config.maxOdds || 50, otherOdds));
  
  _robbers_log_(fn, 'knownOdds=' + knownOdds.toFixed(2) + ' → otherOdds=' + otherOdds.toFixed(2));
  
  return otherOdds;
}

/**
 * Resolve home/away odds from gameData, inferring if necessary
 */
function _robbers_resolveOdds_(gameData, config) {
  var fn = '_robbers_resolveOdds_';
  
  var homeOdds = _robbers_toNum_(gameData.homeOdds, 0);
  var awayOdds = _robbers_toNum_(gameData.awayOdds, 0);
  var source = 'direct';
  var inferred = false;
  
  _robbers_log_(fn, 'Direct: home=' + homeOdds + ', away=' + awayOdds);
  
  if (homeOdds > 1.01 && awayOdds > 1.01) {
    return { homeOdds: homeOdds, awayOdds: awayOdds, source: source, inferred: inferred };
  }
  
  var predRaw = gameData.forebetPick || gameData.pred || gameData.prediction || 
                gameData.Pred || gameData.PRED || gameData.pick;
  var pickOddsRaw = gameData.forebetOdds || gameData.odds || gameData.Odds || 
                   gameData.avgOdds || gameData.avg_odds || gameData.avg;
  
  var home = String(gameData.home || '').trim();
  var away = String(gameData.away || '').trim();
  var pick = _robbers_parsePickForGame_(predRaw, home, away);
  var pickOdds = _robbers_toNum_(pickOddsRaw, 0);
  
  _robbers_log_(fn, 'Pred parse: predRaw="' + predRaw + '" → pick=' + pick + ', pickOdds=' + pickOdds);
  
  if (homeOdds <= 0 && awayOdds <= 0 && (pick === 1 || pick === 2) && pickOdds > 1.01) {
    inferred = true;
    source = 'inferred from Pred+Odds';
    
    if (pick === 1) {
      homeOdds = pickOdds;
      awayOdds = _robbers_inferOtherOdds_(pickOdds, config);
    } else {
      awayOdds = pickOdds;
      homeOdds = _robbers_inferOtherOdds_(pickOdds, config);
    }
    
    _robbers_log_(fn, 'Inferred: home=' + homeOdds + ', away=' + awayOdds);
  }
  else if (homeOdds > 1.01 && awayOdds <= 0) {
    inferred = true;
    source = 'away inferred from home';
    awayOdds = _robbers_inferOtherOdds_(homeOdds, config);
  }
  else if (awayOdds > 1.01 && homeOdds <= 0) {
    inferred = true;
    source = 'home inferred from away';
    homeOdds = _robbers_inferOtherOdds_(awayOdds, config);
  }
  
  return { homeOdds: homeOdds, awayOdds: awayOdds, source: source, inferred: inferred };
}

/**
 * Load H2H statistics from CleanH2H_* sheets
 */
function loadRobbersH2HStats(ss) {
  var fn = 'loadRobbersH2HStats';
  _robbers_log_(fn, 'ENTER');
  
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var h2hStats = {};
  var sheets = ss.getSheets();
  
  for (var si = 0; si < sheets.length; si++) {
    var name = sheets[si].getName();
    if (!/^CleanH2H_/i.test(name)) continue;
    
    var data = sheets[si].getDataRange().getValues();
    if (!data || data.length < 2) continue;
    
    var h = _robbers_headerMap_(data[0]);
    if (h.home === undefined || h.away === undefined) continue;
    
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var home = String(row[h.home] || '').trim();
      var away = String(row[h.away] || '').trim();
      if (!home || !away) continue;
      
      var matchKey = (home + ' vs ' + away).toLowerCase();
      
      if (!h2hStats[matchKey]) {
        h2hStats[matchKey] = {
          totalGames: 0,
          homeWins: 0,
          awayWins: 0,
          quarterWins: {},
          halfWins: {},
          _h1Samples: 0,
          _h2Samples: 0
        };
      }
      
      var stats = h2hStats[matchKey];
      stats.totalGames++;
      
      var ftScore = row[h.ft] || row[h.ftscore] || '';
      var parsed = _robbers_parseScore_(ftScore);
      if (parsed) {
        if (parsed[0] > parsed[1]) stats.homeWins++;
        else if (parsed[1] > parsed[0]) stats.awayWins++;
      }
      
      var q = {};
      ['q1', 'q2', 'q3', 'q4'].forEach(function(qq) {
        var hIdx = h[qq + 'h'], aIdx = h[qq + 'a'];
        if (hIdx !== undefined && aIdx !== undefined) {
          var hS = _robbers_toNum_(row[hIdx], NaN);
          var aS = _robbers_toNum_(row[aIdx], NaN);
          if (!isNaN(hS) && !isNaN(aS)) {
            q[qq + 'h'] = hS;
            q[qq + 'a'] = aS;
            
            if (!stats.quarterWins[home]) stats.quarterWins[home] = {};
            if (!stats.quarterWins[away]) stats.quarterWins[away] = {};
            var Q = qq.toUpperCase();
            stats.quarterWins[home][Q] = (stats.quarterWins[home][Q] || 0) + (hS > aS ? 1 : 0);
            stats.quarterWins[away][Q] = (stats.quarterWins[away][Q] || 0) + (aS > hS ? 1 : 0);
          }
        }
      });
      
      if (q.q1h != null && q.q2h != null) {
        stats._h1Samples++;
        var h1H = q.q1h + q.q2h, h1A = q.q1a + q.q2a;
        if (h1H > h1A) stats.halfWins[home + '_H1'] = (stats.halfWins[home + '_H1'] || 0) + 1;
        else if (h1A > h1H) stats.halfWins[away + '_H1'] = (stats.halfWins[away + '_H1'] || 0) + 1;
      }
      
      if (q.q3h != null && q.q4h != null) {
        stats._h2Samples++;
        var h2H = q.q3h + q.q4h, h2A = q.q3a + q.q4a;
        if (h2H > h2A) stats.halfWins[home + '_H2'] = (stats.halfWins[home + '_H2'] || 0) + 1;
        else if (h2A > h2H) stats.halfWins[away + '_H2'] = (stats.halfWins[away + '_H2'] || 0) + 1;
      }
    }
  }
  
  for (var key in h2hStats) {
    var s = h2hStats[key];
    if (s.totalGames > 0) {
      for (var team in s.quarterWins) {
        for (var qtr in s.quarterWins[team]) {
          s.quarterWins[team][qtr] /= s.totalGames;
        }
      }
      for (var hk in s.halfWins) {
        var denom = /_H1$/.test(hk) ? s._h1Samples : s._h2Samples;
        s.halfWins[hk] = denom > 0 ? s.halfWins[hk] / denom : s.halfWins[hk] / s.totalGames;
      }
    }
    delete s._h1Samples;
    delete s._h2Samples;
  }
  
  _robbers_log_(fn, 'EXIT: ' + Object.keys(h2hStats).length + ' matchups');
  return h2hStats;
}

/**
 * Load recent form from CleanRecentHome_* and CleanRecentAway_* sheets
 */
function loadRobbersRecentForm(ss, lastNGames) {
  var fn = 'loadRobbersRecentForm';
  _robbers_log_(fn, 'ENTER: lastNGames=' + lastNGames);
  
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  lastNGames = lastNGames || 10;
  var recentForm = {};
  
  var sheets = ss.getSheets();
  
  for (var si = 0; si < sheets.length; si++) {
    var name = sheets[si].getName();
    if (!/^CleanRecent(Home|Away)_/i.test(name)) continue;
    
    var data = sheets[si].getDataRange().getValues();
    if (!data || data.length < 2) continue;
    
    var h = _robbers_headerMap_(data[0]);
    var isHome = /home/i.test(name);
    var startRow = Math.max(1, data.length - lastNGames);
    
    for (var r = startRow; r < data.length; r++) {
      var row = data[r];
      var team = String(row[isHome ? h.home : h.away] || '').trim();
      if (!team) continue;
      
      if (!recentForm[team]) recentForm[team] = { wins: 0, losses: 0, games: 0 };
      recentForm[team].games++;
      
      var ftScore = row[h.ft] || row[h.ftscore] || '';
      var parsed = _robbers_parseScore_(ftScore);
      if (parsed) {
        var teamScore = isHome ? parsed[0] : parsed[1];
        var oppScore = isHome ? parsed[1] : parsed[0];
        if (teamScore > oppScore) recentForm[team].wins++;
        else recentForm[team].losses++;
      }
    }
  }
  
  _robbers_log_(fn, 'EXIT: ' + Object.keys(recentForm).length + ' teams');
  return recentForm;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROBBERS MODULE v2.2 — UNIFIED TIER/CONFIDENCE CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// DROP-IN REPLACEMENT — Fixes:
//   1. Calibrates ROBBER confidence using market-anchored Bayesian shrinkage
//   2. Computes EV from calibrated probabilities (no more 250%+ EVs)
//   3. Uses unified tier system (ELITE/STRONG/MEDIUM/WEAK)
//   4. Standard confidence display format (★ (64%) ●)
//   5. Preserves all existing scoring logic and thresholds
//   6. Zero breaking changes to consumers of these functions
//
// FUNCTIONS REPLACED:
//   - _robbers_normalizePick_ (new)
//   - _robbers_buildTierDisplay_ (new)
//   - _robbers_getTierSuffix_ (stub for backwards compat)
//   - detectRobbers
//   - predictRobbers
//   - detectAllRobbers
//   - _writeBetSlipsEnhanced
//
// ═══════════════════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 1: HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Verbose logging flag — controlled by config
 */
var _robbers_verbose_ = false;

/**
 * Logging helper with conditional verbosity
 */
function _robbers_log_(fn, msg) {
  if (_robbers_verbose_ || /ERROR|WARN|★★★|EXIT/.test(String(msg))) {
    Logger.log('[' + fn + '] ' + msg);
  }
}

/**
 * Safe numeric conversion with fallback
 */
function _robbers_toNum_(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  var n = parseFloat(String(val).replace(/[,%$]/g, '').trim());
  return isFinite(n) ? n : fallback;
}

/**
 * Merge config objects (shallow, non-null override)
 */
function _robbers_mergeConfig_(defaults, custom) {
  var result = {};
  var key;
  if (defaults) {
    for (key in defaults) {
      if (defaults.hasOwnProperty(key)) {
        result[key] = defaults[key];
      }
    }
  }
  if (custom) {
    for (key in custom) {
      if (custom.hasOwnProperty(key) && custom[key] !== undefined && custom[key] !== null) {
        result[key] = custom[key];
      }
    }
  }
  return result;
}

/**
 * Case-insensitive sheet getter
 */
function _robbers_getSheet_(ss, name) {
  var sheets = ss.getSheets();
  var nameLower = String(name).toLowerCase();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === nameLower) {
      return sheets[i];
    }
  }
  return null;
}

/**
 * Build header index map from row
 */
function _robbers_headerMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || '').toLowerCase().trim().replace(/[\s_]+/g, '');
    if (h) map[h] = i;
  }
  return map;
}

/**
 * Get value from row using multiple key aliases
 */
function _robbers_getVal_(row, hMap, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i].toLowerCase().replace(/[\s_]+/g, '');
    if (hMap.hasOwnProperty(k) && hMap[k] !== undefined && row[hMap[k]] !== undefined) {
      return row[hMap[k]];
    }
  }
  return undefined;
}

/**
 * Tier suffix helper — stub for backwards compatibility
 * Returns empty string since unified tiers replace custom suffixes
 */
function _robbers_getTierSuffix_(confidence) {
  return '';
}


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 2: CALIBRATION CONFIG DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// ROBBERS CONFIG — COMPLETE (Inference + Calibration)
// ═══════════════════════════════════════════════════════════════════════════════

var ROBBERS_CONFIG_DEFAULTS = {
  // ─── H2H REQUIREMENTS ──────────────────────────────────────────────────────
  minH2HGames: 1,
  underdogWinThreshold: 0.30,
  
  // ─── MOMENTUM REQUIREMENTS ─────────────────────────────────────────────────
  momentumGames: 5,
  momentumWinThreshold: 0.55,
  
  // ─── ODDS BOUNDS ───────────────────────────────────────────────────────────
  minOdds: 1.80,
  maxOdds: 12.00,
  maxFavoriteOdds: 1.95,
  
  // ─── SCORING THRESHOLDS ────────────────────────────────────────────────────
  minScore: 20,
  maxConfidence: 80,
  
  // ─── ODDS INFERENCE (CRITICAL - was missing!) ──────────────────────────────
  inferOverround: 0.06,
  inferProbFloor: 0.06,
  inferProbCeil: 0.94,
  inferRoundTo: 2,
  
  // ─── TIERING THRESHOLDS ────────────────────────────────────────────────────
  solidScore: 35,
  primeScore: 45,
  eliteScore: 55,
  eliteMaxUnderdogOdds: 6.50,
  eliteMaxFavoriteOdds: 1.65,
  eliteMinEV: 0.00,
  
  // ─── CALIBRATION (NEW - for unified tier system) ───────────────────────────
  calibrationShrink: 0.38,
  calibrationMaxProb: 0.67,
  calibrationMinEdge: 0.08,
  calibrationMaxEV: 0.85,
  
  // ─── LOGGING ───────────────────────────────────────────────────────────────
  enableVerboseLogging: true
};


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 3: TIER DISPLAY BUILDER
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Build standard tier display string
 * Format: "★ (64%) ●" or "● (58%) ○"
 *
 * @param {number} confPct — Confidence percentage (0-100)
 * @param {number} ev — Expected value as decimal (e.g., 0.25 = 25%)
 * @returns {string} Formatted tier display
 */
function _robbers_buildTierDisplay_(confPct, ev) {
  var confSymbol, evSymbol;
  
  // Confidence symbol
  if (confPct >= 70) {
    confSymbol = '★';
  } else if (confPct >= 60) {
    confSymbol = '●';
  } else {
    confSymbol = '○';
  }
  
  // EV symbol (ev is decimal)
  if (ev >= 0.12) {
    evSymbol = '★';
  } else if (ev >= 0.05) {
    evSymbol = '●';
  } else {
    evSymbol = '○';
  }
  
  return confSymbol + ' (' + confPct + '%) ' + evSymbol;
}


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 4: CORE NORMALIZATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * _robbers_normalizePick_ — Calibrate ROBBER to unified tier/confidence system
 *
 * Uses Bayesian shrinkage to anchor model probability toward market implied probability.
 * This produces realistic confidence values for upset picks.
 *
 * Formula: calibrated = implied + (raw - implied) × shrink
 *   - shrink=0.38 means: 62% weight to market, 38% weight to model
 *   - This acknowledges markets are efficient while giving credit to our signals
 *
 * @param {Object} robber — Raw robber pick from detectRobbers
 * @param {Object} config — Config with calibration parameters
 * @returns {Object} Normalized robber pick (mutated in place)
 */
function _robbers_normalizePick_(robber, config) {
  var fn = '_robbers_normalizePick_';
  
  if (!robber) return null;
  config = config || {};
  
  // ─── STEP 1: Validate and extract odds ─────────────────────────────────────
  var odds = _robbers_toNum_(robber.odds || robber.underdogOdds, 0);
  if (odds <= 1.01) {
    // No valid odds — return unchanged
    return robber;
  }
  
  var impliedProb = 1.0 / odds;
  
  // ─── STEP 2: Extract raw confidence and convert to probability ─────────────
  var rawConf = _robbers_toNum_(robber.confidence, 50);
  
  // Store original values for debugging
  robber._rawConfidence = rawConf;
  robber._rawTier = robber.tier;
  robber._rawTierDisplay = robber.tierDisplay;
  robber._impliedProb = Math.round(impliedProb * 1000) / 1000;
  
  // Normalize to 0-1 probability (handle both percentage and decimal inputs)
  var rawProb = (rawConf > 1.5) ? (rawConf / 100) : rawConf;
  rawProb = Math.max(0.01, Math.min(0.99, rawProb));
  
  // ─── STEP 3: Bayesian shrinkage toward market probability ──────────────────
  var shrink = _robbers_toNum_(config.calibrationShrink, 0.38);
  shrink = Math.max(0.15, Math.min(0.60, shrink)); // Bound shrink factor
  
  var calibratedProb = impliedProb + (rawProb - impliedProb) * shrink;
  
  // ─── STEP 4: Apply realistic bounds for underdogs ──────────────────────────
  var maxProb = _robbers_toNum_(config.calibrationMaxProb, 0.67);
  maxProb = Math.min(0.75, maxProb);
  
  var minEdge = _robbers_toNum_(config.calibrationMinEdge, 0.08);
  var minProb = Math.min(maxProb - 0.05, impliedProb + minEdge);
  minProb = Math.max(0.30, minProb);
  
  if (calibratedProb > maxProb) calibratedProb = maxProb;
  if (calibratedProb < minProb) calibratedProb = minProb;
  
  // ─── STEP 5: Convert to confidence percentage ──────────────────────────────
  var confPct = Math.round(calibratedProb * 100);
  if (confPct < 50) confPct = 50;
  if (confPct > 95) confPct = 95;
  
  // ─── STEP 6: Recompute EV and edge from calibrated probability ─────────────
  var ev = calibratedProb * (odds - 1) - (1 - calibratedProb);
  var edge = calibratedProb - impliedProb;
  
  var maxEV = _robbers_toNum_(config.calibrationMaxEV, 0.85);
  ev = Math.max(-0.50, Math.min(maxEV, ev));
  
  // ─── STEP 7: Derive unified tier ───────────────────────────────────────────
  var tier, tierDisplay;
  
  // Try system tier function first
  if (typeof getTierObject === 'function') {
    try {
      var tierObj = getTierObject(confPct);
      if (tierObj && tierObj.tier) {
        tier = tierObj.tier;
        tierDisplay = tierObj.display || _robbers_buildTierDisplay_(confPct, ev);
      }
    } catch (e) {
      // Fall through to manual
    }
  }
  
  // Manual fallback if system function unavailable
  if (!tier) {
    if (confPct >= 70) {
      tier = 'ELITE';
    } else if (confPct >= 63) {
      tier = 'STRONG';
    } else if (confPct >= 55) {
      tier = 'MEDIUM';
    } else {
      tier = 'WEAK';
    }
    tierDisplay = _robbers_buildTierDisplay_(confPct, ev);
  }
  
  // ─── STEP 8: Update robber object ──────────────────────────────────────────
  robber.confidence = confPct;
  robber.ev = Math.round(ev * 10000) / 10000;
  robber.edge = Math.round(edge * 10000) / 10000;
  robber.tier = tier;
  robber.tierDisplay = tierDisplay;
  robber._calibratedProb = Math.round(calibratedProb * 1000) / 1000;
  
  _robbers_log_(fn, 
    robber.pick + ' @' + odds.toFixed(2) + 
    ' | Raw=' + rawConf.toFixed(1) + '% → Cal=' + confPct + 
    '% | EV=' + (ev * 100).toFixed(1) + '% | Tier=' + tier
  );
  
  return robber;
}


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 5: MAIN DETECTION FUNCTION — detectRobbers
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Detect if a game represents a ROBBER (upset) opportunity
 *
 * @param {Object} gameData — Game info with home, away, odds
 * @param {Object} h2hStats — H2H statistics for this matchup
 * @param {Object} recentForm — Recent form data by team
 * @param {Object} config — Optional config overrides
 * @returns {Object|null} Normalized robber pick object or null
 */
function detectRobbers(gameData, h2hStats, recentForm, config) {
  var fn = 'detectRobbers';
  _robbers_log_(fn, '════════════════════════════════════════════════════════════');
  
  // Merge config once at entry
  config = _robbers_mergeConfig_(ROBBERS_CONFIG_DEFAULTS, config);
  _robbers_verbose_ = config.enableVerboseLogging !== false;
  
  // ─── INPUT VALIDATION ──────────────────────────────────────────────────────
  if (!gameData || !gameData.home || !gameData.away) {
    _robbers_log_(fn, 'EXIT: Invalid gameData');
    return null;
  }
  
  var home = String(gameData.home).trim();
  var away = String(gameData.away).trim();
  _robbers_log_(fn, 'Match: ' + home + ' vs ' + away);
  
  // ─── ODDS RESOLUTION ───────────────────────────────────────────────────────
  var resolved;
  if (typeof _robbers_resolveOdds_ === 'function') {
    resolved = _robbers_resolveOdds_(gameData, config);
  } else {
    resolved = {
      homeOdds: _robbers_toNum_(gameData.homeOdds || gameData.home_odds, 0),
      awayOdds: _robbers_toNum_(gameData.awayOdds || gameData.away_odds, 0),
      source: 'direct',
      inferred: false
    };
  }
  
  var homeOdds = resolved.homeOdds;
  var awayOdds = resolved.awayOdds;
  
  _robbers_log_(fn, 'Resolved odds: home=' + homeOdds + ', away=' + awayOdds + ' (' + resolved.source + ')');
  
  var oddsAvailable = (homeOdds > 0 && awayOdds > 0);
  
  if (!oddsAvailable) {
    _robbers_log_(fn, 'WARNING: Odds not available — using prediction-based fallback (winner/loser mode)');
  }

  // ─── FAVORITE/UNDERDOG DETERMINATION ───────────────────────────────────────
  // When odds are missing, determine sides from prediction data:
  //   gameData.pred  → 1 = home predicted winner, 2 = away predicted winner
  //   gameData.probHome / gameData.probAway → probability percentages
  //   gameData.prob  → composite string like "56 - 44"
  var isHomeUnderdog;
  var underdog, favorite;
  var underdogOdds = 0, favoriteOdds = 0;

  if (oddsAvailable) {
    isHomeUnderdog = (homeOdds > awayOdds);
    underdogOdds   = isHomeUnderdog ? homeOdds : awayOdds;
    favoriteOdds   = isHomeUnderdog ? awayOdds : homeOdds;
  } else {
    // Fall back to prediction direction
    var predWinner = _robbers_toNum_(gameData.pred || gameData.predicted_winner || 0, 0);
    var probHome   = _robbers_toNum_(gameData.probHome || gameData.prob_home || 0, 0);
    var probAway   = _robbers_toNum_(gameData.probAway || gameData.prob_away || 0, 0);

    // Parse combined prob string "56 - 44"
    if (!probHome && !probAway && gameData.prob) {
      var probStr = String(gameData.prob || '');
      var probParts = probStr.split(/[\-–\/]/);
      if (probParts.length >= 2) {
        probHome = _robbers_toNum_(probParts[0].trim(), 0);
        probAway = _robbers_toNum_(probParts[1].trim(), 0);
      }
    }

    if (predWinner === 2) {
      // Away is predicted favorite → home is the potential underdog to back
      isHomeUnderdog = true;
    } else if (predWinner === 1) {
      // Home is predicted favorite → away is the potential underdog to back
      isHomeUnderdog = false;
    } else if (probHome > 0 || probAway > 0) {
      // Use probability: higher prob = favorite, so underdog = lower prob side
      isHomeUnderdog = (probHome < probAway);
    } else {
      var hForm = 0, aForm = 0;
      if (recentForm) {
        var hK = home.toLowerCase().replace(/[^a-z0-9]/g, '');
        var aK = away.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (var k in recentForm) {
          var tk = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
          if (tk === hK && recentForm[k]) hForm = _robbers_toNum_(recentForm[k].overallWinRate, 0);
          if (tk === aK && recentForm[k]) aForm = _robbers_toNum_(recentForm[k].overallWinRate, 0);
        }
      }
      isHomeUnderdog = (hForm <= aForm); // default Home underdog if tied
      _robbers_log_(fn, 'Sides inferred from Form: ' + (isHomeUnderdog ? home : away) + ' is underdog (no odds or pred)');
    }
  }


  underdog = isHomeUnderdog ? home : away;
  favorite = isHomeUnderdog ? away : home;

  if (oddsAvailable) {
    _robbers_log_(fn, 'Favorite: ' + favorite + ' @' + favoriteOdds.toFixed(2) +
                     ' | Underdog: ' + underdog + ' @' + underdogOdds.toFixed(2));

    // ─── ODDS RANGE VALIDATION (only when odds are available) ────────────────
    var maxFavoriteOdds = _robbers_toNum_(config.maxFavoriteOdds, 2.20);
    if (favoriteOdds > maxFavoriteOdds) {
      _robbers_log_(fn, 'WARNING: favoriteOdds ' + favoriteOdds.toFixed(2) + ' > max ' + maxFavoriteOdds + ' (bypassed)');
    }

    var minOdds = _robbers_toNum_(config.minOdds, 1.80);
    var maxOdds = _robbers_toNum_(config.maxOdds, 12.00);
    if (underdogOdds < minOdds || underdogOdds > maxOdds) {
      _robbers_log_(fn, 'WARNING: underdogOdds ' + underdogOdds.toFixed(2) + ' outside bounds (bypassed)');
    }
  } else {
    _robbers_log_(fn, 'Predicted winner: ' + favorite + ' | Potential upset pick: ' + underdog + ' (no odds)');
  }

  // ─── SCORING SYSTEM ────────────────────────────────────────────────────────
  var score = 0;
  var reasons = [];
  
  // FACTOR 0: Favorite Strength (max 15) — skipped when odds unavailable
  if (oddsAvailable) {
    if (favoriteOdds <= 1.35) {
      score += 15; reasons.push('Heavy fav @' + favoriteOdds.toFixed(2));
    } else if (favoriteOdds <= 1.55) {
      score += 12; reasons.push('Strong fav @' + favoriteOdds.toFixed(2));
    } else if (favoriteOdds <= 1.75) {
      score += 8; reasons.push('Clear fav @' + favoriteOdds.toFixed(2));
    } else {
      score += 3; reasons.push('Slight fav @' + favoriteOdds.toFixed(2));
    }
  }
  
  // FACTOR 1: H2H History (max 20)
  var minH2HGames = _robbers_toNum_(config.minH2HGames, 3);
  var underdogWinThreshold = _robbers_toNum_(config.underdogWinThreshold, 0.40);
  
  if (h2hStats && (_robbers_toNum_(h2hStats.totalGames, 0) >= minH2HGames)) {
    var underdogH2HWins = isHomeUnderdog 
      ? _robbers_toNum_(h2hStats.homeWins, 0) 
      : _robbers_toNum_(h2hStats.awayWins, 0);
    var h2hWinRate = underdogH2HWins / h2hStats.totalGames;
    
    _robbers_log_(fn, 'H2H: ' + underdogH2HWins + '/' + h2hStats.totalGames + ' = ' + (h2hWinRate * 100).toFixed(1) + '%');
    
    if (h2hWinRate >= underdogWinThreshold) {
      score += 20; 
      reasons.push('H2H ' + Math.round(h2hWinRate * 100) + '% (' + underdogH2HWins + '/' + h2hStats.totalGames + ')');
    } else if (underdogH2HWins > 0) {
      score += 6; 
      reasons.push('H2H wins (' + underdogH2HWins + ')');
    }
  }
  
  // FACTOR 2: Quarter Dominance (max 12)
  if (h2hStats && h2hStats.quarterWins && h2hStats.quarterWins[underdog]) {
    var qWins = h2hStats.quarterWins[underdog];
    var dominantQs = 0;
    var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    for (var qi = 0; qi < quarters.length; qi++) {
      if (_robbers_toNum_(qWins[quarters[qi]], 0) > 0.50) dominantQs++;
    }
    
    if (dominantQs >= 2) {
      score += 12; reasons.push('Quarter edge (' + dominantQs + 'Q)');
    } else if (dominantQs === 1) {
      score += 5; reasons.push('Quarter edge (1Q)');
    }
  }
  
  // FACTOR 3: Half Performance (max 10)
  if (h2hStats && h2hStats.halfWins) {
    var h1Rate = _robbers_toNum_(h2hStats.halfWins[underdog + '_H1'], 0);
    var h2Rate = _robbers_toNum_(h2hStats.halfWins[underdog + '_H2'], 0);
    
    if (h1Rate > 0.50) { score += 5; reasons.push('Strong 1H ' + Math.round(h1Rate * 100) + '%'); }
    if (h2Rate > 0.50) { score += 5; reasons.push('Strong 2H ' + Math.round(h2Rate * 100) + '%'); }
  }
  
  // FACTOR 4: Recent Momentum (max 15)
  var momentumGames = _robbers_toNum_(config.momentumGames, 5);
  var momentumWinThreshold = _robbers_toNum_(config.momentumWinThreshold, 0.60);
  
  if (recentForm && recentForm[underdog]) {
    var recent = recentForm[underdog];
    var recentWins = _robbers_toNum_(recent.wins, 0);
    var recentGames = _robbers_toNum_(recent.games, 0);
    
    if (recentGames >= momentumGames) {
      var momentumRate = recentWins / recentGames;
      
      if (momentumRate >= momentumWinThreshold) {
        score += 15; reasons.push('Hot ' + recentWins + 'W/' + recentGames + 'G');
      } else if (momentumRate >= 0.45) {
        score += 8; reasons.push('Form ' + recentWins + 'W/' + recentGames + 'G');
      }
    }
  }
  
  // FACTOR 5: Odds Value (max 15) — skipped when odds unavailable
  if (oddsAvailable) {
    if (underdogOdds >= 2.50 && underdogOdds <= 5.50) {
      score += 15; reasons.push('Value @' + underdogOdds.toFixed(2));
    } else if (underdogOdds >= 2.00 && underdogOdds < 2.50) {
      score += 10; reasons.push('Playable @' + underdogOdds.toFixed(2));
    } else if (underdogOdds > 5.50 && underdogOdds <= 8.00) {
      score += 8; reasons.push('High payout @' + underdogOdds.toFixed(2));
    } else {
      score += 4; reasons.push('Longshot @' + underdogOdds.toFixed(2));
    }
  } else {
    reasons.push('No odds (prediction-based pick)');
  }

  // ─── THRESHOLD CHECK ───────────────────────────────────────────────────────
  // When odds are unavailable the max possible score is lower (Factors 0 & 5
  // are skipped = up to 30 points missing). Lower the minimum threshold
  // proportionally so prediction-based picks are still surfaced.
  var minScore = _robbers_toNum_(config.minScore, 25);
  if (!oddsAvailable) {
    minScore = Math.max(10, Math.round(minScore * 0.55));
    _robbers_log_(fn, 'No-odds mode: adjusted minScore → ' + minScore);
  }
  _robbers_log_(fn, 'Score: ' + score + ' (min: ' + minScore + ') | ' + reasons.join(' | '));
  
  if (score < minScore) {
    _robbers_log_(fn, 'EXIT: Below threshold');
    return null;
  }
  
  // ─── RAW CONFIDENCE CALCULATION ────────────────────────────────────────────
  var maxConfidence = _robbers_toNum_(config.maxConfidence, 95);
  var rawConfidence = Math.min(maxConfidence, 46 + score * 0.55);
  var rawModelProb = rawConfidence / 100;
  // impliedProb and EV only apply when odds are known
  var impliedProb = oddsAvailable ? (1.0 / underdogOdds) : rawModelProb;
  var rawEdge = oddsAvailable ? (rawModelProb - impliedProb) : 0;
  var rawEV   = oddsAvailable ? ((underdogOdds - 1) * rawModelProb - (1 - rawModelProb)) : 0;

  // ─── BUILD RESULT OBJECT ───────────────────────────────────────────────────
  var result = {
    isRobber: true,
    team: underdog,
    opponent: favorite,
    pick: underdog + (oddsAvailable ? ' ML' : ' (Upset Pick)'),
    type: 'ROBBER',
    odds: oddsAvailable ? underdogOdds : 0,
    confidence: Math.round(rawConfidence * 10) / 10,
    tier: 'ROBBER',
    tierDisplay: '(ROBBER)',
    reasons: reasons,
    score: score,
    edge: Math.round(rawEdge * 1000) / 1000,
    ev: Math.round(rawEV * 1000) / 1000,
    homeOdds: homeOdds,
    awayOdds: awayOdds,
    favoriteOdds: favoriteOdds,
    underdogOdds: underdogOdds,
    inferredOdds: resolved.inferred || false,
    oddsSource: resolved.source || 'unknown',
    isHomeUnderdog: isHomeUnderdog
  };
  
  // ─── NORMALIZE TO UNIFIED TIER SYSTEM ──────────────────────────────────────
  result = _robbers_normalizePick_(result, config);
  
  _robbers_log_(fn, 
    '★★★ ROBBER: ' + result.pick + 
    ' @' + result.odds.toFixed(2) + 
    ' | ' + result.tier + 
    ' | Conf=' + result.confidence + '%' +
    ' | EV=' + (result.ev * 100).toFixed(1) + '%'
  );
  
  return result;
}


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 6: BATCH DETECTION — detectAllRobbers
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Detect robbers from pre-loaded game array
 *
 * @param {Array} games — Array of game objects
 * @param {Object} allH2HStats — H2H stats keyed by matchup string
 * @param {Object} allRecentForm — Recent form keyed by team name
 * @param {Object} config — Optional config overrides
 * @returns {Array} Array of robber picks, sorted by confidence descending
 */
function detectAllRobbers(games, allH2HStats, allRecentForm, config) {
  var fn = 'detectAllRobbers';
  var robbers = [];
  
  if (!games || !games.length) {
    return robbers;
  }
  
  // Merge config once
  config = _robbers_mergeConfig_(ROBBERS_CONFIG_DEFAULTS, config);
  
  for (var i = 0; i < games.length; i++) {
    var game = games[i];
    if (!game || !game.home || !game.away) continue;
    
    // Build H2H lookup keys
    var matchKey = (String(game.home) + ' vs ' + String(game.away)).toLowerCase();
    var reverseKey = (String(game.away) + ' vs ' + String(game.home)).toLowerCase();
    var h2h = null;
    
    if (allH2HStats) {
      h2h = allH2HStats[matchKey] || allH2HStats[reverseKey] || null;
    }
    
    var robber = detectRobbers(game, h2h, allRecentForm, config);
    
    if (robber) {
      robber.match = String(game.home) + ' vs ' + String(game.away);
      robber.league = String(game.league || '');
      robber.date = game.date || '';
      robber.time = game.time || '';
      robbers.push(robber);
    }
  }
  
  // Sort by calibrated confidence descending
  robbers.sort(function(a, b) {
    return (_robbers_toNum_(b.confidence, 0)) - (_robbers_toNum_(a.confidence, 0));
  });
  
  return robbers;
}


// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 7: MAIN ENTRY POINT — predictRobbers
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Process all upcoming games and find ROBBER opportunities
 *
 * @param {Spreadsheet} ss — Google Spreadsheet (optional, defaults to active)
 * @returns {Array} Array of robber pick objects, sorted by confidence
 */
function predictRobbers(ss) {
  var fn = 'predictRobbers';
  _robbers_log_(fn, '════════════════════════════════════════════════════════════');
  _robbers_log_(fn, 'ENTER — Unified Tier System v2.2');
  
  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    
    // ─── LOAD CONFIG ─────────────────────────────────────────────────────────
    var config = {};
    if (typeof loadTier2Config === 'function') {
      try { 
        config = loadTier2Config(ss) || {}; 
      } catch (e) {
        _robbers_log_(fn, 'WARN: loadTier2Config failed: ' + e.message);
      }
    }
    config = _robbers_mergeConfig_(ROBBERS_CONFIG_DEFAULTS, config);
    _robbers_verbose_ = config.enableVerboseLogging !== false;
    
    if (config.enableRobbers === false) {
      _robbers_log_(fn, 'EXIT: ROBBERS disabled in config');
      return [];
    }
    
    // ─── FIND UPCOMING SHEET ─────────────────────────────────────────────────
    var upSheet = _robbers_getSheet_(ss, 'UpcomingClean');
    if (!upSheet) {
      var available = ss.getSheets().map(function(s) { return s.getName(); }).join(', ');
      _robbers_log_(fn, 'ERROR: UpcomingClean not found. Available: ' + available);
      throw new Error('UpcomingClean sheet not found. Run parsers first.');
    }
    
    var values = upSheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      _robbers_log_(fn, 'EXIT: No data rows in UpcomingClean');
      return [];
    }
    
    // ─── BUILD HEADER MAP ────────────────────────────────────────────────────
    var hMap = _robbers_headerMap_(values[0]);
    _robbers_log_(fn, 'Headers found: ' + Object.keys(hMap).join(', '));
    
    // ─── LOAD SUPPORTING DATA ────────────────────────────────────────────────
    var allH2H = {};
    var allForm = {};
    
    if (typeof loadRobbersH2HStats === 'function') {
      try {
        allH2H = loadRobbersH2HStats(ss) || {};
      } catch (e) {
        _robbers_log_(fn, 'WARN: H2H load error: ' + e.message);
      }
    }
    
    if (typeof loadRobbersRecentForm === 'function') {
      try {
        allForm = loadRobbersRecentForm(ss, 10) || {};
      } catch (e) {
        _robbers_log_(fn, 'WARN: Form load error: ' + e.message);
      }
    }
    
    _robbers_log_(fn, 'Loaded H2H matchups: ' + Object.keys(allH2H).length + 
                     ', Teams with form: ' + Object.keys(allForm).length);
    
    // ─── PROCESS GAMES ───────────────────────────────────────────────────────
    var robbers = [];
    
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      
      var home = String(_robbers_getVal_(row, hMap, ['home', 'home_team', 'hometeam']) || '').trim();
      var away = String(_robbers_getVal_(row, hMap, ['away', 'away_team', 'awayteam', 'visitor']) || '').trim();
      
      if (!home || !away) continue;
      
      var gameObj = {
        home: home,
        away: away,
        homeOdds: _robbers_toNum_(_robbers_getVal_(row, hMap, ['homeodds', 'home_odds']), 0),
        awayOdds: _robbers_toNum_(_robbers_getVal_(row, hMap, ['awayodds', 'away_odds']), 0),
        pred: _robbers_getVal_(row, hMap, ['pred', 'prediction', 'forebetpred', 'pick']),
        odds: _robbers_toNum_(_robbers_getVal_(row, hMap, ['odds', 'avgodds', 'avg_odds', 'avg']), 0),
        league: String(_robbers_getVal_(row, hMap, ['league']) || ''),
        date: _robbers_getVal_(row, hMap, ['date']),
        time: _robbers_getVal_(row, hMap, ['time'])
      };
      
      // H2H lookup
      var key = (home + ' vs ' + away).toLowerCase();
      var rev = (away + ' vs ' + home).toLowerCase();
      var h2h = allH2H[key] || allH2H[rev] || null;
      
      var robber = detectRobbers(gameObj, h2h, allForm, config);
      
      if (robber) {
        robber.match = home + ' vs ' + away;
        robber.league = gameObj.league;
        robber.date = gameObj.date;
        robber.time = gameObj.time;
        robbers.push(robber);
      }
    }
    
    // Sort by calibrated confidence descending
    robbers.sort(function(a, b) {
      return (_robbers_toNum_(b.confidence, 0)) - (_robbers_toNum_(a.confidence, 0));
    });
    
    _robbers_log_(fn, 'EXIT: ' + robbers.length + ' robbers found (calibrated)');
    return robbers;
    
  } catch (e) {
    _robbers_log_(fn, 'ERROR: ' + e.message + '\n' + (e.stack || ''));
    return [];
  }
}



// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 9: TEST FUNCTION
// ─────────────────────────────────────────────────────────────────────────────────
function testFullRobbersRun() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var robbers = predictRobbers(ss);
  
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('FULL ROBBERS RUN: ' + robbers.length + ' picks found');
  Logger.log('═══════════════════════════════════════════════════════════════');
  
  for (var i = 0; i < Math.min(robbers.length, 5); i++) {
    var r = robbers[i];
    Logger.log('');
    Logger.log((i+1) + '. ' + r.pick + ' @' + r.odds.toFixed(2));
    Logger.log('   Tier: ' + r.tier + ' | Conf: ' + r.confidence + '% | EV: ' + (r.ev * 100).toFixed(1) + '%');
    Logger.log('   Display: ' + r.tierDisplay);
    Logger.log('   Raw Conf: ' + (r._rawConfidence || 'N/A') + '% → Calibrated: ' + r._calibratedProb);
  }
  
  return robbers;
}


/**
 * Batch predict First Half 1x2 for all games
 * @param {Array} games - Array of game objects
 * @param {Object} stats - Team stats
 * @param {Object} config - Prediction config
 * @return {Array} Array of predictions
 */
function predictAllFirstHalf1x2(games, stats, config) {
  var fn = 'predictAllFirstHalf1x2';
  _enh_log(fn, 'ENTER: Processing ' + (games ? games.length : 0) + ' games');
  
  var predictions = [];
  
  for (var i = 0; i < games.length; i++) {
    var game = games[i];
    if (!game) {
      _enh_log(fn, 'Game ' + i + ': null, skipping');
      continue;
    }
    
    _enh_log(fn, 'Processing game ' + i + ': ' + game.home + ' vs ' + game.away);
    
    var pred = predictFirstHalf1x2(game, stats, config);
    pred.league = game.league || '';
    pred.date = game.date || '';
    pred.time = game.time || '';
    pred.match = game.home + ' vs ' + game.away;
    predictions.push(pred);
  }
  
  _enh_log(fn, 'EXIT: ' + predictions.length + ' predictions');
  return predictions;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: FULL TIME OVER/UNDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full Time O/U configuration defaults
 */
var FT_OU_CONFIG_DEFAULTS = {
  minSamples: 3,
  sigmaFloor: 15,
  sigmaScale: 1.0,
  shrinkK: 8,
  edgeThreshold: 0.02,
  minEV: 0.005,
  confidenceScale: 25,
  americanOdds: -110
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * _ft_loadLeaguePrior_ - Load FT league priors from LeagueQuarterO_U_Stats sheet
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * Computes Full-Time prior using Sum-of-Parts from quarter stats:
 *   μ_FT = μ_Q1 + μ_Q2 + μ_Q3 + μ_Q4
 *   σ_FT = sqrt(σ_Q1² + σ_Q2² + σ_Q3² + σ_Q4²)
 * 
 * Caches results per league to avoid repeated sheet reads.
 * 
 * SHEET STRUCTURE EXPECTED (LeagueQuarterO_U_Stats):
 *   Row 1: Title row (optional - auto-detected)
 *   Row 2: Headers (Quarter/Period, Mean, SD, Count, etc.)
 *   Rows 3+: Data (Q1, Q2, Q3, Q4 for each league)
 * 
 * @param {string} leagueKey - League identifier (e.g., 'NBA', 'EuroLeague')
 * @param {Object} [stats] - Optional stats object (unused, for signature compatibility)
 * @param {Object} [config] - Optional config object
 * @returns {Object|null} - { mu, sigma, quarters, source } or null if not found
 */

// Module-level cache for league priors
var _ftLeaguePriorCache_ = null;
var _ftLeaguePriorCacheTime_ = 0;
var _FT_CACHE_TTL_MS_ = 300000; // 5 minutes

function _ft_loadLeaguePrior_(leagueKey, stats, config) {
  var fn = '_ft_loadLeaguePrior_';
  var LOG = '[' + fn + '] ';
  
  if (!leagueKey) {
    Logger.log(LOG + '⚠️ No league key provided');
    return null;
  }
  
  var normalizedKey = String(leagueKey).trim().toUpperCase();
  
  // Check cache
  var now = new Date().getTime();
  if (_ftLeaguePriorCache_ && (now - _ftLeaguePriorCacheTime_) < _FT_CACHE_TTL_MS_) {
    if (_ftLeaguePriorCache_[normalizedKey]) {
      Logger.log(LOG + 'Cache hit for ' + normalizedKey);
      return _ftLeaguePriorCache_[normalizedKey];
    }
  }
  
  // Load from sheet
  var priors = _ft_loadAllLeaguePriors_();
  
  if (!priors) {
    Logger.log(LOG + '⚠️ Could not load league priors from sheet');
    return null;
  }
  
  // Update cache
  _ftLeaguePriorCache_ = priors;
  _ftLeaguePriorCacheTime_ = now;
  
  // Look up requested league
  if (priors[normalizedKey]) {
    Logger.log(LOG + '✓ Found prior for ' + normalizedKey + 
               ': μ=' + priors[normalizedKey].mu.toFixed(1) + 
               ', σ=' + priors[normalizedKey].sigma.toFixed(2));
    return priors[normalizedKey];
  }
  
  // Try fuzzy match
  for (var key in priors) {
    if (key.indexOf(normalizedKey) > -1 || normalizedKey.indexOf(key) > -1) {
      Logger.log(LOG + '✓ Fuzzy match: ' + leagueKey + ' → ' + key);
      return priors[key];
    }
  }
  
  Logger.log(LOG + '⚠️ No prior found for league: ' + leagueKey);
  Logger.log(LOG + '   Available leagues: ' + Object.keys(priors).join(', '));
  return null;
}

/**
 * Load all league priors from LeagueQuarterO_U_Stats sheet
 * @returns {Object} Map of league → { mu, sigma, quarters, source }
 */
function _ft_loadAllLeaguePriors_() {
  var fn = '_ft_loadAllLeaguePriors_';
  var LOG = '[' + fn + '] ';
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('LeagueQuarterO_U_Stats');
  
  if (!sheet) {
    Logger.log(LOG + '⚠️ LeagueQuarterO_U_Stats sheet not found');
    return _ft_getDefaultPriors_();
  }
  
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  if (lastRow < 3 || lastCol < 3) {
    Logger.log(LOG + '⚠️ Sheet too small (rows=' + lastRow + ', cols=' + lastCol + ')');
    return _ft_getDefaultPriors_();
  }
  
  // Read all data
  var allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  
  // Detect title row
  var row1First = String(allData[0][0] || '').trim();
  var hasTitle = row1First.length > 20 || /statistic|report|summary|league/i.test(row1First);
  var headerRowIdx = hasTitle ? 1 : 0;
  var dataStartIdx = headerRowIdx + 1;
  
  Logger.log(LOG + 'Title row detected: ' + hasTitle + ', headers at row ' + (headerRowIdx + 1));
  
  var headers = allData[headerRowIdx];
  
  // Find column indices
  var colIdx = {
    league: -1,
    quarter: -1,
    mean: -1,
    sd: -1,
    count: -1
  };
  
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').toLowerCase().trim();
    var hNorm = h.replace(/[\s_\-()]/g, '');
    
    if (colIdx.league === -1 && /league|competition|sport/.test(h)) {
      colIdx.league = c;
    }
    if (colIdx.quarter === -1 && /quarter|period|^q$|qtr/.test(h)) {
      colIdx.quarter = c;
    }
    if (colIdx.mean === -1 && /mean/.test(h)) {
      // Prefer "actual mean" over just "mean" if both exist
      if (/actual/.test(h) || colIdx.mean === -1) {
        colIdx.mean = c;
      }
    }
    if (colIdx.sd === -1 && /^sd$|^std$|stdev|standarddev|deviation/.test(hNorm)) {
      colIdx.sd = c;
    }
    if (colIdx.count === -1 && /^count$|^n$|^games$|sample/.test(hNorm)) {
      colIdx.count = c;
    }
  }
  
  Logger.log(LOG + 'Column indices: league=' + colIdx.league + ', quarter=' + colIdx.quarter + 
             ', mean=' + colIdx.mean + ', sd=' + colIdx.sd);
  
  // Fallback: if no explicit mean/sd columns, try to detect from data
  if (colIdx.mean === -1 || colIdx.sd === -1) {
    Logger.log(LOG + 'Attempting numeric column detection...');
    for (var dc = 0; dc < Math.min(headers.length, 10); dc++) {
      if (dataStartIdx < allData.length) {
        var val = parseFloat(allData[dataStartIdx][dc]);
        if (isFinite(val)) {
          if (val >= 40 && val <= 80 && colIdx.mean === -1) {
            colIdx.mean = dc;
            Logger.log(LOG + '   Detected mean at col ' + dc + ' (value=' + val + ')');
          } else if (val >= 3 && val <= 25 && colIdx.sd === -1 && dc !== colIdx.mean) {
            colIdx.sd = dc;
            Logger.log(LOG + '   Detected SD at col ' + dc + ' (value=' + val + ')');
          }
        }
      }
    }
  }
  
  if (colIdx.mean === -1 || colIdx.sd === -1) {
    Logger.log(LOG + '⚠️ Could not identify Mean/SD columns');
    Logger.log(LOG + '   Headers: ' + headers.slice(0, 10).join(', '));
    return _ft_getDefaultPriors_();
  }
  
  // Parse data rows into league → quarter → stats structure
  var leagueData = {};
  var quarterMap = { 'q1': 1, 'q2': 2, 'q3': 3, 'q4': 4, '1': 1, '2': 2, '3': 3, '4': 4,
                     'first': 1, 'second': 2, 'third': 3, 'fourth': 4 };
  
  for (var r = dataStartIdx; r < allData.length; r++) {
    var row = allData[r];
    
    var mean = parseFloat(row[colIdx.mean]);
    var sd = parseFloat(row[colIdx.sd]);
    
    if (!isFinite(mean) || !isFinite(sd)) continue;
    if (mean < 20 || mean > 100) continue; // Filter non-quarter data
    
    // Get league
    var league = 'DEFAULT';
    if (colIdx.league > -1) {
      league = String(row[colIdx.league] || '').trim().toUpperCase();
    }
    if (!league) league = 'DEFAULT';
    
    // Get quarter
    var quarterRaw = '';
    if (colIdx.quarter > -1) {
      quarterRaw = String(row[colIdx.quarter] || '').trim().toLowerCase().replace(/\s/g, '');
    } else {
      // Try to detect from row position within league group
      quarterRaw = 'q' + ((r - dataStartIdx) % 4 + 1);
    }
    
    var quarterNum = null;
    for (var qKey in quarterMap) {
      if (quarterRaw.indexOf(qKey) > -1) {
        quarterNum = quarterMap[qKey];
        break;
      }
    }
    
    if (!quarterNum) {
      // Fallback: use row order
      if (!leagueData[league]) {
        quarterNum = 1;
      } else {
        var existingQs = Object.keys(leagueData[league].quarters || {}).length;
        quarterNum = existingQs + 1;
      }
    }
    
    if (quarterNum < 1 || quarterNum > 4) continue;
    
    // Store
    if (!leagueData[league]) {
      leagueData[league] = { quarters: {} };
    }
    
    if (!leagueData[league].quarters[quarterNum]) {
      leagueData[league].quarters[quarterNum] = { mean: mean, sd: sd };
      Logger.log(LOG + '   ' + league + ' Q' + quarterNum + ': μ=' + mean.toFixed(1) + ', σ=' + sd.toFixed(2));
    }
  }
  
  // Compute FT priors using Sum-of-Parts
  var priors = {};
  
  for (var lg in leagueData) {
    var quarters = leagueData[lg].quarters;
    var qCount = Object.keys(quarters).length;
    
    if (qCount < 4) {
      Logger.log(LOG + '⚠️ ' + lg + ' only has ' + qCount + ' quarters, skipping');
      continue;
    }
    
    var ftMu = 0;
    var ftVar = 0;
    
    for (var qi = 1; qi <= 4; qi++) {
      if (quarters[qi]) {
        ftMu += quarters[qi].mean;
        ftVar += Math.pow(quarters[qi].sd, 2);
      }
    }
    
    var ftSigma = Math.sqrt(ftVar);
    
    priors[lg] = {
      mu: ftMu,
      sigma: ftSigma,
      quarters: quarters,
      source: 'LeagueQuarterO_U_Stats'
    };
    
    Logger.log(LOG + '✓ ' + lg + ' FT Prior: μ=' + ftMu.toFixed(1) + ', σ=' + ftSigma.toFixed(2));
  }
  
  // If no leagues parsed, return defaults
  if (Object.keys(priors).length === 0) {
    Logger.log(LOG + '⚠️ No leagues parsed from sheet');
    return _ft_getDefaultPriors_();
  }
  
  return priors;
}

/**
 * Get default priors (only used if sheet is missing/empty)
 * These are DOCUMENTED fallbacks, not magic numbers
 */
function _ft_getDefaultPriors_() {
  var fn = '_ft_getDefaultPriors_';
  Logger.log('[' + fn + '] Using documented fallback priors (sheet unavailable)');
  
  // These defaults are documented and should be overridden by sheet data
  // They exist only to prevent crashes when sheet is missing
  return {
    'NBA': { mu: 229.9, sigma: 17.5, source: 'FALLBACK_DEFAULT', 
             _note: 'Add LeagueQuarterO_U_Stats sheet for accurate priors' },
    'DEFAULT': { mu: 200, sigma: 20, source: 'FALLBACK_DEFAULT',
                 _note: 'Generic fallback - add league-specific data' }
  };
}

/**
 * Force refresh of league prior cache
 */
function _ft_clearLeaguePriorCache_() {
  _ftLeaguePriorCache_ = null;
  _ftLeaguePriorCacheTime_ = 0;
  Logger.log('[_ft_clearLeaguePriorCache_] Cache cleared');
}

/**
 * Diagnostic: Show all loaded league priors
 */
function _ft_showLeaguePriors_() {
  var fn = '_ft_showLeaguePriors_';
  var LOG = '[' + fn + '] ';
  
  Logger.log(LOG + '═══════════════════════════════════════════════════════');
  Logger.log(LOG + 'Loading all league priors from sheet...');
  Logger.log(LOG + '═══════════════════════════════════════════════════════');
  
  _ft_clearLeaguePriorCache_();
  var priors = _ft_loadAllLeaguePriors_();
  
  Logger.log(LOG + '');
  Logger.log(LOG + '═══════════════════════════════════════════════════════');
  Logger.log(LOG + 'LEAGUE PRIORS SUMMARY:');
  Logger.log(LOG + '═══════════════════════════════════════════════════════');
  
  var count = 0;
  for (var league in priors) {
    var p = priors[league];
    Logger.log(LOG + '');
    Logger.log(LOG + '  ' + league + ':');
    Logger.log(LOG + '    FT μ = ' + p.mu.toFixed(1));
    Logger.log(LOG + '    FT σ = ' + p.sigma.toFixed(2));
    Logger.log(LOG + '    Source: ' + p.source);
    
    if (p.quarters) {
      var qStr = [];
      for (var q = 1; q <= 4; q++) {
        if (p.quarters[q]) {
          qStr.push('Q' + q + ':' + p.quarters[q].mean.toFixed(1) + '±' + p.quarters[q].sd.toFixed(1));
        }
      }
      Logger.log(LOG + '    Quarters: ' + qStr.join(', '));
    }
    count++;
  }
  
  Logger.log(LOG + '');
  Logger.log(LOG + 'Total leagues loaded: ' + count);
  Logger.log(LOG + '═══════════════════════════════════════════════════════');
  
  return priors;
}

// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  predictFTOverUnder — v6.3.0 CONSOLIDATED FINAL                                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝
/**
 * Full-Time Over/Under predictor with Bayesian shrinkage and Forebet blending.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ CONSOLIDATED FIXES (v5.x → v6.1 → v6.2 → v6.3):                            │
 * │                                                                             │
 * │  1.  μ CASCADE: TEAM → FOREBET → LEAGUE_PRIOR → LINE                       │
 * │  2.  TEAM TOTAL: (hTot + aTot) / 2 (avgTotal = combined)                   │
 * │  3.  FOREBET EXTRACTION: Multi-source (forebetTotal, predScore, ou-fb-used)│
 * │  4.  SOURCE-AWARE BLENDING: Different strategy per μ source                │
 * │  5.  SHRINKAGE: n/(n+k) Bayesian formula                                   │
 * │  6.  TEMPERATURE: ou_model_error + ou_prob_temp                            │
 * │  7.  CDF: GELU-style Normal approximation                                  │
 * │  8.  SAMPLES: Source-based counts                                          │
 * │  9.  FOREBET: Per-league bias and clamps                                   │
 * │ 10.  DIAGNOSTICS: muSource, lineSource fields for audit trail             │
 * │ 11.  SELF-COMPARISON GUARD: Blocks avg-as-line when forebetTotal exists   │
 * │ 12.  ENHANCED LOGGING: Clear skip reasons and warning markers             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * @param {Object} game   - Game object with teams, lines, and optional Forebet data
 * @param {Object} stats  - Stats object from loadTier2MarginStats
 * @param {Object} config - Configuration object
 * @returns {Object}      - Prediction result with direction, line, pick, confidence, ev, edge, etc.
 */
function predictFTOverUnder(game, stats, config) {
  var fn = 'predictFTOverUnder';
  var LOG = '[' + fn + '] ';
  var VERSION = 'v6.4.0';
  var startTime = new Date().getTime();
  config = config || {};

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function toNum(val) {
    var n = parseFloat(val);
    return isFinite(n) ? n : NaN;
  }

  function hasNum(x) {
    return isFinite(x) && x !== null;
  }

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var v = toNum(arguments[i]);
      if (hasNum(v)) return v;
    }
    return NaN;
  }

  function pickBool() {
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a === true || a === false) return a;
      if (typeof a === 'string') {
        var s = a.toLowerCase().trim();
        if (s === 'true') return true;
        if (s === 'false') return false;
      }
    }
    return false;
  }

  function clamp(val, lo, hi) {
    return Math.max(lo, Math.min(hi, val));
  }

  function fmt(v, d) {
    if (!isFinite(v)) return 'N/A';
    var p = Math.pow(10, d || 2);
    return String(Math.round(v * p) / p);
  }

  function nowMs() {
    return new Date().getTime();
  }

  // GELU-style Normal CDF approximation (accurate to ~0.0003)
  function normCdf(z) {
    var sqrt2OverPi = 0.7978845608;
    return 0.5 * (1 + Math.tanh(sqrt2OverPi * (z + 0.044715 * z * z * z)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED CONFIG — Merges config.ft with top-level config keys
  // ═══════════════════════════════════════════════════════════════════════════
  var userFt = config.ft || {};
  var ft = {
    // Gates
    minConf:           pick(userFt.minConf, config.ou_min_conf, 55),
    minEV:             pick(userFt.minEV, config.ou_min_ev, 0.005),
    edgeThreshold:     pick(userFt.edgeThreshold, config.ou_edge_threshold, 0.04),
    americanOdds:      pick(userFt.americanOdds, config.ou_american_odds, -110),

    // Sigma
    sigmaFloor:        pick(userFt.sigmaFloor, config.ou_sigma_floor, 6),
    sigmaScale:        pick(userFt.sigmaScale, config.ou_sigma_scale, 1.0),
    sigmaFromLinePct:  pick(userFt.sigmaFromLinePct, 0.075),

    // Shrinkage & samples
    shrinkK:           pick(userFt.shrinkK, config.ou_shrink_k, 8),
    confidenceScale:   pick(userFt.confidenceScale, config.ou_confidence_scale, 20),
    minSamples:        pick(userFt.minSamples, config.ou_min_samples, 5),

    // Temperature
    modelError:        pick(userFt.modelError, config.ou_model_error, 4.0),
    probTemp:          pick(userFt.probTemp, config.ou_prob_temp, 1.15),

    // Forebet
    forebetWeight:     pick(userFt.forebetWeight, config.forebet_ou_weight_ft, 0.35),
    forebetEnabled:    pickBool(userFt.forebetEnabled, config.forebet_blend_enabled, true),

    // ── OPTIONAL user overrides — empty by default ──
    // Users CAN add entries like { 'NBA': { mu: 230, sigma: 17.5, ... } }
    // to override the dynamic calculation for specific leagues.
    // Any league NOT listed here gets a dynamically-derived prior.
    leaguePriorOverrides: userFt.leaguePriorOverrides || userFt.leaguePriorByLeague || {},

    // Dynamic prior tuning knobs
    // σ ≈ √(line) × dynamicSigmaK — fits NBA/Euro/WNBA within 1 point at k≈1.15
    dynamicSigmaK:       pick(userFt.dynamicSigmaK, 1.15),
    dynamicSigmaFloor:   pick(userFt.dynamicSigmaFloor, 10),
    dynamicClampPct:     pick(userFt.dynamicClampPct, 0.25),
    dynamicForebetBias:  pick(userFt.dynamicForebetBias, 0.06),

    getLeaguePrior:      userFt.getLeaguePrior || null,
    knownFallbackValue:  pick(userFt.knownFallbackValue, 105),

    // Debug
    debugLogging:        pickBool(userFt.debugLogging, config.debug_ou_logging, false)
  };

  var DEBUG = ft.debugLogging;
  function log(msg) { if (DEBUG) Logger.log(LOG + msg); }

  // ═══════════════════════════════════════════════════════════════════════════
  // DYNAMIC LEAGUE PRIOR FACTORY
  //
  // Resolves a league prior from ALL available sources. ALWAYS returns
  // a valid object when a line exists. Never returns null unnecessarily.
  // Works for ANY league without requiring a static map entry.
  //
  // Priority:
  //   1. User overrides (leaguePriorOverrides[leagueKey])
  //   2. getLeaguePrior hook (custom function)
  //   3. Stats extraction (leagueQuarterStats from margin data)
  //   4. Dynamic derivation from the betting line
  //
  // The dynamic derivation uses:
  //   σ ≈ √(line) × k   where k ≈ 1.15 (empirically fits NBA/Euro/WNBA)
  //   μ = line           (market consensus — best available when no data)
  //   clamps = line ± 25%
  //   forebetBias = 0.06 (conservative default)
  // ═══════════════════════════════════════════════════════════════════════════
  function resolveLeaguePrior(leagueKey, ftLineVal, statsObj) {
    var source = 'NONE';
    var prior = null;

    // ── Source 1: User overrides ──
    if (ft.leaguePriorOverrides && leagueKey) {
      prior = ft.leaguePriorOverrides[leagueKey] || null;
      if (prior && hasNum(prior.mu) && prior.mu > 0) {
        source = 'USER_OVERRIDE';
        // Fill in any missing fields dynamically
        if (!hasNum(prior.sigma) || prior.sigma <= 0) {
          prior.sigma = Math.max(Math.sqrt(prior.mu) * ft.dynamicSigmaK, ft.dynamicSigmaFloor);
        }
        if (!hasNum(prior.forebetBias)) prior.forebetBias = ft.dynamicForebetBias;
        if (!hasNum(prior.clampMin)) prior.clampMin = Math.round(prior.mu * (1 - ft.dynamicClampPct));
        if (!hasNum(prior.clampMax)) prior.clampMax = Math.round(prior.mu * (1 + ft.dynamicClampPct));
        log('League prior [' + leagueKey + '] from user override: mu=' + fmt(prior.mu) +
            ' sigma=' + fmt(prior.sigma));
        return { prior: prior, source: source };
      }
      prior = null;
    }

    // ── Source 2: getLeaguePrior hook ──
    if (ft.getLeaguePrior) {
      try {
        prior = ft.getLeaguePrior(game, statsObj, config);
        if (prior && hasNum(prior.mu) && prior.mu > 0) {
          source = 'HOOK';
          if (!hasNum(prior.sigma) || prior.sigma <= 0) {
            prior.sigma = Math.max(Math.sqrt(prior.mu) * ft.dynamicSigmaK, ft.dynamicSigmaFloor);
          }
          if (!hasNum(prior.forebetBias)) prior.forebetBias = ft.dynamicForebetBias;
          if (!hasNum(prior.clampMin)) prior.clampMin = Math.round(prior.mu * (1 - ft.dynamicClampPct));
          if (!hasNum(prior.clampMax)) prior.clampMax = Math.round(prior.mu * (1 + ft.dynamicClampPct));
          log('League prior [' + leagueKey + '] from hook: mu=' + fmt(prior.mu));
          return { prior: prior, source: source };
        }
      } catch (e) {
        log('getLeaguePrior hook error: ' + e.message);
      }
      prior = null;
    }

    // ── Source 3: Stats extraction ──
    prior = getLeaguePriorFromStats(leagueKey, statsObj);
    if (prior && hasNum(prior.mu) && prior.mu > 0) {
      source = 'STATS';
      if (!hasNum(prior.sigma) || prior.sigma <= 0) {
        prior.sigma = Math.max(Math.sqrt(prior.mu) * ft.dynamicSigmaK, ft.dynamicSigmaFloor);
      }
      if (!hasNum(prior.forebetBias)) prior.forebetBias = ft.dynamicForebetBias;
      if (!hasNum(prior.clampMin)) prior.clampMin = Math.round(prior.mu * (1 - ft.dynamicClampPct));
      if (!hasNum(prior.clampMax)) prior.clampMax = Math.round(prior.mu * (1 + ft.dynamicClampPct));
      log('League prior [' + leagueKey + '] from stats: mu=' + fmt(prior.mu) +
          ' sigma=' + fmt(prior.sigma));
      return { prior: prior, source: source };
    }

    // ── Source 4: Dynamic derivation from line ──
    // This ALWAYS succeeds if we have a valid line
    if (hasNum(ftLineVal) && ftLineVal > 0) {
      var dynMu    = ftLineVal;
      var dynSigma = Math.max(Math.sqrt(ftLineVal) * ft.dynamicSigmaK, ft.dynamicSigmaFloor);
      prior = {
        mu:          dynMu,
        sigma:       dynSigma,
        forebetBias: ft.dynamicForebetBias,
        clampMin:    Math.round(dynMu * (1 - ft.dynamicClampPct)),
        clampMax:    Math.round(dynMu * (1 + ft.dynamicClampPct)),
        dynamic:     true
      };
      source = 'DYNAMIC';
      log('League prior [' + (leagueKey || 'unknown') + '] dynamic from line=' + ftLineVal +
          ': mu=' + fmt(dynMu) + ' sigma=' + fmt(dynSigma) +
          ' clamp=[' + prior.clampMin + ',' + prior.clampMax + ']');
      return { prior: prior, source: source };
    }

    // ── Absolute fallback (should never reach here if line is valid) ──
    log('League prior: no source available');
    return { prior: null, source: 'NONE' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEAGUE PRIOR FROM STATS — Extract from margin stats if available
  // ═══════════════════════════════════════════════════════════════════════════
  function getLeaguePriorFromStats(leagueKey, statsObj) {
    if (!statsObj || !leagueKey) return null;

    var lqs = statsObj.leagueQuarterStats ||
              statsObj.leagueQuarterOUStats ||
              statsObj.LeagueQuarterO_U_Stats || null;

    if (lqs && lqs[leagueKey]) {
      var ld = lqs[leagueKey];
      var mu = NaN;

      // Direct FT mean
      if (hasNum(ld.ftMean)) {
        mu = ld.ftMean;
      } else {
        // Sum quarter means
        var q1m = toNum(ld.q1Mean || ld.q1_mean);
        var q2m = toNum(ld.q2Mean || ld.q2_mean);
        var q3m = toNum(ld.q3Mean || ld.q3_mean);
        var q4m = toNum(ld.q4Mean || ld.q4_mean);
        if (hasNum(q1m) && hasNum(q2m) && hasNum(q3m) && hasNum(q4m)) {
          mu = q1m + q2m + q3m + q4m;
        }
      }

      var sigma = NaN;
      // Direct FT sigma
      if (hasNum(ld.ftSigma || ld.ftSD)) {
        sigma = toNum(ld.ftSigma || ld.ftSD);
      } else {
        // Combine quarter SDs in quadrature
        var q1s = toNum(ld.q1SD || ld.q1_sd);
        var q2s = toNum(ld.q2SD || ld.q2_sd);
        var q3s = toNum(ld.q3SD || ld.q3_sd);
        var q4s = toNum(ld.q4SD || ld.q4_sd);
        if (hasNum(q1s) && hasNum(q2s) && hasNum(q3s) && hasNum(q4s)) {
          sigma = Math.sqrt(q1s * q1s + q2s * q2s + q3s * q3s + q4s * q4s);
        }
      }

      if (hasNum(mu) && mu > 0) {
        return { mu: mu, sigma: hasNum(sigma) && sigma > 0 ? sigma : NaN };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAMPLE COUNT BY μ SOURCE
  // ═══════════════════════════════════════════════════════════════════════════
  function getSampleCountForSource(source, actualN) {
    var counts = {
      'TEAM_SUMQTR':      actualN > 0 ? actualN : 20,
      'FOREBET_AS_PRIOR': 50,
      'LEAGUE_PRIOR':     100,
      'LINE_AS_PRIOR':    200
    };
    return counts[source] || 50;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHRINKAGE: Bayesian n/(n+k) formula
  // ═══════════════════════════════════════════════════════════════════════════
  function calcShrinkage(n, k) {
    if (!hasNum(n) || !hasNum(k) || k <= 0) return 0.5;
    return n / (n + k);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SKIP RESULT HELPER — Standardized skip response with diagnostics
  // ═══════════════════════════════════════════════════════════════════════════
  function skipResult(reason, ctx) {
    ctx = ctx || {};
    var duration = nowMs() - startTime;

    Logger.log(LOG + '⛔ SKIP: ' + reason +
      (ctx.line !== undefined ? ' | line=' + ctx.line + '(' + (ctx.lineSource || '?') + ')' : '') +
      (ctx.ev !== undefined ? ' | ev=' + fmt(ctx.ev, 4) : '') +
      (ctx.edge !== undefined ? ' | edge=' + fmt(ctx.edge, 4) : '') +
      (ctx.confidence !== undefined ? ' | conf=' + ctx.confidence + '%' : '') +
      ' | ' + duration + 'ms');

    return {
      direction: 'N/A',
      line: ctx.line,
      pick: 'Pass',
      expectedTotal: ctx.expectedTotal,
      confidence: 0,
      ev: ctx.ev,
      edge: ctx.edge,
      tier: 'SKIP',
      tierDisplay: '○',
      sigma: ctx.sigma,
      skip: true,
      reason: reason,
      forebetUsed: ctx.forebetUsed || false,
      forebetTotal: ctx.forebetTotal,
      historicalTotal: ctx.historicalTotal,
      muSource: ctx.muSource || 'NONE',
      push: undefined,
      lineSource: ctx.lineSource
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACT DIRECTION — Normalize to title case Over/Under
  // ═══════════════════════════════════════════════════════════════════════════
  function extractDirection(scored, modelMu, line) {
    if (!scored) return modelMu >= line ? 'Over' : 'Under';

    // Direct direction field
    var raw = scored.direction || scored.dir || '';
    raw = String(raw).trim();
    if (raw !== '') {
      var up = raw.toUpperCase();
      if (up === 'OVER') return 'Over';
      if (up === 'UNDER') return 'Under';
    }

    // Text-based extraction
    var checks = [scored.text, scored.pick, scored.selection, scored.market];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i]) {
        var upText = String(checks[i]).toUpperCase();
        if (upText.indexOf('UNDER') > -1) return 'Under';
        if (upText.indexOf('OVER') > -1) return 'Over';
      }
    }

    // Probability-based
    if (scored.pOver !== undefined && scored.pUnder !== undefined) {
      var po = toNum(scored.pOver), pu = toNum(scored.pUnder);
      if (hasNum(po) && hasNum(pu)) return po >= pu ? 'Over' : 'Under';
    }

    return modelMu >= line ? 'Over' : 'Under';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: VALIDATE GAME OBJECT
  // ═══════════════════════════════════════════════════════════════════════════
  if (!game) {
    Logger.log(LOG + '▶ FT O/U: null game');
    return skipResult('Game object is null');
  }
  if (typeof game !== 'object') {
    Logger.log(LOG + '▶ FT O/U: invalid type (' + typeof game + ')');
    return skipResult('Game is not an object (type=' + typeof game + ')');
  }

  var home = String(game.home || '').trim();
  var away = String(game.away || '').trim();

  Logger.log(LOG + '▶ FT O/U ' + VERSION + ': ' + (home || '?') + ' vs ' + (away || '?'));

  if (!home || !away) {
    return skipResult('Missing teams (home="' + home + '", away="' + away + '")', {
      line: game.ftBookLine || game.line
    });
  }

  var leagueKey = String(
    game.leagueKey || game.league || game.competition || config.league || ''
  ).trim();

  log('Teams: ' + home + ' vs ' + away + (leagueKey ? ' [' + leagueKey + ']' : ''));

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: RESOLVE LINE — With self-comparison guard
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │ CRITICAL: The LINE must be the sportsbook O/U (from "FT Score").       │
  // │                                                                         │
  // │ Forebet's avg prediction is a MODEL SIGNAL, not a line.                │
  // │                                                                         │
  // │ FIX: If game.forebetTotal is already set (from avg/predScore),         │
  // │ using avg as the LINE would compare prediction vs itself → ZERO EDGE.  │
  // │ This fallback is now BLOCKED when forebetTotal exists.                 │
  // └─────────────────────────────────────────────────────────────────────────┘
  // ═══════════════════════════════════════════════════════════════════════════
  var lineSource = 'NONE';
  var rawLine = null;

  var lineCandidates = [
    { key: 'ftBookLine', label: 'ftBookLine' },
    { key: 'ou-ft-line', label: 'ou-ft-line' },
    { key: 'ftLine',     label: 'ftLine' },
    { key: 'line',       label: 'line' }
  ];

  for (var li = 0; li < lineCandidates.length; li++) {
    var cand = lineCandidates[li];
    var v = game[cand.key];
    if (v !== undefined && v !== null && v !== '') {
      rawLine = v;
      lineSource = cand.label;
      break;
    }
  }

  var ftLine = toNum(rawLine);

  // Enhanced line parser if available
  if (typeof _enh_parseBookLine === 'function' && rawLine !== null && rawLine !== undefined) {
    try {
      var parsed = _enh_parseBookLine(rawLine);
      if (hasNum(parsed) && parsed > 0) ftLine = parsed;
    } catch (e) {
      log('parseBookLine error: ' + e.message);
    }
  }

  // ─── FALLBACK: Forebet Avg as line — GUARDED ───
  if (!hasNum(ftLine) || ftLine <= 0) {
    var avgVal = toNum(game.avg || game.Avg || game.average);
    var forebetAlreadySet = hasNum(toNum(game.forebetTotal)) && toNum(game.forebetTotal) > 0;

    if (hasNum(avgVal) && avgVal > 0) {
      if (!forebetAlreadySet) {
        ftLine = avgVal;
        lineSource = 'FOREBET_AVG_FALLBACK';
        Logger.log(LOG + '⚠️ Using Forebet avg as line — no real book line found! ' +
                   home + ' vs ' + away + ' line=' + avgVal);
      } else {
        Logger.log(LOG + '⚠️ BLOCKED: avg=' + avgVal + ' as line — forebetTotal already set to ' +
                   game.forebetTotal + '. Would cause self-comparison (zero edge).');
      }
    }
  }

  // ─── FALLBACK: Quarter sum from game object ───
  if (!hasNum(ftLine) || ftLine <= 0) {
    var gq1 = toNum(game.q1 || game.Q1);
    var gq2 = toNum(game.q2 || game.Q2);
    var gq3 = toNum(game.q3 || game.Q3);
    var gq4 = toNum(game.q4 || game.Q4);
    if (hasNum(gq1) && hasNum(gq2) && hasNum(gq3) && hasNum(gq4)) {
      var qSum = gq1 + gq2 + gq3 + gq4;
      if (qSum > 0) {
        ftLine = qSum;
        lineSource = 'QUARTER_SUM';
        log('Line from quarter sum: ' + qSum);
      }
    }
  }

  if (!hasNum(ftLine) || ftLine <= 0) {
    return skipResult('No valid FT line found', { lineSource: lineSource });
  }

  log('Line: ' + ftLine + ' (' + lineSource + ')');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2b: RESOLVE LEAGUE PRIOR — Dynamic factory
  //
  // Called HERE (after line is resolved) because the dynamic fallback
  // needs the line value to derive σ, clamps, etc.
  // The result is used in Steps 4, 5, and 6.
  // ═══════════════════════════════════════════════════════════════════════════
  var lpResult = resolveLeaguePrior(leagueKey, ftLine, stats);
  var leaguePrior = lpResult.prior;
  var leaguePriorSource = lpResult.source;

  Logger.log(LOG + 'League prior: ' + leaguePriorSource +
    (leaguePrior ? ' mu=' + fmt(leaguePrior.mu) + ' sigma=' + fmt(leaguePrior.sigma) +
                   (leaguePrior.dynamic ? ' [dynamic]' : '') : ' NONE'));

  // ─── Per-league Forebet config — derived from resolved prior ───
  var fbBias     = leaguePrior && hasNum(leaguePrior.forebetBias) ? leaguePrior.forebetBias : ft.dynamicForebetBias;
  var fbClampMin = leaguePrior && hasNum(leaguePrior.clampMin) ? leaguePrior.clampMin : null;
  var fbClampMax = leaguePrior && hasNum(leaguePrior.clampMax) ? leaguePrior.clampMax : null;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: FOREBET SIGNAL — Enhanced multi-source extraction
  //
  // Sources (priority order):
  //   1. game.forebetTotal (set by buildEnrichedFTGame_ or caller)
  //   2. _enh_getForebetFromGame helper
  //   3. predScore (e.g., "111-106" → 217)
  //   4. ou-fb-used column (e.g., "FB 217")
  //   5. avg field (only if different from line by >0.5)
  // ═══════════════════════════════════════════════════════════════════════════
  var forebetTotal = NaN;
  var forebetValid = false;
  var forebetSource = 'NONE';

  // Source 1: game.forebetTotal (pre-set by caller)
  if (hasNum(toNum(game.forebetTotal)) && toNum(game.forebetTotal) > 0) {
    forebetTotal = toNum(game.forebetTotal);
    forebetValid = true;
    forebetSource = 'game.forebetTotal';
    log('Forebet from game.forebetTotal: ' + forebetTotal);
  }

  // Source 2: _enh_getForebetFromGame helper
  if (!forebetValid && typeof _enh_getForebetFromGame === 'function') {
    try {
      var fbResult = _enh_getForebetFromGame(game, config);
      if (fbResult && fbResult.valid && hasNum(fbResult.total) && fbResult.total > 0) {
        forebetTotal = fbResult.total;
        forebetValid = true;
        forebetSource = '_enh_getForebetFromGame';
        log('Forebet from _enh_getForebetFromGame: ' + forebetTotal);
      }
    } catch (e) {
      log('Forebet extractor error: ' + e.message);
    }
  }

  // Source 3: predScore (e.g., "111-106" → 217)
  if (!forebetValid) {
    var predScore = game.predScore || game['pred score'] || game['Pred Score'] || game.predscore;
    if (predScore) {
      var parts = String(predScore).split(/\s*[-\u2013\u2014]\s*/);
      if (parts.length >= 2) {
        var pH = toNum(parts[0].replace(/[^\d.]/g, ''));
        var pA = toNum(parts[1].replace(/[^\d.]/g, ''));
        if (hasNum(pH) && hasNum(pA) && pH > 0 && pA > 0) {
          forebetTotal = pH + pA;
          forebetValid = true;
          forebetSource = 'predScore';
          log('Forebet from predScore: ' + predScore + ' → ' + forebetTotal);
        }
      }
    }
  }

  // Source 4: ou-fb-used column (e.g., "FB 217")
  if (!forebetValid && game['ou-fb-used']) {
    var fbStr = String(game['ou-fb-used']);
    var fbMatch = fbStr.match(/(?:FB|Forebet)\s*:?\s*(\d+\.?\d*)/i);
    if (fbMatch) {
      var fbVal = parseFloat(fbMatch[1]);
      if (isFinite(fbVal) && fbVal > 0) {
        forebetTotal = fbVal;
        forebetValid = true;
        forebetSource = 'ou-fb-used';
        log('Forebet from ou-fb-used: ' + forebetTotal);
      }
    }
  }

  // Source 5: avg field (only if meaningfully different from line)
  if (!forebetValid) {
    var avgFb = toNum(game.avg || game.Avg);
    if (hasNum(avgFb) && avgFb > 0 && Math.abs(avgFb - ftLine) > 0.5) {
      forebetTotal = avgFb;
      forebetValid = true;
      forebetSource = 'avg';
      log('Forebet from avg field: ' + forebetTotal);
    }
  }

  log('Forebet: ' + (forebetValid ? fmt(forebetTotal) + ' (' + forebetSource + ')' : 'NONE'));

  var fbEnabled = ft.forebetEnabled;
  var fbWeight  = ft.forebetWeight;
  if (!hasNum(fbWeight) || fbWeight <= 0) fbEnabled = false;

  // Elite config override
  if (typeof _elite_getForebetConfig === 'function') {
    try {
      var efbCfg = _elite_getForebetConfig(config);
      if (efbCfg) {
        if (efbCfg.enabled === false) fbEnabled = false;
        if (hasNum(efbCfg.weightFT)) fbWeight = efbCfg.weightFT;
      }
    } catch (e) {
      log('Forebet config helper error: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: COMPUTE MODEL μ — FIXED CASCADE ORDER
  //
  //   Priority 1: Team-specific quarter sums (best signal — game-specific)
  //   Priority 2: Forebet prediction (game-specific external signal)
  //   Priority 3: League prior (season average — now always available)
  //   Priority 4: Market line as prior (no edge possible)
  // ═══════════════════════════════════════════════════════════════════════════
  var historicalTotal = NaN;
  var historicalSource = 'NONE';
  var actualTeamSamples = 0;

  // ── Priority 1: Team-specific quarter sums ──
  if (typeof sumQuarterPredictions === 'function') {
    try {
      var hTot = sumQuarterPredictions(home, 'Home', stats);
      var aTot = sumQuarterPredictions(away, 'Away', stats);

      var bothValid      = hasNum(hTot) && hasNum(aTot) && hTot > 0 && aTot > 0;
      var knownFallback  = ft.knownFallbackValue || 105;
      var homeIsFallback = (hTot === knownFallback);
      var awayIsFallback = (aTot === knownFallback);

      if (bothValid && !homeIsFallback && !awayIsFallback && hTot !== aTot) {
        historicalTotal = (hTot + aTot) / 2;
        historicalSource = 'TEAM_SUMQTR';

        // Get actual sample count from stats
        var homeKey = home.toLowerCase().trim();
        if (stats && stats[homeKey] && stats[homeKey].Home && stats[homeKey].Home.Q1) {
          actualTeamSamples = stats[homeKey].Home.Q1.samples || 0;
        } else if (stats && stats[homeKey] && stats[homeKey].n) {
          actualTeamSamples = stats[homeKey].n;
        }

        log('Team data: ' + home + '=' + fmt(hTot) + ', ' + away + '=' + fmt(aTot) +
            ' → avg=' + fmt(historicalTotal) + ' (n=' + actualTeamSamples + ')');
      } else if (homeIsFallback || awayIsFallback) {
        log('sumQuarterPredictions fallback detected — skipping team data');
      }
    } catch (e) {
      log('sumQuarterPredictions error: ' + e.message);
    }
  }

  // ── Priority 2: Forebet (game-specific external signal) ──
  if (!hasNum(historicalTotal) && forebetValid) {
    historicalTotal = forebetTotal;
    historicalSource = 'FOREBET_AS_PRIOR';
    log('mu from Forebet: ' + fmt(forebetTotal));
  }

  // ── Priority 3: League prior — now ALWAYS available via dynamic factory ──
  if (!hasNum(historicalTotal)) {
    if (leaguePrior && hasNum(leaguePrior.mu) && leaguePrior.mu > 0) {
      historicalTotal = leaguePrior.mu;
      historicalSource = 'LEAGUE_PRIOR';
      log('mu from league prior (' + leaguePriorSource + '): ' + fmt(historicalTotal));
    }
  }

  // ── Priority 4: Market line (no edge possible) ──
  if (!hasNum(historicalTotal)) {
    historicalTotal = ftLine;
    historicalSource = 'LINE_AS_PRIOR';
    log('mu from line (no edge): ' + fmt(historicalTotal));
  }

  Logger.log(LOG + 'mu=' + fmt(historicalTotal) + ' (' + historicalSource + ')');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: BLEND — Source-aware strategy
  //
  // Different blending strategies based on μ source quality:
  //   - TEAM_SUMQTR: Blend with Forebet at normal weight
  //   - FOREBET_AS_PRIOR: Shrink toward league prior (15%)
  //   - LEAGUE_PRIOR: Boost Forebet weight (game-specific vs season average)
  //   - LINE_AS_PRIOR: No blend (no edge)
  // ═══════════════════════════════════════════════════════════════════════════
  var expectedTotal = historicalTotal;
  var forebetUsed = false;

  if (historicalSource === 'TEAM_SUMQTR') {
    // Best case: team data exists, blend with Forebet at normal weight
    if (fbEnabled && forebetValid && hasNum(fbWeight) && fbWeight > 0) {
      var fbAdj = forebetTotal + fbBias;
      if (hasNum(fbClampMin) && fbAdj < fbClampMin) fbAdj = fbClampMin;
      if (hasNum(fbClampMax) && fbAdj > fbClampMax) fbAdj = fbClampMax;

      if (typeof _elite_blendWithForebet === 'function') {
        try {
          expectedTotal = _elite_blendWithForebet(historicalTotal, fbAdj, fbWeight, fbClampMin, fbClampMax);
        } catch (e) {
          expectedTotal = (1 - fbWeight) * historicalTotal + fbWeight * fbAdj;
        }
      } else {
        expectedTotal = (1 - fbWeight) * historicalTotal + fbWeight * fbAdj;
      }
      forebetUsed = true;
      log('Team + FB blend: ' + fmt(historicalTotal) + ' + ' + fmt(fbAdj) +
          ' @w=' + fmt(fbWeight) + ' → ' + fmt(expectedTotal));
    }

  } else if (historicalSource === 'FOREBET_AS_PRIOR') {
    // Forebet as primary: shrink toward league prior for stability
    forebetUsed = true;
    if (leaguePrior && hasNum(leaguePrior.mu)) {
      expectedTotal = 0.85 * historicalTotal + 0.15 * leaguePrior.mu;
      log('FB shrunk toward league: ' + fmt(historicalTotal) + ' → ' + fmt(expectedTotal));
    }

  } else if (historicalSource === 'LEAGUE_PRIOR') {
    // No team data: boost Forebet weight since it's game-specific
    if (fbEnabled && forebetValid && hasNum(fbWeight) && fbWeight > 0) {
      var fbAdjLP = forebetTotal + fbBias;
      if (hasNum(fbClampMin) && fbAdjLP < fbClampMin) fbAdjLP = fbClampMin;
      if (hasNum(fbClampMax) && fbAdjLP > fbClampMax) fbAdjLP = fbClampMax;
      var boostedWeight = Math.min(fbWeight * 2, 0.75);
      expectedTotal = (1 - boostedWeight) * historicalTotal + boostedWeight * fbAdjLP;
      forebetUsed = true;
      log('League + boosted FB: ' + fmt(historicalTotal) + ' + ' + fmt(fbAdjLP) +
          ' @w=' + fmt(boostedWeight) + ' → ' + fmt(expectedTotal));
    }
  }
  // LINE_AS_PRIOR: no blend, expectedTotal stays as line (no edge)

  log('Expected total: ' + fmt(expectedTotal));

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: SIGMA — Now uses resolved league prior (always available)
  // ═══════════════════════════════════════════════════════════════════════════
  var sigma = NaN;
  var sigmaSource = 'NONE';

  // Try league prior sigma (now always available from dynamic factory)
  if (leaguePrior && hasNum(leaguePrior.sigma) && leaguePrior.sigma > 0) {
    sigma = leaguePrior.sigma;
    sigmaSource = 'LEAGUE_PRIOR(' + leaguePriorSource + ')';
  }

  // Try variance calculator
  if (!hasNum(sigma) && typeof calculateFTVariance === 'function') {
    try {
      var sv = calculateFTVariance(stats, home, away, config);
      if (hasNum(sv) && sv > 0) {
        sigma = sv;
        sigmaSource = 'CALC_FT_VARIANCE';
      }
    } catch (e) {
      log('calculateFTVariance error: ' + e.message);
    }
  }

  // Fallback: percentage of line
  if (!hasNum(sigma)) {
    if (hasNum(ft.sigmaFromLinePct) && ft.sigmaFromLinePct > 0) {
      sigma = ft.sigmaFromLinePct * ftLine;
      sigmaSource = 'SIGMA_FROM_LINE_PCT';
    } else {
      return skipResult('Cannot compute sigma', {
        line: ftLine, lineSource: lineSource,
        expectedTotal: Math.round(expectedTotal * 10) / 10,
        historicalTotal: Math.round(historicalTotal * 10) / 10,
        muSource: historicalSource
      });
    }
  }

  // Add model error in quadrature
  if (hasNum(ft.modelError) && ft.modelError > 0) {
    sigma = Math.sqrt(sigma * sigma + ft.modelError * ft.modelError);
    log('sigma with model error: ' + fmt(sigma));
  }

  // Apply scale and floor
  sigma = Math.max(sigma * ft.sigmaScale, ft.sigmaFloor);
  log('sigma final: ' + fmt(sigma) + ' (' + sigmaSource + ')');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: SCORING
  // ═══════════════════════════════════════════════════════════════════════════
  var ctx = {
    line: ftLine,
    lineSource: lineSource,
    expectedTotal: Math.round(expectedTotal * 10) / 10,
    sigma: Math.round(sigma * 10) / 10,
    forebetUsed: forebetUsed,
    forebetTotal: forebetValid ? forebetTotal : null,
    historicalTotal: Math.round(historicalTotal * 10) / 10,
    muSource: historicalSource
  };

  var sampleCount = getSampleCountForSource(historicalSource, actualTeamSamples);
  log('Sample count: ' + sampleCount + ' (source=' + historicalSource + ')');

  // ─── PATH A: Canonical scorer (if available) ───
  if (typeof t2ou_scoreOverUnderPick_ === 'function') {
    var model = {
      mu: expectedTotal,
      sigma: sigma,
      samples: sampleCount,
      source: 'FT_SOP'
    };

    // Sync thresholds into ouCfg so scorer uses same gates
    var ouCfg = config;
    if (typeof t2ou_sanitizeOUConfig_ === 'function') {
      try { ouCfg = t2ou_sanitizeOUConfig_(config); } catch (e) {}
    }
    ouCfg.ou_edge_threshold = ft.edgeThreshold;
    ouCfg.ou_min_ev = ft.minEV;
    ouCfg.ou_min_samples = ft.minSamples;
    ouCfg.ou_confidence_scale = ft.confidenceScale;

    // FIX: Removed per-pick fake calibration that caused "pass-through" warnings.
    // Calibration should be done with historical picks, not a single current pick.
    var calibrator = null;

    try {
      var scored = t2ou_scoreOverUnderPick_(model, ftLine, ouCfg, calibrator);
      if (!scored) return skipResult('Scorer returned null', ctx);

      var dir = extractDirection(scored, expectedTotal, ftLine);

      log('Scorer: ' + dir + ' ' + ftLine + ' | play=' + scored.play +
          ' conf=' + scored.confPct + '% ev=' + fmt(scored.ev, 4) +
          ' edge=' + fmt(scored.edge, 4) + ' tier=' + scored.tier);

      // Gate: scorer declined
      if (!scored.play) {
        ctx.ev = scored.ev; ctx.edge = scored.edge; ctx.confidence = scored.confPct;
        return skipResult(scored.reason || 'Scorer declined', ctx);
      }

      // Single gate layer — scorer already enforced edge/EV
      if (scored.confPct < ft.minConf) {
        ctx.ev = scored.ev; ctx.edge = scored.edge; ctx.confidence = scored.confPct;
        return skipResult('Conf ' + scored.confPct + '% < ' + ft.minConf + '%', ctx);
      }

      // Build result
      var tierName = scored.tier || 'MEDIUM';
      var tierSymMap = {
        'ELITE': '⭐', 'STRONG': '★', 'MEDIUM': '●',
        'WEAK': '○', 'PASS': '—', 'SKIP': '○'
      };
      var tierSym = tierSymMap[tierName] || '●';
      var pickText = dir + ' ' + ftLine.toFixed(1) + ' ' + tierSym + ' (' + scored.confPct + '%)';

      Logger.log(LOG + '✅ ' + pickText + ' | ev=' + fmt(scored.ev, 4) +
                 ' edge=' + fmt(scored.edge, 4) + ' musrc=' + historicalSource +
                 ' lpSrc=' + leaguePriorSource +
                 ' [' + (nowMs() - startTime) + 'ms]');

      return {
        direction: dir,
        line: ftLine,
        pick: pickText,
        expectedTotal: Math.round(expectedTotal * 10) / 10,
        confidence: scored.confPct,
        ev: Math.round((scored.ev || 0) * 10000) / 10000,
        edge: Math.round((scored.edge || 0) * 10000) / 10000,
        tier: tierName,
        tierDisplay: tierSym,
        sigma: Math.round(sigma * 10) / 10,
        skip: false,
        reason: '',
        forebetUsed: forebetUsed,
        forebetTotal: forebetValid ? forebetTotal : null,
        historicalTotal: Math.round(historicalTotal * 10) / 10,
        muSource: historicalSource,
        push: scored.push || 0,
        lineSource: lineSource
      };

    } catch (e) {
      log('Scorer exception: ' + e.message + ' — falling back to manual');
    }
  }

  // ─── PATH B: Manual scoring ───
  log('Manual scoring path');

  // Z-score with temperature adjustment
  var diff = expectedTotal - ftLine;
  var zRaw = diff / sigma;
  var z = hasNum(ft.probTemp) && ft.probTemp > 0 ? zRaw / ft.probTemp : zRaw;

  // Probabilities
  var pOver  = normCdf(z);
  var pUnder = 1 - pOver;
  var direction = (pOver >= pUnder) ? 'Over' : 'Under';
  var pWin = (direction === 'Over') ? pOver : pUnder;

  // Bayesian shrinkage
  var shrink  = calcShrinkage(sampleCount, ft.shrinkK);
  var pWinAdj = 0.5 + (pWin - 0.5) * shrink;

  // EV and edge calculation
  var odds   = ft.americanOdds;
  var profit = odds < 0 ? (100 / Math.abs(odds)) : (odds / 100);
  var ev     = pWinAdj * profit - (1 - pWinAdj);
  var pBE    = 1 / (1 + profit);
  var edge   = pWinAdj - pBE;
  var confPct = clamp(Math.round(pWinAdj * 100), 0, 100);

  log('Manual: z=' + fmt(z, 3) + ' pWin=' + fmt(pWinAdj, 4) + ' shrink=' + fmt(shrink, 3) +
      ' ev=' + fmt(ev, 4) + ' edge=' + fmt(edge, 4) + ' conf=' + confPct + '%');

  ctx.ev         = Math.round(ev * 10000) / 10000;
  ctx.edge       = Math.round(edge * 10000) / 10000;
  ctx.confidence = confPct;

  // Gates
  if (confPct < ft.minConf) {
    return skipResult('Conf ' + confPct + '% < ' + ft.minConf + '%', ctx);
  }
  if (ev < ft.minEV) {
    return skipResult('EV ' + fmt(ev, 4) + ' < ' + ft.minEV, ctx);
  }
  if (edge < ft.edgeThreshold) {
    return skipResult('Edge ' + fmt(edge, 4) + ' < ' + ft.edgeThreshold, ctx);
  }

  // Tier
  var manualTierObj = { tier: 'MEDIUM', display: '●' };
  if (typeof getTierObject === 'function') {
    try { manualTierObj = getTierObject(confPct); } catch (e) {}
  }

  var manualPickText = direction + ' ' + ftLine.toFixed(1) + ' ' +
                       manualTierObj.display + ' (' + confPct + '%)';

  Logger.log(LOG + '✅ ' + manualPickText + ' (manual) | ev=' + fmt(ev, 4) +
             ' edge=' + fmt(edge, 4) + ' musrc=' + historicalSource +
             ' lpSrc=' + leaguePriorSource +
             ' [' + (nowMs() - startTime) + 'ms]');

  return {
    direction: direction,
    line: ftLine,
    pick: manualPickText,
    expectedTotal: Math.round(expectedTotal * 10) / 10,
    confidence: confPct,
    ev: Math.round(ev * 10000) / 10000,
    edge: Math.round(edge * 10000) / 10000,
    tier: manualTierObj.tier,
    tierDisplay: manualTierObj.display,
    sigma: Math.round(sigma * 10) / 10,
    skip: false,
    reason: '',
    forebetUsed: forebetUsed,
    forebetTotal: forebetValid ? forebetTotal : null,
    historicalTotal: Math.round(historicalTotal * 10) / 10,
    muSource: historicalSource,
    push: 0,
    lineSource: lineSource
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * buildFTConfigFromSheet_ — Unified config from Config_Tier2 sheet
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * This replaces the orphaned t2Config object. 
 * Call once at startup and pass to predictFTOverUnder.
 * Also aliased as _buildFTConfig_ for buildAccumulator compatibility.
 * 
 * Usage in buildAccumulator:
 *   var ftConfig = buildFTConfigFromSheet_(ss);
 *   var ftPred = predictFTOverUnder(game, stats, ftConfig);
 */
function buildFTConfigFromSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config_Tier2');

  var raw = {};
  if (sheet && sheet.getLastRow() > 0) {
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][0] || '').trim();
      var val = data[i][1];
      if (key && key.indexOf('---') === -1) raw[key] = val;
    }
  } else {
    Logger.log('[buildFTConfigFromSheet_] Config_Tier2 not found or empty, using defaults');
  }

  function toNum(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function toBool(v, d) {
    if (v === true || v === false) return v;
    var s = String(v || '').toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    return d;
  }

  // League-specific priors with forebet config (FIX #7-8)
  var leaguePriors = {
    'NBA':        { mu: 229.9, sigma: 17.5, forebetBias: 0.08, clampMin: 180, clampMax: 280 },
    'EuroLeague': { mu: 160.2, sigma: 14.1, forebetBias: 0.05, clampMin: 140, clampMax: 200 },
    'WNBA':       { mu: 165.0, sigma: 14.0, forebetBias: 0.06, clampMin: 140, clampMax: 200 },
    'NCAA':       { mu: 145.0, sigma: 16.0, forebetBias: 0.07, clampMin: 120, clampMax: 180 },
    'ACB':        { mu: 165.0, sigma: 13.5, forebetBias: 0.05, clampMin: 145, clampMax: 195 },
    'BSL':        { mu: 162.0, sigma: 14.0, forebetBias: 0.06, clampMin: 140, clampMax: 190 }
  };

  return {
    // Pass through raw config for other uses
    raw: raw,

    // FT namespace (unified from Config_Tier2)
    ft: {
      // Gates
      minConf:           toNum(raw.ou_min_conf, 55),
      minEV:             toNum(raw.ou_min_ev, 0.005),
      edgeThreshold:     toNum(raw.ou_edge_threshold, 0.04),
      americanOdds:      toNum(raw.ou_american_odds, -110),

      // Sigma
      sigmaFloor:        toNum(raw.ou_sigma_floor, 6),
      sigmaScale:        toNum(raw.ou_sigma_scale, 1.0),
      sigmaFromLinePct:  0.075,

      // Shrinkage — uses ou_shrink_k with n/(n+k) formula (FIX #3)
      shrinkK:           toNum(raw.ou_shrink_k, 8),
      confidenceScale:   toNum(raw.ou_confidence_scale, 20),
      minSamples:        toNum(raw.ou_min_samples, 5),

      // Temperature scaling (FIX #4)
      modelError:        toNum(raw.ou_model_error, 4.0),
      probTemp:          toNum(raw.ou_prob_temp, 1.15),

      // Forebet
      forebetWeight:     toNum(raw.forebet_ou_weight_ft, 0.35),
      forebetEnabled:    toBool(raw.forebet_blend_enabled, true),

      // League-specific priors (FIX #7-8)
      leaguePriorByLeague: leaguePriors,

      // Known fallback for sumQuarterPredictions detection
      knownFallbackValue: 105,

      // Debug
      debugLogging:      toBool(raw.debug_ou_logging, false)
    }
  };
}

/**
 * getDefaultFTConfig_ — Returns hardcoded defaults when Config_Tier2 unavailable.
 * Kept for backward compatibility and explicit fallback scenarios.
 */
function getDefaultFTConfig_() {
  return {
    minConf:           55,
    minEV:             0.005,
    edgeThreshold:     0.04,
    americanOdds:      -110,
    sigmaFloor:        6,
    sigmaScale:        1.0,
    sigmaFromLinePct:  0.075,
    shrinkK:           8,
    confidenceScale:   20,
    minSamples:        5,
    modelError:        4.0,
    probTemp:          1.15,
    forebetWeight:     0.35,
    forebetEnabled:    true,
    leaguePriorByLeague: {
      'NBA':        { mu: 229.9, sigma: 17.5, forebetBias: 0.08, clampMin: 180, clampMax: 280 },
      'EuroLeague': { mu: 160.2, sigma: 14.1, forebetBias: 0.05, clampMin: 140, clampMax: 200 },
      'WNBA':       { mu: 165.0, sigma: 14.0, forebetBias: 0.06, clampMin: 140, clampMax: 200 },
      'NCAA':       { mu: 145.0, sigma: 16.0, forebetBias: 0.07, clampMin: 120, clampMax: 180 },
      'ACB':        { mu: 165.0, sigma: 13.5, forebetBias: 0.05, clampMin: 145, clampMax: 195 },
      'BSL':        { mu: 162.0, sigma: 14.0, forebetBias: 0.06, clampMin: 140, clampMax: 190 }
    },
    knownFallbackValue: 105,
    debugLogging:      false
  };
}

// Alias for buildAccumulator compatibility
var _buildFTConfig_ = buildFTConfigFromSheet_;


// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 4: ACCUMULATOR SAFETY GATE (_acc_*)                                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝

/**
 * Safety gate for Accumulator highest quarter output.
 * ALWAYS call before formatting SNIPER HIGH QTR picks.
 * Catches any "Q1 or Q3" values that slip through.
 * 
 * @param {string} value - Raw quarter value from prediction
 * @return {Object} { quarter, valid, wasSanitized, original }
 */
function _acc_sanitizeHighestQuarter(value) {
  var result = {
    quarter: 'N/A',
    valid: false,
    wasSanitized: false,
    original: value
  };
  
  if (!value) return result;
  
  var str = String(value).trim().toUpperCase();
  
  // Already valid single quarter?
  if (/^Q[1-4]$/.test(str)) {
    result.quarter = str;
    result.valid = true;
    return result;
  }
  
  // Needs sanitization - extract first quarter
  var match = str.match(/Q([1-4])/);
  if (match) {
    result.quarter = 'Q' + match[1];
    result.valid = true;
    result.wasSanitized = true;
    
    Logger.log('[_acc_sanitizeHighestQuarter] FIXED TIE: "' + value + '" → "' + result.quarter + '"');
    return result;
  }
  
  return result;
}



/**
 * DROP-IN REPLACEMENT
 * Robustly sums predicted regulation (Q1–Q4) totals for a team+venue from tier2 margin stats.
 *
 * Works with:
 *  - NEW nested shape: stats[teamKey][Home|Away][Q1..Q4].avgTotal + .samples
 *  - LEGACY flat keys (best-effort): stats[teamKey]["Home_Q1_avgTotal"] etc
 *
 * Returns:
 *  - number (sum of Q1..Q4 avgTotal), or 0 if incomplete / not found.
 */
function sumQuarterPredictions(team, venue, stats) {
  var LOG = 'sumQuarterPredictions: ';

  // ---- input guards
  if (!stats || typeof stats !== 'object') return 0;
  if (!team) return 0;

  // Normalize venue to "Home"/"Away"
  venue = (venue || '').toString().trim();
  var vLower = venue.toLowerCase();
  var V = (vLower === 'home') ? 'Home' : (vLower === 'away') ? 'Away' : venue;
  if (V !== 'Home' && V !== 'Away') {
    Logger.log(LOG + 'Bad venue="' + venue + '" (need Home/Away)');
    return 0;
  }

  // ---- canonicalization (uses your canonical fn if present; otherwise safe fallback)
  var canon = (typeof _t2_teamKeyCanonical_ === 'function')
    ? _t2_teamKeyCanonical_
    : function (s) {
        s = (s == null) ? '' : String(s);
        s = s.trim().toLowerCase();
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
        return s.replace(/[^a-z0-9]+/g, '');
      };

  function toFinite_(x) {
    var n = (typeof x === 'number') ? x : parseFloat(x);
    return isFinite(n) ? n : NaN;
  }

  // ---- locate team data by canonical key, with fallbacks
  var teamKey = canon(team);
  var teamData = stats[teamKey];

  // Fallback A: scan keys (skip _meta and underscore keys)
  if (!teamData) {
    var keys = Object.keys(stats);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!k || k === '_meta' || k[0] === '_') continue;
      if (canon(k) === teamKey) {
        teamData = stats[k];
        break;
      }
    }
  }

  // Fallback B: use _meta.teamDisplay reverse match (if present)
  if (!teamData && stats._meta && stats._meta.teamDisplay) {
    var td = stats._meta.teamDisplay;
    var tdKeys = Object.keys(td);
    for (var j = 0; j < tdKeys.length; j++) {
      var kk = tdKeys[j]; // canonical key
      var disp = td[kk];
      if (canon(disp) === teamKey) {
        teamData = stats[kk];
        teamKey = kk;
        break;
      }
    }
  }

  if (!teamData || typeof teamData !== 'object') {
    Logger.log(LOG + '"' + team + '": NOT FOUND (canon="' + teamKey + '")');
    return 0;
  }

  // ---- helpers to read NEW nested shape
  function getNestedNode_(quarter) {
    if (!teamData[V] || !teamData[V][quarter]) return null;
    return teamData[V][quarter];
  }

  // ---- helpers to read LEGACY flat shape (best effort)
  // Common patterns we support:
  //  - Home_Q1_avgTotal, Away_Q2_avgTotal
  //  - Home_Q1_samples, Away_Q2_samples
  //  - Home_Q1_total (fallback), Home_Q1_avg (fallback)
  function getFlatCandidate_(quarter) {
    var base = V + '_' + quarter + '_';
    var avgTotal =
      (teamData[base + 'avgTotal'] !== undefined) ? teamData[base + 'avgTotal'] :
      (teamData[base + 'total'] !== undefined)    ? teamData[base + 'total'] :
      (teamData[base + 'avg'] !== undefined)      ? teamData[base + 'avg'] :
      undefined;

    var samples =
      (teamData[base + 'samples'] !== undefined) ? teamData[base + 'samples'] :
      (teamData[base + 'count'] !== undefined)   ? teamData[base + 'count'] :
      undefined;

    var t = toFinite_(avgTotal);
    var s = toFinite_(samples);
    return {
      avgTotal: isFinite(t) ? t : NaN,
      samples: isFinite(s) ? s : 0
    };
  }

  // ---- choose best candidate per quarter (prefers higher samples; requires finite avgTotal > 0)
  function pickBestQuarterTotal_(quarter) {
    var nested = getNestedNode_(quarter);
    var nTotal = nested ? toFinite_(nested.avgTotal) : NaN;
    var nSamp  = nested ? toFinite_(nested.samples) : 0;
    if (!isFinite(nSamp)) nSamp = 0;

    var flat = getFlatCandidate_(quarter);
    var fTotal = flat.avgTotal;
    var fSamp  = flat.samples;

    // Validate candidates
    var nOk = isFinite(nTotal) && nTotal > 0;
    var fOk = isFinite(fTotal) && fTotal > 0;

    if (!nOk && !fOk) return NaN;
    if (nOk && !fOk) return nTotal;
    if (!nOk && fOk) return fTotal;

    // Both OK: choose higher samples; tie -> nested
    if (fSamp > nSamp) return fTotal;
    return nTotal;
  }

  // ---- sum regulation quarters
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var sum = 0;

  for (var q = 0; q < quarters.length; q++) {
    var qt = quarters[q];
    var best = pickBestQuarterTotal_(qt);
    if (!isFinite(best) || best <= 0) {
      Logger.log(LOG + 'Incomplete for "' + team + '" (' + teamKey + ') ' + V + ' missing/invalid ' + qt);
      return 0;
    }
    sum += best;
  }

  return isFinite(sum) ? sum : 0;
}

/**
 * DROP-IN NEW HELPER
 * Game total prediction using your rule: average the two team venue totals.
 * Returns 0 if either side is missing.
 */
function predictGameTotalFromQuarters(homeTeam, awayTeam, stats) {
  var hTot = sumQuarterPredictions(homeTeam, 'Home', stats);
  var aTot = sumQuarterPredictions(awayTeam, 'Away', stats);
  if (!(hTot > 0) || !(aTot > 0)) return 0;
  return (hTot + aTot) / 2;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * extractNestedQuarters_ — BACKWARD COMPAT STUB
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * sumQuarterPredictions v4.0 is self-contained and doesn't call this.
 * Kept for backward compatibility if other code references it.
 *
 * Handles both call signatures:
 *   - extractNestedQuarters_(venueData) — v3.1 style
 *   - extractNestedQuarters_(teamStats, venue) — old style
 *
 * @param {Object} venueOrTeamData - Either venueData or teamStats
 * @param {string} [venueOrNothing] - Optional venue string if first arg is teamStats
 * @returns {Object} { total, found, details, Q1, Q2, Q3, Q4 }
 */
function extractNestedQuarters_(venueOrTeamData, venueOrNothing) {
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var data = venueOrTeamData;
  var total = 0;
  var found = 0;
  var parts = [];
  var qVals = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

  if (!data || typeof data !== 'object') {
    return { total: 0, found: 0, details: 'no data', Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  }

  // If called with (teamStats, venue) — old signature
  if (typeof venueOrNothing === 'string' && data[venueOrNothing]) {
    data = data[venueOrNothing];
  }

  for (var i = 0; i < quarters.length; i++) {
    var q = quarters[i];
    var qData = data[q] || data[q.toLowerCase()];
    var val = 0;

    if (qData && typeof qData === 'object') {
      var props = ['avgTotal', 'avg_total', 'mean', 'avgPts'];
      for (var p = 0; p < props.length; p++) {
        var pv = parseFloat(qData[props[p]]);
        if (isFinite(pv) && pv > 0) {
          val = pv;
          break;
        }
      }
    } else if (typeof qData === 'number' && qData > 0) {
      val = qData;
    }

    qVals[q] = val;

    if (val > 0) {
      total += val;
      found++;
      parts.push(q + '=' + val.toFixed(1));
    } else {
      parts.push(q + '=0');
    }
  }

  return {
    total: total,
    found: found,
    details: parts.join(' + '),
    Q1: qVals.Q1,
    Q2: qVals.Q2,
    Q3: qVals.Q3,
    Q4: qVals.Q4
  };
}


/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * extractFlatQuarters_ — BACKWARD COMPAT STUB
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * sumQuarterPredictions v4.0 is self-contained and doesn't call this.
 * Handles flat key structures like:
 *   teamData.q1_home_mean, teamData.Home_Q1_avgTotal, etc.
 *
 * @param {Object} teamData - The team's stats object
 * @param {boolean} isHome - True for home, false for away
 * @returns {Object} { total, found, details, Q1, Q2, Q3, Q4 }
 */
function extractFlatQuarters_(teamData, isHome) {
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var total = 0;
  var found = 0;
  var parts = [];
  var qVals = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  var venue = isHome ? 'Home' : 'Away';
  var venueLower = venue.toLowerCase();

  if (!teamData || typeof teamData !== 'object') {
    return { total: 0, found: 0, details: 'no team data', Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  }

  for (var i = 0; i < quarters.length; i++) {
    var q = quarters[i];
    var qLower = q.toLowerCase();
    var val = 0;

    // Try multiple flat key patterns
    var patterns = [
      venue + '_' + q + '_avgTotal',           // Home_Q1_avgTotal
      venueLower + '_' + qLower + '_avgTotal', // home_q1_avgTotal
      qLower + '_' + venueLower + '_mean',     // q1_home_mean
      qLower + '_' + venueLower + '_avg',      // q1_home_avg
      qLower + '_' + venueLower + '_avgTotal', // q1_home_avgTotal
      venue + '_' + q,                         // Home_Q1
      qLower + '_' + venueLower,               // q1_home
      q + '_avgTotal',                         // Q1_avgTotal (venue-agnostic)
      qLower + '_mean',                        // q1_mean
      qLower + '_avg'                          // q1_avg
    ];

    for (var p = 0; p < patterns.length; p++) {
      var candidate = parseFloat(teamData[patterns[p]]);
      if (isFinite(candidate) && candidate > 0) {
        val = candidate;
        break;
      }
    }

    qVals[q] = val;

    if (val > 0) {
      total += val;
      found++;
      parts.push(q + '=' + val.toFixed(1));
    } else {
      parts.push(q + '=0');
    }
  }

  return {
    total: total,
    found: found,
    details: parts.join(' + '),
    Q1: qVals.Q1,
    Q2: qVals.Q2,
    Q3: qVals.Q3,
    Q4: qVals.Q4
  };
}


/**
 * Helper: Get quarter value from object with multiple possible keys
 */
function getQuarterValue(obj, keys) {
  if (!obj || !keys) return 0;
  
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (obj.hasOwnProperty(key)) {
      var val = parseFloat(obj[key]);
      if (isFinite(val) && val > 0) {
        return val;
      }
    }
  }
  
  return 0;
}

/**
 * League quarter SD cache (per execution)
 */
var __LEAGUE_Q_SD_CACHE = null;
var __LEAGUE_Q_SD_CACHE_SET = false;

/**
 * Calculates FT TOTAL uncertainty for penalty/confidence.
 *
 * IMPORTANT: This returns SIGMA (standard deviation), not raw variance.
 *
 * Priority:
 *  1) If team variances exist (config.varianceMap / config.teamVarianceMap / Stats table), use them:
 *       sigma = sqrt(varHome + varAway)
 *  2) Else derive league FT sigma from LeagueQuarterO_U_Stats:
 *       ftVar = Q1sd^2 + Q2sd^2 + Q3sd^2 + Q4sd^2
 *       sigma = sqrt(ftVar)
 *  3) Else fallbackSigma (default 20)
 *
 * Config:
 *  - ss / spreadsheet : Spreadsheet handle (optional)
 *  - league           : e.g. 'NBA' (default)
 *  - sigmaFloor       : default 15
 *  - sigmaScale       : default 1.0
 *  - sigmaCap         : default 60
 *  - fallbackSigma    : default 20
 *  - useTeamVariance  : true/false (default true)
 *  - useLeagueQuarterSigma : true/false (default true)
 */
function calculateFTVariance(stats, home, away, config) {
  var fn = 'calculateFTVariance';
  config = config || {};

  // Soft-deps (so this function doesn't crash if your helpers aren't defined)
  function _toNum_(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }
  function _log_(msg) {
    try {
      if (typeof _enh_log === 'function') _enh_log(fn, msg);
      else Logger.log('[' + fn + '] ' + msg);
    } catch (e) {}
  }

  var sigmaFloor = (typeof _enh_toNum === 'function') ? _enh_toNum(config.sigmaFloor, 15) : _toNum_(config.sigmaFloor, 15);
  var sigmaScale = (typeof _enh_toNum === 'function') ? _enh_toNum(config.sigmaScale, 1.0) : _toNum_(config.sigmaScale, 1.0);
  var sigmaCap   = (typeof _enh_toNum === 'function') ? _enh_toNum(config.sigmaCap, 60) : _toNum_(config.sigmaCap, 60);

  var useTeamVariance = (config.useTeamVariance !== undefined) ? !!config.useTeamVariance : true;
  var useLeagueQuarterSigma = (config.useLeagueQuarterSigma !== undefined) ? !!config.useLeagueQuarterSigma : true;

  // Spreadsheet best-effort
  var ss = config.ss || config.spreadsheet || null;
  try { if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e0) {}

  function canonTeam_(name) {
    return String(name || '')
      .toLowerCase()
      .trim()
      .replace(/['’`]/g, '')
      .replace(/[.\-,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseNum_(v) {
    var s = String(v || '').trim();
    if (!s) return NaN;
    s = s.replace(/,/g, '').replace(/%/g, '');
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function normHead_(s) {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/\u00A0/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function headerMap_(row) {
    var hm = {};
    for (var c = 0; c < row.length; c++) {
      var k = normHead_(row[c]);
      if (k && hm[k] === undefined) hm[k] = c;
    }
    return hm;
  }

  function findCol_(hm, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var k = normHead_(aliases[i]);
      if (hm[k] !== undefined) return hm[k];
    }
    return undefined;
  }

  function _getTeamVarMapCached_(ss) {
    if (__TEAM_VARIANCE_MAP_CACHE_SET) return __TEAM_VARIANCE_MAP_CACHE;
    __TEAM_VARIANCE_MAP_CACHE = _loadVarianceMap(ss);
    __TEAM_VARIANCE_MAP_CACHE_SET = true;
    return __TEAM_VARIANCE_MAP_CACHE;
  }

  function _loadLeagueQuarterSDsCached_(ss) {
    if (__LEAGUE_Q_SD_CACHE_SET) return __LEAGUE_Q_SD_CACHE;
    __LEAGUE_Q_SD_CACHE_SET = true;
    __LEAGUE_Q_SD_CACHE = null;

    try {
      var sh = (typeof getSheetInsensitive === 'function')
        ? getSheetInsensitive(ss, 'LeagueQuarterO_U_Stats')
        : ss.getSheetByName('LeagueQuarterO_U_Stats');
      if (!sh || sh.getLastRow() < 2) return null;

      var values = sh.getDataRange().getValues();
      if (!values || values.length < 2) return null;

      // find header row: League + Quarter + SD
      var headerRowIdx = -1, hm = null;
      for (var r = 0; r < Math.min(25, values.length); r++) {
        hm = headerMap_(values[r]);
        var cLeague = findCol_(hm, ['league']);
        var cQuarter = findCol_(hm, ['quarter']);
        var cSd = findCol_(hm, ['sd', 'stddev', 'stdev', 'sigma']);
        if (cLeague !== undefined && cQuarter !== undefined && cSd !== undefined) {
          headerRowIdx = r;
          break;
        }
      }
      if (headerRowIdx < 0) return null;

      var cLeague2 = findCol_(hm, ['league']);
      var cQuarter2 = findCol_(hm, ['quarter']);
      var cSd2 = findCol_(hm, ['sd', 'stddev', 'stdev', 'sigma']);

      var out = {}; // {NBA:{Q1:8.4,...}}
      for (var i = headerRowIdx + 1; i < values.length; i++) {
        var row = values[i];
        var lg = String(row[cLeague2] || '').trim().toUpperCase();
        var q = String(row[cQuarter2] || '').trim().toUpperCase();
        var sd = parseNum_(row[cSd2]);
        if (!lg || !q || !isFinite(sd)) continue;

        var m = q.match(/Q\s*([1-4])/i);
        if (m) q = 'Q' + m[1];
        if (!/^Q[1-4]$/.test(q)) continue;

        if (!out[lg]) out[lg] = {};
        out[lg][q] = sd;
      }

      __LEAGUE_Q_SD_CACHE = out;
      return out;
    } catch (e) {
      _log_('League quarter SD load failed: ' + e.message);
      return null;
    }
  }

  function clampSigma_(sigma) {
    sigma = sigma * sigmaScale;
    sigma = Math.max(sigmaFloor, sigma);
    sigma = Math.min(sigmaCap, sigma);
    return sigma;
  }

  // 1) TEAM variance (if available)
  if (useTeamVariance) {
    try {
      var teamVarMap =
        config.varianceMap ||
        config.teamVarianceMap ||
        null;

      if (!teamVarMap && ss) teamVarMap = _getTeamVarMapCached_(ss);

      var hKey = canonTeam_(home);
      var aKey = canonTeam_(away);

      if (teamVarMap && Object.keys(teamVarMap).length) {
        var hVar = teamVarMap[hKey];
        var aVar = teamVarMap[aKey];

        if (isFinite(hVar) && hVar > 0 && isFinite(aVar) && aVar > 0) {
          var sigmaTeam = Math.sqrt(hVar + aVar);
          sigmaTeam = clampSigma_(sigmaTeam);
          _log_('Team variance used. homeVar=' + hVar + ', awayVar=' + aVar + ' => sigma=' + sigmaTeam.toFixed(2));
          return sigmaTeam;
        }
      }
    } catch (e1) {
      _log_('Team variance path failed: ' + e1.message);
    }
  }

  // 2) LEAGUE quarter SD fallback (your current setup)
  if (useLeagueQuarterSigma) {
    try {
      if (ss) {
        var league = String(config.league || 'NBA').trim().toUpperCase();
        var sdMap = _loadLeagueQuarterSDsCached_(ss);
        var q = sdMap && (sdMap[league] || sdMap.NBA);

        if (q && isFinite(q.Q1) && isFinite(q.Q2) && isFinite(q.Q3) && isFinite(q.Q4)) {
          var ftVar = (q.Q1*q.Q1) + (q.Q2*q.Q2) + (q.Q3*q.Q3) + (q.Q4*q.Q4);
          var sigmaLeague = Math.sqrt(ftVar);
          var raw = sigmaLeague;

          sigmaLeague = clampSigma_(sigmaLeague);

          _log_('League Q SD used for ' + league + ': sqrt(' +
                q.Q1 + '^2+' + q.Q2 + '^2+' + q.Q3 + '^2+' + q.Q4 + '^2)=' +
                raw.toFixed(2) + ' -> scaled/clamped=' + sigmaLeague.toFixed(2));

          return sigmaLeague;
        } else {
          _log_('LeagueQuarterO_U_Stats missing/incomplete SDs for ' + league + ' (need Q1-Q4).');
        }
      }
    } catch (e2) {
      _log_('League-derived sigma failed: ' + e2.message);
    }
  }

  // 3) Final fallback
  var fallbackSigma = (typeof _enh_toNum === 'function')
    ? _enh_toNum(config.fallbackSigma, 20)
    : _toNum_(config.fallbackSigma, 20);

  fallbackSigma = clampSigma_(fallbackSigma);
  _log_('Fallback sigma used: ' + fallbackSigma.toFixed(2));
  return fallbackSigma;
}



// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: STANDARDIZED OUTPUT FORMATTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns standardized headers for bet output
 */
function getStandardBetHeaders() {
  var fn = 'getStandardBetHeaders';
  var headers = ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier'];
  _enh_log(fn, 'Returning ' + headers.length + ' headers');
  return headers;
}

/**
 * Formats a single bet pick to standardized row structure
 */
function formatStandardBetRow(pick) {
  var fn = 'formatStandardBetRow';
  _enh_log(fn, 'ENTER: Formatting pick for ' + (pick.match || pick.home + ' vs ' + pick.away));
  
  var tierObj = getTierObject(pick.confidence);
  
  var row = [
    pick.league || '',
    formatDateStandard(pick.date),
    formatTimeStandard(pick.time),
    pick.match || (pick.home + ' vs ' + pick.away),
    pick.pick || '',
    pick.type || '',
    pick.odds ? String(pick.odds) : '-',
    tierObj.display || formatConfidenceDisplay(pick.confidence),
    formatEVDisplay(pick.ev),
    tierObj.tier || ''
  ];
  
  _enh_log(fn, 'EXIT: Row with ' + row.length + ' columns');
  return row;
}

/**
 * Formats date consistently (DD/MM/YYYY)
 */
function formatDateStandard(val) {
  var fn = 'formatDateStandard';
  
  if (!val) {
    _enh_log(fn, 'No value → empty string');
    return '';
  }
  
  var d;
  if (val instanceof Date) {
    d = val;
    _enh_log(fn, 'Input is Date object');
  } else if (typeof val === 'number') {
    d = new Date((val - 25569) * 86400000);
    _enh_log(fn, 'Input is Excel serial: ' + val);
  } else {
    var str = String(val).trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      _enh_log(fn, 'Already in DD/MM/YYYY format: ' + str);
      return str;
    }
    d = new Date(str);
    _enh_log(fn, 'Parsed string: ' + str);
  }
  
  if (!d || isNaN(d.getTime())) {
    _enh_log(fn, 'Invalid date → returning as string: ' + val);
    return String(val);
  }
  
  var day = ('0' + d.getDate()).slice(-2);
  var mon = ('0' + (d.getMonth() + 1)).slice(-2);
  var result = day + '/' + mon + '/' + d.getFullYear();
  
  _enh_log(fn, 'Formatted: ' + result);
  return result;
}

/**
 * Formats time consistently (HH:MM)
 */
function formatTimeStandard(val) {
  var fn = 'formatTimeStandard';
  
  if (!val) {
    _enh_log(fn, 'No value → empty string');
    return '';
  }
  
  if (val instanceof Date) {
    var h = ('0' + val.getHours()).slice(-2);
    var m = ('0' + val.getMinutes()).slice(-2);
    var result = h + ':' + m;
    _enh_log(fn, 'Date object → ' + result);
    return result;
  }
  
  _enh_log(fn, 'String value: ' + val);
  return String(val);
}

/**
 * Formats confidence percentage for display
 */
function formatConfidenceDisplay(conf) {
  var fn = 'formatConfidenceDisplay';
  
  if (!isFinite(conf)) {
    _enh_log(fn, 'Not finite → N/A');
    return 'N/A';
  }
  
  var rounded = Math.round(conf * 10) / 10;
  var result = (rounded === Math.floor(rounded)) ? Math.floor(rounded) + '%' : rounded.toFixed(1) + '%';
  
  _enh_log(fn, conf + ' → ' + result);
  return result;
}

/**
 * Formats EV for display
 */
function formatEVDisplay(ev) {
  var fn = 'formatEVDisplay';
  
  if (!isFinite(ev)) {
    _enh_log(fn, 'Not finite → -');
    return '-';
  }
  
  if (ev === 0) {
    _enh_log(fn, 'Zero → 0%');
    return '0%';
  }
  
  var result;
  if (ev > -1 && ev < 1) {
    result = (ev * 100).toFixed(1) + '%';
  } else {
    result = ev.toFixed(1) + '%';
  }
  
  _enh_log(fn, ev + ' → ' + result);
  return result;
}

/**
 * Formats a batch of picks with consistent structure
 */
function formatAllPicksStandard(picks) {
  var fn = 'formatAllPicksStandard';
  _enh_log(fn, 'ENTER: Formatting ' + (picks ? picks.length : 0) + ' picks');
  
  var output = [getStandardBetHeaders()];
  
  for (var i = 0; i < picks.length; i++) {
    output.push(formatStandardBetRow(picks[i]));
  }
  
  _enh_log(fn, 'EXIT: ' + output.length + ' rows (including header)');
  return output;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: INTERNAL HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safe number conversion with fallback
 */
function _enh_toNum(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  var n = parseFloat(String(val).replace(/[,%]/g, '').trim());
  return isFinite(n) ? n : fallback;
}

/**
 * Clamp value between min and max
 */
function _enh_clamp(val, min, max) {
  val = Number(val);
  if (!isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Merge config objects with defaults
 */
function _enh_mergeConfig(defaults, custom) {
  var result = {};
  for (var key in defaults) {
    result[key] = defaults[key];
  }
  if (custom) {
    for (var k in custom) {
      if (custom[k] !== undefined && custom[k] !== null) {
        result[k] = custom[k];
      }
    }
  }
  return result;
}

/**
 * Create header map from header row
 */
function _enh_headerMap(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').toLowerCase().trim();
    if (h) map[h] = i;
  }
  
  // Common aliases
  if (map['home team'] !== undefined && map.home === undefined) map.home = map['home team'];
  if (map['away team'] !== undefined && map.away === undefined) map.away = map['away team'];
  if (map['ft score'] !== undefined && map.ft === undefined) map.ft = map['ft score'];
  
  return map;
}

/**
 * Parse score string to [home, away] array
 */
function _enh_parseScore(scoreStr) {
  if (!scoreStr) return null;
  var s = String(scoreStr).trim().replace(/[–—]/g, '-');
  
  var m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  
  var home = parseInt(m[1], 10);
  var away = parseInt(m[2], 10);
  
  if (!isFinite(home) || !isFinite(away)) return null;
  return [home, away];
}

/**
 * Parse book line from various formats
 */
function _enh_parseBookLine(val) {
  var fn = '_enh_parseBookLine';
  
  if (!val) {
    _enh_log(fn, 'No value → NaN');
    return NaN;
  }
  
  var s = String(val).trim();
  _enh_log(fn, 'Parsing: "' + s + '"');
  
  // Skip score formats
  if (/^\d+\s*[-:]\s*\d+$/.test(s)) {
    _enh_log(fn, 'Looks like score format → NaN');
    return NaN;
  }
  
  // Handle fractions and formatting
  s = s.replace(/½/g, '.5').replace(/,/g, '.');
  
  var m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) {
    _enh_log(fn, 'No number found → NaN');
    return NaN;
  }
  
  var n = parseFloat(m[1]);
  if (!isFinite(n)) {
    _enh_log(fn, 'Parse result not finite → NaN');
    return NaN;
  }
  
  // Sanity check for basketball totals
  if (n < 10 || n > 300) {
    _enh_log(fn, 'Value ' + n + ' outside basketball range [10,300] → NaN');
    return NaN;
  }
  
  _enh_log(fn, 'Parsed: ' + n);
  return n;
}

/**
 * Normal CDF approximation
 */
function _enh_normCdf(z) {
  var sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  
  var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  
  var t = 1 / (1 + p * z);
  var erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-z * z);
  
  return 0.5 * (1 + sign * erf);
}

/**
 * Error function for normal CDF calculations
 */
function _enh_erf(x) {
  var a1 =  0.254829592;
  var a2 = -0.284496736;
  var a3 =  1.421413741;
  var a4 = -1.453152027;
  var a5 =  1.061405429;
  var p  =  0.3275911;
  
  var sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  var t = 1.0 / (1.0 + p * x);
  var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return sign * y;
}



/**
 * Integrates robber picks with accumulator system
 */
function formatRobbersForAccumulator(robbers, accaConfig) {
  var fn = 'formatRobbersForAccumulator';
  _enh_log(fn, 'ENTER: Processing ' + (robbers ? robbers.length : 0) + ' robbers for accumulator');
  
  accaConfig = accaConfig || {};
  var maxRobbersPerAcca = _enh_toNum(accaConfig.maxRobbersPerAcca, 1);
  var minRobberConf = _enh_toNum(accaConfig.minRobberConfidence, 60);
  
  _enh_log(fn, 'Config: maxPerAcca=' + maxRobbersPerAcca + ', minConf=' + minRobberConf);
  
  if (!robbers || !Array.isArray(robbers) || robbers.length === 0) {
    _enh_log(fn, 'EXIT: No robbers to process → empty array');
    return [];
  }
  
  var formatted = [];
  
  for (var i = 0; i < robbers.length; i++) {
    var robber = robbers[i];
    
    if (!robber || robber.confidence < minRobberConf) {
      _enh_log(fn, 'Robber ' + i + ': Skipped (conf=' + (robber ? robber.confidence : 'null') + ')');
      continue;
    }
    
    _enh_log(fn, 'Robber ' + i + ': ' + robber.team + ' @ ' + robber.odds + ' (conf=' + robber.confidence + '%)');
    
    formatted.push({
      league: robber.league || '',
      date: robber.date || '',
      time: robber.time || '',
      match: robber.match || '',
      pick: robber.pick || (robber.team + ' ML'),
      type: 'ROBBER',
      odds: robber.odds || 0,
      confidence: robber.confidence || 0,
      tier: robber.tier || 'ROBBER',
      tierDisplay: robber.tierDisplay || getOUTierDisplay(robber.confidence),
      ev: robber.ev || 0,
      edge: robber.edge || 0,
      isRobber: true,
      robberScore: robber.score || 0,
      robberReasons: robber.reasons || [],
      isHomeUnderdog: robber.isHomeUnderdog || false,
      accaEligible: robber.confidence >= minRobberConf && robber.ev > 0,
      accaWeight: Math.min(1.0, robber.confidence / 100) * 0.8,
      riskCategory: 'HIGH'
    });
  }
  
  formatted.sort(function(a, b) { return b.confidence - a.confidence; });
  
  if (formatted.length > maxRobbersPerAcca) {
    _enh_log(fn, 'Limiting from ' + formatted.length + ' to ' + maxRobbersPerAcca);
    formatted = formatted.slice(0, maxRobbersPerAcca);
  }
  
  _enh_log(fn, 'EXIT: Returning ' + formatted.length + ' formatted robbers');
  return formatted;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Cache clearing — consolidated (shared helper, no duplicated logic)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Shared helper: resets T2OU_CACHE fields if the global exists */
function _clearT2OUCache_() {
  if (typeof T2OU_CACHE !== 'undefined' && T2OU_CACHE) {
    T2OU_CACHE.teamStats = null;
    T2OU_CACHE.league = null;
    T2OU_CACHE.builtAt = null;
    return true;
  }
  return false;
}

/**
 * Clear T2OU cache only
 */
function clearTier2OUCache() {
  var fn = 'clearTier2OUCache';
  _enh_log(fn, 'ENTER: Clearing O/U cache');

  if (_clearT2OUCache_()) {
    _enh_log(fn, 'T2OU_CACHE cleared');
  } else {
    _enh_log(fn, 'T2OU_CACHE not defined');
  }

  _safeToast_(null, 'O/U cache cleared', 'Ma Golide', 3);
  _enh_log(fn, 'EXIT');
}

/**
 * Clear all Tier 2 caches
 */
function clearAllTier2Caches() {
  var fn = 'clearAllTier2Caches';
  _enh_log(fn, 'ENTER: Clearing all Tier 2 caches');

  TIER2_MARGIN_STATS_CACHE = null;
  _enh_log(fn, 'Cleared: TIER2_MARGIN_STATS_CACHE');

  if (_clearT2OUCache_()) {
    _enh_log(fn, 'Cleared: T2OU_CACHE');
  }

  CONFIG_TIER2 = null;
  CONFIG_TIER2_META = { loadedAt: 0, source: null, league: null };
  _enh_log(fn, 'Cleared: CONFIG_TIER2');

  _safeToast_(null, 'All Tier 2 caches cleared', 'Ma Golide', 3);
  _enh_log(fn, 'EXIT: All caches cleared');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTION STUBS (if not defined elsewhere)
// ═══════════════════════════════════════════════════════════════════════════

// These may be defined in other modules - providing stubs if not
if (typeof _ensureSpreadsheet_ !== 'function') {
  function _ensureSpreadsheet_(ss) {
    if (ss && typeof ss.getSheets === 'function') return ss;
    try { return SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { return null; }
  }
}

if (typeof _safeToast_ !== 'function') {
  function _safeToast_(ss, msg, title, timeout) {
    try {
      ss = ss || SpreadsheetApp.getActiveSpreadsheet();
      if (ss && typeof ss.toast === 'function') {
        ss.toast(msg, title || 'Ma Golide', timeout || 5);
      }
    } catch (e) { /* ignore */ }
  }
}

if (typeof _getSheetByNameInsensitive_ !== 'function') {
  function _getSheetByNameInsensitive_(ss, name) {
    if (!ss) return null;
    var sheets = ss.getSheets();
    var lowerName = name.toLowerCase();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().toLowerCase() === lowerName) {
        return sheets[i];
      }
    }
    return null;
  }
}

if (typeof _createHeaderMap_ !== 'function') {
  function _createHeaderMap_(headerRow) {
    var map = {};
    for (var i = 0; i < headerRow.length; i++) {
      var h = String(headerRow[i] || '').toLowerCase().trim();
      if (h) map[h] = i;
    }
    return map;
  }
}

if (typeof loadTier2Config !== 'function') {
  function loadTier2Config(ss) {
    _enh_log('loadTier2Config', 'STUB: Returning default config');
    return {
      enableRobbers: true,
      enableFirstHalf: true,
      enableFTOU: true,
      enableEnhancedHighestQ: true
    };
  }
}


/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * buildEnrichedFTGame_ — Builds a fully enriched game object for FT O/U prediction
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The old code built { home, away, ftBookLine, league } — stripping predScore, avg,
 * forebetTotal, quarters. Without these, predictFTOverUnder can never extract Forebet data.
 *
 * This extracts:
 *   - predScore (e.g., "111-106")
 *   - avg column
 *   - forebetTotal from ou-fb-used column (format: "FB 217")
 *   - quarters (q1, q2, q3, q4)
 *   - date/time
 *   - t2 fallback signals
 *
 * @param {string} home       - Home team name
 * @param {string} away       - Away team name
 * @param {string} league     - League identifier
 * @param {number} ftLine     - FT book line (O/U total)
 * @param {Array}  row        - Raw row data from sheet
 * @param {Object} t1Map      - Header-to-index mapping { headerName: columnIndex }
 * @param {Object} [t2]       - Optional Tier2 data object with fallback signals
 * @returns {Object}          - Enriched game object for predictFTOverUnder
 */
function buildEnrichedFTGame_(home, away, league, ftLine, row, t1Map, t2) {
  var game = {
    home: home,
    away: away,
    ftBookLine: ftLine,
    line: ftLine,
    league: league,
    leagueKey: league
  };

  // ── Pred Score (e.g., "111-106") ──
  var psKeys = ['pred_score', 'predscore', 'predScore'];
  for (var p = 0; p < psKeys.length; p++) {
    var psIdx = t1Map[psKeys[p]];
    if (psIdx !== undefined && row[psIdx]) {
      game.predScore = String(row[psIdx]);
      break;
    }
  }

  // ── Avg column ──
  if (t1Map['avg'] !== undefined && row[t1Map['avg']]) {
    game.avg = row[t1Map['avg']];
  }

  // ── Quarter predictions ──
  var qKeys = ['q1', 'q2', 'q3', 'q4'];
  for (var q = 0; q < qKeys.length; q++) {
    if (t1Map[qKeys[q]] !== undefined) {
      game[qKeys[q]] = row[t1Map[qKeys[q]]];
    }
  }

  // ── ou-fb-used column (format: "FB 217") ──
  var fbUsedIdx = findFBUsedIndex_(t1Map);
  if (fbUsedIdx !== undefined && row[fbUsedIdx]) {
    var fbStr = String(row[fbUsedIdx]);
    game['ou-fb-used'] = fbStr;
    var fbMatch = fbStr.match(/FB\s*(\d+\.?\d*)/i);
    if (fbMatch) {
      game.forebetTotal = parseFloat(fbMatch[1]);
    }
  }

  // ── Derive forebetTotal from predScore if not set ──
  if (!game.forebetTotal && game.predScore) {
    game.forebetTotal = parsePredScoreTotal_(game.predScore);
  }

  // ── t2 fallback signals ──
  if (t2) {
    if (!game.forebetTotal && t2.forebetTotal) game.forebetTotal = t2.forebetTotal;
    if (!game.forebetTotal && t2.fbTotal) game.forebetTotal = t2.fbTotal;
    if (!game.ftBookLine && t2.ftLine) game.ftBookLine = t2.ftLine;
  }

  // ── Date/Time ──
  if (t1Map['date'] !== undefined) game.date = row[t1Map['date']];
  if (t1Map['time'] !== undefined) game.time = row[t1Map['time']];

  return game;
}

/**
 * findFBUsedIndex_ — Finds the column index for ou-fb-used with flexible matching.
 * Handles: 'ou-fb-used', 'ou_fb_used', or partial match containing ou+fb+used.
 */
function findFBUsedIndex_(t1Map) {
  // Direct match attempts
  if (t1Map['ou-fb-used'] !== undefined) return t1Map['ou-fb-used'];
  if (t1Map['ou_fb_used'] !== undefined) return t1Map['ou_fb_used'];
  if (t1Map['oufbused'] !== undefined) return t1Map['oufbused'];

  // Partial match fallback
  var hKeys = Object.keys(t1Map);
  for (var i = 0; i < hKeys.length; i++) {
    var key = hKeys[i].toLowerCase();
    if (key.indexOf('ou') >= 0 && key.indexOf('fb') >= 0 && key.indexOf('used') >= 0) {
      return t1Map[hKeys[i]];
    }
  }

  return undefined;
}

/**
 * parsePredScoreTotal_ — Parses "111-106" or "111–106" into total (217).
 * Returns null if parsing fails.
 */
function parsePredScoreTotal_(predScore) {
  if (!predScore) return null;

  var parts = String(predScore).split(/\s*[-–]\s*/);
  if (parts.length >= 2) {
    var pH = parseFloat(parts[0]);
    var pA = parseFloat(parts[1]);
    if (isFinite(pH) && isFinite(pA) && pH > 0 && pA > 0) {
      return pH + pA;
    }
  }

  return null;
}


// Cache variables (ensure defined)
var TIER2_MARGIN_STATS_CACHE = null;
var CONFIG_TIER2 = null;
var CONFIG_TIER2_META = { loadedAt: 0, source: null, league: null };

/**
 * ============================================================================
 * MODULE 9 — ELITE DROP-IN ENHANCEMENT SYSTEM v6.0
 * ============================================================================
 * 
 * COMPATIBILITY GUARANTEES:
 * - All public function signatures EXACTLY match existing implementations
 * - Falls back gracefully when data is missing/invalid
 * - Works with time-driven triggers, web apps, and direct execution
 * - Cache invalidation is automatic per-spreadsheet
 * 
 * INTEGRATION REQUIREMENTS:
 * Sheets (case-insensitive):
 *   - LeagueQuarterO_U_Stats: League, Quarter, Mean/Mean(Actual), SD, Over%, Under%, Count
 *   - CleanH2H_1..N: Home, Away, Q1H, Q1A, Q2H, Q2A, Q3H, Q3A, Q4H, Q4A
 *   - CleanRecentHome_1..N: Home (focus team), Away (opponent), Q1H..Q4A
 *   - CleanRecentAway_1..N: Away (focus team), Home (opponent), Q1H..Q4A
 *   - Clean (optional): League, Status, Q1, Q2, Q3, Q4 (fallback derivation)
 *   - LeagueQuarterStats (optional): Team, Quarter, Win%, Total
 * 
 * DEBUG: Call Elite.setDebug(true) to enable logging
 * CACHE: Call Elite.resetCache() to force reload
 * ============================================================================
 */

var Elite = (function() {
  'use strict';
  
  // =====================
  // CONFIGURATION
  // =====================
  var VERSION = '6.0.0';
  var MAX_LOG_LINES = 150;
  var MAX_SHEET_INDEX = 25;
  var QUARTER_KEYS = ['Q1', 'Q2', 'Q3', 'Q4'];
  
  // Default baselines (NBA-calibrated, but overridden by league data)
  var DEFAULT_QUARTER = { mean: 54, sd: 8.8, overPct: 50, underPct: 50, count: 0 };
  
  // =====================
  // STATE (module-private)
  // =====================
  var state = {
    debug: true,
    logCount: 0,
    cache: null,
    cacheKey: null
  };
  
  // =====================
  // LOGGING
  // =====================
  function log(fn, msg) {
    if (!state.debug || state.logCount >= MAX_LOG_LINES) return;
    Logger.log('[Elite:' + fn + '] ' + msg);
    state.logCount++;
  }
  
  function warn(fn, msg) {
    Logger.log('[Elite:WARN:' + fn + '] ' + msg);
  }
  
  // =====================
  // UTILITIES
  // =====================
  function toNum(v, fallback) {
    if (v == null || v === '') return fallback;
    var s = String(v).replace(/[,%\s]/g, '');
    var n = Number(s);
    return isFinite(n) ? n : fallback;
  }
  
  function clamp(x, lo, hi) {
    x = Number(x);
    return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;
  }
  
  function round(x, dp) {
    if (!isFinite(x)) return 0;
    var p = Math.pow(10, dp || 1);
    return Math.round(x * p) / p;
  }
  
  function mean(arr) {
    if (!arr || !arr.length) return NaN;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }
  
  function stdDev(arr) {
    if (!arr || arr.length < 2) return NaN;
    var mu = mean(arr);
    var variance = 0;
    for (var i = 0; i < arr.length; i++) {
      var d = arr[i] - mu;
      variance += d * d;
    }
    return Math.sqrt(variance / arr.length);
  }
  
  // Canonical team key: lowercase, single spaces, trimmed
  function teamKey(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }
  
  // Canonical league key: uppercase, trimmed
  function leagueKey(s) {
    return String(s || '').toUpperCase().trim();
  }
  
  // Canonical quarter: ensures Q1-Q4 format
  function quarterKey(q) {
    q = String(q || '').toUpperCase().trim();
    if (/^[1-4]$/.test(q)) return 'Q' + q;
    if (/^Q[1-4]$/.test(q)) return q;
    return null;
  }
  
  // Canonical matchup key (sorted for symmetric lookup)
  function matchupKey(home, away) {
    var h = teamKey(home);
    var a = teamKey(away);
    if (!h || !a) return null;
    return (h < a) ? (h + '|' + a) : (a + '|' + h);
  }
  
  // =====================
  // HEADER MAPPING (robust)
  // =====================
  function buildHeaderMap(headerRow) {
    var map = {};
    for (var i = 0; i < headerRow.length; i++) {
      var raw = String(headerRow[i] || '').trim();
      if (!raw) continue;
      
      var variants = [
        raw.toLowerCase(),
        raw.toLowerCase().replace(/[\s_\-\/().%]+/g, ''),
        raw.toLowerCase().replace(/[\s_\-\/().%]+/g, '').replace(/quarter/g, 'q')
      ];
      
      for (var v = 0; v < variants.length; v++) {
        if (variants[v] && !map.hasOwnProperty(variants[v])) {
          map[variants[v]] = i;
        }
      }
    }
    return map;
  }
  
  function findColumn(hmap, options) {
    for (var i = 0; i < options.length; i++) {
      var opt = String(options[i]).toLowerCase().replace(/[\s_\-\/().%]+/g, '');
      if (hmap.hasOwnProperty(opt)) return hmap[opt];
    }
    return undefined;
  }
  
  // =====================
  // SPREADSHEET ACCESS (safe)
  // =====================
  function getSpreadsheet(arg) {
    // If already a spreadsheet, return it
    if (arg && typeof arg.getSheets === 'function') return arg;
    
    // Try project helper functions
    if (typeof _ensureSpreadsheet_ === 'function') {
      try { return _ensureSpreadsheet_(arg); } catch (e) {}
    }
    if (typeof ensureSpreadsheet === 'function') {
      try { return ensureSpreadsheet(arg); } catch (e) {}
    }
    
    // Last resort: active spreadsheet (can be null in triggers!)
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) return ss;
    } catch (e) {}
    
    // Truly last resort: open by ID if provided
    if (typeof arg === 'string' && arg.length > 10) {
      try { return SpreadsheetApp.openById(arg); } catch (e) {}
    }
    
    return null;
  }
  
  function getSheet(ss, name) {
    if (!ss) return null;
    
    // Try project helper functions
    if (typeof _getSheetByNameInsensitive_ === 'function') {
      try { return _getSheetByNameInsensitive_(ss, name); } catch (e) {}
    }
    if (typeof getSheetByNameInsensitive === 'function') {
      try { return getSheetByNameInsensitive(ss, name); } catch (e) {}
    }
    
    // Manual case-insensitive search
    var target = String(name || '').toLowerCase();
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().toLowerCase() === target) return sheets[i];
    }
    return null;
  }
  
  function toast(ss, msg, title, sec) {
    try {
      if (typeof _safeToast_ === 'function') return _safeToast_(ss, msg, title, sec);
      if (typeof safeToast === 'function') return safeToast(ss, msg, title, sec);
      if (ss && typeof ss.toast === 'function') ss.toast(msg, title || 'Elite', sec || 3);
    } catch (e) {}
  }

  
  // =====================
  // CACHE MANAGEMENT
  // =====================
  function getCacheKey(ss) {
    try { return ss.getId(); } catch (e) { return 'unknown'; }
  }
  
  function ensureCache(ss) {
    var key = getCacheKey(ss);
    
    // Invalidate if spreadsheet changed
    if (state.cacheKey !== key) {
      log('ensureCache', 'Cache invalidated: new spreadsheet');
      state.cache = null;
      state.cacheKey = key;
    }
    
    if (!state.cache) {
      state.cache = {
        leagueOU: null,
        teamWin: null,
        h2h: null,
        recentHome: null,
        recentAway: null,
        derivedOU: null,
        loadedAt: new Date()
      };
    }
    
    return state.cache;
  }
  
  // =====================
  // LOADERS
  // =====================
  
  /**
 * PATCHED: loadLeagueOU
 * Fixes header/schema mismatch when the sheet has a title row above the real headers.
 * - Scans the first ~10 rows to find the header row containing "League" and "Quarter".
 * - More tolerant header normalization ("Over %" vs "Over%"; "Mean (Actual)" etc.)
 *
 * Returns: { ok: boolean, byLeague: { LEAGUE: { Q1: {...}, ... } } }
 */
function loadLeagueOU(ss) {
  var fn = 'loadLeagueOU';
  var cache = (typeof ensureCache === 'function') ? ensureCache(ss) : (loadLeagueOU._cache || (loadLeagueOU._cache = {}));
  if (cache.leagueOU) return cache.leagueOU;

  function log_(m) { try { (typeof log === 'function' ? log(fn, m) : Logger.log('[' + fn + '] ' + m)); } catch (e) {} }
  function warn_(m) { try { (typeof warn === 'function' ? warn(fn, m) : Logger.log('[' + fn + '][WARN] ' + m)); } catch (e) {} }

  var result = { ok: false, byLeague: {} };

  var sh = null;
  try {
    sh = (typeof getSheet === 'function') ? getSheet(ss, 'LeagueQuarterO_U_Stats') : null;
    if (!sh && typeof t2ou_getSheetInsensitive_ === 'function') sh = t2ou_getSheetInsensitive_(ss, 'LeagueQuarterO_U_Stats');
  } catch (e) {
    sh = null;
  }

  if (!sh) {
    warn_('Sheet not found, will try derived fallback');
    cache.leagueOU = result;
    return result;
  }

  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) {
    warn_('Sheet empty');
    cache.leagueOU = result;
    return result;
  }

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

  function findHeaderRowIndex_(grid) {
    var maxScan = Math.min(10, grid.length);
    for (var r = 0; r < maxScan; r++) {
      var hm = headerMap_(grid[r]);
      var cLeague = findCol_(hm, ['league']);
      var cQuarter = findCol_(hm, ['quarter', 'period', 'q']);
      if (cLeague !== undefined && cQuarter !== undefined) return r;
      // Also detect wide-format header row
      var cWideLeague = findCol_(hm, ['league', 'competition', 'comp']);
      var cQ1M = findCol_(hm, ['q1 mean', 'q1mean', 'q1_mean']);
      if (cWideLeague !== undefined && cQ1M !== undefined) return r;
    }
    return 0; // fallback to first row
  }

  var headerRowIdx = findHeaderRowIndex_(data);
  var headers = data[headerRowIdx];
  var hm = headerMap_(headers);

  var cLeague = findCol_(hm, ['league', 'competition', 'comp']);
  var cQuarter = findCol_(hm, ['quarter', 'period', 'q']);
  var cMean = findCol_(hm, ['mean actual', 'mean', 'avg', 'average']);
  var cSD = findCol_(hm, ['sd', 'stddev', 'stdev', 'sigma', 'standard deviation']);
  var cOver = findCol_(hm, ['over pct', 'over']);
  var cUnder = findCol_(hm, ['under pct', 'under']);
  var cCount = findCol_(hm, ['count', 'games', 'n', 'total']);

  function leagueKey_(v) { return String(v || '').trim().toUpperCase(); }
  function quarterKey_(v) {
    var s = String(v || '').trim().toUpperCase();
    var m = s.match(/\bQ[1-4]\b/);
    return m ? m[0] : '';
  }
  function toNum_(v, fallback) {
    var s = String(v || '').trim();
    if (!s) return fallback;
    s = s.replace(/%/g, '');
    var n = Number(s);
    return isFinite(n) ? n : fallback;
  }

  // ── Wide-format detection & parsing ──
  if (cLeague === undefined || cQuarter === undefined) {
    // Try wide-format: columns like "Q1 Mean", "Q1 SD", "Q2 Mean", etc.
    var wideQuarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    var wideCols = {}; // { Q1: {mean:col, sd:col, over:col, under:col, count:col}, ... }
    var anyWideFound = false;

    for (var qi = 0; qi < wideQuarters.length; qi++) {
      var qLabel = wideQuarters[qi]; // "Q1"
      var ql = qLabel.toLowerCase();  // "q1"
      var qEntry = {
        mean:     findCol_(hm, [ql + ' mean', ql + 'mean', ql + '_mean', ql + ' avg', ql + ' average', ql + ' mean actual']),
        sd:       findCol_(hm, [ql + ' sd', ql + 'sd', ql + '_sd', ql + ' stddev', ql + ' stdev', ql + ' sigma']),
        overPct:  findCol_(hm, [ql + ' over pct', ql + ' over', ql + 'over', ql + '_over', ql + ' over pct']),
        underPct: findCol_(hm, [ql + ' under pct', ql + ' under', ql + 'under', ql + '_under', ql + ' under pct']),
        count:    findCol_(hm, [ql + ' count', ql + ' games', ql + ' n', ql + 'count', ql + '_count', ql + ' total'])
      };
      if (qEntry.mean !== undefined || qEntry.sd !== undefined) {
        anyWideFound = true;
      }
      wideCols[qLabel] = qEntry;
    }

    // Also look for a shared games/count column (not per-quarter)
    var cGamesWide = findCol_(hm, ['games', 'count', 'n', 'total']);

    if (cLeague === undefined || !anyWideFound) {
      warn_('Missing required columns: League and/or Quarter/wide-format (headerRowIdx=' + headerRowIdx + ')');
      cache.leagueOU = result;
      return result;
    }

    // Parse wide format
    var loaded = 0;
    for (var rw = headerRowIdx + 1; rw < data.length; rw++) {
      var row = data[rw];
      var lg = leagueKey_(row[cLeague]);
      if (!lg) continue;

      if (!result.byLeague[lg]) result.byLeague[lg] = {};

      for (var qj = 0; qj < wideQuarters.length; qj++) {
        var qk = wideQuarters[qj];
        var wc = wideCols[qk];
        // Only create entry if at least mean or sd column exists for this quarter
        if (wc.mean === undefined && wc.sd === undefined) continue;

        var qCount = wc.count !== undefined ? toNum_(row[wc.count], 0) : (cGamesWide !== undefined ? toNum_(row[cGamesWide], 0) : 0);

        result.byLeague[lg][qk] = {
          mean:     wc.mean     !== undefined ? toNum_(row[wc.mean], NaN) : NaN,
          sd:       wc.sd       !== undefined ? toNum_(row[wc.sd], NaN) : NaN,
          overPct:  wc.overPct  !== undefined ? toNum_(row[wc.overPct], NaN) : NaN,
          underPct: wc.underPct !== undefined ? toNum_(row[wc.underPct], NaN) : NaN,
          count:    qCount
        };
        loaded++;
      }
    }

    result.ok = loaded > 0;
    log_('Wide-format: loaded ' + loaded + ' quarter-entries, ' + Object.keys(result.byLeague).length + ' leagues (headerRowIdx=' + headerRowIdx + ')');
    cache.leagueOU = result;
    return result;
  }

  // ── Long-format parsing (original logic) ──
  var loaded = 0;
  for (var r2 = headerRowIdx + 1; r2 < data.length; r2++) {
    var row = data[r2];
    var lg = leagueKey_(row[cLeague]);
    var q = quarterKey_(row[cQuarter]);
    if (!lg || !q) continue;

    if (!result.byLeague[lg]) result.byLeague[lg] = {};

    result.byLeague[lg][q] = {
      mean: cMean !== undefined ? toNum_(row[cMean], NaN) : NaN,
      sd: cSD !== undefined ? toNum_(row[cSD], NaN) : NaN,
      overPct: cOver !== undefined ? toNum_(row[cOver], NaN) : NaN,
      underPct: cUnder !== undefined ? toNum_(row[cUnder], NaN) : NaN,
      count: cCount !== undefined ? toNum_(row[cCount], 0) : 0
    };
    loaded++;
  }

  result.ok = loaded > 0;
  log_('Loaded ' + loaded + ' rows, ' + Object.keys(result.byLeague).length + ' leagues (headerRowIdx=' + headerRowIdx + ')');
  cache.leagueOU = result;
  return result;
}
  
  /**
   * Derive league OU from Clean sheet (fallback)
   */
  function derivedLeagueOU(ss) {
    var fn = 'derivedLeagueOU';
    var cache = ensureCache(ss);
    if (cache.derivedOU) return cache.derivedOU;
    
    var result = { ok: false, byLeague: {} };
    var sh = getSheet(ss, 'Clean');
    
    if (!sh) {
      log(fn, 'Clean sheet not found');
      cache.derivedOU = result;
      return result;
    }
    
    var data = sh.getDataRange().getValues();
    if (!data || data.length < 2) {
      cache.derivedOU = result;
      return result;
    }
    
    var h = buildHeaderMap(data[0]);
    var cLeague = findColumn(h, ['league', 'competition', 'comp']);
    var cStatus = findColumn(h, ['status', 'state', 'result']);
    var cQ1 = findColumn(h, ['q1', 'quarter1', '1stquarter']);
    var cQ2 = findColumn(h, ['q2', 'quarter2', '2ndquarter']);
    var cQ3 = findColumn(h, ['q3', 'quarter3', '3rdquarter']);
    var cQ4 = findColumn(h, ['q4', 'quarter4', '4thquarter']);
    
    // Parse "26 - 30" format to total
    function parseQuarterTotal(cell) {
      var s = String(cell || '').trim();
      var m = s.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
      if (!m) return NaN;
      var a = Number(m[1]), b = Number(m[2]);
      return (isFinite(a) && isFinite(b)) ? (a + b) : NaN;
    }
    
    var raw = {};  // { LEAGUE: { Q1: [totals], Q2: [...], ... } }
    
    for (var r = 1; r < Math.min(data.length, 50000); r++) {
      var row = data[r];
      
      // Skip non-finished games
      if (cStatus !== undefined) {
        var status = String(row[cStatus] || '').toUpperCase();
        if (status && status !== 'FT' && status !== 'FINAL' && status !== 'COMPLETED') continue;
      }
      
      var lg = cLeague !== undefined ? leagueKey(row[cLeague]) : 'DEFAULT';
      if (!lg) lg = 'DEFAULT';
      
      if (!raw[lg]) raw[lg] = { Q1: [], Q2: [], Q3: [], Q4: [] };
      
      var q1 = cQ1 !== undefined ? parseQuarterTotal(row[cQ1]) : NaN;
      var q2 = cQ2 !== undefined ? parseQuarterTotal(row[cQ2]) : NaN;
      var q3 = cQ3 !== undefined ? parseQuarterTotal(row[cQ3]) : NaN;
      var q4 = cQ4 !== undefined ? parseQuarterTotal(row[cQ4]) : NaN;
      
      if (isFinite(q1)) raw[lg].Q1.push(q1);
      if (isFinite(q2)) raw[lg].Q2.push(q2);
      if (isFinite(q3)) raw[lg].Q3.push(q3);
      if (isFinite(q4)) raw[lg].Q4.push(q4);
    }
    
    // Convert to profile structure
    Object.keys(raw).forEach(function(lg) {
      result.byLeague[lg] = {};
      QUARTER_KEYS.forEach(function(Q) {
        var arr = raw[lg][Q] || [];
        var mu = mean(arr);
        var sd = stdDev(arr);
        result.byLeague[lg][Q] = {
          mean: isFinite(mu) ? mu : DEFAULT_QUARTER.mean,
          sd: (isFinite(sd) && sd > 0) ? sd : DEFAULT_QUARTER.sd,
          overPct: 50,
          underPct: 50,
          count: arr.length
        };
      });
    });
    
    result.ok = Object.keys(result.byLeague).length > 0;
    log(fn, 'Derived ' + Object.keys(result.byLeague).length + ' leagues from Clean');
    cache.derivedOU = result;
    return result;
  }
  
  /**
   * Get league profile with fallback chain
   */
  function getLeagueProfile(ss, league) {
    var lg = leagueKey(league);
    
    // Try primary source
    var primary = loadLeagueOU(ss);
    if (primary.ok && primary.byLeague[lg]) {
      var p = primary.byLeague[lg];
      var out = {};
      QUARTER_KEYS.forEach(function(Q) {
        var cell = p[Q] || {};
        out[Q] = {
          mean: isFinite(cell.mean) ? cell.mean : DEFAULT_QUARTER.mean,
          sd: (isFinite(cell.sd) && cell.sd > 0) ? cell.sd : DEFAULT_QUARTER.sd,
          overPct: isFinite(cell.overPct) ? cell.overPct : 50,
          underPct: isFinite(cell.underPct) ? cell.underPct : 50,
          count: cell.count || 0
        };
      });
      out._source = 'LeagueQuarterO_U_Stats';
      return out;
    }
    
    // Try derived fallback
    var derived = derivedLeagueOU(ss);
    if (derived.ok && derived.byLeague[lg]) {
      var d = derived.byLeague[lg];
      var out2 = {};
      QUARTER_KEYS.forEach(function(Q) {
        var cell = d[Q] || {};
        out2[Q] = {
          mean: isFinite(cell.mean) ? cell.mean : DEFAULT_QUARTER.mean,
          sd: (isFinite(cell.sd) && cell.sd > 0) ? cell.sd : DEFAULT_QUARTER.sd,
          overPct: 50,
          underPct: 50,
          count: cell.count || 0
        };
      });
      out2._source = 'Clean-derived';
      return out2;
    }
    
    // Return defaults
    var fb = {};
    QUARTER_KEYS.forEach(function(Q) {
      fb[Q] = Object.assign({}, DEFAULT_QUARTER);
    });
    fb._source = 'defaults';
    return fb;
  }
  
  /**
 * ═══════════════════════════════════════════════════════════════════════════
 * loadH2H — PATCHED (Fix 2B)
 * ═══════════════════════════════════════════════════════════════════════════
 * Fix 2B: Preserves raw quarter arrays as .values and adds .recentAvg
 *         (mean of most-recent 4 entries) alongside existing {avg, sd, count}.
 *         Old consumers reading .avg/.sd/.count are unaffected.
 *         New consumers can use .recentAvg for recency-weighted H2H and
 *         .values for custom analysis.
 */
 function loadH2H(ss) {
   var fn = 'loadH2H';
   var cache = ensureCache(ss);
   if (cache.h2h) return cache.h2h;

   var result = { ok: false, byMatchup: {} };
   var sheets = ss.getSheets();
   var loaded = 0;

   for (var si = 0; si < sheets.length; si++) {
     var name = sheets[si].getName();
     if (!/^cleanh2h[_\-]?\d+$/i.test(name)) continue;

     var data = sheets[si].getDataRange().getValues();
     if (!data || data.length < 2) continue;

     var h = buildHeaderMap(data[0]);
     var cHome = findColumn(h, ['home', 'hometeam', 'home_team', 'team1']);
     var cAway = findColumn(h, ['away', 'awayteam', 'away_team', 'team2']);

     var cQ1H = findColumn(h, ['q1h', 'q1_h', 'q1home', 'quarter1home', '1qh']);
     var cQ1A = findColumn(h, ['q1a', 'q1_a', 'q1away', 'quarter1away', '1qa']);
     var cQ2H = findColumn(h, ['q2h', 'q2_h', 'q2home', 'quarter2home', '2qh']);
     var cQ2A = findColumn(h, ['q2a', 'q2_a', 'q2away', 'quarter2away', '2qa']);
     var cQ3H = findColumn(h, ['q3h', 'q3_h', 'q3home', 'quarter3home', '3qh']);
     var cQ3A = findColumn(h, ['q3a', 'q3_a', 'q3away', 'quarter3away', '3qa']);
     var cQ4H = findColumn(h, ['q4h', 'q4_h', 'q4home', 'quarter4home', '4qh']);
     var cQ4A = findColumn(h, ['q4a', 'q4_a', 'q4away', 'quarter4away', '4qa']);

     if (cHome === undefined || cAway === undefined) {
       log(fn, name + ': missing Home/Away columns');
       continue;
     }

     var qCols = [cQ1H, cQ1A, cQ2H, cQ2A, cQ3H, cQ3A, cQ4H, cQ4A];
     if (qCols.some(function(c) { return c === undefined; })) {
       log(fn, name + ': missing some quarter columns');
       continue;
     }

     for (var r = 1; r < data.length; r++) {
       var row = data[r];
       var home = String(row[cHome] || '').trim();
       var away = String(row[cAway] || '').trim();
       var key = matchupKey(home, away);

       if (!key) continue;

       if (!result.byMatchup[key]) {
         result.byMatchup[key] = { Q1: [], Q2: [], Q3: [], Q4: [] };
       }

       var q1 = toNum(row[cQ1H], NaN) + toNum(row[cQ1A], NaN);
       var q2 = toNum(row[cQ2H], NaN) + toNum(row[cQ2A], NaN);
       var q3 = toNum(row[cQ3H], NaN) + toNum(row[cQ3A], NaN);
       var q4 = toNum(row[cQ4H], NaN) + toNum(row[cQ4A], NaN);

       if (isFinite(q1)) result.byMatchup[key].Q1.push(q1);
       if (isFinite(q2)) result.byMatchup[key].Q2.push(q2);
       if (isFinite(q3)) result.byMatchup[key].Q3.push(q3);
       if (isFinite(q4)) result.byMatchup[key].Q4.push(q4);

       loaded++;
     }
   }

   // FIX 2B — convert arrays to stats, preserve raw arrays, add recentAvg
   Object.keys(result.byMatchup).forEach(function(key) {
     var m = result.byMatchup[key];
     QUARTER_KEYS.forEach(function(Q) {
       var arr = m[Q] || [];

       // Most-recent entries (assumes array is ordered most-recent first from sheet)
       var recentN = Math.min(4, arr.length);
       var recentAvg = recentN > 0 ? mean(arr.slice(0, recentN)) : NaN;

       m[Q] = {
         // Existing fields (unchanged for old consumers)
         avg: mean(arr),
         sd: stdDev(arr),
         count: arr.length,

         // New additive fields
         recentAvg: isFinite(recentAvg) ? recentAvg : NaN,
         recentCount: recentN,
         values: arr.slice(0)   // defensive copy of raw values
       };
     });
   });

   result.ok = loaded > 0;
   log(fn, 'Loaded ' + loaded + ' H2H games, ' + Object.keys(result.byMatchup).length + ' matchups');
   cache.h2h = result;
   return result;
 }
  
  /**
   * Get H2H stats for a matchup
   */
  function getH2HStats(ss, home, away) {
    var h2h = loadH2H(ss);
    if (!h2h.ok) return null;
    
    var key = matchupKey(home, away);
    return key ? (h2h.byMatchup[key] || null) : null;
  }
  

  
 function loadRecent(ss, configOrN) {
   var fn = 'loadRecent';
   var cache = ensureCache(ss);

   // FIX 2A — cache returns SAME shape (never { ok, home, away })
   if (cache.recent) return cache.recent;
   // Legacy cache keys: if both point to same byTeam-shaped object, use it
   if (cache.recentHome && cache.recentHome.byTeam) return cache.recentHome;
   if (cache.recentAway && cache.recentAway.byTeam) return cache.recentAway;

   var result = {
     ok: false,
     byTeam: {}
   };

   var sheets = ss.getSheets();
   var loaded = 0;

   function ensureTeam(team, venue) {
     var key = teamKey(team);
     if (!result.byTeam[key]) {
       result.byTeam[key] = {
         Home: { games: [], Q1: { scored: [], allowed: [] }, Q2: { scored: [], allowed: [] }, Q3: { scored: [], allowed: [] }, Q4: { scored: [], allowed: [] } },
         Away: { games: [], Q1: { scored: [], allowed: [] }, Q2: { scored: [], allowed: [] }, Q3: { scored: [], allowed: [] }, Q4: { scored: [], allowed: [] } }
       };
     }
     return result.byTeam[key][venue];
   }

   for (var si = 0; si < sheets.length; si++) {
     var name = sheets[si].getName();
     var isHomeSheet = /^cleanrecenthome[_\-]?\d+$/i.test(name);
     var isAwaySheet = /^cleanrecentaway[_\-]?\d+$/i.test(name);

     if (!isHomeSheet && !isAwaySheet) continue;

     var data = sheets[si].getDataRange().getValues();
     if (!data || data.length < 2) continue;

     var h = buildHeaderMap(data[0]);
     var cHome = findColumn(h, ['home', 'hometeam', 'home_team']);
     var cAway = findColumn(h, ['away', 'awayteam', 'away_team']);

     var cQ1H = findColumn(h, ['q1h', 'q1_h', 'q1home']);
     var cQ1A = findColumn(h, ['q1a', 'q1_a', 'q1away']);
     var cQ2H = findColumn(h, ['q2h', 'q2_h', 'q2home']);
     var cQ2A = findColumn(h, ['q2a', 'q2_a', 'q2away']);
     var cQ3H = findColumn(h, ['q3h', 'q3_h', 'q3home']);
     var cQ3A = findColumn(h, ['q3a', 'q3_a', 'q3away']);
     var cQ4H = findColumn(h, ['q4h', 'q4_h', 'q4home']);
     var cQ4A = findColumn(h, ['q4a', 'q4_a', 'q4away']);

     if (cHome === undefined || cAway === undefined) continue;

     for (var r = 1; r < data.length; r++) {
       var row = data[r];
       var homeTeam = String(row[cHome] || '').trim();
       var awayTeam = String(row[cAway] || '').trim();

       if (!homeTeam || !awayTeam) continue;

       var q1h = toNum(row[cQ1H], NaN), q1a = toNum(row[cQ1A], NaN);
       var q2h = toNum(row[cQ2H], NaN), q2a = toNum(row[cQ2A], NaN);
       var q3h = toNum(row[cQ3H], NaN), q3a = toNum(row[cQ3A], NaN);
       var q4h = toNum(row[cQ4H], NaN), q4a = toNum(row[cQ4A], NaN);

       if (isHomeSheet) {
         var bucket = ensureTeam(homeTeam, 'Home');
         if (isFinite(q1h)) bucket.Q1.scored.push(q1h);
         if (isFinite(q1a)) bucket.Q1.allowed.push(q1a);
         if (isFinite(q2h)) bucket.Q2.scored.push(q2h);
         if (isFinite(q2a)) bucket.Q2.allowed.push(q2a);
         if (isFinite(q3h)) bucket.Q3.scored.push(q3h);
         if (isFinite(q3a)) bucket.Q3.allowed.push(q3a);
         if (isFinite(q4h)) bucket.Q4.scored.push(q4h);
         if (isFinite(q4a)) bucket.Q4.allowed.push(q4a);
       } else {
         var bucket = ensureTeam(awayTeam, 'Away');
         if (isFinite(q1a)) bucket.Q1.scored.push(q1a);
         if (isFinite(q1h)) bucket.Q1.allowed.push(q1h);
         if (isFinite(q2a)) bucket.Q2.scored.push(q2a);
         if (isFinite(q2h)) bucket.Q2.allowed.push(q2h);
         if (isFinite(q3a)) bucket.Q3.scored.push(q3a);
         if (isFinite(q3h)) bucket.Q3.allowed.push(q3h);
         if (isFinite(q4a)) bucket.Q4.scored.push(q4a);
         if (isFinite(q4h)) bucket.Q4.allowed.push(q4h);
       }

       loaded++;
     }
   }

   // FIX 2C — parameterized trend lookback
   function pickLookbackN_() {
     var n = NaN;

     if (typeof configOrN === 'number') {
       n = configOrN;
     } else if (configOrN && typeof configOrN === 'object') {
       n = Number(configOrN.recent_games_min || configOrN.recentGamesMin || configOrN.lookbackN);
     }

     if (!isFinite(n) && typeof getEliteDefaults_ === 'function') {
       try {
         var d = getEliteDefaults_() || {};
         n = Number(d.recent_games_min || d.recentGamesMin);
       } catch (e) {}
     }

     if (!isFinite(n) || n <= 0) n = 5;
     n = Math.round(n);
     n = Math.max(2, Math.min(20, n));
     return n;
   }

   function trendForN_(scoredArr, n) {
     if (!scoredArr || !scoredArr.length) return 0;
     if (scoredArr.length < (n + 1)) return 0;

     var recent = mean(scoredArr.slice(0, n));
     var prev = mean(scoredArr.slice(n, 2 * n));
     return isFinite(prev) && prev > 0 ? clamp((recent - prev) / prev, -0.20, 0.20) : 0;
   }

   var lookbackN = pickLookbackN_();

   // Compute averages and trends
   Object.keys(result.byTeam).forEach(function(team) {
     ['Home', 'Away'].forEach(function(venue) {
       var t = result.byTeam[team][venue];
       t.avgScored = {};
       t.avgAllowed = {};
       t.count = {};

       // Legacy: t.trend[Q] (always 5/5)
       t.trend = {};
       // Explicit legacy alias
       t.trend5 = {};
       // Multiple lookbacks
       t.trendByN = {};
       // Configured lookback alias
       t.trendN = {};
       t._trendN = lookbackN;

       // Precompute a set of useful lookbacks (plus configured N)
       var ns = { 3: true, 4: true, 5: true, 6: true, 8: true, 10: true };
       ns[lookbackN] = true;

       Object.keys(ns).forEach(function(nk) {
         t.trendByN[nk] = {};
       });

       QUARTER_KEYS.forEach(function(Q) {
         var scoredArr = t[Q].scored || [];
         var allowedArr = t[Q].allowed || [];

         t.avgScored[Q] = mean(scoredArr);
         t.avgAllowed[Q] = mean(allowedArr);
         t.count[Q] = scoredArr.length;

         // Legacy trend (5/5)
         var tr5 = trendForN_(scoredArr, 5);
         t.trend[Q] = tr5;
         t.trend5[Q] = tr5;

         // trendByN for all precomputed lookbacks
         Object.keys(ns).forEach(function(nk) {
           var n = Number(nk);
           t.trendByN[nk][Q] = (n === 5) ? tr5 : trendForN_(scoredArr, n);
         });

         // Configured lookback alias
         t.trendN[Q] = t.trendByN[String(lookbackN)][Q];
       });
     });
   });

   result.ok = loaded > 0;
   log(fn, 'Loaded ' + loaded + ' recent games, ' + Object.keys(result.byTeam).length + ' teams');

   // FIX 2A — store canonical object; all cache keys point to same shape
   cache.recent = result;
   cache.recentHome = result;
   cache.recentAway = result;

   return result;
 }
  
/**
 * Robust recent stats fetch.
 * - Tries your existing teamKey(team) first (so you keep compatibility)
 * - Falls back to canonical key
 * - Falls back to scan (case-insensitive) if still not found
 */
function getRecentStats(ss, team, venue) {
  var recent = loadRecent(ss);
  if (!recent || !recent.ok) return null;

  var byTeam = recent.byTeam || {};

  // Primary (existing behavior)
  var primaryKey = null;
  try { primaryKey = teamKey(team); } catch (e) { primaryKey = null; }

  if (primaryKey && byTeam[primaryKey]) return byTeam[primaryKey][venue] || null;

  // Canonical fallback
  var canon = _t2_teamKeyCanonical_(team);
  if (canon && byTeam[canon]) return byTeam[canon][venue] || null;

  // Last resort: scan keys (handles unexpected key formats)
  var targetLower = _t2_toStr_(team).toLowerCase().trim();
  var keys = Object.keys(byTeam);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (String(k).toLowerCase().trim() === targetLower) {
      return byTeam[k][venue] || null;
    }
  }

  return null;
}
  
  /**
   * Load LeagueQuarterStats (team quarter win%)
   */
  function loadTeamQuarterWin(ss) {
    var fn = 'loadTeamQuarterWin';
    var cache = ensureCache(ss);
    if (cache.teamWin) return cache.teamWin;
    
    var result = { ok: false, byTeam: {} };
    var sh = getSheet(ss, 'LeagueQuarterStats');
    
    if (!sh) {
      cache.teamWin = result;
      return result;
    }
    
    var data = sh.getDataRange().getValues();
    if (!data || data.length < 2) {
      cache.teamWin = result;
      return result;
    }
    
    var h = buildHeaderMap(data[0]);
    var cTeam = findColumn(h, ['team', 'teamname', 'team_name']);
    var cQuarter = findColumn(h, ['quarter', 'period', 'q']);
    var cWinPct = findColumn(h, ['win%', 'winpct', 'winpercent', 'win']);
    var cTotal = findColumn(h, ['total', 'games', 'count', 'n']);
    
    if (cTeam === undefined || cQuarter === undefined) {
      cache.teamWin = result;
      return result;
    }
    
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var team = teamKey(row[cTeam]);
      var q = quarterKey(row[cQuarter]);
      
      if (!team || !q) continue;
      
      var wp = toNum(row[cWinPct], NaN);
      if (isFinite(wp) && wp > 1.5) wp = wp / 100;  // Handle 68 -> 0.68
      if (!isFinite(wp)) wp = 0.5;
      
      var total = toNum(row[cTotal], 0);
      
      if (!result.byTeam[team]) result.byTeam[team] = {};
      result.byTeam[team][q] = { winPct: clamp(wp, 0, 1), count: total };
    }
    
    result.ok = Object.keys(result.byTeam).length > 0;
    cache.teamWin = result;
    return result;
  }
  
  // =====================
  // SIGNATURE-PRESERVED FACTOR FUNCTIONS
  // =====================
  /**
 * ═══════════════════════════════════════════════════════════════════════════
 * [NEW SIGNAL 5A] _getTeamWinFactor
 * File: Module 9 (Enhancements / Elite module — inside IIFE)
 * ═══════════════════════════════════════════════════════════════════════════
 * Computes a quarter-level win-rate differential signal (home − away).
 * No new sheet reads — operates entirely on in-memory recent data from ctx.
 *
 * Data resolution priority:
 *   1. Raw per-game arrays: margin[] (positive = quarter win)
 *   2. Raw per-game arrays: scored[] + allowed[] (compared pairwise)
 *   3. Summary averages:    avgScored[Q] vs avgAllowed/avgAgainst/avgConceded[Q]
 *      (logistic mapping to win probability, conservatively clamped)
 *
 * Shape detection covers all known recent-data containers:
 *   recentObj[Q], recentObj.byQuarter[Q], recentObj.raw[Q],
 *   recentObj.recentClean[Q], recentObj.clean[Q]
 *
 * Stability features:
 *   - Non-finite values in arrays are skipped (not coerced to 0)
 *   - Ties (margin=0 or scored=allowed) receive half-credit
 *   - Bayesian shrinkage toward 0.5 via n/(n+k), consistent with codebase
 *   - Results cached to ctx._hq.teamWinFactor[Q] for diagnostics
 *
 * Signature (matches helper convention):
 *   _getTeamWinFactor(q, home, away, stats, ctx)
 * Returns factor in [-0.15, 0.15].
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _getTeamWinFactor(q, home, away, stats, ctx) {
  var Q = quarterKey(q);
  if (!Q || !ctx) return 0;

  // ─── Local safe helpers ────────────────────────────────────────────────
  function clamp_(x, lo, hi) {
    x = Number(x);
    if (!isFinite(x)) x = 0;
    return Math.max(lo, Math.min(hi, x));
  }

  function isNum_(v) {
    return isFinite(Number(v));
  }

  // ─── Shape detection: find quarter node from recentObj ─────────────────
  // Supports all known recent-data container shapes across the codebase.
  function getQNode_(recentObj, qKey) {
    if (!recentObj || typeof recentObj !== 'object') return null;
    // Direct: recentObj.Q1
    if (recentObj[qKey] && typeof recentObj[qKey] === 'object') {
      return recentObj[qKey];
    }
    // byQuarter container
    if (recentObj.byQuarter && recentObj.byQuarter[qKey] &&
        typeof recentObj.byQuarter[qKey] === 'object') {
      return recentObj.byQuarter[qKey];
    }
    // raw container
    if (recentObj.raw && recentObj.raw[qKey] &&
        typeof recentObj.raw[qKey] === 'object') {
      return recentObj.raw[qKey];
    }
    // recentClean container
    if (recentObj.recentClean && recentObj.recentClean[qKey] &&
        typeof recentObj.recentClean[qKey] === 'object') {
      return recentObj.recentClean[qKey];
    }
    // clean container
    if (recentObj.clean && recentObj.clean[qKey] &&
        typeof recentObj.clean[qKey] === 'object') {
      return recentObj.clean[qKey];
    }
    return null;
  }

  // ─── Win rate from raw per-game arrays ─────────────────────────────────
  // Priority: margin[] (most direct) > scored[]+allowed[] (pairwise compare)
  // Ties receive half-credit. Non-finite rows are skipped entirely.
  function winRateFromArrays_(node) {
    if (!node || typeof node !== 'object') return null;

    // Path A: margin[] array (positive = quarter win for this team)
    if (Array.isArray(node.margin) && node.margin.length > 0) {
      var nM = 0, winsM = 0;
      for (var i = 0; i < node.margin.length; i++) {
        var d = Number(node.margin[i]);
        if (!isFinite(d)) continue;            // skip invalid
        nM++;
        if (d > 0) winsM += 1;
        else if (d === 0) winsM += 0.5;        // tie = half-credit
      }
      if (nM > 0) return { rate: winsM / nM, n: nM };
    }

    // Path B: scored[] + allowed[] arrays (pairwise)
    var scored  = Array.isArray(node.scored)  ? node.scored  : null;
    var allowed = Array.isArray(node.allowed) ? node.allowed : null;
    if (scored && allowed) {
      var len = Math.min(scored.length, allowed.length);
      var nSA = 0, winsSA = 0;
      for (var j = 0; j < len; j++) {
        var s = Number(scored[j]);
        var a = Number(allowed[j]);
        if (!isFinite(s) || !isFinite(a)) continue;  // skip invalid pairs
        nSA++;
        if (s > a) winsSA += 1;
        else if (s === a) winsSA += 0.5;              // tie = half-credit
      }
      if (nSA > 0) return { rate: winsSA / nSA, n: nSA };
    }

    return null;   // no usable arrays found
  }

  // ─── Fallback: approximate win rate from summary averages ──────────────
  // When raw arrays are unavailable, maps avgScored − avgAllowed through a
  // logistic function for a soft, bounded probability estimate.
  // Conservative clamp to [0.25, 0.75] — averages lack game-level resolution
  // so we prevent extreme signals from this path.
  function approxWinRateFromAverages_(recentObj, qKey) {
    if (!recentObj || typeof recentObj !== 'object') return null;

    var sc = (recentObj.avgScored && isNum_(recentObj.avgScored[qKey]))
      ? Number(recentObj.avgScored[qKey]) : NaN;

    // Try all known allowed-key variants
    var al = NaN;
    if (recentObj.avgAllowed && isNum_(recentObj.avgAllowed[qKey])) {
      al = Number(recentObj.avgAllowed[qKey]);
    } else if (recentObj.avgAgainst && isNum_(recentObj.avgAgainst[qKey])) {
      al = Number(recentObj.avgAgainst[qKey]);
    } else if (recentObj.avgConceded && isNum_(recentObj.avgConceded[qKey])) {
      al = Number(recentObj.avgConceded[qKey]);
    }

    if (!isFinite(sc) || !isFinite(al)) return null;

    var n = (recentObj.count && isNum_(recentObj.count[qKey]))
      ? Math.max(0, Number(recentObj.count[qKey])) : 0;

    // Logistic mapping: scale ~5 pts keeps quarter-level diffs conservative
    // At ±5 pts diff → ~73%/27% win probability (before clamp)
    var diffPts = sc - al;
    var scale = 5;
    var p = 1 / (1 + Math.exp(-diffPts / Math.max(1, scale)));

    // Conservative bounds — averages lack game-level resolution
    p = clamp_(p, 0.25, 0.75);

    return { rate: p, n: n };
  }

  // ─── Unified win-rate resolver per team ────────────────────────────────
  function getQWinRate_(recentObj, qKey) {
    // Try raw arrays first (more accurate, game-level granularity)
    var node = getQNode_(recentObj, qKey);
    var fromArrays = winRateFromArrays_(node);
    if (fromArrays && fromArrays.n > 0) return fromArrays;

    // Fallback to averages (summary-level, less precise)
    var fromAvg = approxWinRateFromAverages_(recentObj, qKey);
    if (fromAvg) return fromAvg;

    // No data at all — neutral
    return { rate: 0.5, n: 0 };
  }

  // ─── Compute raw win rates ─────────────────────────────────────────────
  var h = getQWinRate_(ctx.homeRecent, Q);
  var a = getQWinRate_(ctx.awayRecent, Q);

  // ─── Bayesian shrinkage toward 0.5 ────────────────────────────────────
  // Consistent with codebase n/(n+k) pattern used in _getQuarterBaseScore.
  // Small samples stay close to neutral 0.5; large samples trust observed rate.
  var kWin = (ctx && isNum_(ctx.shrinkK) && Number(ctx.shrinkK) > 0)
    ? Number(ctx.shrinkK) : 8;
  kWin = clamp_(kWin, 4, 16);

  var hRel = (h.n > 0) ? (h.n / (h.n + kWin)) : 0;
  var aRel = (a.n > 0) ? (a.n / (a.n + kWin)) : 0;

  var hRate = 0.5 + (h.rate - 0.5) * hRel;
  var aRate = 0.5 + (a.rate - 0.5) * aRel;

  // ─── Differential → factor ────────────────────────────────────────────
  // Positive = home team wins quarters more often than away team.
  // Scale: 20% win-rate diff → ~0.05 factor (small, additive signal
  // weighted by teamWinWeight default 0.10 in the orchestrator).
  var diff = hRate - aRate;
  var factor = clamp_(diff * 0.25, -0.15, 0.15);

  // ─── Cache to ctx._hq for diagnostics ─────────────────────────────────
  try {
    if (ctx && typeof ctx === 'object') {
      if (!ctx._hq || typeof ctx._hq !== 'object') ctx._hq = {};
      if (!ctx._hq.teamWinFactor || typeof ctx._hq.teamWinFactor !== 'object') {
        ctx._hq.teamWinFactor = {};
      }
      ctx._hq.teamWinFactor[Q] = {
        factor:  Math.round(factor * 10000) / 10000,
        hRate:   Math.round(hRate * 1000) / 1000,
        aRate:   Math.round(aRate * 1000) / 1000,
        hRawRate: Math.round(h.rate * 1000) / 1000,
        aRawRate: Math.round(a.rate * 1000) / 1000,
        hN:      h.n,
        aN:      a.n,
        kWin:    kWin
      };
    }
  } catch (e) {}

  return factor;
}


function _getQuarterBaseScore(q, home, away, stats, ctx) {
  var fn = 'getQuarterBaseScore';
  var Q = quarterKey(q);
  if (!Q) return 52;

  // ─── Local safe helpers ────────────────────────────────────────────────
  function log_(msg) {
    if (typeof log === 'function') return log(fn, msg);
    try { Logger.log('[' + fn + '] ' + msg); } catch (e) {}
  }
  function clamp_(x, lo, hi) {
    if (typeof clamp === 'function') return clamp(x, lo, hi);
    x = Number(x);
    if (!isFinite(x)) x = (lo + hi) / 2;
    return Math.max(lo, Math.min(hi, x));
  }
  function round_(x, n) {
    if (typeof round === 'function') return round(x, n);
    var p = Math.pow(10, n || 0);
    x = Number(x);
    return isFinite(x) ? Math.round(x * p) / p : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // R4-PATCH5 / FIX 4A: O/U → HQ cross-leverage
  // If O/U already computed a per-quarter prediction for this game
  // (Patch 2 wrote it, Patch 4 bridged it, Patch 6 injected it into ctx),
  // prefer that mu as the base score. Short-circuits without needing
  // spreadsheet access — pure in-memory handoff.
  //
  // Falls through to legacy computation if:
  //   - ctx.ouPredictions doesn't exist (O/U didn't run, or standalone call)
  //   - ouPredictions[Q] is missing (model returned null for this quarter)
  //   - mu is not a valid positive number
  // ═══════════════════════════════════════════════════════════════════════
  try {
    if (ctx && ctx.ouPredictions && ctx.ouPredictions[Q]) {
      var ouPred = ctx.ouPredictions[Q];
      var ouMu = Number(ouPred.mu);
      var ouSigma = Number(ouPred.sigma);

      if (isFinite(ouMu) && ouMu > 0) {
        // Stash sigma + source marker for HQ confidence layer
        // (Patch 6+ can read ctx._hq.baseSigmaByQ[Q] to inform volatility)
        if (ctx && typeof ctx === 'object') {
          if (!ctx._hq || typeof ctx._hq !== 'object') ctx._hq = {};
          if (!ctx._hq.baseSourceByQ || typeof ctx._hq.baseSourceByQ !== 'object') {
            ctx._hq.baseSourceByQ = {};
          }
          if (!ctx._hq.baseSigmaByQ || typeof ctx._hq.baseSigmaByQ !== 'object') {
            ctx._hq.baseSigmaByQ = {};
          }

          ctx._hq.baseSourceByQ[Q] = 'OU';
          if (isFinite(ouSigma) && ouSigma > 0) {
            ctx._hq.baseSigmaByQ[Q] = ouSigma;
          }
        }

        var baseFromOU = clamp_(ouMu, 5, 150);

        log_(Q + ' base=' + round_(baseFromOU, 1) +
             ' (source=OU' +
             ', sigma=' + (isFinite(ouSigma) && ouSigma > 0 ? round_(ouSigma, 1) : 'N/A') +
             ')');

        return isFinite(baseFromOU) ? baseFromOU : 52;
      }
    }
  } catch (eOU) {
    // If ctx shape is unexpected, fall through to legacy computation silently.
    // This ensures Patch 5 never breaks HQ even with malformed ctx data.
  }

  // ─── LEGACY PATH (unchanged from R3) ──────────────────────────────────
  // Reached when O/U predictions are not available for this quarter.

  // ─── Spreadsheet (prefer ctx) ──────────────────────────────────────────
  var ss = (ctx && ctx.ss) ? ctx.ss : null;
  if (!ss && typeof getSpreadsheet === 'function') {
    try { ss = getSpreadsheet(null); } catch (e0) {}
  }
  if (!ss) return 52;

  // ─── League + profile (prefer ctx) ─────────────────────────────────────
  var league = (ctx && ctx.league)
    ? ctx.league
    : ((stats && stats._elite && stats._elite.league) ? stats._elite.league : 'UNKNOWN');

  var prof = (ctx && ctx.prof) ? ctx.prof : null;
  if (!prof && typeof getLeagueProfile === 'function') {
    try { prof = getLeagueProfile(ss, league); } catch (e1) {}
  }

  var leagueMean = (prof && prof[Q] && isFinite(prof[Q].mean)) ? Number(prof[Q].mean) : 52;
  if (!isFinite(leagueMean) || leagueMean <= 0) leagueMean = 52;
  var leagueHalf = leagueMean / 2;

  // ─── Shrinkage k (ctx → getEliteDefaults_ → hard fallback 8) ──────────
  var k = (ctx && isFinite(ctx.shrinkK) && ctx.shrinkK > 0) ? Number(ctx.shrinkK) : NaN;
  if (!isFinite(k) || k <= 0) {
    // Defensive: standalone calls may not have ctx.shrinkK
    if (typeof getEliteDefaults_ === 'function') {
      try {
        var d = getEliteDefaults_() || {};
        k = Number(d.margin_shrink_k);
      } catch (e2) {}
    }
  }
  if (!isFinite(k) || k <= 0) k = 8;

  // ─── Recent stats (prefer ctx — orchestrator handled cache fallback) ──
  var homeRecent = (ctx && ctx.homeRecent) ? ctx.homeRecent : null;
  var awayRecent = (ctx && ctx.awayRecent) ? ctx.awayRecent : null;

  if (!homeRecent && typeof getRecentStats === 'function') {
    try { homeRecent = getRecentStats(ss, home, 'Home'); } catch (e3) {}
  }
  if (!awayRecent && typeof getRecentStats === 'function') {
    try { awayRecent = getRecentStats(ss, away, 'Away'); } catch (e4) {}
  }

  var hSc = (homeRecent && homeRecent.avgScored && isFinite(homeRecent.avgScored[Q]))
    ? Number(homeRecent.avgScored[Q]) : NaN;
  var aSc = (awayRecent && awayRecent.avgScored && isFinite(awayRecent.avgScored[Q]))
    ? Number(awayRecent.avgScored[Q]) : NaN;

  var hN = (homeRecent && homeRecent.count && isFinite(homeRecent.count[Q]))
    ? Math.max(0, Number(homeRecent.count[Q])) : 0;
  var aN = (awayRecent && awayRecent.count && isFinite(awayRecent.count[Q]))
    ? Math.max(0, Number(awayRecent.count[Q])) : 0;

  // ─── Bayesian shrinkage per team toward leagueHalf ─────────────────────
  var hMu = isFinite(hSc)
    ? (hSc * (hN / (hN + k)) + leagueHalf * (k / (hN + k)))
    : leagueHalf;

  var aMu = isFinite(aSc)
    ? (aSc * (aN / (aN + k)) + leagueHalf * (k / (aN + k)))
    : leagueHalf;

  var teamMu = hMu + aMu;

  // ─── H2H shrinkage toward teamMu (prefer ctx.h2hStats) ────────────────
  var h2hStats = (ctx && ctx.h2hStats) ? ctx.h2hStats : null;
  if (!h2hStats && typeof getH2HStats === 'function') {
    try { h2hStats = getH2HStats(ss, home, away); } catch (e5) {}
  }

  var h2hMean = (h2hStats && h2hStats[Q] && isFinite(h2hStats[Q].avg))
    ? Number(h2hStats[Q].avg) : NaN;
  var h2hN = (h2hStats && h2hStats[Q] && isFinite(h2hStats[Q].count))
    ? Math.max(0, Number(h2hStats[Q].count)) : 0;

  // H2H shrinks toward teamMu with slightly harder-to-move k
  var base = teamMu;
  if (isFinite(h2hMean) && h2hN > 0) {
    var kH2H = clamp_(k, 6, 16);
    base = h2hMean * (h2hN / (h2hN + kH2H)) + teamMu * (kH2H / (h2hN + kH2H));
  }

  // Sanity bounds
  base = clamp_(base, 5, 150);

  log_(Q + ' base=' + round_(base, 1) +
       ' (lg=' + round_(leagueMean, 1) +
       ' team=' + round_(teamMu, 1) +
       ' [h=' + round_(hMu, 1) + ',a=' + round_(aMu, 1) +
       ',k=' + round_(k, 1) + ',n=' + hN + '/' + aN + ']' +
       ' h2h=' + (isFinite(h2hMean) ? round_(h2hMean, 1) : 'N/A') +
       ' nH2H=' + h2hN + ')');

  return isFinite(base) ? base : 52;
}



 function _getRecentQuarterTrend(q, home, away, stats, games, ctx) {
   var fn = 'getRecentQuarterTrend';
   var Q = quarterKey(q);
   if (!Q) return 0;

   // ─── Local safe helpers ────────────────────────────────────────────────
   function log_(msg) {
     if (typeof log === 'function') return log(fn, msg);
     try { Logger.log('[' + fn + '] ' + msg); } catch (e) {}
   }
   function clamp_(x, lo, hi) {
     if (typeof clamp === 'function') return clamp(x, lo, hi);
     x = Number(x);
     if (!isFinite(x)) x = 0;
     return Math.max(lo, Math.min(hi, x));
   }
   function round_(x, n) {
     if (typeof round === 'function') return round(x, n);
     var p = Math.pow(10, n || 0);
     x = Number(x);
     return isFinite(x) ? Math.round(x * p) / p : 0;
   }

   // ─── Spreadsheet (prefer ctx) ──────────────────────────────────────────
   var ss = (ctx && ctx.ss) ? ctx.ss : null;
   if (!ss && typeof getSpreadsheet === 'function') {
     try { ss = getSpreadsheet(null); } catch (e0) {}
   }
   if (!ss) return 0;

   // ─── Recent stats (prefer ctx) ─────────────────────────────────────────
   var homeRecent = (ctx && ctx.homeRecent) ? ctx.homeRecent : null;
   var awayRecent = (ctx && ctx.awayRecent) ? ctx.awayRecent : null;

   if (!homeRecent && typeof getRecentStats === 'function') {
     try { homeRecent = getRecentStats(ss, home, 'Home'); } catch (e1) {}
   }
   if (!awayRecent && typeof getRecentStats === 'function') {
     try { awayRecent = getRecentStats(ss, away, 'Away'); } catch (e2) {}
   }

   // ─── Normalize lookback N ──────────────────────────────────────────────
   var n = Number(games);
   if (!isFinite(n) || n <= 0) n = 5;
   n = Math.max(2, Math.min(20, Math.round(n)));

   // ─── Extract trend for a given lookback from recent object ─────────────
   function trendFor_(recentObj) {
     if (!recentObj) return 0;

     // 1) Preferred: per-lookback map from patched loadRecent (Fix 2C)
     if (recentObj.trendByN &&
         recentObj.trendByN[String(n)] &&
         isFinite(recentObj.trendByN[String(n)][Q])) {
       return recentObj.trendByN[String(n)][Q];
     }

     // 2) Configured lookback alias (if loader's configured N matches request)
     if (recentObj.trendN &&
         Number(recentObj._trendN) === n &&
         isFinite(recentObj.trendN[Q])) {
       return recentObj.trendN[Q];
     }

     // 3) Explicit legacy alias for n=5
     if (n === 5 && recentObj.trend5 && isFinite(recentObj.trend5[Q])) {
       return recentObj.trend5[Q];
     }

     // 4) Legacy default (always 5/5, works with unpatched loadRecent)
     if (recentObj.trend && isFinite(recentObj.trend[Q])) {
       return recentObj.trend[Q];
     }

     return 0;
   }

   var ht = trendFor_(homeRecent);
   var at = trendFor_(awayRecent);

   var result = clamp_((ht + at) / 2, -0.15, 0.15);
   log_(Q + ' n=' + n + ' home=' + round_(ht, 3) + ' away=' + round_(at, 3) + ' -> ' + round_(result, 3));
   return result;
 }
  

 function _getPaceFactor(q, home, away, stats, ctx) {
   var fn = 'getPaceFactor';
   var Q = quarterKey(q);
   if (!Q) return 0;

   // ─── Local safe helpers ────────────────────────────────────────────────
   function log_(msg) {
     if (typeof log === 'function') return log(fn, msg);
     try { Logger.log('[' + fn + '] ' + msg); } catch (e) {}
   }
   function clamp_(x, lo, hi) {
     if (typeof clamp === 'function') return clamp(x, lo, hi);
     x = Number(x);
     if (!isFinite(x)) x = lo;
     return Math.max(lo, Math.min(hi, x));
   }
   function round_(x, n) {
     if (typeof round === 'function') return round(x, n);
     var p = Math.pow(10, n || 0);
     x = Number(x);
     return isFinite(x) ? Math.round(x * p) / p : 0;
   }

   // ─── Game-level cache (pace is identical for all quarters) ─────────────
   if (ctx) {
     ctx._hq = ctx._hq || {};
     if (isFinite(ctx._hq.paceFactor)) {
       return Number(ctx._hq.paceFactor);
     }
   }

   // ─── Spreadsheet (prefer ctx) ──────────────────────────────────────────
   var ss = (ctx && ctx.ss) ? ctx.ss : null;
   if (!ss && typeof getSpreadsheet === 'function') {
     try { ss = getSpreadsheet(null); } catch (e0) {}
   }
   if (!ss) {
     try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e1) {}
   }
   if (!ss) return 0;

   // ─── League + profile (prefer ctx) ─────────────────────────────────────
   var league = (ctx && ctx.league)
     ? ctx.league
     : ((stats && stats._elite && stats._elite.league) || 'UNKNOWN');

   var prof = (ctx && ctx.prof) ? ctx.prof : null;
   if (!prof && typeof getLeagueProfile === 'function') {
     try { prof = getLeagueProfile(ss, league); } catch (e2) {}
   }
   if (!prof) {
     prof = {
       Q1: { mean: 55 }, Q2: { mean: 55 }, Q3: { mean: 55 }, Q4: { mean: 53 }
     };
   }

   var leagueGameTotal =
     (Number(prof.Q1 && prof.Q1.mean) || 0) +
     (Number(prof.Q2 && prof.Q2.mean) || 0) +
     (Number(prof.Q3 && prof.Q3.mean) || 0) +
     (Number(prof.Q4 && prof.Q4.mean) || 0);

   if (!isFinite(leagueGameTotal) || leagueGameTotal <= 0) {
     log_(Q + ' invalid leagueGameTotal -> 0');
     if (ctx && ctx._hq) ctx._hq.paceFactor = 0;
     return 0;
   }

   // ─── Recent stats (prefer ctx — orchestrator handled cache fallback) ──
   var homeRecent = (ctx && ctx.homeRecent) ? ctx.homeRecent : null;
   var awayRecent = (ctx && ctx.awayRecent) ? ctx.awayRecent : null;

   if (!homeRecent && typeof getRecentStats === 'function') {
     try { homeRecent = getRecentStats(ss, home, 'Home'); } catch (e3) {}
   }
   if (!awayRecent && typeof getRecentStats === 'function') {
     try { awayRecent = getRecentStats(ss, away, 'Away'); } catch (e4) {}
   }

   // ─── Team game totals (scored + allowed across quarters) ───────────────
   var qKeys = (typeof QUARTER_KEYS !== 'undefined' && QUARTER_KEYS && QUARTER_KEYS.length)
     ? QUARTER_KEYS
     : ['Q1', 'Q2', 'Q3', 'Q4'];

   function getTeamTotal_(recentObj) {
     if (!recentObj || !recentObj.avgScored || !recentObj.avgAllowed) return NaN;
     var sum = 0, used = 0;
     for (var i = 0; i < qKeys.length; i++) {
       var qq = qKeys[i];
       var s = Number(recentObj.avgScored[qq]);
       var a = Number(recentObj.avgAllowed[qq]);
       if (isFinite(s) && isFinite(a)) {
         sum += (s + a);
         used++;
       }
     }
     return used >= 2 ? sum : NaN;
   }

   var homeTotal = getTeamTotal_(homeRecent);
   var awayTotal = getTeamTotal_(awayRecent);

   if (!isFinite(homeTotal) || !isFinite(awayTotal)) {
     log_(Q + ' insufficient recent data -> 0');
     if (ctx && ctx._hq) ctx._hq.paceFactor = 0;
     return 0;
   }

   var avgTotal = (homeTotal + awayTotal) / 2;
   var rel = (avgTotal - leagueGameTotal) / leagueGameTotal;
   var result = clamp_(rel * 0.10, -0.10, 0.10);

   log_(Q + ' avgTotal=' + round_(avgTotal, 1) +
        ' leagueTotal=' + round_(leagueGameTotal, 1) +
        ' -> ' + round_(result, 3));

   // Store in game-level cache
   if (ctx && ctx._hq) ctx._hq.paceFactor = result;

   return result;
 }
  


function _getH2HQuarterPattern(q, home, away, stats, ctx) {
  var fn = 'getH2HQuarterPattern';
  var Q = quarterKey(q);
  if (!Q) return 0;

  // ─────────────────────────────────────────────────────────────
  // Local safe helpers
  // ─────────────────────────────────────────────────────────────
  function log_(msg) {
    if (typeof log === 'function') return log(fn, msg);
    try { Logger.log('[' + fn + '] ' + msg); } catch (e) {}
  }
  function clamp_(x, lo, hi) {
    if (typeof clamp === 'function') return clamp(x, lo, hi);
    x = Number(x);
    if (!isFinite(x)) x = lo;
    return Math.max(lo, Math.min(hi, x));
  }
  function round_(x, n) {
    if (typeof round === 'function') return round(x, n);
    var p = Math.pow(10, n || 0);
    x = Number(x);
    return isFinite(x) ? Math.round(x * p) / p : 0;
  }

  // ─────────────────────────────────────────────────────────────
  // Spreadsheet (prefer ctx)
  // ─────────────────────────────────────────────────────────────
  var ss = (ctx && ctx.ss) ? ctx.ss : null;
  if (!ss && typeof getSpreadsheet === 'function') {
    try { ss = getSpreadsheet(null); } catch (e0) {}
  }
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e1) {}
  }
  if (!ss) return 0;

  // ─────────────────────────────────────────────────────────────
  // H2H stats (prefer ctx prefetch)
  // ─────────────────────────────────────────────────────────────
  var h2hStats = (ctx && ctx.h2hStats) ? ctx.h2hStats : null;
  if (!h2hStats && typeof getH2HStats === 'function') {
    try { h2hStats = getH2HStats(ss, home, away); } catch (e2) {}
  }

  if (!h2hStats || !h2hStats[Q] || !isFinite(h2hStats[Q].avg)) {
    log_(Q + ' no H2H data -> 0');
    return 0;
  }

  var h2hAvg = Number(h2hStats[Q].avg);
  var h2hSd = Number(h2hStats[Q].sd);
  var h2hCount = Number(h2hStats[Q].count) || 0;

  // ─────────────────────────────────────────────────────────────
  // League baseline (prefer ctx.prof)
  // ─────────────────────────────────────────────────────────────
  var league = (ctx && ctx.league)
    ? ctx.league
    : ((stats && stats._elite && stats._elite.league) || 'UNKNOWN');

  var prof = (ctx && ctx.prof) ? ctx.prof : null;
  if (!prof && typeof getLeagueProfile === 'function') {
    try { prof = getLeagueProfile(ss, league); } catch (e3) {}
  }

  var leagueMean = (prof && prof[Q] && isFinite(prof[Q].mean)) ? Number(prof[Q].mean) : 55;
  var leagueSd = (prof && prof[Q] && isFinite(prof[Q].sd) && prof[Q].sd > 0) ? Number(prof[Q].sd) : 8;

  // ─────────────────────────────────────────────────────────────
  // Core deviation signal
  // ─────────────────────────────────────────────────────────────
  var dev = (h2hAvg - leagueMean) / Math.max(1, leagueMean);

  // Reliability by sample size
  var rel = clamp_(h2hCount / 8, 0, 1);

  // ─────────────────────────────────────────────────────────────
  // Volatility/noise damping
  //
  // Only damps when H2H is abnormally noisy:
  //   cv = sd / avg  (typical quarter cv ~0.12–0.18)
  // Baseline cv = 0.15; only penalize excess above that.
  //
  // Penalty strength scaled by ctx.variancePenalty if available.
  // ─────────────────────────────────────────────────────────────
  var noiseMult = 1.0;

  if (isFinite(h2hSd) && h2hSd > 0 && isFinite(h2hAvg) && h2hAvg > 0) {
    var cv = h2hSd / Math.max(1, h2hAvg);
    var baselineCv = 0.15;
    var excessCv = Math.max(0, cv - baselineCv);

    // Map excessCv 0..0.20 to 0..1
    var cvPenalty01 = clamp_(excessCv / 0.20, 0, 1);

    // Scale penalty by variance factor (defaults ~0.20)
    var varF = (ctx && isFinite(ctx.variancePenalty)) ? Number(ctx.variancePenalty) : 0.20;
    var scale = clamp_(varF / 0.20, 0.5, 1.5);

    // Max reduction 20%..45% depending on variance factor
    var maxPenalty = clamp_(0.35 * scale, 0.20, 0.45);

    noiseMult = 1 - (cvPenalty01 * maxPenalty);
  } else if (isFinite(h2hSd) && h2hSd > 0 && isFinite(leagueSd) && leagueSd > 0) {
    // Fallback damping if avg missing but sd exists (rare): compare to league sd
    var sdRatio = h2hSd / leagueSd;
    var excess = Math.max(0, sdRatio - 1.25); // tolerate up to +25% sd
    var p01 = clamp_(excess / 0.75, 0, 1);    // at 2.0x sd => full penalty
    noiseMult = 1 - (p01 * 0.25);
  }

  // ─────────────────────────────────────────────────────────────
  // Base factor (pre-boost)
  // ─────────────────────────────────────────────────────────────
  var raw = clamp_(dev * 0.18, -0.18, 0.18);
  var base = raw * rel * noiseMult;

  // ─────────────────────────────────────────────────────────────
  // [NEW 5C] Apply H2H Boost multiplier before final clamp
  //
  // ctx.h2hBoost is injected by the orchestrator from:
  //   config.h2h_boost || config.h2hBoost || defaults.h2h_boost
  //
  // Default = 1.0 (no effect — preserves prior behavior exactly).
  // Values > 1 allow the signal to reach ±0.18 cap faster for
  // leagues where H2H patterns are empirically more predictive.
  // Values < 1 attenuate the signal.
  //
  // Guard: must be finite and > 0; malformed values → 1.0.
  // Final clamp to [-0.18, 0.18] enforced unconditionally after
  // boost, so contract bounds are never exceeded regardless of
  // boost magnitude.
  // ─────────────────────────────────────────────────────────────
  var h2hBoost = (ctx && isFinite(ctx.h2hBoost)) ? Number(ctx.h2hBoost) : 1.0;
  if (!isFinite(h2hBoost) || h2hBoost <= 0) h2hBoost = 1.0;

  var result = base;
  if (h2hBoost !== 1.0) {
    result = base * h2hBoost;
  }

  // Contract clamp — must remain consistent regardless of boost
  result = clamp_(result, -0.18, 0.18);

  log_(
    Q +
    ' h2hAvg=' + round_(h2hAvg, 1) +
    ' leagueMean=' + round_(leagueMean, 1) +
    ' n=' + h2hCount +
    (isFinite(h2hSd) ? (' sd=' + round_(h2hSd, 2)) : '') +
    ' rel=' + round_(rel, 3) +
    ' noiseMult=' + round_(noiseMult, 3) +
    (h2hBoost !== 1.0 ? (' h2hBoost=' + round_(h2hBoost, 3) +
      ' preBoost=' + round_(base, 4)) : '') +
    ' -> ' + round_(result, 3)
  );

  // Optional caching per-quarter (safe no-op if ctx not provided)
  if (ctx) {
    ctx._hq = ctx._hq || {};
    ctx._hq.h2hFactor = ctx._hq.h2hFactor || {};
    ctx._hq.h2hFactor[Q] = result;
  }

  return result;
}
  
/**
 * getQuarterDistribution(q, home, away, stats, ctx)
 * Returns distribution factor [-0.20, 0.20]
 */
 function _getQuarterDistribution(q, home, away, stats, ctx) {
   var fn = 'getQuarterDistribution';
   var Q = quarterKey(q);
   if (!Q) return 0;

   // ─────────────────────────────────────────────────────────────
   // Local safe helpers
   // ─────────────────────────────────────────────────────────────
   function log_(msg) {
     if (typeof log === 'function') return log(fn, msg);
     try { Logger.log('[' + fn + '] ' + msg); } catch (e) {}
   }
   function clamp_(x, lo, hi) {
     if (typeof clamp === 'function') return clamp(x, lo, hi);
     x = Number(x);
     if (!isFinite(x)) x = lo;
     return Math.max(lo, Math.min(hi, x));
   }
   function round_(x, n) {
     if (typeof round === 'function') return round(x, n);
     var p = Math.pow(10, n || 0);
     x = Number(x);
     return isFinite(x) ? Math.round(x * p) / p : 0;
   }

   // ─────────────────────────────────────────────────────────────
   // Spreadsheet + league/profile (prefer ctx)
   // ─────────────────────────────────────────────────────────────
   var ss = (ctx && ctx.ss) ? ctx.ss : null;
   if (!ss && typeof getSpreadsheet === 'function') {
     try { ss = getSpreadsheet(null); } catch (e0) {}
   }
   if (!ss) {
     try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e1) {}
   }
   if (!ss) return 0;

   var league = (ctx && ctx.league) ? ctx.league : ((stats && stats._elite && stats._elite.league) || 'UNKNOWN');

   var prof = (ctx && ctx.prof) ? ctx.prof : null;
   if (!prof && typeof getLeagueProfile === 'function') {
     try { prof = getLeagueProfile(ss, league); } catch (e2) {}
   }
   if (!prof || !prof.Q1 || !prof.Q2 || !prof.Q3 || !prof.Q4 || !prof[Q]) return 0;

   // ─────────────────────────────────────────────────────────────
   // Calculate quarter's share of game total
   // ─────────────────────────────────────────────────────────────
   var q1m = Number(prof.Q1.mean), q2m = Number(prof.Q2.mean), q3m = Number(prof.Q3.mean), q4m = Number(prof.Q4.mean);
   var sum = (isFinite(q1m) ? q1m : 0) + (isFinite(q2m) ? q2m : 0) + (isFinite(q3m) ? q3m : 0) + (isFinite(q4m) ? q4m : 0);
   if (!isFinite(sum) || sum <= 0) return 0;

   var qMean = Number(prof[Q].mean);
   if (!isFinite(qMean)) return 0;

   var share = qMean / sum;

   // Dist: how far this quarter is from uniform (25%), scaled
   var dist = clamp_((share - 0.25) * 4, -0.18, 0.18);

   // O/U bias from profile (if present)
   var overPct = isFinite(prof[Q].overPct) ? Number(prof[Q].overPct) : 50;
   var underPct = isFinite(prof[Q].underPct) ? Number(prof[Q].underPct) : 50;
   var bias = clamp_(((overPct - underPct) / 100) * 0.06, -0.06, 0.06);

   // Reliability scaling by sample size
   var rel = clamp_((prof[Q].count || 0) / 300, 0, 1);

   var result = (dist + bias) * (0.6 + 0.4 * rel);
   result = clamp_(result, -0.20, 0.20);

   log_(Q +
        ' share=' + round_(share, 3) +
        ' dist=' + round_(dist, 3) +
        ' bias=' + round_(bias, 3) +
        ' rel=' + round_(rel, 3) +
        ' -> ' + round_(result, 3));

   // Optional caching (safe no-op if ctx not provided)
   if (ctx) {
     ctx._hq = ctx._hq || {};
     ctx._hq.distFactor = ctx._hq.distFactor || {};
     ctx._hq.distFactor[Q] = result;
   }

   return result;
 }
  
  /**
   * getHalfScore(team, half, stats, venue)
   * Returns expected half score for team
   */
  function _getHalfScore(team, half, stats, venue, opt) {
    var FALLBACK_Q = 26;
    half = String(half || '').toUpperCase();
    venue = String(venue || '').trim();
    opt = opt || {};
    
    var wQ1 = toNum(opt.wQ1, 0.5);
    var wQ2 = toNum(opt.wQ2, 0.5);
    var wQ3 = toNum(opt.wQ3, 0.5);
    var wQ4 = toNum(opt.wQ4, 0.5);
    
    var ss = getSpreadsheet(null);
    
    function getScore(Q) {
      // Try recent stats first
      if (ss) {
        var actualVenue = venue.indexOf('Allowed') >= 0 ? venue.replace('Allowed', '') : venue;
        var recent = getRecentStats(ss, team, actualVenue);
        
        if (recent) {
          if (venue.indexOf('Allowed') >= 0) {
            if (isFinite(recent.avgAllowed[Q])) return recent.avgAllowed[Q];
          } else {
            if (isFinite(recent.avgScored[Q])) return recent.avgScored[Q];
          }
        }
      }
      
      // Try stats object
      if (stats) {
        var key = teamKey(team);
        var keys = Object.keys(stats);
        for (var i = 0; i < keys.length; i++) {
          if (teamKey(keys[i]) === key) {
            var t = stats[keys[i]];
            if (t && t[venue] && t[venue][Q]) {
              var v = toNum(t[venue][Q].avgScore, NaN);
              if (!isFinite(v)) v = toNum(t[venue][Q].mean, NaN);
              if (isFinite(v)) return v;
            }
          }
        }
      }
      
      return FALLBACK_Q;
    }
    
    if (half === 'H1') {
      return 2 * (wQ1 * getScore('Q1') + wQ2 * getScore('Q2'));
    } else {
      return 2 * (wQ3 * getScore('Q3') + wQ4 * getScore('Q4'));
    }
  }
  
  // =====================
  // MAIN PREDICTION FUNCTIONS
  // =====================
  
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * quickSd_ — Module-level utility (Round 5, Patch 3)
 * File: Module 9 (Enhancements / Elite module — inside IIFE)
 * ═══════════════════════════════════════════════════════════════════════════
 * Population standard deviation for a numeric array.
 * Returns 0 if array is null, undefined, or has fewer than 3 elements.
 * Non-finite values are coerced to 0 (matches codebase convention).
 * Used by [5B] momentum swing dampening inside predictHighestQuarterEnhanced.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function quickSd_(arr) {
  if (!arr || arr.length < 3) return 0;
  var m = 0;
  for (var i = 0; i < arr.length; i++) m += Number(arr[i]) || 0;
  m /= arr.length;
  var ss = 0;
  for (var j = 0; j < arr.length; j++) {
    var d = (Number(arr[j]) || 0) - m;
    ss += d * d;
  }
  return Math.sqrt(ss / arr.length);
}



/**
 * Canonical HQ model builder (ES5).
 * Builds a single inspectable per-game model for Highest Quarter.
 * Uses O/U bridge if present: ctx.ouPredictions[Q] = { mu, sigma, sampleConf, ok }
 */
function buildHQModelForGame_(game, stats, config, ctx) {
  var fn = 'buildHQModelForGame_';
  var quarters = ['Q1','Q2','Q3','Q4'];

  function n_(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp_(x, lo, hi) {
    x = Number(x); if (!isFinite(x)) x = lo;
    return Math.max(lo, Math.min(hi, x));
  }
  function round_(x, dp) {
    x = Number(x);
    if (!isFinite(x)) return 0;
    var p = Math.pow(10, dp || 3);
    return Math.round(x * p) / p;
  }
  function log_(msg) {
    try { if (typeof log === 'function') log(fn, msg); } catch (e) {}
  }

  game = game || {};
  stats = stats || {};
  config = config || {};
  ctx = ctx || {};

  var home = String(game.home || '').trim();
  var away = String(game.away || '').trim();
  var league = String(game.league || ctx.league || '').trim();

  var model = {
    home: home,
    away: away,
    league: league,

    quarterScores: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    baseScores:   { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },

    factors: {
      recent:       { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      pace:         { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      h2h:          { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      distribution: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      teamWin:      { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      ouBridge:     { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
    },

    probabilities: { pQ1: 0, pQ2: 0, pQ3: 0, pQ4: 0 },
    sigmaByQ:      { Q1: NaN, Q2: NaN, Q3: NaN, Q4: NaN },

    dominant: { flag: false, quarter: null, strength: 0 },
    tieInfo:  { isTieLikely: false, primary: null, secondary: null, margin: 0 },

    reliability: 0,

    sourceMeta: {
      ouBridgeUsed: false,
      recentUsed: false,
      h2hUsed: false,
      teamWinUsed: false,
      leagueProfileUsed: false,
      profileSource: ''
    },

    diagnostics: { ranked: [] }
  };

  // League profile (optional)
  var prof = ctx.prof || null;
  if (!prof && typeof getLeagueProfile === 'function' && ctx.ss) {
    try { prof = getLeagueProfile(ctx.ss, league); } catch (eP) {}
  }
  if (prof) {
    model.sourceMeta.leagueProfileUsed = true;
    model.sourceMeta.profileSource = prof._source || 'league_profile';
  }

  var relParts = [];

  for (var i = 0; i < quarters.length; i++) {
    var Q = quarters[i];

    // Base score
    var base = 52;
    if (typeof _getQuarterBaseScore === 'function') {
      try { base = n_(_getQuarterBaseScore(Q, home, away, stats, ctx), base); } catch (eB) {}
    } else if (prof && prof[Q] && isFinite(prof[Q].mean)) {
      base = n_(prof[Q].mean, base);
    }
    model.baseScores[Q] = base;

    // Factors
    var recentF = 0, paceF = 0, h2hF = 0, distF = 0, teamWinF = 0, ouBridgeF = 0;

    if (typeof _getRecentQuarterTrend === 'function') {
      try {
        recentF = n_(_getRecentQuarterTrend(Q, home, away, stats, 10, ctx), 0);
        if (recentF !== 0) model.sourceMeta.recentUsed = true;
      } catch (eR) {}
    }

    if (typeof _getPaceFactor === 'function') {
      try { paceF = n_(_getPaceFactor(Q, home, away, stats, ctx), 0); } catch (ePa) {}
    }

    if (typeof _getH2HQuarterPattern === 'function') {
      try {
        h2hF = n_(_getH2HQuarterPattern(Q, home, away, stats, ctx), 0);
        if (h2hF !== 0) model.sourceMeta.h2hUsed = true;
      } catch (eH) {}
    }

    if (typeof _getQuarterDistribution === 'function') {
      try { distF = n_(_getQuarterDistribution(Q, home, away, stats, ctx), 0); } catch (eD) {}
    }

    if (typeof _getTeamWinFactor === 'function') {
      try {
        teamWinF = n_(_getTeamWinFactor(Q, home, away, stats, ctx), 0);
        if (teamWinF !== 0) model.sourceMeta.teamWinUsed = true;
      } catch (eTW) {}
    }

    // O/U bridge (if present)
    if (ctx.ouPredictions && ctx.ouPredictions[Q] && ctx.ouPredictions[Q].ok !== false) {
      var oup = ctx.ouPredictions[Q];
      if (isFinite(oup.mu) && isFinite(base) && base > 0) {
        ouBridgeF = (Number(oup.mu) - base) / Math.max(1, base);
        model.sourceMeta.ouBridgeUsed = true;
      }
      if (isFinite(oup.sigma) && oup.sigma > 0) {
        model.sigmaByQ[Q] = Number(oup.sigma);
      }
    }

    model.factors.recent[Q] = round_(recentF, 4);
    model.factors.pace[Q] = round_(paceF, 4);
    model.factors.h2h[Q] = round_(h2hF, 4);
    model.factors.distribution[Q] = round_(distF, 4);
    model.factors.teamWin[Q] = round_(teamWinF, 4);
    model.factors.ouBridge[Q] = round_(ouBridgeF, 4);

    // Combine -> enhanced score (kept conservative)
    var enh =
      recentF * 0.25 +
      paceF * 0.15 +
      h2hF * 0.25 +
      distF * 0.30 +
      teamWinF * 0.10 +
      ouBridgeF * 0.35;

    enh = clamp_(enh, -0.30, 0.30);
    model.quarterScores[Q] = round_(base * (1 + enh), 3);

    // Reliability component
    if (ctx.ouPredictions && ctx.ouPredictions[Q] && isFinite(ctx.ouPredictions[Q].sampleConf)) {
      relParts.push(clamp_(ctx.ouPredictions[Q].sampleConf, 0, 1));
    } else {
      relParts.push(0.25);
    }
  }

  model.reliability = relParts.length
    ? round_(relParts.reduce(function(a,b){return a+b;},0) / relParts.length, 4)
    : 0.25;

  // Softmax probs
  var temp = 4.0;
  if (isFinite(Number(config.hq_softmax_temperature))) temp = Number(config.hq_softmax_temperature);
  else if (isFinite(Number(config.hqSoftmaxTemperature))) temp = Number(config.hqSoftmaxTemperature);
  temp = Math.max(0.5, temp);

  var maxScore = -Infinity;
  for (var j = 0; j < quarters.length; j++) {
    var s = model.quarterScores[quarters[j]];
    if (s > maxScore) maxScore = s;
  }

  var expSum = 0;
  var exps = {};
  for (var k = 0; k < quarters.length; k++) {
    var QQ = quarters[k];
    exps[QQ] = Math.exp((model.quarterScores[QQ] - maxScore) / temp);
    expSum += exps[QQ];
  }

  model.probabilities.pQ1 = exps.Q1 / expSum;
  model.probabilities.pQ2 = exps.Q2 / expSum;
  model.probabilities.pQ3 = exps.Q3 / expSum;
  model.probabilities.pQ4 = exps.Q4 / expSum;

  var ranked = [
    { q:'Q1', p:model.probabilities.pQ1, s:model.quarterScores.Q1 },
    { q:'Q2', p:model.probabilities.pQ2, s:model.quarterScores.Q2 },
    { q:'Q3', p:model.probabilities.pQ3, s:model.quarterScores.Q3 },
    { q:'Q4', p:model.probabilities.pQ4, s:model.quarterScores.Q4 }
  ].sort(function(a,b){ return b.p - a.p; });

  model.diagnostics.ranked = ranked;

  var top = ranked[0];
  var second = ranked[1];
  var pMargin = top.p - second.p;

  model.tieInfo.primary = top.q;
  model.tieInfo.secondary = second.q;
  model.tieInfo.margin = round_(pMargin, 4);
  model.tieInfo.isTieLikely = (pMargin < 0.08);

  model.dominant.flag = (pMargin >= 0.15 && model.reliability >= 0.45);
  model.dominant.quarter = top.q;
  model.dominant.strength = round_(pMargin, 4);

  log_('Built HQ model: ' + home + ' vs ' + away +
       ' | top=' + top.q +
       ' | p=' + round_(top.p, 3) +
       ' | rel=' + round_(model.reliability, 3) +
       ' | ouBridge=' + model.sourceMeta.ouBridgeUsed);

  return model;
}


function predictHighestQuarterEnhanced(game, stats, config, ctx) {
  function clamp_(x, lo, hi) { x = Number(x); if (!isFinite(x)) x = lo; return Math.max(lo, Math.min(hi, x)); }
  function round_(x, n) { x = Number(x); if (!isFinite(x)) return 0; var p = Math.pow(10, n || 0); return Math.round(x * p) / p; }

  function skip_(reason) {
    return {
      quarter: 'N/A',
      pick: 'N/A',
      confidence: 0,
      tier: 'SKIP',
      tierDisplay: '○',
      skip: true,
      reason: reason || 'skip',
      wasTie: false,
      tiedWith: null,
      pQ1: 0, pQ2: 0, pQ3: 0, pQ4: 0, pWin: 0,
      dominant: false,
      dominantStrength: 0,
      sourceMeta: {},
      reliability: 0
    };
  }

  game = game || {};
  stats = stats || {};
  config = config || {};

  // accept ctx from arg OR from config aliases
  ctx = ctx || config._ctx || config.ctx || config.gameContext || config._gameContext || {};

  var home = String(game.home || '').trim();
  var away = String(game.away || '').trim();
  if (!home || !away) return skip_('missing_teams');

  // Hard-bridge: if ctx.ouPredictions missing, try to locate it on config shapes
  if (!ctx.ouPredictions) {
    if (config._ctx && config._ctx.ouPredictions) ctx.ouPredictions = config._ctx.ouPredictions;
    else if (config._gameContext && config._gameContext.ouPredictions) ctx.ouPredictions = config._gameContext.ouPredictions;
    else if (config.gameContext && config.gameContext.ouPredictions) ctx.ouPredictions = config.gameContext.ouPredictions;
    else if (config.ctx && config.ctx.ouPredictions) ctx.ouPredictions = config.ctx.ouPredictions;
    else if (config.ouPredictions) ctx.ouPredictions = config.ouPredictions;
  }

  var model;
  try {
    model = buildHQModelForGame_(game, stats, config, ctx);
  } catch (e) {
    return skip_('model_build_error: ' + (e && e.message ? e.message : e));
  }

  if (!model || !model.diagnostics || !model.diagnostics.ranked || !model.diagnostics.ranked.length) {
    return skip_('invalid_model');
  }

  var ranked = model.diagnostics.ranked;
  var top = ranked[0];

  // Confidence derived from pWin & reliability (bounded)
  var conf = 50 + ((top.p - 0.25) / 0.75) * 38;
  conf = conf * (0.55 + 0.45 * (model.reliability || 0));
  if (model.tieInfo && model.tieInfo.isTieLikely) conf = conf * 0.88;
  conf = clamp_(conf, 40, 88);
  conf = round_(conf, 1);

  var tierObj = { tier: 'WEAK', display: '○' };
  if (typeof getTierObject === 'function') {
    try { tierObj = getTierObject(conf); } catch (eT) {}
  }

  return {
    quarter: top.q,
    pick: 'Highest Q: ' + top.q,
    confidence: conf,
    expectedTotal: round_(top.s, 1),

    tier: tierObj.tier || 'WEAK',
    tierDisplay: tierObj.display || '○',

    wasTie: !!(model.tieInfo && model.tieInfo.isTieLikely),
    tiedWith: (model.tieInfo && model.tieInfo.isTieLikely) ? [model.tieInfo.primary, model.tieInfo.secondary] : null,

    pQ1: round_(model.probabilities.pQ1, 4),
    pQ2: round_(model.probabilities.pQ2, 4),
    pQ3: round_(model.probabilities.pQ3, 4),
    pQ4: round_(model.probabilities.pQ4, 4),
    pWin: round_(top.p, 4),

    dominant: !!(model.dominant && model.dominant.flag),
    dominantStrength: model.dominant ? round_(model.dominant.strength * 100, 1) : 0,

    sourceMeta: model.sourceMeta || {},
    reliability: round_(model.reliability, 4),

    modelObject: model
  };
}

  
  /* ============================================================================
 * ELITE FIRST HALF 1x2 PREDICTOR v2.0.0
 * ============================================================================
 * 
 * FIXES APPLIED:
 *   BUG-001: Q1/Q2 expectations now properly summed for half (was averaging)
 *   BUG-002: Two-way prediction by default (no "Draw 55%" spam)
 *   BUG-003: Confidence now ranges 51-85% based on actual signal strength
 *   BUG-004: Uses marginStats + H2H half-wins + recent form (like Robbers)
 *   BUG-005: Caches H2H/form data to avoid re-reading sheets per game
 *   BUG-006: Proper error handling with diagnostic logging
 * 
 * ============================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

var H1_CONFIG = {
  debug: true,                    // Set false to reduce logs
  forceTeamWay: true,            // Force HOME/AWAY (no draws)
  defaultHomeAdvantage: 1.5,      // Points advantage for home team
  defaultDrawThreshold: 3.0,      // Only used if forceTwoWay=false
  
  // Signal weights (should sum to ~1.0)
  weights: {
    margin: 0.50,    // Q1+Q2 expected margin (primary)
    h2h: 0.25,       // H2H first-half win rates
    form: 0.15,      // Recent form
    odds: 0.10       // Odds-implied probability
  },
  
  // Confidence scaling
  minConfidence: 51,
  maxConfidence: 85
};

// Cache for H2H and form data (avoid re-reading sheets)
var __H1_CACHE__ = {
  h2h: null,
  form: null,
  marginStats: null,
  loaded: false,
  timestamp: 0
};

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL HELPER FUNCTIONS (self-contained)
// ═══════════════════════════════════════════════════════════════════════════

function _h1_log(msg) {
  if (!H1_CONFIG.debug) return;
  try { 
    Logger.log('[predictFirstHalf1x2] ' + msg); 
  } catch (e) {}
}

function _h1_toNum(v, def) {
  if (v === null || v === undefined || v === '') return def;
  var n = parseFloat(String(v).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : def;
}

function _h1_clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function _h1_round(v, decimals) {
  var mult = Math.pow(10, decimals || 0);
  return Math.round(v * mult) / mult;
}

function _h1_normCdf(z) {
  // Logistic approximation to normal CDF
  return 1 / (1 + Math.exp(-1.7 * z));
}

function _h1_canonName(name) {
  return String(name || '').trim().toLowerCase();
}

function _h1_getSpreadsheet() {
  try {
    if (typeof getSpreadsheet === 'function') return getSpreadsheet(null);
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    return null;
  }
}

function _h1_getTierObject(conf) {
  // Use existing tier function if available
  if (typeof getTierObject === 'function') {
    try { return getTierObject(conf); } catch (e) {}
  }
  
  // Fallback tier logic
  if (conf >= 75) return { tier: 'ELITE', display: '🔥', symbol: '🔥' };
  if (conf >= 65) return { tier: 'HIGH', display: '★★', symbol: '★★' };
  if (conf >= 58) return { tier: 'MEDIUM', display: '★', symbol: '★' };
  if (conf >= 50) return { tier: 'LOW', display: '●', symbol: '●' };
  return { tier: 'SKIP', display: '○', symbol: '○' };
}

function _h1_leagueKey(league) {
  if (typeof leagueKey === 'function') {
    try { return leagueKey(league); } catch (e) {}
  }
  var s = String(league || '').toUpperCase().trim();
  if (/NBA/i.test(s)) return 'NBA';
  if (/EUR|EURO/i.test(s)) return 'EURO';
  return s || 'DEFAULT';
}

// ═══════════════════════════════════════════════════════════════════════════
// SKIP RESULT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function _h1_skipResult(reason) {
  var tierObj = _h1_getTierObject(0);
  return {
    prediction: 'N/A',
    predictedWinner: 'N/A',
    margin: 0,
    homeExpected: 0,
    awayExpected: 0,
    confidence: 0,
    tier: 'SKIP',
    tierDisplay: tierObj.display,
    skip: true,
    reason: reason,
    source: 'H1_SKIP'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA LOADERS (with caching)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load or retrieve cached H2H and form data
 */
function _h1_loadCachedData(ss, config) {
  // Check if cache is still valid (5 minute TTL)
  var now = Date.now();
  var cacheAge = now - (__H1_CACHE__.timestamp || 0);
  var cacheTTL = 5 * 60 * 1000; // 5 minutes
  
  // Use injected caches from config if available
  if (config && config._robbersH2H && config._robbersForm) {
    return {
      h2h: config._robbersH2H,
      form: config._robbersForm
    };
  }
  
  // Use existing cache if valid
  if (__H1_CACHE__.loaded && cacheAge < cacheTTL) {
    return {
      h2h: __H1_CACHE__.h2h,
      form: __H1_CACHE__.form
    };
  }
  
  // Load fresh data
  _h1_log('Loading H2H and form data...');
  
  var h2h = {};
  var form = {};
  
  try {
    if (typeof loadRobbersH2HStats === 'function') {
      h2h = loadRobbersH2HStats(ss) || {};
      _h1_log('H2H loaded: ' + Object.keys(h2h).length + ' matchups');
    } else {
      h2h = _h1_loadH2HFromSheets(ss);
    }
  } catch (e) {
    _h1_log('H2H load error: ' + e.message);
  }
  
  try {
    if (typeof loadRobbersRecentForm === 'function') {
      form = loadRobbersRecentForm(ss, 10) || {};
      _h1_log('Form loaded: ' + Object.keys(form).length + ' teams');
    } else {
      form = _h1_loadFormFromSheets(ss);
    }
  } catch (e) {
    _h1_log('Form load error: ' + e.message);
  }
  
  // Update cache
  __H1_CACHE__.h2h = h2h;
  __H1_CACHE__.form = form;
  __H1_CACHE__.loaded = true;
  __H1_CACHE__.timestamp = now;
  
  return { h2h: h2h, form: form };
}

/**
 * Load H2H data directly from CleanH2H sheets
 */
function _h1_loadH2HFromSheets(ss) {
  if (!ss) return {};
  
  var h2h = {};
  var sheets = ss.getSheets();
  
  for (var si = 0; si < sheets.length; si++) {
    var name = sheets[si].getName();
    if (!/^CleanH2H/i.test(name)) continue;
    
    try {
      var data = sheets[si].getDataRange().getValues();
      if (!data || data.length < 2) continue;
      
      // Build header map
      var hdr = {};
      for (var c = 0; c < data[0].length; c++) {
        var key = _h1_canonName(data[0][c]).replace(/[\s_-]+/g, '');
        hdr[key] = c;
      }
      
      var homeIdx = hdr.home !== undefined ? hdr.home : hdr.hometeam;
      var awayIdx = hdr.away !== undefined ? hdr.away : hdr.awayteam;
      var q1hIdx = hdr.q1h !== undefined ? hdr.q1h : hdr.q1home;
      var q1aIdx = hdr.q1a !== undefined ? hdr.q1a : hdr.q1away;
      var q2hIdx = hdr.q2h !== undefined ? hdr.q2h : hdr.q2home;
      var q2aIdx = hdr.q2a !== undefined ? hdr.q2a : hdr.q2away;
      
      if (homeIdx === undefined || awayIdx === undefined) continue;
      
      for (var r = 1; r < data.length; r++) {
        var row = data[r];
        var home = _h1_canonName(row[homeIdx]);
        var away = _h1_canonName(row[awayIdx]);
        if (!home || !away) continue;
        
        var matchKey = home + ' vs ' + away;
        
        if (!h2h[matchKey]) {
          h2h[matchKey] = {
            games: 0,
            homeH1Wins: 0,
            awayH1Wins: 0,
            draws: 0,
            halfWins: {}
          };
        }
        
        // Calculate first half scores if we have quarter data
        if (q1hIdx !== undefined && q2hIdx !== undefined) {
          var q1h = _h1_toNum(row[q1hIdx], NaN);
          var q1a = _h1_toNum(row[q1aIdx], NaN);
          var q2h = _h1_toNum(row[q2hIdx], NaN);
          var q2a = _h1_toNum(row[q2aIdx], NaN);
          
          if (isFinite(q1h) && isFinite(q1a) && isFinite(q2h) && isFinite(q2a)) {
            var h1Home = q1h + q2h;
            var h1Away = q1a + q2a;
            
            h2h[matchKey].games++;
            if (h1Home > h1Away) h2h[matchKey].homeH1Wins++;
            else if (h1Away > h1Home) h2h[matchKey].awayH1Wins++;
            else h2h[matchKey].draws++;
          }
        }
      }
      
      // Calculate rates
      for (var key in h2h) {
        var m = h2h[key];
        if (m.games > 0) {
          m.homeH1Rate = m.homeH1Wins / m.games;
          m.awayH1Rate = m.awayH1Wins / m.games;
          // Store in halfWins format for compatibility
          var parts = key.split(' vs ');
          if (parts.length === 2) {
            m.halfWins = {};
            m.halfWins[parts[0] + '_H1'] = m.homeH1Rate;
            m.halfWins[parts[1] + '_H1'] = m.awayH1Rate;
          }
        }
      }
    } catch (e) {
      _h1_log('Error processing sheet ' + name + ': ' + e.message);
    }
  }
  
  return h2h;
}

/**
 * Load recent form from CleanRecent sheets
 */
function _h1_loadFormFromSheets(ss) {
  if (!ss) return {};
  
  var form = {};
  var sheets = ss.getSheets();
  var lastN = 10;
  
  for (var si = 0; si < sheets.length; si++) {
    var name = sheets[si].getName();
    if (!/^CleanRecent/i.test(name)) continue;
    
    var isHomeSheet = /Home/i.test(name);
    
    try {
      var data = sheets[si].getDataRange().getValues();
      if (!data || data.length < 2) continue;
      
      var hdr = {};
      for (var c = 0; c < data[0].length; c++) {
        var key = _h1_canonName(data[0][c]).replace(/[\s_-]+/g, '');
        hdr[key] = c;
      }
      
      var teamIdx = isHomeSheet 
        ? (hdr.home !== undefined ? hdr.home : hdr.hometeam)
        : (hdr.away !== undefined ? hdr.away : hdr.awayteam);
      var ftIdx = hdr.ft !== undefined ? hdr.ft : hdr.ftscore;
      
      if (teamIdx === undefined) continue;
      
      var startRow = Math.max(1, data.length - lastN);
      
      for (var r = startRow; r < data.length; r++) {
        var row = data[r];
        var team = _h1_canonName(row[teamIdx]);
        if (!team) continue;
        
        if (!form[team]) {
          form[team] = { wins: 0, losses: 0, games: 0 };
        }
        
        // Parse FT score
        if (ftIdx !== undefined) {
          var ft = String(row[ftIdx] || '');
          var match = ft.match(/(\d+)\s*[-:]\s*(\d+)/);
          if (match) {
            var s1 = parseInt(match[1], 10);
            var s2 = parseInt(match[2], 10);
            var teamScore = isHomeSheet ? s1 : s2;
            var oppScore = isHomeSheet ? s2 : s1;
            
            form[team].games++;
            if (teamScore > oppScore) form[team].wins++;
            else form[team].losses++;
          }
        }
      }
    } catch (e) {
      _h1_log('Error processing form sheet ' + name + ': ' + e.message);
    }
  }
  
  return form;
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL CALCULATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate expected half margin from marginStats (Q1 + Q2)
 * FIXES BUG-001: Properly sums Q1+Q2 instead of averaging
 */
function _h1_calcMarginSignal(home, away, stats, config) {
  if (!stats || typeof stats !== 'object') return null;
  
  // Canonicalize stats keys if function exists
  try {
    if (typeof canonicalizeMarginStatsKeys_ === 'function') {
      stats = canonicalizeMarginStatsKeys_(stats);
    }
  } catch (e) {}
  
  function findTeam(name) {
    var k = _h1_canonName(name);
    if (stats[name]) return stats[name];
    if (stats[k]) return stats[k];
    
    // Try _meta.teamDisplay lookup
    try {
      var td = stats._meta && stats._meta.teamDisplay;
      if (td) {
        for (var key in td) {
          if (_h1_canonName(td[key]) === k) return stats[key];
        }
      }
    } catch (e) {}
    return null;
  }
  
  var hStats = findTeam(home);
  var aStats = findTeam(away);
  
  if (!hStats || !aStats) {
    _h1_log('MarginSignal: Missing team stats for ' + home + ' or ' + away);
    return null;
  }
  
  function getQVal(teamStats, venue, quarter, field) {
    var v = teamStats && teamStats[venue] && teamStats[venue][quarter];
    if (!v) return NaN;
    var val = v[field];
    return isFinite(Number(val)) ? Number(val) : NaN;
  }
  
  // Get Q1 and Q2 margins for both teams (venue-specific)
  var hQ1Margin = getQVal(hStats, 'Home', 'Q1', 'avgMargin');
  var hQ2Margin = getQVal(hStats, 'Home', 'Q2', 'avgMargin');
  var aQ1Margin = getQVal(aStats, 'Away', 'Q1', 'avgMargin');
  var aQ2Margin = getQVal(aStats, 'Away', 'Q2', 'avgMargin');
  
  // Get standard deviations for confidence scaling
  var hQ1Sd = getQVal(hStats, 'Home', 'Q1', 'stdDev') || 9;
  var hQ2Sd = getQVal(hStats, 'Home', 'Q2', 'stdDev') || 9;
  var aQ1Sd = getQVal(aStats, 'Away', 'Q1', 'stdDev') || 9;
  var aQ2Sd = getQVal(aStats, 'Away', 'Q2', 'stdDev') || 9;
  
  var hasMargins = isFinite(hQ1Margin) && isFinite(hQ2Margin) && 
                   isFinite(aQ1Margin) && isFinite(aQ2Margin);
  
  if (!hasMargins) {
    _h1_log('MarginSignal: Missing quarter margins');
    return null;
  }
  
  // FIX BUG-001: Sum Q1+Q2 for half margin
  // Each team's margin is relative to their opponents in recent games
  // Net advantage = (home margin advantage - away margin advantage) / 2
  var q1NetMargin = (hQ1Margin - aQ1Margin) * 0.5;
  var q2NetMargin = (hQ2Margin - aQ2Margin) * 0.5;
  var halfMargin = q1NetMargin + q2NetMargin;
  
  // Add home advantage
  var homeAdv = _h1_toNum(config.homeAdvantage, H1_CONFIG.defaultHomeAdvantage);
  halfMargin += homeAdv;
  
  // Calculate combined sigma for z-score
  var sigma = Math.sqrt(
    Math.pow(hQ1Sd, 2) + Math.pow(hQ2Sd, 2) + 
    Math.pow(aQ1Sd, 2) + Math.pow(aQ2Sd, 2)
  ) * 0.35; // Shrink for combined effect
  sigma = _h1_clamp(sigma, 6, 20);
  
  // Calculate expected points (optional, for display)
  var hQ1Total = getQVal(hStats, 'Home', 'Q1', 'avgTotal');
  var hQ2Total = getQVal(hStats, 'Home', 'Q2', 'avgTotal');
  var aQ1Total = getQVal(aStats, 'Away', 'Q1', 'avgTotal');
  var aQ2Total = getQVal(aStats, 'Away', 'Q2', 'avgTotal');
  
  var homeExp = NaN, awayExp = NaN;
  if (isFinite(hQ1Total) && isFinite(hQ2Total) && isFinite(hQ1Margin) && isFinite(hQ2Margin)) {
    // TeamScore = (Total + Margin) / 2
    homeExp = ((hQ1Total + hQ1Margin) / 2) + ((hQ2Total + hQ2Margin) / 2);
  }
  if (isFinite(aQ1Total) && isFinite(aQ2Total) && isFinite(aQ1Margin) && isFinite(aQ2Margin)) {
    awayExp = ((aQ1Total + aQ1Margin) / 2) + ((aQ2Total + aQ2Margin) / 2);
  }
  
  return {
    margin: halfMargin,
    sigma: sigma,
    homeExp: homeExp,
    awayExp: awayExp,
    z: sigma > 0 ? halfMargin / sigma : 0
  };
}

/**
 * Calculate H2H first-half signal
 */
function _h1_calcH2HSignal(home, away, h2hData) {
  if (!h2hData) return null;
  
  var homeNorm = _h1_canonName(home);
  var awayNorm = _h1_canonName(away);
  
  // Try both orientations
  var matchKey = homeNorm + ' vs ' + awayNorm;
  var revKey = awayNorm + ' vs ' + homeNorm;
  
  var h2h = h2hData[matchKey] || h2hData[revKey];
  if (!h2h || !h2h.games || h2h.games < 1) return null;
  
  var isReverse = !h2hData[matchKey] && h2hData[revKey];
  
  var homeRate, awayRate;
  
  if (h2h.halfWins) {
    // Use halfWins format
    var hKey = homeNorm + '_H1';
    var aKey = awayNorm + '_H1';
    homeRate = _h1_toNum(h2h.halfWins[hKey], NaN);
    awayRate = _h1_toNum(h2h.halfWins[aKey], NaN);
  } else if (isFinite(h2h.homeH1Rate) && isFinite(h2h.awayH1Rate)) {
    if (isReverse) {
      homeRate = h2h.awayH1Rate; // our home was their away
      awayRate = h2h.homeH1Rate;
    } else {
      homeRate = h2h.homeH1Rate;
      awayRate = h2h.awayH1Rate;
    }
  }
  
  if (!isFinite(homeRate) || !isFinite(awayRate)) return null;
  
  // Signal: positive = home favored
  var signal = homeRate - awayRate;
  
  // Reduce weight for small sample
  var weight = h2h.games >= 5 ? 1.0 : (h2h.games >= 3 ? 0.7 : 0.4);
  
  return {
    signal: signal,
    weight: weight,
    homeRate: homeRate,
    awayRate: awayRate,
    games: h2h.games
  };
}

/**
 * Calculate recent form signal
 */
function _h1_calcFormSignal(home, away, formData) {
  if (!formData) return null;
  
  var homeNorm = _h1_canonName(home);
  var awayNorm = _h1_canonName(away);
  
  var hForm = formData[homeNorm] || formData[home];
  var aForm = formData[awayNorm] || formData[away];
  
  if (!hForm || !aForm) return null;
  if ((hForm.games || 0) < 3 || (aForm.games || 0) < 3) return null;
  
  var hWinRate = hForm.games > 0 ? (hForm.wins / hForm.games) : 0.5;
  var aWinRate = aForm.games > 0 ? (aForm.wins / aForm.games) : 0.5;
  
  // Bounded signal
  var signal = _h1_clamp((hWinRate - aWinRate) * 0.8, -0.4, 0.4);
  
  return {
    signal: signal,
    homeWinRate: hWinRate,
    awayWinRate: aWinRate,
    homeGames: hForm.games,
    awayGames: aForm.games
  };
}

/**
 * Calculate odds-implied signal
 */
function _h1_calcOddsSignal(game, config) {
  var homeOdds = _h1_toNum(game.homeOdds, 0);
  var awayOdds = _h1_toNum(game.awayOdds, 0);
  
  // Try robbers resolver if available
  if ((homeOdds <= 1.01 || awayOdds <= 1.01) && typeof _robbers_resolveOdds_ === 'function') {
    try {
      var resolved = _robbers_resolveOdds_(game, config);
      homeOdds = _h1_toNum(resolved.homeOdds, homeOdds);
      awayOdds = _h1_toNum(resolved.awayOdds, awayOdds);
    } catch (e) {}
  }
  
  // Try inference from pred + single odds
  if ((homeOdds <= 1.01 || awayOdds <= 1.01) && game.pred && game.odds) {
    var pred = String(game.pred || '').toUpperCase();
    var singleOdds = _h1_toNum(game.odds, 0);
    if (singleOdds > 1.01 && singleOdds < 20) {
      // Infer opponent odds
      var impliedWin = 1 / singleOdds;
      var impliedLose = 1 - impliedWin;
      var inferredOpp = impliedLose > 0.05 ? (1 / impliedLose) : 15;
      
      if (pred === 'HOME' || pred === '1') {
        homeOdds = singleOdds;
        awayOdds = inferredOpp;
      } else if (pred === 'AWAY' || pred === '2') {
        awayOdds = singleOdds;
        homeOdds = inferredOpp;
      }
    }
  }
  
  if (homeOdds <= 1.01 || awayOdds <= 1.01) return null;
  
  // Convert to implied probabilities and normalize
  var impliedHome = 1 / homeOdds;
  var impliedAway = 1 / awayOdds;
  var total = impliedHome + impliedAway;
  
  if (total <= 0) return null;
  
  var pHome = impliedHome / total;
  
  return {
    signal: (pHome - 0.5) * 2, // Scale to -1 to +1
    pHome: pHome,
    homeOdds: homeOdds,
    awayOdds: awayOdds
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PREDICTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Predict First Half 1x2 Winner
 * 
 * @param {Object} game - { home, away, league, homeOdds, awayOdds, pred, odds }
 * @param {Object} stats - marginStats object
 * @param {Object} config - configuration overrides
 * @returns {Object} prediction result
 */
function predictFirstHalf1x2(game, stats, config) {
  _h1_log('════════════════════════════════════════════════════════════');
  _h1_log('ENTER: ' + (game && game.home) + ' vs ' + (game && game.away));
  
  // ─── VALIDATION ────────────────────────────────────────────────────────
  game = game || {};
  stats = stats || {};
  config = config || {};
  
  var home = String(game.home || '').trim();
  var away = String(game.away || '').trim();
  
  if (!home || !away) {
    _h1_log('EXIT: Missing teams');
    return _h1_skipResult('Missing teams');
  }
  
  // ─── GET SPREADSHEET AND CACHED DATA ───────────────────────────────────
  var ss = _h1_getSpreadsheet();
  var cachedData = _h1_loadCachedData(ss, config);
  
  // ─── CALCULATE ALL SIGNALS ─────────────────────────────────────────────
  var signals = [];
  var debugInfo = {};
  
  // Signal 1: Margin-based (primary)
  var marginResult = _h1_calcMarginSignal(home, away, stats, config);
  if (marginResult && isFinite(marginResult.margin)) {
    var marginStrength = _h1_clamp(Math.abs(marginResult.margin) / 10, 0, 1);
    var marginSignal = marginResult.margin > 0 ? marginStrength : -marginStrength;
    
    signals.push({
      name: 'MARGIN',
      value: marginSignal,
      weight: H1_CONFIG.weights.margin,
      raw: marginResult.margin
    });
    
    debugInfo.margin = {
      value: _h1_round(marginResult.margin, 2),
      z: _h1_round(marginResult.z, 3),
      homeExp: _h1_round(marginResult.homeExp, 1),
      awayExp: _h1_round(marginResult.awayExp, 1)
    };
    
    _h1_log('Signal[MARGIN]: ' + _h1_round(marginSignal, 3) + 
            ' (raw=' + _h1_round(marginResult.margin, 2) + ')');
  }
  
  // Signal 2: H2H first-half
  var h2hResult = _h1_calcH2HSignal(home, away, cachedData.h2h);
  if (h2hResult) {
    var h2hWeight = H1_CONFIG.weights.h2h * h2hResult.weight;
    
    signals.push({
      name: 'H2H',
      value: h2hResult.signal,
      weight: h2hWeight,
      raw: h2hResult
    });
    
    debugInfo.h2h = {
      homeRate: _h1_round(h2hResult.homeRate * 100, 1) + '%',
      awayRate: _h1_round(h2hResult.awayRate * 100, 1) + '%',
      games: h2hResult.games
    };
    
    _h1_log('Signal[H2H]: ' + _h1_round(h2hResult.signal, 3) + 
            ' (games=' + h2hResult.games + ')');
  }
  
  // Signal 3: Recent form
  var formResult = _h1_calcFormSignal(home, away, cachedData.form);
  if (formResult) {
    signals.push({
      name: 'FORM',
      value: formResult.signal,
      weight: H1_CONFIG.weights.form,
      raw: formResult
    });
    
    debugInfo.form = {
      homeWR: _h1_round(formResult.homeWinRate * 100, 1) + '%',
      awayWR: _h1_round(formResult.awayWinRate * 100, 1) + '%'
    };
    
    _h1_log('Signal[FORM]: ' + _h1_round(formResult.signal, 3));
  }
  
  // Signal 4: Odds-implied
  var oddsResult = _h1_calcOddsSignal(game, config);
  if (oddsResult) {
    signals.push({
      name: 'ODDS',
      value: oddsResult.signal,
      weight: H1_CONFIG.weights.odds,
      raw: oddsResult
    });
    
    debugInfo.odds = {
      pHome: _h1_round(oddsResult.pHome * 100, 1) + '%',
      homeOdds: oddsResult.homeOdds,
      awayOdds: oddsResult.awayOdds
    };
    
    _h1_log('Signal[ODDS]: ' + _h1_round(oddsResult.signal, 3));
  }
  
  // ─── COMBINE SIGNALS ───────────────────────────────────────────────────
  if (signals.length === 0) {
    _h1_log('EXIT: No usable signals');
    return _h1_skipResult('No data available');
  }
  
  var weightedSum = 0;
  var totalWeight = 0;
  
  for (var i = 0; i < signals.length; i++) {
    var sig = signals[i];
    weightedSum += sig.value * sig.weight;
    totalWeight += sig.weight;
  }
  
  var combinedSignal = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
  
  _h1_log('Combined signal: ' + _h1_round(combinedSignal, 4) + 
          ' (signals=' + signals.length + ', totalWeight=' + _h1_round(totalWeight, 2) + ')');
  
  // ─── DETERMINE PREDICTION ──────────────────────────────────────────────
  // FIX BUG-002: Force two-way prediction (no draws)
  var forceTwoWay = config.firstHalfTwoWay !== false && H1_CONFIG.forceTeamWay;
  
  var prediction;
  var margin = marginResult ? marginResult.margin : (combinedSignal * 8);
  var absMargin = Math.abs(margin);
  
  if (!forceTwoWay && absMargin < H1_CONFIG.defaultDrawThreshold) {
    prediction = 'Draw';
  } else {
    // FIX: Use combinedSignal for final decision
    prediction = combinedSignal >= 0 ? 'Home' : 'Away';
  }
  
  var predictedWinner = prediction === 'Home' ? home : 
                        (prediction === 'Away' ? away : 'Draw');
  
  // ─── CALCULATE CONFIDENCE ──────────────────────────────────────────────
  // FIX BUG-003: Meaningful confidence based on signal strength
  var absSignal = Math.abs(combinedSignal);
  
  // Convert signal strength to probability (logistic)
  var pFavor = _h1_normCdf(absSignal * 2); // Scale signal for CDF
  
  // Base confidence from probability
  var baseConf = pFavor * 100;
  
  // Adjust by data quality
  var dataQuality = _h1_clamp(totalWeight / 0.8, 0.5, 1.0);
  var confidence = 50 + (baseConf - 50) * dataQuality;
  
  // Clamp to configured range
  confidence = _h1_clamp(confidence, H1_CONFIG.minConfidence, H1_CONFIG.maxConfidence);
  confidence = _h1_round(confidence, 1);
  
  // ─── BUILD RESULT ──────────────────────────────────────────────────────
  var tierObj = _h1_getTierObject(confidence);
  var league = _h1_leagueKey(game.league);
  
  // Ensure margin sign matches prediction
  if (prediction === 'Away') margin = -Math.abs(margin);
  else if (prediction === 'Home') margin = Math.abs(margin);
  
  var result = {
    prediction: prediction,
    predictedWinner: predictedWinner,
    margin: _h1_round(margin, 1),
    homeExpected: marginResult ? _h1_round(marginResult.homeExp, 1) : undefined,
    awayExpected: marginResult ? _h1_round(marginResult.awayExp, 1) : undefined,
    confidence: confidence,
    tier: tierObj.tier,
    tierDisplay: tierObj.display,
    skip: false,
    reason: '',
    league: league,
    source: 'H1_ELITE_v2',
    meta: {
      signals: signals.length,
      totalWeight: _h1_round(totalWeight, 3),
      combinedSignal: _h1_round(combinedSignal, 4),
      forceTwoWay: forceTwoWay,
      debug: debugInfo
    }
  };
  
  _h1_log('RESULT: ' + result.prediction + ' (' + result.predictedWinner + ')');
  _h1_log('  Margin: ' + result.margin + ' | Conf: ' + result.confidence + '%');
  _h1_log('════════════════════════════════════════════════════════════');
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH FUNCTION (for processing multiple games)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Predict First Half 1x2 for multiple games
 */
function predictAllFirstHalf1x2(games, stats, config) {
  _h1_log('predictAllFirstHalf1x2: Processing ' + (games ? games.length : 0) + ' games');
  
  var predictions = [];
  
  for (var i = 0; i < (games || []).length; i++) {
    var game = games[i];
    if (!game) continue;
    
    var pred = predictFirstHalf1x2(game, stats, config);
    
    // Add game context
    pred.league = pred.league || game.league || '';
    pred.date = game.date || '';
    pred.time = game.time || '';
    pred.match = game.home + ' vs ' + game.away;
    
    predictions.push(pred);
  }
  
  _h1_log('predictAllFirstHalf1x2: Completed ' + predictions.length + ' predictions');
  return predictions;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clear the H1 cache (useful before batch operations)
 */
function clearH1Cache() {
  __H1_CACHE__ = {
    h2h: null,
    form: null,
    marginStats: null,
    loaded: false,
    timestamp: 0
  };
  _h1_log('Cache cleared');
}



function processEnhancements(arg1, arg2, arg3, arg4, arg5) {
  _safeLog_('FINGERPRINT: Elite IIFE processEnhancements is running');
  var fn = 'processEnhancements';

  // ──────────────────────────────────────────────────────────────────────────
  // Local helpers
  // ──────────────────────────────────────────────────────────────────────────
  function _safeLog_(msg) {
    try {
      if (typeof log === 'function') return log(fn, msg);
      Logger.log('[' + fn + '] ' + msg);
    } catch (e) {}
  }
  function _safeWarn_(msg) {
    try {
      if (typeof warn === 'function') return warn(fn, msg);
      Logger.log('[' + fn + '][WARN] ' + msg);
    } catch (e) {}
  }
  function _isObj(o) { return !!o && typeof o === 'object'; }
  function _cloneShallow(o) {
    var c = {};
    if (!_isObj(o)) return c;
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    return c;
  }
  function _matchKey(home, away) {
    return (String(home || '').trim() + ' vs ' + String(away || '').trim()).toLowerCase();
  }

  // Header helpers (fallback)
  function _normHeaderKey_(name) {
    return String(name || '').toLowerCase().replace(/[\s_\-\/().%]+/g, '');
  }
  function _buildHeaderMapLocal_(headers) {
    var m = {};
    for (var i = 0; i < headers.length; i++) {
      var key = _normHeaderKey_(headers[i]);
      if (key) m[key] = i;
    }
    return m;
  }
  function _findColumnLocal_(hmap, names) {
    if (!_isObj(hmap) || !names || !names.length) return undefined;
    for (var i = 0; i < names.length; i++) {
      var k = _normHeaderKey_(names[i]);
      if (k && hmap[k] !== undefined) return hmap[k];
    }
    return undefined;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Shared gameContext resolution
  // ──────────────────────────────────────────────────────────────────────────
  function _getSharedStore_() {
    try {
      if (typeof t2_getSharedGameContext_ === 'function') {
        var ctx = t2_getSharedGameContext_();
        if (_isObj(ctx)) return ctx;
      }
    } catch (e0) {}

    try { if (typeof T2_SHARED_GAME_CONTEXT !== 'undefined' && _isObj(T2_SHARED_GAME_CONTEXT)) return T2_SHARED_GAME_CONTEXT; } catch (e1) {}
    try { if (typeof T2_GAME_CONTEXT !== 'undefined' && _isObj(T2_GAME_CONTEXT)) return T2_GAME_CONTEXT; } catch (e2) {}
    try { if (typeof sharedCtx !== 'undefined' && _isObj(sharedCtx)) return sharedCtx; } catch (e3) {}
    try { if (typeof gameContext !== 'undefined' && _isObj(gameContext)) return gameContext; } catch (e4) {}
    try { if (typeof __GAME_CTX__ !== 'undefined' && _isObj(__GAME_CTX__)) return __GAME_CTX__; } catch (e5) {}

    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Robust resolver + OU extraction/normalization
  // ──────────────────────────────────────────────────────────────────────────
  function _normAlphaNum_(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function _resolveGameCtxFuzzy_(store, home, away, league) {
    if (!_isObj(store)) return null;

    var normH = _normAlphaNum_(home);
    var normA = _normAlphaNum_(away);
    var normL = _normAlphaNum_(league);

    var pools = [];
    if (_isObj(store.games)) pools.push(store.games);
    if (_isObj(store.byGame)) pools.push(store.byGame);
    if (_isObj(store.ctx)) pools.push(store.ctx);
    pools.push(store);

    var best = null;
    var bestScore = -1;

    for (var p = 0; p < pools.length; p++) {
      var pool = pools[p];
      if (!_isObj(pool)) continue;

      var keys = [];
      try { keys = Object.keys(pool); } catch (eK) {}

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var val = pool[key];
        if (!_isObj(val)) continue;

        var kLower = _normAlphaNum_(key);
        var score = 0;

        var hasHome = normH && kLower.indexOf(normH) > -1;
        var hasAway = normA && kLower.indexOf(normA) > -1;

        if (hasHome) score += 10;
        if (hasAway) score += 10;
        if (hasHome && hasAway) score += 30;
        if (normL && kLower.indexOf(normL) > -1) score += 5;

        var hasOU =
          val.ouPredictions || val.ouPredictionsByQuarter || val.ouPreds || val.ou ||
          (val.predictions && (val.predictions.ouPredictions || val.predictions.ou)) ||
          (val._ctx && val._ctx.ouPredictions) ||
          (val.gameContext && val.gameContext.ouPredictions);

        if (hasOU) score += 20;

        if (score >= 60 && score > bestScore) {
          bestScore = score;
          best = val;
        }
      }
      if (best) break;
    }

    return best;
  }

  function _normalizeOuPreds_(raw) {
    if (!_isObj(raw)) return null;

    if (_isObj(raw.quarters)) raw = raw.quarters;
    if (_isObj(raw.qtr)) raw = raw.qtr;

    var out = {};
    var qs = ['Q1','Q2','Q3','Q4'];
    var any = false;

    for (var i = 0; i < qs.length; i++) {
      var Q = qs[i];
      var v = raw[Q];
      if (v == null) v = raw[Q.toLowerCase()];
      if (v == null) continue;

      if (typeof v === 'number') {
        out[Q] = { ok: true, mu: Number(v), sigma: NaN, sampleConf: 0.5, sampleSize: 0 };
        any = true;
        continue;
      }

      if (!_isObj(v)) continue;

      var mu = Number(v.mu);
      if (!isFinite(mu)) mu = Number(v.mean);
      var sigma = Number(v.sigma);
      if (!isFinite(sigma) || sigma <= 0) sigma = Number(v.sd);
      if (!isFinite(sigma) || sigma <= 0) sigma = Number(v.stdDev);

      if (!isFinite(mu) || mu <= 0) continue;

      var n = Number(v.samples);
      if (!isFinite(n)) n = Number(v.sampleSize);
      if (!isFinite(n)) n = 0;

      var sc = Number(v.sampleConf);
      if (!isFinite(sc)) sc = Math.max(0, Math.min(1, n / 20));

      out[Q] = {
        ok: (v.ok === false) ? false : true,
        mu: mu,
        sigma: (isFinite(sigma) && sigma > 0) ? sigma : NaN,
        sampleSize: n,
        samples: n,
        sampleConf: sc,
        source: v.source || 'ou_bridge_norm'
      };
      any = true;
    }

    return any ? out : null;
  }

  function _extractOuPredsRobust_(gameCtx) {
    if (!_isObj(gameCtx)) return null;

    var raw =
      gameCtx.ouPredictions ||
      gameCtx.ouPredictionsByQuarter ||
      gameCtx.ouPreds ||
      gameCtx.ou ||
      (gameCtx.predictions && (gameCtx.predictions.ouPredictions || gameCtx.predictions.ou)) ||
      (gameCtx._ctx && gameCtx._ctx.ouPredictions) ||
      (gameCtx.gameContext && gameCtx.gameContext.ouPredictions) ||
      null;

    if (!_isObj(raw) && _isObj(gameCtx.ou) && _isObj(gameCtx.ou.ouPredictions)) raw = gameCtx.ou.ouPredictions;

    return _normalizeOuPreds_(raw);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Detect mode
  // ──────────────────────────────────────────────────────────────────────────
  var isSpreadsheetMode = arg1 && typeof arg1.getSheets === 'function';
  _safeLog_('ENTER mode=' + (isSpreadsheetMode ? 'SPREADSHEET' : 'CONTRACT'));

  // ──────────────────────────────────────────────────────────────────────────
  // CONTRACT MODE
  // ──────────────────────────────────────────────────────────────────────────
  if (!isSpreadsheetMode) {
    var game = arg1 || {};
    var marginStats = arg2 || {};

    var cfg = arg5 || arg4 || arg3 || {};
    var cfgForGame = _cloneShallow(cfg);

    var result = { firstHalf: null, highestQ: null };

    try { result.highestQ = predictHighestQuarterEnhanced(game, marginStats, cfgForGame, cfgForGame._ctx); }
    catch (eH) { result.highestQ = { error: eH.message, skip: true }; }

    try { result.firstHalf = predictFirstHalf1x2(game, marginStats, cfgForGame); }
    catch (eF) { result.firstHalf = { error: eF.message, skip: true }; }

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SPREADSHEET MODE
  // ──────────────────────────────────────────────────────────────────────────
  var ss = (typeof getSpreadsheet === 'function') ? getSpreadsheet(arg1) : arg1;
  if (!ss) return { ok: false, error: 'Spreadsheet not available', processed: 0 };

  var cfgBase = {};
  try { if (typeof loadTier2Config === 'function') cfgBase = loadTier2Config(ss) || {}; } catch (e0) {}

  var marginStats2 = {};
  try { if (typeof loadTier2MarginStats === 'function') marginStats2 = loadTier2MarginStats(ss) || {}; } catch (e1) {}

  var up = (typeof getSheet === 'function') ? getSheet(ss, 'UpcomingClean') : ss.getSheetByName('UpcomingClean');
  if (!up) return { ok: false, error: 'UpcomingClean not found', processed: 0 };

  var values = up.getDataRange().getValues();
  if (!values || values.length < 2) return { ok: true, processed: 0, reason: 'no rows' };

  var header = values[0].slice();
  var hmap = (typeof buildHeaderMap === 'function') ? buildHeaderMap(header) : _buildHeaderMapLocal_(header);

  function ensureCol(name) {
    var key = _normHeaderKey_(name);
    if (hmap && hmap[key] !== undefined) return hmap[key];
    header.push(name);
    hmap = (typeof buildHeaderMap === 'function') ? buildHeaderMap(header) : _buildHeaderMapLocal_(header);
    return header.length - 1;
  }

  var colHQ   = ensureCol('enh-high-q');
  var colHQc  = ensureCol('enh-high-q-conf');
  var colPQ1  = ensureCol('enh-high-q-pq1');
  var colPQ2  = ensureCol('enh-high-q-pq2');
  var colPQ3  = ensureCol('enh-high-q-pq3');
  var colPQ4  = ensureCol('enh-high-q-pq4');
  var colPWin = ensureCol('enh-high-q-pwin');
  var colHDom    = ensureCol('enh-high-q-dominant');
  var colHDomStr = ensureCol('enh-high-q-dom-strength');
  var colHSource = ensureCol('enh-high-q-source');
  var colHTie    = ensureCol('enh-high-q-tie');
  var colHRel    = ensureCol('enh-high-q-reliability');
  var col1H  = ensureCol('enh-1h');
  var col1Hc = ensureCol('enh-1h-conf');

  if (header.length !== values[0].length) {
    values[0] = header;
    for (var r = 1; r < values.length; r++) while (values[r].length < header.length) values[r].push('');
  }

  hmap = (typeof buildHeaderMap === 'function') ? buildHeaderMap(values[0]) : _buildHeaderMapLocal_(values[0]);

  var idxHome = (typeof findColumn === 'function')
    ? findColumn(hmap, ['home', 'hometeam', 'home_team'])
    : _findColumnLocal_(hmap, ['home', 'hometeam', 'home_team']);
  var idxAway = (typeof findColumn === 'function')
    ? findColumn(hmap, ['away', 'awayteam', 'away_team'])
    : _findColumnLocal_(hmap, ['away', 'awayteam', 'away_team']);
  var idxLeague = (typeof findColumn === 'function')
    ? findColumn(hmap, ['league', 'competition', 'comp'])
    : _findColumnLocal_(hmap, ['league', 'competition', 'comp']);

  var sharedStore = _getSharedStore_();
  var ctxGamesFound = 0;

  _safeLog_('Shared ctx store ' + (sharedStore ? 'FOUND' : 'NOT found'));

  var dumped = false;
  var processed = 0;

  for (var i = 1; i < values.length; i++) {
    var row = values[i];

    var home = (idxHome !== undefined && idxHome !== null) ? String(row[idxHome] || '').trim() : '';
    var away = (idxAway !== undefined && idxAway !== null) ? String(row[idxAway] || '').trim() : '';
    if (!home || !away) continue;

    var league = (idxLeague !== undefined && idxLeague !== null) ? String(row[idxLeague] || '').trim() : '';
    var game = { home: home, away: away, league: league };

    var cfgForGame = _cloneShallow(cfgBase);

    var gameCtx = _resolveGameCtxFuzzy_(sharedStore, home, away, league);
    var ouPreds = _extractOuPredsRobust_(gameCtx);

    if (!dumped) {
      dumped = true;
      if (gameCtx) _safeLog_('GAME_CTX_DUMP keys=' + Object.keys(gameCtx).join(', '));
      else _safeLog_('GAME_CTX_DUMP: NULL (O/U bridge will not work)');
    }

    if (ouPreds) {
      cfgForGame._gameContext = gameCtx;
      cfgForGame._ctx = { ss: ss, league: league, home: home, away: away, ouPredictions: ouPreds };
      ctxGamesFound++;
    } else if (gameCtx) {
      _safeLog_('WARNING: gameCtx found but OU preds not detected for ' + home + ' vs ' + away);
    }

    // HQ
    try {
      var hq = predictHighestQuarterEnhanced(game, marginStats2, cfgForGame, cfgForGame._ctx);

      row[colHQ]  = (hq && hq.quarter) ? hq.quarter : '';
      row[colHQc] = (hq && isFinite(hq.confidence)) ? (hq.confidence + '%') : '';

      if (hq && isFinite(hq.pQ1)) {
        row[colPQ1]  = hq.pQ1;
        row[colPQ2]  = hq.pQ2;
        row[colPQ3]  = hq.pQ3;
        row[colPQ4]  = hq.pQ4;
        row[colPWin] = hq.pWin;

        row[colHDom]    = hq.dominant ? 'YES' : 'NO';
        row[colHDomStr] = (hq.dominantStrength != null) ? hq.dominantStrength : '';

        row[colHSource] = hq.sourceMeta ? [
          hq.sourceMeta.ouBridgeUsed ? 'OU' : '',
          hq.sourceMeta.recentUsed ? 'RECENT' : '',
          hq.sourceMeta.h2hUsed ? 'H2H' : '',
          hq.sourceMeta.teamWinUsed ? 'TEAMWIN' : '',
          hq.sourceMeta.profileSource || ''
        ].filter(Boolean).join('|') : '';

        row[colHTie] = hq.wasTie
          ? ('YES' + (hq.tiedWith ? ' (' + hq.tiedWith.join('/') + ')' : ''))
          : 'NO';

        row[colHRel] = (hq.reliability != null) ? hq.reliability : '';
      } else {
        row[colPQ1] = '';
        row[colPQ2] = '';
        row[colPQ3] = '';
        row[colPQ4] = '';
        row[colPWin] = '';
        row[colHDom] = '';
        row[colHDomStr] = '';
        row[colHSource] = '';
        row[colHTie] = '';
        row[colHRel] = '';
      }
    } catch (eHq) {
      row[colHQ] = '';
      row[colHQc] = '';
      row[colPQ1] = '';
      row[colPQ2] = '';
      row[colPQ3] = '';
      row[colPQ4] = '';
      row[colPWin] = '';
      row[colHDom] = '';
      row[colHDomStr] = '';
      row[colHSource] = '';
      row[colHTie] = '';
      row[colHRel] = '';
    }

    // 1H (3 args only)
    try {
      var h1 = predictFirstHalf1x2(game, marginStats2, cfgForGame);
      row[col1H]  = (h1 && h1.prediction && h1.prediction !== 'N/A') ? ('1H: ' + h1.prediction) : '';
      row[col1Hc] = (h1 && isFinite(h1.confidence)) ? (h1.confidence + '%') : '';
    } catch (eH1) {
      row[col1H] = '';
      row[col1Hc] = '';
    }

    processed++;
  }

  try {
    up.getRange(1, 1, values.length, values[0].length).setValues(values);
  } catch (writeErr) {
    _safeWarn_('Write failed: ' + writeErr.message);
    return { ok: false, error: 'Write failed: ' + writeErr.message, processed: processed };
  }

  _safeLog_('EXIT processed=' + processed + ', ctxGamesFound=' + ctxGamesFound);
  return { ok: true, processed: processed, ctxGamesFound: ctxGamesFound };
}

// =========================================================================
  //  EXPORT PUBLIC API & CLOSE MODULE
  // =========================================================================
  return {
    getQuarterBaseScore: _getQuarterBaseScore,
    getRecentQuarterTrend: _getRecentQuarterTrend,
    getPaceFactor: _getPaceFactor,
    getH2HQuarterPattern: _getH2HQuarterPattern,
    getQuarterDistribution: _getQuarterDistribution,
    getHalfScore: _getHalfScore,
    predictHighestQuarterEnhanced: predictHighestQuarterEnhanced,
    predictFirstHalf1x2: predictFirstHalf1x2,
    processEnhancements: processEnhancements,
    resetCache: function() { 
      state.cache = null; 
      Logger.log('[Elite] Cache reset');
    }
  };

})();


function predictHighestQuarterEnhanced(game, stats, config) {
  if (typeof Elite !== 'undefined' && Elite && typeof Elite.predictHighestQuarterEnhanced === 'function') {
    return Elite.predictHighestQuarterEnhanced(game, stats, config);
  }
  return {
    quarter: 'N/A', pick: 'N/A', confidence: 0,
    tier: 'SKIP', skip: true,
    reason: 'Elite.predictHighestQuarterEnhanced not available'
  };
}

// =====================
// GLOBAL SIGNATURE-COMPATIBLE EXPORTS
// =====================
// These replace existing functions with Elite implementations

function getQuarterBaseScore(q, home, away, stats) {
  return Elite.getQuarterBaseScore(q, home, away, stats);
}

function getRecentQuarterTrend(q, home, away, stats, games) {
  return Elite.getRecentQuarterTrend(q, home, away, stats, games);
}

function getPaceFactor(q, home, away, stats) {
  return Elite.getPaceFactor(q, home, away, stats);
}

function getH2HQuarterPattern(q, home, away, stats) {
  return Elite.getH2HQuarterPattern(q, home, away, stats);
}

function getQuarterDistribution(q, home, away, stats) {
  return Elite.getQuarterDistribution(q, home, away, stats);
}

function getHalfScore(team, half, stats, venue, opt) {
  return Elite.getHalfScore(team, half, stats, venue, opt);
}

function predictHighestQuarterEnhanced(game, stats, config) {
  stats = canonicalizeMarginStatsKeys_(stats);
  return Elite.predictHighestQuarterEnhanced(game, stats, config);
}

function predictFirstHalf1x2(game, stats, config) {
  return Elite.predictFirstHalf1x2(game, stats, config);
}

function processEnhancements(arg1, arg2, arg3, arg4, arg5) {
  Logger.log('[GLOBAL processEnhancements FORWARDER] routing to Elite.processEnhancements');
  return Elite.processEnhancements(arg1, arg2, arg3, arg4, arg5);
}

function resetModule9Cache() {
  Elite.resetCache();
}
