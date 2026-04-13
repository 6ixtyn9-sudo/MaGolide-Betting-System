/******************************************************************************
 * CONFIG LEDGER - Satellite Module
 * Repo: Ma_Golide_Satellites
 *
 * PURPOSE:
 *   Writes a config fingerprint into every prediction row at the moment a
 *   pick is committed to the Side / Totals sheet. The Assayer can then
 *   group grades by the config version that generated each bet - closing the
 *   config-blindness gap in the tuning loop.
 *
 * INTEGRATION:
 *   1. Add this file to the Satellite Apps Script project.
 *   2. In Contract_Enforcer.gs (MULTI-LEAGUE-STRICT-2.0), call
 *        ConfigLedger_Satellite.stampRow(sheet, rowIndex)
 *      immediately after writing a prediction row.
 *   3. Ensure the Side / Totals sheets have a "config_stamp" column
 *      (the stamper will create it if absent).
 *
 * LEDGER SHEET ("Config_Ledger"):
 *   Columns: stamp_id | version | built_at | leagues | tier_weights |
 *            conf_thresholds | spread_buckets | line_buckets | notes | created_at
 *
 * DESIGN INVARIANT:
 *   - A stamp_id is a deterministic hash of the config parameters, not a
 *     random UUID, so identical configs always produce the same stamp.
 *   - The ledger row is written once per unique stamp; subsequent rows with
 *     the same stamp reference it without re-writing.
 *   - Never mutate a ledger row once written. Treat as append-only.
 ******************************************************************************/

// ============================================================================
// Public API
// ============================================================================
const ConfigLedger_Satellite = {

  // --------------------------------------------------------------------------
  // stampRow
  //   sheet     - the Side or Totals Sheet object
  //   rowIndex  - 1-based row number of the prediction just written
  //   configObj - (optional) explicit config snapshot; defaults to
  //               _buildConfigSnapshot() from the active project config
  // --------------------------------------------------------------------------
  stampRow(sheet, rowIndex, configObj) {
    try {
      const cfg = configObj || this._buildConfigSnapshot();
      const stampId = this._deriveStampId(cfg);

      // Ensure the ledger row exists before stamping the data row
      this._ensureLedgerRow(sheet.getParent(), stampId, cfg);

      // Write the stamp_id into the prediction row
      const stampCol = this._findOrCreateStampColumn(sheet);
      sheet.getRange(rowIndex, stampCol).setValue(stampId);

      return stampId;
    } catch (err) {
      // Non-fatal: log but do not block prediction writing
      console.warn(`[ConfigLedger_Satellite] stampRow failed: ${err.message}`);
      return null;
    }
  },

  // --------------------------------------------------------------------------
  // stampBatch
  //   Stamps a contiguous range of rows with the same config fingerprint.
  //   Use when writing multiple predictions in a single flush.
  // --------------------------------------------------------------------------
  stampBatch(sheet, startRow, count, configObj) {
    try {
      const cfg = configObj || this._buildConfigSnapshot();
      const stampId = this._deriveStampId(cfg);
      this._ensureLedgerRow(sheet.getParent(), stampId, cfg);

      const stampCol = this._findOrCreateStampColumn(sheet);
      const values = Array.from({ length: count }, () => [stampId]);
      sheet.getRange(startRow, stampCol, count, 1).setValues(values);

      return stampId;
    } catch (err) {
      console.warn(`[ConfigLedger_Satellite] stampBatch failed: ${err.message}`);
      return null;
    }
  },

  // --------------------------------------------------------------------------
  // getCurrentStampId
  //   Returns the stamp_id for the current config without writing anything.
  //   Useful for pre-flight checks.
  // --------------------------------------------------------------------------
  getCurrentStampId(configObj) {
    const cfg = configObj || this._buildConfigSnapshot();
    return this._deriveStampId(cfg);
  },

  // --------------------------------------------------------------------------
  // getOrCreateLedger
  //   Returns the Config_Ledger sheet, creating it if absent.
  // --------------------------------------------------------------------------
  getOrCreateLedger(ss) {
    const LEDGER_NAME = "Config_Ledger";
    let sheet = ss.getSheetByName(LEDGER_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LEDGER_NAME);
      this._formatLedgerHeader(sheet);
    }
    return sheet;
  },

  // ============================================================================
  // Internal helpers
  // ============================================================================

  // Build a canonical config snapshot from the Satellite's active config.
  // Extend this function as your Satellite config grows.
  _buildConfigSnapshot() {
    // Attempt to read from ContractEnforcer / Satellite config objects.
    // Falls back gracefully if they aren't in scope.
    const safeGet = (fn) => { try { return fn(); } catch (_) { return null; } };

    // Get configurations from the new config managers
    const tier1Config = safeGet(() => getTier1Config()) || {};
    const tier2Config = safeGet(() => getTier2Config()) || {};
    const enforcementFlags = safeGet(() => getEnforcementFlags()) || {};

    return {
      // Core identity - bump this manually when logic changes materially
      version:           safeGet(() => CONTRACT_VERSION) || "MULTI-LEAGUE-STRICT-2.0",
      built_at:          safeGet(() => CONTRACT_BUILD_DATE) || new Date().toISOString().split("T")[0],

      // League scope
      active_leagues:    JSON.stringify(safeGet(() => getActiveLeagues())?.sort() || []),

      // Tier / confidence thresholds
      tier_strong_min:   tier1Config.TIER_STRONG_MIN || null,
      tier_medium_min:   tier1Config.TIER_MEDIUM_MIN || null,
      conf_min:          tier1Config.CONF_MIN || null,
      conf_elite:        tier1Config.CONF_ELITE || null,

      // Bucket boundaries (serialised for hashing)
      spread_buckets:    JSON.stringify(tier2Config.SPREAD_BUCKETS || []),
      line_buckets:      JSON.stringify(tier2Config.LINE_BUCKETS || []),
      conf_buckets:      JSON.stringify(tier2Config.CONF_BUCKETS || []),

      // Enforcement flags
      strict_side:       enforcementFlags.strict_side ?? true,
      outright_only:     enforcementFlags.outright_only ?? true,
    };
  },

  // Deterministic fingerprint - SHA-256 would be ideal but Apps Script lacks
  // a native crypto API. We use a fast djb2-style hash over the sorted JSON.
  _deriveStampId(cfg) {
    const canonical = JSON.stringify(cfg, Object.keys(cfg).sort());
    return "CFG_" + this._djb2Hash(canonical);
  },

  _djb2Hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
      h = h & 0xFFFFFFFF; // keep 32-bit
    }
    // Return as unsigned hex, zero-padded to 8 chars
    return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  },

  // Write the ledger row if this stamp_id has not been seen before.
  _ensureLedgerRow(ss, stampId, cfg) {
    const sheet = this.getOrCreateLedger(ss);
    const data = sheet.getDataRange().getValues();

    // Check column 1 (stamp_id) for existing entry
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === stampId) return; // already registered
    }

    // Append new ledger row
    const now = new Date().toISOString();
    sheet.appendRow([
      stampId,                      // stamp_id
      cfg.version || "",            // version
      cfg.built_at || "",           // built_at
      cfg.active_leagues || "",     // leagues
      JSON.stringify({              // tier_weights (compact)
        strong: cfg.tier_strong_min,
        medium: cfg.tier_medium_min
      }),
      JSON.stringify({              // conf_thresholds
        min:   cfg.conf_min,
        elite: cfg.conf_elite
      }),
      cfg.spread_buckets || "",     // spread_buckets
      cfg.line_buckets || "",       // line_buckets
      cfg.conf_buckets || "",       // conf_buckets (bonus column)
      "",                           // notes (manual field)
      now                           // created_at
    ]);
  },

  _formatLedgerHeader(sheet) {
    const headers = [
      "stamp_id", "version", "built_at", "leagues",
      "tier_weights", "conf_thresholds", "spread_buckets",
      "line_buckets", "conf_buckets", "notes", "created_at"
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);   // stamp_id
    sheet.setColumnWidth(2, 120);   // version
    sheet.setColumnWidth(11, 180);  // created_at
  },

  // Returns the 1-based column index of "config_stamp" in the sheet,
  // creating the header cell if the column doesn't exist yet.
  _findOrCreateStampColumn(sheet) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (let i = 0; i < headers.length; i++) {
      if (String(headers[i]).toLowerCase().replace(/[\s_]/g, "") === "configstamp") {
        return i + 1;
      }
    }
    // Append new column
    const newCol = headers.length + 1;
    sheet.getRange(1, newCol)
      .setValue("config_stamp")
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    return newCol;
  }
};
