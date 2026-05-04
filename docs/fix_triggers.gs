// ============================================================
// FIX: Trigger Cleanup + Safe Re-run for Ma Golide Satellites
// ============================================================
// STEP 1: Run nukeAllTriggers() first to clear the pile-up
// STEP 2: Run safeLaunch() to start fresh with one clean trigger
// ============================================================


/**
 * STEP 1 — Run this first.
 * Deletes EVERY trigger in this project (all the duplicates).
 * Safe to run on any satellite sheet via the Apps Script editor.
 */
function nukeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = triggers.length;
  triggers.forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  Logger.log('✅ nukeAllTriggers: Deleted ' + count + ' trigger(s). Slate is clean.');
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Deleted ' + count + ' trigger(s). Ready for clean launch.',
    'Trigger Cleanup', 5
  );
}


/**
 * STEP 2 — Run this after nukeAllTriggers().
 *
 * Why the original trigger didn't fire:
 * - The syncer (script_syncer.py) calls update_project_content() which REPLACES
 *   the script source but does NOT call setupOneTimeTrigger().
 * - The trigger is only created if something explicitly calls setupOneTimeTrigger()
 *   AFTER the script is bound.  If the syncer just pushed new code without calling it,
 *   no trigger was ever registered.
 * - Every subsequent sync pushed the code again, but each time setupOneTimeTrigger()
 *   was called manually (or via the API), it stacked another trigger without cleaning
 *   up the old ones — hence the pile-up.
 *
 * This function:
 * 1. Clears any remaining runTheWholeShebang triggers (safety net)
 * 2. Creates exactly ONE fresh 1-minute trigger
 * 3. Logs it clearly
 */
function safeLaunch() {
  // Safety net: remove any lingering runTheWholeShebang triggers
  var cleared = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'runTheWholeShebang') {
      ScriptApp.deleteTrigger(t);
      cleared++;
    }
  });
  if (cleared > 0) {
    Logger.log('⚠️  safeLaunch: Cleared ' + cleared + ' leftover runTheWholeShebang trigger(s) before launch.');
  }

  // Create ONE clean 1-minute trigger
  ScriptApp.newTrigger('runTheWholeShebang')
    .timeBased()
    .after(60000) // 1 minute
    .create();

  var msg = '🚀 safeLaunch: Single trigger created. runTheWholeShebang fires in ~1 minute.';
  Logger.log(msg);
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Ma Golide Launch', 10);
}


/**
 * HARDENED REPLACEMENT for setupOneTimeTrigger()
 *
 * Drop this into Sheet_Setup.gs (or wherever setupOneTimeTrigger lives)
 * to prevent the pile-up from ever happening again.
 *
 * Key change: it ALWAYS wipes existing runTheWholeShebang triggers before
 * creating a new one — so no matter how many times the syncer calls this,
 * only ONE trigger exists at a time.
 */
function setupOneTimeTrigger() {
  // ── Guard: delete any existing triggers for runTheWholeShebang ──────────
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'runTheWholeShebang';
  });
  existing.forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  if (existing.length > 0) {
    Logger.log('[setupOneTimeTrigger] Cleared ' + existing.length + ' existing trigger(s) before creating new one.');
  }

  // ── Create exactly ONE fresh trigger ─────────────────────────────────────
  ScriptApp.newTrigger('runTheWholeShebang')
    .timeBased()
    .after(60000) // 1 minute
    .create();

  Logger.log('[setupOneTimeTrigger] ✅ Single trigger created. runTheWholeShebang fires in ~1 minute.');
}


/**
 * HARDENED REPLACEMENT for _shebang_scheduleResume_()
 *
 * Same principle: only ONE resume trigger at a time.
 * Prevents resume triggers from piling up if the 6-min wall is hit repeatedly.
 */
function _shebang_scheduleResume_() {
  // Clear any existing resume triggers
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'runTheWholeShebang') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Schedule exactly ONE resume
  ScriptApp.newTrigger('runTheWholeShebang')
    .timeBased()
    .after(60000)
    .create();

  Logger.log('[_shebang_scheduleResume_] ✅ Resume trigger set for ~1 minute from now.');
}


/**
 * DIAGNOSTIC — Shows all current triggers in this project.
 * Run this at any time to see what's registered.
 */
function listAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('=== Current Triggers (' + triggers.length + ') ===');
  triggers.forEach(function(t, i) {
    Logger.log(
      '#' + (i + 1) + ' → ' +
      'fn=' + t.getHandlerFunction() + ' | ' +
      'type=' + t.getEventType() + ' | ' +
      'id=' + t.getUniqueId()
    );
  });
  if (triggers.length === 0) Logger.log('(none — slate is clean)');
}
