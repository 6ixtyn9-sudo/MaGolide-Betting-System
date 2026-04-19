/**
 * =====================================================================
 * MODULE 6
 * PROJECT: Ma Golide
 * =====================================================================
 * WHY:
 *   Perform advanced, game-specific analysis using Head-to-Head (H2H)
 *   and Recent Form loops, then write Tier 2 quarter predictions.
 *
 * WHAT:
 *   Orchestrates three big steps:
 *     1) Parse all Tier 2 raw sheets (H2H + Recent).
 *     2) Build venue + quarter specific stats models.
 *     3) Generate Tier 2 margin predictions for UpcomingClean.
 *
 * HOW:
 *   Uses helpers from Module 1 (Helpers.gs) and parsers from
 *   Module 2 (Parsers.gs). All Tier 2 tuning comes from the
 *   canonical loadTier2Config(ss) in Module 1.
 *
 * [FIX - PRESIDENTIAL PATCH]:
 *   - predictQuarters_Tier2 now CALLS logTier2Prediction (was missing!)
 *   - Added input validation and diagnostic logging
 *   - Added pre-flight column checks for UpcomingClean
 *
 * WHERE:
 *   Runs inside each league file (satellite), writing to:
 *     - CleanH2H_*, CleanRecentHome_*, CleanRecentAway_* (via parsers)
 *     - TeamQuarterStats_Tier2 (aggregated stats)
 *     - UpcomingClean (Tier 2 prediction columns t2-q1..t2-q4)
 *     - Tier2_Log (forensic prediction log)
 *
 * NOTE:
 *   This Module 5 implementation supersedes all previous versions.
 * =====================================================================
 */

// =====================================================================
// MODULE-SCOPED CACHES (non-config, performance only)
// =====================================================================
var TIER2_MARGIN_STATS_CACHE = null;
var TIER2_VENUE_STATS_CACHE = null;

/**
 * =====================================================================
 * PUBLIC RUNNER: runAllTier2Parsers_MODIFIED (PATCHED)
 * =====================================================================
 * WHY:
 *   Refresh all Tier 2 clean sheets (H2H + Recent) without immediately
 *   running stats or predictions.
 *
 * PATCH:
 *   - Skips empty raw sheets with logging
 *   - Filters sheets before processing to avoid empty-data errors
 *   - Reports skipped count in final message
 *
 * WHERE:
 *   Reads from RawH2H_*, RawRecentHome_*, RawRecentAway_* and
 *   writes to CleanH2H_*, CleanRecentHome_*, CleanRecentAway_*.
 * =====================================================================
 */
function runAllTier2Parsers_MODIFIED(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  try {
    ss.toast('Parsing all Tier 2 raw sheets…', 'Tier 2 Parsers');

    var sheetInfo = _findTier2Sheets(ss);
    var h2hRawNames     = sheetInfo.h2hRawNames || [];
    var h2hCleanNames   = sheetInfo.h2hCleanNames || [];
    var homeRawNames    = sheetInfo.homeRawNames || [];
    var homeCleanNames  = sheetInfo.homeCleanNames || [];
    var awayRawNames    = sheetInfo.awayRawNames || [];
    var awayCleanNames  = sheetInfo.awayCleanNames || [];

    // ─────────────────────────────────────────────────────────────────
    // PATCH: Filter out empty raw sheets before processing
    // ─────────────────────────────────────────────────────────────────
    var filterResult = _filterEmptyRawSheets(ss, {
      h2hRawNames: h2hRawNames, 
      h2hCleanNames: h2hCleanNames,
      homeRawNames: homeRawNames, 
      homeCleanNames: homeCleanNames,
      awayRawNames: awayRawNames, 
      awayCleanNames: awayCleanNames
    });

    h2hRawNames    = filterResult.h2hRawNames;
    h2hCleanNames  = filterResult.h2hCleanNames;
    homeRawNames   = filterResult.homeRawNames;
    homeCleanNames = filterResult.homeCleanNames;
    awayRawNames   = filterResult.awayRawNames;
    awayCleanNames = filterResult.awayCleanNames;

    var skippedCount = filterResult.skippedCount;
    var totalSheets = h2hRawNames.length + homeRawNames.length + awayRawNames.length;

    if (totalSheets === 0 && skippedCount === 0) {
      Logger.log('runAllTier2Parsers_MODIFIED: No Tier 2 raw sheets found.');
      ss.toast('No Tier 2 raw sheets found.', 'Tier 2 Parsers', 5);
      return { processed: 0, skipped: 0 };
    }

    if (totalSheets === 0 && skippedCount > 0) {
      Logger.log('runAllTier2Parsers_MODIFIED: All ' + skippedCount + ' raw sheets were empty.');
      ss.toast('All ' + skippedCount + ' raw sheets empty (no data to parse).', 'Tier 2 Parsers', 5);
      return { processed: 0, skipped: skippedCount };
    }

    // ─────────────────────────────────────────────────────────────────
    // Run parsers on non-empty sheets only
    // ─────────────────────────────────────────────────────────────────
    _runAllTier2Parsers(
      ss,
      h2hRawNames, h2hCleanNames,
      homeRawNames, homeCleanNames,
      awayRawNames, awayCleanNames
    );

    var msg = 'Tier 2 parsers complete (' + totalSheets + ' sheets)';
    if (skippedCount > 0) {
      msg += ', skipped ' + skippedCount + ' empty';
    }
    msg += '.';

    Logger.log('runAllTier2Parsers_MODIFIED: ' + msg);
    ss.toast(msg, 'Tier 2 Parsers', 5);

    return { processed: totalSheets, skipped: skippedCount };

  } catch (e) {
    Logger.log('runAllTier2Parsers_MODIFIED ERROR: ' + e.message + '\n' + e.stack);
    ui.alert('Tier 2 parsers FAILED: ' + e.message);
    return { processed: 0, skipped: 0, error: e.message };
  }
}

/**
 * =====================================================================
 * HELPER: _filterEmptyRawSheets (NEW)
 * =====================================================================
 * Filters out raw sheet names that have no data (empty or header-only).
 * Returns parallel-filtered arrays for raw/clean names.
 * =====================================================================
 */
function _filterEmptyRawSheets(ss, sheetArrays) {
  var result = {
    h2hRawNames: [],
    h2hCleanNames: [],
    homeRawNames: [],
    homeCleanNames: [],
    awayRawNames: [],
    awayCleanNames: [],
    skippedCount: 0,
    skippedNames: []
  };
  
  // Helper to check if sheet is empty
  function isSheetEmpty(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return true;
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return true; // No data or only header
    
    return false;
  }
  
  // Filter H2H
  for (var i = 0; i < sheetArrays.h2hRawNames.length; i++) {
    var rawName = sheetArrays.h2hRawNames[i];
    if (isSheetEmpty(rawName)) {
      result.skippedCount++;
      result.skippedNames.push(rawName);
      Logger.log('[_filterEmptyRawSheets] Skipping empty: ' + rawName);
    } else {
      result.h2hRawNames.push(rawName);
      result.h2hCleanNames.push(sheetArrays.h2hCleanNames[i]);
    }
  }
  
  // Filter Home
  for (var j = 0; j < sheetArrays.homeRawNames.length; j++) {
    var homeRaw = sheetArrays.homeRawNames[j];
    if (isSheetEmpty(homeRaw)) {
      result.skippedCount++;
      result.skippedNames.push(homeRaw);
      Logger.log('[_filterEmptyRawSheets] Skipping empty: ' + homeRaw);
    } else {
      result.homeRawNames.push(homeRaw);
      result.homeCleanNames.push(sheetArrays.homeCleanNames[j]);
    }
  }
  
  // Filter Away
  for (var k = 0; k < sheetArrays.awayRawNames.length; k++) {
    var awayRaw = sheetArrays.awayRawNames[k];
    if (isSheetEmpty(awayRaw)) {
      result.skippedCount++;
      result.skippedNames.push(awayRaw);
      Logger.log('[_filterEmptyRawSheets] Skipping empty: ' + awayRaw);
    } else {
      result.awayRawNames.push(awayRaw);
      result.awayCleanNames.push(sheetArrays.awayCleanNames[k]);
    }
  }
  
  if (result.skippedCount > 0) {
    Logger.log('[_filterEmptyRawSheets] Total skipped: ' + result.skippedCount);
  }
  
  return result;
}


/**
 * =====================================================================
 * Backwards-compatibility wrapper
 * =====================================================================
 */
function runAllTier2Parsers(ss) {
  return runAllTier2Parsers_MODIFIED(ss);
}

/**
 * =====================================================================
 * PUBLIC RUNNER: runAllTier2DeepDives_MODIFIED
 * =====================================================================
 * WHY:
 *   Main Tier 2 pipeline for a league – from raw H2H/recent sheets
 *   all the way to fresh Tier 2 quarter predictions.
 *
 * WHAT:
 *   1) Parse all Tier 2 raw sheets,
 *   2) Build TeamQuarterStats_Tier2,
 *   3) Build margin stats + write predictions to UpcomingClean.
 *
 * WHERE:
 *   Operates entirely within the active league spreadsheet.
 * =====================================================================
 */
function runAllTier2DeepDives_MODIFIED(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  Logger.log('===== STARTING TIER 2 DEEP DIVE (Presidential Edition) =====');

  clearAllTier2Caches();

  try {
    ss.toast('Step 1/3: Finding all Tier 2 data sheets…', 'Tier 2 Deep Dive');

    const sheetInfo = _findTier2Sheets(ss);
    const h2hRawNames     = sheetInfo.h2hRawNames || [];
    const h2hCleanNames   = sheetInfo.h2hCleanNames || [];
    const homeRawNames    = sheetInfo.homeRawNames || [];
    const homeCleanNames  = sheetInfo.homeCleanNames || [];
    const awayRawNames    = sheetInfo.awayRawNames || [];
    const awayCleanNames  = sheetInfo.awayCleanNames || [];

    const totalSheets = h2hRawNames.length + homeRawNames.length + awayRawNames.length;
    if (totalSheets === 0) {
      Logger.log('No Tier 2 raw sheets found. Skipping Tier 2.');
      ss.toast('No Tier 2 raw sheets found. Skipping.', 'Tier 2 Deep Dive', 5);
      return;
    }

    Logger.log(
      'Found ' + h2hRawNames.length + ' H2H sheets, ' +
      homeRawNames.length + ' Home sheets, ' +
      awayRawNames.length + ' Away sheets.'
    );

    // STEP 1: Parse
    ss.toast('Step 1/3: Parsing all ' + totalSheets + ' Tier 2 data sheets…', 'Tier 2 Deep Dive');
    _runAllTier2Parsers(
      ss,
      h2hRawNames, h2hCleanNames,
      homeRawNames, homeCleanNames,
      awayRawNames, awayCleanNames
    );

    // STEP 2: Build stats
    ss.toast('Step 2/3: Building Tier 2 statistical model…', 'Tier 2 Deep Dive');
    analyzeTier2Stats(ss);

    // STEP 3: Predict
    ss.toast('Step 3/3: Writing Tier 2 predictions…', 'Tier 2 Deep Dive');
    predictQuarters_Tier2(ss);

    Logger.log('===== TIER 2 DEEP DIVE Complete =====');
    ss.toast('Tier 2 "Deep Dive" Complete!', 'Tier 2 Deep Dive', 5);
  } catch (e) {
    clearAllTier2Caches();
    Logger.log('!!! FATAL ERROR in runAllTier2DeepDives_MODIFIED: ' + e.message + ' ' + e.stack);
    ui.alert('Tier 2 Deep Dive FAILED: ' + e.message);
  }
}

// Backwards-compatibility wrapper
function runAllTier2DeepDives(ss) {
  return runAllTier2DeepDives_MODIFIED(ss);
}

/**
 * =====================================================================
 * PUBLIC RUNNER: runTier2Analysis_MODIFIED
 * =====================================================================
 * WHY:
 *   Re-run Tier 2 stats + predictions using existing clean data
 *   (for example, after tweaking Config_Tier2) without reparsing raw.
 *
 * WHERE:
 *   Operates inside the active league spreadsheet.
 * =====================================================================
 */
function runTier2Analysis_MODIFIED(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== RUNNING Tier 2 Analysis (stats + predictions) =====');

  clearAllTier2Caches();
  analyzeTier2Stats(ss);
  predictQuarters_Tier2(ss);

  Logger.log('===== Tier 2 Analysis complete =====');
}

// Backwards-compatibility wrapper
function runTier2Analysis(ss) {
  return runTier2Analysis_MODIFIED(ss);
}

/**
 * ======================================================================
 * PATCHED: _findTier2Sheets
 * ======================================================================
 * WHY: Dynamically discover Tier 2 raw/clean sheet pairs.
 * WHAT: Finds all RawH2H_N, RawRecentHome_N, RawRecentAway_N sheets
 *       and their corresponding Clean counterparts.
 * 
 * PATCH: Limits sheet discovery to active games count from UpcomingClean
 *        to avoid processing empty placeholder sheets (fixes 49 empty sheets issue).
 * 
 * WHERE: Called by runAllTier2Parsers_MODIFIED
 * ======================================================================
 */
function _findTier2Sheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  
  // Get active game count from UpcomingClean to limit discovery
  var numGames = 5; // Default fallback
  try {
    var upcomingSheet = getSheetInsensitive(ss, 'UpcomingClean');
    if (upcomingSheet) {
      var lastRow = upcomingSheet.getLastRow();
      numGames = Math.max(1, lastRow - 1); // Subtract header row
    }
  } catch (e) {
    Logger.log('[_findTier2Sheets] Could not read UpcomingClean, using default limit: ' + e.message);
  }
  
  Logger.log('[_findTier2Sheets] Limiting discovery to ' + numGames + ' games');
  
  var sheets = ss.getSheets();
  
  var h2hRawNames = [];
  var h2hCleanNames = [];
  var homeRawNames = [];
  var homeCleanNames = [];
  var awayRawNames = [];
  var awayCleanNames = [];
  
  // Patterns for matching sheet names
  var h2hRawPattern = /^RawH2H_(\d+)$/i;
  var h2hCleanPattern = /^CleanH2H_(\d+)$/i;
  var homeRawPattern = /^RawRecentHome_(\d+)$/i;
  var homeCleanPattern = /^CleanRecentHome_(\d+)$/i;
  var awayRawPattern = /^RawRecentAway_(\d+)$/i;
  var awayCleanPattern = /^CleanRecentAway_(\d+)$/i;
  
  // Collect all matching sheets with their indices
  var h2hRawMap = {};
  var h2hCleanMap = {};
  var homeRawMap = {};
  var homeCleanMap = {};
  var awayRawMap = {};
  var awayCleanMap = {};
  
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    var match;
    
    match = name.match(h2hRawPattern);
    if (match) {
      var idx = parseInt(match[1], 10);
      if (idx <= numGames) {
        h2hRawMap[idx] = name;
      }
    }
    
    match = name.match(h2hCleanPattern);
    if (match) {
      var idx = parseInt(match[1], 10);
      if (idx <= numGames) {
        h2hCleanMap[idx] = name;
      }
    }
    
    match = name.match(homeRawPattern);
    if (match) {
      var idx = parseInt(match[1], 10);
      if (idx <= numGames) {
        homeRawMap[idx] = name;
      }
    }
    
    match = name.match(homeCleanPattern);
    if (match) {
      var idx = parseInt(match[1], 10);
      if (idx <= numGames) {
        homeCleanMap[idx] = name;
      }
    }
    
    match = name.match(awayRawPattern);
    if (match) {
      var idx = parseInt(match[1], 10);
      if (idx <= numGames) {
        awayRawMap[idx] = name;
      }
    }
    
    match = name.match(awayCleanPattern);
    if (match) {
      var idx = parseInt(match[1], 10);
      if (idx <= numGames) {
        awayCleanMap[idx] = name;
      }
    }
  }
  
  // Build paired arrays (only include pairs where raw exists)
  var indices = [];
  for (var key in h2hRawMap) {
    if (h2hRawMap.hasOwnProperty(key)) {
      var idx = parseInt(key, 10);
      if (indices.indexOf(idx) === -1) indices.push(idx);
    }
  }
  for (var key in homeRawMap) {
    if (homeRawMap.hasOwnProperty(key)) {
      var idx = parseInt(key, 10);
      if (indices.indexOf(idx) === -1) indices.push(idx);
    }
  }
  for (var key in awayRawMap) {
    if (awayRawMap.hasOwnProperty(key)) {
      var idx = parseInt(key, 10);
      if (indices.indexOf(idx) === -1) indices.push(idx);
    }
  }
  
  indices.sort(function(a, b) { return a - b; });
  
  // PATCH: Limit to numGames
  indices = indices.slice(0, numGames);
  
  for (var j = 0; j < indices.length; j++) {
    var idx = indices[j];
    
    // H2H pairs
    if (h2hRawMap[idx]) {
      h2hRawNames.push(h2hRawMap[idx]);
      h2hCleanNames.push(h2hCleanMap[idx] || 'CleanH2H_' + idx);
    }
    
    // Home pairs
    if (homeRawMap[idx]) {
      homeRawNames.push(homeRawMap[idx]);
      homeCleanNames.push(homeCleanMap[idx] || 'CleanRecentHome_' + idx);
    }
    
    // Away pairs
    if (awayRawMap[idx]) {
      awayRawNames.push(awayRawMap[idx]);
      awayCleanNames.push(awayCleanMap[idx] || 'CleanRecentAway_' + idx);
    }
  }
  
  Logger.log('[_findTier2Sheets] Found: H2H=' + h2hRawNames.length + 
             ', Home=' + homeRawNames.length + 
             ', Away=' + awayRawNames.length +
             ' (limited to ' + numGames + ' games)');
  
  return {
    h2hRawNames: h2hRawNames,
    h2hCleanNames: h2hCleanNames,
    homeRawNames: homeRawNames,
    homeCleanNames: homeCleanNames,
    awayRawNames: awayRawNames,
    awayCleanNames: awayCleanNames,
    numGames: numGames,
    totalDiscovered: h2hRawNames.length + homeRawNames.length + awayRawNames.length
  };
}

/**
 * =====================================================================
 * HELPER: _runAllTier2Parsers
 * =====================================================================
 * WHY:
 *   Central place that calls Module 2 parser runners for every
 *   discovered Tier 2 raw sheet.
 *
 * WHERE:
 *   Active league spreadsheet; writes to various Clean* sheets.
 * =====================================================================
 */
function _runAllTier2Parsers(
  ss,
  h2hRawNames,   h2hCleanNames,
  homeRawNames,  homeCleanNames,
  awayRawNames,  awayCleanNames
) {
  Logger.log('Parsing ' + h2hRawNames.length + ' H2H sheets…');
  
  if (typeof runParseH2H !== 'function') {
    Logger.log('WARNING: runParseH2H is not defined (Module 2 missing?)');
  }
  if (typeof runParseRecent !== 'function') {
    Logger.log('WARNING: runParseRecent is not defined (Module 2 missing?)');
  }

  for (let i = 0; i < h2hRawNames.length; i++) {
    if (typeof runParseH2H === 'function') {
      Logger.log('…Parsing ' + h2hRawNames[i] + ' → ' + h2hCleanNames[i]);
      runParseH2H(ss, h2hRawNames[i], h2hCleanNames[i]);
    }
  }

  Logger.log('Parsing ' + homeRawNames.length + ' RecentHome sheets…');
  for (let j = 0; j < homeRawNames.length; j++) {
    if (typeof runParseRecent === 'function') {
      Logger.log('…Parsing ' + homeRawNames[j] + ' → ' + homeCleanNames[j]);
      runParseRecent(ss, homeRawNames[j], homeCleanNames[j]);
    }
  }

  Logger.log('Parsing ' + awayRawNames.length + ' RecentAway sheets…');
  for (let k = 0; k < awayRawNames.length; k++) {
    if (typeof runParseRecent === 'function') {
      Logger.log('…Parsing ' + awayRawNames[k] + ' → ' + awayCleanNames[k]);
      runParseRecent(ss, awayRawNames[k], awayCleanNames[k]);
    }
  }

  Logger.log('All Tier 2 parsers complete.');
}



function analyzeTier2Stats(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Running analyzeTier2Stats (Venue-Aware)…');

  let statsSheet = getSheetInsensitive(ss, 'TeamQuarterStats_Tier2');
  if (!statsSheet) {
    statsSheet = ss.insertSheet('TeamQuarterStats_Tier2');
  }
  statsSheet.clear();

  const header = ['Team', 'Venue', 'Quarter', 'Wins', 'Losses', 'Ties', 'Win%', 'Games'];
  const output = [header];

  // teamVenueStats[team][venue][quarter] = { w, l, t }
  const teamVenueStats = {};

  function buildQuarterString(row, hCol, aCol) {
    const hVal = row[hCol];
    const aVal = row[aCol];
    if (hVal == null || aVal == null ||
        String(hVal).trim() === '' || String(aVal).trim() === '') {
      return '';
    }
    return String(hVal).trim() + '-' + String(aVal).trim();
  }

  const processGameRow = function (row, homeTeam, awayTeam, map) {
    if (!row[map.q1h] || String(row[map.q1h]).includes(':')) return;

    const q1 = buildQuarterString(row, map.q1h, map.q1a);
    const q2 = buildQuarterString(row, map.q2h, map.q2a);
    const q3 = buildQuarterString(row, map.q3h, map.q3a);
    const q4 = buildQuarterString(row, map.q4h, map.q4a);
    let ot = '';
    if (map.oth !== undefined && map.ota !== undefined) {
      ot = buildQuarterString(row, map.oth, map.ota);
    }

    const quarters = [
      { key: 'Q1', scoreStr: q1 },
      { key: 'Q2', scoreStr: q2 },
      { key: 'Q3', scoreStr: q3 },
      { key: 'Q4', scoreStr: q4 }
    ];
    if (ot) {
      quarters.push({ key: 'OT', scoreStr: ot });
    }

    quarters.forEach(function (q) {
      if (!q.scoreStr) return;

      const parsed = parseScore(q.scoreStr);
      if (!parsed) return;

      const hScore = parsed[0];
      const aScore = parsed[1];
      if (isNaN(hScore) || isNaN(aScore)) return;

      // Home team perspective
      if (!teamVenueStats[homeTeam]) {
        teamVenueStats[homeTeam] = { Home: {}, Away: {} };
      }
      if (!teamVenueStats[homeTeam].Home[q.key]) {
        teamVenueStats[homeTeam].Home[q.key] = { w: 0, l: 0, t: 0 };
      }
      if (hScore > aScore) {
        teamVenueStats[homeTeam].Home[q.key].w++;
      } else if (hScore < aScore) {
        teamVenueStats[homeTeam].Home[q.key].l++;
      } else {
        teamVenueStats[homeTeam].Home[q.key].t++;
      }

      // Away team perspective
      if (!teamVenueStats[awayTeam]) {
        teamVenueStats[awayTeam] = { Home: {}, Away: {} };
      }
      if (!teamVenueStats[awayTeam].Away[q.key]) {
        teamVenueStats[awayTeam].Away[q.key] = { w: 0, l: 0, t: 0 };
      }
      if (aScore > hScore) {
        teamVenueStats[awayTeam].Away[q.key].w++;
      } else if (aScore < hScore) {
        teamVenueStats[awayTeam].Away[q.key].l++;
      } else {
        teamVenueStats[awayTeam].Away[q.key].t++;
      }
    });
  };

  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (!name.match(/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i)) return;

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const headers = data[0];
    const map = createHeaderMap(headers);

    if (map.home === undefined || map.away === undefined ||
        map.q1h === undefined || map.q1a === undefined) {
      return;
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const home = row[map.home];
      const away = row[map.away];
      if (!home || !away) continue;
      processGameRow(row, home, away, map);
    }
  });

  const sortedTeams = Object.keys(teamVenueStats).sort();
  sortedTeams.forEach(function (team) {
    ['Home', 'Away'].forEach(function (venue) {
      ['Q1', 'Q2', 'Q3', 'Q4', 'OT'].forEach(function (q) {
        const s = (teamVenueStats[team][venue] &&
                   teamVenueStats[team][venue][q]) || { w: 0, l: 0, t: 0 };
        const games = s.w + s.l + s.t;
        const winPct = games > 0 ? ((s.w / games) * 100).toFixed(1) : '0.0';
        output.push([team, venue, q, s.w, s.l, s.t, winPct, games]);
      });
    });
  });

  if (output.length === 1) {
    output.push(['No valid Tier 2 data found to analyze.', '', '', '', '', '', '', '']);
  }

  statsSheet.getRange(1, 1, output.length, output[0].length).setValues(output);

  if (output.length > 1) {
    statsSheet.autoResizeColumns(1, output[0].length);
  }

  Logger.log('…analyzeTier2Stats complete.');
}

/**
 * =====================================================================
 * CACHE HELPER: clearMarginCache
 * =====================================================================
 */
function clearMarginCache() {
  const hadCache = TIER2_MARGIN_STATS_CACHE !== null;
  TIER2_MARGIN_STATS_CACHE = null;
  Logger.log('Tier 2 margin cache cleared (was ' + (hadCache ? 'populated' : 'empty') + ').');
}

/**
 * ============================================================================
 * loadTier2MarginStats - FINAL v2.0
 * ============================================================================
 * Builds per-team, per-venue, per-quarter margin statistics from clean sheets.
 *
 * RETURNS:
 *   marginStats[team][venue][quarter] = {
 *     avgMargin: number,      // average point margin (positive = won quarter)
 *     avgTotal: NaN,          // NOT APPLICABLE for margin stats - set to NaN
 *     samples: number,        // count of games
 *     rawMargins: number[],   // array of individual margins
 *     stdDev: number          // standard deviation
 *   }
 *
 * FIXES:
 *   - avgTotal is NaN (was incorrectly duplicating avgMargin)
 *   - Properly handles 0-0 scores
 *   - Guarantees all team/venue/quarter objects exist
 *   - Cache can be cleared by setting TIER2_MARGIN_STATS_CACHE = null
 */

// Global cache declaration
var TIER2_MARGIN_STATS_CACHE = null;

/* ================================================================================================
 * 0) Shared helpers (safe string, team key canonicalization, numeric coercion, header map, stddev)
 * ================================================================================================ */

/** Safe toString + trim */
function _t2_toStr_(v) {
  return (v == null) ? '' : String(v).trim();
}

/** Canonical team key: lowercase + collapse whitespace + remove some punctuation */
function _t2_teamKeyCanonical_(teamName) {
  var s = _t2_toStr_(teamName).toLowerCase();
  s = s.replace(/['’`]/g, '');     // apostrophes
  s = s.replace(/[.\-,]/g, ' ');   // punctuation -> space
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Strict numeric coercion:
 * - returns NaN for null/undefined/'' or non-numeric
 * - never throws
 */
function _t2_toNumStrict_(v) {
  if (v === '' || v == null) return NaN;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;

  var s = String(v).trim();
  if (!s) return NaN;

  // guard against time formats "12:00"
  if (s.indexOf(':') >= 0) return NaN;

  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

/**
 * OT numeric coercion:
 * - blank OT treated as 0 (common in sheets)
 * - non-numeric treated as 0
 */
function _t2_toNumOT_(v) {
  if (v === '' || v == null) return 0;
  var n = _t2_toNumStrict_(v);
  return isFinite(n) ? n : 0;
}

/** Basic header map: lowercased trimmed header -> index */
function _t2_createHeaderMap_(headers) {
  var map = {};
  if (!headers || !headers.length) return map;
  for (var i = 0; i < headers.length; i++) {
    var key = _t2_toStr_(headers[i]).toLowerCase();
    if (key) map[key] = i;
  }
  return map;
}

/** Sample std dev (n-1). Returns NaN for <2 samples. */
function _t2_stdDevSample_(arr) {
  if (!arr || arr.length < 2) return NaN;
  var sum = 0;
  for (var i = 0; i < arr.length; i++) sum += arr[i];
  var mean = sum / arr.length;

  var ssq = 0;
  for (var j = 0; j < arr.length; j++) {
    var d = arr[j] - mean;
    ssq += d * d;
  }
  return Math.sqrt(ssq / (arr.length - 1));
}

/** Ensure nested object exists */
function _t2_ensure_(obj, path, leafInit) {
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (cur[p] == null) cur[p] = (i === parts.length - 1) ? leafInit : {};
    cur = cur[p];
  }
  return cur;
}

/** Quick clamp */
function _t2_clamp_(x, lo, hi) {
  x = Number(x);
  if (!isFinite(x)) x = (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, x));
}


/* ================================================================================================
 * 1) PATCH: loadTier2MarginStats (NaN-proof, canonical keys, keeps display names, caching preserved)
 * ================================================================================================ */
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * loadTier2MarginStats — PATCHED v2
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS FIXED:
 *   - Tracks individual totals[] alongside margins[] for diagnostics
 *   - Detects margin-only data (avgTotal ≈ 0 with samples > 0)
 *   - Reconstructs avgTotal using NBA league-average quarter totals
 *   - Logs how many teams have real vs reconstructed totals
 *
 * Output:
 *   finalStats[teamKey][Home|Away][Q1..Q4|OT] = {
 *     avgMargin: number|0,
 *     avgTotal: number|0,
 *     samples: integer,
 *     rawMargins: number[],
 *     stdDev: number|NaN
 *   }
 *   finalStats._meta.teamDisplay: map
 */

// Reset cache to force rebuild with fix
var TIER2_MARGIN_STATS_CACHE = null;

function loadTier2MarginStats(ss) {
  ss = _ensureSpreadsheet_(ss);

  // Keep your cache contract, but ensure it's canonical
  if (typeof TIER2_MARGIN_STATS_CACHE !== 'undefined' && TIER2_MARGIN_STATS_CACHE !== null) {
    Logger.log('loadTier2MarginStats: Using cache (' + Object.keys(TIER2_MARGIN_STATS_CACHE).length + ' keys)');
    return TIER2_MARGIN_STATS_CACHE;
  }

  if (!ss) {
    Logger.log('loadTier2MarginStats: No spreadsheet available');
    return {};
  }

  Logger.log('loadTier2MarginStats: Building from clean sheets (PATCHED v2)...');

  // config minSamples (keep your original behavior)
  var minSamples = 1;
  try {
    var config = loadTier2Config(ss);
    minSamples = config.ou_min_samples || 1;
  } catch (e) {
    Logger.log('loadTier2MarginStats: Config load warning: ' + e.message);
  }
  minSamples = Math.max(1, parseInt(minSamples, 10) || 1);

  var marginData = {}; // intermediate: canonical teamKey -> venue -> quarter -> accumulators
  var metaDisplay = {}; // canonical teamKey -> first-seen display
  var gamesProcessed = 0;
  var sheetsProcessed = 0;
  var emptySheetsSkipped = 0;

  var allSheets = ss.getSheets() || [];

  function initTeam_(teamKey) {
    if (marginData[teamKey]) return;

    marginData[teamKey] = { Home: {}, Away: {} };
    var venues = ['Home', 'Away'];
    var quarters = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];

    for (var vi = 0; vi < venues.length; vi++) {
      var v = venues[vi];
      for (var qi = 0; qi < quarters.length; qi++) {
        var q = quarters[qi];
        marginData[teamKey][v][q] = {
          sumMargin: 0,
          sumTotal: 0,
          count: 0,
          margins: [],
          totals: []    // ← NEW: track individual totals for diagnostics
        };
      }
    }
  }

  function isCleanTier2Sheet_(sheetName) {
    return /^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i.test(sheetName || '');
  }

  for (var si = 0; si < allSheets.length; si++) {
    var sheet = allSheets[si];
    if (!sheet) continue;

    var sheetName = '';
    try { sheetName = sheet.getName(); } catch (e0) { continue; }

    if (!isCleanTier2Sheet_(sheetName)) continue;

    var data;
    try {
      var lr = sheet.getLastRow();
      var lc = sheet.getLastColumn();
      if (lr < 2 || lc < 5) {
        emptySheetsSkipped++;
        continue;
      }
      data = sheet.getRange(1, 1, lr, lc).getValues();
    } catch (e1) {
      Logger.log('loadTier2MarginStats: Error reading ' + sheetName + ': ' + e1.message);
      continue;
    }

    if (!data || data.length < 2) {
      emptySheetsSkipped++;
      continue;
    }

    var headers = data[0];
    var map = _t2_createHeaderMap_(headers);

    // Validate required columns
    var required = ['home', 'away', 'q1h', 'q1a', 'q2h', 'q2a', 'q3h', 'q3a', 'q4h', 'q4a'];
    var missing = [];
    for (var mi = 0; mi < required.length; mi++) {
      if (map[required[mi]] === undefined) missing.push(required[mi]);
    }
    if (missing.length) {
      Logger.log('loadTier2MarginStats: Skipping ' + sheetName + ' - missing: ' + missing.join(', '));
      continue;
    }

    sheetsProcessed++;

    var hasOT = (map.oth !== undefined && map.ota !== undefined);

    for (var r = 1; r < data.length; r++) {
      var row = data[r];

      var homeDisp = _t2_toStr_(row[map.home]);
      var awayDisp = _t2_toStr_(row[map.away]);
      if (!homeDisp || !awayDisp) continue;

      var homeKey = _t2_teamKeyCanonical_(homeDisp);
      var awayKey = _t2_teamKeyCanonical_(awayDisp);
      if (!homeKey || !awayKey) continue;

      if (!metaDisplay[homeKey]) metaDisplay[homeKey] = homeDisp;
      if (!metaDisplay[awayKey]) metaDisplay[awayKey] = awayDisp;

      initTeam_(homeKey);
      initTeam_(awayKey);

      // Pull quarter points with strict coercion
      var qDefs = [
        { q: 'Q1', h: _t2_toNumStrict_(row[map.q1h]), a: _t2_toNumStrict_(row[map.q1a]) },
        { q: 'Q2', h: _t2_toNumStrict_(row[map.q2h]), a: _t2_toNumStrict_(row[map.q2a]) },
        { q: 'Q3', h: _t2_toNumStrict_(row[map.q3h]), a: _t2_toNumStrict_(row[map.q3a]) },
        { q: 'Q4', h: _t2_toNumStrict_(row[map.q4h]), a: _t2_toNumStrict_(row[map.q4a]) }
      ];

      if (hasOT) {
        qDefs.push({ q: 'OT', h: _t2_toNumOT_(row[map.oth]), a: _t2_toNumOT_(row[map.ota]) });
      }

      var validQuarters = 0;

      for (var qi2 = 0; qi2 < qDefs.length; qi2++) {
        var Q = qDefs[qi2].q;
        var hPts = qDefs[qi2].h;
        var aPts = qDefs[qi2].a;

        // For Q1-Q4 require both finite; for OT (if present) allow 0/0 (still finite)
        if (!isFinite(hPts) || !isFinite(aPts)) continue;

        // sanity range check; keep your original guard (NBA quarters rarely exceed ~50/team)
        if (hPts < 0 || aPts < 0 || hPts > 80 || aPts > 80) continue;

        var homeMargin = hPts - aPts;
        var awayMargin = aPts - hPts;
        var total = hPts + aPts;
        if (!isFinite(total)) continue;

        // Home team at Home venue
        var hNode = marginData[homeKey].Home[Q];
        hNode.sumMargin += homeMargin;
        hNode.sumTotal += total;
        hNode.count += 1;
        hNode.margins.push(homeMargin);
        hNode.totals.push(total);          // ← NEW

        // Away team at Away venue
        var aNode = marginData[awayKey].Away[Q];
        aNode.sumMargin += awayMargin;
        aNode.sumTotal += total;
        aNode.count += 1;
        aNode.margins.push(awayMargin);
        aNode.totals.push(total);          // ← NEW

        validQuarters++;
      }

      if (validQuarters > 0) gamesProcessed++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Convert to final structure with TOTAL RECONSTRUCTION for margin-only data
  // ═══════════════════════════════════════════════════════════════════════════

  // NBA league average quarter totals (both teams combined)
  // Used as fallback when clean sheets only contain margin data
  var LEAGUE_Q_DEFAULTS = {
    'Q1': 57.5, 'Q2': 56.8, 'Q3': 57.2, 'Q4': 57.5, 'OT': 12.0
  };

  var finalStats = { _meta: { teamDisplay: {} } };
  var teamKeys = Object.keys(marginData);
  var teamsWithRealTotals = 0;
  var teamsWithReconstructedTotals = 0;

  for (var t = 0; t < teamKeys.length; t++) {
    var teamKey = teamKeys[t];
    finalStats[teamKey] = { Home: {}, Away: {} };
    finalStats._meta.teamDisplay[teamKey] = metaDisplay[teamKey] || teamKey;

    var venues2 = ['Home', 'Away'];
    for (var v2 = 0; v2 < venues2.length; v2++) {
      var venue = venues2[v2];

      var quarters2 = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
      for (var qk = 0; qk < quarters2.length; qk++) {
        var quarter = quarters2[qk];
        var qData = marginData[teamKey][venue][quarter];

        // Always output object; avg* become 0 if below minSamples (your current behavior)
        var meets = (qData.count >= minSamples);

        var avgMargin = meets ? (qData.sumMargin / qData.count) : 0;
        var avgTotal = meets ? (qData.sumTotal / qData.count) : 0;

        // Guard: never let NaN escape (paranoia)
        if (!isFinite(avgMargin)) avgMargin = 0;
        if (!isFinite(avgTotal)) avgTotal = 0;

        // ═══════════════════════════════════════════════════════════════════
        // FIX: Detect margin-only data and reconstruct avgTotal
        //
        // If we have samples but avgTotal ≈ 0, the clean sheet data
        // contains margins (where q1h + q1a = 0) instead of raw scores.
        // Reconstruct avgTotal using league average.
        // ═══════════════════════════════════════════════════════════════════
        if (qData.count >= 3 && avgTotal < 1.0 && quarter !== 'OT') {
          // Check if ALL individual totals are 0 (confirming margin-only data)
          var allTotalsZero = true;
          for (var ti = 0; ti < qData.totals.length; ti++) {
            if (Math.abs(qData.totals[ti]) > 0.5) {
              allTotalsZero = false;
              break;
            }
          }

          if (allTotalsZero) {
            // Reconstruct: use league average as the combined quarter total
            avgTotal = LEAGUE_Q_DEFAULTS[quarter] || 57.0;
            if (v2 === 0 && qk === 0) {
              teamsWithReconstructedTotals++;
            }
          }
        } else if (avgTotal > 1.0 && v2 === 0 && qk === 0) {
          teamsWithRealTotals++;
        }

        finalStats[teamKey][venue][quarter] = {
          avgMargin: avgMargin,
          avgTotal: avgTotal,
          samples: qData.count || 0,
          rawMargins: (qData.margins || []).slice(),
          stdDev: _t2_stdDevSample_(qData.margins || []),
          sdTotal: _t2_stdDevSample_(qData.totals || []),
          rawTotals: (qData.totals || []).slice()
        };
      }
    }
  }

  // Cache + log
  if (typeof TIER2_MARGIN_STATS_CACHE !== 'undefined') {
    TIER2_MARGIN_STATS_CACHE = finalStats;
  }

  Logger.log(
    'loadTier2MarginStats: Complete (PATCHED v2). ' +
    sheetsProcessed + ' sheets, ' + gamesProcessed + ' games, ' +
    teamKeys.length + ' teams. Skipped empty=' + emptySheetsSkipped +
    '. RealTotals=' + teamsWithRealTotals +
    ', ReconstructedTotals=' + teamsWithReconstructedTotals
  );

  return finalStats;
}

/* ================================================================================================
 * 2) PATCH: canonicalizeMarginStatsKeys_ adapter (if any module still produces Title Case keys)
 * ================================================================================================ */

/**
 * If some caller passes a Title-Case-keyed marginStats map, this converts it to canonical keys.
 * Safe to call multiple times.
 */
function canonicalizeMarginStatsKeys_(marginStats) {
  if (!marginStats || typeof marginStats !== 'object') return marginStats;

  // If it already contains canonical keys (heuristic), keep.
  var keys = Object.keys(marginStats);
  if (keys.some(function(k) { return k && k === k.toLowerCase(); })) return marginStats;

  var out = { _meta: { teamDisplay: {} } };

  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === '_meta') continue;

    var ck = _t2_teamKeyCanonical_(k);
    out[ck] = marginStats[k];
    out._meta.teamDisplay[ck] = k;
  }

  // preserve _elite if present (your system uses it)
  if (marginStats._elite) out._elite = marginStats._elite;

  return out;
}

/**
 * Helper: Clear margin stats cache (call before re-processing)
 */
function clearTier2MarginStatsCache() {
  TIER2_MARGIN_STATS_CACHE = null;
  Logger.log('loadTier2MarginStats: Cache cleared.');
}

/**
 * Helper: Calculate standard deviation
 */
function _calculateStdDev(arr) {
  if (!arr || arr.length < 2) return 0;
  var sum = 0;
  for (var i = 0; i < arr.length; i++) sum += arr[i];
  var mean = sum / arr.length;
  var sq = 0;
  for (var j = 0; j < arr.length; j++) sq += Math.pow(arr[j] - mean, 2);
  return Math.sqrt(sq / arr.length);
}

/**
 * =====================================================================
 * HELPER: parseGameDate
 * =====================================================================
 */
function parseGameDate(dateValue) {
  if (!dateValue) return null;

  if (dateValue instanceof Date && !isNaN(dateValue)) {
    return dateValue;
  }

  const dateStr = String(dateValue).trim();
  if (!dateStr || dateStr.length < 6) return null;

  let day, month, year, parsed;

  // Format 1: DD/MMYYYY or DD.MMYYYY
  let match = dateStr.match(/^(\d{1,2})[.\/\-](\d{2})(\d{4})$/);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10) - 1;
    year = parseInt(match[3], 10);
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11 &&
        year >= 2000 && year <= 2100) {
      parsed = new Date(year, month, day);
      if (!isNaN(parsed)) return parsed;
    }
  }

  // Format 2: DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY
  match = dateStr.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})$/);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10) - 1;
    year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      parsed = new Date(year, month, day);
      if (!isNaN(parsed)) return parsed;
    }
  }

  // Format 3: YYYY-MM-DD
  match = dateStr.match(/^(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})$/);
  if (match) {
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10) - 1;
    day = parseInt(match[3], 10);
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      parsed = new Date(year, month, day);
      if (!isNaN(parsed)) return parsed;
    }
  }

  // Format 4: DDMMYYYY
  match = dateStr.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (match) {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10) - 1;
    year = parseInt(match[3], 10);
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11 &&
        year >= 2000 && year <= 2100) {
      parsed = new Date(year, month, day);
      if (!isNaN(parsed)) return parsed;
    }
  }

  // Last resort
  parsed = new Date(dateStr);
  if (!isNaN(parsed) && parsed.getFullYear() >= 2000 && parsed.getFullYear() <= 2100) {
    return parsed;
  }

  Logger.log('WARNING: Could not parse date: "' + dateStr + '"');
  return null;
}

/**
 * =====================================================================
 * LEGACY STATS LOADER: _loadVenueStats + getTier2QuarterStats
 * =====================================================================
 */
function _loadVenueStats(statsSheet) {
  const data = statsSheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const headers = data.shift();
  const map = createHeaderMap(headers);
  const stats = {};

  data.forEach(function (row) {
    const team = row[map.team];
    const venue = row[map.venue];
    const quarter = row[map.quarter];
    if (!team || !venue || !quarter) return;

    if (!stats[team]) stats[team] = {};
    if (!stats[team][venue]) stats[team][venue] = {};

    stats[team][venue][quarter] = {
      Wins: row[map.wins],
      Losses: row[map.losses],
      Ties: row[map.ties],
      'Win%': row[map['win%']],
      Games: row[map.games]
    };
  });

  return stats;
}

function getTier2QuarterStats(team, venue, quarter) {
  if (TIER2_VENUE_STATS_CACHE === null) {
    Logger.log('Initializing Tier 2 venue stats cache…');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const statsSheet = getSheetInsensitive(ss, 'TeamQuarterStats_Tier2');
    if (!statsSheet) {
      TIER2_VENUE_STATS_CACHE = {};
      Logger.log('…Tier 2 stats sheet not found. Cache is empty.');
    } else {
      TIER2_VENUE_STATS_CACHE = _loadVenueStats(statsSheet);
    }
  }

  const teamData = TIER2_VENUE_STATS_CACHE[team] || {};
  const venueData = teamData[venue] || {};
  return venueData[quarter] || {};
}

/**
 * =====================================================================
 * PHYSICS ENGINE: Momentum & Variance
 * =====================================================================
 */
function calculateMomentum(margins) {
  if (!margins || margins.length === 0) return 0;

  const decay = 0.85;
  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < margins.length && i < 10; i++) {
    const weight = Math.pow(decay, i);
    weightedSum += margins[i] * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

function calculateVariance(margins) {
  if (!margins || margins.length < 2) return 0;
  return _calculateStdDev(margins);
}

/**
 * =====================================================================
 * HELPER: computeDynamicTier2Thresholds
 * =====================================================================
 * WHY:
 *   Static thresholds (e.g. 2.5 for all leagues/quarters) ignore how
 *   volatile a particular league/quarter actually is on this slate.
 *
 * WHAT:
 *   Given a map of predicted margins grouped by quarter, computes
 *   percentile-based thresholds: even / medium / strong.
 *
 * HOW:
 *   - Works on ABSOLUTE margins (direction handled separately)
 *   - Sorts margins per quarter ascending
 *   - Picks 40th, 65th, and 85th percentiles
 *   - Falls back to safe defaults if < 20 samples
 *
 * RETURNS:
 *   {
 *     Q1: { even: P40, medium: P65, strong: P85 },
 *     Q2: { ... }, Q3: { ... }, Q4: { ... },
 *     overall: { ... }
 *   }
 *
 * WHERE: Called once per prediction run before assigning tiers
 * =====================================================================
 */
function computeDynamicTier2Thresholds(marginsByQuarter) {
  var FUNC_NAME = 'computeDynamicTier2Thresholds';
  
  // Safe fallback if insufficient data
  var FALLBACK = {
    even: 2.5,
    medium: 4.0,
    strong: 6.5
  };
  
  function calcThresholds(margins) {
    if (!margins || margins.length < 20) {
      Logger.log('[' + FUNC_NAME + '] Insufficient data (' + 
                 (margins ? margins.length : 0) + '), using fallback');
      return FALLBACK;
    }
    
    var absMargins = margins.map(function(m) { 
      return Math.abs(m); 
    }).sort(function(a, b) { 
      return a - b; 
    });
    
    var n = absMargins.length;
    
    function percentile(p) {
      var idx = Math.floor(p * (n - 1));
      return absMargins[Math.max(0, Math.min(idx, n - 1))];
    }
    
    return {
      even: percentile(0.40),
      medium: percentile(0.65),
      strong: percentile(0.85)
    };
  }
  
  var result = {
    Q1: calcThresholds(marginsByQuarter.Q1 || []),
    Q2: calcThresholds(marginsByQuarter.Q2 || []),
    Q3: calcThresholds(marginsByQuarter.Q3 || []),
    Q4: calcThresholds(marginsByQuarter.Q4 || []),
    overall: FALLBACK
  };
  
  // Calculate overall from all quarters combined
  var allMargins = []
    .concat(marginsByQuarter.Q1 || [])
    .concat(marginsByQuarter.Q2 || [])
    .concat(marginsByQuarter.Q3 || [])
    .concat(marginsByQuarter.Q4 || []);
  
  if (allMargins.length >= 20) {
    result.overall = calcThresholds(allMargins);
  }
  
  Logger.log('[' + FUNC_NAME + '] Q1: EVEN<' + result.Q1.even.toFixed(1) + 
             ', MED<' + result.Q1.medium.toFixed(1) + 
             ', STRONG>=' + result.Q1.strong.toFixed(1));
  Logger.log('[' + FUNC_NAME + '] Q2: EVEN<' + result.Q2.even.toFixed(1) + 
             ', MED<' + result.Q2.medium.toFixed(1) + 
             ', STRONG>=' + result.Q2.strong.toFixed(1));
  Logger.log('[' + FUNC_NAME + '] Q3: EVEN<' + result.Q3.even.toFixed(1) + 
             ', MED<' + result.Q3.medium.toFixed(1) + 
             ', STRONG>=' + result.Q3.strong.toFixed(1));
  Logger.log('[' + FUNC_NAME + '] Q4: EVEN<' + result.Q4.even.toFixed(1) + 
             ', MED<' + result.Q4.medium.toFixed(1) + 
             ', STRONG>=' + result.Q4.strong.toFixed(1));
  
  return result;
}

/**
 * =====================================================================
 * HELPER: assignTier2PredictionTier
 * =====================================================================
 * WHY:
 *   Clean separation between margin NUMBERS and tier LABELS.
 *
 * WHAT:
 *   Takes absolute margin and thresholds, returns tier name.
 *
 * RETURNS: 'STRONG', 'MEDIUM', 'WEAK', or 'EVEN'
 *
 * WHERE: Called inside predictQuarters_Tier2 for each quarter
 * =====================================================================
 */
function assignTier2PredictionTier(absMargin, thresholds) {
  if (!thresholds) {
    return 'EVEN';
  }
  
  if (absMargin < thresholds.even)   return 'EVEN';
  if (absMargin < thresholds.medium) return 'WEAK';
  if (absMargin < thresholds.strong) return 'MEDIUM';
  return 'STRONG';
}



/**
 * ============================================================================
 * predictQuarters_Tier2 — ELITE v3.3 (ANTI-FLATLINE + NO-DUPE-HEADERS)
 * ============================================================================
 * DROP-IN REPLACEMENT for the broken predictQuarters_Tier2 in Module 6.
 *
 * Fixes implemented (architecture-preserving):
 *  [F1] Robust header lookup (t2h_) so we stop silently appending duplicate t2-* columns.
 *  [F2] Canonical/case-insensitive team matching for marginStats lookup to avoid false fallbacks.
 *  [F3] Quarter win-rate fallback (t2ou_loadTeamQuarterStats_) BEFORE rank fallback.
 *  [F4] Quarter-weighted rank fallback so fallback isn’t quarter-flat.
 *  [F5] Dynamic Bayesian shrinkage per quarter to reduce over-shrink on Q1/Q3.
 *
 * Requirements / Optional dependencies:
 *  - createHeaderMap, getSheetInsensitive, loadTier2Config,
 *    computeBacktestedTier2Thresholds_, assignTier2PredictionTier,
 *    computeAdaptiveThreshold_ (optional), loadTier2MarginStats (optional),
 *    loadStandingsAsRankings_ (optional), calculateMomentum/calculateVariance (optional),
 *    t2ou_loadTeamQuarterStats_ (recommended), _t2ou_computeDynamicLeague_ (optional),
 *    t2_teamKeyCanonical (optional), logTier2Prediction (optional)
 *
 * Paste this function in place of your old one.
 * ============================================================================
 */
function predictQuarters_Tier2(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('    ELITE TIER 2 v3.3 (Anti-Flatline + Robust Headers)');
  Logger.log('═══════════════════════════════════════════════════════════════════');

  // ───────────────────────────────────────────────────────────────
  // Debug logging gate (capped)
  // ───────────────────────────────────────────────────────────────
  if (typeof T2_PRED_LOG_STATE === 'undefined') {
    T2_PRED_LOG_STATE = { used: 0, max: 80 };
  }
  function dbg(msg) {
    if (typeof T2_DEBUG_PREDICT === 'undefined' || !T2_DEBUG_PREDICT) return;
    if (T2_PRED_LOG_STATE.used >= T2_PRED_LOG_STATE.max) return;
    Logger.log('[T2-Predict] ' + msg);
    T2_PRED_LOG_STATE.used++;
  }

  // ───────────────────────────────────────────────────────────────
  // Utils
  // ───────────────────────────────────────────────────────────────
  function _num_(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = parseFloat(String(v).replace('%', '').trim());
    return isNaN(n) ? fallback : n;
  }
  function _clamp_(x, lo, hi) {
    x = Number(x);
    if (!isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }
  function _roundHalf_(n) {
    n = Number(n);
    return isFinite(n) ? Math.round(n * 2) / 2 : 0;
  }
  function _stdDev_(arr) {
    if (!arr || arr.length < 2) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    var mean = sum / arr.length;
    var variance = 0;
    for (var j = 0; j < arr.length; j++) {
      variance += Math.pow(arr[j] - mean, 2);
    }
    return Math.sqrt(variance / arr.length);
  }
  function _percentileAbs_(arr, p) {
    if (!arr || arr.length === 0) return 0;
    var sorted = [];
    for (var i = 0; i < arr.length; i++) {
      var x = Math.abs(Number(arr[i]) || 0);
      if (isFinite(x)) sorted.push(x);
    }
    if (sorted.length === 0) return 0;
    sorted.sort(function(a, b) { return a - b; });
    var idx = Math.floor(_clamp_(p, 0, 1) * (sorted.length - 1));
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  // ───────────────────────────────────────────────────────────────
  // [F1] Robust header lookup to stop duplicate t2-* columns
  // Works with both raw and normalized header maps.
  // ───────────────────────────────────────────────────────────────
  function t2h_(hMap, name) {
    if (!hMap) return undefined;
    var raw = String(name || '').toLowerCase().trim();
    var norm = raw.replace(/[\s_-]+/g, '');
    if (hMap[raw] !== undefined) return hMap[raw];
    if (hMap[norm] !== undefined) return hMap[norm];

    // Last resort: scan keys and compare normalized forms
    for (var k in hMap) {
      if (!Object.prototype.hasOwnProperty.call(hMap, k)) continue;
      var kn = String(k).toLowerCase().trim().replace(/[\s_-]+/g, '');
      if (kn === norm) return hMap[k];
    }
    return undefined;
  }

  // ───────────────────────────────────────────────────────────────
  // [F2] Team lookup for marginStats with canonical fallback
  // Uses t2ou_getTeamVenueQuarter_ if available (preferred).
  // ───────────────────────────────────────────────────────────────
  function _canonTeam_(s) {
    if (typeof t2_teamKeyCanonical === 'function') return t2_teamKeyCanonical(s);
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/['’`.\-,]/g, '')
      .replace(/\s+/g, ' ');
  }

  function _getVenueStats(marginStats, team, venue, quarter) {
    if (!marginStats || !team || !venue || !quarter) return null;

    // Best: reuse O/U lookup helper if present
    if (typeof t2ou_getTeamVenueQuarter_ === 'function') {
      var r0 = t2ou_getTeamVenueQuarter_(marginStats, team, venue, quarter);
      if (r0) return r0;
    }

    var teamRaw = String(team || '').trim();
    var vKey = String(venue || '').trim();
    var qKey = String(quarter || '').trim().toUpperCase();
    if (!teamRaw) return null;

    // Direct
    if (marginStats[teamRaw] && marginStats[teamRaw][vKey] && marginStats[teamRaw][vKey][qKey]) {
      return marginStats[teamRaw][vKey][qKey];
    }

    // Canonical scan
    var target = _canonTeam_(teamRaw);
    var keys = Object.keys(marginStats);
    for (var i = 0; i < keys.length; i++) {
      if (_canonTeam_(keys[i]) !== target) continue;
      var td = marginStats[keys[i]];
      if (td && td[vKey] && td[vKey][qKey]) return td[vKey][qKey];
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // Caps learned from CleanRecent (kept from your v3.2 logic)
  // ═══════════════════════════════════════════════════════════════
  function _learnCapsFromCleanRecent_(ss0) {
    var FALLBACK = {
      cap: { Q1: 14, Q2: 14, Q3: 14, Q4: 16 },
      sd:  { Q1: 8,  Q2: 8,  Q3: 8,  Q4: 9  },
      samples: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      source: 'FALLBACK'
    };

    var sheets = ss0.getSheets();
    var recentSheets = [];
    for (var i = 0; i < sheets.length; i++) {
      var nm = sheets[i].getName();
      if (/^(CleanRecentHome_|CleanRecentAway_)/i.test(nm)) recentSheets.push(sheets[i]);
    }
    if (recentSheets.length === 0) return FALLBACK;

    var margins = { Q1: [], Q2: [], Q3: [], Q4: [] };

    for (var si = 0; si < recentSheets.length; si++) {
      var sh = recentSheets[si];
      var data = sh.getDataRange().getValues();
      if (!data || data.length < 2) continue;

      var h0 = createHeaderMap(data[0]);
      if (h0.home === undefined || h0.away === undefined) continue;
      if (h0.q1h === undefined || h0.q1a === undefined) continue;

      for (var r = 1; r < data.length; r++) {
        var row = data[r];
        for (var q = 1; q <= 4; q++) {
          var hi = h0['q' + q + 'h'];
          var ai = h0['q' + q + 'a'];
          if (hi === undefined || ai === undefined) continue;

          var hs = parseFloat(row[hi]);
          var as = parseFloat(row[ai]);
          if (!isNaN(hs) && !isNaN(as) && hs >= 0 && as >= 0 && hs < 100 && as < 100) {
            margins['Q' + q].push(hs - as);
          }
        }
      }
    }

    var total = margins.Q1.length + margins.Q2.length + margins.Q3.length + margins.Q4.length;
    if (total < 40) return FALLBACK;

    function buildCap(arr, fb) {
      var p95 = _percentileAbs_(arr, 0.95);
      return _clamp_(_roundHalf_(p95), 8, 24) || fb;
    }
    function buildSd(arr, fb) {
      var sd = _stdDev_(arr);
      return _clamp_(sd, 4, 18) || fb;
    }

    return {
      cap: {
        Q1: buildCap(margins.Q1, FALLBACK.cap.Q1),
        Q2: buildCap(margins.Q2, FALLBACK.cap.Q2),
        Q3: buildCap(margins.Q3, FALLBACK.cap.Q3),
        Q4: buildCap(margins.Q4, FALLBACK.cap.Q4)
      },
      sd: {
        Q1: buildSd(margins.Q1, FALLBACK.sd.Q1),
        Q2: buildSd(margins.Q2, FALLBACK.sd.Q2),
        Q3: buildSd(margins.Q3, FALLBACK.sd.Q3),
        Q4: buildSd(margins.Q4, FALLBACK.sd.Q4)
      },
      samples: {
        Q1: margins.Q1.length,
        Q2: margins.Q2.length,
        Q3: margins.Q3.length,
        Q4: margins.Q4.length
      },
      source: 'CLEANRECENT_P95'
    };
  }

  var caps = _learnCapsFromCleanRecent_(ss);

  // ═══════════════════════════════════════════════════════════════
  // Config + thresholds
  // ═══════════════════════════════════════════════════════════════
  var config = loadTier2Config(ss);
  if (typeof validateConfigState_ === 'function') {
    try {
      validateConfigState_(config, ['threshold', 'strong_target', 'medium_target', 'even_target']);
    } catch (eCfg) {
      Logger.log('[predictQuarters_Tier2] validateConfigState_: ' + eCfg);
    }
  }

  // Targets used by your tier-aligned confidence mapping
  var TARGET_EVEN = _clamp_(_num_(config.even_target, 0.55), 0.50, 0.80);
  var TARGET_MED  = _clamp_(_num_(config.medium_target, 0.65), TARGET_EVEN, 0.90);
  var TARGET_STR  = _clamp_(_num_(config.strong_target, 0.75), TARGET_MED, 0.95);
  var TARGET_MAX  = _clamp_(_num_(config.max_target, 0.90), TARGET_STR, 0.99);

  var learnedThresholds = computeBacktestedTier2Thresholds_(ss, {
    strongTarget: _num_(config.strong_target, 0.75),
    mediumTarget: _num_(config.medium_target, 0.65),
    evenTarget:   _num_(config.even_target, 0.55),
    confidenceScale: _num_(config.confidence_scale, 30)
  });

  // Defaults tuned slightly to reduce “everything shrinks to EVEN”
  var SHRINK_K = _clamp_(_num_(config.margin_shrink_k, 5), 2, 20);
  var MOM_CAP_FRAC = _clamp_(_num_(config.momentum_cap_frac, 0.40), 0.10, 0.75);

  var ADAPT_CFG = {
    adapt_enabled: (config.adapt_enabled !== false),
    adapt_min_samples: _clamp_(_num_(config.adapt_min_samples, 8), 2, 30),
    adapt_sample_weight: _clamp_(_num_(config.adapt_sample_weight, 0.50), 0, 1),
    adapt_volatility_weight: _clamp_(_num_(config.adapt_volatility_weight, 0.40), 0, 1),
    adapt_margin_weight: _clamp_(_num_(config.adapt_margin_weight, 0.15), 0, 0.5),
    adapt_max_widen: _clamp_(_num_(config.adapt_max_widen, 2.0), 1.0, 3.0),
    adapt_confidence_floor: _clamp_(_num_(config.adapt_confidence_floor, 0.25), 0.10, 0.50)
  };

  Logger.log('[Config] ShrinkK=' + SHRINK_K + ', MomCapFrac=' + MOM_CAP_FRAC +
             ', Adaptive=' + (ADAPT_CFG.adapt_enabled ? 'ON' : 'OFF'));

  // ───────────────────────────────────────────────────────────────
  // Threshold/confidence helpers
  // ───────────────────────────────────────────────────────────────
  function _sanitizeThresholdsCapped_(thr, cap) {
    // Narrow EVEN zone by default (still respects learned thresholds if present)
    var evenT = _num_(thr && thr.even, 1.5);
    var medT  = _num_(thr && thr.medium, 4.0);
    var strT  = _num_(thr && thr.strong, 6.0);
    var confT = _clamp_(_num_(thr && thr.confidence, 0.35), 0, 1);

    evenT = Math.max(0.5, evenT);
    medT  = Math.max(evenT + 0.5, medT);
    strT  = Math.max(medT + 0.5, strT);

    cap = Math.abs(_num_(cap, 16));
    if (cap > 0 && strT > cap) strT = cap;
    if (medT >= strT) medT = Math.max(evenT + 0.5, strT * 0.72);
    if (evenT >= medT) evenT = Math.max(0.5, medT * 0.55);

    return { even: evenT, medium: medT, strong: strT, confidence: confT };
  }

  function _estimateTierProb_(absMargin, thr) {
    absMargin = Math.max(0, Number(absMargin) || 0);
    var t = _sanitizeThresholdsCapped_(thr, 9999);

    if (absMargin <= 0) return 0.50;
    if (absMargin < t.even) {
      return 0.50 + (absMargin / t.even) * (TARGET_EVEN - 0.50);
    }
    if (absMargin < t.medium) {
      return TARGET_EVEN + ((absMargin - t.even) / (t.medium - t.even)) * (TARGET_MED - TARGET_EVEN);
    }
    if (absMargin < t.strong) {
      return TARGET_MED + ((absMargin - t.medium) / (t.strong - t.medium)) * (TARGET_STR - TARGET_MED);
    }

    var over = absMargin - t.strong;
    var scale = Math.max(1, t.strong * 0.75);
    var f = 1 - Math.exp(-over / scale);
    return TARGET_STR + f * (TARGET_MAX - TARGET_STR);
  }

  function _tierAlignedConfidencePct_(absMargin, thr, quality01) {
    var baseProb = _estimateTierProb_(absMargin, thr);
    var q = _clamp_(quality01, 0, 1);
    var shrink = _clamp_(0.30 + 0.70 * q, 0.30, 1.00);
    var finalProb = 0.50 + (baseProb - 0.50) * shrink;
    return _clamp_(Math.round(finalProb * 100), 50, 95);
  }

  // ═══════════════════════════════════════════════════════════════
  // Load sheets/data
  // ═══════════════════════════════════════════════════════════════
  var upcomingSheet = getSheetInsensitive(ss, 'UpcomingClean');
  if (!upcomingSheet) throw new Error('UpcomingClean sheet not found.');

  var data = upcomingSheet.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('No upcoming games found.');

  var h = createHeaderMap(data[0]);
  if (h.home === undefined || h.away === undefined) {
    throw new Error('Missing Home/Away columns in UpcomingClean.');
  }

  var marginStats = (typeof loadTier2MarginStats === 'function') ? loadTier2MarginStats() : {};
  var rankings = (typeof loadStandingsAsRankings_ === 'function') ? loadStandingsAsRankings_(ss) : {};

  // [F3] Quarter win-rate stats used as a fallback before rank fallback
  var quarterWinStats = (typeof t2ou_loadTeamQuarterStats_ === 'function')
    ? t2ou_loadTeamQuarterStats_(ss, false)
    : {};

  // Optional: dynamic league SD per quarter (if cache available)
  var dynamicLeague = null;
  if (typeof _t2ou_computeDynamicLeague_ === 'function' &&
      typeof T2OU_CACHE !== 'undefined' && T2OU_CACHE) {
    try {
      dynamicLeague = _t2ou_computeDynamicLeague_(T2OU_CACHE.teamStats || {}, T2OU_CACHE.league || {});
    } catch (e) {
      dynamicLeague = null;
    }
  }

  var COLORS = {
    strongHome: '#006400', medHome: '#228B22', weakHome: '#90EE90',
    strongAway: '#8B0000', medAway: '#CD5C5C', weakAway: '#FFB6C1',
    even: '#FFFFE0', na: '#FFFFFF'
  };
  var TIER_WEIGHTS = { STRONG: 1.0, MEDIUM: 0.7, WEAK: 0.4, EVEN: 0.1 };

  // ═══════════════════════════════════════════════════════════════
  // Prepare output columns (NO DUPES)
  // ═══════════════════════════════════════════════════════════════
  var outputData = [data[0].slice()];
  var colorMatrix = [];
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var colMap = {};
  var confColMap = {};

  for (var qi = 0; qi < quarters.length; qi++) {
    var q = quarters[qi];
    var colName = 't2-' + q.toLowerCase();
    var confName = 't2-' + q.toLowerCase() + '-conf';

    var idx = t2h_(h, colName);
    if (idx === undefined) {
      idx = outputData[0].length;
      outputData[0].push(colName);
      h[colName] = idx;
    }

    var cidx = t2h_(h, confName);
    if (cidx === undefined) {
      cidx = outputData[0].length;
      outputData[0].push(confName);
      h[confName] = cidx;
    }

    colMap[q] = idx;
    confColMap[q] = cidx;
  }

  var edgeName = 't2-edge-score';
  var edgeCol = t2h_(h, edgeName);
  if (edgeCol === undefined) {
    edgeCol = outputData[0].length;
    outputData[0].push(edgeName);
    h[edgeName] = edgeCol;
  }

  var stats = {
    processed: 0,
    skipped: 0,
    adaptiveUsed: 0,
    byTier: { STRONG: 0, MEDIUM: 0, WEAK: 0, EVEN: 0 },
    byQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    paths: { tier2_stats: 0, partial_stats: 0, quarter_winrate_fallback: 0, rank_fallback: 0 }
  };

  var allPredictions = [];

  Logger.log('');
  Logger.log('[PHASE] Generating predictions...');

  // ═══════════════════════════════════════════════════════════════
  // Main loop
  // ═══════════════════════════════════════════════════════════════
  for (var r = 1; r < data.length; r++) {
    var srcRow = data[r];
    var homeTeam = srcRow[h.home] ? String(srcRow[h.home]).trim() : '';
    var awayTeam = srcRow[h.away] ? String(srcRow[h.away]).trim() : '';

    var dateVal = (h.date !== undefined) ? srcRow[h.date] : '';
    var league = (h.league !== undefined) ? srcRow[h.league] : '';
    var timeVal = (h.time !== undefined) ? srcRow[h.time] : '';

    var row = srcRow.slice();
    while (row.length < outputData[0].length) row.push('');

    if (!homeTeam || !awayTeam) {
      stats.skipped++;
      outputData.push(row);
      colorMatrix.push([COLORS.na, COLORS.na, COLORS.na, COLORS.na]);
      continue;
    }

    stats.processed++;
    var rowColors = [];
    var gameEdge = 0;

    for (var qi2 = 0; qi2 < quarters.length; qi2++) {
      var Q = quarters[qi2];
      var cap = caps.cap[Q] || (Q === 'Q4' ? 16 : 14);
      var fallbackSd = caps.sd[Q] || 8;

      var thrRaw = learnedThresholds[Q] || learnedThresholds.overall ||
                   { even: 1.5, medium: 4.0, strong: 6.0, confidence: 0.35 };

      var homeStats = _getVenueStats(marginStats, homeTeam, 'Home', Q);
      var awayStats = _getVenueStats(marginStats, awayTeam, 'Away', Q);

      var baseMargin = 0;
      var momentumSwing = 0;
      var variancePenalty = 0;

      var path = 'rank_fallback';
      var dataConfidence = 0.20;

      // [F5] Dynamic shrinkage per quarter
      var qShrinkMods = { Q1: 0.8, Q2: 1.2, Q3: 0.8, Q4: 1.3 };
      var activeShrinkK = SHRINK_K * (qShrinkMods[Q] || 1.0);

      // Path 1: both have margin stats
      if (homeStats && awayStats && (homeStats.samples || 0) >= 1 && (awayStats.samples || 0) >= 1) {
        path = 'tier2_stats';

        var hN = Math.max(0, Number(homeStats.samples) || 0);
        var aN = Math.max(0, Number(awayStats.samples) || 0);

        var hAdj = (Number(homeStats.avgMargin) || 0) * (hN / (hN + activeShrinkK));
        var aAdj = (Number(awayStats.avgMargin) || 0) * (aN / (aN + activeShrinkK));
        baseMargin = hAdj - aAdj;

        dataConfidence = 0.30 + 0.70 * Math.min(1, (hN + aN) / 20);

        if (typeof calculateMomentum === 'function') {
          var hm = calculateMomentum(homeStats.rawMargins || []);
          var am = calculateMomentum(awayStats.rawMargins || []);
          var rawMom = (hm - am) * (config.momentumSwingFactor || 0.15);
          var momCap = Math.max(2, cap * MOM_CAP_FRAC);
          momentumSwing = momCap * Math.tanh(rawMom / momCap);
        }

        if (typeof calculateVariance === 'function') {
          var hv = calculateVariance(homeStats.rawMargins || []);
          var av = calculateVariance(awayStats.rawMargins || []);
          var avgVar = (hv + av) / 2;
          variancePenalty = avgVar * (config.variancePenaltyFactor || 0.20) * (1 + Math.abs(baseMargin + momentumSwing) / 20);
        }

      // Path 2: partial margin stats
      } else if (homeStats || awayStats) {
        path = 'partial_stats';
        dataConfidence = 0.25;

        if (homeStats && (homeStats.samples || 0) >= 1) {
          var hn = Math.max(0, Number(homeStats.samples) || 0);
          baseMargin += (Number(homeStats.avgMargin) || 0) * (hn / (hn + activeShrinkK)) * 0.5;
        }
        if (awayStats && (awayStats.samples || 0) >= 1) {
          var an = Math.max(0, Number(awayStats.samples) || 0);
          baseMargin -= (Number(awayStats.avgMargin) || 0) * (an / (an + activeShrinkK)) * 0.5;
        }

      // [F3] Path 3: Quarter win-rate fallback (quarter-aware)
      } else if (quarterWinStats &&
                 quarterWinStats[homeTeam] && quarterWinStats[awayTeam] &&
                 quarterWinStats[homeTeam][Q] && quarterWinStats[awayTeam][Q]) {

        path = 'quarter_winrate_fallback';

        var hQ = quarterWinStats[homeTeam][Q];
        var aQ = quarterWinStats[awayTeam][Q];

        var hWp = Number(hQ.winPct || 50);
        var aWp = Number(aQ.winPct || 50);
        var edge = (hWp - aWp) / 100; // [-1..1] in practice small

        var qSd = fallbackSd;
        if (dynamicLeague && dynamicLeague[Q] && isFinite(dynamicLeague[Q].sd) && dynamicLeague[Q].sd > 0) {
          qSd = dynamicLeague[Q].sd;
        }

        baseMargin = edge * qSd;

        var rel = Math.min(Number(hQ.reliability || 0), Number(aQ.reliability || 0));
        dataConfidence = 0.20 + 0.50 * _clamp_(rel, 0, 1);

      // [F4] Path 4: quarter-weighted rank fallback (not flat)
      } else {
        path = 'rank_fallback';
        var hRank = (rankings[homeTeam] && rankings[homeTeam].rank) || 15;
        var aRank = (rankings[awayTeam] && rankings[awayTeam].rank) || 15;

        var qMult = { Q1: 0.65, Q2: 0.30, Q3: 0.65, Q4: 0.40 };
        baseMargin = (aRank - hRank) * (qMult[Q] || 0.5);

        dataConfidence = 0.20;
      }

      stats.paths[path] = (stats.paths[path] || 0) + 1;

      // Combine + penalties
      var finalMargin = baseMargin + momentumSwing;
      if (finalMargin > 0) finalMargin = Math.max(0, finalMargin - variancePenalty);
      else finalMargin = Math.min(0, finalMargin + variancePenalty);

      // Optional flip
      var flipKey = Q.toLowerCase() + '_flip';
      if (config[flipKey] === true) finalMargin = -finalMargin;

      // Soft-cap
      finalMargin = cap * Math.tanh(finalMargin / cap);

      var absMargin = Math.abs(finalMargin);

      // Adaptive thresholds
      var thrSan = _sanitizeThresholdsCapped_(thrRaw, cap);
      var thrUse = thrSan;

      if (typeof computeAdaptiveThreshold_ === 'function') {
        try {
          thrUse = computeAdaptiveThreshold_(thrSan, {
            cap: cap,
            homeStats: homeStats,
            awayStats: awayStats,
            leagueSd: fallbackSd,
            predictedAbsMargin: absMargin,
            cfg: ADAPT_CFG
          }) || thrSan;

          if (thrUse && thrUse.meta && thrUse.meta.enabled) stats.adaptiveUsed++;
        } catch (e2) {
          thrUse = thrSan;
        }
      }

      var tier = assignTier2PredictionTier(absMargin, thrUse);
      stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
      stats.byQuarter[Q]++;

      var thresholdConfidence = thrUse.confidence || thrSan.confidence || 0.35;
      var quality01 = _clamp_(dataConfidence * 0.6 + thresholdConfidence * 0.4, 0, 1);
      var confPct = _tierAlignedConfidencePct_(absMargin, thrUse, quality01);

      var tierWeight = TIER_WEIGHTS[tier] || 0.1;
      var edgeScore = Math.round(absMargin * tierWeight * (confPct / 100) * 100) / 100;
      gameEdge += edgeScore;

      // Display
      var predText = '';
      var bgColor = COLORS.even;

      if (tier === 'EVEN') {
        predText = 'EVEN';
        bgColor = COLORS.even;
      } else {
        var sign = (finalMargin > 0) ? 'H' : 'A';
        var val = (typeof roundToHalf_ === 'function') ? roundToHalf_(absMargin) : _roundHalf_(absMargin);
        var sym = (tier === 'STRONG') ? '★' : (tier === 'MEDIUM') ? '●' : '○';
        predText = sign + ' +' + val.toFixed(1) + ' ' + sym;

        if (sign === 'H') {
          bgColor = (tier === 'STRONG') ? COLORS.strongHome : (tier === 'MEDIUM') ? COLORS.medHome : COLORS.weakHome;
        } else {
          bgColor = (tier === 'STRONG') ? COLORS.strongAway : (tier === 'MEDIUM') ? COLORS.medAway : COLORS.weakAway;
        }
      }

      row[colMap[Q]] = predText;
      row[confColMap[Q]] = confPct + '%';
      rowColors.push(bgColor);

      allPredictions.push({
        rowIndex: r,
        gameId: homeTeam + ' vs ' + awayTeam,
        date: dateVal,
        quarter: Q,
        tier: tier,
        margin: absMargin,
        direction: finalMargin > 0 ? 'HOME' : 'AWAY',
        confidence: confPct,
        edgeScore: edgeScore,
        predText: predText,
        path: path
      });

      if (typeof logTier2Prediction === 'function') {
        try {
          logTier2Prediction(ss, {
            configVersion: config.config_version || config.version || 'v3.3',
            sourceSheet: 'UpcomingClean',
            rowIndex: r + 1,
            gameId: (league || '') + '_' + dateVal + '_' + homeTeam + '_vs_' + awayTeam,
            date: dateVal,
            time: timeVal,
            league: league,
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            quarter: Q,
            path: path,
            flipApplied: (config[flipKey] === true),
            flipKey: flipKey,
            finalMargin: finalMargin,
            absMargin: absMargin,
            tier: tier,
            dynamicThresholds: thrUse,
            thresholdSource: learnedThresholds.thresholdSource,
            confidence: confPct,
            edgeScore: edgeScore,
            predictionText: predText
          });
        } catch (e3) {}
      }

      dbg(homeTeam + ' vs ' + awayTeam + ' ' + Q + ' abs=' + absMargin.toFixed(2) +
          ' tier=' + tier + ' conf=' + confPct + ' path=' + path);
    }

    row[edgeCol] = gameEdge.toFixed(2);
    outputData.push(row);
    colorMatrix.push(rowColors);
  }

  // ═══════════════════════════════════════════════════════════════
  // Write results
  // ═══════════════════════════════════════════════════════════════
  allPredictions.sort(function(a, b) { return b.edgeScore - a.edgeScore; });

  upcomingSheet.clear();
  upcomingSheet.getRange(1, 1, outputData.length, outputData[0].length).setValues(outputData);

  // Apply colors to the 4 t2-q* cells
  if (colorMatrix.length > 0) {
    var startCol = Math.min(colMap.Q1, colMap.Q2, colMap.Q3, colMap.Q4) + 1;
    upcomingSheet.getRange(2, startCol, colorMatrix.length, 4).setBackgrounds(colorMatrix);
  }

  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('    v3.3 COMPLETE');
  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('Processed: ' + stats.processed + ' | Skipped: ' + stats.skipped);
  Logger.log('Tier Distribution: STRONG=' + stats.byTier.STRONG +
             ', MEDIUM=' + stats.byTier.MEDIUM +
             ', WEAK=' + stats.byTier.WEAK +
             ', EVEN=' + stats.byTier.EVEN);
  Logger.log('Paths: ' + JSON.stringify(stats.paths));
  Logger.log('[PHASE 2 COMPLETE] Tier2_Log: FORENSIC_CORE_17 + Tier2 diagnostics');
  Logger.log('[PHASE 3 COMPLETE] Tier2 validateConfigState_(threshold, strong_target, medium_target, even_target, config_version)');
  Logger.log('[Tier2 v3.3] DONE — Games: ' + stats.processed + ' | Predictions: ' + allPredictions.length + ' | Paths: ' + JSON.stringify(stats.paths));

  return {
    processed: stats.processed,
    skipped: stats.skipped,
    byTier: stats.byTier,
    byQuarter: stats.byQuarter,
    paths: stats.paths,
    adaptiveUsed: stats.adaptiveUsed,
    caps: caps,
    allPredictions: allPredictions
  };
}

// =============================================================================
// MODULE 5: O/U PREDICTIONS - PRODUCTION VERSION
// =============================================================================

/**
 * ============================================================================
 * computeAdaptiveThreshold_ - FINAL v2.0
 * ============================================================================
 * Dynamic threshold widening based on:
 *  - sample size (fewer samples → wider thresholds)
 *  - volatility (higher variance → wider thresholds)
 *  - predicted margin magnitude (larger predictions → slightly wider)
 *
 * INPUTS:
 *   baseThr: {even, medium, strong, confidence?} - baseline thresholds
 *   ctx: {
 *     cap: number - soft cap for this quarter
 *     homeStats: {samples, stdDev, rawMargins[]} | null
 *     awayStats: {samples, stdDev, rawMargins[]} | null
 *     leagueSd: number - fallback standard deviation
 *     predictedAbsMargin: number (optional)
 *     cfg: {
 *       adapt_enabled: boolean (default true)
 *       adapt_min_samples: number (default 8)
 *       adapt_sample_weight: number (default 0.50)
 *       adapt_volatility_weight: number (default 0.40)
 *       adapt_margin_weight: number (default 0.15)
 *       adapt_max_widen: number (default 2.0)
 *       adapt_confidence_floor: number (default 0.25)
 *     }
 *   }
 *
 * OUTPUT:
 *   { even, medium, strong, confidence, meta }
 */
function computeAdaptiveThreshold_(baseThr, ctx) {
  baseThr = baseThr || {};
  ctx = ctx || {};
  var cfg = ctx.cfg || {};

  // ─────────────────────────────────────────────────────────────────
  // Helper functions
  // ─────────────────────────────────────────────────────────────────
  function safeNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(x, lo, hi) {
    x = Number(x);
    if (!isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function calcStdDev(arr) {
    if (!arr || arr.length < 2) return NaN;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    var mean = sum / arr.length;
    var variance = 0;
    for (var j = 0; j < arr.length; j++) {
      var diff = arr[j] - mean;
      variance += diff * diff;
    }
    return Math.sqrt(variance / arr.length);
  }

  // ─────────────────────────────────────────────────────────────────
  // Sanitize base thresholds
  // ─────────────────────────────────────────────────────────────────
  var evenBase = Math.max(0.5, safeNum(baseThr.even, 2.5));
  var medBase = Math.max(evenBase + 0.5, safeNum(baseThr.medium, 4.5));
  var strBase = Math.max(medBase + 0.5, safeNum(baseThr.strong, 6.5));
  var confBase = clamp(safeNum(baseThr.confidence, 0.35), 0, 1);

  // ─────────────────────────────────────────────────────────────────
  // Check if adaptation is enabled
  // ─────────────────────────────────────────────────────────────────
  var enabled = (cfg.adapt_enabled !== false);
  if (!enabled) {
    return {
      even: evenBase,
      medium: medBase,
      strong: strBase,
      confidence: confBase,
      meta: { enabled: false, widen: 1.0 }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Configuration with sensible defaults
  // ─────────────────────────────────────────────────────────────────
  var MIN_SAMPLES = clamp(safeNum(cfg.adapt_min_samples, 8), 2, 30);
  var SAMPLE_WEIGHT = clamp(safeNum(cfg.adapt_sample_weight, 0.50), 0, 1);
  var VOL_WEIGHT = clamp(safeNum(cfg.adapt_volatility_weight, 0.40), 0, 1);
  var MARGIN_WEIGHT = clamp(safeNum(cfg.adapt_margin_weight, 0.15), 0, 0.5);
  var MAX_WIDEN = clamp(safeNum(cfg.adapt_max_widen, 2.0), 1.0, 3.0);
  var CONF_FLOOR = clamp(safeNum(cfg.adapt_confidence_floor, 0.25), 0.10, 0.50);

  var cap = clamp(safeNum(ctx.cap, 14), 6, 30);
  var leagueSd = clamp(safeNum(ctx.leagueSd, 8), 3, 15);

  // ─────────────────────────────────────────────────────────────────
  // Calculate effective sample count
  // ─────────────────────────────────────────────────────────────────
  var hN = Math.max(0, safeNum(ctx.homeStats && ctx.homeStats.samples, 0));
  var aN = Math.max(0, safeNum(ctx.awayStats && ctx.awayStats.samples, 0));
  var nEff = hN + aN;

  // ─────────────────────────────────────────────────────────────────
  // Calculate effective standard deviation
  // ─────────────────────────────────────────────────────────────────
  var hSd = safeNum(ctx.homeStats && ctx.homeStats.stdDev, NaN);
  var aSd = safeNum(ctx.awayStats && ctx.awayStats.stdDev, NaN);

  // Fallback: compute from raw margins if stdDev not provided
  if (!isFinite(hSd) && ctx.homeStats && ctx.homeStats.rawMargins) {
    hSd = calcStdDev(ctx.homeStats.rawMargins);
  }
  if (!isFinite(aSd) && ctx.awayStats && ctx.awayStats.rawMargins) {
    aSd = calcStdDev(ctx.awayStats.rawMargins);
  }

  var sdEff;
  if (isFinite(hSd) && isFinite(aSd)) {
    sdEff = (hSd + aSd) / 2;
  } else if (isFinite(hSd)) {
    sdEff = hSd;
  } else if (isFinite(aSd)) {
    sdEff = aSd;
  } else {
    sdEff = leagueSd;
  }
  sdEff = clamp(sdEff, 2, 20);

  // ─────────────────────────────────────────────────────────────────
  // Component 1: Low-sample widening
  // Fewer samples → higher uncertainty → wider thresholds
  // ─────────────────────────────────────────────────────────────────
  var sampleFactor;
  if (nEff <= 0) {
    sampleFactor = 1.0; // Maximum uncertainty
  } else if (nEff >= MIN_SAMPLES * 2) {
    sampleFactor = 0.0; // Full confidence in data
  } else {
    // Linear ramp: 1.0 at nEff=0, 0.0 at nEff=MIN_SAMPLES*2
    sampleFactor = clamp(1 - (nEff / (MIN_SAMPLES * 2)), 0, 1);
  }
  var sampleBoost = sampleFactor * SAMPLE_WEIGHT;

  // ─────────────────────────────────────────────────────────────────
  // Component 2: Volatility widening
  // Higher variance relative to league average → wider thresholds
  // ─────────────────────────────────────────────────────────────────
  var volRatio = sdEff / leagueSd;
  var volFactor;
  if (volRatio <= 0.8) {
    volFactor = 0.0; // Low volatility, no widening needed
  } else if (volRatio >= 1.5) {
    volFactor = 1.0; // Very high volatility
  } else {
    // Smooth ramp between 0.8 and 1.5
    volFactor = clamp((volRatio - 0.8) / 0.7, 0, 1);
  }
  var volBoost = volFactor * VOL_WEIGHT;

  // ─────────────────────────────────────────────────────────────────
  // Component 3: Large margin widening
  // Extreme predictions are less stable → slightly wider thresholds
  // ─────────────────────────────────────────────────────────────────
  var absM = Math.max(0, safeNum(ctx.predictedAbsMargin, 0));
  var marginFactor = clamp(absM / cap, 0, 1);
  var marginBoost = marginFactor * MARGIN_WEIGHT;

  // ─────────────────────────────────────────────────────────────────
  // Combine all factors into widen multiplier
  // ─────────────────────────────────────────────────────────────────
  var totalBoost = sampleBoost + volBoost + marginBoost;
  var widen = 1 + totalBoost;
  widen = clamp(widen, 1.0, MAX_WIDEN);

  // ─────────────────────────────────────────────────────────────────
  // Apply widening to thresholds (respect cap)
  // ─────────────────────────────────────────────────────────────────
  var evenAdj = clamp(evenBase * widen, 0.5, cap * 0.6);
  var medAdj = clamp(medBase * widen, evenAdj + 0.5, cap * 0.85);
  var strAdj = clamp(strBase * widen, medAdj + 0.5, cap);

  // ─────────────────────────────────────────────────────────────────
  // Confidence penalty: more widening → lower confidence
  // ─────────────────────────────────────────────────────────────────
  var confPenalty = (widen - 1) * 0.35; // 35% penalty per 1.0 widen
  var confAdj = clamp(confBase - confPenalty, CONF_FLOOR, confBase);

  return {
    even: evenAdj,
    medium: medAdj,
    strong: strAdj,
    confidence: confAdj,
    meta: {
      enabled: true,
      widen: widen,
      nEff: nEff,
      sampleFactor: sampleFactor,
      sampleBoost: sampleBoost,
      sdEff: sdEff,
      volFactor: volFactor,
      volBoost: volBoost,
      absMargin: absM,
      marginBoost: marginBoost,
      cap: cap
    }
  };
}


function calculatePushProbability_(expectedQ, scaledSD, threshold, tolerance) {
  if (scaledSD <= 0) return 0;
  tolerance = tolerance || 0.5;
  
  var zLow = (threshold - tolerance - expectedQ) / scaledSD;
  var zHigh = (threshold + tolerance - expectedQ) / scaledSD;
  
  return normalCDF_(zHigh) - normalCDF_(zLow);
}


function calculateExpectedValue_(pWin, pPush) {
  pPush = pPush || 0;
  var pLose = 1 - pWin - pPush;
  
  var ev = (pWin * 100) - (pLose * 110);
  var evPercent = ev / 110;
  
  return {
    raw: ev,
    percent: evPercent
  };
}



function loadLeagueQuarterOUStats_(ss, debug) {
  var FN = 'loadLeagueQuarterOUStats_';
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  debug = (debug === true);

  var sh = ss.getSheetByName('LeagueQuarterO_U_Stats');
  if (!sh) throw new Error(FN + ': Missing sheet "LeagueQuarterO_U_Stats"');

  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) throw new Error(FN + ': Sheet is empty');

  /* ── helpers ── */
  function norm_(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9%]/g, '');
  }
  function toNum_(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var s = String(v == null ? '' : v).trim();
    if (!s || s.toLowerCase() === 'n/a') return NaN;
    if (s.indexOf('%') >= 0) {
      var p = parseFloat(s.replace('%', ''));
      return isFinite(p) ? p : NaN;
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function toPct_(v) {
    var n = toNum_(v);
    if (!isFinite(n)) return NaN;
    // Sheets sometimes stores 0.557 instead of 55.7
    if (n > 0 && n <= 1.5) return n * 100;
    return n;
  }

  /* ── find header row (handles title/spacer rows above) ── */
  var headerRow = -1;
  var colMap = {};

  for (var r = 0; r < Math.min(values.length, 50); r++) {
    var normed = values[r].map(norm_);
    var hasLeague  = normed.indexOf('league') >= 0;
    var hasQuarter = normed.indexOf('quarter') >= 0 || normed.indexOf('qtr') >= 0;
    var hasMean    = normed.some(function(h) { return h.indexOf('mean') >= 0 && h.indexOf('pred') < 0 && h.indexOf('safe') < 0; });
    var hasSD      = normed.some(function(h) { return h === 'sd' || h.indexOf('std') >= 0 || h.indexOf('stdev') >= 0; });

    if (hasLeague && hasQuarter && hasMean && hasSD) {
      headerRow = r;
      for (var c = 0; c < normed.length; c++) {
        if (normed[c]) colMap[normed[c]] = c;
      }
      break;
    }
  }

  if (headerRow < 0) {
    throw new Error(FN + ': Cannot find header row with League, Quarter, Mean, SD in "LeagueQuarterO_U_Stats"');
  }

  /* ── resolve column indices ── */
  function findCol_(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var k = norm_(candidates[i]);
      if (colMap.hasOwnProperty(k)) return colMap[k];
    }
    // partial match fallback
    var keys = Object.keys(colMap);
    for (var i = 0; i < candidates.length; i++) {
      var target = norm_(candidates[i]);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].indexOf(target) >= 0) return colMap[keys[j]];
      }
    }
    return -1;
  }

  var cLeague  = findCol_(['league']);
  var cQuarter = findCol_(['quarter', 'qtr']);
  var cCount   = findCol_(['count', 'games']);
  var cSD      = findCol_(['sd', 'stdev', 'standarddeviation']);

  // Mean (Actual) — must avoid "Pred. Q Avg" and "Safe Lower/Upper"
  var cMean = -1;
  var colKeys = Object.keys(colMap);
  for (var ci = 0; ci < colKeys.length; ci++) {
    var h = colKeys[ci];
    if (h.indexOf('mean') >= 0 && h.indexOf('pred') < 0 && h.indexOf('safe') < 0) {
      cMean = colMap[h];
      break;
    }
  }

  var cOver  = findCol_(['over%', 'over']);
  var cUnder = findCol_(['under%', 'under']);

  if (cLeague < 0 || cQuarter < 0 || cMean < 0 || cSD < 0) {
    throw new Error(FN + ': Missing required columns. Resolved: league=' + cLeague +
      ' quarter=' + cQuarter + ' mean=' + cMean + ' sd=' + cSD +
      ' | Headers found: ' + JSON.stringify(colMap));
  }

  /* ── parse data rows ── */
  var out = {};   // { "LeagueName": { Q1:{mean,sd,count,overPct,underPct}, Q2:... }, ... }
  var validQs = { Q1: true, Q2: true, Q3: true, Q4: true };
  var parsed = 0;

  for (var i = headerRow + 1; i < values.length; i++) {
    var row = values[i];
    var league  = String(row[cLeague]  || '').trim();
    var quarter = String(row[cQuarter] || '').trim().toUpperCase();

    if (!league && !quarter) continue;   // blank spacer row

    if (!league || !quarter) {
      throw new Error(FN + ': Malformed row ' + (i + 1) + ' (league="' + league + '", quarter="' + quarter + '")');
    }

    if (!validQs[quarter]) continue;     // skip OT or other rows

    var mean     = toNum_(row[cMean]);
    var sd       = toNum_(row[cSD]);
    var count    = (cCount >= 0) ? toNum_(row[cCount]) : 0;
    var overPct  = (cOver  >= 0) ? toPct_(row[cOver])  : NaN;
    var underPct = (cUnder >= 0) ? toPct_(row[cUnder]) : NaN;

    if (!isFinite(mean) || !isFinite(sd)) {
      throw new Error(FN + ': Non-numeric mean/sd at row ' + (i + 1) +
        ' (' + league + ' ' + quarter + ') mean=' + row[cMean] + ' sd=' + row[cSD]);
    }

    if (!out[league]) out[league] = {};
    out[league][quarter] = {
      mean:     mean,
      sd:       sd,
      count:    isFinite(count)    ? count    : 0,
      overPct:  isFinite(overPct)  ? overPct  : NaN,
      underPct: isFinite(underPct) ? underPct : NaN
    };
    parsed++;
  }

  /* ── validate: every league must have all four quarters ── */
  var leagues = Object.keys(out);
  if (!leagues.length) throw new Error(FN + ': Parsed 0 leagues from sheet');

  for (var li = 0; li < leagues.length; li++) {
    var L = leagues[li];
    var missing = [];
    var qs = ['Q1', 'Q2', 'Q3', 'Q4'];
    for (var qi = 0; qi < qs.length; qi++) {
      if (!out[L][qs[qi]] || !isFinite(out[L][qs[qi]].mean) || !isFinite(out[L][qs[qi]].sd)) {
        missing.push(qs[qi]);
      }
    }
    if (missing.length) {
      throw new Error(FN + ': League "' + L + '" missing quarters: ' + missing.join(', '));
    }
  }

  if (debug) {
    Logger.log('[' + FN + '] Parsed ' + leagues.length + ' league(s), ' + parsed + ' rows. Leagues: ' + leagues.join(', '));
    for (var di = 0; di < leagues.length; di++) {
      var dL = leagues[di];
      Logger.log('[' + FN + '] ' + dL + ' Q1.mean=' + out[dL].Q1.mean + ' Q2.mean=' + out[dL].Q2.mean +
        ' Q3.mean=' + out[dL].Q3.mean + ' Q4.mean=' + out[dL].Q4.mean);
    }
  }

  return out;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * QUARTER O/U PREDICTION - TIER 2 ENHANCED
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 
 * Analyzes all 4 quarters × 2 directions = 8 opportunities per game
 * Provides multiple selection strategies:
 * - Highest Confidence (best probability)
 * - Highest EV (best expected value)
 * - Directional (OVER→highest expected, UNDER→lowest expected)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * ELITE O/U CONFIG - NO RESTRICTIONS, BAYESIAN INTELLIGENCE
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
var OU_CONFIG = {
  // Core probability settings
  BREAKEVEN_PROB: 0.524,
  DEFAULT_EDGE: 0.02,           // Lowered to capture more opportunities
  
  // Sample requirements - NOW UNRESTRICTED
  MIN_SAMPLES: 1,               // Works with ANY data (was 20)
  PREFERRED_SAMPLES: 30,        // Used for confidence scaling only
  
  // Bayesian confidence parameters
  CONFIDENCE_SCALE: 25,         // Samples for ~75% sample confidence
  MIN_CONFIDENCE: 0.20,         // Even 1 sample provides signal
  MAX_CONFIDENCE: 0.95,         // Cap confidence at 95%
  
  // Edge/EV settings - Relaxed to show more
  MIN_EXPECTED_EV: 0.005,       // Lowered from 0.02 to show more picks
  SOFT_EV_THRESHOLD: 0.02,      // Soft threshold for tier assignment
  
  // Statistical settings
  PUSH_TOLERANCE: 0.5,
  UNCERTAINTY_CONSTANT: 10,
  JUICE: 0.9091,
  
  // Quarters
  QUARTERS: ['Q1', 'Q2', 'Q3', 'Q4'],
  
  // Bayesian priors (used when data is sparse)
  PRIORS: {
    Q1: { mean: 52.0, sd: 8.0 },
    Q2: { mean: 54.0, sd: 8.5 },
    Q3: { mean: 51.0, sd: 8.0 },
    Q4: { mean: 55.0, sd: 9.0 },
    default: { mean: 53.0, sd: 8.5 }
  },
  
  // Tier thresholds for edge score ranking
  TIERS: {
    ELITE: { minConf: 70, minEV: 0.05 },
    STRONG: { minConf: 62, minEV: 0.03 },
    MEDIUM: { minConf: 55, minEV: 0.015 },
    WEAK: { minConf: 52.4, minEV: 0.005 }
  }
};
/* ============================================================================
 * TIER2 ADAPTIVE THRESHOLD LEARNER v2.4.0
 * ============================================================================
 * 
 * FEATURES:
 *   - Leakage-free ROLLING approach for CleanBacktested sheets
 *   - Supports BOTH quarter column formats:
 *       1) Separate: Q1H, Q1A, Q2H, Q2A, ... (numeric)
 *       2) Combined: Q1, Q2, Q3, Q4 with "26 - 30" strings
 *   - Configurable minimum prediction margin (minPredictionMargin)
 *   - Configurable minimum samples per quarter (minQuarterSamples)
 *   - Returns overall AND per-quarter hit rates
 *   - Explicit logging when quarters fall back to overall thresholds
 *   - Self-contained with all helper functions included
 *   - 4-tier priority: CleanBacktested → Tier2_Accuracy → Tier2_Log → Clean+Stats
 * 
 * USAGE:
 *   var thresholds = computeBacktestedTier2Thresholds_(ss, {
 *     minPredictionMargin: 0.5,
 *     minQuarterSamples: 30,
 *     strongTarget: 0.75,
 *     mediumTarget: 0.65,
 *     evenTarget: 0.55
 *   });
 * 
 * ============================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (Self-contained)
// ═══════════════════════════════════════════════════════════════════════════

// createHeaderMap / getSheetInsensitive: Module_00_Contract_Enforcer (Patch 8 — no duplicate defs).

/**
 * Detect quarter column indices with separate home/away columns
 * Looks for patterns like: Q1H/Q1A, Q1_Home/Q1_Away, HomeQ1/AwayQ1, etc.
 * @param {Object} headerMap
 * @returns {Object} { valid: boolean, Q1H, Q1A, Q2H, Q2A, Q3H, Q3A, Q4H, Q4A }
 */
function detectBacktestedQuarterColumns_(headerMap) {
  var result = { valid: false };
  
  var patterns = [
    { Q1H: 'q1h', Q1A: 'q1a', Q2H: 'q2h', Q2A: 'q2a', Q3H: 'q3h', Q3A: 'q3a', Q4H: 'q4h', Q4A: 'q4a' },
    { Q1H: 'q1_home', Q1A: 'q1_away', Q2H: 'q2_home', Q2A: 'q2_away', Q3H: 'q3_home', Q3A: 'q3_away', Q4H: 'q4_home', Q4A: 'q4_away' },
    { Q1H: 'q1home', Q1A: 'q1away', Q2H: 'q2home', Q2A: 'q2away', Q3H: 'q3home', Q3A: 'q3away', Q4H: 'q4home', Q4A: 'q4away' },
    { Q1H: 'homeq1', Q1A: 'awayq1', Q2H: 'homeq2', Q2A: 'awayq2', Q3H: 'homeq3', Q3A: 'awayq3', Q4H: 'homeq4', Q4A: 'awayq4' },
    { Q1H: 'home_q1', Q1A: 'away_q1', Q2H: 'home_q2', Q2A: 'away_q2', Q3H: 'home_q3', Q3A: 'away_q3', Q4H: 'home_q4', Q4A: 'away_q4' },
    { Q1H: '1qh', Q1A: '1qa', Q2H: '2qh', Q2A: '2qa', Q3H: '3qh', Q3A: '3qa', Q4H: '4qh', Q4A: '4qa' },
    { Q1H: '1q_h', Q1A: '1q_a', Q2H: '2q_h', Q2A: '2q_a', Q3H: '3q_h', Q3A: '3q_a', Q4H: '4q_h', Q4A: '4q_a' }
  ];
  
  for (var pi = 0; pi < patterns.length; pi++) {
    var p = patterns[pi];
    var allFound = true;
    
    for (var key in p) {
      if (headerMap[p[key]] === undefined) {
        allFound = false;
        break;
      }
    }
    
    if (allFound) {
      result.valid = true;
      result.Q1H = headerMap[p.Q1H];
      result.Q1A = headerMap[p.Q1A];
      result.Q2H = headerMap[p.Q2H];
      result.Q2A = headerMap[p.Q2A];
      result.Q3H = headerMap[p.Q3H];
      result.Q3A = headerMap[p.Q3A];
      result.Q4H = headerMap[p.Q4H];
      result.Q4A = headerMap[p.Q4A];
      return result;
    }
  }
  
  return result;
}

/**
 * Detect simple quarter columns like Q1, Q2, Q3, Q4 (single column per quarter)
 * Used for sheets where quarter scores are stored as "26 - 30"
 * @param {Object} headerMap
 * @returns {Object} { valid: boolean, Q1, Q2, Q3, Q4 }
 */
function detectSimpleQuarterColumns_(headerMap) {
  var q1 = headerMap.q1;
  var q2 = headerMap.q2;
  var q3 = headerMap.q3;
  var q4 = headerMap.q4;
  
  if (q1 === undefined || q2 === undefined || q3 === undefined || q4 === undefined) {
    return { valid: false };
  }
  
  return {
    valid: true,
    Q1: q1,
    Q2: q2,
    Q3: q3,
    Q4: q4
  };
}

/**
 * Parse a quarter cell like "26 - 30" into numeric home/away scores
 * Handles various separators: "-", "–" (en dash), "—" (em dash)
 * @param {*} value - Cell value
 * @returns {Object} { home: Number|null, away: Number|null }
 */
function parseQuarterScoreCell_(value) {
  if (value === null || value === undefined || value === '') {
    return { home: null, away: null };
  }
  
  // If it's already a number, can't split into home/away
  if (typeof value === 'number') {
    return { home: null, away: null };
  }
  
  var s = String(value).trim();
  if (!s) return { home: null, away: null };
  
  // Match patterns like "26 - 30", "26-30", "26 – 30", "26—30"
  var m = s.match(/(-?\d+)\s*[-–—]\s*(-?\d+)/);
  if (!m) {
    return { home: null, away: null };
  }
  
  var home = parseInt(m[1], 10);
  var away = parseInt(m[2], 10);
  
  if (!isFinite(home) || !isFinite(away)) {
    return { home: null, away: null };
  }
  
  return { home: home, away: away };
}

/**
 * Create game key for result matching
 * @param {Date|string} date
 * @param {string} home
 * @param {string} away
 * @returns {string|null}
 */
function createGameKey_(date, home, away) {
  if (!home || !away) return null;
  
  var dateStr = '';
  if (date) {
    if (date instanceof Date) {
      try {
        dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } catch (e) {
        dateStr = String(date);
      }
    } else {
      dateStr = String(date).trim();
    }
  }
  
  return dateStr + '|' + String(home).trim().toLowerCase() + '|' + String(away).trim().toLowerCase();
}

/**
 * Get quarter scores from a row, supporting both column formats
 * @param {Array} row - Data row
 * @param {Object} qColsRich - Result from detectBacktestedQuarterColumns_ (or null)
 * @param {Object} qColsSimple - Result from detectSimpleQuarterColumns_ (or null)
 * @param {string} quarter - "Q1", "Q2", "Q3", or "Q4"
 * @returns {Object} { homeScore: Number|NaN, awayScore: Number|NaN }
 */
function getQuarterScores_(row, qColsRich, qColsSimple, quarter) {
  var homeScore = NaN;
  var awayScore = NaN;
  
  if (qColsRich && qColsRich.valid) {
    homeScore = parseFloat(row[qColsRich[quarter + 'H']]);
    awayScore = parseFloat(row[qColsRich[quarter + 'A']]);
  } else if (qColsSimple && qColsSimple.valid) {
    var parsed = parseQuarterScoreCell_(row[qColsSimple[quarter]]);
    homeScore = parsed.home;
    awayScore = parsed.away;
  }
  
  return { homeScore: homeScore, awayScore: awayScore };
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY 1: CleanBacktested (ROLLING - NO LEAKAGE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load training samples from CleanBacktested sheets using ROLLING approach
 * 
 * KEY BEHAVIOR:
 *   - Predicts each game using ONLY stats from earlier games
 *   - Updates stats AFTER scoring (prevents data leakage)
 *   - Skipped predictions still contribute to learning (intentional)
 *   - Supports both Q1H/Q1A and Q1 "26-30" formats
 *
 * @param {Spreadsheet} ss
 * @param {string} logPrefix - Prefix for log messages
 * @param {Object} [opts] - Options
 * @param {number} [opts.minMargin=0.5] - Minimum |predictedMargin| to include as sample
 * @returns {Object|null} { Q1: [], Q2: [], Q3: [], Q4: [], overall: [] }
 */
function tryLoadFromCleanBacktested_(ss, logPrefix, opts) {
  opts = opts || {};
  
  // Use explicit null/undefined check to allow minMargin=0
  var MIN_PREDICTION_MARGIN = (opts.minMargin !== null && opts.minMargin !== undefined)
    ? opts.minMargin
    : 0.5;

  var sheets = ss.getSheets();
  var backtestedSheets = [];
  
  // Match all CleanBacktested variants
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (/^CleanBacktest(ed)?/i.test(name) || 
        /^Backtested/i.test(name) || 
        /^Clean_Backtest(ed)?/i.test(name) ||
        /^BackTest/i.test(name)) {
      backtestedSheets.push(sheets[i]);
    }
  }
  
  if (backtestedSheets.length === 0) {
    Logger.log('[' + logPrefix + '] No CleanBacktested sheets found');
    return null;
  }
  
  Logger.log('[' + logPrefix + '] Found ' + backtestedSheets.length + ' CleanBacktested sheet(s)');
  Logger.log('[' + logPrefix + '] Using minMargin=' + MIN_PREDICTION_MARGIN);
  
  var samples = { Q1: [], Q2: [], Q3: [], Q4: [], overall: [] };
  
  // Rolling team stats: team -> { Home: {Q1: {n, sum}, ...}, Away: {...} }
  var stats = {};
  
  function ensureTeam(team) {
    if (!stats[team]) {
      stats[team] = { Home: {}, Away: {} };
    }
    return stats[team];
  }
  
  function ensureQuarter(team, venue, q) {
    var t = ensureTeam(team);
    if (!t[venue][q]) {
      t[venue][q] = { n: 0, sum: 0 };
    }
    return t[venue][q];
  }
  
  function getAvgMargin(team, venue, q) {
    var t = stats[team];
    if (!t || !t[venue] || !t[venue][q] || t[venue][q].n === 0) {
      return null;
    }
    return t[venue][q].sum / t[venue][q].n;
  }
  
  function predictMargin(home, away, q) {
    var homeAvg = getAvgMargin(home, 'Home', q);
    var awayAvg = getAvgMargin(away, 'Away', q);
    
    if (homeAvg === null || awayAvg === null) {
      return null;
    }
    
    return homeAvg - awayAvg;
  }
  
  function updateStats(home, away, q, actualMargin) {
    var hCell = ensureQuarter(home, 'Home', q);
    hCell.n++;
    hCell.sum += actualMargin;
    
    var aCell = ensureQuarter(away, 'Away', q);
    aCell.n++;
    aCell.sum += (-actualMargin);
  }
  
  function getDateIndex(h) {
    if (h.date !== undefined) return h.date;
    if (h.gamedate !== undefined) return h.gamedate;
    if (h.game_date !== undefined) return h.game_date;
    return undefined;
  }
  
  function toTimestamp(v) {
    if (!v) return null;
    if (v instanceof Date) return v.getTime();
    var d = new Date(v);
    return isFinite(d.getTime()) ? d.getTime() : null;
  }
  
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  
  for (var si = 0; si < backtestedSheets.length; si++) {
    var sheet = backtestedSheets[si];
    var sheetName = sheet.getName();
    
    if (sheet.getLastRow() < 2) continue;
    
    var data = sheet.getDataRange().getValues();
    var h = createHeaderMap(data[0]);
    
    var homeIdx = h.home !== undefined ? h.home : h.hometeam;
    var awayIdx = h.away !== undefined ? h.away : h.awayteam;
    
    if (homeIdx === undefined || awayIdx === undefined) {
      Logger.log('[' + logPrefix + '] ' + sheetName + ': Missing home/away columns');
      continue;
    }
    
    // Try both column formats
    var qColsRich = detectBacktestedQuarterColumns_(h);
    var qColsSimple = null;
    
    if (!qColsRich.valid) {
      qColsSimple = detectSimpleQuarterColumns_(h);
      if (!qColsSimple.valid) {
        Logger.log('[' + logPrefix + '] ' + sheetName + ': No quarter columns found');
        continue;
      }
      Logger.log('[' + logPrefix + '] ' + sheetName + ': Using simple Q1..Q4 format');
    } else {
      Logger.log('[' + logPrefix + '] ' + sheetName + ': Using Q1H/Q1A format');
    }
    
    var dateIdx = getDateIndex(h);
    
    var rowIndices = [];
    for (var r = 1; r < data.length; r++) {
      rowIndices.push(r);
    }
    
    if (dateIdx !== undefined) {
      rowIndices.sort(function(a, b) {
        var ta = toTimestamp(data[a][dateIdx]);
        var tb = toTimestamp(data[b][dateIdx]);
        if (ta === null && tb === null) return a - b;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      });
      Logger.log('[' + logPrefix + '] ' + sheetName + ': Sorted by date (' + rowIndices.length + ' rows)');
    }
    
    var sheetSamples = 0;
    var sheetSkippedNoPrior = 0;
    var sheetSkippedLowMargin = 0;
    
    for (var ri = 0; ri < rowIndices.length; ri++) {
      var row = data[rowIndices[ri]];
      
      var home = String(row[homeIdx] || '').trim().toLowerCase();
      var away = String(row[awayIdx] || '').trim().toLowerCase();
      
      if (!home || !away) continue;
      
      for (var qi = 0; qi < quarters.length; qi++) {
        var q = quarters[qi];
        
        var scores = getQuarterScores_(row, qColsRich.valid ? qColsRich : null, qColsSimple, q);
        var homeScore = scores.homeScore;
        var awayScore = scores.awayScore;
        
        if (!isFinite(homeScore) || !isFinite(awayScore)) continue;
        
        var actualMargin = homeScore - awayScore;
        var predictedMargin = predictMargin(home, away, q);
        
        if (predictedMargin === null) {
          updateStats(home, away, q, actualMargin);
          sheetSkippedNoPrior++;
          continue;
        }
        
        if (Math.abs(predictedMargin) < MIN_PREDICTION_MARGIN) {
          updateStats(home, away, q, actualMargin);
          sheetSkippedLowMargin++;
          continue;
        }
        
        var hit = (actualMargin !== 0) && ((predictedMargin > 0) === (actualMargin > 0));
        
        var sample = { margin: Math.abs(predictedMargin), hit: hit };
        samples.overall.push(sample);
        samples[q].push(sample);
        sheetSamples++;
        
        updateStats(home, away, q, actualMargin);
      }
    }
    
    Logger.log('[' + logPrefix + '] ' + sheetName + ': ' + sheetSamples + ' samples' +
               ', ' + sheetSkippedNoPrior + ' skipped (no prior)' +
               ', ' + sheetSkippedLowMargin + ' skipped (low margin)');
  }
  
  Logger.log('[' + logPrefix + '] CleanBacktested total: ' + samples.overall.length + ' samples');
  Logger.log('[' + logPrefix + '] By quarter: Q1=' + samples.Q1.length +
             ', Q2=' + samples.Q2.length +
             ', Q3=' + samples.Q3.length +
             ', Q4=' + samples.Q4.length);
  Logger.log('[' + logPrefix + '] Teams tracked: ' + Object.keys(stats).length);
  
  return samples.overall.length > 0 ? samples : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY 2: Tier2_Accuracy (Live Prediction Tracking)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load from Tier2_Accuracy or Stats_Tier2_Accuracy sheet
 * @param {Spreadsheet} ss
 * @param {string} logPrefix
 * @returns {Object|null}
 */
function tryLoadFromTier2Accuracy_(ss, logPrefix) {
  var accSheet = getSheetInsensitive(ss, 'Tier2_Accuracy') ||
                 getSheetInsensitive(ss, 'Stats_Tier2_Accuracy');
  
  if (!accSheet || accSheet.getLastRow() < 10) {
    Logger.log('[' + logPrefix + '] Tier2_Accuracy/Stats_Tier2_Accuracy not found or too small');
    return null;
  }

  var data = accSheet.getDataRange().getValues();

  // Find detail header row
  var headerRowIndex = -1;
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    if (!row || row.length < 5) continue;

    var firstCell = String(row[0] || '').trim().toLowerCase();
    if (firstCell === 'date') {
      var tmpMap = createHeaderMap(row);
      var hasAbsMargin = tmpMap.abs_margin !== undefined || tmpMap.absmargin !== undefined;
      var hasResult = tmpMap.result !== undefined;
      var hasSide = tmpMap.pred_side !== undefined || tmpMap.predside !== undefined || tmpMap.side !== undefined;
      
      if (hasAbsMargin && hasResult && hasSide) {
        headerRowIndex = r;
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    Logger.log('[' + logPrefix + '] No valid detail header in Tier2_Accuracy');
    return null;
  }

  var h = createHeaderMap(data[headerRowIndex]);
  var idxQuarter = h.quarter;
  var idxAbsMargin = h.abs_margin !== undefined ? h.abs_margin : h.absmargin;
  var idxResult = h.result;
  var idxSide = h.pred_side !== undefined ? h.pred_side : 
                (h.predside !== undefined ? h.predside : h.side);

  if (idxQuarter === undefined || idxAbsMargin === undefined ||
      idxResult === undefined || idxSide === undefined) {
    Logger.log('[' + logPrefix + '] Missing required columns in Tier2_Accuracy');
    return null;
  }

  var samples = { Q1: [], Q2: [], Q3: [], Q4: [], overall: [] };

  for (var i = headerRowIndex + 1; i < data.length; i++) {
    var row = data[i];
    var res = String(row[idxResult] || '').trim().toUpperCase();
    var side = String(row[idxSide] || '').trim().toUpperCase();
    var q = String(row[idxQuarter] || '').trim().toUpperCase();
    var absM = parseFloat(row[idxAbsMargin]);

    if (side !== 'H' && side !== 'A' && side !== 'HOME' && side !== 'AWAY') continue;
    if (res !== 'HIT' && res !== 'MISS' && res !== 'WIN' && res !== 'LOSS') continue;
    if (!isFinite(absM)) continue;

    var isHit = (res === 'HIT' || res === 'WIN');
    var sample = { margin: absM, hit: isHit };
    
    samples.overall.push(sample);
    if (samples[q]) {
      samples[q].push(sample);
    }
  }

  Logger.log('[' + logPrefix + '] Tier2_Accuracy loaded: ' + samples.overall.length + ' total');
  return samples.overall.length > 0 ? samples : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY 3: Tier2_Log + Results
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load from Tier2_Log matched against Results sheet
 * Supports both Q1H/Q1A and Q1 "26-30" formats
 * @param {Spreadsheet} ss
 * @param {string} logPrefix
 * @returns {Object|null}
 */
function tryLoadFromTier2Log_(ss, logPrefix) {
  var logSheet = getSheetInsensitive(ss, 'Tier2_Log');
  if (!logSheet || logSheet.getLastRow() < 2) {
    Logger.log('[' + logPrefix + '] Tier2_Log not found or empty');
    return null;
  }

  var logData = logSheet.getDataRange().getValues();
  var logH = createHeaderMap(logData[0]);

  var homeIdx = logH.home !== undefined ? logH.home : logH.hometeam;
  var awayIdx = logH.away !== undefined ? logH.away : logH.awayteam;
  var quarterIdx = logH.quarter;
  var predIdx = logH.prediction_text !== undefined ? logH.prediction_text : logH.predictiontext;
  
  if (homeIdx === undefined || awayIdx === undefined || 
      quarterIdx === undefined || predIdx === undefined) {
    Logger.log('[' + logPrefix + '] Tier2_Log missing required columns');
    return null;
  }

  var resultsSheet = getSheetInsensitive(ss, 'ResultsClean') ||
                     getSheetInsensitive(ss, 'Clean') ||
                     getSheetInsensitive(ss, 'Results');
  
  if (!resultsSheet || resultsSheet.getLastRow() < 2) {
    Logger.log('[' + logPrefix + '] Results sheet not found');
    return null;
  }

  var resData = resultsSheet.getDataRange().getValues();
  var resH = createHeaderMap(resData[0]);

  // Try both column formats
  var qColsRich = detectBacktestedQuarterColumns_(resH);
  var qColsSimple = null;
  
  if (!qColsRich.valid) {
    qColsSimple = detectSimpleQuarterColumns_(resH);
    if (!qColsSimple.valid) {
      Logger.log('[' + logPrefix + '] No quarter columns in results (neither Q1H/Q1A nor Q1..Q4)');
      return null;
    }
    Logger.log('[' + logPrefix + '] Using simple Q1..Q4 quarter columns in results');
  } else {
    Logger.log('[' + logPrefix + '] Using Q1H/Q1A quarter columns in results');
  }

  var resHomeIdx = resH.home !== undefined ? resH.home : resH.hometeam;
  var resAwayIdx = resH.away !== undefined ? resH.away : resH.awayteam;
  var resDateIdx = resH.date !== undefined ? resH.date : resH.gamedate;
  
  var resultMap = {};
  for (var i = 1; i < resData.length; i++) {
    var row = resData[i];
    var key = createGameKey_(row[resDateIdx], row[resHomeIdx], row[resAwayIdx]);
    if (key) resultMap[key] = row;
  }

  Logger.log('[' + logPrefix + '] Result map: ' + Object.keys(resultMap).length + ' games');

  var samples = { Q1: [], Q2: [], Q3: [], Q4: [], overall: [] };

  var logDateIdx = logH.date !== undefined ? logH.date : logH.gamedate;
  var absMarginIdx = logH.abs_margin !== undefined ? logH.abs_margin : logH.absmargin;

  for (var li = 1; li < logData.length; li++) {
    var logRow = logData[li];

    var homeTeam = String(logRow[homeIdx] || '').trim();
    var awayTeam = String(logRow[awayIdx] || '').trim();
    var dateVal = logRow[logDateIdx];
    var quarter = String(logRow[quarterIdx] || '').trim().toUpperCase();
    var predText = String(logRow[predIdx] || '').trim().toUpperCase();
    var absMargin = parseFloat(logRow[absMarginIdx]);

    if (!homeTeam || !awayTeam || !quarter || !predText) continue;
    if (['Q1', 'Q2', 'Q3', 'Q4'].indexOf(quarter) === -1) continue;
    if (!isFinite(absMargin)) absMargin = 2.5;
    if (predText === 'EVEN' || predText === 'E') continue;

    var gameKey = createGameKey_(dateVal, homeTeam, awayTeam);
    var resRow = resultMap[gameKey];
    if (!resRow) continue;

    // Get quarter scores using appropriate format
    var scores = getQuarterScores_(resRow, qColsRich.valid ? qColsRich : null, qColsSimple, quarter);
    var homeScore = scores.homeScore;
    var awayScore = scores.awayScore;
    
    if (!isFinite(homeScore) || !isFinite(awayScore)) continue;
    
    var actualMargin = homeScore - awayScore;

    var predictedHome = predText.indexOf('HOME') >= 0 || predText.indexOf('H ') === 0 || 
                        predText === 'H' || predText.indexOf('H+') === 0;
    var predictedAway = predText.indexOf('AWAY') >= 0 || predText.indexOf('A ') === 0 || 
                        predText === 'A' || predText.indexOf('A+') === 0;
    
    if (!predictedHome && !predictedAway) continue;
    
    var hit = (predictedHome && actualMargin > 0) || (predictedAway && actualMargin < 0);

    samples.overall.push({ margin: absMargin, hit: hit });
    samples[quarter].push({ margin: absMargin, hit: hit });
  }

  Logger.log('[' + logPrefix + '] Tier2_Log loaded: ' + samples.overall.length + ' total');
  return samples.overall.length > 0 ? samples : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY 4: Clean + MarginStats (Fallback)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Backtest using pre-built marginStats
 * Supports both Q1H/Q1A and Q1 "26-30" formats
 * @param {Spreadsheet} ss
 * @param {string} logPrefix
 * @returns {Object|null}
 */
function tryLoadFromCleanSheets_(ss, logPrefix) {
  var marginStats = null;
  try {
    if (typeof loadTier2MarginStats === 'function') {
      marginStats = loadTier2MarginStats(ss);
    }
  } catch (e) {
    Logger.log('[' + logPrefix + '] loadTier2MarginStats failed: ' + e.message);
    return null;
  }
  
  if (!marginStats || Object.keys(marginStats).length < 10) {
    Logger.log('[' + logPrefix + '] Insufficient margin stats for backtesting');
    return null;
  }

  var cleanSheet = getSheetInsensitive(ss, 'Clean') ||
                   getSheetInsensitive(ss, 'ResultsClean') ||
                   getSheetInsensitive(ss, 'Results');
  
  if (!cleanSheet || cleanSheet.getLastRow() < 2) {
    Logger.log('[' + logPrefix + '] No Clean/Results sheet found');
    return null;
  }

  var data = cleanSheet.getDataRange().getValues();
  var h = createHeaderMap(data[0]);
  
  var homeIdx = h.home !== undefined ? h.home : h.hometeam;
  var awayIdx = h.away !== undefined ? h.away : h.awayteam;
  
  if (homeIdx === undefined || awayIdx === undefined) {
    Logger.log('[' + logPrefix + '] Clean sheet missing home/away columns');
    return null;
  }

  // Try both column formats
  var qColsRich = detectBacktestedQuarterColumns_(h);
  var qColsSimple = null;
  
  if (!qColsRich.valid) {
    qColsSimple = detectSimpleQuarterColumns_(h);
    if (!qColsSimple.valid) {
      Logger.log('[' + logPrefix + '] No quarter columns in Clean sheet (neither Q1H/Q1A nor Q1..Q4)');
      return null;
    }
    Logger.log('[' + logPrefix + '] Using simple Q1..Q4 quarter columns from Clean');
  } else {
    Logger.log('[' + logPrefix + '] Using Q1H/Q1A quarter columns from Clean');
  }

  var samples = { Q1: [], Q2: [], Q3: [], Q4: [], overall: [] };
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var processed = 0;
  var skippedNoStats = 0;
  var skippedNoScores = 0;
  var skippedLowMargin = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var home = String(row[homeIdx] || '').trim().toLowerCase();
    var away = String(row[awayIdx] || '').trim().toLowerCase();
    
    if (!home || !away) continue;
    
    var homeStats = marginStats[home];
    var awayStats = marginStats[away];
    
    if (!homeStats || !awayStats) {
      skippedNoStats++;
      continue;
    }

    for (var qi = 0; qi < quarters.length; qi++) {
      var q = quarters[qi];
      
      // Get quarter scores using appropriate format
      var scores = getQuarterScores_(row, qColsRich.valid ? qColsRich : null, qColsSimple, q);
      var homeScore = scores.homeScore;
      var awayScore = scores.awayScore;
      
      if (!isFinite(homeScore) || !isFinite(awayScore)) {
        skippedNoScores++;
        continue;
      }
      
      var actualMargin = homeScore - awayScore;

      var homeAvg = (homeStats.Home && homeStats.Home[q]) ? homeStats.Home[q].avgMargin : null;
      var awayAvg = (awayStats.Away && awayStats.Away[q]) ? awayStats.Away[q].avgMargin : null;
      
      if (homeAvg === null || awayAvg === null) {
        skippedNoStats++;
        continue;
      }
      
      var predictedMargin = homeAvg - awayAvg;
      var absMargin = Math.abs(predictedMargin);
      
      if (absMargin < 0.5) {
        skippedLowMargin++;
        continue;
      }

      var hit = (actualMargin !== 0) && ((predictedMargin > 0) === (actualMargin > 0));

      var sample = { margin: absMargin, hit: hit };
      samples.overall.push(sample);
      samples[q].push(sample);
      processed++;
    }
  }

  Logger.log('[' + logPrefix + '] Clean backtest: ' + samples.overall.length + ' samples');
  Logger.log('[' + logPrefix + '] Skipped: noStats=' + skippedNoStats + 
             ', noScores=' + skippedNoScores + ', lowMargin=' + skippedLowMargin);
  Logger.log('[' + logPrefix + '] By quarter: Q1=' + samples.Q1.length +
             ', Q2=' + samples.Q2.length +
             ', Q3=' + samples.Q3.length +
             ', Q4=' + samples.Q4.length);

  return samples.overall.length > 0 ? samples : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION: computeBacktestedTier2Thresholds_
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute adaptive thresholds from historical data
 * 
 * @param {Spreadsheet} ss
 * @param {Object} [options]
 * @param {number} [options.minPredictionMargin=0.5] - Min |margin| to include as sample
 * @param {number} [options.minQuarterSamples=30] - Min samples for quarter-specific thresholds
 * @param {number} [options.strongTarget=0.75] - Hit rate target for STRONG tier
 * @param {number} [options.mediumTarget=0.65] - Hit rate target for MEDIUM tier
 * @param {number} [options.evenTarget=0.55] - Hit rate target for EVEN tier
 * @param {number} [options.confidenceScale=50] - Samples for ~75% confidence
 * 
 * @returns {Object} Learned thresholds with diagnostics
 */
function computeBacktestedTier2Thresholds_(ss, options) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  options = options || {};

  var FUNC_NAME = 'computeBacktestedTier2Thresholds_';
  
  // Target hit-rates
  var STRONG_TARGET = options.strongTarget || 0.75;
  var MEDIUM_TARGET = options.mediumTarget || 0.65;
  var EVEN_TARGET = options.evenTarget || 0.55;
  
  // Confidence parameters
  var CONFIDENCE_SCALE = options.confidenceScale || 50;
  var MIN_CONFIDENCE = 0.15;
  
  // Configurable thresholds - use explicit null checks to allow 0
  var MIN_PREDICTION_MARGIN = (options.minPredictionMargin !== null && options.minPredictionMargin !== undefined)
    ? options.minPredictionMargin
    : 0.5;
    
  var MIN_QUARTER_SAMPLES = (options.minQuarterSamples !== null && options.minQuarterSamples !== undefined)
    ? options.minQuarterSamples
    : 30;
  
  // Prior thresholds
  var PRIOR = {
    even: 2.5,
    medium: 4.5,
    strong: 6.5,
    confidence: 0.3
  };
  
  var EMPTY_RESULT = {
    learned: false,
    confidence: PRIOR.confidence,
    Q1: Object.assign({}, PRIOR),
    Q2: Object.assign({}, PRIOR),
    Q3: Object.assign({}, PRIOR),
    Q4: Object.assign({}, PRIOR),
    overall: Object.assign({}, PRIOR),
    sampleSize: 0,
    thresholdSource: 'PRIOR',
    dataSource: 'NONE',
    quarterSamples: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    overallHitRate: null,
    quarterHitRates: { Q1: null, Q2: null, Q3: null, Q4: null }
  };

  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════════════════════════');
  Logger.log('[' + FUNC_NAME + '] ADAPTIVE THRESHOLD LEARNING v2.4.0');
  Logger.log('[' + FUNC_NAME + '] Supports Q1H/Q1A AND Q1 "26-30" formats');
  Logger.log('[' + FUNC_NAME + '] Priority: CleanBacktested → Tier2_Accuracy → Tier2_Log → Clean+Stats');
  Logger.log('[' + FUNC_NAME + '] Config: minMargin=' + MIN_PREDICTION_MARGIN + 
             ', minQuarterSamples=' + MIN_QUARTER_SAMPLES);
  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════════════════════════');

  // ═══════════════════════════════════════════════════════════════════════
  // TRY DATA SOURCES IN PRIORITY ORDER
  // ═══════════════════════════════════════════════════════════════════════
  var samples = null;
  var dataSource = 'PRIOR';
  
  // STRATEGY 1: CleanBacktested (ROLLING - no leakage)
  Logger.log('[' + FUNC_NAME + '] Trying CleanBacktested (rolling approach)...');
  samples = tryLoadFromCleanBacktested_(ss, FUNC_NAME, { minMargin: MIN_PREDICTION_MARGIN });
  if (samples && samples.overall && samples.overall.length > 0) {
    dataSource = 'CLEAN_BACKTESTED';
    Logger.log('[' + FUNC_NAME + '] ✓ Using ' + samples.overall.length + ' samples from CleanBacktested');
  }
  
  // STRATEGY 2: Tier2_Accuracy
  if (!samples || samples.overall.length === 0) {
    Logger.log('[' + FUNC_NAME + '] Trying Tier2_Accuracy...');
    samples = tryLoadFromTier2Accuracy_(ss, FUNC_NAME);
    if (samples && samples.overall && samples.overall.length > 0) {
      dataSource = 'TIER2_ACCURACY';
      Logger.log('[' + FUNC_NAME + '] ✓ Using ' + samples.overall.length + ' samples from Tier2_Accuracy');
    }
  }
  
  // STRATEGY 3: Tier2_Log + Results
  if (!samples || samples.overall.length === 0) {
    Logger.log('[' + FUNC_NAME + '] Trying Tier2_Log + Results...');
    samples = tryLoadFromTier2Log_(ss, FUNC_NAME);
    if (samples && samples.overall && samples.overall.length > 0) {
      dataSource = 'TIER2_LOG';
      Logger.log('[' + FUNC_NAME + '] ✓ Using ' + samples.overall.length + ' samples from Tier2_Log');
    }
  }
  
  // STRATEGY 4: Clean + MarginStats
  if (!samples || samples.overall.length === 0) {
    Logger.log('[' + FUNC_NAME + '] Trying Clean + MarginStats...');
    samples = tryLoadFromCleanSheets_(ss, FUNC_NAME);
    if (samples && samples.overall && samples.overall.length > 0) {
      dataSource = 'CLEAN_MARGINSTATS';
      Logger.log('[' + FUNC_NAME + '] ✓ Using ' + samples.overall.length + ' samples from Clean+MarginStats');
    }
  }
  
  var totalSamples = samples && samples.overall ? samples.overall.length : 0;
  
  if (totalSamples === 0) {
    Logger.log('[' + FUNC_NAME + '] ⚠ No historical data found');
    Logger.log('[' + FUNC_NAME + '] Using prior thresholds. Add CleanBacktested sheets to enable learning.');
    return EMPTY_RESULT;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COMPUTE HIT RATES
  // ═══════════════════════════════════════════════════════════════════════
  function computeHitRate(sampleArr) {
    if (!sampleArr || sampleArr.length === 0) return null;
    var hits = 0;
    for (var i = 0; i < sampleArr.length; i++) {
      if (sampleArr[i].hit) hits++;
    }
    return Math.round((hits / sampleArr.length) * 1000) / 1000;
  }
  
  var overallHitRate = computeHitRate(samples.overall);
  var quarterHitRates = {
    Q1: computeHitRate(samples.Q1),
    Q2: computeHitRate(samples.Q2),
    Q3: computeHitRate(samples.Q3),
    Q4: computeHitRate(samples.Q4)
  };

  Logger.log('[' + FUNC_NAME + '] ───────────────────────────────────────');
  Logger.log('[' + FUNC_NAME + '] Data source: ' + dataSource);
  Logger.log('[' + FUNC_NAME + '] Total samples: ' + totalSamples + 
             ' | Overall hit rate: ' + (overallHitRate * 100).toFixed(1) + '%');
  Logger.log('[' + FUNC_NAME + '] Quarter samples: Q1=' + samples.Q1.length +
             ', Q2=' + samples.Q2.length +
             ', Q3=' + samples.Q3.length +
             ', Q4=' + samples.Q4.length);
  Logger.log('[' + FUNC_NAME + '] Quarter hit rates: Q1=' + 
             (quarterHitRates.Q1 !== null ? (quarterHitRates.Q1 * 100).toFixed(1) + '%' : 'N/A') +
             ', Q2=' + (quarterHitRates.Q2 !== null ? (quarterHitRates.Q2 * 100).toFixed(1) + '%' : 'N/A') +
             ', Q3=' + (quarterHitRates.Q3 !== null ? (quarterHitRates.Q3 * 100).toFixed(1) + '%' : 'N/A') +
             ', Q4=' + (quarterHitRates.Q4 !== null ? (quarterHitRates.Q4 * 100).toFixed(1) + '%' : 'N/A'));
  Logger.log('[' + FUNC_NAME + '] ───────────────────────────────────────');

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIDENCE CALCULATION
  // ═══════════════════════════════════════════════════════════════════════
  function calculateConfidence(n) {
    if (n === 0) return MIN_CONFIDENCE;
    var conf = Math.min(0.95, MIN_CONFIDENCE + (1 - MIN_CONFIDENCE) * (1 - Math.exp(-n / CONFIDENCE_SCALE)));
    return Math.round(conf * 100) / 100;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BAYESIAN BLENDING
  // ═══════════════════════════════════════════════════════════════════════
  function blendWithPrior(learned, confidence) {
    if (!learned) return Object.assign({}, PRIOR);
    var priorWeight = 1 - confidence;
    var learnedWeight = confidence;
    
    return {
      even: Math.round((learned.even * learnedWeight + PRIOR.even * priorWeight) * 10) / 10,
      medium: Math.round((learned.medium * learnedWeight + PRIOR.medium * priorWeight) * 10) / 10,
      strong: Math.round((learned.strong * learnedWeight + PRIOR.strong * priorWeight) * 10) / 10,
      confidence: confidence
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // THRESHOLD DERIVATION
  // ═══════════════════════════════════════════════════════════════════════
  function deriveThresholds(sampleArr, label) {
    if (!sampleArr || sampleArr.length === 0) {
      Logger.log('[' + FUNC_NAME + '] ' + label + ': No samples, using prior');
      return null;
    }

    var n = sampleArr.length;
    var confidence = calculateConfidence(n);
    
    var sorted = sampleArr.slice().sort(function(a, b) {
      return a.margin - b.margin;
    });

    // Build suffix hit-rate arrays
    var suffHits = new Array(n);
    var suffCount = new Array(n);
    var hitsSoFar = 0;
    var countSoFar = 0;

    for (var idx = n - 1; idx >= 0; idx--) {
      countSoFar++;
      if (sorted[idx].hit) hitsSoFar++;
      suffHits[idx] = hitsSoFar;
      suffCount[idx] = countSoFar;
    }

    var strong = null, medium = null, even = null;

    for (var i = 0; i < n; i++) {
      var hitRate = suffHits[i] / suffCount[i];
      var margin = sorted[i].margin;

      if (strong === null && hitRate >= STRONG_TARGET) strong = margin;
      if (medium === null && hitRate >= MEDIUM_TARGET) medium = margin;
      if (even === null && hitRate >= EVEN_TARGET) even = margin;
    }

    // Smart fallbacks
    var maxMargin = sorted[n - 1].margin;
    var avgMargin = sorted.reduce(function(sum, s) { return sum + s.margin; }, 0) / n;
    var hits = sorted.filter(function(s) { return s.hit; }).length;
    var localHitRate = hits / n;
    
    if (strong === null) strong = Math.max(maxMargin * 1.1, PRIOR.strong);
    if (medium === null) medium = Math.min(strong * 0.72, Math.max(avgMargin * 0.9, PRIOR.medium));
    if (even === null) even = Math.min(medium * 0.55, Math.max(avgMargin * 0.5, PRIOR.even));

    // Enforce strict ordering
    if (medium >= strong) medium = strong * 0.72;
    if (even >= medium) even = medium * 0.55;

    // Floor values
    even = Math.max(1.0, even);
    medium = Math.max(2.0, medium);
    strong = Math.max(4.0, strong);

    var learnedRaw = {
      even: Math.round(even * 10) / 10,
      medium: Math.round(medium * 10) / 10,
      strong: Math.round(strong * 10) / 10
    };

    var blended = blendWithPrior(learnedRaw, confidence);

    Logger.log('[' + FUNC_NAME + '] ' + label + ' (n=' + n + ', hitRate=' + 
               (localHitRate * 100).toFixed(1) + '%, conf=' + (confidence * 100).toFixed(0) + '%)');
    Logger.log('[' + FUNC_NAME + ']   Learned: EVEN=' + learnedRaw.even + 
               ' MED=' + learnedRaw.medium + ' STRONG=' + learnedRaw.strong);
    Logger.log('[' + FUNC_NAME + ']   Blended: EVEN=' + blended.even + 
               ' MED=' + blended.medium + ' STRONG=' + blended.strong);

    return blended;
  }

  /**
   * Derive quarter thresholds with explicit fallback logging
   */
  function deriveQuarterOrOverall(qSamples, label, overallT) {
    var n = qSamples ? qSamples.length : 0;
    
    if (!qSamples || n === 0) {
      Logger.log('[' + FUNC_NAME + '] ' + label + ': No samples → using OVERALL thresholds');
      return overallT;
    }
    
    if (n < MIN_QUARTER_SAMPLES) {
      Logger.log('[' + FUNC_NAME + '] ' + label + ': Only ' + n + ' samples (< ' + 
                 MIN_QUARTER_SAMPLES + ') → using OVERALL thresholds');
      return overallT;
    }
    
    return deriveThresholds(qSamples, label) || overallT;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DERIVE ALL THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════
  var overallT = deriveThresholds(samples.overall, 'OVERALL');
  if (!overallT) overallT = Object.assign({}, PRIOR);

  var q1T = deriveQuarterOrOverall(samples.Q1, 'Q1', overallT);
  var q2T = deriveQuarterOrOverall(samples.Q2, 'Q2', overallT);
  var q3T = deriveQuarterOrOverall(samples.Q3, 'Q3', overallT);
  var q4T = deriveQuarterOrOverall(samples.Q4, 'Q4', overallT);

  var overallConfidence = calculateConfidence(totalSamples);
  var thresholdSource = overallConfidence >= 0.7 ? 'LEARNED' : 
                        overallConfidence >= 0.4 ? 'BLENDED' : 'PRIOR_WEIGHTED';

  var result = {
    learned: true,
    confidence: overallConfidence,
    Q1: q1T,
    Q2: q2T,
    Q3: q3T,
    Q4: q4T,
    overall: overallT,
    sampleSize: totalSamples,
    thresholdSource: thresholdSource,
    dataSource: dataSource,
    quarterSamples: {
      Q1: samples.Q1 ? samples.Q1.length : 0,
      Q2: samples.Q2 ? samples.Q2.length : 0,
      Q3: samples.Q3 ? samples.Q3.length : 0,
      Q4: samples.Q4 ? samples.Q4.length : 0
    },
    overallHitRate: overallHitRate,
    quarterHitRates: quarterHitRates
  };

  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════════════════════════');
  Logger.log('[' + FUNC_NAME + '] SUCCESS: ' + thresholdSource + ' thresholds from ' + dataSource);
  Logger.log('[' + FUNC_NAME + '] Samples: ' + totalSamples + 
             ' | Confidence: ' + (overallConfidence * 100).toFixed(0) + '%' +
             ' | Hit rate: ' + (overallHitRate * 100).toFixed(1) + '%');
  Logger.log('[' + FUNC_NAME + '] OVERALL: EVEN=' + overallT.even + 
             ' MED=' + overallT.medium + ' STRONG=' + overallT.strong);
  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════════════════════════');

  return result;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * writeOUPredictionsToSheet - SAFE DELEGATOR
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Since predictQuarters_Tier2_OU() now writes correctly via setValues(),
 * this function just wraps it to avoid duplicating fragile row-matching logic.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function writeOUPredictionsToSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('  O/U WRITER (SAFE DELEGATOR)');
  Logger.log('  Delegating to predictQuarters_Tier2_OU()');
  Logger.log('═══════════════════════════════════════════════════════════════');

  var res = predictQuarters_Tier2_OU(ss, { showUI: false });

  Logger.log('[O/U WRITER] Complete.');
  Logger.log('  Games processed: ' + (res ? res.games : 0));
  Logger.log('  Picks written: ' + (res ? res.picks : 0));
  Logger.log('  By tier: ' + (res ? JSON.stringify(res.byTier) : 'N/A'));
  Logger.log('═══════════════════════════════════════════════════════════════');

  return res;
}




// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function findCol_(headerMap, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    if (headerMap[aliases[i]] !== undefined) {
      return headerMap[aliases[i]];
    }
  }
  return -1;
}

function normalizeMatchup_(matchup) {
  return String(matchup || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*vs\.?\s*/g, ' vs ')
    .replace(/\s*@\s*/g, ' vs ')
    .replace(/q[1-4]\s*:?.*$/i, '')  // Remove quarter suffix
    .trim();
}

function extractQuarter_(label) {
  var match = String(label).match(/q(\d)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function findGameRow_(allData, matchup, colMap) {
  var awayCol = colMap.awayTeam;
  var homeCol = colMap.homeTeam;
  
  if (awayCol < 0 || homeCol < 0) {
    // Try to parse from matchup
    var parts = normalizeMatchup_(matchup).split(' vs ');
    if (parts.length !== 2) return -1;
    
    var awayTeam = normalizeTeam_(parts[0]);
    var homeTeam = normalizeTeam_(parts[1]);
    
    // Search all columns for team names
    for (var r = 1; r < allData.length; r++) {
      var row = allData[r];
      var rowText = row.join(' ').toLowerCase();
      
      if (rowText.indexOf(awayTeam) !== -1 && rowText.indexOf(homeTeam) !== -1) {
        return r;
      }
    }
    return -1;
  }
  
  // Parse matchup
  var parts = normalizeMatchup_(matchup).split(' vs ');
  if (parts.length !== 2) return -1;
  
  var awayTeam = normalizeTeam_(parts[0]);
  var homeTeam = normalizeTeam_(parts[1]);
  
  for (var r = 1; r < allData.length; r++) {
    var rowAway = normalizeTeam_(allData[r][awayCol]);
    var rowHome = normalizeTeam_(allData[r][homeCol]);
    
    if (rowAway.indexOf(awayTeam) !== -1 || awayTeam.indexOf(rowAway) !== -1) {
      if (rowHome.indexOf(homeTeam) !== -1 || homeTeam.indexOf(rowHome) !== -1) {
        return r;
      }
    }
  }
  
  return -1;
}

function normalizeTeam_(team) {
  return String(team || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function writeQuarterPrediction_(allData, rowIdx, pred, colMap, qNum) {
  var prefix = 'ouQ' + qNum;
  
  // Main pick (e.g., "UNDER 58.0 ★")
  if (colMap[prefix] >= 0) {
    allData[rowIdx][colMap[prefix]] = pred.pick || pred.label || '';
  }
  
  // Confidence
  if (colMap[prefix + 'Conf'] >= 0) {
    allData[rowIdx][colMap[prefix + 'Conf']] = pred.confidence || pred.conf || '';
  }
  
  // EV
  if (colMap[prefix + 'Ev'] >= 0) {
    allData[rowIdx][colMap[prefix + 'Ev']] = pred.ev || '';
  }
  
  // Edge
  if (colMap[prefix + 'Edge'] >= 0) {
    allData[rowIdx][colMap[prefix + 'Edge']] = pred.edge || '';
  }
  
  // Push probability
  if (colMap[prefix + 'Push'] >= 0) {
    allData[rowIdx][colMap[prefix + 'Push']] = pred.pushProb || pred.pPush || '';
  }
  
  // Tier
  if (colMap[prefix + 'Tier'] >= 0) {
    allData[rowIdx][colMap[prefix + 'Tier']] = pred.tier || '';
  }
}

function writeBestPrediction_(allData, rowIdx, preds, colMap) {
  // Find the best pick among q1-q4
  var best = null;
  var bestEdge = -Infinity;
  var bestQ = 0;
  
  for (var q = 1; q <= 4; q++) {
    var p = preds['q' + q];
    if (p && (p.edge || 0) > bestEdge) {
      best = p;
      bestEdge = p.edge || 0;
      bestQ = q;
    }
  }
  
  if (!best) return;
  
  // Write best columns
  if (colMap.ouBest >= 0) {
    allData[rowIdx][colMap.ouBest] = best.pick || best.label || '';
  }
  
  if (colMap.ouBestQ >= 0) {
    allData[rowIdx][colMap.ouBestQ] = 'Q' + bestQ;
  }
  
  if (colMap.ouBestEv >= 0) {
    allData[rowIdx][colMap.ouBestEv] = best.ev || '';
  }
  
  if (colMap.ouBestEdge >= 0) {
    allData[rowIdx][colMap.ouBestEdge] = best.edge || '';
  }
  
  if (colMap.ouBestConf >= 0) {
    allData[rowIdx][colMap.ouBestConf] = best.confidence || best.conf || '';
  }
  
  if (colMap.ouBestDir >= 0) {
    allData[rowIdx][colMap.ouBestDir] = best.direction || (String(best.pick).indexOf('OVER') !== -1 ? 'OVER' : 'UNDER');
  }
  
  // Edge score (sum of all quarter edges)
  if (colMap.ouEdgeScore >= 0) {
    var totalEdge = 0;
    for (var q = 1; q <= 4; q++) {
      if (preds['q' + q]) {
        totalEdge += preds['q' + q].edge || 0;
      }
    }
    allData[rowIdx][colMap.ouEdgeScore] = totalEdge.toFixed(2);
  }
  
  // Game tier (best tier among quarters)
  if (colMap.ouGameTier >= 0) {
    var tierOrder = { 'ELITE': 4, 'STRONG': 3, 'MEDIUM': 2, 'WEAK': 1 };
    var bestTier = 'WEAK';
    var bestTierScore = 0;
    
    for (var q = 1; q <= 4; q++) {
      var p = preds['q' + q];
      if (p && p.tier && (tierOrder[p.tier] || 0) > bestTierScore) {
        bestTier = p.tier;
        bestTierScore = tierOrder[p.tier];
      }
    }
    allData[rowIdx][colMap.ouGameTier] = bestTier;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * predictQuarters_Tier2_OU - UNIFIED v7.0 (Forebet + Bayesian + Tier System)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * MERGED CAPABILITIES:
 *   - Forebet integration with blending (from v6.0)
 *   - Bayesian confidence system (from Unrestricted)
 *   - Full tier system: ELITE > STRONG > MEDIUM > WEAK > PASS
 *   - Global ranking by edge score
 *   - Color coding by tier
 *   - Works with existing helper functions
 *   - Backward compatible with both calling conventions
 * 
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED CONFIGURATION (Merged from both systems)
// ═══════════════════════════════════════════════════════════════════════════════
var UNIFIED_OU_CONFIG = {
  VERSION: 'v7.0-UNIFIED',
  version: 'v7.0-UNIFIED',
  LAST_UPDATED: new Date().toISOString(),
  
  QUARTERS: ['Q1', 'Q2', 'Q3', 'Q4'],
  
  // Probability thresholds
  BREAKEVEN_PROB: 0.5238,  // -110 juice
  /** American odds baseline (merged from Config_Tier2 "juice" when present) */
  JUICE: -110,
  /** Default sigma fallback when league SD missing (Phase 3 — sheet override key: fallback_sd) */
  fallbackSd: 8.5,
  DEFAULT_EDGE: 0.04,
  MIN_EXPECTED_EV: 0.005,
  PUSH_TOLERANCE: 0.5,
  
  // Bayesian system
  MIN_CONFIDENCE: 0.20,
  MAX_CONFIDENCE: 0.95,
  CONFIDENCE_SCALE: 20,
  PREFERRED_SAMPLES: 25,
  UNCERTAINTY_CONSTANT: 5,
  
  // Quarter priors (from NBA averages)
  PRIORS: {
    Q1: { mean: 54.5, sd: 8.2 },
    Q2: { mean: 53.8, sd: 8.5 },
    Q3: { mean: 53.0, sd: 8.8 },
    Q4: { mean: 55.2, sd: 9.5 },
    default: { mean: 54.0, sd: 8.5 }
  },
  
  // Tier thresholds
  TIERS: {
    ELITE:  { minConf: 72, minEV: 0.08, symbol: '⭐', weight: 1.0 },
    STRONG: { minConf: 62, minEV: 0.05, symbol: '★',  weight: 0.8 },
    MEDIUM: { minConf: 55, minEV: 0.02, symbol: '●',  weight: 0.6 },
    WEAK:   { minConf: 52, minEV: 0.00, symbol: '○',  weight: 0.4 },
    PASS:   { minConf: 0,  minEV: -1,   symbol: '—',  weight: 0.1 }
  },
  
  // Colors by tier and direction
  COLORS: {
    eliteOver:   '#004d00',
    strongOver:  '#228B22',
    mediumOver:  '#90EE90',
    weakOver:    '#C8F7C8',
    eliteUnder:  '#8B0000',
    strongUnder: '#DC143C',
    mediumUnder: '#FFB6C1',
    weakUnder:   '#FFD6DC',
    pass:        '#F5F5DC',
    estimate:    '#E8E8E8',
    na:          '#D3D3D3',
    highest:     '#FFD700',
    lowSample:   '#FFFACD',
    bayesian:    '#E6E6FA',
    forebet:     '#E0FFFF'
  }
};

// Module-level OU_CFG so helper functions (_assignTier, _calcEdgeScore, etc.)
// can reference it as a global. Gets overwritten per-run inside predictQuarters_Tier2_OU.
var OU_CFG = UNIFIED_OU_CONFIG;


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * predictQuarters_Tier2_OU — PATCHED (R3 + R4-PATCH2)
 * File: Module 6 (Analyzers_Tier2_OU.gs)
 * ═══════════════════════════════════════════════════════════════════════════
 * Prior patches preserved:
 *   Fix 3A: Dynamic league from teamStats
 *   Fix 3B: Dynamic Forebet weight
 *   Guard:  typeof check on t2ou_predictQuarterTotal_
 *
 * R4-PATCH2 additions (Fixes 4A + 4C — purely additive, no logic changes):
 *   1. Reads shared gameContext from options.gameContext (Patch 1 passes this)
 *      with fallback to global t2_getSharedGameContext_().
 *   2. Creates per-game record in gameContext.games[gameKey] on first encounter.
 *   3. Records per-quarter {mu, sigma, muRaw, sigmaRaw, sampleSize, ...}
 *      into gameContext.games[gameKey].ouPredictions[Q] AFTER all adjustments
 *      (Bayesian shrinkage + Forebet blend) — these are the values HQ consumes.
 *   4. Records null-model entries so HQ can distinguish "tried and failed"
 *      from "not yet run."
 *   5. Updates game-level ouMeta and ctx.ou rollup for diagnostics.
 *
 * What this patch does NOT change:
 *   - Pick logic, thresholds, blending math, sheet output — all identical.
 *   - No new data fetches. No new sheet writes. Pure in-memory handoff.
 *   - Signature unchanged: (ss, options)
 *   - Graceful degradation: if gameContext is null, all new code is skipped.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function predictQuarters_Tier2_OU(ss, options) {
  ss = _safeGetSpreadsheet(ss);
  options = options || {};

  // ═══════════════════════════════════════════════════════════════════════════
  // R4-PATCH2: Shared in-memory gameContext hookup (Fix 4C)
  // Prefer explicit handoff via options.gameContext; fallback to global accessor.
  // If neither exists, gameContext stays null and all ctx code is safely skipped.
  // ═══════════════════════════════════════════════════════════════════════════
  var gameContext = (options && options.gameContext)
    ? options.gameContext
    : ((typeof t2_getSharedGameContext_ === 'function') ? t2_getSharedGameContext_() : null);

  OU_CFG = (typeof mergeUnifiedOuConfigWithSheet_ === 'function')
    ? mergeUnifiedOuConfigWithSheet_(ss, UNIFIED_OU_CONFIG)
    : UNIFIED_OU_CONFIG;
  if (typeof validateConfigState_ === 'function') {
    try {
      validateConfigState_(OU_CFG, ['VERSION', 'BREAKEVEN_PROB', 'JUICE', 'fallbackSd']);
    } catch (eVal) {
      Logger.log('[predictQuarters_Tier2_OU] validateConfigState_: ' + eVal);
    }
  }

  // Game key helper — matches accumulator convention: (home + ' vs ' + away).toLowerCase()
  // All downstream patches (4-7) must use the same keying.
  function _ouGameKey_(home, away) {
    return (String(home || '').trim() + ' vs ' + String(away || '').trim()).toLowerCase();
  }

  var VERSION = OU_CFG.VERSION + '-PATCHED-R3';
  var showUI = options.showUI !== false;
  var ui = showUI ? SpreadsheetApp.getUi() : null;

  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('  UNIFIED O/U PREDICTIONS (' + VERSION + ')');
  Logger.log('  Forebet + Bayesian + Tier System');
  Logger.log('═══════════════════════════════════════════════════════════════');

  // R4-PATCH2: One-time trace note (verifies runtime order via ctx.steps from Patch 1)
  if (gameContext && gameContext.runId) {
    Logger.log('[R4-P2] Shared gameContext active: runId=' + gameContext.runId);
    if (typeof t2_traceSharedGameContextStep_ === 'function') {
      t2_traceSharedGameContextStep_('ou', 'ENTER', 'predictQuarters_Tier2_OU');
    }
  }

  var sheet = _getSheetSafe(ss, 'UpcomingClean');
  if (!sheet) throw new Error('UpcomingClean not found.');

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return _returnResult(0, 0, 0, VERSION, showUI, ui);
  }

  var headerRow = data[0];
  var h = _buildHeaderMap(headerRow);

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECK FOR DUPLICATE HEADERS
  // ═══════════════════════════════════════════════════════════════════════════
  var dupCheck = t2ou_detectDuplicateHeaders_(headerRow);
  if (dupCheck.hasDuplicates) {
    Logger.log('⚠️ WARNING: Duplicate ou-* columns detected!');
    Logger.log('   Writes will go to LAST occurrence. First block may appear empty.');
    dupCheck.duplicates.forEach(function(d) {
      Logger.log('   - "' + d.name + '" at columns: ' + d.indices.map(function(i) { return i + 1; }).join(', '));
    });
  }

  // Validate required columns
  var required = ['home', 'away'];
  var missing = required.filter(function(k) { return h[k] === undefined; });
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));

  // ═══════════════════════════════════════════════════════════════════════════
  // ENSURE OUTPUT COLUMNS
  // ═══════════════════════════════════════════════════════════════════════════
  var outCols = [
    'ou-q1', 'ou-q1-conf', 'ou-q1-ev', 'ou-q1-edge', 'ou-q1-push', 'ou-q1-tier',
    'ou-q2', 'ou-q2-conf', 'ou-q2-ev', 'ou-q2-edge', 'ou-q2-push', 'ou-q2-tier',
    'ou-q3', 'ou-q3-conf', 'ou-q3-ev', 'ou-q3-edge', 'ou-q3-push', 'ou-q3-tier',
    'ou-q4', 'ou-q4-conf', 'ou-q4-ev', 'ou-q4-edge', 'ou-q4-push', 'ou-q4-tier',
    'ou-best', 'ou-best-q', 'ou-best-ev', 'ou-best-edge',
    'ou-best-conf', 'ou-best-dir',
    'ou-edge-score', 'ou-game-tier', 'ou-highest-est',
    'ou-fb-used', 'ou-bayesian-used'
  ];

  data = _ensureColumns(data, outCols);
  headerRow = data[0];
  h = _buildHeaderMap(headerRow);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  var cfg = _loadConfig(ss);
  var debug = cfg.debug_ou_logging === true || String(cfg.debug_ou_logging).toLowerCase() === 'true';

  var EDGE = parseFloat(cfg.ou_edge_threshold) || OU_CFG.DEFAULT_EDGE;
  var MIN_EV = parseFloat(cfg.ou_min_ev) || OU_CFG.MIN_EXPECTED_EV;
  var CONF_SCALE = parseFloat(cfg.ou_confidence_scale) || OU_CFG.CONFIDENCE_SCALE;

  Logger.log('[Config] Edge threshold: ' + (EDGE * 100).toFixed(1) + '%');
  Logger.log('[Config] Min EV: ' + (MIN_EV * 100).toFixed(2) + '%');
  Logger.log('[Config] Confidence scale: ' + CONF_SCALE);

  // ═══════════════════════════════════════════════════════════════════════════
  // FOREBET SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  var fbConfig = {
    enabled: cfg.forebet_blend_enabled === true ||
             String(cfg.forebet_blend_enabled).toUpperCase() === 'TRUE',
    weightQtr: parseFloat(cfg.forebet_ou_weight_qtr) || 0.25,
    weightFT: parseFloat(cfg.forebet_ou_weight_ft) || 0.35
  };

  var fbColumnIdx = _findForebetColumn(h, headerRow);

  if (fbConfig.enabled && fbColumnIdx !== undefined) {
    Logger.log('[Forebet] ENABLED, weight=' + fbConfig.weightQtr + ', column=' + fbColumnIdx);
  } else {
    Logger.log('[Forebet] ' + (fbConfig.enabled ? 'Enabled but column not found' : 'DISABLED'));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD/LOAD STATS CACHE
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof T2OU_CACHE === 'undefined') {
    T2OU_CACHE = { teamStats: null, league: null, builtAt: null };
  }

  if (!T2OU_CACHE.teamStats || !T2OU_CACHE.league) {
    var built = _buildStatsCache(ss);
    T2OU_CACHE.teamStats = built.teamStats;
    T2OU_CACHE.league = built.league;
    T2OU_CACHE.builtAt = new Date();
    Logger.log('[Cache] Built: ' + Object.keys(built.teamStats || {}).length + ' teams');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 3A: COMPUTE DYNAMIC LEAGUE FROM TEAMSTATS
  // ═══════════════════════════════════════════════════════════════════════════
  var dynamicLeague;
  if (typeof _t2ou_computeDynamicLeague_ === 'function') {
    dynamicLeague = _t2ou_computeDynamicLeague_(T2OU_CACHE.teamStats, T2OU_CACHE.league);
    T2OU_CACHE.dynamicLeague = dynamicLeague;
  } else {
    dynamicLeague = T2OU_CACHE.league;
  }

  if (dynamicLeague) {
    var dlQ1 = dynamicLeague.Q1 || {};
    Logger.log('[Fix3A] Dynamic league: Q1 mu=' +
      (isFinite(dlQ1.mu) ? dlQ1.mu.toFixed(1) : 'N/A') +
      ' sd=' + (isFinite(dlQ1.sd) ? dlQ1.sd.toFixed(1) : 'N/A') +
      ' n=' + (dlQ1.samples || 0));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCESSING VARIABLES
  // ═══════════════════════════════════════════════════════════════════════════
  var quarters = OU_CFG.QUARTERS;
  var stats = {
    games: 0,
    picks: 0,
    skipped: 0,
    firedOver: 0,
    firedUnder: 0,
    fbUsed: 0,
    bayesianUsed: 0,
    byTier: { ELITE: 0, STRONG: 0, MEDIUM: 0, WEAK: 0, PASS: 0 },
    byQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  };

  var allPredictions = [];
  var colorMatrix = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCESS EACH GAME
  // ═══════════════════════════════════════════════════════════════════════════
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var home = String(row[h.home] || '').trim();
    var away = String(row[h.away] || '').trim();
    var league = h.league !== undefined ? String(row[h.league] || '').trim() : '';

    if (!home || !away) {
      stats.skipped++;
      colorMatrix.push(_emptyColorRow());
      continue;
    }

    stats.games++;
    var matchupStr = home + ' vs ' + away;

    // ═════════════════════════════════════════════════════════════════════════
    // R4-PATCH2: Ensure per-game record in shared gameContext (Fix 4C)
    // Key matches accumulator: (home + ' vs ' + away).toLowerCase()
    // ═════════════════════════════════════════════════════════════════════════
    var gameKey = _ouGameKey_(home, away);
    var gcGame = null; // shorthand reference into gameContext.games[gameKey]

    if (gameContext && gameContext.games) {
      if (!gameContext.games[gameKey]) {
        gameContext.games[gameKey] = {
          key: gameKey,
          home: home,
          away: away,
          league: league,
          rowIndex: r,
          ouPredictions: {},  // Fix 4A: per-quarter {mu, sigma, ...} for HQ
          ouMeta: {}          // game-level O/U summary
        };
      }
      gcGame = gameContext.games[gameKey];

      // Back-fill fields if game was pre-created by another pipeline
      if (!gcGame.home) gcGame.home = home;
      if (!gcGame.away) gcGame.away = away;
      if (!gcGame.league) gcGame.league = league;
      if (!gcGame.ouPredictions) gcGame.ouPredictions = {};
      if (!gcGame.ouMeta) gcGame.ouMeta = {};
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FOREBET PARSING
    // ═══════════════════════════════════════════════════════════════════════
    var forebetQuarters = null;
    var forebetTotal = NaN;
    var fbUsedThisGame = false;

    if (fbConfig.enabled && fbConfig.weightQtr > 0 && fbColumnIdx !== undefined) {
      var fbParsed = _parseForebetScore(row[fbColumnIdx]);

      if (fbParsed.valid && fbParsed.total > 0) {
        forebetTotal = fbParsed.total;
        // FIX 3A: Use dynamicLeague for Forebet apportionment
        forebetQuarters = _apportionForebet(forebetTotal, dynamicLeague);

        if (debug && forebetQuarters) {
          Logger.log('[FB] ' + matchupStr + ': total=' + forebetTotal);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROCESS EACH QUARTER
    // ═══════════════════════════════════════════════════════════════════════
    var gameBets = [];
    var gameMaxEdge = 0;
    var gameBestTier = 'PASS';
    var highestEst = { q: '', mu: -Infinity };
    var rowColors = [];
    var bayesianUsedThisGame = false;

    for (var qi = 0; qi < quarters.length; qi++) {
      var Q = quarters[qi];
      var qk = Q.toLowerCase();

      var colPick = t2ou_h_(h, 'ou-' + qk);
      var colConf = t2ou_h_(h, 'ou-' + qk + '-conf');
      var colEV = t2ou_h_(h, 'ou-' + qk + '-ev');
      var colEdge = t2ou_h_(h, 'ou-' + qk + '-edge');
      var colPush = t2ou_h_(h, 'ou-' + qk + '-push');
      var colTier = t2ou_h_(h, 'ou-' + qk + '-tier');

      // Parse book line
      var bookLine = _parseBookLine(row, h, qk);

      // ═══════════════════════════════════════════════════════════════════
      // FIX 3A: Pass dynamicLeague to predictor
      // DEFENSIVE GUARD: typeof check with fallback to _predictQuarterTotal
      // for safe partial deployment (orchestrator deployed without Fix 3C).
      // ═══════════════════════════════════════════════════════════════════
      var model = (typeof t2ou_predictQuarterTotal_ === 'function')
        ? t2ou_predictQuarterTotal_(home, away, Q, T2OU_CACHE.teamStats, dynamicLeague, cfg)
        : _predictQuarterTotal(home, away, Q, T2OU_CACHE, cfg);

      // Clear outputs first
      _clearCells(row, [colConf, colEV, colEdge, colPush, colTier]);

      if (!model) {
        if (colPick !== undefined) row[colPick] = '';
        rowColors.push(OU_CFG.COLORS.na);

        // ─── R4-PATCH2: Record explicit null so HQ knows model was tried ───
        if (gcGame && gcGame.ouPredictions) {
          gcGame.ouPredictions[Q] = {
            ok: false,
            mu: null,
            sigma: null,
            sampleSize: 0,
            reason: 'model_null',
            updatedAt: new Date()
          };
        }

        continue;
      }

      // ═════════════════════════════════════════════════════════════════════
      // R4-PATCH2: Snapshot raw predictor output BEFORE Bayesian/Forebet
      // HQ receives final (post-adjustment) mu/sigma as primary values,
      // with raw snapshots available for diagnostics or alternative use.
      // ═════════════════════════════════════════════════════════════════════
      var muRaw = model.mu;
      var sigmaRaw = model.sigma;

      // ═══ BAYESIAN CONFIDENCE ═══
      var sampleSize = model.samples || model.sampleSize || 0;
      var sampleConf = _calcSampleConfidence(sampleSize, CONF_SCALE, OU_CFG);
      var isBayesian = sampleConf < 0.7;

      if (isBayesian) {
        bayesianUsedThisGame = true;
        var prior = OU_CFG.PRIORS[Q] || OU_CFG.PRIORS.default;
        model.mu = model.mu * sampleConf + prior.mean * (1 - sampleConf);
        model.sigma = model.sigma * sampleConf + prior.sd * (1 - sampleConf);
      }

      // ═══════════════════════════════════════════════════════════════════
      // FIX 3B: DYNAMIC FOREBET WEIGHT
      // Uses standalone t2ou_dynamicForebetWeight_ — _blendWithForebet
      // is NOT modified. Dynamic weight computed externally and passed in.
      // Guard: typeof check with fallback to static fbConfig.weightQtr.
      // ═══════════════════════════════════════════════════════════════════
      var forebetBlendApplied = false;  // R4-PATCH2: track for ctx
      var forebetBlendWeight = 0;       // R4-PATCH2: track for ctx

      if (forebetQuarters && isFinite(forebetQuarters[Q]) && fbConfig.weightQtr > 0) {
        var originalMu = model.mu;
        var dynW = (typeof t2ou_dynamicForebetWeight_ === 'function')
          ? t2ou_dynamicForebetWeight_(fbConfig.weightQtr, sampleSize)
          : fbConfig.weightQtr;

        forebetBlendWeight = dynW;

        if (dynW > 0) {
          model.mu = _blendWithForebet(model.mu, forebetQuarters[Q], dynW);
          fbUsedThisGame = true;
          forebetBlendApplied = true;
        }

        if (debug) {
          Logger.log('[FB-Blend] ' + Q + ': w=' + dynW.toFixed(3) + ' n=' + sampleSize +
                     ' ' + originalMu.toFixed(1) + ' → ' + model.mu.toFixed(1));
        }
      }

      // ═════════════════════════════════════════════════════════════════════
      // R4-PATCH2: Record per-quarter mu/sigma into shared gameContext
      // (Fix 4A + 4C) — AFTER all adjustments so HQ gets the best estimate.
      // Placed here (before highest-est tracking) so every valid model is
      // recorded, including quarters with no book line (estimate-only).
      // ═════════════════════════════════════════════════════════════════════
      if (gcGame && gcGame.ouPredictions) {
        gcGame.ouPredictions[Q] = {
          ok: true,

          // Primary values for HQ consumption (post Bayesian + Forebet)
          mu: model.mu,
          sigma: model.sigma,

          // Pre-adjustment snapshots (diagnostics / alternative HQ use)
          muRaw: muRaw,
          sigmaRaw: sigmaRaw,

          // Provenance metadata
          sampleSize: sampleSize,
          sampleConf: sampleConf,
          bayesianBlended: isBayesian,
          forebetBlended: forebetBlendApplied,
          forebetWeight: forebetBlendWeight,
          bookLine: isFinite(bookLine) ? bookLine : null,

          updatedAt: new Date()
        };
      }

      // Track highest estimate
      if (isFinite(model.mu) && model.mu > highestEst.mu) {
        highestEst = { q: Q, mu: model.mu };
      }

      // ═══ NO BOOK LINE - SHOW ESTIMATE ═══
      if (!isFinite(bookLine)) {
        var est = _roundHalf(model.mu);
        if (colPick !== undefined) row[colPick] = 'EST ' + est.toFixed(1);
        rowColors.push(isBayesian ? OU_CFG.COLORS.bayesian : OU_CFG.COLORS.estimate);
        continue;
      }

      // ═══ SCORE THE PICK ═══
      var scored = _scoreOverUnderPick(model, bookLine, cfg, sampleConf);

      if (!scored || !scored.play) {
        if (colPick !== undefined) row[colPick] = '';
        rowColors.push(OU_CFG.COLORS.pass);
        stats.byTier.PASS++;
        continue;
      }

      // ═══ VALID PICK - RECORD IT ═══
      stats.picks++;
      stats.byTier[scored.tier]++;
      stats.byQuarter[Q]++;

      if (scored.direction === 'OVER') stats.firedOver++;
      else stats.firedUnder++;

      // Write to cells
      if (colPick !== undefined) row[colPick] = scored.text;
      if (colConf !== undefined) row[colConf] = scored.confPct + '%' + (isBayesian ? ' 🔮' : '');
      if (colEV !== undefined) row[colEV] = scored.ev.toFixed(4);
      if (colEdge !== undefined) row[colEdge] = scored.edge.toFixed(4);
      if (colPush !== undefined) row[colPush] = (scored.pPush * 100).toFixed(1) + '%';
      if (colTier !== undefined) row[colTier] = scored.tier + ' ' + OU_CFG.TIERS[scored.tier].symbol;

      // Track best for game
      if (scored.edgeScore > gameMaxEdge) {
        gameMaxEdge = scored.edgeScore;
        gameBestTier = scored.tier;
      }

      gameBets.push({
        q: Q,
        direction: scored.direction,
        text: scored.text,
        confPct: scored.confPct,
        ev: scored.ev,
        edge: scored.edge,
        edgeScore: scored.edgeScore,
        tier: scored.tier
      });

      var pickDir = scored.direction || scored.dir || t2ou_dirFromPickText_(scored.text) || 'UNDER';

      allPredictions.push({
        rowIndex: r,
        gameId: matchupStr,
        matchup: matchupStr,
        home: home,
        away: away,
        homeTeam: home,
        awayTeam: away,
        league: league,
        date: row[h.date] || '',
        time: row[h.time] || '',
        quarter: Q,
        prediction: pickDir,
        direction: pickDir,
        text: scored.text,
        pick: scored.text,
        threshold: bookLine,
        confidence: scored.confPct,
        ev: scored.ev,
        evPercent: scored.ev,
        edge: scored.edge,
        tier: scored.tier,
        edgeScore: scored.edgeScore,
        sampleSize: sampleSize,
        isBayesian: isBayesian,
        isForebet: fbUsedThisGame,
        configVersion: VERSION,
        expectedQ: model.mu,
        pushPct: (scored.pPush * 100)
      });

      rowColors.push(_getTierColor(scored.tier, scored.direction));
    }

    // Update game-level stats
    if (fbUsedThisGame) stats.fbUsed++;
    if (bayesianUsedThisGame) stats.bayesianUsed++;

    // ═══════════════════════════════════════════════════════════════════════
    // WRITE GAME SUMMARY COLUMNS
    // ═══════════════════════════════════════════════════════════════════════
    _writeGameSummary(row, h, gameBets, gameMaxEdge, gameBestTier, highestEst,
                      forebetTotal, fbUsedThisGame, bayesianUsedThisGame);

    // ═════════════════════════════════════════════════════════════════════════
    // R4-PATCH2: Game-level bookkeeping in shared ctx (Fix 4C)
    // ═════════════════════════════════════════════════════════════════════════
    try {
      if (gcGame) {
        gcGame.ouMeta.completed = true;
        gcGame.ouMeta.completedAt = new Date();
        gcGame.ouMeta.picks = gameBets.length;
        gcGame.ouMeta.bestTier = gameBestTier;
        gcGame.ouMeta.highestEst = highestEst;
        gcGame.ouMeta.fbUsed = !!fbUsedThisGame;
        gcGame.ouMeta.bayesianUsed = !!bayesianUsedThisGame;
      }
      if (gameContext && gameContext.ou) {
        gameContext.ou.processed = (Number(gameContext.ou.processed) || 0) + 1;
      }
    } catch (eGC) { /* swallow — ctx failure must never break O/U */ }

    colorMatrix.push(rowColors);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // R4-PATCH2: Final ctx.ou rollup + trace step (Fix 4C)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    if (gameContext) {
      if (!gameContext.ou) gameContext.ou = { processed: 0, notes: [] };
      gameContext.ou.notes.push(
        'O/U complete: ' + stats.games + ' games, ' + stats.picks + ' picks' +
        (stats.fbUsed > 0 ? ', ' + stats.fbUsed + ' FB' : '') +
        (stats.bayesianUsed > 0 ? ', ' + stats.bayesianUsed + ' Bayes' : '')
      );
      Logger.log('[R4-P2] ctx.ou: processed=' + gameContext.ou.processed +
        ', games in ctx=' + Object.keys(gameContext.games).length);

      if (typeof t2_traceSharedGameContextStep_ === 'function') {
        t2_traceSharedGameContextStep_('ou', 'EXIT',
          stats.games + ' games, ' + stats.picks + ' picks');
      }
    }
  } catch (eCtxFinal) { /* swallow */ }

  // ═══════════════════════════════════════════════════════════════════════════
  // RANK ALL PREDICTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  allPredictions.sort(function(a, b) { return b.edgeScore - a.edgeScore; });

  var topElite = allPredictions.filter(function(p) { return p.tier === 'ELITE'; }).slice(0, 10);
  var topStrong = allPredictions.filter(function(p) { return p.tier === 'STRONG'; }).slice(0, 10);
  var topMedium = allPredictions.filter(function(p) { return p.tier === 'MEDIUM'; }).slice(0, 10);

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);

  _applyColors(sheet, colorMatrix, h, quarters);

  sheet.getRange(1, 1, 1, data[0].length).setFontWeight('bold').setBackground('#d0d0d0');

  // ═══════════════════════════════════════════════════════════════════════════
  // LOG RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  _logResults(stats, topElite, topStrong, topMedium);

  if (showUI && ui) {
    _showResultsDialog(ui, stats, topElite, topStrong, topMedium, fbConfig.enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSIST TO OU_Log (Fix: Ensuring Accumulator can find these signals)
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof logOUPrediction_ === 'function') {
    allPredictions.forEach(function(p) {
      try {
        logOUPrediction_(ss, p);
      } catch (eLog) {
        Logger.log('[O/U LOG ERROR] ' + eLog.message);
      }
    });
    Logger.log('[OU_Log] Persisted ' + allPredictions.length + ' predictions.');
  }

  var msg = 'T2 O/U: ' + stats.games + ' games, ' + stats.picks + ' picks';
  if (stats.fbUsed > 0) msg += ', ' + stats.fbUsed + ' FB';
  if (stats.bayesianUsed > 0) msg += ', ' + stats.bayesianUsed + ' Bayes';
  _safeToast(ss, msg, 'Unified ' + VERSION, 5);

  Logger.log('[COMPLETE] ' + msg);
  Logger.log('[PHASE 2 COMPLETE] OU_Log: FORENSIC_CORE_17 + O/U diagnostics');
  Logger.log('[PHASE 3 COMPLETE] OU_CFG merge (Config_Tier2) + validateConfigState_(VERSION, BREAKEVEN_PROB, JUICE, fallbackSd)');

  return {
    games: stats.games,
    picks: stats.picks,
    skipped: stats.skipped,
    firedOver: stats.firedOver,
    firedUnder: stats.firedUnder,
    forebetBlends: stats.fbUsed,
    bayesianBlends: stats.bayesianUsed,
    byTier: stats.byTier,
    byQuarter: stats.byQuarter,
    allPredictions: allPredictions,
    topElite: topElite,
    topStrong: topStrong,
    topMedium: topMedium,
    version: VERSION,

    // R4-PATCH2: minimal linkage for debugging (full data lives in global ctx)
    ctxRunId: (gameContext && gameContext.runId) ? gameContext.runId : ''
  };
}

/**
 * Extract direction (OVER/UNDER) from pick text
 */
function t2ou_dirFromPickText_(text) {
  var s = String(text || '').trim().toUpperCase();
  if (s.indexOf('OVER') === 0) return 'OVER';
  if (s.indexOf('UNDER') === 0) return 'UNDER';
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (Self-contained, uses existing if available)
// ═══════════════════════════════════════════════════════════════════════════════

function _safeGetSpreadsheet(ss) {
  if (ss) return ss;
  if (typeof _ensureSpreadsheet_ === 'function') return _ensureSpreadsheet_(ss);
  try { return SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { return null; }
}

function _getSheetSafe(ss, name) {
  if (typeof _getSheetByNameInsensitive_ === 'function') {
    return _getSheetByNameInsensitive_(ss, name);
  }
  return ss.getSheetByName(name);
}

function _buildHeaderMap(headerRow) {
  if (typeof t2ou_headerMap_ === 'function') {
    return t2ou_headerMap_(headerRow);
  }
  var h = {};
  headerRow.forEach(function(hdr, idx) {
    if (hdr) {
      var key = String(hdr).toLowerCase().replace(/[\s_\-]+/g, '');
      h[key] = idx;
    }
  });
  return h;
}

function _ensureColumns(data, cols) {
  if (typeof t2ou_ensureColumnsIn2D_ === 'function') {
    return t2ou_ensureColumnsIn2D_(data, cols);
  }
  var headerRow = data[0];
  var h = _buildHeaderMap(headerRow);
  cols.forEach(function(col) {
    var key = col.toLowerCase().replace(/[\s_\-]+/g, '');
    if (h[key] === undefined) {
      headerRow.push(col);
      for (var i = 1; i < data.length; i++) {
        data[i].push('');
      }
    }
  });
  return data;
}

function _loadConfig(ss) {
  var cfg = {};
  if (typeof t2ou_loadTier2Config_ === 'function') {
    cfg = t2ou_loadTier2Config_(ss) || {};
  } else if (typeof loadTier2Config === 'function') {
    cfg = loadTier2Config(ss) || {};
  }
  // Lowercase keys
  var cfgLC = {};
  Object.keys(cfg).forEach(function(k) { cfgLC[k.toLowerCase()] = cfg[k]; });
  return cfgLC;
}

function _findForebetColumn(h, headerRow) {
  // Try common names
  var candidates = ['predscore', 'pred_score', 'pred score', 'forebet', 'fb_score', 'fbscore'];
  for (var i = 0; i < candidates.length; i++) {
    var key = candidates[i].replace(/[\s_\-]+/g, '');
    if (h[key] !== undefined) return h[key];
  }
  return undefined;
}

function _parseForebetScore(raw) {
  if (!raw) return { valid: false, total: NaN };
  var str = String(raw).trim();
  
  // Try "X-Y" format
  var match = str.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (match) {
    return { valid: true, total: parseInt(match[1]) + parseInt(match[2]), home: parseInt(match[1]), away: parseInt(match[2]) };
  }
  
  // Try single number
  var num = parseFloat(str);
  if (!isNaN(num) && num > 0) {
    return { valid: true, total: num };
  }
  
  return { valid: false, total: NaN };
}


function _blendWithForebet(modelMu, forebetMu, weight) {
  // Clamp and blend
  weight = Math.max(0, Math.min(1, weight));
  var blended = modelMu * (1 - weight) + forebetMu * weight;
  // Bounds check
  return Math.max(5, Math.min(150, blended));
}

function _calcSampleConfidence(n, scale, cfg) {
  if (n === 0) return cfg.MIN_CONFIDENCE;
  var conf = cfg.MIN_CONFIDENCE +
             (cfg.MAX_CONFIDENCE - cfg.MIN_CONFIDENCE) *
             (1 - Math.exp(-n / scale));
  return Math.min(cfg.MAX_CONFIDENCE, conf);
}

function _parseBookLine(row, h, qk) {
  // Try multiple column naming conventions
  var candidates = [qk, 'ou-line-' + qk, qk + 'ou', qk + 'line'];
  for (var i = 0; i < candidates.length; i++) {
    var key = candidates[i].replace(/[\s_\-]+/g, '');
    if (h[key] !== undefined) {
      var val = row[h[key]];
      if (typeof t2ou_parseBookLine_ === 'function') {
        return t2ou_parseBookLine_(val);
      }
      return parseFloat(val);
    }
  }
  return NaN;
}

function _predictQuarterTotal(home, away, Q, cache, cfg) {
  if (typeof t2ou_predictQuarterTotal_ === 'function') {
    return t2ou_predictQuarterTotal_(home, away, Q, cache.teamStats, cache.league, cfg);
  }
  
  // Fallback: use priors
  var prior = OU_CFG.PRIORS[Q] || OU_CFG.PRIORS.default;
  return {
    mu: prior.mean,
    sigma: prior.sd,
    sampleSize: 0
  };
}

function _scoreOverUnderPick(model, bookLine, cfg, sampleConf) {
  // Use existing scorer if available
  if (typeof t2ou_scoreOverUnderPick_ === 'function') {
    var scored = t2ou_scoreOverUnderPick_(model, bookLine, cfg);
    if (scored) {
      // Enhance with tier
      scored.tier = _assignTier(scored.confPct, scored.ev);
      scored.edgeScore = _calcEdgeScore(model.mu, bookLine, scored.tier, sampleConf, scored.ev);
    }
    return scored;
  }
  
  // Inline scoring
  var mu = model.mu;
  var sigma = model.sigma || 8.5;
  
  var z = (bookLine - mu) / sigma;
  var pOver = 1 - _normalCDF(z);
  var pUnder = _normalCDF(z);
  
  var pPush = _calcPushProb(mu, sigma, bookLine, 0.5);
  var pOverAdj = pOver - pPush / 2;
  var pUnderAdj = pUnder - pPush / 2;
  
  var evOver = _calcEV(pOverAdj, pPush, -110);
  var evUnder = _calcEV(pUnderAdj, pPush, -110);
  
  var betOver = pOverAdj > pUnderAdj;
  var bestProb = betOver ? pOverAdj : pUnderAdj;
  var bestEV = betOver ? evOver : evUnder;
  
  var minEV = parseFloat(cfg.ou_min_ev) || 0.005;
  
  if (bestProb < OU_CFG.BREAKEVEN_PROB || bestEV < minEV) {
    return null;
  }
  
  var direction = betOver ? 'OVER' : 'UNDER';
  var confPct = Math.round(bestProb * 100);
  var tier = _assignTier(confPct, bestEV);
  var edgeScore = _calcEdgeScore(mu, bookLine, tier, sampleConf, bestEV);
  var edge = Math.abs(mu - bookLine);
  
  return {
    play: true,
    direction: direction,
    text: direction + ' ' + bookLine.toFixed(1) + ' ' + OU_CFG.TIERS[tier].symbol,
    confPct: confPct,
    ev: bestEV,
    edge: edge,
    pPush: pPush,
    tier: tier,
    edgeScore: edgeScore
  };
}

function _assignTier(confPct, ev) {
  var tiers = OU_CFG.TIERS;
  if (confPct >= tiers.ELITE.minConf && ev >= tiers.ELITE.minEV) return 'ELITE';
  if (confPct >= tiers.STRONG.minConf && ev >= tiers.STRONG.minEV) return 'STRONG';
  if (confPct >= tiers.MEDIUM.minConf && ev >= tiers.MEDIUM.minEV) return 'MEDIUM';
  if (confPct >= tiers.WEAK.minConf && ev >= tiers.WEAK.minEV) return 'WEAK';
  return 'PASS';
}

function _calcEdgeScore(mu, line, tier, sampleConf, ev) {
  var weight = OU_CFG.TIERS[tier].weight;
  return Math.abs(mu - line) * weight * sampleConf * (1 + ev);
}

function _getTierColor(tier, direction) {
  var c = OU_CFG.COLORS;
  if (direction === 'OVER') {
    switch (tier) {
      case 'ELITE': return c.eliteOver;
      case 'STRONG': return c.strongOver;
      case 'MEDIUM': return c.mediumOver;
      default: return c.weakOver;
    }
  } else {
    switch (tier) {
      case 'ELITE': return c.eliteUnder;
      case 'STRONG': return c.strongUnder;
      case 'MEDIUM': return c.mediumUnder;
      default: return c.weakUnder;
    }
  }
}

function _emptyColorRow() {
  return [OU_CFG.COLORS.na, OU_CFG.COLORS.na, 
          OU_CFG.COLORS.na, OU_CFG.COLORS.na];
}

function _clearCells(row, indices) {
  indices.forEach(function(idx) {
    if (idx !== undefined) row[idx] = '';
  });
}

function _roundHalf(n) {
  return Math.round(n * 2) / 2;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _writeGameSummary - PATCHED
 * Uses t2ou_h_() for all ou-* lookups, expects populated bets array
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _writeGameSummary(row, h, bets, maxEdge, bestTier, highest, fbTotal, fbUsed, bayesUsed) {
  bets = bets || [];

  // Find best picks by different metrics
  var bestEV = bets.length ? bets.reduce(function(a, b) { return (a.ev > b.ev) ? a : b; }) : null;
  var bestConf = bets.length ? bets.reduce(function(a, b) { return (a.confPct > b.confPct) ? a : b; }) : null;
  var bestEdge = bets.length ? bets.reduce(function(a, b) { return (a.edgeScore > b.edgeScore) ? a : b; }) : null;

  var edgeSumVal = bets.reduce(function(sum, b) { return sum + (b.edgeScore || 0); }, 0);

  // Helper for safe column writes
  function setCol_(colName, value) {
    var idx = t2ou_h_(h, colName);
    if (idx !== undefined) row[idx] = value;
  }

  // Edge score & estimates
  setCol_('ou-edge-score', edgeSumVal ? edgeSumVal.toFixed(2) : '');
  setCol_('ou-highest-est', highest && highest.q 
    ? (highest.q + ' ' + (Math.round(highest.mu * 2) / 2).toFixed(1)) 
    : '');

  // Method indicators
  setCol_('ou-fb-used', fbUsed ? ('FB ' + String(fbTotal || '').trim()) : '');
  setCol_('ou-bayesian-used', bayesUsed ? '🔮 BAYES' : '');

  // Best pick details
  if (bestEdge) {
    setCol_('ou-best', bestEdge.q + ' ' + bestEdge.text);
    setCol_('ou-best-q', bestEdge.q);
    setCol_('ou-best-ev', isFinite(bestEdge.ev) ? bestEdge.ev.toFixed(4) : '');
    setCol_('ou-best-edge', isFinite(bestEdge.edge) ? bestEdge.edge.toFixed(4) : '');
    
    var tierSymbol = (OU_CFG.TIERS[bestTier] || {}).symbol || '';
    setCol_('ou-game-tier', bestTier + ' ' + tierSymbol);
  } else {
    setCol_('ou-best', 'N/A');
    setCol_('ou-best-q', '');
    setCol_('ou-best-ev', '');
    setCol_('ou-best-edge', '');
    setCol_('ou-game-tier', 'PASS —');
  }

  // Confidence and direction bests
  setCol_('ou-best-conf', bestConf 
    ? (bestConf.q + ' ' + bestConf.direction + ' (' + bestConf.confPct + '%)') 
    : 'N/A');
  setCol_('ou-best-dir', bestEV 
    ? (bestEV.q + ' ' + bestEV.direction + ' (EV ' + (bestEV.ev * 100).toFixed(1) + '%)') 
    : 'N/A');
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HEADER & UTILITY HELPERS - Combined best practices
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Normalize header key exactly like _buildHeaderMap() does
 * Handles: "OU-Q1" → "ouq1", "ou_q1_conf" → "ouq1conf"
 */
function t2ou_normKey_(s) {
  return String(s || '').toLowerCase().replace(/[\s_\-]+/g, '');
}

/**
 * Safe header lookup using normalized keys
 * Usage: t2ou_h_(h, 'ou-q1') instead of h['ou-q1']
 * Works whether caller passes 'ou-q1', 'ou_q1', or 'ouq1'
 */
function t2ou_h_(h, headerName) {
  if (!h) return undefined;
  return h[t2ou_normKey_(headerName)];
}

/**
 * Extract direction (OVER/UNDER) from pick text
 * Handles: "OVER 42.5" → "OVER", "UNDER 38.0" → "UNDER"
 */
function t2ou_dirFromPickText_(text) {
  var s = String(text || '').trim().toUpperCase();
  if (s.indexOf('OVER') === 0) return 'OVER';
  if (s.indexOf('UNDER') === 0) return 'UNDER';
  return '';
}

/**
 * Build matchup string from prediction object (for writer compatibility)
 */
function t2ou_buildMatchup_(pred) {
  if (!pred) return '';
  if (pred.matchup) return pred.matchup;
  if (pred.gameId) return pred.gameId;
  if (pred.home && pred.away) return pred.home + ' vs ' + pred.away;
  return '';
}

/**
 * Detect duplicate ou-* columns in header row
 * Returns: { hasDuplicates: boolean, duplicates: [{name, indices}] }
 */
function t2ou_detectDuplicateHeaders_(headerRow) {
  var seen = {};
  var duplicates = [];
  
  for (var i = 0; i < headerRow.length; i++) {
    var raw = String(headerRow[i] || '').trim().toLowerCase();
    if (raw.indexOf('ou-') === 0 || raw.indexOf('ou_') === 0) {
      var norm = t2ou_normKey_(raw);
      if (seen[norm]) {
        seen[norm].push(i);
      } else {
        seen[norm] = [i];
      }
    }
  }
  
  for (var key in seen) {
    if (seen[key].length > 1) {
      duplicates.push({ name: key, indices: seen[key] });
    }
  }
  
  return {
    hasDuplicates: duplicates.length > 0,
    duplicates: duplicates
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _applyColors - PATCHED
 * Uses t2ou_h_() for proper column lookup
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _applyColors(sheet, colorMatrix, h, quarters) {
  if (!colorMatrix || colorMatrix.length === 0) return;

  for (var qi = 0; qi < quarters.length; qi++) {
    var qk = quarters[qi].toLowerCase();
    var colIdx = t2ou_h_(h, 'ou-' + qk);

    if (colIdx !== undefined) {
      var colors = colorMatrix.map(function(row) {
        return [(row && row[qi]) ? row[qi] : OU_CFG.COLORS.na];
      });
      sheet.getRange(2, colIdx + 1, colors.length, 1).setBackgrounds(colors);
    }
  }
}

function _buildStatsCache(ss) {
  if (typeof t2ou_buildTotalsStatsFromCleanSheets_ === 'function') {
    return t2ou_buildTotalsStatsFromCleanSheets_(ss);
  }
  return { teamStats: {}, league: {} };
}

function _normalCDF(z) {
  if (typeof normalCDF_ === 'function') return normalCDF_(z);
  // Approximation
  var a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  var sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  var t = 1.0 / (1.0 + p * z);
  var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

function _calcPushProb(mu, sigma, line, tolerance) {
  if (typeof calculatePushProbability_ === 'function') {
    return calculatePushProbability_(mu, sigma, line, tolerance);
  }
  var pLow = _normalCDF((line - tolerance - mu) / sigma);
  var pHigh = _normalCDF((line + tolerance - mu) / sigma);
  return Math.max(0, pHigh - pLow);
}

function _calcEV(pWin, pPush, odds) {
  if (typeof calculateExpectedValue_ === 'function') {
    var result = calculateExpectedValue_(pWin, pPush);
    return result.percent || result;
  }
  var pLose = 1 - pWin - pPush;
  var profit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return pWin * profit - pLose;
}

function _safeToast(ss, msg, title, duration) {
  if (typeof _safeToast_ === 'function') {
    _safeToast_(ss, msg, title, duration);
  } else {
    try { ss.toast(msg, title, duration); } catch (e) {}
  }
}

function _logResults(stats, topElite, topStrong, topMedium) {
  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('    O/U RESULTS SUMMARY');
  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('Games: ' + stats.games + ' | Picks: ' + stats.picks + ' | Skipped: ' + stats.skipped);
  Logger.log('OVER: ' + stats.firedOver + ' | UNDER: ' + stats.firedUnder);
  Logger.log('Forebet used: ' + stats.fbUsed + ' | Bayesian: ' + stats.bayesianUsed);
  Logger.log('Tiers: ELITE=' + stats.byTier.ELITE + ', STRONG=' + stats.byTier.STRONG +
             ', MEDIUM=' + stats.byTier.MEDIUM + ', WEAK=' + stats.byTier.WEAK);
  
  // Helper to format pick for logging
  function formatPick(p, i) {
    var dir = p.prediction || t2ou_dirFromPickText_(p.text) || p.text || 'N/A';
    var line = p.threshold || p.line || 0;
    var lineStr = typeof line === 'number' ? line.toFixed(1) : String(line);
    var edge = p.edgeScore || 0;
    return '  ' + (i+1) + '. ' + p.gameId + ' ' + p.quarter + ': ' + 
           dir + ' ' + lineStr + ' (edge: ' + edge.toFixed(2) + ')';
  }
  
  if (topElite.length > 0) {
    Logger.log('');
    Logger.log('⭐ TOP ELITE (' + topElite.length + '):');
    topElite.slice(0, 5).forEach(function(p, i) {
      Logger.log(formatPick(p, i));
    });
  }
  
  if (topStrong.length > 0) {
    Logger.log('');
    Logger.log('★ TOP STRONG (' + topStrong.length + '):');
    topStrong.slice(0, 5).forEach(function(p, i) {
      Logger.log(formatPick(p, i));
    });
  }
  
  if (topMedium.length > 0) {
    Logger.log('');
    Logger.log('● TOP MEDIUM (' + topMedium.length + '):');
    topMedium.slice(0, 3).forEach(function(p, i) {
      Logger.log(formatPick(p, i));
    });
  }
}

function _showResultsDialog(ui, stats, topElite, topStrong, topMedium, fbEnabled) {
  var totalFired = stats.firedOver + stats.firedUnder;
  
  var topPicks = '';
  if (topElite.length > 0) {
    topPicks += '⭐ ELITE:\n';
    topElite.slice(0, 3).forEach(function(p) {
      topPicks += '  ' + p.gameId + ' ' + p.quarter + ': ' + p.prediction + '\n';
    });
  }
  if (topStrong.length > 0) {
    topPicks += '\n★ STRONG:\n';
    topStrong.slice(0, 3).forEach(function(p) {
      topPicks += '  ' + p.gameId + ' ' + p.quarter + ': ' + p.prediction + '\n';
    });
  }
  if (!topPicks && topMedium.length > 0) {
    topPicks += '● MEDIUM:\n';
    topMedium.slice(0, 3).forEach(function(p) {
      topPicks += '  ' + p.gameId + ' ' + p.quarter + ': ' + p.prediction + '\n';
    });
  }
  
  Logger.log('[O/U COMPLETE] Games: ' + stats.games + ' | Picks: ' + totalFired +
    ' (OVER: ' + stats.firedOver + ', UNDER: ' + stats.firedUnder + ')' +
    ' | Tiers: ELITE=' + stats.byTier.ELITE + ' STRONG=' + stats.byTier.STRONG +
    ' MEDIUM=' + stats.byTier.MEDIUM + ' WEAK=' + stats.byTier.WEAK);
  Logger.log('[O/U TOP PICKS]\n' + (topPicks || 'No qualifying picks'));
}

function _returnResult(games, picks, fb, version, showUI, ui) {
  if (showUI && ui) {
    ui.alert('O/U', 'No games to process.', ui.ButtonSet.OK);
  }
  return { games: games, picks: picks, forebetBlends: fb, version: version };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALIAS for backward compatibility
// ═══════════════════════════════════════════════════════════════════════════════
function predictQuartersOU_Tier2(ss) {
  return predictQuarters_Tier2_OU(ss, { showUI: true });
}

// ═══ HELPER FUNCTIONS ═══

function normalCDF_(z) {
  var a1 =  0.254829592;
  var a2 = -0.284496736;
  var a3 =  1.421413741;
  var a4 = -1.453152027;
  var a5 =  1.061405429;
  var p  =  0.3275911;
  
  var sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  
  var t = 1.0 / (1.0 + p * z);
  var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  
  return 0.5 * (1.0 + sign * y);
}

function calculatePushProbability_(mean, sd, threshold, tolerance) {
  var zLow = (threshold - tolerance - mean) / sd;
  var zHigh = (threshold + tolerance - mean) / sd;
  return Math.max(0, normalCDF_(zHigh) - normalCDF_(zLow));
}

// calculateExpectedValue_: single implementation above (Patch 8 — collision removed).
// O/U paths use _calcEV → calculateExpectedValue_(pWin, pPush).

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * ELITE O/U LOGGER - Enhanced with tier and edge tracking
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
function logOUPrediction_(ss, payload) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  try {
    var logSheet = getSheetInsensitive(ss, 'OU_Log');
    if (!logSheet) logSheet = ss.insertSheet('OU_Log');

    var F17 = (typeof FORENSIC_CORE_17 !== 'undefined')
      ? FORENSIC_CORE_17.slice()
      : [
        'Prediction_Record_ID', 'Universal_Game_ID', 'Config_Version', 'Timestamp_UTC',
        'League', 'Date', 'Home', 'Away', 'Market', 'Period', 'Pick_Code', 'Pick_Text',
        'Confidence_Pct', 'Confidence_Prob', 'Tier_Code', 'EV', 'Edge_Score'
      ];
    var OU_EXTRA = [
      'Time', 'Quarter', 'Threshold', 'Line_Source', 'P_Over', 'P_Under', 'P_Push',
      'Expected_Q', 'Scaled_SD', 'League_Avg', 'Sample_Size', 'Sample_Confidence',
      'EV_Percent', 'Scale_Factor', 'Tier_Legacy', 'Is_Bayesian', 'Reasoning',
      'Prediction', 'Confidence'
    ];
    var HEADER_TARGET = F17.concat(OU_EXTRA);

    function canonKOu_(name) {
      if (typeof canonicalHeaderKey_ === 'function') return canonicalHeaderKey_(name);
      return String(name || '').trim().toLowerCase().replace(/[\s\-\.]+/g, '_').replace(/[^\w_]/g, '');
    }

    var lr0 = logSheet.getLastRow();
    var lc0 = logSheet.getLastColumn();
    var existingH = [];
    if (lr0 > 0 && lc0 > 0) {
      existingH = logSheet.getRange(1, 1, 1, lc0).getValues()[0] || [];
    }

    var headerRow;
    if (!existingH || existingH.length === 0) {
      headerRow = HEADER_TARGET;
      logSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
      logSheet.getRange(1, 1, 1, headerRow.length).setFontWeight('bold').setBackground('#d9d9d9');
      logSheet.setFrozenRows(1);
    } else {
      headerRow = existingH.slice();
      var hmEx = (typeof createCanonicalHeaderMap_ === 'function')
        ? createCanonicalHeaderMap_(headerRow)
        : createHeaderMap(headerRow);
      HEADER_TARGET.forEach(function (col) {
        var ck = canonKOu_(col);
        if (hmEx[ck] === undefined) {
          headerRow.push(col);
          hmEx[ck] = headerRow.length - 1;
        }
      });
      if (headerRow.length !== existingH.length) {
        logSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
        logSheet.getRange(1, 1, 1, headerRow.length).setFontWeight('bold').setBackground('#d9d9d9');
      }
    }

    var hm = (typeof createCanonicalHeaderMap_ === 'function')
      ? createCanonicalHeaderMap_(headerRow)
      : createHeaderMap(headerRow);

    var cfgV = (payload && payload.configVersion) || '';
    var qLab = 'Q' + String((payload && payload.quarter) != null ? String(payload.quarter).replace(/^Q/i, '') : 'X');
    var universalGameId = '';
    try {
      if (typeof buildUniversalGameID_ === 'function') {
        universalGameId = buildUniversalGameID_(payload.date, payload.homeTeam, payload.awayTeam);
      }
    } catch (eU) {
      Logger.log('[OU Logger] buildUniversalGameID_: ' + eU.message);
    }
    if (!universalGameId && typeof standardizeDate_ === 'function') {
      var ymdO = standardizeDate_(payload.date);
      var yO = (ymdO && ymdO.replace(/-/g, '')) || 'NODATE';
      var hO = String((payload && payload.homeTeam) || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      var aO = String((payload && payload.awayTeam) || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      universalGameId = yO + '__' + hO + '__' + aO;
    }
    var predictionRecordId = '';
    try {
      if (typeof buildPredictionRecordID_ === 'function' && universalGameId) {
        predictionRecordId = buildPredictionRecordID_(universalGameId, 'TIER2_OU', qLab, cfgV || 'OU_DEFAULT');
      }
    } catch (eP) {
      Logger.log('[OU Logger] buildPredictionRecordID_: ' + eP.message);
    }

    var confB = (typeof normalizeConfidenceBundle_ === 'function')
      ? normalizeConfidenceBundle_(payload && payload.confidence)
      : { confidencePct: Number(payload && payload.confidence) || 0, confidenceProb: 0, tierCode: 'WEAK', tierDisplay: '' };

    var predStr = String((payload && payload.prediction) || '');
    var pU = predStr.toUpperCase();
    var pickCode = 'UNK';
    if (pU.indexOf('OVER') >= 0) pickCode = 'OVER';
    else if (pU.indexOf('UNDER') >= 0) pickCode = 'UNDER';

    var stdD = (typeof standardizeDate_ === 'function') ? standardizeDate_(payload && payload.date) : '';
    var evNum = payload && payload.evPercent;
    var out = new Array(headerRow.length).fill('');
    function setOu_(aliases, val) {
      for (var i = 0; i < aliases.length; i++) {
        var ck = canonKOu_(aliases[i]);
        if (hm[ck] !== undefined) {
          out[hm[ck]] = val;
          return;
        }
      }
    }

    setOu_(['Prediction_Record_ID'], predictionRecordId);
    setOu_(['Universal_Game_ID'], universalGameId);
    setOu_(['Config_Version'], cfgV);
    setOu_(['Timestamp_UTC'], new Date());
    setOu_(['League'], (payload && payload.league) || '');
    setOu_(['Date'], stdD || (payload && payload.date) || '');
    setOu_(['Home'], (payload && payload.homeTeam) || '');
    setOu_(['Away'], (payload && payload.awayTeam) || '');
    setOu_(['Market'], 'TIER2_OU');
    setOu_(['Period'], qLab);
    setOu_(['Pick_Code'], pickCode);
    setOu_(['Pick_Text'], predStr);
    setOu_(['Confidence_Pct'], confB.confidencePct);
    setOu_(['Confidence_Prob'], confB.confidenceProb);
    setOu_(['Tier_Code'], confB.tierCode);
    setOu_(['EV'], evNum);
    setOu_(['Edge_Score'], (payload && payload.edgeScore) || 0);

    setOu_(['Time'], (payload && payload.time) || '');
    setOu_(['Quarter'], (payload && payload.quarter) || '');
    setOu_(['Threshold'], payload && payload.threshold);
    setOu_(['Line_Source'], (payload && payload.lineSource) || '');
    setOu_(['P_Over'], payload && payload.overPct);
    setOu_(['P_Under'], payload && payload.underPct);
    setOu_(['P_Push'], payload && payload.pushPct);
    setOu_(['Expected_Q'], payload && payload.expectedQ);
    setOu_(['Scaled_SD'], payload && payload.scaledSD);
    setOu_(['League_Avg'], payload && payload.leagueAvg);
    setOu_(['Sample_Size'], payload && payload.sampleSize);
    setOu_(['Sample_Confidence'], payload && payload.sampleConfidence);
    setOu_(['EV_Percent'], payload && payload.evPercent);
    setOu_(['Scale_Factor'], payload && payload.scaleFactor);
    setOu_(['Tier_Legacy'], (payload && payload.tier) || 'UNKNOWN');
    setOu_(['Is_Bayesian'], payload && payload.isBayesian ? 'YES' : 'NO');
    setOu_(['Reasoning'], (payload && payload.reasoning) || '');
    setOu_(['Prediction'], predStr);
    setOu_(['Confidence'], payload && payload.confidence);

    logSheet.appendRow(out);
  } catch (e) {
    Logger.log('[OU Logger] ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// O/U ACCURACY REPORT - COMPLETE PRODUCTION VERSION
// All functions included - no external dependencies
// ═══════════════════════════════════════════════════════════════════════════

/**
 * =====================================================================
 * FUNCTION 3: buildOUAccuracyReport(ss)
 * =====================================================================
 * Bet_Slips-first grading; OU_Log fallback; HIGH_QTR unchanged.
 */
function buildOUAccuracyReport(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  Logger.log('╔═══════════════════════════════════════════════════════════════╗');
  Logger.log('║         O/U ACCURACY REPORT - BET_SLIPS FIRST                 ║');
  Logger.log('╚═══════════════════════════════════════════════════════════════╝');

  try {
    // ─── LOAD RESULTS ─────────────────────────────────────────────
    var resultsSheet = getSheetInsensitive(ss, 'ResultsClean') ||
                       getSheetInsensitive(ss, 'RawResults') ||
                       getSheetInsensitive(ss, 'Clean') ||
                       getSheetInsensitive(ss, 'Results');

    if (!resultsSheet || resultsSheet.getLastRow() < 2) {
      throw new Error('No results sheet found (tried: ResultsClean, RawResults, Clean, Results).');
    }

    var resData = resultsSheet.getDataRange().getValues();
    var resH = createHeaderMap(resData[0]);
    Logger.log('[Results] Sheet: ' + resultsSheet.getName() + ', Rows: ' + (resData.length - 1));

    var quarterFormat = detectQuarterFormat_(resH);
    if (!quarterFormat.valid) {
      throw new Error('No quarter columns found. Need Q1H/Q1A OR Q1 OR Q1_total.');
    }
    Logger.log('[Results] Quarter format: ' + quarterFormat.type);

    var resultMapData = buildResultMap_(resData, resH);
    Logger.log('[Results] Map entries: ' + resultMapData.entryCount +
               ', Collisions: ' + resultMapData.collisions +
               ', Ambiguous keys: ' + resultMapData.ambiguousCount);

    // ─── TRY BET_SLIPS FIRST ──────────────────────────────────────
    var slipPicks = loadBetSlipsSniperOUPicks_(ss);
    Logger.log('[Bet_Slips] Sniper O/U picks loaded: ' + slipPicks.length);

    var evaluation;

    if (slipPicks && slipPicks.length > 0) {
      Logger.log('[Mode] BET_SLIPS');
      evaluation = evaluateBetSlipsOUPicks_(slipPicks, resultMapData, resH, quarterFormat);
      evaluation.source = 'BET_SLIPS';
    } else {
      // ─── FALLBACK TO OU_LOG ───────────────────────────────────────
      Logger.log('[Mode] OU_LOG (fallback)');

      var logSheet = getSheetInsensitive(ss, 'OU_Log');
      if (!logSheet || logSheet.getLastRow() < 2) {
        throw new Error('No Bet_Slips O/U picks found AND OU_Log is empty/missing.');
      }

      var logData = logSheet.getDataRange().getValues();
      var logH = createHeaderMap(logData[0]);
      Logger.log('[OU_Log] Rows: ' + (logData.length - 1));

      evaluation = evaluatePredictions_(logData, logH, resultMapData, resH, quarterFormat);
      evaluation.source = 'OU_LOG';
    }

    // ─── HIGH_QTR (unchanged) ─────────────────────────────────────
    var highQtrPredictions = loadHighQtrPredictions_(ss);
    Logger.log('[HIGH_QTR] Loaded: ' + highQtrPredictions.length);

    evaluation.highQtr = evaluateHighQtrPredictions_(highQtrPredictions, resultMapData, resH, quarterFormat);

    // ─── WRITE REPORT ─────────────────────────────────────────────
    writeAccuracyReport_(ss, evaluation);
    displayAccuracySummary_(ui, evaluation);

    Logger.log('[DONE] Report complete. Source=' + evaluation.source);
    return evaluation;

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log(e.stack);
    ui.alert('O/U Accuracy Report Error', e.message, ui.ButtonSet.OK);
    return null;
  }
}

/**
 * Detect quarter column format in results sheet
 * Supports: separate (Q1H/Q1A), combined total (Q1_Total), or simple (Q1)
 */
function detectQuarterFormat_(resH) {
  // Check for separate home/away columns
  var hasSeparate = (findColumn_(resH, ['q1h', 'q1home', 'q1_home']) !== undefined) &&
                    (findColumn_(resH, ['q1a', 'q1away', 'q1_away']) !== undefined);
  
  // Check for combined total columns
  var hasTotal = findColumn_(resH, ['q1total', 'q1_total']) !== undefined;
  
  // Check for simple Q1, Q2, etc.
  var hasCombined = findColumn_(resH, ['q1']) !== undefined;

  return {
    valid: hasSeparate || hasCombined || hasTotal,
    type: hasSeparate ? 'separate' : (hasTotal ? 'total' : (hasCombined ? 'combined' : 'none')),
    separate: hasSeparate,
    combined: hasCombined,
    total: hasTotal
  };
}

/**
 * Build result map from results data
 * Returns { map, nodateCounts, entryCount, collisions, ambiguousCount }
 * 
 * Stores:
 * - Dated keys (both team orientations) when date is valid
 * - No-date keys (both orientations) always, tracking collision count
 */
function buildResultMap_(resData, resH) {
  var map = {};
  var nodateCounts = {}; // Track how many times each no-date key is seen
  var collisions = 0;

  // Find column indexes
  var homeCol = findColumn_(resH, ['home', 'hometeam', 'home_team', 'teamhome']);
  var awayCol = findColumn_(resH, ['away', 'awayteam', 'away_team', 'teamaway']);
  var dateCol = findColumn_(resH, ['date', 'gamedate', 'game_date']);

  if (homeCol === undefined || awayCol === undefined) {
    Logger.log('[Results] Warning: Could not find home/away columns');
    return { 
      map: map, 
      nodateCounts: nodateCounts,
      entryCount: 0, 
      collisions: 0,
      ambiguousCount: 0
    };
  }

  for (var i = 1; i < resData.length; i++) {
    var row = resData[i];
    var home = row[homeCol];
    var away = row[awayCol];
    var date = dateCol !== undefined ? row[dateCol] : null;

    if (!home || !away) continue;

    var homeNorm = normalizeTeamName_(home);
    var awayNorm = normalizeTeamName_(away);
    if (!homeNorm || !awayNorm) continue;

    var dateStr = normalizeDateStr_(date);

    // Store dated keys (both orientations) when date is valid
    if (dateStr) {
      var k1 = dateStr + '|' + homeNorm + '|' + awayNorm;
      if (!map[k1]) map[k1] = row;

      var k1swap = dateStr + '|' + awayNorm + '|' + homeNorm;
      if (!map[k1swap]) map[k1swap] = row;
    }

    // Always track no-date keys for fallback (with collision counting)
    var k2 = 'NODATE|' + homeNorm + '|' + awayNorm;
    if (!nodateCounts[k2]) {
      nodateCounts[k2] = 1;
      map[k2] = row;
    } else {
      nodateCounts[k2]++;
      collisions++;
    }

    var k2swap = 'NODATE|' + awayNorm + '|' + homeNorm;
    if (!nodateCounts[k2swap]) {
      nodateCounts[k2swap] = 1;
      map[k2swap] = row;
    } else {
      nodateCounts[k2swap]++;
      collisions++;
    }
  }

  // Count ambiguous keys (seen more than once)
  var ambiguousCount = 0;
  for (var key in nodateCounts) {
    if (nodateCounts[key] > 1) ambiguousCount++;
  }

  return { 
    map: map, 
    nodateCounts: nodateCounts,
    entryCount: Object.keys(map).length, 
    collisions: collisions,
    ambiguousCount: ambiguousCount
  };
}

/**
 * Look up result row with fallback strategies
 * 
 * Order of attempts:
 * 1. Dated key (exact date + teams)
 * 2. Dated key with swapped teams
 * 3. No-date key (only if unambiguous - seen exactly once)
 * 4. No-date key with swapped teams (only if unambiguous)
 */
function lookupResult_(resultMapData, date, team1, team2) {
  var map = resultMapData.map;
  var nodateCounts = resultMapData.nodateCounts;

  var t1 = normalizeTeamName_(team1);
  var t2 = normalizeTeamName_(team2);
  if (!t1 || !t2) return null;

  var dateStr = normalizeDateStr_(date);

  // Try with date (both orientations)
  if (dateStr) {
    var k1 = dateStr + '|' + t1 + '|' + t2;
    if (map[k1]) return map[k1];

    var k1swap = dateStr + '|' + t2 + '|' + t1;
    if (map[k1swap]) return map[k1swap];
  }

  // Fall back to no-date ONLY if unambiguous (seen exactly once)
  var k2 = 'NODATE|' + t1 + '|' + t2;
  if (map[k2] && nodateCounts[k2] === 1) {
    return map[k2];
  }

  var k2swap = 'NODATE|' + t2 + '|' + t1;
  if (map[k2swap] && nodateCounts[k2swap] === 1) {
    return map[k2swap];
  }

  return null;
}

/**
 * =====================================================================
 * HELPER: Create standardized game key for matching
 * Handles Date objects, various string formats, malformed dates, and normalizes team names
 * =====================================================================
 */
/**
 * Create game key with date (returns null if date invalid)
 */
function createGameKey_(date, home, away) {
  var homeStr = normalizeTeamName_(home);
  var awayStr = normalizeTeamName_(away);
  if (!homeStr || !awayStr) return null;
  
  var dateStr = normalizeDateStr_(date);
  if (!dateStr) return null; // Caller should use createGameKeyNoDate_() instead
  
  return dateStr + '|' + homeStr + '|' + awayStr;
}

/**
 * Create game key without date (for fallback matching)
 */
function createGameKeyNoDate_(home, away) {
  var homeStr = normalizeTeamName_(home);
  var awayStr = normalizeTeamName_(away);
  if (!homeStr || !awayStr) return null;
  return 'NODATE|' + homeStr + '|' + awayStr;
}

/**
 * Split match string using multiple separator patterns
 * Returns [team1, team2] or [original, ''] if no split found
 */
function splitMatchString_(matchStr) {
  var m = String(matchStr || '').trim();
  if (!m) return ['', ''];

  // Try common separators in order of specificity
  var patterns = [
    /\s+vs\.?\s+/i,    // "Team A vs Team B" or "Team A vs. Team B"
    /\s+v\.?\s+/i,     // "Team A v Team B"
    /\s+@\s+/,         // "Team A @ Team B"
    /\s+-\s+/,         // "Team A - Team B"
    /\s+at\s+/i        // "Team A at Team B"
  ];

  for (var i = 0; i < patterns.length; i++) {
    var parts = m.split(patterns[i]);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      // Return only first two parts (handles "A vs B vs C" edge case)
      return [parts[0].trim(), parts[1].trim()];
    }
  }

  return [m, ''];
}

/**
 * Normalize team name for consistent matching
 */
function normalizeTeamName_(name) {
  if (!name) return '';
  
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Collapse multiple spaces
    .replace(/['']/g, "'")          // Normalize quotes
    .replace(/[^\w\s'-]/g, '')      // Remove special chars except apostrophe/hyphen
    .trim();
}

/**
 * Debug function to test date parsing
 */
function testDateParsing() {
  var testDates = [
    '02/032025',      // Missing second slash
    '0203/2025',      // Missing first slash
    '02032025',       // No slashes
    '2/32025',        // Single digit with missing slash
    '02/03/2025',     // Normal DD/MM/YYYY
    '2025-03-02',     // ISO format
    '02-03-2025',     // Dashes
    '02.03.2025',     // Dots
    new Date(2025, 2, 2),  // Date object
    45719               // Excel serial
  ];
  
  Logger.log('═══ DATE PARSING TEST ═══');
  for (var i = 0; i < testDates.length; i++) {
    var input = testDates[i];
    var key = createGameKey_(input, 'Home Team', 'Away Team');
    Logger.log('Input: ' + input + ' → Key: ' + key);
  }
}

/**
 * Create key without date for fuzzy matching
 */
function createGameKeyNoDate_(home, away) {
  if (!home || !away) return null;
  return 'NODATE|' + normalizeTeamName_(home) + '|' + normalizeTeamName_(away);
}

/**
 * Normalize team name for matching
 */
function normalizeTeamName_(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Normalize date to YYYY-MM-DD format
 * Handles Date objects, Excel serial numbers, and various string formats
 * Smart DD/MM vs MM/DD detection
 */
function normalizeDateStr_(date) {
  if (!date) return '';
  var d = null;

  if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'number') {
    // Excel serial date (days since 1899-12-30)
    d = new Date((date - 25569) * 86400000);
  } else {
    var str = String(date).trim();
    
    // Fix malformed dates like "02/032025" → "02/03/2025"
    var m1 = str.match(/^(\d{1,2})\/(\d{2})(\d{4})$/);
    if (m1) str = m1[1] + '/' + m1[2] + '/' + m1[3];
    
    // Fix "02032025" → "02/03/2025"
    var m2 = str.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (m2) str = m2[1] + '/' + m2[2] + '/' + m2[3];
    
    // Normalize separators
    str = str.replace(/[-\.]/g, '/');
    
    // Parse date parts
    var parts = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (parts) {
      var p1 = parseInt(parts[1], 10);
      var p2 = parseInt(parts[2], 10);
      var year = parseInt(parts[3], 10);
      
      // Smart DD/MM vs MM/DD detection
      if (p1 > 12) {
        // Must be DD/MM (day > 12)
        d = new Date(year, p2 - 1, p1);
      } else if (p2 > 12) {
        // Must be MM/DD (day > 12)
        d = new Date(year, p1 - 1, p2);
      } else {
        // Ambiguous: default to DD/MM (common in non-US sheets)
        d = new Date(year, p2 - 1, p1);
      }
    } else {
      // Try native parsing as fallback
      d = new Date(str);
    }
  }

  if (d && !isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return '';
}

/**
 * Group predictions by game for strategy identification
 */
function groupPredictionsByGame_(logData, logH) {
  var groups = {};
  
  for (var i = 1; i < logData.length; i++) {
    var row = logData[i];
    var key = createGameKey_(
      row[logH['date']],
      row[logH['home']],
      row[logH['away']]
    );
    
    if (!key) continue;
    
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push({ rowIndex: i, row: row });
  }
  
  return groups;
}


/**
 * Load HIGH_QTR predictions from Bet_Slips and archives
 * Handles multi-header sheets (with #ERROR! blocks)
 */
function loadHighQtrPredictions_(ss) {
  var predictions = [];

  // Pre-normalize type patterns for matching
  var typePatterns = ['HIGH QTR', 'HIGHQTR', 'HIGHEST', 'HSQ', 'SNIPER HIGH', 'SNIPERHIGH']
    .map(function(s) { return s.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  // Flexible required columns (alternatives per field)
  var requiredAlternatives = [
    ['date', 'gamedate', 'game_date'],
    ['match', 'matchup', 'game', 'teams'],
    ['pick', 'selection', 'bet'],
    ['type', 'bettype', 'bet_type', 'category']
  ];

  // ─────────────────────────────────────────────────────────────
  // SOURCE 1: Bet_Slips
  // ─────────────────────────────────────────────────────────────
  var slipsSheet = getSheetInsensitive(ss, 'Bet_Slips');
  if (slipsSheet && slipsSheet.getLastRow() >= 2) {
    var data = slipsSheet.getDataRange().getValues();
    var headerBlocks = findHeaderRows_(data, requiredAlternatives);
    Logger.log('[HIGH_QTR] Bet_Slips header blocks: ' + headerBlocks.length);

    for (var b = 0; b < headerBlocks.length; b++) {
      var hdrRowIdx = headerBlocks[b].rowIndex;
      var hdr = headerBlocks[b].headerMap;
      var end = (b + 1 < headerBlocks.length) ? headerBlocks[b + 1].rowIndex : data.length;

      // Get column indexes
      var dateCol = findColumn_(hdr, ['date', 'gamedate']);
      var matchCol = findColumn_(hdr, ['match', 'matchup', 'game', 'teams']);
      var pickCol = findColumn_(hdr, ['pick', 'selection', 'bet']);
      var typeCol = findColumn_(hdr, ['type', 'bettype', 'category']);

      // Skip block if required columns missing
      if (matchCol === undefined || pickCol === undefined || typeCol === undefined) {
        Logger.log('[HIGH_QTR] Skipping block at row ' + (hdrRowIdx + 1) + ': missing columns');
        continue;
      }

      for (var r = hdrRowIdx + 1; r < end; r++) {
        var row = data[r];
        if (!row || row.length === 0) continue;

        var firstCell = String(row[0] || '').trim();
        if (firstCell === '#ERROR!' || firstCell === '#REF!' || 
            firstCell === '#N/A' || firstCell === '') continue;

        // Normalize type for matching
        var type = String(row[typeCol] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        var pick = String(row[pickCol] || '');
        var match = String(row[matchCol] || '');
        var date = dateCol !== undefined ? row[dateCol] : '';

        // Check if this is a HIGH_QTR prediction
        var isHighQtr = false;
        for (var t = 0; t < typePatterns.length; t++) {
          if (type.indexOf(typePatterns[t]) !== -1) {
            isHighQtr = true;
            break;
          }
        }
        if (!isHighQtr && /highest\s*scoring\s*q/i.test(pick)) isHighQtr = true;
        if (!isHighQtr && /high\s*qtr/i.test(pick)) isHighQtr = true;
        if (!isHighQtr && /hsq/i.test(type)) isHighQtr = true;
        if (!isHighQtr) continue;

        // Extract quarter from pick text
        var qMatch = pick.match(/(Q[1-4])/i);
        if (!qMatch) continue;

        // Try to extract predicted total
        var totalMatch = pick.match(/Q[1-4]\s*([\d.]+)/i);

        // Split match string into teams
        var matchParts = splitMatchString_(match);

        // Guard against empty teams
        if (!matchParts[0] || !matchParts[1]) continue;

        predictions.push({
          date: date,
          team1: matchParts[0],
          team2: matchParts[1],
          predictedQuarter: qMatch[1].toUpperCase(),
          predictedTotal: totalMatch ? parseFloat(totalMatch[1]) : null,
          pick: pick,
          source: 'Bet_Slips',
          rowNum: r + 1
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SOURCE 2: Archives
  // ─────────────────────────────────────────────────────────────
  var archiveNames = ['Bet_Slips_Archive', 'SlipsArchive', 'BetSlipsHistory', 'Slips_Archive'];
  
  for (var a = 0; a < archiveNames.length; a++) {
    var archSheet = getSheetInsensitive(ss, archiveNames[a]);
    if (!archSheet || archSheet.getLastRow() < 2) continue;

    var archData = archSheet.getDataRange().getValues();
    var archHeaders = findHeaderRows_(archData, requiredAlternatives);
    Logger.log('[HIGH_QTR] ' + archiveNames[a] + ' header blocks: ' + archHeaders.length);

    for (var ab = 0; ab < archHeaders.length; ab++) {
      var ahIdx = archHeaders[ab].rowIndex;
      var aH = archHeaders[ab].headerMap;
      var aEnd = (ab + 1 < archHeaders.length) ? archHeaders[ab + 1].rowIndex : archData.length;

      var aDateCol = findColumn_(aH, ['date', 'gamedate']);
      var aMatchCol = findColumn_(aH, ['match', 'matchup', 'game']);
      var aPickCol = findColumn_(aH, ['pick', 'selection']);
      var aTypeCol = findColumn_(aH, ['type', 'bettype']);

      if (aMatchCol === undefined || aPickCol === undefined || aTypeCol === undefined) continue;

      for (var ar = ahIdx + 1; ar < aEnd; ar++) {
        var aRow = archData[ar];
        if (!aRow) continue;
        
        var aFirst = String(aRow[0] || '').trim();
        if (aFirst === '#ERROR!' || aFirst === '#REF!' || 
            aFirst === '#N/A' || aFirst === '') continue;

        var aType = String(aRow[aTypeCol] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        var aPick = String(aRow[aPickCol] || '');
        var aMatch = String(aRow[aMatchCol] || '');
        var aDate = aDateCol !== undefined ? aRow[aDateCol] : '';

        var aIsHigh = false;
        for (var at = 0; at < typePatterns.length; at++) {
          if (aType.indexOf(typePatterns[at]) !== -1) {
            aIsHigh = true;
            break;
          }
        }
        if (!aIsHigh && /highest\s*scoring\s*q/i.test(aPick)) aIsHigh = true;
        if (!aIsHigh) continue;

        var aqm = aPick.match(/(Q[1-4])/i);
        if (!aqm) continue;

        var atm = aPick.match(/Q[1-4]\s*([\d.]+)/i);
        var aParts = splitMatchString_(aMatch);

        if (!aParts[0] || !aParts[1]) continue;

        predictions.push({
          date: aDate,
          team1: aParts[0],
          team2: aParts[1],
          predictedQuarter: aqm[1].toUpperCase(),
          predictedTotal: atm ? parseFloat(atm[1]) : null,
          pick: aPick,
          source: archiveNames[a],
          rowNum: ar + 1
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // DEDUPLICATE (using sorted team pair to handle A vs B == B vs A)
  // ─────────────────────────────────────────────────────────────
  var seen = {};
  var unique = [];
  
  for (var u = 0; u < predictions.length; u++) {
    var pred = predictions[u];
    var t1 = normalizeTeamName_(pred.team1);
    var t2 = normalizeTeamName_(pred.team2);
    
    // Sort teams so A|B == B|A
    var teamPair = [t1, t2].sort().join('|');
    var key = teamPair + '|' + pred.predictedQuarter + '|' + normalizeDateStr_(pred.date);
    
    if (!seen[key]) {
      seen[key] = true;
      unique.push(pred);
    }
  }

  Logger.log('[HIGH_QTR] Unique predictions after dedup: ' + unique.length);
  return unique;
}

/**
 * Evaluate HIGH_QTR predictions
 */
function evaluateHighQtrPredictions_(predictions, resultMapData, resH, quarterFormat) {
  var results = {
    total: 0,
    matched: 0,
    correct: 0,
    incorrect: 0,
    pending: 0,
    accuracy: 0,
    details: [],
    byPredictedQuarter: { 
      Q1: { c: 0, t: 0 }, 
      Q2: { c: 0, t: 0 }, 
      Q3: { c: 0, t: 0 }, 
      Q4: { c: 0, t: 0 } 
    },
    byActualQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    randomBaseline: 25,
    edgeVsRandom: 0
  };

  for (var i = 0; i < predictions.length; i++) {
    var pred = predictions[i];
    results.total++;

    // Look up result
    var resultRow = lookupResult_(resultMapData, pred.date, pred.team1, pred.team2);

    if (!resultRow) {
      results.pending++;
      results.details.push({
        date: pred.date,
        match: pred.team1 + ' vs ' + pred.team2,
        predicted: pred.predictedQuarter,
        actual: 'PENDING',
        result: 'PENDING',
        quarterTotals: null,
        source: pred.source
      });
      continue;
    }

    // Get quarter totals
    var qt = getQuarterTotals_(resultRow, resH, quarterFormat);
    if (!qt) {
      results.pending++;
      results.details.push({
        date: pred.date,
        match: pred.team1 + ' vs ' + pred.team2,
        predicted: pred.predictedQuarter,
        actual: 'NO Q DATA',
        result: 'NO DATA',
        quarterTotals: null,
        source: pred.source
      });
      continue;
    }

    results.matched++;

    // Find actual highest quarter
    var actualHighest = findHighestQuarter_(qt);
    var ok = pred.predictedQuarter === actualHighest.quarter;

    // Update stats
    results.byPredictedQuarter[pred.predictedQuarter].t++;
    if (ok) {
      results.correct++;
      results.byPredictedQuarter[pred.predictedQuarter].c++;
    } else {
      results.incorrect++;
    }

    if (actualHighest.quarter) {
      results.byActualQuarter[actualHighest.quarter]++;
    }

    results.details.push({
      date: pred.date,
      match: pred.team1 + ' vs ' + pred.team2,
      predicted: pred.predictedQuarter,
      predictedTotal: pred.predictedTotal,
      actual: actualHighest.quarter,
      actualTotal: actualHighest.total,
      result: ok ? 'WIN' : 'LOSS',
      quarterTotals: qt,
      margin: actualHighest.margin,
      source: pred.source
    });
  }

  // Calculate accuracy
  var decided = results.correct + results.incorrect;
  results.accuracy = decided ? Math.round((results.correct / decided) * 1000) / 10 : 0;
  results.edgeVsRandom = results.accuracy - results.randomBaseline;

  return results;
}

/**
 * Extract quarter totals from a result row
 * Returns { Q1: number, Q2: number, Q3: number, Q4: number } or null
 * [PATCHED]: Handles "Home - Away" strings in combined columns (e.g. "31 - 31" -> 62)
 */
function getQuarterTotals_(row, resH, format) {
  var totals = { Q1: NaN, Q2: NaN, Q3: NaN, Q4: NaN };

  if (format.separate) {
    // Separate home/away columns: Q1H + Q1A = Q1 total
    for (var q = 1; q <= 4; q++) {
      var hCol = findColumn_(resH, ['q' + q + 'h', 'q' + q + 'home', 'q' + q + '_home']);
      var aCol = findColumn_(resH, ['q' + q + 'a', 'q' + q + 'away', 'q' + q + '_away']);
      if (hCol !== undefined && aCol !== undefined) {
        var home = parseFloat(row[hCol]);
        var away = parseFloat(row[aCol]);
        if (isFinite(home) && isFinite(away)) {
          totals['Q' + q] = home + away;
        }
      }
    }
  } else if (format.total) {
    // Pre-calculated total columns
    for (var q2 = 1; q2 <= 4; q2++) {
      var col = findColumn_(resH, ['q' + q2 + 'total', 'q' + q2 + '_total']);
      if (col !== undefined) {
        var v = parseFloat(row[col]);
        if (isFinite(v)) totals['Q' + q2] = v;
      }
    }
  } else if (format.combined) {
    // Simple Q1, Q2, etc. columns which may contain "31 - 31" strings
    for (var q3 = 1; q3 <= 4; q3++) {
      var c3 = findColumn_(resH, ['q' + q3]);
      if (c3 !== undefined) {
        var rawVal = row[c3];
        
        // 1. Try parsing as "Home - Away" string first
        var parsed = parseScore(rawVal); // Uses local or global parseScore
        if (parsed && parsed.length === 2) {
           totals['Q' + q3] = parsed[0] + parsed[1];
        } else {
           // 2. Fallback to raw number if it's already a total
           var v3 = parseFloat(rawVal);
           if (isFinite(v3)) totals['Q' + q3] = v3;
        }
      }
    }
  }

  // Return null if no valid quarter data found
  var hasData = isFinite(totals.Q1) || isFinite(totals.Q2) || 
                isFinite(totals.Q3) || isFinite(totals.Q4);
  return hasData ? totals : null;
}

/**
 * Find the highest scoring quarter from totals
 * Returns { quarter: 'Q1'|'Q2'|'Q3'|'Q4'|null, total: number, margin: number }
 */
function findHighestQuarter_(totals) {
  var best = { quarter: null, total: -Infinity, margin: 0 };
  var arr = [];

  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(q) {
    var v = totals[q];
    if (isFinite(v)) {
      arr.push({ quarter: q, total: v });
      if (v > best.total) {
        best.quarter = q;
        best.total = v;
      }
    }
  });

  // Calculate margin (difference between 1st and 2nd highest)
  arr.sort(function(a, b) { return b.total - a.total; });
  if (arr.length >= 2) {
    best.margin = arr[0].total - arr[1].total;
  }

  return best;
}

/**
 * Evaluate all O/U predictions from OU_Log
 * Computes overall stats and per-game strategy stats
 */
function evaluatePredictions_(logData, logH, resultMapData, resH, quarterFormat) {
  // Initialize evaluation structure
  var eval_ = {
    all: { total: 0, matched: 0, correct: 0, incorrect: 0, push: 0, pending: 0, accuracy: 0 },
    highestConf: { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    highestEV: { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    composite: { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    directional: { bets: 0, correct: 0, incorrect: 0, push: 0, accuracy: 0 },
    byQuarter: { Q1: { c: 0, t: 0 }, Q2: { c: 0, t: 0 }, Q3: { c: 0, t: 0 }, Q4: { c: 0, t: 0 } },
    byDirection: { OVER: { c: 0, t: 0 }, UNDER: { c: 0, t: 0 } },
    byLeague: {},
    details: [],
    duplicatesSkipped: 0
  };

  var seen = {};
  var byGame = {}; // For strategy grouping

  // Find column indexes
  var dateCol = findColumn_(logH, ['date', 'gamedate', 'game_date']);
  var homeCol = findColumn_(logH, ['home', 'hometeam', 'home_team']);
  var awayCol = findColumn_(logH, ['away', 'awayteam', 'away_team']);
  var quarterCol = findColumn_(logH, ['quarter', 'qtr', 'q']);
  var dirCol = findColumn_(logH, ['direction', 'prediction', 'pick', 'side']);
  var lineCol = findColumn_(logH, ['line', 'threshold', 'total', 'ouline', 'ou_line']);
  var leagueCol = findColumn_(logH, ['league', 'competition', 'comp']);
  var confCol = findColumn_(logH, ['confidence', 'conf', 'confpct', 'conf_pct']);
  var evCol = findColumn_(logH, ['ev', 'expectedvalue', 'expected_value', 'evpct']);
  var edgeCol = findColumn_(logH, ['edge', 'edgescore', 'edge_score']);
  var dirFlagCol = findColumn_(logH, ['isdirectional', 'directional', 'is_directional']);

  Logger.log('[Eval] Column indexes - date:' + dateCol + ' home:' + homeCol + ' away:' + awayCol +
             ' qtr:' + quarterCol + ' dir:' + dirCol + ' line:' + lineCol + ' ev:' + evCol);

  // Process each row
  for (var r = 1; r < logData.length; r++) {
    var row = logData[r];

    // Extract values with safe defaults
    var date = dateCol !== undefined ? row[dateCol] : null;
    var home = homeCol !== undefined ? String(row[homeCol] || '').trim() : '';
    var away = awayCol !== undefined ? String(row[awayCol] || '').trim() : '';
    var league = leagueCol !== undefined ? String(row[leagueCol] || '').trim() : 'Unknown';
    if (!league) league = 'Unknown';

    // Normalize quarter
    var qRaw = quarterCol !== undefined ? String(row[quarterCol] || '').toUpperCase() : '';
    var qm = qRaw.match(/Q?([1-4])/);
    var quarter = qm ? 'Q' + qm[1] : '';
    if (!quarter) continue;

    // Normalize direction
    var dirRaw = dirCol !== undefined ? String(row[dirCol] || '').toUpperCase() : '';
    var direction = '';
    if (dirRaw.indexOf('OVER') !== -1) direction = 'OVER';
    else if (dirRaw.indexOf('UNDER') !== -1) direction = 'UNDER';
    if (!direction) continue;

    // Parse line
    var line = lineCol !== undefined ? parseFloat(row[lineCol]) : NaN;
    if (!isFinite(line)) continue;

    // Require both teams
    if (!home || !away) continue;

    // Normalize for dedup and grouping
    var dateStr = normalizeDateStr_(date);
    var homeNorm = normalizeTeamName_(home);
    var awayNorm = normalizeTeamName_(away);

    // Dedup key (uses NODATE fallback to prevent "|home|away" keys)
    var dedupKey = (dateStr || 'NODATE') + '|' + homeNorm + '|' + awayNorm +
      '|' + quarter + '|' + direction + '|' + line.toFixed(2);

    if (seen[dedupKey]) {
      eval_.duplicatesSkipped++;
      continue;
    }
    seen[dedupKey] = true;

    eval_.all.total++;

    // Look up result
    var resultRow = lookupResult_(resultMapData, date, home, away);
    if (!resultRow) {
      eval_.all.pending++;
      continue;
    }

    // Get quarter totals
    var qTotals = getQuarterTotals_(resultRow, resH, quarterFormat);
    if (!qTotals || !isFinite(qTotals[quarter])) {
      eval_.all.pending++;
      continue;
    }

    eval_.all.matched++;

    // Evaluate outcome
    var actual = qTotals[quarter];
    var outcome = evaluateOUOutcome_(direction, line, actual);
    var diff = actual - line;

    // Update overall stats
    if (outcome === 'WIN') {
      eval_.all.correct++;
      eval_.byQuarter[quarter].c++;
      eval_.byDirection[direction].c++;
    } else if (outcome === 'LOSS') {
      eval_.all.incorrect++;
    } else {
      eval_.all.push++;
    }
    eval_.byQuarter[quarter].t++;
    eval_.byDirection[direction].t++;

    // Update league stats
    if (!eval_.byLeague[league]) {
      eval_.byLeague[league] = { t: 0, c: 0, l: 0, p: 0 };
    }
    eval_.byLeague[league].t++;
    if (outcome === 'WIN') eval_.byLeague[league].c++;
    else if (outcome === 'LOSS') eval_.byLeague[league].l++;
    else eval_.byLeague[league].p++;

    // Parse strategy metrics
    var conf = confCol !== undefined ? parseFloat(row[confCol]) : 0;
    conf = isFinite(conf) ? conf : 0;

    var ev = evCol !== undefined ? parseFloat(row[evCol]) : 0;
    ev = isFinite(ev) ? ev : 0;
    if (ev > 0 && ev <= 1) ev *= 100; // Normalize decimal EV to percentage

    var edge = edgeCol !== undefined ? parseFloat(row[edgeCol]) : 0;
    edge = isFinite(edge) ? edge : 0;

    // Smart edge normalization (detect if already 0-1)
    var edgeNorm = edge;
    if (edgeNorm > 1) edgeNorm = edgeNorm / 100;
    edgeNorm = Math.min(Math.max(edgeNorm, 0), 1);

    // Composite score
    var composite = (conf * 0.4) + (ev * 0.4) + (edgeNorm * 20);

    // Directional flag
    var dirFlag = dirFlagCol !== undefined ? String(row[dirFlagCol] || '').toUpperCase() : '';
    var isDirectional = (dirFlag === 'TRUE' || dirFlag === 'YES' || dirFlag === '1');

    // Create prediction record
    var pred = {
      date: dateStr || date,
      league: league,
      home: home,
      away: away,
      quarter: quarter,
      direction: direction,
      line: line,
      conf: conf,
      ev: ev,
      edge: edge,
      composite: composite,
      isDirectional: isDirectional,
      actual: actual,
      outcome: outcome,
      diff: diff,
      strategies: []
    };

    eval_.details.push(pred);

    // Group by game for strategy calculation (uses NODATE fallback)
    var gameKey = (dateStr || 'NODATE') + '|' + homeNorm + '|' + awayNorm;
    if (!byGame[gameKey]) byGame[gameKey] = [];
    byGame[gameKey].push(pred);
  }

  // ─────────────────────────────────────────────────────────────
  // CALCULATE STRATEGY STATS (per-game best pick)
  // ─────────────────────────────────────────────────────────────
  var gameCount = 0;
  
  for (var gk in byGame) {
    var preds = byGame[gk];
    if (!preds || preds.length === 0) continue;
    gameCount++;

    var bestConf = null;
    var bestEV = null;
    var bestComp = null;
    var bestDir = null;

    for (var i = 0; i < preds.length; i++) {
      var p = preds[i];
      
      // Highest confidence
      if (!bestConf || p.conf > bestConf.conf) bestConf = p;
      
      // Highest EV (prefer positive)
      if (p.ev > 0 && (!bestEV || p.ev > bestEV.ev)) bestEV = p;
      
      // Highest composite
      if (!bestComp || p.composite > bestComp.composite) bestComp = p;
      
      // Best directional (requires flag + positive EV)
      if (p.isDirectional && p.ev > 0 && (!bestDir || p.ev > bestDir.ev)) bestDir = p;
    }

    // Fallback for EV if no positive EVs found
    if (!bestEV) {
      for (var j = 0; j < preds.length; j++) {
        if (!bestEV || preds[j].ev > bestEV.ev) bestEV = preds[j];
      }
    }

    // Apply strategy stats
    applyStrategyStats_(eval_.highestConf, bestConf, '📊CONF');
    applyStrategyStats_(eval_.highestEV, bestEV, '💰EV');
    applyStrategyStats_(eval_.composite, bestComp, '⚖️COMP');
    applyStrategyStats_(eval_.directional, bestDir, '🎯DIR');
  }

  Logger.log('[Eval] Games evaluated for strategies: ' + gameCount);

  // Calculate accuracies
  eval_.all.accuracy = calcAccuracy_(eval_.all.correct, eval_.all.incorrect);
  eval_.highestConf.accuracy = calcAccuracy_(eval_.highestConf.correct, eval_.highestConf.incorrect);
  eval_.highestEV.accuracy = calcAccuracy_(eval_.highestEV.correct, eval_.highestEV.incorrect);
  eval_.composite.accuracy = calcAccuracy_(eval_.composite.correct, eval_.composite.incorrect);
  eval_.directional.accuracy = calcAccuracy_(eval_.directional.correct, eval_.directional.incorrect);

  return eval_;
}

/**
 * Evaluate O/U outcome (WIN, LOSS, or PUSH)
 */
function evaluateOUOutcome_(direction, line, actual) {
  var diff = actual - line;
  
  // Push threshold (handles floating point precision)
  if (Math.abs(diff) < 0.01) return 'PUSH';
  
  if (direction === 'OVER') {
    return actual > line ? 'WIN' : 'LOSS';
  }
  if (direction === 'UNDER') {
    return actual < line ? 'WIN' : 'LOSS';
  }
  
  return 'LOSS';
}

/**
 * Calculate accuracy percentage (excluding pushes)
 */
function calcAccuracy_(correct, incorrect) {
  var decided = (correct || 0) + (incorrect || 0);
  if (decided <= 0) return 0;
  return Math.round((correct / decided) * 1000) / 10;
}

/**
 * Apply strategy stats to bucket
 */
function applyStrategyStats_(bucket, pred, label) {
  if (!pred) return;
  
  pred.strategies.push(label);
  bucket.bets++;
  
  if (pred.outcome === 'WIN') {
    bucket.correct++;
  } else if (pred.outcome === 'LOSS') {
    bucket.incorrect++;
  } else {
    bucket.push++;
  }
}

/**
 * =====================================================================
 * FUNCTION 4: writeAccuracyReport_(ss, eval_)
 * =====================================================================
 * Production-safe version with:
 *   - Throw-on-overflow row() to prevent silent data loss
 *   - pctToNumber_() for OU_Log string percentages
 *   - Defensive bucket reads throughout
 *   - Lookup failures section for debugging
 *   - COLS = 14 matching expanded detail header
 */
function writeAccuracyReport_(ss, eval_) {
  // Write O/U accuracy data into the main Accuracy_Report sheet (appended after
  // the existing content) so everything is consolidated in one place.
  // A standalone OU_Accuracy sheet is no longer created.
  var sheet = getSheetInsensitive(ss, 'Accuracy_Report') || ss.insertSheet('Accuracy_Report');
  // Do NOT clear — we append after whatever generateAccuracyReport already wrote.
  // Start writing at the next empty row after existing content.
  var startRow = sheet.getLastRow() + 2; // +2 for a blank separator row
  
  var out = [];
  var now = new Date().toLocaleString();
  var COLS = 14; // Matches expanded detail log columns

  // ─────────────────────────────────────────────────────────────────
  // HELPER: Enforce exact row width (throw-on-overflow for safety)
  // ─────────────────────────────────────────────────────────────────
  function row(arr) {
    arr = arr || [];
    if (arr.length > COLS) {
      // Fail loudly so layout bugs are caught immediately
      throw new Error('writeAccuracyReport_: row has ' + arr.length + ' cols, COLS=' + COLS + 
                      ' :: ' + JSON.stringify(arr.slice(0, 5)) + '...');
    }
    while (arr.length < COLS) arr.push('');
    return arr;
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPER: Safe property access
  // ─────────────────────────────────────────────────────────────────
  function safe(obj, prop, def) {
    return (obj && obj[prop] !== undefined && obj[prop] !== null) ? obj[prop] : def;
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPER: Robust percent coercion (handles strings like "63%")
  // ─────────────────────────────────────────────────────────────────
  function pctToNumber_(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') {
      if (!isFinite(v)) return 0;
      return (v > 0 && v <= 1) ? v * 100 : v;
    }
    var n = parseFloat(String(v).replace('%', '').trim());
    if (!isFinite(n)) return 0;
    return (n > 0 && n <= 1) ? n * 100 : n;
  }

  // ─────────────────────────────────────────────────────────────────
  // HEADER
  // ─────────────────────────────────────────────────────────────────
  out.push(row(['O/U ACCURACY REPORT']));
  out.push(row(['Generated: ' + now]));
  out.push(row(['Source: ' + (eval_.source || 'Unknown')]));
  out.push(row(['']));

  // ─────────────────────────────────────────────────────────────────
  // OVERALL SUMMARY
  // ─────────────────────────────────────────────────────────────────
  var all = eval_.all || {};
  out.push(row(['═══ OVERALL O/U SUMMARY ═══']));
  out.push(row(['Total Predictions', safe(all, 'total', 0)]));
  out.push(row(['Matched to Results', safe(all, 'matched', 0)]));
  out.push(row(['Pending (No Results)', safe(all, 'pending', 0)]));
  out.push(row(['Duplicates Skipped', eval_.duplicatesSkipped || 0]));
  out.push(row(['']));
  out.push(row(['Wins', safe(all, 'correct', 0)]));
  out.push(row(['Losses', safe(all, 'incorrect', 0)]));
  out.push(row(['Pushes', safe(all, 'push', 0)]));
  
  var allAcc = safe(all, 'accuracy', 0);
  out.push(row(['Win Rate', allAcc + '%']));
  out.push(row(['Breakeven Required', '52.4%']));

  var edge = Math.round((allAcc - 52.4) * 10) / 10;
  out.push(row(['Edge vs Breakeven', (edge >= 0 ? '+' : '') + edge.toFixed(1) + '%']));
  out.push(row(['']));

  // ─────────────────────────────────────────────────────────────────
  // HIGHEST SCORING QUARTER
  // ─────────────────────────────────────────────────────────────────
  out.push(row(['═══ HIGHEST SCORING QUARTER ═══']));
  if (eval_.highQtr && eval_.highQtr.total > 0) {
    out.push(row(['Total Predictions', eval_.highQtr.total]));
    out.push(row(['Matched', eval_.highQtr.matched]));
    out.push(row(['Pending', eval_.highQtr.pending]));
    out.push(row(['Correct', eval_.highQtr.correct]));
    out.push(row(['Incorrect', eval_.highQtr.incorrect]));
    out.push(row(['Accuracy', eval_.highQtr.accuracy + '%']));
    out.push(row(['Random Baseline', '25%']));
    var hqEdge = eval_.highQtr.edgeVsRandom || 0;
    out.push(row(['Edge vs Random', (hqEdge >= 0 ? '+' : '') + hqEdge.toFixed(1) + '%']));
  } else {
    out.push(row(['No HIGH_QTR predictions found or matched']));
  }
  out.push(row(['']));

  // ─────────────────────────────────────────────────────────────────
  // STRATEGY COMPARISON OR BET_SLIPS TYPE BREAKDOWN
  // ─────────────────────────────────────────────────────────────────
  var isBetSlips = String(eval_.source || '').toUpperCase() === 'BET_SLIPS';

  if (isBetSlips && eval_.byType && Object.keys(eval_.byType).length > 0) {
    // BET_SLIPS MODE: Show breakdown by bet type
    out.push(row(['═══ BET_SLIPS O/U BREAKDOWN ═══']));
    out.push(row(['(Grading ACTUAL bets from Bet_Slips)']));
    out.push(row(['']));
    out.push(row(['Type', 'Bets', 'Wins', 'Losses', 'Pushes', 'Win Rate', 'Edge']));

    // All Sniper O/U summary row
    var allEdge = allAcc - 52.4;
    out.push(row([
      'ALL SNIPER O/U',
      safe(all, 'matched', 0),
      safe(all, 'correct', 0),
      safe(all, 'incorrect', 0),
      safe(all, 'push', 0),
      allAcc + '%',
      (allEdge >= 0 ? '+' : '') + allEdge.toFixed(1) + '%'
    ]));

    // Individual type rows (sorted by volume)
    var typeNames = Object.keys(eval_.byType);
    typeNames.sort(function(a, b) {
      return (eval_.byType[b].bets || 0) - (eval_.byType[a].bets || 0);
    });

    typeNames.forEach(function(typeName) {
      var s = eval_.byType[typeName] || {};
      var acc = s.accuracy || 0;
      var e = acc - 52.4;
      out.push(row([
        '  • ' + typeName,
        s.bets || 0,
        s.correct || 0,
        s.incorrect || 0,
        s.push || 0,
        acc + '%',
        (e >= 0 ? '+' : '') + e.toFixed(1) + '%'
      ]));
    });
    out.push(row(['']));

  } else {
    // OU_LOG MODE: Show strategy comparison
    out.push(row(['═══ O/U STRATEGY COMPARISON ═══']));
    out.push(row(['Strategy', 'Bets', 'Wins', 'Losses', 'Pushes', 'Win Rate', 'Edge']));

    function stratRow(name, s) {
      s = s || {};
      var acc = s.accuracy || 0;
      var e = acc - 52.4;
      return row([
        name,
        s.bets || 0,
        s.correct || 0,
        s.incorrect || 0,
        s.push || 0,
        acc + '%',
        (e >= 0 ? '+' : '') + e.toFixed(1) + '%'
      ]);
    }

    // All Quarters row
    var allEdge2 = allAcc - 52.4;
    out.push(row([
      'All Quarters',
      safe(all, 'matched', 0),
      safe(all, 'correct', 0),
      safe(all, 'incorrect', 0),
      safe(all, 'push', 0),
      allAcc + '%',
      (allEdge2 >= 0 ? '+' : '') + allEdge2.toFixed(1) + '%'
    ]));

    out.push(stratRow('📊 Highest Confidence', eval_.highestConf));
    out.push(stratRow('💰 Highest EV', eval_.highestEV));
    out.push(stratRow('⚖️ Composite Score', eval_.composite));
    out.push(stratRow('🎯 Directional', eval_.directional));
    out.push(row(['']));
  }

  // ─────────────────────────────────────────────────────────────────
  // BY DIRECTION
  // ─────────────────────────────────────────────────────────────────
  out.push(row(['═══ O/U BY DIRECTION ═══']));
  out.push(row(['Direction', 'Bets', 'Wins', 'Win Rate']));

  ['OVER', 'UNDER'].forEach(function(d) {
    var bucket = (eval_.byDirection && eval_.byDirection[d]) || { t: 0, c: 0 };
    var t = bucket.t || 0;
    var c = bucket.c || 0;
    var acc = t ? Math.round((c / t) * 1000) / 10 : 0;
    out.push(row([d, t, c, acc + '%']));
  });
  out.push(row(['']));

  // ─────────────────────────────────────────────────────────────────
  // BY QUARTER
  // ─────────────────────────────────────────────────────────────────
  out.push(row(['═══ O/U BY QUARTER ═══']));
  out.push(row(['Quarter', 'Bets', 'Wins', 'Win Rate']));

  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(q) {
    var bucket = (eval_.byQuarter && eval_.byQuarter[q]) || { t: 0, c: 0 };
    var t = bucket.t || 0;
    var c = bucket.c || 0;
    var acc = t ? Math.round((c / t) * 1000) / 10 : 0;
    out.push(row([q, t, c, acc + '%']));
  });
  out.push(row(['']));

  // ─────────────────────────────────────────────────────────────────
  // BY LEAGUE (Top 10)
  // ─────────────────────────────────────────────────────────────────
  out.push(row(['═══ O/U BY LEAGUE (Top 10) ═══']));
  out.push(row(['League', 'Bets', 'Wins', 'Win Rate', 'W-L-P']));

  var leagues = Object.keys(eval_.byLeague || {}).map(function(k) {
    return { name: k, d: eval_.byLeague[k] };
  });
  leagues.sort(function(a, b) { 
    return (b.d.t || 0) - (a.d.t || 0); 
  });

  leagues.slice(0, 10).forEach(function(x) {
    var t = x.d.t || 0;
    var c = x.d.c || 0;
    var l = x.d.l || 0;
    var p = x.d.p || 0;
    var acc = t ? Math.round((c / t) * 1000) / 10 : 0;
    out.push(row([x.name, t, c, acc + '%', c + '-' + l + '-' + p]));
  });
  out.push(row(['']));

  // ─────────────────────────────────────────────────────────────────
  // LOOKUP FAILURES (Top 10 for debugging)
  // ─────────────────────────────────────────────────────────────────
  if (eval_.lookupFailures && eval_.lookupFailures.length > 0) {
    out.push(row(['═══ LOOKUP FAILURES (First 10) ═══']));
    out.push(row(['Date', 'Home', 'Away', 'Reason']));
    
    eval_.lookupFailures.slice(0, 10).forEach(function(f) {
      out.push(row([
        f.date || '',
        f.home || '',
        f.away || '',
        f.reason || ''
      ]));
    });
    
    if (eval_.lookupFailures.length > 10) {
      out.push(row(['... and ' + (eval_.lookupFailures.length - 10) + ' more']));
    }
    out.push(row(['']));
  }

  // ─────────────────────────────────────────────────────────────────
  // O/U DETAIL LOG (EXPANDED)
  // ─────────────────────────────────────────────────────────────────
  out.push(row(['═══ O/U DETAIL LOG ═══']));
  out.push(row(['Date', 'League', 'Home', 'Away', 'Qtr', 'Dir', 'Line', 'Actual', 'Result', 'Diff', 'Conf%', 'EV%', 'Tier', 'Type']));

  (eval_.details || []).forEach(function(d) {
    // Handle both confidence (Bet_Slips) and conf (OU_Log) with robust coercion
    var confVal = pctToNumber_(d.confidence !== undefined ? d.confidence : d.conf);
    var evVal = pctToNumber_(d.ev);

    var confStr = confVal > 0 ? confVal.toFixed(0) + '%' : '';
    var evStr = evVal > 0 ? evVal.toFixed(1) + '%' : '';
    var typeStr = (d.strategies && d.strategies.length) ? d.strategies.join(' ') : (d.type || '');

    out.push(row([
      d.date,
      d.league,
      d.home,
      d.away,
      d.quarter,
      d.direction,
      d.line,
      d.actual,
      d.outcome,
      isFinite(d.diff) ? d.diff.toFixed(1) : '',
      confStr,
      evStr,
      d.tier || '',
      typeStr
    ]));
  });

  // ─────────────────────────────────────────────────────────────────
  // HIGH_QTR DETAIL LOG
  // ─────────────────────────────────────────────────────────────────
  if (eval_.highQtr && eval_.highQtr.details && eval_.highQtr.details.length > 0) {
    out.push(row(['']));
    out.push(row(['═══ HIGH_QTR DETAIL LOG ═══']));
    out.push(row(['Date', 'Match', 'Predicted', 'PredTotal', 'Actual', 'ActTotal', 'Result', 'Q1', 'Q2', 'Q3', 'Q4', 'Margin', 'Source']));

    eval_.highQtr.details.forEach(function(h) {
      var qt = h.quarterTotals || {};
      var dateStr = h.date;

      if (h.date instanceof Date) {
        try {
          dateStr = Utilities.formatDate(h.date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } catch (e) {
          dateStr = String(h.date);
        }
      }

      out.push(row([
        dateStr,
        h.match,
        h.predicted,
        isFinite(h.predictedTotal) ? h.predictedTotal : '-',
        h.actual,
        isFinite(h.actualTotal) ? h.actualTotal : '-',
        h.result,
        isFinite(qt.Q1) ? qt.Q1 : '-',
        isFinite(qt.Q2) ? qt.Q2 : '-',
        isFinite(qt.Q3) ? qt.Q3 : '-',
        isFinite(qt.Q4) ? qt.Q4 : '-',
        isFinite(h.margin) ? h.margin.toFixed(1) : '-',
        h.source || ''
      ]));
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // WRITE TO SHEET (appended to Accuracy_Report after existing content)
  // ─────────────────────────────────────────────────────────────────
  sheet.getRange(startRow, 1, out.length, COLS).setValues(out);

  // Apply formatting (optional - wrapped in try/catch)
  try {
    sheet.getRange(startRow, 1).setFontWeight('bold').setFontSize(12);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 80);
    sheet.setColumnWidth(3, 120);
    sheet.setColumnWidth(4, 120);
  } catch (e) { /* Formatting is optional */ }

  // ─────────────────────────────────────────────────────────────────
  // APPLY CONDITIONAL FORMATTING (applies to whole sheet data range)
  // ─────────────────────────────────────────────────────────────────
  try {
    var range = sheet.getDataRange();
    var rules = [];

    // Green for WIN/HIT
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('WIN')
        .setBackground('#b6d7a8')
        .setFontColor('#274e13')
        .setRanges([range])
        .build()
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('HIT')
        .setBackground('#b6d7a8')
        .setFontColor('#274e13')
        .setRanges([range])
        .build()
    );

    // Red for LOSS/MISS
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('LOSS')
        .setBackground('#ea9999')
        .setFontColor('#990000')
        .setRanges([range])
        .build()
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('MISS')
        .setBackground('#ea9999')
        .setFontColor('#990000')
        .setRanges([range])
        .build()
    );

    // Yellow for PUSH
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('PUSH')
        .setBackground('#ffe599')
        .setFontColor('#b45f06')
        .setRanges([range])
        .build()
    );

    sheet.setConditionalFormatRules(rules);
    Logger.log('[Report] Applied color coding to Accuracy_Report (O/U section)');
  } catch (e) {
    Logger.log('Error applying colors: ' + e.message);
  }

  Logger.log('[Report] O/U section written to Accuracy_Report starting at row ' + startRow + ' (' + out.length + ' rows)');
}


/**
 * =====================================================================
 * UTILITIES
 * =====================================================================
 */
if (typeof getSheetInsensitive !== 'function') {
  function getSheetInsensitive(ss, name) {
    var sheets = ss.getSheets();
    var lower = name.toLowerCase();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().toLowerCase() === lower) return sheets[i];
    }
    return null;
  }
}

if (typeof createHeaderMap !== 'function') {
  function createHeaderMap(headerRow) {
    if (typeof createCanonicalHeaderMap_ === 'function') {
      return createCanonicalHeaderMap_(headerRow);
    }
    var map = {};
    if (!headerRow) return map;
    for (var i = 0; i < headerRow.length; i++) {
      var raw = String(headerRow[i] || '').trim();
      if (!raw) continue;
      var lower = raw.toLowerCase();
      var keyStrong = lower.replace(/[^a-z0-9]/g, '');
      if (keyStrong && map[keyStrong] === undefined) map[keyStrong] = i;
      var keyMedium = lower.replace(/[\s_-]+/g, '');
      if (keyMedium && map[keyMedium] === undefined) map[keyMedium] = i;
      if (map[lower] === undefined) map[lower] = i;
    }
    return map;
  }
}

/**
 * Find column index from header map using multiple possible names
 */
function findColumn_(headerMap, possibleNames) {
  if (!headerMap || !possibleNames) return undefined;
  
  for (var i = 0; i < possibleNames.length; i++) {
    var raw = String(possibleNames[i]);
    var key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (headerMap[key] !== undefined) return headerMap[key];
    if (typeof canonicalHeaderKey_ === 'function') {
      var ck = canonicalHeaderKey_(raw);
      if (headerMap[ck] !== undefined) return headerMap[ck];
    }
  }
  return undefined;
}

/**
 * Find all valid header rows in data (for multi-table sheets)
 * Uses flexible column matching with alternatives per field
 */
function findHeaderRows_(data, requiredAlternatives) {
  var headerRows = [];
  if (!data || !requiredAlternatives) return headerRows;
  
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    if (!row) continue;
    
    var firstCell = String(row[0] || '').trim();
    if (firstCell === '#ERROR!' || firstCell === '#REF!' || firstCell === '#N/A') continue;
    
    var map = createHeaderMap(row);
    var hasAll = true;
    
    for (var i = 0; i < requiredAlternatives.length; i++) {
      var alternatives = requiredAlternatives[i];
      var found = false;
      
      for (var j = 0; j < alternatives.length; j++) {
        var key = String(alternatives[j]).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (map[key] !== undefined) {
          found = true;
          break;
        }
      }
      
      if (!found) {
        hasAll = false;
        break;
      }
    }
    
    if (hasAll) {
      headerRows.push({ rowIndex: r, headerMap: map });
    }
  }
  
  return headerRows;
}

/**
 * Menu integration
 */
function runOUAccuracyReport() {
  buildOUAccuracyReport();
}

/**
 * Debug function to check HIGH_QTR detection
 */
function debugHighQtrDetection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var predictions = loadHighQtrPredictions_(ss);
  
  Logger.log('═══ HIGH_QTR DETECTION DEBUG ═══');
  Logger.log('Found: ' + predictions.length + ' predictions');
  
  for (var i = 0; i < predictions.length; i++) {
    var p = predictions[i];
    Logger.log('\n#' + (i + 1) + ':');
    Logger.log('  Match: ' + p.home + ' vs ' + p.away);
    Logger.log('  Predicted: ' + p.predictedQuarter + (p.predictedTotal ? ' (' + p.predictedTotal + ')' : ''));
    Logger.log('  Pick: ' + p.pick);
    Logger.log('  Source: ' + p.source);
    Logger.log('  Date: ' + p.date);
  }
  
  // Also check what columns exist in results
  var resSheet = getSheetInsensitive(ss, 'ResultsClean') || 
                 getSheetInsensitive(ss, 'RawResults');
  if (resSheet) {
    var headers = resSheet.getRange(1, 1, 1, resSheet.getLastColumn()).getValues()[0];
    Logger.log('\n═══ RESULT COLUMNS ═══');
    Logger.log(headers.join(', '));
  }
}



/**
 * Group predictions by game
 * [FIX v2.0] - More robust key generation
 */
function groupPredictionsByGame_(logData, logH) {
  var groups = {};
  var seenRows = {};
  
  for (var i = 1; i < logData.length; i++) {
    var row = logData[i];
    var pred = String(row[logH['prediction']] || '').toUpperCase();
    
    if (pred !== 'OVER' && pred !== 'UNDER') continue;
    
    var key = createGameKey_(
      row[logH['date']],
      row[logH['home']],
      row[logH['away']]
    );
    
    if (!key) continue;
    
    // [FIX] Create unique row key including quarter to detect duplicates
    var quarter = String(row[logH['quarter']] || '').toUpperCase();
    var rowKey = key + '|' + quarter + '|' + pred;
    
    // Skip if we've already seen this exact row
    if (seenRows[rowKey]) {
      Logger.log('[groupPredictions] Duplicate row skipped: ' + rowKey);
      continue;
    }
    seenRows[rowKey] = true;
    
    if (!groups[key]) groups[key] = [];
    groups[key].push({ row: row, index: i });
  }
  
  return groups;
}

/**
 * Identify the best pick by each strategy for each game
 */
function identifyStrategyPicks_(gameGroups, logH) {
  var markers = {
    confidence: {},
    ev: {},
    composite: {},
    directional: {}
  };
  
  for (var gameKey in gameGroups) {
    var group = gameGroups[gameKey];
    
    // Best by Confidence
    var bestConf = findBestInGroup_(group, logH, 'confidence');
    if (bestConf) {
      var confKey = gameKey + '|' + bestConf.row[logH['quarter']];
      markers.confidence[confKey] = true;
    }
    
    // Best by EV
    var bestEV = findBestInGroup_(group, logH, 'ev_percent');
    if (bestEV) {
      var evKey = gameKey + '|' + bestEV.row[logH['quarter']];
      markers.ev[evKey] = true;
    }
    
    // Best by Composite
    var bestComp = findBestInGroup_(group, logH, 'composite');
    if (bestComp) {
      var compKey = gameKey + '|' + bestComp.row[logH['quarter']];
      markers.composite[compKey] = true;
    }
    
    // Best Directional
    var bestDir = findBestDirectionalInGroup_(group, logH);
    if (bestDir) {
      var dirKey = gameKey + '|' + bestDir.row[logH['quarter']];
      markers.directional[dirKey] = true;
    }
  }
  
  return markers;
}

/**
 * Find best prediction in a group by a specific metric
 */
function findBestInGroup_(group, logH, metric) {
  if (group.length === 0) return null;
  
  var best = group[0];
  var bestVal = parseFloat(best.row[logH[metric]]) || 0;
  
  for (var i = 1; i < group.length; i++) {
    var val = parseFloat(group[i].row[logH[metric]]) || 0;
    if (val > bestVal) {
      best = group[i];
      bestVal = val;
    }
  }
  
  return best;
}

/**
 * Find best directional pick in a group
 * OVER: highest expected total
 * UNDER: lowest expected total
 * Then pick between them by EV, then confidence
 */
function findBestDirectionalInGroup_(group, logH) {
  var overs = [];
  var unders = [];
  
  for (var i = 0; i < group.length; i++) {
    var pred = String(group[i].row[logH['prediction']] || '').toUpperCase();
    var expQ = parseFloat(group[i].row[logH['expected_q']]) || 0;
    
    if (pred === 'OVER') {
      overs.push({ item: group[i], expQ: expQ });
    } else if (pred === 'UNDER') {
      unders.push({ item: group[i], expQ: expQ });
    }
  }
  
  var bestOver = null;
  var bestUnder = null;
  
  // For OVER: pick highest expected (most room to go over)
  if (overs.length > 0) {
    overs.sort(function(a, b) { return b.expQ - a.expQ; });
    bestOver = overs[0].item;
  }
  
  // For UNDER: pick lowest expected (most room to go under)
  if (unders.length > 0) {
    unders.sort(function(a, b) { return a.expQ - b.expQ; });
    bestUnder = unders[0].item;
  }
  
  // Choose between them
  if (bestOver && bestUnder) {
    var evOver = parseFloat(bestOver.row[logH['ev_percent']]) || 0;
    var evUnder = parseFloat(bestUnder.row[logH['ev_percent']]) || 0;
    var confOver = parseFloat(bestOver.row[logH['confidence']]) || 0;
    var confUnder = parseFloat(bestUnder.row[logH['confidence']]) || 0;
    
    if (evUnder > evOver + 0.5) return bestUnder;
    if (evOver > evUnder + 0.5) return bestOver;
    return confOver >= confUnder ? bestOver : bestUnder;
  }
  
  return bestOver || bestUnder;
}



/**
 * Get actual quarter total from result row
 * [FIX v3.0] - Explicit type checking to prevent date contamination
 */
function getActualQuarterTotal_(resultRow, resH, quarter, quarterFormat) {
  var qNum = parseInt(quarter.replace(/\D/g, ''), 10);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) return NaN;
  
  var actual = NaN;
  
  // Try separate columns first (Q1H, Q1A)
  if (quarterFormat.separate) {
    var homeCol = resH['q' + qNum + 'h'];
    var awayCol = resH['q' + qNum + 'a'];
    
    if (homeCol !== undefined && awayCol !== undefined) {
      var homeRaw = resultRow[homeCol];
      var awayRaw = resultRow[awayCol];
      
      // [FIX] Check for Date objects
      if (homeRaw instanceof Date || awayRaw instanceof Date) {
        Logger.log('[BUG] Date found in quarter score column Q' + qNum);
        return NaN;
      }
      
      var homeVal = parseFloat(homeRaw);
      var awayVal = parseFloat(awayRaw);
      
      // [FIX] Sanity check - quarter scores shouldn't be > 100
      if (!isNaN(homeVal) && !isNaN(awayVal) && homeVal < 100 && awayVal < 100) {
        actual = homeVal + awayVal;
      }
    }
  }
  
  // Try combined columns (Q1 with "25-18" format)
  if (isNaN(actual) && quarterFormat.combined) {
    var combCol = resH['q' + qNum];
    
    if (combCol !== undefined) {
      var combVal = resultRow[combCol];
      
      // [FIX] Check for Date objects
      if (combVal instanceof Date) {
        Logger.log('[BUG] Date found in combined quarter column Q' + qNum);
        return NaN;
      }
      
      var parsed = parseScore(combVal);
      
      if (parsed && parsed.length >= 2) {
        // [FIX] Sanity check scores
        if (parsed[0] < 100 && parsed[1] < 100) {
          actual = parsed[0] + parsed[1];
        }
      } else {
        var numVal = parseFloat(combVal);
        // [FIX] Sanity check - total shouldn't be > 150
        if (!isNaN(numVal) && numVal < 150) {
          actual = numVal;
        }
      }
    }
  }
  
  return actual;
}
/**
 * Calculate win rate from stats object
 */
function calcWinRate_(statsObj) {
  // Handle both 'matched' (overall) and 'bets' (sub-categories) 
  var total = statsObj.matched || statsObj.bets || 0;
  var pushes = statsObj.pushes || 0;
  var wins = statsObj.wins || 0;
  
  var decided = total - pushes;
  if (decided <= 0) return 0;
  return (wins / decided) * 100;
}


/**
 * Display summary dialog after report generation
 */
function displayAccuracySummary_(ui, eval_) {
  var msg = '═══ O/U ACCURACY SUMMARY ═══\n\n';
  
  msg += 'Overall:\n';
  msg += '  Matched: ' + eval_.all.matched + '/' + eval_.all.total + '\n';
  msg += '  W-L-P: ' + eval_.all.correct + '-' + eval_.all.incorrect + '-' + eval_.all.push + '\n';
  msg += '  Win Rate: ' + eval_.all.accuracy + '%\n';
  msg += '  Edge: ' + (eval_.all.accuracy - 52.4).toFixed(1) + '%\n\n';

  msg += 'Strategies (Rate / Bets):\n';
  msg += '  📊 Confidence: ' + eval_.highestConf.accuracy + '% / ' + eval_.highestConf.bets + '\n';
  msg += '  💰 EV: ' + eval_.highestEV.accuracy + '% / ' + eval_.highestEV.bets + '\n';
  msg += '  ⚖️ Composite: ' + eval_.composite.accuracy + '% / ' + eval_.composite.bets + '\n';
  msg += '  🎯 Directional: ' + eval_.directional.accuracy + '% / ' + eval_.directional.bets + '\n';

  if (eval_.highQtr && eval_.highQtr.total > 0) {
    msg += '\nHighest Scoring Quarter:\n';
    msg += '  Matched: ' + eval_.highQtr.matched + '/' + eval_.highQtr.total + '\n';
    msg += '  Accuracy: ' + eval_.highQtr.accuracy + '% (vs 25% random)\n';
    msg += '  Edge: ' + (eval_.highQtr.edgeVsRandom >= 0 ? '+' : '') + 
           eval_.highQtr.edgeVsRandom.toFixed(1) + '%\n';
  }

  ui.alert('Report Complete', msg, ui.ButtonSet.OK);
}


function parseScore(val) {
  if (!val) return null;
  var str = String(val).trim();
  var match = str.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  return null;
}

// Helper: Apply conditional formatting to Result column
function applyResultFormatting(sheet, startRow, numRows, resultCol) {
  var range = sheet.getRange(startRow, resultCol, numRows, 1);
  var values = range.getValues();
  var colors = values.map(function(row) {
    if (row[0] === 'WIN') return ['#c6efce'];
    if (row[0] === 'LOSS') return ['#ffc7ce'];
    if (row[0] === 'PUSH') return ['#ffeb9c'];
    return [null];
  });
  range.setBackgrounds(colors);
}

/**
 * =====================================================================
 * HELPER: _getVenueStats
 * =====================================================================
 */
function _getVenueStats(marginStats, team, venue, quarter) {
  const defaultStats = {
    samples: 0,
    avgMargin: 0,
    rawMargins: [],
    stdDev: 0
  };

  try {
    if (!marginStats || !team || !venue || !quarter) {
      return defaultStats;
    }

    let teamData = marginStats[team];
    if (!teamData) {
      const teamKeys = Object.keys(marginStats);
      for (let t = 0; t < teamKeys.length; t++) {
        if (teamKeys[t].toLowerCase() === team.toLowerCase()) {
          teamData = marginStats[teamKeys[t]];
          break;
        }
      }
    }
    if (!teamData) {
      return defaultStats;
    }

    const venueKeyTitle = venue.charAt(0).toUpperCase() + venue.slice(1).toLowerCase();
    let venueData = teamData[venue] || teamData[venue.toLowerCase()] || teamData[venueKeyTitle];

    if (!venueData) {
      return defaultStats;
    }

    let quarterData = venueData[quarter] || venueData[String(quarter).toUpperCase()] || 
                      venueData[String(quarter).toLowerCase()];

    if (!quarterData) {
      return defaultStats;
    }

    return {
      samples: quarterData.samples || quarterData.count || 0,
      avgMargin: quarterData.avgMargin || quarterData.avg || 0,
      rawMargins: quarterData.rawMargins || quarterData.margins || [],
      stdDev: quarterData.stdDev || 0
    };
  } catch (e) {
    Logger.log('_getVenueStats ERROR: ' + e.message);
    return defaultStats;
  }
}


/**
 * =====================================================================
 * UTILITY: clearAllTier2Caches (ENHANCED)
 * =====================================================================
 * Clears all Tier 2 caches and resets config for fresh load.
 * =====================================================================
 */
function clearAllTier2Caches() {
  // Clear margin stats cache
  if (typeof TIER2_MARGIN_STATS_CACHE !== 'undefined') {
    TIER2_MARGIN_STATS_CACHE = null;
  }
  
  // Clear venue stats cache
  if (typeof TIER2_VENUE_STATS_CACHE !== 'undefined') {
    TIER2_VENUE_STATS_CACHE = null;
  }
  
  // Clear config cache (forces reload)
  if (typeof CONFIG_TIER2 !== 'undefined') {
    CONFIG_TIER2 = null;
  }
  if (typeof CONFIG_TIER2_META !== 'undefined') {
    CONFIG_TIER2_META = {};
  }
  
  // Clear O/U cache
  if (typeof T2OU_CACHE !== 'undefined') {
    T2OU_CACHE = { teamStats: null, league: null, builtAt: null };
  }
  
  // Clear tuner results
  if (typeof t2_lastEvalResults !== 'undefined') {
    t2_lastEvalResults = null;
  }
  
  Logger.log('[clearAllTier2Caches] All Tier 2 caches cleared:');
  Logger.log('  - TIER2_MARGIN_STATS_CACHE');
  Logger.log('  - TIER2_VENUE_STATS_CACHE');
  Logger.log('  - CONFIG_TIER2');
  Logger.log('  - T2OU_CACHE');
  Logger.log('  - t2_lastEvalResults');
  
  return { success: true, message: 'All caches cleared' };
}

/**
 * =====================================================================
 * HELPER: loadStandingsAsRankings_
 * =====================================================================
 */
function loadStandingsAsRankings_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const rankings = {};

  const standingsSheet = getSheetInsensitive(ss, 'Standings');
  if (!standingsSheet) {
    Logger.log('loadStandingsAsRankings_: Standings sheet not found');
    return rankings;
  }

  const data = standingsSheet.getDataRange().getValues();
  if (data.length < 2) return rankings;

  const h = createHeaderMap(data[0]);

  const teamCol = h['team name'] !== undefined ? h['team name'] :
                  h.team !== undefined ? h.team :
                  h.teamname !== undefined ? h.teamname : 1;

  let rankCounter = 1;
  for (let i = 1; i < data.length; i++) {
    const teamName = String(data[i][teamCol] || '').trim();
    if (!teamName) continue;

    const lowered = teamName.toLowerCase();
    if (lowered === 'team name' || lowered === 'team') continue;

    rankings[teamName] = { rank: rankCounter };
    rankCounter++;
  }

  Logger.log('loadStandingsAsRankings_: Loaded ' + Object.keys(rankings).length + ' teams');
  return rankings;
}

/**
 * =====================================================================
 * HELPER: roundToHalf_
 * =====================================================================
 */
function roundToHalf_(num) {
  if (typeof num !== 'number' || isNaN(num)) return 0;
  return Math.round(num * 2) / 2;
}

/**
 * =====================================================================
 * SIMULATION HELPER: getTunedThreshold_
 * =====================================================================
 */
function getTunedThreshold_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const simSheet = getSheetInsensitive(ss, 'Stats_Tier2_Simulation');
  if (!simSheet) {
    Logger.log('getTunedThreshold_: No simulation sheet found. Using default 2.5');
    return 2.5;
  }

  const data = simSheet.getDataRange().getValues();
  for (let r = data.length - 1; r >= 0; r--) {
    const key = String(data[r][0] || '').toLowerCase().trim();
    if (key === 'bestthreshold') {
      const val = parseFloat(data[r][1]);
      Logger.log('getTunedThreshold_: Found tuned threshold = ' + val);
      return isNaN(val) ? 2.5 : val;
    }
  }

  Logger.log('getTunedThreshold_: BestThreshold not found. Using default 2.5');
  return 2.5;
}

/**
 * =====================================================================
 * LOGGER: logTier2Prediction (DYNAMIC-AWARE)
 * =====================================================================
 * WHY:
 *   Forensic trail of every Tier 2 pick with dynamic threshold context.
 *
 * WHAT:
 *   Appends one row per quarter to 'Tier2_Log' including:
 *   - All original columns (backwards compatible)
 *   - NEW: Tier, Threshold_EVEN, Threshold_MEDIUM, Threshold_STRONG
 *
 * WHERE:
 *   WRITES: 'Tier2_Log'
 *   CALLED BY: predictQuarters_Tier2
 * =====================================================================
 */
function _getActiveTier2ConfigVersion_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var cfg = loadTier2Config(ss);
  var v = (cfg && (cfg.config_version || cfg.version)) ? String(cfg.config_version || cfg.version).trim() : '';
  return v || 'elite_defaults';
}

/**
 * =====================================================================
 * LOGGER: logTier2Prediction (PATCHED to include Confidence)
 * =====================================================================
 * FIX:
 *  - Adds "Confidence" and "Edge_Score" columns to Tier2_Log (appended safely)
 *  - Writes payload.confidence (percent 0-100) so SNIPER 🎯 can display it
 *
 * NOTE:
 *  - This does NOT reorder existing columns (prevents historical row misalignment)
 *  - Re-run predictQuarters_Tier2 after patch so new log rows contain confidence
 * =====================================================================
 */
function logTier2Prediction(ss, payload) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  try {
    var logSheet = getSheetInsensitive(ss, 'Tier2_Log');
    if (!logSheet) logSheet = ss.insertSheet('Tier2_Log');

    // Phase 2 / Patch 6: FORENSIC_CORE_17 first on greenfield; legacy + F17 merged append-only.
    var F17 = (typeof FORENSIC_CORE_17 !== 'undefined')
      ? FORENSIC_CORE_17.slice()
      : [
        'Prediction_Record_ID', 'Universal_Game_ID', 'Config_Version', 'Timestamp_UTC',
        'League', 'Date', 'Home', 'Away', 'Market', 'Period', 'Pick_Code', 'Pick_Text',
        'Confidence_Pct', 'Confidence_Prob', 'Tier_Code', 'EV', 'Edge_Score'
      ];
    var T2_EXTRA = [
      'Timestamp', 'Source_Sheet', 'Row_Index', 'Game_ID', 'Time', 'Quarter', 'Path',
      'Flip_Applied', 'Flip_Key', 'Raw_Margin_PreFlip', 'Final_Margin_PostFlip',
      'Abs_Margin', 'Threshold_Used', 'Tier', 'Threshold_EVEN', 'Threshold_MEDIUM', 'Threshold_STRONG',
      'Base_Margin', 'Momentum_Swing', 'Variance_Penalty', 'Avg_Variance',
      'Home_Momentum', 'Away_Momentum', 'Home_Variance', 'Away_Variance',
      'Rank_Home', 'Rank_Away', 'Prediction_Text', 'Confidence'
    ];
    var targetOrder = F17.concat(T2_EXTRA);

    function canonK_(name) {
      if (typeof canonicalHeaderKey_ === 'function') return canonicalHeaderKey_(name);
      return String(name || '').trim().toLowerCase().replace(/[\s\-\.]+/g, '_').replace(/[^\w_]/g, '');
    }

    // -------------------------------------------------------------------
    // 1) Ensure header exists and contains new columns (append-only upgrade)
    // -------------------------------------------------------------------
    var existingLastCol = logSheet.getLastColumn();
    var existingHeader = [];

    if (logSheet.getLastRow() > 0 && existingLastCol > 0) {
      existingHeader = logSheet.getRange(1, 1, 1, existingLastCol).getValues()[0] || [];
    }

    var headerToUse;
    if (!existingHeader || existingHeader.length === 0) {
      headerToUse = targetOrder;
      logSheet.getRange(1, 1, 1, headerToUse.length).setValues([headerToUse]);
      logSheet.getRange(1, 1, 1, headerToUse.length).setFontWeight('bold').setBackground('#d0d0d0');
    } else {
      headerToUse = existingHeader.slice();
      var headerMapExisting = (typeof createCanonicalHeaderMap_ === 'function')
        ? createCanonicalHeaderMap_(headerToUse)
        : createHeaderMap(headerToUse);

      targetOrder.forEach(function (col) {
        var ck = canonK_(col);
        if (headerMapExisting[ck] === undefined) {
          headerToUse.push(col);
          headerMapExisting[ck] = headerToUse.length - 1;
        }
      });

      if (headerToUse.length !== existingHeader.length) {
        logSheet.getRange(1, 1, 1, headerToUse.length).setValues([headerToUse]);
        logSheet.getRange(1, 1, 1, headerToUse.length).setFontWeight('bold').setBackground('#d0d0d0');
      }
    }

    var hm = (typeof createCanonicalHeaderMap_ === 'function')
      ? createCanonicalHeaderMap_(headerToUse)
      : createHeaderMap(headerToUse);

    // -------------------------------------------------------------------
    // 2) Prepare derived fields (existing logic preserved)
    // -------------------------------------------------------------------
    var c = (payload && payload.components) || {};
    var thresholds = (payload && payload.dynamicThresholds) || {
      even: 0,
      medium: (payload && typeof payload.threshold === 'number') ? payload.threshold : 0,
      strong: 0
    };

    // FORCE correct config version (your existing fix)
    var activeCfgVersion = _getActiveTier2ConfigVersion_(ss);
    var pv = payload && payload.configVersion != null ? String(payload.configVersion).trim() : '';
    var configVersionToLog = pv && pv !== 'elite_defaults' ? pv : activeCfgVersion;

    var rankHome = (payload && payload.rankings && payload.rankings.home != null) ? payload.rankings.home : '';
    var rankAway = (payload && payload.rankings && payload.rankings.away != null) ? payload.rankings.away : '';

    // Confidence normalization (accepts 63, "63", "63%")
    var confVal = '';
    if (payload && payload.confidence != null && payload.confidence !== '') {
      if (typeof payload.confidence === 'number') {
        confVal = payload.confidence;
      } else {
        var parsedConf = parseFloat(String(payload.confidence).replace('%', ''));
        confVal = isNaN(parsedConf) ? String(payload.confidence) : parsedConf;
      }
    }

    // Edge score normalization
    var edgeVal = '';
    if (payload && payload.edgeScore != null && payload.edgeScore !== '') {
      if (typeof payload.edgeScore === 'number') {
        edgeVal = payload.edgeScore;
      } else {
        var parsedEdge = parseFloat(String(payload.edgeScore));
        edgeVal = isNaN(parsedEdge) ? String(payload.edgeScore) : parsedEdge;
      }
    }

    // -------------------------------------------------------------------
    // 3) IDs + confidence bundle (FORENSIC_CORE_17)
    // -------------------------------------------------------------------
    var qLabel = 'Q' + String((payload && payload.quarter) != null ? String(payload.quarter).replace(/^Q/i, '') : '');
    var universalGameId = '';
    try {
      if (typeof buildUniversalGameID_ === 'function') {
        universalGameId = buildUniversalGameID_(payload.date, payload.homeTeam, payload.awayTeam);
      }
    } catch (eU) {
      Logger.log('[logTier2Prediction] buildUniversalGameID_: ' + eU.message);
    }
    if (!universalGameId && typeof standardizeDate_ === 'function') {
      var ymd2 = standardizeDate_(payload.date);
      var y2 = (ymd2 && ymd2.replace(/-/g, '')) || 'NODATE';
      var h2 = String((payload && payload.homeTeam) || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      var a2 = String((payload && payload.awayTeam) || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      universalGameId = y2 + '__' + h2 + '__' + a2;
    }
    var predictionRecordId = '';
    try {
      if (typeof buildPredictionRecordID_ === 'function' && universalGameId) {
        predictionRecordId = buildPredictionRecordID_(universalGameId, 'TIER2_MARGIN', qLabel || 'QX', configVersionToLog);
      }
    } catch (eP) {
      Logger.log('[logTier2Prediction] buildPredictionRecordID_: ' + eP.message);
    }

    var confB = (typeof normalizeConfidenceBundle_ === 'function')
      ? normalizeConfidenceBundle_(confVal)
      : { confidencePct: Number(confVal) || 0, confidenceProb: (Number(confVal) || 0) / 100, tierCode: 'WEAK', tierDisplay: '' };
    var predTxt = (payload && payload.predictionText) ? String(payload.predictionText) : '';
    var predU = predTxt.toUpperCase();
    var pickCode = 'UNK';
    if (predU.indexOf('EVEN') >= 0) pickCode = 'EVEN';
    else if (predU.charAt(0) === 'H') pickCode = 'HOME';
    else if (predU.charAt(0) === 'A') pickCode = 'AWAY';

    var stdDate = (typeof standardizeDate_ === 'function') ? standardizeDate_(payload && payload.date) : '';
    var ts = new Date();

    // -------------------------------------------------------------------
    // 4) Build row by header name (prevents column index drift)
    // -------------------------------------------------------------------
    var out = new Array(headerToUse.length).fill('');

    function setIf_(keyList, val) {
      for (var si = 0; si < keyList.length; si++) {
        var ck = canonK_(keyList[si]);
        if (hm[ck] !== undefined) {
          out[hm[ck]] = val;
          return;
        }
      }
    }

    // FORENSIC 17
    setIf_(['Prediction_Record_ID'], predictionRecordId);
    setIf_(['Universal_Game_ID'], universalGameId);
    setIf_(['Config_Version'], configVersionToLog);
    setIf_(['Timestamp_UTC'], ts);
    setIf_(['League'], (payload && payload.league) || '');
    setIf_(['Date'], stdDate || (payload && payload.date) || '');
    setIf_(['Home'], (payload && payload.homeTeam) || '');
    setIf_(['Away'], (payload && payload.awayTeam) || '');
    setIf_(['Market'], 'TIER2_MARGIN');
    setIf_(['Period'], qLabel || '');
    setIf_(['Pick_Code'], pickCode);
    setIf_(['Pick_Text'], predTxt);
    setIf_(['Confidence_Pct'], confB.confidencePct);
    setIf_(['Confidence_Prob'], confB.confidenceProb);
    setIf_(['Tier_Code'], confB.tierCode);
    setIf_(['EV'], '');
    setIf_(['Edge_Score'], edgeVal);

    // Legacy / extended
    setIf_(['Timestamp'], ts);
    setIf_(['Source_Sheet'], (payload && payload.sourceSheet) || '');
    setIf_(['Row_Index'], (payload && payload.rowIndex) || '');
    setIf_(['Game_ID'], (payload && payload.gameId) || '');
    setIf_(['Time'], (payload && payload.time) || '');
    setIf_(['Quarter'], (payload && payload.quarter) || '');
    setIf_(['Path'], (payload && payload.path) || '');
    setIf_(['Flip_Applied'], (payload && payload.flipApplied) ? 'TRUE' : 'FALSE');
    setIf_(['Flip_Key'], (payload && payload.flipKey) || '');
    setIf_(['Raw_Margin_PreFlip'], payload && payload.rawMargin);
    setIf_(['Final_Margin_PostFlip'], payload && payload.finalMargin);
    setIf_(['Abs_Margin'], payload && payload.absMargin);
    setIf_(['Threshold_Used'], payload && payload.threshold);
    setIf_(['Tier'], (payload && payload.tier) || '');
    setIf_(['Threshold_EVEN'], thresholds.even || 0);
    setIf_(['Threshold_MEDIUM'], thresholds.medium || 0);
    setIf_(['Threshold_STRONG'], thresholds.strong || 0);
    setIf_(['Base_Margin'], c.baseMargin || '');
    setIf_(['Momentum_Swing'], c.momentumSwing || '');
    setIf_(['Variance_Penalty'], c.variancePenalty || '');
    setIf_(['Avg_Variance'], c.avgVariance || '');
    setIf_(['Home_Momentum'], c.homeMomentum || '');
    setIf_(['Away_Momentum'], c.awayMomentum || '');
    setIf_(['Home_Variance'], c.homeVariance || '');
    setIf_(['Away_Variance'], c.awayVariance || '');
    setIf_(['Rank_Home'], rankHome);
    setIf_(['Rank_Away'], rankAway);
    setIf_(['Prediction_Text'], predTxt);
    setIf_(['Confidence'], confVal);

    logSheet.appendRow(out);

  } catch (e) {
    Logger.log('logTier2Prediction ERROR: ' + e.message);
  }
}

/**
 * =====================================================================
 * SCORING ENGINE: scoreT2Prediction_
 * =====================================================================
 */
function scoreT2Prediction_(predText, actualMargin, threshold) {
  if (!predText || typeof predText !== 'string') {
    return { result: 'ERROR', error: null, detail: 'Invalid prediction text' };
  }
  if (typeof actualMargin !== 'number' || isNaN(actualMargin)) {
    return { result: 'ERROR', error: null, detail: 'Invalid actual margin' };
  }
  if (typeof threshold !== 'number' || isNaN(threshold)) {
    threshold = 2.5;
  }

  const pred = predText.trim().toUpperCase();

  // EVEN Prediction
  if (pred === 'EVEN') {
    if (Math.abs(actualMargin) < threshold) {
      return {
        result: 'HIT',
        error: Math.abs(actualMargin),
        detail: 'Predicted EVEN, actual was close to zero (' + actualMargin.toFixed(1) + ')'
      };
    } else {
      return {
        result: 'MISS',
        error: Math.abs(actualMargin),
        detail: 'Predicted EVEN, but actual margin was ' + actualMargin.toFixed(1)
      };
    }
  }

  // Sided Prediction
  const sign = pred.charAt(0);
  if (sign !== 'H' && sign !== 'A') {
    return {
      result: 'ERROR',
      error: null,
      detail: 'Prediction format not recognized: ' + predText
    };
  }

  let predictedMarginAbs = 0;
  const match = pred.match(/([+-]?\s*\d+\.?\d*)/);
  if (match) {
    predictedMarginAbs = Math.abs(parseFloat(match[1]));
  }

  const predictedSide = sign === 'H' ? 1 : -1;
  let actualSide = 0;
  if (actualMargin > 0) actualSide = 1;
  else if (actualMargin < 0) actualSide = -1;

  // Tie game
  if (actualSide === 0) {
    if (predictedMarginAbs < threshold) {
      return {
        result: 'PUSH',
        error: predictedMarginAbs,
        detail: 'Game tied; predicted small margin (' + predictedMarginAbs.toFixed(1) + ')'
      };
    } else {
      return {
        result: 'MISS',
        error: predictedMarginAbs,
        detail: 'Game tied; predicted larger margin (' + sign + ' +' + predictedMarginAbs.toFixed(1) + ')'
      };
    }
  }

  // Standard case
  const error = Math.abs(predictedMarginAbs - Math.abs(actualMargin));

  if (predictedSide === actualSide) {
    return {
      result: 'HIT',
      error: error,
      detail: 'Predicted ' + sign + ' +' + predictedMarginAbs.toFixed(1) +
              ', actual margin ' + actualMargin.toFixed(1)
    };
  } else {
    return {
      result: 'MISS',
      error: error,
      detail: 'Predicted ' + sign + ' +' + predictedMarginAbs.toFixed(1) +
              ', actual margin ' + actualMargin.toFixed(1) + ' (wrong side)'
    };
  }
}

/**
 * =====================================================================
 * REPORT PIPELINE: buildTier2AccuracyReport  (PATCHED v3)
 * =====================================================================
 * v3 PATCHES:
 *   [A] Reads Tier column (EVEN / MEDIUM / STRONG) as primary pred source
 *   [B] Falls back to Threshold_EVEN when Threshold_Used is empty
 *   [C] Supports t2_q1‥t2_q4 result columns as additional quarter source
 *   [D] ±1-day fuzzy date matching to handle timezone drift
 *   [E] Diagnostic panel showing match debug info & sample keys
 *   [F] Team-name normalisation (trim + collapse whitespace)
 *   [G] Includes Confidence & Edge_Score in detail output
 *   — Retains all v2 fixes (dedup, #NUM! handling, inline scorer)
 * =====================================================================
 */
function buildTier2AccuracyReport(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  /* ── Locate sheets ─────────────────────────────────────────── */
  var logSheet = getSheetInsensitive(ss, 'Tier2_Log');
  if (!logSheet) {
    SpreadsheetApp.getUi().alert('No "Tier2_Log" sheet found. Run Tier 2 predictions first.');
    return;
  }

  var resultsSheet = getSheetInsensitive(ss, 'ResultsClean')
                  || getSheetInsensitive(ss, 'Clean');
  if (!resultsSheet) {
    SpreadsheetApp.getUi().alert('No "ResultsClean" or "Clean" sheet found.');
    return;
  }

  var resultsData = resultsSheet.getDataRange().getValues();
  if (resultsData.length < 2) {
    SpreadsheetApp.getUi().alert('Results sheet has no data rows.');
    return;
  }

  var resHeader = resultsData[0];
  var resMap    = createHeaderMap(resHeader);

  if (resMap.home === undefined || resMap.away === undefined || resMap.date === undefined) {
    SpreadsheetApp.getUi().alert('Results sheet missing "Home" / "Away" / "Date" headers.');
    return;
  }

  /* ── Detect quarter-column format ──────────────────────────── */
  var useSeparateCols = (resMap.q1h !== undefined && resMap.q1a !== undefined);
  var useConcatCols   = (resMap.q1  !== undefined);
  var useT2Cols       = (resMap.t2_q1 !== undefined || resMap.t2q1 !== undefined);   // [PATCH C]

  Logger.log('Quarter format ► Separate=' + useSeparateCols +
             '  Concat=' + useConcatCols +
             '  T2=' + useT2Cols);

  if (!useSeparateCols && !useConcatCols && !useT2Cols) {
    SpreadsheetApp.getUi().alert(
      'ResultsClean has no quarter columns.\n\n' +
      'Expected Q1H/Q1A, Q1 (concat), or t2-q1.\n' +
      'Found: ' + resHeader.join(', ')
    );
    return;
  }

  /* ================================================================
     HELPER FUNCTIONS
     ================================================================ */

  /** Parse "25 - 16" → [25, 16] */
  function parseConcatenatedScore_(scoreStr) {
    if (!scoreStr) return null;
    var cleaned = String(scoreStr).trim();
    if (!cleaned || cleaned.toLowerCase() === 'n/a' || cleaned === '-') return null;
    var delimiters = [' - ', ' – ', '-', '–', ':'];
    for (var d = 0; d < delimiters.length; d++) {
      if (cleaned.indexOf(delimiters[d]) !== -1) {
        var parts = cleaned.split(delimiters[d]);
        if (parts.length >= 2) {
          var h = parseInt(parts[0].trim(), 10);
          var a = parseInt(parts[1].trim(), 10);
          if (!isNaN(h) && !isNaN(a)) return [h, a];
        }
      }
    }
    return null;
  }

  /** Normalise a date value → "YYYY-MM-DD" (local TZ) */
  function toDateKey_(val) {
    if (!val) return '';
    var d;
    if (val instanceof Date) {
      d = val;
    } else {
      var s = String(val).trim();
      if (!s) return '';
      d = new Date(s);
    }
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
           ('0' + d.getDate()).slice(-2);
  }

  /** [PATCH D] Return an array of date keys: [exact, −1 day, +1 day] */
  function toDateKeys_(val) {
    if (!val) return [];
    var d;
    if (val instanceof Date) {
      d = new Date(val.getTime());
    } else {
      var s = String(val).trim();
      if (!s) return [];
      d = new Date(s);
    }
    if (isNaN(d.getTime())) return [];

    var keys = [];
    for (var offset = -1; offset <= 1; offset++) {
      var dd = new Date(d.getTime() + offset * 86400000);
      keys.push(dd.getFullYear() + '-' +
                ('0' + (dd.getMonth() + 1)).slice(-2) + '-' +
                ('0' + dd.getDate()).slice(-2));
    }
    return keys; // [yesterday, today, tomorrow]
  }

  /** Safe float parse — returns NaN for #NUM!, #REF!, blanks */
  function safeParseFloat_(val) {
    if (val === null || val === undefined) return NaN;
    if (typeof val === 'number') return val;
    var s = String(val).trim();
    if (s === '' || s.charAt(0) === '#') return NaN;
    return parseFloat(s);
  }

  /** Check for spreadsheet error values */
  function isSheetError_(val) {
    if (val === null || val === undefined) return false;
    return String(val).trim().charAt(0) === '#';
  }

  /** [PATCH F] Normalise team name for matching */
  function normTeam_(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /* ================================================================
     [FIX #1 / retained] INLINE scoreT2Prediction_
     ================================================================ */
  function scoreT2Prediction_(predSide, predMargin, actualMargin, threshold) {
    if (!predSide || predSide === 'UNKNOWN') {
      return { result: 'ERROR', error: null, detail: 'Invalid/unknown prediction side' };
    }

    var actualAbs  = Math.abs(actualMargin);
    var actualSide = actualMargin > 0 ? 'H' : (actualMargin < 0 ? 'A' : 'EVEN');

    // EVEN prediction
    if (predSide === 'EVEN') {
      if (actualAbs <= threshold) {
        return { result: 'HIT',  error: actualAbs,
                 detail: 'EVEN correct (actual margin ' + actualMargin +
                         ' within threshold ' + threshold + ')' };
      } else {
        return { result: 'MISS', error: actualAbs,
                 detail: 'EVEN wrong (actual margin ' + actualMargin +
                         ' exceeds threshold ' + threshold + ')' };
      }
    }

    // Side prediction (H or A)
    if (actualMargin === 0) {
      return { result: 'PUSH', error: 0, detail: 'Actual margin is 0 (push)' };
    }

    if (predSide === actualSide) {
      return { result: 'HIT',  error: Math.abs(predMargin - actualAbs),
               detail: 'Predicted ' + predSide + ', actual ' + actualSide + ' by ' + actualAbs };
    } else {
      return { result: 'MISS', error: Math.abs(predMargin + actualAbs),
               detail: 'Predicted ' + predSide + ', actual ' + actualSide + ' by ' + actualAbs };
    }
  }

  /* ================================================================
     BUILD RESULTS LOOKUP   [PATCH D – multi-key]
     ================================================================ */
  var resultMap  = {};   // dateKey|home|away → row
  var resultKeys = [];   // for diagnostics

  for (var i = 1; i < resultsData.length; i++) {
    var row  = resultsData[i];
    var home = normTeam_(row[resMap.home]);
    var away = normTeam_(row[resMap.away]);
    if (!home || !away) continue;

    var dateKey = toDateKey_(row[resMap.date]);
    if (!dateKey) continue;

    var key = dateKey + '|' + home + '|' + away;
    resultMap[key] = row;
    resultKeys.push(key);
  }

  Logger.log('Result map keys (' + resultKeys.length + '): ' +
             resultKeys.slice(0, 5).join(' ; '));

  /* ================================================================
     READ & DEDUPLICATE LOG
     ================================================================ */
  var logData = logSheet.getDataRange().getValues();
  if (logData.length < 2) {
    SpreadsheetApp.getUi().alert('"Tier2_Log" has no prediction rows to evaluate.');
    return;
  }

  var logHeader = logData[0];
  var logMap    = createHeaderMap(logHeader);

  Logger.log('Log rows: ' + (logData.length - 1));
  Logger.log('Log header map keys: ' + Object.keys(logMap).join(', '));

  // Dedup: keep latest entry per (date|home|away|quarter)
  var deduped = {};
  for (var i = 1; i < logData.length; i++) {
    var row      = logData[i];
    var homeTeam = normTeam_(row[logMap.home]);
    var awayTeam = normTeam_(row[logMap.away]);
    var quarter  = String(row[logMap.quarter] || '').trim().toUpperCase();
    var dateKey  = toDateKey_(row[logMap.date]);

    var dedupKey = dateKey + '|' + homeTeam + '|' + awayTeam + '|' + quarter;
    deduped[dedupKey] = { row: row, index: i };
  }

  var dedupedEntries = [];
  for (var k in deduped) dedupedEntries.push(deduped[k]);
  dedupedEntries.sort(function(a, b) { return a.index - b.index; });

  Logger.log('Dedup: ' + (logData.length - 1) + ' raw → ' + dedupedEntries.length + ' unique');

  /* ================================================================
     PREPARE OUTPUT SHEET
     ================================================================ */
  var accSheetName = 'Tier2_Accuracy';
  var accSheet = getSheetInsensitive(ss, accSheetName);
  if (!accSheet) accSheet = ss.insertSheet(accSheetName);
  accSheet.clear();

  var summary = {
    totalRaw: logData.length - 1,
    totalUnique: dedupedEntries.length,
    withResult: 0,
    sidePreds: 0, sideHits: 0, sideMisses: 0, pushes: 0,
    evenPreds: 0, evenHits: 0, evenMisses: 0,
    errors: 0, noResult: 0, noQData: 0,
    derivedCount: 0, tierDerived: 0, marginDerived: 0,
    dateMatchExact: 0, dateMatchFuzzy: 0
  };

  var detailHeader = [
    'Date', 'League', 'Home', 'Away', 'Quarter',
    'Config_Version', 'Path', 'Flip_Applied',
    'Tier', 'Prediction_Text', 'Pred_Side', 'Pred_Source',
    'Threshold_Used', 'Threshold_EVEN',
    'Raw_Margin_PreFlip', 'Final_Margin_PostFlip', 'Abs_Margin',
    'Actual_Q_Home', 'Actual_Q_Away', 'Actual_Margin', 'Actual_Side',
    'Result', 'Error', 'Detail',
    'Confidence', 'Edge_Score',
    'Rank_Home', 'Rank_Away', 'Source_Sheet',
    'Match_Type', 'Log_Row', 'Log_Timestamp'
  ];
  var detailRows = [];

  /* ================================================================
     PROCESS EACH UNIQUE PREDICTION
     ================================================================ */
  for (var di = 0; di < dedupedEntries.length; di++) {
    var entry   = dedupedEntries[di];
    var row     = entry.row;
    var origIdx = entry.index;

    /* ── Read basic fields ─────────────────────────────────── */
    var dateVal     = row[logMap.date] || '';
    var homeTeam    = String(row[logMap.home] || '').trim();
    var awayTeam    = String(row[logMap.away] || '').trim();
    var quarterRaw  = String(row[logMap.quarter] || '').trim().toUpperCase();
    var league      = logMap.league !== undefined         ? row[logMap.league] : '';
    var configVer   = logMap.config_version !== undefined  ? row[logMap.config_version] : '';
    var path        = logMap.path !== undefined            ? row[logMap.path] : '';
    var flipVal     = logMap.flip_applied !== undefined    ? row[logMap.flip_applied] : '';
    var flipApplied = String(flipVal).toUpperCase() === 'TRUE' || flipVal === true;
    var rankHome    = logMap.rank_home !== undefined       ? row[logMap.rank_home] : '';
    var rankAway    = logMap.rank_away !== undefined       ? row[logMap.rank_away] : '';
    var sourceSheet = logMap.source_sheet !== undefined    ? row[logMap.source_sheet] : '';
    var logTimestamp = logMap.timestamp !== undefined      ? row[logMap.timestamp] : '';
    var confidence  = logMap.confidence !== undefined      ? row[logMap.confidence] : '';
    var edgeScore   = logMap.edge_score !== undefined      ? row[logMap.edge_score] : '';

    /* ── [PATCH A] Read Tier column ──────────────────────── */
    var tierVal = logMap.tier !== undefined
                ? String(row[logMap.tier] || '').trim().toUpperCase() : '';

    /* ── [PATCH B] Read margins & thresholds safely ──────── */
    var rawMarginVal   = logMap.raw_margin_preflip !== undefined
                       ? row[logMap.raw_margin_preflip] : '';
    var finalMarginVal = logMap.final_margin_postflip !== undefined
                       ? row[logMap.final_margin_postflip] : '';
    var absMarginVal   = logMap.abs_margin !== undefined
                       ? row[logMap.abs_margin] : '';

    var rawMarginDisplay = isSheetError_(rawMarginVal) ? 'ERR' : rawMarginVal;
    var finalMargin      = safeParseFloat_(finalMarginVal);
    var absMargin        = safeParseFloat_(absMarginVal);

    // Threshold cascade: Threshold_Used → Threshold_EVEN → 2.5
    var thresholdUsed = logMap.threshold_used !== undefined
                      ? safeParseFloat_(row[logMap.threshold_used]) : NaN;

    var thresholdEven = logMap.threshold_even !== undefined          // [PATCH B]
                      ? safeParseFloat_(row[logMap.threshold_even]) : NaN;

    if (isNaN(thresholdUsed)) {
      thresholdUsed = !isNaN(thresholdEven) ? thresholdEven : 2.5;
    }

    /* ══════════════════════════════════════════════════════════
       DETERMINE PREDICTION SIDE
       Priority:  1) Prediction_Text  2) Tier col  3) Final_Margin
       ══════════════════════════════════════════════════════════ */
    var predSide   = 'UNKNOWN';
    var predText   = '';
    var predSource = '';

    // ── Source 1: Prediction_Text ─────────────────────────────
    var predTextRaw = logMap.prediction_text !== undefined
                    ? String(row[logMap.prediction_text] || '') : '';

    if (predTextRaw && !isSheetError_(predTextRaw) && predTextRaw.trim() !== '') {
      predText = predTextRaw.trim();
      var pu   = predText.toUpperCase();
      if (pu.indexOf('EVEN') !== -1)                            predSide = 'EVEN';
      else if (pu.indexOf('HOME') !== -1 || pu.charAt(0) === 'H') predSide = 'H';
      else if (pu.indexOf('AWAY') !== -1 || pu.charAt(0) === 'A') predSide = 'A';
      if (predSide !== 'UNKNOWN') predSource = 'log_text';
    }

    // ── Source 2: Tier column  [PATCH A] ─────────────────────
    if (predSide === 'UNKNOWN' && tierVal) {
      if (tierVal === 'EVEN') {
        predSide   = 'EVEN';
        predText   = 'EVEN (from Tier column)';
        predSource = 'tier_column';
        summary.tierDerived++;
        summary.derivedCount++;
      } else if (tierVal === 'MEDIUM' || tierVal === 'STRONG') {
        // Need margin sign to know H vs A
        if (!isNaN(finalMargin)) {
          if (finalMargin > 0)      predSide = 'H';
          else if (finalMargin < 0) predSide = 'A';
          else                      predSide = 'EVEN';

          predText   = predSide + ' (' + tierVal + ', margin=' +
                       finalMargin.toFixed(2) + ')';
          predSource = 'tier_column+margin';
          summary.tierDerived++;
          summary.derivedCount++;
        }
      }
    }

    // ── Source 3: Derive from Final_Margin ────────────────────
    if (predSide === 'UNKNOWN' && !isNaN(finalMargin)) {
      if (Math.abs(finalMargin) <= thresholdUsed) {
        predSide = 'EVEN';
        predText = 'EVEN (margin=' + finalMargin.toFixed(2) +
                   ', thresh=' + thresholdUsed.toFixed(2) + ')';
      } else if (finalMargin > 0) {
        predSide = 'H';
        predText = 'H by ' + Math.abs(finalMargin).toFixed(2) + ' (derived)';
      } else {
        predSide = 'A';
        predText = 'A by ' + Math.abs(finalMargin).toFixed(2) + ' (derived)';
      }
      predSource = 'derived_margin';
      summary.marginDerived++;
      summary.derivedCount++;
    }

    // ── Source 4: Derive from Abs_Margin + flip ──────────────
    if (predSide === 'UNKNOWN' && !isNaN(absMargin)) {
      if (absMargin <= thresholdUsed) {
        predSide   = 'EVEN';
        predText   = 'EVEN (abs=' + absMargin.toFixed(2) + ')';
        predSource = 'derived_abs';
        summary.derivedCount++;
      } else {
        var rawParsed = safeParseFloat_(rawMarginVal);
        if (!isNaN(rawParsed)) {
          var effMargin = flipApplied ? -rawParsed : rawParsed;
          predSide   = effMargin > 0 ? 'H' : 'A';
          predText   = predSide + ' by ' + absMargin.toFixed(2) + ' (raw+flip)';
          predSource = 'derived_abs+flip';
          summary.derivedCount++;
        }
      }
    }

    /* ══════════════════════════════════════════════════════════
       LOOK UP ACTUAL RESULT   [PATCH D – fuzzy date]
       ══════════════════════════════════════════════════════════ */
    var actualHomeScore = '';
    var actualAwayScore = '';
    var actualMargin    = null;
    var actualSide      = '';
    var resultLabel     = '';
    var errorVal        = '';
    var detailText      = '';
    var matchType       = '';

    var homeNorm = normTeam_(homeTeam);
    var awayNorm = normTeam_(awayTeam);
    var dateKeys = toDateKeys_(dateVal);        // [yesterday, today, tomorrow]

    var resRow = undefined;
    if (homeNorm && awayNorm && dateKeys.length > 0) {
      // Try exact date first (index 1 = today)
      var exactKey = dateKeys[1] + '|' + homeNorm + '|' + awayNorm;
      if (resultMap[exactKey]) {
        resRow    = resultMap[exactKey];
        matchType = 'exact';
        summary.dateMatchExact++;
      } else {
        // Try ±1 day  [PATCH D]
        for (var dki = 0; dki < dateKeys.length; dki++) {
          if (dki === 1) continue; // skip exact, already tried
          var fuzzyKey = dateKeys[dki] + '|' + homeNorm + '|' + awayNorm;
          if (resultMap[fuzzyKey]) {
            resRow    = resultMap[fuzzyKey];
            matchType = 'fuzzy_' + (dki === 0 ? '-1d' : '+1d');
            summary.dateMatchFuzzy++;
            break;
          }
        }
      }
    }

    if (!resRow) {
      resultLabel = 'NO_RESULT';
      detailText  = 'Game not found (tried keys: ' +
                    dateKeys.map(function(dk) {
                      return dk + '|' + homeNorm + '|' + awayNorm;
                    }).join(' ; ') + ')';
      summary.noResult++;
    } else {
      summary.withResult++;

      var qNum = parseInt(quarterRaw.replace('Q', ''), 10);
      if (isNaN(qNum) || qNum < 1 || qNum > 4) {
        resultLabel = 'UNKNOWN_Q';
        detailText  = 'Invalid quarter: ' + quarterRaw;
      } else {
        /* ── Extract actual quarter scores ──────────────────── */
        var qHomeScore = null;
        var qAwayScore = null;

        // Try 1: Separate columns (Q1H / Q1A)
        if (useSeparateCols) {
          var qhKey = 'q' + qNum + 'h';
          var qaKey = 'q' + qNum + 'a';
          if (resMap[qhKey] !== undefined && resMap[qaKey] !== undefined) {
            qHomeScore = parseFloat(resRow[resMap[qhKey]]);
            qAwayScore = parseFloat(resRow[resMap[qaKey]]);
          }
        }

        // Try 2: Concatenated columns (Q1 = "25 - 16")
        if ((qHomeScore === null || isNaN(qHomeScore)) && useConcatCols) {
          var qKey = 'q' + qNum;
          if (resMap[qKey] !== undefined) {
            var parsed = parseConcatenatedScore_(resRow[resMap[qKey]]);
            if (parsed) {
              qHomeScore = parsed[0];
              qAwayScore = parsed[1];
            }
          }
        }

        // Try 3: t2-q columns  [PATCH C]
        if ((qHomeScore === null || isNaN(qHomeScore)) && useT2Cols) {
          var t2Key = 't2_q' + qNum;
          var t2KeyAlt = 't2q' + qNum;
          var t2Idx = resMap[t2Key] !== undefined ? resMap[t2Key]
                    : (resMap[t2KeyAlt] !== undefined ? resMap[t2KeyAlt] : undefined);
          if (t2Idx !== undefined) {
            var parsed2 = parseConcatenatedScore_(resRow[t2Idx]);
            if (parsed2) {
              qHomeScore = parsed2[0];
              qAwayScore = parsed2[1];
            }
          }
        }

        if (qHomeScore === null || qAwayScore === null ||
            isNaN(qHomeScore) || isNaN(qAwayScore)) {
          resultLabel = 'NO_Q_DATA';
          detailText  = 'Could not parse Q' + qNum + ' scores from results';
          summary.noQData++;
        } else {
          actualHomeScore = qHomeScore;
          actualAwayScore = qAwayScore;
          actualMargin    = qHomeScore - qAwayScore;
          actualSide      = actualMargin > 0 ? 'H'
                          : (actualMargin < 0 ? 'A' : 'EVEN');

          /* ── SCORE the prediction ─────────────────────────── */
          if (predSide === 'UNKNOWN') {
            resultLabel = 'ERROR';
            detailText  = 'Could not determine prediction side';
            summary.errors++;
          } else {
            var predMarginAbs = !isNaN(absMargin) ? absMargin
                              : (!isNaN(finalMargin) ? Math.abs(finalMargin) : 0);

            var scoreResult = scoreT2Prediction_(
              predSide, predMarginAbs, actualMargin, thresholdUsed
            );
            resultLabel = scoreResult.result;
            errorVal    = scoreResult.error !== null
                        ? scoreResult.error.toFixed(2) : '';
            detailText  = scoreResult.detail;

            // Tally
            if (predSide === 'EVEN') {
              summary.evenPreds++;
              if (resultLabel === 'HIT')       summary.evenHits++;
              else if (resultLabel === 'MISS') summary.evenMisses++;
            } else {
              summary.sidePreds++;
              if (resultLabel === 'HIT')       summary.sideHits++;
              else if (resultLabel === 'MISS') summary.sideMisses++;
              else if (resultLabel === 'PUSH') summary.pushes++;
            }
            if (resultLabel === 'ERROR') summary.errors++;
          }
        }
      }
    }

    /* ── Build detail row ─────────────────────────────────── */
    detailRows.push([
      dateVal, league, homeTeam, awayTeam, quarterRaw,
      configVer, path, flipApplied ? 'TRUE' : 'FALSE',
      tierVal, predText, predSide, predSource,
      thresholdUsed, isNaN(thresholdEven) ? '' : thresholdEven,
      rawMarginDisplay,
      isNaN(finalMargin) ? 'ERR' : finalMargin,
      isNaN(absMargin)   ? 'ERR' : absMargin,
      actualHomeScore, actualAwayScore, actualMargin, actualSide,
      resultLabel, errorVal, detailText,
      confidence, edgeScore,
      rankHome, rankAway, sourceSheet,
      matchType, origIdx + 1, logTimestamp
    ]);
  }

  /* ================================================================
     WRITE SUMMARY SECTION
     ================================================================ */
  var sideDenom  = summary.sideHits + summary.sideMisses;
  var sideHitPct = sideDenom > 0
                 ? ((summary.sideHits / sideDenom) * 100).toFixed(1) + '%' : 'N/A';

  var evenDenom  = summary.evenHits + summary.evenMisses;
  var evenHitPct = evenDenom > 0
                 ? ((summary.evenHits / evenDenom) * 100).toFixed(1) + '%' : 'N/A';

  var totalScored = sideDenom + summary.pushes + evenDenom;
  var totalHits   = summary.sideHits + summary.evenHits;
  var totalHitPct = (sideDenom + evenDenom) > 0
                  ? ((totalHits / (sideDenom + evenDenom)) * 100).toFixed(1) + '%'
                  : 'N/A';

  var summaryData = [
    ['TIER 2 ACCURACY REPORT', 'Generated: ' + new Date().toLocaleString()],
    ['', ''],
    ['Metric', 'Value'],
    ['Raw Log Rows', summary.totalRaw],
    ['Unique Predictions (deduplicated)', summary.totalUnique],
    ['', ''],
    ['── PREDICTION SOURCES ──', ''],
    ['  From Prediction_Text', summary.totalUnique - summary.derivedCount],
    ['  From Tier Column', summary.tierDerived],
    ['  From Margin Derivation', summary.marginDerived],
    ['  Total Derived', summary.derivedCount],
    ['', ''],
    ['── MATCH RESULTS ──', ''],
    ['  With Result (matched)', summary.withResult],
    ['  Exact Date Match', summary.dateMatchExact],
    ['  Fuzzy Date Match (±1d)', summary.dateMatchFuzzy],
    ['  No Result Found', summary.noResult],
    ['  No Quarter Data', summary.noQData],
    ['', ''],
    ['── OVERALL ──', ''],
    ['  Total Scored', totalScored],
    ['  Total Hits', totalHits],
    ['  Overall Hit %', totalHitPct],
    ['', ''],
    ['── SIDE (H/A) ──', ''],
    ['  Side Predictions', summary.sidePreds],
    ['  Side Hits', summary.sideHits],
    ['  Side Misses', summary.sideMisses],
    ['  Side Pushes', summary.pushes],
    ['  Side Hit % (excl pushes)', sideHitPct],
    ['', ''],
    ['── EVEN ──', ''],
    ['  EVEN Predictions', summary.evenPreds],
    ['  EVEN Hits', summary.evenHits],
    ['  EVEN Misses', summary.evenMisses],
    ['  EVEN Hit %', evenHitPct],
    ['', ''],
    ['Errors', summary.errors],
    ['', ''],
    ['── DIAGNOSTICS ──', ''],                                  // [PATCH E]
    ['  Result Map Keys (sample)',
      resultKeys.slice(0, 5).join('\n')],
    ['  Log Sample Key',
      dedupedEntries.length > 0
        ? (function() {
            var r = dedupedEntries[0].row;
            return toDateKey_(r[logMap.date]) + '|' +
                   normTeam_(r[logMap.home]) + '|' +
                   normTeam_(r[logMap.away]);
          })()
        : 'N/A']
  ];

  accSheet.getRange(1, 1, summaryData.length, 2).setValues(summaryData);
  accSheet.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(12);
  accSheet.getRange(3, 1, 1, 2).setFontWeight('bold').setBackground('#d9d9d9');

  // Bold section headers
  for (var si = 0; si < summaryData.length; si++) {
    if (String(summaryData[si][0]).indexOf('──') !== -1) {
      accSheet.getRange(si + 1, 1).setFontWeight('bold')
                                   .setFontColor('#1a73e8');
    }
  }

  /* ================================================================
     WRITE DETAIL SECTION
     ================================================================ */
  var startRowDetail = summaryData.length + 2;

  accSheet.getRange(startRowDetail, 1, 1, detailHeader.length)
          .setValues([detailHeader])
          .setFontWeight('bold')
          .setBackground('#d9d9d9');

  if (detailRows.length > 0) {
    accSheet.getRange(startRowDetail + 1, 1,
                      detailRows.length, detailHeader.length)
            .setValues(detailRows);

    // Color-code Result column
    var resultColIdx = detailHeader.indexOf('Result') + 1;
    for (var r = 0; r < detailRows.length; r++) {
      var cell = accSheet.getRange(startRowDetail + 1 + r, resultColIdx);
      var val  = detailRows[r][resultColIdx - 1];
      if (val === 'HIT')        cell.setBackground('#c6efce').setFontColor('#006100');
      else if (val === 'MISS')  cell.setBackground('#ffc7ce').setFontColor('#9c0006');
      else if (val === 'PUSH')  cell.setBackground('#ffeb9c').setFontColor('#9c6500');
      else if (val === 'ERROR') cell.setBackground('#ff9999').setFontColor('#660000');
      else if (val === 'NO_RESULT' || val === 'NO_Q_DATA')
                                cell.setBackground('#f0f0f0').setFontColor('#999999');
    }

    // Color-code Pred_Source column
    var srcColIdx = detailHeader.indexOf('Pred_Source') + 1;
    for (var r = 0; r < detailRows.length; r++) {
      var cell = accSheet.getRange(startRowDetail + 1 + r, srcColIdx);
      var val  = detailRows[r][srcColIdx - 1];
      if (val === 'tier_column' || val === 'tier_column+margin')
        cell.setBackground('#e8f0fe').setFontColor('#1a73e8');
      else if (val.indexOf('derived') !== -1)
        cell.setBackground('#fef7e0').setFontColor('#e37400');
    }
  } else {
    accSheet.getRange(startRowDetail + 1, 1)
            .setValue('No Tier 2 predictions to report.');
  }

  accSheet.autoResizeColumns(1, detailHeader.length);
  accSheet.setFrozenRows(startRowDetail);

  /* ── Final logging ─────────────────────────────────────────── */
  Logger.log('buildTier2AccuracyReport v3: Complete. ' +
    summary.totalRaw + ' raw → ' + summary.totalUnique + ' unique. ' +
    'Matched: ' + summary.withResult + ' (exact: ' + summary.dateMatchExact +
    ', fuzzy: ' + summary.dateMatchFuzzy + '). ' +
    'Derived: ' + summary.derivedCount +
    ' (tier: ' + summary.tierDerived + ', margin: ' + summary.marginDerived + ').');

  SpreadsheetApp.getUi().alert(
    '✅ Tier 2 Accuracy Report (v3)\n\n' +
    '📊 Unique: ' + summary.totalUnique +
      ' (from ' + summary.totalRaw + ' raw)\n' +
    '🔗 Matched: ' + summary.withResult +
      ' (exact: ' + summary.dateMatchExact +
      ', fuzzy±1d: ' + summary.dateMatchFuzzy + ')\n' +
    '🔧 Derived: ' + summary.derivedCount +
      ' (tier: ' + summary.tierDerived +
      ', margin: ' + summary.marginDerived + ')\n\n' +
    '── Overall ──\n' +
    'Hit Rate: ' + totalHitPct +
      ' (' + totalHits + '/' + (sideDenom + evenDenom) + ')\n\n' +
    '── Side (H/A) ──\n' +
    'Hit Rate: ' + sideHitPct +
      ' (' + summary.sideHits + '/' + sideDenom + ')\n' +
    'Pushes: ' + summary.pushes + '\n\n' +
    '── EVEN ──\n' +
    'Hit Rate: ' + evenHitPct +
      ' (' + summary.evenHits + '/' + evenDenom + ')\n\n' +
    'No Result: ' + summary.noResult +
    '  |  No Q Data: ' + summary.noQData +
    '  |  Errors: ' + summary.errors + '\n\n' +
    'See "Tier2_Accuracy" sheet for details + diagnostics.'
  );
}


/**
 * Global cache for evaluation results (used by proposal diversity logic)
 */
var t2_lastEvalResults = null;

/**
 * Standings cache to prevent repeated sheet reads
 */
var T2_STANDINGS_CACHE_ = T2_STANDINGS_CACHE_ || { 
  builtAt: 0, 
  map: null, 
  ssId: null 
};

/**
 * Tuner log configuration
 */
var T2_TUNER_LOG_SHEET = 'T2_Tuner_Log';
var T2_TUNER_LOG_STATE = T2_TUNER_LOG_STATE || { 
  used: 0, 
  max: 500 
};


/**
 * Logs to both Logger and a persistent sheet (T2_Tuner_Log)
 * Allows copying logs even if UI hangs
 * 
 * @param {Spreadsheet} ss - Spreadsheet instance
 * @param {string} runId - Unique identifier for this tuning run
 * @param {string} msg - Message to log
 */
function t2_log_(ss, runId, msg) {
  Logger.log('[T2] ' + msg);

  if (T2_TUNER_LOG_STATE.used >= T2_TUNER_LOG_STATE.max) return;

  try {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    var sh = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, T2_TUNER_LOG_SHEET)
      : ss.getSheetByName(T2_TUNER_LOG_SHEET);

    if (!sh) {
      sh = ss.insertSheet(T2_TUNER_LOG_SHEET);
    }
    if (sh.getLastRow() === 0) {
      sh.appendRow(['timestamp', 'run_id', 'message']);
    }

    sh.appendRow([new Date(), runId || '', String(msg)]);
    T2_TUNER_LOG_STATE.used++;
  } catch (e) {
    // Ignore sheet errors; Logger already has the message
  }
}


/**
 * Loads standings once and caches for 10 minutes
 * CRITICAL: Prevents repeated sheet reads inside evaluation loops
 * 
 * @param {Spreadsheet} ss - Spreadsheet instance
 * @returns {Object} Map of team -> ranking data
 */
function t2_loadStandingsAsRankingsCached_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ssId = (ss && ss.getId) ? ss.getId() : 'unknown';
  var now = Date.now();

  // Return cached if valid (10 minute window)
  if (T2_STANDINGS_CACHE_.ssId === ssId &&
      T2_STANDINGS_CACHE_.map &&
      (now - T2_STANDINGS_CACHE_.builtAt) < 10 * 60 * 1000) {
    return T2_STANDINGS_CACHE_.map;
  }

  var map = {};
  try {
    if (typeof loadStandingsAsRankings_ === 'function') {
      map = loadStandingsAsRankings_(ss) || {};
    }
  } catch (e) {
    Logger.log('[StandingsCache] Failed to load: ' + e.message);
    map = {};
  }

  T2_STANDINGS_CACHE_.ssId = ssId;
  T2_STANDINGS_CACHE_.builtAt = now;
  T2_STANDINGS_CACHE_.map = map;

  return map;
}



/**
 * Reads a key-value sheet into a map
 * Local fallback if _readKeyValueSheetMap_ doesn't exist
 * 
 * @param {Sheet} sheet - Sheet with key in column A, value in column B
 * @returns {Object} Lowercase key -> value map
 */
function t2_readKeyValueSheetMapLocal_(sheet) {
  var map = {};
  if (!sheet) return map;
  
  var values = sheet.getDataRange().getValues();
  for (var r = 0; r < values.length; r++) {
    var key = String(values[r][0] || '').trim();
    if (!key) continue;
    if (key.indexOf('---') === 0) continue;
    map[key.toLowerCase()] = values[r][1];
  }
  return map;
}


/**
 * Local number coercion fallback (uses global _coerceNumber_ if available).
 */
function t2_localCoerceNumber_(v, fallback) {
  if (typeof _coerceNumber_ === 'function') return _coerceNumber_(v, fallback);
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (v instanceof Date) {
    var base = Date.UTC(1899, 11, 30, 0, 0, 0);
    var serial = (v.getTime() - base) / 86400000;
    return isNaN(serial) ? fallback : serial;
  }
  var s = String(v == null ? '' : v).trim().replace(',', '.');
  if (!s) return fallback;
  var n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

/**
 * Local boolean coercion fallback (uses global _coerceBool_ if available).
 */
function t2_localCoerceBool_(v, fallback) {
  if (typeof _coerceBool_ === 'function') return _coerceBool_(v, fallback);
  if (v === true || v === false) return v;
  var s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'TRUE' || s === 'YES' || s === '1') return true;
  if (s === 'FALSE' || s === 'NO' || s === '0') return false;
  return fallback === undefined ? false : fallback;
}

/**
 * Banner logs + starting toast.
 */
function t2_logTunerBanner_(ss) {
  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('    ELITE TIER 2 CONFIG TUNING v5.1 (FULLY PATCHED)');
  Logger.log('═══════════════════════════════════════════════════════════════════');
  ss.toast('Elite tuning: Bayesian optimization starting...', 'Ma Golide Elite', 30);
}

/**
 * Error log + error alert.
 */
function t2_handleTuneTier2Error_(ui, e) {
  Logger.log('!!! ERROR in tuneTier2Config v5.1: ' + e.message + '\n' + e.stack);
  ui.alert('Elite Tuning Error', e.message, ui.ButtonSet.OK);
}


/**
 * Loads current Tier 2 config and returns tuning context
 * PATCHED: Fixes camelCase vs snake_case key mismatch for momentum & variance
 * PATCHED: All core params now use multi-key lookup with cfgMap fallback
 * 
 * @param {Spreadsheet} ss - Spreadsheet instance
 * @returns {Object} Context object with currentConfig, cfgMap, and parsed values
 */
function t2_loadTier2TuningContext_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  if (typeof loadTier2Config !== 'function') {
    throw new Error('t2_loadTier2TuningContext_: loadTier2Config(ss) not found.');
  }
  if (typeof getSheetInsensitive !== 'function') {
    throw new Error('t2_loadTier2TuningContext_: getSheetInsensitive(ss,name) not found.');
  }

  var currentConfig = loadTier2Config(ss) || {};
  Logger.log('[Tuner] Current config_version: ' +
             (currentConfig.config_version || currentConfig.version || 'elite_defaults'));

  var cfgSheet = getSheetInsensitive(ss, 'Config_Tier2');
  if (!cfgSheet) throw new Error('Config_Tier2 sheet not found.');

  var cfgMap = (typeof _readKeyValueSheetMap_ === 'function')
    ? _readKeyValueSheetMap_(cfgSheet)
    : t2_readKeyValueSheetMapLocal_(cfgSheet);

  // ── Type conversion helpers ──
  function num_(v, fb) { 
    v = Number(v); 
    return isFinite(v) ? v : fb; 
  }
  function bool_(v, fb) {
    if (v === true || v === false) return v;
    var s = String(v == null ? '' : v).trim().toUpperCase();
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    return !!fb;
  }
  function str_(v, fb) { 
    var s = String(v == null ? '' : v).trim(); 
    return s ? s : (fb || ''); 
  }

  // ── PATCH: Multi-key lookup (checks both naming conventions + raw sheet) ──
  function pick_() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') {
        return arguments[i];
      }
    }
    return undefined;
  }

  // ── Core parameters (PATCHED: tries camelCase, snake_case, and cfgMap) ──
  var curThreshold = num_(pick_(
    currentConfig.threshold,
    cfgMap['threshold']
  ), 2.5);

  var curMom = num_(pick_(
    currentConfig.momentumSwingFactor,
    currentConfig.momentum_swing_factor,
    cfgMap['momentum_swing_factor']
  ), 0.15);

  var curVar = num_(pick_(
    currentConfig.variancePenaltyFactor,
    currentConfig.variance_penalty_factor,
    cfgMap['variance_penalty_factor']
  ), 0.20);

  // ── Elite targets (read from cfgMap with currentConfig fallback) ──
  var curStrongTarget = num_(pick_(
    cfgMap['strong_target'],
    currentConfig.strong_target,
    currentConfig.strongTarget
  ), 0.75);

  var curMediumTarget = num_(pick_(
    cfgMap['medium_target'],
    currentConfig.medium_target,
    currentConfig.mediumTarget
  ), 0.65);

  var curEvenTarget = num_(pick_(
    cfgMap['even_target'],
    currentConfig.even_target,
    currentConfig.evenTarget
  ), 0.55);

  var curConfidenceScale = num_(pick_(
    cfgMap['confidence_scale'],
    currentConfig.confidence_scale,
    currentConfig.confidenceScale
  ), 30);

  // ── Flip patterns ──
  var curFlip = {
    q1_flip: bool_(pick_(currentConfig.q1_flip, cfgMap['q1_flip']), false),
    q2_flip: bool_(pick_(currentConfig.q2_flip, cfgMap['q2_flip']), false),
    q3_flip: bool_(pick_(currentConfig.q3_flip, cfgMap['q3_flip']), false),
    q4_flip: bool_(pick_(currentConfig.q4_flip, cfgMap['q4_flip']), false)
  };

  // ── NEW FRIENDS - ensure they exist on currentConfig ──
  currentConfig.forebet_blend_enabled = bool_(
    pick_(cfgMap['forebet_blend_enabled'], currentConfig.forebet_blend_enabled), true
  );
  currentConfig.forebet_ou_weight_qtr = num_(
    pick_(cfgMap['forebet_ou_weight_qtr'], currentConfig.forebet_ou_weight_qtr), 0.25
  );
  currentConfig.forebet_ou_weight_ft = num_(
    pick_(cfgMap['forebet_ou_weight_ft'], currentConfig.forebet_ou_weight_ft), 2.0
  );
  currentConfig.highest_q_tie_policy = str_(
    pick_(cfgMap['highest_q_tie_policy'], currentConfig.highest_q_tie_policy), 'first'
  ).toLowerCase();
  currentConfig.highest_q_tie_conf_penalty = num_(
    pick_(cfgMap['highest_q_tie_conf_penalty'], currentConfig.highest_q_tie_conf_penalty), 0.10
  );

  Logger.log('[Tuner] Current: threshold=' + curThreshold +
             ', momentum=' + curMom + ', variance=' + curVar);
  Logger.log('[Tuner] Targets: strong=' + curStrongTarget +
             ', medium=' + curMediumTarget + ', even=' + curEvenTarget);
  Logger.log('[Tuner] Confidence scale: ' + curConfidenceScale);
  Logger.log('[Tuner] NEW FRIENDS: forebet_blend=' + currentConfig.forebet_blend_enabled +
             ', tie_policy=' + currentConfig.highest_q_tie_policy);

  return {
    currentConfig: currentConfig,
    cfgMap: cfgMap,
    curThreshold: curThreshold,
    curMom: curMom,
    curVar: curVar,
    curStrongTarget: curStrongTarget,
    curMediumTarget: curMediumTarget,
    curEvenTarget: curEvenTarget,
    curConfidenceScale: curConfidenceScale,
    curFlip: curFlip
  };
}


/**
 * Bayesian confidence calculator factory.
 */
function t2_makeConfidenceCalculator_() {
  var MIN_CONFIDENCE = 0.15;
  var MAX_CONFIDENCE = 0.95;

  function calculateConfidence(sampleSize, confidenceScale) {
    if (sampleSize === 0) return MIN_CONFIDENCE;
    var conf = MIN_CONFIDENCE +
               (MAX_CONFIDENCE - MIN_CONFIDENCE) *
               (1 - Math.exp(-sampleSize / confidenceScale));
    return Math.min(MAX_CONFIDENCE, conf);
  }

  return {
    MIN_CONFIDENCE: MIN_CONFIDENCE,
    MAX_CONFIDENCE: MAX_CONFIDENCE,
    calculateConfidence: calculateConfidence
  };
}

/**
 * Load all Tier 2 raw data sheets and compute dataConfidence (hardcoded scale 50).
 */
function t2_loadTier2RawGameData_(ss, calcConfFn) {
  var allSheets = ss.getSheets();
  var tier2Sheets = [];

  for (var si = 0; si < allSheets.length; si++) {
    var name = allSheets[si].getName();
    if (name.match(/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i)) {
      tier2Sheets.push(allSheets[si]);
    }
  }

  if (tier2Sheets.length === 0) {
    var resultsSheet = getSheetInsensitive(ss, 'ResultsClean') ||
                       getSheetInsensitive(ss, 'Clean');
    if (resultsSheet) {
      tier2Sheets.push(resultsSheet);
      Logger.log('[Tuner] Using ResultsClean as fallback data source');
    }
  }

  var allGames = [];
  var headers = null;

  if (tier2Sheets.length === 0) {
    Logger.log('[Tuner] WARNING: No training data found. Will use prior-based defaults.');
    headers = ['date', 'home', 'away', 'q1', 'q2', 'q3', 'q4'];
  } else {
    Logger.log('[Tuner] Found ' + tier2Sheets.length + ' data sources');
    for (var tsi = 0; tsi < tier2Sheets.length; tsi++) {
      var sh = tier2Sheets[tsi];
      var data = sh.getDataRange().getValues();
      if (data.length < 2) continue;
      if (!headers) headers = data[0];
      allGames = allGames.concat(data.slice(1));
      Logger.log('[Tuner] Loaded ' + (data.length - 1) + ' from ' + sh.getName());
    }
  }

  Logger.log('[Tuner] Total games: ' + allGames.length);

  var dataConfidence = calcConfFn(allGames.length, 50);
  Logger.log('[Tuner] Data confidence: ' + (dataConfidence * 100).toFixed(0) + '%');

  return { allGames: allGames, headers: headers, dataConfidence: dataConfidence };
}

/**
 * Detect Q column format (SEPARATE vs CONCAT vs UNKNOWN).
 */
function t2_detectTier2ColumnFormat_(headers, allGames) {
  var headerMap = headers ? createHeaderMap(headers) : {};

  var hasSeparateCols = (headerMap['q1h'] !== undefined && headerMap['q1a'] !== undefined);
  var hasConcatCols = (headerMap['q1'] !== undefined);

  if (!hasSeparateCols && !hasConcatCols && allGames.length > 0) {
    Logger.log('[Tuner] WARNING: No quarter columns detected. Will use limited training.');
  }

  Logger.log('[Tuner] Format: ' +
             (hasSeparateCols ? 'SEPARATE' : hasConcatCols ? 'CONCAT' : 'UNKNOWN'));

  return { headerMap: headerMap, hasSeparateCols: hasSeparateCols, hasConcatCols: hasConcatCols };
}

/**
 * Reset margin stats cache + load margin stats with try/catch fallback.
 */
function t2_loadTier2MarginStatsWithReset_() {
  Logger.log('[Tuner] Loading margin stats...');

  if (typeof TIER2_MARGIN_STATS_CACHE !== 'undefined') {
    TIER2_MARGIN_STATS_CACHE = null;
  }

  var marginStats = {};
  try {
    marginStats = (typeof loadTier2MarginStats === 'function')
      ? loadTier2MarginStats() || {}
      : {};
  } catch (e) {
    Logger.log('[Tuner] Could not load margin stats: ' + e.message);
  }

  Logger.log('[Tuner] Stats for ' + Object.keys(marginStats).length + ' teams');
  return marginStats;
}


/**
 * Builds training set from historical game data
 * PATCHED: Uses cached standings (no sheet reads in loops)
 * 
 * @param {Spreadsheet} ss
 * @param {Array} allGames - Raw game data rows
 * @param {Object} headerMap - Column name -> index map
 * @param {boolean} hasSeparateCols - Q1H/Q1A format
 * @param {boolean} hasConcatCols - Q1 "X-Y" format
 * @param {Object} marginStats - Pre-loaded margin stats
 * @param {Object} currentConfig - Current configuration
 * @param {number} curConfidenceScale - Confidence scale parameter
 * @param {Object} confidenceCalc - Confidence calculator
 * @returns {Array} Training set array
 */
function t2_buildTier2TrainingSet_(
  ss,
  allGames,
  headerMap,
  hasSeparateCols,
  hasConcatCols,
  marginStats,
  currentConfig,
  curConfidenceScale,
  confidenceCalc
) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  allGames = allGames || [];
  headerMap = headerMap || {};
  marginStats = marginStats || {};
  currentConfig = currentConfig || {};
  confidenceCalc = confidenceCalc || {};

  var trainingSet = [];
  var skippedNoTeams = 0;
  var skippedNoQuarters = 0;
  var skippedNoStats = 0;

  // CRITICAL FIX: Load standings ONCE (no sheet reads in loops)
  var standings = t2_loadStandingsAsRankingsCached_(ss);

  // Build lower->real key map once for marginStats lookup
  var lowerTeamKeyMap = Object.create(null);
  Object.keys(marginStats).forEach(function(k) {
    lowerTeamKeyMap[String(k).toLowerCase()] = k;
  });

  function toNum_(x) {
    var n = Number(x);
    return isFinite(n) ? n : NaN;
  }

  function getQuarterScores_(row, qIdLower) {
    if (hasSeparateCols) {
      var hIdx = headerMap[qIdLower + 'h'];
      var aIdx = headerMap[qIdLower + 'a'];
      if (hIdx === undefined || aIdx === undefined) return null;
      var h = toNum_(row[hIdx]);
      var a = toNum_(row[aIdx]);
      return (isFinite(h) && isFinite(a)) ? [h, a] : null;
    }

    if (hasConcatCols) {
      var colIdx = headerMap[qIdLower];
      if (colIdx === undefined) return null;
      var raw = row[colIdx];
      if (!raw || String(raw).trim().toLowerCase() === 'n/a') return null;

      if (typeof parseScore === 'function') {
        var parsed = parseScore(raw);
        if (parsed && parsed.length >= 2) {
          return [toNum_(parsed[0]), toNum_(parsed[1])];
        }
      }

      var parts = String(raw).split(/[-:]/);
      if (parts.length >= 2) {
        var hh = toNum_(parts[0]);
        var aa = toNum_(parts[1]);
        if (isFinite(hh) && isFinite(aa)) return [hh, aa];
      }
      return null;
    }

    return null;
  }

  function getVenueStats_(team, venue, quarter) {
    if (typeof _getVenueStats === 'function') {
      return _getVenueStats(marginStats, team, venue, quarter);
    }

    var teamData = marginStats[team];
    if (!teamData) {
      var realKey = lowerTeamKeyMap[String(team).toLowerCase()];
      if (realKey) teamData = marginStats[realKey];
    }
    if (!teamData) return null;

    var venueData = teamData[venue] || 
                    teamData[String(venue).toLowerCase()] ||
                    teamData[venue.charAt(0).toUpperCase() + venue.slice(1).toLowerCase()];
    if (!venueData) return null;

    return venueData[quarter] || venueData[String(quarter).toUpperCase()] || null;
  }

  function calcMomentum_(margins) {
    if (typeof calculateMomentum === 'function') return calculateMomentum(margins);
    if (!margins || margins.length === 0) return 0;

    var decay = toNum_(currentConfig.decay);
    if (!isFinite(decay)) decay = 0.9;

    var weighted = 0, total = 0;
    for (var i = 0; i < margins.length; i++) {
      var w = Math.pow(decay, i);
      weighted += margins[i] * w;
      total += w;
    }
    return total > 0 ? weighted / total : 0;
  }

  function calcVariance_(margins) {
    if (typeof calculateVariance === 'function') return calculateVariance(margins);
    if (!margins || margins.length < 2) return 0;

    var sum = 0;
    for (var i = 0; i < margins.length; i++) sum += margins[i];
    var mean = sum / margins.length;

    var sq = 0;
    for (var j = 0; j < margins.length; j++) {
      var d = margins[j] - mean;
      sq += d * d;
    }
    return Math.sqrt(sq / margins.length);
  }

  var QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  var idxHome = headerMap.home;
  var idxAway = headerMap.away;
  var idxDate = headerMap.date;

  for (var gi = 0; gi < allGames.length; gi++) {
    var row = allGames[gi];

    var homeTeam = String(row[idxHome] || '').trim();
    var awayTeam = String(row[idxAway] || '').trim();
    var dateVal = (idxDate !== undefined) ? row[idxDate] : '';

    if (!homeTeam || !awayTeam) {
      skippedNoTeams++;
      continue;
    }

    for (var qi = 0; qi < 4; qi++) {
      var qId = QUARTERS[qi];
      var scores = getQuarterScores_(row, qId.toLowerCase());

      if (!scores) {
        skippedNoQuarters++;
        continue;
      }

      var actualMargin = scores[0] - scores[1];
      var homeStats = getVenueStats_(homeTeam, 'Home', qId);
      var awayStats = getVenueStats_(awayTeam, 'Away', qId);

      var sampleConfidence = (confidenceCalc && confidenceCalc.MIN_CONFIDENCE != null)
        ? confidenceCalc.MIN_CONFIDENCE
        : 0.2;

      var baseMargin = 0;
      var homeMom = 0, awayMom = 0;
      var homeVar = 0, awayVar = 0;
      var usedStats = false;

      if (homeStats && awayStats) {
        var homeSamples = homeStats.samples || 0;
        var awaySamples = awayStats.samples || 0;
        var totalSamples = homeSamples + awaySamples;

        if (confidenceCalc && typeof confidenceCalc.calculateConfidence === 'function') {
          sampleConfidence = confidenceCalc.calculateConfidence(totalSamples, curConfidenceScale);
        }

        if (homeSamples >= 1 && awaySamples >= 1) {
          baseMargin = (homeStats.avgMargin || 0) - (awayStats.avgMargin || 0);
          homeMom = calcMomentum_(homeStats.rawMargins || []);
          awayMom = calcMomentum_(awayStats.rawMargins || []);
          homeVar = calcVariance_(homeStats.rawMargins || []);
          awayVar = calcVariance_(awayStats.rawMargins || []);
          usedStats = true;
        }
      }

      if (!usedStats) {
        // Cached standings fallback (no sheet reads here)
        var hRank = (standings[homeTeam] && standings[homeTeam].rank) || 15;
        var aRank = (standings[awayTeam] && standings[awayTeam].rank) || 15;
        baseMargin = (aRank - hRank) * 0.5;
        sampleConfidence = 0.2;
      }

      trainingSet.push({
        gameId: homeTeam + '_vs_' + awayTeam + '_' + dateVal,
        quarter: qId,
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        baseMargin: baseMargin,
        homeMomentum: homeMom,
        awayMomentum: awayMom,
        avgVariance: (homeVar + awayVar) / 2,
        actualMargin: actualMargin,
        confidence: sampleConfidence,
        usedStats: usedStats
      });
    }
  }

  Logger.log('[Tuner] Training set: ' + trainingSet.length + ' quarters');
  Logger.log('[Tuner] Skipped: ' + skippedNoQuarters + ' (no scores), ' +
             skippedNoStats + ' (no stats), ' + skippedNoTeams + ' (no teams)');

  return trainingSet;
}

/**
 * Samples candidate configurations for tuning
 * PATCHED: Includes NEW FRIENDS parameters
 * 
 * @param {Object} space - Search space definition
 * @param {Object} cur - Current configuration values
 * @param {number} maxN - Maximum number of candidates
 * @returns {Array} Array of candidate config objects
 */
function t2_sampleTier2Candidates_(space, cur, maxN) {
  maxN = maxN || 520;
  space = space || {};
  cur = cur || {};

  // Core parameter arrays from search space
  var thresholds = (space.thresholds && space.thresholds.length) 
    ? space.thresholds : [cur.threshold || 2.5];
  var momentums = (space.momentums && space.momentums.length) 
    ? space.momentums : [cur.momentumSwingFactor || 0.15];
  var variances = (space.variances && space.variances.length) 
    ? space.variances : [cur.variancePenaltyFactor || 0.20];
  var flips = (space.flipCombos && space.flipCombos.length) 
    ? space.flipCombos : [[!!cur.q1_flip, !!cur.q2_flip, !!cur.q3_flip, !!cur.q4_flip]];
  var confScales = (space.confidenceScales && space.confidenceScales.length) 
    ? space.confidenceScales : [cur.confidence_scale || 30];

  // NEW FRIENDS search ranges
  var fbEnabledArr = [true, false];
  var fbQtrWArr = [0, 0.10, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60];
  var fbFtWArr = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
  var tiePolicyArr = ['first', 'highest_conf', 'random'];
  var tiePenaltyArr = [0.00, 0.05, 0.10, 0.15, 0.20];

  // Helpers
  function pick_(arr) { 
    return arr[Math.floor(Math.random() * arr.length)]; 
  }
  function clamp_(x, lo, hi) { 
    return Math.max(lo, Math.min(hi, x)); 
  }
  function toBool_(v, fb) {
    if (v === true || v === false) return v;
    var s = String(v == null ? '' : v).trim().toUpperCase();
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    return !!fb;
  }
  function toNum_(v, fb) { 
    var n = Number(v); 
    return isFinite(n) ? n : fb; 
  }
  function toStr_(v, fb) { 
    var s = String(v == null ? '' : v).trim(); 
    return s ? s : (fb || ''); 
  }

  // Base values for NEW FRIENDS (biased sampling)
  var baseFbEnabled = toBool_(cur.forebet_blend_enabled, true);
  var baseFbQtrW = toNum_(cur.forebet_ou_weight_qtr, 0.25);
  var baseFbFtW = toNum_(cur.forebet_ou_weight_ft, 2.0);
  var baseTiePolicy = toStr_(cur.highest_q_tie_policy, 'first').toLowerCase();
  var baseTiePenalty = toNum_(cur.highest_q_tie_conf_penalty, 0.10);

  var out = [];
  var seen = Object.create(null);

  function key_(c) {
    return [
      Number(c.threshold).toFixed(2),
      Number(c.momentumSwingFactor).toFixed(3),
      Number(c.variancePenaltyFactor).toFixed(3),
      c.q1_flip ? 1 : 0,
      c.q2_flip ? 1 : 0,
      c.q3_flip ? 1 : 0,
      c.q4_flip ? 1 : 0,
      String(parseInt(c.confidence_scale, 10) || 0),
      c.forebet_blend_enabled ? 1 : 0,
      Number(c.forebet_ou_weight_qtr).toFixed(2),
      Number(c.forebet_ou_weight_ft).toFixed(2),
      String(c.highest_q_tie_policy || ''),
      Number(c.highest_q_tie_conf_penalty).toFixed(2)
    ].join('|');
  }

  function makeCfg_(t, m, v, f, cs, fbE, fbQ, fbF, tp, pen) {
    return {
      threshold: Number(t),
      momentumSwingFactor: Number(m),
      variancePenaltyFactor: Number(v),
      q1_flip: !!f[0],
      q2_flip: !!f[1],
      q3_flip: !!f[2],
      q4_flip: !!f[3],
      confidence_scale: parseInt(cs, 10) || 30,
      strong_target: toNum_(cur.strong_target, 0.75),
      medium_target: toNum_(cur.medium_target, 0.65),
      even_target: toNum_(cur.even_target, 0.55),
      // NEW FRIENDS
      forebet_blend_enabled: !!fbE,
      forebet_ou_weight_qtr: Number(fbQ),
      forebet_ou_weight_ft: Number(fbF),
      highest_q_tie_policy: String(tp || 'first'),
      highest_q_tie_conf_penalty: Number(pen)
    };
  }

  function pushCfg_(cfg) {
    var k = key_(cfg);
    if (seen[k]) return false;
    seen[k] = 1;
    out.push(cfg);
    return true;
  }

  // Anchor 1: Current config
  pushCfg_(makeCfg_(
    cur.threshold || 2.5,
    cur.momentumSwingFactor || 0.15,
    cur.variancePenaltyFactor || 0.20,
    [cur.q1_flip, cur.q2_flip, cur.q3_flip, cur.q4_flip],
    cur.confidence_scale || 30,
    baseFbEnabled, baseFbQtrW, baseFbFtW, baseTiePolicy, baseTiePenalty
  ));

  // Anchor 2: Default baseline
  pushCfg_(makeCfg_(
    2.5, 0.15, 0.20,
    [false, false, false, false],
    cur.confidence_scale || 30,
    baseFbEnabled, baseFbQtrW, baseFbFtW, baseTiePolicy, baseTiePenalty
  ));

  var tries = 0;
  var MAX_TRIES = maxN * 60;

  while (out.length < maxN && tries < MAX_TRIES) {
    tries++;

    var t = Number(pick_(thresholds));
    var m = Number(pick_(momentums));
    var v = Number(pick_(variances));
    var f = pick_(flips);
    var cs = parseInt(pick_(confScales), 10) || (parseInt(cur.confidence_scale, 10) || 30);

    // Random jitter on core params
    if (Math.random() < 0.25) t += (Math.random() - 0.5) * 0.6;
    if (Math.random() < 0.25) m += (Math.random() - 0.5) * 0.06;
    if (Math.random() < 0.25) v += (Math.random() - 0.5) * 0.06;

    t = clamp_(t, 1.0, 7.0);
    m = clamp_(m, 0.0, 0.5);
    v = clamp_(v, 0.0, 0.75);
    cs = clamp_(cs, 5, 100);

    // NEW FRIENDS (70-75% biased to current, rest random)
    var fbE = (Math.random() < 0.70) ? baseFbEnabled : pick_(fbEnabledArr);
    var fbQ = (Math.random() < 0.70) ? baseFbQtrW : pick_(fbQtrWArr);
    var fbF = (Math.random() < 0.70) ? baseFbFtW : pick_(fbFtWArr);
    var tp = (Math.random() < 0.75) ? baseTiePolicy : pick_(tiePolicyArr);
    var pen = (Math.random() < 0.75) ? baseTiePenalty : pick_(tiePenaltyArr);
    pen = clamp_(pen, 0, 0.35);

    var cfg = makeCfg_(
      Number(t.toFixed(2)),
      Number(m.toFixed(3)),
      Number(v.toFixed(3)),
      f,
      cs,
      fbE,
      Number(Number(fbQ).toFixed(2)),
      Number(Number(fbF).toFixed(2)),
      tp,
      Number(Number(pen).toFixed(2))
    );

    pushCfg_(cfg);
  }

  Logger.log('[Sampler] Generated ' + out.length + ' candidates in ' + tries + ' tries');
  return out;
}

/**
 * Handle <4 training samples: write defaults + alert + early return signal.
 */
function t2_handleLowDataCase_(ss, ui, cfgMap, trainingSetLength) {
  if (trainingSetLength >= 4) return false;

  Logger.log('[Tuner] Very limited data. Using prior-weighted defaults.');

  var defaultConfig = {
    threshold: 3.0,
    momentumSwingFactor: 0.10,
    variancePenaltyFactor: 0.15,
    q1_flip: false,
    q2_flip: false,
    q3_flip: false,
    q4_flip: false,
    strong_target: 0.75,
    medium_target: 0.65,
    even_target: 0.55,
    confidence_scale: 30
  };

  var defaultStats = {
    sideAccuracy: 50, coverage: 0, overallAccuracy: 50, sidePreds: 0,
    evenPreds: 0, sideHits: 0, sideMisses: 0, sidePushes: 0,
    evenHits: 0, evenMisses: 0, errors: 0, weightedScore: 0
  };

  writeProposalSheet_(ss, cfgMap, defaultConfig, defaultConfig, defaultConfig,
    defaultStats, defaultStats, trainingSetLength, defaultStats, defaultStats);

  ui.alert(
    'Elite Tuning (Limited Data)',
    'Training data: ' + trainingSetLength + ' quarters\n\n' +
    'Not enough data for reliable optimization.\n' +
    'Using conservative prior-weighted defaults.\n\n' +
    'The system will still work and improve as you add more games.\n\n' +
    'Review Config_Tier2_Proposals.',
    ui.ButtonSet.OK
  );

  return true;
}

/**
 * Dedupe numbers (by toFixed(3)) + sort ascending.
 */
function t2_uniqueSorted_(arr) {
  var nums = [];
  for (var i = 0; i < arr.length; i++) {
    var val = parseFloat(arr[i]);
    if (!isNaN(val)) nums.push(val);
  }
  var seen = {};
  var out = [];
  for (var j = 0; j < nums.length; j++) {
    var k = nums[j].toFixed(3);
    if (!seen[k]) {
      seen[k] = true;
      out.push(nums[j]);
    }
  }
  out.sort(function(a, b) { return a - b; });
  return out;
}

/**
 * Generate 16 flip combos (loop order preserved).
 */
function t2_buildFlipCombos_() {
  var flipCombos = [];
  var flipVals = [false, true];
  for (var f1 = 0; f1 < 2; f1++) {
    for (var f2 = 0; f2 < 2; f2++) {
      for (var f3 = 0; f3 < 2; f3++) {
        for (var f4 = 0; f4 < 2; f4++) {
          flipCombos.push({
            q1_flip: flipVals[f1],
            q2_flip: flipVals[f2],
            q3_flip: flipVals[f3],
            q4_flip: flipVals[f4]
          });
        }
      }
    }
  }
  return flipCombos;
}


/********************************************************************
 * ============================================================
 * PATCH: t2_buildTier2SearchSpace_ (full grids incl. targets)
 * ============================================================
 ********************************************************************/

/**
 * PATCHED: Build comprehensive search space including targets.
 * cur* args retained but NOT used for grid bounds.
 */
function t2_buildTier2SearchSpace_(curThreshold, curMom, curVar) {
  var thresholds = t2_rangeStep_(2.0, 10.0, 0.5);  // 17
  var momentums = t2_rangeStep_(0.05, 0.50, 0.05); // 10
  var variances = t2_rangeStep_(0.05, 0.30, 0.05); // 6

  var confidenceScales = t2_rangeStep_(20, 50, 5).map(function(x) { return Math.round(x); }); // 7

  var strongTargets = t2_rangeStep_(0.50, 0.85, 0.05); // 8
  var mediumTargets = t2_rangeStep_(0.50, 0.85, 0.05); // 8
  var evenTargets = t2_rangeStep_(0.50, 0.85, 0.05);   // 8

  var flipCombos = t2_buildFlipCombos_(); // 16

  Logger.log('[SearchSpace] thresholds=' + thresholds.length +
             ', momentums=' + momentums.length +
             ', variances=' + variances.length +
             ', flips=' + flipCombos.length +
             ', confidenceScales=' + confidenceScales.length +
             ', targets=' + strongTargets.length + '×' + mediumTargets.length + '×' + evenTargets.length);

  return {
    thresholds: thresholds,
    momentums: momentums,
    variances: variances,
    confidenceScales: confidenceScales,
    strongTargets: strongTargets,
    mediumTargets: mediumTargets,
    evenTargets: evenTargets,
    flipCombos: flipCombos
  };
}

/**
 * Round to nearest 0.5.
 */
function t2_roundToHalf__(n) {
  return Math.round(n * 2) / 2;
}

/**
 * Score a single Tier2 prediction text against actual margin.
 */
function t2_scoreT2Pred_(predText, actualMargin, th) {
  if (!predText || typeof actualMargin !== 'number' || isNaN(actualMargin)) {
    return { result: 'ERROR' };
  }

  if (predText === 'EVEN') {
    return Math.abs(actualMargin) <= th ? { result: 'HIT' } : { result: 'MISS' };
  }

  var match = predText.match(/^([HA])\s*\+?([\d.]+)/i);
  if (!match) return { result: 'ERROR' };

  var predSide = match[1].toUpperCase();
  var actualSide = actualMargin > 0 ? 'H' : actualMargin < 0 ? 'A' : 'PUSH';

  if (actualSide === 'PUSH') return { result: 'PUSH' };
  return predSide === actualSide ? { result: 'HIT' } : { result: 'MISS' };
}

/**
 * Create evaluator function (Quirk 1 preserved: calcConfFn(10, confScale)).
 */
function t2_makeTier2Evaluator_(trainingSet, calcConfFn, curConfidenceScale) {
  return function(cand) {
    var sidePreds = 0, sideHits = 0, sideMisses = 0, sidePushes = 0;
    var evenPreds = 0, evenHits = 0, evenMisses = 0, errors = 0;

    var weightedHits = 0, weightedTotal = 0;

    var th = cand.threshold;
    var momF = cand.momentumSwingFactor;
    var varF = cand.variancePenaltyFactor;
    var confScale = cand.confidence_scale || curConfidenceScale;

    for (var i = 0; i < trainingSet.length; i++) {
      var g = trainingSet[i];

      // Quirk 1: constant 10 (do not "fix")
      var sampleConf = g.usedStats ? calcConfFn(10, confScale) : 0.2;

      var momDiff = g.homeMomentum - g.awayMomentum;
      var momSwing = momDiff * momF;
      var varPenalty = g.avgVariance * varF;

      var finalMargin = g.baseMargin + momSwing;
      if (finalMargin > 0) {
        finalMargin = Math.max(0, finalMargin - varPenalty);
      } else {
        finalMargin = Math.min(0, finalMargin + varPenalty);
      }

      if (g.quarter === 'Q1' && cand.q1_flip) finalMargin *= -1;
      if (g.quarter === 'Q2' && cand.q2_flip) finalMargin *= -1;
      if (g.quarter === 'Q3' && cand.q3_flip) finalMargin *= -1;
      if (g.quarter === 'Q4' && cand.q4_flip) finalMargin *= -1;

      var absM = Math.abs(finalMargin);
      var predText, predSide;

      if (absM < th) {
        predText = 'EVEN';
        predSide = 'EVEN';
      } else {
        predSide = finalMargin > 0 ? 'H' : 'A';
        predText = predSide + ' +' + t2_roundToHalf__(absM).toFixed(1);
      }

      var sr = t2_scoreT2Pred_(predText, g.actualMargin, th);

      if (predSide === 'EVEN') {
        evenPreds++;
        if (sr.result === 'HIT') {
          evenHits++;
          weightedHits += sampleConf;
        } else if (sr.result === 'MISS') {
          evenMisses++;
        } else {
          errors++;
        }
        weightedTotal += sampleConf;
      } else {
        sidePreds++;
        if (sr.result === 'HIT') {
          sideHits++;
          weightedHits += sampleConf;
        } else if (sr.result === 'MISS') {
          sideMisses++;
        } else if (sr.result === 'PUSH') {
          sidePushes++;
          weightedHits += sampleConf * 0.5;
        } else {
          errors++;
        }
        weightedTotal += sampleConf;
      }
    }

    var sideDenom = sideHits + sideMisses;
    var sideAcc = sideDenom > 0 ? (sideHits / sideDenom * 100) : 0;

    var totalPreds = sidePreds + evenPreds;
    var totalHits = sideHits + evenHits;
    var overallAcc = totalPreds > 0 ? (totalHits / totalPreds * 100) : 0;

    var coverage = trainingSet.length > 0 ? (sidePreds / trainingSet.length * 100) : 0;

    var weightedScore = weightedTotal > 0 ? (weightedHits / weightedTotal * 100) : 0;

    return {
      sideAccuracy: sideAcc,
      overallAccuracy: overallAcc,
      coverage: coverage,
      weightedScore: weightedScore,
      sidePreds: sidePreds,
      sideHits: sideHits,
      sideMisses: sideMisses,
      sidePushes: sidePushes,
      evenPreds: evenPreds,
      evenHits: evenHits,
      evenMisses: evenMisses,
      errors: errors
    };
  };
}

/********************************************************************
 * ============================================================
 * PATCH: t2_runPhase1CoreGridSearch_ (shuffle + dedupe + sampling + 2 refinements)
 * ============================================================
 ********************************************************************/

/**
 * Phase 1 grid search (core params) with shuffle+dedupe and 2 refinement passes.
 */
function t2_runPhase1CoreGridSearch_(ss, thresholds, momentums, variances, ctx, evalFn) {
  ss.toast('Phase 1/3: Core parameters...', 'Ma Golide Elite', 30);

  var evalResults = [];
  evalResults._seen = Object.create(null);
  evalResults._uniqueCount = 0;
  evalResults._penaltyMultiplier = 1.0;

  function buildCand_(t, m, v) {
    // Quirk 4: property names + order preserved exactly
    return {
      threshold: t,
      momentumSwingFactor: m,
      variancePenaltyFactor: v,
      q1_flip: ctx.curFlip.q1_flip,
      q2_flip: ctx.curFlip.q2_flip,
      q3_flip: ctx.curFlip.q3_flip,
      q4_flip: ctx.curFlip.q4_flip,
      strong_target: ctx.curStrongTarget,
      medium_target: ctx.curMediumTarget,
      even_target: ctx.curEvenTarget,
      confidence_scale: ctx.curConfidenceScale
    };
  }

  function perturbOnce_(cand) {
    // ±0.01..0.05 perturb, clamped to valid ranges
    var dt = (Math.random() < 0.5 ? -1 : 1) * (0.01 + Math.random() * 0.04);
    var dm = (Math.random() < 0.5 ? -1 : 1) * (0.01 + Math.random() * 0.04);
    var dv = (Math.random() < 0.5 ? -1 : 1) * (0.01 + Math.random() * 0.04);

    cand.threshold = Math.round(t2_clamp_(cand.threshold + dt, 2.0, 10.0) * 100) / 100;
    cand.momentumSwingFactor = Math.round(t2_clamp_(cand.momentumSwingFactor + dm, 0.05, 0.50) * 1000) / 1000;
    cand.variancePenaltyFactor = Math.round(t2_clamp_(cand.variancePenaltyFactor + dv, 0.05, 0.30) * 1000) / 1000;
    return cand;
  }

  function evalUnique_(cand) {
    var h = t2_configHash_(cand);
    if (evalResults._seen[h]) {
      cand = perturbOnce_(cand);
      h = t2_configHash_(cand);
      if (evalResults._seen[h]) return null;
    }
    var st = evalFn(cand);
    evalResults.push({ config: cand, stats: st });
    evalResults._seen[h] = true;
    evalResults._uniqueCount++;
    return st;
  }

  // Build all core combos then Fisher-Yates shuffle (positional bias prevention)
  var combos = [];
  for (var ti = 0; ti < thresholds.length; ti++) {
    for (var mi = 0; mi < momentums.length; mi++) {
      for (var vi = 0; vi < variances.length; vi++) {
        combos.push([thresholds[ti], momentums[mi], variances[vi]]);
      }
    }
  }
  t2_shuffle_(combos);

  // Performance cap: sample to 2000 while forcing extremes
  var MAX_PHASE1 = 2000;
  if (combos.length > MAX_PHASE1) {
    var corners = [
      [thresholds[0], momentums[0], variances[0]],
      [thresholds[0], momentums[0], variances[variances.length - 1]],
      [thresholds[0], momentums[momentums.length - 1], variances[0]],
      [thresholds[thresholds.length - 1], momentums[0], variances[0]],
      [thresholds[thresholds.length - 1], momentums[momentums.length - 1], variances[variances.length - 1]]
    ];
    combos = corners.concat(combos.slice(0, MAX_PHASE1 - corners.length));
    t2_shuffle_(combos);
    Logger.log('[Phase1] Sampling: ' + combos.length + ' combos (cap=' + MAX_PHASE1 + ')');
  }

  var bestPhase1 = null;

  // Broad pass
  for (var i = 0; i < combos.length; i++) {
    var c = combos[i];
    var cand = buildCand_(c[0], c[1], c[2]);
    var st = evalUnique_(cand);
    if (!st) continue;

    // Quirk 2: +0.5 tie logic preserved
    if (!bestPhase1 ||
        st.weightedScore > bestPhase1.stats.weightedScore + 0.5 ||
        (Math.abs(st.weightedScore - bestPhase1.stats.weightedScore) < 0.5 &&
         st.sideAccuracy > bestPhase1.stats.sideAccuracy)) {
      bestPhase1 = { config: cand, stats: st };
    }
  }

  // Two refinement passes around current best (single-run stability)
  function buildRefineCombos_(center, spanT, stepT, spanM, stepM, spanV, stepV) {
    var out = [];
    for (var dt = -spanT; dt <= spanT + 1e-9; dt += stepT) {
      for (var dm = -spanM; dm <= spanM + 1e-9; dm += stepM) {
        for (var dv = -spanV; dv <= spanV + 1e-9; dv += stepV) {
          var t = Math.round(t2_clamp_(center.threshold + dt, 2.0, 10.0) * 100) / 100;
          var m = Math.round(t2_clamp_(center.momentumSwingFactor + dm, 0.05, 0.50) * 1000) / 1000;
          var v = Math.round(t2_clamp_(center.variancePenaltyFactor + dv, 0.05, 0.30) * 1000) / 1000;
          out.push([t, m, v]);
        }
      }
    }
    t2_shuffle_(out);
    return out;
  }

  if (bestPhase1) {
    var passes = [
      // Pass 1 (coarse)
      { spanT: 0.75, stepT: 0.25, spanM: 0.05, stepM: 0.025, spanV: 0.05, stepV: 0.025 },
      // Pass 2 (fine)
      { spanT: 0.30, stepT: 0.10, spanM: 0.02, stepM: 0.01,  spanV: 0.02, stepV: 0.01  }
    ];

    for (var p = 0; p < passes.length; p++) {
      var P = passes[p];
      var ref = buildRefineCombos_(bestPhase1.config, P.spanT, P.stepT, P.spanM, P.stepM, P.spanV, P.stepV);

      for (var r = 0; r < ref.length; r++) {
        var rc = ref[r];
        var candR = buildCand_(rc[0], rc[1], rc[2]);
        var stR = evalUnique_(candR);
        if (!stR) continue;

        // Quirk 2 preserved
        if (stR.weightedScore > bestPhase1.stats.weightedScore + 0.5 ||
            (Math.abs(stR.weightedScore - bestPhase1.stats.weightedScore) < 0.5 &&
             stR.sideAccuracy > bestPhase1.stats.sideAccuracy)) {
          bestPhase1 = { config: candR, stats: stR };
        }
      }
    }
  }

  Logger.log('[Tuner] Phase 1 best weighted: ' + (bestPhase1 ? bestPhase1.stats.weightedScore.toFixed(1) : 'N/A') + '%');
  Logger.log('[Tuner] Unique configs so far: ' + evalResults._uniqueCount);

  return { evalResults: evalResults, bestPhase1: bestPhase1 };
}

/********************************************************************
 * ============================================================
 * ADD ONCE (top-level): stash for write-time diversity escalation
 * ============================================================
 ********************************************************************/
var t2_lastEvalResults = null;


/********************************************************************
 * ============================================================
 * ADD ONCE: SHARED UTILITIES FOR DIVERSITY-AWARE TUNING
 * ============================================================
 ********************************************************************/

function t2_configHash_(cfg) {
  function n_(x) { return (x == null || isNaN(x)) ? 'null' : Number(x).toFixed(6); }
  function b_(x) { return x ? '1' : '0'; }
  // All 11 params (core + flips + targets + confidence_scale)
  return [
    'threshold=' + n_(cfg.threshold),
    'momentumSwingFactor=' + n_(cfg.momentumSwingFactor),
    'variancePenaltyFactor=' + n_(cfg.variancePenaltyFactor),
    'q1_flip=' + b_(cfg.q1_flip),
    'q2_flip=' + b_(cfg.q2_flip),
    'q3_flip=' + b_(cfg.q3_flip),
    'q4_flip=' + b_(cfg.q4_flip),
    'strong_target=' + n_(cfg.strong_target),
    'medium_target=' + n_(cfg.medium_target),
    'even_target=' + n_(cfg.even_target),
    'confidence_scale=' + n_(cfg.confidence_scale)
  ].join('|');
}

function t2_diffCount_(a, b) {
  var d = 0, eps = 1e-6;
  function neqNum(x, y) {
    if (x == null && y == null) return false;
    if (x == null || y == null) return true;
    return Math.abs(Number(x) - Number(y)) > eps;
  }
  if (neqNum(a.threshold, b.threshold)) d++;
  if (neqNum(a.momentumSwingFactor, b.momentumSwingFactor)) d++;
  if (neqNum(a.variancePenaltyFactor, b.variancePenaltyFactor)) d++;
  if (!!a.q1_flip !== !!b.q1_flip) d++;
  if (!!a.q2_flip !== !!b.q2_flip) d++;
  if (!!a.q3_flip !== !!b.q3_flip) d++;
  if (!!a.q4_flip !== !!b.q4_flip) d++;
  if (neqNum(a.strong_target, b.strong_target)) d++;
  if (neqNum(a.medium_target, b.medium_target)) d++;
  if (neqNum(a.even_target, b.even_target)) d++;
  if (neqNum(a.confidence_scale, b.confidence_scale)) d++;
  return d;
}

function t2_shuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function t2_clamp_(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function t2_rangeStep_(start, end, step) {
  var out = [];
  for (var v = start; v <= end + 1e-9; v += step) {
    out.push(Math.round(v * 1000000) / 1000000);
  }
  return t2_uniqueSorted_(out);
}


/********************************************************************
 * ============================================================
 * PATCH: t2_runPhase2FlipSearch_ (shuffle + dedupe)
 * ============================================================
 ********************************************************************/

/**
 * Phase 2 flip search (mutates evalResults by appending).
 */
function t2_runPhase2FlipSearch_(ss, flipCombos, bestPhase1, ctx, evalFn, evalResults) {
  ss.toast('Phase 2/3: Flip patterns...', 'Ma Golide Elite', 20);

  function evalUnique_(cand) {
    var h = t2_configHash_(cand);
    if (evalResults._seen && evalResults._seen[h]) return null;
    var st = evalFn(cand);
    evalResults.push({ config: cand, stats: st });
    if (evalResults._seen) evalResults._seen[h] = true;
    if (typeof evalResults._uniqueCount === 'number') evalResults._uniqueCount++;
    return st;
  }

  var flips = flipCombos.slice();
  t2_shuffle_(flips);

  var bestPhase2 = bestPhase1;

  for (var fi = 0; fi < flips.length; fi++) {
    var flip = flips[fi];

    // Quirk 4: property names + order preserved exactly
    var candFlip = {
      threshold: bestPhase1.config.threshold,
      momentumSwingFactor: bestPhase1.config.momentumSwingFactor,
      variancePenaltyFactor: bestPhase1.config.variancePenaltyFactor,
      q1_flip: flip.q1_flip,
      q2_flip: flip.q2_flip,
      q3_flip: flip.q3_flip,
      q4_flip: flip.q4_flip,
      strong_target: ctx.curStrongTarget,
      medium_target: ctx.curMediumTarget,
      even_target: ctx.curEvenTarget,
      confidence_scale: ctx.curConfidenceScale
    };

    var flipStats = evalUnique_(candFlip);
    if (!flipStats) continue;

    // Quirk 2: +0.5 tie logic preserved
    if (flipStats.weightedScore > bestPhase2.stats.weightedScore + 0.5 ||
        (Math.abs(flipStats.weightedScore - bestPhase2.stats.weightedScore) < 0.5 &&
         flipStats.sideAccuracy > bestPhase2.stats.sideAccuracy)) {
      bestPhase2 = { config: candFlip, stats: flipStats };
    }
  }

  Logger.log('[Tuner] Phase 2 best weighted: ' + bestPhase2.stats.weightedScore.toFixed(1) + '%');
  Logger.log('[Tuner] Unique configs so far: ' + (evalResults._uniqueCount || evalResults.length));

  return { config: bestPhase2.config, stats: bestPhase2.stats };
}

/********************************************************************
 * ============================================================
 * PATCH: t2_runPhase3EliteParamSearch_ (searches confidence + targets; strict > preserved)
 * ============================================================
 ********************************************************************/

/**
 * Phase 3 confidence scale + target search (mutates evalResults by appending).
 * Uses evalResults._space for target grids (set in tuneTier2Config).
 */
function t2_runPhase3EliteParamSearch_(ss, confidenceScales, bestPhase2, ctx, evalFn, evalResults) {
  ss.toast('Phase 3/3: Elite parameters...', 'Ma Golide Elite', 30);

  var space = evalResults && evalResults._space;

  // Pull target grids from space if available; fallback to current values (compat)
  var strongTargets = (space && space.strongTargets) || [ctx.curStrongTarget];
  var mediumTargets = (space && space.mediumTargets) || [ctx.curMediumTarget];
  var evenTargets   = (space && space.evenTargets)   || [ctx.curEvenTarget];

  function evalUnique_(cand) {
    var h = t2_configHash_(cand);
    if (evalResults._seen && evalResults._seen[h]) return null;
    var st = evalFn(cand);
    evalResults.push({ config: cand, stats: st });
    if (evalResults._seen) evalResults._seen[h] = true;
    if (typeof evalResults._uniqueCount === 'number') evalResults._uniqueCount++;
    return st;
  }

  // Build valid elite combos with constraint strong > medium > even
  var eliteCombos = [];
  for (var csi = 0; csi < confidenceScales.length; csi++) {
    for (var si = 0; si < strongTargets.length; si++) {
      for (var mi = 0; mi < mediumTargets.length; mi++) {
        for (var ei = 0; ei < evenTargets.length; ei++) {
          var st = strongTargets[si], mt = mediumTargets[mi], et = evenTargets[ei];
          if (!(st > mt && mt > et)) continue;
          eliteCombos.push([confidenceScales[csi], st, mt, et]);
        }
      }
    }
  }

  t2_shuffle_(eliteCombos);

  // Cap Phase 3 to avoid timeout (shuffled so still covers broadly)
  var MAX_PHASE3 = 500;
  if (eliteCombos.length > MAX_PHASE3) eliteCombos = eliteCombos.slice(0, MAX_PHASE3);

  var bestPhase3 = bestPhase2;

  for (var i = 0; i < eliteCombos.length; i++) {
    var combo = eliteCombos[i];

    // Quirk 4: property names + order preserved exactly
    var candElite = {
      threshold: bestPhase2.config.threshold,
      momentumSwingFactor: bestPhase2.config.momentumSwingFactor,
      variancePenaltyFactor: bestPhase2.config.variancePenaltyFactor,
      q1_flip: bestPhase2.config.q1_flip,
      q2_flip: bestPhase2.config.q2_flip,
      q3_flip: bestPhase2.config.q3_flip,
      q4_flip: bestPhase2.config.q4_flip,
      strong_target: combo[1],
      medium_target: combo[2],
      even_target: combo[3],
      confidence_scale: combo[0]
    };

    var eliteStats = evalUnique_(candElite);
    if (!eliteStats) continue;

    // Quirk 2: strict > only (no +0.5) preserved
    if (eliteStats.weightedScore > bestPhase3.stats.weightedScore) {
      bestPhase3 = { config: candElite, stats: eliteStats };
    }
  }

  Logger.log('[Tuner] Phase 3 best weighted: ' + bestPhase3.stats.weightedScore.toFixed(1) + '%');
  Logger.log('[Tuner] Total configs tested: ' + evalResults.length);
  Logger.log('[Tuner] Total unique configs tested: ' + (evalResults._uniqueCount || evalResults.length));

  return { config: bestPhase3.config, stats: bestPhase3.stats };
}

/**
 * Evaluate current config and log weighted score.
 */
function t2_evaluateCurrentConfig_(ctx, evalFn) {
  var currentEval = evalFn({
    threshold: ctx.curThreshold,
    momentumSwingFactor: ctx.curMom,
    variancePenaltyFactor: ctx.curVar,
    q1_flip: ctx.curFlip.q1_flip,
    q2_flip: ctx.curFlip.q2_flip,
    q3_flip: ctx.curFlip.q3_flip,
    q4_flip: ctx.curFlip.q4_flip,
    strong_target: ctx.curStrongTarget,
    medium_target: ctx.curMediumTarget,
    even_target: ctx.curEvenTarget,
    confidence_scale: ctx.curConfidenceScale
  });

  Logger.log('[Tuner] Current weighted: ' + currentEval.weightedScore.toFixed(1) + '%');
  return currentEval;
}

/**
 * PATCHED (PERF FIX): Diversity-aware greedy re-ranking without O(n^3).
 * - Preserves base tie-break quirks
 * - Greedy selection with penalty when similarity > 0.8
 * - Uses incremental max-sim updates => O(n^2) similarity checks
 *
 * penaltyMultiplier:
 *   1.0 normal, 2.0 escalated (write-time fallback)
 */
function t2_rankEvalResults_(evalResults, penaltyMultiplier) {
  if (!evalResults || !evalResults.length) return evalResults;

  penaltyMultiplier = penaltyMultiplier || evalResults._penaltyMultiplier || 1.0;

  function norm_(x) { x = Number(x); return isNaN(x) ? 0 : x; }

  function getVec_(cfg) {
    // Normalize to [0,1] using declared ranges
    var t  = (norm_(cfg.threshold) - 2.0) / 8.0;
    var m  = (norm_(cfg.momentumSwingFactor) - 0.05) / 0.45;
    var v  = (norm_(cfg.variancePenaltyFactor) - 0.05) / 0.25;
    var cs = (norm_(cfg.confidence_scale || 30) - 20) / 30;

    var st = (norm_(cfg.strong_target || 0.75) - 0.50) / 0.35;
    var mt = (norm_(cfg.medium_target || 0.65) - 0.50) / 0.35;
    var et = (norm_(cfg.even_target || 0.55) - 0.50) / 0.35;

    return {
      num: [
        t2_clamp_(t, 0, 1),
        t2_clamp_(m, 0, 1),
        t2_clamp_(v, 0, 1),
        t2_clamp_(cs, 0, 1),
        t2_clamp_(st, 0, 1),
        t2_clamp_(mt, 0, 1),
        t2_clamp_(et, 0, 1)
      ],
      flips: [
        cfg.q1_flip ? 1 : 0,
        cfg.q2_flip ? 1 : 0,
        cfg.q3_flip ? 1 : 0,
        cfg.q4_flip ? 1 : 0
      ]
    };
  }

  function similarityVec_(aVec, bVec) {
    var sumSq = 0;
    for (var i = 0; i < aVec.num.length; i++) {
      var d = aVec.num[i] - bVec.num[i];
      sumSq += d * d;
    }
    var euclid = Math.sqrt(sumSq / aVec.num.length);

    var ham = 0;
    for (var j = 0; j < 4; j++) if (aVec.flips[j] !== bVec.flips[j]) ham++;
    var hamNorm = ham / 4;

    var dist = 0.7 * euclid + 0.3 * hamNorm;
    return 1.0 - t2_clamp_(dist, 0, 1);
  }

  function penaltyFromMaxSim_(maxSim) {
    if (maxSim <= 0.8) return 0;

    // penalty = lerp(0.001, 0.05, (maxSim - 0.8) / 0.2)
    var t = (maxSim - 0.8) / 0.2;
    t = t2_clamp_(t, 0, 1);
    var penalty = (0.001 + (0.05 - 0.001) * t) * penaltyMultiplier; // fraction
    return penalty;
  }

  // 1) Base sort with original tie-break thresholds preserved
  evalResults.sort(function(a, b) {
    if (Math.abs(a.stats.weightedScore - b.stats.weightedScore) > 0.5) {
      return b.stats.weightedScore - a.stats.weightedScore;
    }
    if (Math.abs(a.stats.sideAccuracy - b.stats.sideAccuracy) > 0.25) {
      return b.stats.sideAccuracy - a.stats.sideAccuracy;
    }
    return (b.stats.coverage || 0) - (a.stats.coverage || 0);
  });

  Logger.log('[Rank] Re-ranking ' + evalResults.length + ' results with diversity penalty x' + penaltyMultiplier + '...');

  // 2) Prepare working copy with cached vectors + running max similarity
  var remaining = [];
  for (var r = 0; r < evalResults.length; r++) {
    var item = evalResults[r];
    remaining.push({
      item: item,
      vec: getVec_(item.config),
      maxSim: 0
    });
  }

  var selected = [];

  // Pick #1: highest base score (already at remaining[0])
  var first = remaining.shift();
  selected.push(first.item);

  // Initialize maxSim for all remaining against first
  for (var i = 0; i < remaining.length; i++) {
    remaining[i].maxSim = similarityVec_(remaining[i].vec, first.vec);
  }

  // Greedy pick rest
  while (remaining.length) {
    var bestIdx = 0;

    var best = remaining[0];
    var bestPenalty = penaltyFromMaxSim_(best.maxSim);
    var bestAdj = (Number(best.item.stats && best.item.stats.weightedScore) || 0) * (1 - bestPenalty);

    for (var k = 1; k < remaining.length; k++) {
      var cand = remaining[k];
      var pen = penaltyFromMaxSim_(cand.maxSim);
      var base = (Number(cand.item.stats && cand.item.stats.weightedScore) || 0);
      var adj = base * (1 - pen);

      // Use strict ">" so ties keep earlier base order (quirk-friendly)
      if (adj > bestAdj + 1e-9) {
        bestAdj = adj;
        bestIdx = k;
      }
    }

    var picked = remaining.splice(bestIdx, 1)[0];
    selected.push(picked.item);

    // Update each remaining candidate's maxSim using the newly selected item only
    for (var u = 0; u < remaining.length; u++) {
      var sim = similarityVec_(remaining[u].vec, picked.vec);
      if (sim > remaining[u].maxSim) remaining[u].maxSim = sim;
    }
  }

  // 3) Mutate evalResults in place
  evalResults.length = 0;
  for (var z = 0; z < selected.length; z++) evalResults.push(selected[z]);

  // Stash snapshot for write-time escalation
  evalResults._stash = selected.slice();
  evalResults._penaltyMultiplier = penaltyMultiplier;

  Logger.log('[Rank] Done. Top weighted=' + (evalResults[0].stats.weightedScore || 0).toFixed(1) + '%');
  return evalResults;
}


/**
 * PATCHED: picks top 3 with CORE diversity preference.
 *
 * Prefers:
 *  - total diff >= 2 AND core diff >= 1
 * Keeps picks close to best weighted score (widens band if needed).
 * Optional: MIN_COVERAGE gate (defaults OFF).
 * Guarantees no duplicates by config hash.
 */
function t2_pickTop3_(evalResults) {
  if (!evalResults || !evalResults.length) return { best: null, second: null, third: null };

  // Turn ON (e.g. 3.0 or 5.0) to avoid "accuracy by doing nothing" configs dominating.
  // NOTE: This gate applies to Rank #2/#3 selection (best stays evalResults[0]).
  var MIN_COVERAGE = 3.0;

  var best = evalResults[0];
  var bestScore = Number(best.stats && best.stats.weightedScore) || 0;

  function hashItem_(item) { return t2_configHash_(item.config); }

  function isCoverageOk_(item) {
    if (!MIN_COVERAGE || MIN_COVERAGE <= 0) return true;
    var cov = Number(item.stats && item.stats.coverage) || 0;
    return cov >= MIN_COVERAGE;
  }

  function alreadyUsed_(used, item) {
    return !!used[hashItem_(item)];
  }

  /**
   * Pick next candidate not in basePicks that satisfies:
   *  - weightedScore >= bestScore - scoreDrop
   *  - for each base pick: totalDiff >= minTotalDiff AND coreDiff >= minCoreDiff
   *  - optional: coverage >= MIN_COVERAGE
   */
  function pick_(basePicks, minTotalDiff, minCoreDiff, scoreDrop, used) {
    scoreDrop = (scoreDrop == null) ? 1.0 : scoreDrop;
    used = used || Object.create(null);

    for (var r = 0; r < evalResults.length; r++) {
      var cand = evalResults[r];
      if (!cand) continue;

      if (alreadyUsed_(used, cand)) continue;
      if (!isCoverageOk_(cand)) continue;

      var candScore = Number(cand.stats && cand.stats.weightedScore) || 0;
      if (candScore < bestScore - scoreDrop) continue;

      var ok = true;
      for (var j = 0; j < basePicks.length; j++) {
        var bp = basePicks[j];
        if (!bp) continue;

        var tDiff = t2_diffCount_(cand.config, bp.config);
        var cDiff = t2_coreDiffCount_(cand.config, bp.config);
        if (tDiff < minTotalDiff || cDiff < minCoreDiff) { ok = false; break; }
      }

      if (ok) return cand;
    }

    return null;
  }

  // Track used hashes so we never repeat configs
  var used = Object.create(null);
  used[hashItem_(best)] = true;

  // SECOND: prefer (total>=2 AND core>=1) within 1.0 of best, widen, then relax core
  var second =
    pick_([best], 2, 1, 1.0, used) ||
    pick_([best], 2, 1, 2.0, used) ||
    pick_([best], 2, 0, 1.0, used) ||
    pick_([best], 1, 0, 10.0, used) || // last-resort: anything not duplicate
    (evalResults[1] || best);

  used[hashItem_(second)] = true;

  // THIRD
  var third =
    pick_([best, second], 2, 1, 1.0, used) ||
    pick_([best, second], 2, 1, 2.0, used) ||
    pick_([best, second], 2, 0, 1.0, used) ||
    pick_([best, second], 1, 0, 10.0, used) ||
    (evalResults[2] || second);

  // Final hard de-dupe (in case fallback hit duplicates somehow)
  if (hashItem_(second) === hashItem_(best)) {
    second = pick_([best], 1, 0, 10.0, used) || second;
    used[hashItem_(second)] = true;
  }
  if (hashItem_(third) === hashItem_(best) || hashItem_(third) === hashItem_(second)) {
    third = pick_([best, second], 1, 0, 10.0, used) || third;
  }

  Logger.log(
    '[PickTop3] total/core diffs: ' +
    'b-2=' + t2_diffCount_(best.config, second.config) + '/' + t2_coreDiffCount_(best.config, second.config) + ', ' +
    'b-3=' + t2_diffCount_(best.config, third.config) + '/' + t2_coreDiffCount_(best.config, third.config) + ', ' +
    '2-3=' + t2_diffCount_(second.config, third.config) + '/' + t2_coreDiffCount_(second.config, third.config) +
    (MIN_COVERAGE > 0 ? (' (MIN_COVERAGE=' + MIN_COVERAGE + '%)') : '')
  );

  return { best: best, second: second, third: third };
}



/**
 * Backwards-compatible wrapper: keep your existing call sites untouched.
 * This calls writeProposalSheet_ (patched below).
 */
function t2_writeTier2ProposalSheet_(
  ss,
  cfgMap,
  bestConfig,
  secondConfig,
  thirdConfig,
  bestStats,
  currentStats,
  trainingSize,
  secondStats,
  thirdStats
) {
  return writeProposalSheet_(
    ss, cfgMap,
    bestConfig, secondConfig, thirdConfig,
    bestStats, currentStats, trainingSize,
    secondStats, thirdStats
  );
}


/**
 * Mutate HQ + Module 9 keys on candidate configs so the tuner
 * can actually optimize them. Keeps runtime bounded by mutating
 * only 1-3 extra params per candidate on ~60% of candidates.
 *
 * @param {Object[]} candidates - array of config objects
 * @param {Object} cfgMap - current config map (for fallback values)
 * @returns {Object[]} same array, mutated in place
 */
function t2_mutateTier2CandidatesExtras_(candidates, cfgMap) {
  if (!candidates || !candidates.length) return candidates;

  function rand_(a, b)   { return a + Math.random() * (b - a); }
  function rint_(a, b)   { return Math.floor(rand_(a, b + 1)); }
  function pick_(arr)    { return arr[Math.floor(Math.random() * arr.length)]; }

  var DOMAINS = [
    // HQ block
    { k: 'hq_enabled',             t: 'bool' },
    { k: 'hq_min_confidence',      t: 'int',  min: 40, max: 70 },
    { k: 'hq_skip_ties',           t: 'bool' },
    { k: 'hq_min_pwin',            t: 'num',  min: 0.20, max: 0.55 },
    { k: 'tieMargin',              t: 'num',  min: 0.5,  max: 3.5 },
    { k: 'highQtrTieMargin',       t: 'num',  min: 1.0,  max: 4.0 },
    { k: 'hq_softmax_temperature', t: 'int',  min: 2,    max: 12 },
    { k: 'hq_shrink_k',            t: 'int',  min: 5,    max: 30 },
    { k: 'hq_vol_weight',          t: 'num',  min: 0.0,  max: 1.0 },
    { k: 'hq_fb_weight',           t: 'num',  min: 0.0,  max: 0.8 },
    { k: 'hq_exempt_from_cap',     t: 'bool' },
    { k: 'hq_max_picks_per_slip',  t: 'int',  min: 1,    max: 4 },

    // Module 9
    { k: 'enableRobbers',          t: 'bool' },
    { k: 'enableFirstHalf',        t: 'bool' },
    { k: 'ftOUMinConf',            t: 'int',  min: 45, max: 70 }
  ];

  for (var i = 0; i < candidates.length; i++) {
    // Only mutate ~60% of candidates
    if (Math.random() > 0.60) continue;

    var c = candidates[i];
    if (!c) continue;

    // Mutate 1-3 random extra params
    var n = 1 + Math.floor(Math.random() * 3);
    for (var j = 0; j < n; j++) {
      var dom = pick_(DOMAINS);
      if (dom.t === 'bool') {
        c[dom.k] = (Math.random() < 0.5);
      } else if (dom.t === 'int') {
        c[dom.k] = rint_(dom.min, dom.max);
      } else if (dom.t === 'num') {
        c[dom.k] = Number(rand_(dom.min, dom.max).toFixed(3));
      }
    }
  }

  return candidates;
}



/**
 * Final completion banner logs + success alert + done toast.
 * Nested helper boolStr preserved here only.
 */
function t2_showFinalReport_(ss, ui, best, currentEval, trainingSetLength, dataConfidence, totalConfigsTested) {
  var diff = best.stats.weightedScore - currentEval.weightedScore;
  var diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';

  function boolStr(b) { return b ? 'TRUE' : 'FALSE'; }

  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('    ELITE TIER 2 CONFIG TUNING COMPLETE v5.1');
  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('Best config: threshold=' + best.config.threshold +
             ', momentum=' + best.config.momentumSwingFactor +
             ', variance=' + best.config.variancePenaltyFactor);
  Logger.log('Best flips: Q1=' + boolStr(best.config.q1_flip) +
             ', Q2=' + boolStr(best.config.q2_flip) +
             ', Q3=' + boolStr(best.config.q3_flip) +
             ', Q4=' + boolStr(best.config.q4_flip));
  Logger.log('Best scores: weighted=' + best.stats.weightedScore.toFixed(1) +
             '%, side=' + best.stats.sideAccuracy.toFixed(1) +
             '%, coverage=' + best.stats.coverage.toFixed(1) + '%');

  ui.alert(
    '✅ Elite Tier 2 Tuning Complete (v5.1)',
    'Training: ' + trainingSetLength + ' quarters\n' +
    'Data confidence: ' + (dataConfidence * 100).toFixed(0) + '%\n' +
    'Configs tested: ' + totalConfigsTested + '\n\n' +
    '🏆 PROPOSED (Bayesian-Optimized):\n' +
    '  Threshold: ' + best.config.threshold + '\n' +
    '  Momentum: ' + best.config.momentumSwingFactor + '\n' +
    '  Variance: ' + best.config.variancePenaltyFactor + '\n' +
    '  Confidence Scale: ' + best.config.confidence_scale + '\n' +
    '  Flips: Q1=' + boolStr(best.config.q1_flip) +
    ', Q2=' + boolStr(best.config.q2_flip) +
    ', Q3=' + boolStr(best.config.q3_flip) +
    ', Q4=' + boolStr(best.config.q4_flip) + '\n\n' +
    '📊 SCORES:\n' +
    '  Weighted Score: ' + best.stats.weightedScore.toFixed(1) + '%\n' +
    '  Side Accuracy: ' + best.stats.sideAccuracy.toFixed(1) + '%\n' +
    '  Coverage: ' + best.stats.coverage.toFixed(1) + '%\n\n' +
    '📈 CURRENT: ' + currentEval.weightedScore.toFixed(1) + '%\n' +
    '🚀 Change: ' + diffStr + '\n\n' +
    'Review Config_Tier2_Proposals to apply.',
    ui.ButtonSet.OK
  );

  ss.toast('Done! Best weighted: ' + best.stats.weightedScore.toFixed(1) + '%', 'Ma Golide Elite', 8);
}

/**
 * Runs a lightweight O/U tuner (using your existing t2ou_* functions) and returns top3.
 * This lets the Tier2 margins tuner actually optimize O/U keys and merge them into proposals.
 */
function t2_tuneOUForTier2_(ss, MAX) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  MAX = MAX || 1200;

  var needFns = [
    't2ou_buildOUTuningSamplesFromCleanSheets_',
    't2ou_splitTrainTestByGame_',
    't2ou_buildTotalsStatsFromRows_',
    't2ou_computeLeagueMeans_',
    't2ou_buildCandidateGrid_',
    't2ou_evalOUConfig_'
  ];

  for (var i = 0; i < needFns.length; i++) {
    if (typeof this[needFns[i]] !== 'function') {
      Logger.log('[Tier2] O/U mini-tuner skipped: missing ' + needFns[i]);
      return null;
    }
  }

  var samples = t2ou_buildOUTuningSamplesFromCleanSheets_(ss);
  if (!samples || samples.length < 300) {
    Logger.log('[Tier2] O/U mini-tuner skipped: not enough samples (' + (samples ? samples.length : 0) + '), need 300+');
    return null;
  }

  var split = t2ou_splitTrainTestByGame_(samples, 0.80);
  var train = split.train || [];
  var test = split.test || [];
  if (train.length < 100 || test.length < 100) {
    Logger.log('[Tier2] O/U mini-tuner skipped: train/test too small (' + train.length + '/' + test.length + ')');
    return null;
  }

  var trainBuilt = t2ou_buildTotalsStatsFromRows_(train);
  var proxyLine = t2ou_computeLeagueMeans_(train);

  var realLinesCount = 0;
  for (var r = 0; r < test.length; r++) if (isFinite(test[r].line)) realLinesCount++;
  var usingRealLines = realLinesCount >= Math.max(100, Math.floor(test.length * 0.15));
  var realLinePct = test.length ? Math.round((realLinesCount / test.length) * 100) : 0;

  var candidates = t2ou_buildCandidateGrid_(MAX);

  var results = [];
  for (var c = 0; c < candidates.length; c++) {
    var cand = candidates[c];
    var perf = t2ou_evalOUConfig_(test, trainBuilt.teamStats, trainBuilt.league, proxyLine, usingRealLines, cand);
    results.push({ config: cand, stats: perf });
  }

  results.sort(function(a, b) { return (b.stats.weightedScore || 0) - (a.stats.weightedScore || 0); });

  var top3 = results.slice(0, 3);
  if (top3.length < 1) return null;

  Logger.log('[Tier2] O/U mini-tuner done: usingRealLines=' + usingRealLines + ' (' + realLinePct + '%), topScore=' +
             (top3[0].stats.weightedScore != null ? top3[0].stats.weightedScore.toFixed(3) : 'n/a'));

  return {
    best: top3[0] || null,
    second: top3[1] || null,
    third: top3[2] || null,
    meta: {
      allSamples: samples.length,
      trainSamples: train.length,
      testSamples: test.length,
      usingRealLines: usingRealLines,
      realLinePct: realLinePct
    }
  };
}

/** Merges O/U keys into an existing Tier2 config object (shallow copy; base preserved). */
function t2_mergeOUIntoTier2Config_(baseCfg, ouCfg) {
  var out = {};
  baseCfg = baseCfg || {};
  ouCfg = ouCfg || {};

  Object.keys(baseCfg).forEach(function(k) { out[k] = baseCfg[k]; });

  var ouKeys = [
    'ou_edge_threshold', 'ou_min_samples', 'ou_min_ev', 'ou_confidence_scale',
    'ou_shrink_k', 'ou_sigma_floor', 'ou_sigma_scale', 'ou_american_odds',
    'ou_model_error', 'ou_prob_temp', 'ou_use_effn',
    'ou_confidence_shrink_min', 'ou_confidence_shrink_max'
  ];

  ouKeys.forEach(function(k) {
    if (ouCfg[k] !== undefined && ouCfg[k] !== '') out[k] = ouCfg[k];
  });

  return out;
}


/**
 * Main Tier 2 tuner with time-budget guard
 * PATCHED:
 *   - cur object carries ALL config keys (HQ + Module 9 + everything)
 *   - Candidates get extra-key mutations via t2_mutateTier2CandidatesExtras_
 *   - Bounded search, cached standings, persistent logging
 *
 * @param {Spreadsheet} ss
 * @returns {Object} Top 3 results (if successful)
 */
function tuneTier2Config(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var runId = 'T2TUNE_' + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );
  var START = Date.now();
  var MAX_RUNTIME_MS = 330000; // 5.5 minutes

  function shouldStop_() {
    return (Date.now() - START) > MAX_RUNTIME_MS;
  }
  function elapsedSec_() {
    return ((Date.now() - START) / 1000).toFixed(1);
  }

  t2_log_(ss, runId, 'Start. budgetSec=' + (MAX_RUNTIME_MS / 1000));

  try {
    // Guard required functions
    var required = [
      ['t2_loadTier2RawGameData_',            typeof t2_loadTier2RawGameData_ === 'function'],
      ['t2_detectTier2ColumnFormat_',          typeof t2_detectTier2ColumnFormat_ === 'function'],
      ['t2_loadTier2MarginStatsWithReset_',    typeof t2_loadTier2MarginStatsWithReset_ === 'function'],
      ['t2_makeConfidenceCalculator_',         typeof t2_makeConfidenceCalculator_ === 'function'],
      ['t2_makeTier2Evaluator_',               typeof t2_makeTier2Evaluator_ === 'function'],
      ['t2_buildTier2SearchSpace_',            typeof t2_buildTier2SearchSpace_ === 'function'],
      ['t2_rankEvalResults_',                  typeof t2_rankEvalResults_ === 'function'],
      ['t2_pickTop3_',                         typeof t2_pickTop3_ === 'function'],
      ['t2_evaluateCurrentConfig_',            typeof t2_evaluateCurrentConfig_ === 'function']
    ];

    for (var i = 0; i < required.length; i++) {
      if (!required[i][1]) {
        throw new Error('tuneTier2Config: missing required function ' + required[i][0]);
      }
    }

    // Optional banner
    if (typeof t2_logTunerBanner_ === 'function') {
      try { t2_logTunerBanner_(ss); } catch (eB) {}
    }

    // Load context
    var ctx = t2_loadTier2TuningContext_(ss);
    var confidenceCalc = t2_makeConfidenceCalculator_();

    // Load raw data
    var raw = t2_loadTier2RawGameData_(ss, confidenceCalc.calculateConfidence);
    var fmt = t2_detectTier2ColumnFormat_(raw.headers, raw.allGames);

    // Load margin stats
    var marginStats = t2_loadTier2MarginStatsWithReset_();

    // Build training set
    t2_log_(ss, runId, 'Build trainingSet...');
    var trainingSet = t2_buildTier2TrainingSet_(
      ss,
      raw.allGames,
      fmt.headerMap,
      fmt.hasSeparateCols,
      fmt.hasConcatCols,
      marginStats,
      ctx.currentConfig,
      ctx.curConfidenceScale,
      confidenceCalc
    );
    t2_log_(ss, runId, 'Training size=' + trainingSet.length + ' elapsed=' + elapsedSec_() + 's');

    // Low data guard
    if (typeof t2_handleLowDataCase_ === 'function') {
      if (t2_handleLowDataCase_(ss, ui, ctx.cfgMap, trainingSet.length)) {
        t2_log_(ss, runId, 'Low-data guard exit.');
        return;
      }
    }

    // Create evaluator (pure compute, no sheet reads)
    var evalFn = t2_makeTier2Evaluator_(
      trainingSet,
      confidenceCalc.calculateConfidence,
      ctx.curConfidenceScale
    );

    // Build search space and sample candidates
    var space = t2_buildTier2SearchSpace_(ctx.curThreshold, ctx.curMom, ctx.curVar);

    // ── Helper to read from currentConfig with case-insensitive fallback ──
    function cc_(key, fb) {
      if (ctx.currentConfig && ctx.currentConfig[key] !== undefined) return ctx.currentConfig[key];
      var lk = key.toLowerCase();
      if (ctx.currentConfig && ctx.currentConfig[lk] !== undefined) return ctx.currentConfig[lk];
      if (ctx.cfgMap && ctx.cfgMap[lk] !== undefined) return ctx.cfgMap[lk];
      return fb;
    }

    var cur = {
      threshold:              Number(ctx.curThreshold),
      momentumSwingFactor:    Number(ctx.curMom),
      variancePenaltyFactor:  Number(ctx.curVar),
      q1_flip:                !!ctx.currentConfig.q1_flip,
      q2_flip:                !!ctx.currentConfig.q2_flip,
      q3_flip:                !!ctx.currentConfig.q3_flip,
      q4_flip:                !!ctx.currentConfig.q4_flip,
      confidence_scale:       Number(ctx.curConfidenceScale) || 30,
      strong_target:          Number(ctx.currentConfig.strong_target) || 0.75,
      medium_target:          Number(ctx.currentConfig.medium_target) || 0.65,
      even_target:            Number(ctx.currentConfig.even_target) || 0.55,

      // NEW FRIENDS
      forebet_blend_enabled:       cc_('forebet_blend_enabled', true),
      forebet_ou_weight_qtr:       cc_('forebet_ou_weight_qtr', 0.25),
      forebet_ou_weight_ft:        cc_('forebet_ou_weight_ft', 2.0),
      highest_q_tie_policy:        cc_('highest_q_tie_policy', 'first'),
      highest_q_tie_conf_penalty:  cc_('highest_q_tie_conf_penalty', 0.10),

      // HQ PARAMS (PATCH — previously missing from cur)
      hq_enabled:              cc_('hq_enabled', true),
      hq_min_confidence:       cc_('hq_min_confidence', 52),
      hq_skip_ties:            cc_('hq_skip_ties', true),
      hq_min_pwin:             cc_('hq_min_pwin', 0.3),
      tieMargin:               cc_('tieMargin', 1.5),
      highQtrTieMargin:        cc_('highQtrTieMargin', 2.5),
      hq_softmax_temperature:  cc_('hq_softmax_temperature', 6),
      hq_shrink_k:             cc_('hq_shrink_k', 15),
      hq_vol_weight:           cc_('hq_vol_weight', 0.4),
      hq_fb_weight:            cc_('hq_fb_weight', 0.25),
      hq_exempt_from_cap:      cc_('hq_exempt_from_cap', false),
      hq_max_picks_per_slip:   cc_('hq_max_picks_per_slip', 2),

      // MODULE 9 (PATCH — previously missing from cur)
      enableRobbers:           cc_('enableRobbers', true),
      enableFirstHalf:         cc_('enableFirstHalf', true),
      ftOUMinConf:             cc_('ftOUMinConf', 55)
    };

    // PATCH: also carry any other keys from currentConfig not yet in cur
    if (ctx.currentConfig) {
      Object.keys(ctx.currentConfig).forEach(function(k) {
        if (cur[k] === undefined) cur[k] = ctx.currentConfig[k];
      });
    }

    var candidates = t2_sampleTier2Candidates_(space, cur, 520);

    // PATCH: mutate HQ + Module9 params on candidates so tuner actually optimizes them
    if (typeof t2_mutateTier2CandidatesExtras_ === 'function') {
      candidates = t2_mutateTier2CandidatesExtras_(candidates, ctx.cfgMap);
    }

    t2_log_(ss, runId, 'Candidates=' + candidates.length);

    // Evaluate candidates with time guard
    var evalResults = [];
    for (var c = 0; c < candidates.length; c++) {
      if (shouldStop_()) {
        t2_log_(ss, runId, 'Stop(time) at i=' + c + ' evals=' + evalResults.length);
        break;
      }

      var cfgCandidate = candidates[c];
      var stats = null;
      try {
        stats = evalFn(cfgCandidate);
      } catch (eEval) {
        stats = null;
      }
      if (!stats) continue;

      evalResults.push({ config: cfgCandidate, stats: stats });

      if (c % 100 === 0) {
        t2_log_(ss, runId, 'Progress i=' + c + '/' + candidates.length + ' elapsed=' + elapsedSec_());
      }
    }

    if (!evalResults.length) {
      throw new Error('No configs evaluated (evalFn returned null for all).');
    }

    // Store for diversity logic
    evalResults._space = space;
    evalResults._runId = runId;

    // Rank and cache
    t2_rankEvalResults_(evalResults);
    t2_lastEvalResults = evalResults;

    var top3 = t2_pickTop3_(evalResults);
    var currentEval = t2_evaluateCurrentConfig_(ctx, evalFn);

    // Optional O/U merge
    if (!shouldStop_() &&
        typeof t2_tuneOUForTier2_ === 'function' &&
        typeof t2_mergeOUIntoTier2Config_ === 'function') {
      try {
        t2_log_(ss, runId, 'Tuning O/U...');
        var ouTop3 = t2_tuneOUForTier2_(ss, 800);
        if (ouTop3 && ouTop3.best && ouTop3.best.config) {
          top3.best.config = t2_mergeOUIntoTier2Config_(top3.best.config, ouTop3.best.config);
          if (top3.second && top3.second.config) {
            top3.second.config = t2_mergeOUIntoTier2Config_(
              top3.second.config,
              (ouTop3.second && ouTop3.second.config) ? ouTop3.second.config : ouTop3.best.config
            );
          }
          if (top3.third && top3.third.config) {
            top3.third.config = t2_mergeOUIntoTier2Config_(
              top3.third.config,
              (ouTop3.third && ouTop3.third.config) ? ouTop3.third.config : ouTop3.best.config
            );
          }
          t2_log_(ss, runId, 'O/U merge complete.');
        }
      } catch (eOU) {
        t2_log_(ss, runId, 'O/U merge failed: ' + eOU.message);
      }
    }

    // Write proposals
    var writerFn = (typeof t2_writeTier2ProposalSheet_ === 'function')
      ? t2_writeTier2ProposalSheet_
      : (typeof writeProposalSheet_ === 'function')
        ? writeProposalSheet_
        : null;

    if (!writerFn) throw new Error('No proposal writer found.');

    writerFn(
      ss,
      ctx.cfgMap,
      top3.best.config,
      top3.second ? top3.second.config : null,
      top3.third  ? top3.third.config  : null,
      top3.best.stats,
      currentEval,
      trainingSet.length,
      top3.second ? top3.second.stats : null,
      top3.third  ? top3.third.stats  : null
    );

    t2_log_(ss, runId, 'Done. evals=' + evalResults.length + ' elapsed=' + elapsedSec_() + 's');

    // Final report
    if (typeof t2_showFinalReport_ === 'function' && !shouldStop_()) {
      t2_showFinalReport_(
        ss, ui, top3.best, currentEval,
        trainingSet.length, raw.dataConfidence, evalResults.length
      );
    }

    return top3;

  } catch (e) {
    try {
      if (typeof t2_handleTuneTier2Error_ === 'function') {
        t2_handleTuneTier2Error_(ui, e);
      }
    } catch (e2) {}
    t2_log_(ss, runId, 'FAILED: ' + (e && e.stack ? e.stack : e));
    throw e;
  }
}



/**
 * Writes tuning proposals to Config_Tier2_Proposals sheet.
 *
 * PATCHED:
 *   - Added  --- HQ PARAMS ---  section  (12 keys)
 *   - Added  --- MODULE 9 ENHANCEMENTS ---  section  (3 keys)
 *   - Auto-appends any MISSING keys from Config_Tier2 (future-proof)
 *   - Updated fmtByKey / textKeys maps for correct formatting
 *   - Diversity re-rank escalation preserved
 */
function writeProposalSheet_(
  ss, cfgMap, bestConfig, secondConfig, thirdConfig,
  bestStats, currentStats, trainingSize, secondStats, thirdStats
) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  /* ── Null-safe config access ─────────────────────────────────── */
  bestConfig   = bestConfig   || {};
  secondConfig = secondConfig || {};
  thirdConfig  = thirdConfig  || {};

  /* ── Diversity validation ────────────────────────────────────── */
  function validate_(a, b, c) {
    var d12 = (typeof t2_diffCount_ === 'function') ? t2_diffCount_(a, b) : 0;
    var c12 = (typeof t2_coreDiffCount_ === 'function') ? t2_coreDiffCount_(a, b) : 0;
    var d13 = (typeof t2_diffCount_ === 'function') ? t2_diffCount_(a, c) : 0;
    var c13 = (typeof t2_coreDiffCount_ === 'function') ? t2_coreDiffCount_(a, c) : 0;
    var d23 = (typeof t2_diffCount_ === 'function') ? t2_diffCount_(b, c) : 0;
    var c23 = (typeof t2_coreDiffCount_ === 'function') ? t2_coreDiffCount_(b, c) : 0;
    var ok = (d12 >= 3 && c12 >= 1) && (d13 >= 3 && c13 >= 1) && (d23 >= 2 && c23 >= 1);
    return { ok: ok };
  }

  var v0 = validate_(bestConfig, secondConfig, thirdConfig);
  if (!v0.ok && typeof t2_lastEvalResults !== 'undefined' && t2_lastEvalResults && t2_lastEvalResults._stash && t2_lastEvalResults._stash.length) {
    Logger.log('[Write] Low diversity; reranking with 2x penalty');
    var stash = t2_lastEvalResults._stash.slice();
    if (typeof t2_rankEvalResults_ === 'function') t2_rankEvalResults_(stash, 2.0);
    if (typeof t2_pickTop3_ === 'function') {
      var top3 = t2_pickTop3_(stash);
      bestConfig   = top3.best.config;    bestStats   = top3.best.stats;
      secondConfig = top3.second.config;  secondStats = top3.second.stats;
      thirdConfig  = top3.third.config;   thirdStats  = top3.third.stats;
    }
  }

  /* ── Sheet setup ─────────────────────────────────────────────── */
  var propSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Config_Tier2_Proposals')
    : ss.getSheetByName('Config_Tier2_Proposals');
  if (!propSheet) propSheet = ss.insertSheet('Config_Tier2_Proposals');
  propSheet.clear();

  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  var newVersion = 't2_elite_' + ts;

  /* ── Value helpers ───────────────────────────────────────────── */
  function cfgVal(k, fb) {
    if (!cfgMap) return fb;
    var v = cfgMap[k];
    if (v === undefined) v = cfgMap[k.toLowerCase()];
    if (v === undefined) v = cfgMap[String(k).replace(/([A-Z])/g, '_$1').toLowerCase()];
    return (v === undefined) ? fb : v;
  }
  function num_(x, fb)  { var n = Number(x);       return isNaN(n) ? fb : n; }
  function int_(x, fb)  { var n = parseInt(x, 10);  return isNaN(n) ? fb : n; }
  function boolVal_(v, fb) {
    if (v === true || v === false) return v;
    var s = String(v == null ? '' : v).toUpperCase().trim();
    if (s === 'TRUE')  return true;
    if (s === 'FALSE') return false;
    return !!fb;
  }
  function boolStr(b)   { return b ? 'TRUE' : 'FALSE'; }
  function fmtPct_(n)   { if (n == null || isNaN(n)) return '-'; return Number(n).toFixed(1) + '%'; }
  function safeInt_(n)  { var x = parseInt(n, 10); return isNaN(x) ? '-' : x; }

  function pickCfg_(cfgObj, key, fb) {
    if (!cfgObj) return fb;
    if (cfgObj[key] !== undefined && cfgObj[key] !== '') return cfgObj[key];
    var lk = key.toLowerCase();
    if (cfgObj[lk] !== undefined && cfgObj[lk] !== '') return cfgObj[lk];
    return cfgVal(key, fb);
  }

  /* ── Build rows ──────────────────────────────────────────────── */
  var rows = [
    ['Parameter', 'PROPOSED (Elite Best)', 'Current', 'Rank #2', 'Rank #3'],
    ['config_version', newVersion, String(cfgVal('config_version', '') || ''), newVersion + '_2', newVersion + '_3'],

    // ═══════════════════════════════════════════════════════════
    // NEW FRIENDS
    // ═══════════════════════════════════════════════════════════
    ['--- NEW FRIENDS ---', '---', '---', '---', '---'],
    ['forebet_blend_enabled',
      boolStr(boolVal_(pickCfg_(bestConfig,   'forebet_blend_enabled', cfgVal('forebet_blend_enabled', 'TRUE')), true)),
      boolStr(boolVal_(cfgVal('forebet_blend_enabled', 'TRUE'), true)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'forebet_blend_enabled', cfgVal('forebet_blend_enabled', 'TRUE')), true)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'forebet_blend_enabled', cfgVal('forebet_blend_enabled', 'TRUE')), true))
    ],
    ['forebet_ou_weight_qtr',
      num_(pickCfg_(bestConfig,   'forebet_ou_weight_qtr', 0.25), 0.25),
      num_(cfgVal('forebet_ou_weight_qtr', 0.25), 0.25),
      num_(pickCfg_(secondConfig, 'forebet_ou_weight_qtr', 0.25), 0.25),
      num_(pickCfg_(thirdConfig,  'forebet_ou_weight_qtr', 0.25), 0.25)
    ],
    ['forebet_ou_weight_ft',
      num_(pickCfg_(bestConfig,   'forebet_ou_weight_ft', 2.0), 2.0),
      num_(cfgVal('forebet_ou_weight_ft', 2.0), 2.0),
      num_(pickCfg_(secondConfig, 'forebet_ou_weight_ft', 2.0), 2.0),
      num_(pickCfg_(thirdConfig,  'forebet_ou_weight_ft', 2.0), 2.0)
    ],
    ['highest_q_tie_policy',
      String(pickCfg_(bestConfig,   'highest_q_tie_policy', cfgVal('highest_q_tie_policy', 'first'))),
      String(cfgVal('highest_q_tie_policy', 'first')),
      String(pickCfg_(secondConfig, 'highest_q_tie_policy', cfgVal('highest_q_tie_policy', 'first'))),
      String(pickCfg_(thirdConfig,  'highest_q_tie_policy', cfgVal('highest_q_tie_policy', 'first')))
    ],
    ['highest_q_tie_conf_penalty',
      num_(pickCfg_(bestConfig,   'highest_q_tie_conf_penalty', 0.10), 0.10),
      num_(cfgVal('highest_q_tie_conf_penalty', 0.10), 0.10),
      num_(pickCfg_(secondConfig, 'highest_q_tie_conf_penalty', 0.10), 0.10),
      num_(pickCfg_(thirdConfig,  'highest_q_tie_conf_penalty', 0.10), 0.10)
    ],

    // ═══════════════════════════════════════════════════════════
    // CORE PARAMS
    // ═══════════════════════════════════════════════════════════
    ['--- CORE PARAMS ---', '---', '---', '---', '---'],
    ['threshold',
      num_(bestConfig.threshold, 2.5),
      num_(cfgVal('threshold', 2.5), 2.5),
      num_(secondConfig.threshold, 2.5),
      num_(thirdConfig.threshold, 2.5)
    ],
    ['momentum_swing_factor',
      num_(bestConfig.momentumSwingFactor, 0.15),
      num_(cfgVal('momentum_swing_factor', 0.15), 0.15),
      num_(secondConfig.momentumSwingFactor, 0.15),
      num_(thirdConfig.momentumSwingFactor, 0.15)
    ],
    ['variance_penalty_factor',
      num_(bestConfig.variancePenaltyFactor, 0.20),
      num_(cfgVal('variance_penalty_factor', 0.20), 0.20),
      num_(secondConfig.variancePenaltyFactor, 0.20),
      num_(thirdConfig.variancePenaltyFactor, 0.20)
    ],
    ['decay',
      num_(cfgVal('decay', 0.9), 0.9),
      num_(cfgVal('decay', 0.9), 0.9),
      num_(cfgVal('decay', 0.9), 0.9),
      num_(cfgVal('decay', 0.9), 0.9)
    ],
    ['h2h_boost',
      num_(cfgVal('h2h_boost', 1), 1),
      num_(cfgVal('h2h_boost', 1), 1),
      num_(cfgVal('h2h_boost', 1), 1),
      num_(cfgVal('h2h_boost', 1), 1)
    ],

    // ═══════════════════════════════════════════════════════════
    // FLIP PATTERNS
    // ═══════════════════════════════════════════════════════════
    ['--- FLIP PATTERNS ---', '---', '---', '---', '---'],
    ['q1_flip', boolStr(!!bestConfig.q1_flip), String(cfgVal('q1_flip', 'FALSE')), boolStr(!!secondConfig.q1_flip), boolStr(!!thirdConfig.q1_flip)],
    ['q2_flip', boolStr(!!bestConfig.q2_flip), String(cfgVal('q2_flip', 'FALSE')), boolStr(!!secondConfig.q2_flip), boolStr(!!thirdConfig.q2_flip)],
    ['q3_flip', boolStr(!!bestConfig.q3_flip), String(cfgVal('q3_flip', 'FALSE')), boolStr(!!secondConfig.q3_flip), boolStr(!!thirdConfig.q3_flip)],
    ['q4_flip', boolStr(!!bestConfig.q4_flip), String(cfgVal('q4_flip', 'FALSE')), boolStr(!!secondConfig.q4_flip), boolStr(!!thirdConfig.q4_flip)],

    // ═══════════════════════════════════════════════════════════
    // ELITE PARAMS
    // ═══════════════════════════════════════════════════════════
    ['--- ELITE PARAMS ---', '---', '---', '---', '---'],
    ['strong_target',
      num_(bestConfig.strong_target, 0.75),
      num_(cfgVal('strong_target', 0.75), 0.75),
      num_(secondConfig.strong_target, 0.75),
      num_(thirdConfig.strong_target, 0.75)
    ],
    ['medium_target',
      num_(bestConfig.medium_target, 0.65),
      num_(cfgVal('medium_target', 0.65), 0.65),
      num_(secondConfig.medium_target, 0.65),
      num_(thirdConfig.medium_target, 0.65)
    ],
    ['even_target',
      num_(bestConfig.even_target, 0.55),
      num_(cfgVal('even_target', 0.55), 0.55),
      num_(secondConfig.even_target, 0.55),
      num_(thirdConfig.even_target, 0.55)
    ],
    ['confidence_scale',
      int_(bestConfig.confidence_scale, 30),
      int_(cfgVal('confidence_scale', 30), 30),
      int_(secondConfig.confidence_scale, 30),
      int_(thirdConfig.confidence_scale, 30)
    ],

    // ═══════════════════════════════════════════════════════════
    // O/U PARAMS
    // ═══════════════════════════════════════════════════════════
    ['--- O/U PARAMS ---', '---', '---', '---', '---'],
    ['ou_edge_threshold',
      num_(pickCfg_(bestConfig,   'ou_edge_threshold', 0.015), 0.015),
      num_(cfgVal('ou_edge_threshold', 0.015), 0.015),
      num_(pickCfg_(secondConfig, 'ou_edge_threshold', 0.015), 0.015),
      num_(pickCfg_(thirdConfig,  'ou_edge_threshold', 0.015), 0.015)
    ],
    ['ou_min_samples',
      int_(pickCfg_(bestConfig,   'ou_min_samples', 6), 6),
      int_(cfgVal('ou_min_samples', 6), 6),
      int_(pickCfg_(secondConfig, 'ou_min_samples', 6), 6),
      int_(pickCfg_(thirdConfig,  'ou_min_samples', 6), 6)
    ],
    ['ou_min_ev',
      num_(pickCfg_(bestConfig,   'ou_min_ev', 0.005), 0.005),
      num_(cfgVal('ou_min_ev', 0.005), 0.005),
      num_(pickCfg_(secondConfig, 'ou_min_ev', 0.005), 0.005),
      num_(pickCfg_(thirdConfig,  'ou_min_ev', 0.005), 0.005)
    ],
    ['ou_confidence_scale',
      int_(pickCfg_(bestConfig,   'ou_confidence_scale', 25), 25),
      int_(cfgVal('ou_confidence_scale', 25), 25),
      int_(pickCfg_(secondConfig, 'ou_confidence_scale', 25), 25),
      int_(pickCfg_(thirdConfig,  'ou_confidence_scale', 25), 25)
    ],
    ['ou_shrink_k',
      int_(pickCfg_(bestConfig,   'ou_shrink_k', 8), 8),
      int_(cfgVal('ou_shrink_k', 8), 8),
      int_(pickCfg_(secondConfig, 'ou_shrink_k', 8), 8),
      int_(pickCfg_(thirdConfig,  'ou_shrink_k', 8), 8)
    ],
    ['ou_sigma_floor',
      num_(pickCfg_(bestConfig,   'ou_sigma_floor', 6), 6),
      num_(cfgVal('ou_sigma_floor', 6), 6),
      num_(pickCfg_(secondConfig, 'ou_sigma_floor', 6), 6),
      num_(pickCfg_(thirdConfig,  'ou_sigma_floor', 6), 6)
    ],
    ['ou_sigma_scale',
      num_(pickCfg_(bestConfig,   'ou_sigma_scale', 1.0), 1.0),
      num_(cfgVal('ou_sigma_scale', 1.0), 1.0),
      num_(pickCfg_(secondConfig, 'ou_sigma_scale', 1.0), 1.0),
      num_(pickCfg_(thirdConfig,  'ou_sigma_scale', 1.0), 1.0)
    ],
    ['ou_american_odds',
      int_(pickCfg_(bestConfig,   'ou_american_odds', -110), -110),
      int_(cfgVal('ou_american_odds', -110), -110),
      int_(pickCfg_(secondConfig, 'ou_american_odds', -110), -110),
      int_(pickCfg_(thirdConfig,  'ou_american_odds', -110), -110)
    ],
    ['ou_model_error',
      num_(pickCfg_(bestConfig,   'ou_model_error', 4), 4),
      num_(cfgVal('ou_model_error', 4), 4),
      num_(pickCfg_(secondConfig, 'ou_model_error', 4), 4),
      num_(pickCfg_(thirdConfig,  'ou_model_error', 4), 4)
    ],
    ['ou_prob_temp',
      num_(pickCfg_(bestConfig,   'ou_prob_temp', 1.30), 1.30),
      num_(cfgVal('ou_prob_temp', 1.30), 1.30),
      num_(pickCfg_(secondConfig, 'ou_prob_temp', 1.30), 1.30),
      num_(pickCfg_(thirdConfig,  'ou_prob_temp', 1.30), 1.30)
    ],
    ['ou_use_effn',
      boolStr(boolVal_(pickCfg_(bestConfig,   'ou_use_effn', cfgVal('ou_use_effn', 'TRUE')), true)),
      boolStr(boolVal_(cfgVal('ou_use_effn', 'TRUE'), true)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'ou_use_effn', cfgVal('ou_use_effn', 'TRUE')), true)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'ou_use_effn', cfgVal('ou_use_effn', 'TRUE')), true))
    ],
    ['ou_confidence_shrink_min',
      num_(pickCfg_(bestConfig,   'ou_confidence_shrink_min', 0.25), 0.25),
      num_(cfgVal('ou_confidence_shrink_min', 0.25), 0.25),
      num_(pickCfg_(secondConfig, 'ou_confidence_shrink_min', 0.25), 0.25),
      num_(pickCfg_(thirdConfig,  'ou_confidence_shrink_min', 0.25), 0.25)
    ],
    ['ou_confidence_shrink_max',
      num_(pickCfg_(bestConfig,   'ou_confidence_shrink_max', 0.90), 0.90),
      num_(cfgVal('ou_confidence_shrink_max', 0.90), 0.90),
      num_(pickCfg_(secondConfig, 'ou_confidence_shrink_max', 0.90), 0.90),
      num_(pickCfg_(thirdConfig,  'ou_confidence_shrink_max', 0.90), 0.90)
    ],
    ['debug_ou_logging',
      String(pickCfg_(bestConfig,   'debug_ou_logging', cfgVal('debug_ou_logging', 'FALSE'))),
      String(cfgVal('debug_ou_logging', 'FALSE')),
      String(pickCfg_(secondConfig, 'debug_ou_logging', cfgVal('debug_ou_logging', 'FALSE'))),
      String(pickCfg_(thirdConfig,  'debug_ou_logging', cfgVal('debug_ou_logging', 'FALSE')))
    ],

    // ═══════════════════════════════════════════════════════════
    // HQ PARAMS  (PATCH — previously missing from proposals)
    // ═══════════════════════════════════════════════════════════
    ['--- HQ PARAMS ---', '---', '---', '---', '---'],
    ['hq_enabled',
      boolStr(boolVal_(pickCfg_(bestConfig,   'hq_enabled', cfgVal('hq_enabled', true)), true)),
      boolStr(boolVal_(cfgVal('hq_enabled', true), true)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'hq_enabled', cfgVal('hq_enabled', true)), true)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'hq_enabled', cfgVal('hq_enabled', true)), true))
    ],
    ['hq_min_confidence',
      int_(pickCfg_(bestConfig,   'hq_min_confidence', cfgVal('hq_min_confidence', 52)), 52),
      int_(cfgVal('hq_min_confidence', 52), 52),
      int_(pickCfg_(secondConfig, 'hq_min_confidence', cfgVal('hq_min_confidence', 52)), 52),
      int_(pickCfg_(thirdConfig,  'hq_min_confidence', cfgVal('hq_min_confidence', 52)), 52)
    ],
    ['hq_skip_ties',
      boolStr(boolVal_(pickCfg_(bestConfig,   'hq_skip_ties', cfgVal('hq_skip_ties', true)), true)),
      boolStr(boolVal_(cfgVal('hq_skip_ties', true), true)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'hq_skip_ties', cfgVal('hq_skip_ties', true)), true)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'hq_skip_ties', cfgVal('hq_skip_ties', true)), true))
    ],
    ['hq_min_pwin',
      num_(pickCfg_(bestConfig,   'hq_min_pwin', cfgVal('hq_min_pwin', 0.3)), 0.3),
      num_(cfgVal('hq_min_pwin', 0.3), 0.3),
      num_(pickCfg_(secondConfig, 'hq_min_pwin', cfgVal('hq_min_pwin', 0.3)), 0.3),
      num_(pickCfg_(thirdConfig,  'hq_min_pwin', cfgVal('hq_min_pwin', 0.3)), 0.3)
    ],
    ['tieMargin',
      num_(pickCfg_(bestConfig,   'tieMargin', cfgVal('tieMargin', 1.5)), 1.5),
      num_(cfgVal('tieMargin', 1.5), 1.5),
      num_(pickCfg_(secondConfig, 'tieMargin', cfgVal('tieMargin', 1.5)), 1.5),
      num_(pickCfg_(thirdConfig,  'tieMargin', cfgVal('tieMargin', 1.5)), 1.5)
    ],
    ['hq_softmax_temperature',
      num_(pickCfg_(bestConfig,   'hq_softmax_temperature', cfgVal('hq_softmax_temperature', 6)), 6),
      num_(cfgVal('hq_softmax_temperature', 6), 6),
      num_(pickCfg_(secondConfig, 'hq_softmax_temperature', cfgVal('hq_softmax_temperature', 6)), 6),
      num_(pickCfg_(thirdConfig,  'hq_softmax_temperature', cfgVal('hq_softmax_temperature', 6)), 6)
    ],
    ['hq_shrink_k',
      int_(pickCfg_(bestConfig,   'hq_shrink_k', cfgVal('hq_shrink_k', 15)), 15),
      int_(cfgVal('hq_shrink_k', 15), 15),
      int_(pickCfg_(secondConfig, 'hq_shrink_k', cfgVal('hq_shrink_k', 15)), 15),
      int_(pickCfg_(thirdConfig,  'hq_shrink_k', cfgVal('hq_shrink_k', 15)), 15)
    ],
    ['hq_vol_weight',
      num_(pickCfg_(bestConfig,   'hq_vol_weight', cfgVal('hq_vol_weight', 0.4)), 0.4),
      num_(cfgVal('hq_vol_weight', 0.4), 0.4),
      num_(pickCfg_(secondConfig, 'hq_vol_weight', cfgVal('hq_vol_weight', 0.4)), 0.4),
      num_(pickCfg_(thirdConfig,  'hq_vol_weight', cfgVal('hq_vol_weight', 0.4)), 0.4)
    ],
    ['hq_fb_weight',
      num_(pickCfg_(bestConfig,   'hq_fb_weight', cfgVal('hq_fb_weight', 0.25)), 0.25),
      num_(cfgVal('hq_fb_weight', 0.25), 0.25),
      num_(pickCfg_(secondConfig, 'hq_fb_weight', cfgVal('hq_fb_weight', 0.25)), 0.25),
      num_(pickCfg_(thirdConfig,  'hq_fb_weight', cfgVal('hq_fb_weight', 0.25)), 0.25)
    ],
    ['hq_exempt_from_cap',
      boolStr(boolVal_(pickCfg_(bestConfig,   'hq_exempt_from_cap', cfgVal('hq_exempt_from_cap', false)), false)),
      boolStr(boolVal_(cfgVal('hq_exempt_from_cap', false), false)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'hq_exempt_from_cap', cfgVal('hq_exempt_from_cap', false)), false)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'hq_exempt_from_cap', cfgVal('hq_exempt_from_cap', false)), false))
    ],
    ['hq_max_picks_per_slip',
      int_(pickCfg_(bestConfig,   'hq_max_picks_per_slip', cfgVal('hq_max_picks_per_slip', 2)), 2),
      int_(cfgVal('hq_max_picks_per_slip', 2), 2),
      int_(pickCfg_(secondConfig, 'hq_max_picks_per_slip', cfgVal('hq_max_picks_per_slip', 2)), 2),
      int_(pickCfg_(thirdConfig,  'hq_max_picks_per_slip', cfgVal('hq_max_picks_per_slip', 2)), 2)
    ],
    ['highQtrTieMargin',
      num_(pickCfg_(bestConfig,   'highQtrTieMargin', cfgVal('highQtrTieMargin', 2.5)), 2.5),
      num_(cfgVal('highQtrTieMargin', 2.5), 2.5),
      num_(pickCfg_(secondConfig, 'highQtrTieMargin', cfgVal('highQtrTieMargin', 2.5)), 2.5),
      num_(pickCfg_(thirdConfig,  'highQtrTieMargin', cfgVal('highQtrTieMargin', 2.5)), 2.5)
    ],

    // ═══════════════════════════════════════════════════════════
    // MODULE 9 ENHANCEMENTS  (PATCH — previously missing)
    // ═══════════════════════════════════════════════════════════
    ['--- MODULE 9 ENHANCEMENTS ---', '---', '---', '---', '---'],
    ['enableRobbers',
      boolStr(boolVal_(pickCfg_(bestConfig,   'enableRobbers', cfgVal('enableRobbers', true)), true)),
      boolStr(boolVal_(cfgVal('enableRobbers', true), true)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'enableRobbers', cfgVal('enableRobbers', true)), true)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'enableRobbers', cfgVal('enableRobbers', true)), true))
    ],
    ['enableFirstHalf',
      boolStr(boolVal_(pickCfg_(bestConfig,   'enableFirstHalf', cfgVal('enableFirstHalf', true)), true)),
      boolStr(boolVal_(cfgVal('enableFirstHalf', true), true)),
      boolStr(boolVal_(pickCfg_(secondConfig, 'enableFirstHalf', cfgVal('enableFirstHalf', true)), true)),
      boolStr(boolVal_(pickCfg_(thirdConfig,  'enableFirstHalf', cfgVal('enableFirstHalf', true)), true))
    ],
    ['ftOUMinConf',
      int_(pickCfg_(bestConfig,   'ftOUMinConf', cfgVal('ftOUMinConf', 55)), 55),
      int_(cfgVal('ftOUMinConf', 55), 55),
      int_(pickCfg_(secondConfig, 'ftOUMinConf', cfgVal('ftOUMinConf', 55)), 55),
      int_(pickCfg_(thirdConfig,  'ftOUMinConf', cfgVal('ftOUMinConf', 55)), 55)
    ],

    // ═══════════════════════════════════════════════════════════
    // METRICS (diagnostic only — never applied as config)
    // ═══════════════════════════════════════════════════════════
    ['--- METRICS ---', '---', '---', '---', '---'],
    ['Weighted Score %',   fmtPct_(bestStats && bestStats.weightedScore),   fmtPct_(currentStats && currentStats.weightedScore),   fmtPct_(secondStats && secondStats.weightedScore),   fmtPct_(thirdStats && thirdStats.weightedScore)],
    ['Side Accuracy %',    fmtPct_(bestStats && bestStats.sideAccuracy),    fmtPct_(currentStats && currentStats.sideAccuracy),    fmtPct_(secondStats && secondStats.sideAccuracy),    fmtPct_(thirdStats && thirdStats.sideAccuracy)],
    ['Coverage %',         fmtPct_(bestStats && bestStats.coverage),        fmtPct_(currentStats && currentStats.coverage),        fmtPct_(secondStats && secondStats.coverage),        fmtPct_(thirdStats && thirdStats.coverage)],
    ['Overall Accuracy %', fmtPct_(bestStats && bestStats.overallAccuracy), fmtPct_(currentStats && currentStats.overallAccuracy), fmtPct_(secondStats && secondStats.overallAccuracy), fmtPct_(thirdStats && thirdStats.overallAccuracy)],
    ['Side Predictions',   safeInt_(bestStats && bestStats.sidePreds),      safeInt_(currentStats && currentStats.sidePreds),      safeInt_(secondStats && secondStats.sidePreds),      safeInt_(thirdStats && thirdStats.sidePreds)],
    ['EVEN Predictions',   safeInt_(bestStats && bestStats.evenPreds),      safeInt_(currentStats && currentStats.evenPreds),      safeInt_(secondStats && secondStats.evenPreds),      safeInt_(thirdStats && thirdStats.evenPreds)],
    ['Training Size', trainingSize, trainingSize, trainingSize, trainingSize],

    // ═══════════════════════════════════════════════════════════
    // INFO
    // ═══════════════════════════════════════════════════════════
    ['--- INFO ---', '---', '---', '---', '---'],
    ['last_updated', new Date(), '', '', ''],
    ['updated_by', 'tuneTier2Config Elite', 'Manual', 'Elite', 'Elite']
  ];

  /* ── PATCH: Auto-append any keys in Config_Tier2 not yet in rows ── */
  (function appendMissingConfigKeys_() {
    var seen = {};
    rows.forEach(function(r) {
      var k = String((r && r[0]) || '').trim().toLowerCase();
      if (k) seen[k] = true;
    });

    var cfgSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'Config_Tier2')
      : ss.getSheetByName('Config_Tier2');
    if (!cfgSheet) return;

    var last = cfgSheet.getLastRow();
    if (!last) return;

    var cfgData = cfgSheet.getRange(1, 1, last, Math.max(2, cfgSheet.getLastColumn())).getValues();
    var missing = [];

    for (var i = 0; i < cfgData.length; i++) {
      var keyOrig = String(cfgData[i][0] || '').trim();
      if (!keyOrig) continue;
      if (keyOrig.indexOf('---') === 0) continue;

      var lk = keyOrig.toLowerCase();
      if (seen[lk]) continue;

      // Never pull metrics (contain spaces or %) or metadata
      if (/\s/.test(keyOrig) || keyOrig.indexOf('%') !== -1) continue;
      if (lk === 'config_version' || lk === 'last_updated' || lk === 'updated_by') continue;

      missing.push(keyOrig);
      seen[lk] = true;
    }

    if (missing.length > 0) {
      rows.push(['--- AUTO (EXTRA KEYS FROM Config_Tier2) ---', '---', '---', '---', '---']);
      for (var j = 0; j < missing.length; j++) {
        var mk = missing[j];
        rows.push([
          mk,
          String(pickCfg_(bestConfig,   mk, cfgVal(mk, ''))),
          String(cfgVal(mk, '')),
          String(pickCfg_(secondConfig, mk, cfgVal(mk, ''))),
          String(pickCfg_(thirdConfig,  mk, cfgVal(mk, '')))
        ]);
      }
    }
  })();

  /* ── Write to sheet ──────────────────────────────────────────── */
  propSheet.getRange(1, 1, rows.length, 5).setValues(rows);

  /* ── Formatting ──────────────────────────────────────────────── */
  propSheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#d9ead3');
  propSheet.getRange(1, 2, rows.length, 1).setBackground('#e6f2ff');
  propSheet.getRange(1, 1, rows.length, 1).setNumberFormat('@');
  propSheet.getRange(1, 2, rows.length, 4).setNumberFormat('0.########');
  propSheet.getRange(2, 2, 1, 4).setNumberFormat('@');

  var fmtByKey = {
    'threshold': '0.00',
    'momentum_swing_factor': '0.000',
    'variance_penalty_factor': '0.000',
    'strong_target': '0.000',
    'medium_target': '0.000',
    'even_target': '0.000',
    'confidence_scale': '0',
    'forebet_ou_weight_qtr': '0.00',
    'forebet_ou_weight_ft': '0.00',
    'highest_q_tie_conf_penalty': '0.00',
    'ou_edge_threshold': '0.0000',
    'ou_min_ev': '0.0000',
    'ou_confidence_scale': '0',
    'ou_min_samples': '0',
    'ou_shrink_k': '0',
    'ou_sigma_floor': '0.00',
    'ou_sigma_scale': '0.000',
    'ou_american_odds': '0',
    'ou_model_error': '0.00',
    'ou_prob_temp': '0.00',
    'ou_confidence_shrink_min': '0.00',
    'ou_confidence_shrink_max': '0.00',
    // HQ numeric formats
    'hq_min_confidence': '0',
    'hq_min_pwin': '0.00',
    'tiemargin': '0.0',
    'hq_softmax_temperature': '0',
    'hq_shrink_k': '0',
    'hq_vol_weight': '0.00',
    'hq_fb_weight': '0.00',
    'hq_max_picks_per_slip': '0',
    'highqtrtiemargin': '0.0',
    // Module 9
    'ftouminconf': '0'
  };

  var textKeys = {
    'q1_flip': true, 'q2_flip': true, 'q3_flip': true, 'q4_flip': true,
    'forebet_blend_enabled': true, 'highest_q_tie_policy': true,
    'ou_use_effn': true, 'debug_ou_logging': true,
    'weighted score %': true, 'side accuracy %': true,
    'coverage %': true, 'overall accuracy %': true,
    // HQ boolean text
    'hq_enabled': true, 'hq_skip_ties': true, 'hq_exempt_from_cap': true,
    // Module 9 boolean text
    'enablerobbers': true, 'enablefirsthalf': true
  };

  for (var r = 0; r < rows.length; r++) {
    var k = String(rows[r][0] || '').trim().toLowerCase();
    if (!k || k.indexOf('---') === 0) continue;

    var rowRangeBE = propSheet.getRange(r + 1, 2, 1, 4);
    if (textKeys[k]) {
      rowRangeBE.setNumberFormat('@');
    } else if (fmtByKey[k]) {
      rowRangeBE.setNumberFormat(fmtByKey[k]);
    }

    if (k === 'last_updated') {
      propSheet.getRange(r + 1, 2, 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    }
  }

  propSheet.autoResizeColumns(1, 5);
  propSheet.setFrozenRows(1);
  propSheet.setFrozenColumns(1);
}

/**
 * Applies proposal from Config_Tier2_Proposals to Config_Tier2
 *
 * PATCHED v3:
 *   - ENSURES Config_Tier2 has a header row (root cause of "tuner ignores applied config")
 *   - Skips diagnostic/metrics rows (not real config)
 *   - Guards against NaN / '-' values
 *   - Clears in-memory caches after write
 *   - Row indexing accounts for header row
 *
 * @param {Spreadsheet} ss
 * @param {number} rankNumber - 1, 2, or 3
 */
/**
 * =============================================================================
 * DROP-IN PATCH v5 (for your sheet layout: Proposed, Current, Rank#2, Rank#3)
 * Fixes: incomplete apply, normalization mismatches, duplicate-key shadowing,
 *        metric/diagnostic bloat, string-typed booleans/numbers, OU hardcoding.
 * =============================================================================
 */

/** Toggle: remove previously-injected metric rows from Config_Tier2 (safe, optional) */
var T2_APPLY_CLEAN_METRICS_FROM_CONFIG = true;

function applyTier2ProposalToConfig_(ss, rankNumber) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  rankNumber = rankNumber || 1;

  if (typeof getSheetInsensitive !== 'function') {
    throw new Error('applyTier2ProposalToConfig_: getSheetInsensitive not found.');
  }

  function safeAlert_(title, msg) {
    try { SpreadsheetApp.getUi().alert(title, msg, SpreadsheetApp.getUi().ButtonSet.OK); }
    catch (e) { Logger.log(title + '\n' + msg); }
  }

  function normStr_(v) { return String(v || '').trim().toLowerCase(); }

  // Strong key normalizer: snake_case, camelCase, spaces all collapse
  function normKey_(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function coerce_(val) {
    if (val === null || typeof val === 'undefined') return val;
    if (val instanceof Date) return val;
    if (typeof val === 'boolean' || typeof val === 'number') return val;

    var s = String(val).trim();
    if (!s) return val;

    var up = s.toUpperCase();
    if (up === 'TRUE') return true;
    if (up === 'FALSE') return false;

    // numeric strings (allow commas)
    var cleaned = s.replace(/,/g, '');
    if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
      var n = Number(cleaned);
      if (!isNaN(n)) return n;
    }
    return s;
  }

  var prop = getSheetInsensitive(ss, 'Config_Tier2_Proposals');
  if (!prop) throw new Error('Config_Tier2_Proposals not found. Run tuner first.');

  var cfg = getSheetInsensitive(ss, 'Config_Tier2');
  if (!cfg) cfg = ss.insertSheet('Config_Tier2');

  var data = prop.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('Config_Tier2_Proposals is empty.');

  // 1) Ensure Config_Tier2 has a header row (prevents loader skipping row1)
  var cfgLastRow = cfg.getLastRow();
  var addedHeader = false;

  if (cfgLastRow === 0) {
    cfg.getRange(1, 1, 1, 2).setValues([['Parameter', 'Value']]).setFontWeight('bold').setBackground('#d9ead3');
    addedHeader = true;
  } else {
    var firstCell = normStr_(cfg.getRange(1, 1).getValue());
    var isHeader = (firstCell === 'parameter' || firstCell === 'key' || firstCell === 'setting');
    if (!isHeader) {
      cfg.insertRowBefore(1);
      cfg.getRange(1, 1, 1, 2).setValues([['Parameter', 'Value']]).setFontWeight('bold').setBackground('#d9ead3');
      addedHeader = true;
    }
  }

  // 2) Find proposal header row
  var headerRow = -1;
  for (var h = 0; h < Math.min(data.length, 25); h++) {
    if (normStr_(data[h][0]) === 'parameter') { headerRow = h; break; }
  }
  if (headerRow === -1) headerRow = 0;

  var header = data[headerRow] || [];

  function findCol_(regex) {
    for (var c = 0; c < header.length; c++) {
      if (regex.test(normStr_(header[c]))) return c;
    }
    return -1;
  }

  // 3) Determine the correct value column
  // Your sheet: Parameter | Proposed | Current | Rank #2 | Rank #3
  // indices:      0           1         2         3          4
  var valueCol = -1;
  if (rankNumber === 1) valueCol = findCol_(/proposed|elite|best|rank\s*#?\s*1|candidate\s*1/);
  if (rankNumber === 2) valueCol = findCol_(/rank\s*#?\s*2|alt\s*2|candidate\s*2/);
  if (rankNumber === 3) valueCol = findCol_(/rank\s*#?\s*3|alt\s*3|candidate\s*3/);

  // Fallback that matches YOUR layout even if header parsing fails:
  if (valueCol === -1) {
    valueCol = (rankNumber === 1) ? 1 : (rankNumber === 2) ? 3 : 4;
  }
  if (rankNumber < 1 || rankNumber > 3) throw new Error('rankNumber must be 1, 2, or 3.');

  // 4) Diagnostics/metrics to ignore (normalized)
  var DIAG = {
    weightedscore: 1,
    sideaccuracy: 1,
    overallaccuracy: 1,
    coverage: 1,
    accuracy: 1,
    compositescore: 1,
    dataconfidence: 1,
    trainingsize: 1,
    correctpredictions: 1,
    totalpredictions: 1,
    riskycount: 1,
    sidepredictions: 1,
    evenpredictions: 1,
    hitrate: 1,
    brier: 1,
    logloss: 1,
    picks: 1,
    pushes: 1,
    reallinepct: 1,
    usingreallines: 1
    // NOTE: do NOT include configversion; allow it through
  };

  // 5) Build proposed map (normalizedKey -> {original, value})
  var proposed = {};
  var skippedDiag = 0, skippedBad = 0;

  for (var r = headerRow + 1; r < data.length; r++) {
    var keyOrig = String(data[r][0] || '').trim();
    if (!keyOrig) continue;
    if (keyOrig.indexOf('---') === 0 || keyOrig.indexOf('===') === 0) continue;

    var lk = normKey_(keyOrig);
    if (!lk || lk === 'parameter') continue;
    if (DIAG[lk]) { skippedDiag++; continue; }

    var rowArr = data[r] || [];
    var rawVal = (valueCol < rowArr.length) ? rowArr[valueCol] : null;

    if (rawVal === '' || rawVal === null || typeof rawVal === 'undefined') continue;
    if (typeof rawVal === 'number' && isNaN(rawVal)) { skippedBad++; continue; }

    var rawStr = String(rawVal).trim();
    if (!rawStr || rawStr === '-' || rawStr.toLowerCase() === 'nan') { skippedBad++; continue; }

    proposed[lk] = { original: keyOrig, value: coerce_(rawVal) };
  }

  var proposedKeys = Object.keys(proposed);
  if (!proposedKeys.length) {
    safeAlert_(
      'Apply Tier 2 Proposal',
      'No proposed values found for Rank #' + rankNumber + '.\n' +
      'Header row: ' + headerRow + '\nValue col: ' + valueCol
    );
    return;
  }

  // 6) Index existing Config_Tier2 rows (track duplicates!)
  cfgLastRow = cfg.getLastRow();
  var cfgData = (cfgLastRow > 1) ? cfg.getRange(2, 1, cfgLastRow - 1, 2).getValues() : [];

  var rowsByKey = {}; // normalizedKey -> [rowNum, rowNum, ...]
  var duplicateKeys = 0;

  for (var i = 0; i < cfgData.length; i++) {
    var k = normKey_(cfgData[i][0]);
    if (!k || k === 'parameter') continue;

    var rowNum = i + 2;
    if (!rowsByKey[k]) rowsByKey[k] = [];
    else duplicateKeys++;

    rowsByKey[k].push(rowNum);
  }

  // Optional cleanup of already-injected metrics in Config_Tier2
  // (removes only rows whose key normalizes to a DIAG key; keeps section dividers)
  var cleanedMetricRows = 0;
  if (T2_APPLY_CLEAN_METRICS_FROM_CONFIG) {
    // delete from bottom to top so row numbers stay stable
    for (var rr = cfg.getLastRow(); rr >= 2; rr--) {
      var kcell = String(cfg.getRange(rr, 1).getValue() || '').trim();
      if (!kcell) continue;
      if (kcell.indexOf('---') === 0 || kcell.indexOf('===') === 0) continue;

      var nk = normKey_(kcell);
      if (DIAG[nk]) {
        cfg.deleteRow(rr);
        cleanedMetricRows++;
      }
    }

    // rebuild index after deletes
    cfgLastRow = cfg.getLastRow();
    cfgData = (cfgLastRow > 1) ? cfg.getRange(2, 1, cfgLastRow - 1, 2).getValues() : [];
    rowsByKey = {};
    duplicateKeys = 0;
    for (i = 0; i < cfgData.length; i++) {
      var kk = normKey_(cfgData[i][0]);
      if (!kk || kk === 'parameter') continue;
      var rn = i + 2;
      if (!rowsByKey[kk]) rowsByKey[kk] = [];
      else duplicateKeys++;
      rowsByKey[kk].push(rn);
    }
  }

  // 7) Apply: update ALL duplicates; append missing
  var toAppend = [];
  var updatedCells = 0;

  proposedKeys.forEach(function(lk) {
    var entry = proposed[lk];
    var rows = rowsByKey[lk];

    if (rows && rows.length) {
      rows.forEach(function(sheetRow) {
        cfg.getRange(sheetRow, 2).setValue(entry.value);
        updatedCells++;
      });
    } else {
      toAppend.push([entry.original, entry.value]);
    }
  });

  if (toAppend.length) {
    var startRow = cfg.getLastRow() + 1;
    cfg.getRange(startRow, 1, toAppend.length, 2).setValues(toAppend);
    for (var a = 0; a < toAppend.length; a++) {
      var nk2 = normKey_(toAppend[a][0]);
      if (!rowsByKey[nk2]) rowsByKey[nk2] = [];
      rowsByKey[nk2].push(startRow + a);
    }
  }

  // 8) Metadata stamp (updates duplicates too if present)
  function setKV_(key, value) {
    var lk = normKey_(key);
    var rows = rowsByKey[lk];

    if (!rows || !rows.length) {
      var newRow = cfg.getLastRow() + 1;
      cfg.getRange(newRow, 1).setValue(key);
      cfg.getRange(newRow, 2).setValue(value);
      rowsByKey[lk] = [newRow];
      return;
    }

    rows.forEach(function(sheetRow) {
      cfg.getRange(sheetRow, 2).setValue(value);
    });
  }

  setKV_('last_updated', new Date());
  setKV_('updated_by', 'applyTier2ProposalToConfig_ (rank ' + rankNumber + ')');

  // 9) Formatting
  var finalRow = cfg.getLastRow();
  if (finalRow > 1) cfg.getRange(2, 1, finalRow - 1, 1).setNumberFormat('@');

  // preserve your explicit numeric formats
  function setFmt_(key, fmt) {
    var lk = normKey_(key);
    var rows = rowsByKey[lk] || [];
    rows.forEach(function(sheetRow) { cfg.getRange(sheetRow, 2).setNumberFormat(fmt); });
  }
  setFmt_('ou_edge_threshold', '0.0000');
  setFmt_('ou_min_ev', '0.0000');

  // 10) Clear in-memory caches
  try {
    if (typeof CONFIG_TIER2 !== 'undefined') CONFIG_TIER2 = null;
    if (typeof CONFIG_TIER2_META !== 'undefined') CONFIG_TIER2_META = { loadedAt: 0, source: null, league: null };
    if (typeof T2OU_CACHE !== 'undefined') T2OU_CACHE = { teamStats: null, league: null, builtAt: null };
  } catch (eClear) {}

  safeAlert_(
    'Config_Tier2 Applied',
    'Rank #' + rankNumber + ' applied.\n\n' +
    (addedHeader ? 'Header row was missing and was added.\n\n' : '') +
    'Updated cells (includes duplicates): ' + updatedCells + '\n' +
    'Appended new keys: ' + toAppend.length + '\n' +
    'Skipped diagnostics: ' + skippedDiag + '\n' +
    'Skipped bad vals: ' + skippedBad + '\n' +
    'Duplicate config rows detected: ' + duplicateKeys + '\n' +
    (T2_APPLY_CLEAN_METRICS_FROM_CONFIG ? ('Metric rows removed: ' + cleanedMetricRows + '\n') : '') +
    '\nRun Tier 2 again to use the new config.'
  );
}


/**
 * OU proposal applier (robust, non-hardcoded)
 * Applies from Config_Tier2_OU_Proposals into Config_Tier2 using the same
 * normalization + duplicate-row update strategy and type coercion.
 */
function t2ou_applyProposalRankToConfig_(ss, rankNumber) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  rankNumber = rankNumber || 1;

  if (typeof getSheetInsensitive !== 'function') {
    throw new Error('t2ou_applyProposalRankToConfig_: getSheetInsensitive not found.');
  }

  function safeAlert_(title, msg) {
    try { SpreadsheetApp.getUi().alert(title, msg, SpreadsheetApp.getUi().ButtonSet.OK); }
    catch (e) { Logger.log(title + '\n' + msg); }
  }

  function normStr_(v) { return String(v || '').trim().toLowerCase(); }
  function normKey_(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function coerce_(val) {
    if (val === null || typeof val === 'undefined') return val;
    if (val instanceof Date) return val;
    if (typeof val === 'boolean' || typeof val === 'number') return val;

    var s = String(val).trim();
    if (!s) return val;

    var up = s.toUpperCase();
    if (up === 'TRUE') return true;
    if (up === 'FALSE') return false;

    var cleaned = s.replace(/,/g, '');
    if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
      var n = Number(cleaned);
      if (!isNaN(n)) return n;
    }
    return s;
  }

  var prop = getSheetInsensitive(ss, 'Config_Tier2_OU_Proposals');
  if (!prop) throw new Error('Config_Tier2_OU_Proposals not found. Run tuner first.');

  var cfg = getSheetInsensitive(ss, 'Config_Tier2');
  if (!cfg) cfg = ss.insertSheet('Config_Tier2');

  var data = prop.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('Config_Tier2_OU_Proposals is empty.');

  // Ensure header in Config_Tier2
  var cfgLastRow = cfg.getLastRow();
  if (cfgLastRow === 0) {
    cfg.getRange(1, 1, 1, 2).setValues([['Parameter', 'Value']]).setFontWeight('bold').setBackground('#d9ead3');
  } else {
    var firstCell = normStr_(cfg.getRange(1, 1).getValue());
    var isHeader = (firstCell === 'parameter' || firstCell === 'key' || firstCell === 'setting');
    if (!isHeader) {
      cfg.insertRowBefore(1);
      cfg.getRange(1, 1, 1, 2).setValues([['Parameter', 'Value']]).setFontWeight('bold').setBackground('#d9ead3');
    }
  }

  // Find header row
  var headerRow = -1;
  for (var h = 0; h < Math.min(data.length, 25); h++) {
    if (normStr_(data[h][0]) === 'parameter') { headerRow = h; break; }
  }
  if (headerRow === -1) headerRow = 0;

  var header = data[headerRow] || [];

  function findCol_(regex) {
    for (var c = 0; c < header.length; c++) {
      if (regex.test(normStr_(header[c]))) return c;
    }
    return -1;
  }

  if (rankNumber < 1 || rankNumber > 3) throw new Error('rankNumber must be 1, 2, or 3.');

  // Try header-based detection first
  var valueCol = -1;
  if (rankNumber === 1) valueCol = findCol_(/proposed|best|rank\s*#?\s*1|candidate\s*1/);
  if (rankNumber === 2) valueCol = findCol_(/rank\s*#?\s*2|alt\s*2|candidate\s*2/);
  if (rankNumber === 3) valueCol = findCol_(/rank\s*#?\s*3|alt\s*3|candidate\s*3/);

  // Fallback: if OU proposals also have a "Current" column, map like Tier2.
  // If not, the common layout is Parameter | Proposed | Rank2 | Rank3.
  if (valueCol === -1) {
    var hasCurrent = (findCol_(/current/) !== -1);
    if (hasCurrent) valueCol = (rankNumber === 1) ? 1 : (rankNumber === 2) ? 3 : 4;
    else valueCol = (rankNumber === 1) ? 1 : (rankNumber === 2) ? 2 : 3;
  }

  // Diagnostics to ignore (normalized)
  var DIAG = {
    weightedscore: 1,
    hitrate: 1,
    coverage: 1,
    avgev: 1,
    brier: 1,
    logloss: 1,
    picks: 1,
    pushes: 1,
    usingreallines: 1,
    reallinepct: 1,
    allsamples: 1,
    trainsamples: 1,
    testsamples: 1
  };

  // Build proposed
  var proposed = {};
  var skippedDiag = 0, skippedBad = 0;

  for (var r = headerRow + 1; r < data.length; r++) {
    var keyOrig = String(data[r][0] || '').trim();
    if (!keyOrig) continue;
    if (keyOrig.indexOf('---') === 0 || keyOrig.indexOf('===') === 0) continue;

    var lk = normKey_(keyOrig);
    if (!lk || lk === 'parameter') continue;
    if (DIAG[lk]) { skippedDiag++; continue; }

    var rowArr = data[r] || [];
    var rawVal = (valueCol < rowArr.length) ? rowArr[valueCol] : null;

    if (rawVal === '' || rawVal === null || typeof rawVal === 'undefined') continue;
    if (typeof rawVal === 'number' && isNaN(rawVal)) { skippedBad++; continue; }

    var rawStr = String(rawVal).trim();
    if (!rawStr || rawStr === '-' || rawStr.toLowerCase() === 'nan') { skippedBad++; continue; }

    proposed[lk] = { original: keyOrig, value: coerce_(rawVal) };
  }

  var proposedKeys = Object.keys(proposed);
  if (!proposedKeys.length) {
    safeAlert_('Tier2 OU Apply', 'No tuneable values found for Rank #' + rankNumber + '.');
    return false;
  }

  // Index Config_Tier2 (duplicates-aware)
  cfgLastRow = cfg.getLastRow();
  var cfgData = (cfgLastRow > 1) ? cfg.getRange(2, 1, cfgLastRow - 1, 2).getValues() : [];

  var rowsByKey = {};
  var duplicateKeys = 0;

  for (var i = 0; i < cfgData.length; i++) {
    var k = normKey_(cfgData[i][0]);
    if (!k || k === 'parameter') continue;

    var rowNum = i + 2;
    if (!rowsByKey[k]) rowsByKey[k] = [];
    else duplicateKeys++;

    rowsByKey[k].push(rowNum);
  }

  // Apply
  var toAppend = [];
  var updatedCells = 0;

  proposedKeys.forEach(function(lk) {
    var entry = proposed[lk];
    var rows = rowsByKey[lk];

    if (rows && rows.length) {
      rows.forEach(function(sheetRow) {
        cfg.getRange(sheetRow, 2).setValue(entry.value);
        updatedCells++;
      });
    } else {
      toAppend.push([entry.original, entry.value]);
    }
  });

  if (toAppend.length) {
    var startRow = cfg.getLastRow() + 1;
    cfg.getRange(startRow, 1, toAppend.length, 2).setValues(toAppend);
  }

  // Metadata
  function setKV_(key, value) {
    var lk = normKey_(key);
    var rows = rowsByKey[lk];

    if (!rows || !rows.length) {
      var newRow = cfg.getLastRow() + 1;
      cfg.getRange(newRow, 1).setValue(key);
      cfg.getRange(newRow, 2).setValue(value);
      rowsByKey[lk] = [newRow];
      return;
    }
    rows.forEach(function(sheetRow) { cfg.getRange(sheetRow, 2).setValue(value); });
  }

  setKV_('last_updated', new Date());
  setKV_('updated_by', 't2ou_applyProposalRankToConfig_ (rank ' + rankNumber + ')');

  // Formatting
  var finalRow = cfg.getLastRow();
  if (finalRow > 1) cfg.getRange(2, 1, finalRow - 1, 1).setNumberFormat('@');

  // Clear caches
  try {
    if (typeof CONFIG_TIER2 !== 'undefined') CONFIG_TIER2 = null;
    if (typeof T2OU_CACHE !== 'undefined') T2OU_CACHE = { teamStats: null, league: null, builtAt: null };
  } catch (eClear) {}

  safeAlert_(
    'Tier2 OU Applied',
    'Rank #' + rankNumber + ' applied.\n\n' +
    'Updated cells (includes duplicates): ' + updatedCells + '\n' +
    'Appended new keys: ' + toAppend.length + '\n' +
    'Skipped diagnostics: ' + skippedDiag + '\n' +
    'Skipped bad vals: ' + skippedBad + '\n' +
    'Duplicate config rows detected: ' + duplicateKeys + '\n\n' +
    'Run Tier 2 again to use the new config.'
  );

  return true;
}

/* ── Convenience wrappers ─────────────────────────────────────────── */
function applyTier2ProposedToConfig() {
  return applyTier2ProposalToConfig_(SpreadsheetApp.getActiveSpreadsheet(), 1);
}
function applyTier2Rank2ToConfig() {
  return applyTier2ProposalToConfig_(SpreadsheetApp.getActiveSpreadsheet(), 2);
}
function applyTier2Rank3ToConfig() {
  return applyTier2ProposalToConfig_(SpreadsheetApp.getActiveSpreadsheet(), 3);
}


/**
 * ======================================================================
 * WRAPPER: tuneTier2ConfigWrapper (Updated)
 * ======================================================================
 */
function tuneTier2ConfigWrapper() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var response = ui.alert(
    '⭐ Elite Tier 2 Config Optimizer (v5.0)',
    'This will optimize your Tier 2 configuration using Bayesian methods.\n\n' +
    '✨ Elite Features:\n' +
    '• Works with ANY amount of data (no minimums)\n' +
    '• Confidence-weighted evaluation\n' +
    '• Tunes elite parameters (confidence scale, targets)\n' +
    '• O/U elite parameters included\n\n' +
    'Data sources:\n' +
    '• CleanH2H_*, CleanRecentHome_*, CleanRecentAway_*\n' +
    '• Falls back to ResultsClean if needed\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    ss.toast('Cancelled.', 'Ma Golide', 3);
    return;
  }

  tuneTier2Config(ss);
}

function t2_coreDiffCount_(a, b) {
  var d = 0, eps = 1e-6;

  function neqNum(x, y) {
    if (x == null && y == null) return false;
    if (x == null || y == null) return true;
    x = Number(x); y = Number(y);
    if (isNaN(x) && isNaN(y)) return false;
    if (isNaN(x) || isNaN(y)) return true;
    return Math.abs(x - y) > eps;
  }

  if (neqNum(a.threshold, b.threshold)) d++;
  if (neqNum(a.momentumSwingFactor, b.momentumSwingFactor)) d++;
  if (neqNum(a.variancePenaltyFactor, b.variancePenaltyFactor)) d++;

  if (!!a.q1_flip !== !!b.q1_flip) d++;
  if (!!a.q2_flip !== !!b.q2_flip) d++;
  if (!!a.q3_flip !== !!b.q3_flip) d++;
  if (!!a.q4_flip !== !!b.q4_flip) d++;

  return d;
}
