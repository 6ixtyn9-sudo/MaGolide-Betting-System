/**
 * ============================================================
 * MODULE 7
 * ============================================================
 * 
 * PRODUCTION-READY FEATURES:
 * 1. Push-aware scoring with continuity correction for integer lines
 * 2. Direction chosen by comparing SHRUNK conditional win rates
 * 3. Break-even adjusted for push probability
 * 4. Confidence display uses CONDITIONAL pWinNoPush (intuitive)
 * 5. EV/Edge gates use UNCONDITIONAL pWin (matches betting math)
 * 6. Tuner Brier uses UNCONDITIONAL pWin (consistent with push=0.5)
 * 7. NonPush derived from raw masses (exact conditional complements)
 * 8. Random candidate sampling (no 18.6M grid OOM)
 * 9. Config key lowercasing (prevents case-mismatch bugs)
 * 10. Book line parsing handles ½ and comma decimals
 *
 * PROBABILITY MODEL:
 *  - pPush derived from continuity correction for integer lines
 *  - nonPush = pUnderWinRaw + pOverWinRaw (ensures exact complements)
 *  - Conditional rates: pOverNoPush + pUnderNoPush = 1 exactly
 *  - Shrinkage applied in conditional space
 *  - Recompose: pWin = nonPush * pWinNoPush
 *
 * IMPORTANT: Ensure only ONE copy of these wrappers exists:
 *  - runTier2OU, runTier2_BothModes, predictQuarters_Tier2_OU
 * ============================================================
 */



// At top of your script (temporarily):
var T2OU_DEBUG = true;  // Enable all debug logs

// Or per-function:
var T2OU_DEBUG_SCORING = true;
var T2OU_DEBUG_LOOKUP = true;
var T2OU_DEBUG_CACHE = true;
var T2OU_DEBUG_TUNING = true;

// ===================== CACHES =====================
var T2OU_CACHE = {
  teamStats: null,
  league: null,
  builtAt: null
};

/**
 * Create / replace the shared context for this Tier 2 run.
 * Called once at the top of runTier2_BothModes.
 *
 * @param {Spreadsheet} ss   Active spreadsheet (for ID stamping)
 * @param {Object}      meta Optional metadata (source, intended order, etc.)
 * @return {Object}     The newly created context
 */
function t2_resetSharedGameContext_(ss, meta) {
  meta = meta || {};

  var runId;
  try {
    runId = (typeof Utilities !== 'undefined' && Utilities.getUuid)
      ? Utilities.getUuid()
      : String(new Date().getTime());
  } catch (e) {
    runId = String(new Date().getTime());
  }

  var ctx = {
    _type:          'Tier2GameContext',
    _version:       'R4-PATCH1',
    runId:          runId,
    createdAt:      new Date(),
    // metadata for the orchestrator
    ssId: (ss && typeof ss.getId === 'function') ? ss.getId() : 'active',
    ts: new Date(),
    options: meta || {},

    // games keyed by "home vs away" (lowercase)
    games: {},

    // ── Pipeline rollup sections ────────────────────────────────────────
    ou: { processed: 0, notes: [] },
    hq: { processed: 0, notes: [] },

    // ── Execution-order diagnostics ─────────────────────────────────────
    steps: [],

    // ── Cross-module scratch flags ──────────────────────────────────────
    flags: {}
  };

  globalThis.T2_SHARED_GAME_CONTEXT = ctx;
  return ctx;
}

/**
 * Read the shared context. Returns null if the orchestrator hasn't run yet
 * (e.g., Module 9 called standalone outside runTier2_BothModes).
 */
function t2_getSharedGameContext_() {
  // Use globalThis explicitly to ensure we pick up the same object across files
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (typeof g.T2_SHARED_GAME_CONTEXT === 'undefined') {
    g.T2_SHARED_GAME_CONTEXT = null;
  }
  return g.T2_SHARED_GAME_CONTEXT || null;
}

/**
 * Append a step-trace entry to the shared context.
 * Safe / no-throw — silently no-ops if context doesn't exist.
 */
function t2_traceSharedGameContextStep_(stepName, status, detail) {
  try {
    var g = (typeof globalThis !== 'undefined') ? globalThis : this;
    if (typeof g.T2_SHARED_GAME_CONTEXT === 'undefined' || !g.T2_SHARED_GAME_CONTEXT) {
      return;
    }

    var ctx = g.T2_SHARED_GAME_CONTEXT;
    if (!ctx.steps || !Array.isArray(ctx.steps)) {
      ctx.steps = [];
    }

    ctx.steps.push({
      step:   String(stepName || ''),
      status: String(status || ''),
      detail: detail || '',
      ts:     new Date()
    });
  } catch (e) { /* swallow */ }
}


/* =============================================================================
 * runTier2_BothModes() — PATCHED (Fix 4C: shared ctx bootstrap + order tracing)
 *
 * Execution order (unchanged):
 *   1) Margins  → Module 5  (predictQuarters_Tier2)
 *   2) O/U      → Module 6  (predictQuarters_Tier2_OU)   ← WRITES to ctx
 *   3) HQ / Enh → Module 9  (runAllEnhancements / processEnhancements) ← READS ctx
 *
 * Changes vs pre-patch:
 *   • Calls t2_resetSharedGameContext_ before any pipeline step.
 *   • Passes gameContext into O/U via existing `options` parameter.
 *   • Wraps each step with t2_traceSharedGameContextStep_ for order verification.
 *   • Returns lightweight gameContext summary in result object.
 *   • All original behavior preserved — no signature changes downstream.
 * ============================================================================= */
function runTier2_BothModes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    if (typeof _safeAlert_ === 'function') _safeAlert_('Tier 2', 'Spreadsheet not available.');
    return { ok: false, error: 'Spreadsheet not available' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIX 4C: Initialize shared in-memory context for this run
  // No sheet writes — pure in-memory handoff between pipelines.
  // ═══════════════════════════════════════════════════════════════════════════
  var gameContext = t2_resetSharedGameContext_(ss, {
    source: 'runTier2_BothModes',
    intendedOrder: ['margins', 'ou', 'enhancements']
  });

  Logger.log('===== TIER 2 BOTH MODES (WITH ENHANCEMENTS) =====');
  Logger.log('[Tier2] Shared gameContext initialized: runId=' + gameContext.runId);

  var marginResult = null, ouResult = null, enhResult = null, errors = [];

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // STEP 1: MARGINS (Module 5)
    // ═════════════════════════════════════════════════════════════════════════
    t2_traceSharedGameContextStep_('margins', 'START', '');
    if (typeof _safeToast_ === 'function') _safeToast_(ss, '1/3: Margin predictions...', 'Tier 2', 20);

    if (typeof predictQuarters_Tier2 === 'function') {
      try {
        marginResult = predictQuarters_Tier2(ss);
        Logger.log('[Tier2] Margins complete');
        t2_traceSharedGameContextStep_('margins', 'OK', '');
      } catch (e1) {
        errors.push('Margins: ' + e1.message);
        Logger.log('[Tier2] Margins error: ' + e1.message);
        t2_traceSharedGameContextStep_('margins', 'ERROR', e1.message);
      }
    } else {
      Logger.log('[Tier2] predictQuarters_Tier2 not found (skipping margins).');
      t2_traceSharedGameContextStep_('margins', 'SKIP', 'predictQuarters_Tier2 not found');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: O/U (Module 6) — WRITES ouPredictions into shared ctx
    // Pass gameContext via existing `options` parameter (no signature change).
    // ═════════════════════════════════════════════════════════════════════════
    t2_traceSharedGameContextStep_('ou', 'START', '');
    if (typeof _safeToast_ === 'function') _safeToast_(ss, '2/3: O/U predictions...', 'Tier 2', 20);

    var ouOptions = { gameContext: gameContext };

    if (typeof predictQuarters_Tier2_OU === 'function') {
      try {
        ouResult = predictQuarters_Tier2_OU(ss, ouOptions);
        Logger.log('[Tier2] O/U complete');
        t2_traceSharedGameContextStep_('ou', 'OK', '');
      } catch (e2) {
        errors.push('O/U: ' + e2.message);
        Logger.log('[Tier2] O/U error: ' + e2.message);
        t2_traceSharedGameContextStep_('ou', 'ERROR', e2.message);
      }
    } else if (typeof predictQuartersOU_Tier2 === 'function') {
      try {
        // Legacy fn has no options param; shared ctx still reachable via global accessor
        ouResult = predictQuartersOU_Tier2(ss);
        Logger.log('[Tier2] O/U complete (legacy fn)');
        t2_traceSharedGameContextStep_('ou', 'OK', 'legacy fn (no options param)');
      } catch (e2b) {
        errors.push('O/U: ' + e2b.message);
        Logger.log('[Tier2] O/U error (legacy fn): ' + e2b.message);
        t2_traceSharedGameContextStep_('ou', 'ERROR', e2b.message);
      }
    } else {
      Logger.log('[Tier2] No O/U function found (skipping O/U).');
      t2_traceSharedGameContextStep_('ou', 'SKIP', 'no O/U function found');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: ENHANCEMENTS / HQ (Module 9) — READS ouPredictions from ctx
    // Shared ctx available via t2_getSharedGameContext_() — no signature change.
    // Preserve existing call convention: runAllEnhancements() takes no args.
    // ═════════════════════════════════════════════════════════════════════════
    t2_traceSharedGameContextStep_('enhancements', 'START', '');
    if (typeof _safeToast_ === 'function') _safeToast_(ss, '3/3: Running Enhancements...', 'Tier 2', 20);

    try {
      if (typeof runAllEnhancements === 'function') {
        // runAllEnhancements() internally calls processEnhancements(ss).
        // It acquires ss on its own; shared ctx is read via global accessor.
        enhResult = runAllEnhancements();
        Logger.log('[Tier2] Enhancements complete: ' + JSON.stringify(enhResult));
        t2_traceSharedGameContextStep_('enhancements', 'OK', 'runAllEnhancements');
      } else if (typeof processEnhancements === 'function') {
        // Direct fallback — pass ss for spreadsheet-mode entry
        enhResult = processEnhancements(ss);
        Logger.log('[Tier2] Enhancements complete: ' + JSON.stringify(enhResult));
        t2_traceSharedGameContextStep_('enhancements', 'OK', 'processEnhancements');
      } else {
        Logger.log('[Tier2] Enhancements not available (skipping enhancements).');
        t2_traceSharedGameContextStep_('enhancements', 'SKIP', 'no enhancements entrypoint');
      }
    } catch (e3) {
      errors.push('Enhancements: ' + e3.message);
      Logger.log('[Tier2] Enhancements error: ' + e3.message);
      t2_traceSharedGameContextStep_('enhancements', 'ERROR', e3.message);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═════════════════════════════════════════════════════════════════════════
    var msg = ['✅ Tier 2 Complete\n'];
    msg.push('ctx.runId: ' + (gameContext.runId || 'N/A'));
    msg.push(marginResult ? '📊 Margins: Generated' : '📊 Margins: Skipped');
    msg.push(ouResult
      ? '🎯 O/U: ' + (ouResult.games || 0) + ' games, ' + (ouResult.picks || 0) + ' picks'
      : '🎯 O/U: Skipped');
    msg.push(enhResult
      ? '🔮 Enhancements: ' + (enhResult.processed || 0) + ' games'
      : '🔮 Enhancements: Skipped');
    if (errors.length) msg.push('\n⚠️ Errors:\n' + errors.join('\n'));
    msg.push('\nNext: Run Accumulator');

    if (typeof _safeAlert_ === 'function') _safeAlert_('Tier 2 Complete', msg.join('\n'));

    return {
      ok: errors.length === 0,
      margin: marginResult,
      ou: ouResult,
      enhancements: enhResult,
      errors: errors,

      // Lightweight ctx summary — full per-game data stays in global only
      gameContext: {
        runId:         gameContext.runId,
        createdAt:     gameContext.createdAt,
        steps:         gameContext.steps,
        spreadsheetId: gameContext.spreadsheetId,
        version:       gameContext._version
      }
    };

  } catch (fatal) {
    Logger.log('[Tier2_BothModes] Fatal: ' + fatal.message);
    t2_traceSharedGameContextStep_('orchestrator', 'FATAL', fatal.message);
    if (typeof _safeAlert_ === 'function') _safeAlert_('Tier 2 Error', fatal.message);
    return {
      ok: false,
      error: fatal.message,
      ctxRunId: (gameContext && gameContext.runId) || ''
    };
  }
}


/**
 * ============================================================================
 * t2ou_evaluateConfigOnHistory_ - PRODUCTION v7.0 (TUNER-SAFE + FAST)
 * ============================================================================
 * OPTIMIZATIONS:
 *  - ZERO SpreadsheetApp calls (pure computation)
 *  - Minimal logging (capped globally)
 *  - Uses pre-built cache only
 *  - Early exits where possible
 *
 * Goals:
 *  1) Correct evaluation over all games/quarters
 *  2) Keep execution log readable
 *  3) Execute as fast as possible
 */
function t2ou_evaluateConfigOnHistory_(cand, games, cache) {
  var FN = 't2ou_evaluateConfigOnHistory_';
  var VERSION = 'v7.0-LINE10-PATCH';

  if (!games || !games.length) return null;
  if (!cache || !cache.teamStats || !cache.league) return null;

  var cfg = t2ou_sanitizeOUConfig_(cand);

  if (typeof T2OU_TUNER_LOG_STATE === 'undefined' || !T2OU_TUNER_LOG_STATE) {
    T2OU_TUNER_LOG_STATE = {
      cfgCount: 0,
      pickLogsUsed: 0,
      maxPickLogsTotal: 15,
      suppressedNoticeShown: false,
      versionStamped: false
    };
  }
  T2OU_TUNER_LOG_STATE.cfgCount++;
  var cfgNo = T2OU_TUNER_LOG_STATE.cfgCount;

  if (!T2OU_TUNER_LOG_STATE.versionStamped) {
    Logger.log('[' + FN + '] ' + VERSION + ' ACTIVE');
    T2OU_TUNER_LOG_STATE.versionStamped = true;
  }

  var allowLogs = (cfgNo === 1);
  var remaining = Math.max(0, T2OU_TUNER_LOG_STATE.maxPickLogsTotal - T2OU_TUNER_LOG_STATE.pickLogsUsed);
  var maxLogsThisConfig = allowLogs ? Math.min(5, remaining) : 0;

  // Proxy lines from league means
  var proxyLine = {};
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  for (var qi = 0; qi < 4; qi++) {
    var Q = quarters[qi];
    var lg = cache.league[Q];
    var mu = (lg && isFinite(lg.mu)) ? lg.mu : 55;
    proxyLine[Q] = t2ou_roundHalf_(mu);
  }

  var odds = Number(cfg.ou_american_odds);
  if (!isFinite(odds) || odds === 0) odds = -110;
  var profitUnit = (odds < 0) ? (100 / Math.abs(odds)) : (odds / 100);

  var minSamples = cfg.ou_min_samples || 0;

  var picks = 0, correct = 0, brierSum = 0, profit = 0, pushes = 0;

  var diag = {
    reasons: {
      noQuarterData: 0,
      noModel: 0,
      noLeagueLine: 0,
      notPlay: 0,
      lowSamples: 0,
      badLine: 0
    },
    totalQuarters: 0
  };

  var logged = 0;
  var nGames = games.length;

  for (var gi = 0; gi < nGames; gi++) {
    var game = games[gi];
    if (!game || !game.quarters) continue;

    var home = game.home;
    var away = game.away;

    for (var q = 1; q <= 4; q++) {
      var QQ = 'Q' + q;
      diag.totalQuarters++;

      var qt = game.quarters[QQ];
      if (!qt || !isFinite(qt.total)) { diag.reasons.noQuarterData++; continue; }

      var actual = Number(qt.total);

      var model = t2ou_predictQuarterTotal_(home, away, QQ, cache.teamStats, cache.league, cfg);
      if (!model) { diag.reasons.noModel++; continue; }

      if ((model.samples || 0) < minSamples) { diag.reasons.lowSamples++; continue; }

      var baseLine = proxyLine[QQ];
      if (!isFinite(baseLine)) { diag.reasons.noLeagueLine++; continue; }

      var jitter = t2ou_deterministicJitter_(home, away, QQ);
      var rawLine = baseLine + jitter;
      var line = t2ou_roundHalf_(rawLine);

      if (!isFinite(line)) { diag.reasons.badLine++; continue; }

      var meta = {
        source: FN,
        caller: FN,
        lineSource: 'proxyLine(' + baseLine + ')+jitter(' + jitter + ')',
        rawLine: rawLine,
        fallbackUsed: false,
        league: (game.league || ''),
        quarter: QQ,
        match: String(home || '') + ' vs ' + String(away || ''),
        home: home,
        away: away
      };

      var scored = t2ou_scoreOverUnderPick_(model, line, cfg, null, meta);
      if (!scored || !scored.play) { diag.reasons.notPlay++; continue; }

      picks++;

      var diff = actual - line;
      var wasPush = Math.abs(diff) < 0.001;
      var wasOver = diff > 0;
      var wasUnder = diff < 0;

      var dirU = String(scored.dir || scored.direction || '').toUpperCase();
      var won = false;

      if (wasPush) {
        pushes++;
      } else if (dirU === 'OVER' && wasOver) {
        won = true;
      } else if (dirU === 'UNDER' && wasUnder) {
        won = true;
      }

      if (!wasPush) {
        if (won) { correct++; profit += profitUnit; }
        else { profit -= 1; }
      }

      var y = wasPush ? 0.5 : (won ? 1 : 0);
      var pWin = scored.pWin || 0;
      brierSum += (pWin - y) * (pWin - y);

      if (maxLogsThisConfig > 0 && logged < maxLogsThisConfig) {
        if (logged === 0 || logged === maxLogsThisConfig - 1) {
          Logger.log(
            '[' + FN + '] cfg#' + cfgNo +
            ' gm#' + (gi + 1) + ' ' + home + ' v ' + away + ' ' + QQ +
            ' | actual=' + actual.toFixed(1) +
            ' line=' + line.toFixed(1) +
            ' mu=' + (model.mu != null ? Number(model.mu).toFixed(2) : 'NA') +
            ' | dir=' + dirU +
            ' pWin=' + (pWin != null ? Number(pWin).toFixed(3) : 'NA') +
            ' | won=' + won + (wasPush ? ' (PUSH)' : '')
          );
          logged++;
          T2OU_TUNER_LOG_STATE.pickLogsUsed++;
        }
      }
    }
  }

  if (cfgNo === 1) {
    Logger.log('[' + FN + '] SUMMARY cfg#1: games=' + nGames +
      ' quarters=' + diag.totalQuarters +
      ' picks=' + picks +
      ' correct=' + correct +
      ' pushes=' + pushes);
  }

  if (picks === 0) {
    return { picks: 0, correct: 0, accuracy: 0, brier: 1, roi: 0, pushes: 0, diag: diag };
  }

  return {
    picks: picks,
    correct: correct,
    accuracy: correct / picks,
    brier: brierSum / picks,
    roi: profit / picks,
    pushes: pushes,
    diag: diag
  };
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _t2ou_computeDynamicLeague_ — NEW HELPER (Fix 3A — UNBLOCKED)
 * ═══════════════════════════════════════════════════════════════════════════
 * Computes live league mean/SD per quarter from teamStats in memory.
 *
 * CRITICAL: Collects from Home venue ONLY to avoid double-counting.
 *
 * UNBLOCKED: Works with BOTH data shapes:
 *   Shape A (raw):        { totals: [55, 48, ...], avgTotal, stdDev, samples }
 *   Shape B (aggregated): { avgTotal, stdDev, samples }  (no .totals array)
 *
 * When .totals arrays are present (Shape A), computes exact mean/SD.
 * When only aggregated stats exist (Shape B), uses weighted pooled combine:
 *   pooled mean = weighted average of per-team avgTotal
 *   pooled SD   = sqrt of weighted average of (sd² + (avg - grandMean)²)
 *
 * Falls back to staticLeague for any quarter with insufficient data (<20).
 *
 * @param {Object} teamStats      - T2OU_CACHE.teamStats
 * @param {Object} fallbackLeague - T2OU_CACHE.league (sheet-loaded fallback)
 * @returns {Object} { Q1: {mu, sd, samples}, Q2: ..., Q3: ..., Q4: ... }
 */
function _t2ou_computeDynamicLeague_(teamStats, fallbackLeague) {
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var out = {};
  var MIN_SAMPLES = 20;

  function fallback_(Q) {
    var fb = (fallbackLeague && fallbackLeague[Q]) ? fallbackLeague[Q] : null;
    return {
      mu: (fb && isFinite(fb.mu)) ? fb.mu : (Q === 'Q4' ? 53 : 55),
      sd: (fb && isFinite(fb.sd) && fb.sd > 0) ? fb.sd : 8,
      samples: (fb && isFinite(fb.samples)) ? fb.samples : 0
    };
  }

  var teams = Object.keys(teamStats || {});

  for (var qi = 0; qi < quarters.length; qi++) {
    var Q = quarters[qi];

    // Collect raw totals from teams that have them (Shape A)
    var allTotals = [];
    // Collect aggregated stats from teams without raw arrays (Shape B)
    var groups = [];

    // Home venue ONLY — avoids double-counting
    for (var ti = 0; ti < teams.length; ti++) {
      var teamData = teamStats[teams[ti]];
      if (!teamData || !teamData.Home || !teamData.Home[Q]) continue;

      var qData = teamData.Home[Q];
      if (!qData) continue;

      // Shape A: raw .totals array exists
      if (qData.totals && qData.totals.length > 0) {
        for (var gi = 0; gi < qData.totals.length; gi++) {
          var val = qData.totals[gi];
          if (isFinite(val) && val >= 0 && val <= 200) {
            allTotals.push(val);
          }
        }
      }
      // Shape B: only aggregated {avgTotal, samples, stdDev}
      else if (isFinite(qData.avgTotal) && qData.avgTotal > 0 &&
               isFinite(qData.samples) && qData.samples > 0) {
        groups.push({
          avg: qData.avgTotal,
          sd: (isFinite(qData.stdDev) && qData.stdDev > 0) ? qData.stdDev : 0,
          n: qData.samples
        });
      }
    }

    // Path A: compute from raw totals (exact)
    if (allTotals.length >= MIN_SAMPLES) {
      var sum = 0;
      for (var i = 0; i < allTotals.length; i++) sum += allTotals[i];
      var mu = sum / allTotals.length;

      var ssq = 0;
      for (var j = 0; j < allTotals.length; j++) {
        var d = allTotals[j] - mu;
        ssq += d * d;
      }
      var sd = allTotals.length > 1 ? Math.sqrt(ssq / (allTotals.length - 1)) : NaN;

      out[Q] = {
        mu: isFinite(mu) ? mu : fallback_(Q).mu,
        sd: (isFinite(sd) && sd > 0) ? sd : fallback_(Q).sd,
        samples: allTotals.length
      };
      continue;
    }

    // Path B: compute from aggregated stats (weighted pooled combine)
    // Also include any raw totals we found (< MIN_SAMPLES) as a single group
    if (allTotals.length > 0) {
      var rawSum = 0;
      for (var ri = 0; ri < allTotals.length; ri++) rawSum += allTotals[ri];
      var rawMean = rawSum / allTotals.length;
      var rawSsq = 0;
      for (var rj = 0; rj < allTotals.length; rj++) {
        var rd = allTotals[rj] - rawMean;
        rawSsq += rd * rd;
      }
      var rawSd = allTotals.length > 1 ? Math.sqrt(rawSsq / (allTotals.length - 1)) : 0;
      groups.push({ avg: rawMean, sd: rawSd, n: allTotals.length });
    }

    var totalN = 0;
    for (var g = 0; g < groups.length; g++) totalN += groups[g].n;

    if (totalN >= MIN_SAMPLES && groups.length > 0) {
      // Weighted mean
      var weightedSum = 0;
      for (var g1 = 0; g1 < groups.length; g1++) {
        weightedSum += groups[g1].avg * groups[g1].n;
      }
      var grandMean = weightedSum / totalN;

      // Pooled SD: sqrt of weighted average of (within-group variance + between-group variance)
      var pooledVar = 0;
      for (var g2 = 0; g2 < groups.length; g2++) {
        var withinVar = groups[g2].sd * groups[g2].sd;
        var betweenVar = (groups[g2].avg - grandMean) * (groups[g2].avg - grandMean);
        pooledVar += groups[g2].n * (withinVar + betweenVar);
      }
      pooledVar = pooledVar / totalN;
      var pooledSd = Math.sqrt(pooledVar);

      out[Q] = {
        mu: isFinite(grandMean) ? grandMean : fallback_(Q).mu,
        sd: (isFinite(pooledSd) && pooledSd > 0) ? pooledSd : fallback_(Q).sd,
        samples: totalN
      };
    } else {
      out[Q] = fallback_(Q);
    }
  }

  return out;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * t2ou_dynamicForebetWeight_ — NEW HELPER (Fix 3B)
 * ═══════════════════════════════════════════════════════════════════════════
 * Computes confidence-aware Forebet blend weight.
 *   dynamicWeight = configWeight * (1 - reliability * 0.5)
 *   reliability   = clamp(samples / 20, 0, 1)
 *
 * High samples → reliability≈1 → weight halved → resist Forebet noise
 * Low samples  → reliability≈0 → full weight   → lean on Forebet signal
 *
 * Standalone helper: does NOT modify _blendWithForebet signature.
 *
 * @param {number} configWeight - Base Forebet weight from config (0–1)
 * @param {number} samples      - Model sample size for this quarter
 * @returns {number} Dynamic weight, clamped [0, 1]
 */
function t2ou_dynamicForebetWeight_(configWeight, samples) {
  var w = Number(configWeight);
  var n = Number(samples);

  if (!isFinite(w) || w <= 0) return 0;
  if (!isFinite(n) || n < 0) n = 0;

  var reliability = Math.max(0, Math.min(1, n / 20));
  var dyn = w * (1 - reliability * 0.5);

  return Math.max(0, Math.min(1, dyn));
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * t2ou_predictQuarterTotal_ — PATCHED (Fix 3C + R4-PATCH3 / Fix 4A support)
 * File: Module 6 (Analyzers_Tier2_OU.gs)
 * ═══════════════════════════════════════════════════════════════════════════
 * Fix 3C (preserved): CV-based SD fallback when team stdDev missing:
 *   sigmaSide = max(sigmaFloor, avgTotal * 0.15)
 *   Uses raw avgTotal (actual observed) for CV, not shrinkage-adjusted hMu.
 *   Falls back to leagueMu * 0.15 when avgTotal also missing.
 *
 * R4-PATCH3 additions (Fix 4A support — purely additive):
 *   - Adds OPTIONAL `ctx` parameter (7th arg). Backward compatible:
 *     existing 6-arg calls are unaffected.
 *   - If ctx is provided, populates:
 *       ctx.ouPredictions[Q] = { ok, mu, sigma, samples, sampleSize, source, updatedAt }
 *   - Also records {ok: false} entries on null-model returns, so downstream
 *     consumers (HQ) can distinguish "tried and failed" from "not yet run."
 *   - All ctx writes are try/catch wrapped — prediction is never blocked by ctx failure.
 *
 * Returns both `samples` and `sampleSize` for caller compatibility.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function t2ou_predictQuarterTotal_(home, away, Q, teamStats, league, cfg, ctx) {
  // Defensive: ensure cfg has required params with fallbacks
  var k = Number(cfg && cfg.ou_shrink_k);
  var sigmaFloor = Number(cfg && cfg.ou_sigma_floor);
  var sigmaScale = Number(cfg && cfg.ou_sigma_scale);

  if (!isFinite(k) || k <= 0) k = 8;
  if (!isFinite(sigmaFloor) || sigmaFloor <= 0) sigmaFloor = 6;
  if (!isFinite(sigmaScale) || sigmaScale <= 0) sigmaScale = 1.0;

  // ─── R4-PATCH3: Canonicalize quarter key for ctx writes ─────────────────
  // Ensures ctx keys are always 'Q1'–'Q4' regardless of input casing.
  // Original Q is preserved for team stats lookup (t2ou_getTeamVenueQuarter_
  // may be case-sensitive depending on the data source).
  var Qk = String(Q || '').toUpperCase().trim();
  if (!/^Q[1-4]$/.test(Qk)) Qk = String(Q || '').trim(); // fallback: pass-through

  // League baseline for this quarter
  var lg = (league && league[Q]) ? league[Q]
         : ((league && league[Qk]) ? league[Qk]
         : { mu: 55, sd: 8, samples: 0 });
  var leagueMu = isFinite(lg.mu) ? lg.mu : 55;
  var leagueSd = (isFinite(lg.sd) && lg.sd > 0) ? lg.sd : 8;

  // Team quarter stats
  var h = t2ou_getTeamVenueQuarter_(teamStats, home, 'Home', Q);
  var a = t2ou_getTeamVenueQuarter_(teamStats, away, 'Away', Q);

  var hN = h ? (Number(h.samples) || 0) : 0;
  var aN = a ? (Number(a.samples) || 0) : 0;

  // Shrinkage-weighted means
  var hMu = (h && isFinite(h.avgTotal))
    ? (h.avgTotal * (hN / (hN + k)) + leagueMu * (k / (hN + k)))
    : leagueMu;
  var aMu = (a && isFinite(a.avgTotal))
    ? (a.avgTotal * (aN / (aN + k)) + leagueMu * (k / (aN + k)))
    : leagueMu;

  var mu = (hMu + aMu) / 2;

  // ═══════════════════════════════════════════════════════════════════════
  // FIX 3C: CV-based SD fallback
  // Prefer raw avgTotal (actual observed scoring) over shrinkage-adjusted hMu.
  // Falls back to leagueMu * 0.15 when avgTotal also missing.
  // ═══════════════════════════════════════════════════════════════════════
  function sdFallback_(avgTotalLike) {
    var base = (isFinite(avgTotalLike) && avgTotalLike > 0)
      ? (avgTotalLike * 0.15)
      : (leagueMu * 0.15);
    return Math.max(sigmaFloor, base);
  }

  var hAvgForSd = (h && isFinite(h.avgTotal) && h.avgTotal > 0) ? h.avgTotal : hMu;
  var aAvgForSd = (a && isFinite(a.avgTotal) && a.avgTotal > 0) ? a.avgTotal : aMu;

  var hSd = (h && isFinite(h.stdDev) && h.stdDev > 0) ? h.stdDev : sdFallback_(hAvgForSd);
  var aSd = (a && isFinite(a.stdDev) && a.stdDev > 0) ? a.stdDev : sdFallback_(aAvgForSd);

  // Combined sigma with floor and scale
  var sigma = Math.sqrt((hSd * hSd + aSd * aSd) / 2);
  sigma = Math.max(sigmaFloor, sigma * sigmaScale);

  // Final validation
  if (!isFinite(mu) || !isFinite(sigma) || sigma <= 0) {
    // ─── R4-PATCH3: Record explicit failure in ctx ────────────────────────
    // Downstream (HQ) can distinguish "tried, got null" from "not yet run."
    try {
      if (ctx && typeof ctx === 'object') {
        if (!ctx.ouPredictions || typeof ctx.ouPredictions !== 'object') {
          ctx.ouPredictions = {};
        }
        ctx.ouPredictions[Qk] = {
          ok: false,
          mu: null,
          sigma: null,
          samples: 0,
          sampleSize: 0,
          source: 't2ou_predictQuarterTotal_',
          reason: 'invalid_mu_sigma',
          updatedAt: new Date()
        };
      }
    } catch (e0) { /* never block prediction path */ }

    return null;
  }

  var totalSamples = hN + aN;

  // ═══════════════════════════════════════════════════════════════════════
  // R4-PATCH3: Populate ctx.ouPredictions for HQ reuse (Fix 4A support)
  // NOTE: These are PRE-Bayesian/PRE-Forebet values (raw predictor output).
  // Patch 2 records POST-adjustment values at the caller level.
  // Both are available to downstream consumers via different paths.
  // ═══════════════════════════════════════════════════════════════════════
  try {
    if (ctx && typeof ctx === 'object') {
      if (!ctx.ouPredictions || typeof ctx.ouPredictions !== 'object') {
        ctx.ouPredictions = {};
      }
      ctx.ouPredictions[Qk] = {
        ok: true,
        mu: mu,
        sigma: sigma,
        samples: totalSamples,
        sampleSize: totalSamples,
        source: 't2ou_predictQuarterTotal_',
        updatedAt: new Date()
      };
    }
  } catch (e1) { /* never block prediction path */ }

  return {
    mu: mu,
    sigma: sigma,
    samples: totalSamples,
    sampleSize: totalSamples
  };
}



/**
 * ============================================================================
 * t2ou_sanitizeOUConfig_ - PRODUCTION v6.1
 * ============================================================================
 * Ensures ALL required O/U config params exist with sensible defaults.
 * This is the "safety net" that prevents NaN propagation.
 */
function t2ou_sanitizeOUConfig_(raw) {
  raw = t2ou_lowerKeyMap_(raw || {});
  
  function num_(v, fb) { 
    v = Number(v); 
    return isFinite(v) ? v : fb; 
  }
  
  function int_(v, fb) { 
    v = parseInt(v, 10); 
    return isFinite(v) ? v : fb; 
  }
  
  function clamp_(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  
  // Handle odds (avoid 0)
  var odds = int_(raw.ou_american_odds, -110);
  if (odds === 0) odds = -110;
  
  // Handle confidence scale (check alternate key)
  var confScale = int_(raw.ou_confidence_scale, int_(raw.ou_conf_scale, 25));
  
  return {
    ou_edge_threshold: clamp_(num_(raw.ou_edge_threshold, 0.02), 0, 0.25),
    ou_min_samples: Math.max(1, int_(raw.ou_min_samples, 5)),
    ou_min_ev: clamp_(num_(raw.ou_min_ev, 0.005), -0.5, 0.5),
    ou_confidence_scale: Math.max(5, confScale),
    ou_shrink_k: Math.max(1, int_(raw.ou_shrink_k, 8)),
    ou_sigma_floor: Math.max(1, num_(raw.ou_sigma_floor, 6)),
    ou_sigma_scale: clamp_(num_(raw.ou_sigma_scale, 1.0), 0.5, 2.0),
    ou_american_odds: odds,
    ou_push_width: clamp_(num_(raw.ou_push_width, 0.5), 0, 2)
  };
}



/**
 * ============================================================================
 * t2ou_computeCompositeScore_ - PRODUCTION v6.1
 * ============================================================================
 * Calculates a single score for ranking configs. Higher is better.
 */
function t2ou_computeCompositeScore_(score) {
  if (!score) return -999;
  
  // Lower Brier is better (penalty)
  var brierPenalty = (score.brier || 0.5) * 2.0;
  
  // Higher accuracy is better (bonus)
  var accuracyBonus = (score.accuracy || 0) * 1.5;
  
  // Higher positive ROI is better (bonus)
  var roiBonus = Math.max(0, score.roi || 0) * 1.0;
  
  // More picks = more confidence (small bonus, capped)
  var volumeBonus = Math.min((score.picks || 0) / 100, 0.5);
  
  return accuracyBonus + roiBonus + volumeBonus - brierPenalty;
}



/**
 * ============================================================================
 * t2ou_deterministicJitter_ - Helper
 * ============================================================================
 * Returns a deterministic "jitter" value in [-1.5, +1.5] based on matchup+quarter.
 * This makes backtesting reproducible while adding realistic line variation.
 */
function t2ou_deterministicJitter_(home, away, Q) {
  var key = String(home) + '|' + String(away) + '|' + String(Q);
  var u = t2ou_hash01_(key);
  var jitter = (u - 0.5) * 3.0;
  return Math.round(jitter * 2) / 2;
}




/**
 * ============================================================================
 * t2ou_roundHalf_ - Helper (if not already defined)
 * ============================================================================
 * Rounds a number to the nearest 0.5
 */
function t2ou_roundHalf_(val) {
  return Math.round(val * 2) / 2;
}


/**
 * ============================================================================
 * t2ou_clamp_ - Helper (if not already defined)
 * ============================================================================
 * Clamps a value between min and max
 */
function t2ou_clamp_(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Clear T2OU cache
 */
function clearTier2OUCache() {
  if (typeof T2OU_CACHE !== 'undefined') {
    T2OU_CACHE.teamStats = null;
    T2OU_CACHE.league = null;
    T2OU_CACHE.builtAt = null;
  }
  _safeToast_(null, 'Cache cleared', 'Ma Golide', 3);
}

/**
 * runAllEnhancements() — ISS-013 FIX
 * Validates UpcomingClean exists before processing
 */
function runAllEnhancements() {
  var fn = 'runAllEnhancements';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var upcomingSheet = (typeof _getSheetByNameInsensitive_ === 'function')
    ? _getSheetByNameInsensitive_(ss, 'UpcomingClean')
    : ss.getSheetByName('UpcomingClean');

  if (!upcomingSheet) {
    var msg1 = 'UpcomingClean sheet not found. Run parsers first.';
    Logger.log('[' + fn + '] ERROR: ' + msg1);
    try { SpreadsheetApp.getUi().alert('Enhancement Error', msg1, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    return { ok: false, error: msg1, processed: 0 };
  }

  if (upcomingSheet.getLastRow() < 2) {
    var msg2 = 'UpcomingClean has no data rows. Run parsers first.';
    Logger.log('[' + fn + '] ERROR: ' + msg2);
    try { SpreadsheetApp.getUi().alert('Enhancement Error', msg2, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    return { ok: false, error: msg2, processed: 0 };
  }

  Logger.log('[' + fn + '] UpcomingClean validated: ' + (upcomingSheet.getLastRow() - 1) + ' games');

  if (typeof processEnhancements === 'function') {
    return processEnhancements(ss);
  }

  throw new Error('runAllEnhancements: processEnhancements(ss) not found.');
}

/**
 * WHY: Wrapper for config tuning.
 * NOTE: Only define ONCE (was duplicated in original)
 */
function tuneTier2OUConfigWrapper() {
  return tuneTier2OUConfig(SpreadsheetApp.getActiveSpreadsheet());
}

function applyTier2OUProposalRank1() { return t2ou_applyProposalRankToConfig_(SpreadsheetApp.getActiveSpreadsheet(), 1); }
function applyTier2OUProposalRank2() { return t2ou_applyProposalRankToConfig_(SpreadsheetApp.getActiveSpreadsheet(), 2); }
function applyTier2OUProposalRank3() { return t2ou_applyProposalRankToConfig_(SpreadsheetApp.getActiveSpreadsheet(), 3); }

function t2ou_addMenuItems_(ui) {
  try {
    ui.createMenu('Tier2 O/U')
      .addItem('▶ Run Tier 2 O/U', 'runTier2OU')
      .addItem('▶ Run Both (Margins + O/U)', 'runTier2_BothModes')
      .addSeparator()
      .addItem('🎯 Tune O/U Config', 'tuneTier2OUConfigWrapper')
      .addItem('✅ Apply O/U Rank #1', 'applyTier2OUProposalRank1')
      .addItem('✅ Apply O/U Rank #2', 'applyTier2OUProposalRank2')
      .addItem('✅ Apply O/U Rank #3', 'applyTier2OUProposalRank3')
      .addSeparator()
      .addItem('🧹 Clear O/U Cache', 'clearTier2OUCache')
      .addToUi();
  } catch (e) {
    Logger.log('[T2OU] Menu add failed: ' + e);
  }
}


// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 2: QUARTER O/U FOREBET FUNCTIONS (t2ou_*)                                                ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝

/**
 * Distributes a predicted total to quarters using league-specific quarter proportions.
 * 
 * [PATCH Step 6]: Removed hardcoded NBA default percentages (0.253, 0.248, etc.).
 *                 Now REQUIRES a valid leagueProfile with quarterPcts.
 *                 Returns {valid: false} if league data is missing — callers must handle.
 * 
 * @param {number} predTotal - Predicted full-game total
 * @param {Object} leagueProfile - Must contain { quarterPcts: { Q1, Q2, Q3, Q4 } }
 * @param {Object} [cfg] - Optional config (reserved for future use)
 * @return {Object} { Q1, Q2, Q3, Q4, valid } or { valid: false, reason: '...' }
 */
function _apportionForebet(predTotal, leagueProfile, cfg) {
  // No hardcoded league percentages. Require league profile data.
  if (!leagueProfile || !leagueProfile.quarterPcts) {
    return { valid: false, reason: 'No league quarterPcts for forebet apportioning' };
  }
  var qp = leagueProfile.quarterPcts;
  if (!isFinite(qp.Q1) || !isFinite(qp.Q2) || !isFinite(qp.Q3) || !isFinite(qp.Q4)) {
    return { valid: false, reason: 'Incomplete league quarterPcts' };
  }
  var sum = qp.Q1 + qp.Q2 + qp.Q3 + qp.Q4;
  if (sum <= 0) return { valid: false, reason: 'quarterPcts sum to 0' };
  return {
    valid: true,
    Q1: predTotal * (qp.Q1 / sum),
    Q2: predTotal * (qp.Q2 / sum),
    Q3: predTotal * (qp.Q3 / sum),
    Q4: predTotal * (qp.Q4 / sum)
  };
}

/**
 * Distributes Forebet FT total to quarters using league quarter mean proportions.
 * 
 * Example: If league Q1=58, Q2=57, Q3=58, Q4=55 (sum=228)
 *          and Forebet total=243, then:
 *          Q1 = 243 * (58/228) = 61.8
 * 
 * @param {number} forebetTotal - Forebet full-game total
 * @param {Object} leagueStats - { Q1: {mu}, Q2: {mu}, ... } or { Q1: {mean}, ... }
 * @return {Object} { Q1, Q2, Q3, Q4, valid }
 */
function t2ou_apportionForebetToQuarters(forebetTotal, leagueStats) {
  var result = { Q1: NaN, Q2: NaN, Q3: NaN, Q4: NaN, valid: false };
  
  forebetTotal = Number(forebetTotal);
  if (!isFinite(forebetTotal) || forebetTotal <= 0) return result;
  if (!leagueStats) return result;
  
  var quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  var means = [];
  var sumMeans = 0;
  
  // Extract quarter means
  for (var i = 0; i < quarters.length; i++) {
    var q = quarters[i];
    var mean = 55; // Default
    
    if (leagueStats[q]) {
      if (isFinite(leagueStats[q].mu)) mean = leagueStats[q].mu;
      else if (isFinite(leagueStats[q].mean)) mean = leagueStats[q].mean;
    }
    
    means.push(mean);
    sumMeans += mean;
  }
  
  if (sumMeans <= 0) sumMeans = 220;
  
  // Apportion by proportion
  for (var j = 0; j < quarters.length; j++) {
    result[quarters[j]] = Math.round((forebetTotal * means[j] / sumMeans) * 10) / 10;
  }
  
  result.valid = true;
  return result;
}

/**
 * Extract + parse Forebet Pred Score from an UpcomingClean row.
 * 
 * @param {Array} row - Data row from sheet
 * @param {Array} headers - Header row
 * @param {Object} [config] - Config object with optional column override
 * @return {Object} { valid, total, home, away, col, raw }
 */
function t2ou_getForebetFromRow(row, headers, config) {
  var headerMap = {};
  if (headers && Array.isArray(headers)) {
    headers.forEach(function(h, idx) {
      if (h) {
        var key = String(h).toLowerCase().replace(/[\s_\-]+/g, '');
        headerMap[key] = idx;
      }
    });
  }
  
  var idx = _elite_findForebetColumn(headerMap, headers, config);
  if (idx === undefined || idx < 0) {
    return { valid: false, total: NaN, home: NaN, away: NaN, col: -1, raw: '' };
  }
  
  var raw = row[idx];
  var parsed = _elite_parseForebetScore(raw);
  
  return {
    valid: parsed.valid,
    total: parsed.total,
    home: parsed.home,
    away: parsed.away,
    col: idx,
    raw: parsed.raw
  };
}




// ╔═══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 3: ENHANCEMENT FUNCTIONS (_enh_*)                                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝

// Cache for Forebet lookup from UpcomingClean
var _ENH_FOREBET_CACHE = {
  ssId: null,
  builtAt: 0,
  pairToPred: null
};

/**
 * Builds a cache of Forebet predictions keyed by "home|away" pair.
 * Used as fallback when game object doesn't have predScore directly.
 * 
 * @param {Spreadsheet} ss - Spreadsheet object
 * @param {Object} [config] - Config object
 * @return {Object} Cache object
 */
function _enh_buildForebetCache(ss, config) {
  try {
    if (!ss || typeof ss.getId !== 'function') return null;
    var ssId = ss.getId();
    var now = Date.now();
    
    // Cache for 5 minutes
    if (_ENH_FOREBET_CACHE.ssId === ssId &&
        _ENH_FOREBET_CACHE.pairToPred &&
        (now - _ENH_FOREBET_CACHE.builtAt) < 300000) {
      return _ENH_FOREBET_CACHE;
    }
    
    var sheet = ss.getSheetByName('UpcomingClean');
    if (!sheet) return null;
    
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return null;
    
    var headers = values[0];
    var headerMap = {};
    headers.forEach(function(h, idx) {
      if (h) headerMap[String(h).toLowerCase().replace(/[\s_\-]+/g, '')] = idx;
    });
    
    var idxHome = headerMap.home;
    var idxAway = headerMap.away;
    var idxPred = _elite_findForebetColumn(headerMap, headers, config);
    
    if (idxHome === undefined || idxAway === undefined || idxPred === undefined) return null;
    
    var pairToPred = {};
    
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var home = String(row[idxHome] || '').trim();
      var away = String(row[idxAway] || '').trim();
      if (!home || !away) continue;
      
      var raw = row[idxPred];
      if (raw === '' || raw == null) continue;
      
      pairToPred[home + '|' + away] = raw;
      pairToPred[away + '|' + home] = raw; // Reverse lookup
    }
    
    _ENH_FOREBET_CACHE.ssId = ssId;
    _ENH_FOREBET_CACHE.builtAt = now;
    _ENH_FOREBET_CACHE.pairToPred = pairToPred;
    
    return _ENH_FOREBET_CACHE;
  } catch (e) {
    return null;
  }
}

/**
 * Extracts Forebet prediction from game object.
 * Falls back to UpcomingClean lookup if not found directly.
 * 
 * @param {Object} game - Game row object
 * @param {Object} [config] - Config object
 * @return {Object} { total, home, away, valid, source }
 */
function _enh_getForebetFromGame(game, config) {
  if (!game) return { total: 0, valid: false, source: 'none' };
  
  // Direct field check (multiple possible key names)
  var keys = [
    'predScore', 'predscore', 'pred score', 'Pred Score', 'pred-score',
    'forebet', 'forebetScore', 'forebet_score',
    'fbScore', 'fb_score', 'fb score', 'forebetTotal', 'fbTotal', 'predTotal'
  ];
  
  for (var i = 0; i < keys.length; i++) {
    var val = game[keys[i]];
    if (val !== undefined && val !== null && val !== '') {
      var parsed = _elite_parseForebetScore(val);
      if (parsed.valid) {
        return { 
          total: parsed.total, 
          home: parsed.home,
          away: parsed.away,
          valid: true, 
          source: 'direct:' + keys[i]
        };
      }
    }
  }
  
  // Fallback: lookup in UpcomingClean cache
  try {
    var ss = null;
    if (typeof getSpreadsheet === 'function') {
      ss = getSpreadsheet(null);
    } else {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
    
    if (!ss) return { total: 0, valid: false, source: 'none' };
    
    var cache = _enh_buildForebetCache(ss, config);
    if (!cache || !cache.pairToPred) return { total: 0, valid: false, source: 'none' };
    
    var home = String(game.home || '').trim();
    var away = String(game.away || '').trim();
    if (!home || !away) return { total: 0, valid: false, source: 'none' };
    
    var key = home + '|' + away;
    var raw = cache.pairToPred[key];
    
    if (raw) {
      var parsed2 = _elite_parseForebetScore(raw);
      if (parsed2.valid) {
        return {
          total: parsed2.total,
          home: parsed2.home,
          away: parsed2.away,
          valid: true,
          source: 'cache:' + key
        };
      }
    }
  } catch (e) {
    // Silent fail
  }
  
  return { total: 0, valid: false, source: 'none' };
}


/**
 * ============================================================================
 * CORE UTILITIES - Production v1.0
 * ============================================================================
 * Add these at the TOP of your script after T2OU_CACHE declaration
 */

/**
 * _ensureSpreadsheet_ - Safely converts Sheet/Spreadsheet/null to Spreadsheet
 * Prevents "ss.toast is not a function" errors
 */
function _ensureSpreadsheet_(ssOrSheet) {
  if (!ssOrSheet) {
    try { return SpreadsheetApp.getActiveSpreadsheet(); } 
    catch (e) { return null; }
  }
  
  // Already a Spreadsheet
  if (typeof ssOrSheet.getSheets === 'function' && 
      typeof ssOrSheet.getId === 'function') {
    return ssOrSheet;
  }
  
  // It's a Sheet - get parent
  if (typeof ssOrSheet.getParent === 'function') {
    try {
      var parent = ssOrSheet.getParent();
      if (parent && typeof parent.getSheets === 'function') return parent;
    } catch (e) { /* fall through */ }
  }
  
  try { return SpreadsheetApp.getActiveSpreadsheet(); } 
  catch (e) { return null; }
}

/**
 * Safe toast - handles Sheet vs Spreadsheet, server context
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
  } catch (e) { /* fall through */ }
  
  Logger.log('[Toast] ' + t + ': ' + m);
  return false;
}

/**
 * Safe alert - handles server context where UI unavailable
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
  
  // Exact match
  try {
    var exact = ss.getSheetByName(sheetName);
    if (exact) return exact;
  } catch (e) {}
  
  // Case-insensitive search
  try {
    var sheets = ss.getSheets() || [];
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getName() || '').toLowerCase().trim() === target) {
        return sheets[i];
      }
    }
  } catch (e) {}
  
  return null;
}

/**
 * Validates historical data quality for tuning (PATCHED v2.0)
 * 
 * Supports multiple shapes:
 *  A) Game objects: { home, away, quarters: {Q1:{total},...} }
 *  B) Row objects:  { homeTeam, awayTeam, quarter:'Q1', actualTotal: 112 }
 *  C) Generic:      { home, away, total: 220 }
 *
 * @param {Array} games - array of objects (games OR rows)
 * @param {number} minValidRatio - default 0.8
 * @return {Object} { ok, valid, total, ratio, reasons, examples }
 */
function _validateHistoricalDataQuality_(games, minValidRatio) {
  var fn = '_validateHistoricalDataQuality_';
  var threshold = (minValidRatio !== undefined) ? minValidRatio : 0.8;

  if (!games || !Array.isArray(games) || games.length === 0) {
    Logger.log('[' + fn + '] No games provided');
    return { ok: false, valid: 0, total: 0, ratio: 0, reasons: { no_data: 1 }, examples: {} };
  }

  var reasons = {
    ok: 0,
    missing_teams: 0,
    missing_totals: 0,
    invalid_totals: 0,
    missing_samples: 0,
    invalid_shape: 0
  };

  // store a few examples for debugging
  var examples = {
    missing_teams: [],
    missing_totals: [],
    invalid_totals: [],
    invalid_shape: []
  };

  function addExample_(bucket, g, note) {
    if (!examples[bucket] || examples[bucket].length >= 3) return;
    try {
      examples[bucket].push({
        note: note || '',
        keys: Object.keys(g || {}).slice(0, 20),
        home: g && (g.home || g.homeTeam || g.Home),
        away: g && (g.away || g.awayTeam || g.Away),
        quarter: g && g.quarter,
        total: g && (g.actualTotal || g.total || g.ftTotal),
        hasQuarters: !!(g && g.quarters)
      });
    } catch (e) {}
  }

  // Extract a list of totals we can validate from this object
  function extractTotals_(g) {
    if (!g) return [];

    // Case B: tuning sample row (single quarter)
    if (g.actualTotal !== undefined || g.total !== undefined || g.ftTotal !== undefined) {
      var t = (g.actualTotal !== undefined) ? Number(g.actualTotal)
            : (g.total !== undefined) ? Number(g.total)
            : Number(g.ftTotal);
      return [t];
    }

    // Case A: game with quarters
    if (g.quarters && typeof g.quarters === 'object') {
      var out = [];
      ['Q1','Q2','Q3','Q4'].forEach(function(Q){
        if (g.quarters[Q] && g.quarters[Q].total !== undefined) {
          out.push(Number(g.quarters[Q].total));
        }
      });
      return out;
    }

    // Some alternate nesting: g.quarters might be an array, etc.
    return [];
  }

  function hasTeams_(g) {
    var h = g && (g.home || g.homeTeam || g.Home);
    var a = g && (g.away || g.awayTeam || g.Away);
    return !!(String(h || '').trim() && String(a || '').trim());
  }

  // Acceptable bounds:
  // - Quarter total: 0..200 (safe upper for any league)
  // - Full game total: 0..400 (your old bound)
  // We’ll infer which by looking at magnitude.
  function isValidTotal_(t) {
    if (!isFinite(t)) return false;
    if (t < 0) return false;
    if (t <= 200) return true;   // quarter total or low-scoring game
    if (t <= 400) return true;   // full game total
    return false;
  }

  var valid = 0;

  for (var i = 0; i < games.length; i++) {
    var g = games[i] || {};

    // 1) teams
    if (!hasTeams_(g)) {
      reasons.missing_teams++;
      addExample_('missing_teams', g, 'No home/away fields detected');
      continue;
    }

    // 2) totals
    var totals = extractTotals_(g);
    if (!totals.length) {
      reasons.missing_totals++;
      // Helpful hint if it *looks* like a game object but quarters missing
      if (g.quarters !== undefined) addExample_('missing_totals', g, 'quarters exists but no Q1..Q4.total found');
      else addExample_('missing_totals', g, 'No total fields and no quarters totals');
      continue;
    }

    // 3) validate totals: require at least one valid number
    var anyValid = false;
    for (var j = 0; j < totals.length; j++) {
      if (isValidTotal_(totals[j])) { anyValid = true; break; }
    }

    if (!anyValid) {
      reasons.invalid_totals++;
      addExample_('invalid_totals', g, 'Totals present but out of bounds or NaN: ' + JSON.stringify(totals.slice(0, 6)));
      continue;
    }

    // 4) optional sample count check (don’t fail games without it; your earlier validator did)
    // We keep stats but we don't force it, because your game objects don’t carry samples.
    valid++;
    reasons.ok++;
  }

  var ratio = valid / games.length;
  var ok = ratio >= threshold;

  Logger.log('[' + fn + '] total=' + games.length + ' valid=' + valid + ' ratio=' + (ratio * 100).toFixed(1) + '% (threshold=' + (threshold * 100) + '%)');
  Logger.log('[' + fn + '] reasons: ' + JSON.stringify(reasons));

  // Log compact examples only when failing hard
  if (!ok) {
    Logger.log('[' + fn + '] examples: ' + JSON.stringify(examples));
  }

  return { ok: ok, valid: valid, total: games.length, ratio: ratio, reasons: reasons, examples: examples };
}


// ─────────────────────────────────────────────────────────────────────────────
// Unified Debug Logger (single global state, shared cap)
// ─────────────────────────────────────────────────────────────────────────────
var T2OU_LOG_STATE_ = T2OU_LOG_STATE_ || { used: 0, max: 50 };

function t2ou_dbg_(tag, msg, specificFlag) {
  var enabled = (typeof T2OU_DEBUG !== 'undefined' && T2OU_DEBUG) ||
                (typeof specificFlag !== 'undefined' && specificFlag);
  if (!enabled) return;
  if (T2OU_LOG_STATE_.used >= T2OU_LOG_STATE_.max) return;
  Logger.log('[' + tag + '] ' + msg);
  T2OU_LOG_STATE_.used++;
}



// ============================================================================
// 4. t2ou_scoreOverUnderPick_ (PRODUCTION v7.0)
// ============================================================================
var T2OU_VERBOSE = false;              // keep FALSE to stop spam
var T2OU_DIAG = true;                 // keep TRUE to trace line=10
var T2OU_TINY_LINE_THRESHOLD = 15;    // anything <= 15 is suspicious


/**
 * PATCHED (NO-SPAM + LINE=10 FORENSICS)
 *
 * Replaces your existing:
 *   function t2ou_scoreOverUnderPick_(model, line, cfg, calibrator)
 *
 * Changes:
 * - NO log spam unless T2OU_VERBOSE === true
 * - DIAG logs (once per signature) when line is tiny / line==10 / scale mismatch
 * - Rejects obvious scale mismatch: (mu >= 35 && line <= tinyThreshold)
 * - Accepts optional 5th argument: meta (callers will pass it)
 */
function t2ou_scoreOverUnderPick_(model, line, cfg, calibrator, meta) {
  var FN = 't2ou_scoreOverUnderPick_';
  meta = meta || {};
  var lineSource = String(meta.lineSource || '').toUpperCase();
  var isLeagueStats = (
    lineSource.indexOf('LEAGUE_STATS') !== -1 || 
    lineSource.indexOf('PROXY') !== -1 ||
    lineSource.indexOf('SUM') !== -1 ||
    lineSource.indexOf('FALLBACK') !== -1 ||
    lineSource === 'NONE' ||
    lineSource === ''
  );

  // ----- Controls -----
  var verbose = (typeof T2OU_VERBOSE !== 'undefined') ? !!T2OU_VERBOSE : false;
  var diagOn = (typeof T2OU_DIAG !== 'undefined') ? !!T2OU_DIAG : true;
  var tinyThr = (typeof T2OU_TINY_LINE_THRESHOLD !== 'undefined')
    ? Number(T2OU_TINY_LINE_THRESHOLD)
    : 15;
  if (!isFinite(tinyThr)) tinyThr = 15;

  // ----- "log once" store (global, survives across calls in same execution) -----
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  if (!g.__T2OU_DIAG_ONCE__) g.__T2OU_DIAG_ONCE__ = Object.create(null);

  function diagKey_(lineNum) {
    // Keep key stable to avoid thousands of logs
    return [
      meta.source || meta.caller || '',
      meta.lineSource || '',
      meta.sheet || '',
      meta.match || '',
      meta.quarter || '',
      String(lineNum)
    ].join('|');
  }

  function diagOnce_(key, msg, includeStack) {
    if (!diagOn) return;
    if (g.__T2OU_DIAG_ONCE__[key]) return;
    g.__T2OU_DIAG_ONCE__[key] = true;

    if (includeStack) {
      var st = '';
      try { st = (new Error('T2OU_STACK')).stack || ''; } catch (e) {}
      if (st) msg += '\n' + st.split('\n').slice(0, 7).join('\n');
    }
    Logger.log(msg);
  }

  function compactMeta_() {
    return {
      source: meta.source || meta.caller || '',
      caller: meta.caller || '',
      lineSource: meta.lineSource || '',
      rawLine: meta.rawLine,
      rawLineIn: meta.rawLineIn,
      fallbackUsed: meta.fallbackUsed,
      league: meta.league || '',
      quarter: meta.quarter || '',
      match: meta.match || '',
      sheet: meta.sheet || '',
      gameKey: meta.gameKey || '',
      dateKey: meta.dateKey || '',
      home: meta.home || '',
      away: meta.away || ''
    };
  }

  // ----- Preserve original "debugFlag" logic, but require T2OU_VERBOSE to actually log -----
  var debugFlag = false;
  if (typeof T2OU_DEBUG_SCORING !== 'undefined' && T2OU_DEBUG_SCORING) debugFlag = true;
  if (cfg && (cfg.debug_ou_engine === true || String(cfg.debug_ou_engine).toUpperCase() === 'TRUE')) debugFlag = true;
  if (cfg && (cfg.debug === true || String(cfg.debug).toUpperCase() === 'TRUE')) debugFlag = true;

  function log(msg) {
    if (debugFlag && verbose) Logger.log('[' + FN + '] ' + msg);
  }

  // ----- SANITIZE CONFIG -----
  if (typeof t2ou_sanitizeOUConfig_ === 'function') cfg = t2ou_sanitizeOUConfig_(cfg || {});
  else cfg = cfg || {};

  // ----- INPUT VALIDATION -----
  if (!model || typeof model !== 'object') {
    diagOnce_(
      'invalid-model|' + diagKey_(''),
      '[T2OU_DIAG] invalid model object => play=false. meta=' + JSON.stringify(compactMeta_()),
      false
    );
    return { play: false, reason: 'invalid_model' };
  }

  // Keep raw input for diagnostics
  if (meta.rawLineIn === undefined) meta.rawLineIn = line;

  var lineNum = _elite_toNum(line, NaN);
  if (!isFinite(lineNum)) {
    diagOnce_(
      'invalid-line|' + diagKey_('NaN'),
      '[T2OU_DIAG] invalid line => play=false. lineIn=' + JSON.stringify(line) +
        ' meta=' + JSON.stringify(compactMeta_()),
      true
    );
    return { play: false, reason: 'invalid_line' };
  }

  var mu = _elite_toNum(model.mu, NaN);
  var sigma = _elite_toNum(model.sigma, NaN);
  var samples = _elite_toNum(model.samples, 0);

  if (!isFinite(mu)) return { play: false, reason: 'invalid_mu' };
  if (!isFinite(sigma) || sigma <= 0) return { play: false, reason: 'invalid_sigma' };

  var minSamples = _elite_toNum(cfg.ou_min_samples, 1);
  if (samples < minSamples) {
    // No spam here; this happens a lot in tuning
    return { play: false, reason: 'insufficient_samples', samples: samples, minSamples: minSamples };
  }

  // ----- LINE=10 / TINY LINE FORENSICS (ONCE) -----
  var dk = diagKey_(lineNum);

  if (lineNum <= tinyThr) {
    diagOnce_(
      'tiny-line|' + dk,
      '[T2OU_LINE_DIAG] tiny line detected: line=' + lineNum +
        ' mu=' + _elite_round(mu, 2) +
        ' sigma=' + _elite_round(sigma, 2) +
        ' samples=' + samples +
        ' meta=' + JSON.stringify(compactMeta_()),
      true
    );
  }

  if (Math.abs(lineNum - 10) < 1e-9) {
    diagOnce_(
      'line10|' + dk,
      '[T2OU_LINE_DIAG] line==10 detected: line=' + lineNum +
        ' rawLineIn=' + JSON.stringify(meta.rawLineIn) +
        ' rawLine=' + JSON.stringify(meta.rawLine) +
        ' lineSource=' + JSON.stringify(meta.lineSource) +
        ' fallbackUsed=' + JSON.stringify(meta.fallbackUsed) +
        ' meta=' + JSON.stringify(compactMeta_()),
      true
    );
  }

  // Hard fix: prevent nonsense picks when line is obviously wrong scale
  if (mu >= 35 && lineNum <= tinyThr) {
    diagOnce_(
      'scale-mismatch|' + dk,
      '[T2OU_LINE_DIAG] SCALE MISMATCH => play=false: mu=' + _elite_round(mu, 2) +
        ' line=' + lineNum +
        ' meta=' + JSON.stringify(compactMeta_()),
      false
    );
    return { play: false, reason: 'scale_mismatch_tiny_line', line: lineNum, mu: mu, sigma: sigma, samples: samples };
  }

  log('ENTRY: mu=' + _elite_round(mu, 2) + ' sigma=' + _elite_round(sigma, 2) + ' line=' + lineNum + ' samples=' + samples);

  // ----- CONFIGURATION -----
  var pushWidth = _elite_clamp(_elite_toNum(cfg.ou_push_width, 0.5), 0, 1.5);
  var confScale = Math.max(1, _elite_toNum(cfg.ou_confidence_scale, 30));
  var odds = _elite_toNum(cfg.ou_american_odds, -110);
  if (odds === 0) odds = -110;
  var edgeThreshold = _elite_toNum(cfg.ou_edge_threshold, 0.02);
  var minEV = _elite_toNum(cfg.ou_min_ev, 0.005);

  // ----- STEP 1: RAW PROBABILITIES -----
  var isIntegerLine = Math.abs(lineNum - Math.round(lineNum)) < 0.001;
  var pUnderRaw, pOverRaw, pPushRaw;

  if (isIntegerLine && pushWidth > 0) {
    var zLo = (lineNum - pushWidth - mu) / sigma;
    var zHi = (lineNum + pushWidth - mu) / sigma;
    var cdfLo = _elite_normCdf(zLo);
    var cdfHi = _elite_normCdf(zHi);

    pUnderRaw = cdfLo;
    pPushRaw = Math.max(0, cdfHi - cdfLo);
    pOverRaw = Math.max(0, 1 - cdfHi);

    log('CALC integer line: zLo=' + _elite_round(zLo, 3) + ' zHi=' + _elite_round(zHi, 3) +
      ' pUnder=' + _elite_round(pUnderRaw, 4) + ' pPush=' + _elite_round(pPushRaw, 4) +
      ' pOver=' + _elite_round(pOverRaw, 4));
  } else {
    var z = (lineNum - mu) / sigma;
    var cdf = _elite_normCdf(z);

    pUnderRaw = cdf;
    pOverRaw = 1 - cdf;
    pPushRaw = 0;

    log('CALC half-point line: z=' + _elite_round(z, 3) +
      ' pUnder=' + _elite_round(pUnderRaw, 4) + ' pOver=' + _elite_round(pOverRaw, 4));
  }

  // ----- STEP 2: CLAMP AND NORMALIZE -----
  pUnderRaw = _elite_clamp(pUnderRaw, 0, 1);
  pOverRaw = _elite_clamp(pOverRaw, 0, 1);
  pPushRaw = _elite_clamp(pPushRaw, 0, 1);

  var pSum = pUnderRaw + pOverRaw + pPushRaw;
  if (pSum > 0 && Math.abs(pSum - 1) > 0.001) {
    pUnderRaw = pUnderRaw / pSum;
    pOverRaw = pOverRaw / pSum;
    pPushRaw = pPushRaw / pSum;
  }

  var nonPush = _elite_clamp(pUnderRaw + pOverRaw, 1e-12, 1);

  // ----- STEP 3: CONDITIONAL PROBABILITIES -----
  var pOverCondRaw = pOverRaw / nonPush;
  var pUnderCondRaw = pUnderRaw / nonPush;

  // ----- STEP 4: SHRINKAGE -----
  var sampleRatio = _elite_clamp(samples / confScale, 0, 1);
  var shrink = 0.5 + 0.5 * sampleRatio;

  var pOverCond = _elite_clamp(0.5 + (pOverCondRaw - 0.5) * shrink, 0, 1);
  var pUnderCond = _elite_clamp(0.5 + (pUnderCondRaw - 0.5) * shrink, 0, 1);

  // ----- PHASE 3.1: BIAS CORRECTION (Circular Confidence Mitigation) -----
  // When line is derived from league stats (no book line), we shrink pWin further
  // to avoid over-confident circularity in the Assayer.
  if (isLeagueStats) {
    var BIAS_SHRINK = 0.7; // Shrink 30% towards 50%
    pOverCond = 0.5 + (pOverCond - 0.5) * BIAS_SHRINK;
    pUnderCond = 0.5 + (pUnderCond - 0.5) * BIAS_SHRINK;
    log('PHASE 3.1: Applied League-Stats Bias Correction (x' + BIAS_SHRINK + ')');
  }

  log('CALC shrinkage: sampleRatio=' + _elite_round(sampleRatio, 3) +
    ' shrink=' + _elite_round(shrink, 3) +
    ' pOverCond=' + _elite_round(pOverCond, 4) +
    ' pUnderCond=' + _elite_round(pUnderCond, 4));

  // ----- STEP 5: DIRECTION -----
  var dir = (pOverCond >= pUnderCond) ? 'OVER' : 'UNDER';
  var pWinCond = (dir === 'OVER') ? pOverCond : pUnderCond;

  // ----- STEP 6: UNCONDITIONAL -----
  var pWin = nonPush * pWinCond;
  var pLose = nonPush * (1 - pWinCond);
  var pPush = pPushRaw;

  // ----- STEP 7: EV + EDGE -----
  var profit = (odds < 0) ? (100 / Math.abs(odds)) : (odds / 100);
  var ev = pWin * profit - pLose;

  var pBreakEven = (1 - pPush) / (1 + profit);
  var edge = pWin - pBreakEven;

  log('CALC EV/edge: profit=' + _elite_round(profit, 3) +
    ' pWin=' + _elite_round(pWin, 4) +
    ' pBE=' + _elite_round(pBreakEven, 4) +
    ' edge=' + _elite_round(edge, 4) +
    ' EV=' + _elite_round(ev, 4));

  // ----- STEP 8: GATES -----
  if (edge < edgeThreshold) {
    return {
      play: false,
      reason: 'edge_below_threshold',
      edge: _elite_round(edge, 4),
      threshold: edgeThreshold,
      dir: (dir === 'OVER') ? 'Over' : 'Under',
      ev: _elite_round(ev, 4),
      confPct: _elite_clamp(Math.round(pWinCond * 100), 45, 95)
    };
  }

  if (ev < minEV) {
    return {
      play: false,
      reason: 'ev_below_threshold',
      ev: _elite_round(ev, 4),
      minEV: minEV,
      dir: (dir === 'OVER') ? 'Over' : 'Under',
      edge: _elite_round(edge, 4),
      confPct: _elite_clamp(Math.round(pWinCond * 100), 45, 95)
    };
  }

  // ----- STEP 9: CONFIDENCE -----
  var rawConfPct = Math.round(pWinCond * 100);
  var confPct = _elite_clamp(rawConfPct, 45, 95);

  if (calibrator) {
    if (typeof calibrator.applyConfidence === 'function') confPct = calibrator.applyConfidence(confPct);
    else if (typeof calibrator === 'function') confPct = calibrator(confPct);
  }

  // ----- PHASE 3.3: PER-LEAGUE CONFIDENCE WEIGHTS -----
  // Check for league-specific weight in config: "league_weight_<LEAGUE_NAME>"
  var leagueName = String(meta.league || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (leagueName) {
    var lWeight = _elite_toNum(cfg['league_weight_' + leagueName], 1.0);
    if (lWeight < 1.0) {
      var oldConf = confPct;
      // Shrink distance from 50%
      confPct = 50 + (confPct - 50) * lWeight;
      log('PHASE 3.3: Applied League Weight (' + leagueName + ') = ' + lWeight + ': ' + oldConf + '% -> ' + Math.round(confPct) + '%');
    }
  }

  // ----- STEP 10: TIERING -----
  var tier = 'WEAK';
  var sym = '○';

  if (edge >= 0.06 && confPct >= 60 && ev >= 0.05) { tier = 'STRONG'; sym = '★'; }
  else if (edge >= 0.035 && confPct >= 55 && ev >= 0.02) { tier = 'MEDIUM'; sym = '●'; }

  // ----- STEP 11: OUTPUT -----
  var dirDisplay = (dir === 'OVER') ? 'Over' : 'Under';
  var text = dirDisplay + ' ' + lineNum.toFixed(1) + ' ' + sym + ' (' + Math.round(confPct) + '%)';

  var tierWeight = (tier === 'STRONG') ? 1.0 : (tier === 'MEDIUM') ? 0.7 : 0.4;
  var pointsFromLine = Math.abs(mu - lineNum);
  var edgeScore = _elite_round(pointsFromLine * tierWeight * (confPct / 100), 2);

  log('EXIT: ' + text + ' tier=' + tier + ' edgeScore=' + edgeScore);

  return {
    play: true,
    dir: dirDisplay,
    direction: dirDisplay,
    line: lineNum,
    mu: _elite_round(mu, 2),
    sigma: _elite_round(sigma, 2),
    samples: samples,
    pWin: _elite_round(pWin, 4),
    pWinCond: _elite_round(pWinCond, 4),
    pPush: _elite_round(pPush, 4),
    pLose: _elite_round(pLose, 4),
    pBreakEven: _elite_round(pBreakEven, 4),
    edge: _elite_round(edge, 4),
    ev: _elite_round(ev, 4),
    rawConfPct: rawConfPct,
    confPct: _elite_round(confPct, 1),
    tier: tier,
    text: text,
    edgeScore: edgeScore
  };
}


// ============================================================================
// INTEGRATION EXAMPLE
// ============================================================================

/**
 * Example: How to wire calibration into your scoring pipeline
 */
function example_calibratedScoring() {
  // 1. Build historical picks from your backtest
  var historicalPicks = [
    { confidence: 65, hit: true },
    { confidence: 65, hit: false },
    { confidence: 70, hit: true },
    // ... hundreds more
  ];
  
  // 2. Create calibrator
  var calibrator = calibrateConfidence(historicalPicks, {
    bucketWidth: 5,
    minSamples: 30,
    allowInflation: false,
    debug: true
  });
  
  if (!calibrator.ok) {
    Logger.log('Calibration failed: ' + calibrator.error);
    calibrator = null;  // Will use uncalibrated confidence
  }
  
  // 3. Use in scoring
  var model = { mu: 215.5, sigma: 8.2, samples: 45 };
  var line = 220;
  var cfg = { ou_edge_threshold: 0.02, ou_min_ev: 0.005 };
  
  var result = t2ou_scoreOverUnderPick_(model, line, cfg, calibrator);
  
  Logger.log('Result: ' + JSON.stringify(result));
}


/**
 * ============================================================================
 * 3) t2ou_buildTotalsStatsFromCleanSheets_ — PRODUCTION v2.5
 * ============================================================================
 * 
 * Improvements:
 *  - Robust header mapping with fallback
 *  - Detailed diagnostics per sheet
 *  - Score bounds validation (0-99 per quarter, 0-200 total)
 *  - Team name normalization
 */
function t2ou_buildTotalsStatsFromCleanSheets_(ss) {
  ss = _ensureSpreadsheet_(ss);
  if (!ss) throw new Error('t2ou_buildTotalsStatsFromCleanSheets_: Spreadsheet not available.');
  
  var TAG = 't2ou_buildTotalsStatsFromCleanSheets_';
  var debugFlag = (typeof T2OU_DEBUG_CACHE !== 'undefined' && T2OU_DEBUG_CACHE);
  
  var teamStats = {};
  var leagueTotals = { Q1: [], Q2: [], Q3: [], Q4: [] };
  
  var diag = {
    sheetsSeen: 0,
    sheetsMatched: 0,
    sheetsProcessed: 0,
    sheetsSkipped: 0,
    rowsScanned: 0,
    rowsUsed: 0,
    rowsSkippedNoTeams: 0,
    rowsSkippedInvalidScores: 0
  };
  
  // Header map fallback for robustness
  function buildHeaderMap(headerRow) {
    var map = {};
    for (var i = 0; i < headerRow.length; i++) {
      var raw = String(headerRow[i] || '').trim();
      if (!raw) continue;
      
      // Store both original lowercase and stripped version
      var lower = raw.toLowerCase();
      var stripped = lower.replace(/[\s\-_\/()]+/g, '');
      
      map[lower] = i;
      if (stripped !== lower) map[stripped] = i;
    }
    return map;
  }
  
  function normTeam(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
  }
  
  function isValidScore(x) {
    return isFinite(x) && x >= 0 && x <= 99;
  }
  
  function initTeam(team) {
    if (!teamStats[team]) {
      teamStats[team] = { Home: {}, Away: {} };
    }
  }
  
  function pushStat(team, venue, Q, total) {
    initTeam(team);
    if (!teamStats[team][venue][Q]) {
      teamStats[team][venue][Q] = { totals: [], sum: 0, count: 0 };
    }
    var o = teamStats[team][venue][Q];
    o.totals.push(total);
    o.sum += total;
    o.count++;
  }
  
  var sheets = ss.getSheets() || [];
  diag.sheetsSeen = sheets.length;
  
  for (var si = 0; si < sheets.length; si++) {
    var sh = sheets[si];
    if (!sh) continue;
    
    var name = '';
    try { name = sh.getName(); } catch (e) { continue; }
    
    if (!name || !/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i.test(name)) continue;
    diag.sheetsMatched++;
    
    var values;
    try { values = sh.getDataRange().getValues(); } catch (e) { continue; }
    if (!values || values.length < 2) {
      diag.sheetsSkipped++;
      continue;
    }
    
    // Try t2ou_headerMap_ first, fallback to our own
    var hm;
    try {
      hm = t2ou_headerMap_(values[0]);
    } catch (e) {
      hm = buildHeaderMap(values[0]);
    }
    if (!hm || typeof hm !== 'object') {
      hm = buildHeaderMap(values[0]);
    }
    
    // Check required columns
    var required = ['home', 'away', 'q1h', 'q1a', 'q2h', 'q2a', 'q3h', 'q3a', 'q4h', 'q4a'];
    var missing = required.filter(function(k) { return hm[k] === undefined; });
    
    if (missing.length > 0) {
      t2ou_dbg_(TAG, 'Skip "' + name + '": missing ' + missing.join(', '), debugFlag);
      diag.sheetsSkipped++;
      continue;
    }
    
    diag.sheetsProcessed++;
    var sheetRowsUsed = 0;
    
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      diag.rowsScanned++;
      
      var home = normTeam(row[hm.home]);
      var away = normTeam(row[hm.away]);
      
      if (!home || !away) {
        diag.rowsSkippedNoTeams++;
        continue;
      }
      
      var anyValidQuarter = false;
      
      for (var q = 1; q <= 4; q++) {
        var hScore = Number(row[hm['q' + q + 'h']]);
        var aScore = Number(row[hm['q' + q + 'a']]);
        
        if (!isValidScore(hScore) || !isValidScore(aScore)) {
          continue;
        }
        
        var total = hScore + aScore;
        if (total < 0 || total > 200) continue;
        
        var qKey = 'Q' + q;
        
        pushStat(home, 'Home', qKey, total);
        pushStat(away, 'Away', qKey, total);
        leagueTotals[qKey].push(total);
        
        anyValidQuarter = true;
      }
      
      if (anyValidQuarter) {
        diag.rowsUsed++;
        sheetRowsUsed++;
      } else {
        diag.rowsSkippedInvalidScores++;
      }
    }
    
    t2ou_dbg_(TAG, 'Sheet "' + name + '": ' + sheetRowsUsed + '/' + (values.length - 1) + ' rows used', debugFlag);
  }
  
  // Compute per-team derived stats
  Object.keys(teamStats).forEach(function(team) {
    ['Home', 'Away'].forEach(function(venue) {
      ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(Q) {
        var o = teamStats[team][venue][Q];
        if (!o || o.count < 1) return;
        o.avgTotal = o.sum / o.count;
        o.samples = o.count;
        o.stdDev = t2ou_stdDev_(o.totals);
      });
    });
  });
  
  // League-wide stats with fallback defaults
  var league = {};
  var defaults = { Q1: 55, Q2: 55, Q3: 55, Q4: 53 };
  
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(Q) {
    var arr = leagueTotals[Q] || [];
    var mu = t2ou_mean_(arr);
    var sd = t2ou_stdDev_(arr);
    
    if (!isFinite(mu) || arr.length < 10) mu = defaults[Q];
    if (!isFinite(sd) || sd <= 0) sd = 8;
    
    league[Q] = { mu: mu, sd: sd, samples: arr.length };
  });
  
  Logger.log('[' + TAG + '] v2.5 COMPLETE: ' +
             Object.keys(teamStats).length + ' teams, ' +
             diag.sheetsProcessed + '/' + diag.sheetsMatched + ' sheets, ' +
             diag.rowsUsed + '/' + diag.rowsScanned + ' rows');
  
  t2ou_dbg_(TAG, 'Diag: ' + JSON.stringify(diag), debugFlag);
  
  return { teamStats: teamStats, league: league };
}


function mg_teamKey_(name) {
  var s = String(name || '').toLowerCase().trim();
  // Normalize unicode (V8 usually supports this; guard just in case)
  try { s = s.normalize('NFKD'); } catch (e) {}
  // Remove diacritics
  s = s.replace(/[\u0300-\u036f]/g, '');
  // Keep only alphanumerics
  return s.replace(/[^a-z0-9]/g, '');
}


function mg_resolveTeamData_(stats, team) {
  if (!stats || !team) return null;

  var raw = String(team).trim();
  if (!raw) return null;

  // Fast paths (handles your non-enumerable lowercase aliases too)
  if (stats[raw]) return stats[raw];
  var lower = raw.toLowerCase();
  if (stats[lower]) return stats[lower];

  var canon = mg_teamKey_(raw);
  if (!canon) return null;

  // Build or reuse an index: canonKey -> best matching real key in stats
  var IDX_PROP = '__mgTeamIndex__';
  var idx = stats[IDX_PROP];

  if (!idx) {
    idx = {};
    var keys = Object.keys(stats);

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];

      // Skip obvious metadata keys if you have them
      if (k === 'league' || k === 'aggregate' || k === 'overall') continue;

      var kc = mg_teamKey_(k);
      if (!kc) continue;

      // If collisions happen, keep the "shortest" label as canonical
      if (!idx[kc] || String(k).length < String(idx[kc]).length) {
        idx[kc] = k;
      }
    }

    // Store non-enumerably to avoid polluting Object.keys(stats)
    try {
      Object.defineProperty(stats, IDX_PROP, { value: idx, enumerable: false, configurable: true });
    } catch (e) {
      stats[IDX_PROP] = idx;
    }
  }

  // Exact canonical match
  var hitKey = idx[canon];
  if (hitKey && stats[hitKey]) return stats[hitKey];

  // Sponsor/prefix tolerant fallback: choose the closest containing match
  var bestKey = null;
  var bestDelta = 1e9;
  var idxKeys = Object.keys(idx);

  for (var j = 0; j < idxKeys.length; j++) {
    var kCanon = idxKeys[j];
    if (kCanon.indexOf(canon) >= 0 || kCanon.endsWith(canon)) {
      var delta = Math.abs(kCanon.length - canon.length);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestKey = idx[kCanon];
      }
    }
  }

  return bestKey ? stats[bestKey] : null;
}


var __t2ou_missingQCache = {};

function t2ou_getTeamVenueQuarter_(teamStats, team, venue, Q) {
  var TAG = 't2ou_getTeamVenueQuarter_';
  var debugFlag = (typeof T2OU_DEBUG_LOOKUP !== 'undefined' && T2OU_DEBUG_LOOKUP);

  if (!teamStats || !team || !venue || !Q) return null;

  var teamKeyRaw = String(team).trim();
  if (!teamKeyRaw) return null;

  var venueRaw = String(venue).trim();
  var venueKey =
    (/^home$/i.test(venueRaw) ? 'Home' :
     /^away$/i.test(venueRaw) ? 'Away' : venueRaw);

  var qKey = String(Q).trim().toUpperCase();
  var cacheKey = teamKeyRaw + '|' + venueKey + '|' + qKey;

  if (__t2ou_missingQCache[cacheKey]) return null;

  var teamKeyRaw = String(team).trim();
  if (!teamKeyRaw) return null;

  var venueRaw = String(venue).trim();
  var venueKey =
    (/^home$/i.test(venueRaw) ? 'Home' :
     /^away$/i.test(venueRaw) ? 'Away' : venueRaw);

  var qKey = String(Q).trim().toUpperCase();

  // 1) Direct + lowercase-alias direct (works with non-enum aliases too)
  var teamData = teamStats[teamKeyRaw] || teamStats[teamKeyRaw.toLowerCase()];

  // 2) Canonical match (punctuation/whitespace/unicode hyphen safe)
  if (!teamData) {
    var targetCanon = mg_teamKey_(teamKeyRaw);
    var keys = Object.keys(teamStats);

    var bestKey = null;
    var bestDelta = 1e9;

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var kCanon = mg_teamKey_(k);

      if (kCanon === targetCanon) { bestKey = k; bestDelta = 0; break; }

      // Sponsor/prefix tolerant fallback: "ubtclujnapoca" contains "clujnapoca"
      if (targetCanon && kCanon && (kCanon.endsWith(targetCanon) || kCanon.indexOf(targetCanon) >= 0)) {
        var delta = Math.abs(kCanon.length - targetCanon.length);
        if (delta < bestDelta) { bestDelta = delta; bestKey = k; }
      }
    }

    if (bestKey) teamData = teamStats[bestKey];
  }

  if (!teamData) {
    if (!__t2ou_missingQCache[cacheKey]) {
      t2ou_dbg_(TAG, 'Team not found: "' + teamKeyRaw + '"', debugFlag);
      if (debugFlag) {
        var hint = Object.keys(teamStats).filter(function(k) {
          return mg_teamKey_(k).indexOf(mg_teamKey_(teamKeyRaw)) >= 0;
        }).slice(0, 5);
        if (hint.length) t2ou_dbg_(TAG, 'Closest keys: ' + hint.join(' | '), true);
      }
      __t2ou_missingQCache[cacheKey] = true;
    }
    return null;
  }

  if (!teamData[venueKey]) {
    if (!__t2ou_missingQCache[cacheKey]) {
      t2ou_dbg_(TAG, 'Venue not found: team="' + teamKeyRaw + '" venue="' + venueKey + '"', debugFlag);
      __t2ou_missingQCache[cacheKey] = true;
    }
    return null;
  }

  if (!teamData[venueKey][qKey]) {
    if (!__t2ou_missingQCache[cacheKey]) {
      t2ou_dbg_(TAG, 'Quarter not found: team="' + teamKeyRaw + '" venue="' + venueKey + '" Q="' + qKey + '"', debugFlag);
      __t2ou_missingQCache[cacheKey] = true;
    }
    return null;
  }

  return teamData[venueKey][qKey];
}

// ===================== PRESERVE MANUAL LINES =====================
function t2ou_preserveUpcomingBookLines_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var saved = {};

  var sh = t2ou_getSheetInsensitive_(ss, 'UpcomingClean');
  if (!sh) return saved;

  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return saved;

  var h = t2ou_headerMap_(data[0]);
  if (h.home === undefined || h.away === undefined) return saved;

  // 'ftscore' matches t2ou_headerMap_ which normalises "FT Score" → "ftscore"
  // 'ft score' kept as fallback for any non-t2ou header map
  var cols = ['q1', 'q2', 'q3', 'q4', 'ot', 'ftscore', 'ft score', 'ft_score', 'status'].filter(function(c) { return h[c] !== undefined; });

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var home = String(row[h.home] || '').trim();
    var away = String(row[h.away] || '').trim();
    if (!home || !away) continue;

    var key = t2ou_upcomingKey_(row, h);
    var obj = {};
    var any = false;

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var v = row[h[c]];
      if (v !== '' && v !== null && v !== undefined) {
        obj[c] = v;
        any = true;
      }
    }
    if (any) saved[key] = obj;
  }

  return saved;
}

function t2ou_restoreUpcomingBookLines_(parsed2D, saved) {
  if (!saved || !Object.keys(saved).length) return parsed2D;
  if (!parsed2D || parsed2D.length < 2) return parsed2D;

  var h = t2ou_headerMap_(parsed2D[0]);
  if (h.home === undefined || h.away === undefined) return parsed2D;

  // 'ftscore' matches t2ou_headerMap_ which normalises "FT Score" → "ftscore"
  // 'ft score' kept as fallback for any non-t2ou header map
  var cols = ['q1', 'q2', 'q3', 'q4', 'ot', 'ftscore', 'ft score', 'ft_score', 'status'].filter(function(c) { return h[c] !== undefined; });

  for (var r = 1; r < parsed2D.length; r++) {
    var row = parsed2D[r];
    var home = String(row[h.home] || '').trim();
    var away = String(row[h.away] || '').trim();
    if (!home || !away) continue;

    var key = t2ou_upcomingKey_(row, h);
    var obj = saved[key];
    if (!obj) continue;

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var cur = row[h[c]];
      if ((cur === '' || cur === null || cur === undefined) && obj[c] !== undefined) {
        row[h[c]] = obj[c];
      }
    }
  }
  return parsed2D;
}

function t2ou_upcomingKey_(row, h) {
  var home = String(row[h.home] || '').trim();
  var away = String(row[h.away] || '').trim();

  var dateKey = '';
  if (h.date !== undefined && row[h.date]) {
    try {
      dateKey = Utilities.formatDate(new Date(row[h.date]), Session.getScriptTimeZone(), 'yyyyMMdd');
    } catch (e) { dateKey = ''; }
  }

  var timeKey = (h.time !== undefined) ? String(row[h.time] || '').trim() : '';
  var leagueKey = (h.league !== undefined) ? String(row[h.league] || '').trim() : '';

  return home + '|' + away + '|' + dateKey + '|' + timeKey + '|' + leagueKey;
}

/**
 * ============================================================================
 * TIMING & SAMPLING HELPERS - Add these globally
 * ============================================================================
 */

/** Returns current time in milliseconds */
function _t2ou_nowMs_() {
  return Date.now();
}

/** Check if we've exceeded our time budget */
function _t2ou_shouldStop_(startedMs, budgetMs) {
  return (Date.now() - startedMs) > budgetMs;
}

/** 
 * Sample games for faster tuning (deterministic, spread across dataset)
 * @param {Array} games - Full games array
 * @param {number} maxN - Maximum games to return
 * @return {Array} Sampled games
 */
function _t2ou_sampleGames_(games, maxN) {
  if (!games || games.length <= maxN) return games;
  var out = [];
  var step = Math.ceil(games.length / maxN);
  for (var i = 0; i < games.length; i += step) {
    out.push(games[i]);
  }
  return out;
}

/**
 * Reset tuner logging state (call at start of tuning run)
 */
function _t2ou_resetTunerLogState_() {
  T2OU_TUNER_LOG_STATE = {
    cfgCount: 0,
    pickLogsUsed: 0,
    maxPickLogsTotal: 15,
    suppressedNoticeShown: false,
    versionStamped: false,
    sampleGameIdxs: null
  };
}

// ===================== TUNER =====================
/**
 * ============================================================================
 * tuneTier2OUConfig - PRODUCTION v7.0 (TIMEOUT-SAFE)
 * ============================================================================
 * FIXES:
 * - Hard time budget (5.5 min) with early exit - writes best-so-far
 * - Reduced grid for faster execution (16 configs instead of 256)
 * - Optional game sampling for large datasets
 * - Zero sheet access during evaluation loop
 * - Extensive timing diagnostics
 * - Version stamp in logs
 */
function tuneTier2OUConfig(ss) {
  ss = _ensureSpreadsheet_(ss);
  var fn = 'tuneTier2OUConfig';
  var VERSION = 'v7.0-TIMEOUT-SAFE';
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TIME BUDGET SETUP - Critical for avoiding Apps Script timeout
  // ═══════════════════════════════════════════════════════════════════════════
  var START_MS = _t2ou_nowMs_();
  var MAX_RUNTIME_MS = 5.5 * 60 * 1000; // 5.5 minutes (safe under 6 min limit)
  var WARN_RUNTIME_MS = 4.5 * 60 * 1000; // Warning at 4.5 minutes
  
  function timeExceeded_() { 
    return _t2ou_shouldStop_(START_MS, MAX_RUNTIME_MS); 
  }
  
  function elapsedSec_() {
    return ((Date.now() - START_MS) / 1000).toFixed(1);
  }
  
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('  Tier 2 O/U Tuner ' + VERSION);
  Logger.log('  Build: ' + new Date().toISOString());
  Logger.log('  Time budget: ' + (MAX_RUNTIME_MS / 1000) + 's');
  Logger.log('═══════════════════════════════════════════════════════════════');
  
  // Reset logging state for fresh run
  _t2ou_resetTunerLogState_();
  
  if (!ss) {
    _safeAlert_('Tuner', 'Spreadsheet not available.');
    return { success: false, reason: 'no_spreadsheet' };
  }
  
  // Complete default config with ALL required parameters
  var defaultCfg = {
    ou_edge_threshold: 0.03,
    ou_min_ev: 0.01,
    ou_min_samples: 5,
    ou_confidence_scale: 30,
    ou_shrink_k: 8,
    ou_sigma_floor: 6,
    ou_sigma_scale: 1.0,
    ou_american_odds: -110,
    ou_push_width: 0.5
  };
  
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Load historical games
    // ─────────────────────────────────────────────────────────────────────────
    Logger.log('[' + fn + '] Loading historical games...');
    
    if (typeof t2ou_buildHistoricalGamesForTuning_ !== 'function') {
      throw new Error('t2ou_buildHistoricalGamesForTuning_() not found. Check code deployment.');
    }
    
    var allGames = t2ou_buildHistoricalGamesForTuning_(ss);
    var totalGameCount = allGames ? allGames.length : 0;
    
    Logger.log('[' + fn + '] Total games loaded: ' + totalGameCount + ' (elapsed: ' + elapsedSec_() + 's)');
    
    // Validate data quality
    var dq = _validateHistoricalDataQuality_(allGames, 0.8);
    Logger.log('[' + fn + '] Valid games: ' + dq.valid + ' (' + (dq.ratio * 100).toFixed(1) + '%)');
    
    var MIN_GAMES = 50;
    if (!allGames || totalGameCount < MIN_GAMES || !dq.ok) {
      Logger.log('[' + fn + '] INSUFFICIENT DATA - aborting tuning');
      
      _safeAlert_('Insufficient Data',
        'Found ' + totalGameCount + ' games, ' + dq.valid + ' valid (' + (dq.ratio * 100).toFixed(1) + '%)\n' +
        'Need ≥' + MIN_GAMES + ' games with ≥80% valid.\n\n' +
        'Using default configuration.');
      
      return { 
        success: false, 
        reason: 'insufficient_data', 
        gamesFound: totalGameCount, 
        dataQuality: dq, 
        defaultConfig: defaultCfg 
      };
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1B: Sample games if dataset is large (PERFORMANCE OPTIMIZATION)
    // ─────────────────────────────────────────────────────────────────────────
    var MAX_TUNE_GAMES = 600; // Adjust this: lower = faster, higher = more accurate
    var games = _t2ou_sampleGames_(allGames, MAX_TUNE_GAMES);
    var count = games.length;
    
    if (count < totalGameCount) {
      Logger.log('[' + fn + '] Sampled ' + count + ' games from ' + totalGameCount + ' for tuning (faster)');
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Build/verify cache (ONCE - before grid loop)
    // ─────────────────────────────────────────────────────────────────────────
    Logger.log('[' + fn + '] Checking/building cache...');
    
    if (!T2OU_CACHE.teamStats || !T2OU_CACHE.league || Object.keys(T2OU_CACHE.teamStats).length === 0) {
      Logger.log('[' + fn + '] Building fresh cache...');
      var built = t2ou_buildTotalsStatsFromCleanSheets_(ss);
      T2OU_CACHE.teamStats = built.teamStats || {};
      T2OU_CACHE.league = built.league || {};
      T2OU_CACHE.builtAt = new Date();
    }
    
    var teamCount = Object.keys(T2OU_CACHE.teamStats).length;
    Logger.log('[' + fn + '] Teams in cache: ' + teamCount);
    Logger.log('[' + fn + '] League stats: ' + JSON.stringify(T2OU_CACHE.league));
    Logger.log('[' + fn + '] Cache ready (elapsed: ' + elapsedSec_() + 's)');
    
    if (teamCount === 0) {
      _safeAlert_('No Team Stats', 'Cache has 0 teams. Check Clean sheets have data.');
      return { success: false, reason: 'no_team_stats', defaultConfig: defaultCfg };
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Grid search - REDUCED SIZE for speed
    // ─────────────────────────────────────────────────────────────────────────
    // COARSE GRID (16 configs) - much faster than 256
    // You can expand this later if you have more time budget
    var grid = {
      ou_edge_threshold: [0.02, 0.04],      // 2 values (was 4)
      ou_min_ev: [0.005, 0.015],            // 2 values (was 4)
      ou_min_samples: [3, 7],               // 2 values (was 4)
      ou_confidence_scale: [20, 40]         // 2 values (was 4)
    };
    
    // Fixed values for shrink/sigma (keeps search space manageable)
    var fixedShrinkK = 8;
    var fixedSigmaFloor = 6;
    var fixedSigmaScale = 1.0;
    
    var totalConfigs = grid.ou_edge_threshold.length * grid.ou_min_ev.length * 
                       grid.ou_min_samples.length * grid.ou_confidence_scale.length;
    
    Logger.log('[' + fn + '] Testing ' + totalConfigs + ' configurations on ' + count + ' games...');
    _safeToast_(ss, 'Testing ' + totalConfigs + ' configs on ' + count + ' games...', 'O/U Tuner', 60);
    
    var results = [];
    var tested = 0;
    var evalErrors = 0;
    var lastError = '';
    var firstConfigLogged = false;
    var timedOut = false;
    var warnShown = false;
    
    // Aggregate diagnostics
    var diagAgg = {
      nullScore: 0,
      picksLt10: 0,
      picks0: 0,
      totalPicks: 0,
      reasons: {},
      slowConfigs: 0,
      avgEvalMs: 0,
      totalEvalMs: 0
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // GRID LOOP with time budget checking
    // ─────────────────────────────────────────────────────────────────────────
    GRID_LOOP:
    for (var ei = 0; ei < grid.ou_edge_threshold.length; ei++) {
      for (var evi = 0; evi < grid.ou_min_ev.length; evi++) {
        for (var si = 0; si < grid.ou_min_samples.length; si++) {
          for (var ci = 0; ci < grid.ou_confidence_scale.length; ci++) {
            
            // ═══════════════════════════════════════════════════════════════
            // TIME CHECK - Every config (lightweight check)
            // ═══════════════════════════════════════════════════════════════
            if (timeExceeded_()) {
              timedOut = true;
              Logger.log('[' + fn + '] ⚠️ TIME BUDGET HIT at ' + elapsedSec_() + 's. Stopping. Tested=' + tested);
              break GRID_LOOP;
            }
            
            // Warning at 4.5 minutes
            if (!warnShown && _t2ou_shouldStop_(START_MS, WARN_RUNTIME_MS)) {
              warnShown = true;
              Logger.log('[' + fn + '] ⚠️ WARNING: 4.5min elapsed. Remaining: ~1min. Tested=' + tested + '/' + totalConfigs);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // BUILD TEST CONFIG with ALL required parameters
            // ═══════════════════════════════════════════════════════════════
            var testCfg = {
              ou_edge_threshold: grid.ou_edge_threshold[ei],
              ou_min_ev: grid.ou_min_ev[evi],
              ou_min_samples: grid.ou_min_samples[si],
              ou_confidence_scale: grid.ou_confidence_scale[ci],
              ou_shrink_k: fixedShrinkK,
              ou_sigma_floor: fixedSigmaFloor,
              ou_sigma_scale: fixedSigmaScale,
              ou_american_odds: -110,
              ou_push_width: 0.5
            };
            
            // Log first config to verify structure
            if (!firstConfigLogged) {
              Logger.log('[' + fn + '] First test config: ' + JSON.stringify(testCfg));
              firstConfigLogged = true;
            }
            
            // ═══════════════════════════════════════════════════════════════
            // EVALUATE - with timing
            // ═══════════════════════════════════════════════════════════════
            var score = null;
            var evalStart = Date.now();
            
            try {
              score = t2ou_evaluateConfigOnHistory_(testCfg, games, T2OU_CACHE);
            } catch (e) {
              evalErrors++;
              lastError = e.message || String(e);
              if (evalErrors <= 3) {
                Logger.log('[' + fn + '] Eval error #' + evalErrors + ': ' + lastError);
              }
            }
            
            var evalMs = Date.now() - evalStart;
            diagAgg.totalEvalMs += evalMs;
            tested++;
            
            // Track slow configs
            if (evalMs > 500) {
              diagAgg.slowConfigs++;
              if (diagAgg.slowConfigs <= 3) {
                Logger.log('[' + fn + '] SLOW eval: ' + evalMs + 'ms for cfg=' + JSON.stringify(testCfg));
              }
            }
            
            // Progress logging every 25%
            if (tested % Math.max(1, Math.floor(totalConfigs / 4)) === 0) {
              var pct = ((tested / totalConfigs) * 100).toFixed(0);
              Logger.log('[' + fn + '] Progress: ' + tested + '/' + totalConfigs + ' (' + pct + '%) at ' + elapsedSec_() + 's');
            }
            
            // ═══════════════════════════════════════════════════════════════
            // PROCESS RESULTS
            // ═══════════════════════════════════════════════════════════════
            if (!score) {
              diagAgg.nullScore++;
              continue;
            }
            
            diagAgg.totalPicks += (score.picks || 0);
            
            // Aggregate rejection reasons
            if (score.diag && score.diag.reasons) {
              Object.keys(score.diag.reasons).forEach(function(k) {
                diagAgg.reasons[k] = (diagAgg.reasons[k] || 0) + score.diag.reasons[k];
              });
            }
            
            if ((score.picks || 0) === 0) {
              diagAgg.picks0++;
              continue;
            }
            
            if ((score.picks || 0) < 10) {
              diagAgg.picksLt10++;
              continue;
            }
            
            // Calculate composite score for ranking
            var composite = t2ou_computeCompositeScore_(score);
            
            results.push({
              config: testCfg,
              brier: score.brier,
              picks: score.picks,
              accuracy: score.accuracy,
              roi: score.roi,
              pushes: score.pushes || 0,
              compositeScore: composite,
              stats: {
                weightedScore: composite,
                hitRate: (score.accuracy || 0) * 100,
                coverage: (score.picks / (count * 4)) * 100,
                avgEV: score.roi || 0,
                brier: score.brier,
                picks: score.picks,
                pushes: score.pushes || 0
              }
            });
          }
        }
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Report results
    // ─────────────────────────────────────────────────────────────────────────
    diagAgg.avgEvalMs = tested > 0 ? (diagAgg.totalEvalMs / tested).toFixed(1) : 0;
    
    Logger.log('[' + fn + '] ═══════════════════════════════════════════════════');
    Logger.log('[' + fn + '] TUNING COMPLETE (elapsed: ' + elapsedSec_() + 's)');
    Logger.log('[' + fn + '] ═══════════════════════════════════════════════════');
    Logger.log('[' + fn + '] Tested: ' + tested + '/' + totalConfigs + (timedOut ? ' (TIMED OUT)' : ''));
    Logger.log('[' + fn + '] Eval errors: ' + evalErrors + (lastError ? ' (last: ' + lastError + ')' : ''));
    Logger.log('[' + fn + '] Viable configs: ' + results.length);
    Logger.log('[' + fn + '] Null scores: ' + diagAgg.nullScore);
    Logger.log('[' + fn + '] Zero picks: ' + diagAgg.picks0);
    Logger.log('[' + fn + '] <10 picks: ' + diagAgg.picksLt10);
    Logger.log('[' + fn + '] Slow configs (>500ms): ' + diagAgg.slowConfigs);
    Logger.log('[' + fn + '] Avg eval time: ' + diagAgg.avgEvalMs + 'ms');
    Logger.log('[' + fn + '] Rejection reasons: ' + JSON.stringify(diagAgg.reasons));
    
    if (results.length === 0) {
      var msg = (timedOut ? 'Timed out before finding viable configs.\n\n' : '') +
        'All ' + tested + ' tested configs produced <10 picks.\n\n' +
        'Diagnostics:\n' +
        '• Null scores: ' + diagAgg.nullScore + '\n' +
        '• Zero picks: ' + diagAgg.picks0 + '\n' +
        '• <10 picks: ' + diagAgg.picksLt10 + '\n\n' +
        'Check execution log for details.\nUsing defaults.';
      
      _safeAlert_('No Viable Configs', msg);
      
      return { 
        success: false, 
        reason: timedOut ? 'timeout_no_viable' : 'no_viable', 
        tested: tested,
        timedOut: timedOut,
        diagnostics: diagAgg,
        defaultConfig: defaultCfg 
      };
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Sort with tie-breaking and deduplicate
    // ─────────────────────────────────────────────────────────────────────────
    results.sort(function(a, b) {
      // Primary: lower Brier is better
      if (Math.abs(a.brier - b.brier) > 0.0001) return a.brier - b.brier;
      // Secondary: more picks is better (more confident)
      if (a.picks !== b.picks) return b.picks - a.picks;
      // Tertiary: higher ROI is better
      if (Math.abs(a.roi - b.roi) > 0.0001) return b.roi - a.roi;
      // Finally: higher accuracy
      return b.accuracy - a.accuracy;
    });
    
    // Deduplicate by config fingerprint
    var seen = {};
    var top3 = [];
    for (var i = 0; i < results.length && top3.length < 3; i++) {
      var key = JSON.stringify(results[i].config);
      if (seen[key]) continue;
      seen[key] = true;
      top3.push(results[i]);
    }
    
    // If we couldn't get 3 unique, just take first 3
    if (top3.length < 3) {
      top3 = results.slice(0, 3);
    }
    
    Logger.log('[' + fn + '] ─── Top 3 Configurations ───');
    for (var i = 0; i < top3.length; i++) {
      var r = top3[i];
      Logger.log('  #' + (i + 1) + ': Brier=' + r.brier.toFixed(4) +
                 ' Picks=' + r.picks +
                 ' Acc=' + (r.accuracy * 100).toFixed(1) + '%' +
                 ' ROI=' + (r.roi * 100).toFixed(2) + '%');
      Logger.log('      cfg: edge=' + r.config.ou_edge_threshold +
                 ' minEV=' + r.config.ou_min_ev +
                 ' minSamples=' + r.config.ou_min_samples +
                 ' confScale=' + r.config.ou_confidence_scale);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Write proposals to sheet
    // ─────────────────────────────────────────────────────────────────────────
    var meta = {
      usingRealLines: false,
      realLinePct: 0,
      allSamples: count * 4,
      trainSamples: count * 4,
      testSamples: 0,
      timedOut: timedOut,
      testedConfigs: tested,
      totalConfigs: totalConfigs,
      elapsedSec: elapsedSec_()
    };
    
    try {
      t2ou_writeOUProposalSheet_(ss, top3, meta);
      Logger.log('[' + fn + '] Wrote Config_Tier2_OU_Proposals sheet');
    } catch (writeErr) {
      Logger.log('[' + fn + '] Write error: ' + writeErr.message);
    }
    
    // Final toast
    var toastMsg = timedOut 
      ? 'Tuner stopped early (time limit). Wrote best-so-far (' + results.length + ' viable).'
      : 'Tuning complete! ' + results.length + ' viable configs found.';
    
    _safeToast_(ss, toastMsg, 'O/U Tuner', 5);
    
    return { 
      success: !timedOut, 
      partial: timedOut,
      proposals: top3, 
      tested: tested, 
      totalConfigs: totalConfigs,
      viable: results.length, 
      dataQuality: dq,
      diagnostics: diagAgg,
      elapsedSec: elapsedSec_()
    };
    
  } catch (e) {
    Logger.log('[' + fn + '] FATAL ERROR: ' + e.message);
    Logger.log('[' + fn + '] Stack: ' + (e.stack || 'N/A'));
    _safeAlert_('Tuning Failed', 'Error: ' + e.message);
    return { success: false, reason: 'error', error: e.message, defaultConfig: defaultCfg };
  }
}


/**
 * ============================================================================
 * 4) t2ou_buildHistoricalGamesForTuning_ — PRODUCTION v1.2
 * ============================================================================
 * 
 * Improvements:
 *  - Robust deduplication: prefers date-based key, falls back to score fingerprint
 *  - Clear diagnostics
 *  - Proper validation of all quarters
 * 
 * Output: [{home, away, quarters: {Q1: {total, home, away}, ...}}]
 */
function t2ou_buildHistoricalGamesForTuning_(ss) {
  ss = _ensureSpreadsheet_(ss);
  if (!ss) throw new Error('t2ou_buildHistoricalGamesForTuning_: Spreadsheet not available.');
  
  var TAG = 't2ou_buildHistoricalGamesForTuning_';
  var debugFlag = (typeof T2OU_DEBUG_TUNING !== 'undefined' && T2OU_DEBUG_TUNING);
  
  var games = [];
  var seen = {};
  
  var diag = {
    sheetsMatched: 0,
    sheetsProcessed: 0,
    sheetsSkipped: 0,
    rowsScanned: 0,
    rowsAdded: 0,
    rowsDeduped: 0,
    rowsSkippedNoTeams: 0,
    rowsSkippedInvalidScores: 0
  };
  
  function buildHeaderMap(headerRow) {
    var map = {};
    for (var i = 0; i < headerRow.length; i++) {
      var raw = String(headerRow[i] || '').trim();
      if (!raw) continue;
      var lower = raw.toLowerCase();
      var stripped = lower.replace(/[\s\-_\/()]+/g, '');
      map[lower] = i;
      if (stripped !== lower) map[stripped] = i;
    }
    return map;
  }
  
  function normTeam(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
  }
  
  function isValidScore(x) {
    return isFinite(x) && x >= 0 && x <= 99;
  }
  
  function toDateKey(val) {
    if (!val) return '';
    try {
      var d;
      if (val instanceof Date) {
        d = val;
      } else {
        d = new Date(val);
      }
      if (!isFinite(d.getTime())) return '';
      // Format as YYYYMMDD
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var day = ('0' + d.getDate()).slice(-2);
      return y + m + day;
    } catch (e) {
      return '';
    }
  }
  
  var sheets = ss.getSheets() || [];
  
  for (var si = 0; si < sheets.length; si++) {
    var sh = sheets[si];
    if (!sh) continue;
    
    var name = '';
    try { name = sh.getName(); } catch (e) { continue; }
    
    if (!name || !/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i.test(name)) continue;
    diag.sheetsMatched++;
    
    var values;
    try { values = sh.getDataRange().getValues(); } catch (e) { continue; }
    if (!values || values.length < 2) {
      diag.sheetsSkipped++;
      continue;
    }
    
    var hm;
    try {
      hm = t2ou_headerMap_(values[0]);
    } catch (e) {
      hm = buildHeaderMap(values[0]);
    }
    if (!hm || typeof hm !== 'object') {
      hm = buildHeaderMap(values[0]);
    }
    
    var required = ['home', 'away', 'q1h', 'q1a', 'q2h', 'q2a', 'q3h', 'q3a', 'q4h', 'q4a'];
    var missing = required.filter(function(k) { return hm[k] === undefined; });
    
    if (missing.length > 0) {
      t2ou_dbg_(TAG, 'Skip "' + name + '": missing ' + missing.join(', '), debugFlag);
      diag.sheetsSkipped++;
      continue;
    }
    
    // Look for date column (best effort)
    var dateIdx = hm.date !== undefined ? hm.date :
                  hm.gamedate !== undefined ? hm.gamedate :
                  hm.matchdate !== undefined ? hm.matchdate :
                  hm['game date'] !== undefined ? hm['game date'] :
                  undefined;
    
    diag.sheetsProcessed++;
    var sheetAdded = 0, sheetDeduped = 0;
    
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      diag.rowsScanned++;
      
      var home = normTeam(row[hm.home]);
      var away = normTeam(row[hm.away]);
      
      if (!home || !away) {
        diag.rowsSkippedNoTeams++;
        continue;
      }
      
      // Validate and collect all quarter data
      var quarters = {};
      var allValid = true;
      var scoreParts = [];
      
      for (var q = 1; q <= 4; q++) {
        var hScore = Number(row[hm['q' + q + 'h']]);
        var aScore = Number(row[hm['q' + q + 'a']]);
        
        if (!isValidScore(hScore) || !isValidScore(aScore)) {
          allValid = false;
          break;
        }
        
        var total = hScore + aScore;
        quarters['Q' + q] = { total: total, home: hScore, away: aScore };
        scoreParts.push(hScore + '-' + aScore);
      }
      
      if (!allValid) {
        diag.rowsSkippedInvalidScores++;
        continue;
      }
      
      // Build dedupe key: prefer date-based, fall back to score fingerprint
      var dedupeKey;
      var dateKey = (dateIdx !== undefined) ? toDateKey(row[dateIdx]) : '';
      
      if (dateKey) {
        // Date-based: same teams on same date = same game
        dedupeKey = home + '|' + away + '|' + dateKey;
      } else {
        // Score fingerprint: home|away|all quarter scores
        // Less reliable but catches most cross-sheet duplicates
        dedupeKey = home + '|' + away + '|' + scoreParts.join('|');
      }
      
      if (seen[dedupeKey]) {
        diag.rowsDeduped++;
        sheetDeduped++;
        continue;
      }
      seen[dedupeKey] = true;
      
      games.push({
        home: home,
        away: away,
        quarters: quarters
      });
      
      diag.rowsAdded++;
      sheetAdded++;
    }
    
    t2ou_dbg_(TAG, 'Sheet "' + name + '": added=' + sheetAdded + ' deduped=' + sheetDeduped, debugFlag);
  }
  
  Logger.log('[' + TAG + '] v1.2 COMPLETE: ' +
             diag.sheetsProcessed + '/' + diag.sheetsMatched + ' sheets, ' +
             diag.rowsAdded + ' games kept, ' +
             diag.rowsDeduped + ' dupes dropped');
  
  t2ou_dbg_(TAG, 'Diag: ' + JSON.stringify(diag), debugFlag);
  
  return games;
}



/**
 * ============================================================================
 * t2ou_writeProposalsToSheet_ - COMPATIBILITY ALIAS
 * ============================================================================
 * This ensures the tuner works regardless of which function name is called.
 */
function t2ou_writeProposalsToSheet_(ss, top3, meta) {
  return t2ou_writeOUProposalSheet_(ss, top3, meta);
}


/**
 * ============================================================================
 * t2ou_lowerKeyMap_ - Helper
 * ============================================================================
 * Converts all object keys to lowercase for consistent access
 */
function t2ou_lowerKeyMap_(obj) {
  if (!obj || typeof obj !== 'object') return {};
  var result = {};
  Object.keys(obj).forEach(function(k) {
    result[k.toLowerCase()] = obj[k];
  });
  return result;
}


/**
 * Builds O/U tuning candidate grid
 * PATCHED: Includes Forebet weight parameters
 * 
 * @param {number} MAX - Maximum candidates to generate
 * @returns {Array} Candidate config objects
 */
function t2ou_buildCandidateGrid_(MAX) {
  MAX = MAX || 2500;

  if (typeof t2ou_range_ !== 'function') {
    throw new Error('t2ou_buildCandidateGrid_: t2ou_range_ not found.');
  }

  var edgeThrArr = t2ou_range_(0.000, 0.080, 0.005);
  var minSamplesArr = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];
  var minEVArr = [0.00, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05];
  var confScaleArr = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60];
  var shrinkKArr = [4, 6, 8, 10, 12, 16, 20];
  var sigmaFloorArr = [4, 5, 6, 7, 8, 9, 10];
  var sigmaScaleArr = [0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15];
  var oddsArr = [-120, -115, -110, -105];

  // NEW FRIENDS for O/U
  var fbEnabledArr = [true, false];
  var fbQtrWArr = [0, 0.10, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60];
  var fbFtWArr = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];

  function pick_(arr) { 
    return arr[Math.floor(Math.random() * arr.length)]; 
  }

  var out = [];
  var seen = Object.create(null);
  var tries = 0;
  var MAX_TRIES = MAX * 60;

  while (out.length < MAX && tries < MAX_TRIES) {
    tries++;

    var cand = {
      ou_edge_threshold: pick_(edgeThrArr),
      ou_min_samples: pick_(minSamplesArr),
      ou_min_ev: pick_(minEVArr),
      ou_confidence_scale: pick_(confScaleArr),
      ou_shrink_k: pick_(shrinkKArr),
      ou_sigma_floor: pick_(sigmaFloorArr),
      ou_sigma_scale: pick_(sigmaScaleArr),
      ou_american_odds: pick_(oddsArr),
      // NEW FRIENDS
      forebet_blend_enabled: pick_(fbEnabledArr),
      forebet_ou_weight_qtr: pick_(fbQtrWArr),
      forebet_ou_weight_ft: pick_(fbFtWArr)
    };

    var key = [
      cand.ou_edge_threshold,
      cand.ou_min_samples,
      cand.ou_min_ev,
      cand.ou_confidence_scale,
      cand.ou_shrink_k,
      cand.ou_sigma_floor,
      cand.ou_sigma_scale,
      cand.ou_american_odds,
      cand.forebet_blend_enabled ? 1 : 0,
      Number(cand.forebet_ou_weight_qtr).toFixed(2),
      Number(cand.forebet_ou_weight_ft).toFixed(2)
    ].join('|');

    if (seen[key]) continue;
    seen[key] = true;
    out.push(cand);
  }

  Logger.log('[T2OU] Generated ' + out.length + ' unique configs in ' + tries + ' tries');
  return out;
}



function buildTeamQuarterWinStatsFromClean_(ss, debug) {
  var FN = 'buildTeamQuarterWinStatsFromClean_';
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  debug = (debug === true);

  var allSheets = ss.getSheets();
  var cleanSheets = [];
  for (var i = 0; i < allSheets.length; i++) {
    var name = allSheets[i].getName();
    if (/^Clean(H2H|Recent(Home|Away))_\d+$/i.test(name)) {
      cleanSheets.push(allSheets[i]);
    }
  }

  if (!cleanSheets.length) {
    Logger.log('[' + FN + '] No clean sheets found');
    return {};
  }

  function normKey_(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function norm_(s) { return String(s == null ? '' : s).trim(); }

  function toNum_(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function clamp_(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function addLowerAliasNonEnum_(obj, key, node) {
    var lk = String(key || '').toLowerCase();
    if (!lk || lk === key) return;
    if (Object.prototype.hasOwnProperty.call(obj, lk)) return;
    try {
      Object.defineProperty(obj, lk, { value: node, enumerable: false, configurable: true });
    } catch (e) {
      obj[lk] = node;
    }
  }

  // Parse "28-30" or "28 - 30" into [homeScore, awayScore]
  function parseScorePair_(v) {
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!m) return null;
    var a = parseInt(m[1], 10);
    var b = parseInt(m[2], 10);
    return (isFinite(a) && isFinite(b)) ? [a, b] : null;
  }

  function dateKey_(v) {
    if (v == null || v === '') return '';
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      var y = v.getFullYear();
      var m = ('0' + (v.getMonth() + 1)).slice(-2);
      var d = ('0' + v.getDate()).slice(-2);
      return y + '-' + m + '-' + d;
    }
    var s = String(v).trim();
    if (!s) return '';
    return s;
  }

  var QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  var raw = {};       // { team: { Q1: { w, l }, ... } }
  var seen = {};      // dedup key → true
  var totalGames = 0;
  var sheetsUsed = 0;
  var sheetsSkipped = 0;

  for (var si = 0; si < cleanSheets.length; si++) {
    var sh = cleanSheets[si];
    var shName = sh.getName();
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 4) { sheetsSkipped++; continue; }

    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();

    // Find header row
    var headerRow = -1;
    var headers = [];
    for (var r = 0; r < Math.min(values.length, 15); r++) {
      var normed = values[r].map(normKey_);
      var hasHome = false;
      var hasAway = false;
      for (var c = 0; c < normed.length; c++) {
        if (normed[c] === 'home' || normed[c] === 'hometeam') hasHome = true;
        if (normed[c] === 'away' || normed[c] === 'awayteam' || normed[c] === 'visitor') hasAway = true;
      }
      if (hasHome && hasAway) {
        headerRow = r;
        headers = normed;
        break;
      }
    }
    if (headerRow < 0) { sheetsSkipped++; continue; }

    // Column finders
    function findExact_(target) {
      for (var c = 0; c < headers.length; c++) { if (headers[c] === target) return c; }
      return -1;
    }
    function findPartial_(target) {
      for (var c = 0; c < headers.length; c++) { if (headers[c].indexOf(target) >= 0) return c; }
      return -1;
    }
    function findAny_() {
      for (var a = 0; a < arguments.length; a++) {
        var idx = findExact_(arguments[a]);
        if (idx >= 0) return idx;
      }
      for (var a2 = 0; a2 < arguments.length; a2++) {
        var idx2 = findPartial_(arguments[a2]);
        if (idx2 >= 0) return idx2;
      }
      return -1;
    }

    var cHome = findAny_('home', 'hometeam');
    var cAway = findAny_('away', 'awayteam', 'visitor');
    var cDate = findAny_('date');
    if (cHome < 0 || cAway < 0) { sheetsSkipped++; continue; }

    // Detect quarter column format
    // Strategy A: separate per-team columns (HQ1/AQ1, Q1H/Q1A, HomeQ1/AwayQ1, etc.)
    // Strategy B: combined "X-Y" columns (Q1 contains "28-30")
    var qCols = {};
    var foundAny = false;

    for (var qi = 0; qi < QUARTERS.length; qi++) {
      var Q = QUARTERS[qi];
      var qLow = Q.toLowerCase();
      var qNum = Q.substring(1);

      var hPatterns = [
        'h' + qLow, 'hq' + qNum, qLow + 'h', 'q' + qNum + 'h',
        'home' + qLow, 'homeq' + qNum, qLow + 'home', 'q' + qNum + 'home',
        'h' + qNum, qNum + 'h'
      ];
      var aPatterns = [
        'a' + qLow, 'aq' + qNum, qLow + 'a', 'q' + qNum + 'a',
        'away' + qLow, 'awayq' + qNum, qLow + 'away', 'q' + qNum + 'away',
        'a' + qNum, qNum + 'a'
      ];

      var hCol = -1;
      var aCol = -1;
      for (var p = 0; p < hPatterns.length && hCol < 0; p++) { hCol = findExact_(hPatterns[p]); }
      for (var p2 = 0; p2 < aPatterns.length && aCol < 0; p2++) { aCol = findExact_(aPatterns[p2]); }

      if (hCol >= 0 && aCol >= 0) {
        qCols[Q] = { hCol: hCol, aCol: aCol, type: 'separate' };
        foundAny = true;
      } else {
        var cCol = findExact_(qLow);
        if (cCol < 0) cCol = findExact_('q' + qNum);
        if (cCol >= 0) {
          qCols[Q] = { combined: cCol, type: 'combined' };
          foundAny = true;
        }
      }
    }

    if (!foundAny) {
      if (debug) Logger.log('[' + FN + '] ' + shName + ': no quarter columns found, skipping');
      sheetsSkipped++;
      continue;
    }

    // For combined columns, verify first data row has "X-Y" format
    var hasCombined = false;
    var qKeys = Object.keys(qCols);
    for (var ci = 0; ci < qKeys.length; ci++) {
      if (qCols[qKeys[ci]].type === 'combined') { hasCombined = true; break; }
    }

    if (hasCombined && headerRow + 1 < values.length) {
      var testQ = null;
      for (var ci2 = 0; ci2 < qKeys.length; ci2++) {
        if (qCols[qKeys[ci2]].type === 'combined') { testQ = qKeys[ci2]; break; }
      }
      if (testQ) {
        var testVal = values[headerRow + 1][qCols[testQ].combined];
        if (!parseScorePair_(testVal)) {
          if (debug) Logger.log('[' + FN + '] ' + shName + ': Q columns are totals not X-Y, skipping');
          sheetsSkipped++;
          continue;
        }
      }
    }

    // Parse game rows
    var sheetGames = 0;
    for (var ri = headerRow + 1; ri < values.length; ri++) {
      var row = values[ri];
      var homeTeam = norm_(row[cHome]);
      var awayTeam = norm_(row[cAway]);
      if (!homeTeam || !awayTeam) continue;

      // First parse quarters into a local decision list (so we can build a stable dedup key)
      var decisions = []; // {Q, winner: 'H'|'A' } for non-tied valid quarters
      var scoreSigParts = []; // for dedup fallback when date missing
      var anyValid = false;

      for (var qi3 = 0; qi3 < QUARTERS.length; qi3++) {
        var Qk = QUARTERS[qi3];
        var qc = qCols[Qk];
        if (!qc) continue;

        var hScore, aScore;

        if (qc.type === 'separate') {
          hScore = toNum_(row[qc.hCol]);
          aScore = toNum_(row[qc.aCol]);
          if (isFinite(hScore) && isFinite(aScore)) {
            scoreSigParts.push(Qk + ':' + hScore + '-' + aScore);
          }
        } else {
          var pair = parseScorePair_(row[qc.combined]);
          if (!pair) continue;
          hScore = pair[0];
          aScore = pair[1];
          scoreSigParts.push(Qk + ':' + hScore + '-' + aScore);
        }

        if (!isFinite(hScore) || !isFinite(aScore)) continue;
        if (hScore === aScore) continue; // tied quarter — skip

        decisions.push({ Q: Qk, winner: (hScore > aScore ? 'H' : 'A') });
        anyValid = true;
      }

      if (!anyValid) continue;

      // Dedup across sheets: prefer Date; if missing/blank, use score signature; else fallback to row identity
      var dk = (cDate >= 0) ? dateKey_(row[cDate]) : '';
      var base = normKey_(homeTeam) + '|' + normKey_(awayTeam);

      var dedupKey;
      if (dk) {
        dedupKey = base + '|' + normKey_(dk);
      } else if (scoreSigParts.length) {
        dedupKey = base + '|scores|' + normKey_(scoreSigParts.join('|'));
      } else {
        // last resort: don't cross-dedup (prevents accidental collisions)
        dedupKey = base + '|row|' + normKey_(shName) + '|' + String(ri);
      }

      if (seen[dedupKey]) continue;
      seen[dedupKey] = true;

      // Init buckets only after dedup accepted
      if (!raw[homeTeam]) raw[homeTeam] = {};
      if (!raw[awayTeam]) raw[awayTeam] = {};
      for (var qi4 = 0; qi4 < QUARTERS.length; qi4++) {
        if (!raw[homeTeam][QUARTERS[qi4]]) raw[homeTeam][QUARTERS[qi4]] = { w: 0, l: 0 };
        if (!raw[awayTeam][QUARTERS[qi4]]) raw[awayTeam][QUARTERS[qi4]] = { w: 0, l: 0 };
      }

      // Apply decisions
      for (var di = 0; di < decisions.length; di++) {
        var d = decisions[di];
        if (d.winner === 'H') {
          raw[homeTeam][d.Q].w++;
          raw[awayTeam][d.Q].l++;
        } else {
          raw[awayTeam][d.Q].w++;
          raw[homeTeam][d.Q].l++;
        }
      }

      sheetGames++;
      totalGames++;
    }

    if (sheetGames > 0) sheetsUsed++;
    else sheetsSkipped++; // if sheet had headers but no usable rows, count it as skipped
  }

  // Build output in the shape Module 7 expects
  var out = {};
  var teams = Object.keys(raw);

  for (var ti = 0; ti < teams.length; ti++) {
    var team = teams[ti];
    var node = {};
    var hasAny = false;

    for (var qi = 0; qi < QUARTERS.length; qi++) {
      var Q = QUARTERS[qi];
      var bucket = raw[team][Q];
      if (!bucket) continue;

      var total = bucket.w + bucket.l;
      if (total <= 0) continue;

      var wp = (bucket.w / total) * 100;
      node[Q] = {
        wins:        bucket.w,
        losses:      bucket.l,
        total:       total,
        winPct:      wp,
        strength:    clamp_((wp - 50) / 50, -1, 1),
        reliability: clamp_(total / 30, 0, 1)
      };
      hasAny = true;
    }

    if (hasAny) {
      out[team] = node;
      addLowerAliasNonEnum_(out, team, node);
    }
  }

  Logger.log('[' + FN + '] ' + cleanSheets.length + ' sheets scanned, ' +
    sheetsUsed + ' used, ' + sheetsSkipped + ' skipped, ' +
    totalGames + ' unique games, ' + Object.keys(out).length + ' teams');

  if (!Object.keys(out).length) {
    Logger.log('[' + FN + '] WARNING: 0 teams extracted. Clean sheets need per-team quarter columns ' +
      '(HQ1/AQ1, Q1H/Q1A, HomeQ1/AwayQ1) or combined X-Y format in Q1-Q4 columns');
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// TUNING DATA BUILDERS — LEAGUE-DYNAMIC v7.1
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Main entry: builds O/U tuning samples from Clean sheets,
 * enriched with league stats, team quarter stats, and upcoming predictions.
 * 
 * LEAGUE-DYNAMIC: Works with any basketball league (NBA, EuroLeague, etc.)
 * 
 * RETURNS: Array with attached metadata properties (backward compatible)
 *   - samples[i] = individual sample object
 *   - samples.leagueStats = league quarter stats
 *   - samples.teamStats = team quarter stats  
 *   - samples.quality = sample quality assessment
 *   - samples.detectedLeague = detected league name
 * 
 * @param {Spreadsheet} ss - Active spreadsheet
 * @return {Array} samples array with metadata properties
 */
function t2ou_buildOUTuningSamplesFromCleanSheets_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var fn = 't2ou_buildOUTuningSamplesFromCleanSheets_';

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: LOAD ALL CONTEXT DATA (league-dynamic)
    // ═══════════════════════════════════════════════════════════════════════
    var leagueData = t2ou_loadLeagueQuarterOUStats_(ss);

    // ── team quarter stats: primary → TeamQuarterStats_Tier2, fallback → clean sheets ──
    var teamStats = {};

    if (typeof t2ou_loadTeamQuarterStats_ === 'function') {
      try {
        teamStats = t2ou_loadTeamQuarterStats_(ss, false) || {};
      } catch (e) {
        Logger.log('[' + fn + '] t2ou_loadTeamQuarterStats_ threw: ' + e.message);
        teamStats = {};
      }
    }

    if (Object.keys(teamStats).length === 0 && typeof buildTeamQuarterWinStatsFromClean_ === 'function') {
      Logger.log('[' + fn + '] Primary team stats empty, building from clean sheets...');
      try {
        teamStats = buildTeamQuarterWinStatsFromClean_(ss, false) || {};
      } catch (e2) {
        Logger.log('[' + fn + '] Clean sheet build threw: ' + e2.message);
        teamStats = {};
      }
    }

    if (Object.keys(teamStats).length === 0 && typeof loadQuarterWinnerStats === 'function') {
      Logger.log('[' + fn + '] Trying legacy loadQuarterWinnerStats...');
      try {
        var legacy = loadQuarterWinnerStats(ss);
        if (legacy && typeof legacy === 'object') {
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
                wins: isFinite(Number(qd.wins)) ? Number(qd.wins) : 0,
                losses: isFinite(Number(qd.losses)) ? Number(qd.losses) : 0,
                total: total,
                winPct: wp,
                strength: Math.max(-1, Math.min(1, (wp - 50) / 50)),
                reliability: Math.max(0, Math.min(1, total / 30))
              };
              cHas = true;
            }
            if (cHas) teamStats[lk] = cNode;
          }
        }
      } catch (e3) {
        Logger.log('[' + fn + '] Legacy loadQuarterWinnerStats threw: ' + e3.message);
      }
    }

    var teamCount = Object.keys(teamStats).length;
    if (teamCount === 0) {
      Logger.log('[' + fn + '] WARNING: All team quarter stat sources returned 0 teams. O/U will use league baselines only.');
    }

    var upcomingData = t2ou_loadUpcomingData_(ss);

    var detectedLeague = leagueData.detectedLeague || 'UNKNOWN';

    Logger.log('[' + fn + '] League: ' + detectedLeague +
               ', LeagueQ=' + Object.keys(leagueData.stats).length +
               ', Teams=' + teamCount +
               ', Upcoming=' + upcomingData.games.length);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: PROCESS HISTORICAL DATA FROM CLEAN SHEETS
    // ═══════════════════════════════════════════════════════════════════════
    var samples = [];
    var seenKeys = {};
    var sheets = ss.getSheets();

    for (var si = 0; si < sheets.length; si++) {
      var sh = sheets[si];
      var name = sh.getName();
      if (!name.match(/^(CleanH2H_|CleanRecentHome_|CleanRecentAway_)/i)) continue;

      var values = sh.getDataRange().getValues();
      if (!values || values.length < 2) continue;

      var hm = t2ou_headerMap_(values[0]);
      var qCols = t2ou_mapQuarterColumns_(hm);

      if (qCols.q1h === undefined || qCols.q1a === undefined) continue;

      for (var r = 1; r < values.length; r++) {
        var row = values[r];

        var home = t2ou_normalizeTeamName_(t2ou_getVal_(row, hm, ['home', 'home_team', 'hometeam']));
        var away = t2ou_normalizeTeamName_(t2ou_getVal_(row, hm, ['away', 'away_team', 'awayteam', 'visitor']));
        if (!home || !away) continue;

        var dateKey = t2ou_extractDateKey_(row, hm);
        var gameKey = home + '|' + away + '|' + dateKey;

        if (seenKeys[gameKey]) continue;
        seenKeys[gameKey] = true;

        var upcomingPredTotal = t2ou_lookupUpcomingTotal_(upcomingData, home, away);

        for (var q = 1; q <= 4; q++) {
          var Q = 'Q' + q;

          var homeScore = t2ou_parseNum_(row[qCols['q' + q + 'h']]);
          var awayScore = t2ou_parseNum_(row[qCols['q' + q + 'a']]);

          if (!t2ou_isValidQuarterScore_(homeScore) || !t2ou_isValidQuarterScore_(awayScore)) continue;

          var actualTotal = homeScore + awayScore;

          var lineResult = t2ou_buildSmartLine_({
            quarter: Q,
            home: home,
            away: away,
            leagueStats: leagueData.stats,
            teamStats: teamStats,
            upcomingPredTotal: upcomingPredTotal
          });

          samples.push({
            homeTeam: home,
            awayTeam: away,
            quarter: Q,
            homeScore: homeScore,
            awayScore: awayScore,
            actualTotal: actualTotal,
            line: lineResult.line,
            lineSource: lineResult.source,
            gameKey: gameKey,
            dateKey: dateKey,
            source: name,
            league: detectedLeague,
            leagueMean: lineResult.leagueMean,
            leagueSD: lineResult.leagueSD,
            leagueOverPct: lineResult.overPct,
            leagueUnderPct: lineResult.underPct,
            homeQWinPct: lineResult.homeWinPct,
            awayQWinPct: lineResult.awayWinPct,
            homeQSamples: lineResult.homeSamples,
            awayQSamples: lineResult.awaySamples,
            confidenceWeight: lineResult.confidence,
            outcome: actualTotal > lineResult.line ? 'OVER' :
                     (actualTotal < lineResult.line ? 'UNDER' : 'PUSH')
          });
        }
      }
    }

    var quality = t2ou_assessSampleQuality_(samples);

    Logger.log('[' + fn + '] COMPLETE: ' + samples.length + ' samples, league=' + detectedLeague);

    // ═══════════════════════════════════════════════════════════════════════
    // BACKWARD-COMPATIBLE RETURN
    // ═══════════════════════════════════════════════════════════════════════
    samples.leagueStats = leagueData.stats;
    samples.teamStats = teamStats;
    samples.quality = quality;
    samples.detectedLeague = detectedLeague;
    samples.samples = samples;
    samples.all = samples;
    samples.rows = samples;

    return samples;

  } catch (e) {
    Logger.log('[' + fn + '] ERROR: ' + e.message + '\n' + (e.stack || ''));

    var empty = [];
    empty.leagueStats = {};
    empty.teamStats = {};
    empty.quality = {};
    empty.detectedLeague = 'ERROR';
    empty.samples = empty;
    empty.all = empty;
    empty.rows = empty;
    return empty;
  }
}


function t2ou_loadLeagueQuarterOUStats_(ss, debug) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  debug = debug === true;

  if (typeof loadLeagueQuarterOUStats_ !== 'function') {
    throw new Error('t2ou_loadLeagueQuarterOUStats_: loadLeagueQuarterOUStats_ is missing');
  }

  var allStats = loadLeagueQuarterOUStats_(ss, debug) || {};
  var leagues = Object.keys(allStats);

  function pickLeagueKeyCI_(want) {
    var w = String(want || '').trim().toLowerCase();
    if (!w) return null;
    for (var i = 0; i < leagues.length; i++) {
      var k = leagues[i];
      if (String(k).trim().toLowerCase() === w) return k; // return original-cased key
    }
    return null;
  }

  // Prefer NBA if present; otherwise fall back to 'overall'; otherwise single league; otherwise UNKNOWN.
  var detectedLeague =
    pickLeagueKeyCI_('nba') ||
    pickLeagueKeyCI_('overall') ||
    (leagues.length === 1 ? leagues[0] : 'UNKNOWN');

  var stats = (detectedLeague !== 'UNKNOWN' && allStats[detectedLeague]) ? allStats[detectedLeague] : {};

  return {
    detectedLeague: detectedLeague,
    stats: stats,        // quarter-keyed object (Q1..Q4) for the detected league
    allStats: allStats,  // full league-keyed map
    leagues: leagues
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gets sheet by trying multiple names (case/space insensitive).
 */
function t2ou_getSheetByNameMulti_(ss, names) {
  if (!ss || typeof ss.getSheets !== 'function') return null;
  
  var sheets = ss.getSheets();
  
  for (var n = 0; n < names.length; n++) {
    var target = String(names[n]).toLowerCase().replace(/[\s_-]/g, '');
    
    for (var i = 0; i < sheets.length; i++) {
      var sheetName = sheets[i].getName().toLowerCase().replace(/[\s_-]/g, '');
      if (sheetName === target) return sheets[i];
    }
  }
  return null;
}

/**
 * Gets sheet by single name (case insensitive).
 */
function t2ou_getSheetInsensitive_(ss, name) {
  return t2ou_getSheetByNameMulti_(ss, [name]);
}

/**
 * Creates normalized header map from row.
 */
function t2ou_headerMap_(row) {
  var hm = {};
  for (var c = 0; c < row.length; c++) {
    var k = t2ou_normalizeHeader_(row[c]);
    if (k && hm[k] === undefined) hm[k] = c;
  }
  return hm;
}

/**
 * Normalizes header for matching.
 */
function t2ou_normalizeHeader_(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
}

/**
 * Finds column index from header map.
 */
function t2ou_findCol_(hm, names) {
  for (var i = 0; i < names.length; i++) {
    var k = t2ou_normalizeHeader_(names[i]);
    if (hm[k] !== undefined) return hm[k];
  }
  return undefined;
}

/**
 * Parses value as number.
 */
function t2ou_parseNum_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  var n = Number(v);
  return isFinite(n) ? n : NaN;
}

/**
 * Normalizes quarter to Q1-Q4 format.
 */
function t2ou_normalizeQuarter_(v) {
  var s = String(v || '').trim().toUpperCase();
  var m = s.match(/Q?([1-4])/);
  return m ? 'Q' + m[1] : '';
}

/**
 * Normalizes team name for matching.
 */
function t2ou_normalizeTeamName_(name) {
  var s = String(name || '').trim();
  if (!s) return '';
  return s.replace(/\s+/g, ' ');
}


// ═══════════════════════════════════════════════════════════════════════════
// LOADER: UpcomingClean
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_loadUpcomingData_(ss) {
  var fn = 't2ou_loadUpcomingData_';
  var result = { games: [], pairs: {}, slateMean: NaN };

  var sh = t2ou_getSheetInsensitive_(ss, 'UpcomingClean');
  if (!sh) return result;

  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return result;

  var hm = t2ou_headerMap_(data[0]);

  var cols = {
    predScore: t2ou_findCol_(hm, ['pred score', 'predscore', 'predicted score', 'prediction', 'score']),
    avg: t2ou_findCol_(hm, ['avg', 'average', 'total', 'predtotal', 'pred_total', 'line', 'ft score']),
    home: t2ou_findCol_(hm, ['home', 'hometeam', 'home_team']),
    away: t2ou_findCol_(hm, ['away', 'awayteam', 'away_team', 'visitor'])
  };

  var totals = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var entry = { predTotal: NaN, homeScore: NaN, awayScore: NaN, home: '', away: '' };

    if (cols.avg !== undefined) {
      entry.predTotal = t2ou_parseNum_(row[cols.avg]);
    }

    if (cols.predScore !== undefined) {
      var parsed = t2ou_parsePredScore_(row[cols.predScore]);
      if (parsed) {
        entry.homeScore = parsed.home;
        entry.awayScore = parsed.away;
        if (!isFinite(entry.predTotal)) {
          entry.predTotal = parsed.home + parsed.away;
        }
      }
    }

    if (cols.home !== undefined) entry.home = t2ou_normalizeTeamName_(String(row[cols.home] || ''));
    if (cols.away !== undefined) entry.away = t2ou_normalizeTeamName_(String(row[cols.away] || ''));

    // Generic validation: total should be reasonable for any basketball league
    if (isFinite(entry.predTotal) && entry.predTotal > 50 && entry.predTotal < 400) {
      entry.quarterEstimates = t2ou_estimateQuarterTotals_(entry.predTotal);
      result.games.push(entry);
      totals.push(entry.predTotal);

      if (entry.home && entry.away) {
        result.pairs[entry.home + '|' + entry.away] = entry;
      }
    }
  }

  if (totals.length > 0) {
    result.slateMean = t2ou_mean_(totals);
  }

  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// SMART LINE BUILDER (LEAGUE-DYNAMIC)
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_buildSmartLine_(opts) {
  opts = opts || {};
  var FN = 't2ou_buildSmartLine_';
  var Q            = opts.quarter;
  var home         = opts.home;
  var away         = opts.away;
  var leagueStats  = opts.leagueStats  || {};
  var teamStats    = opts.teamStats    || {};
  var upcomingPredTotal = opts.upcomingPredTotal;

  /* ── get league quarter stats (must exist — no defaults) ── */
  var leagueQ = leagueStats[Q];
  if (!leagueQ) {
    throw new Error(FN + ': No leagueStats for ' + Q +
      '. Available keys: ' + Object.keys(leagueStats).join(','));
  }

  var mean = Number(leagueQ.mean);
  var sd   = Number(leagueQ.sd);

  if (!isFinite(mean) || !isFinite(sd) || sd <= 0) {
    throw new Error(FN + ': Invalid leagueStats for ' + Q +
      ' mean=' + leagueQ.mean + ' sd=' + leagueQ.sd);
  }

  var result = {
    line:       NaN,
    source:     'league',
    leagueMean: mean,
    leagueSD:   sd,
    overPct:    isFinite(Number(leagueQ.overPct))  ? Number(leagueQ.overPct)  : NaN,
    underPct:   isFinite(Number(leagueQ.underPct)) ? Number(leagueQ.underPct) : NaN,
    homeWinPct:   NaN,
    awayWinPct:   NaN,
    homeSamples:  0,
    awaySamples:  0,
    confidence:   0.5,
    fallbackUsed:   false,
    fallbackReason: ''
  };

  var rawLine = mean;
  var sources = ['league'];
  var confFactors = [];

  /* ── upcoming prediction scaling (optional) ── */
  if (isFinite(upcomingPredTotal) && upcomingPredTotal > 50) {
    var leagueFullGame = 0;
    var qLabels = ['Q1', 'Q2', 'Q3', 'Q4'];
    var allPresent = true;
    for (var qi = 0; qi < qLabels.length; qi++) {
      if (leagueStats[qLabels[qi]] && isFinite(Number(leagueStats[qLabels[qi]].mean))) {
        leagueFullGame += Number(leagueStats[qLabels[qi]].mean);
      } else {
        allPresent = false;
      }
    }
    if (allPresent && leagueFullGame > 0) {
      var scale = upcomingPredTotal / leagueFullGame;
      scale = Math.max(0.80, Math.min(1.20, scale));
      rawLine += (scale - 1) * mean;
      sources.push('upcoming');
      confFactors.push(0.7);
    }
  }

  /* ── team quarter adjustments (only when real data exists) ── */
  var homeTeamQ = teamStats[home] ? teamStats[home][Q] : null;
  var awayTeamQ = teamStats[away] ? teamStats[away][Q] : null;

  if (homeTeamQ) {
    result.homeWinPct  = homeTeamQ.winPct;
    result.homeSamples = homeTeamQ.total;
  }
  if (awayTeamQ) {
    result.awayWinPct  = awayTeamQ.winPct;
    result.awaySamples = awayTeamQ.total;
  }

  var minGames = 5;
  if (homeTeamQ && awayTeamQ &&
      homeTeamQ.total >= minGames && awayTeamQ.total >= minGames) {
    var combined = ((homeTeamQ.strength || 0) + (awayTeamQ.strength || 0)) / 2;
    rawLine += combined * (sd * 0.15);
    sources.push('team_both');
    confFactors.push(Math.min(homeTeamQ.reliability || 0.5, awayTeamQ.reliability || 0.5));
  } else if (homeTeamQ && homeTeamQ.total >= minGames) {
    rawLine += (homeTeamQ.strength || 0) * (sd * 0.08);
    sources.push('team_home');
    confFactors.push((homeTeamQ.reliability || 0.5) * 0.7);
  } else if (awayTeamQ && awayTeamQ.total >= minGames) {
    rawLine += (awayTeamQ.strength || 0) * (sd * 0.08);
    sources.push('team_away');
    confFactors.push((awayTeamQ.reliability || 0.5) * 0.7);
  }

  /* ── league over/under bias (only with sufficient sample) ── */
  if (leagueQ.count >= 50 && isFinite(result.overPct)) {
    var overBias = (result.overPct - 50) / 100;
    rawLine += overBias * (sd * 0.05);
    confFactors.push(Math.min(1, leagueQ.count / 200));
  }

  /* ── clamp to ±2.5 SD from mean ── */
  var lo = mean - 2.5 * sd;
  var hi = mean + 2.5 * sd;
  rawLine = Math.max(lo, Math.min(hi, rawLine));

  /* ── round to 0.5 ── */
  result.line   = Math.round(rawLine * 2) / 2;
  result.source = sources.join('+');

  if (confFactors.length) {
    var sum = 0;
    for (var fi = 0; fi < confFactors.length; fi++) sum += confFactors[fi];
    result.confidence = sum / confFactors.length;
  }

  /* ── final sanity: if line is somehow non-finite, throw (never silently produce garbage) ── */
  if (!isFinite(result.line)) {
    throw new Error(FN + ': Produced non-finite line for ' + Q +
      ' (rawLine=' + rawLine + ', mean=' + mean + ', sd=' + sd + ')');
  }

  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// GENERIC DEFAULTS (No hardcoded league values)
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_getGenericDefaults_() {
  // Generic basketball defaults - will be overridden by actual data
  return {
    Q1: { mean: 55, sd: 8, overPct: 50, underPct: 50, count: 0, safeLower: 47, safeUpper: 63 },
    Q2: { mean: 55, sd: 8, overPct: 50, underPct: 50, count: 0, safeLower: 47, safeUpper: 63 },
    Q3: { mean: 55, sd: 8, overPct: 50, underPct: 50, count: 0, safeLower: 47, safeUpper: 63 },
    Q4: { mean: 53, sd: 9, overPct: 50, underPct: 50, count: 0, safeLower: 44, safeUpper: 62 }
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// QUALITY ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_assessSampleQuality_(samples) {
  if (!samples || samples.length === 0) {
    return { avgConfidence: 0, sourceBreakdown: {}, overRate: 0, underRate: 0, pushRate: 0, total: 0 };
  }

  var totalConf = 0;
  var sourceCount = {};
  var outcomes = { OVER: 0, UNDER: 0, PUSH: 0 };

  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    totalConf += s.confidenceWeight || 0;
    var src = s.lineSource || 'unknown';
    sourceCount[src] = (sourceCount[src] || 0) + 1;
    if (s.outcome) outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1;
  }

  var total = samples.length;
  return {
    avgConfidence: totalConf / total,
    sourceBreakdown: sourceCount,
    overRate: (outcomes.OVER / total) * 100,
    underRate: (outcomes.UNDER / total) * 100,
    pushRate: (outcomes.PUSH / total) * 100,
    total: total
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Lookup upcoming total
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_lookupUpcomingTotal_(upcomingData, home, away) {
  if (!upcomingData) return NaN;

  var key = home + '|' + away;
  if (upcomingData.pairs && upcomingData.pairs[key]) {
    return upcomingData.pairs[key].predTotal;
  }

  var revKey = away + '|' + home;
  if (upcomingData.pairs && upcomingData.pairs[revKey]) {
    return upcomingData.pairs[revKey].predTotal;
  }

  return upcomingData.slateMean;
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Map quarter columns flexibly
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_mapQuarterColumns_(hm) {
  var result = {};
  var patterns = {
    'q1h': ['q1h', 'q1_h', 'q1home', 'home_q1', 'hq1', 'q1_home', '1qh', 'h1'],
    'q1a': ['q1a', 'q1_a', 'q1away', 'away_q1', 'aq1', 'q1_away', '1qa', 'a1'],
    'q2h': ['q2h', 'q2_h', 'q2home', 'home_q2', 'hq2', 'q2_home', '2qh', 'h2'],
    'q2a': ['q2a', 'q2_a', 'q2away', 'away_q2', 'aq2', 'q2_away', '2qa', 'a2'],
    'q3h': ['q3h', 'q3_h', 'q3home', 'home_q3', 'hq3', 'q3_home', '3qh', 'h3'],
    'q3a': ['q3a', 'q3_a', 'q3away', 'away_q3', 'aq3', 'q3_away', '3qa', 'a3'],
    'q4h': ['q4h', 'q4_h', 'q4home', 'home_q4', 'hq4', 'q4_home', '4qh', 'h4'],
    'q4a': ['q4a', 'q4_a', 'q4away', 'away_q4', 'aq4', 'q4_away', '4qa', 'a4']
  };

  Object.keys(patterns).forEach(function(key) {
    result[key] = t2ou_findCol_(hm, patterns[key]);
  });

  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Parse predicted score
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_parsePredScore_(val) {
  if (!val) return null;
  var s = String(val).trim();
  var match = s.match(/(\d+)\s*[-–:]\s*(\d+)/);
  if (match) {
    return { home: parseInt(match[1], 10), away: parseInt(match[2], 10) };
  }
  return null;
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Estimate quarter totals (GENERIC - not league-specific)
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_estimateQuarterTotals_(gameTotal) {
  // Generic basketball distribution (roughly equal quarters, Q4 slightly variable)
  var factors = { Q1: 0.25, Q2: 0.25, Q3: 0.25, Q4: 0.25 };
  var result = {};
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(Q) {
    result[Q] = Math.round(gameTotal * factors[Q] * 10) / 10;
  });
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Team name normalization (GENERIC - no league-specific aliases)
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_normalizeTeamName_(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
}


// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Normalize quarter string
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_normalizeQuarter_(val) {
  var s = String(val || '').trim().toUpperCase();
  if (s === 'Q1' || s === '1' || s === 'QUARTER 1' || s === '1ST' || s === 'FIRST') return 'Q1';
  if (s === 'Q2' || s === '2' || s === 'QUARTER 2' || s === '2ND' || s === 'SECOND') return 'Q2';
  if (s === 'Q3' || s === '3' || s === 'QUARTER 3' || s === '3RD' || s === 'THIRD') return 'Q3';
  if (s === 'Q4' || s === '4' || s === 'QUARTER 4' || s === '4TH' || s === 'FOURTH') return 'Q4';
  if (s === 'OT' || s === 'OVERTIME') return 'OT';
  return '';
}


// ═══════════════════════════════════════════════════════════════════════════
// CORE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════


function t2ou_findCol_(hm, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var k = String(candidates[i]).toLowerCase().replace(/[\s\-\/()]+/g, '');
    if (hm[k] !== undefined) return hm[k];
    var k2 = String(candidates[i]).toLowerCase();
    if (hm[k2] !== undefined) return hm[k2];
  }
  return undefined;
}


function t2ou_getVal_(row, hm, keys) {
  for (var i = 0; i < keys.length; i++) {
    var idx = hm[keys[i]];
    if (idx !== undefined && row[idx] !== '' && row[idx] !== null && row[idx] !== undefined) {
      return row[idx];
    }
  }
  return null;
}

function t2ou_parseNum_(val) {
  if (val === null || val === undefined || val === '') return NaN;
  var n = Number(val);
  return isFinite(n) ? n : NaN;
}

function t2ou_parsePercent_(val) {
  if (val === null || val === undefined || val === '') return NaN;
  var s = String(val).replace('%', '').trim();
  var n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

function t2ou_extractDateKey_(row, hm) {
  var dateVal = t2ou_getVal_(row, hm, ['date', 'game_date', 'gamedate']);
  if (!dateVal) return '';
  try {
    return Utilities.formatDate(new Date(dateVal), Session.getScriptTimeZone(), 'yyyyMMdd');
  } catch (e) {
    return '';
  }
}

function t2ou_isValidQuarterScore_(score) {
  // Generic: valid for any basketball league (0-99 points per quarter is reasonable)
  return isFinite(score) && score >= 0 && score <= 99;
}


function t2ou_stdDev_(arr) {
  if (!arr || arr.length < 2) return NaN;
  var mu = t2ou_mean_(arr);
  var sumSq = 0;
  for (var i = 0; i < arr.length; i++) {
    var d = arr[i] - mu;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (arr.length - 1));
}


// ═══════════════════════════════════════════════════════════════════════════
// STATS BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function t2ou_buildTotalsStatsFromRows_(rows) {
  var teamStats = {};
  var leagueTotals = { Q1: [], Q2: [], Q3: [], Q4: [] };

  function initTeam_(team) {
    if (!teamStats[team]) teamStats[team] = { Home: {}, Away: {} };
  }

  function push_(team, venue, Q, total, enrichment) {
    initTeam_(team);
    if (!teamStats[team][venue][Q]) {
      teamStats[team][venue][Q] = { totals: [], sum: 0, count: 0, lines: [], confidenceSum: 0 };
    }
    var o = teamStats[team][venue][Q];
    o.totals.push(total);
    o.sum += total;
    o.count += 1;

    if (enrichment && isFinite(enrichment.line)) {
      o.lines.push(enrichment.line);
      o.confidenceSum += enrichment.confidence || 0;
    }
  }

  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    var enrichment = { line: s.line, confidence: s.confidenceWeight };
    push_(s.homeTeam, 'Home', s.quarter, s.actualTotal, enrichment);
    push_(s.awayTeam, 'Away', s.quarter, s.actualTotal, enrichment);
    leagueTotals[s.quarter].push(s.actualTotal);
  }

  Object.keys(teamStats).forEach(function(team) {
    ['Home', 'Away'].forEach(function(venue) {
      ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(Q) {
        var o = teamStats[team][venue][Q];
        if (!o || o.count < 1) return;

        o.avgTotal = o.sum / o.count;
        o.samples = o.count;
        o.stdDev = t2ou_stdDev_(o.totals);

        if (o.lines.length > 0) {
          o.avgLine = t2ou_mean_(o.lines);
          o.avgConfidence = o.confidenceSum / o.count;
          var overCount = 0;
          for (var j = 0; j < Math.min(o.totals.length, o.lines.length); j++) {
            if (o.totals[j] > o.lines[j]) overCount++;
          }
          o.overRate = o.lines.length > 0 ? overCount / o.lines.length : 0.5;
        }
      });
    });
  });

  var league = {};
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(Q) {
    var mu = t2ou_mean_(leagueTotals[Q]);
    var sd = t2ou_stdDev_(leagueTotals[Q]);
    if (!isFinite(mu)) mu = 55;
    if (!isFinite(sd) || sd <= 0) sd = 8;
    league[Q] = { mu: mu, sd: sd, samples: (leagueTotals[Q] || []).length };
  });

  return { teamStats: teamStats, league: league };
}

function t2ou_evalOUConfig_(testRows, teamStatsTrain, leagueTrain, proxyLine, usingRealLines, cand) {
  var FN = 't2ou_evalOUConfig_';
  var cfg = t2ou_sanitizeOUConfig_(cand);

  var picks = 0, hits = 0, misses = 0, pushes = 0;
  var evSum = 0, brierSum = 0;

  for (var i = 0; i < testRows.length; i++) {
    var s = testRows[i];
    if (!s) continue;

    var model = t2ou_predictQuarterTotal_(s.homeTeam, s.awayTeam, s.quarter, teamStatsTrain, leagueTrain, cfg);
    if (!model) continue;

    var line, lineSource, rawLine, fallbackUsed;

    if (usingRealLines && isFinite(s.line)) {
      line = s.line;
      rawLine = s.line;
      lineSource = s.lineSource || 'sample.line';
      fallbackUsed = false;
    } else {
      line = t2ou_roundHalf_(proxyLine[s.quarter]);
      rawLine = proxyLine[s.quarter];
      lineSource = 'proxyLine[' + s.quarter + ']';
      fallbackUsed = !!usingRealLines; // wanted real but didn't have it
    }

    if (!isFinite(line)) continue;

    var meta = {
      source: FN,
      caller: FN,
      lineSource: lineSource,
      rawLine: rawLine,
      rawLineIn: (usingRealLines ? s.line : rawLine),
      fallbackUsed: fallbackUsed,
      league: s.league || '',
      quarter: s.quarter || '',
      match: String(s.homeTeam || '') + ' vs ' + String(s.awayTeam || ''),
      home: s.homeTeam,
      away: s.awayTeam,
      sheet: s.source || '',
      gameKey: s.gameKey || '',
      dateKey: s.dateKey || ''
    };

    var scored = t2ou_scoreOverUnderPick_(model, line, cfg, null, meta);
    if (!scored || !scored.play) continue;

    picks++;
    evSum += scored.ev;

    var dirU = String(scored.dir || scored.direction || '').toUpperCase();

    var actualDir;
    if (s.actualTotal > line) actualDir = 'OVER';
    else if (s.actualTotal < line) actualDir = 'UNDER';
    else actualDir = 'PUSH';

    // Brier uses UNCONDITIONAL pWin (push -> 0.5)
    var y = (actualDir === 'PUSH') ? 0.5 : (actualDir === dirU ? 1 : 0);
    brierSum += Math.pow((scored.pWin || 0) - y, 2);

    if (actualDir === 'PUSH') {
      pushes += 1;
      hits += 0.5;
    } else if (actualDir === dirU) {
      hits += 1;
    } else {
      misses += 1;
    }
  }

  var denom = hits + misses;
  var hitRate = denom > 0 ? (hits / denom) * 100 : 0;
  var coverage = testRows.length ? (picks / testRows.length) * 100 : 0;
  var avgEV = picks ? (evSum / picks) : 0;
  var brier = picks ? (brierSum / picks) : 1;

  var weightedScore =
    0.45 * hitRate +
    0.25 * coverage +
    0.20 * (avgEV * 100) +
    0.10 * ((1 - brier) * 100);

  if (picks < 40) weightedScore *= (picks / 40);

  return {
    picks: picks,
    hitRate: hitRate,
    coverage: coverage,
    avgEV: avgEV,
    brier: brier,
    pushes: pushes,
    weightedScore: weightedScore
  };
}



function t2ou_splitTrainTestByGame_(rows, trainFrac) {
  trainFrac = (trainFrac == null) ? 0.8 : trainFrac;
  var train = [], test = [];

  for (var i = 0; i < rows.length; i++) {
    var u = t2ou_hash01_(String(rows[i].gameKey || ''));
    if (u < trainFrac) train.push(rows[i]);
    else test.push(rows[i]);
  }

  if (train.length < 100 || test.length < 100) {
    train = rows.slice(0, Math.floor(rows.length * trainFrac));
    test = rows.slice(train.length);
  }
  return { train: train, test: test };
}



function t2ou_computeLeagueMeans_(rows) {
  var sum = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  var cnt = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

  for (var i = 0; i < rows.length; i++) {
    var q = rows[i].quarter;
    sum[q] += rows[i].actualTotal;
    cnt[q] += 1;
  }

  return {
    Q1: cnt.Q1 ? (sum.Q1 / cnt.Q1) : 55,
    Q2: cnt.Q2 ? (sum.Q2 / cnt.Q2) : 55,
    Q3: cnt.Q3 ? (sum.Q3 / cnt.Q3) : 55,
    Q4: cnt.Q4 ? (sum.Q4 / cnt.Q4) : 53
  };
}

/**
 * ============================================================================
 * t2ou_writeOUProposalSheet_ - PRODUCTION v6.1
 * ============================================================================
 * FIXES:
 * - Handles both flat structure and nested stats structure
 * - Safe access to all properties
 */
function t2ou_writeOUProposalSheet_(ss, top3, meta) {
  meta = meta || { usingRealLines: false, realLinePct: 0, allSamples: '', trainSamples: '', testSamples: '' };
  
  var sh = t2ou_getSheetInsensitive_(ss, 'Config_Tier2_OU_Proposals');
  if (!sh) {
    sh = ss.insertSheet('Config_Tier2_OU_Proposals');
  }
  sh.clear();
  
  // Helper to safely get stats value
  function getStat_(item, key, decimals) {
    if (!item) return '';
    var val = item.stats ? item.stats[key] : item[key];
    if (val === undefined || val === null) return '';
    if (typeof decimals === 'number' && typeof val === 'number') {
      return val.toFixed(decimals);
    }
    return val;
  }
  
  // Helper to safely get config value
  function getCfg_(item, key) {
    if (!item || !item.config) return '';
    return item.config[key] !== undefined ? item.config[key] : '';
  }
  
  var rows = [];
  rows.push(['Parameter', 'Rank #1', 'Rank #2', 'Rank #3']);
  rows.push(['using_real_lines', meta.usingRealLines ? 'TRUE' : 'FALSE', meta.usingRealLines ? 'TRUE' : 'FALSE', meta.usingRealLines ? 'TRUE' : 'FALSE']);
  rows.push(['real_line_pct', meta.realLinePct + '%', meta.realLinePct + '%', meta.realLinePct + '%']);
  rows.push(['all_samples', meta.allSamples, meta.allSamples, meta.allSamples]);
  rows.push(['train_samples', meta.trainSamples, meta.trainSamples, meta.trainSamples]);
  rows.push(['test_samples', meta.testSamples, meta.testSamples, meta.testSamples]);
  rows.push(['', '', '', '']);
  rows.push(['=== O/U PARAMS (write into Config_Tier2) ===', '', '', '']);
  
  var keys = [
    'ou_edge_threshold', 'ou_min_samples', 'ou_min_ev', 'ou_confidence_scale',
    'ou_shrink_k', 'ou_sigma_floor', 'ou_sigma_scale', 'ou_american_odds'
  ];
  keys.forEach(function(k) {
    rows.push([
      k,
      getCfg_(top3[0], k),
      getCfg_(top3[1], k),
      getCfg_(top3[2], k)
    ]);
  });
  
  rows.push(['', '', '', '']);
  rows.push(['=== METRICS ===', '', '', '']);
  
  // Get metrics - handle both flat and nested structure
  var getMetric = function(item, key, decimals) {
    if (!item) return '';
    var val = item.stats && item.stats[key] !== undefined ? item.stats[key] : item[key];
    if (val === undefined || val === null) return '';
    if (typeof decimals === 'number' && typeof val === 'number') {
      return val.toFixed(decimals);
    }
    return val;
  };
  
  rows.push(['weightedScore', getMetric(top3[0], 'weightedScore', 4) || getMetric(top3[0], 'compositeScore', 4), 
                              getMetric(top3[1], 'weightedScore', 4) || getMetric(top3[1], 'compositeScore', 4), 
                              getMetric(top3[2], 'weightedScore', 4) || getMetric(top3[2], 'compositeScore', 4)]);
  
  // hitRate = accuracy * 100
  var hr0 = top3[0] ? ((top3[0].stats && top3[0].stats.hitRate) || (top3[0].accuracy * 100)) : '';
  var hr1 = top3[1] ? ((top3[1].stats && top3[1].stats.hitRate) || (top3[1].accuracy * 100)) : '';
  var hr2 = top3[2] ? ((top3[2].stats && top3[2].stats.hitRate) || (top3[2].accuracy * 100)) : '';
  rows.push(['hitRate%', typeof hr0 === 'number' ? hr0.toFixed(1) : hr0, 
                         typeof hr1 === 'number' ? hr1.toFixed(1) : hr1, 
                         typeof hr2 === 'number' ? hr2.toFixed(1) : hr2]);
  
  // coverage
  var cov0 = top3[0] && top3[0].stats ? top3[0].stats.coverage : '';
  var cov1 = top3[1] && top3[1].stats ? top3[1].stats.coverage : '';
  var cov2 = top3[2] && top3[2].stats ? top3[2].stats.coverage : '';
  rows.push(['coverage%', typeof cov0 === 'number' ? cov0.toFixed(1) : cov0,
                          typeof cov1 === 'number' ? cov1.toFixed(1) : cov1,
                          typeof cov2 === 'number' ? cov2.toFixed(1) : cov2]);
  
  // avgEV = roi
  var ev0 = top3[0] ? ((top3[0].stats && top3[0].stats.avgEV) || top3[0].roi) : '';
  var ev1 = top3[1] ? ((top3[1].stats && top3[1].stats.avgEV) || top3[1].roi) : '';
  var ev2 = top3[2] ? ((top3[2].stats && top3[2].stats.avgEV) || top3[2].roi) : '';
  rows.push(['avgEV', typeof ev0 === 'number' ? ev0.toFixed(4) : ev0,
                      typeof ev1 === 'number' ? ev1.toFixed(4) : ev1,
                      typeof ev2 === 'number' ? ev2.toFixed(4) : ev2]);
  
  rows.push(['brier', getMetric(top3[0], 'brier', 4), getMetric(top3[1], 'brier', 4), getMetric(top3[2], 'brier', 4)]);
  rows.push(['picks', getMetric(top3[0], 'picks'), getMetric(top3[1], 'picks'), getMetric(top3[2], 'picks')]);
  rows.push(['pushes', getMetric(top3[0], 'pushes') || 0, getMetric(top3[1], 'pushes') || 0, getMetric(top3[2], 'pushes') || 0]);
  
  rows.push(['', '', '', '']);
  rows.push(['last_updated', new Date(), new Date(), new Date()]);
  rows.push(['updated_by', 'tuneTier2OUConfig v6.1', 'tuneTier2OUConfig v6.1', 'tuneTier2OUConfig v6.1']);
  
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#d9ead3');
  sh.autoResizeColumns(1, 4);
  sh.setFrozenRows(1);
  
  return sh;
}


function t2ou_applyProposalRankToConfig_(ss, rank) {
  rank = rank || 1;

  var prop = t2ou_getSheetInsensitive_(ss, 'Config_Tier2_OU_Proposals');
  if (!prop) throw new Error('Config_Tier2_OU_Proposals not found. Run tuner first.');

  var cfg = t2ou_getSheetInsensitive_(ss, 'Config_Tier2') || ss.insertSheet('Config_Tier2');

  var data = prop.getDataRange().getValues();
  if (!data || data.length < 5) throw new Error('Config_Tier2_OU_Proposals is empty.');

  var col = (rank === 1) ? 1 : (rank === 2) ? 2 : (rank === 3) ? 3 : null;
  if (col === null) throw new Error('rank must be 1, 2, or 3.');

  var map = {};
  for (var r = 1; r < data.length; r++) {
    var key = String(data[r][0] || '').trim().toLowerCase();
    if (!key || key.indexOf('===') === 0) continue;
    map[key] = data[r][col];
  }

  var cfgData = cfg.getDataRange().getValues();
  if (!cfgData.length) cfgData = [['', '']];

  var rowByKey = {};
  for (var i = 0; i < cfgData.length; i++) {
    var k = String(cfgData[i][0] || '').trim().toLowerCase();
    if (k) rowByKey[k] = i + 1;
  }

  function setKV_(k, v) {
    var kk = k.toLowerCase();
    var row = rowByKey[kk];
    if (!row) {
      row = cfg.getLastRow() + 1;
      cfg.getRange(row, 1).setValue(k);
      rowByKey[kk] = row;
    }
    cfg.getRange(row, 2).setValue(v);
  }

  [
    'ou_edge_threshold', 'ou_min_samples', 'ou_min_ev', 'ou_confidence_scale',
    'ou_shrink_k', 'ou_sigma_floor', 'ou_sigma_scale', 'ou_american_odds'
  ].forEach(function(k) {
    if (map[k] !== undefined && map[k] !== '') setKV_(k, map[k]);
  });

  setKV_('last_updated', new Date());
  setKV_('updated_by', 't2ou_applyProposalRankToConfig_ rank ' + rank);

  SpreadsheetApp.getUi().alert(
    'Applied Tier 2 O/U Config',
    'Applied Rank #' + rank + ' into Config_Tier2.\n\nNow rerun: Run Tier 2 O/U.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return true;
}




function t2ou_loadTier2Config_(ss) {
  if (typeof loadTier2Config === 'function') {
    try { return loadTier2Config(ss); } catch (e) {}
  }

  var cfg = {};
  var sh = t2ou_getSheetInsensitive_(ss, 'Config_Tier2');
  if (!sh) return cfg;

  var values = sh.getDataRange().getValues();
  for (var r = 0; r < values.length; r++) {
    var k = String(values[r][0] || '').trim();
    if (!k) continue;
    cfg[k] = values[r][1];
  }
  return cfg;
}

function t2ou_getSheetInsensitive_(ss, name) {
  if (typeof getSheetInsensitive === 'function') {
    try { return getSheetInsensitive(ss, name); } catch (e) {}
  }

  var target = String(name || '').toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getName()).toLowerCase() === target) return sheets[i];
  }
  return null;
}

function t2ou_headerMap_(headers) {
  if (typeof createHeaderMap === 'function') {
    try { return createHeaderMap(headers); } catch (e) {}
  }

  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var k = String(headers[i] || '').trim().toLowerCase();
    if (k) map[k] = i;
  }
  
  if (map['home team'] !== undefined && map.home === undefined) map.home = map['home team'];
  if (map['away team'] !== undefined && map.away === undefined) map.away = map['away team'];
  
  return map;
}

function t2ou_ensureColumnsIn2D_(data, colNames) {
  var headers = data[0];

  var missing = [];
  for (var i = 0; i < colNames.length; i++) {
    var target = String(colNames[i]).toLowerCase().trim().replace(/[\\s_-]+/g, '');
    var found = false;
    for (var j = 0; j < headers.length; j++) {
      var hStr = String(headers[j]).toLowerCase().trim().replace(/[\\s_-]+/g, '');
      if (hStr === target) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(colNames[i]);
  }
  if (!missing.length) return data;

  for (var m = 0; m < missing.length; m++) {
    headers.push(missing[m]);
  }

  for (var r = 1; r < data.length; r++) {
    while (data[r].length < headers.length) data[r].push('');
  }
  data[0] = headers;
  return data;
}

function t2ou_parseBookLine_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return NaN;

  if (s.match(/^\d+\s*[-:]\s*\d+$/)) return NaN;

  s = s.replace(/½/g, '.5');
  s = s.replace(/,/g, '.');

  var m = s.match(/(\d+(\.\d+)?)/);
  if (!m) return NaN;

  var n = parseFloat(m[1]);
  if (!isFinite(n)) return NaN;

  if (n < 10 || n > 150) return NaN;

  return n;
}


function t2ou_mean_(arr) {
  if (!arr || !arr.length) return NaN;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}



function t2ou_normCdf_(z) {
  var sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);

  var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;

  var t = 1 / (1 + p * z);
  var erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function t2ou_range_(start, end, step) {
  var out = [];
  for (var x = start; x <= end + 1e-12; x += step) {
    out.push(Math.round(x * 1000) / 1000);
  }
  return out;
}

/**
 * ============================================================================
 * t2ou_hash01_ - Helper
 * ============================================================================
 * Simple hash function returning value in [0, 1) for any string.
 */
function t2ou_hash01_(str) {
  var hash = 0;
  str = String(str);
  for (var i = 0; i < str.length; i++) {
    var char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash % 10000) / 10000;
}


/**
 * Run O/U Analysis
 */
function runOUAnalysis(ss) {
  ss = _ensureSpreadsheet_(ss);
  
  try {
    if (!ss) throw new Error('Spreadsheet not available.');
    
    _safeToast_(ss, 'Running O/U Analysis...', 'Ma Golide', 10);
    var result = predictQuarters_Tier2_OU(ss);
    _safeToast_(ss, 'O/U Complete', 'Ma Golide', 3);
    
    return result || { ok: true };
  } catch (e) {
    Logger.log('[runOUAnalysis] ' + e.message);
    _safeAlert_('O/U Error', e.message);
    return { ok: false, error: e.message };
  }
}
