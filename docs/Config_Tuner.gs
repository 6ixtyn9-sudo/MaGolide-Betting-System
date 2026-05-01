/**
 * ============================================================
 * MODULE 10: CONFIG TUNER (Ma Golide v7.0)
 * ============================================================
 * 
 * PURPOSE:
 *  Automates the calibration of Tier thresholds based on
 *  real-world performance data from the Accuracy Report.
 * 
 * FEATURES:
 *  1. Reliability Analysis: Compares stated confidence to actual win rate.
 *  2. Brier Score Calculation: Measures predictive accuracy.
 *  3. Directional Bias: Identifies OVER vs UNDER systematic errors.
 *  4. Tier Tuning: Suggests adjustments to minConf, minEV, minEdge.
 *  5. League Segmentation: Per-league confidence discount suggestions.
 * 
 * USAGE:
 *  Run runConfigTuning() from the menu. Suggestions are written to
 *  the 'Config_Tuner_Suggestions' sheet for human review.
 * ============================================================
 */

var TUNER_CONFIG = {
  TARGET_ELITE_ACC: 0.70,
  TARGET_STRONG_ACC: 0.62,
  TARGET_MEDIUM_ACC: 0.55,
  MIN_SAMPLES_FOR_LEAGUE_TUNING: 20,
  BRIER_THRESHOLD_BAD: 0.22, // Anything > 0.25 is worse than a coin flip
  CONF_BUCKETS: [45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]
};

/**
 * Main entry point for the Tuner
 */
function runConfigTuning() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('🚀 Starting Config Tuner Analysis...');
  
  try {
    // 1. Load data
    var performance = _loadPerformanceData(ss);
    if (!performance || performance.length === 0) {
      Logger.log('❌ No performance data found. Run Accuracy Report first.');
      if (typeof _safeAlert_ === 'function') _safeAlert_('Tuner', 'No performance data found. Please run the Accuracy Report first.');
      return;
    }

    // 2. Run analyses
    var calibration = _analyzeCalibration(performance);
    var bias = _analyzeDirectionalBias(performance);
    var leagueAnalysis = _analyzeLeaguePerformance(performance);
    
    // 3. Generate suggestions
    var suggestions = _generateTuningSuggestions(calibration, bias, leagueAnalysis);
    
    // 4. Write to sheet
    _writeSuggestionsToSheet(ss, suggestions, calibration, bias, leagueAnalysis);
    
    Logger.log('✅ Config Tuning Complete. Check "Config_Tuner_Suggestions" sheet.');
    if (typeof _safeToast_ === 'function') _safeToast_(ss, 'Tuning complete! Suggestions written.', 'Tuner');
    
  } catch (e) {
    Logger.log('❌ Tuner Error: ' + e.message + '\n' + e.stack);
    if (typeof _safeAlert_ === 'function') _safeAlert_('Tuner Error', e.message);
  }
}

/**
 * Loads graded picks from the unified accuracy report or raw Bet_Slips
 * Returns array of { type, market, league, conf, ev, edge, dir, outcome }
 */
function _loadPerformanceData(ss) {
  var sheet = ss.getSheetByName('Bet_Slips');
  if (!sheet) return [];
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  var h = _buildHeaderMap(data[0]);
  var results = [];
  
  // Need to cross-reference with ResultsClean for outcomes if not present in Bet_Slips
  // But usually our hardened Accuracy Report logic puts it there or we use the Report sheet.
  // For simplicity and accuracy, we'll try to find graded data.
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var market = String(row[h['Market']] || '');
    if (!market || market.indexOf('SNIPER_OU') === -1) continue;
    
    // We need an outcome. If the row doesn't have one, we might need to skip or grade it here.
    // In our hardened pipeline, the Accuracy Report Detail sheet is better.
    // Let's check for 'Accuracy_Report_Detail' or similar.
  }
  
  // FALLBACK: Use Accuracy_Report_Detail if it exists (it's the source of truth for grading)
  var detailSheet = ss.getSheetByName('Accuracy_Report_Detail') || ss.getSheetByName('Assayer_Detail');
  if (detailSheet) {
    var detailData = detailSheet.getDataRange().getValues();
    var dh = _buildHeaderMap(detailData[0]);
    
    for (var j = 1; j < detailData.length; j++) {
      var dRow = detailData[j];
      var outcome = String(dRow[dh['Outcome']] || '').toUpperCase();
      if (outcome === 'PENDING' || outcome === '') continue;
      
      results.push({
        market: String(dRow[dh['Market']] || dRow[dh['Type']] || 'SNIPER_OU'),
        league: String(dRow[dh['League']] || ''),
        conf: parseFloat(dRow[dh['Confidence']] || dRow[dh['Confidence_Pct']] || 0),
        ev: parseFloat(dRow[dh['EV']] || 0),
        edge: parseFloat(dRow[dh['Edge']] || 0),
        dir: String(dRow[dh['Direction']] || dRow[dh['Selection_Side']] || '').toUpperCase(),
        outcome: outcome,
        win: (outcome === 'WIN'),
        push: (outcome === 'PUSH')
      });
    }
  }
  
  return results;
}

/**
 * Calculates reliability: actual win rate vs predicted confidence
 */
function _analyzeCalibration(data) {
  var buckets = TUNER_CONFIG.CONF_BUCKETS;
  var calib = {};
  
  buckets.forEach(function(b) {
    calib[b] = { count: 0, wins: 0, pushes: 0, brierSum: 0 };
  });
  
  data.forEach(function(d) {
    var conf = d.conf;
    // Find closest bucket
    var bucket = buckets.reduce(function(prev, curr) {
      return (Math.abs(curr - conf) < Math.abs(prev - conf) ? curr : prev);
    });
    
    var c = calib[bucket];
    c.count++;
    if (d.win) c.wins++;
    if (d.push) c.pushes++;
    
    // Brier score: (p - y)^2
    var p = conf / 100;
    var y = d.win ? 1 : (d.push ? 0.5 : 0);
    c.brierSum += Math.pow(p - y, 2);
  });
  
  // Finalize
  var overallBrier = 0;
  var totalCount = 0;
  
  buckets.forEach(function(b) {
    var c = calib[b];
    if (c.count > 0) {
      c.winRate = c.wins / (c.count - c.pushes);
      c.brier = c.brierSum / c.count;
      overallBrier += c.brierSum;
      totalCount += c.count;
    }
  });
  
  return {
    buckets: calib,
    overallBrier: totalCount > 0 ? (overallBrier / totalCount) : null,
    totalCount: totalCount
  };
}

/**
 * Analyzes OVER vs UNDER bias
 */
function _analyzeDirectionalBias(data) {
  var bias = {
    OVER: { count: 0, wins: 0, pushes: 0 },
    UNDER: { count: 0, wins: 0, pushes: 0 }
  };
  
  data.forEach(function(d) {
    var dir = d.dir;
    if (bias[dir]) {
      bias[dir].count++;
      if (d.win) bias[dir].wins++;
      if (d.push) bias[dir].pushes++;
    }
  });
  
  Object.keys(bias).forEach(function(k) {
    var b = bias[k];
    b.winRate = b.count > b.pushes ? (b.wins / (b.count - b.pushes)) : 0;
  });
  
  return bias;
}

/**
 * Analyzes per-league performance
 */
function _analyzeLeaguePerformance(data) {
  var leagues = {};
  
  data.forEach(function(d) {
    if (!d.league) return;
    if (!leagues[d.league]) {
      leagues[d.league] = { count: 0, wins: 0, pushes: 0, brierSum: 0 };
    }
    var l = leagues[d.league];
    l.count++;
    if (d.win) l.wins++;
    if (d.push) l.pushes++;
    
    var p = d.conf / 100;
    var y = d.win ? 1 : (d.push ? 0.5 : 0);
    l.brierSum += Math.pow(p - y, 2);
  });
  
  Object.keys(leagues).forEach(function(k) {
    var l = leagues[k];
    l.winRate = l.count > l.pushes ? (l.wins / (l.count - l.pushes)) : 0;
    l.brier = l.brierSum / l.count;
  });
  
  return leagues;
}

/**
 * Generates actionable suggestions
 */
function _generateTuningSuggestions(calib, bias, leagues) {
  var suggestions = [];
  
  // 1. Confidence Calibration
  var brier = calib.overallBrier;
  if (brier > TUNER_CONFIG.BRIER_THRESHOLD_BAD) {
    suggestions.push({
      area: 'Global Confidence',
      severity: 'HIGH',
      issue: 'Brier Score (' + brier.toFixed(3) + ') is high, indicating poor calibration.',
      suggestion: 'Increase "ou_confidence_scale" to 40+ to shrink probabilities further.'
    });
  }
  
  // 2. Directional Bias
  var overRate = bias.OVER.winRate;
  var underRate = bias.UNDER.winRate;
  if (Math.abs(overRate - underRate) > 0.10 && (bias.OVER.count + bias.UNDER.count) > 50) {
    var betterDir = overRate > underRate ? 'OVER' : 'UNDER';
    suggestions.push({
      area: 'Directional Bias',
      severity: 'MEDIUM',
      issue: betterDir + ' hits significantly better (' + (Math.max(overRate, underRate)*100).toFixed(1) + '% vs ' + (Math.min(overRate, underRate)*100).toFixed(1) + '%).',
      suggestion: 'The model has a systematic ' + (betterDir === 'OVER' ? 'UNDER' : 'OVER') + ' bias. Check league lines.'
    });
  }
  
  // 3. League Discounts
  Object.keys(leagues).forEach(function(lName) {
    var l = leagues[lName];
    if (l.count >= TUNER_CONFIG.MIN_SAMPLES_FOR_LEAGUE_TUNING && l.winRate < 0.50) {
      suggestions.push({
        area: 'League Weight',
        severity: 'MEDIUM',
        issue: 'League ' + lName + ' has poor win rate (' + (l.winRate*100).toFixed(1) + '%) over ' + l.count + ' samples.',
        suggestion: 'Add config "league_weight_' + lName.replace(/[^A-Z0-9]/g, '') + '" = 0.7 to discount confidence.'
      });
    }
  });
  
  return suggestions;
}

/**
 * Writes the results to the suggestions sheet
 */
function _writeSuggestionsToSheet(ss, suggestions, calib, bias, leagues) {
  var sheetName = 'Config_Tuner_Suggestions';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clear();
  
  var rows = [];
  
  // Header
  rows.push(['CONFIG TUNER REPORT', 'Generated: ' + new Date().toLocaleString()]);
  rows.push(['']);
  
  // 1. ACTIONABLE SUGGESTIONS
  rows.push(['--- ACTIONABLE SUGGESTIONS ---']);
  rows.push(['Area', 'Severity', 'Issue', 'Suggestion']);
  suggestions.forEach(function(s) {
    rows.push([s.area, s.severity, s.issue, s.suggestion]);
  });
  rows.push(['']);
  
  // 2. CALIBRATION CURVE
  rows.push(['--- CALIBRATION CURVE ---']);
  rows.push(['Conf Bucket', 'Count', 'Actual Win Rate', 'Brier Score', 'Reliability Gap']);
  TUNER_CONFIG.CONF_BUCKETS.forEach(function(b) {
    var c = calib.buckets[b];
    if (c.count > 0) {
      var gap = c.winRate - (b/100);
      rows.push([b + '%', c.count, (c.winRate*100).toFixed(1) + '%', c.brier.toFixed(3), (gap*100).toFixed(1) + '%']);
    }
  });
  rows.push(['OVERALL BRIER', '', '', calib.overallBrier ? calib.overallBrier.toFixed(4) : 'N/A']);
  rows.push(['']);
  
  // 3. DIRECTIONAL BIAS
  rows.push(['--- DIRECTIONAL BIAS ---']);
  rows.push(['Direction', 'Picks', 'Wins', 'Pushes', 'Win Rate']);
  rows.push(['OVER', bias.OVER.count, bias.OVER.wins, bias.OVER.pushes, (bias.OVER.winRate*100).toFixed(1) + '%']);
  rows.push(['UNDER', bias.UNDER.count, bias.UNDER.wins, bias.UNDER.pushes, (bias.UNDER.winRate*100).toFixed(1) + '%']);
  rows.push(['']);
  
  // 4. LEAGUE BREAKDOWN
  rows.push(['--- LEAGUE PERFORMANCE ---']);
  rows.push(['League', 'Samples', 'Win Rate', 'Brier Score']);
  Object.keys(leagues).sort().forEach(function(k) {
    var l = leagues[k];
    rows.push([k, l.count, (l.winRate*100).toFixed(1) + '%', l.brier.toFixed(3)]);
  });
  
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  
  // Formatting
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(14);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 400);
}
