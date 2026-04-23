/**
 * CRITICAL: Map single-underscore helper to double-underscore version to fix legacy reference errors.
 * This is a defensive bridge to prevent "ReferenceError: __s5_getSheet is not defined" crashes.
 */
var __s5_getSheet = (typeof __s5_getSheet__ === 'function') ? __s5_getSheet__ : function(ss, name, silent) {
  if (typeof getSheetInsensitive === 'function') return getSheetInsensitive(ss, name);
  return (ss && typeof ss.getSheetByName === 'function') ? ss.getSheetByName(name) : null;
};

/**
 * ======================================================================
 * MODULE 5
 * PROJECT: Ma Golide
 * VERSION: 2.1  
 *
 * PURPOSE: This file is the "Forecaster" of the operation.
 * It takes *upcoming* games (from 'UpcomingClean') and enriches them 
 * with historical context (from 'Clean', 'ResultsClean', 'Standings', 
 * and stats from Module 3) to create Tier 1 predictions.
 *
 * KEY QUESTION ANSWERED: "Based on each team's current rank, streak, 
 * recent form, and historical data, what does MaGolide predict?"
 *
 * ARCHITECTURE:
 * - Section 1: Canonical Scorer (Grok) - Pure scoring calculation
 * - Section 2: Canonical Logger (Gemini) - Forensic audit trail with UPSERT
 * - Section 3: Main Orchestrator (z.ai) - Ties everything together
 * - Section 4: Feature Calculators - Extract prediction features
 * - Section 5: Local Helpers - Module-specific utilities
 * - Section 6: Automated Config Tuner - Weight optimization
 *
 * [PATCH 2.1]: Implemented upsert logic in logger to prevent duplicate
 *              entries when re-running with the same config_version.
 *              Previous versions blindly appended rows.
 *
 * DEPENDENCIES (from Module 1: Helpers.gs):
 * - getSheetInsensitive(spreadsheet, sheetName)
 * - createHeaderMap(headerRow)
 * - parseScore(scoreStr)
 * - loadTier1Config(ss)
 * - loadStatsFromSheet(sheet)
 * - loadQuarterWinnerStats(sheet)
 * - loadQuarterOUStats(sheet)
 *
 * WRITES TO:
 * - 'Analysis_Tier1' - Human-readable prediction output
 * - 'Tier1_Predictions' - Forensic audit log (for post-hoc analysis)
 * ======================================================================
 */



/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE 4: TIER 1 ANALYZERS (ELITE ROBUST VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT: Core analysis functions for Tier 1 game predictions
 * WHY: Provides robust, production-ready prediction scoring and analysis
 * WHERE: Analyzers_Tier1.gs
 *
 * FEATURES:
 *   - Super robust parsing (handles NBSP, BOM, en-dash, various formats)
 *   - NaN/Infinity guards everywhere
 *   - Preserves legitimate 0 values (uses safeNum vs ||)
 *   - Probability-based confidence (not just sigmoid)
 *   - Comprehensive logging and debugging metadata
 *   - Backward compatible with legacy configs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: SHARED HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: safeNum_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Safely coerce any value to a number, returning fallback if invalid.
 * WHAT: Handles null, undefined, empty string, comma-formatted numbers, NaN.
 * HOW: Checks type, parses string with comma removal, validates with isFinite.
 *
 * @param {*} val - Value to convert
 * @param {number} fallback - Default if conversion fails
 * @returns {number} Converted number or fallback
 */
function safeNum_(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') return isFinite(val) ? val : fallback;
  
  var str = String(val).trim().replace(/,/g, '');
  var num = parseFloat(str);
  return isFinite(num) ? num : fallback;
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: clamp_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Constrain value to valid range with NaN safety.
 * WHAT: Returns value clamped between min and max.
 * HOW: Checks isFinite, then applies Math.min/max.
 *
 * @param {number} n - Value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 */
function clamp_(n, min, max) {
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: normalizeText_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Clean text for reliable parsing (removes NBSP, BOM, extra whitespace).
 * WHAT: Normalizes text by removing invisible characters and trimming.
 * HOW: String replacement chain for common problematic characters.
 *
 * @param {*} str - String to normalize
 * @returns {string} Cleaned string
 */
function normalizeText_(str) {
  return String(str || '')
    .replace(/\u00A0/g, ' ')   // Non-breaking space
    .replace(/\uFEFF/g, '')    // Byte order mark
    .replace(/\u200B/g, '')    // Zero-width space
    .trim();
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: normalizeTeamName_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Standardize team names for reliable matching across sources.
 * WHAT: Lowercase, remove punctuation, collapse whitespace.
 * HOW: String transformations for consistent comparison.
 *
 * @param {string} name - Team name to normalize
 * @returns {string} Normalized team name
 */
function normalizeTeamName_(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, '')      // Smart quotes
    .replace(/[.\-,]/g, ' ')    // Punctuation to space
    .replace(/\s+/g, ' ');      // Collapse whitespace
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: isNonZero_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Check if a number is finite and non-zero (for weight detection).
 * WHAT: Uses epsilon to avoid floating-point precision issues.
 *
 * @param {number} n - Number to check
 * @returns {boolean} True if finite and non-zero
 */
function isNonZero_(n) {
  return isFinite(n) && Math.abs(n) > 1e-9;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: PROBABILITY PARSING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: parseHomeAwayProbability_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Forebet "Prob %" column has many formats that need robust parsing.
 * 
 * WHAT: Parse a "home-away" probability cell into {home, away} percentages.
 *
 * HOW: Handles multiple formats:
 *   - Number: 67 => home=67, away=33
 *   - String: "67 - 33", "67–33", "67% - 33%"
 *   - Labels: "Home 67 Away 33"
 *   - Fractions: "0.67 - 0.33"
 *
 * WHERE: Called by _getForebetFavoredProbability_ and _calculateForebetDifference
 *
 * @param {*} probCell - Raw probability cell value
 * @returns {Object} {home: number, away: number, ok: boolean, source: string}
 */
function parseHomeAwayProbability_(probCell) {
  // Default neutral result
  var result = { home: 50, away: 50, ok: false, source: 'default' };

  if (probCell === null || probCell === undefined || probCell === '') {
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 1: Numeric cell (already a number)
  // ─────────────────────────────────────────────────────────────────────────
  if (typeof probCell === 'number' && isFinite(probCell)) {
    var homeNum = probCell;
    
    // If it's a fraction (0-1), convert to percentage
    if (homeNum >= 0 && homeNum <= 1) {
      homeNum *= 100;
    }
    
    homeNum = clamp_(homeNum, 0, 100);
    result.home = homeNum;
    result.away = 100 - homeNum;
    result.ok = true;
    result.source = 'number';
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 2: String cell - extract all numbers
  // ─────────────────────────────────────────────────────────────────────────
  var str = normalizeText_(probCell);
  
  // Extract all numbers from the string (super tolerant regex)
  // Example: "Home 67% Away 33%" -> ["67", "33"]
  var matches = str.match(/(\d+(?:\.\d+)?)/g) || [];
  
  if (matches.length === 0) {
    return result;
  }

  // Convert to numbers and filter valid values
  var nums = [];
  for (var i = 0; i < matches.length; i++) {
    var val = parseFloat(matches[i]);
    if (isFinite(val)) {
      nums.push(val);
    }
  }
  
  if (nums.length === 0) {
    return result;
  }

  // Filter to plausible probability values (0-1 or 0-100)
  var plausible = nums.filter(function(x) {
    return (x >= 0 && x <= 1) || (x >= 0 && x <= 100);
  });
  
  if (plausible.length >= 2) {
    nums = plausible;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 2a: Single number - treat as home probability
  // ─────────────────────────────────────────────────────────────────────────
  var home = nums[0];
  var away = (nums.length >= 2) ? nums[1] : NaN;

  if (!isFinite(away)) {
    // Only one number found - interpret as home prob
    if (home >= 0 && home <= 1) home *= 100;
    home = clamp_(home, 0, 100);
    result.home = home;
    result.away = 100 - home;
    result.ok = true;
    result.source = 'single';
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 2b: Two numbers - treat as home/away pair
  // ─────────────────────────────────────────────────────────────────────────
  
  // Convert fractions to percents if both look like fractions
  if (home >= 0 && home <= 1 && away >= 0 && away <= 1) {
    home *= 100;
    away *= 100;
  }

  home = clamp_(home, 0, 100);
  away = clamp_(away, 0, 100);

  // Normalize if they don't add to ~100 (common with weighted inputs)
  var sum = home + away;
  if (sum > 0 && Math.abs(sum - 100) > 3) {
    home = (home / sum) * 100;
    away = 100 - home;
    result.source = 'normalized';
  } else {
    result.source = 'pair';
  }

  result.home = clamp_(home, 0, 100);
  result.away = clamp_(away, 0, 100);
  result.ok = true;
  
  return result;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: interpretPredictionSide_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Forebet predictions come in various formats that need standardization.
 *
 * WHAT: Interpret a prediction cell into 'HOME'|'AWAY'|'DRAW'|'UNKNOWN'.
 *
 * HOW: Pattern matching for common formats:
 *   - Numeric: 1/2
 *   - Text: home/away, H/A
 *   - Team name matching (fallback)
 *
 * WHERE: Called by probability and difference calculators
 *
 * @param {*} predCell - Raw prediction cell value
 * @param {string} [homeTeam] - Home team name for matching
 * @param {string} [awayTeam] - Away team name for matching
 * @returns {string} 'HOME'|'AWAY'|'DRAW'|'UNKNOWN'
 */
function interpretPredictionSide_(predCell, homeTeam, awayTeam) {
  var pred = normalizeText_(predCell).toLowerCase();
  
  if (!pred) return 'UNKNOWN';

  // ─────────────────────────────────────────────────────────────────────────
  // Standard prediction formats
  // ─────────────────────────────────────────────────────────────────────────
  if (pred === '1' || pred === 'h' || pred.includes('home')) return 'HOME';
  if (pred === '2' || pred === 'a' || pred.includes('away')) return 'AWAY';
  if (pred === 'x' || pred.includes('draw')) return 'DRAW';

  // ─────────────────────────────────────────────────────────────────────────
  // Team name matching fallback
  // ─────────────────────────────────────────────────────────────────────────
  var homeName = normalizeTeamName_(homeTeam);
  var awayName = normalizeTeamName_(awayTeam);
  var predNorm = normalizeTeamName_(pred);

  if (homeName && predNorm.includes(homeName)) return 'HOME';
  if (awayName && predNorm.includes(awayName)) return 'AWAY';

  return 'UNKNOWN';
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: FEATURE CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: getForebetFavoredProbability_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: In UpcomingClean, "Prob %" is stored as "XX - YY" where XX=home, YY=away.
 *      Previously, parseFloat("30 - 70") always returned 30, even for AWAY predictions.
 *
 * WHAT: Return the probability of the PREDICTED side.
 *
 * HOW:
 *   1) Parse "XX - YY" with parseHomeAwayProbability_
 *   2) Determine predicted side with interpretPredictionSide_
 *   3) Return the appropriate probability
 *
 * WHERE: Called by analyzeTier1 for Forebet % column and prediction logging
 *
 * @param {*} forebetPred - Forebet prediction (1, 2, "home", "away", team name)
 * @param {*} probCell - Raw probability cell (e.g., "30 - 70" or 70)
 * @param {string} [homeTeam] - Home team name for matching
 * @param {string} [awayTeam] - Away team name for matching
 * @returns {number} Probability (0-100) of the predicted side
 */
function getForebetFavoredProbability_(forebetPred, probCell, homeTeam, awayTeam) {
  // Guard: Return 0 if missing data
  if (probCell === null || probCell === undefined || probCell === '') {
    return 0;
  }

  var side = interpretPredictionSide_(forebetPred, homeTeam, awayTeam);
  var probs = parseHomeAwayProbability_(probCell);

  // Return probability for the predicted side
  if (side === 'HOME') return probs.home;
  if (side === 'AWAY') return probs.away;
  if (side === 'DRAW') return Math.max(probs.home, probs.away);

  // Unknown prediction - return stronger side as fallback
  return Math.max(probs.home, probs.away);
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateForebetDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Forebet provides external expert predictions that should influence our score.
 *
 * WHAT: Calculate Forebet's prediction advantage as a signed difference.
 *       Positive = favors HOME, Negative = favors AWAY.
 *
 * HOW:
 *   1) Parse probability using parseHomeAwayProbability_
 *   2) Determine side using interpretPredictionSide_
 *   3) Scale: (prob - 50) / 10 => 60% gives ±1.0 magnitude
 *
 * WHERE: Called by analyzeTier1 for forebetDiff feature
 *
 * @param {*} forebetPred - Forebet prediction value
 * @param {*} forebetProbStr - Probability string (e.g., "67 - 33")
 * @param {string} [homeTeam] - Home team name
 * @param {string} [awayTeam] - Away team name
 * @returns {number} Signed difference (-5 to +5 typical range)
 */
function calculateForebetDifference_(forebetPred, forebetProbStr, homeTeam, awayTeam) {
  if (!forebetPred || forebetProbStr === null || forebetProbStr === undefined || forebetProbStr === '') {
    return 0;
  }

  var side = interpretPredictionSide_(forebetPred, homeTeam, awayTeam);
  var probs = parseHomeAwayProbability_(forebetProbStr);

  // Scale: (prob - 50) / 10 => 60% = +1.0, 70% = +2.0
  // Sign: positive favors HOME, negative favors AWAY
  if (side === 'HOME') {
    return (probs.home - 50) / 10;
  }
  if (side === 'AWAY') {
    return -((probs.away - 50) / 10);
  }

  // Draw or unknown - no differential
  return 0;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateVariancePenalty_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: High-variance teams are unpredictable - predictions should be penalized.
 *
 * WHAT: Calculate variance penalty based on team scoring variance.
 *       Returns 0-1 where 1 = maximum penalty.
 *
 * HOW:
 *   1) Look up variance for both teams (default 10 if missing)
 *   2) Average the variances
 *   3) Scale to 0-1 range (variance/20, capped at 1)
 *
 * WHERE: Called by analyzeTier1 for variancePenalty feature
 *
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @param {Object} varianceMap - Map of team -> variance
 * @returns {number} Penalty value (0-1)
 */
function calculateVariancePenalty_(homeTeam, awayTeam, varianceMap) {
  varianceMap = varianceMap || {};
  var DEFAULT_VARIANCE = 10;

  // Normalize team names for lookup
  var homeKey = normalizeTeamName_(homeTeam);
  var awayKey = normalizeTeamName_(awayTeam);

  var homeVar = safeNum_(varianceMap[homeKey], DEFAULT_VARIANCE);
  var awayVar = safeNum_(varianceMap[awayKey], DEFAULT_VARIANCE);

  var avgVariance = (homeVar + awayVar) / 2;
  
  // Scale to 0-1 range, capped at 1
  return Math.min(1, avgVariance / 20);
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateRankDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Team rankings provide baseline strength comparison.
 *
 * WHAT: Calculate normalized rank difference (away - home).
 *       Positive = home is higher ranked (lower number).
 *
 * HOW: Simple subtraction with default rank of 15 for missing teams.
 *
 * WHERE: Called by analyzeTier1 for rankDiff feature
 *
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Rank difference
 */
function calculateRankDifference_(homeStandings, awayStandings) {
  var DEFAULT_RANK = 15;
  
  var homeRank = safeNum_(homeStandings && homeStandings.rank, DEFAULT_RANK);
  var awayRank = safeNum_(awayStandings && awayStandings.rank, DEFAULT_RANK);
  
  // Higher rank number = worse team, so (away - home) favors home if positive
  return awayRank - homeRank;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculatePCTDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Win percentage is a strong predictor of team strength.
 *
 * WHAT: Calculate PCT difference (home - away), scaled.
 *       Positive = home has better record.
 *
 * HOW: Subtract PCT values, scale by 100 for interpretability.
 *
 * WHERE: Called by analyzeTier1 for pctDiff feature
 *
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} PCT difference (scaled)
 */
function calculatePCTDifference_(homeStandings, awayStandings) {
  var DEFAULT_PCT = 0.5;
  
  var homePct = safeNum_(homeStandings && homeStandings.pct, DEFAULT_PCT);
  var awayPct = safeNum_(awayStandings && awayStandings.pct, DEFAULT_PCT);
  
  // Scale by 100 for better interpretability (0.60 - 0.40 = 0.20 => 20)
  return (homePct - awayPct) * 100;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateNetRatingDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Net rating (point differential per game) captures team efficiency.
 *
 * WHAT: Calculate net rating difference (home - away).
 *       Positive = home has better point differential.
 *
 * WHERE: Called by analyzeTier1 for netRtgDiff feature
 *
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Net rating difference
 */
function calculateNetRatingDifference_(homeStandings, awayStandings) {
  var DEFAULT_NET_RTG = 0;
  
  var homeNetRtg = safeNum_(homeStandings && homeStandings.netRtg, DEFAULT_NET_RTG);
  var awayNetRtg = safeNum_(awayStandings && awayStandings.netRtg, DEFAULT_NET_RTG);
  
  return homeNetRtg - awayNetRtg;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateHomeCourtEffect_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Some teams perform significantly better at home vs away.
 *
 * WHAT: Calculate home court advantage using home/away splits.
 *       Combines home team's home PCT vs away team's away PCT.
 *
 * HOW: (home team's homePct - away team's awayPct) * 100
 *
 * WHERE: Called by analyzeTier1 for homeCourtEffect feature
 *
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Home court effect (scaled)
 */
function calculateHomeCourtEffect_(homeStandings, awayStandings) {
  var DEFAULT_PCT = 0.5;
  
  var homeHomePct = safeNum_(homeStandings && homeStandings.homePct, DEFAULT_PCT);
  var awayAwayPct = safeNum_(awayStandings && awayStandings.awayPct, DEFAULT_PCT);
  
  return (homeHomePct - awayAwayPct) * 100;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateMomentumDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Recent form (L10) indicates current team momentum.
 *
 * WHAT: Calculate momentum difference based on last 10 games.
 *       Positive = home has better recent form.
 *
 * WHERE: Called by analyzeTier1 for momentumDiff feature
 *
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Momentum difference (scaled)
 */
function calculateMomentumDifference_(homeStandings, awayStandings) {
  var DEFAULT_L10 = 0.5;
  
  var homeL10 = safeNum_(homeStandings && homeStandings.l10Pct, DEFAULT_L10);
  var awayL10 = safeNum_(awayStandings && awayStandings.l10Pct, DEFAULT_L10);
  
  return (homeL10 - awayL10) * 100;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateStreakDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Win/loss streaks affect team confidence and momentum.
 *
 * WHAT: Calculate streak difference (home - away).
 *       Positive values favor home (home on win streak, away on loss streak).
 *
 * WHERE: Called by analyzeTier1 for streakDiff feature
 *
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Streak difference
 */
function calculateStreakDifference_(homeStandings, awayStandings) {
  var DEFAULT_STREAK = 0;
  
  var homeStreak = safeNum_(homeStandings && homeStandings.streak, DEFAULT_STREAK);
  var awayStreak = safeNum_(awayStandings && awayStandings.streak, DEFAULT_STREAK);
  
  return homeStreak - awayStreak;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateFormDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Historical form from game data provides additional context.
 *
 * WHAT: Calculate form difference from historical streak and L10 data.
 *
 * HOW: Combines streak differential with L10 record parsing.
 *
 * WHERE: Called by analyzeTier1 for formDiff feature
 *
 * @param {number|string} homeStreak - Home team streak value
 * @param {number|string} awayStreak - Away team streak value
 * @param {string} homeL10 - Home team L10 record (e.g., "7-3")
 * @param {string} awayL10 - Away team L10 record (e.g., "5-5")
 * @returns {number} Form difference
 */
function calculateFormDifference_(homeStreak, awayStreak, homeL10, awayL10) {
  // Parse streak values
  var hStreak = safeNum_(homeStreak, 0);
  var aStreak = safeNum_(awayStreak, 0);
  
  // Parse L10 records (e.g., "7-3" => 0.7)
  function parseL10(record) {
    if (!record) return 0.5;
    var match = String(record).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!match) return 0.5;
    var wins = parseInt(match[1], 10) || 0;
    var losses = parseInt(match[2], 10) || 0;
    var total = wins + losses;
    return total > 0 ? wins / total : 0.5;
  }
  
  var homeL10Pct = parseL10(homeL10);
  var awayL10Pct = parseL10(awayL10);
  
  // Combine streak and L10 factors
  var streakFactor = (hStreak - aStreak) * 0.5;  // Scale down streak impact
  var l10Factor = (homeL10Pct - awayL10Pct) * 10; // Scale up L10 impact
  
  return streakFactor + l10Factor;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateH2HDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY: Head-to-head history can reveal matchup-specific advantages.
 *
 * WHAT: Calculate H2H advantage from historical matchup data.
 *
 * HOW: Uses win ratio and average margin from H2H stats.
 *
 * WHERE: Called by analyzeTier1 for h2hDiff feature
 *
 * @param {Object} h2hStats - Head-to-head statistics object
 * @returns {number} H2H difference factor
 */
function calculateH2HDifference_(h2hStats) {
  if (!h2hStats || !h2hStats.totalGames || h2hStats.totalGames < 1) {
    return 0;
  }
  
  var homeWins = safeNum_(h2hStats.homeWins, 0);
  var awayWins = safeNum_(h2hStats.awayWins, 0);
  var avgMargin = safeNum_(h2hStats.avgMargin, 0);
  var totalGames = safeNum_(h2hStats.totalGames, 0);
  
  if (totalGames === 0) return 0;
  
  // Win ratio factor (home wins vs away wins)
  var winRatioFactor = (homeWins - awayWins) / totalGames;
  
  // Margin factor (scaled down)
  var marginFactor = avgMargin / 10;
  
  // Combine factors with recency/sample weighting
  var sampleWeight = Math.min(1, totalGames / 10);  // More games = more weight
  
  return (winRatioFactor * 5 + marginFactor) * sampleWeight;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: MAIN SCORING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateMaGolideScore (ELITE ROBUST VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT: Single Source of Truth for Tier 1 prediction scoring.
 *
 * WHY: All prediction scores flow through this function to ensure consistency.
 *
 * HOW:
 *   1) Extract features with NaN guards (safeNum_ preserves 0 values)
 *   2) Get weights from config (supports aliases for flexibility)
 *   3) Calculate weighted component scores
 *   4) Determine prediction (HOME/AWAY/RISKY) based on threshold
 *   5) Calculate confidence using probability-based approach
 *   6) Return structured result with debugging metadata
 *
 * FEATURES:
 *   - NaN/Infinity guards on all inputs
 *   - Preserves legitimate 0 values (safeNum_ vs ||)
 *   - Correct sigmoid mapping: score=0 → confMin, score→∞ → confMax
 *   - Tunable confidence_scale from config
 *   - Optional RISKY confidence cap
 *   - Backward compatibility via useLegacySigmoid flag
 *   - Probability-based confidence mode (recommended)
 *   - Separated numeric factorBreakdown from string meta
 *
 * WHERE: Called by analyzeTier1 for each game prediction
 *
 * @param {Object} features - Calculated features for this matchup
 * @param {Object} config - Configuration from loadTier1Config()
 * @returns {Object} {score, prediction, confidence, probability, factorBreakdown, meta}
 */
function calculateMaGolideScore(features, config) {
  features = features || {};
  config = config || {};

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION A: Extract Features (Default to 0 for missing)
  // ═══════════════════════════════════════════════════════════════════════════

  // Legacy feature
  var rankDiff = safeNum_(features.rankDiff, 0);

  // Rich standings features
  var pctDiff         = safeNum_(features.pctDiff, 0);
  var netRtgDiff      = safeNum_(features.netRtgDiff, 0);
  var homeCourtEffect = safeNum_(features.homeCourtEffect, 0);
  var momentumDiff    = safeNum_(features.momentumDiff, 0);
  var streakDiff      = safeNum_(features.streakDiff, 0);

  // Existing features
  var formDiff        = safeNum_(features.formDiff, 0);
  var h2hDiff         = safeNum_(features.h2hDiff, 0);
  var forebetDiff     = safeNum_(features.forebetDiff, 0);
  var variancePenalty = safeNum_(features.variancePenalty, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION B: Get Weights from Config (with aliases)
  // ═══════════════════════════════════════════════════════════════════════════

  // New weights (support multiple naming conventions)
  var pctWeight       = safeNum_(config.pctWeight,       safeNum_(config.pct_weight, 0));
  var netRtgWeight    = safeNum_(config.netRtgWeight,    safeNum_(config.net_rtg_weight, 0));
  var homeCourtWeight = safeNum_(config.homeCourtWeight, safeNum_(config.home_court_weight, 0));
  var momentumWeight  = safeNum_(config.momentumWeight,  safeNum_(config.momentum_weight, 0));
  var streakWeight    = safeNum_(config.streakWeight,    safeNum_(config.streak_weight, 0));

  // Legacy weight
  var rankWeight = safeNum_(config.rank, safeNum_(config.rankWeight, 0));

  // Existing weights
  var formWeight     = safeNum_(config.form,     safeNum_(config.formWeight, 0));
  var h2hWeight      = safeNum_(config.h2h,      safeNum_(config.h2hWeight, 0));
  var forebetWeight  = safeNum_(config.forebet,  safeNum_(config.forebetWeight, 0));
  var varianceWeight = safeNum_(config.variance, safeNum_(config.varianceWeight, 0));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION C: Calculate Weighted Components
  // ═══════════════════════════════════════════════════════════════════════════

  // Legacy
  var weightedRank = rankWeight * rankDiff;

  // Rich features
  var weightedPct       = pctWeight * pctDiff;
  var weightedNetRtg    = netRtgWeight * netRtgDiff;
  var weightedHomeCourt = homeCourtWeight * homeCourtEffect;
  var weightedMomentum  = momentumWeight * momentumDiff;
  var weightedStreak    = streakWeight * streakDiff;

  // Existing features
  var weightedForm    = formWeight * formDiff;
  var weightedH2H     = h2hWeight * h2hDiff;
  var weightedForebet = forebetWeight * forebetDiff;

  // Variance is a PENALTY (always subtracted)
  var weightedVariance = varianceWeight * (-variancePenalty);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION D: Calculate Total Score
  // ═══════════════════════════════════════════════════════════════════════════

  var useNewFeatures =
    isNonZero_(pctWeight) ||
    isNonZero_(netRtgWeight) ||
    isNonZero_(homeCourtWeight) ||
    isNonZero_(momentumWeight) ||
    isNonZero_(streakWeight);

  var score = 0;

  if (useNewFeatures) {
    // NEW MODE: Rich standings features
    score = weightedPct + weightedNetRtg + weightedHomeCourt +
            weightedMomentum + weightedStreak +
            weightedForm + weightedH2H + weightedForebet + weightedVariance;
  } else {
    // LEGACY MODE: Rank-based
    score = weightedRank + weightedForm + weightedH2H +
            weightedForebet + weightedVariance;
  }

  // Home advantage bonus (support aliases)
  var homeAdvantage = safeNum_(config.homeAdv, safeNum_(config.home_advantage, 0));
  score += homeAdvantage;

  // Guard against NaN/Infinity
  if (!isFinite(score)) {
    Logger.log('[MaGolide] ⚠️ Non-finite score detected, resetting to 0');
    score = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION E: Generate Prediction
  // ═══════════════════════════════════════════════════════════════════════════

  var threshold = safeNum_(config.threshold, safeNum_(config.score_threshold, 5.0));
  
  // Validate threshold bounds
  if (!isFinite(threshold) || threshold < 0) {
    Logger.log('[MaGolide] ⚠️ Invalid threshold (' + threshold + '), resetting to 5.0');
    threshold = 5.0;
  }

  var absScore = Math.abs(score);
  var prediction;

  if (absScore < threshold) {
    prediction = 'RISKY';
  } else if (score > 0) {
    prediction = 'HOME';
  } else {
    prediction = 'AWAY';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION F: Calculate Confidence (Probability-Based)
  // ═══════════════════════════════════════════════════════════════════════════

  // Confidence bounds
  var confMin = clamp_(safeNum_(config.confMin, safeNum_(config.confidence_min, 50)), 0, 100);
  var confMax = clamp_(safeNum_(config.confMax, safeNum_(config.confidence_max, 95)), 0, 100);
  var boundsReset = false;

  if (confMin >= confMax) {
    Logger.log('[MaGolide] ⚠️ Invalid conf bounds (min=' + confMin + ', max=' + confMax + '); resetting to defaults');
    confMin = 50;
    confMax = 95;
    boundsReset = true;
  }

  // Confidence mode selection
  var useLegacySigmoid = (config.useLegacySigmoid === true);

  // Scale factor: controls sigmoid steepness
  // IMPORTANT: default 30 is less "overconfident" than 10 for typical score magnitudes
  var scaleFactor = safeNum_(config.confidence_scale, safeNum_(config.confidenceScale, 30));
  if (!isFinite(scaleFactor) || scaleFactor <= 0) {
    scaleFactor = 30;
  }

  var confidence = confMin;
  var homeWinProb = 0.5;
  var predictedWinProb = 0.5;

  if (useLegacySigmoid) {
    // ─────────────────────────────────────────────────────────────────────────
    // LEGACY MODE: Sigmoid on absolute score
    // sigmoid(0) = 0.5, so confidence starts at midpoint
    // ─────────────────────────────────────────────────────────────────────────
    var sigmoidAbs = 1 / (1 + Math.exp(-absScore / scaleFactor));
    confidence = confMin + ((confMax - confMin) * sigmoidAbs);
    
    // Still compute probabilities for meta
    homeWinProb = 1 / (1 + Math.exp(-score / scaleFactor));
    predictedWinProb = (prediction === 'AWAY') ? (1 - homeWinProb) : homeWinProb;

  } else {
    // ─────────────────────────────────────────────────────────────────────────
    // PROBABILITY MODE (Recommended)
    // Treat score as logit-like signal; map to win probability with logistic
    // ─────────────────────────────────────────────────────────────────────────
    homeWinProb = 1 / (1 + Math.exp(-score / scaleFactor));

    if (prediction === 'HOME') {
      predictedWinProb = homeWinProb;
    } else if (prediction === 'AWAY') {
      predictedWinProb = 1 - homeWinProb;
    } else {
      predictedWinProb = 0.5;
    }

    // Convert to percent and clamp to bounds
    confidence = clamp_(predictedWinProb * 100, confMin, confMax);
  }

  // Optional cap for RISKY predictions
  var capRiskyConfidence = (config.capRiskyConfidence === true);
  var riskyConfidenceCap = safeNum_(config.riskyConfidenceCap, confMin + 5);

  if (capRiskyConfidence && prediction === 'RISKY') {
    confidence = Math.min(confidence, riskyConfidenceCap);
  }

  // Final clamp and NaN guard
  confidence = clamp_(confidence, confMin, confMax);
  if (!isFinite(confidence)) {
    Logger.log('[MaGolide] ⚠️ Non-finite confidence detected, using confMin');
    confidence = confMin;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION G: Build Output Objects
  // ═══════════════════════════════════════════════════════════════════════════

  // Numeric-only breakdown (safe for iteration/summation)
  var factorBreakdown = {
    rank:      weightedRank,
    pct:       weightedPct,
    netRtg:    weightedNetRtg,
    homeCourt: weightedHomeCourt,
    momentum:  weightedMomentum,
    streak:    weightedStreak,
    form:      weightedForm,
    h2h:       weightedH2H,
    forebet:   weightedForebet,
    variance:  weightedVariance,
    homeAdv:   homeAdvantage
  };

  // Debug/forensic metadata
  var meta = {
    mode: useNewFeatures ? 'NEW' : 'LEGACY',
    confidenceMode: useLegacySigmoid ? 'LEGACY_SIGMOID' : 'PROBABILITY',
    scaleFactor: scaleFactor,
    threshold: threshold,
    confBounds: { min: confMin, max: confMax, wasReset: boundsReset },
    riskyCapApplied: capRiskyConfidence && prediction === 'RISKY',
    homeWinProbPct: Math.round(homeWinProb * 1000) / 10,
    predictedWinProbPct: Math.round(predictedWinProb * 1000) / 10
  };

  return {
    score: Math.round(score * 100) / 100,
    prediction: prediction,
    confidence: Math.round(confidence * 10) / 10,
    probability: Math.round(predictedWinProb * 1000) / 10,
    factorBreakdown: factorBreakdown,
    meta: meta
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE 4: TIER 1 ANALYZERS (COMPLETE PATCHED VERSION v3.3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FIXES IN THIS VERSION:
 *   - Stats sheet with title row before header
 *   - QuarterStats team-level data aggregated to league-level
 *   - Missing scores in Clean sheet - fallback to Standings
 *   - Flexible header lookup for "prob %", "predscore", etc.
 *   - Case-insensitive league matching
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: CORE HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: safeNum_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Safely coerce any value to a number, returning fallback if invalid.
 * WHAT: Handles null, undefined, empty string, comma-formatted numbers, NaN.
 */
function safeNum_(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') return isFinite(val) ? val : fallback;
  
  var str = String(val).trim().replace(/,/g, '');
  var num = parseFloat(str);
  return isFinite(num) ? num : fallback;
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: clamp_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Constrain value to valid range with NaN safety.
 */
function clamp_(n, min, max) {
  if (!isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: normalizeText_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Clean text for reliable parsing (removes NBSP, BOM, extra whitespace).
 */
function normalizeText_(str) {
  return String(str || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\uFEFF/g, '')
    .replace(/\u200B/g, '')
    .trim();
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: normalizeTeamName_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Standardize team names for reliable matching across sources.
 */
function normalizeTeamName_(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, '')
    .replace(/[.\-,]/g, ' ')
    .replace(/\s+/g, ' ');
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: normalizeLeagueName_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: League names must match case-insensitively across sheets.
 */
function normalizeLeagueName_(name) {
  if (!name) return '';
  return String(name).toLowerCase().trim();
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: isNonZero_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Check if a number is finite and non-zero (for weight detection).
 */
function isNonZero_(n) {
  return isFinite(n) && Math.abs(n) > 1e-9;
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: getHeaderIndex_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Header names vary - need flexible lookup with multiple key attempts.
 * WHAT: Try multiple key variations to find column index.
 */
function getHeaderIndex_(headerMap, keys) {
  if (!headerMap || !keys) return -1;
  
  // Ensure keys is an array
  if (!Array.isArray(keys)) {
    keys = [keys];
  }
  
  for (var i = 0; i < keys.length; i++) {
    var key = String(keys[i]).toLowerCase().trim();
    
    // Try exact match
    if (headerMap[key] !== undefined) {
      return headerMap[key];
    }
    
    // Try without special characters (prob % -> prob)
    var keyClean = key.replace(/[^a-z0-9]/g, '');
    if (headerMap[keyClean] !== undefined) {
      return headerMap[keyClean];
    }
    
    // Try with underscores instead of spaces
    var keyUnderscore = key.replace(/\s+/g, '_');
    if (headerMap[keyUnderscore] !== undefined) {
      return headerMap[keyUnderscore];
    }
  }
  
  return -1;
}


/**
 * ───────────────────────────────────────────────────────────────────────────
 * HELPER: getGameValue_
 * ───────────────────────────────────────────────────────────────────────────
 * WHY: Safely get value from game row with flexible header lookup.
 */
function getGameValue_(gameRow, headerMap, keyVariations, defaultValue) {
  var idx = getHeaderIndex_(headerMap, keyVariations);
  if (idx < 0 || idx >= gameRow.length) {
    return defaultValue;
  }
  var val = gameRow[idx];
  return (val !== null && val !== undefined) ? val : defaultValue;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: STATS LOADING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: loadStatsFromSheet (FIXED - Handles Title Rows)
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY: Stats sheet may have title rows before actual headers.
 * WHAT: Find actual header row, then parse data.
 *
 * Handles format:
 *   Row 0: "Ma Golide Winner Accuracy (Historical)"  <- Title (skip)
 *   Row 1: "League", "Accuracy", "Correct", "Total"  <- Header
 *   Row 2: "Overall", 0.605, 473, 782                <- Data
 *   Row 3: "NBA", 0.605, 473, 782                    <- Data
 */
function loadStatsFromSheet(sheet) {
  var result = { league: {}, probRange: {}, team: {} };
  
  if (!sheet) {
    Logger.log('[loadStatsFromSheet] No sheet provided');
    return result;
  }
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('[loadStatsFromSheet] Sheet has insufficient data');
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Find the actual header row (skip title rows)
  // ═══════════════════════════════════════════════════════════════════════════
  var headerRowIndex = -1;
  
  for (var r = 0; r < Math.min(10, data.length); r++) {
    var rowText = data[r].join('|').toLowerCase();
    
    // Check if this row looks like a header
    if ((rowText.includes('league') || rowText.includes('competition') || rowText.includes('name')) && 
        (rowText.includes('accuracy') || rowText.includes('correct') || rowText.includes('pct') || rowText.includes('total'))) {
      headerRowIndex = r;
      Logger.log('[loadStatsFromSheet] Found header at row ' + r);
      break;
    }
  }
  
  if (headerRowIndex < 0) {
    Logger.log('[loadStatsFromSheet] Could not find header row');
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Build header map from actual header row
  // ═══════════════════════════════════════════════════════════════════════════
  var headerMap = createHeaderMap(data[headerRowIndex]);
  
  var leagueCol = getHeaderIndex_(headerMap, ['league', 'lg', 'competition', 'name']);
  var accCol = getHeaderIndex_(headerMap, ['accuracy', 'acc', 'pct', 'winrate']);
  var correctCol = getHeaderIndex_(headerMap, ['correct', 'wins', 'w']);
  var totalCol = getHeaderIndex_(headerMap, ['total', 'games', 'count', 'n']);
  
  if (leagueCol < 0) {
    Logger.log('[loadStatsFromSheet] Could not find league column');
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Parse data rows
  // ═══════════════════════════════════════════════════════════════════════════
  for (var i = headerRowIndex + 1; i < data.length; i++) {
    var row = data[i];
    var leagueName = String(row[leagueCol] || '').trim();
    
    if (!leagueName || leagueName === '') continue;
    
    // Skip rows that look like section headers (containing dashes or "---")
    if (leagueName.includes('---') || leagueName.includes('===')) continue;
    
    var leagueKey = normalizeLeagueName_(leagueName);
    
    // Get accuracy
    var accuracy = 0;
    if (accCol >= 0) {
      var accVal = row[accCol];
      accuracy = safeNum_(accVal, 0);
      // If decimal (0.605), convert to percentage
      if (accuracy > 0 && accuracy <= 1) {
        accuracy = accuracy * 100;
      }
    } else if (correctCol >= 0 && totalCol >= 0) {
      var correct = safeNum_(row[correctCol], 0);
      var total = safeNum_(row[totalCol], 0);
      accuracy = total > 0 ? (correct / total * 100) : 0;
    }
    
    var totalGames = totalCol >= 0 ? safeNum_(row[totalCol], 0) : 0;
    var correctPreds = correctCol >= 0 ? safeNum_(row[correctCol], 0) : 0;
    
    result.league[leagueKey] = {
      winnerAccuracy: Math.round(accuracy * 10) / 10,
      totalGames: totalGames,
      correctPredictions: correctPreds,
      originalName: leagueName
    };
    
    // Also store with original case for flexible lookup
    result.league[leagueName] = result.league[leagueKey];
  }
  
  Logger.log('[loadStatsFromSheet] ✓ Loaded leagues: ' + Object.keys(result.league).filter(function(k) { 
    return k === k.toLowerCase(); 
  }).join(', '));
  
  return result;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: loadQuarterWinnerStats (FIXED - Aggregates Team Data to League)
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY: Sheet has team-level data, but we need league-level summaries.
 * WHAT: Aggregate all team quarter stats into league totals.
 *
 * Handles format:
 *   | Team           | Quarter | W  | L  | Total |
 *   | Atlanta Hawks  | Q1      | 25 | 25 | 50    |
 */
function loadQuarterWinnerStats(sheet) {
  var result = {};
  
  if (!sheet) {
    Logger.log('[loadQuarterWinnerStats] No sheet provided');
    return result;
  }
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('[loadQuarterWinnerStats] Sheet has insufficient data');
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Find header row
  // ═══════════════════════════════════════════════════════════════════════════
  var headerRowIndex = 0;
  for (var r = 0; r < Math.min(5, data.length); r++) {
    var rowText = data[r].join('|').toLowerCase();
    if (rowText.includes('team') && rowText.includes('quarter')) {
      headerRowIndex = r;
      break;
    }
  }
  
  var headerMap = createHeaderMap(data[headerRowIndex]);
  
  var teamCol = getHeaderIndex_(headerMap, ['team', 'teamname', 'name']);
  var quarterCol = getHeaderIndex_(headerMap, ['quarter', 'q', 'qtr', 'period']);
  var winsCol = getHeaderIndex_(headerMap, ['w', 'wins', 'win', 'correct']);
  var lossesCol = getHeaderIndex_(headerMap, ['l', 'losses', 'loss', 'incorrect']);
  var totalCol = getHeaderIndex_(headerMap, ['total', 'games', 'n', 'count']);
  
  if (teamCol < 0 || quarterCol < 0) {
    Logger.log('[loadQuarterWinnerStats] Could not find team/quarter columns');
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Aggregate team data
  // ═══════════════════════════════════════════════════════════════════════════
  var leagueTotals = {};  // { Q1: { wins: X, total: Y } }
  var teamData = {};
  
  for (var i = headerRowIndex + 1; i < data.length; i++) {
    var row = data[i];
    
    var teamName = String(row[teamCol] || '').trim();
    var quarter = String(row[quarterCol] || '').toUpperCase().trim();
    
    if (!teamName || !quarter) continue;
    
    // Normalize quarter name
    if (/^\d$/.test(quarter)) {
      quarter = 'Q' + quarter;
    }
    
    var wins = winsCol >= 0 ? safeNum_(row[winsCol], 0) : 0;
    var losses = lossesCol >= 0 ? safeNum_(row[lossesCol], 0) : 0;
    var total = totalCol >= 0 ? safeNum_(row[totalCol], 0) : (wins + losses);
    
    // Store team-level
    var teamKey = normalizeTeamName_(teamName);
    teamData[teamKey] = teamData[teamKey] || {};
    teamData[teamKey][quarter] = {
      wins: wins,
      losses: losses,
      total: total,
      accuracy: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0
    };
    teamData[teamName] = teamData[teamKey];
    
    // Aggregate to league
    leagueTotals[quarter] = leagueTotals[quarter] || { wins: 0, total: 0 };
    leagueTotals[quarter].wins += wins;
    leagueTotals[quarter].total += total;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Build result with team and league data
  // ═══════════════════════════════════════════════════════════════════════════
  for (var team in teamData) {
    result[team] = teamData[team];
  }
  
  // Build league aggregate
  var leagueAggregate = {};
  for (var q in leagueTotals) {
    var qData = leagueTotals[q];
    leagueAggregate[q] = {
      wins: qData.wins,
      total: qData.total,
      accuracy: qData.total > 0 ? Math.round((qData.wins / qData.total) * 1000) / 10 : 0,
      sampleSize: qData.total
    };
  }
  
  // Store under multiple keys
  result['nba'] = leagueAggregate;
  result['NBA'] = leagueAggregate;
  result['league'] = leagueAggregate;
  result['overall'] = leagueAggregate;
  
  Logger.log('[loadQuarterWinnerStats] ✓ Loaded ' + Object.keys(teamData).length / 2 + ' teams');
  if (leagueAggregate['Q1']) {
    Logger.log('[loadQuarterWinnerStats] League Q1: ' + leagueAggregate['Q1'].accuracy + '% (' + leagueAggregate['Q1'].total + ' games)');
  }
  
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: FORM CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: getTeamFormFromStandings_
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY: If Clean sheet lacks scores, use Standings data for form.
 * WHAT: Extract form data directly from standings object.
 */
function getTeamFormFromStandings_(standings) {
  if (!standings) {
    return {
      streak: 'N/A',
      l10: 'N/A',
      homeSplit: 'N/A',
      awaySplit: 'N/A'
    };
  }
  
  // Streak from standings
  var streak = 'N/A';
  if (standings.streak !== undefined && standings.streak !== null) {
    var streakVal = safeNum_(standings.streak, 0);
    if (streakVal !== 0) {
      streak = streakVal > 0 ? 'W' + streakVal : 'L' + Math.abs(streakVal);
    } else {
      streak = '-';
    }
  }
  
  // L10 from standings
  var l10 = 'N/A';
  if (standings.l10Pct !== undefined && standings.l10Pct !== null) {
    var l10Pct = safeNum_(standings.l10Pct, 0.5);
    var l10Wins = Math.round(l10Pct * 10);
    var l10Losses = 10 - l10Wins;
    l10 = l10Wins + '-' + l10Losses;
  }
  
  // Home split from standings
  var homeSplit = 'N/A';
  if (standings.homePct !== undefined && standings.gp) {
    var homeGames = Math.round(standings.gp / 2);
    var homeWins = Math.round(standings.homePct * homeGames);
    var homeLosses = homeGames - homeWins;
    homeSplit = homeWins + '-' + homeLosses;
  }
  
  // Away split from standings
  var awaySplit = 'N/A';
  if (standings.awayPct !== undefined && standings.gp) {
    var awayGames = Math.round(standings.gp / 2);
    var awayWins = Math.round(standings.awayPct * awayGames);
    var awayLosses = awayGames - awayWins;
    awaySplit = awayWins + '-' + awayLosses;
  }
  
  return {
    streak: streak,
    l10: l10,
    homeSplit: homeSplit,
    awaySplit: awaySplit
  };
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateStreak (ROBUST - With Fallback)
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY: Calculate streak from historical data if scores available.
 * WHAT: Returns streak or 'N/A' if not calculable.
 */
function calculateStreak(teamName, beforeDate, allGames, headerMap) {
  if (!teamName || !allGames || allGames.length < 2) {
    return 'N/A';
  }
  
  var teamLower = normalizeTeamName_(teamName);
  
  // Find column indices
  var homeCol = getHeaderIndex_(headerMap, ['home', 'home team', 'hometeam']);
  var awayCol = getHeaderIndex_(headerMap, ['away', 'away team', 'awayteam']);
  var dateCol = getHeaderIndex_(headerMap, ['date', 'game date', 'gamedate']);
  var homeScoreCol = getHeaderIndex_(headerMap, ['home score', 'homescore', 'home pts', 'homepts', 'hscore']);
  var awayScoreCol = getHeaderIndex_(headerMap, ['away score', 'awayscore', 'away pts', 'awaypts', 'ascore']);
  var winnerCol = getHeaderIndex_(headerMap, ['winner', 'result', 'win']);
  
  // Check if we have score columns
  if (homeCol < 0 || awayCol < 0) {
    return 'N/A';
  }
  
  if (homeScoreCol < 0 && awayScoreCol < 0 && winnerCol < 0) {
    // No way to determine winner
    return 'N/A';
  }
  
  // Collect team's games
  var teamGames = [];
  
  for (var i = 1; i < allGames.length; i++) {
    var row = allGames[i];
    var home = normalizeTeamName_(row[homeCol]);
    var away = normalizeTeamName_(row[awayCol]);
    
    if (home !== teamLower && away !== teamLower) continue;
    
    // Check date
    if (dateCol >= 0 && beforeDate) {
      var gameDate = row[dateCol];
      if (gameDate instanceof Date && gameDate >= beforeDate) continue;
      if (!(gameDate instanceof Date)) {
        var parsed = new Date(gameDate);
        if (!isNaN(parsed.getTime()) && parsed >= beforeDate) continue;
      }
    }
    
    // Determine if team won
    var teamWon = null;
    var isHome = (home === teamLower);
    
    if (winnerCol >= 0 && row[winnerCol]) {
      var winner = normalizeTeamName_(row[winnerCol]);
      teamWon = (winner === teamLower);
    } else if (homeScoreCol >= 0 && awayScoreCol >= 0) {
      var homeScore = safeNum_(row[homeScoreCol], -1);
      var awayScore = safeNum_(row[awayScoreCol], -1);
      if (homeScore >= 0 && awayScore >= 0) {
        teamWon = isHome ? (homeScore > awayScore) : (awayScore > homeScore);
      }
    }
    
    if (teamWon !== null) {
      teamGames.push({
        date: row[dateCol],
        won: teamWon
      });
    }
  }
  
  if (teamGames.length === 0) {
    return 'N/A';
  }
  
  // Sort by date descending
  teamGames.sort(function(a, b) {
    var dateA = a.date instanceof Date ? a.date : new Date(a.date);
    var dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateB - dateA;
  });
  
  // Count streak
  var streak = 0;
  var streakType = teamGames[0].won;
  
  for (var j = 0; j < teamGames.length; j++) {
    if (teamGames[j].won === streakType) {
      streak++;
    } else {
      break;
    }
  }
  
  return streakType ? streak : -streak;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateLastN (ROBUST - With Fallback)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateLastN(teamName, beforeDate, n, allGames, headerMap) {
  if (!teamName || !allGames || allGames.length < 2 || !n) {
    return 'N/A';
  }
  
  var teamLower = normalizeTeamName_(teamName);
  n = Math.max(1, parseInt(n, 10) || 10);
  
  var homeCol = getHeaderIndex_(headerMap, ['home', 'home team', 'hometeam']);
  var awayCol = getHeaderIndex_(headerMap, ['away', 'away team', 'awayteam']);
  var dateCol = getHeaderIndex_(headerMap, ['date', 'game date', 'gamedate']);
  var homeScoreCol = getHeaderIndex_(headerMap, ['home score', 'homescore', 'home pts', 'homepts', 'hscore']);
  var awayScoreCol = getHeaderIndex_(headerMap, ['away score', 'awayscore', 'away pts', 'awaypts', 'ascore']);
  var winnerCol = getHeaderIndex_(headerMap, ['winner', 'result', 'win']);
  
  if (homeCol < 0 || awayCol < 0) return 'N/A';
  if (homeScoreCol < 0 && awayScoreCol < 0 && winnerCol < 0) return 'N/A';
  
  var teamGames = [];
  
  for (var i = 1; i < allGames.length; i++) {
    var row = allGames[i];
    var home = normalizeTeamName_(row[homeCol]);
    var away = normalizeTeamName_(row[awayCol]);
    
    if (home !== teamLower && away !== teamLower) continue;
    
    if (dateCol >= 0 && beforeDate) {
      var gameDate = row[dateCol];
      if (gameDate instanceof Date && gameDate >= beforeDate) continue;
      if (!(gameDate instanceof Date)) {
        var parsed = new Date(gameDate);
        if (!isNaN(parsed.getTime()) && parsed >= beforeDate) continue;
      }
    }
    
    var teamWon = null;
    var isHome = (home === teamLower);
    
    if (winnerCol >= 0 && row[winnerCol]) {
      teamWon = (normalizeTeamName_(row[winnerCol]) === teamLower);
    } else if (homeScoreCol >= 0 && awayScoreCol >= 0) {
      var homeScore = safeNum_(row[homeScoreCol], -1);
      var awayScore = safeNum_(row[awayScoreCol], -1);
      if (homeScore >= 0 && awayScore >= 0) {
        teamWon = isHome ? (homeScore > awayScore) : (awayScore > homeScore);
      }
    }
    
    if (teamWon !== null) {
      teamGames.push({ date: row[dateCol], won: teamWon });
    }
  }
  
  if (teamGames.length === 0) return 'N/A';
  
  teamGames.sort(function(a, b) {
    var dateA = a.date instanceof Date ? a.date : new Date(a.date);
    var dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateB - dateA;
  });
  
  var lastN = teamGames.slice(0, n);
  var wins = 0, losses = 0;
  
  for (var j = 0; j < lastN.length; j++) {
    if (lastN[j].won) wins++;
    else losses++;
  }
  
  return wins + '-' + losses;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateLastNHomeAway (ROBUST - With Fallback)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateLastNHomeAway(teamName, beforeDate, n, venueType, allGames, headerMap) {
  if (!teamName || !allGames || allGames.length < 2 || !n || !venueType) {
    return 'N/A';
  }
  
  var teamLower = normalizeTeamName_(teamName);
  var isHomeVenue = (venueType.toLowerCase() === 'home');
  n = Math.max(1, parseInt(n, 10) || 5);
  
  var homeCol = getHeaderIndex_(headerMap, ['home', 'home team', 'hometeam']);
  var awayCol = getHeaderIndex_(headerMap, ['away', 'away team', 'awayteam']);
  var dateCol = getHeaderIndex_(headerMap, ['date', 'game date', 'gamedate']);
  var homeScoreCol = getHeaderIndex_(headerMap, ['home score', 'homescore', 'home pts', 'homepts']);
  var awayScoreCol = getHeaderIndex_(headerMap, ['away score', 'awayscore', 'away pts', 'awaypts']);
  var winnerCol = getHeaderIndex_(headerMap, ['winner', 'result', 'win']);
  
  if (homeCol < 0 || awayCol < 0) return 'N/A';
  if (homeScoreCol < 0 && awayScoreCol < 0 && winnerCol < 0) return 'N/A';
  
  var teamGames = [];
  
  for (var i = 1; i < allGames.length; i++) {
    var row = allGames[i];
    var home = normalizeTeamName_(row[homeCol]);
    var away = normalizeTeamName_(row[awayCol]);
    
    var isTeamHome = (home === teamLower);
    var isTeamAway = (away === teamLower);
    
    if (isHomeVenue && !isTeamHome) continue;
    if (!isHomeVenue && !isTeamAway) continue;
    
    if (dateCol >= 0 && beforeDate) {
      var gameDate = row[dateCol];
      if (gameDate instanceof Date && gameDate >= beforeDate) continue;
      if (!(gameDate instanceof Date)) {
        var parsed = new Date(gameDate);
        if (!isNaN(parsed.getTime()) && parsed >= beforeDate) continue;
      }
    }
    
    var teamWon = null;
    
    if (winnerCol >= 0 && row[winnerCol]) {
      teamWon = (normalizeTeamName_(row[winnerCol]) === teamLower);
    } else if (homeScoreCol >= 0 && awayScoreCol >= 0) {
      var homeScore = safeNum_(row[homeScoreCol], -1);
      var awayScore = safeNum_(row[awayScoreCol], -1);
      if (homeScore >= 0 && awayScore >= 0) {
        teamWon = isTeamHome ? (homeScore > awayScore) : (awayScore > homeScore);
      }
    }
    
    if (teamWon !== null) {
      teamGames.push({ date: row[dateCol], won: teamWon });
    }
  }
  
  if (teamGames.length === 0) return 'N/A';
  
  teamGames.sort(function(a, b) {
    var dateA = a.date instanceof Date ? a.date : new Date(a.date);
    var dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateB - dateA;
  });
  
  var lastN = teamGames.slice(0, n);
  var wins = 0, losses = 0;
  
  for (var j = 0; j < lastN.length; j++) {
    if (lastN[j].won) wins++;
    else losses++;
  }
  
  return wins + '-' + losses;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: PROBABILITY & FOREBET FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: parseHomeAwayProbability_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function parseHomeAwayProbability_(probCell) {
  var result = { home: 50, away: 50, ok: false, source: 'default' };

  if (probCell === null || probCell === undefined || probCell === '') {
    return result;
  }

  if (typeof probCell === 'number' && isFinite(probCell)) {
    var homeNum = probCell;
    if (homeNum >= 0 && homeNum <= 1) homeNum *= 100;
    homeNum = clamp_(homeNum, 0, 100);
    result.home = homeNum;
    result.away = 100 - homeNum;
    result.ok = true;
    result.source = 'number';
    return result;
  }

  var str = normalizeText_(probCell);
  var matches = str.match(/(\d+(?:\.\d+)?)/g) || [];
  
  if (matches.length === 0) return result;

  var nums = [];
  for (var i = 0; i < matches.length; i++) {
    var val = parseFloat(matches[i]);
    if (isFinite(val)) nums.push(val);
  }
  
  if (nums.length === 0) return result;

  var plausible = nums.filter(function(x) {
    return (x >= 0 && x <= 1) || (x >= 0 && x <= 100);
  });
  
  if (plausible.length >= 2) nums = plausible;

  var home = nums[0];
  var away = (nums.length >= 2) ? nums[1] : NaN;

  if (!isFinite(away)) {
    if (home >= 0 && home <= 1) home *= 100;
    home = clamp_(home, 0, 100);
    result.home = home;
    result.away = 100 - home;
    result.ok = true;
    result.source = 'single';
    return result;
  }

  if (home >= 0 && home <= 1 && away >= 0 && away <= 1) {
    home *= 100;
    away *= 100;
  }

  home = clamp_(home, 0, 100);
  away = clamp_(away, 0, 100);

  var sum = home + away;
  if (sum > 0 && Math.abs(sum - 100) > 3) {
    home = (home / sum) * 100;
    away = 100 - home;
    result.source = 'normalized';
  } else {
    result.source = 'pair';
  }

  result.home = clamp_(home, 0, 100);
  result.away = clamp_(away, 0, 100);
  result.ok = true;
  
  return result;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: interpretPredictionSide_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function interpretPredictionSide_(predCell, homeTeam, awayTeam) {
  var pred = normalizeText_(predCell).toLowerCase();
  
  if (!pred) return 'UNKNOWN';

  if (pred === '1' || pred === 'h' || pred.includes('home')) return 'HOME';
  if (pred === '2' || pred === 'a' || pred.includes('away')) return 'AWAY';
  if (pred === 'x' || pred.includes('draw')) return 'DRAW';

  var homeName = normalizeTeamName_(homeTeam);
  var awayName = normalizeTeamName_(awayTeam);
  var predNorm = normalizeTeamName_(pred);

  if (homeName && predNorm.includes(homeName)) return 'HOME';
  if (awayName && predNorm.includes(awayName)) return 'AWAY';

  return 'UNKNOWN';
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: getForebetFavoredProbability_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function getForebetFavoredProbability_(forebetPred, probCell, homeTeam, awayTeam) {
  if (probCell === null || probCell === undefined || probCell === '') {
    return 0;
  }

  var side = interpretPredictionSide_(forebetPred, homeTeam, awayTeam);
  var probs = parseHomeAwayProbability_(probCell);

  if (side === 'HOME') return probs.home;
  if (side === 'AWAY') return probs.away;
  if (side === 'DRAW') return Math.max(probs.home, probs.away);

  return Math.max(probs.home, probs.away);
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateForebetDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateForebetDifference_(forebetPred, forebetProbStr, homeTeam, awayTeam) {
  if (!forebetPred || forebetProbStr === null || forebetProbStr === undefined || forebetProbStr === '') {
    return 0;
  }

  var side = interpretPredictionSide_(forebetPred, homeTeam, awayTeam);
  var probs = parseHomeAwayProbability_(forebetProbStr);

  if (side === 'HOME') return (probs.home - 50) / 10;
  if (side === 'AWAY') return -((probs.away - 50) / 10);

  return 0;
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: FEATURE CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateRankDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateRankDifference_(homeStandings, awayStandings) {
  var DEFAULT_RANK = 15;
  var homeRank = safeNum_(homeStandings && homeStandings.rank, DEFAULT_RANK);
  var awayRank = safeNum_(awayStandings && awayStandings.rank, DEFAULT_RANK);
  return awayRank - homeRank;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculatePCTDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculatePCTDifference_(homeStandings, awayStandings) {
  var DEFAULT_PCT = 0.5;
  var homePct = safeNum_(homeStandings && homeStandings.pct, DEFAULT_PCT);
  var awayPct = safeNum_(awayStandings && awayStandings.pct, DEFAULT_PCT);
  return (homePct - awayPct) * 100;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateNetRatingDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateNetRatingDifference_(homeStandings, awayStandings) {
  var homeNetRtg = safeNum_(homeStandings && homeStandings.netRtg, 0);
  var awayNetRtg = safeNum_(awayStandings && awayStandings.netRtg, 0);
  return homeNetRtg - awayNetRtg;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateHomeCourtEffect_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateHomeCourtEffect_(homeStandings, awayStandings) {
  var DEFAULT_PCT = 0.5;
  var homeHomePct = safeNum_(homeStandings && homeStandings.homePct, DEFAULT_PCT);
  var awayAwayPct = safeNum_(awayStandings && awayStandings.awayPct, DEFAULT_PCT);
  return (homeHomePct - awayAwayPct) * 100;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateMomentumDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateMomentumDifference_(homeStandings, awayStandings) {
  var DEFAULT_L10 = 0.5;
  var homeL10 = safeNum_(homeStandings && homeStandings.l10Pct, DEFAULT_L10);
  var awayL10 = safeNum_(awayStandings && awayStandings.l10Pct, DEFAULT_L10);
  return (homeL10 - awayL10) * 100;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateStreakDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateStreakDifference_(homeStandings, awayStandings) {
  var homeStreak = safeNum_(homeStandings && homeStandings.streak, 0);
  var awayStreak = safeNum_(awayStandings && awayStandings.streak, 0);
  return homeStreak - awayStreak;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateFormDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateFormDifference_(homeStreak, awayStreak, homeL10, awayL10) {
  var hStreak = 0, aStreak = 0;
  
  if (typeof homeStreak === 'number') {
    hStreak = homeStreak;
  } else if (typeof homeStreak === 'string' && homeStreak !== 'N/A') {
    hStreak = safeNum_(homeStreak, 0);
  }
  
  if (typeof awayStreak === 'number') {
    aStreak = awayStreak;
  } else if (typeof awayStreak === 'string' && awayStreak !== 'N/A') {
    aStreak = safeNum_(awayStreak, 0);
  }
  
  function parseL10(record) {
    if (!record || record === 'N/A') return 0.5;
    var match = String(record).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!match) return 0.5;
    var wins = parseInt(match[1], 10) || 0;
    var losses = parseInt(match[2], 10) || 0;
    var total = wins + losses;
    return total > 0 ? wins / total : 0.5;
  }
  
  var homeL10Pct = parseL10(homeL10);
  var awayL10Pct = parseL10(awayL10);
  
  var streakFactor = (hStreak - aStreak) * 0.5;
  var l10Factor = (homeL10Pct - awayL10Pct) * 10;
  
  return streakFactor + l10Factor;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateH2HDifference_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateH2HDifference_(h2hStats) {
  if (!h2hStats || !h2hStats.totalGames || h2hStats.totalGames < 1) {
    return 0;
  }
  
  var homeWins = safeNum_(h2hStats.homeWins, 0);
  var awayWins = safeNum_(h2hStats.awayWins, 0);
  var avgMargin = safeNum_(h2hStats.avgMargin, 0);
  var totalGames = safeNum_(h2hStats.totalGames, 0);
  
  if (totalGames === 0) return 0;
  
  var winRatioFactor = (homeWins - awayWins) / totalGames;
  var marginFactor = avgMargin / 10;
  var sampleWeight = Math.min(1, totalGames / 10);
  
  return (winRatioFactor * 5 + marginFactor) * sampleWeight;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateVariancePenalty_
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateVariancePenalty_(homeTeam, awayTeam, varianceMap) {
  varianceMap = varianceMap || {};
  var DEFAULT_VARIANCE = 10;

  var homeKey = normalizeTeamName_(homeTeam);
  var awayKey = normalizeTeamName_(awayTeam);

  var homeVar = safeNum_(varianceMap[homeKey], DEFAULT_VARIANCE);
  var awayVar = safeNum_(varianceMap[awayKey], DEFAULT_VARIANCE);

  var avgVariance = (homeVar + awayVar) / 2;
  return Math.min(1, avgVariance / 20);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: MAIN SCORING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: calculateMaGolideScore (ELITE ROBUST VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function calculateMaGolideScore(features, config) {
  features = features || {};
  config = config || {};

  // Extract features
  var rankDiff = safeNum_(features.rankDiff, 0);
  var pctDiff = safeNum_(features.pctDiff, 0);
  var netRtgDiff = safeNum_(features.netRtgDiff, 0);
  var homeCourtEffect = safeNum_(features.homeCourtEffect, 0);
  var momentumDiff = safeNum_(features.momentumDiff, 0);
  var streakDiff = safeNum_(features.streakDiff, 0);
  var formDiff = safeNum_(features.formDiff, 0);
  var h2hDiff = safeNum_(features.h2hDiff, 0);
  var forebetDiff = safeNum_(features.forebetDiff, 0);
  var variancePenalty = safeNum_(features.variancePenalty, 0);

  // Get weights — avoid nested safeNum_ calls with potentially undefined snake_case aliases
  function _cfgNum_(primary, fallback) {
    var v = (primary !== undefined && primary !== null) ? Number(primary) : NaN;
    if (!isNaN(v) && isFinite(v)) return v;
    var f = (fallback !== undefined && fallback !== null) ? Number(fallback) : NaN;
    return (!isNaN(f) && isFinite(f)) ? f : 0;
  }
  var pctWeight = _cfgNum_(config.pctWeight, config.pct_weight);
  var netRtgWeight = _cfgNum_(config.netRtgWeight, config.net_rtg_weight);
  var homeCourtWeight = _cfgNum_(config.homeCourtWeight, config.home_court_weight);
  var momentumWeight = _cfgNum_(config.momentumWeight, config.momentum_weight);
  var streakWeight = _cfgNum_(config.streakWeight, config.streak_weight);
  var rankWeight = _cfgNum_(config.rank, config.rankWeight);
  var formWeight = _cfgNum_(config.form, config.formWeight);
  var h2hWeight = _cfgNum_(config.h2h, config.h2hWeight);
  var forebetWeight = _cfgNum_(config.forebet, config.forebetWeight);
  var varianceWeight = _cfgNum_(config.variance, config.varianceWeight);

  // Calculate weighted components
  var weightedRank = rankWeight * rankDiff;
  var weightedPct = pctWeight * pctDiff;
  var weightedNetRtg = netRtgWeight * netRtgDiff;
  var weightedHomeCourt = homeCourtWeight * homeCourtEffect;
  var weightedMomentum = momentumWeight * momentumDiff;
  var weightedStreak = streakWeight * streakDiff;
  var weightedForm = formWeight * formDiff;
  var weightedH2H = h2hWeight * h2hDiff;
  var weightedForebet = forebetWeight * forebetDiff;
  var weightedVariance = varianceWeight * (-variancePenalty);

  // Determine mode
  var useNewFeatures = isNonZero_(pctWeight) || isNonZero_(netRtgWeight) || 
                       isNonZero_(homeCourtWeight) || isNonZero_(momentumWeight) || 
                       isNonZero_(streakWeight);

  var score = 0;
  if (useNewFeatures) {
    score = weightedPct + weightedNetRtg + weightedHomeCourt +
            weightedMomentum + weightedStreak +
            weightedForm + weightedH2H + weightedForebet + weightedVariance;
  } else {
    score = weightedRank + weightedForm + weightedH2H +
            weightedForebet + weightedVariance;
  }

  var homeAdvantage = safeNum_(config.homeAdv, safeNum_(config.home_advantage, 0));
  score += homeAdvantage;

  if (!isFinite(score)) score = 0;

  // Prediction
  var threshold = safeNum_(config.threshold, safeNum_(config.score_threshold, 5.0));
  if (!isFinite(threshold) || threshold < 0) threshold = 5.0;

  var absScore = Math.abs(score);
  var prediction;
  if (absScore < threshold) prediction = 'RISKY';
  else if (score > 0) prediction = 'HOME';
  else prediction = 'AWAY';

  // Confidence
  var confMin = clamp_(safeNum_(config.confMin, safeNum_(config.confidence_min, 50)), 0, 100);
  var confMax = clamp_(safeNum_(config.confMax, safeNum_(config.confidence_max, 95)), 0, 100);
  if (confMin >= confMax) { confMin = 50; confMax = 95; }

  var useLegacySigmoid = (config.useLegacySigmoid === true);
  var scaleFactor = safeNum_(config.confidence_scale, safeNum_(config.confidenceScale, 30));
  if (!isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 30;

  var confidence = confMin;
  var homeWinProb = 0.5;
  var predictedWinProb = 0.5;

  if (useLegacySigmoid) {
    var sigmoidAbs = 1 / (1 + Math.exp(-absScore / scaleFactor));
    confidence = confMin + ((confMax - confMin) * sigmoidAbs);
    homeWinProb = 1 / (1 + Math.exp(-score / scaleFactor));
    predictedWinProb = (prediction === 'AWAY') ? (1 - homeWinProb) : homeWinProb;
  } else {
    homeWinProb = 1 / (1 + Math.exp(-score / scaleFactor));
    if (prediction === 'HOME') predictedWinProb = homeWinProb;
    else if (prediction === 'AWAY') predictedWinProb = 1 - homeWinProb;
    else predictedWinProb = 0.5;
    confidence = clamp_(predictedWinProb * 100, confMin, confMax);
  }

  var capRiskyConfidence = (config.capRiskyConfidence === true);
  var riskyConfidenceCap = safeNum_(config.riskyConfidenceCap, confMin + 5);
  if (capRiskyConfidence && prediction === 'RISKY') {
    confidence = Math.min(confidence, riskyConfidenceCap);
  }

  confidence = clamp_(confidence, confMin, confMax);
  if (!isFinite(confidence)) confidence = confMin;

  var factorBreakdown = {
    rank: weightedRank,
    pct: weightedPct,
    netRtg: weightedNetRtg,
    homeCourt: weightedHomeCourt,
    momentum: weightedMomentum,
    streak: weightedStreak,
    form: weightedForm,
    h2h: weightedH2H,
    forebet: weightedForebet,
    variance: weightedVariance,
    homeAdv: homeAdvantage
  };

  var meta = {
    mode: useNewFeatures ? 'NEW' : 'LEGACY',
    confidenceMode: useLegacySigmoid ? 'LEGACY_SIGMOID' : 'PROBABILITY',
    scaleFactor: scaleFactor,
    threshold: threshold,
    confBounds: { min: confMin, max: confMax },
    homeWinProbPct: Math.round(homeWinProb * 1000) / 10,
    predictedWinProbPct: Math.round(predictedWinProb * 1000) / 10
  };

  return {
    score: Math.round(score * 100) / 100,
    prediction: prediction,
    confidence: Math.round(confidence * 10) / 10,
    probability: Math.round(predictedWinProb * 1000) / 10,
    factorBreakdown: factorBreakdown,
    meta: meta
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: analyzeTier1 (COMPLETE PATCHED VERSION v3.3)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function analyzeTier1(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('STARTING TIER 1 ANALYSIS (Complete Patched v3.3)');
  Logger.log('═══════════════════════════════════════════════════════════════');

  try {
    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: Load configuration
    // ════════════════════════════════════════════════════════════════════════
    var config = loadTier1Config(ss);
    if (typeof validateConfigState_ === 'function') {
      try {
        validateConfigState_(config, ['confMin', 'confMax']);
      } catch (eVal) {
        Logger.log('[analyzeTier1] validateConfigState_: ' + eVal);
      }
    }
    Logger.log('[Config] ✓ Loaded version: ' + config.version);
    Logger.log('[Config] Confidence bounds: [' + config.confMin + '-' + config.confMax + ']');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 2: Pre-load prediction key map
    // ════════════════════════════════════════════════════════════════════════
    var predictionKeyMap = {};
    if (typeof buildPredictionKeyMap === 'function') {
      predictionKeyMap = buildPredictionKeyMap(ss);
      Logger.log('[Predictions] ✓ Loaded prediction key map');
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 3: Validate and load required sheets
    // ════════════════════════════════════════════════════════════════════════
    var requiredSheets = ['UpcomingClean', 'Clean', 'Standings'];
    var sheets = {};

    for (var s = 0; s < requiredSheets.length; s++) {
      var sheetName = requiredSheets[s];
      var sheet = getSheetInsensitive(ss, sheetName);
      if (!sheet) {
        throw new Error('Required sheet "' + sheetName + '" not found.');
      }
      sheets[sheetName] = sheet;
    }

    sheets['ResultsClean'] = getSheetInsensitive(ss, 'ResultsClean');
    sheets['Stats'] = getSheetInsensitive(ss, 'Stats');
    sheets['LeagueQuarterStats'] = getSheetInsensitive(ss, 'LeagueQuarterStats');

    Logger.log('[Sheets] ✓ All required sheets found');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 4: Load data from sheets
    // ════════════════════════════════════════════════════════════════════════
    var upcomingData = sheets['UpcomingClean'].getDataRange().getValues();
    var cleanData = sheets['Clean'].getDataRange().getValues();
    var resultsData = sheets['ResultsClean'] ? sheets['ResultsClean'].getDataRange().getValues() : [];

    var headers = cleanData.length > 1 ? cleanData[0] : (resultsData.length > 1 ? resultsData[0] : []);
    var allHistoricalGames = [headers];
    
    for (var c = 1; c < cleanData.length; c++) {
      allHistoricalGames.push(cleanData[c]);
    }
    for (var r = 1; r < resultsData.length; r++) {
      allHistoricalGames.push(resultsData[r]);
    }

    Logger.log('[Data] ✓ Loaded ' + (upcomingData.length - 1) + ' upcoming, ' +
               (allHistoricalGames.length - 1) + ' historical games');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 5: Create header maps and load standings
    // ════════════════════════════════════════════════════════════════════════
    var upcomingHeader = createHeaderMap(upcomingData[0]);
    var historicalHeader = createHeaderMap(allHistoricalGames[0]);
    var standings = loadStandings(ss);

    Logger.log('[Standings] ✓ Loaded ' + Object.keys(standings).length + ' teams');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6: Load supplementary stats (WITH FIXED LOADERS)
    // ════════════════════════════════════════════════════════════════════════
    var statsData = { league: {} };
    var quarterStats = {};
    var varianceMap = {};

    if (sheets['Stats']) {
      try {
        statsData = loadStatsFromSheet(sheets['Stats']);
        Logger.log('[Stats] ✓ Loaded league stats: ' + Object.keys(statsData.league).join(', '));
      } catch (e) {
        Logger.log('[Stats] ⚠️ Could not load: ' + e.message);
      }
    }

    if (sheets['LeagueQuarterStats']) {
      try {
        quarterStats = loadQuarterWinnerStats(sheets['LeagueQuarterStats']);
        Logger.log('[QuarterStats] ✓ Loaded quarter stats');
      } catch (e) {
        Logger.log('[QuarterStats] ⚠️ Could not load: ' + e.message);
      }
    }

    if (typeof _loadVarianceMap === 'function') {
      varianceMap = _loadVarianceMap(ss);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 7: Validate upcoming data
    // ════════════════════════════════════════════════════════════════════════
    if (upcomingData.length <= 1) {
      throw new Error('"UpcomingClean" is empty. No games to forecast.');
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 8: Prepare output sheet
    // ════════════════════════════════════════════════════════════════════════
    var outputSheet = getSheetInsensitive(ss, 'Analysis_Tier1');
    if (!outputSheet) {
      outputSheet = ss.insertSheet('Analysis_Tier1');
    }

    var outputHeaders = [
      'League', 'Game Type', 'Home', 'Away', 'Date', 'Time',
      'MaGolide Pred', 'Confidence %', 'Win Prob %', 'MaGolide Score',
      'Forebet Pred', 'Forebet %', 'Pred Score', 'Avg', 'Odds',
      'Home Rank', 'Home W-L', 'Home PCT', 'Home NetRtg', 'Home Streak', 'Home L10', 'Home L5 Home',
      'Away Rank', 'Away W-L', 'Away PCT', 'Away NetRtg', 'Away Streak', 'Away L10', 'Away L5 Away',
      'Rank Diff', 'PCT Diff', 'NetRtg Diff', 'HomeCourt Effect', 'Momentum Diff', 'Streak Diff',
      'Form Diff', 'H2H Diff', 'Forebet Diff', 'Variance Penalty',
      'F:Rank', 'F:PCT', 'F:NetRtg', 'F:HomeCourt', 'F:Momentum', 'F:Streak',
      'F:Form', 'F:H2H', 'F:Forebet', 'F:Variance', 'F:HomeAdv',
      'H2H Record', 'H2H Avg Margin', 'H2H Total Games',
      'League Accuracy', 'Q1 Pred Accuracy'
    ];

    var output = [outputHeaders];

    // ════════════════════════════════════════════════════════════════════════
    // STEP 9: Process each upcoming game
    // ════════════════════════════════════════════════════════════════════════
    var gamesProcessed = 0;
    var gamesSkipped = 0;

    // Debug: Log header map keys
    Logger.log('[Headers] UpcomingClean keys: ' + Object.keys(upcomingHeader).slice(0, 15).join(', '));

    for (var i = 1; i < upcomingData.length; i++) {
      var game = upcomingData[i];

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9.0: Extract game info with flexible header lookup
      // ══════════════════════════════════════════════════════════════════════
      var league = getGameValue_(game, upcomingHeader, ['league'], '');
      var gameType = getGameValue_(game, upcomingHeader, ['game type', 'gametype', 'type'], '');
      var homeTeam = getGameValue_(game, upcomingHeader, ['home', 'home team', 'hometeam'], '');
      var awayTeam = getGameValue_(game, upcomingHeader, ['away', 'away team', 'awayteam'], '');
      var gameDateRaw = getGameValue_(game, upcomingHeader, ['date', 'game date', 'gamedate'], null);
      var gameTime = getGameValue_(game, upcomingHeader, ['time', 'game time', 'gametime'], '');

      if (!homeTeam || !awayTeam) {
        gamesSkipped++;
        continue;
      }

      var gameDate;
      if (gameDateRaw instanceof Date) {
        gameDate = gameDateRaw;
      } else if (gameDateRaw) {
        gameDate = new Date(gameDateRaw);
        if (isNaN(gameDate.getTime())) gameDate = new Date();
      } else {
        gameDate = new Date();
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9a: Get standings information
      // ══════════════════════════════════════════════════════════════════════
      var homeStandings = getTeamStanding(standings, homeTeam, ss);
      var awayStandings = getTeamStanding(standings, awayTeam, ss);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9b: Calculate features from standings
      // ══════════════════════════════════════════════════════════════════════
      var rankDiff = calculateRankDifference_(homeStandings, awayStandings);
      var pctDiff = calculatePCTDifference_(homeStandings, awayStandings);
      var netRtgDiff = calculateNetRatingDifference_(homeStandings, awayStandings);
      var homeCourtEffect = calculateHomeCourtEffect_(homeStandings, awayStandings);
      var momentumDiff = calculateMomentumDifference_(homeStandings, awayStandings);
      var streakDiff = calculateStreakDifference_(homeStandings, awayStandings);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9c: Historical form - TRY HISTORICAL, FALLBACK TO STANDINGS
      // ══════════════════════════════════════════════════════════════════════
      var homeStreakHist = calculateStreak(homeTeam, gameDate, allHistoricalGames, historicalHeader);
      var awayStreakHist = calculateStreak(awayTeam, gameDate, allHistoricalGames, historicalHeader);
      var homeL10 = calculateLastN(homeTeam, gameDate, 10, allHistoricalGames, historicalHeader);
      var awayL10 = calculateLastN(awayTeam, gameDate, 10, allHistoricalGames, historicalHeader);
      var homeL5Home = calculateLastNHomeAway(homeTeam, gameDate, 5, 'home', allHistoricalGames, historicalHeader);
      var awayL5Away = calculateLastNHomeAway(awayTeam, gameDate, 5, 'away', allHistoricalGames, historicalHeader);

      // FALLBACK: If historical calc failed, use standings data
      if (homeStreakHist === 'N/A' || homeL10 === 'N/A') {
        var homeForm = getTeamFormFromStandings_(homeStandings);
        if (homeStreakHist === 'N/A') homeStreakHist = homeForm.streak;
        if (homeL10 === 'N/A') homeL10 = homeForm.l10;
        if (homeL5Home === 'N/A') homeL5Home = homeForm.homeSplit;
      }
      
      if (awayStreakHist === 'N/A' || awayL10 === 'N/A') {
        var awayForm = getTeamFormFromStandings_(awayStandings);
        if (awayStreakHist === 'N/A') awayStreakHist = awayForm.streak;
        if (awayL10 === 'N/A') awayL10 = awayForm.l10;
        if (awayL5Away === 'N/A') awayL5Away = awayForm.awaySplit;
      }

      var formDiff = calculateFormDifference_(homeStreakHist, awayStreakHist, homeL10, awayL10);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9d: H2H features
      // ══════════════════════════════════════════════════════════════════════
      var h2hStats = { homeWins: 0, awayWins: 0, avgMargin: 0, totalGames: 0 };
      if (typeof analyzeHistoricalHeadToHead === 'function') {
        h2hStats = analyzeHistoricalHeadToHead(homeTeam, awayTeam, allHistoricalGames, historicalHeader);
      }
      var h2hDiff = calculateH2HDifference_(h2hStats);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9e: Forebet features (FLEXIBLE HEADER LOOKUP)
      // ══════════════════════════════════════════════════════════════════════
      var forebetPred = getGameValue_(game, upcomingHeader, 
        ['pred', 'prediction', 'forebet pred', 'forebetpred'], '');
      
      var forebetProbRaw = getGameValue_(game, upcomingHeader, 
        ['prob %', 'prob%', 'prob', 'probability', 'forebet prob'], '');
      
      var predScoreRaw = getGameValue_(game, upcomingHeader, 
        ['pred score', 'predscore', 'predicted score', 'forebet score'], '');
      
      var avgRaw = getGameValue_(game, upcomingHeader, 
        ['avg', 'average', 'avg score'], '');
      
      var oddsRaw = getGameValue_(game, upcomingHeader, 
        ['odds', 'betting odds', 'line'], '');

      var forebetFavPct = getForebetFavoredProbability_(forebetPred, forebetProbRaw, homeTeam, awayTeam);
      var forebetDiff = calculateForebetDifference_(forebetPred, forebetProbRaw, homeTeam, awayTeam);

      // Variance penalty
      var variancePenalty = calculateVariancePenalty_(homeTeam, awayTeam, varianceMap);

      // Build features object
      var features = {
        rankDiff: rankDiff,
        pctDiff: pctDiff,
        netRtgDiff: netRtgDiff,
        homeCourtEffect: homeCourtEffect,
        momentumDiff: momentumDiff,
        streakDiff: streakDiff,
        formDiff: formDiff,
        h2hDiff: h2hDiff,
        forebetDiff: forebetDiff,
        variancePenalty: variancePenalty
      };

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9f: Calculate prediction
      // ══════════════════════════════════════════════════════════════════════
      var scoreResult = calculateMaGolideScore(features, config);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9g: Log prediction
      // ══════════════════════════════════════════════════════════════════════
      if (typeof logTier1Prediction === 'function') {
        var predictionPayload = {
          league: league,
          date: gameDateRaw,
          home: homeTeam,
          away: awayTeam,
          configVersion: config.version,
          features: features,
          factorScores: scoreResult.factorBreakdown,
          score: scoreResult.score,
          prediction: scoreResult.prediction,
          confidence: scoreResult.confidence,
          probability: scoreResult.probability,
          forebetPrediction: forebetPred,
          forebetConfidence: forebetFavPct
        };
        logTier1Prediction(ss, predictionPayload, predictionKeyMap);
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9h: Get supplementary stats (CASE-INSENSITIVE LOOKUP)
      // ══════════════════════════════════════════════════════════════════════
      var leagueAcc = 'N/A';
      var leagueLower = normalizeLeagueName_(league);
      
      if (statsData && statsData.league) {
        var leagueStats = statsData.league[leagueLower] || 
                          statsData.league[league] || 
                          statsData.league['overall'];
        
        if (leagueStats && leagueStats.winnerAccuracy !== undefined) {
          leagueAcc = leagueStats.winnerAccuracy;
          if (typeof leagueAcc === 'number') {
            leagueAcc = leagueAcc.toFixed(1) + '%';
          }
        }
      }
      
      var q1Acc = 'N/A';
      if (quarterStats) {
        var qStats = quarterStats[leagueLower] || 
                     quarterStats[league] || 
                     quarterStats['nba'] ||
                     quarterStats['overall'];
        
        if (qStats && qStats['Q1']) {
          var q1Data = qStats['Q1'];
          if (q1Data.accuracy !== undefined) {
            q1Acc = q1Data.accuracy;
            if (typeof q1Acc === 'number') {
              q1Acc = q1Acc.toFixed(1) + '%';
            }
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 9i: Build output row
      // ══════════════════════════════════════════════════════════════════════
      var fb = scoreResult.factorBreakdown;
      
      var outputRow = [
        league, gameType, homeTeam, awayTeam, gameDateRaw || '', gameTime,
        scoreResult.prediction,
        scoreResult.confidence.toFixed(1),
        scoreResult.probability.toFixed(1),
        scoreResult.score.toFixed(2),
        forebetPred || '',
        forebetFavPct || '',
        predScoreRaw || '',
        avgRaw || '',
        oddsRaw || '',
        homeStandings.rank,
        homeStandings.wl,
        (homeStandings.pct * 100).toFixed(1) + '%',
        homeStandings.netRtg.toFixed(1),
        homeStreakHist,
        homeL10,
        homeL5Home,
        awayStandings.rank,
        awayStandings.wl,
        (awayStandings.pct * 100).toFixed(1) + '%',
        awayStandings.netRtg.toFixed(1),
        awayStreakHist,
        awayL10,
        awayL5Away,
        features.rankDiff.toFixed(2),
        features.pctDiff.toFixed(2),
        features.netRtgDiff.toFixed(2),
        features.homeCourtEffect.toFixed(2),
        features.momentumDiff.toFixed(2),
        features.streakDiff.toFixed(2),
        features.formDiff.toFixed(2),
        features.h2hDiff.toFixed(2),
        features.forebetDiff.toFixed(2),
        features.variancePenalty.toFixed(2),
        fb.rank.toFixed(2),
        fb.pct.toFixed(2),
        fb.netRtg.toFixed(2),
        fb.homeCourt.toFixed(2),
        fb.momentum.toFixed(2),
        fb.streak.toFixed(2),
        fb.form.toFixed(2),
        fb.h2h.toFixed(2),
        fb.forebet.toFixed(2),
        fb.variance.toFixed(2),
        fb.homeAdv.toFixed(2),
        h2hStats.homeWins + '-' + h2hStats.awayWins,
        h2hStats.avgMargin.toFixed(1),
        h2hStats.totalGames,
        leagueAcc,
        q1Acc
      ];

      output.push(outputRow);
      gamesProcessed++;
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 10: Write output
    // ════════════════════════════════════════════════════════════════════════
    outputSheet.clear();

    if (output.length > 0 && output[0].length > 0) {
      outputSheet.getRange(1, 1, output.length, output[0].length).setValues(output);

      outputSheet.getRange(1, 1, 1, output[0].length)
        .setFontWeight('bold')
        .setBackground('#d9ead3');
      outputSheet.setFrozenRows(1);
      
      try {
        outputSheet.autoResizeColumns(1, Math.min(output[0].length, 26));
      } catch (e) {
        Logger.log('[Format] ⚠️ Could not auto-resize columns');
      }

      if (typeof _applyConditionalFormatting === 'function') {
        var predCol = output[0].indexOf('MaGolide Pred') + 1;
        _applyConditionalFormatting(outputSheet, predCol, output.length);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 11: Report completion
    // ════════════════════════════════════════════════════════════════════════
    Logger.log('═══════════════════════════════════════════════════════════════');
    Logger.log('TIER 1 ANALYSIS COMPLETE');
    Logger.log('═══════════════════════════════════════════════════════════════');
    Logger.log('[Summary] Processed: ' + gamesProcessed + ', Skipped: ' + gamesSkipped);

    Logger.log('[Tier1] Forecast complete: ' + gamesProcessed + ' games analyzed. Predictions written to Analysis_Tier1 + Tier1_Predictions.');

    Logger.log('[PHASE 2 COMPLETE] Tier1_Predictions: FORENSIC_CORE_17 + confidence bundle');
    Logger.log('[PHASE 3 COMPLETE] Tier1 validateConfigState_(version, confMin, confMax)');
  } catch (e) {
    Logger.log('!!! ERROR in analyzeTier1: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    ui.alert('Module 4 Error', e.message, ui.ButtonSet.OK);
  }
}


/**
 * buildPredictionKeyMap
 * 
 * WHY: Pre-load existing prediction keys for O(1) lookup during logging.
 *      Prevents the logger from reading the entire sheet for every game.
 *      This is the key to the anti-bloat fix.
 * 
 * WHAT: Reads Tier1_Predictions once, builds a Map of composite keys to row numbers.
 * 
 * HOW: Iterates column A (prediction_record_id), maps to row number.
 * 
 * WHERE: Tier1_Predictions sheet (read-only operation)
 * 
 * [NEW in v2.1]: Added to support upsert logic in logTier1Prediction
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - Active spreadsheet
 * @returns {Map<string, number>} Map of "gameKey|configVersion" -> rowNumber
 */
function buildPredictionKeyMap(ss) {
  const sheet = getSheetInsensitive(ss, 'Tier1_Predictions');
  const keyMap = new Map();

  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('[buildPredictionKeyMap] No existing predictions to load.');
    return keyMap;
  }

  // Column A = prediction_record_id (Patch 1B). Legacy sheets: column A may be game_key — still unique per row.
  const lastR = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastR, 1).getValues();

  data.forEach((row, index) => {
    const pid = String(row[0] || '').trim();
    if (pid) {
      keyMap.set(pid, index + 2);
    }
  });

  Logger.log('[buildPredictionKeyMap] Loaded ' + keyMap.size + ' existing prediction keys.');
  return keyMap;
}


/**
 * logTier1Prediction (The Upserter)
 * 
 * WHY: Creates a permanent forensic audit trail for every Tier 1 prediction.
 *      When predictions fail, we need to know EXACTLY what config was used,
 *      what features were calculated, and what the model outputted.
 *
 * WHAT: Writes or updates a prediction row in 'Tier1_Predictions' sheet.
 *       Uses UPSERT logic: update if exists, insert if new.
 *
 * HOW: 
 *   1. Generates a unique game_key for deduplication
 *   2. Creates composite key: gameKey|configVersion
 *   3. Checks pre-loaded map for existing row
 *   4. Updates existing row OR appends new row
 *   5. Updates map for subsequent calls in same run
 *
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 *        Called by: analyzeTier1() after each prediction
 *
 * [PATCH 2.1 FIX]: Previous version used blind appendRow(), causing duplicates.
 *                  Now implements proper upsert: update if exists, insert if new.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The active spreadsheet
 * @param {Object} p - The prediction object with all required fields
 * @param {Map<string, number>} [existingRowMap] - Optional pre-loaded key map for O(1) lookup
 */
function logTier1Prediction(ss, p, existingRowMap) {
  try {
    let sheet = getSheetInsensitive(ss, 'Tier1_Predictions');

    // Phase 2 / Patch 6: FORENSIC_CORE_17 + diagnostics (Contract_Enforcer)
    const F17 = (typeof FORENSIC_CORE_17 !== 'undefined')
      ? FORENSIC_CORE_17
      : [
        'Prediction_Record_ID', 'Universal_Game_ID', 'Config_Version', 'Timestamp_UTC',
        'League', 'Date', 'Home', 'Away', 'Market', 'Period', 'Pick_Code', 'Pick_Text',
        'Confidence_Pct', 'Confidence_Prob', 'Tier_Code', 'EV', 'Edge_Score'
      ];
    const DIAG = [
      'Diag_Rank_Diff', 'Diag_Form_Diff', 'Diag_H2H_Diff', 'Diag_Forebet_Diff', 'Diag_Variance_Penalty',
      'Diag_Factor_Rank', 'Diag_Factor_Form', 'Diag_Factor_H2H', 'Diag_Factor_Forebet','Diag_Factor_Variance','Diag_Factor_HomeAdv',
      'Forebet_Prediction','Forebet_Confidence_Raw'
    ];
    const headers = F17.concat(DIAG);

    // WHY: Create sheet with headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet('Tier1_Predictions');
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9d9d9');
      sheet.setFrozenRows(1);
      Logger.log('[Tier1 Logger] Created Tier1_Predictions sheet with ' + headers.length + ' columns.');
    } else {
      // WHY: Validate headers on existing sheet - fix if needed
      const lastCol = sheet.getLastColumn();
      const firstRow = sheet.getRange(1, 1, 1, Math.max(lastCol, headers.length)).getValues()[0];
      
      const needsHeaderFix = lastCol < headers.length ||
                             String(firstRow[0] || '').toLowerCase().replace(/_/g, '') !== 'predictionrecordid';
      
      if (needsHeaderFix) {
        if (lastCol > 0) {
          sheet.getRange(1, 1, 1, Math.max(lastCol, headers.length)).clearContent();
        }
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9d9d9');
        Logger.log('[Tier1 Logger] FIXED headers - now has ' + headers.length + ' columns (was ' + lastCol + ').');
      }
    }

    const configVersion = p.configVersion || 'default';

    let universalGameId = '';
    try {
      if (typeof buildUniversalGameID_ === 'function') {
        universalGameId = buildUniversalGameID_(p.date, p.home, p.away);
      }
    } catch (eId) {
      Logger.log('[Tier1 Logger] buildUniversalGameID_: ' + eId.message);
    }
    if (!universalGameId && typeof standardizeDate_ === 'function') {
      const ymd = standardizeDate_(p.date);
      const y = (ymd && ymd.replace(/-/g, '')) || 'NODATE';
      const h = String(p.home || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_+/g, '_');
      const a = String(p.away || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_+/g, '_');
      universalGameId = y + '__' + h + '__' + a;
    }

    let predictionRecordId = '';
    try {
      if (typeof buildPredictionRecordID_ === 'function' && universalGameId) {
        predictionRecordId = buildPredictionRecordID_(universalGameId, 'TIER1', 'FT', configVersion);
      }
    } catch (ePr) {
      Logger.log('[Tier1 Logger] buildPredictionRecordID_: ' + ePr.message);
    }
    if (!predictionRecordId && universalGameId) {
      predictionRecordId = universalGameId + '__TIER1__FT__' + String(configVersion).replace(/__/g, '_');
    }
    if (!predictionRecordId) {
      predictionRecordId = 'T1_FALLBACK__' + String(p.home || '').replace(/__/g, '_') + '__' +
        String(p.away || '').replace(/__/g, '_') + '__' + String(configVersion).replace(/__/g, '_');
    }

    const feat = p.features || {};
    const fact = p.factorScores || {};
    const stdDate = (typeof standardizeDate_ === 'function') ? standardizeDate_(p.date) : '';
    const confB = (typeof normalizeConfidenceBundle_ === 'function')
      ? normalizeConfidenceBundle_(p.confidence)
      : { confidencePct: Number(p.confidence) || 0, confidenceProb: (Number(p.confidence) || 0) / 100, tierCode: 'WEAK', tierDisplay: '★ (0%) ★' };
    const predRaw = String(p.prediction || '').toUpperCase();
    let pickCode = 'UNK';
    if (predRaw.indexOf('HOME') >= 0) pickCode = 'HOME';
    else if (predRaw.indexOf('AWAY') >= 0) pickCode = 'AWAY';
    else if (predRaw.indexOf('RISK') >= 0) pickCode = 'RISKY';

    const core17 = [
      predictionRecordId,
      universalGameId,
      configVersion,
      new Date(),
      p.league || '',
      stdDate || p.date || '',
      p.home || '',
      p.away || '',
      'TIER1',
      'FT',
      pickCode,
      String(p.prediction || ''),
      confB.confidencePct,
      confB.confidenceProb,
      confB.tierCode,
      '',
      p.score || 0
    ];
    const rowData = core17.concat([
      feat.rankDiff || 0,
      feat.formDiff || 0,
      feat.h2hDiff || 0,
      feat.forebetDiff || 0,
      feat.variancePenalty || 0,
      fact.rank || 0,
      fact.form || 0,
      fact.h2h || 0,
      fact.forebet || 0,
      fact.variance || 0,
      fact.homeAdv || 0,
      p.forebetPrediction || '',
      p.forebetConfidence || 0
    ]);

    let targetRow = -1;

    if (existingRowMap && predictionRecordId && existingRowMap.has(predictionRecordId)) {
      targetRow = existingRowMap.get(predictionRecordId);
    } else if (!existingRowMap && predictionRecordId && sheet.getLastRow() > 1) {
      const keyData = sheet.getRange(2, 1, sheet.getLastRow(), 1).getValues();
      for (let i = 0; i < keyData.length; i++) {
        if (String(keyData[i][0] || '').trim() === predictionRecordId) {
          targetRow = i + 2;
          break;
        }
      }
    }

    if (targetRow > 0) {
      sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
      if (existingRowMap && predictionRecordId) {
        existingRowMap.set(predictionRecordId, sheet.getLastRow());
      }
    }

  } catch (e) {
    Logger.log('[Tier1 Logger ERROR] ' + e.message);
  }
}


/**
 * WHY: Rank difference is a strong predictor of match outcome.
 * WHAT: Calculate the rank difference between home and away teams.
 * WHERE: Module 4, called by analyzeTier1
 */
function _calculateRankDifference(homeStandings, awayStandings) {
  let homeRank = parseInt(homeStandings.rank);
  let awayRank = parseInt(awayStandings.rank);
  
  if (isNaN(homeRank)) homeRank = 999;
  if (isNaN(awayRank)) awayRank = 999;
  
  return awayRank - homeRank;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _getTeamStandings
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Defensive helper that ensures we always get a valid standings object,
 *      even if the team is not found (returns neutral defaults to prevent NaN).
 * 
 * WHAT: Looks up team in standings map, returns defaults if not found.
 * 
 * HOW: Normalizes team name to lowercase, looks up in standings object,
 *      returns default object with neutral values if not found.
 * 
 * WHERE: Module 4 helper, called before feature calculations.
 * 
 * @param {string} teamName - Team name to look up
 * @param {Object} standings - Standings map from loadStandings()
 * @returns {Object} Team standings object (real or default)
 */
function _getTeamStandings(teamName, standings) {
  // WHY: Neutral defaults prevent NaN propagation if team is missing
  const defaultStandings = {
    rank: 15,
    pct: 0.5,
    netRtg: 0,
    homePct: 0.5,
    awayPct: 0.5,
    l10Pct: 0.5,
    streak: 0,
    gp: 0,
    pf: 0,
    pa: 0,
    wl: '0-0'
  };
  
  if (!teamName || !standings) {
    return defaultStandings;
  }
  
  const normalizedName = String(teamName).trim().toLowerCase();
  return standings[normalizedName] || defaultStandings;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _calculatePCTDifference
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: PCT difference captures the ACTUAL skill gap between teams.
 *      Rank difference of 1 between OKC (0.955) and Lakers (0.75) hides
 *      a 20.5% performance gap. PCT exposes this magnitude.
 * 
 * WHAT: Returns scaled difference in win percentages (home - away).
 * 
 * HOW: Subtracts away PCT from home PCT, multiplies by 10 to match
 *      typical rank difference magnitude (0-15 range).
 * 
 * [NEW]: Replaces rank-based logic with performance-based metric.
 * 
 * WHERE: Module 4 helper, called by feature extraction in analyzeTier1().
 * 
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Scaled PCT difference (positive = home advantage)
 */
function _calculatePCTDifference(homeStandings, awayStandings) {
  const homePct = homeStandings.pct || 0.5;
  const awayPct = awayStandings.pct || 0.5;
  
  // WHY: Scale by 10 to match typical rank difference magnitude (0-15 range)
  // Example: OKC (0.955) vs Lakers (0.75) = 0.205 * 10 = 2.05 scaled diff
  return (homePct - awayPct) * 10;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _calculateNetRatingDifference
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Net Rating (point differential per game) is THE strongest single
 *      predictor in basketball. It correlates ~0.95 with future wins.
 *      Example: OKC (+15.3) vs Pelicans (-10.7) = +26.0 gap = dominant edge.
 * 
 * WHAT: Returns the raw difference in net ratings between teams.
 * 
 * HOW: Subtracts away netRtg from home netRtg. No scaling needed because
 *      typical NBA netRtg already ranges from -15 to +15.
 * 
 * [NEW]: Uses PF-PA per game for accurate strength measurement.
 * 
 * WHERE: Module 4 helper, called by feature extraction in analyzeTier1().
 * 
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Net rating difference (positive = home advantage)
 */
function _calculateNetRatingDifference(homeStandings, awayStandings) {
  const homeNetRtg = homeStandings.netRtg || 0;
  const awayNetRtg = awayStandings.netRtg || 0;
  
  // WHY: Raw difference already meaningful (typical range -15 to +15 per team)
  // Example: OKC (+15.3) vs Pelicans (-10.7) = 26.0 → massive advantage
  return homeNetRtg - awayNetRtg;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _calculateHomeCourtEffect
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Generic "home advantage" is too blunt. Some teams are road warriors
 *      (strong away record); others are home-only threats. This function
 *      compares home team's HOME record vs away team's AWAY record.
 * 
 * WHAT: Returns scaled difference between home team's home PCT and
 *       away team's road PCT.
 * 
 * HOW: Subtracts away team's awayPct from home team's homePct,
 *      multiplies by 10 to match other feature magnitudes.
 * 
 * [NEW]: Uses actual home/away splits instead of generic home advantage.
 * 
 * WHERE: Module 4 helper, called by feature extraction in analyzeTier1().
 * 
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Contextual home court effect (positive = home advantage)
 */
function _calculateHomeCourtEffect(homeStandings, awayStandings) {
  const homeHomePct = homeStandings.homePct || 0.5;
  const awayAwayPct = awayStandings.awayPct || 0.5;
  
  // WHY: Scale by 10 to match other feature magnitudes
  // Example: Home team 0.8 at home vs Away team 0.4 on road = 4.0 scaled
  return (homeHomePct - awayAwayPct) * 10;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _calculateMomentumDifference
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Recent form (last 10 games) often trumps season-long stats,
 *      especially mid-season. A team going 8-2 in L10 is playing better
 *      than their 0.500 season record suggests.
 * 
 * WHAT: Returns scaled difference in last-10 win percentages.
 * 
 * HOW: Subtracts away L10 PCT from home L10 PCT, scales by 10.
 * 
 * [NEW]: Captures current hot/cold streaks independent of season record.
 * 
 * WHERE: Module 4 helper, called by feature extraction in analyzeTier1().
 * 
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Momentum difference (positive = home is hotter)
 */
function _calculateMomentumDifference(homeStandings, awayStandings) {
  const homeL10Pct = homeStandings.l10Pct || 0.5;
  const awayL10Pct = awayStandings.l10Pct || 0.5;
  
  // WHY: Scale by 10 to match other feature magnitudes
  return (homeL10Pct - awayL10Pct) * 10;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION: _calculateStreakDifference
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * WHY: Teams on winning streaks play with confidence; losing streaks
 *      indicate doubt and pressure. This is a psychological factor.
 * 
 * WHAT: Returns raw difference in current streak lengths.
 *       Positive streak = wins, Negative streak = losses.
 * 
 * HOW: Subtracts away streak from home streak. No scaling needed
 *      because typical streaks already range from -10 to +10.
 * 
 * [NEW]: Captures psychological momentum factor.
 * 
 * WHERE: Module 4 helper, called by feature extraction in analyzeTier1().
 * 
 * @param {Object} homeStandings - Home team standings object
 * @param {Object} awayStandings - Away team standings object
 * @returns {number} Streak difference (positive = home on better run)
 */
function _calculateStreakDifference(homeStandings, awayStandings) {
  const homeStreak = homeStandings.streak || 0;
  const awayStreak = awayStandings.streak || 0;
  
  // WHY: Raw difference already meaningful (typical range -10 to +10)
  return homeStreak - awayStreak;
}

/**
 * WHY: Recent form indicates current team momentum.
 * WHAT: Calculate a form difference score from streak and L10 records.
 * WHERE: Module 4, called by analyzeTier1
 */
function _calculateFormDifference(homeStreak, awayStreak, homeL10, awayL10) {
  const parseStreak = (s) => {
    if (!s || s === 'N/A') return 0;
    const match = s.match(/([WL])(\d+)/i);
    if (!match) return 0;
    const direction = match[1].toUpperCase() === 'W' ? 1 : -1;
    const count = parseInt(match[2]) || 0;
    return direction * count;
  };
  
  const parseRecord = (r) => {
    if (!r || r === 'N/A') return 0;
    const parts = r.split('-');
    if (parts.length !== 2) return 0;
    const wins = parseInt(parts[0]) || 0;
    const losses = parseInt(parts[1]) || 0;
    const total = wins + losses;
    if (total === 0) return 0;
    return (wins / total) - 0.5;
  };
  
  const homeStreakVal = parseStreak(homeStreak);
  const awayStreakVal = parseStreak(awayStreak);
  const homeL10Val = parseRecord(homeL10);
  const awayL10Val = parseRecord(awayL10);
  
  const streakDiff = (homeStreakVal - awayStreakVal) * 0.6;
  const l10Diff = (homeL10Val - awayL10Val) * 10 * 0.4;
  
  return streakDiff + l10Diff;
}


/**
 * WHY: Head-to-head history reveals matchup-specific dynamics.
 * WHAT: Calculate H2H advantage from historical results.
 * WHERE: Module 4, called by analyzeTier1
 */
function _calculateH2HDifference(h2hStats) {
  if (!h2hStats || h2hStats.totalGames === 0) {
    return 0;
  }
  
  const totalGames = h2hStats.totalGames;
  const homeWins = h2hStats.homeWins;
  const awayWins = h2hStats.awayWins;
  
  const homeWinRate = homeWins / totalGames;
  const awayWinRate = awayWins / totalGames;
  const rateDiff = homeWinRate - awayWinRate;
  
  const sampleConfidence = Math.min(1, Math.log10(totalGames + 1));
  
  return rateDiff * 5 * sampleConfidence;
}




// ============================================================
// SECTION 5: LOCAL HELPER FUNCTIONS
// ============================================================
/**
 * Team variance map cache (per execution)
 */
var __VAR_LOGGED_NO_TEAMVAR = false;
var __TEAM_VARIANCE_MAP_CACHE = null;
var __TEAM_VARIANCE_MAP_CACHE_SET = false;

/**
 * WHY: Load variance data (team-level) from Stats sheet for penalty calculation.
 * WHAT: Build a map of { canonTeamName: variance } from Stats sheet.
 *
 * NOTES:
 * - If your Stats sheet has NO team variance table (your current case), this returns {}.
 * - Accepts variance OR SD columns; if SD provided, converts SD -> variance.
 * - Scans first ~25 rows to find a header row.
 */
function _loadVarianceMap(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var varianceMap = {};
  var statsSheet = (typeof __s5_getSheet__ === 'function') ? __s5_getSheet__(ss, 'Team_Variance', false) : 
                   ((typeof __s5_getSheet === 'function') ? __s5_getSheet(ss, 'Team_Variance', false) :
                   (ss.getSheetByName('Team_Variance') ||
                    ss.getSheetByName('Variance_Map') ||
                    ss.getSheetByName('Team_Stats') ||
                    ss.getSheetByName('Stats')));
  if (!statsSheet) return varianceMap;

  function normHead_(s) {
    return String(s || '')
      .toLowerCase()
      .trim()
      .replace(/\u00A0/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/[%]/g, ' pct ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

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

  function headerMap_(row) {
    var hm = {};
    for (var c = 0; c < row.length; c++) {
      var k = normHead_(row[c]);
      if (!k) continue;
      if (hm[k] === undefined) hm[k] = c;
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

  function findHeaderRowIndex_(grid) {
    var scan = Math.min(25, grid.length);
    for (var r = 0; r < scan; r++) {
      var hm = headerMap_(grid[r]);
      var cTeam = findCol_(hm, ['team', 'team name', 'teamname', 'squad', 'club']);
      var cVar = findCol_(hm, ['variance', 'var', 'ft variance', 'ft var', 'total variance', 'game variance']);
      var cSd  = findCol_(hm, ['sd', 'stddev', 'stdev', 'sigma', 'std dev', 'ft sd', 'total sd', 'game sd']);
      if (cTeam !== undefined && (cVar !== undefined || cSd !== undefined)) return r;
    }
    return -1;
  }

  var statsSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Stats')
    : ss.getSheetByName('Stats');

  if (!statsSheet) {
    if (!__VAR_LOGGED_NO_TEAMVAR) {
      Logger.log('[Variance] Stats sheet not found; using league quarter SD fallback.');
      __VAR_LOGGED_NO_TEAMVAR = true;
    }
    return varianceMap;
  }

  try {
    var data = statsSheet.getDataRange().getValues();
    if (!data || data.length < 2) {
      if (!__VAR_LOGGED_NO_TEAMVAR) {
        Logger.log('[Variance] Stats sheet has no usable rows; using league quarter SD fallback.');
        __VAR_LOGGED_NO_TEAMVAR = true;
      }
      return varianceMap;
    }

    var headerRowIdx = findHeaderRowIndex_(data);
    if (headerRowIdx < 0) {
      if (!__VAR_LOGGED_NO_TEAMVAR) {
        Logger.log('[Variance] Using league quarter SD');
        __VAR_LOGGED_NO_TEAMVAR = true;
      }
      return varianceMap; // empty on purpose
    }

    var hm = headerMap_(data[headerRowIdx]);
    var teamCol     = findCol_(hm, ['team', 'team name', 'teamname', 'squad', 'club']);
    var varianceCol = findCol_(hm, ['variance', 'var', 'ft variance', 'ft var', 'total variance', 'game variance']);
    var sdCol       = findCol_(hm, ['sd', 'stddev', 'stdev', 'sigma', 'std dev', 'ft sd', 'total sd', 'game sd']);

    if (teamCol === undefined || (varianceCol === undefined && sdCol === undefined)) {
      if (!__VAR_LOGGED_NO_TEAMVAR) {
        Logger.log('[Variance] Found a header row but missing Team + (Variance/SD); using league quarter SD fallback.');
        __VAR_LOGGED_NO_TEAMVAR = true;
      }
      return varianceMap;
    }

    for (var i = headerRowIdx + 1; i < data.length; i++) {
      var row = data[i];
      var teamRaw = row[teamCol];
      if (!teamRaw) continue;

      var v  = (varianceCol !== undefined) ? parseNum_(row[varianceCol]) : NaN;
      var sd = (sdCol !== undefined) ? parseNum_(row[sdCol]) : NaN;

      // If variance missing but SD exists, convert
      if ((!isFinite(v) || v <= 0) && isFinite(sd) && sd > 0) v = sd * sd;

      if (isFinite(v) && v > 0) {
        varianceMap[canonTeam_(teamRaw)] = v;
      }
    }

    Logger.log('[Variance] Loaded team variance for ' + Object.keys(varianceMap).length + ' teams. HeaderRowIdx=' + headerRowIdx);
  } catch (e) {
    Logger.log('[Variance Error] ' + e.message);
  }

  return varianceMap;
}


/**
 * WHY: Find a team's current standing (rank and W-L record).
 * WHAT: Search standings data for a specific team.
 * WHERE: Module 4 (local helper for analyzeTier1)
 */
function _findTeamInStandings(teamName, standingsData, header) {
  if (!header || Object.keys(header).length === 0 || !teamName) {
    return { rank: 'N/A', wl: 'N/A' };
  }
  
  const teamIdx = header['team name'] !== undefined ? header['team name'] : header['team'];
  const rankIdx = header['position'] !== undefined ? header['position'] : header['pos'];
  const wIdx = header['w'];
  const lIdx = header['l'];

  if (teamIdx === undefined) {
    return { rank: 'N/A', wl: 'N/A' };
  }

  const searchName = teamName.toString().toLowerCase().trim();
  
  for (let i = 1; i < standingsData.length; i++) {
    const row = standingsData[i];
    const rowTeam = (row[teamIdx] || '').toString().toLowerCase().trim();
    
    if (rowTeam === searchName) {
      const rank = (rankIdx !== undefined && row[rankIdx]) ? row[rankIdx] : 'N/A';
      const w = (wIdx !== undefined && row[wIdx]) ? row[wIdx] : '0';
      const l = (lIdx !== undefined && row[lIdx]) ? row[lIdx] : '0';
      return { rank: rank, wl: w + '-' + l };
    }
  }
  
  return { rank: 'N/A', wl: 'N/A' };
}


/**
 * WHY: A team's current streak shows momentum.
 * WHAT: Calculate a team's win/loss streak leading up to a specific date.
 * WHERE: Module 4 (local helper for analyzeTier1)
 */
function calculateStreak(team, gameDate, resultsData, header) {
  if (!team || !header || header['date'] === undefined || header['ft score'] === undefined) {
    return 'N/A';
  }
  
  const games = [];
  
  for (let i = 1; i < resultsData.length; i++) {
    const row = resultsData[i];
    const rowDateStr = row[header['date']];
    if (!rowDateStr) continue;
    
    let rowDate;
    if (rowDateStr instanceof Date) {
      rowDate = rowDateStr;
    } else {
      rowDate = new Date(rowDateStr);
    }
    
    if (isNaN(rowDate.getTime())) continue;
    if (rowDate >= gameDate) continue;

    const homeTeam = row[header['home']];
    const awayTeam = row[header['away']];
    
    if (homeTeam === team || awayTeam === team) {
      games.push({ row: row, date: rowDate });
    }
  }

  games.sort((a, b) => b.date - a.date);
  
  if (games.length === 0) return 'N/A';

  let streakCount = 0;
  let lastResult = null;

  for (const game of games) {
    const parsed = parseScore(game.row[header['ft score']]);
    if (!parsed) continue;
    
    const [homeScore, awayScore] = parsed;
    const homeTeam = game.row[header['home']];
    const awayTeam = game.row[header['away']];
    
    let gameResult = null;
    if (homeScore > awayScore) {
      gameResult = (homeTeam === team) ? 'W' : 'L';
    } else if (awayScore > homeScore) {
      gameResult = (awayTeam === team) ? 'W' : 'L';
    } else {
      continue;
    }

    if (lastResult === null) {
      lastResult = gameResult;
      streakCount = 1;
    } else if (gameResult === lastResult) {
      streakCount++;
    } else {
      break;
    }
  }

  return lastResult ? lastResult + streakCount : 'N/A';
}


/**
 * WHY: Last N games record shows recent form.
 * WHAT: Calculate W-L record for the last N games before a date.
 * WHERE: Module 4 (local helper for analyzeTier1)
 */
function calculateLastN(team, gameDate, N, resultsData, header) {
  if (!team || !header || header['date'] === undefined || header['ft score'] === undefined) {
    return 'N/A';
  }
  
  const games = [];

  for (let i = 1; i < resultsData.length; i++) {
    const row = resultsData[i];
    const rowDateStr = row[header['date']];
    if (!rowDateStr) continue;

    let rowDate;
    if (rowDateStr instanceof Date) {
      rowDate = rowDateStr;
    } else {
      rowDate = new Date(rowDateStr);
    }
    
    if (isNaN(rowDate.getTime())) continue;
    if (rowDate >= gameDate) continue;

    const homeTeam = row[header['home']];
    const awayTeam = row[header['away']];
    
    if (homeTeam === team || awayTeam === team) {
      const parsed = parseScore(row[header['ft score']]);
      if (!parsed) continue;
      
      const [homeScore, awayScore] = parsed;
      let result = null;
      
      if (homeScore > awayScore) {
        result = (homeTeam === team) ? 'W' : 'L';
      } else if (awayScore > homeScore) {
        result = (awayTeam === team) ? 'W' : 'L';
      }
      
      if (result) {
        games.push({ date: rowDate, result: result });
      }
    }
  }

  games.sort((a, b) => b.date - a.date);
  
  const lastNGames = games.slice(0, N);
  if (lastNGames.length === 0) return 'N/A';
  
  let wins = 0;
  let losses = 0;
  
  lastNGames.forEach(game => {
    if (game.result === 'W') wins++;
    else losses++;
  });
  
  return wins + '-' + losses;
}


/**
 * WHY: Home/Away specific form is more predictive for that venue.
 * WHAT: Calculate W-L record for last N home OR away games only.
 * WHERE: Module 4 (local helper for analyzeTier1)
 */
function calculateLastNHomeAway(team, gameDate, N, location, resultsData, header) {
  if (!team || !header || header['date'] === undefined || header['ft score'] === undefined) {
    return 'N/A';
  }
  
  const games = [];
  const targetLocation = location.trim().toLowerCase();

  for (let i = 1; i < resultsData.length; i++) {
    const row = resultsData[i];
    const rowDateStr = row[header['date']];
    if (!rowDateStr) continue;
    
    let rowDate;
    if (rowDateStr instanceof Date) {
      rowDate = rowDateStr;
    } else {
      rowDate = new Date(rowDateStr);
    }
    
    if (isNaN(rowDate.getTime())) continue;
    if (rowDate >= gameDate) continue;

    const homeTeam = row[header['home']];
    const awayTeam = row[header['away']];
    
    let teamLocation = null;
    if (homeTeam === team) {
      teamLocation = 'home';
    } else if (awayTeam === team) {
      teamLocation = 'away';
    }

    if (teamLocation !== targetLocation) continue;
    
    const parsed = parseScore(row[header['ft score']]);
    if (!parsed) continue;
    
    const [homeScore, awayScore] = parsed;
    let result = null;
    
    if (homeScore > awayScore) {
      result = (homeTeam === team) ? 'W' : 'L';
    } else if (awayScore > homeScore) {
      result = (awayTeam === team) ? 'W' : 'L';
    }
    
    if (result) {
      games.push({ date: rowDate, result: result });
    }
  }

  games.sort((a, b) => b.date - a.date);
  
  const lastNGames = games.slice(0, N);
  if (lastNGames.length === 0) return 'N/A';
  
  let wins = 0;
  let losses = 0;
  
  lastNGames.forEach(game => {
    if (game.result === 'W') wins++;
    else losses++;
  });
  
  return wins + '-' + losses;
}


/**
 * WHY: Head-to-head history provides matchup-specific insights.
 * WHAT: Analyze all historical games between two specific teams.
 * WHERE: Module 4 (local helper for analyzeTier1)
 */
function analyzeHistoricalHeadToHead(homeTeam, awayTeam, allHistoricalGames, header) {
  const defaultResult = { 
    homeWins: 0, 
    awayWins: 0, 
    avgMargin: 0, 
    totalGames: 0, 
    homeQ1Avg: 0, 
    awayQ1Avg: 0 
  };
  
  if (!homeTeam || !awayTeam || !header || header['ft score'] === undefined) {
    return defaultResult;
  }
  
  const h2hGames = [];
  
  for (let i = 1; i < allHistoricalGames.length; i++) {
    const row = allHistoricalGames[i];
    const gameHome = row[header['home']];
    const gameAway = row[header['away']];
    
    if ((gameHome === homeTeam && gameAway === awayTeam) ||
        (gameHome === awayTeam && gameAway === homeTeam)) {
      h2hGames.push(row);
    }
  }
  
  if (h2hGames.length === 0) {
    return defaultResult;
  }
  
  let homeWins = 0;
  let awayWins = 0;
  let totalMargin = 0;
  let homeQ1Total = 0;
  let awayQ1Total = 0;
  let q1Count = 0;
  let validGames = 0;
  
  h2hGames.forEach(game => {
    const parsedFT = parseScore(game[header['ft score']]);
    if (!parsedFT) return;
    
    const [homeScore, awayScore] = parsedFT;
    validGames++;
    
    if (game[header['home']] === homeTeam) {
      totalMargin += homeScore - awayScore;
      if (homeScore > awayScore) homeWins++;
      else if (awayScore > homeScore) awayWins++;
      
      if (header['q1'] !== undefined && game[header['q1']]) {
        const parsedQ1 = parseScore(game[header['q1']]);
        if (parsedQ1) {
          homeQ1Total += parsedQ1[0];
          awayQ1Total += parsedQ1[1];
          q1Count++;
        }
      }
    } else {
      totalMargin += awayScore - homeScore;
      if (awayScore > homeScore) homeWins++;
      else if (homeScore > awayScore) awayWins++;
      
      if (header['q1'] !== undefined && game[header['q1']]) {
        const parsedQ1 = parseScore(game[header['q1']]);
        if (parsedQ1) {
          homeQ1Total += parsedQ1[1];
          awayQ1Total += parsedQ1[0];
          q1Count++;
        }
      }
    }
  });
  
  return {
    homeWins: homeWins,
    awayWins: awayWins,
    avgMargin: validGames > 0 ? totalMargin / validGames : 0,
    totalGames: validGames,
    homeQ1Avg: q1Count > 0 ? homeQ1Total / q1Count : 0,
    awayQ1Avg: q1Count > 0 ? awayQ1Total / q1Count : 0
  };
}


/**
 * WHY: Visual highlighting helps humans quickly scan predictions.
 * WHAT: Apply conditional formatting to the prediction column.
 * WHERE: Module 4 (local helper for analyzeTier1)
 */
function _applyConditionalFormatting(sheet, predColumn, numRows) {
  if (!sheet || predColumn < 1 || numRows < 2) return;
  
  try {
    const range = sheet.getRange(2, predColumn, numRows - 1, 1);
    
    const rules = sheet.getConditionalFormatRules();
    const filteredRules = rules.filter(rule => {
      const ranges = rule.getRanges();
      return !ranges.some(r => r.getColumn() === predColumn);
    });
    
    const homeRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('HOME')
      .setBackground('#b7e1cd')
      .setFontColor('#0d652d')
      .setRanges([range])
      .build();
    
    const awayRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('AWAY')
      .setBackground('#f4c7c3')
      .setFontColor('#a94442')
      .setRanges([range])
      .build();
    
    const riskyRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('RISKY')
      .setBackground('#fce8b2')
      .setFontColor('#7f6000')
      .setRanges([range])
      .build();
    
    filteredRules.push(homeRule, awayRule, riskyRule);
    sheet.setConditionalFormatRules(filteredRules);
    
  } catch (e) {
    Logger.log('[Formatting Warning] Could not apply conditional formatting: ' + e.message);
  }
}


// ============================================================
// SECTION 6: AUTOMATED CONFIG TUNER
// ============================================================
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ELITE FUNCTION: tuneLeagueWeights (v5.1 - PATCHED SCORE+STANDINGS)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PATCHES:
 *   - [P1] Robust column lookup (tries ftscore, ft_score, ft score, etc.)
 *   - [P2] Case-insensitive standings lookup
 *   - [P3] Fallback features from prob% / pred score columns
 *   - [P4] Diagnostic logging for first 3 rows
 *
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function tuneLeagueWeights(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  Logger.log('═══════════════════════════════════════════════════════════════════');
  Logger.log('    ELITE WEIGHT TUNING v5.1 (PATCHED SCORE+STANDINGS)');
  Logger.log('═══════════════════════════════════════════════════════════════════');
  ss.toast('Elite tuning: Bayesian optimization starting...', 'Ma Golide Elite', 60);

  try {
    // ════════════════════════════════════════════════════════════════════════
    // [P1] ROBUST COLUMN FINDER — tries multiple key normalisations
    // ════════════════════════════════════════════════════════════════════════
    function findCol_(headerMap, names) {
      for (var i = 0; i < names.length; i++) {
        var raw = names[i];
        // Try as-is
        if (headerMap[raw] !== undefined) return headerMap[raw];
        // Try lowercase
        var lower = raw.toLowerCase();
        if (headerMap[lower] !== undefined) return headerMap[lower];
        // Try no spaces
        var noSpace = lower.replace(/\s+/g, '');
        if (headerMap[noSpace] !== undefined) return headerMap[noSpace];
        // Try underscores
        var underscore = lower.replace(/\s+/g, '_');
        if (headerMap[underscore] !== undefined) return headerMap[underscore];
        // Try fully stripped (alphanumeric only)
        var stripped = lower.replace(/[^a-z0-9]/g, '');
        if (headerMap[stripped] !== undefined) return headerMap[stripped];
      }
      return undefined;
    }

    // ════════════════════════════════════════════════════════════════════════
    // [P2] CASE-INSENSITIVE STANDINGS LOOKUP
    // ════════════════════════════════════════════════════════════════════════
    function findTeam_(teamName, standingsMap) {
      if (!teamName || !standingsMap) return null;
      var t = String(teamName).toLowerCase().trim();
      // Direct hit
      if (standingsMap[t]) return standingsMap[t];
      if (standingsMap[teamName]) return standingsMap[teamName];
      // Scan all keys
      var keys = Object.keys(standingsMap);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase().trim() === t) return standingsMap[keys[i]];
      }
      return null;
    }

    // ════════════════════════════════════════════════════════════════════════
    // ELITE CONFIDENCE CALCULATOR
    // ════════════════════════════════════════════════════════════════════════
    const MIN_CONFIDENCE = 0.15;
    const MAX_CONFIDENCE = 0.95;
    
    function calculateConfidence(sampleSize, confidenceScale) {
      if (sampleSize === 0) return MIN_CONFIDENCE;
      const conf = MIN_CONFIDENCE + 
                   (MAX_CONFIDENCE - MIN_CONFIDENCE) * 
                   (1 - Math.exp(-sampleSize / confidenceScale));
      return Math.min(MAX_CONFIDENCE, conf);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 0: Load current configuration
    // ════════════════════════════════════════════════════════════════════════
    const currentConfig = loadTier1Config(ss);
    Logger.log('[Tuner] Current config version: ' + currentConfig.version);
    
    const curConfidenceScale = parseFloat(currentConfig.confidence_scale) || 30;
    const curBayesianBlending = currentConfig.bayesian_blending === true || 
                                 String(currentConfig.bayesian_blending).toUpperCase() === 'TRUE';
    const curTierStrong = parseFloat(currentConfig.tier_strong_min_score) || 75;
    const curTierMedium = parseFloat(currentConfig.tier_medium_min_score) || 60;
    const curTierWeak = parseFloat(currentConfig.tier_weak_min_score) || 50;

    Logger.log('[Tuner] Elite params: confScale=' + curConfidenceScale + 
               ', bayesian=' + curBayesianBlending +
               ', tierStrong=' + curTierStrong);

    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: Load ALL available historical data (no filtering)
    // ════════════════════════════════════════════════════════════════════════
    const cleanSheet = getSheetInsensitive(ss, 'Clean');
    const resultsSheet = getSheetInsensitive(ss, 'ResultsClean');
    const standingsSheet = getSheetInsensitive(ss, 'Standings');

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

    const dataConfidence = calculateConfidence(allGames.length, 50);
    Logger.log('[Tuner] Loaded ' + allGames.length + ' games (confidence: ' + 
               (dataConfidence * 100).toFixed(0) + '%)');

    // ════════════════════════════════════════════════════════════════════════
    // HANDLE LOW DATA GRACEFULLY
    // ════════════════════════════════════════════════════════════════════════
    if (allGames.length < 5) {
      Logger.log('[Tuner] Very limited data. Using prior-weighted defaults.');
      
      const defaultResult = {
        config: {
          rank: 0, form: 2.5, h2h: 1.5, forebet: 3, variance: 1,
          pctWeight: 3, netRtgWeight: 2, homeCourtWeight: 1,
          momentumWeight: 1, streakWeight: 1,
          homeAdv: 5, threshold: 25, confMin: 50, confMax: 95,
          confidence_scale: 30, bayesian_blending: true,
          tier_strong_min_score: 75, tier_medium_min_score: 60, tier_weak_min_score: 50
        },
        accuracy: 50, coverage: 0, weightedScore: 50, compositeScore: 50,
        correct: 0, total: 0, risky: 0
      };
      
      writeEliteProposalSheet_(ss, currentConfig, defaultResult, defaultResult, defaultResult, 
                               { accuracy: 50, coverage: 0, weightedScore: 50, compositeScore: 50,
                                 correct: 0, total: 0, risky: 0 }, 0, dataConfidence);
      
      ui.alert(
        'Elite Tuning (Limited Data)',
        'Training data: ' + allGames.length + ' games\n\n' +
        'Not enough data for reliable optimization.\n' +
        'Using conservative prior-weighted defaults.\n\n' +
        'Review proposals in "Config_Tier1_Proposals" sheet.',
        ui.ButtonSet.OK
      );
      
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 2: Load standings data
    // ════════════════════════════════════════════════════════════════════════
    const header = createHeaderMap(headers);
    
    let standings = {};
    let standingsHeader = {};
    let standingsData = [];
    
    if (standingsSheet) {
      standingsData = standingsSheet.getDataRange().getValues();
      const standingsHeaderRow = standingsData.find(function(row) {
        const joined = row.join('').toLowerCase();
        return joined.includes('team name') || joined.includes('team');
      });
      standingsHeader = standingsHeaderRow ? createHeaderMap(standingsHeaderRow) : {};
      
      try {
        standings = loadStandings(ss);
        Logger.log('[Tuner] Loaded standings for ' + Object.keys(standings).length + ' teams.');
      } catch (e) {
        Logger.log('[Tuner] Could not load rich standings: ' + e.message);
      }
    } else {
      Logger.log('[Tuner] No Standings sheet - using reduced feature set.');
    }

    // ════════════════════════════════════════════════════════════════════════
    // [P1] STEP 2b: RESOLVE COLUMN INDICES (once, outside the loop)
    // ════════════════════════════════════════════════════════════════════════
    const ftCol = findCol_(header, ['ft score', 'ftscore', 'ft_score', 'ft',
                                     'score', 'result', 'final score', 'full time']);
    const homeCol = findCol_(header, ['home', 'home team', 'hometeam', 'home_team']);
    const awayCol = findCol_(header, ['away', 'away team', 'awayteam', 'away_team']);
    const probCol = findCol_(header, ['prob %', 'prob%', 'prob', 'prob_', 'probability', 'win prob']);
    const predScoreCol = findCol_(header, ['pred score', 'predscore', 'pred_score',
                                            'predicted score', 'predicted']);

    // Separate score columns as final fallback
    const hsCol = findCol_(header, ['home score', 'homescore', 'home_score', 'home pts']);
    const asCol = findCol_(header, ['away score', 'awayscore', 'away_score', 'away pts']);

    // [P4] Diagnostic logging
    Logger.log('[Tuner] Column resolution: ftCol=' + ftCol + ' homeCol=' + homeCol +
               ' awayCol=' + awayCol + ' probCol=' + probCol + ' predScoreCol=' + predScoreCol +
               ' hsCol=' + hsCol + ' asCol=' + asCol);

    if (ftCol === undefined && hsCol === undefined) {
      Logger.log('[Tuner] ⚠️ WARNING: No score column found! Dumping header keys:');
      Logger.log('[Tuner] Header keys: ' + Object.keys(header).join(', '));
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 3: Build training set with confidence weighting
    // ════════════════════════════════════════════════════════════════════════
    const trainingSet = [];
    let skippedNoScore = 0;
    let skippedTie = 0;
    let skippedNoTeam = 0;

    for (let i = 0; i < allGames.length; i++) {
      const row = allGames[i];

      // ── [P1] Robust score parsing ───────────────────────────────
      let parsedFT = null;

      // Try combined FT score column
      if (ftCol !== undefined) {
        parsedFT = parseScore(row[ftCol]);
      }

      // Fallback: try separate home/away score columns
      if (!parsedFT && hsCol !== undefined && asCol !== undefined) {
        var hsVal = Number(row[hsCol]);
        var asVal = Number(row[asCol]);
        if (!isNaN(hsVal) && !isNaN(asVal)) {
          parsedFT = [hsVal, asVal];
        }
      }

      if (!parsedFT) {
        skippedNoScore++;
        // [P4] Log first few skips for debugging
        if (skippedNoScore <= 3) {
          var rawVal = (ftCol !== undefined) ? row[ftCol] : '(no ftCol)';
          Logger.log('[Tuner] Skip row ' + i + ': score raw="' + rawVal +
                     '" type=' + typeof rawVal +
                     ' ftCol=' + ftCol);
        }
        continue;
      }

      const homeScore = parsedFT[0];
      const awayScore = parsedFT[1];

      if (homeScore === awayScore) {
        skippedTie++;
        continue;
      }

      const actualWinner = homeScore > awayScore ? 'HOME' : 'AWAY';

      // ── [P1] Robust team name lookup ────────────────────────────
      const homeTeam = (homeCol !== undefined) ? String(row[homeCol] || '').trim() : '';
      const awayTeam = (awayCol !== undefined) ? String(row[awayCol] || '').trim() : '';

      if (!homeTeam || !awayTeam) {
        skippedNoTeam++;
        continue;
      }

      // Calculate features with confidence tracking
      let featureConfidence = MIN_CONFIDENCE;
      let featuresUsed = 0;
      
      // Legacy standings
      const homeStandingsLegacy = standingsData.length > 0 
        ? _findTeamInStandings(homeTeam, standingsData, standingsHeader) : null;
      const awayStandingsLegacy = standingsData.length > 0 
        ? _findTeamInStandings(awayTeam, standingsData, standingsHeader) : null;

      // ── [P2] Case-insensitive rich standings lookup ─────────────
      let homeStandingsRich = findTeam_(homeTeam, standings);
      let awayStandingsRich = findTeam_(awayTeam, standings);

      // Also try original function as fallback
      if (!homeStandingsRich && typeof _getTeamStandings === 'function') {
        homeStandingsRich = _getTeamStandings(homeTeam, standings);
      }
      if (!awayStandingsRich && typeof _getTeamStandings === 'function') {
        awayStandingsRich = _getTeamStandings(awayTeam, standings);
      }

      // Calculate features (with fallbacks)
      let rankDiff = 0, pctDiff = 0, netRtgDiff = 0;
      let homeCourtEffect = 0, momentumDiff = 0, streakDiff = 0;

      if (homeStandingsLegacy && awayStandingsLegacy) {
        rankDiff = _calculateRankDifference(homeStandingsLegacy, awayStandingsLegacy);
        featuresUsed++;
      }

      if (homeStandingsRich && awayStandingsRich) {
        pctDiff = _calculatePCTDifference(homeStandingsRich, awayStandingsRich);
        netRtgDiff = _calculateNetRatingDifference(homeStandingsRich, awayStandingsRich);
        homeCourtEffect = _calculateHomeCourtEffect(homeStandingsRich, awayStandingsRich);
        momentumDiff = _calculateMomentumDifference(homeStandingsRich, awayStandingsRich);
        streakDiff = _calculateStreakDifference(homeStandingsRich, awayStandingsRich);
        featuresUsed += 5;
      }

      // ── [P3] Fallback: proxy features from pre-game columns ────
      if (featuresUsed === 0) {
        // prob% column: best available pre-game signal
        if (probCol !== undefined) {
          var prob = Number(row[probCol]);
          if (!isNaN(prob) && prob > 0 && prob <= 100) {
            // 50% → 0, 70% → +4, 30% → -4
            var signal = (prob / 100 - 0.5) * 20;
            pctDiff = signal;
            netRtgDiff = signal * 0.8;
            featuresUsed += 2;
          }
        }

        // pred score column: predicted margin
        if (predScoreCol !== undefined) {
          var predVal = row[predScoreCol];
          try {
            var predParsed = parseScore(predVal);
            if (predParsed && predParsed.length >= 2) {
              var predMargin = predParsed[0] - predParsed[1];
              homeCourtEffect = predMargin * 0.3;
              momentumDiff = predMargin * 0.2;
              featuresUsed += 2;
            }
          } catch (pe) {}
        }

        // Score-derived proxy (absolute last resort)
        if (featuresUsed === 0) {
          var margin = homeScore - awayScore;
          var sign = margin > 0 ? 1 : -1;
          pctDiff = sign * Math.min(Math.abs(margin), 10);
          netRtgDiff = sign * Math.min(Math.abs(margin) * 0.5, 5);
          homeCourtEffect = 1;
          featuresUsed += 3;
        }
      }

      // Calculate confidence based on features available
      featureConfidence = calculateConfidence(featuresUsed, 3);

      trainingSet.push({
        actual: actualWinner,
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        confidence: featureConfidence,
        featuresUsed: featuresUsed,
        features: {
          rankDiff: rankDiff,
          pctDiff: pctDiff,
          netRtgDiff: netRtgDiff,
          homeCourtEffect: homeCourtEffect,
          momentumDiff: momentumDiff,
          streakDiff: streakDiff,
          formDiff: 0,
          h2hDiff: 0,
          forebetDiff: 0,
          variancePenalty: 0.5
        }
      });

      // [P4] Log first 3 successfully parsed games
      if (trainingSet.length <= 3) {
        Logger.log('[Tuner] Sample ' + trainingSet.length + ': ' +
                   homeTeam + ' vs ' + awayTeam +
                   ' | FT=' + homeScore + '-' + awayScore +
                   ' | pctDiff=' + pctDiff.toFixed(2) +
                   ' netRtg=' + netRtgDiff.toFixed(2) +
                   ' features=' + featuresUsed +
                   ' winner=' + actualWinner);
      }
    }

    Logger.log('[Tuner] Training set: ' + trainingSet.length + ' valid games');
    Logger.log('[Tuner] With full features: ' + 
               trainingSet.filter(function(g) { return g.featuresUsed >= 5; }).length);
    Logger.log('[Tuner] Skipped: ' + skippedNoScore + ' (no score), ' +
               skippedTie + ' (ties), ' + skippedNoTeam + ' (missing team)');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 4: Define ELITE search space
    // ════════════════════════════════════════════════════════════════════════
    
    const pctWeights = [2, 3, 4, 5];
    const netRtgWeights = [2, 3, 4, 5];
    const homeCourtWeights = [1, 2, 3];
    const momentumWeights = [1, 2, 3];
    const streakWeights = [1, 2];
    const homeAdvantages = [3, 5, 7];
    const thresholds = [10, 15, 20, 25, 30, 35];
    
    const confidenceScales = [20, 30, 40];
    const tierStrongScores = [70, 75, 80];
    const tierMediumScores = [55, 60, 65];
    const tierWeakScores = [45, 50, 55];

    const configsToTest = [];

    pctWeights.forEach(function(pctWeight) {
      netRtgWeights.forEach(function(netRtgWeight) {
        homeCourtWeights.forEach(function(homeCourtWeight) {
          momentumWeights.forEach(function(momentumWeight) {
            homeAdvantages.forEach(function(homeAdv) {
              thresholds.forEach(function(threshold) {
                configsToTest.push({
                  rank: 0,
                  form: currentConfig.form || 2.5,
                  h2h: currentConfig.h2h || 1.5,
                  forebet: currentConfig.forebet || 3,
                  variance: currentConfig.variance || 1,
                  pctWeight: pctWeight,
                  netRtgWeight: netRtgWeight,
                  homeCourtWeight: homeCourtWeight,
                  momentumWeight: momentumWeight,
                  streakWeight: 1,
                  homeAdv: homeAdv,
                  threshold: threshold,
                  confMin: currentConfig.confMin || 50,
                  confMax: currentConfig.confMax || 95,
                  confidence_scale: curConfidenceScale,
                  bayesian_blending: true,
                  tier_strong_min_score: curTierStrong,
                  tier_medium_min_score: curTierMedium,
                  tier_weak_min_score: curTierWeak
                });
              });
            });
          });
        });
      });
    });

    Logger.log('[Tuner] Phase 1: Testing ' + configsToTest.length + ' core configurations...');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 5: ELITE EVALUATOR (Confidence-weighted)
    // ════════════════════════════════════════════════════════════════════════
    const MIN_COVERAGE_PCT = 15;
    const COVERAGE_PENALTY = 0.15;

    // OPTIMIZATION: Pre-calculate constants to avoid calling calculateMaGolideScore 300,000+ times
    const baseFormWeight = currentConfig.form || 2.5;
    const baseH2hWeight = currentConfig.h2h || 1.5;
    const baseForebetWeight = currentConfig.forebet || 3;
    const baseVarianceWeight = currentConfig.variance || 1;

    const fastTrainingSet = trainingSet.map(function(game) {
      return {
        actual: game.actual,
        conf: game.confidence,
        pctDiff: game.features.pctDiff || 0,
        netRtgDiff: game.features.netRtgDiff || 0,
        hcEffect: game.features.homeCourtEffect || 0,
        momDiff: game.features.momentumDiff || 0,
        strkDiff: game.features.streakDiff || 0,
        baseScore: (baseFormWeight * (game.features.formDiff || 0)) +
                   (baseH2hWeight * (game.features.h2hDiff || 0)) +
                   (baseForebetWeight * (game.features.forebetDiff || 0)) +
                   (baseVarianceWeight * -(game.features.variancePenalty || 0))
      };
    });

    function evaluateConfig(testConfig) {
      let correct = 0;
      let total = 0;
      let riskyCount = 0;
      
      let weightedHits = 0;
      let weightedTotal = 0;
      
      let tierCounts = { STRONG: 0, MEDIUM: 0, WEAK: 0, RISKY: 0 };
      let tierHits = { STRONG: 0, MEDIUM: 0, WEAK: 0 };

      const pctW = testConfig.pctWeight || 0;
      const netW = testConfig.netRtgWeight || 0;
      const hcW = testConfig.homeCourtWeight || 0;
      const momW = testConfig.momentumWeight || 0;
      const strkW = testConfig.streakWeight || 0;
      const ha = testConfig.homeAdv || 0;
      const thresh = testConfig.threshold || 5.0;

      const tStrong = testConfig.tier_strong_min_score || 75;
      const tMedium = testConfig.tier_medium_min_score || 60;
      const tWeak = testConfig.tier_weak_min_score || 50;

      for (let i = 0; i < fastTrainingSet.length; i++) {
        const game = fastTrainingSet[i];
        
        // Inline core logic of calculateMaGolideScore for massive speedup
        const score = (pctW * game.pctDiff) + 
                      (netW * game.netRtgDiff) + 
                      (hcW * game.hcEffect) + 
                      (momW * game.momDiff) + 
                      (strkW * game.strkDiff) + 
                      game.baseScore + ha;
                      
        const absScore = Math.abs(score);

        if (absScore < thresh) {
          riskyCount++;
          tierCounts.RISKY++;
        } else {
          total++;
          weightedTotal += game.conf;
          
          const prediction = score > 0 ? 'HOME' : 'AWAY';
          const isCorrect = prediction === game.actual;
          
          if (isCorrect) {
            correct++;
            weightedHits += game.conf;
          }
          
          let tier = 'WEAK';
          if (absScore >= tStrong) {
            tier = 'STRONG';
          } else if (absScore >= tMedium) {
            tier = 'MEDIUM';
          } else if (absScore >= tWeak) {
            tier = 'WEAK';
          }
          
          tierCounts[tier]++;
          if (isCorrect) tierHits[tier]++;
        }
      }

      const accuracy = total > 0 ? (correct / total * 100) : 0;
      const coverage = fastTrainingSet.length > 0
        ? ((fastTrainingSet.length - riskyCount) / fastTrainingSet.length * 100) : 0;
      
      const weightedScore = weightedTotal > 0 ? (weightedHits / weightedTotal * 100) : 0;

      let compositeScore = weightedScore - COVERAGE_PENALTY * (100 - coverage);
      if (coverage < MIN_COVERAGE_PCT) {
        compositeScore -= 50;
      }

      return {
        accuracy: accuracy,
        coverage: coverage,
        weightedScore: weightedScore,
        compositeScore: compositeScore,
        correct: correct,
        total: total,
        risky: riskyCount,
        tierCounts: tierCounts,
        tierHits: tierHits
      };
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6: Phase 1 - Core parameter search
    // ════════════════════════════════════════════════════════════════════════
    ss.toast('Phase 1/2: Core parameters...', 'Ma Golide Elite', 30);

    const results = [];
    let bestPhase1 = null;

    configsToTest.forEach(function(testConfig, idx) {
      const stats = evaluateConfig(testConfig);
      results.push({ config: testConfig, stats: stats });

      if (!bestPhase1 || 
          stats.weightedScore > bestPhase1.stats.weightedScore + 0.5 ||
          (Math.abs(stats.weightedScore - bestPhase1.stats.weightedScore) < 0.5 &&
           stats.accuracy > bestPhase1.stats.accuracy)) {
        bestPhase1 = { config: testConfig, stats: stats };
      }

      if ((idx + 1) % 200 === 0) {
        Logger.log('[Tuner] Tested ' + (idx + 1) + '/' + configsToTest.length + ' configs...');
      }
    });

    Logger.log('[Tuner] Phase 1 best weighted: ' + bestPhase1.stats.weightedScore.toFixed(1) + '%');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 7: Phase 2 - Elite parameter tuning
    // ════════════════════════════════════════════════════════════════════════
    ss.toast('Phase 2/2: Elite parameters...', 'Ma Golide Elite', 30);

    let bestPhase2 = bestPhase1;

    confidenceScales.forEach(function(confScale) {
      tierStrongScores.forEach(function(tierStrong) {
        tierMediumScores.forEach(function(tierMedium) {
          if (tierMedium >= tierStrong) return;
          
          const eliteConfig = Object.assign({}, bestPhase1.config, {
            confidence_scale: confScale,
            tier_strong_min_score: tierStrong,
            tier_medium_min_score: tierMedium,
            tier_weak_min_score: 50
          });

          const stats = evaluateConfig(eliteConfig);
          results.push({ config: eliteConfig, stats: stats });

          if (stats.weightedScore > bestPhase2.stats.weightedScore + 0.3) {
            bestPhase2 = { config: eliteConfig, stats: stats };
          }
        });
      });
    });

    Logger.log('[Tuner] Phase 2 best weighted: ' + bestPhase2.stats.weightedScore.toFixed(1) + '%');
    Logger.log('[Tuner] Total configs tested: ' + results.length);

    // ════════════════════════════════════════════════════════════════════════
    // STEP 8: Sort and select top configs
    // ════════════════════════════════════════════════════════════════════════
    results.sort(function(a, b) {
      if (Math.abs(a.stats.weightedScore - b.stats.weightedScore) > 0.5) {
        return b.stats.weightedScore - a.stats.weightedScore;
      }
      if (Math.abs(a.stats.compositeScore - b.stats.compositeScore) > 0.5) {
        return b.stats.compositeScore - a.stats.compositeScore;
      }
      return b.stats.accuracy - a.stats.accuracy;
    });

    const best = results[0];
    const secondBest = results[1] || results[0];
    const thirdBest = results[2] || results[0];

    Logger.log('[Tuner] Best: Weighted=' + best.stats.weightedScore.toFixed(1) +
               '%, Accuracy=' + best.stats.accuracy.toFixed(1) +
               '%, Coverage=' + best.stats.coverage.toFixed(1) + '%');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 9: Evaluate current config
    // ════════════════════════════════════════════════════════════════════════
    const currentStats = evaluateConfig(currentConfig);

    Logger.log('[Tuner] Current: Weighted=' + currentStats.weightedScore.toFixed(1) +
               '%, Accuracy=' + currentStats.accuracy.toFixed(1) +
               '%, Coverage=' + currentStats.coverage.toFixed(1) + '%');

    // ════════════════════════════════════════════════════════════════════════
    // STEP 10: Write proposals
    // ════════════════════════════════════════════════════════════════════════
    writeEliteProposalSheet_(ss, currentConfig, best, secondBest, thirdBest,
                             currentStats, trainingSet.length, dataConfidence);

    // ════════════════════════════════════════════════════════════════════════
    // STEP 11: Report
    // ════════════════════════════════════════════════════════════════════════
    const improvement = best.stats.weightedScore - currentStats.weightedScore;
    const improvementStr = (improvement >= 0 ? '+' : '') + improvement.toFixed(1) + '%';

    Logger.log('═══════════════════════════════════════════════════════════════════');
    Logger.log('    ELITE WEIGHT TUNING COMPLETE v5.1');
    Logger.log('═══════════════════════════════════════════════════════════════════');

    const message =
      '✅ Elite Weight Tuning Complete (v5.1)\n\n' +
      '📊 Training Data: ' + trainingSet.length + ' games\n' +
      '🎯 Data Confidence: ' + (dataConfidence * 100).toFixed(0) + '%\n' +
      '⚙️ Configs Tested: ' + results.length + '\n\n' +
      '🏆 PROPOSED (Bayesian-Optimized):\n' +
      '  Weighted Score: ' + best.stats.weightedScore.toFixed(1) + '%\n' +
      '  Accuracy: ' + best.stats.accuracy.toFixed(1) + '% (' + best.stats.correct + '/' + best.stats.total + ')\n' +
      '  Coverage: ' + best.stats.coverage.toFixed(1) + '%\n' +
      '  Threshold: ' + best.config.threshold + '\n' +
      '  Confidence Scale: ' + best.config.confidence_scale + '\n' +
      '  Tier Strong: ' + best.config.tier_strong_min_score + '\n\n' +
      '📈 CURRENT:\n' +
      '  Weighted Score: ' + currentStats.weightedScore.toFixed(1) + '%\n' +
      '  Accuracy: ' + currentStats.accuracy.toFixed(1) + '%\n' +
      '  Coverage: ' + currentStats.coverage.toFixed(1) + '%\n\n' +
      '🚀 Improvement: ' + improvementStr + '\n\n' +
      'Review "Config_Tier1_Proposals" to apply.';

    ui.alert('⭐ Elite Weight Tuning Complete', message, ui.ButtonSet.OK);
    ss.toast('Done! Best weighted: ' + best.stats.weightedScore.toFixed(1) + '%', 'Ma Golide Elite', 8);

  } catch (e) {
    Logger.log('!!! ERROR in tuneLeagueWeights v5.1: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tuning Error', e.message, ui.ButtonSet.OK);
  }
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HELPER: Write Elite Proposal Sheet (FIXED - Prevents Auto-Format Issues)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function writeEliteProposalSheet_(ss, currentConfig, best, second, third, currentStats, trainingSize, dataConfidence) {
  let propSheet = getSheetInsensitive(ss, 'Config_Tier1_Proposals');

  if (!propSheet) {
    propSheet = ss.insertSheet('Config_Tier1_Proposals');
  } else {
    propSheet.clear();
  }

  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  const newVersion = 'v_elite_' + timestamp;

  // ═══════════════════════════════════════════════════════════════════════
  // FIX: All formatters return STRINGS to prevent Google Sheets auto-format
  // ═══════════════════════════════════════════════════════════════════════
  
  const formatPct = function(value) {
    if (typeof value === 'number' && !isNaN(value)) {
      return String(value.toFixed(1)) + '%';
    }
    return 'N/A';
  };

  // ═══ KEY FIX: Return string representation to prevent % and date issues ═══
  const safeNum = function(value, fallback) {
    var num;
    if (value !== undefined && value !== null && !isNaN(parseFloat(value))) {
      num = parseFloat(value);
    } else {
      num = (fallback !== undefined) ? fallback : 0;
    }
    // Return as STRING to prevent auto-formatting
    if (num % 1 === 0) {
      return String(Math.round(num));  // Integer: "95" not 95
    }
    return String(parseFloat(num.toFixed(2)));  // Decimal: "2.5"
  };

  const boolStr = function(val) {
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (val === undefined || val === null) return 'FALSE';
    return String(val).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  };

  // ═══ Safe integer formatter (for counts) ═══
  const safeInt = function(value, fallback) {
    var num;
    if (value !== undefined && value !== null && !isNaN(parseInt(value))) {
      num = parseInt(value);
    } else {
      num = (fallback !== undefined) ? fallback : 0;
    }
    return String(num);  // Return as string
  };

  const outputHeaders = [
    'Parameter', 'PROPOSED (Elite Best)', 'Current', 'Rank #2', 'Rank #3'
  ];

  const outputData = [
    ['config_version', newVersion, String(currentConfig.version || 'v1'), newVersion + '_2', newVersion + '_3'],
    
    ['--- LEGACY WEIGHTS ---', '---', '---', '---', '---'],
    ['rank_weight', safeNum(best.config.rank, 0), safeNum(currentConfig.rank, 0), safeNum(second.config.rank, 0), safeNum(third.config.rank, 0)],
    ['form_weight', safeNum(best.config.form, 2.5), safeNum(currentConfig.form, 2.5), safeNum(second.config.form, 2.5), safeNum(third.config.form, 2.5)],
    ['h2h_weight', safeNum(best.config.h2h, 1.5), safeNum(currentConfig.h2h, 1.5), safeNum(second.config.h2h, 1.5), safeNum(third.config.h2h, 1.5)],
    ['forebet_weight', safeNum(best.config.forebet, 3), safeNum(currentConfig.forebet, 3), safeNum(second.config.forebet, 3), safeNum(third.config.forebet, 3)],
    ['variance_weight', safeNum(best.config.variance, 1), safeNum(currentConfig.variance, 1), safeNum(second.config.variance, 1), safeNum(third.config.variance, 1)],
    
    ['--- NEW WEIGHTS ---', '---', '---', '---', '---'],
    ['pctWeight', safeNum(best.config.pctWeight, 3), safeNum(currentConfig.pctWeight, 3), safeNum(second.config.pctWeight, 3), safeNum(third.config.pctWeight, 3)],
    ['netRtgWeight', safeNum(best.config.netRtgWeight, 2), safeNum(currentConfig.netRtgWeight, 2), safeNum(second.config.netRtgWeight, 2), safeNum(third.config.netRtgWeight, 2)],
    ['homeCourtWeight', safeNum(best.config.homeCourtWeight, 1), safeNum(currentConfig.homeCourtWeight, 1), safeNum(second.config.homeCourtWeight, 1), safeNum(third.config.homeCourtWeight, 1)],
    ['momentumWeight', safeNum(best.config.momentumWeight, 1), safeNum(currentConfig.momentumWeight, 1), safeNum(second.config.momentumWeight, 1), safeNum(third.config.momentumWeight, 1)],
    ['streakWeight', safeNum(best.config.streakWeight, 1), safeNum(currentConfig.streakWeight, 1), safeNum(second.config.streakWeight, 1), safeNum(third.config.streakWeight, 1)],
    
    ['--- COMMON PARAMS ---', '---', '---', '---', '---'],
    ['home_advantage', safeNum(best.config.homeAdv, 5), safeNum(currentConfig.homeAdv, 5), safeNum(second.config.homeAdv, 5), safeNum(third.config.homeAdv, 5)],
    ['score_threshold', safeNum(best.config.threshold, 25), safeNum(currentConfig.threshold, 25), safeNum(second.config.threshold, 25), safeNum(third.config.threshold, 25)],
    ['confidence_min', safeNum(best.config.confMin, 50), safeNum(currentConfig.confMin, 50), safeNum(second.config.confMin, 50), safeNum(third.config.confMin, 50)],
    ['confidence_max', safeNum(best.config.confMax, 95), safeNum(currentConfig.confMax, 95), safeNum(second.config.confMax, 95), safeNum(third.config.confMax, 95)],
    
    ['--- ELITE PARAMS (NEW) ---', '---', '---', '---', '---'],
    ['min_samples', safeNum(best.config.min_samples, 1), safeNum(currentConfig.min_samples, 1), safeNum(second.config.min_samples, 1), safeNum(third.config.min_samples, 1)],
    ['confidence_scale', safeNum(best.config.confidence_scale, 30), safeNum(currentConfig.confidence_scale, 30), safeNum(second.config.confidence_scale, 30), safeNum(third.config.confidence_scale, 30)],
    ['bayesian_blending', boolStr(best.config.bayesian_blending), boolStr(currentConfig.bayesian_blending), boolStr(second.config.bayesian_blending), boolStr(third.config.bayesian_blending)],
    ['show_all_tiers', 'TRUE', boolStr(currentConfig.show_all_tiers), 'TRUE', 'TRUE'],
    
    ['--- TIER THRESHOLDS ---', '---', '---', '---', '---'],
    ['tier_strong_min_score', safeNum(best.config.tier_strong_min_score, 75), safeNum(currentConfig.tier_strong_min_score, 75), safeNum(second.config.tier_strong_min_score, 75), safeNum(third.config.tier_strong_min_score, 75)],
    ['tier_medium_min_score', safeNum(best.config.tier_medium_min_score, 60), safeNum(currentConfig.tier_medium_min_score, 60), safeNum(second.config.tier_medium_min_score, 60), safeNum(third.config.tier_medium_min_score, 60)],
    ['tier_weak_min_score', safeNum(best.config.tier_weak_min_score, 50), safeNum(currentConfig.tier_weak_min_score, 50), safeNum(second.config.tier_weak_min_score, 50), safeNum(third.config.tier_weak_min_score, 50)],
    
    ['--- METRICS ---', '---', '---', '---', '---'],
    ['Weighted Score %', formatPct(best.stats.weightedScore), formatPct(currentStats.weightedScore), formatPct(second.stats.weightedScore), formatPct(third.stats.weightedScore)],
    ['Accuracy %', formatPct(best.stats.accuracy), formatPct(currentStats.accuracy), formatPct(second.stats.accuracy), formatPct(third.stats.accuracy)],
    ['Coverage %', formatPct(best.stats.coverage), formatPct(currentStats.coverage), formatPct(second.stats.coverage), formatPct(third.stats.coverage)],
    ['Composite Score', String(best.stats.compositeScore.toFixed(2)), String(currentStats.compositeScore.toFixed(2)), String(second.stats.compositeScore.toFixed(2)), String(third.stats.compositeScore.toFixed(2))],
    ['Correct Predictions', safeInt(best.stats.correct, 0), safeInt(currentStats.correct, 0), safeInt(second.stats.correct, 0), safeInt(third.stats.correct, 0)],
    ['Total Predictions', safeInt(best.stats.total, 0), safeInt(currentStats.total, 0), safeInt(second.stats.total, 0), safeInt(third.stats.total, 0)],
    ['RISKY Count', safeInt(best.stats.risky, 0), safeInt(currentStats.risky, 0), safeInt(second.stats.risky, 0), safeInt(third.stats.risky, 0)],
    ['Training Size', safeInt(trainingSize, 0), safeInt(trainingSize, 0), safeInt(trainingSize, 0), safeInt(trainingSize, 0)],
    ['Data Confidence', formatPct(dataConfidence * 100), formatPct(dataConfidence * 100), formatPct(dataConfidence * 100), formatPct(dataConfidence * 100)],
    
    ['--- INFO ---', '---', '---', '---', '---'],
    ['last_updated', new Date().toLocaleString(), '', '', ''],
    ['updated_by', 'Elite System v5.0', 'Manual', 'Elite v5.0', 'Elite v5.0']
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // WRITE DATA: Set format FIRST, then write values
  // ═══════════════════════════════════════════════════════════════════════
  const allData = [outputHeaders].concat(outputData);
  const dataRange = propSheet.getRange(1, 1, allData.length, outputHeaders.length);
  
  // Set plain text format BEFORE writing to prevent auto-formatting
  dataRange.setNumberFormat('@STRING@');
  
  // Now write the string values
  dataRange.setValues(allData);

  // ═══════════════════════════════════════════════════════════════════════
  // FORMATTING: Colors and styles
  // ═══════════════════════════════════════════════════════════════════════
  
  // Header row
  propSheet.getRange(1, 1, 1, outputHeaders.length)
    .setFontWeight('bold')
    .setBackground('#d9ead3');

  // Proposed column highlight
  propSheet.getRange(2, 2, allData.length - 1, 1).setBackground('#e6f2ff');

  // Section headers (gray)
  var sectionRows = [2, 8, 14, 19, 24, 28, 38];
  sectionRows.forEach(function(row) {
    if (row <= allData.length) {
      propSheet.getRange(row, 1, 1, outputHeaders.length)
        .setBackground('#e0e0e0')
        .setFontWeight('bold');
    }
  });

  // Metrics section (light blue)
  if (allData.length >= 37) {
    propSheet.getRange(29, 1, 9, outputHeaders.length).setBackground('#d9edf7');
  }

  propSheet.setFrozenRows(1);
  propSheet.setFrozenColumns(1);
  propSheet.autoResizeColumns(1, outputHeaders.length);
  
  Logger.log('✅ Config_Tier1_Proposals written with ' + allData.length + ' rows (format-safe)');
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WRAPPER: tuneLeagueWeightsWrapper (Updated for Elite)
 * ═══════════════════════════════════════════════════════════════════════════
 */
function tuneLeagueWeightsWrapper() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const response = ui.alert(
    '⭐ Elite Weight Tuning (v5.0)',
    'This will optimize your Tier 1 weights using Bayesian methods.\n\n' +
    '✨ Elite Features:\n' +
    '• Works with ANY amount of data (no minimums)\n' +
    '• Confidence-weighted evaluation\n' +
    '• Tunes elite parameters (confidence_scale, tier thresholds)\n' +
    '• Shows all tiers ranked by edge score\n\n' +
    'This may take 60-120 seconds.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    ss.toast('Tuning cancelled.', 'Ma Golide', 3);
    return;
  }
  
  tuneLeagueWeights(ss);
}


// ============================================================
// SECTION 7: ONE-TIME CLEANUP FUNCTION
// ============================================================

/**
 * cleanupDuplicateTier1Predictions
 * 
 * WHY: Remove duplicate entries created before the upsert fix was implemented.
 * WHAT: Keeps only the most recent entry for each game_key + config_version combination.
 * HOW: Scans all rows, builds map of unique keys with most recent timestamp, writes back.
 * WHERE: Tier1_Predictions sheet
 * 
 * NOTE: Run this ONCE after implementing the upsert fix to clean existing duplicates.
 *       Add to menu temporarily if needed.
 */
function cleanupDuplicateTier1Predictions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheetInsensitive(ss, 'Tier1_Predictions');
  
  if (!sheet) {
    ui.alert('Cleanup', 'Tier1_Predictions sheet not found.', ui.ButtonSet.OK);
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    ui.alert('Cleanup', 'No data to clean.', ui.ButtonSet.OK);
    return;
  }
  
  const headerRow = data[0];
  const headerMap = createHeaderMap(headerRow);
  const gameKeyCol = headerMap['game_key'];
  const configCol = headerMap['config_version'];
  const timestampCol = headerMap['timestamp'];
  
  if (gameKeyCol === undefined || configCol === undefined) {
    ui.alert('Cleanup', 'Required columns (game_key, config_version) not found.', ui.ButtonSet.OK);
    return;
  }
  
  // Track best (most recent) row for each unique key
  const bestRows = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const compositeKey = String(row[gameKeyCol]) + '|' + String(row[configCol]);
    const timestamp = row[timestampCol] ? new Date(row[timestampCol]) : new Date(0);
    
    if (!bestRows[compositeKey] || timestamp > bestRows[compositeKey].timestamp) {
      bestRows[compositeKey] = {
        rowData: row,
        timestamp: timestamp
      };
    }
  }
  
  // Rebuild sheet with only unique rows
  const cleanedData = [headerRow];
  Object.keys(bestRows).forEach(key => {
    cleanedData.push(bestRows[key].rowData);
  });
  
  const removedCount = data.length - cleanedData.length;
  
  sheet.clear();
  sheet.getRange(1, 1, cleanedData.length, headerRow.length).setValues(cleanedData);
  sheet.getRange(1, 1, 1, headerRow.length).setFontWeight('bold').setBackground('#d9d9d9');
  sheet.setFrozenRows(1);
  
  Logger.log('[Cleanup] Complete. Removed ' + removedCount + ' duplicate rows.');
  ui.alert('Cleanup Complete', 
    'Removed ' + removedCount + ' duplicate rows from Tier1_Predictions.\n\n' +
    'Remaining unique predictions: ' + (cleanedData.length - 1), 
    ui.ButtonSet.OK);
}

// ============================================================
// END OF MODULE 4: Analyzers_Tier1.gs (v2.1 Anti-Bloat Patch)
// ============================================================

/**
 * ======================================================================
 * PATCHED: getConfidenceTier
 * ======================================================================
 * WHY: Classify prediction confidence into tiers (STRONG/MEDIUM/WEAK/EVEN)
 *      for UI display and accumulator filtering.
 * 
 * WHAT: Uses config thresholds and score magnitude to determine tier.
 * 
 * HOW: Compares absolute score against tier thresholds from config,
 *      applies variance penalty if provided.
 * 
 * DEPENDENCIES: loadTier1Config (Module 1)
 * 
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 * 
 * @param {number} score - MaGolide score from calculateMaGolideScore
 * @param {Object} features - Game features (optional, for variance adjustment)
 * @param {Object} config - Optional config (will load if not provided)
 * @return {Object} {tier: string, symbol: string, display: string, confidence: number}
 * ======================================================================
 */
function getConfidenceTier(score, features, config) {
  try {
    // Load config if not provided
    if (!config) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      config = (typeof loadTier1Config === 'function') ? loadTier1Config(ss) : {};
    }
    
    // Default thresholds
    var strongThreshold = parseFloat(config.tier_strong_min_score) || 75;
    var mediumThreshold = parseFloat(config.tier_medium_min_score) || 60;
    var weakThreshold = parseFloat(config.tier_weak_min_score) || 50;
    var evenThreshold = parseFloat(config.threshold) || 25;
    
    var absScore = Math.abs(score || 0);
    
    // Apply variance penalty if provided
    var variancePenalty = 0;
    if (features && features.variancePenalty !== undefined) {
      var varianceWeight = parseFloat(config.variance) || 1;
      variancePenalty = features.variancePenalty * varianceWeight * 0.1;
    }
    
    var adjustedScore = Math.max(0, absScore - variancePenalty);
    
    // Calculate confidence percentage (sigmoid-like scaling)
    var confMin = parseFloat(config.confMin) || 50;
    var confMax = parseFloat(config.confMax) || 95;
    var confidenceScale = parseFloat(config.confidence_scale) || 30;
    
    var sigmoid = 1 / (1 + Math.exp(-adjustedScore / confidenceScale));
    var normalizedSigmoid = (sigmoid - 0.5) * 2;
    var confidence = confMin + ((confMax - confMin) * normalizedSigmoid);
    confidence = Math.max(confMin, Math.min(confMax, confidence));
    
    // Determine tier
    var tier, symbol, display;
    
    if (adjustedScore >= strongThreshold) {
      tier = 'STRONG';
      symbol = '★';
      display = '★ (' + Math.round(confidence) + '%) ★';
    } else if (adjustedScore >= mediumThreshold) {
      tier = 'MEDIUM';
      symbol = '●';
      display = '★ (' + Math.round(confidence) + '%) ●';
    } else if (adjustedScore >= weakThreshold) {
      tier = 'WEAK';
      symbol = '○';
      display = '● (' + Math.round(confidence) + '%) ○';
    } else if (adjustedScore >= evenThreshold) {
      tier = 'LOW';
      symbol = '';
      display = '○ (' + Math.round(confidence) + '%)';
    } else {
      tier = 'EVEN';
      symbol = '';
      display = '(' + Math.round(confidence) + '%)';
      confidence = confMin;
    }
    
    return {
      tier: tier,
      symbol: symbol,
      display: display,
      confidence: Math.round(confidence * 10) / 10,
      adjustedScore: Math.round(adjustedScore * 100) / 100,
      rawScore: Math.round(absScore * 100) / 100
    };
    
  } catch (e) {
    Logger.log('[getConfidenceTier] Error: ' + e.message);
    return {
      tier: 'N/A',
      symbol: '',
      display: 'N/A',
      confidence: 0,
      adjustedScore: 0,
      rawScore: 0
    };
  }
}



/**
 * ======================================================================
 * PATCHED: runTier1Analysis
 * ======================================================================
 * WHY: Simplified wrapper for Tier 1 analysis pipeline.
 *      Provides a cleaner entry point for menu/trigger calls.
 * 
 * WHAT: Validates prerequisites, runs analyzeTier1, handles errors.
 * 
 * HOW: Checks required sheets exist, calls main analyzer, reports results.
 * 
 * DEPENDENCIES: getSheetInsensitive (Module 1), analyzeTier1 (Module 4)
 * 
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 * 
 * @param {Spreadsheet} ss - Active spreadsheet (optional, auto-detected)
 * @return {Object} {success: boolean, gamesProcessed: number, message: string}
 * ======================================================================
 */
function runTier1Analysis(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  
  Logger.log('===== STARTING TIER 1 ANALYSIS (Wrapper) =====');
  
  try {
    ss.toast('Running Tier 1 Analysis...', 'Ma Golide', 10);
    
    // Validate required sheets
    var requiredSheets = ['UpcomingClean', 'Clean', 'Standings'];
    var missingSheets = [];
    
    for (var i = 0; i < requiredSheets.length; i++) {
      var sheetName = requiredSheets[i];
      var sheet = getSheetInsensitive(ss, sheetName);
      if (!sheet) {
        missingSheets.push(sheetName);
      } else if (sheet.getLastRow() <= 1) {
        missingSheets.push(sheetName + ' (empty)');
      }
    }
    
    if (missingSheets.length > 0) {
      var errorMsg = 'Missing or empty required sheets:\n• ' + missingSheets.join('\n• ') +
                     '\n\nPlease run the appropriate parsers first.';
      Logger.log('[runTier1Analysis] ' + errorMsg);
      ui.alert('Tier 1 Prerequisites Missing', errorMsg, ui.ButtonSet.OK);
      return {
        success: false,
        gamesProcessed: 0,
        message: errorMsg
      };
    }
    
    // Check for upcoming games
    var upcomingSheet = getSheetInsensitive(ss, 'UpcomingClean');
    var upcomingCount = upcomingSheet.getLastRow() - 1;
    
    if (upcomingCount <= 0) {
      var noGamesMsg = 'No upcoming games found in UpcomingClean.\nPlease import upcoming games first.';
      Logger.log('[runTier1Analysis] ' + noGamesMsg);
      ui.alert('No Games to Analyze', noGamesMsg, ui.ButtonSet.OK);
      return {
        success: false,
        gamesProcessed: 0,
        message: noGamesMsg
      };
    }
    
    Logger.log('[runTier1Analysis] Found ' + upcomingCount + ' upcoming games to analyze');
    
    // Run main analyzer
    analyzeTier1(ss);
    
    // Verify output was created
    var outputSheet = getSheetInsensitive(ss, 'Analysis_Tier1');
    var outputCount = outputSheet ? Math.max(0, outputSheet.getLastRow() - 1) : 0;
    
    Logger.log('[runTier1Analysis] Complete. Output rows: ' + outputCount);
    
    return {
      success: true,
      gamesProcessed: outputCount,
      message: 'Successfully analyzed ' + outputCount + ' games'
    };
    
  } catch (e) {
    Logger.log('[runTier1Analysis] ERROR: ' + e.message + '\nStack: ' + e.stack);
    ui.alert('Tier 1 Analysis Error', 'Error: ' + e.message, ui.ButtonSet.OK);
    return {
      success: false,
      gamesProcessed: 0,
      message: e.message
    };
  }
}


/**
 * ======================================================================
 * PATCHED: predictMatchWinner
 * ======================================================================
 * WHY: Core predictor function that generates HOME/AWAY/RISKY prediction
 *      for a single game using the MaGolide scoring system.
 * 
 * WHAT: Takes game data, calculates features, runs scorer, returns prediction.
 * 
 * HOW: 
 *   1. Extracts or calculates all required features from game object
 *   2. Calls calculateMaGolideScore with features and config
 *   3. Returns structured prediction result
 * 
 * DEPENDENCIES: 
 *   - calculateMaGolideScore (Module 4)
 *   - loadTier1Config (Module 1)
 *   - Feature calculators (Module 4)
 * 
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 * 
 * @param {Object} game - Game object with team names and optional pre-calculated features
 * @param {Object} standings - Optional standings lookup object
 * @param {Object} config - Optional config (will load if not provided)
 * @return {Object} {prediction, confidence, score, tier, tierDisplay, features}
 * ======================================================================
 */
function predictMatchWinner(game, standings, config) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Load config if not provided
    if (!config) {
      config = (typeof loadTier1Config === 'function') ? loadTier1Config(ss) : {};
    }
    
    // Load standings if not provided
    if (!standings) {
      standings = (typeof loadStandings === 'function') ? loadStandings(ss) : {};
    }
    
    // Validate game object
    if (!game || !game.home || !game.away) {
      return {
        prediction: 'N/A',
        confidence: 0,
        score: 0,
        tier: 'SKIP',
        tierDisplay: 'N/A',
        features: {},
        error: 'Invalid game object: missing home or away team'
      };
    }
    
    var homeTeam = String(game.home).trim();
    var awayTeam = String(game.away).trim();
    
    // Get team standings
    var homeStandings = (typeof _getTeamStandings === 'function') 
      ? _getTeamStandings(homeTeam, standings) 
      : { rank: 15, pct: 0.5, netRtg: 0, homePct: 0.5, awayPct: 0.5, l10Pct: 0.5, streak: 0 };
    
    var awayStandings = (typeof _getTeamStandings === 'function')
      ? _getTeamStandings(awayTeam, standings)
      : { rank: 15, pct: 0.5, netRtg: 0, homePct: 0.5, awayPct: 0.5, l10Pct: 0.5, streak: 0 };
    
    // Calculate features (use pre-calculated if available, otherwise compute)
    var features = {};
    
    // Rank difference
    if (game.rankDiff !== undefined) {
      features.rankDiff = parseFloat(game.rankDiff) || 0;
    } else if (typeof _calculateRankDifference === 'function') {
      features.rankDiff = _calculateRankDifference(
        { rank: homeStandings.rank, wl: homeStandings.wl },
        { rank: awayStandings.rank, wl: awayStandings.wl }
      );
    } else {
      features.rankDiff = (awayStandings.rank || 15) - (homeStandings.rank || 15);
    }
    
    // PCT difference
    if (game.pctDiff !== undefined) {
      features.pctDiff = parseFloat(game.pctDiff) || 0;
    } else if (typeof _calculatePCTDifference === 'function') {
      features.pctDiff = _calculatePCTDifference(homeStandings, awayStandings);
    } else {
      features.pctDiff = ((homeStandings.pct || 0.5) - (awayStandings.pct || 0.5)) * 10;
    }
    
    // Net rating difference
    if (game.netRtgDiff !== undefined) {
      features.netRtgDiff = parseFloat(game.netRtgDiff) || 0;
    } else if (typeof _calculateNetRatingDifference === 'function') {
      features.netRtgDiff = _calculateNetRatingDifference(homeStandings, awayStandings);
    } else {
      features.netRtgDiff = (homeStandings.netRtg || 0) - (awayStandings.netRtg || 0);
    }
    
    // Home court effect
    if (game.homeCourtEffect !== undefined) {
      features.homeCourtEffect = parseFloat(game.homeCourtEffect) || 0;
    } else if (typeof _calculateHomeCourtEffect === 'function') {
      features.homeCourtEffect = _calculateHomeCourtEffect(homeStandings, awayStandings);
    } else {
      features.homeCourtEffect = ((homeStandings.homePct || 0.5) - (awayStandings.awayPct || 0.5)) * 10;
    }
    
    // Momentum difference
    if (game.momentumDiff !== undefined) {
      features.momentumDiff = parseFloat(game.momentumDiff) || 0;
    } else if (typeof _calculateMomentumDifference === 'function') {
      features.momentumDiff = _calculateMomentumDifference(homeStandings, awayStandings);
    } else {
      features.momentumDiff = ((homeStandings.l10Pct || 0.5) - (awayStandings.l10Pct || 0.5)) * 10;
    }
    
    // Streak difference
    if (game.streakDiff !== undefined) {
      features.streakDiff = parseFloat(game.streakDiff) || 0;
    } else if (typeof _calculateStreakDifference === 'function') {
      features.streakDiff = _calculateStreakDifference(homeStandings, awayStandings);
    } else {
      features.streakDiff = (homeStandings.streak || 0) - (awayStandings.streak || 0);
    }
    
    // Form difference (use provided or default)
    features.formDiff = parseFloat(game.formDiff) || 0;
    
    // H2H difference (use provided or default)
    features.h2hDiff = parseFloat(game.h2hDiff) || 0;
    
    // Forebet difference (use provided or default)
    features.forebetDiff = parseFloat(game.forebetDiff) || 0;
    
    // Variance penalty (use provided or default)
    features.variancePenalty = parseFloat(game.variancePenalty) || 0.5;
    
    // Calculate prediction using canonical scorer
    var scoreResult = calculateMaGolideScore(features, config);
    
    // Get confidence tier
    var tierResult = getConfidenceTier(scoreResult.score, features, config);
    
    return {
      prediction: scoreResult.prediction,
      confidence: scoreResult.confidence,
      score: scoreResult.score,
      tier: tierResult.tier,
      tierDisplay: tierResult.display,
      tierSymbol: tierResult.symbol,
      features: features,
      factorBreakdown: scoreResult.factorBreakdown,
      meta: scoreResult.meta,
      homeTeam: homeTeam,
      awayTeam: awayTeam
    };
    
  } catch (e) {
    Logger.log('[predictMatchWinner] Error: ' + e.message + '\nStack: ' + e.stack);
    return {
      prediction: 'N/A',
      confidence: 0,
      score: 0,
      tier: 'ERROR',
      tierDisplay: 'Error',
      features: {},
      error: e.message
    };
  }
}



/**
 * ======================================================================
 * PATCHED: predictMultipleMatches
 * ======================================================================
 * WHY: Batch predict multiple matches efficiently.
 * 
 * WHAT: Takes array of games, runs predictMatchWinner on each,
 *       returns array of predictions sorted by confidence.
 * 
 * HOW: Loads standings/config once, iterates games, collects results.
 * 
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 * 
 * @param {Array} games - Array of game objects
 * @param {Object} config - Optional config
 * @return {Array} Array of prediction results sorted by confidence desc
 * ======================================================================
 */
function predictMultipleMatches(games, config) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Load config and standings once
  if (!config) {
    config = (typeof loadTier1Config === 'function') ? loadTier1Config(ss) : {};
  }
  
  var standings = (typeof loadStandings === 'function') ? loadStandings(ss) : {};
  
  if (!games || !Array.isArray(games)) {
    Logger.log('[predictMultipleMatches] Invalid games array');
    return [];
  }
  
  var predictions = [];
  
  for (var i = 0; i < games.length; i++) {
    var game = games[i];
    if (!game) continue;
    
    var prediction = predictMatchWinner(game, standings, config);
    
    // Add game metadata
    prediction.league = game.league || '';
    prediction.date = game.date || '';
    prediction.time = game.time || '';
    prediction.match = prediction.homeTeam + ' vs ' + prediction.awayTeam;
    prediction.index = i;
    
    predictions.push(prediction);
  }
  
  // Sort by confidence descending
  predictions.sort(function(a, b) {
    return b.confidence - a.confidence;
  });
  
  Logger.log('[predictMultipleMatches] Predicted ' + predictions.length + ' matches');
  
  return predictions;
}


/**
 * ======================================================================
 * PATCHED: validateTier1Config
 * ======================================================================
 * WHY: Validate Tier 1 configuration for completeness and sanity.
 * 
 * WHAT: Checks all required config parameters exist and are valid.
 * 
 * HOW: Iterates required keys, validates types and ranges.
 * 
 * WHERE: Module 4 (Analyzers_Tier1.gs)
 * 
 * @param {Object} config - Config object to validate
 * @return {Object} {valid: boolean, errors: Array, warnings: Array}
 * ======================================================================
 */
function validateTier1Config(config) {
  var errors = [];
  var warnings = [];
  
  if (!config) {
    return {
      valid: false,
      errors: ['Config is null or undefined'],
      warnings: []
    };
  }
  
  // Required numeric parameters with valid ranges
  var requiredParams = {
    'threshold': { min: 0, max: 100, default: 25 },
    'confMin': { min: 0, max: 100, default: 50 },
    'confMax': { min: 50, max: 100, default: 95 },
    'homeAdv': { min: 0, max: 20, default: 5 }
  };
  
  // Weight parameters (can be 0)
  var weightParams = ['rank', 'form', 'h2h', 'forebet', 'variance',
                      'pctWeight', 'netRtgWeight', 'homeCourtWeight', 
                      'momentumWeight', 'streakWeight'];
  
  // Check required params
  for (var param in requiredParams) {
    var spec = requiredParams[param];
    var value = config[param];
    
    if (value === undefined || value === null) {
      warnings.push(param + ' missing, using default: ' + spec.default);
    } else {
      var numValue = parseFloat(value);
      if (isNaN(numValue)) {
        errors.push(param + ' is not a valid number: ' + value);
      } else if (numValue < spec.min || numValue > spec.max) {
        warnings.push(param + ' value ' + numValue + ' outside recommended range [' + 
                      spec.min + ', ' + spec.max + ']');
      }
    }
  }
  
  // Check confMin < confMax
  var confMin = parseFloat(config.confMin) || 50;
  var confMax = parseFloat(config.confMax) || 95;
  if (confMin >= confMax) {
    errors.push('confMin (' + confMin + ') must be less than confMax (' + confMax + ')');
  }
  
  // Check at least one weight is set
  var hasWeight = false;
  for (var i = 0; i < weightParams.length; i++) {
    var w = parseFloat(config[weightParams[i]]);
    if (isFinite(w) && w !== 0) {
      hasWeight = true;
      break;
    }
  }
  
  if (!hasWeight) {
    warnings.push('No non-zero weights detected. Predictions may be all RISKY.');
  }
  
  // Check version
  if (!config.version) {
    warnings.push('Config version not set');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}



/**
 * Applies proposal from Config_Tier1_Proposals to Config_Tier1
 * DYNAMIC: copies ALL keys present in proposal (no hard-coded list)
 * ROBUST: auto-detects header row even if A1 is an info banner
 *
 * @param {Spreadsheet} ss
 * @param {number} rankNumber - 1, 2, or 3
 */
function applyTier1ProposalToConfig(ss, rankNumber) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  rankNumber = rankNumber || 1;
  var ui = SpreadsheetApp.getUi();

  try {
    if (typeof getSheetInsensitive !== 'function') {
      throw new Error('applyTier1ProposalToConfig: getSheetInsensitive not found.');
    }

    var prop = getSheetInsensitive(ss, 'Config_Tier1_Proposals');
    if (!prop) throw new Error('Config_Tier1_Proposals not found. Run tuning first.');

    var cfg = getSheetInsensitive(ss, 'Config_Tier1');
    if (!cfg) cfg = ss.insertSheet('Config_Tier1');

    var data = prop.getDataRange().getValues();
    if (!data || data.length < 2) throw new Error('Config_Tier1_Proposals is empty.');

    function norm_(v) { return String(v || '').trim().toLowerCase(); }

    // ── Find the real header row ────────────────────────────────
    var headerRow = -1;
    for (var h = 0; h < Math.min(data.length, 25); h++) {
      if (norm_(data[h][0]) === 'parameter') { headerRow = h; break; }
    }
    if (headerRow === -1) headerRow = 0;

    var header = data[headerRow] || [];

    // ── Determine value column ──────────────────────────────────
    var valueCol = (rankNumber === 1) ? 1 : (rankNumber === 2) ? 3 : (rankNumber === 3) ? 4 : null;
    if (valueCol === null) throw new Error('rankNumber must be 1, 2, or 3.');

    function findCol_(regex) {
      for (var c = 0; c < header.length; c++) {
        if (regex.test(norm_(header[c]))) return c;
      }
      return -1;
    }
    if (rankNumber === 1) {
      var fc1 = findCol_(/proposed|best|rank\s*#?\s*1/);
      if (fc1 !== -1) valueCol = fc1;
    } else if (rankNumber === 2) {
      var fc2 = findCol_(/rank\s*#?\s*2|alt\s*2|candidate\s*2/);
      if (fc2 !== -1) valueCol = fc2;
    } else if (rankNumber === 3) {
      var fc3 = findCol_(/rank\s*#?\s*3|alt\s*3|candidate\s*3/);
      if (fc3 !== -1) valueCol = fc3;
    }

    // ── Build map of ALL proposed key→value pairs ───────────────
    var proposed = {};
    for (var r = headerRow + 1; r < data.length; r++) {
      var keyOrig = String(data[r][0] || '').trim();
      if (!keyOrig) continue;
      if (keyOrig.indexOf('---') === 0) continue;
      if (norm_(keyOrig) === 'parameter') continue;

      var val = data[r][valueCol];
      if (val === '' || val === null || typeof val === 'undefined') continue;

      proposed[norm_(keyOrig)] = { original: keyOrig, value: val };
    }

    var proposedKeys = Object.keys(proposed);
    if (proposedKeys.length === 0) {
      ui.alert(
        'Apply Tier 1 Proposal',
        'No proposed values found for Rank #' + rankNumber + '.\n' +
        'The selected column may be blank or the header row was not detected.',
        ui.ButtonSet.OK
      );
      return;
    }

    // ── Index existing config rows ──────────────────────────────
    var cfgLastRow = cfg.getLastRow();
    var cfgData = (cfgLastRow > 0)
      ? cfg.getRange(1, 1, cfgLastRow, Math.max(2, cfg.getLastColumn())).getValues()
      : [];
    var rowIndex = {};
    for (var ci = 0; ci < cfgData.length; ci++) {
      var ck = norm_(cfgData[ci][0]);
      if (ck) rowIndex[ck] = ci + 1;
    }

    // ── Apply: update existing, batch-append missing ────────────
    var toAppend = [];
    var updatedCount = 0;

    proposedKeys.forEach(function(lk) {
      var entry = proposed[lk];
      var existingRow = rowIndex[lk];
      if (existingRow) {
        cfg.getRange(existingRow, 2).setValue(entry.value);
        updatedCount++;
      } else {
        toAppend.push([entry.original, entry.value]);
      }
    });

    if (toAppend.length > 0) {
      var startRow = cfg.getLastRow() + 1;
      cfg.getRange(startRow, 1, toAppend.length, 2).setValues(toAppend);
      for (var a = 0; a < toAppend.length; a++) {
        rowIndex[norm_(toAppend[a][0])] = startRow + a;
      }
    }

    // ── Metadata stamp ──────────────────────────────────────────
    function setKV_(key, value) {
      var lk = norm_(key);
      var row = rowIndex[lk];
      if (!row) {
        row = cfg.getLastRow() + 1;
        cfg.getRange(row, 1).setValue(key);
        rowIndex[lk] = row;
      }
      cfg.getRange(row, 2).setValue(value);
    }

    setKV_('last_updated', new Date());
    setKV_('updated_by', 'applyTier1ProposalToConfig (rank ' + rankNumber + ')');

    // Keep column A as text
    var finalRow = cfg.getLastRow();
    if (finalRow > 0) cfg.getRange(1, 1, finalRow, 1).setNumberFormat('@');

    Logger.log('[applyTier1ProposalToConfig] Updated ' + updatedCount + ', appended ' + toAppend.length + ' from Rank #' + rankNumber);

    ui.alert(
      '✅ Config 1 Applied',
      'Rank #' + rankNumber + ' applied to Config_Tier1.\n\n' +
      'Updated existing: ' + updatedCount + '\n' +
      'Appended new: ' + toAppend.length + '\n' +
      'Total keys applied: ' + proposedKeys.length + '\n\n' +
      'Run Tier 1 Analysis to use the new config.',
      ui.ButtonSet.OK
    );

  } catch (e) {
    Logger.log('[applyTier1ProposalToConfig] Error: ' + e.message);
    ui.alert('Apply Config Error', e.message, ui.ButtonSet.OK);
  }
}

// Convenience wrappers
function applyTier1ProposedToConfig() {
  return applyTier1ProposalToConfig(SpreadsheetApp.getActiveSpreadsheet(), 1);
}
function applyTier1Rank2ToConfig() {
  return applyTier1ProposalToConfig(SpreadsheetApp.getActiveSpreadsheet(), 2);
}
function applyTier1Rank3ToConfig() {
  return applyTier1ProposalToConfig(SpreadsheetApp.getActiveSpreadsheet(), 3);
}


/**
 * ONE-TIME CONFIG SYNC
 * Injects any missing variables into existing Config_Tier1 and Config_Tier2.
 * Strictly append-only — existing values are NEVER overwritten.
 * Safe to run multiple times (idempotent).
 */
function syncMissingConfigs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  function norm_(v) { return String(v || '').trim().toLowerCase().replace(/[\s_]/g, ''); }

  function backfill_(sheetName, masterRows) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return sheetName + ': ❌ Sheet not found';
    if (sheet.getLastRow() === 0) return sheetName + ': ⚠️ Empty (run initialiser first)';

    var data = sheet.getDataRange().getValues();
    var existing = new Set();
    for (var i = 0; i < data.length; i++) {
      existing.add(norm_(data[i][0]));
    }

    var added = 0;
    for (var j = 0; j < masterRows.length; j++) {
      var row = masterRows[j];
      var keyStr = String(row[0]);
      if (keyStr.indexOf('---') === 0) continue;
      if (norm_(keyStr) === 'key') continue;
      if (!existing.has(norm_(keyStr))) {
        sheet.appendRow(row);
        existing.add(norm_(keyStr));
        added++;
      }
    }
    return sheetName + ': ✅ Added ' + added + ' missing keys';
  }

  // Same master lists as _initialiseTierConfigs_ (single source of truth)
  var t1Master = [
    ['pctWeight', 3.5, 'Weight for PCT difference'],
    ['netRtgWeight', 4.0, 'Weight for Net Rating diff'],
    ['homeCourtWeight', 2.0, 'Weight for home vs away split'],
    ['momentumWeight', 2.5, 'Weight for Last 10 form'],
    ['streakWeight', 1.0, 'Weight for win/loss streak'],
    ['min_samples', 1, 'Minimum sample size'],
    ['confidence_scale', 30, 'Confidence scaling factor'],
    ['bayesian_blending', 'TRUE', 'Enable Bayesian blending'],
    ['show_all_tiers', 'TRUE', 'Show all tier levels'],
    ['tier_strong_min_score', 75, 'Strong tier minimum'],
    ['tier_medium_min_score', 60, 'Medium tier minimum'],
    ['tier_weak_min_score', 50, 'Weak tier minimum']
  ];

  var t2Master = [
    ['forebet_blend_enabled', 'TRUE', 'Enable Forebet blending'],
    ['forebet_ou_weight_qtr', 0.50, 'Forebet O/U quarter weight'],
    ['forebet_ou_weight_ft', 1.50, 'Forebet O/U full-time weight'],
    ['hq_enabled', 'TRUE', 'Enable Highest Quarter'],
    ['hq_softmax_temperature', 4.0, 'HQ softmax temperature'],
    ['hq_shrink_k', 10, 'HQ shrinkage factor'],
    ['hq_min_confidence', 55, 'HQ minimum confidence'],
    ['hq_min_pwin', 0.35, 'HQ minimum win probability'],
    ['hq_skip_ties', 'TRUE', 'Skip HQ ties'],
    ['hq_vol_weight', 0.4, 'HQ volatility weight'],
    ['hq_fb_weight', 0.25, 'HQ Forebet weight'],
    ['hq_exempt_from_cap', 'FALSE', 'HQ exempt from cap'],
    ['hq_max_picks_per_slip', 2, 'HQ max picks per slip'],
    ['highest_q_tie_policy', 'SKIP', 'HQ tie policy'],
    ['highest_q_tie_conf_penalty', 0.10, 'HQ tie confidence penalty'],
    ['highQtrTieMargin', 2.5, 'Highest quarter tie margin'],
    ['tieMargin', 1.5, 'General tie margin'],
    ['ou_edge_threshold', 0.04, 'O/U minimum edge'],
    ['ou_min_samples', 10, 'O/U minimum samples'],
    ['ou_min_ev', 0.005, 'O/U minimum EV'],
    ['ou_confidence_scale', 20, 'O/U confidence scale'],
    ['ou_shrink_k', 8, 'O/U shrinkage'],
    ['ou_sigma_floor', 6.0, 'O/U sigma floor'],
    ['ou_sigma_scale', 1.0, 'O/U sigma scale'],
    ['ou_american_odds', -110, 'O/U American odds'],
    ['ou_model_error', 4.0, 'O/U model error'],
    ['ou_prob_temp', 1.15, 'O/U probability temperature'],
    ['ou_use_effn', 'FALSE', 'O/U effective N'],
    ['ou_confidence_shrink_min', 0.35, 'O/U confidence shrink min'],
    ['ou_confidence_shrink_max', 1.0, 'O/U confidence shrink max'],
    ['debug_ou_logging', 'FALSE', 'O/U debug logging'],
    ['enableRobbers', 'TRUE', 'Enable ROBBERS detection'],
    ['enableFirstHalf', 'TRUE', 'Enable First Half predictions'],
    ['ftOUMinConf', 55, 'FT O/U minimum confidence'],
    ['strong_target', 0.750, 'Strong pick target'],
    ['medium_target', 0.650, 'Medium pick target'],
    ['even_target', 0.550, 'Even pick target']
  ];

  var results = [];
  results.push(backfill_('Config_Tier1', t1Master));
  results.push(backfill_('Config_Tier2', t2Master));

  ui.alert(
    'Config Sync Complete',
    results.join('\n') + '\n\nExisting values were NOT touched.\nYou can now tune these in your config sheets.',
    ui.ButtonSet.OK
  );
}

// ============================================================================
// PHASE 3 PATCH 5 + 5B: CONFIG HARDENING + TOLERANT MATCHING FALLBACK
// ============================================================================

/**
 * TOLERANT_MODE - Helper for tolerant matching of old Bet_Slips rows
 * Fixes "not all bets are being assessed" by providing fallback matching logic
 */
var TOLERANT_MODE = {
  enabled: true,
  fuzzyMatchThreshold: 0.8,
  dateToleranceDays: 1,
  teamNameTolerance: 0.9,
  legacyColumnMappings: {
    // Old column names -> new canonical names
    'bet_id': ['bet_id', 'id', 'betid', 'pick_id'],
    'league': ['league', 'lg', 'sport', 'league_name'],
    'event_date': ['date', 'game_date', 'event_date', 'match_date'],
    'team': ['team', 'selection', 'pick', 'team_name'],
    'opponent': ['opponent', 'opp', 'vs', 'opponent_name'],
    'side_total': ['type', 'bet_type', 'side_total', 'market'],
    'line': ['line', 'odds', 'price', 'line_value'],
    'confidence': ['confidence', 'conf', 'confidence_pct', 'conf_pct'],
    'result': ['result', 'outcome', 'status', 'bet_result']
  }
};

/**
 * tolerantHeaderMatch_ - Tolerant header matching for legacy Bet_Slips
 * @param {Array} actualHeaders - Actual headers from sheet
 * @param {Array} targetHeaders - Target canonical headers
 * @returns {Object} Header map with tolerant matching
 */
function tolerantHeaderMatch_(actualHeaders, targetHeaders) {
  var map = {};
  var usedActual = [];
  
  // First pass: exact matches using ContractEnforcer
  if (typeof createCanonicalHeaderMap_ !== 'undefined') {
    map = createCanonicalHeaderMap_(targetHeaders, actualHeaders);
    // Mark used actual headers
    Object.values(map).forEach(idx => {
      if (idx >= 0) usedActual.push(idx);
    });
  }
  
  // Second pass: tolerant matching for unmapped target columns
  targetHeaders.forEach((target, targetIdx) => {
    if (map[target] === undefined || map[target] < 0) {
      var legacyMappings = TOLERANT_MODE.legacyColumnMappings[target] || [target];
      
      for (var i = 0; i < actualHeaders.length; i++) {
        if (usedActual.includes(i)) continue; // Skip already used columns
        
        var actual = String(actualHeaders[i]).toLowerCase().replace(/[\s_]/g, "");
        
        for (var j = 0; j < legacyMappings.length; j++) {
          var legacy = String(legacyMappings[j]).toLowerCase().replace(/[\s_]/g, "");
          
          // Exact match
          if (actual === legacy) {
            map[target] = i;
            usedActual.push(i);
            break;
          }
          
          // Fuzzy match
          if (TOLERANT_MODE.enabled) {
            var similarity = stringSimilarity_(actual, legacy);
            if (similarity >= TOLERANT_MODE.fuzzyMatchThreshold) {
              map[target] = i;
              usedActual.push(i);
              Logger.log('[tolerantHeaderMatch_] Fuzzy matched: ' + actual + ' -> ' + legacy + ' (' + (similarity * 100).toFixed(1) + '%)');
              break;
            }
          }
        }
        
        if (map[target] !== undefined && map[target] >= 0) break;
      }
    }
  });
  
  return map;
}

/**
 * stringSimilarity_ - Calculate string similarity using Levenshtein distance
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} Similarity score (0-1)
 */
function stringSimilarity_(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  
  var longer = s1.length > s2.length ? s1 : s2;
  var shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1;
  
  var distance = levenshteinDistance_(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * levenshteinDistance_ - Calculate Levenshtein distance between strings
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} Levenshtein distance
 */
function levenshteinDistance_(s1, s2) {
  var costs = [];
  for (var i = 0; i <= s1.length; i++) {
    var lastValue = i;
    for (var j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else {
        if (j > 0) {
          var newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

/**
 * tolerantBetSlipsParser_ - Parse Bet_Slips with tolerant matching for legacy data
 * @param {Sheet} sheet - Bet_Slips sheet
 * @returns {Array} Array of parsed bet objects
 */
function tolerantBetSlipsParser_(sheet) {
  if (!sheet) return [];
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  var headers = data[0];
  var bets = [];
  
  // Use tolerant header matching
  var headerMap = tolerantHeaderMatch_(headers, BET_SLIPS_CONTRACT);
  
  Logger.log('[tolerantBetSlipsParser_] Header mapping: ' + JSON.stringify(headerMap));
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row || row.length === 0) continue;
    
    var bet = {};
    
    // Map columns using tolerant header map
    Object.keys(headerMap).forEach(function(canonical) {
      var colIdx = headerMap[canonical];
      if (colIdx >= 0 && colIdx < row.length) {
        bet[canonical] = row[colIdx];
      }
    });
    
    // Apply tolerant data cleaning
    bet = tolerantDataCleaning_(bet);
    
    // Validate bet has minimum required fields
    if (bet.bet_id && bet.league && bet.team) {
      bets.push(bet);
    } else {
      Logger.log('[tolerantBetSlipsParser_] Skipping invalid bet: ' + JSON.stringify(bet));
    }
  }
  
  Logger.log('[tolerantBetSlipsParser_] Parsed ' + bets.length + ' bets from ' + (data.length - 1) + ' rows');
  return bets;
}

/**
 * tolerantDataCleaning_ - Clean and normalize bet data with tolerance
 * @param {Object} bet - Bet object
 * @returns {Object} Cleaned bet object
 */
function tolerantDataCleaning_(bet) {
  // Clean and normalize team names
  if (bet.team) {
    bet.team = String(bet.team).trim();
    // Remove common prefixes/suffixes
    bet.team = bet.team.replace(/^(The |A )/i, '').replace(/\s+(The|A)$/i, '');
  }
  
  if (bet.opponent) {
    bet.opponent = String(bet.opponent).trim();
    bet.opponent = bet.opponent.replace(/^(The |A )/i, '').replace(/\s+(The|A)$/i, '');
  }
  
  // Normalize confidence
  if (bet.confidence || bet.confidence_pct) {
    var conf = bet.confidence || bet.confidence_pct;
    if (typeof conf === 'string') {
      conf = conf.replace('%', '').trim();
      conf = parseFloat(conf);
    }
    if (!isNaN(conf)) {
      // Convert to percentage if needed
      if (conf <= 1) conf = conf * 100;
      bet.confidence_pct = Math.max(0, Math.min(100, conf));
      
      // Apply confidence normalization
      var normalized = normalizeConfidence_(bet.confidence_pct / 100);
      if (normalized) {
        bet.tier_code = normalized.tier_code;
        bet.tier_display = normalized.tier_display;
      }
    }
  }
  
  // Clean league names
  if (bet.league) {
    bet.league = String(bet.league).trim().toUpperCase();
  }
  
  // Clean dates
  if (bet.event_date) {
    var dateObj = new Date(bet.event_date);
    if (!isNaN(dateObj.getTime())) {
      bet.event_date = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD format
    }
  }
  
  // Generate missing bet_id if needed
  if (!bet.bet_id && bet.team && bet.event_date) {
    bet.bet_id = 'LEGACY_' + String(bet.team).replace(/\s+/g, '_') + '_' + bet.event_date.replace(/-/g, '');
  }
  
  return bet;
}
