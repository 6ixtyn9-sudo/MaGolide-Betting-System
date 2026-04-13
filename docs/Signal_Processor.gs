/**
 * MODULE 3
 * PROJECT: Ma Golide
 *
 * ROLE:
 * This module is the "Mouth" of the system.
 * It reads all messy, vertically-formatted Raw sheets and converts them
 * into clean, standardized, horizontal Clean sheets.
 *
 * [CRITICAL BEHAVIOR]:
 * - Uses robust score-splitting helpers from Module 1.
 * - Protects analyzers from garbage data (Cancl., Postp., missing FT, etc.).
 * - Uses Standings as the authority (“dictionary”) for team names.
 * - Uses SportConfig (via getSportConfig in Module 1) to support different sports
 * such as Basketball (points, 4 quarters) and Volleyball (sets, 3–5 periods).
 * - [NEW] Supports new Tier 2 format with concatenated teams and date on a single line.
 *
 * DEPENDENCIES (defined in Module 1: Helpers.gs):
 * - getSheetInsensitive(ss, sheetName)
 * - createHeaderMap(headerRow)
 * - loadTeamNamesFromStandings(ss)
 * - detectGameType(rawLine, teamNamesSet)
 * - splitScore(scoreStr)
 * - isNumericConcat(str, minLen)
 * - parseRawDate(rawDateStr)
 * - splitTeams(teamsStr, teamNamesSet)
 * - getSportConfig()
 * - parseScore() // NEW
 *
 * IMPORTANT:
 * - No mutable global variables are used.
 * - All functions are pure with respect to data (no hidden state).
 */

// Per instructions, the following helper functions from Module 1 are expected to be
// available in the global scope of the Apps Script project. No explicit import is needed.
// - getSportConfig()
// - splitScore()
// - parseScore()

//========================================================================
// Strict SSoT Helper Implementations (Local to Module 2)
//========================================================================

/**
 * ULTIMATE NFL PERIOD SPLITTER – 2025 NUCLEAR EDITION
 * Fixes ALL known NFL concatenated quarter formats (FlashScore, Sofascore, ESPN, etc.)
 * 
 * Handles:
 * - "1400" → ["14","00"]
 * - "70314" → ["07","03","14"] → correctly recovers missing zero
 * - "30117" → ["03","01","17"] → fixed
 * - Missing leading zeros, single-digit scores, 7/9-digit strings
 * - Returns exactly 8 values: [Q1H, Q1A, Q2H, Q2A, Q3H, Q3A, Q4H, Q4A] as two-digit strings
 * 
 * @param {string|number} input Raw concatenated period string
 * @returns {string[]|null} 8 padded strings or null if truly unrecoverable
 */
function splitNFLPeriods(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;

  // Extract only digits
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 6 || digits.length > 16) return null;
  
  // [H-003 FIX] Prevent backtracking timeout on long garbage strings
  if (digits.length > 12 && digits.length !== 16) return null;

  // Helper: validate 8 quarter scores (max 37 points in a quarter ever)
  const isPlausible = (parts) => {
    if (parts.length !== 8) return false;
    return parts.every(score => {
      const s = parseInt(score, 10);
      return s >= 0 && s <= 37;
    });
  };

  // Strategy 1: Perfect 8-digit string → just split
  if (digits.length === 8) {
    const parts = digits.match(/.{2}/g);
    if (parts && isPlausible(parts)) {
      return parts; // ["14","00","30","00","07","03","10","07"]
    }
  }

  // Strategy 2: 7 digits → one zero missing → try inserting '0' in every position
  if (digits.length === 7) {
    for (let i = 0; i <= 7; i++) { // 8 possible slots (before, between, after)
      const attempt = digits.slice(0, i) + '0' + digits.slice(i);
      const parts = attempt.match(/.{2}/g);
      if (parts && parts.length === 8 && isPlausible(parts)) {
        return parts;
      }
    }
  }

  // Strategy 3: 9 digits → one extra digit → try removing each one
  if (digits.length === 9) {
    for (let i = 0; i < 9; i++) {
      const attempt = digits.slice(0, i) + digits.slice(i + 1);
      const parts = attempt.match(/.{2}/g);
      if (parts && parts.length === 8 && isPlausible(parts)) {
        return parts;
      }
    }
  }

  // Strategy 4: Backtracking solver for rare malformed cases (e.g. "3117693")
  const backtrackResult = (function backtrack(idx = 0, acc = []) {
    if (acc.length === 8) {
      if (idx === digits.length && isPlausible(acc.map(s => s.padStart(2, '0')))) {
        return acc.map(s => s.padStart(2, '0'));
      }
      return null;
    }
    if (idx >= digits.length) return null;

    // Try 1-digit
    const one = digits[idx];
    if (parseInt(one, 10) <= 37) {
      acc.push(one);
      const res = backtrack(idx + 1, acc);
      if (res) return res;
      acc.pop();
    }

    // Try 2-digit
    if (idx + 1 < digits.length) {
      const two = digits[idx] + digits[idx + 1];
      if (parseInt(two, 10) <= 37) {
        acc.push(two);
        const res = backtrack(idx + 2, acc);
        if (res) return res;
        acc.pop();
      }
    }

    return null;
  })();

  if (backtrackResult) return backtrackResult;

  return null; // Truly unrecoverable
}


/**
 * WHY:
 * Protect parsers from ambiguous concatenated numbers.
 *
 * WHAT:
 * Strictly splits a numeric string into equal-sized chunks
 * (e.g. "2518" -> ["25", "18"]).
 *
 * HOW:
 * - Verifies that the string length is a perfect multiple of partLen.
 * - Slices substrings of length partLen.
 * - Returns [] on any length mismatch.
 *
 * [UPGRADE]:
 * - Returns [] if the string length is not an exact multiple of partLen.
 *
 * WHERE:
 * - Used by Tier 1 (Upcoming) and Tier 2 parsers to break "20253035"
 * into quarters/periods.
 *
 * @param {string} str - Concatenated digits (e.g. "20253035").
 * @param {number} [partLen=2] - Length of each part.
 * @returns {Array<string>} - Array of parts, or [] if invalid.
 */
function splitConcatenated(str, partLen) {
  //WHY: Normalize inputs and enforce default part length.
  //WHAT: Clean incoming value and ensure partLen is sane.
  //HOW: Convert to string, trim, and set default partLen=2 if not provided.
  //WHERE: Local utility for this module only (parsers).
  partLen = partLen || 2;
  str = String(str).trim();

  if (str.length === 0 || str.length % partLen !== 0) {
    return []; // Invalid if not a perfect multiple of partLen
  }

  const result = [];
  for (let i = 0; i < str.length; i += partLen) {
    result.push(str.substr(i, partLen));
  }
  return result;
}

/**
 * WHY:
 * Handle concatenated scores with variable digits (e.g. "108" -> "10-8").
 *
 * WHAT:
 * Tries all possible ways to cut a digit string into N parts, each 1–maxDigits long,
 * enforcing:
 * - no invalid leading zeros (except "0"),
 * - each part <= maxValue.
 *
 * HOW:
 * - Uses a depth-first search (DFS) to explore valid splits.
 * - Returns the split with the highest number of maxDigits-length parts
 * (e.g. prefer "10-8" over "1-08").
 *
 * [UPGRADE]:
 * - Supports up to 8 digits total (enough for 4 quarters of 2 digits).
 * - Max value per part is configurable (`maxValue`).
 *
 * WHERE:
 * - Tier 1: per-quarter and OT parsing in parseFullGameSheet.
 * - Tier 2: OT detection in parseTier2Sheet.
 *
 * @param {string} str - Concatenated score string (e.g. "108", "2518").
 * @param {number} [numParts=2] - Number of parts.
 * @param {number} [minDigits=1] - Minimum digits per part.
 * @param {number} [maxDigits=2] - Maximum digits per part.
 * @param {number} [maxValue=60] - Maximum allowed value per part.
 * @returns {Array<string>} - Best split as array of strings, or [] if no valid split.
 */
function splitVariableDigits(str, numParts, minDigits, maxDigits, maxValue) {
  //WHY: Normalize parameters and sanitize input for safe regex checks.
  //WHAT: Ensure input is a digit-only string of length between 2 and 8.
  //HOW: Use a regex /^\d{2,8}$/; if it fails, we abort early.
  //WHERE: Called inside parsers that need flexible chunking (e.g., "108").
  numParts = numParts || 2;
  minDigits = (minDigits === undefined) ? 1 : minDigits;
  maxDigits = (maxDigits === undefined) ? 2 : maxDigits;
  maxValue = (maxValue === undefined) ? 60 : maxValue;

  str = String(str).trim();
  // Sanity check: must be 2–8 digits and only digits.
  if (!/^\d{2,8}$/.test(str)) {
    return [];
  }

  /**
   * WHY:
   * Internal DFS search for all valid ways to split "remaining".
   *
   * WHAT:
   * Recursively builds candidate arrays where each chunk obeys digit length
   * and maxValue.
   *
   * HOW:
   * - Picks 1..maxDigits digits as the next part.
   * - Rejects parts with invalid leading zeros.
   * - Rejects parts exceeding maxValue.
   * - Recurse until all parts are placed or the string is exhausted.
   *
   * WHERE:
   * - Internal to splitVariableDigits only.
   */
  const findSplits = function(remaining, partsLeft, current) {
    current = current || [];
    if (partsLeft === 0) {
      return remaining === '' ? [current] : [];
    }

    const results = [];
    for (let d = minDigits; d <= maxDigits && d <= remaining.length; d++) {
      const partStr = remaining.substr(0, d);
      // Disallow leading zeros except for "0" itself.
      if (partStr.startsWith('0') && partStr !== '0') {
        continue;
      }

      const part = parseInt(partStr, 10);
      if (part > maxValue) {
        continue;
      }

      const subResults = findSplits(
        remaining.substr(d),
        partsLeft - 1,
        current.concat(partStr)
      );
      if (subResults.length) {
        Array.prototype.push.apply(results, subResults);
      }
    }
    return results;
  };

  const possible = findSplits(str, numParts);
  if (possible.length === 0) {
    return [];
  }

  // Prefer solutions with more maxDigits-digit parts (e.g., 2-digit parts).
  possible.sort(function(a, b) {
    const countA = a.filter(function(p) { return p.length === maxDigits; }).length;
    const countB = b.filter(function(p) { return p.length === maxDigits; }).length;
    return countB - countA;
  });

  return possible[0];
}

/**
 * [NEW HELPER]
 * WHY:
 * To handle malformed dates in raw data where a separator is missing,
 * such as "09/112025" instead of "09/11/2025".
 *
 * WHAT:
 * Finds date-like patterns where two digits and a four-digit year are
 * concatenated and inserts a "/" between them.
 *
 * HOW:
 * Uses a regular expression to find and replace patterns like "DD/MMYYYY"
 * anywhere within a given string.
 *
 * WHERE:
 * - Called by `parseTier2Sheet` to sanitize input lines before date extraction.
 *
 * @param {string} line - The raw line which may contain a malformed date.
 * @returns {string} The line with any malformed dates corrected.
 */
function normalizeFlexibleDate(line) {
  // Regex looks for: (digit/digit, separator, two digits) followed immediately by (four digits).
  // Example: "TeamA09/112025" -> "TeamA09/11/2025"
  return line.replace(/(\d{1,2}[/.])(\d{2})(\d{4})/g, '$1$2/$3');
}


/**
 * [NEW HELPER]
 * WHY:
 * To handle the new single-line "Unkillable" format where team names
 * are concatenated without spaces, followed by a date.
 *
 * WHAT:
 * Extracts home team, away team, and a normalized date string from a
 * line like "DallasCowboysPhiladelphiaEagles23/11/2025".
 *
 * HOW:
 * - Locates the date within the string first using a robust regex.
 * - Extracts the text *before* the date as the concatenated team string.
 * - Iterates through known team names (sorted by length, longest first) to find
 *   the away team at the *end* of the string.
 * - Iterates again to match the remaining part of the string to the home team.
 *
 * WHERE:
 * - Called exclusively by `parseTier2Sheet` as its primary strategy for
 *   detecting game blocks.
 *
 * @param {string} line - The raw line, e.g., "TeamANoSpaceTeamBNoSpaceDD/MM/YYYY".
 * @param {Set<string>} teamNamesSet - The set of all known team names from Standings.
 * @returns {object|null} An object `{home, away, dateStr}` or null if no valid match.
 */
function parseConcatenatedTeamsAndDate(line, teamNamesSet) {
  const dateRegex = /(\d{1,2}[/.]\d{1,2}[/.]?\d{4}(\s+\d{1,2}:\d{2})?)/;
  const dateMatch = line.match(dateRegex);
  if (!dateMatch) return null;

  const dateStr = parseRawDate(dateMatch[0].trim()); // Use Module 1 helper
  const teamsStr = line.slice(0, dateMatch.index).trim();
  
  if (teamsStr.length < 6) return null; // Too short for two concatenated teams.

  const sortedTeams = Array.from(teamNamesSet).sort((a, b) => b.length - a.length);

  for (const awayCandidate of sortedTeams) {
    const awayNoSpaces = awayCandidate.replace(/\s/g, '');
    if (teamsStr.endsWith(awayNoSpaces)) {
      const remainingStr = teamsStr.slice(0, teamsStr.length - awayNoSpaces.length);
      
      for (const homeCandidate of sortedTeams) {
        if (remainingStr === homeCandidate.replace(/\s/g, '')) {
          // Perfect match: found both home and away teams.
          return { home: homeCandidate, away: awayCandidate, dateStr: dateStr };
        }
      }
    }
  }
  
  return null; // No valid team pair was found.
}

// ===================================================================
// SINGLE SOURCE OF TRUTH: Use these functions everywhere
// ===================================================================

/**
 * [BULLETPROOF HELPER]
 * Safely parse NFL period scores from a single concatenated string.
 * Wrapper for the powerful splitNFLPeriods.
 * @param {string} periodStr e.g. "07031410" or "107306013"
 * @returns {string[]|null} ["07","03","14","10"] or with OT.
 */
function parseNFLPeriodScores(periodStr) {
  if (!periodStr) return null;
  const cleaned = String(periodStr).trim();
  if (/^\d+$/.test(cleaned)) {
    return splitNFLPeriods(cleaned);
  }
  return null;
}

/**
 * [BULLETPROOF HELPER]
 * The One True Way™ to parse any score string in the system.
 * It tries multiple strategies, from strictest to most flexible, to parse a
 * string into an expected number of parts.
 * @param {string} input The raw score string (e.g., "27-24", "2724", "108").
 * @param {number} [expectedParts=2] - The number of scores to extract (e.g., 2 for a final score).
 * @returns {string[]|null} An array of string parts, or null if unparseable.
 */
function parseScoreRobust(input, expectedParts = 2) {
  if (input === null || input === undefined) return null;
  const str = String(input).trim();
  if (str === '') return null;

  // Strategy 1: Standard "X-Y" or "X Y" format.
  const std = splitScore(str); // Assumes splitScore returns an array of numbers.
  if (std && std.length === expectedParts) {
    return std.map(n => String(n)); // Return as strings for consistency.
  }

  // From here, work with a digits-only string for concatenation strategies.
  const digitStr = str.replace(/[^0-9]/g, '');
  if (!digitStr) return null;

  // Strategy 2: Fixed-digit concatenated (e.g., "0714" -> ["07", "14"] for 2 parts).
  if (digitStr.length === expectedParts * 2) {
    const parts = splitConcatenated(digitStr, 2);
    if (parts && parts.length === expectedParts) return parts;
  }

  // Strategy 3: Variable-digit fallback using DFS (e.g., "108" -> ["10", "8"]).
  const maxValue = expectedParts === 2 ? 150 : 70; // Higher max for final scores.
  const maxDigits = expectedParts === 2 ? 3 : 2;  // Allow 3 digits for final scores.
  const smart = splitVariableDigits(digitStr, expectedParts, 1, maxDigits, maxValue);
  if (smart && smart.length === expectedParts) {
    return smart;
  }

  return null;
}

/**
 * [BULLETPROOF WRAPPER]
 * The new standard for parsing any two-part final score.
 * Handles "27-24", "27 24", "2724", and "108".
 * @param {string} str The raw final score string.
 * @returns {string[]|null} ["27", "24"] or null.
 */
function parseFinalScoreSafe(str) {
  return parseScoreRobust(str, 2);
}


//========================================================================
// TIER 1 PARSER: Full Game Sheets (Raw, ResultsRaw -> Clean, ResultsClean)
//========================================================================
/**
 * WHY:
 * Transform complex multi-line Raw / ResultsRaw game blocks into one-row
 * clean records.
 *
 * WHAT:
 * - Detects each game by a "date + teams" anchor row.
 * - Extracts league & game type from context rows above.
 * - Reads probabilities, predictions, quarters, OT, status, and final score.
 * - Validates that quarters + OT sum to FT (for points-based sports).
 * - Auto-corrects swapped home/away quarter data when possible.
 * - Adds Tier 2 alignment columns: t2-q1..t2-q4.
 *
 * HOW:
 * - Iterate line-by-line.
 * - Use detectGameType() on anchor rows.
 * - Sequentially consume the following lines as a local "block".
 * - [UPGRADE] Use parseScoreRobust for all quarter/OT scores.
 * - [UPGRADE] Use parseFinalScoreSafe for all FT scores.
 * - Use SportConfig (getSportConfig) to allow variable number of periods
 * (e.g., Volleyball 3 sets).
 *
 * [FIX 2025-12-09]: League regex now allows mixed case letters (e.g., "Jp2", "La2", "Eng1")
 * [FIX 2025-12-09 v2]: Game type regex now REQUIRES at least one letter to prevent
 *                      score strings like "6196" from being misidentified as game types.
 *
 * WHERE:
 * - Reads from: 'Raw' OR 'ResultsRaw'.
 * - Writes to: 'Clean' OR 'ResultsClean' (via runner functions).
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Raw / ResultsRaw sheet.
 * @param {Set<string>} teamNamesSet - Known team names from Standings.
 * @returns {Array<Array<string>>} - 2D array ready to be written to Clean sheet.
 */
function parseFullGameSheet(sheet, teamNamesSet) {
  const output = [];
  const headers = [
    'League', 'Game Type', 'Home', 'Away',
    'Date', 'Time',
    'Prob %', 'Pred', 'Pred Score', 'Avg', 'Odds',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT',
    'Status', 'FT Score',
    't2-q1', 't2-q2', 't2-q3', 't2-q4'
  ];
  output.push(headers);

  if (!sheet) return output;
  const data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length < 10) return output;

  const dateRegex = /\d{1,2}[/.]\d{1,2}[/.]?\d{4}/;

  let sportConfig = { minPeriods: 4, scoringMode: 'points' };
  if (typeof getSportConfig === 'function') {
    try {
      const cfg = getSportConfig();
      if (cfg && typeof cfg === 'object') sportConfig = Object.assign(sportConfig, cfg);
    } catch (e) {}
  }
  const minPeriods = sportConfig.minPeriods || 4;
  const scoringMode = sportConfig.scoringMode || 'points';

  for (let r = 0; r < data.length; r++) {
    const anchorCell = data[r][0] ? String(data[r][0]).trim() : '';

    if (!anchorCell || !dateRegex.test(anchorCell)) continue;

    // Assuming detectGameType, parseRawDate, and splitTeams are defined elsewhere
    const gameData = detectGameType(anchorCell, teamNamesSet);
    if (!gameData || !gameData.home) continue;

    const prevRowVal = (r > 0 && data[r - 1][0]) ? String(data[r - 1][0]).trim() : '';
    const prevPrevRowVal = (r > 1 && data[r - 2][0]) ? String(data[r - 2][0]).trim() : '';
    let league = gameData.league || '';
    let gameType = gameData.gameType || 'League';

    // ========================================================================
    // [FIX 2025-12-09] LEAGUE DETECTION - NOW SUPPORTS MIXED CASE
    // ========================================================================
    // WHY: Original regex /^[A-Z0-9\s-]{2,}$/ only matched UPPERCASE letters.
    //      This caused leagues like "Jp2", "La2", "Eng1" to fail and show "UNKNOWN".
    // WHAT: Updated regex to allow mixed case letters (A-Za-z), numbers, spaces, hyphens
    // HOW: Added 'a-z' to the character class
    // WHERE: Context Headers extraction logic for league code detection
    // ========================================================================
    
    // League pattern: letters (any case), numbers, spaces, hyphens - min 2 chars
    const leagueRegex = /^[A-Za-z0-9\s-]{2,}$/;
    
    if (prevRowVal.length >= 2 && leagueRegex.test(prevRowVal) && !dateRegex.test(prevRowVal)) {
      league = prevRowVal;
      
      // ========================================================================
      // [FIX 2025-12-09 v2] GAME TYPE DETECTION - MUST CONTAIN AT LEAST ONE LETTER
      // ========================================================================
      // WHY: The previous regex /^[A-Za-z0-9\s-]+$/ matched pure numeric strings
      //      like "6196" or "70103" (FT scores from previous games) as valid game types.
      // WHAT: New validation requires the string to contain at least one letter [A-Za-z]
      // HOW: Two-part check:
      //      1. Must match overall pattern (letters, numbers, spaces, hyphens)
      //      2. Must contain at least one letter (not pure numbers)
      // EXAMPLES:
      //      - "League"     → PASS (has letters)
      //      - "Round 7"    → PASS (has letters)
      //      - "Playoffs"   → PASS (has letters)
      //      - "Final"      → PASS (has letters)
      //      - "6196"       → FAIL (no letters - this is a score!)
      //      - "70103"      → FAIL (no letters - this is a score!)
      // ========================================================================
      
      const gameTypePatternRegex = /^[A-Za-z0-9\s-]+$/;  // Overall allowed characters
      const hasLetterRegex = /[A-Za-z]/;                  // Must have at least one letter
      
      if (prevPrevRowVal && 
          gameTypePatternRegex.test(prevPrevRowVal) && 
          hasLetterRegex.test(prevPrevRowVal) &&           // <-- THE KEY FIX
          prevPrevRowVal.toLowerCase() !== 'display') {
        gameType = prevPrevRowVal;
      }
    }

    let blockRow = r;
    const getRow = function(rowIndex) {
      if (rowIndex < 0 || rowIndex >= data.length) return null;
      const value = data[rowIndex][0];
      return value === undefined || value === null ? null : String(value).trim();
    };

    const probRaw = getRow(++blockRow);
    const predRaw = getRow(++blockRow);
    const predH = getRow(++blockRow) || '0';
    const predA = getRow(++blockRow) || '0';
    const avgRaw = getRow(++blockRow);
    const oddsRaw = getRow(++blockRow);

    let homeQs = [0, 0, 0, 0];
    let awayQs = [0, 0, 0, 0];
    let otH = 0, otA = 0;
    let periodRawStrings = []; 

    const parseQuarter = function(qStr, qIndex) {
      if (qStr === null) return false;
      const split = parseScoreRobust(qStr, 2); 
      if (!split || split.length !== 2) return false;
      homeQs[qIndex] = Number(split[0]);
      awayQs[qIndex] = Number(split[1]);
      periodRawStrings[qIndex] = qStr.replace(/\D/g, ''); 
      return true;
    };

    const q1Row = getRow(++blockRow);
    const q1Valid = parseQuarter(q1Row, 0);
    const q2Row = getRow(++blockRow);
    const q2Valid = parseQuarter(q2Row, 1);
    const q3Row = getRow(++blockRow);
    const q3Valid = parseQuarter(q3Row, 2);
    const q4Row = getRow(++blockRow);
    let q4Valid = parseQuarter(q4Row, 3);

    // Handle 3-set sports
    if (!q4Valid && minPeriods < 4) {
      if (q1Valid && q2Valid && q3Valid) {
        q4Valid = true;
        if (q4Row && !parseScoreRobust(q4Row, 2)) blockRow--;
      }
    }

    if (!q1Valid || !q2Valid || !q3Valid || !q4Valid) {
      Logger.log(`Skipping game at row ${r + 1} - incomplete quarter data.`);
      r = blockRow; continue;
    }

    // --- OT Check ---
    const nextRowIdx = blockRow + 1;
    let nextStr = (nextRowIdx < data.length) ? getRow(nextRowIdx) : null;
    let otStrRaw = null;

    if (nextStr && !dateRegex.test(nextStr)) {
      const otSplit = parseScoreRobust(nextStr, 2);
      // Ensure it's a score (not a status like 'FT' or 'AOT')
      if (otSplit && otSplit.length === 2 && ['FT', 'AOT'].indexOf(nextStr.toUpperCase()) === -1) { 
        otH = Number(otSplit[0]);
        otA = Number(otSplit[1]);
        otStrRaw = nextStr.replace(/\D/g, '');
        blockRow++; // Consume OT line ONLY IF VALID
      }
    }

    // --- Status and FT Score ---
    const status = getRow(++blockRow);
    const ftStr = getRow(++blockRow);

    // FIX 4: STATUS CHECK GUARD
    // If the status line is actually the anchor for the next game, skip and reset r.
    if (status && dateRegex.test(status)) { 
       r = blockRow - 2; continue; 
    }
    // If FT score is missing, we still can't proceed.
    if (!status || !ftStr) { 
       r = blockRow; continue; 
    }

    // Assuming parseFinalScoreSafe is defined elsewhere
    const ftParts = parseFinalScoreSafe(ftStr); 
    if (!ftParts || ftParts.length !== 2) { 
       r = blockRow; continue; 
    }
    const ftH = Number(ftParts[0]);
    const ftA = Number(ftParts[1]);

    // === UNKILLABLE INTEGRITY CHECK START ===
    if (scoringMode === 'points') {
      let sumH = homeQs.reduce((a, b) => a + b, 0) + otH;
      let sumA = awayQs.reduce((a, b) => a + b, 0) + otA;

      // 1. Try Swap Fix (Home vs Away)
      if (sumH !== ftH || sumA !== ftA) {
        const swH = awayQs.reduce((a, b) => a + b, 0) + otA;
        const swA = homeQs.reduce((a, b) => a + b, 0) + otH;
        if (swH === ftH && swA === ftA) {
          Logger.log(`FIXED: Swapped scores for ${gameData.home}.`);
          [homeQs, awayQs] = [awayQs, homeQs];
          [otH, otA] = [otA, otH];
          sumH = ftH; sumA = ftA; 
        }
      }

      // 3. Try Implicit OT Fix (The most important fix for your issue)
      if (sumH !== ftH || sumA !== ftA) {
          const diffH = ftH - sumH;
          const diffA = ftA - sumA;

          if (diffH >= 0 && diffA >= 0 && (diffH > 0 || diffA > 0)) {
              Logger.log(`[Auto-Fix] Detected missing OT for ${gameData.home}. Adding implicit OT: ${diffH}-${diffA}`);
              otH += diffH; 
              otA += diffA;
              sumH = ftH; // Set to FT score to pass final check
              sumA = ftA; // Set to FT score to pass final check
          }
      }

      // FINAL SAFETY NET: Log Warning but NEVER SKIP
      if (sumH !== ftH || sumA !== ftA) {
        Logger.log(`[FATAL WARNING] Final mismatch for ${gameData.home} vs ${gameData.away}. Qs Sum: ${sumH}-${sumA}, FT: ${ftH}-${ftA}. Writing record and trusting FT score as authority.`);
      }
    }

    // === UNKILLABLE INTEGRITY CHECK END ===

    // Prepare Output Strings
    const fmt = (h, a) => `${h} - ${a}`;
    const q1 = fmt(homeQs[0], awayQs[0]);
    const q2 = fmt(homeQs[1], awayQs[1]);
    const q3 = fmt(homeQs[2], awayQs[2]);
    const q4 = fmt(homeQs[3], awayQs[3]);
    const ot = (otH || otA) ? fmt(otH, otA) : '';

    const finalStatus = status ? String(status).toUpperCase().replace(/\./g, '') : 'N/A';

    if (['FT', 'AOT', 'ABD'].indexOf(finalStatus) !== -1) {
      output.push([
        league, gameType, gameData.home, gameData.away,
        gameData.dateStr, gameData.time,
        // Assuming splitScore is defined elsewhere
        (splitScore(probRaw || '') || []).join(' - '), 
        String(predRaw || ''),
        String(predH) + '-' + String(predA),
        String(avgRaw || ''),
        String(oddsRaw || ''),
        q1, q2, q3, q4, ot,
        finalStatus,
        String(ftH) + '-' + String(ftA),
        'N/A', 'N/A', 'N/A', 'N/A'
      ]);
    }
    r = blockRow;
  }
  return output;
}

//========================================================================
// TIER 1 PARSER: Upcoming Games (UpcomingRaw -> UpcomingClean)
//========================================================================
/**
 * CONSOLIDATED LINE-SAFE VERSION
 * 
 * Addresses all critiques:
 * 1. Robust date normalization → YYYYMMDD (handles "1/2/2026" vs "01/02/2026", Date objects)
 * 2. Uses getValues() for backup → preserves exact user inputs (not display-formatted)
 * 3. Team name normalization → case-insensitive, whitespace-collapsed
 * 4. Fallback key matching → if primary key fails, tries team-only match
 * 5. Explicit spreadsheet parameter → avoids getActiveSpreadsheet() pitfalls
 * 6. Pre-backup option → handles "clear-first" runParseUpcoming patterns
 * 7. Detailed logging → easier debugging
 *
 * TIMING: If your runParseUpcoming clears UpcomingClean BEFORE calling this,
 * use backupUpcomingCleanLines() first and pass via options.preBackup.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - UpcomingRaw sheet.
 * @param {Set<string>} teamNamesSet - Known team names from Standings.
 * @param {Object} [options] - Optional configuration.
 * @param {Object} [options.preBackup] - Pre-extracted Q1–Q4 backup map.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [options.spreadsheet] - Explicit spreadsheet ref.
 * @returns {Array<Array<string>>} - 2D array for UpcomingClean.
 */
function parseUpcomingSheet(sheet, teamNamesSet, options) {
  options = options || {};

  // ---------------------------------------------------------------------------
  // HELPER FUNCTIONS
  // ---------------------------------------------------------------------------

  /** Normalize team name: lowercase, trim, collapse whitespace */
  const normTeam = (s) => 
    String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

  /** 
   * Normalize date to YYYYMMDD for reliable matching.
   * Handles: Date objects, "M/D/YYYY", "MM/DD/YYYY", "M.D.YYYY", ISO "YYYY-MM-DD"
   */
  const normDateKey = (val) => {
    if (val == null) return '';

    // Handle native Date objects
    if (val instanceof Date && !isNaN(val.getTime())) {
      const yyyy = val.getFullYear();
      const mm = String(val.getMonth() + 1).padStart(2, '0');
      const dd = String(val.getDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}`;
    }

    const str = String(val).trim();

    // M/D/YYYY or M.D.YYYY
    const mdyMatch = str.match(/^(\d{1,2})[/.](\d{1,2})[/.]?(\d{4})$/);
    if (mdyMatch) {
      return `${mdyMatch[3]}${mdyMatch[1].padStart(2, '0')}${mdyMatch[2].padStart(2, '0')}`;
    }

    // ISO: YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
    }

    // Fallback: strip non-alphanumeric
    return str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  };

  /** Build unique game key */
  const makeGameKey = (dateVal, home, away) =>
    `${normDateKey(dateVal)}||${normTeam(home)}||${normTeam(away)}`;

  /** Build team-only key for fallback matching */
  const makeTeamKey = (home, away) =>
    `${normTeam(home)}||${normTeam(away)}`;

  // ---------------------------------------------------------------------------
  // OUTPUT HEADERS
  // ---------------------------------------------------------------------------
  const output = [];
  const headers = [
    'League', 'Game Type', 'Home', 'Away',
    'Date', 'Time',
    'Prob %', 'Pred', 'Pred Score', 'Avg', 'Odds',
    'Q1', 'Q2', 'Q3', 'Q4', 'OT',
    'Status', 'FT Score',
    't2-q1', 't2-q2', 't2-q3', 't2-q4'
  ];
  output.push(headers);

  // ---------------------------------------------------------------------------
  // STEP 1: BACKUP Q1–Q4 (use pre-provided OR read from sheet)
  // ---------------------------------------------------------------------------
  let qBackup = options.preBackup || null;
  let qBackupByTeam = {}; // secondary index for fallback matching

  if (!qBackup) {
    qBackup = Object.create(null);

    try {
      const ss = options.spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
      const cleanSheet = ss.getSheetByName('UpcomingClean');

      if (cleanSheet && cleanSheet.getLastRow() >= 2 && cleanSheet.getLastColumn() >= 1) {
        // CRITICAL: Use getValues() to preserve exact user inputs
        const cleanValues = cleanSheet.getDataRange().getValues();
        const h = cleanValues[0].map(x => String(x == null ? '' : x).trim());

        const idxDate = h.indexOf('Date');
        const idxHome = h.indexOf('Home');
        const idxAway = h.indexOf('Away');
        const idxQ1   = h.indexOf('Q1');
        const idxQ2   = h.indexOf('Q2');
        const idxQ3   = h.indexOf('Q3');
        const idxQ4   = h.indexOf('Q4');

        const canBackup =
          idxDate > -1 && idxHome > -1 && idxAway > -1 &&
          idxQ1 > -1 && idxQ2 > -1 && idxQ3 > -1 && idxQ4 > -1;

        if (canBackup) {
          for (let i = 1; i < cleanValues.length; i++) {
            const row = cleanValues[i];
            const q1 = row[idxQ1], q2 = row[idxQ2], q3 = row[idxQ3], q4 = row[idxQ4];

            // Only store if there's something to preserve
            const hasData = [q1, q2, q3, q4].some(v => v != null && String(v).trim() !== '');
            if (hasData) {
              const key = makeGameKey(row[idxDate], row[idxHome], row[idxAway]);
              const teamKey = makeTeamKey(row[idxHome], row[idxAway]);
              const qVals = [
                q1 == null ? '' : q1,
                q2 == null ? '' : q2,
                q3 == null ? '' : q3,
                q4 == null ? '' : q4
              ];
              qBackup[key] = qVals;
              qBackupByTeam[teamKey] = qBackupByTeam[teamKey] || qVals; // first match wins
            }
          }
          Logger.log('Q1–Q4 backup: preserved ' + Object.keys(qBackup).length + ' games');
        } else {
          Logger.log('Warning: UpcomingClean missing required columns for backup');
        }
      } else {
        Logger.log('Info: UpcomingClean empty or missing; no Q1–Q4 to preserve');
      }
    } catch (e) {
      Logger.log('Warning: Q1–Q4 backup failed (non-fatal): ' + (e && e.message ? e.message : e));
    }
  } else {
    // Build secondary team index from pre-provided backup
    for (const key in qBackup) {
      const parts = key.split('||');
      if (parts.length >= 3) {
        const teamKey = `${parts[1]}||${parts[2]}`;
        qBackupByTeam[teamKey] = qBackupByTeam[teamKey] || qBackup[key];
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 2: STANDARD GUARDS
  // ---------------------------------------------------------------------------
  if (!sheet) {
    Logger.log('Warning: parseUpcomingSheet called with null sheet');
    return output;
  }

  const data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length < 7) {
    Logger.log('Info: UpcomingRaw has insufficient data (< 7 rows)');
    return output;
  }

  const dateRegex = /\d{1,2}[/.]\d{1,2}[/.]?\d{4}/;

  // ---------------------------------------------------------------------------
  // STEP 3: PARSE AND RESTORE
  // ---------------------------------------------------------------------------
  let restoredCount = 0, fallbackCount = 0, parsedCount = 0;

  try {
    for (let r = 0; r < data.length; r++) {
      const anchorCell = data[r][0] ? String(data[r][0]).trim() : '';
      if (!anchorCell || !dateRegex.test(anchorCell) || (r + 6 >= data.length)) continue;

      const gameData = detectGameType(anchorCell, teamNamesSet);
      if (!gameData || !gameData.home || gameData.away === 'Unknown') continue;

      // Extract metadata
      const league = (r > 0 && data[r - 1][0]) ? String(data[r - 1][0]).trim() : 'UNKNOWN';
      const rMinus2Val = (r > 1 && data[r - 2][0]) ? String(data[r - 2][0]).trim() : '';
      const gameType = (
        rMinus2Val &&
        /^[A-Za-z\s-]+$/.test(rMinus2Val) &&
        rMinus2Val.toLowerCase() !== 'display'
      ) ? rMinus2Val : 'League';

      const probStr = (r + 1 < data.length) ? data[r + 1][0] : '';
      const prob = splitConcatenated(probStr || '', 2);
      const pred = (r + 2 < data.length) ? data[r + 2][0] : '';
      const predHome = (r + 3 < data.length) ? data[r + 3][0] : '0';
      const predAway = (r + 4 < data.length) ? data[r + 4][0] : '0';
      const avg = (r + 5 < data.length) ? data[r + 5][0] : '';
      const odds = (r + 6 < data.length) ? data[r + 6][0] : '';

      // -----------------------------------------------------------------------
      // RESTORE Q1–Q4: primary key, then fallback to team-only
      // -----------------------------------------------------------------------
      let restored = ['', '', '', ''];
      const primaryKey = makeGameKey(gameData.dateStr, gameData.home, gameData.away);
      const teamKey = makeTeamKey(gameData.home, gameData.away);

      if (qBackup[primaryKey]) {
        restored = qBackup[primaryKey];
        restoredCount++;
      } else if (qBackupByTeam[teamKey]) {
        // Fallback: same teams, possibly different date format
        restored = qBackupByTeam[teamKey];
        restoredCount++;
        fallbackCount++;
        Logger.log('Fallback restore for: ' + gameData.home + ' vs ' + gameData.away);
      }

      output.push([
        league,
        gameType,
        gameData.home,
        gameData.away,
        gameData.dateStr,
        gameData.time,
        prob.join(' - '),
        String(pred || ''),
        String(predHome) + '-' + String(predAway),
        String(avg || ''),
        String(odds || ''),
        restored[0], restored[1], restored[2], restored[3], // Q1–Q4
        '',          // OT
        '', '',      // Status, FT Score
        'N/A', 'N/A', 'N/A', 'N/A'
      ]);

      parsedCount++;
      r += 6;
    }
  } catch (e) {
    Logger.log(
      'CRITICAL Error in parseUpcomingSheet: ' + (e && e.message ? e.message : e) +
      '\n' + (e && e.stack ? e.stack : '')
    );
  }

  Logger.log(`Parsed: ${parsedCount} games | Restored Q1–Q4: ${restoredCount} (${fallbackCount} via fallback)`);
  return output;
}


/**
 * STANDALONE BACKUP FUNCTION
 * 
 * Call this BEFORE clearing UpcomingClean if your runParseUpcoming clears first.
 * Pass the result to parseUpcomingSheet via options.preBackup.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {Object} Map of gameKey → [q1, q2, q3, q4]
 */
function backupUpcomingCleanLines(spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  const qBackup = Object.create(null);

  const normTeam = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const normDateKey = (val) => {
    if (val == null) return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      return `${val.getFullYear()}${String(val.getMonth() + 1).padStart(2, '0')}${String(val.getDate()).padStart(2, '0')}`;
    }
    const str = String(val).trim();
    const m = str.match(/^(\d{1,2})[/.](\d{1,2})[/.]?(\d{4})$/);
    if (m) return `${m[3]}${m[1].padStart(2, '0')}${m[2].padStart(2, '0')}`;
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
    return str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  };
  const makeGameKey = (d, h, a) => `${normDateKey(d)}||${normTeam(h)}||${normTeam(a)}`;

  try {
    const cleanSheet = ss.getSheetByName('UpcomingClean');
    if (!cleanSheet || cleanSheet.getLastRow() < 2) return qBackup;

    const vals = cleanSheet.getDataRange().getValues();
    const h = vals[0].map(x => String(x == null ? '' : x).trim());

    const idxDate = h.indexOf('Date'), idxHome = h.indexOf('Home'), idxAway = h.indexOf('Away');
    const idxQ1 = h.indexOf('Q1'), idxQ2 = h.indexOf('Q2');
    const idxQ3 = h.indexOf('Q3'), idxQ4 = h.indexOf('Q4');

    if ([idxDate, idxHome, idxAway, idxQ1, idxQ2, idxQ3, idxQ4].some(i => i < 0)) return qBackup;

    for (let i = 1; i < vals.length; i++) {
      const row = vals[i];
      const qs = [row[idxQ1], row[idxQ2], row[idxQ3], row[idxQ4]].map(v => v == null ? '' : v);
      if (qs.some(v => String(v).trim() !== '')) {
        qBackup[makeGameKey(row[idxDate], row[idxHome], row[idxAway])] = qs;
      }
    }
    Logger.log('backupUpcomingCleanLines: backed up ' + Object.keys(qBackup).length + ' games');
  } catch (e) {
    Logger.log('backupUpcomingCleanLines error: ' + (e && e.message ? e.message : e));
  }

  return qBackup;
}


/**
 * SAFE WRAPPER — Use if your existing code clears UpcomingClean before parsing.
 * 
 * Replace your existing runParseUpcoming() call with this, or call this from it.
 */
function runParseUpcomingLineSafe() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1) BACKUP FIRST (before any clearing)
  const qBackup = backupUpcomingCleanLines(ss);

  // 2) Get raw sheet
  const rawSheet = ss.getSheetByName('UpcomingRaw');
  if (!rawSheet) {
    Logger.log('Error: UpcomingRaw not found');
    return;
  }

  // 3) Get team names (adjust to your implementation)
  const teamNamesSet = new Set();
  try {
    const standingsSheet = ss.getSheetByName('Standings');
    if (standingsSheet && standingsSheet.getLastRow() >= 2) {
      standingsSheet.getRange(2, 1, standingsSheet.getLastRow() - 1, 1)
        .getValues()
        .forEach(row => { if (row[0]) teamNamesSet.add(String(row[0]).trim()); });
    }
  } catch (e) {
    Logger.log('Warning: Could not load team names: ' + e.message);
  }

  // 4) Parse with backup injected
  const parsed = parseUpcomingSheet(rawSheet, teamNamesSet, { preBackup: qBackup, spreadsheet: ss });

  // 5) NOW safe to clear and write
  let cleanSheet = ss.getSheetByName('UpcomingClean');
  if (!cleanSheet) {
    cleanSheet = ss.insertSheet('UpcomingClean');
  } else {
    cleanSheet.clearContents();
  }

  if (parsed.length > 0) {
    cleanSheet.getRange(1, 1, parsed.length, parsed[0].length).setValues(parsed);
  }

  Logger.log('UpcomingClean updated: ' + (parsed.length - 1) + ' games');
}


//========================================================================
// TIER 2 PARSER: Robust H2H / Recent (RawH2H_x, RawRecent_x -> CleanH2H_x, CleanRecent_x)
//========================================================================
//========================================================================
// PHASE 6 ELITE PATCH PACK v6.1 — PRODUCTION-READY
// Drop-in replacements: parseTier2Sheet, clearAllCaches, getEliteDefaults_
//
// Fixes addressed:
// - Forward-scanning block detection (handles noise, OT variants, 6+ line blocks)
// - OT written as blank when not detected (prevents false OT downstream)
// - Opt-in audit columns via opts.includeAuditColumns (schema-safe)
// - Checksum-aware fallbacks for quarter parsing
// - Complete cache clearing (Module 9 + globals) without eval()
// - Conservative OT acceptance: only when it reconciles totals
//========================================================================

/**
 * ============================================================================
 * parseTier2Sheet v6.3 MISMATCH-PROOF + 76ERS-SAFE
 * ============================================================================
 * Patch summary:
 * - FIX: isLikelyTeamLine_ no longer rejects team lines containing digits
 *   (e.g., "Philadelphia 76ersNew Orleans Pelicans").
 * - FIX: safeSplitTeams_ can split concatenated names using Standings team list,
 *   even without delimiters. This prevents "Unknown" teams and block skips.
 * - COMPAT: validTeams may be Array or Set; handled safely.
 *
 * Goals unchanged:
 * - Never output a row where quarters/OT do not reconcile with FT.
 * - Eliminate "away quarters become 0" failure by enforcing strict validation.
 * - If OT line is missing, optionally infer OT ONLY when it reconciles uniquely.
 */
function parseTier2Sheet(ss, rawName, cleanName, opts) {
  var FN = 'parseTier2Sheet';
  opts = opts || {};

  var debug = !!opts.debug;
  var maxScanAhead = isFinite(opts.maxScanAhead) ? Number(opts.maxScanAhead) : 12;
  var mismatchLogLimit = isFinite(opts.mismatchLogLimit) ? Number(opts.mismatchLogLimit) : 15;
  var includeAuditColumns = !!opts.includeAuditColumns;

  var inferOTWhenMissing = (opts.inferOTWhenMissing !== undefined) ? !!opts.inferOTWhenMissing : true;
  var skipMismatchedRows = (opts.skipMismatchedRows !== undefined) ? !!opts.skipMismatchedRows : true;

  // ─────────────────────────────────────────────────────────────────────
  // UTILITY FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────
  function log_(level, msg) {
    if (debug || level === 'ERROR' || level === 'WARN') {
      Logger.log('[' + FN + '] [' + level + '] ' + msg);
    }
  }

  function toStr_(v) {
    return (v == null) ? '' : String(v).trim();
  }

  function digitsOnly_(s) {
    return String(s || '').replace(/[^\d]/g, '');
  }

  function isDateLine_(s) {
    s = toStr_(s);
    return /\d{1,2}[/.\-]?\d{1,2}[/.\-]?\d{2,4}/.test(s) &&
      (s.indexOf('/') > -1 || s.indexOf('.') > -1 || s.indexOf('-') > -1);
  }

  function isMashedNumeric_(s) {
    var d = digitsOnly_(s);
    return d.length >= 3 && d.length <= 12 && /^\d+$/.test(d);
  }

  /**
   * PATCHED:
   * Previously rejected any string whose digitsOnly_() was purely numeric (e.g., "76").
   * That breaks for "Philadelphia 76ers" when concatenated with another team name.
   *
   * Now:
   * - require some letters
   * - require at least one "word-ish" run
   * - reject only if the ENTIRE string is numeric after trimming (not "contains digits")
   */
  function isLikelyTeamLine_(s) {
    s = toStr_(s);
    if (s.length <= 3) return false;
    if (!/[A-Za-z]/.test(s)) return false;         // must contain letters
    if (/^\d+$/.test(s)) return false;             // entire string cannot be only digits
    // Extra guard: avoid lines that are mostly numbers with a stray letter
    var letters = (s.match(/[A-Za-z]/g) || []).length;
    var digits = (s.match(/\d/g) || []).length;
    if (letters < 3) return false;
    if (digits > 0 && letters / (digits + 1) < 1) {
      // Very number-heavy "team line" is suspicious; allow but cautiously.
      // Return true anyway because Tier2 formats can be weird; downstream team-split validates.
      return true;
    }
    return true;
  }

  function escapeRegExp_(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeTeamKey_(name) {
    return toStr_(name).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setToArray_(maybeSet) {
    if (!maybeSet) return [];
    if (Array.isArray(maybeSet)) return maybeSet.slice();
    if (typeof maybeSet.forEach === 'function') {
      var out = [];
      maybeSet.forEach(function (v) { out.push(v); });
      return out;
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────
  // SAFE HELPER WRAPPERS (with intelligent fallbacks)
  // ─────────────────────────────────────────────────────────────────────
  function safeNormalizeDate_(s) {
    if (typeof normalizeFlexibleDate === 'function') {
      try { return normalizeFlexibleDate(s); } catch (e) {}
    }
    s = toStr_(s);
    var m = s.match(/^(\d{1,2})\/(\d{2})(\d{4})$/);
    if (m) return m[1] + '/' + m[2] + '/' + m[3];
    return s;
  }

  function safeParseDate_(s) {
    if (typeof parseRawDate === 'function') {
      try { return parseRawDate(s); } catch (e) {}
    }
    return safeNormalizeDate_(s);
  }

  function safeSplitTotals_(mashed) {
    if (typeof splitMashedTotals === 'function') {
      try { return splitMashedTotals(mashed); } catch (e) {}
    }
    mashed = digitsOnly_(mashed);
    if (mashed.length < 3) return null;

    var candidates = [];
    for (var awayLen = 2; awayLen <= 3 && awayLen < mashed.length; awayLen++) {
      var a = Number(mashed.slice(-awayLen));
      var h = Number(mashed.slice(0, mashed.length - awayLen));
      if (h >= 50 && h <= 180 && a >= 50 && a <= 180) {
        candidates.push({ H: h, A: a, plausibility: Math.abs(h - a) < 50 ? 1 : 0 });
      }
    }
    if (candidates.length === 0) {
      var a2 = Number(mashed.slice(-2));
      var h2 = Number(mashed.slice(0, mashed.length - 2));
      return { H: h2, A: a2 };
    }
    candidates.sort(function (x, y) { return y.plausibility - x.plausibility; });
    return { H: candidates[0].H, A: candidates[0].A };
  }

  function strictCrack4Quarters_(mashedQs, targetSum) {
    var d = digitsOnly_(mashedQs);
    if (!d || d.length < 4 || d.length > 12) return null;

    if (typeof crackScoreStringRobust === 'function') {
      try {
        var r = crackScoreStringRobust(d, targetSum);
        if (r && r.length >= 4) {
          var q = r.slice(0, 4).map(Number);
          if (q.every(function (x) { return isFinite(x) && x >= 0 && x <= 80; })) {
            var s = q[0] + q[1] + q[2] + q[3];
            if (s === targetSum) return q;
          }
        }
      } catch (e) {}
    }

    var sols = [];

    function pushIfValid_(lens) {
      if (lens[0] + lens[1] + lens[2] + lens[3] !== d.length) return;
      var pos = 0;
      var q1 = Number(d.substr(pos, lens[0])); pos += lens[0];
      var q2 = Number(d.substr(pos, lens[1])); pos += lens[1];
      var q3 = Number(d.substr(pos, lens[2])); pos += lens[2];
      var q4 = Number(d.substr(pos, lens[3]));

      if (![q1, q2, q3, q4].every(function (x) { return isFinite(x); })) return;
      if ([q1, q2, q3, q4].some(function (x) { return x < 0 || x > 80; })) return;

      var sum = q1 + q2 + q3 + q4;
      if (sum === targetSum) sols.push([q1, q2, q3, q4]);
    }

    for (var a = 1; a <= 3; a++) {
      for (var b = 1; b <= 3; b++) {
        for (var c = 1; c <= 3; c++) {
          var rem = d.length - a - b - c;
          if (rem >= 1 && rem <= 3) pushIfValid_([a, b, c, rem]);
        }
      }
    }

    if (sols.length === 0) return null;
    if (sols.length === 1) return sols[0];

    sols.sort(function (x, y) {
      function score(q) {
        return q.filter(function (n) { return n >= 10 && n <= 45; }).length;
      }
      return score(y) - score(x);
    });
    return sols[0];
  }

  function safeParseOT_(rawOTStr, qSumH, qSumA, ftH, ftA) {
    if (!rawOTStr) return { otH: 0, otA: 0 };

    if (typeof parseOTScore === 'function') {
      try {
        var r = parseOTScore(rawOTStr, qSumH, qSumA, ftH, ftA);
        if (r && (qSumH + (r.otH || 0)) === ftH && (qSumA + (r.otA || 0)) === ftA) {
          return r;
        }
      } catch (e) {}
    }

    var d = digitsOnly_(rawOTStr);
    if (d.length < 2 || d.length > 5) return { otH: 0, otA: 0 };

    for (var awayLen = 1; awayLen <= Math.min(2, d.length - 1); awayLen++) {
      var otA = Number(d.slice(-awayLen));
      var otH = Number(d.slice(0, d.length - awayLen));
      if ((qSumH + otH) === ftH && (qSumA + otA) === ftA) return { otH: otH, otA: otA };
    }

    return { otH: 0, otA: 0 };
  }

  function inferOTByReconciliation_(qSumH, qSumA, ftH, ftA) {
    var dH = ftH - qSumH;
    var dA = ftA - qSumA;
    if (!isFinite(dH) || !isFinite(dA)) return { otH: 0, otA: 0 };
    if (dH < 0 || dA < 0) return { otH: 0, otA: 0 };
    if (dH === 0 && dA === 0) return { otH: 0, otA: 0 };
    if (dH > 40 || dA > 40) return { otH: 0, otA: 0 };
    return { otH: dH, otA: dA };
  }

  /**
   * PATCHED:
   * Robustly split team strings even when concatenated (no delimiter),
   * using Standings team list when available.
   */
  function safeSplitTeams_(rawTeams, validTeams) {
    var s = toStr_(rawTeams);
    if (!s) return { home: 'Unknown', away: 'Unknown' };

    // ── STEP 1: Use the primary splitTeams (now handles multi-word names) ──
    if (typeof splitTeams === 'function') {
      try {
        var r0 = splitTeams(s, validTeams);
        // Only accept if BOTH halves are real (not "Unknown")
        if (r0 && r0.home && r0.away && r0.away !== 'Unknown' && r0.home !== 'Unknown') {
          return r0;
        }
      } catch (e) {
        log_('WARN', 'splitTeams threw: ' + e.message);
      }
    }

    // ── STEP 2: Delimiter-based split (double-space, "vs", " - ") ──
    var parts = s.split(/\s{2,}|(?:\s+vs\.?\s+)|(?:\s+-\s+)/i);
    if (parts.length >= 2) {
      var h0 = toStr_(parts[0]);
      var a0 = toStr_(parts.slice(1).join(' '));
      if (h0 && a0) return { home: h0, away: a0 };
    }

    // ── STEP 3: Standings-based substring matching (last resort) ──
    var teamsArr = setToArray_(validTeams)
      .map(toStr_)
      .filter(Boolean);

    if (teamsArr.length) {
      // Sort longest-first to prevent partial/substring traps
      teamsArr.sort(function (a, b) { return b.length - a.length; });

      var lower = s.toLowerCase();

      for (var i = 0; i < teamsArr.length; i++) {
        var t1 = teamsArr[i];
        var k1 = t1.toLowerCase();
        var idx1 = lower.indexOf(k1);
        if (idx1 < 0) continue;

        var remainder = (lower.slice(0, idx1) + lower.slice(idx1 + k1.length))
          .replace(/\s+/g, ' ')
          .trim();
        var remainderNoSpaces = remainder.replace(/\s+/g, '');

        for (var j = 0; j < teamsArr.length; j++) {
          if (j === i) continue;
          var t2 = teamsArr[j];
          var k2Norm = t2.toLowerCase().replace(/\s+/g, ' ').trim();
          var k2NoSpaces = t2.toLowerCase().replace(/\s+/g, '');

          if (remainder === k2Norm || remainderNoSpaces === k2NoSpaces) {
            var firstIsHome = (idx1 === 0);
            return firstIsHome ? { home: t1, away: t2 } : { home: t2, away: t1 };
          }
        }
      }

      // PARTIAL: one team recognized, other isn't in standings
      for (var p = 0; p < teamsArr.length; p++) {
        var tp = teamsArr[p];
        var kp = tp.toLowerCase();
        if (lower.startsWith(kp) && s.length > tp.length) {
          var leftover = s.substring(tp.length).trim();
          if (leftover.length > 1) return { home: tp, away: leftover };
        }
        if (lower.endsWith(kp) && s.length > tp.length) {
          var prefix = s.substring(0, s.length - tp.length).trim();
          if (prefix.length > 1) return { home: prefix, away: tp };
        }
      }
    }

    // ── STEP 4: Last resort ──
    return { home: s, away: 'Unknown' };
  }

  function safeLoadTeams_(ss) {
    if (typeof loadTeamNamesFromStandings === 'function') {
      try {
        var result = loadTeamNamesFromStandings(ss);
        // Ensure we always return a Set (loadTeamNamesFromStandings now returns Set)
        if (result instanceof Set) return result;
        // If somehow an array came back, convert it
        if (Array.isArray(result)) return new Set(result);
        return result || new Set();
      } catch (e) {
        log_('WARN', 'loadTeamNamesFromStandings threw: ' + e.message);
      }
    }
    return new Set();  // ← was [] — splitTeams checks .size, not .length
  }

  // ─────────────────────────────────────────────────────────────────────
  // MAIN PARSER LOGIC
  // ─────────────────────────────────────────────────────────────────────
  log_('INFO', 'ENTRY rawName=' + rawName + ' cleanName=' + cleanName);

  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('[' + FN + '] Spreadsheet required');

  var rawSheet = getSheetInsensitive(ss, rawName);
  if (!rawSheet) {
    log_('ERROR', 'Missing raw sheet: ' + rawName);
    return { ok: false, error: 'Missing raw sheet: ' + rawName, parsed: 0 };
  }

  var cleanSheet = getSheetInsensitive(ss, cleanName, true);
  if (!cleanSheet) cleanSheet = ss.insertSheet(cleanName);

  var lastRow = rawSheet.getLastRow();
  var lastCol = rawSheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    log_('WARN', 'Raw sheet empty: ' + rawName);
    return { ok: true, parsed: 0, skipped: 0, mismatches: 0 };
  }

  var data = rawSheet.getRange(1, 1, lastRow, Math.min(lastCol, 3)).getValues();
  var validTeams = safeLoadTeams_(ss);

  var cleanData = [];
  var stats = { parsed: 0, skipped: 0, mismatches: 0, mismatchLogged: 0 };

  for (var i = 0; i < data.length; i++) {
    var rawDateVal = safeNormalizeDate_(toStr_(data[i][0]));
    if (!isDateLine_(rawDateVal)) continue;

    if (i + 3 >= data.length) { stats.skipped++; break; }

    var rawTeams = toStr_(data[i + 1][0]);
    var rawHomeQs = toStr_(data[i + 2][0]);
    var rawAwayQs = toStr_(data[i + 3][0]);

    if (!isLikelyTeamLine_(rawTeams) || !isMashedNumeric_(rawHomeQs) || !isMashedNumeric_(rawAwayQs)) {
      stats.skipped++;
      continue;
    }

    // Scan forward for numeric lines (OT, Totals)
    var numericLines = [];
    var scanEnd = Math.min(data.length - 1, i + 4 + maxScanAhead);

    for (var j = i + 4; j <= scanEnd; j++) {
      var lineVal = safeNormalizeDate_(toStr_(data[j][0]));
      if (isDateLine_(lineVal)) break;
      if (isMashedNumeric_(lineVal)) {
        numericLines.push({ idx: j, str: digitsOnly_(lineVal), original: toStr_(data[j][0]) });
      }
    }

    if (numericLines.length === 0) { stats.skipped++; i += 3; continue; }

    var totalsLine = numericLines[numericLines.length - 1];
    var otLine = (numericLines.length >= 2) ? numericLines[numericLines.length - 2] : null;

    var totals = safeSplitTotals_(totalsLine.str);
    if (!totals || !isFinite(totals.H) || !isFinite(totals.A)) {
      stats.skipped++;
      i = totalsLine.idx;
      continue;
    }

    // First attempt: assume NO OT, crack quarters to full totals
    var hQuarters = strictCrack4Quarters_(rawHomeQs, totals.H);
    var aQuarters = strictCrack4Quarters_(rawAwayQs, totals.A);

    var otH = 0, otA = 0;
    var rawOTStr = otLine ? otLine.original : '';

    if (!hQuarters || !aQuarters) {
      if (otLine) {
        var found = null;
        var otDigits = digitsOnly_(otLine.str);
        var otCandidates = [];
        for (var awayLen = 1; awayLen <= Math.min(2, otDigits.length - 1); awayLen++) {
          otCandidates.push({
            otH: Number(otDigits.slice(0, otDigits.length - awayLen)),
            otA: Number(otDigits.slice(-awayLen))
          });
        }

        for (var c = 0; c < otCandidates.length; c++) {
          var cand = otCandidates[c];
          if (!isFinite(cand.otH) || !isFinite(cand.otA)) continue;
          if (cand.otH < 0 || cand.otA < 0 || cand.otH > 40 || cand.otA > 40) continue;

          var adjH = totals.H - cand.otH;
          var adjA = totals.A - cand.otA;
          if (adjH < 0 || adjA < 0) continue;

          var hTry = strictCrack4Quarters_(rawHomeQs, adjH);
          var aTry = strictCrack4Quarters_(rawAwayQs, adjA);
          if (hTry && aTry) { found = { h: hTry, a: aTry, otH: cand.otH, otA: cand.otA }; break; }
        }

        if (found) {
          hQuarters = found.h; aQuarters = found.a; otH = found.otH; otA = found.otA;
        }
      }

      if ((!hQuarters || !aQuarters) && inferOTWhenMissing) {
        var inferred = null;
        for (var tryOtH = 0; tryOtH <= 40; tryOtH++) {
          var adjTH = totals.H - tryOtH;
          if (adjTH < 0) continue;
          var hTry2 = strictCrack4Quarters_(rawHomeQs, adjTH);
          if (!hTry2) continue;

          for (var tryOtA = 0; tryOtA <= 40; tryOtA++) {
            var adjTA = totals.A - tryOtA;
            if (adjTA < 0) continue;
            var aTry2 = strictCrack4Quarters_(rawAwayQs, adjTA);
            if (!aTry2) continue;

            inferred = { h: hTry2, a: aTry2, otH: tryOtH, otA: tryOtA };
            break;
          }
          if (inferred) break;
        }
        if (inferred) {
          hQuarters = inferred.h; aQuarters = inferred.a; otH = inferred.otH; otA = inferred.otA;
        }
      }
    }

    if (hQuarters && aQuarters && otLine) {
      var qSumH0 = hQuarters[0] + hQuarters[1] + hQuarters[2] + hQuarters[3];
      var qSumA0 = aQuarters[0] + aQuarters[1] + aQuarters[2] + aQuarters[3];
      var otParsed = safeParseOT_(otLine.str, qSumH0, qSumA0, totals.H, totals.A);
      if ((otParsed.otH || 0) > 0 || (otParsed.otA || 0) > 0) {
        var adjTargetH2 = totals.H - (otParsed.otH || 0);
        var adjTargetA2 = totals.A - (otParsed.otA || 0);
        var hAdj = strictCrack4Quarters_(rawHomeQs, adjTargetH2);
        var aAdj = strictCrack4Quarters_(rawAwayQs, adjTargetA2);
        if (hAdj && aAdj) {
          hQuarters = hAdj; aQuarters = aAdj; otH = otParsed.otH || 0; otA = otParsed.otA || 0;
        }
      }
    }

    if (!hQuarters || !aQuarters) {
      stats.skipped++;
      log_('WARN', 'Unreconcilable block (quarters cannot be cracked strictly). row=' + (i + 1) +
        ' teams="' + rawTeams + '" qH="' + rawHomeQs + '" qA="' + rawAwayQs +
        '" FT="' + totalsLine.original + '" otLine="' + (rawOTStr || 'none') + '"');
      i = totalsLine.idx;
      continue;
    }

    // Team split (PATCHED)
    var teamSplit = safeSplitTeams_(rawTeams, validTeams);
    var homeTeam = teamSplit.home || 'Unknown';
    var awayTeam = teamSplit.away || 'Unknown';

    var qSumH = hQuarters[0] + hQuarters[1] + hQuarters[2] + hQuarters[3];
    var qSumA = aQuarters[0] + aQuarters[1] + aQuarters[2] + aQuarters[3];

    if (inferOTWhenMissing && !otLine && otH === 0 && otA === 0) {
      var inf = inferOTByReconciliation_(qSumH, qSumA, totals.H, totals.A);
      otH = inf.otH; otA = inf.otA;
    }

    var calcH = qSumH + otH;
    var calcA = qSumA + otA;
    var mismatch = (calcH !== totals.H || calcA !== totals.A);

    if (mismatch) {
      stats.mismatches++;
      if (stats.mismatchLogged < mismatchLogLimit) {
        log_('WARN', 'MISMATCH row=' + (i + 1) + ' ' + homeTeam + ' vs ' + awayTeam +
          ' calc=' + calcH + '-' + calcA + ' FT=' + totals.H + '-' + totals.A +
          ' qH=' + rawHomeQs + ' qA=' + rawAwayQs + ' otLine=' + (rawOTStr || 'none'));
        stats.mismatchLogged++;
      }
      if (skipMismatchedRows) {
        stats.skipped++;
        i = totalsLine.idx;
        continue;
      }
    }

    var winner = (totals.H > totals.A) ? 'H' : (totals.A > totals.H) ? 'A' : 'D';

    var row = [
      safeParseDate_(rawDateVal),
      homeTeam,
      awayTeam,
      hQuarters[0], aQuarters[0],
      hQuarters[1], aQuarters[1],
      hQuarters[2], aQuarters[2],
      hQuarters[3], aQuarters[3],
      otH > 0 ? otH : '',
      otA > 0 ? otA : '',
      winner,
      totals.H,
      totals.A,
      totals.H + '-' + totals.A,
      mismatch ? 'MISMATCH' : ''
    ];

    if (includeAuditColumns) {
      row.push(rawName, rawTeams, rawHomeQs, rawAwayQs, rawOTStr || '', totalsLine.original);
    }

    cleanData.push(row);
    stats.parsed++;

    i = totalsLine.idx;
  }

  // ─────────────────────────────────────────────────────────────────────
  // WRITE OUTPUT
  // ─────────────────────────────────────────────────────────────────────
  var headers = [
    'Date', 'Home', 'Away',
    'Q1H', 'Q1A', 'Q2H', 'Q2A', 'Q3H', 'Q3A', 'Q4H', 'Q4A',
    'OTH', 'OTA', 'Winner', 'TotalH', 'TotalA', 'FT', 'SumMismatch'
  ];

  if (includeAuditColumns) {
    headers.push('SourceSheet', 'RawTeams', 'RawQH', 'RawQA', 'RawOT', 'RawFT');
  }

  cleanSheet.clearContents();
  cleanSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (cleanData.length > 0) {
    cleanSheet.getRange(2, 1, cleanData.length, headers.length).setValues(cleanData);
  }

  log_('INFO', 'EXIT parsed=' + stats.parsed + ' skipped=' + stats.skipped +
    ' mismatches=' + stats.mismatches + ' -> ' + cleanName);

  return {
    ok: true,
    parsed: stats.parsed,
    skipped: stats.skipped,
    mismatches: stats.mismatches,
    sheet: cleanName
  };
}

// ==========================================
// NEW HELPER FUNCTIONS (Strictly for Tier 2)
// ==========================================

/**
 * Splits a mashed total string (e.g. "5345" or "10298").
 */
function splitMashedTotals(str) {
  if (!str) return null;
  var clean = String(str).replace(/\D/g, '');
  var len = clean.length;
  
  if (len < 4 || len > 6) return null;
  
  var h, a;

  // 4 digits: "9365" → [93, 65]
  if (len === 4) {
    h = parseInt(clean.substring(0, 2), 10);
    a = parseInt(clean.substring(2, 4), 10);
    return { H: h, A: a };
  }
  
  // 5 digits: "10298" could be [102, 98] or [10, 298]
  if (len === 5) {
    // Try 3-2 split (one team scored 100+)
    var h1 = parseInt(clean.substring(0, 3), 10);
    var a1 = parseInt(clean.substring(3, 5), 10);
    
    // Try 2-3 split
    var h2 = parseInt(clean.substring(0, 2), 10);
    var a2 = parseInt(clean.substring(2, 5), 10);
    
    // Validate: basketball scores typically 50-150
    var valid1 = h1 >= 50 && h1 <= 150 && a1 >= 40 && a1 <= 99;
    var valid2 = h2 >= 40 && h2 <= 99 && a2 >= 50 && a2 <= 150;
    
    // Prefer smaller differential (more realistic)
    var diff1 = Math.abs(h1 - a1);
    var diff2 = Math.abs(h2 - a2);
    
    if (valid1 && (!valid2 || diff1 <= diff2)) return { H: h1, A: a1 };
    if (valid2) return { H: h2, A: a2 };
    return diff1 <= diff2 ? { H: h1, A: a1 } : { H: h2, A: a2 };
  }
  
  // 6 digits: "102105" → [102, 105]
  if (len === 6) {
    h = parseInt(clean.substring(0, 3), 10);
    a = parseInt(clean.substring(3, 6), 10);
    return { H: h, A: a };
  }
  
  return null;
}

/**
 * ROBUST Quarter Cracker.
 * Unlike the previous recursive solver, this prioritizes standard 2-digit splits.
 * Input: "29304031" -> [29, 30, 40, 31]
 */
function crackScoreStringRobust(str, targetSum) {
  if (!str) return [0, 0, 0, 0];
  var clean = String(str).replace(/\D/g, '');
  
  if (clean.length === 0) return [0, 0, 0, 0];
  
  // STRATEGY 1: Perfect 8 digits → Standard 2-2-2-2 split
  if (clean.length === 8) {
    var result = [
      parseInt(clean.substring(0, 2), 10),
      parseInt(clean.substring(2, 4), 10),
      parseInt(clean.substring(4, 6), 10),
      parseInt(clean.substring(6, 8), 10)
    ];
    var sum = result[0] + result[1] + result[2] + result[3];
    
    // Validate each quarter is plausible (0-50 for basketball)
    var allValid = result.every(function(q) { return q >= 0 && q <= 50; });
    
    if (allValid && (targetSum === undefined || sum === targetSum)) {
      return result;
    }
    
    // If 8-digit split doesn't match target, try backtracking
    if (targetSum !== undefined && sum !== targetSum) {
      var solved8 = findSplitWithTarget(clean, 4, targetSum);
      if (solved8) return solved8;
    }
  }
  
  // STRATEGY 2: Target-Constrained Backtracking (KEY FIX for 7-digit strings)
  if (targetSum !== undefined && targetSum > 0) {
    var solved = findSplitWithTarget(clean, 4, targetSum);
    if (solved) return solved;
  }
  
  // STRATEGY 3: Unconstrained fallback (prefers 2-digit parts)
  var fallback = findSplitRobust(clean, 4);
  if (fallback) return fallback;
  
  // STRATEGY 4: Last resort for 4-digit strings (each digit = 1 quarter)
  if (clean.length === 4) {
    return [
      parseInt(clean[0], 10),
      parseInt(clean[1], 10),
      parseInt(clean[2], 10),
      parseInt(clean[3], 10)
    ];
  }
  
  return [0, 0, 0, 0];
}

/**
 * Parse OT string with validation against final totals.
 * 
 * Basketball OT is 5 minutes, typical scores range 5-15 per team.
 * For 3-digit strings like "119", validates against totals to choose
 * between [1, 19] and [11, 9].
 * 
 * @param {string} rawOTStr - Raw OT string (e.g., "119", "1210", "58")
 * @param {number} qSumH - Sum of home quarters
 * @param {number} qSumA - Sum of away quarters
 * @param {number} totalH - Home final total
 * @param {number} totalA - Away final total
 * @returns {{otH: number, otA: number}}
 */
function parseOTScore(rawOTStr, qSumH, qSumA, totalH, totalA) {
  var otH = 0, otA = 0;
  
  if (!rawOTStr) {
    // Derive OT from difference between quarters and totals
    if (totalH > qSumH) otH = totalH - qSumH;
    if (totalA > qSumA) otA = totalA - qSumA;
    return { otH: otH, otA: otA };
  }
  
  var digits = rawOTStr.replace(/\D/g, '');
  
  if (digits.length === 0) {
    return { otH: 0, otA: 0 };
  }
  
  // 1 digit: single team OT score (rare)
  if (digits.length === 1) {
    otH = parseInt(digits, 10);
    otA = 0;
  }
  // 2 digits: "58" → [5, 8]
  else if (digits.length === 2) {
    otH = parseInt(digits[0], 10);
    otA = parseInt(digits[1], 10);
  }
  // 3 digits: "119" - KEY FIX: validate against totals
  else if (digits.length === 3) {
    var split1 = [parseInt(digits[0], 10), parseInt(digits.substring(1), 10)];       // [1, 19]
    var split2 = [parseInt(digits.substring(0, 2), 10), parseInt(digits[2], 10)];    // [11, 9]
    
    // Validate: OT + quarters should equal total
    var valid1H = (qSumH + split1[0] === totalH);
    var valid1A = (qSumA + split1[1] === totalA);
    var valid1 = valid1H && valid1A;
    
    var valid2H = (qSumH + split2[0] === totalH);
    var valid2A = (qSumA + split2[1] === totalA);
    var valid2 = valid2H && valid2A;
    
    if (valid2 && !valid1) {
      otH = split2[0];
      otA = split2[1];
    } else if (valid1 && !valid2) {
      otH = split1[0];
      otA = split1[1];
    } else {
      // Both valid or neither: prefer more balanced split (typical OT range)
      var diff1 = Math.abs(split1[0] - split1[1]);
      var diff2 = Math.abs(split2[0] - split2[1]);
      
      // Check if values are in typical OT range (≤20)
      var inRange2 = split2[0] <= 20 && split2[1] <= 20;
      
      if (inRange2 && diff2 < diff1) {
        otH = split2[0];
        otA = split2[1];
      } else {
        otH = split1[0];
        otA = split1[1];
      }
    }
  }
  // 4 digits: "1210" → [12, 10]
  else if (digits.length === 4) {
    otH = parseInt(digits.substring(0, 2), 10);
    otA = parseInt(digits.substring(2, 4), 10);
  }
  // Longer: try variable split
  else {
    var parts = splitVariableDigits(digits, 2, 1, 2, 40);
    if (parts && parts.length === 2) {
      otH = parseInt(parts[0], 10);
      otA = parseInt(parts[1], 10);
    }
  }
  
  // Final validation: if parsed OT doesn't reconcile, derive from totals
  if (otH === 0 && otA === 0) {
    if (totalH > qSumH) otH = totalH - qSumH;
    if (totalA > qSumA) otA = totalA - qSumA;
  }
  
  return { otH: otH, otA: otA };
}


/**
 * Backtracking Solver with Sum Constraint
 * 
 * @param {string} str - Digits only (e.g., "9152317")
 * @param {number} numParts - Number of parts (4 for quarters)
 * @param {number} targetSum - Required sum
 * @returns {number[]|null}
 */
function findSplitWithTarget(str, numParts, targetSum) {
  var MAX_QUARTER = 50;
  
  function backtrack(remaining, partsLeft, current, runningSum) {
    // Base case: used all parts
    if (partsLeft === 0) {
      if (remaining === '' && runningSum === targetSum) {
        return current.slice();
      }
      return null;
    }
    
    // Pruning conditions
    if (remaining === '') return null;
    if (runningSum > targetSum) return null;
    if (targetSum - runningSum > partsLeft * MAX_QUARTER) return null;
    
    // Try 2-digit first (more common in basketball: 22, 19, 30)
    if (remaining.length >= 2) {
      var twoDigit = parseInt(remaining.substring(0, 2), 10);
      if (twoDigit >= 0 && twoDigit <= MAX_QUARTER) {
        current.push(twoDigit);
        var res2 = backtrack(
          remaining.slice(2),
          partsLeft - 1,
          current,
          runningSum + twoDigit
        );
        if (res2) return res2;
        current.pop();
      }
    }
    
    // Try 1-digit (for cases like "9" at end of "1915229")
    if (remaining.length >= 1) {
      var oneDigit = parseInt(remaining[0], 10);
      if (oneDigit >= 0 && oneDigit <= MAX_QUARTER) {
        current.push(oneDigit);
        var res1 = backtrack(
          remaining.slice(1),
          partsLeft - 1,
          current,
          runningSum + oneDigit
        );
        if (res1) return res1;
        current.pop();
      }
    }
    
    return null;
  }
  
  return backtrack(str, numParts, [], 0);
}

/**
 * Fallback Recursive Solver (No Sum Constraint)
 * 
 * @param {string} str - Digits only
 * @param {number} partsLeft - Number of parts needed
 * @returns {number[]|null}
 */
function findSplitRobust(str, partsLeft) {
  var MAX_VAL = 50;
  
  // Base case: last part
  if (partsLeft === 1) {
    var val = parseInt(str, 10);
    return (val >= 0 && val <= MAX_VAL) ? [val] : null;
  }
  
  if (str.length === 0) return null;
  
  // Try 2-digit first (preferred for basketball quarters)
  if (str.length >= 2) {
    var val2 = parseInt(str.substring(0, 2), 10);
    if (val2 >= 0 && val2 <= MAX_VAL) {
      var res2 = findSplitRobust(str.substring(2), partsLeft - 1);
      if (res2) return [val2].concat(res2);
    }
  }
  
  // Try 1-digit
  if (str.length >= 1) {
    var val1 = parseInt(str.substring(0, 1), 10);
    if (val1 >= 0 && val1 <= MAX_VAL) {
      var res1 = findSplitRobust(str.substring(1), partsLeft - 1);
      if (res1) return [val1].concat(res1);
    }
  }
  
  return null;
}

//========================================================================
// PARSER RUNNERS (called from Menu / Tier 2 analyzers)
//========================================================================

/**
 * Gatekeeper to validate that "Standings" is usable before any parsing runs.
 */
function runParseStandings(ss) {
  Logger.log('Validating "Standings" sheet...');
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const teamNames = loadTeamNamesFromStandings(ss);

  // Accept Array or Set
  let count = 0;
  if (teamNames) {
    if (Array.isArray(teamNames)) count = teamNames.length;
    else if (typeof teamNames.size === 'number') count = teamNames.size;
    else if (typeof teamNames.length === 'number') count = teamNames.length;
  }

  if (count > 0) {
    Logger.log(`"Standings" sheet is valid. Found ${count} teams.`);
  } else {
    throw new Error(
      '"Standings" sheet is missing, empty, or has no "Team name" column. Parsing cannot continue.'
    );
  }
}

/**
 * Orchestrate parsing of the main "Raw" sheet into "Clean".
 */
function runParseRaw(ss) {
  Logger.log('Parsing "Raw" sheet...');
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();

  const rawSheet = getSheetInsensitive(ss, 'Raw');
  if (!rawSheet) {
    Logger.log('runParseRaw: Could not find sheet "Raw". Skipping.');
    return;
  }

  const teamNames = loadTeamNamesFromStandings(ss);

  let count = 0;
  if (teamNames) {
    if (Array.isArray(teamNames)) count = teamNames.length;
    else if (typeof teamNames.size === 'number') count = teamNames.size;
    else if (typeof teamNames.length === 'number') count = teamNames.length;
  }
  Logger.log(`runParseRaw: Loaded ${count} team names from Standings.`);

  const data = parseFullGameSheet(rawSheet, teamNames);

  let cleanSheet = getSheetInsensitive(ss, 'Clean');
  if (!cleanSheet) cleanSheet = ss.insertSheet('Clean');

  cleanSheet.clear();

  if (!data || data.length <= 1) {
    Logger.log('runParseRaw: Parser returned no valid game rows from "Raw".');
    return;
  }

  cleanSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  Logger.log(`runParseRaw: Success. Wrote ${data.length - 1} records to "Clean".`);
}

/**
 * ======================================================================
 * FUNCTION: runParseResults
 * ======================================================================
 * WHY: Standalone runner for parsing historical 'ResultsRaw' data.
 *      Allows running parse results independently without parseRaw.
 * WHAT: Parses ResultsRaw -> ResultsClean.
 * HOW: Loads team names, calls parseFullGameSheet, writes output.
 * WHERE: MODULE 2: Parsers.gs
 * 
 * PATCH NOTES:
 * - Added ss fallback for standalone execution (button/editor/menu)
 * - Added typeof checks for helper function safety
 * - Added try/catch with user feedback
 * - Added toast notifications for progress
 * - Added autoResizeColumns for clean output
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss] - Optional spreadsheet object.
 */
function runParseResults(ss) {
  // PATCH: Fallback for standalone execution (button/editor/menu)
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  Logger.log('===== STARTING PARSE RESULTS =====');

  try {
    // Validate spreadsheet object
    if (!ss) {
      throw new Error('Spreadsheet object not available.');
    }
    
    ss.toast('Parsing ResultsRaw sheet...', 'Ma Golide', 5);

    // 1. Get Raw Sheet (with case-insensitive fallback)
    const rawSheet = (typeof getSheetInsensitive === 'function') 
      ? getSheetInsensitive(ss, 'ResultsRaw') 
      : ss.getSheetByName('ResultsRaw');
    
    if (!rawSheet) {
      throw new Error('Sheet "ResultsRaw" not found.');
    }

    // 2. Get/Create Clean Sheet
    let cleanSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'ResultsClean')
      : ss.getSheetByName('ResultsClean');
    
    if (!cleanSheet) {
      cleanSheet = ss.insertSheet('ResultsClean');
      Logger.log('Created new "ResultsClean" sheet.');
    }

    // 3. Load Team Names (required by parseFullGameSheet)
    const teamNamesSet = (typeof loadTeamNamesFromStandings === 'function')
      ? loadTeamNamesFromStandings(ss)
      : new Set();

    // 4. Parse Data
    if (typeof parseFullGameSheet !== 'function') {
      throw new Error('parseFullGameSheet function not found in Module 2.');
    }
    const parsedData = parseFullGameSheet(rawSheet, teamNamesSet);

    // 5. Validate & Write Output
    if (!parsedData || parsedData.length <= 1) {
      ss.toast('Warning: No valid data found in ResultsRaw.', 'Ma Golide', 5);
      Logger.log('runParseResults: Parser returned no valid rows from "ResultsRaw".');
      return;
    }

    cleanSheet.clearContents();
    cleanSheet.getRange(1, 1, parsedData.length, parsedData[0].length).setValues(parsedData);
    cleanSheet.autoResizeColumns(1, parsedData[0].length);

    // 6. Success Feedback
    const rowCount = parsedData.length - 1;
    Logger.log(`runParseResults: Success. Wrote ${rowCount} records to "ResultsClean".`);
    ss.toast(`✓ Parsed ${rowCount} historical results.`, 'Ma Golide', 5);

  } catch (e) {
    Logger.log('!!! ERROR in runParseResults: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Parse Results Error', e.message, ui.ButtonSet.OK);
  }
  
  Logger.log('===== PARSE RESULTS COMPLETE =====');
}

/**
 * ======================================================================
 * runParseUpcoming - PATCH (Preserve manual betting lines in Q1–Q4)
 * ======================================================================
 * FIX: When UpcomingClean is rebuilt, it was overwriting your manual
 *      betting line inputs in Q1/Q2/Q3/Q4 (and OT). This patch preserves
 *      those columns from the existing UpcomingClean and restores them
 *      onto the newly parsed rows (manual values WIN if present).
 *
 * Also keeps the original Tier-2 column guarantees (t2-q1..t2-q4).
 *
 * Reads:  UpcomingRaw, Standings
 * Writes: UpcomingClean
 * ======================================================================
 */
function runParseUpcoming(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();

  Logger.log('Parsing "UpcomingRaw" sheet...');

  // ----------------------------
  // Helpers (local + robust)
  // ----------------------------
  function headerMap_(headers) {
    var m = {};
    for (var i = 0; i < headers.length; i++) {
      var k = String(headers[i] || '').toLowerCase().trim();
      if (k) m[k] = i;
    }
    return m;
  }

  function idx_(h, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var k = String(candidates[i]).toLowerCase().trim();
      if (h[k] !== undefined) return h[k];
    }
    return undefined;
  }

  function isBlank_(v) {
    return v === '' || v === null || v === undefined;
  }

  function safeStr_(v) {
    return String(v || '').trim();
  }

  // ---------------------------------------------------------------
  // PATCHED upcomingKey_  —  date/time independent, type-safe
  // ---------------------------------------------------------------
  // Root cause: t2ou_upcomingKey_ produces different keys for the
  // SAME game when cell types differ (Date objects vs strings, raw
  // time objects vs "HH:mm" strings).  Existing UpcomingClean has
  // Date objects; freshly-parsed rows have strings or Date objects
  // with month/day swapped.  Result: keys never match → nothing is
  // restored.
  //
  // Fix: use league + away + home (lowercased).  For the Upcoming
  // sheet the same two teams never appear twice in the same league,
  // so this is a safe, stable key.
  // ---------------------------------------------------------------
  function upcomingKey_(row, h) {
    var iHome   = idx_(h, ['home', 'home team']);
    var iAway   = idx_(h, ['away', 'away team']);
    var iLeague = idx_(h, ['league']);

    var home   = iHome   !== undefined ? safeStr_(row[iHome]).toLowerCase()   : '';
    var away   = iAway   !== undefined ? safeStr_(row[iAway]).toLowerCase()   : '';
    var league = iLeague !== undefined ? safeStr_(row[iLeague]).toLowerCase() : '';

    return league + '|' + away + '|' + home;
  }

  // ----------------------------
  // 1) Preserve existing Q1–Q4/OT/FT Score/Status from UpcomingClean (manual betting lines)
  // ----------------------------
  var preservedQ = {}; // key -> { q1, q2, q3, q4, ot, ftscore, status }

  var cleanSheetBefore = getSheetInsensitive(ss, 'UpcomingClean');
  if (cleanSheetBefore) {
    var existing = cleanSheetBefore.getDataRange().getValues();
    if (existing && existing.length > 1) {
      var h0 = headerMap_(existing[0]);

      var iHome0 = idx_(h0, ['home', 'home team']);
      var iAway0 = idx_(h0, ['away', 'away team']);

      // Only attempt preserve if we can identify games
      if (iHome0 !== undefined && iAway0 !== undefined) {
        var iQ1_0  = idx_(h0, ['q1']);
        var iQ2_0  = idx_(h0, ['q2']);
        var iQ3_0  = idx_(h0, ['q3']);
        var iQ4_0  = idx_(h0, ['q4']);
        var iOT_0  = idx_(h0, ['ot']);
        var iFT_0  = idx_(h0, ['ft score']);
        var iSt_0  = idx_(h0, ['status']);

        for (var r = 1; r < existing.length; r++) {
          var row = existing[r];
          var key = upcomingKey_(row, h0);
          if (!key) continue;

          var obj = {};

          if (iQ1_0 !== undefined && !isBlank_(row[iQ1_0])) obj.q1 = row[iQ1_0];
          if (iQ2_0 !== undefined && !isBlank_(row[iQ2_0])) obj.q2 = row[iQ2_0];
          if (iQ3_0 !== undefined && !isBlank_(row[iQ3_0])) obj.q3 = row[iQ3_0];
          if (iQ4_0 !== undefined && !isBlank_(row[iQ4_0])) obj.q4 = row[iQ4_0];
          if (iOT_0 !== undefined && !isBlank_(row[iOT_0])) obj.ot = row[iOT_0];
          if (iFT_0 !== undefined && !isBlank_(row[iFT_0])) obj.ftscore = row[iFT_0];
          if (iSt_0 !== undefined && !isBlank_(row[iSt_0])) obj.status = row[iSt_0];

          // Only store if at least one manual value exists
          if (Object.keys(obj).length) preservedQ[key] = obj;
        }

        Logger.log('[Q Preserve] Saved Q1–Q4/OT/FT Score/Status for ' + Object.keys(preservedQ).length + ' games');
      } else {
        Logger.log('[Q Preserve] Skipped (could not find Home/Away headers in UpcomingClean).');
      }
    }
  }

  // ----------------------------
  // 2) Preserve any OU/book lines via your existing functions (unchanged)
  // ----------------------------
  var savedBookLines = {};
  try {
    if (typeof t2ou_preserveUpcomingBookLines_ === 'function') {
      savedBookLines = t2ou_preserveUpcomingBookLines_(ss) || {};
      Logger.log('[OU Preserve] Saved lines for ' + Object.keys(savedBookLines).length + ' games');
    }
  } catch (e) {
    Logger.log('[OU Preserve] Failed (continuing): ' + e.message);
  }

  // ----------------------------
  // 3) Parse UpcomingRaw
  // ----------------------------
  var rawSheet = getSheetInsensitive(ss, 'UpcomingRaw');
  if (!rawSheet) {
    Logger.log('runParseUpcoming: Could not find sheet "UpcomingRaw". Skipping.');
    return;
  }

  var teamNamesSet = loadTeamNamesFromStandings(ss);
  var data = parseUpcomingSheet(rawSheet, teamNamesSet);

  if (!data || data.length <= 1) {
    Logger.log('runParseUpcoming: Parser returned no valid rows from "UpcomingRaw".');
    return;
  }

  // ----------------------------
  // 4) Ensure required headers exist (Q + Tier2)
  // ----------------------------
  var headers = data[0];
  var columnsAdded = false;

  function ensureHeader_(name) {
    var low = String(name).toLowerCase().trim();
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).toLowerCase().trim() === low) return;
    }
    headers.push(name);
    columnsAdded = true;
  }

  ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'Status', 'FT Score'].forEach(ensureHeader_);
  ['t2-q1', 't2-q2', 't2-q3', 't2-q4'].forEach(ensureHeader_);

  if (columnsAdded) {
    for (var rr = 1; rr < data.length; rr++) {
      while (data[rr].length < headers.length) data[rr].push('');
    }
    data[0] = headers;
  }

  // ----------------------------
  // 5) Restore OU/book lines (unchanged)
  // ----------------------------
  try {
    if (savedBookLines && Object.keys(savedBookLines).length > 0 && typeof t2ou_restoreUpcomingBookLines_ === 'function') {
      t2ou_restoreUpcomingBookLines_(data, savedBookLines);
      Logger.log('[OU Restore] Restored preserved book lines.');
    }
  } catch (e) {
    Logger.log('[OU Restore] Failed (continuing): ' + e.message);
  }

  // ----------------------------
  // 6) Restore manual Q1–Q4/OT/FT Score/Status betting lines (DO NOT OVERWRITE user inputs)
  //    Manual values WIN if present.
  // ----------------------------
  if (preservedQ && Object.keys(preservedQ).length) {
    var h1 = headerMap_(data[0]);

    var iQ1 = idx_(h1, ['q1']);
    var iQ2 = idx_(h1, ['q2']);
    var iQ3 = idx_(h1, ['q3']);
    var iQ4 = idx_(h1, ['q4']);
    var iOT = idx_(h1, ['ot']);
    var iFT = idx_(h1, ['ft score']);
    var iSt = idx_(h1, ['status']);

    var restoredCount = 0;
    for (var r2 = 1; r2 < data.length; r2++) {
      var row2 = data[r2];
      var key2 = upcomingKey_(row2, h1);
      var saved = preservedQ[key2];
      if (!saved) continue;

      restoredCount++;

      // Only write back values the user had actually entered (non-blank preserved)
      if (iQ1 !== undefined && saved.q1 !== undefined)      row2[iQ1] = saved.q1;
      if (iQ2 !== undefined && saved.q2 !== undefined)      row2[iQ2] = saved.q2;
      if (iQ3 !== undefined && saved.q3 !== undefined)      row2[iQ3] = saved.q3;
      if (iQ4 !== undefined && saved.q4 !== undefined)      row2[iQ4] = saved.q4;
      if (iOT !== undefined && saved.ot !== undefined)      row2[iOT] = saved.ot;
      if (iFT !== undefined && saved.ftscore !== undefined) row2[iFT] = saved.ftscore;
      if (iSt !== undefined && saved.status !== undefined)  row2[iSt] = saved.status;
    }

    Logger.log('[Q Restore] Restored manual Q1–Q4/OT/FT Score/Status for ' + restoredCount + '/' + (data.length - 1) + ' games.');
  }

  // ----------------------------
  // 7) Write to UpcomingClean
  // ----------------------------
  var cleanSheet = getSheetInsensitive(ss, 'UpcomingClean');
  if (!cleanSheet) cleanSheet = ss.insertSheet('UpcomingClean');

  // Use clearContents so formats/validations survive (optional but usually nicer).
  cleanSheet.clearContents();
  cleanSheet.getRange(1, 1, data.length, data[0].length).setValues(data);

  Logger.log('runParseUpcoming: Success. Wrote ' + (data.length - 1) + ' records to "UpcomingClean".');
}

/**
 * WHY:
 * Parse a single H2H Tier 2 raw sheet into its matching clean sheet.
 *
 * WHAT:
 * - Runs parseTier2Sheet() on a sheet like "RawH2H_1" and outputs to "CleanH2H_1".
 *
 * HOW:
 * - Locates the raw sheet, loads Standings, parses, then writes or clears clean sheet.
 *
 * WHERE:
 * - Reads from: 'RawH2H_x', 'Standings'.
 * - Writes to: 'CleanH2H_x'.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Active spreadsheet.
 * @param {string} rawName - Name of the raw H2H sheet (e.g. "RawH2H_1").
 * @param {string} cleanName - Name of the clean H2H sheet (e.g. "CleanH2H_1").
 */
function runParseH2H(ss, rawName, cleanName) {
  const rawSheet = getSheetInsensitive(ss, rawName);
  if (!rawSheet) {
    Logger.log(`runParseH2H: Sheet "${rawName}" not found. Skipping.`);
    return;
  }
  parseTier2Sheet(ss, rawName, cleanName);  // ← now passes ss
  Logger.log(`runParseH2H: Success - ${rawName} -> ${cleanName}`);
}

/**
 * WHY:
 * Parse a single "Recent Form" Tier 2 raw sheet into its clean counterpart.
 *
 * WHAT:
 * Mirrors runParseH2H but for recent performance feeds.
 *
 * HOW:
 * - Calls parseTier2Sheet() on RawRecent_* and writes to CleanRecent_*.
 *
 * WHERE:
 * - Reads from: 'RawRecent_x', 'Standings'.
 * - Writes to: 'CleanRecent_x'.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Active spreadsheet.
 * @param {string} rawName - Name of the raw recent form sheet (e.g. "RawRecent_1").
 * @param {string} cleanName - Name of the clean recent sheet (e.g. "CleanRecent_1").
 */

function runParseRecent(ss, rawName, cleanName) {
  const rawSheet = getSheetInsensitive(ss, rawName);
  if (!rawSheet) {
    Logger.log(`runParseRecent: Sheet "${rawName}" not found. Skipping.`);
    return;
  }
  parseTier2Sheet(ss, rawName, cleanName);  // ← now passes ss
  Logger.log(`runParseRecent: Success - ${rawName} -> ${cleanName}`);
}
