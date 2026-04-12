/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *                      ███╗   ███╗ █████╗      ██████╗  ██████╗ ██╗     ██╗██████╗ ███████╗    
 *                      ████╗ ████║██╔══██╗    ██╔════╝ ██╔═══██╗██║     ██║██╔══██╗██╔════╝  
 *                      ██╔████╔██║███████║    ██║  ███╗██║   ██║██║     ██║██║  ██║█████╗    
 *                      ██║╚██╔╝██║██╔══██║    ██║   ██║██║   ██║██║     ██║██║  ██║██╔══╝     
 *                      ██║ ╚═╝ ██║██║  ██║    ╚██████╔╝╚██████╔╝███████╗██║██████╔╝███████╗    
 *                      ╚═╝     ╚═╝╚═╝  ╚═╝     ╚═════╝  ╚═════╝ ╚══════╝╚═╝╚═════╝ ╚══════╝    
 *                                                                                                              
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * /**
 * MODULE 1
 * AUTHORITY: The President / The Architect
 * PURPOSE: One-click creation of the full Ma Golide sheet infrastructure.
 *
 * This module is the SINGLE SOURCE OF TRUTH for:
 * - Which sheets must exist in every Ma Golide league spreadsheet.
 * - The official sheet names used by all other modules (1–6 and 7).
 *
 * CRITICAL RULES IT RESPECTS:
 * - No global variables (all constants live inside functions).
 * - Idempotent: Safe to run multiple times (never duplicates sheets).
 * - No renames/deletes: It ONLY creates missing sheets.
 * - NEVER overwrites existing data in any sheet.
 *
 * ENTRYPOINT:
 *   - setupAllSheets()
 *     Call this once per file to build the Ma Golide "stadium".
 */
/**

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MA GOLIDE BET GRADING AUDIT SYSTEM v2.0
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * COMPREHENSIVE DIAGNOSTIC that traces the FULL data flow:
 *   Predictions → Bet_Slips → Results → Accuracy Reports
 * 
 * For EACH bet type, audits:
 *   1. Source function that generates the prediction
 *   2. Where it writes to (columns, formats)
 *   3. How Bet_Slips captures it
 *   4. How ResultsClean stores the actual outcome
 *   5. How the accuracy report tries to match them
 *   6. WHY grading fails (specific cell-level mismatches)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMPLETE ACCURACY FUNCTIONS PACKAGE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Includes:
 *   - loadHistoricalGames (enhanced to parse combined format)
 *   - buildMLAccuracyReport
 *   - buildFirstHalfAccuracyReport
 *   - buildFTOUAccuracyReport
 *   - buildHighQtrAccuracyReport
 *   - All helpers needed
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CORE HELPER: Parse Score from Various Formats
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MA GOLIDE UNIFIED ACCURACY REPORT SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Generates detailed accuracy reports matching the specified format:
 *   - Header with title and timestamp
 *   - Summary with source, totals, hits, misses, hit rate
 *   - Detailed table with ALL Bet_Slips columns + grading outcome
 * 
 * Bet Types Supported:
 *   - SNIPER MARGIN (Quarter Spreads)
 *   - SNIPER O/U (Quarter Totals)
 *   - BANKER (Moneyline)
 *   - ROBBER (Underdog ML)
 *   - FIRST HALF 1X2
 *   - FT O/U
 *   - HIGH QUARTER
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: Generate Complete Accuracy Report
// ═══════════════════════════════════════════════════════════════════════════════

function generateCompleteAccuracyReport(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('    MA GOLIDE COMPLETE ACCURACY REPORT');
  Logger.log('═══════════════════════════════════════════════════════════════');
  
  try {
    ss.toast('Generating Complete Accuracy Report...', 'Ma Golide', 30);
    
    // Load all data
    var games = loadHistoricalGamesEnhanced_(ss);
    var betSlipsData = loadBetSlipsComplete_(ss);
    
    Logger.log('[Report] Games loaded: ' + games.length);
    Logger.log('[Report] Bet_Slips rows: ' + betSlipsData.rows.length);
    
    // Grade each bet type
    var reports = {};
    
    reports.SNIPER_MARGIN = gradeSniperMargin_(betSlipsData, games);
    reports.SNIPER_OU = gradeSniperOU_(betSlipsData, games);
    reports.BANKER = gradeBankers_(betSlipsData, games);
    reports.ROBBER = gradeRobbers_(betSlipsData, games);
    reports.FIRST_HALF = gradeFirstHalf_(betSlipsData, games);
    reports.FT_OU = gradeFTOU_(betSlipsData, games);
    reports.HIGH_QUARTER = gradeHighQuarter_(betSlipsData, games);
    
    // Write unified report
    writeUnifiedAccuracyReport_(ss, reports);
    
    // Summary
    var totalBets = 0, totalHits = 0;
    Object.keys(reports).forEach(function(key) {
      totalBets += reports[key].matched;
      totalHits += reports[key].hits;
    });
    
    var overallRate = totalBets > 0 ? (totalHits / totalBets * 100).toFixed(1) : '0.0';
    
    ss.toast('Report complete: ' + totalHits + '/' + totalBets + ' (' + overallRate + '%)', 'Ma Golide', 5);
    
    ui.alert('Accuracy Report Complete',
      'Total Bets Graded: ' + totalBets + '\n' +
      'Total Hits: ' + totalHits + '\n' +
      'Overall Hit Rate: ' + overallRate + '%\n\n' +
      '(See Ma_Golide_Report sheet for details)',
      ui.ButtonSet.OK);
    
    return reports;
    
  } catch (e) {
    Logger.log('[Report] ERROR: ' + e.message + '\n' + e.stack);
    ui.alert('Error', e.message, ui.ButtonSet.OK);
    return null;
  }
}

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
    
    // Detect column header rows
    var hasHeaderWords = row.some(function(c) {
      var s = String(c || '').toLowerCase();
      return s === 'match' || s === 'fixture' || s === 'game' || 
             s === 'league' || s === 'date' || s === 'pick';
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
    
    // Get match column
    var matchCol = currentHMap.match || currentHMap.fixture || currentHMap.game;
    if (matchCol === undefined) continue;
    
    var matchVal = String(row[matchCol] || '').trim();
    if (!matchVal) continue;
    
    // Skip if looks like a header or separator
    if (matchVal.toLowerCase() === 'match' || matchVal.indexOf('────') !== -1) continue;
    
    // Parse teams
    var teams = parseMatchTeams_(matchVal);
    if (!teams) continue;
    
    // Build row data
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
      
      // Extract common columns
      league: getColValue_(row, currentHMap, ['league', 'comp']),
      date: getColValue_(row, currentHMap, ['date', 'gamedate']),
      time: getColValue_(row, currentHMap, ['time']),
      type: getColValue_(row, currentHMap, ['type', 'signal', 'signaltype']),
      pick: getColValue_(row, currentHMap, ['pick', 'selection', 'bet']),
      odds: getColValue_(row, currentHMap, ['odds', 'price']),
      confidence: getColValue_(row, currentHMap, ['confidence', 'conf']),
      ev: getColValue_(row, currentHMap, ['ev', 'expectedvalue']),
      tier: getColValue_(row, currentHMap, ['tier'])
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
  
  // Filter for margin bets
  var marginBets = betSlipsData.rows.filter(function(row) {
    var typeUpper = (row.type + ' ' + row.section).toUpperCase();
    return typeUpper.indexOf('SNIPER') !== -1 && 
           (typeUpper.indexOf('MARGIN') !== -1 || typeUpper.indexOf('SIDE') !== -1) &&
           typeUpper.indexOf('O/U') === -1;
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

function gradeSniperOU_(betSlipsData, games) {
  var result = {
    name: 'SNIPER O/U',
    description: 'Quarter Over/Under Totals',
    found: 0,
    matched: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    hitRate: 0,
    details: []
  };
  
  // Filter for O/U bets
  var ouBets = betSlipsData.rows.filter(function(row) {
    var typeUpper = (row.type + ' ' + row.section + ' ' + row.pick).toUpperCase();
    return (typeUpper.indexOf('O/U') !== -1 || typeUpper.indexOf('OU') !== -1 ||
            typeUpper.indexOf('OVER') !== -1 || typeUpper.indexOf('UNDER') !== -1) &&
           /Q[1-4]/i.test(typeUpper + ' ' + row.pick);
  });
  
  result.found = ouBets.length;
  
  ouBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    // Parse pick: "Q1 UNDER 55.5" or "Q2: O 48.5"
    var pickUpper = bet.pick.toUpperCase();
    var qMatch = pickUpper.match(/Q([1-4])/);
    var dirMatch = pickUpper.match(/(OVER|UNDER|O|U)\s*(\d+\.?\d*)/);
    
    if (!qMatch || !dirMatch) return;
    
    var quarter = 'Q' + qMatch[1];
    var direction = dirMatch[1] === 'O' ? 'OVER' : dirMatch[1] === 'U' ? 'UNDER' : dirMatch[1];
    var line = parseFloat(dirMatch[2]);
    
    var qScore = game.qScores[quarter];
    if (!qScore) return;
    
    var actualTotal = qScore.home + qScore.away;
    var actualResult = actualTotal > line ? 'OVER' : (actualTotal < line ? 'UNDER' : 'PUSH');
    
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
      type: bet.type || 'SNIPER O/U',
      odds: bet.odds || '-',
      confidence: bet.confidence,
      ev: bet.ev || '-',
      tier: bet.tier,
      quarter: quarter,
      line: line,
      actualTotal: actualTotal,
      actualResult: actualResult,
      outcome: outcome === 'HIT' ? '✅ HIT' : (outcome === 'PUSH' ? '🟡 PUSH' : '❌ MISS')
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
    var typeUpper = (row.type + ' ' + row.section).toUpperCase();
    return typeUpper.indexOf('BANKER') !== -1 || 
           (typeUpper.indexOf('ML') !== -1 && typeUpper.indexOf('ROBBER') === -1);
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
    var typeUpper = (row.type + ' ' + row.section).toUpperCase();
    return typeUpper.indexOf('ROBBER') !== -1 || typeUpper.indexOf('UNDERDOG') !== -1;
  });
  
  result.found = robberBets.length;
  
  robberBets.forEach(function(bet) {
    var game = findMatchingGame_(games, bet.homeNorm, bet.awayNorm);
    if (!game) return;
    
    result.matched++;
    
    var pickText = bet.pick + ' ' + findWinnerInRow_(bet.rawRow, bet.headerMap, game);
    var predicted = 'AWAY'; // Robbers typically pick underdogs
    
    if (pickText.toLowerCase().indexOf(game.home.toLowerCase()) !== -1 ||
        pickText.indexOf('Home') !== -1) {
      predicted = 'HOME';
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
    var typeUpper = (row.type + ' ' + row.section).toUpperCase();
    return typeUpper.indexOf('1H') !== -1 || typeUpper.indexOf('FIRST HALF') !== -1 ||
           typeUpper.indexOf('FH') !== -1 || typeUpper.indexOf('HALF TIME') !== -1;
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
    var typeUpper = (row.type + ' ' + row.section + ' ' + row.pick).toUpperCase();
    return (typeUpper.indexOf('FT O/U') !== -1 || typeUpper.indexOf('FT OU') !== -1 ||
            typeUpper.indexOf('FULL TIME') !== -1 || typeUpper.indexOf('TOTAL') !== -1) &&
           !/Q[1-4]/i.test(row.pick);
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
    var typeUpper = (row.type + ' ' + row.section).toUpperCase();
    return typeUpper.indexOf('HIGH') !== -1 && 
           (typeUpper.indexOf('QTR') !== -1 || typeUpper.indexOf('QUARTER') !== -1);
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
// WRITE UNIFIED ACCURACY REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function writeUnifiedAccuracyReport_(ss, reports) {
  var sheetName = 'Ma_Golide_Report';
  var sh = findSheet_(ss, sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  }
  sh.clear();
  
  var output = [];
  var rowIndex = 0;
  
  // HEADER
  output.push(['MA GOLIDE ACCURACY REPORT', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['Generated:', new Date().toLocaleString(), '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  
  // Process each report type
  Object.keys(reports).forEach(function(key) {
    var report = reports[key];
    
    if (report.found === 0) return; // Skip empty sections
    
    // Section header
    output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['═══ ' + report.name + ' — ' + report.description + ' ═══', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['Source sheet:', 'Bet_Slips', '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['Total bets found:', report.found, '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['Matched to ResultsClean:', report.matched, '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['Hits:', report.hits, '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['Misses:', report.misses, '', '', '', '', '', '', '', '', '', '', '', '']);
    
    if (report.pushes !== undefined) {
      output.push(['Pushes/Ties:', report.pushes || report.ties || 0, '', '', '', '', '', '', '', '', '', '', '', '']);
    }
    
    output.push(['Hit Rate (excl pushes/ties):', report.hitRate.toFixed(2) + '%', '', '', '', '', '', '', '', '', '', '', '', '']);
    output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    
    // Detail header
    if (report.details.length > 0) {
      output.push(['--- BET DETAILS ---', '', '', '', '', '', '', '', '', '', '', '', '', '']);
      
      // Build header based on bet type
      var detailHeader = buildDetailHeader_(key);
      output.push(detailHeader);
      
      // Add each detail row
      report.details.forEach(function(d) {
        var detailRow = buildDetailRow_(key, d);
        output.push(detailRow);
      });
    }
    
    output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  });
  
  // Write to sheet
  var maxCols = 14;
  var paddedOutput = output.map(function(row) {
    while (row.length < maxCols) row.push('');
    return row.slice(0, maxCols);
  });
  
  sh.getRange(1, 1, paddedOutput.length, maxCols).setValues(paddedOutput);
  
  // Formatting
  sh.getRange(1, 1, 1, maxCols).setFontWeight('bold').setFontSize(14).setBackground('#4a86e8').setFontColor('white');
  
  // Format section headers
  for (var i = 0; i < paddedOutput.length; i++) {
    var cell = String(paddedOutput[i][0]);
    
    if (cell.startsWith('═══')) {
      sh.getRange(i + 1, 1, 1, maxCols).setFontWeight('bold').setBackground('#d9ead3');
    }
    if (cell === '--- BET DETAILS ---') {
      sh.getRange(i + 1, 1, 1, maxCols).setFontWeight('bold').setBackground('#e8e8e8');
    }
    if (cell === 'League') {
      sh.getRange(i + 1, 1, 1, maxCols).setFontWeight('bold').setBackground('#f3f3f3');
    }
  }
  
  sh.autoResizeColumns(1, maxCols);
  
  Logger.log('[writeUnifiedAccuracyReport_] Report written to ' + sheetName);
}

function buildDetailHeader_(betType) {
  switch (betType) {
    case 'SNIPER_MARGIN':
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Quarter', 'Actual Q Score', 'Actual Side', 'Outcome'];
    case 'SNIPER_OU':
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Quarter', 'Line', 'Actual Total', 'Outcome'];
    case 'BANKER':
    case 'ROBBER':
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Predicted', 'Actual Score', 'Actual Winner', 'Outcome'];
    case 'FIRST_HALF':
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Predicted', 'Actual 1H Score', 'Actual Result', 'Outcome'];
    case 'FT_OU':
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Line', 'Actual Total', 'Result', 'Outcome'];
    case 'HIGH_QUARTER':
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Predicted', 'Q Totals', 'Actual Highest', 'Outcome'];
    default:
      return ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'Tier', 'Detail1', 'Detail2', 'Detail3', 'Outcome'];
  }
}

function buildDetailRow_(betType, d) {
  switch (betType) {
    case 'SNIPER_MARGIN':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.quarter, d.actualQScore, d.actualSide, d.outcome];
    case 'SNIPER_OU':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.quarter, d.line, d.actualTotal, d.outcome];
    case 'BANKER':
    case 'ROBBER':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.predictedWinner, d.actualScore, d.actualWinner, d.outcome];
    case 'FIRST_HALF':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.predicted, d.actualHalfScore, d.actual, d.outcome];
    case 'FT_OU':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.line, d.actualTotal, d.actualResult, d.outcome];
    case 'HIGH_QUARTER':
      return [d.league, d.date, d.time, d.match, d.pick, d.type, d.odds, d.confidence, d.ev, d.tier, d.predicted, 
              'Q1:' + d.q1Total + ' Q2:' + d.q2Total + ' Q3:' + d.q3Total + ' Q4:' + d.q4Total, d.actualHighest, d.outcome];
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
// MENU WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

function runCompleteAccuracyReport() {
  generateCompleteAccuracyReport(SpreadsheetApp.getActiveSpreadsheet());
}




/**
 * WHY: Main entry point that builds the entire Ma Golide infrastructure.
 * WHAT: Creates all core sheets, loop sheets, and output sheets required
 *       by the Project Charter and Presidential Genesis Mandate.
 * HOW:
 *   1. Get the active spreadsheet.
 *   2. Create core sheets (Raw, Clean, Standings, Upcoming..., Results..., Stats...).
 *   3. Create loop sheets (RawH2H_1..12, CleanH2H_1..12, RawRecentHome_1..12, etc.).
 *   4. Create output sheets (Bet_Slips, Acca_Central).
 *   5. Show a toast confirming completion.
 * WHERE:
 *   - This function operates on the ACTIVE spreadsheet (SpreadsheetApp.getActiveSpreadsheet()).
 */
function setupAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  Logger.log('========================================');
  Logger.log('MODULE 0: GENESIS - Starting');
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Timestamp: ' + new Date().toISOString());
  Logger.log('========================================');

  createCoreSheets_(ss);
  createLoopSheets_(ss);
  createOutputSheets_(ss);

  Logger.log('========================================');
  Logger.log('MODULE 0: GENESIS - Complete');
  Logger.log('========================================');
  
  ss.toast('Ma Golide infrastructure built successfully – Genesis complete.', 'Ma Golide – Genesis');
}

/**
 * WHY: Convenience alias – some users might prefer a more "ceremonial" name.
 * WHAT: Simple wrapper that calls setupAllSheets(), no additional logic.
 * HOW: One-line function delegating to the main entrypoint.
 * WHERE:
 *   - Same active spreadsheet as setupAllSheets().
 */
function runGenesis() {
  setupAllSheets();
}

/**
 * WHY: Find a sheet by name using case-insensitive matching for resilience.
 * WHAT: Returns the sheet object if found (regardless of case), or null if not.
 * HOW: Loops through all sheets, comparing lowercase names.
 * WHERE: Used anywhere we need flexible sheet lookup.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss - The spreadsheet to search.
 * @param {string} name - The sheet name to find (case-insensitive).
 * @returns {SpreadsheetApp.Sheet|null} The sheet if found, null otherwise.
 */
function getSheetInsensitive_(ss, name) {
  const lowerName = name.toLowerCase();
  const sheets = ss.getSheets();
  
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === lowerName) {
      return sheets[i];
    }
  }
  
  return null;
}

/**
 * WHY: Core factory – ensure every league file has the full sheet skeleton
 *      for Tier 1 + Tier 2, including config + proposal sheets.
 * WHAT: Creates all base sheets if missing, then seeds ONLY Config sheets
 *       with sensible defaults (if empty). Never touches Raw sheets.
 * HOW: 
 *   1) Loops through a list of required sheet names and calls
 *      createSheetIfMissing_(ss, name).
 *   2) Calls _initialiseTierConfigs_(ss) to populate Config_Tier1 / 2
 *      only if they are currently empty.
 * WHERE: Applies to the *league spreadsheet* (satellite), not Mothership.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss - Active spreadsheet instance.
 */
function createCoreSheets_(ss) {
  Logger.log('--- Creating Core Sheets ---');
  
  const coreSheets = [
    // Core reference & IO
    'SportConfig',
    'Raw',
    'Clean',
    'ResultsRaw',
    'ResultsClean',
    'Standings',
    'UpcomingRaw',
    'UpcomingClean',

    // Historical stats
    'Stats',
    'LeagueQuarterStats',
    'LeagueQuarterO_U_Stats',

    // Tier 1 ecosystem
    'Analysis_Tier1',
    'Config_Tier1',
    'Config_Tier1_Proposals',

    // Tier 2 ecosystem
    'TeamQuarterStats_Tier2',
    'Stats_Tier2_Accuracy',
    'Stats_Tier2_Simulation',
    'Stats_Tier2_Optimization',
    'Config_Tier2',
    'Config_Tier2_Proposals',

    // Phase 4 — identity ledger (Assayer / Mothership joins)
    'Satellite_Identity'
  ];

  let createdCount = 0;
  let skippedCount = 0;
  
  for (let i = 0; i < coreSheets.length; i++) {
    const result = createSheetIfMissing_(ss, coreSheets[i]);
    if (result) {
      createdCount++;
    } else {
      skippedCount++;
    }
  }
  
  Logger.log('Core Sheets Summary: Created=' + createdCount + ', Already Existed=' + skippedCount);

  _initialiseTierConfigs_(ss);

  var sid = ss.getSheetByName('Satellite_Identity');
  if (sid && sid.getLastRow() === 0) {
    sid.getRange(1, 1, 1, 5).setValues([[
      'Satellite_Key', 'Display_Name', 'League', 'Notes', 'Updated_UTC'
    ]]);
    sid.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#fff2cc');
    Logger.log('Satellite_Identity: seeded header row');
  }

  if (typeof ensureResultsCleanCanonicalHeaders_ === 'function') {
    try {
      ensureResultsCleanCanonicalHeaders_(ss);
    } catch (eR) {
      Logger.log('ensureResultsCleanCanonicalHeaders_: ' + eR.message);
    }
  }

  Logger.log('[PHASE 4 COMPLETE] Satellite_Identity sheet + ResultsClean canonical header merge (append-only)');
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _initialiseTierConfigs_
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Avoid "first run" crashes when Config_Tier1 / Config_Tier2 are empty.
 *      New league files need sensible defaults to function immediately.
 * 
 * WHAT: If Config_Tier1 / Config_Tier2 exist but have no rows, write
 *       default key/value configs (with config_version).
 * 
 * HOW: Uses simple "if getLastRow() === 0" guard to avoid overwriting
 *      any existing human-edited configuration.
 * 
 * [UPGRADE 2025]: Added new PCT/NetRtg-based weights for magnitude-aware
 *                 predictions. These replace/augment the legacy rank-based
 *                 system for improved accuracy.
 * 
 * IMPORTANT: Only writes to Config sheets. NEVER touches Raw/Clean/Results sheets.
 * 
 * WHERE: Module 0 (Genesis), operating on the league file.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss - Active spreadsheet instance.
 */
function _initialiseTierConfigs_(ss) {
  Logger.log('--- Initialising Tier Configs (v4.0 - Full Coverage) ---');

  // ════════════════════════════════════════════════════════════════
  // HELPER: normalize key for comparison (case + underscore blind)
  // ════════════════════════════════════════════════════════════════
  function norm_(v) { return String(v || '').trim().toLowerCase().replace(/[\s_]/g, ''); }

  /**
   * Backfill missing keys into an existing config sheet.
   * NEVER overwrites existing values — append only.
   */
  function backfillMissing_(sheet, masterRows) {
    if (!sheet || sheet.getLastRow() === 0) return 0;
    var data = sheet.getDataRange().getValues();
    var existing = new Set();
    for (var i = 0; i < data.length; i++) {
      existing.add(norm_(data[i][0]));
    }
    var added = 0;
    for (var j = 0; j < masterRows.length; j++) {
      var row = masterRows[j];
      if (String(row[0]).indexOf('---') === 0) continue;   // skip dividers
      if (norm_(row[0]) === 'key') continue;                // skip header
      if (!existing.has(norm_(row[0]))) {
        sheet.appendRow(row);
        existing.add(norm_(row[0]));
        added++;
      }
    }
    return added;
  }

  // ════════════════════════════════════════════════════════════════
  // TIER 1 MASTER LIST
  // ════════════════════════════════════════════════════════════════
  var t1Rows = [
    ['key', 'value', 'comment'],
    ['config_version', '3.1', 'Increment when any Tier 1 param changes'],
    ['--- LEGACY WEIGHTS ---', '---', ''],
    ['rank_weight', 0, 'Legacy: Weight of league position'],
    ['form_weight', 2.5, 'Weight of recent form'],
    ['h2h_weight', 1.5, 'Weight of head-to-head history'],
    ['forebet_weight', 3.0, 'Weight of external model'],
    ['variance_weight', 1.0, 'Penalty for volatile teams'],
    ['--- PCT/NETRTG WEIGHTS ---', '---', ''],
    ['pctWeight', 3.5, 'Weight for PCT (Win %) difference'],
    ['netRtgWeight', 4.0, 'Weight for Net Rating diff'],
    ['homeCourtWeight', 2.0, 'Weight for home vs away split'],
    ['momentumWeight', 2.5, 'Weight for Last 10 games form'],
    ['streakWeight', 1.0, 'Weight for current win/loss streak'],
    ['--- COMMON PARAMS ---', '---', ''],
    ['home_advantage', 5.0, 'Home bonus (relative units)'],
    ['score_threshold', 5.0, 'Min |score| for HOME/AWAY pick'],
    ['confidence_min', 50, 'Confidence floor %'],
    ['confidence_max', 95, 'Confidence ceiling %'],
    ['--- ELITE PARAMS ---', '---', ''],
    ['min_samples', 1, 'Minimum sample size'],
    ['confidence_scale', 30, 'Scaling factor for confidence'],
    ['bayesian_blending', 'TRUE', 'Enable Bayesian blending'],
    ['show_all_tiers', 'TRUE', 'Show all tier levels'],
    ['--- TIER THRESHOLDS ---', '---', ''],
    ['tier_strong_min_score', 75, 'Strong tier minimum score'],
    ['tier_medium_min_score', 60, 'Medium tier minimum score'],
    ['tier_weak_min_score', 50, 'Weak tier minimum score']
  ];

  // ════════════════════════════════════════════════════════════════
  // TIER 2 MASTER LIST (COMPLETE — legacy + O/U + HQ + Forebet)
  // ════════════════════════════════════════════════════════════════
  var t2Rows = [
    ['key', 'value', 'comment'],
    ['config_version', '2.0', 'Increment when any Tier 2 param changes'],
    ['--- CORE PARAMS ---', '---', ''],
    ['threshold', 2.5, 'Base absolute margin threshold'],
    ['decay', 0.90, 'Momentum decay factor per game'],
    ['h2h_boost', 1.0, 'Extra weight for direct H2H'],
    ['momentum_swing_factor', 0.15, 'Weight of recent margins vs baseline'],
    ['variance_penalty_factor', 0.20, 'Penalty for high-variance matchups'],
    ['--- FLIP PATTERNS ---', '---', ''],
    ['q1_flip', 'FALSE', 'Flip Q1 direction (Costanza)'],
    ['q2_flip', 'FALSE', 'Flip Q2 direction'],
    ['q3_flip', 'FALSE', 'Flip Q3 direction'],
    ['q4_flip', 'FALSE', 'Flip Q4 direction'],
    ['--- ELITE PARAMS ---', '---', ''],
    ['strong_target', 0.750, 'Confidence target for strong picks'],
    ['medium_target', 0.650, 'Confidence target for medium picks'],
    ['even_target', 0.550, 'Confidence target for even picks'],
    ['confidence_scale', 25, 'Scaling factor for confidence'],
    ['--- FOREBET BLEND ---', '---', ''],
    ['forebet_blend_enabled', 'TRUE', 'Enable Forebet model blending'],
    ['forebet_ou_weight_qtr', 0.50, 'Forebet O/U weight for quarters'],
    ['forebet_ou_weight_ft', 1.50, 'Forebet O/U weight for full-time'],
    ['--- HIGHEST QUARTER ---', '---', ''],
    ['hq_enabled', 'TRUE', 'Enable Highest Quarter module'],
    ['hq_softmax_temperature', 4.0, 'Temperature for HQ softmax probability'],
    ['hq_shrink_k', 10, 'Shrinkage factor toward league prior'],
    ['hq_min_confidence', 55, 'Minimum confidence for HQ picks'],
    ['hq_min_pwin', 0.35, 'Minimum probability to win quarter'],
    ['hq_skip_ties', 'TRUE', 'Skip if model predicts a tie'],
    ['hq_vol_weight', 0.4, 'HQ volatility weight'],
    ['hq_fb_weight', 0.25, 'HQ Forebet weight'],
    ['hq_exempt_from_cap', 'FALSE', 'Exempt HQ from confidence cap'],
    ['hq_max_picks_per_slip', 2, 'Max HQ picks per accumulator slip'],
    ['highest_q_tie_policy', 'SKIP', 'What to do on HQ ties (SKIP/RANDOM)'],
    ['highest_q_tie_conf_penalty', 0.10, 'Confidence penalty on HQ ties'],
    ['highQtrTieMargin', 2.5, 'Tie margin for highest quarter'],
    ['tieMargin', 1.5, 'General tie margin'],
    ['--- O/U PARAMS ---', '---', ''],
    ['ou_edge_threshold', 0.04, 'Minimum edge for O/U picks'],
    ['ou_min_samples', 10, 'Minimum games needed for O/U stats'],
    ['ou_min_ev', 0.005, 'Minimum Expected Value for O/U'],
    ['ou_confidence_scale', 20, 'O/U confidence scaling factor'],
    ['ou_shrink_k', 8, 'O/U shrinkage factor'],
    ['ou_sigma_floor', 6.0, 'O/U sigma floor'],
    ['ou_sigma_scale', 1.0, 'O/U sigma scaling'],
    ['ou_american_odds', -110, 'O/U American odds baseline'],
    ['breakeven_prob', 0.5238, 'O/U break-even implied prob (merged into unified OU config)'],
    ['juice', -110, 'O/U American juice (merged into unified OU config)'],
    ['fallback_sd', 8.5, 'Default sigma fallback when league SD missing'],
    ['ou_model_error', 4.0, 'O/U model error estimate'],
    ['ou_prob_temp', 1.15, 'O/U probability temperature'],
    ['ou_use_effn', 'FALSE', 'Use effective N for O/U'],
    ['ou_confidence_shrink_min', 0.35, 'O/U confidence shrink floor'],
    ['ou_confidence_shrink_max', 1.0, 'O/U confidence shrink ceiling'],
    ['debug_ou_logging', 'FALSE', 'Enable O/U debug logging'],
    ['--- ENHANCEMENT FLAGS ---', '---', ''],
    ['enableRobbers', 'TRUE', 'Enable ROBBERS detection module'],
    ['enableFirstHalf', 'TRUE', 'Enable First Half predictions'],
    ['ftOUMinConf', 55, 'FT O/U minimum confidence']
  ];

  // ════════════════════════════════════════════════════════════════
  // TIER 1 — seed or backfill
  // ════════════════════════════════════════════════════════════════
  var c1 = ss.getSheetByName('Config_Tier1');
  if (c1 && c1.getLastRow() === 0) {
    Logger.log('Config_Tier1: Empty — seeding with full defaults');
    c1.getRange(1, 1, t1Rows.length, 3).setValues(t1Rows);
    c1.getRange('A1:C1').setFontWeight('bold').setBackground('#d9ead3');
    c1.autoResizeColumns(1, 3);
  } else if (c1) {
    var added1 = backfillMissing_(c1, t1Rows);
    Logger.log('Config_Tier1: Backfilled ' + added1 + ' missing keys');
  } else {
    Logger.log('Config_Tier1: Sheet not found — ERROR');
  }

  // ════════════════════════════════════════════════════════════════
  // TIER 2 — seed or backfill
  // ════════════════════════════════════════════════════════════════
  var c2 = ss.getSheetByName('Config_Tier2');
  if (c2 && c2.getLastRow() === 0) {
    Logger.log('Config_Tier2: Empty — seeding with full defaults');
    c2.getRange(1, 1, t2Rows.length, 3).setValues(t2Rows);
    c2.getRange('A1:C1').setFontWeight('bold').setBackground('#d9ead3');
    c2.autoResizeColumns(1, 3);
  } else if (c2) {
    var added2 = backfillMissing_(c2, t2Rows);
    Logger.log('Config_Tier2: Backfilled ' + added2 + ' missing keys');
  } else {
    Logger.log('Config_Tier2: Sheet not found — ERROR');
  }

  // ════════════════════════════════════════════════════════════════
  // PROPOSAL SHELLS — create if missing, never overwrite
  // ════════════════════════════════════════════════════════════════
  if (!ss.getSheetByName('Config_Tier1_Proposals')) {
    var p1 = ss.insertSheet('Config_Tier1_Proposals');
    p1.getRange('A1').setValue('Populated by "Tune League Weights" from the Ma Golide menu.');
    p1.getRange('A1').setFontStyle('italic').setFontColor('#666666');
    Logger.log('Config_Tier1_Proposals: Created');
  }
  if (!ss.getSheetByName('Config_Tier2_Proposals')) {
    var p2 = ss.insertSheet('Config_Tier2_Proposals');
    p2.getRange('A1').setValue('Populated by "Optimize Tier 2 Config" from the Ma Golide menu.');
    p2.getRange('A1').setFontStyle('italic').setFontColor('#666666');
    Logger.log('Config_Tier2_Proposals: Created');
  }

  Logger.log('--- Tier Configs Initialisation Complete ---');
}

/**
 * WHY: Create only as many H2H/Recent loop sheets as this league actually needs,
 *      preventing the creation of unnecessary, empty sheets.
 * WHAT: Counts the number of distinct game blocks in 'UpcomingRaw' and
 *       creates one set of loop sheets for each game found, plus a buffer.
 * HOW: Reads the 'UpcomingRaw' sheet, counts non-empty rows separated by blanks
 *      to determine the game count, then loops that many times to create sheets.
 * IMPORTANT: Only READS from UpcomingRaw to count games. Never writes to it.
 * WHERE: Reads from 'UpcomingRaw'. Creates 'RawH2H_#', 'CleanH2H_#', etc.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss - Active spreadsheet instance.
 */
function createLoopSheets_(ss) {
  Logger.log('--- Creating Loop Sheets ---');
  
  const upcomingSheet = getSheetInsensitive_(ss, 'UpcomingRaw');
  let maxSlots = 12;
  const BUFFER = 2;

  if (!upcomingSheet) {
    Logger.log('UpcomingRaw: NOT FOUND - using default 12 slots');
    ss.toast('UpcomingRaw sheet not found. Creating default 12 slots.', 'Genesis Warning', 10);
  } else {
    // READ ONLY - count blocks to determine game count
    const values = upcomingSheet.getDataRange().getValues();
    let gameCount = 0;
    let inBlock = false;
    
    for (let i = 0; i < values.length; i++) {
      const isRowEmpty = values[i].join('').trim() === '';
      if (!isRowEmpty && !inBlock) {
        gameCount++;
        inBlock = true;
      } else if (isRowEmpty) {
        inBlock = false;
      }
    }
    
    maxSlots = gameCount > 0 ? gameCount + BUFFER : 3;
    Logger.log('UpcomingRaw: Found ' + gameCount + ' game blocks');
    Logger.log('Loop slots to create: ' + maxSlots + ' (games + ' + BUFFER + ' buffer)');
  }

  ss.toast('Found ' + (maxSlots - BUFFER) + ' games. Creating ' + maxSlots + ' loop slots...', 'Genesis');

  let createdCount = 0;
  let skippedCount = 0;

  // Create empty shell sheets only - no data written
  for (let i = 1; i <= maxSlots; i++) {
    const loopSheets = [
      'RawH2H_' + i,
      'CleanH2H_' + i,
      'RawRecentHome_' + i,
      'CleanRecentHome_' + i,
      'RawRecentAway_' + i,
      'CleanRecentAway_' + i
    ];
    
    for (let j = 0; j < loopSheets.length; j++) {
      const result = createSheetIfMissing_(ss, loopSheets[j]);
      if (result) {
        createdCount++;
      } else {
        skippedCount++;
      }
    }
  }
  
  Logger.log('Loop Sheets Summary: Created=' + createdCount + ', Already Existed=' + skippedCount);
}

/**
 * WHY: Create the sheets that hold final outputs from the system,
 *      especially for betting slips / accumulator logic.
 * WHAT:
 *   - Ensures existence of:
 *       Bet_Slips   → final slips / tickets
 *       Acca_Central → cross-league accumulator control/summary
 * HOW:
 *   1. Define the array of output sheet names.
 *   2. For each, call createSheetIfMissing_.
 * IMPORTANT: Only creates empty sheets. Never writes data.
 * WHERE:
 *   - Operates at the spreadsheet level, serving as sink/output layers.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss - Active spreadsheet instance.
 */
function createOutputSheets_(ss) {
  Logger.log('--- Creating Output Sheets ---');
  
  const outputSheets = [
    'Bet_Slips',
    'Acca_Central'
  ];

  let createdCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < outputSheets.length; i++) {
    const result = createSheetIfMissing_(ss, outputSheets[i]);
    if (result) {
      createdCount++;
    } else {
      skippedCount++;
    }
  }
  
  Logger.log('Output Sheets Summary: Created=' + createdCount + ', Already Existed=' + skippedCount);
}

/**
 * WHY: Shared low-level helper that encapsulates the "create if missing" pattern.
 *      This enforces the no-duplicate rule and keeps logic DRY.
 * WHAT:
 *   - Checks if a sheet with the given name exists.
 *   - If not, inserts a new EMPTY sheet with exactly that name.
 *   - NEVER writes any data to the sheet.
 * HOW:
 *   1. Call ss.getSheetByName(name).
 *   2. If the result is null, call ss.insertSheet(name).
 *   3. If it exists, do nothing (idempotent behavior).
 * WHERE:
 *   - Operates across ALL types of sheets in Ma Golide (core, loop, output).
 *
 * @param {SpreadsheetApp.Spreadsheet} ss - Active spreadsheet.
 * @param {string} sheetName - The exact, official name of the sheet to enforce.
 * @returns {boolean} True if sheet was created, false if it already existed.
 */
function createSheetIfMissing_(ss, sheetName) {
  const existing = ss.getSheetByName(sheetName);

  if (!existing) {
    ss.insertSheet(sheetName);
    Logger.log('  [CREATED] ' + sheetName);
    return true;
  }
  
  // If sheet exists, do NOTHING - preserve all existing data
  Logger.log('  [EXISTS]  ' + sheetName + ' - skipped (data preserved)');
  return false;
}


function cleanUpcomingCleanDuplicateColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('UpcomingClean');
  if (!sheet) { Logger.log('UpcomingClean not found'); return; }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var seen = {};
  var dupeColumns = []; // 1-based column indices to delete
  
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').toLowerCase().trim();
    if (!key) continue;
    
    if (seen[key] !== undefined) {
      dupeColumns.push(i + 1); // 1-based
      Logger.log('DUPLICATE at col ' + (i + 1) + ': "' + headers[i] + '" (first at col ' + (seen[key] + 1) + ')');
    } else {
      seen[key] = i;
    }
  }
  
  // Delete from right to left to preserve indices
  dupeColumns.sort(function(a, b) { return b - a; });
  
  for (var d = 0; d < dupeColumns.length; d++) {
    sheet.deleteColumn(dupeColumns[d]);
  }
  
  Logger.log('Deleted ' + dupeColumns.length + ' duplicate columns. Remaining: ' + (headers.length - dupeColumns.length));
  return { deleted: dupeColumns.length, remaining: headers.length - dupeColumns.length };
}



/**
 * 
 * PROJECT: Ma Golide
 * STATUS: APPROVED BY PRESIDENTIAL DIRECTIVE - FINAL VERSION
 *
 * This file is the "Cockpit" of the operation.
 *
 * Its only purpose is to create the custom "Ma Golide" menu
 * in the spreadsheet UI and to act as the main "wrapper" that
 * calls the master functions from other modules.
 *
 * It provides robust error handling for all user-initiated actions.
 * ======================================================================
 * 
 * SUPERSEDES: All previous Menu.gs implementations
 * PATCH: Added O/U Predictions menu items and wrapper functions
 * ======================================================================
 */

/**
 * WHY: This is a special Apps Script trigger that creates the custom
 *      "Ma Golide" menu in the spreadsheet UI every time the file is opened.
 * WHAT: Adds the custom menu to the spreadsheet.
 * HOW: Gets the Spreadsheet UI, creates a new menu named "Ma Golide",
 *      and adds items with their corresponding function calls.
 * WHERE: This function is an 'onOpen' simple trigger, automatically
 *        executed by Google Sheets when the file is opened.
 * 
 * PATCH NOTES:
 * - Added 'Parse Results' menu item to Parsers submenu
 * - Added System Audit submenu for diagnostics
 * 
 * @param {Object} e The event object (unused).
 */
/* =============================================================================
 * (1) + (3) COMPLETION GLUE (SAFE WRAPPERS / ALIASES)
 * Put in ANY module that loads early (Module 1 or Module 9 recommended).
 * - Ensures menu items exist even if your real implementations have different names.
 * - Does NOT overwrite real functions.
 * ============================================================================*/




// Menu expects: runAllEnhancements / runRobbersDetection / runFirstHalfPredictions / runFTOUPredictions / runEnhancedHighestQ
if (typeof runAllEnhancements !== 'function') {
  function runAllEnhancements() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // Prefer your dual-mode runner if you have it.
    if (typeof processEnhancements === 'function') return processEnhancements(ss);
    // Else try a generic “Module 9 main runner”
    if (typeof runEnhancementsTest === 'function') return runEnhancementsTest();
    throw new Error('runAllEnhancements: no processEnhancements(ss) or runEnhancementsTest() found.');
  }
}


function runHQPredictions() { return runTier2_BothModes(); }
function runHQWithOUCrossLeverage() { return runTier2_BothModes(); }
function runEnhancedHighestQ() { return runTier2_BothModes(); }
function runAllEnhancements() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return processEnhancements(ss);
}


if (typeof runRobbersDetection !== 'function') {
  function runRobbersDetection() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (typeof predictRobbers === 'function') return predictRobbers(ss);
    if (typeof detectAllRobbers === 'function' && typeof loadRobbersH2HStats === 'function' && typeof loadRobbersRecentForm === 'function') {
      var up = _mg_getUpcomingGames_(ss).games;
      var h2h = loadRobbersH2HStats(ss) || {};
      var form = loadRobbersRecentForm(ss, 10) || {};
      return detectAllRobbers(up, h2h, form, (typeof loadTier2Config === 'function' ? loadTier2Config(ss) : null));
    }
    throw new Error('runRobbersDetection: no predictRobbers() and no detectAllRobbers() pipeline found.');
  }
}

if (typeof runFirstHalfPredictions !== 'function') {
  function runFirstHalfPredictions() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (typeof predictFirstHalf1x2 !== 'function') throw new Error('runFirstHalfPredictions: predictFirstHalf1x2 not found.');
    var cfg = (typeof loadTier2Config === 'function') ? (loadTier2Config(ss) || {}) : {};
    var marginStats = (typeof loadTier2MarginStats === 'function') ? (loadTier2MarginStats(ss) || {}) : {};
    var games = _mg_getUpcomingGames_(ss).games;
    return games.map(function(g) {
      return { match: g.home + ' vs ' + g.away, result: predictFirstHalf1x2({ home: g.home, away: g.away }, marginStats, cfg) };
    });
  }
}

if (typeof runFTOUPredictions !== 'function') {
  function runFTOUPredictions() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (typeof predictFTOverUnder !== 'function' && typeof predictFTOverUnder !== 'function') {
      // Your doc uses predictFTOverUnder; some code uses predictFTOverUnder.
      // If neither exists, throw.
      throw new Error('runFTOUPredictions: predictFTOverUnder not found.');
    }
    var cfg = (typeof loadTier2Config === 'function') ? (loadTier2Config(ss) || {}) : {};
    var marginStats = (typeof loadTier2MarginStats === 'function') ? (loadTier2MarginStats(ss) || {}) : {};
    var games = _mg_getUpcomingGames_(ss).games;
    return games.map(function(g) {
      var fn = (typeof predictFTOverUnder === 'function') ? predictFTOverUnder : predictFTOverUnder;
      return { match: g.home + ' vs ' + g.away, line: g.ftBookLine, result: fn({ home: g.home, away: g.away, ftBookLine: g.ftBookLine }, marginStats, cfg) };
    });
  }
}

if (typeof runEnhancedHighestQ !== 'function') {
  function runEnhancedHighestQ() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (typeof predictHighestQuarterEnhanced !== 'function') throw new Error('runEnhancedHighestQ: predictHighestQuarterEnhanced not found.');
    var cfg = (typeof loadTier2Config === 'function') ? (loadTier2Config(ss) || {}) : {};
    var marginStats = (typeof loadTier2MarginStats === 'function') ? (loadTier2MarginStats(ss) || {}) : {};
    var games = _mg_getUpcomingGames_(ss).games;
    return games.map(function(g) {
      return { match: g.home + ' vs ' + g.away, result: predictHighestQuarterEnhanced({ home: g.home, away: g.away }, marginStats, cfg) };
    });
  }
}

// Internal helpers for wrappers (safe, low-risk). Put once.
if (typeof _mg_getUpcomingGames_ !== 'function') {
  function _mg_getUpcomingGames_(ss) {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    var sh = (typeof _getSheetByNameInsensitive_ === 'function')
      ? _getSheetByNameInsensitive_(ss, 'UpcomingClean')
      : ss.getSheetByName('UpcomingClean');
    if (!sh) throw new Error('UpcomingClean not found.');

    var values = sh.getDataRange().getValues();
    if (!values || values.length < 2) return { games: [] };

    var hMap = {};
    for (var c = 0; c < values[0].length; c++) {
      var k = String(values[0][c] || '').toLowerCase().trim();
      if (k) hMap[k] = c;
    }

    function getVal(row, keys) {
      for (var i = 0; i < keys.length; i++) {
        var idx = hMap[keys[i]];
        if (idx !== undefined) {
          var v = row[idx];
          if (v !== '' && v !== null && v !== undefined) return v;
        }
      }
      return null;
    }

    var games = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var home = String(getVal(row, ['home', 'home_team', 'hometeam']) || '').trim();
      var away = String(getVal(row, ['away', 'away_team', 'awayteam', 'visitor']) || '').trim();
      if (!home || !away) continue;

      // FT line fallback chain (ISS-006 compatible)
      var ftBookLine = parseFloat(getVal(row, ['ft score','ft_score','ftline','ft_line','avg','total','line'])) || 0;

      games.push({
        home: home,
        away: away,
        ftBookLine: ftBookLine,
        homeOdds: parseFloat(getVal(row, ['homeodds', 'home_odds'])) || 0,
        awayOdds: parseFloat(getVal(row, ['awayodds', 'away_odds'])) || 0,
        league: String(getVal(row, ['league']) || ''),
        date: getVal(row, ['date']),
        time: getVal(row, ['time'])
      });
    }

    return { games: games };
  }
}


/* =============================================================================
 * FUNCTION 4/6 — Module 7 (Menu.gs): onOpen(e) PATCHED
 * ============================================================================*/
// ═══════════════════════════════════════════════════════════════════════════
// MENU — UPDATED WITH ALL HQ ITEMS
// Replaces existing onOpen (audit: 53 lines)
// Every menu item points to a function that now exists.
// ═══════════════════════════════════════════════════════════════════════════

function onOpen(e) {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Ma Golide')
    .addItem('RUN THE WHOLE SHEBANG', 'runTheWholeShebang')
    .addItem('Run Full Analysis (No Tuning)', 'runFullAnalysis')
    .addSeparator()
    .addSubMenu(ui.createMenu('Parsers')
      .addItem('Parse Raw', 'parseRaw')
      .addItem('Parse Results', 'runParseResults')
      .addItem('Parse Upcoming', 'parseUpcomingMatches')
      .addItem('Parse All H2H', 'runAllH2HParsers')
      .addItem('Parse All Recent', 'runAllRecentParsers')
      .addItem('Run All Parsers', 'runAllParsers'))
    .addSubMenu(ui.createMenu('Analyzers')
      .addItem('Run Historical Analysis', 'runHistoricalAnalyzers')
      .addItem('Run Tier 1 Forecast', 'runTier1_Forecast')
      .addItem('Run Tier 1 Forensics', 'runTier1Forensics')
      .addSeparator()
      .addItem('Run Tier 2 COMPLETE', 'runTier2Complete')
      .addSeparator()
      .addItem('Run Tier 2 Margins Only', 'runTier2_DeepDive')
      .addItem('Run Tier 2 O/U Only', 'runTier2OU')
      .addItem('Run O/U Then Enhancements', 'runOUThenEnhancements'))
    .addSubMenu(ui.createMenu('Enhancements')
      .addItem('Run All Enhancements (HQ + 1H)', 'runAllEnhancements')
      .addSeparator()
      .addItem('Run ROBBERS Detection', 'runRobbersDetection')
      .addItem('Run First Half Predictions', 'runFirstHalfPredictions')
      .addItem('Run FT O/U Predictions', 'runFTOUPredictions')
      .addSeparator()
      .addItem('Enhancement Diagnostic', 'runEnhancementDiagnostic')
      .addItem('Clear All Caches', 'clearAllCaches'))
    .addSubMenu(ui.createMenu('Highest Quarter')
      .addItem('Run HQ Predictions', 'runHQPredictions')
      .addItem('Run HQ With O/U Cross-Leverage', 'runHQWithOUCrossLeverage')
      .addSeparator()
      .addItem('Build HQ History', 'runBuildHQHistory')
      .addItem('Backtest HQ Model', 'runHQBacktest')
      .addItem('HQ Accuracy Report', 'runHQAccuracyReport')
      .addSeparator()
      .addItem('HQ Diagnostic (First Game)', 'runHQDiagnostic')
      .addItem('HQ Pipeline Status', 'runHQStatusCheck'))
    .addSubMenu(ui.createMenu('Reports')
      .addItem('Generate Accuracy Report', 'runAccuracyReportWrapper')
      .addItem('Generate Tier 2 Accuracy Report', 'generateTier2AccuracyReport_')
      .addItem('Generate O/U Accuracy Report', 'runOUAccuracyReport')
      .addItem('Generate HQ Accuracy Report', 'runHQAccuracyReport'))
    .addSubMenu(ui.createMenu('Configuration')
      .addItem('Sync Missing Configs (Safe)', 'syncMissingConfigs')
      .addSeparator()
      .addItem('Optimize Tier 2 Config', 'runTier2ConfigOptimization')
      .addItem('Tune League Weights', 'tuneLeagueWeightsWrapper')
      .addItem('Tune HQ Parameters', 'runHQTuner')
      .addSeparator()
      .addItem('Apply Tier 1 Rank #1', 'applyTier1ProposedToConfig')
      .addItem('Apply Tier 1 Rank #2', 'applyTier1Rank2ToConfig')
      .addItem('Apply Tier 1 Rank #3', 'applyTier1Rank3ToConfig')
      .addSeparator()
      .addItem('Apply Tier 2 Rank #1', 'applyTier2ProposedToConfig')
      .addItem('Apply Tier 2 Rank #2', 'applyTier2Rank2ToConfig')
      .addItem('Apply Tier 2 Rank #3', 'applyTier2Rank3ToConfig')
      .addSeparator()
      .addItem('Create HQ Sheets', 'runCreateHQSheets')
      .addItem('Create Config_Tier2', 'createTier2ConfigSheet')
      .addItem('View Current Config', 'showCurrentConfig')
      .addSeparator()
      .addItem('Clean Duplicate Columns', 'cleanUpcomingCleanDuplicateColumns')
      .addItem('Clear Margin Cache', 'clearMarginCache'))
    .addSeparator()
    .addItem('Build Accumulators', 'runAccumulator')
    .addSubMenu(ui.createMenu('Diagnostics')
      .addItem('HQ Pipeline Status', 'runHQStatusCheck')
      .addItem('HQ Diagnostic (First Game)', 'runHQDiagnostic')
      .addItem('Data Access Check', 'diagHQDataAccess')
      .addItem('Run Full HQ Audit', 'runHQFullAudit'))
    .addToUi();
}

// ═══════════════════════════════════════════════════════════════════════════
// MENU WRAPPER FUNCTIONS FOR MODULE 9 ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════════════════

function runRobbersDetection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  try {
    ss.toast('Running ROBBERS detection...', 'Ma Golide', 5);
    
    if (typeof detectAllRobbers !== 'function') {
      throw new Error('MODULE 9 not loaded. Add Enhancements.gs first.');
    }
    
    var sheet = getSheetInsensitive(ss, 'UpcomingClean');
    if (!sheet) throw new Error('UpcomingClean not found.');
    
    var data = sheet.getDataRange().getValues();
    var h = createHeaderMap(data[0]);
    var games = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      games.push({
        home: row[h.home],
        away: row[h.away],
        homeOdds: row[h['home_odds']] || row[h.homeodds] || 0,
        awayOdds: row[h['away_odds']] || row[h.awayodds] || 0,
        league: row[h.league],
        date: row[h.date],
        time: row[h.time]
      });
    }
    
    var h2hStats = loadRobbersH2HStats(ss);
    var recentForm = loadRobbersRecentForm(ss, 10);
    var robbers = detectAllRobbers(games, h2hStats, recentForm, null);
    
    ui.alert(
      '🔥 ROBBERS Detection Complete',
      'Found ' + robbers.length + ' potential upset picks.\n\n' +
      (robbers.length > 0 ? 
        'Top 3:\n' + robbers.slice(0, 3).map(function(r) {
          return '• ' + r.team + ' (' + r.confidence + '%)';
        }).join('\n') : 'No upsets detected.') +
      '\n\nRun Build Accumulators to include ROBBERS in bet slips.',
      ui.ButtonSet.OK
    );
    
  } catch (e) {
    Logger.log('[ROBBERS] Error: ' + e.message);
    ui.alert('ROBBERS Error', e.message, ui.ButtonSet.OK);
  }
}

function runFirstHalfPredictions() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  try {
    ss.toast('Running First Half predictions...', 'Ma Golide', 5);
    
    if (typeof predictFirstHalf1x2 !== 'function') {
      throw new Error('MODULE 9 not loaded. Add Enhancements.gs first.');
    }
    
    var marginStats = typeof loadTier2MarginStats === 'function' ? loadTier2MarginStats() : {};
    var sheet = getSheetInsensitive(ss, 'UpcomingClean');
    if (!sheet) throw new Error('UpcomingClean not found.');
    
    var data = sheet.getDataRange().getValues();
    var h = createHeaderMap(data[0]);
    var predictions = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var home = String(row[h.home] || '').trim();
      var away = String(row[h.away] || '').trim();
      if (!home || !away) continue;
      
      var pred = predictFirstHalf1x2({ home: home, away: away }, marginStats, null);
      if (pred && pred.prediction !== 'N/A') {
        predictions.push(pred);
      }
    }
    
    ui.alert(
      '⏱️ First Half 1x2 Complete',
      'Generated ' + predictions.length + ' predictions.\n\n' +
      'Run Build Accumulators to include 1H picks in bet slips.',
      ui.ButtonSet.OK
    );
    
  } catch (e) {
    Logger.log('[1H] Error: ' + e.message);
    ui.alert('First Half Error', e.message, ui.ButtonSet.OK);
  }
}

function runFTOUPredictions() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  try {
    ss.toast('Running FT O/U predictions...', 'Ma Golide', 5);
    
    if (typeof predictFTOverUnder !== 'function') {
      throw new Error('MODULE 9 not loaded. Add Enhancements.gs first.');
    }
    
    ui.alert(
      '📊 FT O/U',
      'FT Over/Under predictions require book lines in UpcomingClean.\n\n' +
      'Ensure you have a "ft_line" or "ftline" column with the total line.\n\n' +
      'Run Build Accumulators to include FT O/U picks in bet slips.',
      ui.ButtonSet.OK
    );
    
  } catch (e) {
    Logger.log('[FT O/U] Error: ' + e.message);
    ui.alert('FT O/U Error', e.message, ui.ButtonSet.OK);
  }
}




/**
 * ======================================================================
 * THE PRESIDENTIAL BUTTON: runTheWholeShebang (DAILY / NO TUNING)
 * ======================================================================
 * Runs the complete daily pipeline but intentionally excludes the heavy
 * tuning modules to avoid the Apps Script 6-minute limit.
 *
 * ZERO_FALLBACK overlay (if present):
 *   - bridge configs
 *   - install numeric guards (monitor)
 *   - clear caches
 *   - wrap critical writer stages with:
 *       conservative repair -> stage -> freshest repair
 * ======================================================================
 */
function runTheWholeShebang() {
  return _runWholeShebang_({ includeTuners: false });
}

/**
 * Optional: keep a second menu item if you ever want to try "everything".
 * Warning: may exceed 6 minutes unless you run under a longer-limit context.
 */
function runTheWholeShebang_WithTuners() {
  return _runWholeShebang_({ includeTuners: true });
}

function _runWholeShebang_(opts) {
  opts = opts || {};
  const includeTuners = !!opts.includeTuners;

  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const g  = (typeof globalThis !== 'undefined') ? globalThis : this;

  const confirm = ui.alert(
    includeTuners ? '🚀 RUN THE WHOLE SHEBANG (WITH TUNING)?' : '🚀 RUN THE WHOLE SHEBANG?',
    'This will execute the Ma Golide pipeline.\n\n' +
      (includeTuners
        ? 'Includes Tuning (may hit the 6-minute limit).\n\n'
        : 'Tuning is excluded to stay under the 6-minute limit.\n\n') +
      'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    ss.toast('Pipeline cancelled.', 'Ma Golide', 3);
    return;
  }

  Logger.log('===== INITIATING THE WHOLE SHEBANG =====');

  const startMs   = Date.now();
  const startTime = new Date();
  const completed = [];
  const skipped   = [];
  const zfLog     = [];

  // If you want to fail gracefully before Apps Script kills the process.
  // (Does NOT save you if a single stage itself runs too long.)
  const MAX_SAFE_MS = 5.5 * 60 * 1000; // 5m30s safety margin
  function timeGuard(label) {
    if (Date.now() - startMs > MAX_SAFE_MS) {
      throw new Error('Aborting before Apps Script 6-minute limit (at stage: ' + label + '). ' +
                      'Run Tuners separately.');
    }
  }

  function pickFn(preferred, fallback) {
    if (typeof g[preferred] === 'function') return g[preferred];
    if (fallback && typeof g[fallback] === 'function') return g[fallback];
    return null;
  }

  // Prefer underscore overlay API; allow fallback if your overlay uses non-underscore names.
  const zf = {
    repair:         pickFn('_zf_repairSheet_',         'zf_repairSheet'),
    bridge:         pickFn('_zf_bridgeConfig_',        'zf_bridgeConfig'),
    installNumeric: pickFn('_zf_installNumericGuards_','zf_installNumericGuards'),
    clearCaches:    pickFn('_zf_clearCaches_',         'zf_clearCaches'),
    verifyHeaders:  pickFn('_zf_verifyHeaders_',       'zf_verifyHeaders')
  };

  const zfDetected    = !!(zf.repair || zf.bridge || zf.installNumeric || zf.clearCaches || zf.verifyHeaders);
  const zfGuardActive = !!zf.repair;

  function resolveFn(candidates) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && typeof c.name === 'string' && typeof g[c.name] === 'function') {
        return { name: c.name, fn: g[c.name], passSs: !!c.passSs };
      }
    }
    return null;
  }

  function callResolved(res) {
    return res.passSs ? res.fn(ss) : res.fn();
  }

  function zfBootstrap() {
    if (zf.bridge) {
      zf.bridge(ss, 'Config_Tier1', zfLog);
      zf.bridge(ss, 'Config_Tier2', zfLog);
    }
    if (zf.repair) {
      zf.repair(ss, 'UpcomingClean', zfLog, { policy: 'conservative' });
    }
    if (zf.installNumeric) {
      zf.installNumeric(ss, zfLog, { mode: 'monitor' });
    }
    if (zf.clearCaches) {
      zf.clearCaches(zfLog);
    }
  }

  function zfPreStage() {
    if (zfGuardActive) zf.repair(ss, 'UpcomingClean', zfLog, { policy: 'conservative' });
  }
  function zfPostStage() {
    if (zfGuardActive) zf.repair(ss, 'UpcomingClean', zfLog, { policy: 'freshest' });
  }

  function runPlainStage(label, toastMsg, candidates) {
    timeGuard(label);
    ss.toast(toastMsg, 'The Whole Shebang', 15);

    const res = resolveFn(candidates);
    if (!res) { skipped.push(label + ' (not found)'); return; }

    try {
      callResolved(res);
      completed.push(label);
      Logger.log('[Shebang] OK  ' + label + ' via ' + res.name + '()');
    } catch (e) {
      skipped.push(label + ' (error)');
      Logger.log('[Shebang] FAIL ' + label + ' via ' + res.name + '(): ' + e.message);
    }
  }

  function runGuardedStage(label, toastMsg, candidates) {
    timeGuard(label);
    ss.toast(toastMsg, 'The Whole Shebang', 20);

    const res = resolveFn(candidates);
    if (!res) { skipped.push(label + ' (not found)'); return; }

    let preRan = false;
    try {
      if (zfGuardActive) { zfPreStage(); preRan = true; }
      callResolved(res);
      completed.push(label + (zfGuardActive ? ' [ZF]' : ''));
      Logger.log('[Shebang] OK  ' + label + ' via ' + res.name + '()' + (zfGuardActive ? ' [ZF guarded]' : ''));
    } catch (e) {
      skipped.push(label + ' (error)');
      Logger.log('[Shebang] FAIL ' + label + ' via ' + res.name + '(): ' + e.message);
    } finally {
      if (preRan) {
        try { zfPostStage(); }
        catch (postErr) { Logger.log('[Shebang] Post-repair error after ' + label + ': ' + postErr.message); }
      }
    }
  }

  try {
    // Phase 1: Genesis
    runPlainStage('Genesis', 'Phase 1/7: Running Genesis...', [
      { name: 'setupAllSheets', passSs: false }
    ]);

    // Phase 2: Parsers
    runPlainStage('Parsers', 'Phase 2/7: Parsing ALL Data...', [
      { name: 'runAllParsers', passSs: false }
    ]);

    // ZF bootstrap AFTER setup+parse
    try {
      zfBootstrap();
      Logger.log('[Shebang] ZERO_FALLBACK overlay: ' + (zfDetected ? 'detected' : 'not detected'));
    } catch (e) {
      Logger.log('[Shebang] ZERO_FALLBACK bootstrap error (non-fatal): ' + e.message);
    }

    // Phase 3: Historical (keep plain unless you KNOW it writes schema-sensitive columns)
    runPlainStage('Historical Analysis', 'Phase 3/7: Historical Analysis...', [
      { name: 'runAllHistoricalAnalyzers', passSs: true }
    ]);

    // Phase 4: Tier 1 (writer => guarded)
    runGuardedStage('Tier 1 Forecast', 'Phase 4/7: Tier 1 Forecast...', [
      { name: 'analyzeTier1', passSs: true }
    ]);

    try {
      if (typeof t2_resetSharedGameContext_ === 'function') {
        t2_resetSharedGameContext_(ss, { source: 'WholeShebang' });
        Logger.log('[Shebang] Shared Context Initialized for O/U -> HQ Bridge!');
      }
    } catch(eCtx) {
      Logger.log('[Shebang] Context init failed: ' + eCtx.message);
    }

    // Phase 5: Tier 2 writers (ONE canonical pass each)
    runGuardedStage('Tier 2 Margins', 'Phase 5/7: Tier 2 Margins...', [
      { name: 'runTier2_DeepDive', passSs: false },
      { name: 'predictQuarters_Tier2', passSs: true }
    ]);

    runGuardedStage('Tier 2 O/U', 'Phase 5/7: Tier 2 O/U...', [
      { name: 'runTier2OU', passSs: false },
      { name: 'predictQuartersOU_Tier2', passSs: true },
      { name: 'predictQuarters_Tier2_OU', passSs: true }
    ]);

    runGuardedStage('Enhancements', 'Phase 5/7: Enhancements...', [
      { name: 'runAllEnhancements', passSs: false }
    ]);

    // Phase 6: Accumulator (writer => guarded)
    runGuardedStage('Accumulator', 'Phase 6/7: Building Accumulators...', [
      { name: 'buildAccumulator', passSs: true },
      { name: 'buildModule8Accumulator', passSs: true },
      { name: 'runAccumulator', passSs: false }
    ]);

    // Optional verify
    if (zf.verifyHeaders) {
      try { zf.verifyHeaders(ss, 'UpcomingClean', zfLog); }
      catch (e) { Logger.log('[Shebang] Header verify error (non-fatal): ' + e.message); }
    }

    // Phase 7: Reports (plain)
    runPlainStage('Accuracy Report', 'Phase 7/7: Accuracy Report...', [
      { name: 'generateAccuracyReport', passSs: true }
    ]);
    runPlainStage('Tier 2 Accuracy Report', 'Phase 7/7: Tier 2 Accuracy...', [
      { name: 'buildTier2AccuracyReport', passSs: true }
    ]);
    runPlainStage('O/U Accuracy Report', 'Phase 7/7: O/U Accuracy...', [
      { name: 'buildOUAccuracyReport', passSs: true }
    ]);

    // OPTIONAL (not recommended for menu/editor runs)
    if (includeTuners) {
      runPlainStage('Tier 1 Tuning', 'Phase 7/7: Tier 1 Tuning (proposal)...', [
        { name: 'tuneLeagueWeights', passSs: true }
      ]);
      runPlainStage('Tier 2 Tuning', 'Phase 7/7: Tier 2 Tuning (proposal)...', [
        { name: 'tuneTier2Config', passSs: true }
      ]);
    }

    const duration = Math.round((Date.now() - startMs) / 1000);
    let msg = '✅ COMPLETE in ' + duration + ' seconds\n\n';
    msg += 'Completed (' + completed.length + '):\n' + completed.map(p => '  • ' + p).join('\n');
    if (skipped.length) msg += '\n\n⚠️ Skipped (' + skipped.length + '):\n' + skipped.map(p => '  • ' + p).join('\n');
    msg += '\n\n🛡️ ZF overlay: ' + (zfDetected ? 'ACTIVE' : 'not detected');
    msg += '\n🧱 Guard sandwich: ' + (zfGuardActive ? 'ACTIVE' : 'not available');
    msg += '\n📊 UpcomingClean: predictions';
    msg += '\n🍳 Bet_Slips: accumulators';

    if (zfLog.length) Logger.log('\n=== ZERO_FALLBACK OPERATIONS LOG ===\n' + zfLog.join('\n'));

    ui.alert('🚀 THE WHOLE SHEBANG COMPLETE', msg, ui.ButtonSet.OK);
    Logger.log('===== THE WHOLE SHEBANG COMPLETE =====');

  } catch (e) {
    Logger.log('!!! CRITICAL SHEBANG FAILURE: ' + e.message + '\nStack: ' + e.stack);
    if (zfLog.length) Logger.log('\n=== ZERO_FALLBACK LOG (PARTIAL) ===\n' + zfLog.join('\n'));

    ui.alert(
      'Shebang Failed',
      'Error: ' + e.message + '\n\nCompleted: ' + completed.join(', ') + '\n\nCheck Logs for details.',
      ui.ButtonSet.OK
    );
  }
}




/**
 * Runs ONLY the tuning/proposal generators.
 * (Still subject to Apps Script runtime limits, so run sparingly.)
 */
function runTunersOnly() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const confirm = ui.alert(
    '🧠 RUN TUNERS ONLY?',
    'This runs heavy optimization/proposal stages (may take a long time).\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const start = Date.now();
  const done = [];
  const fail = [];

  try {
    if (typeof tuneLeagueWeights === 'function') {
      try { tuneLeagueWeights(ss); done.push('Tier 1 Tuning'); }
      catch (e) { fail.push('Tier 1 Tuning'); Logger.log('[TunersOnly] T1 error: ' + e.message); }
    } else {
      fail.push('Tier 1 Tuning (not found)');
    }

    if (typeof tuneTier2Config === 'function') {
      try { tuneTier2Config(ss); done.push('Tier 2 Tuning'); }
      catch (e) { fail.push('Tier 2 Tuning'); Logger.log('[TunersOnly] T2 error: ' + e.message); }
    } else {
      fail.push('Tier 2 Tuning (not found)');
    }

    const dur = Math.round((Date.now() - start) / 1000);
    ui.alert(
      'Tuners Complete',
      'Done in ' + dur + 's\n\n' +
        'Completed:\n' + (done.length ? done.map(x => '  • ' + x).join('\n') : '  (none)') + '\n\n' +
        (fail.length ? ('Failed/Skipped:\n' + fail.map(x => '  • ' + x).join('\n')) : ''),
      ui.ButtonSet.OK
    );

  } catch (e) {
    ui.alert('Tuners Failed', 'Error: ' + e.message + '\n\nCheck Logs.', ui.ButtonSet.OK);
  }
}



/**
 * WHY: Runs the full analysis pipeline WITHOUT tuning.
 * WHAT: Executes parsers, historical, Tier 1, and Tier 2 (including O/U).
 * HOW: Sequential calls with proper O/U integration.
 * WHERE: Called from menu.
 */
function runFullAnalysis() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING FULL ANALYSIS =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    
    // Step 1: Parsers
    ss.toast('Step 1/5: Running all parsers...', 'Full Analysis', 15);
    runAllParsers();

    // Step 2: Historical Analysis
    ss.toast('Step 2/5: Historical analysis...', 'Full Analysis', 15);
    if (typeof runAllHistoricalAnalyzers === 'function') {
      runAllHistoricalAnalyzers(ss);
    }

    // Step 3: Tier 1 Forecast
    ss.toast('Step 3/5: Tier 1 forecast...', 'Full Analysis', 15);
    if (typeof analyzeTier1 === 'function') {
      analyzeTier1(ss);
    }

    // Step 4: Tier 2 Margins
    ss.toast('Step 4/5: Tier 2 margins...', 'Full Analysis', 20);
    if (typeof predictQuarters_Tier2 === 'function') {
      predictQuarters_Tier2(ss);
    }

    // Step 5: Tier 2 O/U (THE FIX!)
    ss.toast('Step 5/5: Tier 2 O/U...', 'Full Analysis', 20);
    if (typeof predictQuartersOU_Tier2 === 'function') {
      predictQuartersOU_Tier2(ss);
    }

    ui.alert(
      'Full Analysis Complete!',
      'All predictions generated:\n\n' +
      '✅ Historical Analysis\n' +
      '✅ Tier 1 Forecast\n' +
      '✅ Tier 2 Margins (t2-q1..t2-q4)\n' +
      '✅ Tier 2 O/U (ou-q1..ou-q4)\n\n' +
      'Check UpcomingClean sheet for results.',
      ui.ButtonSet.OK
    );
    
    Logger.log('===== FULL ANALYSIS COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runFullAnalysis: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Full Analysis Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Resilient wrapper for running all parsers.
 * WHAT: Calls all parser functions with individual error handling.
 * HOW: Sequential calls with try-catch per parser to prevent cascade failures.
 * WHERE: Called from menu or as part of larger pipeline.
 * [UPGRADE]: Added individual sheet existence checks before parsing loops.
 */
function runAllParsers() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('--- Starting Full Parse ---');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');

    // 1. Parse Standings (Critical - needed for team splitting)
    if (typeof runParseStandings === 'function') {
      try {
        runParseStandings(ss);
      } catch (e) {
        Logger.log('Standings parse error: ' + e.message);
        // Non-fatal, continue
      }
    }

    // 2. Parse Raw
    if (typeof runParseRaw === 'function') {
      try {
        runParseRaw(ss);
      } catch (e) {
        Logger.log('Raw parse error: ' + e.message);
      }
    }

    // 3. Parse Results (Historical)
    if (typeof runParseResults === 'function') {
      try {
        runParseResults(ss);
      } catch (e) {
        Logger.log('Results parse error: ' + e.message);
      }
    }

    // 4. Parse Upcoming
    if (typeof runParseUpcoming === 'function') {
      try {
        runParseUpcoming(ss);
      } catch (e) {
        Logger.log('Upcoming parse error: ' + e.message);
      }
    }

    // 5. Parse Looped Sheets (H2H / Recent)
    for (let i = 1; i <= 12; i++) {
      // H2H
      const rawH2H = ss.getSheetByName('RawH2H_' + i);
      if (rawH2H && typeof runParseH2H === 'function') {
        try {
          runParseH2H(ss, 'RawH2H_' + i, 'CleanH2H_' + i);
        } catch (e) {
          Logger.log('Skipping H2H_' + i + ': ' + e.message);
        }
      }

      // Recent Home
      const rawHome = ss.getSheetByName('RawRecentHome_' + i);
      if (rawHome && typeof runParseRecent === 'function') {
        try {
          runParseRecent(ss, 'RawRecentHome_' + i, 'CleanRecentHome_' + i);
        } catch (e) {
          Logger.log('Skipping RecentHome_' + i + ': ' + e.message);
        }
      }

      // Recent Away
      const rawAway = ss.getSheetByName('RawRecentAway_' + i);
      if (rawAway && typeof runParseRecent === 'function') {
        try {
          runParseRecent(ss, 'RawRecentAway_' + i, 'CleanRecentAway_' + i);
        } catch (e) {
          Logger.log('Skipping RecentAway_' + i + ': ' + e.message);
        }
      }
    }

    Logger.log('--- Parsing Complete ---');

  } catch (e) {
    Logger.log('FATAL ERROR in runAllParsers: ' + e.message);
    throw e; // Re-throw for parent handler
  }
}


/**
 * WHY: Wrapper for parsing raw historical data sheet.
 * WHAT: Parses the Raw sheet to Clean sheet.
 * HOW: Calls parseRawSheet from Module 2.
 * WHERE: Called from menu or pipeline.
 */
function parseRaw() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING PARSE RAW =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Parsing Raw sheet...', 'Ma Golide', 5);

    // Use case-insensitive helper if available
    const rawSheet = (typeof getSheetInsensitive === 'function') 
      ? getSheetInsensitive(ss, 'Raw') 
      : ss.getSheetByName('Raw');
    if (!rawSheet) throw new Error('"Raw" sheet not found.');

    const cleanSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'Clean')
      : ss.getSheetByName('Clean');
    if (!cleanSheet) throw new Error('"Clean" sheet not found.');

    if (typeof parseRawSheet === 'function') {
      parseRawSheet(rawSheet, cleanSheet);
    } else {
      throw new Error('parseRawSheet function not found in Module 2.');
    }

    ss.toast('Parse Raw Complete!', 'Ma Golide', 5);
    Logger.log('===== PARSE RAW COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in parseRaw: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Parse Raw Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for parsing upcoming matches.
 * WHAT: Parses UpcomingRaw to UpcomingClean.
 * HOW: Calls parseUpcomingSheet from Module 2.
 * WHERE: Called from menu or pipeline.
 */
function parseUpcomingMatches() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING PARSE UPCOMING =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Parsing UpcomingRaw sheet...', 'Ma Golide', 5);

    const rawSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'UpcomingRaw')
      : ss.getSheetByName('UpcomingRaw');
    if (!rawSheet) throw new Error('"UpcomingRaw" sheet not found.');

    const cleanSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'UpcomingClean')
      : ss.getSheetByName('UpcomingClean');
    if (!cleanSheet) throw new Error('"UpcomingClean" sheet not found.');

    if (typeof parseUpcomingSheet === 'function') {
      parseUpcomingSheet(rawSheet, cleanSheet);
    } else {
      throw new Error('parseUpcomingSheet function not found in Module 2.');
    }

    ss.toast('Parse Upcoming Complete!', 'Ma Golide', 5);
    Logger.log('===== PARSE UPCOMING COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in parseUpcomingMatches: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Parse Upcoming Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for parsing all H2H sheets (1-12).
 * WHAT: Loops through RawH2H_1 to _12 and parses each.
 * HOW: Dynamic loop with existence checks.
 * WHERE: Called from menu or pipeline.
 */
function runAllH2HParsers() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING PARSE ALL H2H =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Parsing all H2H sheets...', 'Ma Golide', 10);

    for (let i = 1; i <= 12; i++) {
      try {
        if (typeof runParseH2H === 'function') {
          runParseH2H(ss, 'RawH2H_' + i, 'CleanH2H_' + i);
        }
      } catch (e) {
        Logger.log('Skipping H2H_' + i + ': ' + e.message);
      }
    }

    ss.toast('Parse All H2H Complete!', 'Ma Golide', 5);
    Logger.log('===== PARSE ALL H2H COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runAllH2HParsers: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Parse All H2H Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for parsing all Recent form sheets (Home & Away, 1-12).
 * WHAT: Loops through RawRecentHome/Away_1 to _12 and parses each.
 * HOW: Dynamic loop with existence checks.
 * WHERE: Called from menu or pipeline.
 */
function runAllRecentParsers() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING PARSE ALL RECENT =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Parsing all Recent form sheets...', 'Ma Golide', 10);

    for (let i = 1; i <= 12; i++) {
      try {
        if (typeof runParseRecent === 'function') {
          runParseRecent(ss, 'RawRecentHome_' + i, 'CleanRecentHome_' + i);
        }
      } catch (e) {
        Logger.log('Skipping RecentHome_' + i + ': ' + e.message);
      }

      try {
        if (typeof runParseRecent === 'function') {
          runParseRecent(ss, 'RawRecentAway_' + i, 'CleanRecentAway_' + i);
        }
      } catch (e) {
        Logger.log('Skipping RecentAway_' + i + ': ' + e.message);
      }
    }

    ss.toast('Parse All Recent Complete!', 'Ma Golide', 5);
    Logger.log('===== PARSE ALL RECENT COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runAllRecentParsers: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Parse All Recent Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for historical analyzers from Module 3.
 * WHAT: Runs all historical analysis functions.
 * HOW: Calls runAllHistoricalAnalyzers from Module 3.
 * WHERE: Called from menu or pipeline.
 */
function runHistoricalAnalyzers() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING HISTORICAL ANALYZERS =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Historical Analyzers (Module 3)...', 'Ma Golide', 10);

    if (typeof runAllHistoricalAnalyzers === 'function') {
      runAllHistoricalAnalyzers(ss);
    } else {
      throw new Error('runAllHistoricalAnalyzers function not found in Module 3.');
    }

    ss.toast('Historical Analyzers Complete!', 'Ma Golide', 5);
    Logger.log('===== HISTORICAL ANALYZERS COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runHistoricalAnalyzers: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Historical Analyzers Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 1 forecast from Module 4.
 * WHAT: Runs the Tier 1 prediction pipeline.
 * HOW: Calls analyzeTier1 from Module 4.
 * WHERE: Called from menu or pipeline.
 */
function runTier1_Forecast() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 1 FORECAST =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Tier 1 Forecast (Module 4)...', 'Ma Golide', 10);

    if (typeof analyzeTier1 === 'function') {
      analyzeTier1(ss);
    } else if (typeof runTier1_Forecast_ === 'function') {
      runTier1_Forecast_(ss);
    } else if (typeof tier1Forecast === 'function') {
      tier1Forecast(ss);
    } else {
      throw new Error('Tier 1 Forecast function not found. Ensure Module 4 is loaded.');
    }

    ss.toast('Tier 1 Forecast Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 1 FORECAST COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier1_Forecast: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 1 Forecast Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 2 deep dive - MARGINS ONLY.
 * WHAT: Runs just the margin predictions (not O/U).
 * HOW: Calls predictQuarters_Tier2 from Module 5.
 * WHERE: Called from menu.
 */
function runTier2_DeepDive() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 DEEP DIVE (MARGINS) =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Tier 2 Margin Predictions...', 'Ma Golide', 10);

    if (typeof predictQuarters_Tier2 === 'function') {
      predictQuarters_Tier2(ss);
      ui.alert(
        'Tier 2 Margins Complete',
        'Margin predictions generated in UpcomingClean:\n' +
        '• t2-q1, t2-q2, t2-q3, t2-q4, t2-ft\n\n' +
        'Note: This did NOT run O/U predictions.\n' +
        'Use "Run Both (Margins + O/U)" for complete analysis.',
        ui.ButtonSet.OK
      );
    } else if (typeof runAllTier2DeepDives_MODIFIED === 'function') {
      runAllTier2DeepDives_MODIFIED(ss);
    } else if (typeof runAllTier2DeepDives === 'function') {
      runAllTier2DeepDives();
    } else {
      throw new Error('Tier 2 prediction function not found. Ensure Module 5 is loaded.');
    }

    ss.toast('Tier 2 Margins Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 2 DEEP DIVE (MARGINS) COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier2_DeepDive: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 2 Deep Dive Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 2 deep dive with fixed margins.
 * WHAT: Runs Tier 2 with the nuclear/fixed margin predictions.
 * HOW: Calls the appropriate function from Module 5.
 * WHERE: Called from menu.
 */
function runTier2_DeepDive_Fixed() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 DEEP DIVE (FIXED MARGINS) =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running FIXED Tier 2 (2025 Nuclear Edition)...', 'Ma Golide', 15);

    if (typeof runAllTier2DeepDives === 'function') {
      runAllTier2DeepDives();
    } else {
      throw new Error('runAllTier2DeepDives function not found.');
    }

    ss.toast('Tier 2 FIXED Complete!', 'Ma Golide', 6);
    Logger.log('===== TIER 2 DEEP DIVE (FIXED) COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier2_DeepDive_Fixed: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 2 Deep Dive (Fixed) Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for the Nuclear 2025 Tier 2 mode.
 * WHAT: Runs advanced Tier 2 predictions.
 * HOW: Same as fixed, but branded differently.
 * WHERE: Called from menu.
 */
function runTier2Nuclear() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 NUCLEAR 2025 =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Launching Ma Golide NUCLEAR 2025...', 'Tier 2', 10);

    if (typeof runAllTier2DeepDives === 'function') {
      runAllTier2DeepDives();
    } else {
      throw new Error('runAllTier2DeepDives function not found.');
    }

    ss.toast('NUCLEAR Tier 2 Complete – Predictions UNLOCKED', 'Success', 8);
    Logger.log('===== TIER 2 NUCLEAR 2025 COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier2Nuclear: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 2 Nuclear Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 2 margin predictions only.
 * WHAT: Runs just the Q1-Q4 + FT margin predictions.
 * HOW: Calls predictQuarters_Tier2 from Module 5.
 * WHERE: Called from menu.
 */
function runTier2MarginOnly() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 MARGIN ONLY =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Tier 2 Margin Predictions (Q1-Q4 + FT)...', 'Ma Golide', 10);

    if (typeof predictQuarters_Tier2 === 'function') {
      predictQuarters_Tier2(ss);
    } else {
      throw new Error('predictQuarters_Tier2 function not found.');
    }

    ss.toast('Margin Predictions Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 2 MARGIN ONLY COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier2MarginOnly: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 2 Margin Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 1 Forensics analysis.
 * WHAT: Runs forensic analysis on Tier 1 predictions.
 * HOW: Calls the forensics function from its module.
 * WHERE: Called from menu.
 */
function runTier1Forensics() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 1 FORENSICS =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Tier 1 Forensics...', 'Ma Golide', 10);

    if (typeof runTier1Forensics_ === 'function') {
      runTier1Forensics_(ss);
    } else if (typeof tier1Forensics === 'function') {
      tier1Forensics(ss);
    } else if (typeof analyzeTier1Forensics === 'function') {
      analyzeTier1Forensics(ss);
    } else {
      throw new Error('Tier 1 Forensics function not found.');
    }

    ss.toast('Tier 1 Forensics Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 1 FORENSICS COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier1Forensics: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 1 Forensics Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for experimental Tier 1 config simulation.
 * WHAT: Tests different Tier 1 configurations.
 * HOW: Calls the simulation function.
 * WHERE: Called from menu.
 */
function simulateTier1Configs() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 1 CONFIG SIMULATION =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Tier 1 Config Simulation (Experimental)...', 'Ma Golide', 15);

    if (typeof simulateTier1Configs_ === 'function') {
      simulateTier1Configs_(ss);
    } else if (typeof runTier1Simulation === 'function') {
      runTier1Simulation(ss);
    } else if (typeof tier1ConfigSimulation === 'function') {
      tier1ConfigSimulation(ss);
    } else {
      throw new Error('Tier 1 Config Simulation function not found.');
    }

    ss.toast('Tier 1 Config Simulation Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 1 CONFIG SIMULATION COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in simulateTier1Configs: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 1 Config Simulation Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for League Weights tuning.
 * WHAT: Runs the Tier 1 league weights optimization.
 * HOW: Calls the tuning function.
 * WHERE: Called from menu.
 */
function tuneLeagueWeightsWrapper() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING LEAGUE WEIGHTS TUNING =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Tuning League Weights...', 'Ma Golide', 10);

    if (typeof tuneLeagueWeights_ === 'function') {
      tuneLeagueWeights_(ss);
    } else if (typeof tuneLeagueWeights === 'function') {
      tuneLeagueWeights(ss);
    } else if (typeof runLeagueWeightsTuning === 'function') {
      runLeagueWeightsTuning(ss);
    } else {
      throw new Error('League Weights tuning function not found.');
    }

    ss.toast('League Weights Tuning Complete!', 'Ma Golide', 5);
    Logger.log('===== LEAGUE WEIGHTS TUNING COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in tuneLeagueWeightsWrapper: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('League Weights Tuning Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 2 Config Optimization.
 * WHAT: Runs the Tier 2 config optimization process.
 * HOW: Calls the optimization function from Module 5.
 * WHERE: Called from menu.
 */
function runTier2ConfigOptimization() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 CONFIG OPTIMIZATION =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Optimizing Tier 2 Config...', 'Ma Golide', 10);

    if (typeof tuneTier2ConfigWrapper === 'function') {
      tuneTier2ConfigWrapper();
    } else if (typeof tuneTier2Config === 'function') {
      tuneTier2Config(ss);
    } else if (typeof runTier2ConfigOptimization_ === 'function') {
      runTier2ConfigOptimization_(ss);
    } else if (typeof optimizeTier2Config === 'function') {
      optimizeTier2Config(ss);
    } else {
      throw new Error('Tier 2 Config Optimization function not found.');
    }

    ss.toast('Tier 2 Config Optimization Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 2 CONFIG OPTIMIZATION COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runTier2ConfigOptimization: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 2 Config Optimization Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * WHY: Display current tuned configuration to user.
 * WHAT: Shows a scrollable dialog with ALL current Tier 2 config values.
 * HOW: Calls loadTier2Config and dynamically formats every key for display.
 * WHERE: Called from menu.
 */
function showCurrentConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  let config = {};

  // Try to load config using SSoT loader
  try {
    if (typeof loadTier2Config === 'function') {
      config = loadTier2Config(ss);
    } else if (typeof getTunedConfig_ === 'function') {
      config = getTunedConfig_(ss);
    }
  } catch (e) {
    ui.alert('❌ Config Load Error', 'Failed to load config:\n' + e.message, ui.ButtonSet.OK);
    return;
  }

  const keys = Object.keys(config);
  Logger.log('[showCurrentConfig] Config has ' + keys.length + ' keys: ' + keys.join(', '));

  if (keys.length === 0) {
    ui.alert('⚠️ Empty Config', 'loadTier2Config returned 0 keys.\nCheck that Config_Tier2 sheet exists and has data.', ui.ButtonSet.OK);
    return;
  }

  // ── Section grouping ──────────────────────────────────────────────
  const sections = [
    {
      title: '🆕 NEW FRIENDS',
      keys: [
        'forebet_blend_enabled', 'forebet_ou_weight_qtr', 'forebet_ou_weight_ft',
        'highest_q_tie_policy', 'highest_q_tie_conf_penalty'
      ]
    },
    {
      title: '📊 CORE PARAMS',
      keys: ['threshold', 'momentum_swing_factor', 'variance_penalty_factor', 'decay', 'h2h_boost']
    },
    {
      title: '🔄 FLIP PATTERNS',
      keys: ['q1_flip', 'q2_flip', 'q3_flip', 'q4_flip']
    },
    {
      title: '🏆 ELITE PARAMS',
      keys: ['strong_target', 'medium_target', 'even_target', 'confidence_scale']
    },
    {
      title: '📈 O/U PARAMS',
      keys: [
        'ou_edge_threshold', 'ou_min_samples', 'ou_min_ev', 'ou_confidence_scale',
        'ou_shrink_k', 'ou_sigma_floor', 'ou_sigma_scale', 'ou_american_odds',
        'ou_model_error', 'ou_prob_temp', 'ou_use_effn',
        'ou_confidence_shrink_min', 'ou_confidence_shrink_max', 'debug_ou_logging'
      ]
    },
    {
      title: '🎯 HQ PARAMS',
      keys: [
        'hq_enabled', 'hq_min_confidence', 'hq_skip_ties', 'hq_min_pwin',
        'tieMargin', 'hq_softmax_temperature', 'hq_shrink_k',
        'hq_vol_weight', 'hq_fb_weight', 'hq_exempt_from_cap', 'hq_max_picks_per_slip'
      ]
    },
    {
      title: '📉 METRICS',
      keys: [
        'Weighted Score %', 'Side Accuracy %', 'Coverage %', 'Overall Accuracy %',
        'Side Predictions', 'EVEN Predictions', 'Training Size'
      ]
    },
    {
      title: 'ℹ️ INFO',
      keys: ['config_version', 'last_updated', 'updated_by']
    }
  ];

  // ── Build HTML ────────────────────────────────────────────────────
  const tracked = {};
  let rows = '';

  sections.forEach(function(section) {
    rows += '<tr class="section-header"><td colspan="2">' + section.title + '</td></tr>';
    section.keys.forEach(function(key) {
      const val = config[key];
      const display = (val !== undefined && val !== null && val !== '') ? String(val) : '—';
      rows += '<tr><td class="key">' + escHtml_(key) + '</td><td class="val">' + escHtml_(display) + '</td></tr>';
      tracked[key] = true;
    });
  });

  // ── Catch-all: any keys NOT in a section above ────────────────────
  const extras = keys.filter(function(k) { return !tracked[k]; });
  if (extras.length > 0) {
    rows += '<tr class="section-header"><td colspan="2">🔍 OTHER / UNMAPPED</td></tr>';
    extras.forEach(function(key) {
      const val = config[key];
      const display = (val !== undefined && val !== null && val !== '') ? String(val) : '—';
      rows += '<tr><td class="key">' + escHtml_(key) + '</td><td class="val">' + escHtml_(display) + '</td></tr>';
    });
  }

  const html = `
    <style>
      body { font-family: 'Google Sans', Arial, sans-serif; margin: 0; padding: 12px; background: #1e1e1e; color: #e0e0e0; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .section-header td {
        font-weight: bold; font-size: 14px; padding: 12px 6px 4px 6px;
        color: #4fc3f7; border-bottom: 2px solid #4fc3f7;
      }
      tr:nth-child(even) { background: #2a2a2a; }
      td.key { padding: 4px 8px; color: #aaa; width: 55%; }
      td.val { padding: 4px 8px; color: #fff; font-weight: 500; text-align: right; }
      .footer { margin-top: 16px; padding: 10px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #444; }
      .count-badge {
        display: inline-block; background: #4fc3f7; color: #1e1e1e;
        padding: 2px 10px; border-radius: 12px; font-weight: bold; font-size: 12px;
      }
    </style>
    <div>
      <div style="text-align:center;margin-bottom:8px;">
        <span class="count-badge">${keys.length} settings loaded</span>
      </div>
      <table>${rows}</table>
      <div class="footer">
        Run <b>"Optimize Tier 2 Config"</b> to generate new proposals.
      </div>
    </div>
  `;

  const output = HtmlService
    .createHtmlOutput(html)
    .setWidth(520)
    .setHeight(750);

  ui.showModalDialog(output, '⚙️ Ma Golide Config');
}

/** Escape HTML special chars to prevent rendering issues */
function escHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/**
 * WHY: Wrapper for clearing margin cache.
 * WHAT: Clears any cached margin data.
 * HOW: Calls the cache clear function.
 * WHERE: Called from menu.
 */
function clearMarginCache() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== CLEARING MARGIN CACHE =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Clearing Margin Cache...', 'Ma Golide', 5);

    if (typeof clearMarginCache_ === 'function') {
      clearMarginCache_(ss);
    } else if (typeof clearTier2Cache === 'function') {
      clearTier2Cache(ss);
    } else {
      // Manual cache clear - delete cache sheet if exists
      const cacheSheet = ss.getSheetByName('MarginCache');
      if (cacheSheet) {
        cacheSheet.clear();
        Logger.log('MarginCache sheet cleared.');
      }
    }

    ss.toast('Margin Cache Cleared!', 'Ma Golide', 5);
    Logger.log('===== MARGIN CACHE CLEARED =====');

  } catch (e) {
    Logger.log('!!! ERROR in clearMarginCache: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Clear Margin Cache Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for the Accuracy Report from Module 3.
 * WHAT: Generates the accuracy report.
 * HOW: Calls generateAccuracyReport from Module 3.
 * WHERE: Called from menu.
 */
function runAccuracyReportWrapper() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING ACCURACY REPORT =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Generating Accuracy Report...', 'Ma Golide', 10);

    if (typeof generateAccuracyReport === 'function') {
      generateAccuracyReport(ss);
    } else {
      throw new Error('generateAccuracyReport function not found in Module 3.');
    }

    ss.toast('Accuracy Report Complete!', 'Ma Golide', 5);
    Logger.log('===== ACCURACY REPORT COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runAccuracyReportWrapper: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Accuracy Report Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for Tier 2 Accuracy Report.
 * WHAT: Generates Tier 2 specific accuracy report.
 * HOW: Calls buildTier2AccuracyReport from Module 5.
 * WHERE: Called from menu.
 */
function generateTier2AccuracyReport_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING TIER 2 ACCURACY REPORT =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Generating Tier 2 Accuracy Report...', 'Ma Golide', 10);

    if (typeof buildTier2AccuracyReport === 'function') {
      buildTier2AccuracyReport(ss);
    } else {
      throw new Error('buildTier2AccuracyReport function not found in Module 5.');
    }

    ss.toast('Tier 2 Accuracy Report Complete!', 'Ma Golide', 5);
    Logger.log('===== TIER 2 ACCURACY REPORT COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in generateTier2AccuracyReport_: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 2 Accuracy Report Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


/**
 * WHY: Wrapper for building accumulators (Module 7).
 * WHAT: Generates bet slips from predictions.
 * HOW: Calls buildAccumulator from Module 7.
 * WHERE: Called from menu or pipeline.
 */
function runAccumulator() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== STARTING ACCA COOKER (MODULE 7) =====');

  try {
    if (!ss) throw new Error('Spreadsheet object not available.');
    ss.toast('Running Acca Cooker (Module 7)...', 'Ma Golide', 10);

    if (typeof buildAccumulator === 'function') {
      buildAccumulator(ss);
    } else if (typeof runAccaCooker === 'function') {
      runAccaCooker(ss);
    } else if (typeof cookAcca === 'function') {
      cookAcca(ss);
    } else {
      throw new Error('Accumulator function not found. Ensure Module 7 is loaded.');
    }

    ss.toast('Acca Cooker Complete!', 'Ma Golide', 5);
    Logger.log('===== ACCA COOKER COMPLETE =====');

  } catch (e) {
    Logger.log('!!! ERROR in runAccumulator: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Acca Cooker Error', 'An error occurred: ' + e.message, ui.ButtonSet.OK);
  }
}


// =====================================================================
// CONSOLIDATED PUBLIC WRAPPERS (Remove duplicates - keep only these)
// =====================================================================

/**
 * WHY: Single entry point for Tier 2 O/U predictions.
 * WHAT: Runs the O/U prediction pipeline for all quarters.
 * WHERE: Called from menu.
 */
function runTier2OU() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    ss.toast('Running O/U Predictions...', 'Ma Golide', 10);
    return predictQuarters_Tier2_OU(ss);
  } catch (e) {
    Logger.log('runTier2OU ERROR: ' + e.message + '\n' + e.stack);
    SpreadsheetApp.getUi().alert('Error', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}



/**
 * WHY: Wrapper for O/U Accuracy Report generation.
 * WHAT: Generates accuracy report for Over/Under predictions.
 * HOW: Calls buildOUAccuracyReport from Module 5.
 * WHERE: Called from menu.
 */
function runOUAccuracyReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    ss.toast('Generating O/U Accuracy Report...', 'Ma Golide', 10);
    buildOUAccuracyReport(ss);
  } catch (e) {
    Logger.log('runOUAccuracyReport: ' + e.message);
    SpreadsheetApp.getUi().alert('Error', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}



// ═══════════════════════════════════════════════════════════════════════════
// HQ_System_Fixes.gs
// 
// Phase 0: Runners, gating helpers, tie handling, diagnostics
// Phase 1: Sheet creation, history builder
// Phase 2: Probability functions (softmax, shrinkage)
// Phase 4: Backtest
// Phase 6: Diagnostics + status
//
// All functions at global scope. No IIFE. No magic numbers.
// ═══════════════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────────────
// PHASE 0: RUNNER FUNCTIONS (missing from audit)
// ───────────────────────────────────────────────────────────────────────────

function runTier2Complete() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ss.toast('1/3: Tier 2 Margins...', 'Ma Golide', 10);
  try {
    runTier2_DeepDive();
  } catch (e) {
    Logger.log('[runTier2Complete] Margins error: ' + (e && e.message ? e.message : e));
  }

  ss.toast('2/3: Tier 2 O/U...', 'Ma Golide', 10);
  try {
    runTier2OU();
  } catch (e2) {
    Logger.log('[runTier2Complete] O/U error: ' + (e2 && e2.message ? e2.message : e2));
  }

  ss.toast('3/3: Enhancements (HQ + 1H)...', 'Ma Golide', 10);
  try {
    processEnhancements(ss);
  } catch (e3) {
    Logger.log('[runTier2Complete] Enhancements error: ' + (e3 && e3.message ? e3.message : e3));
  }

  ss.toast('Tier 2 Complete pipeline finished.', 'Ma Golide', 5);
}

function runOUThenEnhancements() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Step 1/2: O/U predictions...', 'Ma Golide', 10);
  try { runTier2OU(); } catch(e) {
    Logger.log('[runOUThenEnhancements] O/U error: ' + e.message);
  }
  ss.toast('Step 2/2: Enhancements (HQ + 1H)...', 'Ma Golide', 10);
  try { runAllEnhancements(); } catch(e) {
    Logger.log('[runOUThenEnhancements] Enhancement error: ' + e.message);
  }
  ss.toast('O/U + Enhancements complete.', 'Ma Golide', 5);
}




function runHQAccuracyReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = ss.getSheetByName('HQ_Backtest_Report');
  if (!dataSheet || dataSheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert(
      'No backtest data yet.\n\nRun:\n1. Build HQ History\n2. Backtest HQ Model'
    );
    return;
  }
  SpreadsheetApp.getUi().alert('HQ accuracy data is in the HQ_Backtest_Report sheet.');
}

function runEnhancementDiagnostic() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var uc = ss.getSheetByName('UpcomingClean');
  if (!uc || uc.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('UpcomingClean has no data.');
    return;
  }
  var headers = uc.getRange(1, 1, 1, uc.getLastColumn()).getValues()[0];
  var enhCols = [];
  for (var i = 0; i < headers.length; i++) {
    if (/^enh-/i.test(String(headers[i]))) enhCols.push(String(headers[i]));
  }
  SpreadsheetApp.getUi().alert(
    'Enhancement Columns in UpcomingClean:\n\n' +
    (enhCols.length > 0 ? enhCols.join('\n') : 'NONE — run Enhancements first') +
    '\n\nTotal columns: ' + headers.length +
    '\nData rows: ' + (uc.getLastRow() - 1)
  );
}

function createTier2ConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existing = ss.getSheetByName('Config_Tier2');
  if (existing) {
    SpreadsheetApp.getUi().alert('Config_Tier2 already exists with ' + existing.getLastRow() + ' rows.');
    return;
  }
  var sh = ss.insertSheet('Config_Tier2');
  sh.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
  sh.setFrozenRows(1);
  SpreadsheetApp.getUi().alert('Config_Tier2 created. Add config keys manually.');
}

/**
 * UPGRADED HQ GATE: Multiclass-Sharpness + Reliability – Accumulator-aware
 *
 * Works with the flat HQ object the Accumulator passes AND
 * can fall back to UpcomingClean's enh-high-q-* columns when needed.
 *
 * PASS CONDITIONS:
 *   - If hq_enabled = false → FAIL
 *   - If hq_skip_ties = true and wasTie = true → FAIL
 *   - PASS if pWin >= 0.40
 *   - OR PASS if (confidence >= 58 AND reliability >= 0.80)
 *
 * Returns: { pass:Boolean, reason:String }
 */
function hq_gateCheck_(hqRes, config) {
  if (!hqRes) return { pass: false, reason: 'null HQ result' };

  // ───────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────
  function toNum_(v, d) {
    if (v === null || v === undefined || v === '') return d;
    var s = String(v).replace('%', '').trim();
    // remove non-numeric except dot and minus
    s = s.replace(/[^\d.-]/g, '');
    var n = Number(s);
    return isFinite(n) ? n : d;
  }

  function clamp01_(x) {
    x = Number(x);
    if (!isFinite(x)) return 0;
    // handle percent-like values
    if (x > 1 && x <= 100) x = x / 100;
    return Math.max(0, Math.min(1, x));
  }

  function getCfgBool_(keys, fallback) {
    if (!config) return fallback;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = config[k];
      if (v === undefined || v === null || v === '') continue;

      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;

      var s = String(v).toLowerCase().trim();
      if (s === 'true' || s === 'yes' || s === '1' || s === 'on') return true;
      if (s === 'false' || s === 'no' || s === '0' || s === 'off') return false;
    }
    return fallback;
  }

  function getCfgNum_(keys, fallback) {
    if (!config) return fallback;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = config[k];
      if (v === undefined || v === null || v === '') continue;
      var n = toNum_(v, NaN);
      if (isFinite(n)) return n;
    }
    return fallback;
  }

  function pickFirst_(obj, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return fallback;
  }

  // ───────────────────────────────────────────────
  // 1) Config checks (enabled + skip ties)
  // ───────────────────────────────────────────────
  var enabled = getCfgBool_(['hq_enabled', 'hqEnabled', 'includeHighestQuarter'], true);
  if (!enabled) return { pass: false, reason: 'hq_enabled=false' };

  var skipTies = getCfgBool_(['hq_skip_ties', 'hqSkipTies'], true);
  var isTie = !!hqRes.wasTie;
  if (skipTies && isTie) return { pass: false, reason: 'Tie skipped (hq_skip_ties=true)' };

  // ───────────────────────────────────────────────
  // 2) Extract metrics (patched for stripped headers)
  // ───────────────────────────────────────────────
  // confidence may be on: confidence/conf/enhConfidence/enh_high_q_conf/enhhighqconf/...
  var confRaw = pickFirst_(hqRes, [
    'confidence', 'conf',
    'enhConfidence', 'enh_confidence',
    'enhHighQConf', 'enh_high_q_conf', 'enh-high-q-conf', 'enhhighqconf',
    'hqConfidence', 'hq_confidence'
  ], 0);
  var conf = toNum_(confRaw, 0);

  // pWin may be on: pWin/enhPWin/enh_high_q_pwin/enhhighqpwin/...
  var pWinRaw = pickFirst_(hqRes, [
    'pWin', 'pwin',
    'enhPWin', 'enh_pwin',
    'enhHighQPWin', 'enh_high_q_pwin', 'enh-high-q-pwin', 'enhhighqpwin'
  ], NaN);
  var pWin = clamp01_(toNum_(pWinRaw, NaN));
  if (!isFinite(pWin)) pWin = 0;

  // reliability may be on: reliability/enhHighQReliability/enhhighqreliability/...
  var relRaw = pickFirst_(hqRes, [
    'reliability', 'reliab',
    'enhReliability', 'enh_reliability',
    'enhHighQReliability', 'enh_high_q_reliability', 'enh-high-q-reliability', 'enhhighqreliability'
  ], NaN);
  var rel = clamp01_(toNum_(relRaw, NaN));
  if (!isFinite(rel)) rel = 0;

  // ───────────────────────────────────────────────
  // 3) Gate thresholds (wired to config)
  // ───────────────────────────────────────────────
  var minPWin = getCfgNum_(['hq_min_pwin', 'hqMinPWin'], 0.35);
  var minConf = getCfgNum_(['hq_min_confidence', 'hqMinConfidence'], 55);
  // reliability threshold kept as a stable "trust" floor; can be made configurable later
  var minRel = getCfgNum_(['hq_min_reliability', 'hqMinReliability'], 0.80);

  // A) Separation strong enough
  if (pWin >= minPWin) {
    return { pass: true, reason: 'High pWin (' + pWin.toFixed(4) + ' >= ' + minPWin + ')' };
  }

  // B) Backup path: confident + reliable even if separation modest
  if (conf >= minConf && rel >= minRel) {
    return { pass: true, reason: 'Conf ' + conf + ' >= ' + minConf + ' + Rel ' + rel.toFixed(2) + ' >= ' + minRel };
  }

  // Reject
  return {
    pass: false,
    reason: 'Failed Smart Gate (pWin: ' + pWin.toFixed(3) + ' < ' + minPWin +
            ', conf: ' + conf + ' < ' + minConf +
            ', rel: ' + rel.toFixed(2) + ' < ' + minRel + ')'
  };
}


/** Read a boolean config value from multiple possible key names. Returns true/false/null. */
function _hq_getConfigBool_(cfg, keys) {
  if (!cfg) return null;
  for (var i = 0; i < keys.length; i++) {
    var v = cfg[keys[i]];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      var s = v.toLowerCase().trim();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no') return false;
    }
    if (typeof v === 'number') return v !== 0;
  }
  return null;
}

/** Read a numeric config value from multiple possible key names. Returns number/null. */
function _hq_getConfigNum_(cfg, keys) {
  if (!cfg) return null;
  for (var i = 0; i < keys.length; i++) {
    var v = cfg[keys[i]];
    if (v === undefined || v === null || v === '') continue;
    var n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}


// ───────────────────────────────────────────────────────────────────────────
// PHASE 1: SHEET CREATION
// ───────────────────────────────────────────────────────────────────────────

function runCreateHQSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var created = [];
  
  var schemas = {
    'HQ_Backtest_Data': [
      'League','DateISO','Home','Away',
      'Q1_Total','Q2_Total','Q3_Total','Q4_Total',
      'HighestQ_Actual','WasTie_Actual','TieQuarters_Actual',
      'SourceSheet','SourceRow'
    ],
    'HQ_Prediction_Log': [
      'TimestampISO','RunId','League','Home','Away',
      'HQ_Pick','HQ_Conf','HQ_PWin','HQ_Skip','HQ_Reason',
      'ProfileSource','Reliability','OUBridged','ConfigVersion'
    ],
    'HQ_Accuracy': [
      'ConfBucket','Games','Correct','Accuracy','VsRandom','AvgConf'
    ],
    'HQ_Backtest_Report': [
      'RunId','RunDateISO','Games','Correct','Accuracy',
      'TieRate','Brier','ConfigVersion','Notes'
    ],
    'Config_HighestQ_Proposals': [
      'ProposalId','CreatedAtISO','ParamJson',
      'FromISO','ToISO','Games','Accuracy','Brier','AvgEV','Notes'
    ]
  };
  
  for (var name in schemas) {
    if (!schemas.hasOwnProperty(name)) continue;
    if (ss.getSheetByName(name)) {
      Logger.log('[HQ Sheets] ' + name + ' already exists');
      continue;
    }
    var sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, schemas[name].length).setValues([schemas[name]]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, schemas[name].length).setFontWeight('bold');
    created.push(name);
  }
  
  SpreadsheetApp.getUi().alert(
    created.length > 0
      ? 'Created ' + created.length + ' sheets:\n• ' + created.join('\n• ')
      : 'All HQ sheets already exist.'
  );
}


// ───────────────────────────────────────────────────────────────────────────
// PHASE 1: HISTORY BUILDER
// ───────────────────────────────────────────────────────────────────────────

function buildHighestQuarterHistory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var outSheet = ss.getSheetByName('HQ_Backtest_Data');
  if (!outSheet) throw new Error('Run "Create HQ Sheets" first');
  
  if (outSheet.getLastRow() > 1) {
    outSheet.getRange(2, 1, outSheet.getLastRow() - 1, outSheet.getLastColumn()).clearContent();
  }
  
  var allSheets = ss.getSheets();
  var rows = [];
  var sheetsScanned = 0;
  
  for (var si = 0; si < allSheets.length; si++) {
    var sheet = allSheets[si];
    var name = sheet.getName();
    if (!/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_|ResultsClean)/i.test(name)) continue;
    if (sheet.getLastRow() < 2) continue;
    sheetsScanned++;
    
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var hmap = {};
    for (var h = 0; h < headers.length; h++) {
      hmap[String(headers[h]).toLowerCase().trim().replace(/[\s_]+/g, '')] = h;
    }
    
    var find = function(names) {
      for (var n = 0; n < names.length; n++) {
        var k = names[n].toLowerCase().replace(/[\s_]+/g, '');
        if (hmap[k] !== undefined) return hmap[k];
      }
      return -1;
    };
    
    var cHome = find(['home','hometeam']);
    var cAway = find(['away','awayteam']);
    var cQ1H = find(['q1h','q1home','homeq1']);
    var cQ1A = find(['q1a','q1away','awayq1']);
    var cQ2H = find(['q2h','q2home','homeq2']);
    var cQ2A = find(['q2a','q2away','awayq2']);
    var cQ3H = find(['q3h','q3home','homeq3']);
    var cQ3A = find(['q3a','q3away','awayq3']);
    var cQ4H = find(['q4h','q4home','homeq4']);
    var cQ4A = find(['q4a','q4away','awayq4']);
    var cDate = find(['date','gamedate','matchdate']);
    var cLeague = find(['league','competition','comp']);
    
    if (cHome < 0 || cAway < 0) continue;
    if (cQ1H < 0 || cQ1A < 0 || cQ2H < 0 || cQ2A < 0 ||
        cQ3H < 0 || cQ3A < 0 || cQ4H < 0 || cQ4A < 0) continue;
    
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var home = String(row[cHome] || '').trim();
      var away = String(row[cAway] || '').trim();
      if (!home || !away) continue;
      
      var q1 = parseFloat(row[cQ1H]) + parseFloat(row[cQ1A]);
      var q2 = parseFloat(row[cQ2H]) + parseFloat(row[cQ2A]);
      var q3 = parseFloat(row[cQ3H]) + parseFloat(row[cQ3A]);
      var q4 = parseFloat(row[cQ4H]) + parseFloat(row[cQ4A]);
      
      if (!isFinite(q1) || !isFinite(q2) || !isFinite(q3) || !isFinite(q4)) continue;
      
      var max = Math.max(q1, q2, q3, q4);
      var winners = [];
      if (q1 === max) winners.push('Q1');
      if (q2 === max) winners.push('Q2');
      if (q3 === max) winners.push('Q3');
      if (q4 === max) winners.push('Q4');
      
      var league = cLeague >= 0 ? String(row[cLeague] || '').trim() : '';
      var dt = cDate >= 0 ? row[cDate] : '';
      var iso = (dt instanceof Date && !isNaN(dt)) ? dt.toISOString().slice(0,10) : String(dt || '');
      
      rows.push([
        league, iso, home, away, q1, q2, q3, q4,
        winners[0],
        winners.length > 1 ? 'TRUE' : 'FALSE',
        winners.length > 1 ? winners.join(',') : '',
        name, r + 1
      ]);
    }
  }
  
  if (rows.length > 0) {
    outSheet.getRange(2, 1, rows.length, 13).setValues(rows);
  }
  
  Logger.log('[buildHQHistory] Scanned ' + sheetsScanned + ' sheets, wrote ' + rows.length + ' rows');
  return { ok: true, rows: rows.length, sheets: sheetsScanned };
}

function runBuildHQHistory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Building HQ history from Clean sheets...', 'Ma Golide', 15);
  try {
    var result = buildHighestQuarterHistory();
    ss.toast('Done: ' + result.rows + ' games from ' + result.sheets + ' sheets', 'Ma Golide', 5);
  } catch(e) {
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}


// ───────────────────────────────────────────────────────────────────────────
// PHASE 2: PROBABILITY FUNCTIONS
// ───────────────────────────────────────────────────────────────────────────

/**
 * Softmax: raw quarter scores → probability distribution.
 * Temperature MUST come from config. No default.
 */
function hq_softmax_(scores, temperature) {
  if (!temperature || !isFinite(temperature) || temperature <= 0) {
    return { valid: false, reason: 'hq_softmax_temperature required in config' };
  }
  var keys = ['Q1','Q2','Q3','Q4'];
  var maxS = -Infinity;
  for (var i = 0; i < keys.length; i++) {
    if (!isFinite(scores[keys[i]])) return { valid: false, reason: 'missing score for ' + keys[i] };
    if (scores[keys[i]] > maxS) maxS = scores[keys[i]];
  }
  var exps = {}, expSum = 0;
  for (var j = 0; j < keys.length; j++) {
    exps[keys[j]] = Math.exp((scores[keys[j]] - maxS) / temperature);
    expSum += exps[keys[j]];
  }
  var probs = {};
  for (var k = 0; k < keys.length; k++) {
    probs[keys[k]] = exps[keys[k]] / expSum;
  }
  return { valid: true, probs: probs };
}

/**
 * Bayesian shrinkage toward league base rates.
 * k MUST come from config. No default.
 */
function hq_shrinkEstimate_(modelProbs, priorProbs, k) {
  if (!isFinite(k) || k < 0) return { valid: false, reason: 'hq_shrink_k required in config' };
  var keys = ['Q1','Q2','Q3','Q4'];
  var result = {}, sum = 0;
  for (var i = 0; i < keys.length; i++) {
    var q = keys[i];
    result[q] = ((modelProbs[q] || 0.25) + (priorProbs[q] || 0.25) * k) / (1 + k);
    sum += result[q];
  }
  for (var j = 0; j < keys.length; j++) result[keys[j]] /= sum;
  return { valid: true, probs: result };
}

/**
 * Full pipeline: scores → softmax → optional shrinkage → dominant quarter.
 */
function hq_computeQuarterProbs_(quarterScores, leaguePrior, cfg) {
  var temp = _hq_getConfigNum_(cfg, ['hq_softmax_temperature', 'hqSoftmaxTemperature']);
  var sm = hq_softmax_(quarterScores, temp);
  if (!sm.valid) return sm;
  
  var final = sm.probs;
  var shrinkK = _hq_getConfigNum_(cfg, ['hq_shrink_k', 'hqShrinkK']);
  if (leaguePrior && shrinkK !== null) {
    var sh = hq_shrinkEstimate_(sm.probs, leaguePrior, shrinkK);
    if (sh.valid) final = sh.probs;
  }
  
  var keys = ['Q1','Q2','Q3','Q4'];
  var maxP = 0, domQ = 'Q1';
  for (var i = 0; i < keys.length; i++) {
    if (final[keys[i]] > maxP) { maxP = final[keys[i]]; domQ = keys[i]; }
  }
  
  return {
    valid: true,
    pQ1: final.Q1, pQ2: final.Q2, pQ3: final.Q3, pQ4: final.Q4,
    pWin: maxP, dominantQ: domQ, dominantStrength: maxP - 0.25
  };
}

/**
 * EV computation. Only runs when real odds exist.
 */
function hq_computeEV_(modelPWin, decimalOdds) {
  if (!isFinite(modelPWin) || !isFinite(decimalOdds) || decimalOdds <= 1) {
    return { valid: false, reason: 'invalid inputs' };
  }
  return {
    valid: true,
    ev: (modelPWin * (decimalOdds - 1)) - (1 - modelPWin),
    edge: modelPWin - (1 / decimalOdds),
    implied: 1 / decimalOdds
  };
}


// ───────────────────────────────────────────────────────────────────────────
// PHASE 4: BACKTEST
// ───────────────────────────────────────────────────────────────────────────

function backtestHighestQuarter(ss, overrideCfg) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = ss.getSheetByName('HQ_Backtest_Data');
  if (!dataSheet || dataSheet.getLastRow() < 2) {
    throw new Error('HQ_Backtest_Data empty — run Build HQ History first');
  }
  
  var data = dataSheet.getDataRange().getValues();
  var headers = data[0];
  var hmap = {};
  for (var h = 0; h < headers.length; h++) {
    hmap[String(headers[h]).toLowerCase().trim().replace(/[\s_]+/g, '')] = h;
  }
  
  var cHome = hmap['home'];
  var cAway = hmap['away'];
  var cLeague = hmap['league'];
  // Try multiple normalized forms for the column name
  var cActual = hmap['highestqactual'];
  if (cActual === undefined) cActual = hmap['highestq_actual'];
  var cWasTie = hmap['wastieactual'];
  if (cWasTie === undefined) cWasTie = hmap['wastie_actual'];
  
  if (cHome === undefined || cAway === undefined || cActual === undefined) {
    throw new Error('HQ_Backtest_Data missing required columns (home/away/highestq_actual)');
  }
  
  var marginStats = {};
  try { if (typeof loadTier2MarginStats === 'function') marginStats = loadTier2MarginStats(ss) || {}; }
  catch(e) { Logger.log('[backtest] marginStats load error: ' + e.message); }
  
  var cfg = overrideCfg || {};
  if (!overrideCfg) {
    try { if (typeof loadTier2Config === 'function') cfg = loadTier2Config(ss) || {}; }
    catch(e) {}
  }
  
  var correct = 0, total = 0, skipped = 0, ties = 0;
  var buckets = {};
  var brierInputs = [];
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var actual = String(row[cActual] || '').trim();
    if (!actual || actual === 'N/A') continue;
    
    var game = {
      home: String(row[cHome] || '').trim(),
      away: String(row[cAway] || '').trim(),
      league: cLeague !== undefined ? String(row[cLeague] || '').trim() : ''
    };
    if (!game.home || !game.away) continue;
    
    var hq;
    try {
      hq = predictHighestQuarterEnhanced(game, marginStats, cfg);
    } catch(e) { skipped++; continue; }
    
    if (!hq || hq.skip || !hq.quarter || hq.quarter === 'N/A' || hq.quarter === 'SKIP') {
      skipped++;
      continue;
    }
    
    total++;
    var isCorrect = (hq.quarter === actual);
    if (isCorrect) correct++;
    if (hq.wasTie) ties++;
    
    var bucket = Math.floor((hq.confidence || 0) / 5) * 5;
    var bKey = bucket + '-' + (bucket + 5);
    if (!buckets[bKey]) buckets[bKey] = { games: 0, correct: 0, sumConf: 0 };
    buckets[bKey].games++;
    if (isCorrect) buckets[bKey].correct++;
    buckets[bKey].sumConf += (hq.confidence || 0);
    
    if (isFinite(hq.pQ1)) {
      brierInputs.push({ pQ1:hq.pQ1, pQ2:hq.pQ2, pQ3:hq.pQ3, pQ4:hq.pQ4, actual:actual });
    }
  }
  
  var accuracy = total > 0 ? (correct / total * 100) : 0;
  var tieRate = total > 0 ? (ties / total * 100) : 0;
  
  // Brier score
  var brier = NaN;
  if (brierInputs.length > 0) {
    var brierSum = 0;
    var quarters = ['Q1','Q2','Q3','Q4'];
    for (var b = 0; b < brierInputs.length; b++) {
      for (var q = 0; q < 4; q++) {
        var prob = brierInputs[b]['p' + quarters[q]] || 0.25;
        var act = (brierInputs[b].actual === quarters[q]) ? 1 : 0;
        brierSum += Math.pow(prob - act, 2);
      }
    }
    brier = brierSum / brierInputs.length;
  }
  
  Logger.log('═══ HQ BACKTEST ═══');
  Logger.log('Games: ' + total + ' | Skipped: ' + skipped);
  Logger.log('Correct: ' + correct + '/' + total + ' = ' + accuracy.toFixed(1) + '%');
  Logger.log('Tie rate: ' + tieRate.toFixed(1) + '% | Brier: ' +
    (isFinite(brier) ? brier.toFixed(4) : 'N/A') + ' (random=0.75)');
  
  for (var bk in buckets) {
    if (!buckets.hasOwnProperty(bk)) continue;
    var bv = buckets[bk];
    Logger.log('  ' + bk + '%: ' + bv.correct + '/' + bv.games + ' = ' +
      (bv.games > 0 ? (bv.correct/bv.games*100).toFixed(1) : 0) + '%');
  }
  
  // Write to report sheet
  var reportSheet = ss.getSheetByName('HQ_Backtest_Report');
  if (reportSheet) {
    reportSheet.appendRow([
      Utilities.getUuid().slice(0,8), new Date().toISOString(),
      total, correct, accuracy.toFixed(1), tieRate.toFixed(1),
      isFinite(brier) ? brier.toFixed(4) : 'N/A',
      '', ''
    ]);
  }
  
  return { accuracy:accuracy, total:total, correct:correct,
           skipped:skipped, tieRate:tieRate, brier:brier, buckets:buckets };
}

function runHQBacktest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = ss.getSheetByName('HQ_Backtest_Data');
  if (!dataSheet || dataSheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Run "Build HQ History" first.');
    return;
  }
  ss.toast('Running HQ backtest...', 'Ma Golide', 30);
  try {
    var r = backtestHighestQuarter(ss);
    SpreadsheetApp.getUi().alert(
      'HQ Backtest Results\n\n' +
      'Games: ' + r.total + ' | Skipped: ' + r.skipped + '\n' +
      'Correct: ' + r.correct + '/' + r.total + '\n' +
      'Accuracy: ' + r.accuracy.toFixed(1) + '%\n' +
      'Brier: ' + (isFinite(r.brier) ? r.brier.toFixed(4) : 'N/A') + '\n' +
      'Tie rate: ' + r.tieRate.toFixed(1) + '%\n\n' +
      'Random baseline: 25% / Brier 0.75\n' +
      'See execution log for confidence bucket breakdown.'
    );
  } catch(e) {
    SpreadsheetApp.getUi().alert('Backtest error: ' + e.message);
  }
}


// ───────────────────────────────────────────────────────────────────────────
// PHASE 5: TUNER (basic grid search)
// ───────────────────────────────────────────────────────────────────────────

function tuneHighestQConfig(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var proposalSheet = ss.getSheetByName('Config_HighestQ_Proposals');
  if (!proposalSheet) throw new Error('Run "Create HQ Sheets" first');
  
  var baseCfg = {};
  try { baseCfg = loadTier2Config(ss) || {}; } catch(e) {}
  
  var temps = [3, 5, 7, 10];
  var ks = [5, 10, 15, 20];
  var best = { accuracy: 0, params: null };
  var proposals = [];
  
  for (var ti = 0; ti < temps.length; ti++) {
    for (var ki = 0; ki < ks.length; ki++) {
      var testCfg = {};
      for (var key in baseCfg) testCfg[key] = baseCfg[key];
      testCfg.hq_softmax_temperature = temps[ti];
      testCfg.hq_shrink_k = ks[ki];
      
      try {
        var result = backtestHighestQuarter(ss, testCfg);
        var params = { temp: temps[ti], k: ks[ki] };
        proposals.push([
          Utilities.getUuid().slice(0,8), new Date().toISOString(),
          JSON.stringify(params), '', '', result.total,
          result.accuracy.toFixed(1),
          isFinite(result.brier) ? result.brier.toFixed(4) : 'N/A',
          '', 'temp=' + temps[ti] + ' k=' + ks[ki]
        ]);
        if (result.accuracy > best.accuracy) {
          best.accuracy = result.accuracy;
          best.params = params;
        }
      } catch(e) {
        Logger.log('[TUNE] Error temp=' + temps[ti] + ' k=' + ks[ki] + ': ' + e.message);
      }
    }
  }
  
  if (proposals.length > 0) {
    proposalSheet.getRange(proposalSheet.getLastRow()+1, 1, proposals.length, proposals[0].length)
      .setValues(proposals);
  }
  Logger.log('[TUNE] Best: ' + JSON.stringify(best));
  return best;
}

function runHQTuner() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = ss.getSheetByName('HQ_Backtest_Data');
  if (!dataSheet || dataSheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Run "Build HQ History" first, then "Backtest HQ Model".');
    return;
  }
  ss.toast('Tuning HQ parameters (may take minutes)...', 'Ma Golide', 120);
  try {
    var best = tuneHighestQConfig(ss);
    SpreadsheetApp.getUi().alert(
      'HQ Tuning Complete\n\n' +
      'Best accuracy: ' + best.accuracy.toFixed(1) + '%\n' +
      'Best params: ' + JSON.stringify(best.params) + '\n\n' +
      'Results in Config_HighestQ_Proposals.\nReview and apply manually to Config_Tier2.'
    );
  } catch(e) {
    SpreadsheetApp.getUi().alert('Tuner error: ' + e.message);
  }
}


// ───────────────────────────────────────────────────────────────────────────
// PHASE 6: DIAGNOSTICS
// ───────────────────────────────────────────────────────────────────────────

function runHQStatusCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var funcs = {
    'Elite IIFE':                    typeof Elite !== 'undefined' && Elite !== null,
    'processEnhancements':           typeof processEnhancements === 'function',
    'predictHighestQuarterEnhanced': typeof predictHighestQuarterEnhanced === 'function',
    'hq_softmax_':                   typeof hq_softmax_ === 'function',
    'hq_shrinkEstimate_':            typeof hq_shrinkEstimate_ === 'function',
    'hq_computeQuarterProbs_':       typeof hq_computeQuarterProbs_ === 'function',
    'hq_gateCheck_':                 typeof hq_gateCheck_ === 'function',
    'buildHighestQuarterHistory':    typeof buildHighestQuarterHistory === 'function',
    'backtestHighestQuarter':        typeof backtestHighestQuarter === 'function',
    'tuneHighestQConfig':            typeof tuneHighestQConfig === 'function',
    'loadTier2MarginStats':          typeof loadTier2MarginStats === 'function',
    'buildAccumulator':              typeof buildAccumulator === 'function'
  };
  
  var sheets = ['UpcomingClean','Config_Tier2','HQ_Backtest_Data',
    'HQ_Prediction_Log','HQ_Accuracy','HQ_Backtest_Report','Config_HighestQ_Proposals'];
  var sheetInfo = {};
  for (var i = 0; i < sheets.length; i++) {
    var sh = ss.getSheetByName(sheets[i]);
    sheetInfo[sheets[i]] = sh ? ((sh.getLastRow()-1) + ' data rows') : 'MISSING';
  }
  
  // Check UpcomingClean for HQ columns
  var hqCols = {'enh-high-q':false, 'enh-high-q-conf':false, 'enh-high-q-pq1':false};
  var uc = ss.getSheetByName('UpcomingClean');
  if (uc && uc.getLastRow() > 0) {
    var headers = uc.getRange(1,1,1,uc.getLastColumn()).getValues()[0];
    for (var h = 0; h < headers.length; h++) {
      var hdr = String(headers[h]).toLowerCase().trim();
      if (hqCols.hasOwnProperty(hdr)) hqCols[hdr] = true;
    }
  }
  
  // Check config keys
  var cfgKeys = ['hq_enabled','hq_min_confidence','hq_skip_ties',
    'hq_softmax_temperature','hq_shrink_k'];
  var cfgPresent = {};
  try {
    var cfg = loadTier2Config(ss);
    if (cfg) {
      for (var k = 0; k < cfgKeys.length; k++) {
        var found = false;
        var variants = [cfgKeys[k], cfgKeys[k].replace(/_/g,''),
          cfgKeys[k].replace(/_([a-z])/g, function(m,c){return c.toUpperCase();})];
        for (var v = 0; v < variants.length; v++) {
          if (cfg[variants[v]] !== undefined && cfg[variants[v]] !== null) {
            cfgPresent[cfgKeys[k]] = String(cfg[variants[v]]);
            found = true; break;
          }
        }
        if (!found) cfgPresent[cfgKeys[k]] = 'MISSING';
      }
    }
  } catch(e) {}
  
  var msg = '═══ HQ PIPELINE STATUS ═══\n\n';
  msg += '── Functions ──\n';
  for (var fn in funcs) msg += (funcs[fn]?'✅':'❌') + ' ' + fn + '\n';
  msg += '\n── Sheets ──\n';
  for (var sn in sheetInfo) {
    msg += (sheetInfo[sn]!=='MISSING'?'✅':'❌') + ' ' + sn + ': ' + sheetInfo[sn] + '\n';
  }
  msg += '\n── UpcomingClean HQ Columns ──\n';
  for (var col in hqCols) msg += (hqCols[col]?'✅':'❌') + ' ' + col + '\n';
  msg += '\n── Config_Tier2 HQ Keys ──\n';
  for (var ck in cfgPresent) {
    msg += (cfgPresent[ck]!=='MISSING'?'✅':'❌') + ' ' + ck + ': ' + cfgPresent[ck] + '\n';
  }
  
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

function runHQDiagnostic() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var uc = ss.getSheetByName('UpcomingClean');
  if (!uc || uc.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('UpcomingClean has no games.');
    return;
  }
  
  var headers = uc.getRange(1,1,1,uc.getLastColumn()).getValues()[0];
  var row = uc.getRange(2,1,1,uc.getLastColumn()).getValues()[0];
  var hIdx=-1, aIdx=-1, lIdx=-1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h==='home') hIdx=i;
    if (h==='away') aIdx=i;
    if (h==='league'||h==='competition') lIdx=i;
  }
  
  var game = {
    home: String(row[hIdx]||''), away: String(row[aIdx]||''),
    league: lIdx>=0 ? String(row[lIdx]||'') : ''
  };
  
  var marginStats = {};
  try { marginStats = loadTier2MarginStats(ss) || {}; } catch(e) {}
  var cfg = {};
  try { cfg = loadTier2Config(ss) || {}; } catch(e) {}
  
  var hq;
  try {
    hq = predictHighestQuarterEnhanced(game, marginStats, cfg);
  } catch(e) {
    hq = { error: e.message };
  }
  
  var msg = 'HQ Diagnostic: ' + game.home + ' vs ' + game.away + '\n';
  msg += 'League: ' + game.league + '\n\n';
  
  if (hq.error) {
    msg += 'ERROR: ' + hq.error + '\n';
  } else {
    msg += 'Pick: ' + (hq.quarter||'N/A') + '\n';
    msg += 'Confidence: ' + (hq.confidence||0) + '%\n';
    msg += 'Tier: ' + (hq.tier||'N/A') + '\n';
    msg += 'Skip: ' + (hq.skip||false) + '\n';
    msg += 'Reason: ' + (hq.reason||'') + '\n';
    msg += 'Was Tie: ' + (hq.wasTie||false) + '\n';
    msg += 'Margin: ' + (hq.margin||0) + '\n';
    
    if (hq.pQ1 !== undefined) {
      msg += '\nProbabilities:\n';
      msg += '  Q1: ' + (hq.pQ1*100).toFixed(1) + '%\n';
      msg += '  Q2: ' + (hq.pQ2*100).toFixed(1) + '%\n';
      msg += '  Q3: ' + (hq.pQ3*100).toFixed(1) + '%\n';
      msg += '  Q4: ' + (hq.pQ4*100).toFixed(1) + '%\n';
      msg += '  pWin: ' + (hq.pWin*100).toFixed(1) + '%\n';
    }
    
    if (hq.allQuarters) {
      msg += '\nQuarter Scores:\n';
      for (var q = 0; q < hq.allQuarters.length; q++) {
        var aq = hq.allQuarters[q];
        msg += '  ' + aq.quarter + ': ' + (aq.enhancedScore||aq.score||0).toFixed(1) + '\n';
      }
    }
    
    // PATCH 5: Decision-path visibility
    if (hq.allQuarters && hq.allQuarters.length > 0) {
      msg += '\nTop by score: ' + hq.allQuarters[0].quarter + 
             ' (' + hq.allQuarters[0].enhancedScore + ')\n';
      if (hq.allQuarters.length > 1) {
        msg += 'Runner-up: ' + hq.allQuarters[1].quarter + 
               ' (' + hq.allQuarters[1].enhancedScore + ')\n';
      }
    }
    if (hq.meta) {
      msg += 'Profile source: ' + (hq.meta.profileSource || '?') + '\n';
      msg += 'Tie margin used: ' + (hq.meta.tieMarginUsed || hq.meta.tieMargin || '?') + '\n';
      msg += 'sdAvg: ' + (hq.meta.sdAvg || '?') + '\n';
      msg += 'Reliability: ' + (hq.meta.reliability || '?') + '\n';
    }
    
    // Gate check
    var gate = hq_gateCheck_(hq, cfg);
    // PATCH 4: enforce gate result
    if (!gate.pass) {
      hq.skip = true;
      hq.reason = hq.reason ? (hq.reason + '; ' + gate.reason) : gate.reason;
    }
    msg += '\nGate Check: ' + (gate.pass ? 'PASS' : 'FAIL — ' + gate.reason) + '\n';
  }
  
  // Check marginStats for these teams
  var msKeys = Object.keys(marginStats);
  var homeKey = game.home.toLowerCase().trim();
  var awayKey = game.away.toLowerCase().trim();
  var homeFound = msKeys.some(function(k){return k.toLowerCase()===homeKey;});
  var awayFound = msKeys.some(function(k){return k.toLowerCase()===awayKey;});
  msg += '\nData:\n';
  msg += '  marginStats teams: ' + (msKeys.length - (marginStats._meta?1:0)) + '\n';
  msg += '  Home "' + game.home + '" in stats: ' + homeFound + '\n';
  msg += '  Away "' + game.away + '" in stats: ' + awayFound + '\n';
  
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

function diagHQDataAccess() {
  var results = {
    Elite_exists: typeof Elite !== 'undefined' && Elite !== null,
    Elite_members: [],
    processEnhancements: typeof processEnhancements === 'function',
    predictHighestQuarterEnhanced: typeof predictHighestQuarterEnhanced === 'function',
    loadTier2MarginStats: typeof loadTier2MarginStats === 'function',
    loadTier2Config: typeof loadTier2Config === 'function',
    buildAccumulator: typeof buildAccumulator === 'function',
    hq_gateCheck_: typeof hq_gateCheck_ === 'function',
    hq_softmax_: typeof hq_softmax_ === 'function'
  };
  
  if (results.Elite_exists) {
    try { results.Elite_members = Object.keys(Elite); } catch(e) {}
  }
  
  Logger.log(JSON.stringify(results, null, 2));
  SpreadsheetApp.getUi().alert(
    'Data Access Check\n\n' +
    'Elite: ' + results.Elite_exists + ' (' + results.Elite_members.length + ' members)\n' +
    'processEnhancements: ' + results.processEnhancements + '\n' +
    'predictHighestQuarterEnhanced: ' + results.predictHighestQuarterEnhanced + '\n' +
    'hq_gateCheck_: ' + results.hq_gateCheck_ + '\n' +
    'hq_softmax_: ' + results.hq_softmax_ + '\n' +
    '\nSee execution log for full details.'
  );
}

function cleanUpcomingCleanDuplicateColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('UpcomingClean');
  if (!sheet) { SpreadsheetApp.getUi().alert('UpcomingClean not found.'); return; }
  var headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  var seen = {}, dupes = [];
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i]||'').toLowerCase().trim();
    if (!key) continue;
    if (seen[key] !== undefined) dupes.push(i+1);
    else seen[key] = i;
  }
  dupes.sort(function(a,b){return b-a;});
  for (var d = 0; d < dupes.length; d++) sheet.deleteColumn(dupes[d]);
  SpreadsheetApp.getUi().alert(dupes.length > 0
    ? 'Deleted ' + dupes.length + ' duplicate columns.'
    : 'No duplicates found.');
}



function buildLeagueQuarterStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = ss.getSheetByName('HQ_Backtest_Data');
  if (!dataSheet || dataSheet.getLastRow() < 2) {
    throw new Error('Run Build HQ History first');
  }
  
  var data = dataSheet.getDataRange().getValues();
  var headers = data[0];
  var hmap = {};
  for (var h = 0; h < headers.length; h++) {
    hmap[String(headers[h]).toLowerCase().trim().replace(/[\s_]+/g, '')] = h;
  }
  
  var cLeague = hmap['league'];
  var cQ1 = hmap['q1total'] !== undefined ? hmap['q1total'] : hmap['q1_total'];
  var cQ2 = hmap['q2total'] !== undefined ? hmap['q2total'] : hmap['q2_total'];
  var cQ3 = hmap['q3total'] !== undefined ? hmap['q3total'] : hmap['q3_total'];
  var cQ4 = hmap['q4total'] !== undefined ? hmap['q4total'] : hmap['q4_total'];
  var cHighest = hmap['highestqactual'] !== undefined ? hmap['highestqactual'] : hmap['highestq_actual'];
  var cTie = hmap['wastieactual'] !== undefined ? hmap['wastieactual'] : hmap['wastie_actual'];
  
  if (cQ1 === undefined) {
    SpreadsheetApp.getUi().alert('Cannot find Q1_Total column in HQ_Backtest_Data');
    return;
  }
  
  var leagues = {};
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var league = String(row[cLeague] || 'NBA').trim();
    if (!league) league = 'NBA';
    
    if (!leagues[league]) {
      leagues[league] = {
        games: 0,
        q1Sum: 0, q2Sum: 0, q3Sum: 0, q4Sum: 0,
        q1SqSum: 0, q2SqSum: 0, q3SqSum: 0, q4SqSum: 0,
        highestCount: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
        ties: 0
      };
    }
    
    var lg = leagues[league];
    var q1 = parseFloat(row[cQ1]), q2 = parseFloat(row[cQ2]);
    var q3 = parseFloat(row[cQ3]), q4 = parseFloat(row[cQ4]);
    if (!isFinite(q1) || !isFinite(q2) || !isFinite(q3) || !isFinite(q4)) continue;
    
    lg.games++;
    lg.q1Sum += q1; lg.q2Sum += q2; lg.q3Sum += q3; lg.q4Sum += q4;
    lg.q1SqSum += q1*q1; lg.q2SqSum += q2*q2; lg.q3SqSum += q3*q3; lg.q4SqSum += q4*q4;
    
    var highest = String(row[cHighest] || '').trim();
    if (lg.highestCount[highest] !== undefined) lg.highestCount[highest]++;
    
    var wasTie = String(row[cTie] || '').toUpperCase() === 'TRUE';
    if (wasTie) lg.ties++;
  }
  
  // Write to LeagueQuarterO_U_Stats
  var outSheet = ss.getSheetByName('LeagueQuarterO_U_Stats');
  if (!outSheet) {
    outSheet = ss.insertSheet('LeagueQuarterO_U_Stats');
  }
  outSheet.clearContents();
  
  var outHeaders = [
    'League', 'Games', 'TieRate',
    'Q1_Mean', 'Q1_SD', 'Q2_Mean', 'Q2_SD',
    'Q3_Mean', 'Q3_SD', 'Q4_Mean', 'Q4_SD',
    'Q1_HighestPct', 'Q2_HighestPct', 'Q3_HighestPct', 'Q4_HighestPct',
    'GameTotal_Mean'
  ];
  outSheet.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]);
  outSheet.setFrozenRows(1);
  outSheet.getRange(1, 1, 1, outHeaders.length).setFontWeight('bold');
  
  var outRows = [];
  for (var lg2 in leagues) {
    if (!leagues.hasOwnProperty(lg2)) continue;
    var d = leagues[lg2];
    var n = d.games;
    if (n < 5) continue;
    
    var q1m = d.q1Sum / n, q2m = d.q2Sum / n, q3m = d.q3Sum / n, q4m = d.q4Sum / n;
    var q1sd = Math.sqrt(d.q1SqSum / n - q1m * q1m);
    var q2sd = Math.sqrt(d.q2SqSum / n - q2m * q2m);
    var q3sd = Math.sqrt(d.q3SqSum / n - q3m * q3m);
    var q4sd = Math.sqrt(d.q4SqSum / n - q4m * q4m);
    
    var total = d.highestCount.Q1 + d.highestCount.Q2 + d.highestCount.Q3 + d.highestCount.Q4;
    var q1pct = total > 0 ? d.highestCount.Q1 / total : 0.25;
    var q2pct = total > 0 ? d.highestCount.Q2 / total : 0.25;
    var q3pct = total > 0 ? d.highestCount.Q3 / total : 0.25;
    var q4pct = total > 0 ? d.highestCount.Q4 / total : 0.25;
    
    outRows.push([
      lg2, n, (d.ties / n * 100).toFixed(1) + '%',
      q1m.toFixed(1), q1sd.toFixed(1), q2m.toFixed(1), q2sd.toFixed(1),
      q3m.toFixed(1), q3sd.toFixed(1), q4m.toFixed(1), q4sd.toFixed(1),
      (q1pct * 100).toFixed(1) + '%', (q2pct * 100).toFixed(1) + '%',
      (q3pct * 100).toFixed(1) + '%', (q4pct * 100).toFixed(1) + '%',
      (q1m + q2m + q3m + q4m).toFixed(1)
    ]);
  }
  
  if (outRows.length > 0) {
    outSheet.getRange(2, 1, outRows.length, outHeaders.length).setValues(outRows);
  }
  
  Logger.log('[buildLeagueQuarterStats] Wrote ' + outRows.length + ' leagues from ' +
    data.length + ' games');
  
  for (var i = 0; i < outRows.length; i++) {
    Logger.log('  ' + outRows[i][0] + ': ' + outRows[i][1] + ' games, tie rate=' +
      outRows[i][2] + ', Q1=' + outRows[i][11] + ' Q2=' + outRows[i][12] +
      ' Q3=' + outRows[i][13] + ' Q4=' + outRows[i][14]);
  }
  
  return { leagues: outRows.length };
}

function runBuildLeagueQuarterStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Building league quarter stats...', 'Ma Golide', 10);
  try {
    var result = buildLeagueQuarterStats();
    ss.toast('Done: ' + result.leagues + ' leagues profiled', 'Ma Golide', 5);
  } catch(e) {
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}


/**
 * Loads league quarter profile from LeagueQuarterO_U_Stats sheet.
 * Returns the format predictHighestQuarterEnhanced expects.
 * If league not found: returns null (caller handles fallback/skip).
 */
function getLeagueProfile(ss, league) {
  // NEW: make it work when ss isn't passed (diagnostics/backtests/contract mode)
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  }
  if (!ss) return null;
  
  var sheet = ss.getSheetByName('LeagueQuarterO_U_Stats');
  if (!sheet || sheet.getLastRow() < 2) return null;
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var hmap = {};
  for (var h = 0; h < headers.length; h++) {
    hmap[String(headers[h]).toLowerCase().trim().replace(/[\s_]+/g, '')] = h;
  }
  
  // Find the league row
  var leagueNorm = String(league || '').toLowerCase().trim();
  var cLeague = hmap['league'];
  if (cLeague === undefined) return null;
  
  var row = null;
  for (var r = 1; r < data.length; r++) {
    var rowLeague = String(data[r][cLeague] || '').toLowerCase().trim();
    if (rowLeague === leagueNorm || 
        (leagueNorm === '' && data.length === 2)) { // single league: use it
      row = data[r];
      break;
    }
  }
  
  // If no exact match found and only one league exists, use it
  if (!row && data.length === 2) {
    row = data[1];
  }
  
  if (!row) return null;
  
  // Parse helper: strips '%' and returns number
  function parseVal(idx) {
    if (idx === undefined) return NaN;
    var v = String(row[idx] || '').replace('%', '').trim();
    return parseFloat(v);
  }
  
  var cGames = hmap['games'];
  var cQ1Mean = hmap['q1mean'] !== undefined ? hmap['q1mean'] : hmap['q1_mean'];
  var cQ1SD = hmap['q1sd'] !== undefined ? hmap['q1sd'] : hmap['q1_sd'];
  var cQ2Mean = hmap['q2mean'] !== undefined ? hmap['q2mean'] : hmap['q2_mean'];
  var cQ2SD = hmap['q2sd'] !== undefined ? hmap['q2sd'] : hmap['q2_sd'];
  var cQ3Mean = hmap['q3mean'] !== undefined ? hmap['q3mean'] : hmap['q3_mean'];
  var cQ3SD = hmap['q3sd'] !== undefined ? hmap['q3sd'] : hmap['q3_sd'];
  var cQ4Mean = hmap['q4mean'] !== undefined ? hmap['q4mean'] : hmap['q4_mean'];
  var cQ4SD = hmap['q4sd'] !== undefined ? hmap['q4sd'] : hmap['q4_sd'];
  var cQ1Pct = hmap['q1highestpct'] !== undefined ? hmap['q1highestpct'] : hmap['q1_highestpct'];
  var cQ2Pct = hmap['q2highestpct'] !== undefined ? hmap['q2highestpct'] : hmap['q2_highestpct'];
  var cQ3Pct = hmap['q3highestpct'] !== undefined ? hmap['q3highestpct'] : hmap['q3_highestpct'];
  var cQ4Pct = hmap['q4highestpct'] !== undefined ? hmap['q4highestpct'] : hmap['q4_highestpct'];
  
  var games = parseVal(cGames);
  if (!isFinite(games) || games < 5) return null;
  
  var q1m = parseVal(cQ1Mean), q1s = parseVal(cQ1SD);
  var q2m = parseVal(cQ2Mean), q2s = parseVal(cQ2SD);
  var q3m = parseVal(cQ3Mean), q3s = parseVal(cQ3SD);
  var q4m = parseVal(cQ4Mean), q4s = parseVal(cQ4SD);
  
  // Parse highest-quarter percentages (stored as "29.4%")
  var q1pct = parseVal(cQ1Pct) / 100;
  var q2pct = parseVal(cQ2Pct) / 100;
  var q3pct = parseVal(cQ3Pct) / 100;
  var q4pct = parseVal(cQ4Pct) / 100;
  
  // Validate
  if (!isFinite(q1m) || !isFinite(q2m) || !isFinite(q3m) || !isFinite(q4m)) return null;
  
  // Default SDs if missing
  if (!isFinite(q1s) || q1s <= 0) q1s = 8;
  if (!isFinite(q2s) || q2s <= 0) q2s = 8;
  if (!isFinite(q3s) || q3s <= 0) q3s = 8;
  if (!isFinite(q4s) || q4s <= 0) q4s = 8;
  
  // Default percentages if missing
  if (!isFinite(q1pct)) q1pct = 0.25;
  if (!isFinite(q2pct)) q2pct = 0.25;
  if (!isFinite(q3pct)) q3pct = 0.25;
  if (!isFinite(q4pct)) q4pct = 0.25;
  
  var prof = {
    Q1: { mean: q1m, sd: q1s, count: games, overPct: 50, underPct: 50 },
    Q2: { mean: q2m, sd: q2s, count: games, overPct: 50, underPct: 50 },
    Q3: { mean: q3m, sd: q3s, count: games, overPct: 50, underPct: 50 },
    Q4: { mean: q4m, sd: q4s, count: games, overPct: 50, underPct: 50 },
    _source: 'LeagueQuarterO_U_Stats',
    quarterPcts: { Q1: q1pct, Q2: q2pct, Q3: q3pct, Q4: q4pct }
  };
  
  Logger.log('[getLeagueProfile] Loaded profile for "' + league + '": ' +
    'Q1=' + q1m + '±' + q1s + ' (' + (q1pct*100).toFixed(1) + '%), ' +
    'Q2=' + q2m + '±' + q2s + ' (' + (q2pct*100).toFixed(1) + '%), ' +
    'Q3=' + q3m + '±' + q3s + ' (' + (q3pct*100).toFixed(1) + '%), ' +
    'Q4=' + q4m + '±' + q4s + ' (' + (q4pct*100).toFixed(1) + '%)');
  
  return prof;
}

function t2_canonicalizeConfig_(cfg) {
  cfg = cfg || {};

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    return undefined;
  }
  function firstNum(keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (cfg[k] === undefined) continue;
      var v = num(cfg[k]);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  function firstBool(keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (cfg[k] === undefined) continue;
      return !!cfg[k];
    }
    return undefined;
  }

  // --- Numbers (MOST IMPORTANT: tiemargin -> tieMargin) ---
  var tm = firstNum(['tiemargin', 'tieMargin']);
  if (tm !== undefined) cfg.tieMargin = tm;

  var hqtm = firstNum(['highQtrTieMargin', 'highqtrtiemargin']);
  if (hqtm !== undefined) cfg.highQtrTieMargin = hqtm;

  var t = firstNum(['hq_softmax_temperature', 'hqSoftmaxTemperature', 'hqsoftmaxtemperature']);
  if (t !== undefined) cfg.hqSoftmaxTemperature = t;

  var mc = firstNum(['hq_min_confidence', 'hqMinConfidence', 'hqminconfidence']);
  if (mc !== undefined) cfg.hqMinConfidence = mc;

  // --- Booleans (nice-to-have consistency) ---
  var sk = firstBool(['hq_skip_ties', 'hqSkipTies', 'hqskipties']);
  if (sk !== undefined) cfg.hqSkipTies = sk;

  return cfg;
}


function hq_computeQuarterProbs_(scoreMap, leaguePrior, config) {
  config = config || {};
  scoreMap = scoreMap || {};

  function getNum(keys, def) {
    for (var i = 0; i < keys.length; i++) {
      var v = config[keys[i]];
      if (typeof v === 'number' && isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    }
    return def;
  }

  var T = getNum(['hqSoftmaxTemperature', 'hq_softmax_temperature'], 4);
  if (!isFinite(T) || T <= 0) T = 4;

  var priorStrength = getNum(['hqPriorStrength', 'hq_prior_strength'], 0.0); // 0 = off
  if (!isFinite(priorStrength) || priorStrength < 0) priorStrength = 0;

  var qs = ['Q1','Q2','Q3','Q4'];
  var logits = {};
  var maxL = -Infinity;

  for (var i = 0; i < qs.length; i++) {
    var q = qs[i];
    var s = scoreMap[q];
    if (!isFinite(s)) return { valid: false };
    var l = s / T;
    logits[q] = l;
    if (l > maxL) maxL = l;
  }

  // softmax
  var expSum = 0;
  var raw = {};
  for (var j = 0; j < qs.length; j++) {
    var qq = qs[j];
    var e = Math.exp(logits[qq] - maxL);
    raw[qq] = e;
    expSum += e;
  }
  if (!(expSum > 0)) return { valid: false };

  var p = {};
  for (var k = 0; k < qs.length; k++) {
    var qqq = qs[k];
    p[qqq] = raw[qqq] / expSum;
  }

  // Optional shrinkage toward league prior (multiplicative, renormalize)
  if (leaguePrior && priorStrength > 0) {
    var sum2 = 0;
    for (var a = 0; a < qs.length; a++) {
      var qx = qs[a];
      var pr = leaguePrior[qx];
      if (!isFinite(pr) || pr <= 0) pr = 0.25;
      p[qx] = p[qx] * Math.pow(pr, priorStrength);
      sum2 += p[qx];
    }
    if (sum2 > 0) {
      for (var b = 0; b < qs.length; b++) p[qs[b]] /= sum2;
    }
  }

  var pWin = Math.max(p.Q1, p.Q2, p.Q3, p.Q4);

  return {
    valid: true,
    pQ1: p.Q1, pQ2: p.Q2, pQ3: p.Q3, pQ4: p.Q4,
    pWin: pWin
  };
}





/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * ==============================================================================
 * MA GOLIDE — MULTI-LEAGUE STRICT ZERO-FAKE-FALLBACK PATCH
 * VERSION: MULTI-LEAGUE-STRICT-2.0
 *
 * PURPOSE
 * - Strict-safe overlay loaded AFTER existing modules
 * - No fake numeric fallback injection from placeholders / blanks / invalid values
 * - Sparse UpcomingClean duplicate-header repair
 * - Append-only config alias bridge
 * - League-agnostic replacements for shared loaders/selectors
 * - Optional runner wrapping, configurable by function name
 *
 * NOTES
 * - Apps Script uses "last definition wins"
 * - Paste this as ONE NEW FILE loaded LAST
 * - No sheet/column deletion
 * - No full-sheet flattening
 * - Sparse writes only where needed
 * ==============================================================================
 */

/* ============================================================================
 * SECTION 0 — GLOBAL BOOT / CONFIG / STATE
 * ========================================================================== */

(function MG_STRICT_bootGlobals_() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  g.ZERO_FALLBACK_OVERLAY_ACTIVE = true;
  g.ZERO_FALLBACK_OVERLAY_VERSION = 'MULTI-LEAGUE-STRICT-2.0';
})();

function IS_ZERO_FALLBACK_OVERLAY_ACTIVE() {
  return true;
}

var MG_STRICT_PATCH_VERSION = 'MULTI-LEAGUE-STRICT-2.0';
var MG_STRICT_GUARD_MODE = 'strict'; // strict | log-only

var MG_FIX_CANONICAL_BAND = { min: 23, max: 66 };
var MG_FIX_ELIGIBLE_PREFIXES = ['t2-', 'ou-', 'enh-', 'hq'];

var MG_FIX_KEY_BRIDGE = {
  confMin: 'confidence_min',
  confMax: 'confidence_max',
  confidenceScale: 'confidence_scale',
  homeCourtWeight: 'home_court_weight',
  momentumWeight: 'momentum_weight',
  netRtgWeight: 'net_rtg_weight',
  pctWeight: 'pct_weight',
  streakWeight: 'streak_weight',
  formWeight: 'form_weight',
  h2hWeight: 'h2h_weight',
  forebetWeight: 'forebet_weight',
  varianceWeight: 'variance_weight',
  rankWeight: 'rank_weight',
  homeAdv: 'home_advantage',
  tierWeakMinScore: 'tier_weak_min_score',
  tierMediumMinScore: 'tier_medium_min_score',
  tierStrongMinScore: 'tier_strong_min_score',
  momentumSwingFactor: 'momentum_swing_factor',
  variancePenaltyFactor: 'variance_penalty_factor',
  ftOUMinConf: 'ou_min_conf',
  ftOUMinEV: 'ou_min_ev',
  ftOuMinConf: 'ou_min_conf',
  ftOuMinEv: 'ou_min_ev',
  bankerThreshold: 'banker_threshold',
  minBankerOdds: 'min_banker_odds',
  maxBankerOdds: 'max_banker_odds',
  sniperMinMargin: 'sniper_min_margin',
  minEdgeScore: 'min_edge_score'
};

var MG_ZF_NUMERIC_HELPERS = [
  'safeNum_',
  '_toNum',
  '_enh_toNum',
  '_m8_toNum_',
  'm8_toNum',
  'coerceNumber',
  '_coerceNumber_',
  't2_localCoerceNumber_'
];

var MG_STRICT_MAIN_RUNNERS = [
  'runTheWholeShebang',
  'runTunersOnly'
];

var MG_STRICT_STAGE_RUNNERS = [
  'analyzeTier1',
  'predictQuarters_Tier2',
  'predictQuarters_Tier2_OU',
  'runAllEnhancements',
  'buildAccumulator'
];

var MG_STRICT_BASIC_RUNNERS = [
  'runTier2OU',
  'tuneLeagueWeights',
  'tuneTier2Config',
  'tuneTier2OUConfig',
  'runAccumulator'
];

(function MG_STRICT_initState_() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (!g.__MG_STRICT_STATE) {
    g.__MG_STRICT_STATE = {
      installed: false,
      wrapped: Object.create(null),
      orig: Object.create(null),
      eventSeen: Object.create(null)
    };
  }
})();

/* ============================================================================
 * SECTION 1 — CONFIG HELPERS / SETTERS
 * ========================================================================== */

function MG_SET_UPCOMING_PREFIXES(prefixes) {
  MG_FIX_ELIGIBLE_PREFIXES = prefixes || ['t2-', 'ou-', 'enh-', 'hq'];
}

function MG_SET_STRICT_RUNNERS_(mainRunners, stageRunners, basicRunners) {
  if (mainRunners && mainRunners.length) MG_STRICT_MAIN_RUNNERS = mainRunners.slice();
  if (stageRunners && stageRunners.length) MG_STRICT_STAGE_RUNNERS = stageRunners.slice();
  if (basicRunners && basicRunners.length) MG_STRICT_BASIC_RUNNERS = basicRunners.slice();
}

function MG_SET_GUARD_MODE_(mode) {
  MG_STRICT_GUARD_MODE = (mode === 'log-only') ? 'log-only' : 'strict';
}

/* ============================================================================
 * SECTION 2 — LOW-LEVEL UTILS
 * ========================================================================== */

function mg_fix_norm_(s) {
  return String(s == null ? '' : s)
    .replace(/\u00A0/g, ' ')
    .replace(/\uFEFF/g, '')
    .trim();
}

function mg_fix_normLower_(s) {
  return mg_fix_norm_(s).toLowerCase();
}

function mg_fix_normKey_(s) {
  return mg_fix_normLower_(s).replace(/[\s_\-]+/g, '');
}

function mg_fix_stripDupSuffix_(h) {
  var s = mg_fix_norm_(h);
  s = s.replace(/__dup\d+$/i, '');
  s = s.replace(/\s*\(\s*dup\s*\d+\s*\)\s*$/i, '');
  return s;
}

function mg_fix_isEmpty_(v) {
  return v === '' || v === null || typeof v === 'undefined';
}

function mg_fix_sameValue_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a) === String(b);
}

function mg_fix_isPlaceholderText_(v) {
  var s = mg_fix_normLower_(v);
  return !s || /^(n\/a|na|null|undefined|skipped|skip|--+|-|—|tbd)$/i.test(s);
}

function mg_fix_realNum_(v) {
  if (v === null || typeof v === 'undefined') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = mg_fix_norm_(v);
  if (!s) return null;
  if (mg_fix_isPlaceholderText_(s)) return null;
  s = s.replace('%', '').replace(/,/g, '.').trim();
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function mg_fix_getSheetInsensitive_(ss, name) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var direct = ss.getSheetByName(name);
  if (direct) return direct;
  var target = mg_fix_normLower_(name);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (mg_fix_normLower_(sheets[i].getName()) === target) return sheets[i];
  }
  return null;
}

function mg_fix_normalizeTeamNameSafe_(name) {
  try {
    if (typeof normalizeTeamName_ === 'function') return normalizeTeamName_(name);
  } catch (e) {}
  return mg_fix_normLower_(name)
    .replace(/[^\w\s&.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mg_fix_applySparseColumnWrites_(sheet, fills) {
  if (!fills || !fills.length) return;
  var byCol = Object.create(null);
  for (var i = 0; i < fills.length; i++) {
    var f = fills[i];
    var k = String(f.col);
    if (!byCol[k]) byCol[k] = [];
    byCol[k].push(f);
  }
  Object.keys(byCol).forEach(function(colStr) {
    var col = parseInt(colStr, 10);
    var arr = byCol[colStr].sort(function(a, b) { return a.row - b.row; });
    var segStart = null, segVals = [], prevRow = null;

    function flush_() {
      if (segStart === null || segVals.length === 0) return;
      sheet.getRange(segStart, col, segVals.length, 1).setValues(segVals);
      segStart = null;
      segVals = [];
      prevRow = null;
    }

    for (var j = 0; j < arr.length; j++) {
      var u = arr[j];
      if (segStart === null) {
        segStart = u.row;
        segVals = [[u.value]];
        prevRow = u.row;
      } else if (u.row === prevRow + 1) {
        segVals.push([u.value]);
        prevRow = u.row;
      } else {
        flush_();
        segStart = u.row;
        segVals = [[u.value]];
        prevRow = u.row;
      }
    }
    flush_();
  });
}

/* ============================================================================
 * SECTION 3 — FALLBACK EVENT LOGGING
 * ========================================================================== */

function MG_ZF_logFallbackEvent_(ss, helper, label, raw, fallback) {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var st = g.__MG_STRICT_STATE;
  if (!st) return;

  var sig = [String(helper), String(label || ''), String(raw), String(fallback)].join('|');
  if (st.eventSeen[sig]) return;
  st.eventSeen[sig] = true;

  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    var sh = ss.getSheetByName('ZERO_FALLBACK_EVENTS');
    if (!sh) {
      sh = ss.insertSheet('ZERO_FALLBACK_EVENTS');
      sh.appendRow(['Timestamp', 'Helper', 'Label', 'RawValue', 'FallbackArg', 'User', 'Stack']);
      sh.setFrozenRows(1);
    }

    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (e2) {}

    var stack = '';
    try { stack = (new Error()).stack || ''; } catch (e3) {}

    sh.appendRow([
      new Date(),
      helper || '',
      label || '',
      String(raw),
      String(fallback),
      email,
      String(stack).slice(0, 500)
    ]);
  } catch (e) {
    Logger.log('[MG_ZF] event log failed: ' + e.message);
  }
}

function CLEAR_ZERO_FALLBACK_EVENTS_KEEP_HEADER() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('ZERO_FALLBACK_EVENTS');
  if (!sh) return;
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) return;
  sh.deleteRows(2, lastRow - 1);
}

function BUILD_ZERO_FALLBACK_EVENTS_SUMMARY() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName('ZERO_FALLBACK_EVENTS');
  if (!src || src.getLastRow() < 2) return;

  var outSh = ss.getSheetByName('ZERO_FALLBACK_EVENTS_SUMMARY');
  if (!outSh) outSh = ss.insertSheet('ZERO_FALLBACK_EVENTS_SUMMARY');
  outSh.clear();

  var values = src.getRange(2, 1, src.getLastRow() - 1, 7).getValues();
  var map = Object.create(null);

  values.forEach(function(r) {
    var helper = r[1], label = r[2], fallback = r[4], ts = r[0], raw = r[3];
    var key = [helper, label, fallback].join('||');
    if (!map[key]) {
      map[key] = {
        helper: helper,
        label: label,
        fallback: fallback,
        count: 0,
        lastSeen: ts,
        sampleRaw: raw
      };
    }
    map[key].count++;
    if (new Date(ts).getTime() > new Date(map[key].lastSeen).getTime()) map[key].lastSeen = ts;
    if (!map[key].sampleRaw && raw) map[key].sampleRaw = raw;
  });

  var out = [['Helper', 'Label', 'FallbackArg', 'Count', 'LastSeen', 'SampleRawValue']];
  Object.keys(map)
    .sort(function(a, b) { return map[b].count - map[a].count; })
    .forEach(function(k) {
      var x = map[k];
      out.push([x.helper, x.label, x.fallback, x.count, x.lastSeen, x.sampleRaw]);
    });

  if (out.length > outSh.getMaxRows()) {
    outSh.insertRowsAfter(outSh.getMaxRows(), out.length - outSh.getMaxRows() + 10);
  }
  outSh.getRange(1, 1, out.length, out[0].length).setValues(out);
  outSh.setFrozenRows(1);
  outSh.autoResizeColumns(1, 6);
}

/* ============================================================================
 * SECTION 4 — STRICT NUMERIC GUARDS
 * ========================================================================== */

function MG_ZF_installNumericGuards_(opts) {
  opts = opts || {};
  var mode = opts.mode || MG_STRICT_GUARD_MODE;
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var st = g.__MG_STRICT_STATE;
  if (!st) return;

  MG_ZF_NUMERIC_HELPERS.forEach(function(name) {
    if (typeof g[name] !== 'function') return;

    var key = 'NUMHELP|' + name;
    if (st.wrapped[key]) return;

    st.orig[name] = st.orig[name] || g[name];
    var orig = st.orig[name];

    g[name] = function() {
      var raw = (arguments.length > 0) ? arguments[0] : undefined;
      var fallback = (arguments.length > 1) ? arguments[1] : undefined;
      var label = (arguments.length > 2) ? arguments[2] : '';

      if (arguments.length >= 2) {
        var missing = (raw === '' || raw === null || typeof raw === 'undefined');
        var invalid = (!missing && isNaN(Number(raw)));
        if (missing || invalid) {
          var ss = null;
          try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
          MG_ZF_logFallbackEvent_(ss, name, label, raw, fallback);

          if (mode === 'strict') {
            throw new Error(
              'MG_ZF_STRICT_BLOCKED [' + name + '] ' +
              (label || 'unlabelled') +
              ' raw=' + JSON.stringify(raw) +
              ' fallback=' + JSON.stringify(fallback)
            );
          }
        }
      }

      return orig.apply(this, arguments);
    };

    st.wrapped[key] = true;
  });
}

/* ============================================================================
 * SECTION 5 — UPCOMINGCLEAN DUPLICATE HEADER REPAIR
 * ========================================================================== */

function mg_fix_isEligibleHeader_(name) {
  var h = mg_fix_normLower_(name);
  if (!h) return false;

  for (var i = 0; i < MG_FIX_ELIGIBLE_PREFIXES.length; i++) {
    if (h.indexOf(MG_FIX_ELIGIBLE_PREFIXES[i]) === 0) return true;
  }

  var nk = mg_fix_normKey_(mg_fix_stripDupSuffix_(h));
  return (
    nk === 't2q1' || nk === 't2q2' || nk === 't2q3' || nk === 't2q4' ||
    nk.indexOf('ouq') === 0 ||
    nk.indexOf('enh') === 0 ||
    nk.indexOf('hq') === 0
  );
}

function mg_fix_repairUpcomingClean_(ss, opts) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  opts = opts || {};
  var mode = opts.mode || 'PRE'; // PRE | POST

  var sh = mg_fix_getSheetInsensitive_(ss, 'UpcomingClean');
  if (!sh) return { ok: false, reason: 'missing_UpcomingClean' };

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { ok: false, reason: 'empty_UpcomingClean' };

  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var groups = Object.create(null);

  for (var c = 0; c < hdr.length; c++) {
    var raw = mg_fix_norm_(hdr[c]);
    if (!mg_fix_isEligibleHeader_(raw)) continue;
    var baseName = mg_fix_stripDupSuffix_(raw);
    var baseKey = mg_fix_normKey_(baseName);
    if (!groups[baseKey]) groups[baseKey] = { baseKey: baseKey, baseName: baseName, cols: [] };
    groups[baseKey].cols.push(c);
  }

  var keys = Object.keys(groups);
  if (keys.length === 0) return { ok: true, changed: false, reason: 'no_eligible' };

  var bodyRows = Math.max(0, lastRow - 1);
  var fills = [];
  var headerWrites = [];
  var repairedGroups = 0;

  function pickCanonical_(cols, baseName) {
    var best = cols[0];
    var bestScore = -1;

    for (var i = 0; i < cols.length; i++) {
      var col0 = cols[i];
      var col1 = col0 + 1;
      var name = mg_fix_norm_(hdr[col0]);
      var stripped = mg_fix_stripDupSuffix_(name);
      var isDup = /__dup\d+$/i.test(name) || /\(\s*dup\s*\d+\s*\)\s*$/i.test(name);
      var isExactBase = (mg_fix_normKey_(stripped) === mg_fix_normKey_(baseName));
      var inBand = (col1 >= MG_FIX_CANONICAL_BAND.min && col1 <= MG_FIX_CANONICAL_BAND.max);

      var score = 0;
      if (inBand) score += 100;
      if (!isDup) score += 10;
      if (isExactBase) score += 5;

      if (score > bestScore) {
        bestScore = score;
        best = col0;
      }
    }

    return best;
  }

  keys.forEach(function(k) {
    var cols = groups[k].cols;
    if (!cols || cols.length <= 1) return;

    var baseName = groups[k].baseName;
    var canon = pickCanonical_(cols, baseName);
    cols = cols.slice().sort(function(a, b) { return a - b; });

    if (mode === 'PRE') {
      if (mg_fix_norm_(hdr[canon]) !== baseName) {
        headerWrites.push({ col: canon + 1, value: baseName });
        hdr[canon] = baseName;
      }

      var dupIndex = 1;
      for (var i = 0; i < cols.length; i++) {
        var cc = cols[i];
        if (cc === canon) continue;
        var newName = baseName + '__DUP' + (dupIndex++);
        if (mg_fix_norm_(hdr[cc]) !== newName) {
          headerWrites.push({ col: cc + 1, value: newName });
          hdr[cc] = newName;
        }
      }

      if (bodyRows > 0) {
        var minC = cols[0], maxC = cols[cols.length - 1];
        var block = sh.getRange(2, minC + 1, bodyRows, maxC - minC + 1).getValues();
        var canonOff = canon - minC;

        for (var r = 0; r < bodyRows; r++) {
          var canonVal = block[r][canonOff];
          if (!mg_fix_isEmpty_(canonVal)) continue;

          var chosen = canonVal;
          for (var j = cols.length - 1; j >= 0; j--) {
            var colJ = cols[j];
            if (colJ === canon) continue;
            var v = block[r][colJ - minC];
            if (!mg_fix_isEmpty_(v)) {
              chosen = v;
              break;
            }
          }

          if (!mg_fix_sameValue_(canonVal, chosen)) {
            fills.push({ row: r + 2, col: canon + 1, value: chosen });
          }
        }
      }
    } else {
      if (bodyRows > 0) {
        var minC2 = cols[0], maxC2 = cols[cols.length - 1];
        var block2 = sh.getRange(2, minC2 + 1, bodyRows, maxC2 - minC2 + 1).getValues();
        var canonOff2 = canon - minC2;

        for (var rr = 0; rr < bodyRows; rr++) {
          var canonVal2 = block2[rr][canonOff2];
          var chosen2 = canonVal2;

          for (var jj = cols.length - 1; jj >= 0; jj--) {
            var colJJ = cols[jj];
            var v2 = block2[rr][colJJ - minC2];
            if (!mg_fix_isEmpty_(v2)) {
              chosen2 = v2;
              break;
            }
          }

          if (!mg_fix_sameValue_(canonVal2, chosen2)) {
            fills.push({ row: rr + 2, col: canon + 1, value: chosen2 });
          }
        }
      }
    }

    repairedGroups++;
  });

  for (var hw = 0; hw < headerWrites.length; hw++) {
    sh.getRange(1, headerWrites[hw].col).setValue(headerWrites[hw].value);
  }

  mg_fix_applySparseColumnWrites_(sh, fills);

  Logger.log('[MG_FIX] UpcomingClean repair mode=' + mode +
    ' groups=' + repairedGroups +
    ' headerWrites=' + headerWrites.length +
    ' cellUpdates=' + fills.length);

  return {
    ok: true,
    mode: mode,
    groups: repairedGroups,
    headerWrites: headerWrites.length,
    cellUpdates: fills.length
  };
}

function mg_fix_verifyUpcomingCleanHeaders_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = mg_fix_getSheetInsensitive_(ss, 'UpcomingClean');
  if (!sh) return;

  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return;

  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var seen = Object.create(null);
  var dupes = [];

  for (var i = 0; i < hdr.length; i++) {
    var base = mg_fix_stripDupSuffix_(hdr[i]);
    var k = mg_fix_normKey_(base);
    if (!k) continue;
    if (seen[k]) dupes.push(k + '@C' + (i + 1));
    seen[k] = true;
  }

  if (dupes.length === 0) Logger.log('[MG_FIX] UpcomingClean header scan clean (base keys).');
  else Logger.log('[MG_FIX] UpcomingClean base-key dupes remain -> ' + dupes.slice(0, 50).join(', '));
}

/* ============================================================================
 * SECTION 6 — CONFIG KEY BRIDGE
 * ========================================================================== */

function mg_fix_bridgeConfigAliases_(ss, sheetName) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = mg_fix_getSheetInsensitive_(ss, sheetName);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 2) return 0;

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();

  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var keyCol = 1, valCol = 2;

  for (var c = 0; c < header.length; c++) {
    var h = mg_fix_normLower_(header[c]);
    if (h === 'parameter' || h === 'key' || h === 'setting') keyCol = c + 1;
    if (h === 'value') valCol = c + 1;
  }

  if (keyCol === valCol) return 0;

  var keys = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
  var vals = sh.getRange(2, valCol, lastRow - 1, 1).getValues();

  var exists = Object.create(null);
  var valBy = Object.create(null);

  for (var r = 0; r < keys.length; r++) {
    var k = mg_fix_norm_(keys[r][0]);
    if (!k) continue;
    var kl = k.toLowerCase();
    exists[kl] = true;
    valBy[kl] = vals[r][0];
  }

  var addK = [], addV = [];
  Object.keys(MG_FIX_KEY_BRIDGE).forEach(function(camel) {
    var snake = MG_FIX_KEY_BRIDGE[camel];
    var cL = camel.toLowerCase();
    var sL = snake.toLowerCase();

    if (!exists[cL] || exists[sL]) return;

    var v = valBy[cL];
    if (mg_fix_isEmpty_(v) || mg_fix_isPlaceholderText_(v)) return;

    addK.push([snake]);
    addV.push([v]);
    exists[sL] = true;
  });

  if (addK.length > 0) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, keyCol, addK.length, 1).setValues(addK);
    sh.getRange(start, valCol, addV.length, 1).setValues(addV);
  }

  Logger.log('[MG_FIX] ' + sheetName + ': appended ' + addK.length + ' config aliases');
  return addK.length;
}

/* ============================================================================
 * SECTION 7 — STRICT-SAFE OVERRIDES
 * ========================================================================== */

function loadStatsFromSheet(sheet) {
  var result = { league: {}, probRange: {}, team: {} };
  if (!sheet) return result;

  function key_(v) {
    return mg_fix_normLower_(v).replace(/[\s_()%\/\-]+/g, '');
  }

  try {
    var data = sheet.getDataRange().getValues();
    if (!data || data.length < 2) return result;

    var headerRow = -1, best = -1;
    for (var r = 0; r < Math.min(15, data.length); r++) {
      var score = 0;
      for (var c = 0; c < data[r].length; c++) {
        var k = key_(data[r][c]);
        if (k === 'league' || k === 'competition' || k === 'name' || k === 'range') score++;
        if (k === 'accuracy' || k === 'acc' || k === 'correct' || k === 'total' || k === 'pct') score++;
      }
      if (score > best) {
        best = score;
        headerRow = r;
      }
    }

    if (headerRow < 0 || best < 2) return result;

    var hdr = data[headerRow];
    var hm = Object.create(null);
    for (var i = 0; i < hdr.length; i++) {
      var hk = key_(hdr[i]);
      if (hk && typeof hm[hk] === 'undefined') hm[hk] = i;
    }

    function findCol_(names) {
      for (var i = 0; i < names.length; i++) {
        var k = key_(names[i]);
        if (typeof hm[k] !== 'undefined') return hm[k];
      }
      return -1;
    }

    var leagueCol = findCol_(['league', 'competition', 'name', 'range']);
    var accCol = findCol_(['accuracy', 'acc', 'pct', 'winrate']);
    var correctCol = findCol_(['correct', 'wins', 'w']);
    var totalCol = findCol_(['total', 'games', 'n', 'count']);

    if (leagueCol < 0) return result;

    for (var rr = headerRow + 1; rr < data.length; rr++) {
      var row = data[rr];
      var label = mg_fix_norm_(row[leagueCol]);
      if (!label) continue;
      if (mg_fix_isPlaceholderText_(label)) continue;
      if (/^(---+|===+|summary|details)$/i.test(label)) continue;

      var acc = (accCol >= 0) ? mg_fix_realNum_(row[accCol]) : null;
      var correct = (correctCol >= 0) ? mg_fix_realNum_(row[correctCol]) : null;
      var total = (totalCol >= 0) ? mg_fix_realNum_(row[totalCol]) : null;

      if (acc !== null && acc >= 0 && acc <= 1) acc = acc * 100;
      if (acc === null && correct !== null && total !== null && total > 0) {
        acc = (correct / total) * 100;
      }

      if (/^\d{1,3}\s*-\s*\d{1,3}%?$/.test(label)) {
        result.probRange[label] = {
          accuracy: acc,
          correct: correct,
          total: total,
          raw: row
        };
        continue;
      }

      if (acc !== null || correct !== null || total !== null) {
        var lk = label.toLowerCase().trim();
        result.league[lk] = {
          winnerAccuracy: (acc !== null) ? Math.round(acc * 10) / 10 : null,
          totalGames: total,
          correctPredictions: correct,
          originalName: label,
          raw: row
        };
        result.league[label] = result.league[lk];
      }
    }
  } catch (e) {
    Logger.log('[loadStatsFromSheet] Error: ' + e.message);
  }

  return result;
}


function loadQuarterWinnerStats(sheet) {
  var result = {};

  // Local safe fallbacks if MG helpers aren't present
  function _norm_(v) { return String(v == null ? '' : v).trim(); }
  function _normLower_(v) { return _norm_(v).toLowerCase(); }
  function _realNum_(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    if (s.indexOf('%') >= 0) {
      var p = parseFloat(s.replace('%', ''));
      return isFinite(p) ? p : null;
    }
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function _normalizeTeam_(name) {
    var s = _normLower_(name);
    return s.replace(/\s+/g, ' ');
  }

  var mg_norm_ = (typeof mg_fix_norm_ === 'function') ? mg_fix_norm_ : _norm_;
  var mg_normLower_ = (typeof mg_fix_normLower_ === 'function') ? mg_fix_normLower_ : _normLower_;
  var mg_realNum_ = (typeof mg_fix_realNum_ === 'function') ? mg_fix_realNum_ : _realNum_;
  var mg_teamSafe_ = (typeof mg_fix_normalizeTeamNameSafe_ === 'function') ? mg_fix_normalizeTeamNameSafe_ : _normalizeTeam_;

  // ─── Self-sufficient: if called with Spreadsheet (or nothing), find the sheet ───
  if (!sheet) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      sheet = ss ? ss.getSheetByName('TeamQuarterStats_Tier2') : null;
    } catch (e) {}
  }
  if (sheet && typeof sheet.getSheetByName === 'function') {
    var ss_ = sheet;
    var sheetNames = ['TeamQuarterStats_Tier2', 'QuarterWinnerStats', 'TeamQuarterStats'];
    sheet = null;
    for (var sn = 0; sn < sheetNames.length; sn++) {
      sheet = ss_.getSheetByName(sheetNames[sn]);
      if (sheet) break;
    }
  }

  if (!sheet) {
    Logger.log('[loadQuarterWinnerStats] No sheet found');
    return result;
  }

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return result;

  var headerRow = 0;
  for (var r = 0; r < Math.min(8, data.length); r++) {
    var txt = data[r].join('|').toLowerCase();
    if (txt.indexOf('team') > -1 && txt.indexOf('quarter') > -1) {
      headerRow = r;
      break;
    }
  }

  var hdr = data[headerRow];
  var hm = Object.create(null);

  for (var i = 0; i < hdr.length; i++) {
    var k = mg_normLower_(hdr[i]).replace(/[\s_%-]+/g, '');
    if (k && typeof hm[k] === 'undefined') hm[k] = i;
  }

  function col_(names) {
    for (var i = 0; i < names.length; i++) {
      var k = mg_normLower_(names[i]).replace(/[\s_%-]+/g, '');
      if (typeof hm[k] !== 'undefined') return hm[k];
    }
    return -1;
  }

  var teamCol    = col_(['team', 'teamname', 'name']);
  var quarterCol = col_(['quarter', 'q', 'qtr', 'period']);
  var winsCol    = col_(['w', 'wins', 'win', 'correct']);
  var lossesCol  = col_(['l', 'losses', 'loss', 'incorrect']);
  var totalCol   = col_(['total', 'games', 'n', 'count', 'gp']);
  var winPctCol  = col_(['win%', 'winpct', 'winrate', 'accuracy', 'pct']);

  if (teamCol < 0 || quarterCol < 0) return result;

  var leagueTotals = Object.create(null);
  var teamData = Object.create(null);

  for (var rr = headerRow + 1; rr < data.length; rr++) {
    var row = data[rr];
    var teamName = mg_norm_(row[teamCol]);
    var quarter = mg_norm_(row[quarterCol]).toUpperCase();

    if (!teamName || !quarter) continue;
    if (/^\d$/.test(quarter)) quarter = 'Q' + quarter;
    if (!/^Q[1-4]$/.test(quarter)) continue;

    var wins   = (winsCol >= 0)   ? mg_realNum_(row[winsCol])   : null;
    var losses = (lossesCol >= 0) ? mg_realNum_(row[lossesCol]) : null;
    var total  = (totalCol >= 0)  ? mg_realNum_(row[totalCol])  : null;
    var winPct = (winPctCol >= 0) ? mg_realNum_(row[winPctCol]) : null;

    if (wins === null) wins = 0;
    if (losses === null) losses = 0;
    if (wins < 0) wins = 0;
    if (losses < 0) losses = 0;

    if (total === null || total <= 0) {
      total = wins + losses;
    }

    if (wins === 0 && losses === 0 && winPct !== null && isFinite(winPct) && total > 0) {
      var pct = winPct;
      if (pct > 0 && pct <= 1) pct = pct * 100;
      wins = Math.round((pct / 100) * total);
      losses = total - wins;
    }

    if (total < 0) total = 0;

    var tk = mg_teamSafe_(teamName);
    if (!teamData[tk]) teamData[tk] = {};
    teamData[tk][quarter] = {
      wins: wins,
      losses: losses,
      total: total,
      accuracy: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0
    };
    teamData[teamName] = teamData[tk];

    if (!leagueTotals[quarter]) leagueTotals[quarter] = { wins: 0, total: 0 };
    leagueTotals[quarter].wins += wins;
    leagueTotals[quarter].total += total;
  }

  Object.keys(teamData).forEach(function(k) {
    result[k] = teamData[k];
  });

  var leagueAgg = Object.create(null);
  Object.keys(leagueTotals).forEach(function(q) {
    var x = leagueTotals[q];
    leagueAgg[q] = {
      wins: x.wins,
      total: x.total,
      accuracy: x.total > 0 ? Math.round((x.wins / x.total) * 1000) / 10 : 0,
      sampleSize: x.total
    };
  });

  result.aggregate = leagueAgg;
  result.league = leagueAgg;
  result.overall = leagueAgg;

  return result;
}




function calculateFormDifference_(homeStreak, awayStreak, homeL10, awayL10) {
  function parseStreak_(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var s = mg_fix_norm_(v);
    if (!s || mg_fix_isPlaceholderText_(s)) return 0;

    var wl = s.match(/^([WL])\s*(\d+)$/i);
    if (wl) {
      var n = parseInt(wl[2], 10);
      if (!isFinite(n)) return 0;
      return wl[1].toUpperCase() === 'W' ? n : -n;
    }

    var wonLost = s.match(/^(WON|LOST)\s*(\d+)$/i);
    if (wonLost) {
      var n2 = parseInt(wonLost[2], 10);
      if (!isFinite(n2)) return 0;
      return wonLost[1].toUpperCase() === 'WON' ? n2 : -n2;
    }

    var n3 = mg_fix_realNum_(s);
    return (n3 === null) ? 0 : n3;
  }

  function parseL10_(record) {
    var s = mg_fix_norm_(record);
    if (!s || mg_fix_isPlaceholderText_(s)) return 0.5;
    var m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) return 0.5;

    var w = parseInt(m[1], 10);
    var l = parseInt(m[2], 10);
    if (!isFinite(w) || !isFinite(l)) return 0.5;

    var t = w + l;
    return (t > 0) ? (w / t) : 0.5;
  }

  var hS = parseStreak_(homeStreak);
  var aS = parseStreak_(awayStreak);
  var h10 = parseL10_(homeL10);
  var a10 = parseL10_(awayL10);

  var streakFactor = (hS - aS) * 0.5;
  var l10Factor = (h10 - a10) * 10;
  return streakFactor + l10Factor;
}

function calculateVariancePenalty_(homeTeam, awayTeam, varianceMap) {
  varianceMap = varianceMap || {};

  var homeKey = mg_fix_normalizeTeamNameSafe_(homeTeam);
  var awayKey = mg_fix_normalizeTeamNameSafe_(awayTeam);

  function readVar_(k) {
    var v = varianceMap[k];
    var n = mg_fix_realNum_(v);
    return (n !== null && n > 0) ? n : null;
  }

  var hv = readVar_(homeKey);
  var av = readVar_(awayKey);

  if (hv === null && av === null) return 0;

  var useH = (hv !== null) ? hv : av;
  var useA = (av !== null) ? av : hv;

  var avg = (useH + useA) / 2;
  var p = avg / 20;
  if (!isFinite(p) || p < 0) return 0;
  return Math.min(1, p);
}



/**
 * CONSOLIDATED DROP-IN: _selectSnipers (single definition)
 * ---------------------------------------------------------------------------
 * Fixes your issue: you currently have TWO _selectSnipers() in the project.
 * The second one ("HIGH_QTR: Always include") is the one that keeps letting
 * SKIP/low-confidence HQ picks through.
 *
 * This consolidated version:
 *  - Enforces HQ enable flag + hq_gateCheck_ + hq_min_confidence
 *  - Prevents SKIP-tier HQ from printing
 *  - Preserves your existing Margin + OU logic (conf/EV/edge gating + dedup)
 *  - Keeps the same output object fields used by Bet_Slips
 *
 * IMPORTANT:
 * 1) Delete/rename/comment-out every other `function _selectSnipers(...)` in the
 *    entire Apps Script project. There must be EXACTLY ONE.
 * 2) Then paste this one.
 */

if (typeof _selectSnipers === 'function') {
  Logger.log('[WARN] _selectSnipers duplicates');
}

function _selectSnipers(candidates, config, tierCuts) {
  var fn = '_selectSnipers';
  candidates = candidates || [];
  config = config || {};

  // ───────────────────────────────────────────────
  // Helpers (safe even if some project helpers are missing)
  // ───────────────────────────────────────────────
  function toNum_(v, d) {
    // prefer project numeric sanitizer if present
    try {
      if (typeof mg_fix_realNum_ === 'function') {
        var nn = mg_fix_realNum_(v);
        return (nn === null) ? d : nn;
      }
    } catch (e) {}
    var n = parseFloat(String(v).replace('%', '').replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : d;
  }

  function toBool_(v, d) {
    if (v === true || v === false) return v;
    if (v === null || v === undefined || v === '') return d;
    var s = String(v).toLowerCase().trim();
    if (s === 'true' || s === 'yes' || s === '1' || s === 'on') return true;
    if (s === 'false' || s === 'no' || s === '0' || s === 'off') return false;
    return d;
  }

  function normMatch_(s) {
    if (typeof _m8_normMatch_ === 'function') return _m8_normMatch_(s);
    if (typeof mg_fix_normLower_ === 'function') return mg_fix_normLower_(s);
    return String(s || '').toLowerCase().trim();
  }

  function normOUPickKey_(matchKey, pick) {
    if (typeof _m8_normOUPickKey_ === 'function') return _m8_normOUPickKey_(matchKey, pick);
    return matchKey + '|' + String(pick || '').toLowerCase().trim();
  }

  function tierBonus_(gameTier) {
    if (typeof _m8_tierBonus_ === 'function') return _m8_tierBonus_(gameTier);
    return 0;
  }

  function getTier_(conf) {
    // prefer existing tier system
    if (typeof _m8_getTier_ === 'function') return _m8_getTier_(conf, tierCuts);
    if (typeof getTierObject === 'function') {
      var t = getTierObject(conf);
      return t ? t.tier : null;
    }
    return null;
  }

  function alignPick_(pick, tier) {
    if (typeof _m8_alignPick_ === 'function') return _m8_alignPick_(pick, tier);
    return pick;
  }

  // ───────────────────────────────────────────────
  // Config thresholds
  // ───────────────────────────────────────────────
  var minMargin = toNum_(config.sniperMinMargin, 6);

  var minConf = toNum_(config.ouMinConf, toNum_(config.ou_min_conf, 60));
  var minEV   = toNum_(config.ouMinEV,   toNum_(config.ou_min_ev, 0));
  var minEdge = toNum_(config.minEdgeScore, toNum_(config.min_edge_score, 0));

  var preferStrong = (config.preferStrongTier !== false);

  // HQ controls
  var hqEnabled = toBool_(config.hqEnabled,
                  toBool_(config.hq_enabled,
                    toBool_(config.includeHighestQuarter, true)));

  var hqMinConf = toNum_(config.hqMinConfidence,
                  toNum_(config.hq_min_confidence, 55));

  // ───────────────────────────────────────────────
  // Main selection
  // ───────────────────────────────────────────────
  var snipers = [];
  var addedOUPicks = Object.create(null);

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c) continue;

    var matchKey = normMatch_(c.match);

    // ─────────────────────────────────────────────
    // HIGH_QTR (gated)
    // ─────────────────────────────────────────────
    if (c.signalType === 'HIGH_QTR') {
      if (!hqEnabled) continue;

      var hqConf = toNum_(c.confidence, NaN);
      if (!isFinite(hqConf)) continue;

      // hard confidence floor
      if (hqConf < hqMinConf) continue;

      // run HQ gate defensively (uses pWin/rel/tie/etc if present)
      if (typeof hq_gateCheck_ === 'function') {
        var gate = hq_gateCheck_(c, config);
        if (!gate || gate.pass !== true) continue;
      }

      // suppress SKIP tier explicitly
      var hqTierObj = (typeof getTierObject === 'function') ? getTierObject(hqConf) : null;
      if (hqTierObj && String(hqTierObj.tier || '').toUpperCase() === 'SKIP') continue;

      snipers.push({
        league: c.league,
        date: c.date,
        time: c.time,
        match: c.match,
        pick: c.pick,
        type: 'SNIPER HIGH QTR',
        confidence: hqConf,
        ev: '-',
        gameTier: c.gameTier,
        star: false,
        sortPriority: 2,
        sortValue: hqConf,
        isHighQtr: true,
        hqSource: c.hqSource || null,
        tier: hqTierObj ? hqTierObj.tier : null,
        tierDisplay: hqTierObj ? hqTierObj.display : null
      });
      continue;
    }

    // ─────────────────────────────────────────────
    // MARGIN
    // ─────────────────────────────────────────────
    if (c.signalType === 'MARGIN') {
      var mm = String(c.pick || '').match(/[+-]([\d.]+)/);
      if (!mm) continue;

      var margin = toNum_(mm[1], NaN);
      if (!isFinite(margin) || margin < minMargin) continue;

      var tierM = getTier_(toNum_(c.confidence, 0));
      var bonusM = preferStrong ? tierBonus_(c.gameTier) : 0;

      snipers.push({
        league: c.league,
        date: c.date,
        time: c.time,
        match: c.match,
        pick: alignPick_(c.pick, tierM),
        type: 'SNIPER MARGIN',
        confidence: c.confidence,
        ev: '-',
        gameTier: c.gameTier,
        star: false,
        sortPriority: 3,
        sortValue: bonusM + toNum_(c.confidence, 0),
        isHighQtr: false
      });
      continue;
    }

    // ─────────────────────────────────────────────
    // O/U (OU, OU_STAR, OU_DIR)
    // ─────────────────────────────────────────────
    if (c.signalType === 'OU' || c.signalType === 'OU_STAR' || c.signalType === 'OU_DIR') {
      var conf = toNum_(c.confidence, NaN);
      var ev   = toNum_(c.ev, NaN);
      var edge = toNum_(c.edge, NaN);

      // Gate: must meet conf OR EV threshold (treat NaN as 0)
      var confVal = isFinite(conf) ? conf : 0;
      var evVal   = isFinite(ev)   ? ev   : 0;

      if (confVal < minConf && evVal < minEV) continue;

      // Edge gating
      if (minEdge > 0) {
        if (isFinite(edge)) {
          // if edge is explicitly provided and below minEdge, reject
          if (edge < minEdge && edge !== 0) continue;
          // edge==0 means "unknown/flat" in your pipeline sometimes; then rely on EV
          if (edge === 0 && evVal < minEV) continue;
        } else {
          if (evVal < minEV) continue;
        }
      }

      // Dedup by (match + canonical pick)
      var normKey = normOUPickKey_(matchKey, c.pick);
      if (addedOUPicks[normKey]) continue;
      addedOUPicks[normKey] = true;

      var typeLabel = 'SNIPER O/U';
      var priority = 3;
      if (c.star) { typeLabel = 'SNIPER O/U STAR'; priority = 1; }
      else if (c.signalType === 'OU_DIR') { typeLabel = 'SNIPER O/U DIR'; priority = 2; }

      var tierOU = getTier_(confVal);
      var bonusOU = preferStrong ? tierBonus_(c.gameTier) : 0;

      snipers.push({
        league: c.league,
        date: c.date,
        time: c.time,
        match: c.match,
        pick: alignPick_(c.pick, tierOU),
        type: typeLabel,
        confidence: isFinite(conf) ? conf : null,
        ev: evVal > 0 ? evVal.toFixed(1) + '%' : 'N/A',
        gameTier: c.gameTier,
        star: !!c.star,
        sortPriority: priority,
        sortValue: bonusOU + (c.star ? 100000 : 0) + (evVal > 0 ? evVal : confVal),
        isHighQtr: false
      });
    }
  }

  // Sort by priority ASC, then value DESC
  snipers.sort(function(a, b) {
    if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
    return (b.sortValue || 0) - (a.sortValue || 0);
  });

  var hqCount = snipers.filter(function(s) { return s && s.isHighQtr; }).length;
  Logger.log('[' + fn + '] ' + candidates.length + ' candidates → ' +
             snipers.length + ' snipers (HQ: ' + hqCount + ')' +
             ' | HQ(minConf=' + hqMinConf + ', enabled=' + hqEnabled + ')');

  return snipers;
}


function _selectBankers(candidates, config) {
  candidates = candidates || [];
  config = config || {};

  function cfgNum_(a, b) {
    var v = mg_fix_realNum_(config[a]);
    if (v === null && b) v = mg_fix_realNum_(config[b]);
    return v;
  }

  var threshold = cfgNum_('bankerThreshold', 'banker_threshold');
  var minOdds = cfgNum_('minBankerOdds', 'min_banker_odds');
  var maxOdds = cfgNum_('maxBankerOdds', 'max_banker_odds');

  if (threshold === null || minOdds === null || maxOdds === null) return [];

  var bankers = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c) continue;

    var conf = mg_fix_realNum_(c.confidence);
    var odds = mg_fix_realNum_(c.odds);
    if (conf === null || odds === null) continue;

    if (conf >= threshold && odds >= minOdds && odds <= maxOdds) {
      var ev = (odds > 0) ? ((odds - 1) * (conf / 100)) : null;
      bankers.push({
        league: c.league,
        date: c.date,
        time: c.time,
        match: c.match,
        pick: c.pick,
        odds: odds,
        confidence: conf,
        ev: (ev !== null && isFinite(ev) && ev > 0) ? ev.toFixed(3) : 'N/A',
        type: 'BANKER'
      });
    }
  }

  bankers.sort(function(a, b) {
    var evA = parseFloat(a.ev) || 0;
    var evB = parseFloat(b.ev) || 0;
    if (evA !== evB) return evB - evA;
    return (b.confidence || 0) - (a.confidence || 0);
  });

  return bankers;
}

function loadStandings(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  var sheet = mg_fix_getSheetInsensitive_(ss, 'Standings');
  var standings = Object.create(null);
  if (!sheet) return standings;

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return standings;

  function normHeader_(v) {
    return mg_fix_normLower_(v).replace(/[^a-z0-9]/g, '');
  }

  function isHeaderRow_(row) {
    var hasTeam = false, hasStat = false;
    for (var i = 0; i < row.length; i++) {
      var h = normHeader_(row[i]);
      if (h === 'team' || h === 'teamname' || h === 'name') hasTeam = true;
      if (h === 'w' || h === 'wins' || h === 'gp' || h === 'games' || h === 'pct' || h === 'winpct') hasStat = true;
    }
    return hasTeam && hasStat;
  }

  function isSectionLabel_(row) {
    var first = normHeader_(row[0]);
    return {
      west: 1, east: 1, western: 1, eastern: 1,
      westernconference: 1, easternconference: 1,
      atlantic: 1, central: 1, southeast: 1,
      northwest: 1, pacific: 1, southwest: 1,
      conference: 1, division: 1
    }[first] === 1;
  }

  function isEmptyRow_(row) {
    for (var i = 0; i < row.length; i++) {
      if (!mg_fix_isEmpty_(row[i]) && mg_fix_norm_(row[i]) !== '') return false;
    }
    return true;
  }

  function parseWL_(v) {
    var s = mg_fix_norm_(v);
    if (!s || mg_fix_isPlaceholderText_(s)) return null;
    var m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) return null;

    var w = parseInt(m[1], 10);
    var l = parseInt(m[2], 10);
    if (!isFinite(w) || !isFinite(l)) return null;

    var t = w + l;
    return { wins: w, losses: l, pct: t > 0 ? (w / t) : 0.5 };
  }

  function parseStreak_(v) {
    var s = mg_fix_norm_(v).toUpperCase();
    if (!s || mg_fix_isPlaceholderText_(s)) return 0;

    var m = s.match(/^(W|WON|L|LOST)\s*(\d+)$/i);
    if (m) {
      var n = parseInt(m[2], 10);
      if (!isFinite(n)) return 0;
      return m[1].charAt(0) === 'W' ? n : -n;
    }

    var num = mg_fix_realNum_(s);
    return num === null ? 0 : num;
  }

  function buildColMap_(headerRow) {
    var map = Object.create(null);
    var aliases = {
      rank: ['position', 'pos', 'rank', 'rk', '#'],
      team: ['teamname', 'team', 'name', 'club'],
      gp: ['gp', 'games', 'gamesplayed', 'g', 'mp'],
      wins: ['w', 'wins', 'win'],
      losses: ['l', 'losses', 'loss'],
      pf: ['pf', 'pts', 'pointsfor', 'ppg', 'ptsfor'],
      pa: ['pa', 'pointsagainst', 'papg', 'opp', 'ptsagainst'],
      pct: ['pct', 'winpct', 'wpct', 'percentage'],
      streak: ['streak', 'strk', 'str'],
      l10: ['l10', 'last10', 'lastten'],
      home: ['home', 'homerec', 'homerecord'],
      away: ['away', 'road', 'awayrec', 'roadrec', 'awayrecord'],
      netRtg: ['netrtg', 'netrating', 'net']
    };

    for (var c = 0; c < headerRow.length; c++) {
      var h = normHeader_(headerRow[c]);
      if (!h) continue;

      Object.keys(aliases).forEach(function(field) {
        if (typeof map[field] !== 'undefined') return;
        for (var i = 0; i < aliases[field].length; i++) {
          if (h === aliases[field][i]) {
            map[field] = c;
            break;
          }
        }
      });
    }

    return map;
  }

  function cell_(row, idx) {
    if (typeof idx === 'undefined' || idx === null) return '';
    return row[idx];
  }

  var colMap = null;
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    if (isEmptyRow_(row)) continue;
    if (isSectionLabel_(row)) continue;

    if (isHeaderRow_(row)) {
      colMap = buildColMap_(row);
      continue;
    }

    if (!colMap || typeof colMap.team === 'undefined') continue;

    var teamRaw = mg_fix_norm_(cell_(row, colMap.team));
    if (!teamRaw) continue;

    var key = mg_fix_normalizeTeamNameSafe_(teamRaw);

    var gp = mg_fix_realNum_(cell_(row, colMap.gp));
    var w = mg_fix_realNum_(cell_(row, colMap.wins));
    var l = mg_fix_realNum_(cell_(row, colMap.losses));
    var pf = mg_fix_realNum_(cell_(row, colMap.pf));
    var pa = mg_fix_realNum_(cell_(row, colMap.pa));
    var rank = mg_fix_realNum_(cell_(row, colMap.rank));

    if (rank === null) rank = 15;

    var pct = mg_fix_realNum_(cell_(row, colMap.pct));
    if (pct !== null && pct > 1 && pct <= 100) pct = pct / 100;
    if ((pct === null || !isFinite(pct) || pct < 0 || pct > 1) && w !== null && l !== null) {
      var t = w + l;
      pct = (t > 0) ? (w / t) : 0.5;
    }
    if (pct === null || !isFinite(pct) || pct < 0 || pct > 1) pct = 0.5;

    var netRtg = 0;
    if (typeof colMap.netRtg !== 'undefined') {
      var rawNet = mg_fix_realNum_(cell_(row, colMap.netRtg));
      if (rawNet !== null) netRtg = rawNet;
    } else if (gp !== null && gp > 0 && pf !== null && pa !== null) {
      netRtg = (pf - pa) / gp;
    }

    var streak = (typeof colMap.streak !== 'undefined') ? parseStreak_(cell_(row, colMap.streak)) : 0;

    var l10Pct = pct;
    if (typeof colMap.l10 !== 'undefined') {
      var wl10 = parseWL_(cell_(row, colMap.l10));
      if (wl10) l10Pct = wl10.pct;
    }

    var homePct = pct;
    if (typeof colMap.home !== 'undefined') {
      var wh = parseWL_(cell_(row, colMap.home));
      if (wh) homePct = wh.pct;
    }

    var awayPct = pct;
    if (typeof colMap.away !== 'undefined') {
      var wa = parseWL_(cell_(row, colMap.away));
      if (wa) awayPct = wa.pct;
    }

    standings[key] = {
      teamName: teamRaw,
      rank: rank,
      pct: pct,
      netRtg: netRtg,
      wl: (w !== null && l !== null) ? (w + '-' + l) : '',
      wins: (w !== null) ? w : 0,
      losses: (l !== null) ? l : 0,
      homePct: homePct,
      awayPct: awayPct,
      l10Pct: l10Pct,
      streak: streak,
      gp: (gp !== null) ? gp : 0,
      pf: (pf !== null) ? pf : 0,
      pa: (pa !== null) ? pa : 0
    };

    standings[teamRaw] = standings[key];
  }

  return standings;
}

function loadStandingsAsRankings_(ss) {
  return loadStandings(ss);
}

function getTeamStanding(standingsMap, teamName, ss) {
  if (!standingsMap) standingsMap = loadStandings(ss);

  var key = mg_fix_normalizeTeamNameSafe_(teamName);
  if (standingsMap[key]) return standingsMap[key];
  if (standingsMap[teamName]) return standingsMap[teamName];

  for (var mapKey in standingsMap) {
    if (!standingsMap.hasOwnProperty(mapKey)) continue;
    var mk = mg_fix_normalizeTeamNameSafe_(mapKey);
    if (mk === key || mk.indexOf(key) !== -1 || key.indexOf(mk) !== -1) {
      Logger.log('[getTeamStanding] Partial match: "' + key + '" → "' + mapKey + '"');
      return standingsMap[mapKey];
    }
  }

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

/* ============================================================================
 * SECTION 8 — CACHE CLEAR / RUNNER WRAPS
 * ========================================================================== */

function mg_fix_clearCaches_(log) {
  log = log || [];
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  var fns = ['clearAllTier2CachesAndState', 'clearAllTier2Caches', 'clearAllCaches'];
  for (var i = 0; i < fns.length; i++) {
    if (typeof g[fns[i]] === 'function') {
      try {
        g[fns[i]]({ toast: false });
        log.push('[OK] ' + fns[i] + '()');
        return;
      } catch (e) {
        log.push('[WARN] ' + fns[i] + '() failed: ' + e.message);
      }
    }
  }

  var globals = ['CONFIG_TIER1', 'CONFIG_TIER2', 'CONFIG_TIER2_META', 'T2_SHARED_GAME_CONTEXT', 'TIER1_CACHE', '_T2_CONFIG_CACHE'];
  var cleared = [];

  globals.forEach(function(n) {
    try {
      if (typeof g[n] !== 'undefined') {
        g[n] = null;
        cleared.push(n);
      }
    } catch (e2) {}
  });

  if (cleared.length) log.push('[OK] Nulled globals: ' + cleared.join(', '));
}

function mg_fix_wrapFunction_(fnName, kind) {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var st = g.__MG_STRICT_STATE;
  if (!st) return;
  if (typeof g[fnName] !== 'function') return;

  var key = 'WRAP|' + fnName;
  if (st.wrapped[key]) return;

  st.orig[fnName] = st.orig[fnName] || g[fnName];
  var orig = st.orig[fnName];

  if (kind === 'main') {
    g[fnName] = function() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var log = [];

      MG_ZF_installNumericGuards_({ mode: MG_STRICT_GUARD_MODE });

      try { mg_fix_bridgeConfigAliases_(ss, 'Config_Tier1'); } catch (e1) {}
      try { mg_fix_bridgeConfigAliases_(ss, 'Config_Tier2'); } catch (e2) {}
      try { mg_fix_clearCaches_(log); } catch (e3) {}
      try { mg_fix_repairUpcomingClean_(ss, { mode: 'PRE' }); } catch (e4) {}

      var out = orig.apply(this, arguments);

      try {
        mg_fix_repairUpcomingClean_(ss, { mode: 'POST' });
        mg_fix_verifyUpcomingCleanHeaders_();
      } catch (e5) {}

      return out;
    };
  } else if (kind === 'stage') {
    g[fnName] = function() {
      var ss = SpreadsheetApp.getActiveSpreadsheet();

      MG_ZF_installNumericGuards_({ mode: MG_STRICT_GUARD_MODE });
      try { mg_fix_repairUpcomingClean_(ss, { mode: 'PRE' }); } catch (e1) {}

      var out = orig.apply(this, arguments);

      try { mg_fix_repairUpcomingClean_(ss, { mode: 'POST' }); } catch (e2) {}
      return out;
    };
  } else {
    g[fnName] = function() {
      MG_ZF_installNumericGuards_({ mode: MG_STRICT_GUARD_MODE });
      return orig.apply(this, arguments);
    };
  }

  st.wrapped[key] = true;
}

/* ============================================================================
 * SECTION 9 — MANUAL ENTRYPOINTS / DIAGNOSTICS
 * ========================================================================== */

function MG_FIX_STRICT_REPAIR_ONLY() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  MG_ZF_installNumericGuards_({ mode: MG_STRICT_GUARD_MODE });
  try { mg_fix_bridgeConfigAliases_(ss, 'Config_Tier1'); } catch (e1) {}
  try { mg_fix_bridgeConfigAliases_(ss, 'Config_Tier2'); } catch (e2) {}
  mg_fix_repairUpcomingClean_(ss, { mode: 'PRE' });
  mg_fix_repairUpcomingClean_(ss, { mode: 'POST' });
  mg_fix_verifyUpcomingCleanHeaders_();
  Logger.log('[MG_FIX] STRICT repair only complete.');
}

function MG_FIX_WORKBOOK_SANITY_CHECK(sheetNames) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  sheetNames = sheetNames || [
    'UpcomingClean',
    'Standings',
    'Stats',
    'Bet_Slips',
    'Tier2_Accuracy',
    'ResultsClean'
  ];

  var out = [];
  out.push(['Sheet', 'Exists', 'Rows', 'Cols', 'Header Sample (first 12)']);

  sheetNames.forEach(function(n) {
    var sh = mg_fix_getSheetInsensitive_(ss, n);
    if (!sh) {
      out.push([n, 'NO', '', '', '']);
      return;
    }
    var lr = sh.getLastRow();
    var lc = sh.getLastColumn();
    var hdr = (lc > 0) ? sh.getRange(1, 1, 1, Math.min(12, lc)).getValues()[0] : [];
    out.push([n, 'YES', lr, lc, hdr.join(' | ')]);
  });

  var rep = ss.getSheetByName('MG_FIX_SANITY');
  if (!rep) rep = ss.insertSheet('MG_FIX_SANITY');
  rep.clear();
  rep.getRange(1, 1, out.length, out[0].length).setValues(out);
  rep.setFrozenRows(1);
  rep.autoResizeColumns(1, 5);
}

/* Optional compatibility aliases */
function ZF_REPAIR_ONLY() { return MG_FIX_STRICT_REPAIR_ONLY(); }
function MG_FIX_PRE_STAGE() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return mg_fix_repairUpcomingClean_(ss, { mode: 'PRE' });
}
function MG_FIX_POST_STAGE() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return mg_fix_repairUpcomingClean_(ss, { mode: 'POST' });
}

/* ============================================================================
 * SECTION 10 — INSTALL
 * ========================================================================== */

function INSTALL_MG_STRICT_ZERO_FALLBACK_PATCH() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var st = g.__MG_STRICT_STATE;
  if (!st || st.installed) return;

  MG_ZF_installNumericGuards_({ mode: MG_STRICT_GUARD_MODE });

  MG_STRICT_MAIN_RUNNERS.forEach(function(fn) {
    mg_fix_wrapFunction_(fn, 'main');
  });

  MG_STRICT_STAGE_RUNNERS.forEach(function(fn) {
    mg_fix_wrapFunction_(fn, 'stage');
  });

  MG_STRICT_BASIC_RUNNERS.forEach(function(fn) {
    mg_fix_wrapFunction_(fn, 'basic');
  });

  st.installed = true;
  Logger.log('[MG_ZF] Multi-league strict patch installed. Version=' + ZERO_FALLBACK_OVERLAY_VERSION + ' GuardMode=' + MG_STRICT_GUARD_MODE);
}

INSTALL_MG_STRICT_ZERO_FALLBACK_PATCH();


/**
 * =============================================================================
 * MG STRICT PATCH — COMPATIBILITY + HEADER-VERIFY HOTFIX
 * Load AFTER the multi-league strict overlay
 * =============================================================================
 */

/* ---------------------------------------------------------------------------
 * 1) Legacy compatibility sentinels so older pipelines detect the overlay
 * ------------------------------------------------------------------------- */
(function MG_STRICT_compatBoot_() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  /* Neutral sentinels */
  g.ZERO_FALLBACK_OVERLAY_ACTIVE = true;
  g.ZERO_FALLBACK_OVERLAY_VERSION = g.ZERO_FALLBACK_OVERLAY_VERSION || 'MULTI-LEAGUE-STRICT-2.0';

  /* Legacy/compat aliases for old NBA-branded detection code */
  g.MG_NBA_STRICT_ZERO_FALLBACK_PATCH = true;
  g.MG_STRICT_ZERO_FALLBACK_PATCH = true;
  g.MG_NBA_STRICT_PATCH_ACTIVE = true;
  g.MG_STRICT_PATCH_ACTIVE = true;
  g.MG_NBA_STRICT_PATCH_VERSION = g.ZERO_FALLBACK_OVERLAY_VERSION;
  g.MG_MULTI_LEAGUE_STRICT_VERSION = g.ZERO_FALLBACK_OVERLAY_VERSION;

  /* A few likely detection helpers */
  g.IS_ZERO_FALLBACK_OVERLAY_ACTIVE = g.IS_ZERO_FALLBACK_OVERLAY_ACTIVE || function() {
    return true;
  };
  g.IS_MG_STRICT_ZERO_FALLBACK_PATCH_ACTIVE = function() {
    return true;
  };
  g.IS_MG_NBA_STRICT_ZERO_FALLBACK_PATCH_ACTIVE = function() {
    return true;
  };
})();

/* ---------------------------------------------------------------------------
 * 2) Make verifier smarter:
 *    only flag duplicate base keys if there are MULTIPLE unsuffixed headers
 *    for the same canonical key.
 * ------------------------------------------------------------------------- */
function mg_fix_verifyUpcomingCleanHeaders_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = mg_fix_getSheetInsensitive_(ss, 'UpcomingClean');
  if (!sh) return;

  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return;

  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var groups = Object.create(null);

  for (var i = 0; i < hdr.length; i++) {
    var raw = mg_fix_norm_(hdr[i]);
    if (!raw) continue;

    var base = mg_fix_stripDupSuffix_(raw);
    var key = mg_fix_normKey_(base);
    if (!key) continue;

    if (!groups[key]) {
      groups[key] = {
        cols: [],
        raw: [],
        unsuffixed: []
      };
    }

    groups[key].cols.push(i + 1);
    groups[key].raw.push(raw);

    var isDupMarked = /__dup\d+$/i.test(raw) || /\(\s*dup\s*\d+\s*\)\s*$/i.test(raw);
    if (!isDupMarked) groups[key].unsuffixed.push(i + 1);
  }

  var offenders = [];
  Object.keys(groups).forEach(function(k) {
    var g = groups[k];

    /* Only a real problem if same canonical key appears in more than one
       unsuffixed header. If one is canonical and others are __DUPn, that's fine. */
    if (g.unsuffixed.length > 1) {
      offenders.push(k + '@C' + g.unsuffixed.join(',C'));
    }
  });

  if (offenders.length === 0) {
    Logger.log('[MG_FIX] UpcomingClean header scan clean (canonical duplicate policy).');
  } else {
    Logger.log('[MG_FIX] UpcomingClean UNSUFFIXED duplicate base-key headers remain -> ' +
      offenders.slice(0, 50).join(', '));
  }
}

/* ---------------------------------------------------------------------------
 * 3) Optional helper: inspect UpcomingClean headers with duplicate status
 * ------------------------------------------------------------------------- */
function MG_DEBUG_UPCOMING_HEADERS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = mg_fix_getSheetInsensitive_(ss, 'UpcomingClean');
  if (!sh) {
    Logger.log('[MG_DEBUG] UpcomingClean not found');
    return;
  }

  var lastCol = sh.getLastColumn();
  if (lastCol < 1) {
    Logger.log('[MG_DEBUG] UpcomingClean has no columns');
    return;
  }

  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var out = [['Col', 'RawHeader', 'BaseHeader', 'Key', 'IsDupMarked', 'Eligible']];

  for (var i = 0; i < hdr.length; i++) {
    var raw = mg_fix_norm_(hdr[i]);
    var base = mg_fix_stripDupSuffix_(raw);
    var key = mg_fix_normKey_(base);
    var isDupMarked = /__dup\d+$/i.test(raw) || /\(\s*dup\s*\d+\s*\)\s*$/i.test(raw);
    var eligible = mg_fix_isEligibleHeader_(raw);
    out.push([i + 1, raw, base, key, isDupMarked ? 'YES' : 'NO', eligible ? 'YES' : 'NO']);
  }

  var rep = ss.getSheetByName('MG_DEBUG_UPCOMING_HEADERS');
  if (!rep) rep = ss.insertSheet('MG_DEBUG_UPCOMING_HEADERS');
  rep.clear();
  rep.getRange(1, 1, out.length, out[0].length).setValues(out);
  rep.setFrozenRows(1);
  rep.autoResizeColumns(1, out[0].length);

  Logger.log('[MG_DEBUG] Wrote UpcomingClean header debug report: ' + (out.length - 1) + ' columns');
}



/**
 * Normalize a generic returned map into:
 * {
 *   "team key": {
 *     team: "Original Team Name",
 *     q1: number|null,
 *     q2: number|null,
 *     q3: number|null,
 *     q4: number|null
 *   }
 * }
 *
 * This never invents zeros.
 */
function _t2ou_normalizeQuarterStatsMapStrict_(raw, sourceName) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;

  var teamKeys = Object.keys(raw);
  for (var i = 0; i < teamKeys.length; i++) {
    var rawTeamKey = teamKeys[i];
    var teamObj = raw[rawTeamKey];
    if (!teamObj || typeof teamObj !== 'object') continue;

    var normTeamKey = _t2ou_cleanKey_(rawTeamKey);
    if (!normTeamKey) continue;

    var teamName = teamObj.team || rawTeamKey;

    // Case A: already in flat q1/q2/q3/q4 form
    if ('q1' in teamObj || 'q2' in teamObj || 'q3' in teamObj || 'q4' in teamObj) {
      out[normTeamKey] = {
        team: String(teamName).trim(),
        q1: _t2ou_numOrNull_(teamObj.q1),
        q2: _t2ou_numOrNull_(teamObj.q2),
        q3: _t2ou_numOrNull_(teamObj.q3),
        q4: _t2ou_numOrNull_(teamObj.q4)
      };
      continue;
    }

    // Case B: nested quarter objects, e.g. Q1/Q2/Q3/Q4 with accuracy
    var q1 = _t2ou_extractQuarterMetricStrict_(teamObj, ['Q1', 'q1', '1Q', 'Quarter 1']);
    var q2 = _t2ou_extractQuarterMetricStrict_(teamObj, ['Q2', 'q2', '2Q', 'Quarter 2']);
    var q3 = _t2ou_extractQuarterMetricStrict_(teamObj, ['Q3', 'q3', '3Q', 'Quarter 3']);
    var q4 = _t2ou_extractQuarterMetricStrict_(teamObj, ['Q4', 'q4', '4Q', 'Quarter 4']);

    out[normTeamKey] = {
      team: String(teamName).trim(),
      q1: q1,
      q2: q2,
      q3: q3,
      q4: q4
    };
  }

  Logger.log('[T2OU_SHIM_STRICT] Normalized quarter stats from source=' + sourceName +
    ' teams=' + Object.keys(out).length);
  return out;
}


/**
 * Adapt your existing loadTeamQuarterStats(sheet) output, which looks like:
 * {
 *   "Boston Celtics": {
 *     "Q1": { W, L, Total, "Win %", accuracy },
 *     "Q2": { ... },
 *     ...
 *   }
 * }
 *
 * into strict flat q1..q4 form.
 */
function _t2ou_adaptSSoTTeamQuarterStatsStrict_(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;

  var teams = Object.keys(raw);
  for (var i = 0; i < teams.length; i++) {
    var teamName = teams[i];
    var teamObj = raw[teamName];
    if (!teamObj || typeof teamObj !== 'object') continue;

    var teamKey = _t2ou_cleanKey_(teamName);
    if (!teamKey) continue;

    out[teamKey] = {
      team: String(teamName).trim(),
      q1: _t2ou_extractQuarterMetricStrict_(teamObj, ['Q1', 'q1', '1Q', 'Quarter 1']),
      q2: _t2ou_extractQuarterMetricStrict_(teamObj, ['Q2', 'q2', '2Q', 'Quarter 2']),
      q3: _t2ou_extractQuarterMetricStrict_(teamObj, ['Q3', 'q3', '3Q', 'Quarter 3']),
      q4: _t2ou_extractQuarterMetricStrict_(teamObj, ['Q4', 'q4', '4Q', 'Quarter 4'])
    };
  }

  Logger.log('[T2OU_SHIM_STRICT] Adapted SSoT TeamQuarterStats_Tier2 for ' +
    Object.keys(out).length + ' teams');
  return out;
}


/**
 * Extract a quarter metric from nested quarter objects.
 * Preference order:
 * 1) accuracy
 * 2) Win %
 * 3) null
 *
 * Never returns fabricated 0.
 */
function _t2ou_extractQuarterMetricStrict_(teamObj, aliases) {
  if (!teamObj || typeof teamObj !== 'object') return null;

  for (var i = 0; i < aliases.length; i++) {
    var qKey = aliases[i];
    if (!(qKey in teamObj)) continue;

    var qObj = teamObj[qKey];
    if (qObj === null || typeof qObj === 'undefined') return null;

    if (typeof qObj === 'number' || typeof qObj === 'string') {
      return _t2ou_numOrNull_(qObj);
    }

    if (typeof qObj === 'object') {
      if ('accuracy' in qObj) {
        return _t2ou_numOrNull_(qObj.accuracy);
      }
      if ('Win %' in qObj) {
        return _t2ou_numOrNull_(qObj['Win %']);
      }
      if ('winPct' in qObj) {
        return _t2ou_numOrNull_(qObj.winPct);
      }
    }

    return null;
  }

  return null;
}


/**
 * Strict numeric parser:
 * - null/undefined/blank => null
 * - non-numeric => null
 * - numeric => Number(value)
 */
function _t2ou_numOrNull_(v) {
  if (v === null || typeof v === 'undefined') return null;
  if (typeof v === 'string' && v.trim() === '') return null;

  var n = Number(v);
  return isNaN(n) ? null : n;
}


/**
 * Normalizes quarter labels from the sheet to q1/q2/q3/q4.
 */
function _t2ou_normalizeQuarterKey_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (!s) return null;

  if (s === 'q1' || s === '1q' || s === 'quarter 1' || s === '1st quarter') return 'q1';
  if (s === 'q2' || s === '2q' || s === 'quarter 2' || s === '2nd quarter') return 'q2';
  if (s === 'q3' || s === '3q' || s === 'quarter 3' || s === '3rd quarter') return 'q3';
  if (s === 'q4' || s === '4q' || s === 'quarter 4' || s === '4th quarter') return 'q4';

  return null;
}


/**
 * Normalizes team keys for lookup consistency.
 */
function _t2ou_cleanKey_(v) {
  return String(v || '').trim().toLowerCase();
}


/**
 * Case-insensitive sheet lookup.
 */
function _t2ou_getSheetInsensitive_(ss, wantedName) {
  if (!ss) return null;
  var sheets = ss.getSheets();
  var target = String(wantedName || '').trim().toLowerCase();

  for (var i = 0; i < sheets.length; i++) {
    var name = String(sheets[i].getName() || '').trim().toLowerCase();
    if (name === target) return sheets[i];
  }
  return null;
}


/**
 * OVERRIDE (LOAD LAST): Team quarter win-rate stats for O/U smart lines.
 * Output shape (what Module 7 expects):
 * teamStats["Boston Celtics"]["Q1"] = { winPct, total, strength, reliability }
 *
 * Sources:
 * 1) TeamQuarterStats_Tier2 (preferred; schema-correct)
 * 2) Clean sheets rebuild (fallback; needs q1h/q1a etc or combined "X-Y")
 */
function t2ou_loadTeamQuarterStats_(ss, debug) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  debug = (debug === true);
  var FN = 't2ou_loadTeamQuarterStats_';

  function norm_(v) { return String(v == null ? '' : v).trim(); }
  function normKey_(v) { return norm_(v).toLowerCase().replace(/[^a-z0-9%]/g, ''); }
  function toNum_(v) {
    if (v === '' || v == null) return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).trim();
    if (!s) return NaN;
    if (s.toLowerCase() === 'n/a') return NaN;
    if (s.indexOf('%') >= 0) {
      var p = parseFloat(s.replace('%', ''));
      return isFinite(p) ? p : NaN;
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function clamp_(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function getSheet_(name) {
    if (!ss) return null;
    var sh = ss.getSheetByName(name);
    if (sh) return sh;
    var target = name.toLowerCase();
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getName().toLowerCase() === target) return all[i];
    }
    return null;
  }

  function qKey_(v) {
    var s = norm_(v).toUpperCase();
    var m = s.match(/Q?([1-4])/);
    return m ? ('Q' + m[1]) : '';
  }

  // Add lowercase alias without inflating Object.keys()
  function addLowerAliasNonEnum_(obj, key, node) {
    var lk = String(key || '').toLowerCase();
    if (!lk || lk === key) return;
    if (Object.prototype.hasOwnProperty.call(obj, lk)) return;
    try {
      Object.defineProperty(obj, lk, { value: node, enumerable: false, configurable: true });
    } catch (e) {
      // Fallback if defineProperty fails in some edge contexts
      obj[lk] = node;
    }
  }

  // ───────────────────────────────────────────────────────────────
  // SOURCE 1: TeamQuarterStats_Tier2
  // Schema: Team | Venue | Quarter | Wins | Losses | Ties | Win% | Games
  // ───────────────────────────────────────────────────────────────
  var sh = getSheet_('TeamQuarterStats_Tier2');
  if (sh && sh.getLastRow() >= 2) {
    var values = sh.getDataRange().getValues();

    // Find header row
    var headerRow = -1;
    var hm = null;
    for (var r = 0; r < Math.min(values.length, 15); r++) {
      var normed = values[r].map(normKey_);
      var hasTeam = false;
      var hasQuarter = false;
      for (var c = 0; c < normed.length; c++) {
        if (normed[c] === 'team' || normed[c] === 'teamname') hasTeam = true;
        if (normed[c] === 'quarter' || normed[c] === 'qtr' || normed[c] === 'q') hasQuarter = true;
      }
      if (hasTeam && hasQuarter) {
        headerRow = r;
        hm = {};
        for (var c2 = 0; c2 < normed.length; c2++) {
          if (normed[c2] && hm[normed[c2]] === undefined) hm[normed[c2]] = c2;
        }
        break;
      }
    }

    if (headerRow >= 0 && hm) {
      function col_(names) {
        for (var i = 0; i < names.length; i++) {
          var k = normKey_(names[i]);
          if (hm[k] !== undefined) return hm[k];
        }
        // Partial match fallback
        var keys = Object.keys(hm);
        for (var i2 = 0; i2 < names.length; i2++) {
          var target = normKey_(names[i2]);
          for (var j = 0; j < keys.length; j++) {
            if (keys[j].indexOf(target) >= 0) return hm[keys[j]];
          }
        }
        return -1;
      }

      var cTeam    = col_(['team', 'teamname', 'name']);
      var cVenue   = col_(['venue', 'location', 'homeaway']);
      var cQtr     = col_(['quarter', 'qtr', 'q', 'period']);
      var cWins    = col_(['wins', 'win', 'w', 'correct']);
      var cLosses  = col_(['losses', 'loss', 'l', 'incorrect']);
      var cTies    = col_(['ties', 'tie', 'draw', 'draws', 't', 'd']);
      var cWinPct  = col_(['win%', 'winpct', 'winrate', 'accuracy', 'pct']);
      var cGames   = col_(['games', 'total', 'count', 'n', 'gp']);

      if (cTeam >= 0 && cQtr >= 0) {
        // Aggregate across venues: canonicalize by lowercase team key to avoid casing duplicates
        var acc = {};         // canonTeam -> Q -> { wins, losses, ties, games }
        var label = {};       // canonTeam -> first seen label

        for (var ri = headerRow + 1; ri < values.length; ri++) {
          var row = values[ri];
          var teamRaw = norm_(row[cTeam]);
          if (!teamRaw) continue;

          var teamCanon = teamRaw.toLowerCase();
          if (!label[teamCanon]) label[teamCanon] = teamRaw;

          var Q = qKey_(row[cQtr]);
          if (!Q) continue;

          var wins   = (cWins >= 0)   ? toNum_(row[cWins])   : NaN;
          var losses = (cLosses >= 0) ? toNum_(row[cLosses]) : NaN;
          var ties   = (cTies >= 0)   ? toNum_(row[cTies])   : 0;
          var games  = (cGames >= 0)  ? toNum_(row[cGames])  : NaN;
          var winPct = (cWinPct >= 0) ? toNum_(row[cWinPct]) : NaN;

          if (!isFinite(ties)) ties = 0;

          // Reconstruct missing fields from what's available
          if (isFinite(wins) && isFinite(losses)) {
            if (!isFinite(games)) games = wins + losses + ties;
          } else if (isFinite(winPct) && isFinite(games) && games > 0) {
            // Win% might be 0-100 or 0-1
            var pct = winPct;
            if (pct > 0 && pct <= 1) pct = pct * 100;
            wins = Math.round((pct / 100) * games);
            losses = games - wins - ties;
            if (losses < 0) { ties = 0; losses = games - wins; }
          } else {
            continue;
          }

          if (!isFinite(games) || games <= 0) continue;
          if (!isFinite(wins)) wins = 0;
          if (!isFinite(losses)) losses = 0;

          if (!acc[teamCanon]) acc[teamCanon] = {};
          if (!acc[teamCanon][Q]) acc[teamCanon][Q] = { wins: 0, losses: 0, ties: 0, games: 0 };

          acc[teamCanon][Q].wins   += wins;
          acc[teamCanon][Q].losses += losses;
          acc[teamCanon][Q].ties   += ties;
          acc[teamCanon][Q].games  += games;
        }

        // Build output in the shape Module 7 expects
        var out = {};
        var canonTeams = Object.keys(acc);

        for (var ti = 0; ti < canonTeams.length; ti++) {
          var canon = canonTeams[ti];
          var teamName = label[canon] || canon;

          var node = {};
          var hasAny = false;

          for (var q = 1; q <= 4; q++) {
            var QQ = 'Q' + q;
            var a = acc[canon][QQ];
            if (!a || a.games <= 0) continue;

            var wp = (a.wins / a.games) * 100;
            node[QQ] = {
              wins:        a.wins,
              losses:      a.losses,
              ties:        a.ties,
              total:       a.games,
              winPct:      wp,
              strength:    clamp_((wp - 50) / 50, -1, 1),
              reliability: clamp_(a.games / 30, 0, 1)
            };
            hasAny = true;
          }

          if (hasAny) {
            // Enumerate by display label; add lowercase alias non-enumerable
            out[teamName] = node;
            addLowerAliasNonEnum_(out, teamName, node);
          }
        }

        var teamCount = Object.keys(out).length;
        if (teamCount > 0) {
          Logger.log('[' + FN + '] Loaded from TeamQuarterStats_Tier2: ' + teamCount + ' teams');
          if (debug) {
            var keys = Object.keys(out);
            for (var di = 0; di < Math.min(3, keys.length); di++) {
              var dt = keys[di];
              var dq = out[dt];
              if (dq && dq.Q1) {
                Logger.log('[' + FN + ']   ' + dt + ' Q1: winPct=' +
                  dq.Q1.winPct.toFixed(1) + '% total=' + dq.Q1.total +
                  ' strength=' + dq.Q1.strength.toFixed(3));
              }
            }
          }
          return out;
        }

        if (debug) Logger.log('[' + FN + '] TeamQuarterStats_Tier2 parsed but 0 teams had usable data');
      } else {
        if (debug) Logger.log('[' + FN + '] TeamQuarterStats_Tier2 exists but required columns (team/quarter) not found. Headers: ' + JSON.stringify(hm));
      }
    } else {
      if (debug) Logger.log('[' + FN + '] TeamQuarterStats_Tier2 exists but no header row found');
    }
  } else {
    if (debug) Logger.log('[' + FN + '] TeamQuarterStats_Tier2 not found or empty');
  }

  // ───────────────────────────────────────────────────────────────
  // SOURCE 2: Build from clean sheets (fallback)
  // ───────────────────────────────────────────────────────────────
  if (typeof buildTeamQuarterWinStatsFromClean_ === 'function') {
    try {
      var built = buildTeamQuarterWinStatsFromClean_(ss, debug);
      var nBuilt = built ? Object.keys(built).length : 0;
      Logger.log('[' + FN + '] Built from clean sheets: ' + nBuilt + ' teams');
      if (nBuilt > 0) return built;
    } catch (e) {
      Logger.log('[' + FN + '] Clean sheet build failed: ' + e.message);
    }
  }

  // ───────────────────────────────────────────────────────────────
  // SOURCE 3: Legacy loadQuarterWinnerStats (last resort)
  // ───────────────────────────────────────────────────────────────
  if (typeof loadQuarterWinnerStats === 'function') {
    try {
      var legacy = loadQuarterWinnerStats(ss);
      if (legacy && typeof legacy === 'object') {
        var converted = {};
        var lKeys = Object.keys(legacy);
        for (var li = 0; li < lKeys.length; li++) {
          var lk = lKeys[li];
          if (lk === 'aggregate' || lk === 'league' || lk === 'overall' ||
              lk === 'nba' || lk === 'NBA') continue;

          var tData = legacy[lk];
          if (!tData || typeof tData !== 'object') continue;

          var cNode = {};
          var cHas = false;
          for (var q = 1; q <= 4; q++) {
            var QQ = 'Q' + q;
            var qd = tData[QQ];
            if (!qd) continue;

            var total = isFinite(Number(qd.total)) ? Number(qd.total) :
                        (isFinite(Number(qd.wins)) && isFinite(Number(qd.losses)) ?
                         Number(qd.wins) + Number(qd.losses) : 0);
            if (total <= 0) continue;

            var wp = isFinite(Number(qd.accuracy)) ? Number(qd.accuracy) :
                     (isFinite(Number(qd.wins)) ? (Number(qd.wins) / total) * 100 : 50);

            cNode[QQ] = {
              wins:        isFinite(Number(qd.wins)) ? Number(qd.wins) : 0,
              losses:      isFinite(Number(qd.losses)) ? Number(qd.losses) : 0,
              total:       total,
              winPct:      wp,
              strength:    clamp_((wp - 50) / 50, -1, 1),
              reliability: clamp_(total / 30, 0, 1)
            };
            cHas = true;
          }
          if (cHas) converted[lk] = cNode;
        }

        var cCount = Object.keys(converted).length;
        if (cCount > 0) {
          Logger.log('[' + FN + '] Converted from legacy loadQuarterWinnerStats: ' + cCount + ' teams');
          return converted;
        }
      }
    } catch (e3) {
      Logger.log('[' + FN + '] Legacy loadQuarterWinnerStats failed: ' + e3.message);
    }
  }

  Logger.log('[' + FN + '] WARNING: All sources exhausted, returning 0 teams');
  return {};
}
