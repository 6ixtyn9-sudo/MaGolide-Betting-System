/**
 * ======================================================================
 * MODULE 8:  
 * PROJECT: Ma Golide
 * VERSION: 2.10 (Production-Ready)
 * ======================================================================
 *
 * FIXES FROM v2.9:
 * 1) Normalized duplicate keys: O/U picks keyed by quarter+direction+line (1 decimal)
 * 2) Edge=0 logic tightened: only bypasses threshold if EV is present (not just passes)
 * 3) preferStrongTier now implemented: STRONG/MEDIUM games get sort bonus
 *
 * FEATURES:
 * - Reads per-quarter: ou-q*-ev, ou-q*-edge, ou-q*-conf
 * - Confidence MAX-merge (text vs column)
 * - Ignores "EST ..." as O/U bets, uses for Highest Quarter derivation
 * - Highest Scoring Quarter as separate market (no O/U gating, exempt from cap)
 * - maxSnipersPerGame enforced (HIGH_QTR exempt)
 * - Clean priority sorting: stars → tier bonus → HIGH_QTR → others
 * ======================================================================
 */

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

function _toBool(v) {
  if (v === true || v === false) return v;
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1';
}

function _toNum(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  var n = parseFloat(String(v).replace('%', '').trim());
  return isFinite(n) ? n : fallback;
}

function _parseConfPct(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return (v > 0 && v <= 1) ? v * 100 : v;
  var s = String(v).trim().replace('%', '').trim();
  var n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return (n > 0 && n <= 1) ? n * 100 : n;
}

function _formatConfPct(pct) {
  if (!isFinite(pct)) return 'N/A';
  var rounded = Math.round(pct * 10) / 10;
  return (rounded === Math.floor(rounded)) ? Math.floor(rounded) + '%' : rounded.toFixed(1) + '%';
}

function _getSheet(ss, name) {
  var sheets = ss.getSheets();
  var lower = name.toLowerCase();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === lower) return sheets[i];
  }
  return null;
}

function _headerMap(row) {
  var map = {};
  for (var i = 0; i < row.length; i++) {
    var h = String(row[i] || '').toLowerCase().trim();
    if (h) map[h] = i;
  }
  return map;
}

function _formatDate(raw) {
  if (!raw) return '';
  var d;
  if (raw instanceof Date) {
    d = raw;
  } else if (typeof raw === 'number') {
    d = new Date((raw - 25569) * 86400000);
  } else {
    var str = String(raw).trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) return str;
    d = new Date(str);
  }
  if (!d || isNaN(d.getTime())) return '';
  var day = ('0' + d.getDate()).slice(-2);
  var mon = ('0' + (d.getMonth() + 1)).slice(-2);
  return day + '/' + mon + '/' + d.getFullYear();
}

function _formatTime(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    var h = raw.getHours(), m = raw.getMinutes();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }
  return String(raw);
}

// FIX #1 (PATCHED): Normalized O/U pick key for robust duplicate detection
// - Accepts optional colon after quarter ("Q3: UNDER 58.0")
// - Normalizes line to 1 decimal place
function _normOUPickKey(matchKey, pick) {
  var s = String(pick || '').toUpperCase().replace(/\s+/g, ' ').trim();
  var m = s.match(/(Q[1-4])\s*[:\-]?\s*(OVER|UNDER)\s+([\d.]+)/i);

  if (!m) {
    return String(matchKey || '').trim().toLowerCase() + '|RAW|' + s;
  }

  var lineNum = parseFloat(m[3]);
  var line = isFinite(lineNum) ? (Math.round(lineNum * 10) / 10).toFixed(1) : 'NaN';

  return String(matchKey || '').trim().toLowerCase() + '|' + m[1] + '|' + m[2] + '|' + line;
}

// =====================================================================
// CONFIGURATION
// =====================================================================


function getTunedThresholds(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var cfg = loadAccumulatorConfig(ss);

  var simSheet = _getSheet(ss, 'Stats_Tier2_Simulation');
  if (!simSheet) return cfg;

  try {
    var sniperRate = parseFloat(String(simSheet.getRange('B8').getValue()).replace('%', ''));
    if (isFinite(sniperRate)) {
      if (sniperRate >= 58) cfg.sniperMinMargin = Math.max(2.0, cfg.sniperMinMargin - 0.5);
      else if (sniperRate < 52.4) cfg.sniperMinMargin = Math.min(4.0, cfg.sniperMinMargin + 1.0);
    }
  } catch (e) {
    Logger.log('[Thresholds] Error: ' + e.message);
  }

  return cfg;
}

// =====================================================================
// TIER SYSTEM
// =====================================================================

function _loadTierCuts(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var weakMin = 55, mediumMin = 65, strongMin = 75;

  try {
    if (typeof loadTier2Config === 'function') {
      var t2cfg = loadTier2Config(ss) || {};
      weakMin = _parseConfPct(t2cfg.even_target) || 55;
      mediumMin = _parseConfPct(t2cfg.medium_target) || 65;
      strongMin = _parseConfPct(t2cfg.strong_target) || 75;
    }
  } catch (e) {}

  weakMin = Math.max(50, Math.min(95, weakMin));
  mediumMin = Math.max(weakMin + 1, Math.min(94, mediumMin));
  strongMin = Math.max(mediumMin + 1, Math.min(95, strongMin));

  return { weakMin: weakMin, mediumMin: mediumMin, strongMin: strongMin };
}

/**
 * Enhanced tier calculation using MODULE 9 if available
 * @param {number} confPct - Confidence percentage
 * @param {Object} cuts - Tier cutoff thresholds
 * @return {Object} {tier, symbol, display}
 */
function _getTier(confPct, cuts) {
  // Use MODULE 9 if available
  if (typeof getTierObject === 'function') {
    return getTierObject(confPct);
  }
  
  // Fallback to original logic
  if (!isFinite(confPct)) return { tier: 'EVEN', symbol: '', display: 'N/A' };
  
  cuts = cuts || { strongMin: 75, mediumMin: 65, weakMin: 55 };
  
  if (confPct >= cuts.strongMin) return { tier: 'STRONG', symbol: '★', display: '★ (' + Math.round(confPct) + '%)' };
  if (confPct >= cuts.mediumMin) return { tier: 'MEDIUM', symbol: '●', display: '● (' + Math.round(confPct) + '%)' };
  if (confPct >= cuts.weakMin) return { tier: 'WEAK', symbol: '○', display: '○ (' + Math.round(confPct) + '%)' };
  
  return { tier: 'EVEN', symbol: '', display: '(' + Math.round(confPct) + '%)' };
}

function _tierLabel(tierObj) {
  if (!tierObj || !tierObj.tier) return '';
  return tierObj.symbol ? tierObj.tier + ' ' + tierObj.symbol : tierObj.tier;
}

function _alignPick(pick, tierObj) {
  // Keep Pick clean - symbols now in Confidence column
  return String(pick || '').replace(/[★●○⭐]/g, '').replace(/\s+/g, ' ').trim();
}

// =====================================================================
// SIGNAL LOADING
// =====================================================================

function _parseESTValue(raw) {
  if (!raw) return NaN;
  var m = String(raw).trim().match(/^EST\s+([\d.]+)/i);
  return m ? parseFloat(m[1]) : NaN;
}

function _parseOUSignal(raw) {
  if (!raw) return null;
  var str = String(raw).trim();
  if (/^EST\s/i.test(str)) return null;
  if (str === 'N/A' || str === '') return null;

  var star = /[★⭐]/.test(str);
  var clean = str.replace(/[★⭐●○]/g, '').replace(/\([\s\d.%]*\)/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

  // Pattern: "OVER 58.8 (55%)"
  var m1 = clean.match(/^(OVER|UNDER)\s+([\d.]+)\s*\((\d+)\s*%?\)/i);
  if (m1) {
    return { direction: m1[1], line: parseFloat(m1[2]), conf: parseFloat(m1[3]), ev: NaN, edge: NaN, star: star };
  }

  // Pattern: "OVER 58.8" - default conf to 50 for legacy compatibility
  var m2 = clean.match(/^(OVER|UNDER)\s+([\d.]+)/i);
  if (m2) {
    return { direction: m2[1], line: parseFloat(m2[2]), conf: 50, ev: NaN, edge: NaN, star: star };
  }

  return null;
}

// NEW: Robust parser handles "UNDER 59.0 ★ (74%)" format
function _parseOUSignalRobust(txt) {
  if (!txt || txt === 'N/A') return null;

  var s = String(txt).toUpperCase();

  // Strip symbols: ★ ● ○ ⭐
  // Strip percentage brackets: (74%)
  // Normalize whitespace
  s = s.replace(/[★●○⭐]/g, ' ')
       .replace(/\([^)]*\)/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();

  // Match: OVER 58.8 or UNDER 59.0
  var m = s.match(/(OVER|UNDER)\s+([\d.]+)/i);
  if (!m) return null;

  return {
    direction: m[1],
    line: parseFloat(m[2]),
    conf: NaN,
    ev: NaN,
    edge: NaN,
    star: false
  };
}

function _parseBestDir(raw) {
  if (!raw) return null;
  var str = String(raw).trim();
  if (str === 'N/A' || str === '') return null;

  var star = /[★⭐]/.test(str);
  var clean = str.replace(/[★⭐●○]/g, '').replace(/\s+/g, ' ').trim();

  // Pattern: "Q1 OVER 58.8 (59% | EV 17.0%)"
  var m1 = clean.match(/(Q[1-4])\s+(OVER|UNDER)\s+([\d.]+)\s*\(\s*(\d+)\s*%?\s*\|\s*EV\s*:?\s*([\d.]+)\s*%?\s*\)/i);
  if (m1) {
    return { quarter: m1[1].toUpperCase(), direction: m1[2].toUpperCase(), line: parseFloat(m1[3]), conf: parseFloat(m1[4]), ev: parseFloat(m1[5]), edge: NaN, star: star };
  }

  // Pattern: "Q1 OVER 58.8 (59%)"
  var m2 = clean.match(/(Q[1-4])\s+(OVER|UNDER)\s+([\d.]+)\s*\(\s*(\d+)\s*%?\s*\)/i);
  if (m2) {
    return { quarter: m2[1].toUpperCase(), direction: m2[2].toUpperCase(), line: parseFloat(m2[3]), conf: parseFloat(m2[4]), ev: NaN, edge: NaN, star: star };
  }

  // Pattern: "Q1 OVER 58.8"
  var m3 = clean.match(/(Q[1-4])\s+(OVER|UNDER)\s+([\d.]+)/i);
  if (m3) {
    return { quarter: m3[1].toUpperCase(), direction: m3[2].toUpperCase(), line: parseFloat(m3[3]), conf: 50, ev: NaN, edge: NaN, star: star };
  }

  return null;
}

function _loadTier2Signals(ss, config) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  config = config || {};

  var sheet = (typeof _getSheet === 'function') ? _getSheet(ss, 'UpcomingClean') : ss.getSheetByName('UpcomingClean');
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return {};

  var signals = {};
  var QUARTERS_L = ['q1', 'q2', 'q3', 'q4'];

  // ─────────────────────────────────────────────────────────────
  // Robust header map + column resolver
  // ─────────────────────────────────────────────────────────────
  function _headerMapRobust_(row0) {
    var m = {};
    for (var i = 0; i < row0.length; i++) {
      var raw = row0[i];
      if (raw === null || raw === undefined || raw === '') continue;

      var s = String(raw).trim();
      var lower = s.toLowerCase();
      var norm1 = lower.replace(/[\s]+/g, '_');       // spaces -> _
      var norm2 = lower.replace(/[\s_\-]+/g, '');     // strip separators
      var norm3 = lower.replace(/-/g, '_');           // - -> _

      m[lower] = i;
      m[norm1] = i;
      m[norm2] = i;
      m[norm3] = i;
    }
    return m;
  }

  function _col_(hdr, name) {
    if (!hdr) return undefined;
    if (hdr[name] !== undefined) return hdr[name];

    var s = String(name || '').toLowerCase().trim();
    var v1 = s;
    var v2 = s.replace(/[\s]+/g, '_');
    var v3 = s.replace(/-/g, '_');
    var v4 = s.replace(/[\s_\-]+/g, '');
    if (hdr[v1] !== undefined) return hdr[v1];
    if (hdr[v2] !== undefined) return hdr[v2];
    if (hdr[v3] !== undefined) return hdr[v3];
    if (hdr[v4] !== undefined) return hdr[v4];
    return undefined;
  }

  function _toNum_(v, def) {
    if (v === null || v === undefined || v === '') return def;
    var n = parseFloat(String(v).replace(/,/g, '').replace(/[^\d.-]/g, '').trim());
    return isFinite(n) ? n : def;
  }

  // Normalizes 0.54 -> 54, keeps 56 -> 56
  function _normalizeConf_(v, def) {
    var n = _toNum_(v, def);
    if (!isFinite(n)) return def;
    if (n > 0 && n <= 1.0) return n * 100;
    return n;
  }

  // Direction normalizer (ONE canonical name used everywhere)
  function _normOuDir_(d) {
    d = String(d || '').trim().toUpperCase();
    if (d === 'O') return 'OVER';
    if (d === 'U') return 'UNDER';
    if (d === 'OVER' || d === 'UNDER') return d;
    return '';
  }

  // Safe O/U signal parser (for UpcomingClean ou-q* cells if they exist)
  function _parseOUSignalRobust_(txt) {
    if (!txt || txt === 'N/A') return null;
    var s = String(txt).toUpperCase();

    // strip symbols + bracketed conf
    s = s.replace(/[★●○⭐]/g, ' ');
    s = s.replace(/\([^)]*\)/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();

    // match OVER 58.8 / UNDER 59
    var m = s.match(/\b(OVER|UNDER|O|U)\b\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (!m) return null;

    var dir = _normOuDir_(m[1]);
    if (!dir) return null;

    return {
      direction: dir,
      line: parseFloat(m[2]),
      conf: NaN,
      ev: NaN,
      edge: NaN,
      star: false
    };
  }

  var hdr = _headerMapRobust_(data[0]);

  // ─────────────────────────────────────────────────────────────
  // Build Q1–Q4 book-line cache from UpcomingClean (for OU_Log override)
  // ─────────────────────────────────────────────────────────────
  var ucQLines = {};
  var ucHomeIdx = _col_(hdr, 'home');
  var ucAwayIdx = _col_(hdr, 'away');
  var ucQ1Idx = _col_(hdr, 'q1');
  var ucQ2Idx = _col_(hdr, 'q2');
  var ucQ3Idx = _col_(hdr, 'q3');
  var ucQ4Idx = _col_(hdr, 'q4');

  if (ucHomeIdx !== undefined && ucAwayIdx !== undefined) {
    for (var r0 = 1; r0 < data.length; r0++) {
      var row0 = data[r0];
      var h0 = String(row0[ucHomeIdx] || '').trim().toLowerCase();
      var a0 = String(row0[ucAwayIdx] || '').trim().toLowerCase();
      if (!h0 || !a0) continue;

      var k0 = h0 + ' vs ' + a0;
      ucQLines[k0] = {
        Q1: (ucQ1Idx !== undefined) ? _toNum_(row0[ucQ1Idx], NaN) : NaN,
        Q2: (ucQ2Idx !== undefined) ? _toNum_(row0[ucQ2Idx], NaN) : NaN,
        Q3: (ucQ3Idx !== undefined) ? _toNum_(row0[ucQ3Idx], NaN) : NaN,
        Q4: (ucQ4Idx !== undefined) ? _toNum_(row0[ucQ4Idx], NaN) : NaN
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1) Load per-game Tier2 fields directly from UpcomingClean (if present)
  // ─────────────────────────────────────────────────────────────
  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    var homeIdx = _col_(hdr, 'home');
    var awayIdx = _col_(hdr, 'away');
    if (homeIdx === undefined || awayIdx === undefined) continue;

    var home = String(row[homeIdx] || '').trim();
    var away = String(row[awayIdx] || '').trim();
    if (!home || !away) continue;

    var key = home.toLowerCase() + ' vs ' + away.toLowerCase();

    var sig = {
      margin: { Q1: null, Q2: null, Q3: null, Q4: null },
      marginConf: { Q1: NaN, Q2: NaN, Q3: NaN, Q4: NaN },
      marginEdge: NaN,

      ou: { Q1: null, Q2: null, Q3: null, Q4: null },
      ouBestDir: null,
      ouHighestEst: '',
      gameTier: ''
    };

    // gameTier (if you store it)
    var gtIdx = _col_(hdr, 'ou-game-tier');
    if (gtIdx !== undefined) sig.gameTier = String(row[gtIdx] || '').trim();

    // margin edge score
    var meIdx = _col_(hdr, 't2-edge-score');
    if (meIdx !== undefined) sig.marginEdge = _normalizeConf_(row[meIdx], NaN);

    // margin per quarter
    for (var qi = 0; qi < QUARTERS_L.length; qi++) {
      var qL = QUARTERS_L[qi];
      var qU = qL.toUpperCase();

      var sigIdx = _col_(hdr, 't2-' + qL);
      var confIdx = _col_(hdr, 't2-' + qL + '-conf');

      if (sigIdx !== undefined) {
        var rawSig = String(row[sigIdx] || '').trim();
        if (rawSig && rawSig !== 'N/A' && rawSig !== 'EVEN') {
          sig.margin[qU] = rawSig;
          if (confIdx !== undefined) sig.marginConf[qU] = _normalizeConf_(row[confIdx], NaN);
        }
      }
    }

    // ou per quarter from UpcomingClean columns if they exist (ou-q1 / ou_q1)
    if (config.includeOUSignals !== false) {
      for (var oqi = 0; oqi < QUARTERS_L.length; oqi++) {
        var oqL = QUARTERS_L[oqi];
        var oqU = oqL.toUpperCase();

        var ouIdx = _col_(hdr, 'ou-' + oqL);
        if (ouIdx === undefined) ouIdx = _col_(hdr, 'ou_' + oqL);
        if (ouIdx === undefined) continue;

        var ouRaw = String(row[ouIdx] || '').trim();
        if (!ouRaw) continue;

        var parsed = (typeof _parseOUSignal === 'function') ? _parseOUSignal(ouRaw) : null;
        if (!parsed) parsed = _parseOUSignalRobust_(ouRaw);
        if (!parsed) continue;

        if (parsed.dir && !parsed.direction) parsed.direction = parsed.dir;
        parsed.direction = _normOuDir_(parsed.direction);
        if (!parsed.direction) continue;

        // optional conf/ev/edge columns
        var confIdx2 = _col_(hdr, 'ou-' + oqL + '-conf');
        if (confIdx2 === undefined) confIdx2 = _col_(hdr, 'ou_' + oqL + '_conf');
        if (confIdx2 !== undefined) {
          var c2 = _normalizeConf_(row[confIdx2], NaN);
          if (isFinite(c2)) parsed.conf = isFinite(parsed.conf) ? Math.max(parsed.conf, c2) : c2;
        }

        var evIdx = _col_(hdr, 'ou-' + oqL + '-ev');
        if (evIdx === undefined) evIdx = _col_(hdr, 'ou_' + oqL + '_ev');
        if (evIdx !== undefined) {
          var ev2 = _toNum_(row[evIdx], NaN);
          if (isFinite(ev2)) parsed.ev = ev2;
        }

        var edgeIdx = _col_(hdr, 'ou-' + oqL + '-edge');
        if (edgeIdx === undefined) edgeIdx = _col_(hdr, 'ou_' + oqL + '_edge');
        if (edgeIdx !== undefined) {
          var e2 = _toNum_(row[edgeIdx], NaN);
          if (isFinite(e2)) parsed.edge = e2;
        }

        sig.ou[oqU] = parsed;
      }
    }

    signals[key] = sig;
  }

  // ─────────────────────────────────────────────────────────────
  // 2) OU_Log FALLBACK (critical fix: reads Prediction/Confidence/EV_Percent/Threshold columns)
  // ─────────────────────────────────────────────────────────────
  if (config.includeOUSignals !== false) {
    var hasAnyOU = Object.keys(signals).some(function(k) {
      var s = signals[k] && signals[k].ou;
      return s && (s.Q1 || s.Q2 || s.Q3 || s.Q4);
    });

    if (!hasAnyOU) {
      var ouLogSheet = (typeof _getSheet === 'function') ? _getSheet(ss, 'OU_Log') : ss.getSheetByName('OU_Log');
      if (!ouLogSheet) return signals;

      var ouData = ouLogSheet.getDataRange().getValues();
      if (!ouData || ouData.length < 2) return signals;

      var ouHdr = _headerMapRobust_(ouData[0]);

      // OU_Log columns: Home, Away, Quarter, Threshold, Prediction, Confidence, EV_Percent, Edge_Score, Expected_Q
      var ouHomeIdx  = _col_(ouHdr, 'home');
      var ouAwayIdx  = _col_(ouHdr, 'away');
      var ouQIdx     = _col_(ouHdr, 'quarter');
      if (ouQIdx === undefined) ouQIdx = _col_(ouHdr, 'period');

      var ouDirIdx   = _col_(ouHdr, 'prediction');
      if (ouDirIdx === undefined) ouDirIdx = _col_(ouHdr, 'pick_code');
      if (ouDirIdx === undefined) ouDirIdx = _col_(ouHdr, 'direction');

      var ouLineIdx  = _col_(ouHdr, 'threshold');
      if (ouLineIdx === undefined) ouLineIdx = _col_(ouHdr, 'line');

      var ouConfIdx  = _col_(ouHdr, 'confidence');
      if (ouConfIdx === undefined) ouConfIdx = _col_(ouHdr, 'confidence_pct');

      var ouEvIdx    = _col_(ouHdr, 'ev_percent');
      if (ouEvIdx === undefined) ouEvIdx = _col_(ouHdr, 'ev');

      var ouEdgeIdx  = _col_(ouHdr, 'edge_score');
      if (ouEdgeIdx === undefined) ouEdgeIdx = _col_(ouHdr, 'edge');

      var ouExpIdx   = _col_(ouHdr, 'expected_q');
      if (ouExpIdx === undefined) ouExpIdx = _col_(ouHdr, 'expected');

      if (ouHomeIdx === undefined || ouAwayIdx === undefined || ouQIdx === undefined) return signals;

      for (var r1 = 1; r1 < ouData.length; r1++) {
        var ouRow = ouData[r1];
        var ouHome = String(ouRow[ouHomeIdx] || '').trim();
        var ouAway = String(ouRow[ouAwayIdx] || '').trim();
        if (!ouHome || !ouAway) continue;

        var ouKey = ouHome.toLowerCase() + ' vs ' + ouAway.toLowerCase();

        var qRaw = String(ouRow[ouQIdx] || '').trim().toUpperCase();
        if (!/^Q[1-4]$/.test(qRaw)) continue;

        var dirRaw = (ouDirIdx !== undefined) ? String(ouRow[ouDirIdx] || '').trim() : '';
        var dir = _normOuDir_(dirRaw);
        if (!dir) continue;

        var line0 = (ouLineIdx !== undefined) ? _toNum_(ouRow[ouLineIdx], NaN) : NaN;
        if (!isFinite(line0) || line0 <= 0) continue;

        var conf0 = (ouConfIdx !== undefined) ? _normalizeConf_(ouRow[ouConfIdx], NaN) : NaN;
        var ev0   = (ouEvIdx !== undefined) ? _toNum_(ouRow[ouEvIdx], NaN) : NaN;
        var edge0 = (ouEdgeIdx !== undefined) ? _toNum_(ouRow[ouEdgeIdx], NaN) : NaN;
        var exp0  = (ouExpIdx !== undefined) ? _toNum_(ouRow[ouExpIdx], NaN) : NaN;

        var ouParsed = {
          direction: dir,
          line: line0,
          bookLine: null,
          conf: conf0,
          ev: ev0,
          edge: edge0,
          expected: exp0,
          star: false
        };

        // If Edge_Score is missing, compute from expected-vs-line
        if ((!isFinite(ouParsed.edge) || ouParsed.edge === 0) && isFinite(exp0)) {
          ouParsed.edge = (dir === 'OVER') ? (exp0 - line0) : (line0 - exp0);
        }

        // Ensure base node exists
        if (!signals[ouKey]) {
          signals[ouKey] = {
            margin: { Q1: null, Q2: null, Q3: null, Q4: null },
            marginConf: { Q1: NaN, Q2: NaN, Q3: NaN, Q4: NaN },
            marginEdge: NaN,
            ou: { Q1: null, Q2: null, Q3: null, Q4: null },
            ouBestDir: null,
            ouHighestEst: '',
            gameTier: ''
          };
        }

        // Only set if missing (don't overwrite UpcomingClean data)
        if (!signals[ouKey].ou[qRaw]) {
          signals[ouKey].ou[qRaw] = ouParsed;
        }

        // Override with UpcomingClean book line for this quarter
        var ucQEntry = ucQLines[ouKey];
        if (ucQEntry && isFinite(ucQEntry[qRaw]) && ucQEntry[qRaw] > 0) {
          signals[ouKey].ou[qRaw].line = ucQEntry[qRaw];
          signals[ouKey].ou[qRaw].bookLine = ucQEntry[qRaw];

          // Recompute edge vs book line if expected exists
          var expX = signals[ouKey].ou[qRaw].expected;
          if (isFinite(expX)) {
            var bl = ucQEntry[qRaw];
            signals[ouKey].ou[qRaw].edge = (dir === 'OVER') ? (expX - bl) : (bl - expX);
          }
        }
      }

      Logger.log('[_loadTier2Signals] OU_Log fallback applied (format: Prediction/Confidence/EV_Percent/Threshold)');
    }
  }

  return signals;
}

function _buildDateLookup(ss) {
  var lookup = {};
  var sheet = _getSheet(ss, 'UpcomingClean');
  if (!sheet) return lookup;

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return lookup;

  var hdr = _headerMap(data[0]);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var home = String(row[hdr['home']] || '').trim().toLowerCase();
    var away = String(row[hdr['away']] || '').trim().toLowerCase();
    var dateVal = row[hdr['date']];
    if (home && away && dateVal) {
      lookup[home + '|' + away] = _formatDate(dateVal);
    }
  }
  return lookup;
}

// =====================================================================
// SELECTION LOGIC
// =====================================================================

function _selectBankers(candidates, config) {
  var bankers = [];
  var threshold = config.bankerThreshold;
  var minOdds = config.minBankerOdds;
  var maxOdds = config.maxBankerOdds;

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var conf = _toNum(c.confidence, 0);
    var odds = _toNum(c.odds, 0);

    if (conf >= threshold && odds >= minOdds && odds <= maxOdds) {
      var ev = odds > 0 ? (odds - 1) * (conf / 100) : 0;
      bankers.push({
        league: c.league,
        date: c.date,
        time: c.time,
        match: c.match,
        pick: c.pick,
        odds: odds > 0 ? odds : '-',
        confidence: conf,
        ev: ev > 0 ? ev.toFixed(3) : 'N/A',
        type: 'BANKER'
      });
    }
  }

  bankers.sort(function(a, b) {
    var evA = parseFloat(a.ev) || 0, evB = parseFloat(b.ev) || 0;
    if (evA !== evB) return evB - evA;
    return b.confidence - a.confidence;
  });

  return bankers;
}

/**
 * ============================================================================
 * PHASE 3 (Module 8) - UNIFIED ACCUMULATOR & HIGH_QTR
 * Version: 3.0.0
 * ============================================================================
 * 
 * INSTALLATION: Replace ALL existing copies of these functions.
 * Do NOT paste multiple versions - only the last definition survives.
 * 
 * Functions (names preserved for compatibility):
 *   _deriveHighestQuarter_(game, marginStats, config, t2)
 *   _selectSnipers(candidates, config, tierCuts)
 *   buildAccumulator(ss)
 *   runAccumulator(ss)
 *   _capSnipersPerGame(snipers, maxPerGame)
 * ============================================================================
 */

// Version check - prevents double-loading issues
var _MODULE_8_VERSION_ = '3.0.0';


/* ============================================================================
 * INTERNAL HELPERS (prefixed to avoid collisions)
 * ============================================================================ */

function _m8_toNum_(v, fallback) {
  if (typeof _toNum === 'function') return _toNum(v, fallback);
  var n = Number(String(v == null ? '' : v).replace(/[%,]/g, '').trim());
  return isFinite(n) ? n : (fallback != null ? fallback : 0);
}

function _m8_getTier_(conf, cuts) {
  if (typeof _getTier === 'function') return _getTier(conf, cuts);
  conf = _m8_toNum_(conf, 0);
  if (conf >= 75) return 'STRONG';
  if (conf >= 65) return 'MEDIUM';
  if (conf >= 55) return 'WEAK';
  return 'EVEN';
}

function _m8_alignPick_(pick, tier) {
  if (typeof _alignPick === 'function') return _alignPick(pick, tier);
  return String(pick || '');
}

function m8_normOUPickKey(matchKey, pick) {
  if (typeof _normOUPickKey === 'function') return _normOUPickKey(matchKey, pick);

  var s = String(pick || '').toUpperCase();
  
  // Strip symbols and brackets FIRST
  s = s.replace(/[★●○⭐]/g, ' ')
       .replace(/\([^)]*\)/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();

  var m = s.match(/(Q[1-4])\s*[:\-]?\s*(OVER|UNDER)\s+([\d.]+)/i);

  if (!m) {
    return String(matchKey || '').trim().toLowerCase() + '|RAW|' + s;
  }

  var lineNum = parseFloat(m[3]);
  var line = isFinite(lineNum) ? (Math.round(lineNum * 10) / 10).toFixed(1) : 'NaN';

  return String(matchKey || '').trim().toLowerCase() + '|' + m[1] + '|' + m[2] + '|' + line;
}

function _m8_normOUPickKey_(matchKey, pick) {
  // Delegate to public version for consistency
  return m8_normOUPickKey(matchKey, pick);
}

function _m8_normMatch_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+vs\.?\s+/gi, ' vs ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _m8_stdDev_(arr) {
  if (!arr || arr.length < 2) return 0;
  var sum = 0, len = arr.length;
  for (var i = 0; i < len; i++) sum += arr[i];
  var mean = sum / len;
  var variance = 0;
  for (var j = 0; j < len; j++) {
    var d = arr[j] - mean;
    variance += d * d;
  }
  return Math.sqrt(variance / len);
}

function _m8_clamp_(x, lo, hi) {
  x = Number(x);
  return isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;
}

function _m8_headerMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var k = String(headerRow[i] || '').toLowerCase().trim();
    if (k) map[k] = i;
  }
  return map;
}

function _m8_parseConf_(raw) {
  if (raw == null || raw === '') return 0;
  var s = String(raw);
  var range = s.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return Math.max(parseFloat(range[1]), parseFloat(range[2]));
  return parseFloat(s.replace('%', '')) || 0;
}



/* ============================================================================
 * COMPANION DIAGNOSTIC FUNCTION
 * ============================================================================
 * Call this separately to diagnose marginStats population issues
 */
function diagnoseMarginStats_(marginStats, ss) {
  var FN = 'diagnoseMarginStats_';
  
  Logger.log('[' + FN + '] ═══════════════════════════════════════════════════════════════');
  Logger.log('[' + FN + '] MARGINSTATS DIAGNOSTIC REPORT');
  Logger.log('[' + FN + '] ═══════════════════════════════════════════════════════════════');
  
  // 1. Basic type check
  Logger.log('[' + FN + '] Type: ' + typeof marginStats);
  Logger.log('[' + FN + '] Is null: ' + (marginStats === null));
  Logger.log('[' + FN + '] Is undefined: ' + (marginStats === undefined));
  
  if (!marginStats || typeof marginStats !== 'object') {
    Logger.log('[' + FN + '] CRITICAL: marginStats is not a valid object!');
    return { valid: false, reason: 'not_an_object' };
  }
  
  // 2. Key analysis
  var keys = [];
  try { keys = Object.keys(marginStats); } catch (e) {
    Logger.log('[' + FN + '] ERROR getting keys: ' + e.message);
    return { valid: false, reason: 'keys_error', error: e.message };
  }
  
  Logger.log('[' + FN + '] Total keys: ' + keys.length);
  
  if (keys.length === 0) {
    Logger.log('[' + FN + '] CRITICAL: marginStats is EMPTY!');
    Logger.log('[' + FN + '] This means the stats loading function returned empty data.');
    Logger.log('[' + FN + '] Check: buildMarginStats_(), loadQuarterlyStats_(), or similar');
    return { valid: false, reason: 'empty_object', keyCount: 0 };
  }
  
  // 3. Key format analysis
  Logger.log('[' + FN + '] First 10 keys: ' + JSON.stringify(keys.slice(0, 10)));
  Logger.log('[' + FN + '] Last 5 keys: ' + JSON.stringify(keys.slice(-5)));
  
  // Check for case patterns
  var lowercaseKeys = keys.filter(function(k) { return k === k.toLowerCase(); });
  var uppercaseKeys = keys.filter(function(k) { return k === k.toUpperCase(); });
  var mixedKeys = keys.filter(function(k) { return k !== k.toLowerCase() && k !== k.toUpperCase(); });
  
  Logger.log('[' + FN + '] Key case analysis:');
  Logger.log('[' + FN + ']   - All lowercase: ' + lowercaseKeys.length);
  Logger.log('[' + FN + ']   - All uppercase: ' + uppercaseKeys.length);
  Logger.log('[' + FN + ']   - Mixed case: ' + mixedKeys.length);
  
  if (mixedKeys.length > 0) {
    Logger.log('[' + FN + ']   - Mixed case samples: ' + JSON.stringify(mixedKeys.slice(0, 5)));
  }
  
  // 4. Value structure analysis
  var firstKey = keys[0];
  var firstValue = marginStats[firstKey];
  
  Logger.log('[' + FN + '] Sample entry analysis for key: "' + firstKey + '"');
  Logger.log('[' + FN + ']   - Value type: ' + typeof firstValue);
  
  if (firstValue && typeof firstValue === 'object') {
    var valueKeys = Object.keys(firstValue);
    Logger.log('[' + FN + ']   - Value keys: ' + JSON.stringify(valueKeys.slice(0, 20)));
    
    // Check for expected quarterly data structure
    var hasQ1 = firstValue.hasOwnProperty('Q1') || firstValue.hasOwnProperty('q1');
    var hasQuarters = firstValue.hasOwnProperty('quarters');
    var hasMargin = firstValue.hasOwnProperty('margin') || firstValue.hasOwnProperty('avgMargin');
    
    Logger.log('[' + FN + ']   - Has Q1 property: ' + hasQ1);
    Logger.log('[' + FN + ']   - Has quarters property: ' + hasQuarters);
    Logger.log('[' + FN + ']   - Has margin property: ' + hasMargin);
    
    if (firstValue.Q1 !== undefined) {
      Logger.log('[' + FN + ']   - Q1 value: ' + JSON.stringify(firstValue.Q1));
    }
    if (firstValue.quarters !== undefined) {
      Logger.log('[' + FN + ']   - quarters value: ' + JSON.stringify(firstValue.quarters));
    }
  }
  
  // 5. NBA team coverage check
  var nbaTeams = [
    'atlanta hawks', 'boston celtics', 'brooklyn nets', 'charlotte hornets',
    'chicago bulls', 'cleveland cavaliers', 'dallas mavericks', 'denver nuggets',
    'detroit pistons', 'golden state warriors', 'houston rockets', 'indiana pacers',
    'los angeles clippers', 'los angeles lakers', 'memphis grizzlies', 'miami heat',
    'milwaukee bucks', 'minnesota timberwolves', 'new orleans pelicans', 'new york knicks',
    'oklahoma city thunder', 'orlando magic', 'philadelphia 76ers', 'phoenix suns',
    'portland trail blazers', 'sacramento kings', 'san antonio spurs', 'toronto raptors',
    'utah jazz', 'washington wizards'
  ];
  
  var keysLower = keys.map(function(k) { return k.toLowerCase(); });
  var foundTeams = [];
  var missingTeams = [];
  
  nbaTeams.forEach(function(team) {
    var found = keysLower.indexOf(team) !== -1;
    if (!found) {
      // Try partial match
      found = keysLower.some(function(k) { return k.indexOf(team) !== -1 || team.indexOf(k) !== -1; });
    }
    if (found) {
      foundTeams.push(team);
    } else {
      missingTeams.push(team);
    }
  });
  
  Logger.log('[' + FN + '] NBA team coverage: ' + foundTeams.length + '/' + nbaTeams.length);
  if (missingTeams.length > 0 && missingTeams.length <= 10) {
    Logger.log('[' + FN + '] Missing teams: ' + JSON.stringify(missingTeams));
  } else if (missingTeams.length > 10) {
    Logger.log('[' + FN + '] Missing teams (sample): ' + JSON.stringify(missingTeams.slice(0, 10)));
    Logger.log('[' + FN + '] ... and ' + (missingTeams.length - 10) + ' more');
  }
  
  // 6. Check if spreadsheet has the expected data sheets
  if (ss) {
    Logger.log('[' + FN + '] Checking spreadsheet for data sheets...');
    var sheets = ss.getSheets();
    var sheetNames = sheets.map(function(s) { return s.getName(); });
    
    var expectedSheets = ['CleanH2H', 'CleanRecent', 'Standings', 'TeamStats', 'QuarterStats'];
    expectedSheets.forEach(function(name) {
      var found = sheetNames.some(function(sn) { 
        return sn.toLowerCase().indexOf(name.toLowerCase()) !== -1; 
      });
      Logger.log('[' + FN + ']   - ' + name + ': ' + (found ? 'FOUND' : 'MISSING'));
    });
  }
  
  Logger.log('[' + FN + '] ═══════════════════════════════════════════════════════════════');
  
  return {
    valid: keys.length > 0,
    keyCount: keys.length,
    casePattern: mixedKeys.length > lowercaseKeys.length ? 'mixed' : 'lowercase',
    nbaTeamCoverage: foundTeams.length + '/' + nbaTeams.length,
    missingTeams: missingTeams,
    sampleKey: firstKey,
    sampleValueStructure: firstValue ? Object.keys(firstValue).slice(0, 10) : null
  };
}



function _m8_tierBonus_(gameTier) {
  if (/STRONG/i.test(gameTier)) return 5000;
  if (/MEDIUM/i.test(gameTier)) return 2000;
  return 0;
}

/**
 * MASTER sanitization function for quarter values.
 * Extracts FIRST valid quarter from any string containing Q1-Q4.
 * 
 * @param {*} value - Any value that might contain quarter(s)
 * @return {Object} { quarter, valid, wasSanitized, original, reason }
 */
function _acc_sanitizeHighestQuarter(value) {
  var result = {
    quarter: 'N/A',
    valid: false,
    wasSanitized: false,
    original: value,
    reason: ''
  };
  
  if (value === null || value === undefined || value === '') {
    result.reason = 'empty';
    return result;
  }
  
  var str = String(value).trim().toUpperCase();
  
  // Already valid single quarter?
  if (/^Q[1-4]$/.test(str)) {
    result.quarter = str;
    result.valid = true;
    result.reason = 'already_valid';
    return result;
  }
  
  // Detect if this looks like a tie/multi-quarter situation
  var looksLikeTie = /( OR |[\/&,]|TIE)/i.test(str);
  
  // Extract FIRST valid quarter from compound values
  var match = str.match(/Q([1-4])/);
  if (match) {
    result.quarter = 'Q' + match[1];
    result.valid = true;
    result.wasSanitized = true;
    result.reason = looksLikeTie ? 'tie_resolved' : 'extracted';
    
    if (looksLikeTie) {
      Logger.log('[_acc_sanitizeHighestQuarter] TIE FIX: "' + value + '" → "' + result.quarter + '"');
    }
    return result;
  }
  
  result.reason = 'no_quarter_found';
  return result;
}

/**
 * Sanitizes pick TEXT that may contain tie patterns.
 * E.g., "Highest Q: Q1 or Q3" → "Highest Q: Q1"
 * 
 * @param {string} pickText - Raw pick text
 * @return {string} Sanitized pick text
 */
function _acc_sanitizePickText(pickText) {
  if (!pickText) return pickText;
  
  var str = String(pickText);
  var upper = str.toUpperCase();
  
  // Only process if it looks like a Highest Quarter pick with potential tie
  var isHighestQ = upper.indexOf('HIGHEST') >= 0 || 
                   (upper.indexOf('HIGH') >= 0 && upper.indexOf('QTR') >= 0);
  
  if (!isHighestQ) return str;
  
  // Check for tie patterns
  var hasTie = / OR /i.test(str) || 
               /Q[1-4]\s*[\/&,]\s*Q[1-4]/i.test(str) ||
               /TIE/i.test(str);
  
  if (!hasTie) return str;
  
  // Extract first quarter and rebuild
  var s = _acc_sanitizeHighestQuarter(str);
  if (s.valid) {
    var fixed = 'Highest Q: ' + s.quarter;
    Logger.log('[_acc_sanitizePickText] FIXED: "' + pickText + '" → "' + fixed + '"');
    return fixed;
  }
  
  return str;
}

/**
 * Checks if a pick object is a Highest Quarter sniper pick.
 */
function _acc_isHighestQuarterPick(p) {
  if (!p || typeof p !== 'object') return false;
  
  // Explicit flag
  if (p.isHighQtr === true) return true;
  
  // Signal type / type field
  var st = String(p.signalType || '').toUpperCase();
  var ty = String(p.type || '').toUpperCase();
  
  if (st.indexOf('HIGH_QTR') >= 0) return true;
  if (st.indexOf('HIGH') >= 0 && st.indexOf('QTR') >= 0) return true;
  if (ty.indexOf('HIGH') >= 0 && ty.indexOf('QTR') >= 0) return true;
  
  // Pick text heuristics
  var pk = String(p.pick || '').toUpperCase();
  if (pk.indexOf('HIGHEST') >= 0 && pk.indexOf('Q') >= 0) return true;
  
  return false;
}

/**
 * Sanitizes a single pick object IN-PLACE.
 * Returns the same object (mutated) for chaining.
 */
function _acc_sanitizePickObject(p) {
  if (!p || typeof p !== 'object') return p;
  
  // Only process Highest Quarter picks
  if (!_acc_isHighestQuarterPick(p)) return p;
  
  var rawPick = String(p.pick || '');
  var s = _acc_sanitizeHighestQuarter(rawPick);
  
  if (!s.valid) return p;
  
  // Check if tie was detected
  var wasTie = s.wasSanitized && s.reason === 'tie_resolved';
  
  // Standardize the pick text
  p.pick = 'Highest Q: ' + s.quarter;
  
  // Ensure proper flags
  p.signalType = p.signalType || 'HIGH_QTR';
  p.type = p.type || 'SNIPER HIGH QTR';
  p.isHighQtr = true;
  
  // Confidence penalty for ties (cap at 55%)
  if (wasTie && p.confidence != null) {
    var conf = parseFloat(String(p.confidence).replace('%', ''));
    if (isFinite(conf)) {
      p.confidence = Math.min(conf, 55);
      p.wasTie = true;
    }
  }
  
  return p;
}

/**
 * Sanitizes an entire picks bundle (all arrays).
 */
function _acc_sanitizePicksBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return bundle;
  
  var arrays = ['snipers', 'bankers', 'robbers', 'firstHalves', 'ftOUs'];
  
  for (var i = 0; i < arrays.length; i++) {
    var arr = bundle[arrays[i]];
    if (!Array.isArray(arr)) continue;
    
    for (var j = 0; j < arr.length; j++) {
      _acc_sanitizePickObject(arr[j]);
    }
  }
  
  return bundle;
}


// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 2: _deriveHighestQuarter_ (PATCHED)                                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝

/**
Derives highest quarter from available data sources.
ALWAYS returns a single quarter via sanitization.
Priority:
1) predictHighestQuarterEnhanced (if available)
2) T2 signals (ou-highest-est field)
3) marginStats derived calculation
*/
function _deriveHighestQuarter_(game, marginStats, config, t2) {
  var fn = '_deriveHighestQuarter_';

  function has_(obj, k) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, k);
  }

  function pick_(obj, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return fallback;
  }

  var skipResult = {
    quarter: 'N/A',
    pick: null,
    confidence: 0,
    source: 'skip',
    wasTie: false,
    tiedWith: null,
    // pass-through fields (so gatekeepers don’t see missing-as-zero)
    pWin: null,
    reliability: null,
    pQ1: null, pQ2: null, pQ3: null, pQ4: null,
    expectedTotal: null,
    dominant: null,
    dominantStrength: null,
    tier: null,
    tierDisplay: null,
    sourceMeta: null,
    modelObject: null
  };

  game = game || {};
  config = config || {};
  marginStats = marginStats || {};
  t2 = t2 || null;

  if (!game || !game.home || !game.away) return skipResult;

  var home = String(game.home).trim();
  var away = String(game.away).trim();
  if (!home || !away) return skipResult;

  // ───────────────────────────────────────────────
  // METHOD 1: Enhanced predictor
  // ───────────────────────────────────────────────
  if (typeof predictHighestQuarterEnhanced === 'function') {
    try {
      var hqPred = predictHighestQuarterEnhanced(game, marginStats, config);
      if (hqPred && !hqPred.skip && hqPred.quarter && hqPred.quarter !== 'N/A') {
        var s = _acc_sanitizeHighestQuarter(hqPred.quarter);
        if (s && s.valid) {
          var out = {
            quarter: s.quarter,
            pick: 'Highest Q: ' + s.quarter,
            confidence: (hqPred.confidence != null ? hqPred.confidence : 55),
            source: 'Elite_HQ' + (s.wasSanitized ? '_SANITIZED' : ''),
            wasTie: !!(hqPred.wasTie || s.wasSanitized),
            tiedWith: hqPred.tiedWith || null,

            // NEW: preserve model metrics for gating/sorting/debug
            pWin: null,
            reliability: null,
            pQ1: null, pQ2: null, pQ3: null, pQ4: null,
            expectedTotal: (hqPred.expectedTotal != null ? hqPred.expectedTotal : null),
            dominant: (hqPred.dominant != null ? hqPred.dominant : null),
            dominantStrength: (hqPred.dominantStrength != null ? hqPred.dominantStrength : null),
            tier: (hqPred.tier != null ? hqPred.tier : null),
            tierDisplay: (hqPred.tierDisplay != null ? hqPred.tierDisplay : null),
            sourceMeta: (hqPred.sourceMeta != null ? hqPred.sourceMeta : null),
            modelObject: (hqPred.modelObject != null ? hqPred.modelObject : null)
          };

          // pWin aliases
          if (has_(hqPred, 'pWin')) out.pWin = hqPred.pWin;
          else if (has_(hqPred, 'pwin')) out.pWin = hqPred.pwin;

          // reliability aliases
          if (has_(hqPred, 'reliability')) out.reliability = hqPred.reliability;
          else if (has_(hqPred, 'reliab')) out.reliability = hqPred.reliab;
          else if (has_(hqPred, 'rel')) out.reliability = hqPred.rel;

          // quarter prob aliases
          if (has_(hqPred, 'pQ1')) out.pQ1 = hqPred.pQ1;
          if (has_(hqPred, 'pQ2')) out.pQ2 = hqPred.pQ2;
          if (has_(hqPred, 'pQ3')) out.pQ3 = hqPred.pQ3;
          if (has_(hqPred, 'pQ4')) out.pQ4 = hqPred.pQ4;

          // Optional raw payload for diagnostics (off by default)
          if (config && (config.hqReturnRaw === true || config.hq_return_raw === true)) {
            out._hqRaw = hqPred;
          }

          return out;
        }
      }
    } catch (e) {
      Logger.log('[' + fn + '] Elite error: ' + (e && e.message ? e.message : e));
    }
  }

  // ───────────────────────────────────────────────
  // METHOD 2: Tier2 signals (ouHighestEst, etc.)
  // ───────────────────────────────────────────────
  if (t2) {
    var candidates = [
      t2.ouHighestEst, t2['ou-highest-est'], t2.highestQuarter, t2.highestQ
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;

      var s2 = _acc_sanitizeHighestQuarter(String(candidates[i]));
      if (s2 && s2.valid) {
        return {
          quarter: s2.quarter,
          pick: 'Highest Q: ' + s2.quarter,
          confidence: (t2.highestQConf != null ? t2.highestQConf : 55),
          source: 'T2_Signal' + (s2.wasSanitized ? '_SANITIZED' : ''),
          wasTie: !!s2.wasSanitized,
          tiedWith: null,

          // keep fields present but unknown here
          pWin: null,
          reliability: null,
          pQ1: null, pQ2: null, pQ3: null, pQ4: null,
          expectedTotal: null,
          dominant: null,
          dominantStrength: null,
          tier: null,
          tierDisplay: null,
          sourceMeta: null,
          modelObject: null
        };
      }
    }

    // If you store per-quarter confidence and want a fallback:
    if (t2.marginConf && typeof t2.marginConf === 'object') {
      var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
      var bestQ = null, bestConf = 0;

      for (var qi = 0; qi < quarters.length; qi++) {
        var q = quarters[qi];
        var conf = t2.marginConf[q];
        if (typeof conf === 'number' && conf > bestConf) {
          bestConf = conf;
          bestQ = q;
        }
      }

      if (bestQ && bestConf > 50) {
        return {
          quarter: bestQ,
          pick: 'Highest Q: ' + bestQ,
          confidence: bestConf,
          source: 'T2_MarginConf',
          wasTie: false,
          tiedWith: null,

          pWin: null,
          reliability: null,
          pQ1: null, pQ2: null, pQ3: null, pQ4: null,
          expectedTotal: null,
          dominant: null,
          dominantStrength: null,
          tier: null,
          tierDisplay: null,
          sourceMeta: null,
          modelObject: null
        };
      }
    }
  }

  // ───────────────────────────────────────────────
  // METHOD 3: Derive from marginStats (as seen in your PDF snippet)
  // ───────────────────────────────────────────────
  try {
    if (marginStats && typeof marginStats === 'object') {
      var homeKey = home, awayKey = away;
      if (typeof t2_teamKeyCanonical === 'function') {
        homeKey = t2_teamKeyCanonical(home);
        awayKey = t2_teamKeyCanonical(away);
      }

      var homeStats = marginStats[homeKey] || marginStats[home] || marginStats[String(home).toLowerCase()];
      var awayStats = marginStats[awayKey] || marginStats[away] || marginStats[String(away).toLowerCase()];

      if (homeStats && awayStats) {
        var qs = ['Q1', 'Q2', 'Q3', 'Q4'];
        var scores = [];

        for (var j = 0; j < qs.length; j++) {
          var Q = qs[j];
          var homeAvg = 55, awayAvg = 55;

          if (homeStats.Home && homeStats.Home[Q]) {
            homeAvg = homeStats.Home[Q].avgTotal || homeStats.Home[Q].mean || 55;
          }
          if (awayStats.Away && awayStats.Away[Q]) {
            awayAvg = awayStats.Away[Q].avgTotal || awayStats.Away[Q].mean || 55;
          }

          scores.push({ quarter: Q, total: homeAvg + awayAvg });
        }

        scores.sort(function(a, b) { return b.total - a.total; });

        if (scores.length > 0) {
          var wasTie = (scores.length > 1) && (Math.abs(scores[0].total - scores[1].total) < 1.5);
          return {
            quarter: scores[0].quarter,
            pick: 'Highest Q: ' + scores[0].quarter,
            confidence: wasTie ? 52 : 58,
            source: 'MarginStats_Derived',
            wasTie: wasTie,
            tiedWith: wasTie ? [scores[0].quarter, scores[1].quarter] : null,

            pWin: null,
            reliability: null,
            pQ1: null, pQ2: null, pQ3: null, pQ4: null,
            expectedTotal: scores[0].total,
            dominant: null,
            dominantStrength: null,
            tier: null,
            tierDisplay: null,
            sourceMeta: null,
            modelObject: null
          };
        }
      }
    }
  } catch (e3) {
    Logger.log('[' + fn + '] marginStats derive error: ' + (e3 && e3.message ? e3.message : e3));
  }

  return skipResult;
}

// Back-compat name used elsewhere in your codebase/PDFs:
function deriveHighestQuarter(game, marginStats, config, t2) {
  return _deriveHighestQuarter_(game, marginStats, config, t2);
}



function _acc_installWriteWrapper_() {
  try {
    if (typeof _writeBetSlipsEnhanced !== 'function') {
      Logger.log('[ACC-WRAP] _writeBetSlipsEnhanced not found, skipping wrapper');
      return false;
    }
    
    if (_writeBetSlipsEnhanced._accSanitized === true) {
      return true; // Already wrapped
    }
    
    var originalFn = _writeBetSlipsEnhanced;
    
    _writeBetSlipsEnhanced = function(ss, bundle, config, tierCuts, enhEnabled) {
      // Sanitize bundle BEFORE writing
      try {
        _acc_sanitizePicksBundle(bundle);
        Logger.log('[ACC-WRAP] Pre-write sanitization applied');
      } catch (e) {
        Logger.log('[ACC-WRAP] Pre-sanitize error (non-fatal): ' + e.message);
      }
      
      return originalFn(ss, bundle, config, tierCuts, enhEnabled);
    };
    
    _writeBetSlipsEnhanced._accSanitized = true;
    Logger.log('[ACC-WRAP] Installed sanitization wrapper on _writeBetSlipsEnhanced');
    return true;
    
  } catch (e) {
    Logger.log('[ACC-WRAP] Install failed: ' + e.message);
    return false;
  }
}


// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 4: LAYER 4 - POST-WRITE SHEET SCRUB                                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝
/**
 * Scans bet slip sheets and sanitizes any remaining Highest-Q tie strings.
 * Final safety net for any legacy paths.
 *
 * [PATCH Step 5]: Tied HQ picks containing "OR" are now BLANKED OUT
 *                 instead of forcing one side via _acc_sanitizeHighestQuarter.
 */
function _acc_scrubBetSlipsSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, touched: 0, reason: 'no_ss' };
  
  var sheetNames = ['BET_SLIPS', 'Bet_Slips', 'BetSlips', 'BETSLIPS', 'Accumulator'];
  var touched = 0;
  var blanked = 0;
  
  for (var si = 0; si < sheetNames.length; si++) {
    var sheet = null;
    
    // Case-insensitive lookup
    var allSheets = ss.getSheets();
    var target = sheetNames[si].toLowerCase();
    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().toLowerCase() === target) {
        sheet = allSheets[i];
        break;
      }
    }
    
    if (!sheet) continue;
    
    var range = sheet.getDataRange();
    var values = range.getValues();
    var modified = false;
    
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        var cell = values[r][c];
        if (!cell) continue;
        
        var txt = String(cell);
        var upper = txt.toUpperCase();

        // ── TIE SCRUB FIX (Step 5) ────────────────────────────────
        // If an HQ pick contains "OR" (tied quarters), blank it out
        // instead of forcing one side
        if (/highest\s*q/i.test(txt) && /\bOR\b/i.test(txt)) {
          Logger.log('[SCRUB] Removing tied HQ pick: ' + txt);
          values[r][c] = '';
          modified = true;
          blanked++;
          continue;
        }
        // ── END TIE SCRUB FIX ─────────────────────────────────────
        
        // Only target Highest Quarter cells with non-OR tie patterns
        var isHighestQ = upper.indexOf('HIGHEST') >= 0 || 
                        (upper.indexOf('HIGH') >= 0 && upper.indexOf('QTR') >= 0);
        
        if (!isHighestQ) continue;
        
        // Remaining tie patterns (slash, ampersand, comma, explicit TIE label)
        var hasTie = /[\/&,]/.test(txt) || 
                     /TIE/i.test(txt);
        
        if (!hasTie) continue;
        
        var s = _acc_sanitizeHighestQuarter(txt);
        if (s.valid) {
          values[r][c] = 'Highest Q: ' + s.quarter;
          modified = true;
          touched++;
          Logger.log('[ACC-SCRUB] Fixed R' + (r+1) + 'C' + (c+1) + ': "' + txt + '" → "' + values[r][c] + '"');
        }
      }
    }
    
    if (modified) {
      range.setValues(values);
      Logger.log('[ACC-SCRUB] Sheet "' + sheet.getName() + '" updated — touched=' + touched + ', blanked=' + blanked);
    }
  }
  
  return { ok: true, touched: touched, blanked: blanked };
}

// ─────────────────────────────────────────────────────────────
// enh-high-q cache (UpcomingClean) — GLOBAL (paste once)
// ─────────────────────────────────────────────────────────────
var _ucEnhCache = null;

function _loadUpcomingCleanEnhColumns(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (_ucEnhCache !== null) return _ucEnhCache;

  _ucEnhCache = {};

  var ucSheet = ss.getSheetByName('UpcomingClean');
  if (!ucSheet) {
    Logger.log('[UpcomingClean] not found — cannot load enh-high-q columns');
    return _ucEnhCache;
  }

  var ucData = ucSheet.getDataRange().getValues();
  if (!ucData || ucData.length < 2) return _ucEnhCache;

  function normKey_(s) {
    return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  }

  function headerMap_(headers) {
    var m = {};
    for (var i = 0; i < headers.length; i++) {
      var raw = String(headers[i] || '').toLowerCase().trim();
      if (!raw) continue;

      // Multiple normalized forms
      var k1 = raw;
      var k2 = raw.replace(/[\s_]+/g, '_');
      var k3 = raw.replace(/-/g, '_');
      var k4 = raw.replace(/[\s_-]+/g, '');
      var k5 = normKey_(raw);

      m[k1] = i;
      m[k2] = i;
      m[k3] = i;
      m[k4] = i;
      m[k5] = i;
    }
    return m;
  }

  function toNum_(v, d) {
    if (v === null || v === undefined || v === '') return d;
    var s = String(v).replace('%', '').trim().replace(/[^\d.-]/g, '');
    var n = Number(s);
    return isFinite(n) ? n : d;
  }

  function toBool_(v, d) {
    if (v === true || v === false) return v;
    var s = String(v || '').toLowerCase().trim();
    if (s === 'true' || s === 'yes' || s === '1' || s === 'on') return true;
    if (s === 'false' || s === 'no' || s === '0' || s === 'off') return false;
    return d;
  }

  function normQuarter_(v) {
    var s = String(v || '').toUpperCase().trim();
    if (!s) return '';
    if (/^Q[1-4]$/.test(s)) return s;
    if (/^[1-4]$/.test(s)) return 'Q' + s;
    var m = s.match(/Q\s*([1-4])/);
    return m ? ('Q' + m[1]) : '';
  }

  var map = headerMap_(ucData[0]);

  var homeIdx = map['home'];
  var awayIdx = map['away'];

  var enhQIdx    = map['enh_high_q'] || map['enh-high-q'] || map['enhhighq'];
  var enhConfIdx = map['enh_high_q_conf'] || map['enh-high-q-conf'] || map['enhhighqconf'];
  var enhEvIdx   = map['enh_high_q_ev'] || map['enh-high-q-ev'] || map['enhhighqev'];
  var enhPwinIdx = map['enh_high_q_pwin'] || map['enh-high-q-pwin'] || map['enhhighqpwin'];
  var enhRelIdx  = map['enh_high_q_reliability'] || map['enh-high-q-reliability'] || map['enhhighqreliability'];
  var enhTieIdx  = map['enh_high_q_tie'] || map['enh-high-q-tie'] || map['enhhighqtie'];

  if (homeIdx === undefined || awayIdx === undefined || enhQIdx === undefined) {
    Logger.log('[UpcomingClean] Missing required columns for enh-high-q cache (need: home, away, enh-high-q)');
    return _ucEnhCache;
  }

  var loaded = 0;

  for (var r = 1; r < ucData.length; r++) {
    var row = ucData[r];

    var home = String(row[homeIdx] || '').trim().toLowerCase();
    var away = String(row[awayIdx] || '').trim().toLowerCase();
    if (!home || !away) continue;

    var q = normQuarter_(row[enhQIdx]);
    if (!q) continue;

    var key = home + ' vs ' + away;

    _ucEnhCache[key] = {
      quarter: q,
      confidence: (enhConfIdx !== undefined) ? toNum_(row[enhConfIdx], 0) : 0,
      ev:         (enhEvIdx   !== undefined) ? toNum_(row[enhEvIdx], 0)   : 0,
      pWin:       (enhPwinIdx !== undefined) ? toNum_(row[enhPwinIdx], 0) : 0,
      reliability:(enhRelIdx  !== undefined) ? toNum_(row[enhRelIdx], 0)  : 0,
      isTie:      (enhTieIdx  !== undefined) ? toBool_(row[enhTieIdx], false) : false
    };

    loaded++;
  }

  Logger.log('[UpcomingClean] Loaded ' + loaded + ' enh-high-q entries');
  return _ucEnhCache;
}

function _getEnhHighQ(ss, homeTeam, awayTeam) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var cache = _loadUpcomingCleanEnhColumns(ss);
  var key = (String(homeTeam) + ' vs ' + String(awayTeam)).toLowerCase();
  return cache[key] || null;
}


// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  buildAccumulator v3.8.2 — CONSOLIDATED FINAL + HQ Gating + enh-high-q Reading                  ║
// ║                                                                                                   ║
// ║  Key Improvements:                                                                                ║
// ║    • FT Score = BOOK LINE (sportsbook O/U)                                                       ║
// ║    • Avg/pred_score = FOREBET PREDICTION (model signal)                                          ║
// ║    • Uses _extractFTBookLine_ and _extractForebetPrediction_ with inline fallbacks               ║
// ║    • PATCHED: Falls back to UpcomingClean for FT line when Analysis_Tier1 lacks Q1-Q4/FT Score   ║
// ║    • PATCH 4A: canonicalizeConfig includes full HQ gating keys                                   ║
// ║    • PATCH 4B: hq_gateCheck_ called before HQ push to sniperCandidates                          ║
// ║    • Enhanced diagnostics with noLine tracking                                                   ║
// ║    • Preserves hyphenated AND normalized header keys                                             ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝

function buildAccumulator(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var FN = 'buildAccumulator';
  var VERSION = 'v3.8.2-CONSOLIDATED-R4B-HQ-GATED';

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function log(msg) {
    Logger.log('[' + FN + '] ' + msg);
  }

  function toNum(v, def) {
    if (v === null || v === undefined || v === '') return def;
    var n = parseFloat(String(v).replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : def;
  }

  function toBool(v, def) {
    if (v === true || v === false) return v;
    var s = String(v || '').trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].indexOf(s) >= 0) return true;
    if (['false', 'no', '0', 'off'].indexOf(s) >= 0) return false;
    return def;
  }

  function getFirst(obj, keys, def) {
    if (!obj) return def;
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined && obj[keys[i]] !== '') return obj[keys[i]];
    }
    return def;
  }

  function parseConf(v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v || '').replace('%', ''));
    return isFinite(n) ? n : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // headerMap — Preserves BOTH normalized AND raw hyphenated/spaced keys
  //   "FT Score"   → "ft_score" (normalized) AND "ft score" (raw lowercase)
  //   "ou-fb-used" → "ou_fb_used" (normalized) AND "ou-fb-used" (raw)
  // ═══════════════════════════════════════════════════════════════════════════
  function headerMap(headers) {
    var m = {};
    for (var i = 0; i < headers.length; i++) {
      var normalized = String(headers[i] || '').toLowerCase().trim().replace(/[\s_]+/g, '_');
      m[normalized] = i;

      var raw = String(headers[i] || '').toLowerCase().trim();
      if (raw !== normalized) m[raw] = i;

      var hyphenNorm = raw.replace(/-/g, '_');
      if (hyphenNorm !== normalized && hyphenNorm !== raw) m[hyphenNorm] = i;
    }
    return m;
  }

  function formatDate(v) {
    if (!v) return '';
    if (v instanceof Date) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(v);
  }

  function _fmtLine1dp_(x) {
    var n = parseFloat(x);
    if (!isFinite(n)) return '';
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function _toPct_(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return (v > 0 && v <= 1) ? v * 100 : v;
    var s = String(v).trim().replace('%', '');
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return (n > 0 && n <= 1) ? n * 100 : n;
  }

  function _canonicalQOUPick_(quarter, direction, line) {
    var q = String(quarter || '').toUpperCase().trim();

    var d0 = String(direction || '').toUpperCase().trim();
    var d  = (d0 === 'O') ? 'OVER'
           : (d0 === 'U') ? 'UNDER'
           : d0;

    var l = _fmtLine1dp_(line);

    if (!/^Q[1-4]$/.test(q)) return '';
    if (!(d === 'OVER' || d === 'UNDER')) return '';
    if (!l) return '';
    return q + ': ' + d + ' ' + l;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HQ Dominant Quarter (R4B) helpers
  // ═══════════════════════════════════════════════════════════════════════════
  function _normQuarter_(v) {
    var s = String(v || '').toUpperCase().trim();
    if (!s) return '';
    if (/^Q[1-4]$/.test(s)) return s;
    if (/^[1-4]$/.test(s)) return 'Q' + s;
    var m = s.match(/Q\s*([1-4])/);
    if (m) return 'Q' + m[1];
    return '';
  }

  function _extractDominantFromT2_(t2) {
    if (!t2) return null;

    function pick_(obj, keys) {
      for (var i = 0; i < keys.length; i++) {
        if (obj && obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') {
          return obj[keys[i]];
        }
      }
      return null;
    }

    var hqNode =
      t2.hq || t2.highQ || t2.highestQ || t2.highestQuarter || t2.enh || t2.enhancements || null;

    var qRaw = pick_(t2, [
      'hqDominantQ', 'hqDominantQuarter', 'dominantQ', 'dominantQuarter',
      'hq_dominant_q', 'hq_dominant_quarter', 'dominant_q', 'dominant_quarter',
      'enhDominantQ', 'enhDominantQuarter', 'enh_dominant_q'
    ]);
    var cRaw = pick_(t2, [
      'hqDominantConf', 'dominantConf', 'dominantConfidence',
      'hq_dominant_conf', 'dominant_conf', 'dominant_confidence'
    ]);

    if (!qRaw && hqNode) {
      qRaw = pick_(hqNode, [
        'dominantQ', 'dominantQuarter', 'hqDominantQ', 'hqDominantQuarter',
        'quarterDominant', 'dominant'
      ]);
      cRaw = (cRaw === null) ? pick_(hqNode, [
        'dominantConf', 'dominantConfidence', 'hqDominantConf', 'confidence', 'conf'
      ]) : cRaw;
    }

    var isDominantFlag = !!pick_(t2, ['hqDominant', 'dominant', 'isDominant', 'hq_is_dominant', 'is_dominant']);
    if (!qRaw && isDominantFlag) {
      qRaw = pick_(t2, ['hqQ', 'hqQuarter', 'highestQ', 'highestQuarter', 'enhHighQ', 'enhHighQuarter']);
      if (!qRaw && hqNode) qRaw = pick_(hqNode, ['quarter', 'q', 'pick']);
    }

    var q = _normQuarter_(qRaw);
    var conf = parseConf(cRaw);

    if (!q) return null;
    if (!isFinite(conf) || conf <= 0) conf = 0;

    return { quarter: q, confidence: conf, source: 't2' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INLINE EXTRACTION HELPERS (used when external helpers unavailable)
  // ═══════════════════════════════════════════════════════════════════════════

  function _inlineExtractBookLine_(row, t1Map, t2) {
    var BOOK_LINE_KEYS = [
      'ft_score', 'ftscore', 'ft-score', 'ft score',
      'ft_book_line', 'ftbookline', 'ft-book-line',
      'ou_line', 'ou-line', 'ouline',
      'book_line', 'bookline', 'book-line',
      'ft_line', 'ftline', 'ft-line',
      'line'
    ];

    for (var i = 0; i < BOOK_LINE_KEYS.length; i++) {
      var key = BOOK_LINE_KEYS[i];
      var idx = t1Map[key];
      if (idx === undefined) idx = t1Map[key.toLowerCase()];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== '') {
        var val = parseFloat(String(row[idx]).replace(/[^\d.-]/g, ''));
        if (isFinite(val) && val > 0) return val;
      }
    }

    if (t2) {
      var t2Cands = [t2.ftScore, t2.ftBookLine, t2.ftLine, t2.ouLine, t2.bookLine, t2.line];
      for (var j = 0; j < t2Cands.length; j++) {
        var t2Val = parseFloat(t2Cands[j]);
        if (isFinite(t2Val) && t2Val > 0) return t2Val;
      }
    }

    return null;
  }

  function _inlineExtractForebetPrediction_(row, t1Map) {
    var psKeys = ['pred_score', 'predscore', 'pred-score', 'pred score'];
    for (var p = 0; p < psKeys.length; p++) {
      var psIdx = t1Map[psKeys[p]];
      if (psIdx !== undefined && row[psIdx]) {
        var ps = String(row[psIdx]);
        var parts = ps.split(/\s*[-–—]\s*/);
        if (parts.length >= 2) {
          var h = parseFloat(parts[0].replace(/[^\d.]/g, ''));
          var a = parseFloat(parts[1].replace(/[^\d.]/g, ''));
          if (isFinite(h) && isFinite(a) && h > 0 && a > 0) return h + a;
        }
      }
    }

    var fbKeys = ['ou-fb-used', 'ou_fb_used', 'oufbused'];
    for (var f = 0; f < fbKeys.length; f++) {
      var fbIdx = t1Map[fbKeys[f]];
      if (fbIdx !== undefined && row[fbIdx]) {
        var fbStr = String(row[fbIdx]);
        var fbMatch = fbStr.match(/(?:FB|Forebet)\s*:?\s*(\d+\.?\d*)/i);
        if (fbMatch) {
          var fbVal = parseFloat(fbMatch[1]);
          if (isFinite(fbVal) && fbVal > 0) return fbVal;
        }
      }
    }

    var ftKeys = ['forebet_total', 'forebettotal', 'fb_total'];
    for (var t = 0; t < ftKeys.length; t++) {
      var ftIdx = t1Map[ftKeys[t]];
      if (ftIdx !== undefined && row[ftIdx]) {
        var ftVal = parseFloat(row[ftIdx]);
        if (isFinite(ftVal) && ftVal > 0) return ftVal;
      }
    }

    var avgIdx = t1Map['avg'];
    if (avgIdx !== undefined && row[avgIdx]) {
      var avgVal = parseFloat(row[avgIdx]);
      if (isFinite(avgVal) && avgVal > 0) return avgVal;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FT LINE LOOKUP FROM UPCOMINGCLEAN
  // ═══════════════════════════════════════════════════════════════════════════
  var _ucFTLineCache = null;

  function _loadUpcomingCleanFTLines() {
    if (_ucFTLineCache !== null) return _ucFTLineCache;

    _ucFTLineCache = {};
    var ucSheet = ss.getSheetByName('UpcomingClean');
    if (!ucSheet) {
      log('UpcomingClean not found — cannot load FT lines');
      return _ucFTLineCache;
    }

    var ucData = ucSheet.getDataRange().getValues();
    if (ucData.length < 2) return _ucFTLineCache;

    var ucMap = {};
    for (var i = 0; i < ucData[0].length; i++) {
      var h = String(ucData[0][i] || '').toLowerCase().trim().replace(/[\s_]+/g, '_');
      ucMap[h] = i;
      var raw = String(ucData[0][i] || '').toLowerCase().trim();
      if (raw !== h) ucMap[raw] = i;
    }

    var homeIdx = ucMap['home'];
    var awayIdx = ucMap['away'];
    var ftIdx = ucMap['ft_score'] !== undefined ? ucMap['ft_score'] : ucMap['ft score'];
    var q1Idx = ucMap['q1'];
    var q2Idx = ucMap['q2'];
    var q3Idx = ucMap['q3'];
    var q4Idx = ucMap['q4'];
    var avgIdx = ucMap['avg'];

    for (var r = 1; r < ucData.length; r++) {
      var ucRow = ucData[r];
      var ucHome = String(ucRow[homeIdx] || '').trim().toLowerCase();
      var ucAway = String(ucRow[awayIdx] || '').trim().toLowerCase();
      if (!ucHome || !ucAway) continue;

      var key = ucHome + ' vs ' + ucAway;
      var ftLine = null;

      if (ftIdx !== undefined && ucRow[ftIdx] !== undefined && ucRow[ftIdx] !== '') {
        var ftVal = parseFloat(String(ucRow[ftIdx]).replace(/[^\d.-]/g, ''));
        if (isFinite(ftVal) && ftVal > 100) ftLine = ftVal;
      }

      if (!ftLine && q1Idx !== undefined && q2Idx !== undefined &&
          q3Idx !== undefined && q4Idx !== undefined) {
        var q1 = parseFloat(ucRow[q1Idx]);
        var q2 = parseFloat(ucRow[q2Idx]);
        var q3 = parseFloat(ucRow[q3Idx]);
        var q4 = parseFloat(ucRow[q4Idx]);

        if (isFinite(q1) && isFinite(q2) && isFinite(q3) && isFinite(q4) &&
            q1 > 0 && q2 > 0 && q3 > 0 && q4 > 0) {
          ftLine = q1 + q2 + q3 + q4;
        }
      }

      if (!ftLine && avgIdx !== undefined && ucRow[avgIdx] !== undefined && ucRow[avgIdx] !== '') {
        var avgVal = parseFloat(String(ucRow[avgIdx]).replace(/[^\d.-]/g, ''));
        if (isFinite(avgVal) && avgVal > 100) ftLine = avgVal;
      }

      if (ftLine && ftLine > 100) {
        _ucFTLineCache[key] = ftLine;
      }
    }

    log('Loaded ' + Object.keys(_ucFTLineCache).length + ' FT lines from UpcomingClean');
    return _ucFTLineCache;
  }

  function _getFTLineFromUpcomingClean(homeTeam, awayTeam) {
    var cache = _loadUpcomingCleanFTLines();
    var key = (homeTeam + ' vs ' + awayTeam).toLowerCase();
    return cache[key] || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUARTER BOOK LINE LOOKUP FROM UPCOMINGCLEAN
  // Reads Q1-Q4 columns (actual book lines, e.g. 58.5) so OU candidates use
  // the real spread rather than the predicted line from OU_Log.
  // ═══════════════════════════════════════════════════════════════════════════
  var _ucQuarterLineCache = null;

  function _loadUpcomingCleanQuarterLines() {
    if (_ucQuarterLineCache !== null) return _ucQuarterLineCache;

    _ucQuarterLineCache = {};
    var ucSheet = ss.getSheetByName('UpcomingClean');
    if (!ucSheet) {
      log('UpcomingClean not found — cannot load quarter book lines');
      return _ucQuarterLineCache;
    }

    var ucData = ucSheet.getDataRange().getValues();
    if (ucData.length < 2) return _ucQuarterLineCache;

    var ucMap = {};
    for (var i = 0; i < ucData[0].length; i++) {
      var h = String(ucData[0][i] || '').toLowerCase().trim().replace(/[\s_]+/g, '_');
      ucMap[h] = i;
      var raw = String(ucData[0][i] || '').toLowerCase().trim();
      if (raw !== h) ucMap[raw] = i;
    }

    var homeIdx = ucMap['home'];
    var awayIdx = ucMap['away'];
    var q1Idx   = ucMap['q1'];
    var q2Idx   = ucMap['q2'];
    var q3Idx   = ucMap['q3'];
    var q4Idx   = ucMap['q4'];

    for (var r = 1; r < ucData.length; r++) {
      var ucRow  = ucData[r];
      var ucHome = String(ucRow[homeIdx] || '').trim().toLowerCase();
      var ucAway = String(ucRow[awayIdx] || '').trim().toLowerCase();
      if (!ucHome || !ucAway) continue;

      var key = ucHome + ' vs ' + ucAway;
      _ucQuarterLineCache[key] = {
        Q1: q1Idx !== undefined ? parseFloat(ucRow[q1Idx]) : NaN,
        Q2: q2Idx !== undefined ? parseFloat(ucRow[q2Idx]) : NaN,
        Q3: q3Idx !== undefined ? parseFloat(ucRow[q3Idx]) : NaN,
        Q4: q4Idx !== undefined ? parseFloat(ucRow[q4Idx]) : NaN
      };
    }

    log('Loaded quarter book lines for ' + Object.keys(_ucQuarterLineCache).length + ' games from UpcomingClean');
    return _ucQuarterLineCache;
  }

  function _getQuarterLineFromUpcomingClean(homeTeam, awayTeam, quarter) {
    var cache = _loadUpcomingCleanQuarterLines();
    var key   = (homeTeam + ' vs ' + awayTeam).toLowerCase();
    var lines  = cache[key];
    if (!lines) return null;
    var val = lines[quarter];
    return (isFinite(val) && val > 0) ? val : null;
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG CANONICALIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  function canonicalizeConfig(cfg) {
    cfg = cfg || {};
    return {
      bankerThreshold:       toNum(getFirst(cfg, ['bankerThreshold', 'banker_threshold'], 60), 60),
      minBankerOdds:         toNum(getFirst(cfg, ['minBankerOdds', 'min_banker_odds'], 1.01), 1.01),
      maxBankerOdds:         toNum(getFirst(cfg, ['maxBankerOdds', 'max_banker_odds'], 3.0), 3.0),

      sniperMinMargin:       toNum(getFirst(cfg, ['sniperMinMargin', 'sniper_min_margin'], 2.5), 2.5),
      maxSnipersPerGame:     toNum(getFirst(cfg, ['maxSnipersPerGame', 'max_snipers_per_game'], 2), 2),

      includeOUSignals:      toBool(getFirst(cfg, ['includeOUSignals', 'include_ou_signals'], true), true),
      ouMinConf:             toNum(getFirst(cfg, ['ouMinConf', 'ou_min_conf'], 55), 55),
      ouMinEv:               toNum(getFirst(cfg, ['ouMinEv', 'ou_min_ev'], 5), 5),
      minEdgeScore:          toNum(getFirst(cfg, ['minEdgeScore', 'min_edge_score'], 0), 0),
      preferDirectional:     toBool(getFirst(cfg, ['preferDirectional', 'prefer_directional'], true), true),

      includeHighestQuarter: toBool(getFirst(cfg, ['includeHighestQuarter', 'include_highest_quarter'], true), true),

      // R4B: HQ dominant quarter → OU boost knobs (supplementary signal)
      hqDominantMinConf:     toNum(getFirst(cfg, ['hqDominantMinConf', 'hq_dominant_min_conf', 'hqMinDominantConf'], 72), 72),
      hqDominantMinMargin:   toNum(getFirst(cfg, ['hqDominantMinMargin', 'hq_dominant_min_margin', 'hqMinDominantMargin'], 2.0), 2.0),
      hqOuConfBoost:         toNum(getFirst(cfg, ['hqOuConfBoost', 'hq_ou_conf_boost', 'hqOUConfidenceBoost'], 2.5), 2.5),

      // ── HQ GATING CONFIG (Patch 4A) ────────────────────────────
      hqEnabled:             toBool(getFirst(cfg, ['hq_enabled', 'hqEnabled', 'includeHighestQuarter'], true), true),
      hqMinConfidence:       toNum(getFirst(cfg, ['hq_min_confidence', 'hqMinConfidence', 'hqMinConf'], 55), 55),
      hqSkipTies:            toBool(getFirst(cfg, ['hq_skip_ties', 'hqSkipTies'], true), true),
      hqMinPWin:             toNum(getFirst(cfg, ['hq_min_pwin', 'hqMinPWin'], 0), 0),
      hqMinEV:               toNum(getFirst(cfg, ['hq_min_ev', 'hqMinEV'], 0), 0),
      hqExemptFromCap:       toBool(getFirst(cfg, ['hq_exempt_from_cap', 'hqExemptFromCap'], false), false),
      hqMaxPerSlip:          toNum(getFirst(cfg, ['hq_max_picks_per_slip', 'hqMaxPerSlip'], 3), 3),
      // ── END HQ GATING CONFIG ───────────────────────────────────

      enableRobbers:         toBool(getFirst(cfg, ['enableRobbers', 'enable_robbers'], true), true),
      robberMinConf:         toNum(getFirst(cfg, ['robberMinConf', 'robber_min_conf'], 54), 54),
      robberMaxPicks:        toNum(getFirst(cfg, ['robberMaxPicks', 'robber_max_picks'], 10), 10),

      enableFirstHalf:       toBool(getFirst(cfg, ['enableFirstHalf', 'enable_first_half'], true), true),
      firstHalfMinConf:      toNum(getFirst(cfg, ['firstHalfMinConf', 'first_half_min_conf'], 58), 58),
      firstHalfTwoWay:       toBool(getFirst(cfg, ['firstHalfTwoWay', 'first_half_two_way'], true), true),

      enableFTOU:            toBool(getFirst(cfg, ['enableFTOU', 'enable_ft_ou'], true), true),
      ftOuMinConf:           toNum(getFirst(cfg, ['ftOuMinConf', 'ft_ou_min_conf'], 55), 55),
      ftOuMinEv:             toNum(getFirst(cfg, ['ftOuMinEv', 'ft_ou_min_ev'], 0.005), 0.005),

      ouMinEdge:             toNum(getFirst(cfg, ['ouMinEdge', 'ou_min_edge'], 2.0), 2.0),
      includeHQSignals:      toBool(getFirst(cfg, ['includeHQSignals', 'include_hq_signals', 'hq_enabled', 'hqEnabled', 'includeHighestQuarter'], true), true)
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('  ACCUMULATOR ' + VERSION);
  Logger.log('═══════════════════════════════════════════════════════════════');

  try {
    ss.toast('Building accumulator...', 'Ma Golide', 5);

    // ─── Load Configs ───
    var rawConfig = (typeof getTunedThresholds === 'function')
      ? (getTunedThresholds(ss) || {}) : {};
    var config = canonicalizeConfig(rawConfig);

    if (typeof validateConfigState_ === 'function') {
      try {
        validateConfigState_(config, [
          'bankerThreshold', 'sniperMinMargin', 'ouMinConf', 'enableRobbers', 'includeHighestQuarter'
        ]);
      } catch (eAcc) {
        log('validateConfigState_: ' + eAcc);
      }
    }

    var tierCuts = (typeof _loadTierCuts === 'function')
      ? _loadTierCuts(ss) : null;

    // ─── Load FT O/U Config ───
    var ftConfig = null;
    if (typeof _buildFTConfig_ === 'function') {
      ftConfig = _buildFTConfig_(ss);
    } else if (typeof buildFTConfigFromSheet_ === 'function') {
      ftConfig = buildFTConfigFromSheet_(ss);
    }

    if (!ftConfig) {
      ftConfig = {
        ft: {
          minConf: 55, minEV: 0.005, edgeThreshold: 0.04, americanOdds: -110,
          sigmaFloor: 6, sigmaScale: 1.0, sigmaFromLinePct: 0.075, shrinkK: 8,
          modelError: 4.0, probTemp: 1.15, forebetWeight: 0.35, forebetEnabled: true,
          leaguePriorByLeague: {
            'NBA':        { mu: 229.9, sigma: 17.5, forebetBias: 0.08, clampMin: 180, clampMax: 280 },
            'EuroLeague': { mu: 160.2, sigma: 14.1, forebetBias: 0.05, clampMin: 140, clampMax: 200 },
            'WNBA':       { mu: 165.0, sigma: 14.0, forebetBias: 0.06, clampMin: 140, clampMax: 200 },
            'NCAA':       { mu: 145.0, sigma: 16.0, forebetBias: 0.07, clampMin: 120, clampMax: 180 }
          },
          knownFallbackValue: 105, debugLogging: false
        }
      };
    }

    // ─── Check Available Enhancements ───
    var enh = {
      robbers:   typeof detectRobbers === 'function',
      firstHalf: typeof predictFirstHalf1x2 === 'function',
      ftOU:      typeof predictFTOverUnder === 'function',
      highQtr:   typeof predictHighestQuarterEnhanced === 'function',
      tiers:     typeof getTierObject === 'function',
      extractFTLine:    typeof _extractFTBookLine_ === 'function',
      extractFBPred:    typeof _extractForebetPrediction_ === 'function',
      buildEnrichedFT:  typeof buildEnrichedFTGame_ === 'function'
    };
    var enhEnabled = Object.keys(enh).some(function(k) { return enh[k]; });

    // ─── Load Tier 1 Data ───
    var t1Sheet = (typeof _getSheet === 'function')
      ? _getSheet(ss, 'Analysis_Tier1')
      : ss.getSheetByName('Analysis_Tier1');
    if (!t1Sheet) throw new Error('Analysis_Tier1 not found');

    var t1Data = t1Sheet.getDataRange().getValues();
    if (t1Data.length < 2) throw new Error('Analysis_Tier1 is empty');

    var t1Map = headerMap(t1Data[0]);
    log('Tier1: ' + (t1Data.length - 1) + ' rows, ' + Object.keys(t1Map).length + ' headers mapped');

    // ─── Load Supporting Data ───
    var t2Signals = (typeof _loadTier2Signals === 'function')
      ? (_loadTier2Signals(ss, config) || {}) : {};
    var dateLookup = (typeof _buildDateLookup === 'function')
      ? (_buildDateLookup(ss) || {}) : {};

    var marginStats = {};
    if (typeof loadTier2MarginStats === 'function') {
      try { marginStats = loadTier2MarginStats(ss) || {}; }
      catch (e) { log('Margin stats error: ' + e.message); }
    }

    // ─── Load H2H/Form for Robbers and First Half ───
    var h2hStats = {}, recentForm = {};
    if ((enh.robbers && config.enableRobbers) || (enh.firstHalf && config.enableFirstHalf)) {
      if (typeof loadRobbersH2HStats === 'function') {
        try { h2hStats = loadRobbersH2HStats(ss) || {}; } catch (e) {}
      }
      if (typeof loadRobbersRecentForm === 'function') {
        try { recentForm = loadRobbersRecentForm(ss, 10) || {}; } catch (e) {}
      }
      config._robbersH2H = h2hStats;
      config._robbersForm = recentForm;
    }

    // ─── Pre-load enh-high-q columns from UpcomingClean (Patch 4B support) ───
    _loadUpcomingCleanEnhColumns(ss);

    // ─── Initialize Buckets ───
    var bankerCandidates    = [];
    var sniperCandidates    = [];
    var robberCandidates    = [];
    var firstHalfCandidates = [];
    var ftOUCandidates      = [];
    var QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

    // ─── Diagnostics ───
    var diag = {
      gamesProcessed: 0,
      robbers:   { attempted: 0, found: 0, errors: 0 },
      firstHalf: { attempted: 0, found: 0, errors: 0 },
      highestQ:  { attempted: 0, found: 0, sanitized: 0, skipped: 0, gated: 0, errors: 0 },
      hqDominant: { found: 0, used: 0, boostedOU: 0, boostedOUDir: 0, source: {} },
      ftOU:      { attempted: 0, found: 0, skipped: 0, noLine: 0, noForebet: 0, errors: 0, muSources: {} },
      ouCandidates: 0,
      ouDirCandidates: 0
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // PROCESS GAMES
    // ═══════════════════════════════════════════════════════════════════════════
    for (var r = 1; r < t1Data.length; r++) {
      var row = t1Data[r];
      var home = String(row[t1Map['home']] || '').trim();
      var away = String(row[t1Map['away']] || '').trim();
      if (!home || !away) continue;

      diag.gamesProcessed++;

      // ─── Parse Core Fields ───
      var pred = String(row[t1Map['magolide_pred']] || row[t1Map['pred']] || '').toUpperCase().trim();
      if (pred === '1') pred = 'HOME';
      if (pred === '2') pred = 'AWAY';

      var conf = parseConf(
        row[t1Map['confidence_%']] || row[t1Map['prob_%']] || row[t1Map['confidence']] || 0
      );

      var dateVal = '';
      if (t1Map['date'] !== undefined) dateVal = formatDate(row[t1Map['date']]);
      if (!dateVal) dateVal = dateLookup[home.toLowerCase() + '|' + away.toLowerCase()] || '';

      var league   = row[t1Map['league']] || '';
      var time     = row[t1Map['time']]   || '';
      var matchStr = home + ' vs ' + away;

      var homeOdds = toNum(row[t1Map['home_odds']] || row[t1Map['homeodds']], 0);
      var awayOdds = toNum(row[t1Map['away_odds']] || row[t1Map['awayodds']], 0);
      var mainOdds = toNum(row[t1Map['odds']]      || row[t1Map['avgodds']],  0);

      // ═══════════════════════════════════════════════════════════════════════
      // BANKERS
      // ═══════════════════════════════════════════════════════════════════════
      if (conf > 0 && (pred === 'HOME' || pred === 'AWAY')) {
        bankerCandidates.push({
          league: league, date: dateVal, time: time, match: matchStr,
          pick: (pred === 'HOME' ? home : away) + ' Win',
          odds: mainOdds, confidence: conf
        });
      }

      // ═══════════════════════════════════════════════════════════════════════
      // ROBBERS
      // ═══════════════════════════════════════════════════════════════════════
      if (enh.robbers && config.enableRobbers) {
        diag.robbers.attempted++;
        try {
          var gameData = {
            home: home, away: away, homeOdds: homeOdds, awayOdds: awayOdds,
            pred: pred, odds: mainOdds, league: league, date: dateVal, time: time
          };
          var h2hKey = (home + ' vs ' + away).toLowerCase();
          var h2h = h2hStats[h2hKey] || h2hStats[(away + ' vs ' + home).toLowerCase()] || null;
          var robber = detectRobbers(gameData, h2h, recentForm, config);
          if (robber && toNum(robber.confidence, 0) >= config.robberMinConf) {
            robber.league = league;
            robber.date = dateVal;
            robber.time = time;
            robber.match = matchStr;
            robberCandidates.push(robber);
            diag.robbers.found++;
          }
        } catch (e) { diag.robbers.errors++; }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FIRST HALF
      // ═══════════════════════════════════════════════════════════════════════
      if (enh.firstHalf && config.enableFirstHalf) {
        diag.firstHalf.attempted++;
        try {
          var h1Game = {
            home: home, away: away, league: league, date: dateVal, time: time,
            homeOdds: homeOdds, awayOdds: awayOdds, odds: mainOdds, pred: pred
          };
          var h1Config = {};
          for (var k in ftConfig) {
            if (ftConfig.hasOwnProperty(k)) h1Config[k] = ftConfig[k];
          }
          h1Config._robbersH2H     = config._robbersH2H;
          h1Config._robbersForm    = config._robbersForm;
          h1Config.firstHalfTwoWay = config.firstHalfTwoWay;

          var h1Pred    = predictFirstHalf1x2(h1Game, marginStats, h1Config);
          var h1ConfVal = toNum(h1Pred ? h1Pred.confidence : 0, 0);
          var h1PredVal = h1Pred ? h1Pred.prediction : 'null';

          if (h1Pred && !h1Pred.skip &&
              h1PredVal !== 'N/A' && h1PredVal !== 'Draw' &&
              h1ConfVal >= config.firstHalfMinConf) {
            firstHalfCandidates.push({
              league: league, date: dateVal, time: time, match: matchStr,
              pick: '1H: ' + (h1Pred.predictedWinner || h1Pred.prediction) +
                    ' (' + (h1Pred.margin || 0) + ')',
              type: '1H 1x2', confidence: h1Pred.confidence, tier: h1Pred.tier
            });
            diag.firstHalf.found++;
          }
        } catch (e) { diag.firstHalf.errors++; }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // T2 SIGNALS
      // ═══════════════════════════════════════════════════════════════════════
      var matchKey = home.toLowerCase() + ' vs ' + away.toLowerCase();
      var t2 = t2Signals[matchKey] || {};
      // NOTE: do NOT continue; HSQ can still be derived from marginStats / enhanced model

      // R4B: Pre-seed dominant quarter from existing game result payload (if present)
      var hqDominant = _extractDominantFromT2_(t2);
      if (hqDominant) {
        diag.hqDominant.found++;
        diag.hqDominant.source[hqDominant.source] = (diag.hqDominant.source[hqDominant.source] || 0) + 1;
      }

      // ─── MARGIN per Quarter ───
      for (var qi = 0; qi < QUARTERS.length; qi++) {
        var q = QUARTERS[qi];
        var marginSig = t2.margin && t2.margin[q];
        if (!marginSig) continue;

        var marginConf = t2.marginConf ? t2.marginConf[q] : null;
        var pickText = q + ': ' + marginSig;

        if (enh.tiers && isFinite(marginConf)) {
          var tierObj = getTierObject(marginConf);
          if (tierObj && tierObj.symbol) pickText += ' ' + tierObj.symbol;
        }

        sniperCandidates.push({
          league: league, date: dateVal, time: time, match: matchStr,
          pick: pickText, signalType: 'MARGIN',
          confidence: marginConf, gameTier: t2.gameTier
        });
      }


// ═══════════════════════════════════════════════════════════════════════
// HIGHEST QUARTER (PRIMARY = enh-high-q from UpcomingClean)
// ═══════════════════════════════════════════════════════════════════════
if (config.includeHighestQuarter) {
  diag.highestQ.attempted++;
  try {
    var hqRes = null;

    // PRIMARY: read enh-high-q output (already computed with correct OU→HQ bridge)
    var enhData = _getEnhHighQ(ss, home, away);

    if (enhData && enhData.quarter) {
      hqRes = {
        quarter: enhData.quarter,
        pick: 'Highest Q: ' + enhData.quarter,
        confidence: enhData.confidence || 0,
        ev: enhData.ev || 0,
        pWin: enhData.pWin || 0,
        reliability: enhData.reliability || 0,
        wasTie: !!enhData.isTie,
        source: 'enh-high-q'
      };
    } else {
      // FALLBACK: derive only if enh columns are missing
      hqRes = _deriveHighestQuarter_(
        { home: home, away: away, league: league, date: dateVal },
        marginStats, config, t2
      );
    }

    if (hqRes && hqRes.quarter !== 'N/A' && hqRes.pick) {
      var finalQuarter = hqRes.quarter;
      var finalPick = hqRes.pick;

      var sHQ = _acc_sanitizeHighestQuarter(finalQuarter);
      if (sHQ.wasSanitized) {
        finalQuarter = sHQ.quarter;
        finalPick = 'Highest Q: ' + sHQ.quarter;
        diag.highestQ.sanitized++;
      }

      finalPick = _acc_sanitizePickText(finalPick);

      if (/^Q[1-4]$/.test(finalQuarter)) {
        var hqGate = (typeof hq_gateCheck_ === 'function')
          ? hq_gateCheck_(hqRes, config)
          : { pass: true, reason: '' };

        if (!hqGate.pass) {
          diag.highestQ.gated = (diag.highestQ.gated || 0) + 1;
          Logger.log('[HQ GATE] SKIP: ' + hqGate.reason);
        } else {
          // Push as standard SNIPER row (helps _selectSnipers not drop it)
          sniperCandidates.push({
            league: league,
            date: dateVal,
            time: time,
            match: matchStr,
            pick: finalPick,

            type: 'SNIPER',
            signalType: 'HIGH_QTR',
            market: 'HIGH_QTR',
            period: finalQuarter,

            confidence: (function () {
              var c = Number(hqRes.confidence);
              if (!isFinite(c) || c <= 0) c = 55;
              if (sHQ.wasSanitized) c = Math.min(c, 55);
              return c;
            })(),

            isHighQtr: true,
            isHQ: true,
            wasTie: !!hqRes.wasTie,
            hqSource: hqRes.source || null,
            gameTier: (t2 && t2.gameTier) ? t2.gameTier : '',

            pWin: (hqRes.pWin != null ? hqRes.pWin : null),
            reliability: (hqRes.reliability != null ? hqRes.reliability : null)
          });

          diag.highestQ.found++;

          // OPTIONAL: keep your dominant-quarter inference (safe even if margin missing)
          var hqQ = _normQuarter_(finalQuarter);
          var hqC = toNum(hqRes.confidence, 0);
          var hqM = toNum(hqRes.margin, 0);

          if (!hqDominant &&
              hqQ &&
              hqC >= config.hqDominantMinConf &&
              !hqRes.wasTie &&
              hqM >= config.hqDominantMinMargin) {
            hqDominant = { quarter: hqQ, confidence: hqC, margin: hqM, source: 'hqRes' };
            diag.hqDominant.found++;
            diag.hqDominant.source[hqDominant.source] =
              (diag.hqDominant.source[hqDominant.source] || 0) + 1;
          }
        }
      } else {
        diag.highestQ.skipped++;
      }
    } else {
      diag.highestQ.skipped++;
    }
  } catch (e) {
    diag.highestQ.errors++;
    Logger.log('[HSQ] ERROR: ' + (e && e.message ? e.message : e));
  }
}

      if (config.includeOUSignals && t2.ou) {
        var usedDominantThisGame = false;
        var _lqProfileCache = null; // Caches the league profile for this game

        for (var oqi = 0; oqi < QUARTERS.length; oqi++) {
          var oq    = QUARTERS[oqi];
          var ouSig = t2.ou[oq];
          if (!ouSig) continue;

          // Use actual book line from UpcomingClean Q1-Q4 columns if available,
          // falling back to the predicted line from OU_Log or the attached bookLine.
          var bookLine = _getQuarterLineFromUpcomingClean(home, away, oq)
                      || (ouSig.bookLine && isFinite(ouSig.bookLine) && ouSig.bookLine > 0 ? ouSig.bookLine : null);

          // Fallback to LeagueQuarterO_U_Stats if book line is still missing
          if (!bookLine || bookLine <= 0) {
            if (_lqProfileCache === null) {
              _lqProfileCache = (typeof getLeagueProfile === 'function') ? getLeagueProfile(ss, league) : false;
            }
            if (_lqProfileCache && _lqProfileCache[oq] && isFinite(_lqProfileCache[oq].mean) && _lqProfileCache[oq].mean > 0) {
              var qMean = _lqProfileCache[oq].mean;
              var totalHist = _lqProfileCache.Q1.mean + _lqProfileCache.Q2.mean + _lqProfileCache.Q3.mean + _lqProfileCache.Q4.mean;
              
              var gameExpectedFT = null;
              try {
                var avgVal = t1Map['avg'] !== undefined ? parseFloat(row[t1Map['avg']]) : null;
                if (!isFinite(avgVal) || avgVal <= 0) avgVal = null;

                gameExpectedFT = _getFTLineFromUpcomingClean(home, away) 
                              || _inlineExtractBookLine_(row, t1Map, t2)
                              || avgVal
                              || _inlineExtractForebetPrediction_(row, t1Map);
              } catch(e) {}
              if (!isFinite(gameExpectedFT) || gameExpectedFT <= 100) gameExpectedFT = totalHist;
              
              // 1. Proportional Scaling
              var scaledLine = gameExpectedFT * (qMean / totalHist);
              
              // 2. Edge Constraints (Cap deviation from prediction)
              if (ouSig.line && isFinite(ouSig.line) && ouSig.line > 0) {
                 var maxDev = 3.5;
                 if (scaledLine > ouSig.line + maxDev) scaledLine = ouSig.line + maxDev;
                 if (scaledLine < ouSig.line - maxDev) scaledLine = ouSig.line - maxDev;
              }
              
              // 3. Half-Point Rounding (Force .5)
              bookLine = Math.floor(scaledLine) + 0.5;
            }
          }

          var lineToUse = bookLine || ouSig.line;

          var pickOU = _canonicalQOUPick_(oq, ouSig.direction, lineToUse);
          if (!pickOU) continue;

          diag.ouCandidates++;

          var ouConf0 = toNum(ouSig.conf, 0);
          var ouConf = ouConf0;

          var isDomMatch = false;
          if (hqDominant &&
              hqDominant.quarter === oq &&
              toNum(hqDominant.confidence, 0) >= config.hqDominantMinConf) {
            isDomMatch = true;
            usedDominantThisGame = true;

            if (ouConf > 0) {
              ouConf = Math.min(99, ouConf + config.hqOuConfBoost);
            }
          }

          sniperCandidates.push({
            league: league, date: dateVal, time: time, match: matchStr,
            pick: pickOU,
            type: (ouSig.star ? 'SNIPER O/U STAR' : 'SNIPER O/U') + (isDomMatch ? ' +HQ' : ''),
            signalType: ouSig.star ? 'OU_STAR' : (isDomMatch ? 'OU_HQ' : 'OU'),
            confidence: ouConf,
            ev:    _toPct_(ouSig.ev),
            edge:  ouSig.edge,
            star:  ouSig.star,
            gameTier: t2.gameTier,

            // R4B metadata (non-breaking)
            hqDominantQuarter: isDomMatch ? hqDominant.quarter : null,
            hqDominantConf:    isDomMatch ? toNum(hqDominant.confidence, 0) : null,
            hqDominantSource:  isDomMatch ? (hqDominant.source || '') : null,
            hqBoostApplied:    isDomMatch ? true : false,
            originalConfidence: ouConf0,
            lineSource: isFinite(bookLine) ? 'BOOK' : 'LEAGUE_STATS'
          });

          if (isDomMatch) diag.hqDominant.boostedOU++;
        }

        if (usedDominantThisGame) diag.hqDominant.used++;
      }

      // ─── Best Directional (R4B: apply same dominant boost if quarter matches) ───
      if (config.preferDirectional && t2.ouBestDir) {
        var bd     = t2.ouBestDir;
        var pickBD = _canonicalQOUPick_(bd.quarter, bd.direction, bd.line);
        if (pickBD) {
          diag.ouDirCandidates++;

          var bdQ = _normQuarter_(bd.quarter);
          var bdConf0 = toNum(bd.conf, 0);
          var bdConf = bdConf0;

          var bdDomMatch = false;
          if (hqDominant &&
              bdQ &&
              hqDominant.quarter === bdQ &&
              toNum(hqDominant.confidence, 0) >= config.hqDominantMinConf) {
            bdDomMatch = true;
            if (bdConf > 0) {
              bdConf = Math.min(99, bdConf + config.hqOuConfBoost);
            }
            diag.hqDominant.boostedOUDir++;
          }

          sniperCandidates.push({
            league: league, date: dateVal, time: time, match: matchStr,
            pick: pickBD,
            type: (bd.star ? 'SNIPER O/U STAR' : 'SNIPER O/U DIR') + (bdDomMatch ? ' +HQ' : ''),
            signalType: bd.star ? 'OU_STAR' : (bdDomMatch ? 'OU_DIR_HQ' : 'OU_DIR'),
            confidence: bdConf,
            ev:    _toPct_(bd.ev),
            edge:  bd.edge,
            star:  bd.star,
            gameTier: t2.gameTier,

            // R4B metadata
            hqDominantQuarter: bdDomMatch ? hqDominant.quarter : null,
            hqDominantConf:    bdDomMatch ? toNum(hqDominant.confidence, 0) : null,
            hqDominantSource:  bdDomMatch ? (hqDominant.source || '') : null,
            hqBoostApplied:    bdDomMatch ? true : false,
            originalConfidence: bdConf0,
            lineSource: isFinite(bd.line) ? 'BOOK' : 'LEAGUE_STATS'
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FT O/U — CONSOLIDATED: Separate Book Line from Forebet Prediction
      // ═══════════════════════════════════════════════════════════════════════
      if (enh.ftOU && config.enableFTOU) {
        diag.ftOU.attempted++;
        try {
          var ftBookLine = null;

          if (enh.extractFTLine && typeof _extractFTBookLine_ === 'function') {
            try {
              ftBookLine = _extractFTBookLine_(row, t1Map, t2);
            } catch (e) {
              log('FT O/U: _extractFTBookLine_ error for ' + matchStr + ': ' + e.message);
            }
          }

          if (!ftBookLine || ftBookLine <= 0) {
            ftBookLine = _inlineExtractBookLine_(row, t1Map, t2);
          }

          if (!ftBookLine || ftBookLine <= 0) {
            ftBookLine = _getFTLineFromUpcomingClean(home, away);
            if (ftBookLine) {
              log('FT O/U: Got line ' + ftBookLine + ' from UpcomingClean for ' + matchStr);
            }
          }

          if (!ftBookLine || ftBookLine <= 0) {
            diag.ftOU.noLine++;
            diag.ftOU.skipped++;
            continue;
          }

          var ftGame;

          if (enh.buildEnrichedFT) {
            ftGame = buildEnrichedFTGame_(home, away, league, ftBookLine, row, t1Map, t2);
            if (!ftGame.ftBookLine) ftGame.ftBookLine = ftBookLine;
          } else {
            ftGame = {
              home: home,
              away: away,
              ftBookLine: ftBookLine,
              line: ftBookLine,
              league: league,
              leagueKey: league
            };

            ftGame.forebetTotal = enh.extractFBPred
              ? _extractForebetPrediction_(row, t1Map)
              : _inlineExtractForebetPrediction_(row, t1Map);

            if (!ftGame.forebetTotal) {
              diag.ftOU.noForebet++;
            }

            var predScoreIdx = t1Map['pred_score'] || t1Map['predscore'] || t1Map['pred score'];
            if (predScoreIdx !== undefined && row[predScoreIdx]) {
              ftGame.predScore = String(row[predScoreIdx]);
            }

            if (t1Map['avg'] !== undefined && row[t1Map['avg']]) {
              ftGame.avg = row[t1Map['avg']];
            }

            var fbIdx = t1Map['ou-fb-used'] !== undefined ? t1Map['ou-fb-used'] :
                        t1Map['ou_fb_used'] !== undefined ? t1Map['ou_fb_used'] : undefined;
            if (fbIdx !== undefined && row[fbIdx]) {
              ftGame['ou-fb-used'] = String(row[fbIdx]);
            }

            for (var qk = 0; qk < QUARTERS.length; qk++) {
              var qKey = QUARTERS[qk].toLowerCase();
              if (t1Map[qKey] !== undefined) {
                ftGame[qKey] = row[t1Map[qKey]];
              }
            }
          }

          var ftPred = predictFTOverUnder(ftGame, marginStats, ftConfig);

          if (ftPred && !ftPred.skip && ftPred.direction !== 'N/A' &&
              toNum(ftPred.confidence, 0) >= config.ftOuMinConf &&
              toNum(ftPred.ev, 0) >= config.ftOuMinEv) {

            var muSrc = ftPred.muSource || 'unknown';
            diag.ftOU.muSources[muSrc] = (diag.ftOU.muSources[muSrc] || 0) + 1;

            ftOUCandidates.push({
              league: league,
              date: dateVal,
              time: time,
              match: matchStr,
              pick: 'FT ' + ftPred.direction + ' ' + ftBookLine,
              type: 'FT O/U',
              confidence: ftPred.confidence,
              ev: ftPred.ev,
              edge: ftPred.edge,
              expectedTotal: ftPred.expectedTotal,
              muSource: muSrc,
              forebetUsed: ftPred.forebetUsed || false,
              bookLine: ftBookLine,
              forebetPrediction: ftGame.forebetTotal || null,
              lineSource: isFinite(ftBookLine) ? 'BOOK' : 'LEAGUE_STATS'
            });
            diag.ftOU.found++;
          } else {
            diag.ftOU.skipped++;
          }

        } catch (e) {
          diag.ftOU.errors++;
          log('FT O/U error for ' + matchStr + ': ' + e.message);
        }
      }

    } // end game loop

    // ═══════════════════════════════════════════════════════════════════════════
    // DIAGNOSTICS
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('───────────────────────────────────────────────────────────────');
    log('DIAGNOSTICS:');
    log('  Games processed: ' + diag.gamesProcessed);
    log('  ROBBERS: ' + diag.robbers.found + '/' + diag.robbers.attempted +
        (diag.robbers.errors ? ' (errors=' + diag.robbers.errors + ')' : ''));
    log('  FIRST HALF: ' + diag.firstHalf.found + '/' + diag.firstHalf.attempted +
        (diag.firstHalf.errors ? ' (errors=' + diag.firstHalf.errors + ')' : ''));
    log('  HIGHEST Q: ' + diag.highestQ.found + '/' + diag.highestQ.attempted +
        ' (sanitized=' + diag.highestQ.sanitized +
        ', skipped=' + diag.highestQ.skipped +
        ', gated=' + diag.highestQ.gated + ')');
    log('  HQ DOMINANT: found=' + diag.hqDominant.found +
        ', used=' + diag.hqDominant.used +
        ', boostedOU=' + diag.hqDominant.boostedOU +
        ', boostedOU_DIR=' + diag.hqDominant.boostedOUDir);

    log('  FT O/U: ' + diag.ftOU.found + '/' + diag.ftOU.attempted +
        ' (skipped=' + diag.ftOU.skipped +
        ', noLine=' + diag.ftOU.noLine +
        ', noForebet=' + diag.ftOU.noForebet +
        ', errors=' + diag.ftOU.errors + ')');

    if (Object.keys(diag.ftOU.muSources).length > 0) {
      var srcParts = [];
      for (var src in diag.ftOU.muSources) {
        if (diag.ftOU.muSources.hasOwnProperty(src)) {
          srcParts.push(src + '=' + diag.ftOU.muSources[src]);
        }
      }
      log('  FT O/U μ-sources: ' + srcParts.join(', '));
    }

    log('  OU candidates: ' + diag.ouCandidates + ' | OU_DIR: ' + diag.ouDirCandidates);
    Logger.log('───────────────────────────────────────────────────────────────');

    // ═══════════════════════════════════════════════════════════════════════════
    // SELECT FINAL PICKS
    // ═══════════════════════════════════════════════════════════════════════════
    var bankers = (typeof _selectBankers === 'function')
      ? _selectBankers(bankerCandidates, config)
      : bankerCandidates;

    var snipers = (typeof _selectSnipers === 'function')
      ? _selectSnipers(sniperCandidates, config, tierCuts)
      : sniperCandidates;

    if (typeof _capSnipersPerGame === 'function') {
      snipers = _capSnipersPerGame(snipers, config.maxSnipersPerGame);
    }

// ─────────────────────────────────────────────────────────────
// FORCE INCLUDE HSQ if selection dropped them all
// (Observed in your log: _selectSnipers ... (HQ: 0) while HSQ found>0)
// ─────────────────────────────────────────────────────────────
(function forceIncludeHQ_() {
  function isHQPick_(p) {
    if (!p) return false;
    if (p.isHighQtr === true || p.isHQ === true) return true;
    if (String(p.signalType || '').toUpperCase() === 'HIGH_QTR') return true;
    var txt = String(p.pick || '');
    return (/Highest\s*Q/i.test(txt) && /Q([1-4])/i.test(txt));
  }

  function num_(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }

  // Candidates that already passed your HQ gate are in sniperCandidates
  var hqCand = (sniperCandidates || []).filter(isHQPick_);
  var hqInSnipers = (snipers || []).filter(isHQPick_);

  // Add a quick diagnostic so you can confirm counts in logs
  log('HSQ PRE-FORCE: candidatesHQ=' + hqCand.length + ' selectedHQ=' + hqInSnipers.length);

  if (!hqCand.length) return;          // nothing to add
  if (hqInSnipers.length > 0) return;  // already present

  // how many to inject
  var maxHQ = num_(config && config.hqMaxPerSlip, 1);
  if (!isFinite(maxHQ) || maxHQ <= 0) maxHQ = 1;
  maxHQ = Math.max(1, Math.min(5, Math.round(maxHQ)));

  // sort by confidence desc
  hqCand.sort(function(a, b) {
    return num_(b.confidence, 0) - num_(a.confidence, 0);
  });

  // avoid duplicates
  var seen = {};
  for (var i = 0; i < snipers.length; i++) {
    var s = snipers[i];
    var k0 = (s.match || '') + '|' + (s.pick || '') + '|' + (s.type || '');
    seen[k0] = true;
  }

  var added = 0;
  for (var j = 0; j < hqCand.length && added < maxHQ; j++) {
    var p = hqCand[j];

    // clone + normalize as standard SNIPER row (grader + compatibility)
    var c = {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) c[k] = p[k];
    c.type = 'SNIPER';        // critical
    c.signalType = 'HIGH_QTR';
    c.market = c.market || 'HIGH_QTR';

    // ensure numeric confidence
    c.confidence = num_(c.confidence, 55);

    var key = (c.match || '') + '|' + (c.pick || '') + '|' + (c.type || '');
    if (seen[key]) continue;

    snipers.push(c);
    seen[key] = true;
    added++;
  }

  log('HSQ FORCE-INCLUDE: added=' + added + ' (maxHQ=' + maxHQ + ')');
})();


    robberCandidates.sort(function(a, b) {
      return toNum(b.confidence, 0) - toNum(a.confidence, 0);
    });
    
    var robbers = [];
    for (var ri = 0; ri < robberCandidates.length; ri++) {
      var p = robberCandidates[ri];
      var conf = toNum(p.confidence, 0);
      if (conf >= config.robberMinConf) {
        if (robbers.length < config.robberMaxPicks) {
          robbers.push(p);
        } else {
          log('ROBBER SKIPPED: Max picks (' + config.robberMaxPicks + ') reached. Dropping ' + p.pick + ' (' + conf + '%)');
        }
      } else {
        log('ROBBER SKIPPED: Tier=' + (p.tier || 'WEAK') + ' below inclusion threshold (' + conf + '% < ' + config.robberMinConf + '%). Dropping ' + p.pick);
      }
    }

    firstHalfCandidates.sort(function(a, b) {
      return toNum(b.confidence, 0) - toNum(a.confidence, 0);
    });
    var firstHalves = firstHalfCandidates;

    ftOUCandidates.sort(function(a, b) {
      var evDiff = toNum(b.ev, 0) - toNum(a.ev, 0);
      return evDiff !== 0 ? evDiff : (toNum(b.confidence, 0) - toNum(a.confidence, 0));
    });
    var ftOUs = ftOUCandidates;

    log('FINAL PICKS: Bankers=' + bankers.length +
        ', Snipers=' + snipers.length +
        ', Robbers=' + robbers.length +
        ', 1H=' + firstHalves.length +
        ', FT_OU=' + ftOUs.length);

    // ═══════════════════════════════════════════════════════════════════════════
    // OUTPUT
    // ═══════════════════════════════════════════════════════════════════════════
    if (typeof _writeBetSlipsEnhanced !== 'function') {
      throw new Error('_writeBetSlipsEnhanced not found');
    }

    _writeBetSlipsEnhanced(ss, {
      bankers: bankers,
      snipers: snipers,
      robbers: robbers,
      firstHalves: firstHalves,
      ftOUs: ftOUs
    }, config, tierCuts, enhEnabled);

// Split combined SNIPERS block into 3 separate blocks
    try {
      if (typeof splitSnipersIntoThreeBlocks_BetSlips_ === 'function') {
        splitSnipersIntoThreeBlocks_BetSlips_(ss);
      }
    } catch (eSplit) {
      Logger.log('[buildAccumulator] SNIPERS split error (non-fatal): ' + (eSplit && eSplit.message ? eSplit.message : eSplit));
    }

    var summary = 'Bankers: ' + bankers.length +
      ', Snipers: ' + snipers.length +
      ', Robbers: ' + robbers.length +
      ', 1H: ' + firstHalves.length +
      ', FT O/U: ' + ftOUs.length;

    Logger.log('═══════════════════════════════════════════════════════════════');
    Logger.log('  ACCUMULATOR COMPLETE: ' + summary);
    Logger.log('═══════════════════════════════════════════════════════════════');
    Logger.log('[PHASE 3 COMPLETE] Accumulator canonicalizeConfig + validateConfigState_ + Bet_Slips 23-col');

    ss.toast('Done! ' + summary, 'Ma Golide', 5);

    return {
      ok: true,
      version: VERSION,
      summary: summary,
      bankers: bankers.length,
      snipers: snipers.length,
      robbers: robbers.length,
      firstHalves: firstHalves.length,
      ftOUs: ftOUs.length,
      diagnostics: diag
    };

  } catch (e) {
    Logger.log('!!! ACCUMULATOR ERROR !!!\n' + e.message + (e.stack ? '\n' + e.stack : ''));
    ui.alert('Accumulator Error', e.message, ui.ButtonSet.OK);
    return { ok: false, error: e.message };
  }
}



/**
 * Builds FT config from Config_Tier2 sheet — called by buildAccumulator
 */
function _buildFTConfig_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config_Tier2');
  
  // Default config if sheet not found
  var defaults = {
    ft: {
      minConf: 55, minEV: 0.005, edgeThreshold: 0.04, americanOdds: -110,
      sigmaFloor: 6, sigmaScale: 1.0, sigmaFromLinePct: 0.075,
      shrinkK: 8, confidenceScale: 20, minSamples: 5,
      modelError: 4.0, probTemp: 1.15,
      forebetWeight: 0.35, forebetEnabled: true,
      leaguePriorByLeague: {
        'NBA':        { mu: 229.9, sigma: 17.5, forebetBias: 0.08, clampMin: 180, clampMax: 280 },
        'EuroLeague': { mu: 160.2, sigma: 14.1, forebetBias: 0.05, clampMin: 140, clampMax: 200 },
        'WNBA':       { mu: 165.0, sigma: 14.0, forebetBias: 0.06, clampMin: 140, clampMax: 200 },
        'NCAA':       { mu: 145.0, sigma: 16.0, forebetBias: 0.07, clampMin: 120, clampMax: 180 }
      },
      knownFallbackValue: 105,
      debugLogging: false
    }
  };
  
  if (!sheet) {
    Logger.log('[_buildFTConfig_] Config_Tier2 not found, using defaults');
    return defaults;
  }
  
  var data = sheet.getDataRange().getValues();
  var raw = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    var val = data[i][1];
    if (key && key.indexOf('---') === -1) {
      raw[key] = val;
    }
  }
  
  function toNum(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function toBool(v, d) {
    if (v === true || v === false) return v;
    var s = String(v || '').toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
    return d;
  }
  
  return {
    raw: raw,
    ft: {
      minConf:         toNum(raw.ou_min_conf, 55),
      minEV:           toNum(raw.ou_min_ev, 0.005),
      edgeThreshold:   toNum(raw.ou_edge_threshold, 0.04),
      americanOdds:    toNum(raw.ou_american_odds, -110),
      sigmaFloor:      toNum(raw.ou_sigma_floor, 6),
      sigmaScale:      toNum(raw.ou_sigma_scale, 1.0),
      sigmaFromLinePct: 0.075,
      shrinkK:         toNum(raw.ou_shrink_k, 8),
      confidenceScale: toNum(raw.ou_confidence_scale, 20),
      minSamples:      toNum(raw.ou_min_samples, 5),
      modelError:      toNum(raw.ou_model_error, 4.0),
      probTemp:        toNum(raw.ou_prob_temp, 1.15),
      forebetWeight:   toNum(raw.forebet_ou_weight_ft, 0.35),
      forebetEnabled:  toBool(raw.forebet_blend_enabled, true),
      leaguePriorByLeague: defaults.ft.leaguePriorByLeague,
      knownFallbackValue: 105,
      debugLogging:    toBool(raw.debug_ou_logging, false)
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Extract FT Line
// ═══════════════════════════════════════════════════════════════════════════

function _m8_extractFTLine_(t2, row, t1Map) {
  // First check t2 object
  if (t2 && t2.ftLine != null && t2.ftLine !== '') {
    var v = parseFloat(t2.ftLine);
    if (isFinite(v) && v > 0) return v;
  }
  
  // Then check various column names in row
  var cols = ['avg', 'ft_line', 'ftline', 'total', 'line', 'ft_total', 'fttotal'];
  for (var i = 0; i < cols.length; i++) {
    if (t1Map[cols[i]] !== undefined) {
      var val = parseFloat(row[t1Map[cols[i]]]);
      if (isFinite(val) && val > 0) return val;
    }
  }
  
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Clear H1 Cache (called at start of accumulator)
// ═══════════════════════════════════════════════════════════════════════════

function clearH1Cache() {
  if (typeof __H1_CACHE__ !== 'undefined') {
    __H1_CACHE__ = {
      h2h: null,
      form: null,
      marginStats: null,
      loaded: false,
      timestamp: 0
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Inject Caches (utility function for external callers)
// ═══════════════════════════════════════════════════════════════════════════

function injectH1Caches(config, h2hStats, recentForm) {
  config = config || {};
  config._robbersH2H = h2hStats;
  config._robbersForm = recentForm;
  return config;
}


/**
 * runAccumulator - ROBUST v3.5.0
 * 
 * 4-LAYER DEFENSE:
 *   Layer 1: _deriveHighestQuarter_() returns single quarter
 *   Layer 2: buildAccumulator() belt-and-suspenders check
 *   Layer 3: _writeBetSlipsEnhanced wrapper sanitizes ALL picks pre-write
 *   Layer 4: Post-write sheet scrub catches any legacy escapes
 */
function runAccumulator(ss) {
  Logger.log('[runAccumulator] ROBUST v3.5.0 (4-Layer Quarter Sanitization)');
  
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  
  // LAYER 3: Install pre-write sanitization wrapper
  _acc_installWriteWrapper_();
  
  // LAYERS 1 & 2: Run buildAccumulator
  var result = buildAccumulator(ss);
  
// LAYER 4: Post-write sheet scrub
  try {
    var scrub = _acc_scrubBetSlipsSheet_(ss);
    Logger.log('[runAccumulator] Layer 4 post-scrub: ' + (scrub.touched || 0) + ' cells fixed');
    
    if (scrub.touched > 0 && result.diagnostics) {
      result.diagnostics.postScrubFixed = scrub.touched;
    }
  } catch (e) {
    Logger.log('[runAccumulator] Layer 4 error (non-fatal): ' + e.message);
  }

  return result;
}


/* ============================================================================
 * 5) _capSnipersPerGame
 * ============================================================================ */
function _capSnipersPerGame(snipers, maxPerGame) {
  if (!Array.isArray(snipers)) return [];
  if (!isFinite(maxPerGame) || maxPerGame <= 0) return snipers;
  
  var counts = {};
  var result = [];
  var dropped = 0;
  
  for (var i = 0; i < snipers.length; i++) {
    var s = snipers[i];
    if (!s) continue;
    
    // HIGH_QTR always exempt
    if (s.isHighQtr) { result.push(s); continue; }
    
    var key = _m8_normMatch_(s.match) || '__unknown__';
    counts[key] = counts[key] || 0;
    
    if (counts[key] < maxPerGame) {
      result.push(s);
      counts[key]++;
    } else {
      dropped++;
    }
  }
  
  if (dropped > 0) {
    Logger.log('[_capSnipersPerGame] Dropped ' + dropped + ' (max ' + maxPerGame + '/game)');
  }
  return result;
}

/**
 * ======================================================================
 * createAccumulatorConfigSheet()
 * ======================================================================
 * WHY: Initialize/reset accumulator configuration with all enhancement flags.
 * WHAT: Creates Config_Accumulator sheet with MODULE 9 options enabled.
 * HOW: Writes config key-value pairs with descriptions, applies formatting.
 * 
 * WHERE: Called from menu or during system initialization.
 * SAFE: Uses fallback if _getSheet() unavailable.
 * ======================================================================
 */
function createAccumulatorConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = (typeof _getSheet === 'function')
    ? _getSheet(ss, 'Config_Accumulator')
    : ss.getSheetByName('Config_Accumulator');

  var isNew = !sheet;
  if (isNew) {
    sheet = ss.insertSheet('Config_Accumulator');
  }

  // Canonical key list — all keys this module needs, with defaults
  var canonical = [
    ['banker_threshold',        60,      'Minimum confidence % for Banker picks'],
    ['min_banker_odds',         1.01,    'Minimum odds for bankers'],
    ['max_banker_odds',         3.0,     'Maximum odds for bankers'],
    ['sniper_min_margin',       2.5,     'Minimum margin for Sniper spread picks'],
    ['max_snipers_per_game',    2,       'Maximum Snipers per match (HIGH_QTR exempt)'],
    ['includeOUSignals',        'TRUE',  'Include Over/Under signals'],
    ['ouMinConf',               50,      'Minimum confidence % for O/U'],
    ['ouMinEdge',               2.0,     'Minimum edge score for O/U picks'],
    ['ou_min_ev',               5,       'Minimum EV % for O/U'],
    ['min_edge_score',          0.0,     'Global minimum edge score (0 = disabled)'],
    ['prefer_directional',      'TRUE',  'Use ou-best-dir / ou-best column'],
    ['include_highest_quarter', 'TRUE',  'Include Highest Scoring Quarter as Sniper'],
    ['hq_min_confidence',       55,      'Minimum confidence % for HQ picks'],
    ['hq_skip_ties',            'TRUE',  'Skip tied-quarter HQ picks'],
    ['includeHQSignals',        'TRUE',  'Include HQ signals in accumulator'],
    ['hq_enabled',              'TRUE',  'Master toggle for HQ processing'],
    ['prefer_strong_tier',      'TRUE',  'Give STRONG/MEDIUM games sort priority bonus'],
    ['enable_robbers',          'TRUE',  'Enable ROBBERS (upset detection) picks'],
    ['robber_min_conf',         54,      'Minimum confidence % for ROBBER picks'],
    ['robber_max_picks',        10,      'Maximum ROBBER picks to include'],
    ['enable_first_half',       'TRUE',  'Enable First Half 1x2 predictions'],
    ['first_half_min_conf',     58,      'Minimum confidence % for 1H picks'],
    ['enable_ft_ou',            'TRUE',  'Enable Full Time Over/Under predictions'],
    ['ft_ou_min_conf',          55,      'Minimum confidence % for FT O/U'],
    ['ft_ou_min_ev',            0.005,   'Minimum EV for FT O/U (decimal)'],
    ['enable_enhanced_highest_q', 'TRUE','Use enhanced highest quarter from MODULE 9']
  ];

  if (isNew) {
    // Write header + all canonical rows on a fresh sheet
    var rows = [['Parameter', 'Value', 'Description']];
    for (var ci = 0; ci < canonical.length; ci++) {
      rows.push(canonical[ci]);
    }
    rows.push(['last_updated', new Date(), 'Auto-updated timestamp']);
    rows.push(['version', 'v2.12', 'Config version']);

    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#d9ead3');
    sheet.autoResizeColumns(1, 2);
    sheet.setColumnWidth(3, 350);
    Logger.log('Config_Accumulator created fresh (createAccumulatorConfigSheet)');

  } else {
    // Existing sheet — only append missing keys, never overwrite
    var existing = sheet.getDataRange().getValues();
    var existingKeys = {};
    for (var ei = 0; ei < existing.length; ei++) {
      var ek = String(existing[ei][0] || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
      if (ek) existingKeys[ek] = true;
    }

    var toAppend = [];
    for (var ki = 0; ki < canonical.length; ki++) {
      var rowKey = String(canonical[ki][0] || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
      if (!existingKeys[rowKey]) {
        toAppend.push(canonical[ki]);
      }
    }

    if (toAppend.length > 0) {
      var nextRow = existing.length + 1;
      sheet.getRange(nextRow, 1, toAppend.length, 3).setValues(toAppend);
      Logger.log('Config_Accumulator: appended ' + toAppend.length + ' missing keys');
    } else {
      Logger.log('Config_Accumulator: all keys already present');
    }
  }

  ss.toast('Config_Accumulator is complete and up to date', 'Ma Golide', 3);
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────────
// SECTION 8: BET SLIPS WRITER — _writeBetSlipsEnhanced
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Parse "Home vs Away" (or @ / v) for Contract_Enforcer IDs.
 */
function _m8_parseMatchTeamsForIds_(matchStr) {
  var s = String(matchStr || '').trim();
  if (!s) return { home: '', away: '' };
  if (/\s+@\s+/.test(s)) {
    var tmp = s.split(/\s+@\s+/);
    if (tmp.length >= 2) {
      return { home: String(tmp[1]).trim(), away: String(tmp[0]).trim() };
    }
  }
  var parts = s.split(/\s+vs\.?\s+/i);
  if (parts.length < 2) parts = s.split(/\s+v\s+/i);
  if (parts.length < 2) return { home: '', away: '' };
  return { home: String(parts[0]).trim(), away: String(parts[1]).trim() };
}

/**
 * Universal + source prediction IDs (slip index applied in _formatBetSlipRow_).
 */
function _m8_readConfigVersions_(ss) {
  var o = { t1: '', t2: '' };
  try {
    if (typeof loadTier1Config === 'function') {
      var c1 = loadTier1Config(ss);
      o.t1 = String((c1 && (c1.version || c1.config_version)) || '');
    }
  } catch (e1) {}
  try {
    if (typeof loadTier2Config === 'function') {
      var c2 = loadTier2Config(ss);
      o.t2 = String((c2 && (c2.config_version || c2.version)) || '');
    }
  } catch (e2) {}
  return o;
}

function _m8_forensicIdsForSlip_(pick, market, period, cfgVer) {
  var teams = (pick && pick.home && pick.away)
    ? { home: pick.home, away: pick.away }
    : _m8_parseMatchTeamsForIds_(pick && pick.match);
  var cv = String(cfgVer || (typeof CONTRACT_VERSION !== 'undefined' ? CONTRACT_VERSION : 'ACC'));
  var universalGameId = '';
  try {
    if (typeof buildUniversalGameID_ === 'function' && teams.home && teams.away) {
      universalGameId = buildUniversalGameID_(pick && pick.date, teams.home, teams.away);
    }
  } catch (e1) {
    Logger.log('[_m8_forensicIdsForSlip_] buildUniversalGameID_: ' + e1.message);
  }
  if (!universalGameId && typeof standardizeDate_ === 'function' && teams.home && teams.away) {
    var ymd = standardizeDate_(pick && pick.date);
    var y = (ymd && ymd.replace(/-/g, '')) || 'NODATE';
    universalGameId = y + '__' + String(teams.home).toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '__' + String(teams.away).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }
  var sourcePredictionRecordId = '';
  try {
    if (typeof buildPredictionRecordID_ === 'function' && universalGameId) {
      sourcePredictionRecordId = buildPredictionRecordID_(universalGameId, market, period, cv);
    }
  } catch (e2) {
    Logger.log('[_m8_forensicIdsForSlip_] buildPredictionRecordID_: ' + e2.message);
  }
  return { universalGameId: universalGameId, sourcePredictionRecordId: sourcePredictionRecordId };
}

function _extractFirstNumber_(s) {
  var m = String(s || '').match(/([+-]?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
}

function _extractParenNumber_(s) {
  // pulls 5.4 from "(5.4)" or "(-8.9)"
  var m = String(s || '').match(/\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/);
  return m ? parseFloat(m[1]) : NaN;
}

function _parseAHSide_(s) {
  // looks for "Q1: A +8.0" or "Q2: H +4.0" or "A +8.0"
  var t = String(s || '').toUpperCase();
  if (t.match(/\bA\b/)) return 'AWAY';
  if (t.match(/\bH\b/)) return 'HOME';
  return '';
}

/**
 * Normalize non-odds/non-EV selection fields to satisfy BET_SLIPS_CONTRACT_23.
 * Call this right before you assemble the 23-column output row.
 */
function _normalizeSelectionFields_(bet) {
  // Expect bet to be an object with:
  // bet.market, bet.period, bet.home, bet.away,
  // bet.selectionSide, bet.selectionLine, bet.selectionTeam, bet.selectionText

  var market = String(bet.market || '').toUpperCase();
  var period = String(bet.period || '').toUpperCase();
  var text   = String(bet.selectionText || '').trim();

  // --- FIRST HALF handicap: fill missing positive lines from "(5.4)"
  if (market === 'FIRST_HALF_1X2') {
    if ((bet.selectionLine === '' || bet.selectionLine == null || !isFinite(bet.selectionLine)) && text) {
      var n = _extractParenNumber_(text);
      if (!isFinite(n)) n = _extractFirstNumber_(text);
      if (isFinite(n)) bet.selectionLine = n;
    }
  }

  // --- SNIPER_MARGIN: fill side/team from A/H if missing
  if (market === 'SNIPER_MARGIN') {
    if (!bet.selectionSide) {
      var s = _parseAHSide_(text);
      if (s) bet.selectionSide = s;
    }
    if (!bet.selectionTeam) {
      if (bet.selectionSide === 'HOME') bet.selectionTeam = bet.home || '';
      if (bet.selectionSide === 'AWAY') bet.selectionTeam = bet.away || '';
    }
  }

  // --- Totals: ensure Selection_Team not blank
  if (market === 'FT_OU' || market === 'SNIPER_OU') {
    if (!bet.selectionTeam) bet.selectionTeam = bet.selectionSide || '';
  }

  // --- Highest quarter (your output shows Market=SNIPER, Period=Q2, text="Highest Q: Q2")
  // If you have a dedicated market name for this internally, add it too.
  if (market === 'SNIPER') {
    if (text.toUpperCase().indexOf('HIGHEST') !== -1) {
      if (!bet.selectionSide) bet.selectionSide = period;  // Q2
      if (!bet.selectionTeam) bet.selectionTeam = period;  // Q2
      // Selection_Line should be same as Selection_Side
      bet.selectionLine = period;
    }
  }

  // --- BANKER and ROBBER: fill Selection_Line with 1 (HOME) or 2 (AWAY)
  if (market === 'BANKER' || market === 'ROBBER') {
    if (!bet.selectionLine) {
      if (bet.selectionSide === 'HOME') bet.selectionLine = '1';
      else if (bet.selectionSide === 'AWAY') bet.selectionLine = '2';
    }
  }

  return bet;
}


/**
 * One machine row for Bet_Slips — BET_SLIPS_CONTRACT_23 (patched).
 * Forces Tier_Code + Tier_Display consistency.
 *
 * cfgBundle: { t1, t2, acc } config version stamps.
 */
function _formatBetSlipRow_(pick, market, period, cfgBundle, slipIndex,
  formatTime, formatOdds, formatEV, getTierDisplay, getTierLabel, confPct, typeLabel) {

  // ─── IDs / metadata ────────────────────────────────────────────────────────
  var accVer = cfgBundle && cfgBundle.acc != null ? cfgBundle.acc : '';
  var ids = _m8_forensicIdsForSlip_(pick, market, period, accVer);

  var betRecordId = '';
  try {
    if (typeof buildBetRecordID_ === 'function' && ids.sourcePredictionRecordId) {
      betRecordId = buildBetRecordID_(ids.sourcePredictionRecordId, slipIndex);
    }
  } catch (eB) {
    Logger.log('[_formatBetSlipRow_] buildBetRecordID_: ' + eB.message);
  }

  var teams = (pick && pick.home && pick.away)
    ? { home: pick.home, away: pick.away }
    : _m8_parseMatchTeamsForIds_(pick && pick.match);

  var stdDate = (typeof standardizeDate_ === 'function')
    ? standardizeDate_(pick && pick.date)
    : '';

  // ─── Confidence normalization (supports 0.57 -> 57) ────────────────────────
  var c = Number(confPct);
  if (!isFinite(c)) c = 0;
  if (c > 0 && c <= 1) c = c * 100;             // probability -> percent
  var confInt = Math.round(Math.max(0, Math.min(100, c)));
  var confProb = confInt / 100;

  // ─── Tier_Code (source of truth: pick.tier if provided) ────────────────────
  var tierCode =
    (pick && (pick.tier || pick.tierCode || pick.tier_code)) ||
    (getTierLabel ? getTierLabel(confInt) : '') ||
    '';

  // If still empty, try getTierObject
  if (!tierCode && typeof getTierObject === 'function') {
    try {
      var tObj = getTierObject(confInt);
      if (tObj && tObj.tier) tierCode = tObj.tier;
    } catch (eT) {}
  }

  // Final fallback
  if (!tierCode) {
    tierCode = (confInt >= 70) ? 'ELITE' :
               (confInt >= 63) ? 'STRONG' :
               (confInt >= 55) ? 'MEDIUM' : 'WEAK';
  }

  // ─── EV + odds handling for display ────────────────────────────────────────
  var oddsNum = Number(pick && pick.odds);
  var oddsValid = isFinite(oddsNum) && oddsNum > 1.01;

  var evNum = Number(pick && pick.ev);
  var evValid = isFinite(evNum);

  // For Tier_Display symbol only: EV unknown if odds missing/invalid
  var evForTierDisplay = (oddsValid && evValid) ? evNum : null;

  // ─── Tier_Display (must follow Tier_Code) ──────────────────────────────────
  var tierDisplay =
    (pick && (pick.tierDisplay || pick.tier_display)) ||
    (typeof _formatTierDisplay_ === 'function'
      ? _formatTierDisplay_(confInt, evForTierDisplay, tierCode)
      : ((getTierDisplay && getTierDisplay(confInt)) || ''));

  // ─── Selection parsing ─────────────────────────────────────────────────────
  var pickStr = String((pick && pick.pick) || '');
  var pU = pickStr.toUpperCase();

  var side = '';
  var lineStr = '';
  var selectionTeam = '';

  if (pU.indexOf('OVER') >= 0) {
    side = 'OVER';
    var _ovM = pickStr.match(/OVER\s*([+-]?\d+\.?\d*)/i);
    if (_ovM) lineStr = _ovM[1];
  } else if (pU.indexOf('UNDER') >= 0) {
    side = 'UNDER';
    var _unM = pickStr.match(/UNDER\s*([+-]?\d+\.?\d*)/i);
    if (_unM) lineStr = _unM[1];
  } else {
    var _homeU = (teams.home || '').toUpperCase();
    var _awayU = (teams.away || '').toUpperCase();
    if (_homeU && pU.indexOf(_homeU) >= 0) {
      side = 'HOME';
      selectionTeam = teams.home;
    } else if (_awayU && pU.indexOf(_awayU) >= 0) {
      side = 'AWAY';
      selectionTeam = teams.away;
    }
    var _marginM = pickStr.match(/([+-]\d+\.?\d*)/);
    if (_marginM) lineStr = _marginM[1];
  }

  // Optional: normalize selection fields if your function exists
  if (typeof _normalizeSelectionFields_ === 'function') {
    var tempBet = {
      market: market,
      period: period,
      home: teams.home || '',
      away: teams.away || '',
      selectionSide: side,
      selectionLine: lineStr,
      selectionTeam: selectionTeam,
      selectionText: pickStr
    };

    tempBet = _normalizeSelectionFields_(tempBet);

    side = tempBet.selectionSide;
    lineStr = tempBet.selectionLine;
    selectionTeam = tempBet.selectionTeam;
    pickStr = tempBet.selectionText;
  }

  // ─── Output row ────────────────────────────────────────────────────────────
  var evDisp = formatEV(pick && pick.ev);
  var t1 = (cfgBundle && cfgBundle.t1) || '';
  var t2 = (cfgBundle && cfgBundle.t2) || '';
  var acc = (cfgBundle && cfgBundle.acc) || '';

  return [
    betRecordId,
    ids.universalGameId || '',
    ids.sourcePredictionRecordId || '',
    (pick && pick.league) || '',
    stdDate || (pick && pick.date) || '',
    teams.home || '',
    teams.away || '',
    market,
    period,
    side,
    lineStr,
    selectionTeam,
    pickStr,
    formatOdds(pick && pick.odds),
    confInt,
    confProb,
    evDisp,
    tierCode,
    tierDisplay,
    t1,
    t2,
    acc,
    'Module_8_Accumulator',
    '', // Config_Stamp_ID (filled by stampBatch)
    (pick && (pick.lineSource || pick.source)) || '' // Book_Line_Source
  ];
}



/**
 * _writeBetSlipsEnhanced — Write all picks to Bet_Slips sheet (25-col contract)
 *
 * This version:
 * - Fixes conf parsing (supports 0.57 -> 57%)
 * - Forces Tier_Code and Tier_Display to be consistent
 * - Uses pick.tier (if present) as the Tier_Code source of truth
 * - Uses _formatTierDisplay_(confPct, ev, tierCode) for Tier_Display
 * - Treats EV as unknown when odds are missing/invalid -> Tier_Display ends with "—"
 */
function _writeBetSlipsEnhanced(ss, picks, config, tierCuts, enhancementsEnabled) {
  var fn = '_writeBetSlipsEnhanced';

  // ─── GET OR CREATE SHEET ───────────────────────────────────────────────────
  var sheet = (typeof _getSheet === 'function')
    ? _getSheet(ss, 'Bet_Slips')
    : ss.getSheetByName('Bet_Slips');

  if (!sheet) sheet = ss.insertSheet('Bet_Slips');

  // Clear sheet before writing (preserving headers)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(23, sheet.getLastColumn())).clearContent();
  }
  var lastRowBefore = sheet.getLastRow();
  try { sheet.getRange('A:Y').setNumberFormat('@'); } catch (eFmt) {}

  // ─── NORMALIZE PICKS OBJECT ────────────────────────────────────────────────
  picks = picks || {};
  picks.bankers = picks.bankers || [];
  picks.snipers = picks.snipers || [];
  picks.robbers = picks.robbers || [];
  picks.firstHalves = picks.firstHalves || [];
  picks.ftOUs = picks.ftOUs || [];

  var NUM_COLS = 25;
  var slipSeq = 0;

  var cfgAcc = (config && (config.config_version_accumulator || config.acc_version || config.version)) ||
    (typeof CONTRACT_VERSION !== 'undefined' ? CONTRACT_VERSION : 'ACC');

  var cfgVers = (typeof _m8_readConfigVersions_ === 'function')
    ? _m8_readConfigVersions_(ss)
    : { t1: '', t2: '' };

  var cfgBundle = { t1: cfgVers.t1 || '', t2: cfgVers.t2 || '', acc: cfgAcc };

  var headers = (typeof BET_SLIPS_CONTRACT_25 !== 'undefined')
    ? BET_SLIPS_CONTRACT_25.slice()
    : [
      'Bet_Record_ID', 'Universal_Game_ID', 'Source_Prediction_Record_ID',
      'League', 'Date', 'Home', 'Away', 'Market', 'Period', 'Selection_Side', 'Selection_Line',
      'Selection_Team', 'Selection_Text', 'Odds', 'Confidence_Pct', 'Confidence_Prob', 'EV',
      'Tier_Code', 'Tier_Display', 'Config_Version_T1', 'Config_Version_T2', 'Config_Version_Acc', 'Source_Module',
      'Config_Stamp_ID', 'Book_Line_Source'
    ];

  function pad25(cells) {
    var r = cells ? cells.slice() : [];
    while (r.length < NUM_COLS) r.push('');
    return r;
  }

  function slipPeriodFromSniper_(sp) {
    var m = String((sp && sp.pick) || '').match(/\bQ([1-4])\b/i);
    return m ? ('Q' + m[1]) : 'FT';
  }

  function slipMarketFromSniper_(sp) {
    if (!sp) return 'SNIPER';
    var sig = String(sp.signalType || '').toUpperCase();
    if (sig === 'MARGIN') return 'SNIPER_MARGIN';
    if (sig === 'OU' || sig === 'OU_STAR' || sig === 'OU_HQ' ||
        sig === 'OU_DIR' || sig === 'OU_DIR_HQ') return 'SNIPER_OU';
    if (sig === 'HIGH_QTR') return 'SNIPER';
    var p = String(sp.pick || '').toUpperCase();
    if (p.indexOf('OVER') >= 0 || p.indexOf('UNDER') >= 0) return 'SNIPER_OU';
    if (p.indexOf('+') >= 0 || p.indexOf('-') >= 0) return 'SNIPER_MARGIN';
    return 'SNIPER';
  }

  // ─── SAFE PARSERS/FORMATTERS ───────────────────────────────────────────────
  function parseConf(val) {
    var n;
    if (typeof val === 'number') n = val;
    else {
      var s = String(val || '').replace(/[%★●○\(\)]/g, '').trim();
      n = parseFloat(s);
    }
    if (!isFinite(n)) return 0;
    // If it's probability 0..1, convert to %
    if (n > 0 && n <= 1) n = n * 100;
    return n;
  }

  function _parseEvDecimal_(ev) {
    if (ev === undefined || ev === null || ev === '' || ev === '-') return null;
    if (typeof ev === 'number') return isFinite(ev) ? ev : null;
    var s = String(ev).trim();
    // "15.6%" -> 0.156
    if (s.indexOf('%') >= 0) {
      var n1 = parseFloat(s.replace('%', ''));
      return isFinite(n1) ? (n1 / 100) : null;
    }
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function formatEV(ev) {
    if (ev === undefined || ev === null || ev === '' || ev === '-') return '-';
    var n = Number(ev);
    if (!isFinite(n)) return '-';
    return (n * 100).toFixed(1) + '%';
  }

  function formatTime(t) {
    if (typeof _formatTime === 'function') {
      try { return _formatTime(t); } catch (e) {}
    }
    return String(t || '');
  }

  function formatOdds(odds) {
    if (odds === undefined || odds === null || odds === '' || odds === '-') return '-';
    var n = Number(odds);
    if (!isFinite(n) || n <= 0) return '-';
    return n.toFixed(2);
  }

  function _isValidOdds_(odds) {
    var n = Number(odds);
    return isFinite(n) && n > 1.01;
  }

  // Decide final tierCode + tierDisplay for a pick row
  function _finalTierForSlip_(pick, confPct) {
    var confInt = Math.round(Number(confPct));
    if (!isFinite(confInt)) confInt = 0;
    confInt = Math.max(0, Math.min(100, confInt));

    // Tier_Code: prefer pick.tier (source of truth)
    var tierCode = pick.tier || pick.tierCode || pick.tier_code;

    // If still missing, try getTierObject
    if (!tierCode && typeof getTierObject === 'function') {
      try {
        var tObj = getTierObject(confInt);
        if (tObj && tObj.tier) tierCode = tObj.tier;
      } catch (e) {}
    }

    // Hard fallback
    if (!tierCode) {
      tierCode = (confInt >= 70) ? 'ELITE' :
                 (confInt >= 63) ? 'STRONG' :
                 (confInt >= 55) ? 'MEDIUM' : 'WEAK';
    }

    // EV known only if odds are valid
    var evDec = _parseEvDecimal_(pick.ev);
    var evForDisplay = (_isValidOdds_(pick.odds) ? evDec : null);

    var tierDisplay = (typeof _formatTierDisplay_ === 'function')
      ? _formatTierDisplay_(confInt, evForDisplay, tierCode)
      : String(pick.tierDisplay || pick.tier_display || '');

    return { tierCode: tierCode, tierDisplay: tierDisplay, confInt: confInt };
  }

  // Push a row with fixed tier functions (prevents any downstream recompute)
  function _pushRow_(pickObj, market, period, typeLabel, confPct) {
    var fin = _finalTierForSlip_(pickObj, confPct);

    // Ensure pickObj carries the final tier fields (helpful for debugging)
    pickObj.tier = fin.tierCode;
    pickObj.tierCode = fin.tierCode;
    pickObj.tier_code = fin.tierCode;
    pickObj.tierDisplay = fin.tierDisplay;
    pickObj.tier_display = fin.tierDisplay;

    function tierDisplayFn_() { return fin.tierDisplay; }
    function tierLabelFn_() { return fin.tierCode; }

    slipSeq++;
    output.push(_formatBetSlipRow_(
      pickObj, market, period, cfgBundle, slipSeq,
      formatTime, formatOdds, formatEV,
      tierDisplayFn_, tierLabelFn_,
      fin.confInt, typeLabel
    ));
  }

  // ─── BUILD OUTPUT ──────────────────────────────────────────────────────────
  var output = [
    pad25(['Ma Golide Bet Slips - Generated: ' + new Date().toLocaleString() +
      (enhancementsEnabled ? ' [ENHANCED]' : '')]),
    pad25([])
  ];

  if (lastRowBefore > 0) {
    output.unshift(pad25([]));
    output.unshift(pad25(['── Bet_Slips run ' + new Date().toISOString() + ' ──']));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BANKERS
  // ═══════════════════════════════════════════════════════════════════════════
  output.push(pad25(['──── BANKERS (>=' + (config.bankerThreshold || 60) + '% Confidence) ────']));
  output.push(headers);

  if (picks.bankers.length) {
    for (var bi = 0; bi < picks.bankers.length; bi++) {
      var b = picks.bankers[bi];
      var bConf = parseConf(b.confidence);
      _pushRow_(b, 'BANKER', 'FT', 'BANKER', bConf);
    }
  } else {
    output.push(pad25(['No Bankers found']));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROBBERS
  // ═══════════════════════════════════════════════════════════════════════════
  if (picks.robbers && picks.robbers.length > 0) {
    output.push(pad25([]));
    output.push(pad25(['──── ROBBERS (Upset Picks) ────']));
    output.push(headers);

    for (var ri = 0; ri < picks.robbers.length; ri++) {
      var r = picks.robbers[ri];
      var rConf = parseConf(r.confidence);

      // Use robber object directly (keeps all fields _formatBetSlipRow_ might need)
      _pushRow_(r, 'ROBBER', 'FT', 'ROBBER', rConf);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRST HALF
  // ═══════════════════════════════════════════════════════════════════════════
  if (picks.firstHalves && picks.firstHalves.length > 0) {
    output.push(pad25([]));
    output.push(pad25(['──── FIRST HALF 1x2 ────']));
    output.push(headers);

    for (var hi = 0; hi < picks.firstHalves.length; hi++) {
      var h = picks.firstHalves[hi];
      var hConf = parseConf(h.confidence);
      _pushRow_(h, 'FIRST_HALF_1X2', '1H', '1H 1x2', hConf);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FT O/U
  // ═══════════════════════════════════════════════════════════════════════════
  if (picks.ftOUs && picks.ftOUs.length > 0) {
    output.push(pad25([]));
    output.push(pad25(['──── FULL TIME OVER/UNDER ────']));
    output.push(headers);

    for (var fi = 0; fi < picks.ftOUs.length; fi++) {
      var f = picks.ftOUs[fi];
      var fConf = parseConf(f.confidence);
      _pushRow_(f, 'FT_OU', 'FT', 'FT O/U', fConf);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNIPERS
  // ═══════════════════════════════════════════════════════════════════════════
  output.push(pad25([]));
  output.push(pad25(['──── SNIPERS (Margin + O/U) ────']));
  output.push(headers);

  if (picks.snipers.length) {
    for (var si = 0; si < picks.snipers.length; si++) {
      var s = picks.snipers[si];
      var sConf = parseConf(s.confidence);
      var sMkt = slipMarketFromSniper_(s);
      var sPer = slipPeriodFromSniper_(s);
      _pushRow_(s, sMkt, sPer, s.type || 'SNIPER', sConf);
    }
  } else {
    output.push(pad25(['No Snipers found']));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  var totalPicks = picks.bankers.length + picks.snipers.length + picks.robbers.length +
    picks.firstHalves.length + picks.ftOUs.length;

  output.push(pad25([]));
  output.push(pad25(['──── SUMMARY ────']));
  output.push(pad25(['Bankers:', String(picks.bankers.length), '',
    'ROBBERS:', String(picks.robbers.length), '',
    '1H:', String(picks.firstHalves.length), '', '']));
  output.push(pad25(['Snipers:', String(picks.snipers.length), '',
    'FT O/U:', String(picks.ftOUs.length), '', '', '', '', '']));
  output.push(pad25(['TOTAL PICKS:', String(totalPicks), '', '', '', '', '', '', '', '']));

  // ─── WRITE TO SHEET (append) ────────────────────────────────────────────────
  var writeStart = lastRowBefore + 1;
  sheet.getRange(writeStart, 1, output.length, NUM_COLS).setValues(output);

  // Column widths
  var widths = [150, 200, 220, 80, 90, 100, 100, 100, 70, 80, 90, 70, 260, 60, 90, 90, 70, 70, 120, 120, 120, 120, 120];
  for (var w = 0; w < widths.length; w++) sheet.setColumnWidth(w + 1, widths[w]);

  // ─── APPLY FORMATTING ──────────────────────────────────────────────────────
  for (var row = 0; row < output.length; row++) {
    var rowNum = writeStart + row;
    var firstCell = String(output[row][0] || '');
    var marketCell = String(output[row][7] || '');
    var range = sheet.getRange(rowNum, 1, 1, NUM_COLS);

    if (firstCell.indexOf('Ma Golide') === 0) {
      range.setFontWeight('bold').setFontSize(12).setBackground('#4285f4').setFontColor('#ffffff');
    } else if (firstCell.indexOf('──') === 0 && firstCell.indexOf('Bet_Slips run') !== -1) {
      range.setFontWeight('bold').setBackground('#f1f3f4');
    } else if (firstCell.indexOf('===') === 0) {
      range.setFontWeight('bold').setBackground('#f1f3f4');
    } else if (firstCell === 'Bet_Record_ID' || firstCell === 'Bankers:' || firstCell === 'TOTAL PICKS:') {
      range.setFontWeight('bold').setBackground('#e8eaed');
    } else if (marketCell === 'BANKER') {
      range.setBackground('#e6f4ea');
    } else if (marketCell === 'ROBBER') {
      range.setBackground('#fce4ec').setFontWeight('bold');
    } else if (marketCell === 'FIRST_HALF_1X2') {
      range.setBackground('#e3f2fd');
    } else if (marketCell === 'FT_OU') {
      range.setBackground('#fff3e0');
    } else if (marketCell.indexOf('STAR') !== -1) {
      range.setBackground('#fff2cc').setFontWeight('bold');
    } else if (marketCell.indexOf('HIGH QTR') !== -1) {
      range.setBackground('#e8f0fe').setFontWeight('bold');
    } else if (marketCell.indexOf('SNIPER') !== -1) {
      range.setBackground('#fce8b2');
    }
  }

  // Config stamp entire run efficiently
  if (typeof ConfigLedger_Satellite !== 'undefined' && ConfigLedger_Satellite.stampBatch) {
    ConfigLedger_Satellite.stampBatch(sheet, writeStart, output.length);
  }

  Logger.log('[' + fn + '] Bet_Slips appended from row ' + writeStart + ': ' + output.length +
    ' rows, ' + totalPicks + ' picks, slipSeq=' + slipSeq);
}


// =====================================================================
// OUTPUT
// =====================================================================

function _writeBetSlips(ss, bankers, snipers, config, tierCuts) {
  var sheet = _getSheet(ss, 'Bet_Slips');
  if (!sheet) sheet = ss.insertSheet('Bet_Slips');
  sheet.clear();
  sheet.getRange('A:J').setNumberFormat('@');

  var headers = ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier'];

  var output = [
    ['Ma Golide Bet Slips - Generated: ' + new Date().toLocaleString(), '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['──── BANKERS (>=' + config.bankerThreshold + '% Confidence) ────', '', '', '', '', '', '', '', '', ''],
    headers
  ];

  if (bankers.length) {
    for (var i = 0; i < bankers.length; i++) {
      var b = bankers[i];
      var confPct = _parseConfPct(b.confidence);
      var tier = _getTier(confPct, tierCuts);
      output.push([
        b.league, b.date, _formatTime(b.time), b.match,
        _alignPick(b.pick, tier), b.type,
        b.odds !== '-' ? String(b.odds) : '-',
        _formatConfPct(confPct), b.ev, _tierLabel(tier)
      ]);
    }
  } else {
    output.push(['No Bankers found', '', '', '', '', '', '', '', '', '']);
  }

  output.push(['', '', '', '', '', '', '', '', '', '']);
  output.push(['──── SNIPERS (O/U >=' + config.ouMinConf + '%, Margin >=+' + config.sniperMinMargin + ', Max ' + config.maxSnipersPerGame + '/game + HIGH_QTR) ────', '', '', '', '', '', '', '', '', '']);
  output.push(headers);

  if (snipers.length) {
    for (var j = 0; j < snipers.length; j++) {
      var s = snipers[j];
      var confPctS = _parseConfPct(s.confidence);
      var tierS = _getTier(confPctS, tierCuts);
      output.push([
        s.league, s.date, _formatTime(s.time), s.match,
        s.pick, s.type, '-',
        _formatConfPct(confPctS), s.ev || '-', _tierLabel(tierS)
      ]);
    }
  } else {
    output.push(['No Snipers found', '', '', '', '', '', '', '', '', '']);
  }

  output.push(['', '', '', '', '', '', '', '', '', '']);
  output.push(['──── SUMMARY ────', '', '', '', '', '', '', '', '', '']);
  output.push(['Total Bankers:', String(bankers.length), '', 'Total Snipers:', String(snipers.length), '', '', '', '', '']);

  sheet.getRange(1, 1, output.length, headers.length).setValues(output);

  // Column widths
  var widths = [80, 90, 70, 250, 260, 140, 60, 100, 70, 110];
  for (var w = 0; w < widths.length; w++) sheet.setColumnWidth(w + 1, widths[w]);

  // Formatting
  for (var r = 0; r < output.length; r++) {
    var rowNum = r + 1;
    var first = String(output[r][0] || '');
    var type = String(output[r][5] || '');
    var range = sheet.getRange(rowNum, 1, 1, 10);

    if (first.indexOf('Ma Golide') === 0) {
      range.setFontWeight('bold').setFontSize(12).setBackground('#4285f4').setFontColor('#ffffff');
    } else if (first.indexOf('===') === 0) {
      range.setFontWeight('bold').setBackground('#f1f3f4');
    } else if (first === 'League' || first === 'Total Bankers:') {
      range.setFontWeight('bold').setBackground('#e8eaed');
    } else if (type.indexOf('BANKER') !== -1) {
      range.setBackground('#e6f4ea');
    } else if (type.indexOf('STAR') !== -1) {
      range.setBackground('#fff2cc').setFontWeight('bold');
    } else if (type.indexOf('HIGH QTR') !== -1) {
      range.setBackground('#e8f0fe').setFontWeight('bold');
    } else if (type.indexOf('SNIPER') !== -1) {
      range.setBackground('#fce8b2');
    }
  }
}

// =====================================================================
// DEBUG
// =====================================================================

function debugOUSignals() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getTunedThresholds(ss);

  Logger.log('=== CONFIG ===');
  Logger.log('includeOUSignals: ' + config.includeOUSignals);
  Logger.log('includeHighestQuarter: ' + config.includeHighestQuarter);
  Logger.log('ouMinConf: ' + config.ouMinConf);
  Logger.log('ouMinEV: ' + config.ouMinEV);
  Logger.log('minEdgeScore: ' + config.minEdgeScore);
  Logger.log('maxSnipersPerGame: ' + config.maxSnipersPerGame);
  Logger.log('preferStrongTier: ' + config.preferStrongTier);

  var signals = _loadTier2Signals(ss, config);

  Logger.log('\n=== SIGNALS ===');
  for (var key in signals) {
    var s = signals[key];
    Logger.log('\n' + key);
    if (s.ouHighestEst) Logger.log('  HighestQ: ' + s.ouHighestEst);
    if (s.gameTier) Logger.log('  GameTier: ' + s.gameTier);

    for (var q in s.ou) {
      var ou = s.ou[q];
      if (ou) {
        Logger.log('  ' + q + ': ' + ou.direction + ' ' + ou.line +
          ' (Conf:' + (isFinite(ou.conf) ? ou.conf : '-') +
          '% EV:' + (isFinite(ou.ev) ? ou.ev.toFixed(1) : '-') +
          '% Edge:' + (isFinite(ou.edge) ? ou.edge : 'NaN') + ')');
      }
    }

    if (s.ouBestDir) {
      var bd = s.ouBestDir;
      Logger.log('  BestDir: ' + bd.quarter + ' ' + bd.direction + ' ' + bd.line +
        ' (Conf:' + (isFinite(bd.conf) ? bd.conf : '-') +
        '% EV:' + (isFinite(bd.ev) ? bd.ev.toFixed(1) : '-') +
        '% Edge:' + (isFinite(bd.edge) ? bd.edge : 'NaN') + ')');
    }
  }
}

function debugSniperSelection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getTunedThresholds(ss);
  var tierCuts = _loadTierCuts(ss);
  var signals = _loadTier2Signals(ss, config);

  Logger.log('=== SNIPER SELECTION DEBUG ===');
  Logger.log('minEdge: ' + config.minEdgeScore);
  Logger.log('minConf: ' + config.ouMinConf);
  Logger.log('minEV: ' + config.ouMinEV);

  var testCases = [];
  for (var key in signals) {
    var s = signals[key];
    for (var q in s.ou) {
      var ou = s.ou[q];
      if (ou) {
        testCases.push({
          match: key,
          quarter: q,
          conf: ou.conf,
          ev: ou.ev,
          edge: ou.edge
        });
      }
    }
  }

  Logger.log('\n=== EDGE GATING DECISIONS ===');
  for (var i = 0; i < testCases.length; i++) {
    var tc = testCases[i];
    var edge = tc.edge;
    var ev = tc.ev || 0;
    var conf = tc.conf || 0;

    var meetsConfOrEV = (conf >= config.ouMinConf) || (ev >= config.ouMinEV);
    var meetsEdge = true;
    var reason = '';

    if (config.minEdgeScore > 0) {
      if (!isFinite(edge)) {
        meetsEdge = ev >= config.ouMinEV;
        reason = 'edge=NaN, require EV>=' + config.ouMinEV;
      } else if (edge === 0) {
        if (isFinite(ev)) {
          meetsEdge = ev >= config.ouMinEV;
          reason = 'edge=0 + EV present, require EV>=' + config.ouMinEV;
        } else {
          meetsEdge = false;
          reason = 'edge=0 + EV missing, FAIL';
        }
      } else {
        meetsEdge = edge >= config.minEdgeScore;
        reason = 'edge=' + edge + ' vs min=' + config.minEdgeScore;
      }
    }

    var pass = meetsConfOrEV && meetsEdge;
    Logger.log(tc.quarter + ' ' + tc.match.substring(0, 30) +
      ' | Conf:' + (isFinite(conf) ? conf : '-') +
      ' EV:' + (isFinite(ev) ? ev.toFixed(1) : '-') +
      ' Edge:' + (isFinite(edge) ? edge : 'NaN') +
      ' | ' + reason +
      ' | ' + (pass ? 'PASS' : 'FAIL'));
  }
}


/**
 * PATCH 2026-04-19 (v2)
 * -----------------------------------------------------------------------------
 * Load Sniper quarter O/U picks from Bet_Slips using the canonical parser.
 *
 * Enhanced with VIBRANT DIAGNOSTICS to solve the "Loaded: 0" mystery.
 */
function loadBetSlipsSniperOUPicks_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var FN = '[loadBetSlipsSniperOUPicks_]';

  if (typeof loadBetSlipsComplete_ !== 'function') {
    Logger.log(FN + ' ERROR: loadBetSlipsComplete_ not found.');
    return [];
  }

  var betSlipsData = loadBetSlipsComplete_(ss);
  var rows = (betSlipsData && betSlipsData.rows) ? betSlipsData.rows : [];
  Logger.log(FN + ' Canonical rows parsed: ' + rows.length);

  function normDir_(v) {
    var s = String(v || '').trim().toUpperCase();
    if (s === 'O' || s === 'OVER') return 'OVER';
    if (s === 'U' || s === 'UNDER') return 'UNDER';
    return '';
  }

  function toNum_(v) {
    if (v === '' || v == null) return NaN;
    var n = parseFloat(String(v).replace(/[%,\s]/g, '').trim());
    return isFinite(n) ? n : NaN;
  }

  function quarterFrom_(periodU, pickU) {
    if (/^Q[1-4]$/.test(periodU)) return periodU;
    var qm = pickU.match(/\bQ([1-4])\b/i) || pickU.match(/Q([1-4])/i);
    return qm ? ('Q' + qm[1]) : '';
  }

  function parsePickDirLine_(pickU) {
    // Robust pattern: look for O/U/OVER/UNDER followed by a number
    // Handle cases like "O 58.5", "OVER 58.5", "U58.5", "Q1: UNDER 59.0"
    var dm = pickU.match(/\b(OVER|UNDER|O|U)\b\s*([0-9]+(?:\.[0-9]+)?)/i) || 
             pickU.match(/(OVER|UNDER|O|U)\s*([0-9]+(?:\.[0-9]+)?)/i);
             
    if (!dm) return { dir: '', line: NaN };
    var dirRaw = dm[1].toUpperCase();
    var dir = (dirRaw === 'O' || dirRaw === 'OVER') ? 'OVER' : 'UNDER';
    var line = parseFloat(dm[2]);
    return { dir: dir, line: isFinite(line) ? line : NaN };
  }

  var picks = [];
  var skippedCounts = { context: 0, quarter: 0, ou: 0 };

  rows.forEach(function(r, idx) {
    if (!r) return;

    var typeU = String(r.type || '').trim().toUpperCase();
    var secU  = String(r.section || '').trim().toUpperCase();
    var pickText = String(r.pick || '').trim();
    var pickU = pickText.toUpperCase();
    var periodU = String(r.period || '').trim().toUpperCase();

    // 1. Context Check
    var inSniperContext = (typeU.indexOf('SNIPER') !== -1) || (secU.indexOf('SNIPER') !== -1);
    
    // 2. Quarter Check
    var q = quarterFrom_(periodU, pickU);
    var isQuarter = !!q;

    // 3. O/U Check
    var selSide = '';
    var selLine = '';
    if (r.rawRow && r.headerMap && typeof getColValue_ === 'function') {
      selSide = getColValue_(r.rawRow, r.headerMap, ['selection_side', 'side', 'dir', 'direction']);
      selLine = getColValue_(r.rawRow, r.headerMap, ['selection_line', 'line', 'total']);
    }

    var dir = normDir_(selSide);
    var line = toNum_(selLine);

    // Fallback to parsing pick text if structured columns are empty
    if (!dir || !isFinite(line)) {
      var parsed = parsePickDirLine_(pickU);
      if (!dir) dir = parsed.dir;
      if (!isFinite(line)) line = parsed.line;
    }

    var isOU = !!dir && isFinite(line);

    // Logging for troubleshooting
    if (idx < 5 || (inSniperContext && idx < 20)) {
      Logger.log(FN + ' Row ' + (idx + 1) + ' Debug: ' + 
                 'Match=' + r.match + ' | ' +
                 'Type=' + typeU + ' | ' +
                 'Sec=' + secU + ' | ' +
                 'Pick=' + pickU + ' | ' +
                 'Period=' + periodU + ' | ' +
                 'Parsed: q=' + q + ' dir=' + dir + ' line=' + line + ' | ' +
                 'Flags: context=' + inSniperContext + ' qtr=' + isQuarter + ' ou=' + isOU);
    }

    if (!inSniperContext) { skippedCounts.context++; return; }
    if (!isQuarter) { skippedCounts.quarter++; return; }
    if (!isOU) { skippedCounts.ou++; return; }

    picks.push({
      source: 'Bet_Slips',
      type: 'SNIPER_OU',
      originalType: r.type || '',
      section: r.section || '',
      date: r.date || '',
      league: r.league || '',
      home: r.home || '',
      away: r.away || '',
      quarter: q,
      direction: dir,
      line: line,
      confidence: r.confidence || '',
      ev: r.ev || '',
      tier: r.tier || '',
      pick: pickText,
      period: r.period || '',
      sourceRow: r.sourceRow || ''
    });
  });

  Logger.log(FN + ' FINAL: Loaded ' + picks.length + ' Sniper O/U picks');
  if (picks.length === 0) {
    Logger.log(FN + ' SKIP SUMMARY: context=' + skippedCounts.context + 
               ', quarter=' + skippedCounts.quarter + 
               ', ou=' + skippedCounts.ou);
  }

  return picks;
}

/**
 * =====================================================================
 * FUNCTION 2: evaluateBetSlipsOUPicks_(...)
 * =====================================================================
 * Writer-compatible bucket shapes:
 *   byQuarter[Qx] = { c, t }
 *   byDirection[dir] = { c, t }
 *   byLeague[league] = { t, c, l, p }
 *   byType[type] = { bets, correct, incorrect, push, accuracy }
 */
function evaluateBetSlipsOUPicks_(slipPicks, resultMapData, resH, quarterFormat) {
  var eval_ = {
    source: 'BET_SLIPS',

    all: { total: 0, matched: 0, correct: 0, incorrect: 0, push: 0, pending: 0, accuracy: 0 },

    // Placeholders for writer compatibility (unused in BET_SLIPS mode)
    highestConf: { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    highestEV:   { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    composite:   { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    directional: { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },

    byQuarter: { 
      Q1: { c: 0, t: 0 }, 
      Q2: { c: 0, t: 0 }, 
      Q3: { c: 0, t: 0 }, 
      Q4: { c: 0, t: 0 } 
    },
    byDirection: { 
      OVER:  { c: 0, t: 0 }, 
      UNDER: { c: 0, t: 0 } 
    },
    byLeague: {},
    byType: {},

    details: [],
    duplicatesSkipped: 0,
    lookupFailures: []
  };

  var seen = {};

  function normPct_(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) return 0;
    return (n > 0 && n <= 1) ? n * 100 : n;
  }

  for (var i = 0; i < (slipPicks || []).length; i++) {
    var p = slipPicks[i];
    if (!p || !p.home || !p.away || !p.quarter || !p.direction || !isFinite(p.line)) continue;

    var dateStr = normalizeDateStr_(p.date);
    var homeNorm = normalizeTeamName_(p.home);
    var awayNorm = normalizeTeamName_(p.away);

    // Dedup key includes type to distinguish different bet types on same game/quarter
    var dedupKey = [
      dateStr || 'NODATE',
      homeNorm,
      awayNorm,
      p.quarter,
      p.direction,
      Number(p.line).toFixed(2),
      String(p.type || '').toUpperCase()
    ].join('|');

    if (seen[dedupKey]) { 
      eval_.duplicatesSkipped++; 
      continue; 
    }
    seen[dedupKey] = true;

    eval_.all.total++;

    // Lookup result (try both orderings to reduce false pending)
    var resultRow = lookupResult_(resultMapData, p.date, p.home, p.away) ||
                    lookupResult_(resultMapData, p.date, p.away, p.home);

    if (!resultRow) {
      eval_.all.pending++;
      eval_.lookupFailures.push({ 
        date: dateStr || p.dateRaw, 
        home: p.home, 
        away: p.away, 
        reason: 'No result found' 
      });
      continue;
    }

    var qTotals = getQuarterTotals_(resultRow, resH, quarterFormat);
    if (!qTotals || !isFinite(qTotals[p.quarter])) {
      eval_.all.pending++;
      eval_.lookupFailures.push({ 
        date: dateStr || p.dateRaw, 
        home: p.home, 
        away: p.away, 
        reason: 'No ' + p.quarter + ' total in results' 
      });
      continue;
    }

    eval_.all.matched++;

    var actual = qTotals[p.quarter];
    var outcome = evaluateOUOutcome_(p.direction, p.line, actual);
    var diff = actual - p.line;

    // Update overall counts
    if (outcome === 'WIN') {
      eval_.all.correct++;
    } else if (outcome === 'LOSS') {
      eval_.all.incorrect++;
    } else {
      eval_.all.push++;
    }

    // ─── GUARD: Initialize unexpected quarter/direction keys ──────
    if (!eval_.byQuarter[p.quarter]) {
      eval_.byQuarter[p.quarter] = { c: 0, t: 0 };
    }
    if (!eval_.byDirection[p.direction]) {
      eval_.byDirection[p.direction] = { c: 0, t: 0 };
    }

    // Update byQuarter (shape: { c, t })
    eval_.byQuarter[p.quarter].t++;
    if (outcome === 'WIN') eval_.byQuarter[p.quarter].c++;

    // Update byDirection (shape: { c, t })
    eval_.byDirection[p.direction].t++;
    if (outcome === 'WIN') eval_.byDirection[p.direction].c++;

    // Update byLeague (shape: { t, c, l, p })
    var league = p.league || 'Unknown';
    if (!eval_.byLeague[league]) {
      eval_.byLeague[league] = { t: 0, c: 0, l: 0, p: 0 };
    }
    eval_.byLeague[league].t++;
    if (outcome === 'WIN') eval_.byLeague[league].c++;
    else if (outcome === 'LOSS') eval_.byLeague[league].l++;
    else eval_.byLeague[league].p++;

    // Update byType (for BET_SLIPS breakdown)
    var typeName = String(p.type || 'Unknown').trim() || 'Unknown';
    if (!eval_.byType[typeName]) {
      eval_.byType[typeName] = { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 };
    }
    eval_.byType[typeName].bets++;
    if (outcome === 'WIN') eval_.byType[typeName].correct++;
    else if (outcome === 'LOSS') eval_.byType[typeName].incorrect++;
    else eval_.byType[typeName].push++;

    // Add detail row with expanded fields
    eval_.details.push({
      date: dateStr || p.dateRaw || '',
      league: league,
      home: p.home,
      away: p.away,
      quarter: p.quarter,
      direction: p.direction,
      line: p.line,
      actual: actual,
      outcome: outcome,
      diff: diff,
      confidence: normPct_(p.confidence || 0),
      ev: normPct_(p.ev || 0),
      tier: p.tier || '',
      strategies: [typeName]
    });
  }

  // Calculate accuracies
  eval_.all.accuracy = calcAccuracy_(eval_.all.correct, eval_.all.incorrect);

  Object.keys(eval_.byType).forEach(function(k) {
    var b = eval_.byType[k];
    b.accuracy = calcAccuracy_(b.correct, b.incorrect);
  });

  Logger.log('[evaluateBetSlipsOUPicks_] Results: ' +
    eval_.all.matched + ' matched, ' +
    eval_.all.correct + ' wins, ' +
    eval_.all.incorrect + ' losses, ' +
    eval_.all.push + ' pushes, ' +
    eval_.all.pending + ' pending');

  if (eval_.lookupFailures.length > 0) {
    Logger.log('[evaluateBetSlipsOUPicks_] First 5 lookup failures:');
    eval_.lookupFailures.slice(0, 5).forEach(function(f) {
      Logger.log('  - ' + f.date + ' | ' + f.home + ' vs ' + f.away + ' | ' + f.reason);
    });
  }

  return eval_;
}

/**
 * Accumulator configuration defaults - PATCHED for enhancements
 */
var ACCUMULATOR_DEFAULTS = {
  // [EXISTING]
  bankerThreshold: 50,
  sniperMinMargin: 2.5,
  maxSnipersPerGame: 8,
  includeOUSignals: true,
  ouMinConf: 50,
  ouMinEV: 5,
  ouMinEdge: 2.0,
  minEdgeScore: 0.0,
  preferDirectional: true,
  preferStrongTier: true,
  includeHighestQuarter: true,
  minBankerOdds: 1.01,
  maxBankerOdds: 3.0,

  // HQ controls
  hqEnabled: true,
  includeHQSignals: true,
  hqMinConfidence: 55,
  hqSkipTies: true,

  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 9 enhancement flags
  // ═══════════════════════════════════════════════════════════════════════
  enableRobbers: true,
  enableFirstHalf: true,
  enableFTOU: true,
  enableEnhancedHighestQ: true,

  // ROBBERS config
  robberMinConf: 48,
  robberMaxPicks: 10,

  // First Half config
  firstHalfMinConf: 58,

  // FT O/U config
  ftOUMinConf: 55,
  ftOUMinEV: 0.005
};

function loadAccumulatorConfig(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var cfg = {};
  for (var k in ACCUMULATOR_DEFAULTS) cfg[k] = ACCUMULATOR_DEFAULTS[k];

  var sheet = _getSheet(ss, 'Config_Accumulator');
  if (!sheet) return cfg;

  try {
    var data = sheet.getDataRange().getValues();
    var cfgMap = {};
    for (var r = 1; r < data.length; r++) {
      var key = String(data[r][0] || '').trim().toLowerCase().replace(/_/g, '');
      if (key) cfgMap[key] = data[r][1];
    }

    // [EXISTING CONFIG LOADING]
    if (cfgMap['bankerthreshold'] !== undefined) cfg.bankerThreshold = _toNum(cfgMap['bankerthreshold'], cfg.bankerThreshold);
    if (cfgMap['sniperminmargin'] !== undefined) cfg.sniperMinMargin = _toNum(cfgMap['sniperminmargin'], cfg.sniperMinMargin);
    if (cfgMap['maxsniperspergame'] !== undefined) cfg.maxSnipersPerGame = parseInt(cfgMap['maxsniperspergame'], 10) || cfg.maxSnipersPerGame;
    if (cfgMap['includeousignals'] !== undefined) cfg.includeOUSignals = _toBool(cfgMap['includeousignals']);
    if (cfgMap['ouminconf'] !== undefined) cfg.ouMinConf = _toNum(cfgMap['ouminconf'], cfg.ouMinConf);
    if (cfgMap['ouminev'] !== undefined) cfg.ouMinEV = _toNum(cfgMap['ouminev'], cfg.ouMinEV);
    if (cfgMap['minedgescore'] !== undefined) cfg.minEdgeScore = _toNum(cfgMap['minedgescore'], cfg.minEdgeScore);
    if (cfgMap['preferdirectional'] !== undefined) cfg.preferDirectional = _toBool(cfgMap['preferdirectional']);
    if (cfgMap['preferstrongtier'] !== undefined) cfg.preferStrongTier = _toBool(cfgMap['preferstrongtier']);
    if (cfgMap['includehighestquarter'] !== undefined) cfg.includeHighestQuarter = _toBool(cfgMap['includehighestquarter']);
    if (cfgMap['minbankerodds'] !== undefined) cfg.minBankerOdds = _toNum(cfgMap['minbankerodds'], cfg.minBankerOdds);
    if (cfgMap['maxbankerodds'] !== undefined) cfg.maxBankerOdds = _toNum(cfgMap['maxbankerodds'], cfg.maxBankerOdds);

    // ═══════════════════════════════════════════════════════════════════
    // NEW: Load MODULE 9 enhancement flags
    // ═══════════════════════════════════════════════════════════════════
    if (cfgMap['enablerobbers'] !== undefined) cfg.enableRobbers = _toBool(cfgMap['enablerobbers']);
    if (cfgMap['enablefirsthalf'] !== undefined) cfg.enableFirstHalf = _toBool(cfgMap['enablefirsthalf']);
    if (cfgMap['enableftou'] !== undefined) cfg.enableFTOU = _toBool(cfgMap['enableftou']);
    if (cfgMap['enableenhancedhighestq'] !== undefined) cfg.enableEnhancedHighestQ = _toBool(cfgMap['enableenhancedhighestq']);

    if (cfgMap['robberminconf'] !== undefined) cfg.robberMinConf = _toNum(cfgMap['robberminconf'], cfg.robberMinConf);
    if (cfgMap['robbermaxpicks'] !== undefined) cfg.robberMaxPicks = parseInt(cfgMap['robbermaxpicks'], 10) || cfg.robberMaxPicks;
    if (cfgMap['firsthalfminconf'] !== undefined) cfg.firstHalfMinConf = _toNum(cfgMap['firsthalfminconf'], cfg.firstHalfMinConf);
    if (cfgMap['ftouminconf'] !== undefined) cfg.ftOUMinConf = _toNum(cfgMap['ftouminconf'], cfg.ftOUMinConf);
    if (cfgMap['ftouminev'] !== undefined) cfg.ftOUMinEV = _toNum(cfgMap['ftouminev'], cfg.ftOUMinEV);

    // ═══════════════════════════════════════════════════════════════════
    // OU edge + HQ controls (persisted in Config_Accumulator)
    // ═══════════════════════════════════════════════════════════════════
    // Note: cfgMap keys are already lowercased + underscores stripped, so
    // 'ouMinEdge', 'ou_min_edge', 'oumin_edge' all map to 'ouminedge'
    if (cfgMap['ouminedge'] !== undefined) cfg.ouMinEdge = _toNum(cfgMap['ouminedge'], cfg.ouMinEdge);
    if (cfgMap['hqminconfidence'] !== undefined) cfg.hqMinConfidence = _toNum(cfgMap['hqminconfidence'], cfg.hqMinConfidence);
    if (cfgMap['hqminconf'] !== undefined) cfg.hqMinConfidence = _toNum(cfgMap['hqminconf'], cfg.hqMinConfidence);
    if (cfgMap['hqskipties'] !== undefined) cfg.hqSkipTies = _toBool(cfgMap['hqskipties']);
    if (cfgMap['includehqsignals'] !== undefined) cfg.includeHQSignals = _toBool(cfgMap['includehqsignals']);
    if (cfgMap['hqenabled'] !== undefined) cfg.hqEnabled = _toBool(cfgMap['hqenabled']);

  } catch (e) {
    Logger.log('[Config] Error: ' + e.message);
  }

  return cfg;
}

/**
 * ======================================================================
 * PATCHED: cleanEmptySheets
 * ======================================================================
 * WHY: Remove empty placeholder sheets that clutter the spreadsheet.
 * WHAT: Deletes sheets with only header row or completely empty.
 * HOW: Iterates all sheets, checks row count, deletes if <= 1 row.
 * 
 * SAFETY: 
 *   - Skips protected sheets (Config_*, Clean, Results*, Upcoming*, etc.)
 *   - Requires confirmation before bulk delete
 *   - Logs all deletions
 * 
 * WHERE: Called from Menu.gs or manually for cleanup
 * ======================================================================
 */
function cleanEmptySheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  // Protected sheet name patterns - never delete these even if empty
  var protectedPatterns = [
    /^config/i,
    /^clean$/i,
    /^results/i,
    /^upcoming/i,
    /^standings/i,
    /^analysis/i,
    /^stats/i,
    /^bet_?slips?/i,
    /^tier\d/i,
    /^menu/i,
    /^dashboard/i,
    /^summary/i,
    /^log/i,
    /^accuracy/i,
    /^inventory/i
  ];
  
  function isProtected(sheetName) {
    for (var i = 0; i < protectedPatterns.length; i++) {
      if (protectedPatterns[i].test(sheetName)) return true;
    }
    return false;
  }
  
  var sheets = ss.getSheets();
  var emptySheets = [];
  var protectedEmpty = [];
  
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    var lastRow = sheet.getLastRow();
    
    // Check if empty (0 rows) or only header (1 row)
    if (lastRow <= 1) {
      if (isProtected(name)) {
        protectedEmpty.push(name);
      } else {
        emptySheets.push({ sheet: sheet, name: name, rows: lastRow });
      }
    }
  }
  
  if (emptySheets.length === 0) {
    Logger.log('[cleanEmptySheets] No empty sheets found to delete');
    if (protectedEmpty.length > 0) {
      Logger.log('[cleanEmptySheets] Protected empty sheets (not deleted): ' + protectedEmpty.join(', '));
    }
    ss.toast('No empty sheets to clean up', 'Ma Golide', 3);
    return { deleted: 0, protected: protectedEmpty };
  }
  
  // Show confirmation
  var sheetList = emptySheets.slice(0, 20).map(function(s) { return s.name; }).join('\n');
  if (emptySheets.length > 20) {
    sheetList += '\n... and ' + (emptySheets.length - 20) + ' more';
  }
  
  var response = ui.alert(
    'Delete Empty Sheets?',
    'Found ' + emptySheets.length + ' empty sheets to delete:\n\n' + sheetList + 
    '\n\nProtected sheets (not deleted): ' + protectedEmpty.length +
    '\n\nProceed with deletion?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    ss.toast('Cleanup cancelled', 'Ma Golide', 3);
    return { deleted: 0, cancelled: true };
  }
  
  // Delete empty sheets
  var deleted = [];
  var failed = [];
  
  for (var j = 0; j < emptySheets.length; j++) {
    try {
      var sheetToDelete = emptySheets[j].sheet;
      var sheetName = emptySheets[j].name;
      
      // Double-check sheet still exists and is still empty
      if (sheetToDelete.getLastRow() <= 1) {
        ss.deleteSheet(sheetToDelete);
        deleted.push(sheetName);
        Logger.log('[cleanEmptySheets] Deleted: ' + sheetName);
      }
    } catch (e) {
      failed.push({ name: emptySheets[j].name, error: e.message });
      Logger.log('[cleanEmptySheets] Failed to delete ' + emptySheets[j].name + ': ' + e.message);
    }
  }
  
  var summary = 'Deleted ' + deleted.length + ' empty sheets';
  if (failed.length > 0) {
    summary += ', ' + failed.length + ' failed';
  }
  
  Logger.log('[cleanEmptySheets] ' + summary);
  ss.toast(summary, 'Ma Golide', 5);
  
  return {
    deleted: deleted.length,
    deletedSheets: deleted,
    failed: failed,
    protected: protectedEmpty
  };
}


/**
 * ======================================================================
 * PATCHED: writeInventorySheet (Orphan Deduplication Fix)
 * ======================================================================
 * WHY: Fix orphan bug where sheets appear in both categories AND orphans.
 * WHAT: Writes sheet inventory with proper orphan deduplication.
 * HOW: Filters orphans to exclude any sheet already in a known category.
 * 
 * WHERE: Called during audit/inventory generation
 * ======================================================================
 */
function writeInventorySheet(ss, inventory) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  
  if (!inventory) {
    Logger.log('[writeInventorySheet] No inventory data provided');
    return;
  }
  
  var sheet = _getSheet(ss, 'Sheet_Inventory');
  if (!sheet) {
    sheet = ss.insertSheet('Sheet_Inventory');
  }
  sheet.clear();
  
  // ═══════════════════════════════════════════════════════════════════════
  // PATCH: Build set of all categorized sheet names for orphan deduplication
  // ═══════════════════════════════════════════════════════════════════════
  var categorizedSheets = {};
  
  var categoryKeys = [
    'config', 'raw', 'clean', 'stats', 'analysis', 'results', 
    'upcoming', 'standings', 'tier1', 'tier2', 'ou', 'betslips',
    'h2h', 'recentHome', 'recentAway', 'proposals', 'logs', 'accuracy'
  ];
  
  for (var ck = 0; ck < categoryKeys.length; ck++) {
    var key = categoryKeys[ck];
    var sheetsInCategory = inventory[key] || inventory[key + 'Sheets'] || [];
    
    if (Array.isArray(sheetsInCategory)) {
      for (var si = 0; si < sheetsInCategory.length; si++) {
        var sheetName = sheetsInCategory[si];
        if (typeof sheetName === 'string') {
          categorizedSheets[sheetName.toLowerCase()] = true;
        } else if (sheetName && sheetName.name) {
          categorizedSheets[sheetName.name.toLowerCase()] = true;
        }
      }
    }
  }
  
  // Also add from nested objects if present
  if (inventory.categories) {
    for (var catKey in inventory.categories) {
      var catSheets = inventory.categories[catKey];
      if (Array.isArray(catSheets)) {
        for (var cs = 0; cs < catSheets.length; cs++) {
          var csName = catSheets[cs];
          if (typeof csName === 'string') {
            categorizedSheets[csName.toLowerCase()] = true;
          } else if (csName && csName.name) {
            categorizedSheets[csName.name.toLowerCase()] = true;
          }
        }
      }
    }
  }
  
  Logger.log('[writeInventorySheet] Categorized sheets count: ' + Object.keys(categorizedSheets).length);
  
  // ═══════════════════════════════════════════════════════════════════════
  // PATCH: Filter orphans to remove any that appear in categories
  // ═══════════════════════════════════════════════════════════════════════
  var rawOrphans = inventory.orphans || inventory.orphanSheets || [];
  var dedupedOrphans = [];
  var removedDuplicates = [];
  
  for (var oi = 0; oi < rawOrphans.length; oi++) {
    var orphan = rawOrphans[oi];
    var orphanName = typeof orphan === 'string' ? orphan : (orphan && orphan.name ? orphan.name : '');
    
    if (!orphanName) continue;
    
    if (categorizedSheets[orphanName.toLowerCase()]) {
      removedDuplicates.push(orphanName);
      Logger.log('[writeInventorySheet] Removed duplicate orphan: ' + orphanName);
    } else {
      dedupedOrphans.push(orphan);
    }
  }
  
  if (removedDuplicates.length > 0) {
    Logger.log('[writeInventorySheet] Removed ' + removedDuplicates.length + ' duplicate orphans');
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // Build output
  // ═══════════════════════════════════════════════════════════════════════
  var output = [];
  
  output.push(['Sheet Inventory - Generated: ' + new Date().toLocaleString()]);
  output.push(['']);
  output.push(['──── SUMMARY ────']);
  output.push(['Total Sheets:', inventory.totalSheets || ss.getSheets().length]);
  output.push(['Categorized:', Object.keys(categorizedSheets).length]);
  output.push(['Orphans:', dedupedOrphans.length]);
  output.push(['Empty:', inventory.emptyCount || 0]);
  output.push(['']);
  
  // Write categories
  output.push(['──── CATEGORIZED SHEETS ────']);
  output.push(['Category', 'Sheet Name', 'Rows', 'Status']);
  
  for (var catKey2 in inventory.categories || {}) {
    var catList = inventory.categories[catKey2];
    if (!Array.isArray(catList)) continue;
    
    for (var cli = 0; cli < catList.length; cli++) {
      var item = catList[cli];
      var itemName = typeof item === 'string' ? item : (item.name || '');
      var itemRows = typeof item === 'object' ? (item.rows || '-') : '-';
      var itemStatus = typeof item === 'object' ? (item.status || 'OK') : 'OK';
      
      output.push([catKey2, itemName, itemRows, itemStatus]);
    }
  }
  
  output.push(['']);
  
  // Write orphans (DEDUPLICATED)
  output.push(['──── ORPHAN SHEETS (Uncategorized) ────']);
  if (dedupedOrphans.length === 0) {
    output.push(['No orphan sheets found']);
  } else {
    output.push(['Sheet Name', 'Rows', 'Notes']);
    for (var doi = 0; doi < dedupedOrphans.length; doi++) {
      var dOrphan = dedupedOrphans[doi];
      var dName = typeof dOrphan === 'string' ? dOrphan : (dOrphan.name || '');
      var dRows = typeof dOrphan === 'object' ? (dOrphan.rows || '-') : '-';
      var dNotes = typeof dOrphan === 'object' ? (dOrphan.notes || '') : '';
      
      output.push([dName, dRows, dNotes]);
    }
  }
  
  // Note about removed duplicates
  if (removedDuplicates.length > 0) {
    output.push(['']);
    output.push(['──── DEDUPLICATION LOG ────']);
    output.push(['Removed ' + removedDuplicates.length + ' sheets that were incorrectly flagged as orphans:']);
    for (var rdi = 0; rdi < Math.min(removedDuplicates.length, 20); rdi++) {
      output.push(['  - ' + removedDuplicates[rdi]]);
    }
    if (removedDuplicates.length > 20) {
      output.push(['  ... and ' + (removedDuplicates.length - 20) + ' more']);
    }
  }
  
  // Pad rows to be rectangular
  var maxCols = 4;
  for (var ri = 0; ri < output.length; ri++) {
    while (output[ri].length < maxCols) {
      output[ri].push('');
    }
  }
  
  // Write to sheet
  sheet.getRange(1, 1, output.length, maxCols).setValues(output);
  
  // Formatting
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  sheet.getRange('A3').setFontWeight('bold');
  sheet.autoResizeColumns(1, maxCols);
  
  // Highlight orphans section
  for (var hi = 0; hi < output.length; hi++) {
    if (output[hi][0] === '=== ORPHAN SHEETS (Uncategorized) ===') {
      sheet.getRange(hi + 1, 1, 1, maxCols).setBackground('#fff3e0').setFontWeight('bold');
      break;
    }
  }
  
  Logger.log('[writeInventorySheet] Inventory written with ' + dedupedOrphans.length + ' orphans');
  
  return {
    totalSheets: inventory.totalSheets || ss.getSheets().length,
    categorized: Object.keys(categorizedSheets).length,
    orphans: dedupedOrphans.length,
    duplicatesRemoved: removedDuplicates.length
  };
}

// ============================================================================
// PHASE 2 PATCH 3 + 3B + 3C: 23-COLUMN BET_SLIPS CONTRACT + CONFIDENCE NORMALIZATION
// ============================================================================

/**
 * BET_SLIPS_CONTRACT - 23-column canonical contract (Phase 2 Patch 3)
 * All bet data must conform to this standardized structure
 */
const BET_SLIPS_CONTRACT = [
  "bet_id", "league", "event_date", "team", "opponent", "side_total",
  "line", "implied_prob", "confidence_pct", "tier_code", "tier_display",
  "ev", "kelly_pct", "status", "result", "payout", "placed_at",
  "settled_at", "config_stamp", "source", "gender", "quarter", "season",
  "created_at"
];

/**
 * normalizeConfidence_ - Full confidence normalization (Phase 2 Patch 3B)
 * Normalizes confidence to Pct/Prob/Tier_Code/Tier_Display format
 * @param {number} confidence - Raw confidence value
 * @returns {Object} Normalized confidence object
 */
function normalizeConfidence_(confidence) {
  // Use ContractEnforcer function for consistency
  if (typeof createCanonicalHeaderMap_ !== 'undefined') {
    return createCanonicalHeaderMap_(BET_SLIPS_CONTRACT, [confidence]);
  }
  
  const pct = Math.max(0, Math.min(1, confidence));
  const prob = pct;
  
  // Determine tier using normalized thresholds
  let tierCode, tierDisplay;
  if (pct >= 0.85) {
    tierCode = "ELITE";
    tierDisplay = "Elite (85%+)";
  } else if (pct >= 0.65) {
    tierCode = "STRONG";
    tierDisplay = "Strong (65-84%)";
  } else if (pct >= 0.55) {
    tierCode = "MEDIUM";
    tierDisplay = "Medium (55-64%)";
  } else if (pct >= 0.45) {
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
 * createBetSlipsHeaderMap_ - Create standardized header map for Bet_Slips
 * @param {Array} actualHeaders - Actual headers from sheet
 * @returns {Object} Header map using ContractEnforcer functions
 */
function createBetSlipsHeaderMap_(actualHeaders) {
  // Use ContractEnforcer function for consistency
  if (typeof createCanonicalHeaderMap_ !== 'undefined') {
    return createCanonicalHeaderMap_(BET_SLIPS_CONTRACT, actualHeaders);
  }
  
  // Fallback implementation
  const map = {};
  const normalizedActual = actualHeaders.map(h => 
    String(h).toLowerCase().replace(/[\s_]/g, "")
  );
  
  BET_SLIPS_CONTRACT.forEach((canonical, idx) => {
    const normalized = canonical.toLowerCase().replace(/[\s_]/g, "");
    const actualIdx = normalizedActual.indexOf(normalized);
    map[canonical] = actualIdx >= 0 ? actualIdx : idx;
  });
  
  return map;
}

/**
 * validateBetSlipsRow_ - Validate row against 23-column contract
 * @param {Object} bet - Bet object
 * @returns {Object} Validation result
 */
function validateBetSlipsRow_(bet) {
  const errors = [];
  const warnings = [];
  
  // Required fields
  const required = ['bet_id', 'league', 'team', 'side_total'];
  required.forEach(field => {
    if (!bet[field] || bet[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  });
  
  // Confidence normalization
  if (bet.confidence_pct !== undefined && bet.confidence_pct !== null) {
    const normalized = normalizeConfidence_(bet.confidence_pct);
    if (!normalized.tier_code) {
      errors.push('Invalid confidence value - cannot determine tier');
    }
  } else {
    warnings.push('Missing confidence_pct - tier cannot be determined');
  }
  
  // EV calculation
  if (bet.implied_prob && bet.confidence_pct && !bet.ev) {
    // Calculate EV using ContractEnforcer function
    if (typeof calculateExpectedValue_ !== 'undefined') {
      bet.ev = calculateExpectedValue_(bet.implied_prob, bet.confidence_pct, bet.line || 0);
    } else {
      // Fallback EV calculation
      const winProb = bet.confidence_pct;
      const loseProb = 1 - winProb;
      const payout = (1 / bet.implied_prob) - 1;
      bet.ev = (winProb * payout) - loseProb;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

/**
 * writeBetSlips_ - Write bets using 23-column contract (Phase 2 Patch 3C)
 * @param {Sheet} sheet - Target sheet
 * @param {Array} bets - Array of bet objects
 * @returns {Object} Write result
 */
function writeBetSlips_(sheet, bets) {
  if (!sheet || !bets) return { success: false, error: 'Invalid parameters' };
  
  // Ensure sheet has correct headers
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, BET_SLIPS_CONTRACT.length).setValues([BET_SLIPS_CONTRACT])
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    sheet.setFrozenRows(1);
  }
  
  // Clear existing data (preserve header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerMap = createBetSlipsHeaderMap_(headers);
  
  const rows = [];
  const validationErrors = [];
  
  bets.forEach((bet, index) => {
    // Validate bet
    const validation = validateBetSlipsRow_(bet);
    if (!validation.valid) {
      validationErrors.push({ index: index, errors: validation.errors });
      return;
    }
    
    // Apply confidence normalization
    if (bet.confidence_pct !== undefined) {
      const normalized = normalizeConfidence_(bet.confidence_pct);
      Object.assign(bet, normalized);
    }
    
    // Map to contract columns
    const row = BET_SLIPS_CONTRACT.map(column => {
      const colIdx = headerMap[column];
      return colIdx >= 0 ? bet[column] || '' : '';
    });
    
    rows.push(row);
  });
  
  // Write data
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  // Log validation issues
  if (validationErrors.length > 0) {
    Logger.log('[writeBetSlips_] Validation errors: ' + JSON.stringify(validationErrors));
  }
  
  return {
    success: true,
    rowsWritten: rows.length,
    validationErrors: validationErrors.length
  };
}

// ============================================================================
// PHASE 2 PATCH 6: 17-COLUMN FORENSIC LOGS CONTRACT
// ============================================================================

/**
 * FORENSIC_LOGS_CONTRACT - 17-column canonical contract (Phase 2 Patch 6)
 * All forensic logs (Tier1_Predictions, Tier2_Log, OU_Log) must conform to this
 */
const FORENSIC_LOGS_CONTRACT = [
  "log_id", "timestamp", "league", "event_id", "team", "opponent",
  "side_total", "line", "prediction", "confidence", "tier", "ev",
  "status", "result", "config_stamp", "source", "notes"
];

/**
 * createForensicLogsHeaderMap_ - Create standardized header map for forensic logs
 * @param {Array} actualHeaders - Actual headers from sheet
 * @returns {Object} Header map using ContractEnforcer functions
 */
function createForensicLogsHeaderMap_(actualHeaders) {
  // Use ContractEnforcer function for consistency
  if (typeof createCanonicalHeaderMap_ !== 'undefined') {
    return createCanonicalHeaderMap_(FORENSIC_LOGS_CONTRACT, actualHeaders);
  }
  
  // Fallback implementation
  const map = {};
  const normalizedActual = actualHeaders.map(h => 
    String(h).toLowerCase().replace(/[\s_]/g, "")
  );
  
  FORENSIC_LOGS_CONTRACT.forEach((canonical, idx) => {
    const normalized = canonical.toLowerCase().replace(/[\s_]/g, "");
    const actualIdx = normalizedActual.indexOf(normalized);
    map[canonical] = actualIdx >= 0 ? actualIdx : idx;
  });
  
  return map;
}

/**
 * validateForensicLogRow_ - Validate row against 17-column contract
 * @param {Object} log - Log object
 * @returns {Object} Validation result
 */
function validateForensicLogRow_(log) {
  const errors = [];
  const warnings = [];
  
  // Required fields
  const required = ['log_id', 'timestamp', 'league', 'team', 'side_total'];
  required.forEach(field => {
    if (!log[field] || log[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  });
  
  // Confidence and tier validation
  if (log.confidence !== undefined && log.confidence !== null) {
    const normalized = normalizeConfidence_(log.confidence);
    if (!normalized.tier_code) {
      errors.push('Invalid confidence value - cannot determine tier');
    } else {
      // Apply normalized tier
      log.tier = normalized.tier_code;
    }
  } else {
    warnings.push('Missing confidence - tier may be inconsistent');
  }
  
  // EV calculation if missing
  if (log.line && log.confidence && !log.ev) {
    // Calculate implied probability from line (simplified)
    const impliedProb = log.line > 0 ? 1 / (log.line + 1) : Math.abs(log.line) / (Math.abs(log.line) + 1);
    
    // Calculate EV using ContractEnforcer function
    if (typeof calculateExpectedValue_ !== 'undefined') {
      log.ev = calculateExpectedValue_(impliedProb, log.confidence, log.line);
    } else {
      // Fallback EV calculation
      const winProb = log.confidence;
      const loseProb = 1 - winProb;
      const payout = Math.abs(log.line);
      log.ev = (winProb * payout) - loseProb;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

/**
 * writeForensicLogs_ - Write logs using 17-column contract (Phase 2 Patch 6)
 * @param {Sheet} sheet - Target sheet (Tier1_Predictions, Tier2_Log, OU_Log)
 * @param {Array} logs - Array of log objects
 * @returns {Object} Write result
 */
function writeForensicLogs_(sheet, logs) {
  if (!sheet || !logs) return { success: false, error: 'Invalid parameters' };
  
  // Ensure sheet has correct headers
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, FORENSIC_LOGS_CONTRACT.length).setValues([FORENSIC_LOGS_CONTRACT])
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    sheet.setFrozenRows(1);
  }
  
  // Clear existing data (preserve header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headerMap = createForensicLogsHeaderMap_(headers);
  
  const rows = [];
  const validationErrors = [];
  
  logs.forEach((log, index) => {
    // Validate log
    const validation = validateForensicLogRow_(log);
    if (!validation.valid) {
      validationErrors.push({ index: index, errors: validation.errors });
      return;
    }
    
    // Apply confidence normalization
    if (log.confidence !== undefined) {
      const normalized = normalizeConfidence_(log.confidence);
      Object.assign(log, normalized);
    }
    
    // Map to contract columns
    const row = FORENSIC_LOGS_CONTRACT.map(column => {
      const colIdx = headerMap[column];
      return colIdx >= 0 ? log[column] || '' : '';
    });
    
    rows.push(row);
  });
  
  // Write data
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  // Log validation issues
  if (validationErrors.length > 0) {
    Logger.log('[writeForensicLogs_] Validation errors: ' + JSON.stringify(validationErrors));
  }
  
  return {
    success: true,
    rowsWritten: rows.length,
    validationErrors: validationErrors.length
  };
}

/**
 * alignForensicLogsToContract_ - Align existing forensic logs to 17-column contract
 * @param {Spreadsheet} ss - Spreadsheet object
 * @returns {Object} Alignment result
 */
function alignForensicLogsToContract_(ss) {
  const forensicSheets = ['Tier1_Predictions', 'Tier2_Log', 'OU_Log'];
  const results = {};
  
  forensicSheets.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      results[sheetName] = { success: false, error: 'Sheet not found' };
      return;
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      results[sheetName] = { success: false, error: 'No data to align' };
      return;
    }
    
    const headers = data[0];
    const logs = [];
    
    // Convert existing data to log objects
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const log = {};
      
      // Map existing columns to contract
      headers.forEach((header, idx) => {
        const normalizedHeader = String(header).toLowerCase().replace(/[\s_]/g, "");
        
        // Try to match to contract columns
        FORENSIC_LOGS_CONTRACT.forEach(contractCol => {
          const normalizedContract = contractCol.toLowerCase().replace(/[\s_]/g, "");
          if (normalizedHeader === normalizedContract) {
            log[contractCol] = row[idx];
          }
        });
      });
      
      // Add missing required fields with defaults
      if (!log.log_id) log.log_id = 'LOG_' + Utilities.getUuid();
      if (!log.timestamp) log.timestamp = new Date().toISOString();
      if (!log.source) log.source = sheetName;
      if (!log.notes) log.notes = 'Aligned from existing data';
      
      logs.push(log);
    }
    
    // Write aligned data
    const writeResult = writeForensicLogs_(sheet, logs);
    results[sheetName] = writeResult;
  });
  
  return results;
}
