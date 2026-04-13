/******************************************************************************
 * CONFIG LEDGER — Satellite Module
 * Repo: Ma_Golide_Satellites
 *
 * Paste AFTER Module_00_Contract_Enforcer in the Apps Script project.
 *
 * Call ConfigLedger_Satellite.stampRow(sheet, rowIndex) after writing a row
 * to Bet_Slips / forensic logs / any machine contract the Assayer reads.
 ******************************************************************************/

// ============================================================================
// Public API
// ============================================================================
var ConfigLedger_Satellite = {

  stampRow: function (sheet, rowIndex, configObj) {
    try {
      var cfg = configObj || this._buildConfigSnapshot();
      var stampId = this._deriveStampId(cfg);
      this._ensureLedgerRow(sheet.getParent(), stampId, cfg);
      var stampCol = this._findOrCreateStampColumn(sheet);
      sheet.getRange(rowIndex, stampCol).setValue(stampId);
      return stampId;
    } catch (err) {
      console.warn("[ConfigLedger_Satellite] stampRow failed: " + err.message);
      return null;
    }
  },

  stampBatch: function (sheet, startRow, count, configObj) {
    try {
      var cfg = configObj || this._buildConfigSnapshot();
      var stampId = this._deriveStampId(cfg);
      this._ensureLedgerRow(sheet.getParent(), stampId, cfg);
      var stampCol = this._findOrCreateStampColumn(sheet);
      var values = [];
      for (var i = 0; i < count; i++) {
        values.push([stampId]);
      }
      sheet.getRange(startRow, stampCol, count, 1).setValues(values);
      return stampId;
    } catch (err) {
      console.warn("[ConfigLedger_Satellite] stampBatch failed: " + err.message);
      return null;
    }
  },

  getCurrentStampId: function (configObj) {
    var cfg = configObj || this._buildConfigSnapshot();
    return this._deriveStampId(cfg);
  },

  getOrCreateLedger: function (ss) {
    var LEDGER_NAME = "Config_Ledger";
    var sheet = ss.getSheetByName(LEDGER_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LEDGER_NAME);
      this._formatLedgerHeader(sheet);
    }
    return sheet;
  },

  _buildConfigSnapshot: function () {
    var safeGet = function (fn) {
      try {
        return fn();
      } catch (_) {
        return null;
      }
    };

    return {
      version: safeGet(function () {
        return CONTRACT_VERSION;
      }) || "MULTI-LEAGUE-STRICT-2.0",
      built_at: safeGet(function () {
        return CONTRACT_BUILD_DATE;
      }) || new Date().toISOString().split("T")[0],
      active_leagues: safeGet(function () {
        return typeof ACTIVE_LEAGUES !== "undefined" && ACTIVE_LEAGUES
          ? JSON.stringify(ACTIVE_LEAGUES.slice().sort())
          : "[]";
      }) || "[]",
      tier_strong_min: safeGet(function () {
        return typeof TIER_THRESHOLDS !== "undefined" ? TIER_THRESHOLDS.strong : null;
      }),
      tier_medium_min: safeGet(function () {
        return typeof TIER_THRESHOLDS !== "undefined" ? TIER_THRESHOLDS.medium : null;
      }),
      conf_min: safeGet(function () {
        return typeof CONFIDENCE_THRESHOLDS !== "undefined" ? CONFIDENCE_THRESHOLDS.min : null;
      }),
      conf_elite: safeGet(function () {
        return typeof CONFIDENCE_THRESHOLDS !== "undefined" ? CONFIDENCE_THRESHOLDS.elite : null;
      }),
      spread_buckets: safeGet(function () {
        return typeof SPREAD_BUCKETS !== "undefined" ? JSON.stringify(SPREAD_BUCKETS) : "[]";
      }) || "[]",
      line_buckets: safeGet(function () {
        return typeof LINE_BUCKETS !== "undefined" ? JSON.stringify(LINE_BUCKETS) : "[]";
      }) || "[]",
      conf_buckets: safeGet(function () {
        return typeof CONF_BUCKETS !== "undefined" ? JSON.stringify(CONF_BUCKETS) : "[]";
      }) || "[]",
      strict_side: typeof ENFORCE_STRICT_SIDE !== "undefined" ? ENFORCE_STRICT_SIDE : true,
      outright_only: typeof OUTRIGHT_ONLY !== "undefined" ? OUTRIGHT_ONLY : true
    };
  },

  _deriveStampId: function (cfg) {
    var keys = Object.keys(cfg).sort();
    var canonical = JSON.stringify(cfg, keys);
    return "CFG_" + this._djb2Hash(canonical);
  },

  _djb2Hash: function (str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
      h = h & 0xffffffff;
    }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  },

  _ensureLedgerRow: function (ss, stampId, cfg) {
    var sheet = this.getOrCreateLedger(ss);
    var data = sheet.getDataRange().getValues();
    var r;
    for (r = 1; r < data.length; r++) {
      if (data[r][0] === stampId) {
        return;
      }
    }
    var now = new Date().toISOString();
    sheet.appendRow([
      stampId,
      cfg.version || "",
      cfg.built_at || "",
      cfg.active_leagues || "",
      JSON.stringify({ strong: cfg.tier_strong_min, medium: cfg.tier_medium_min }),
      JSON.stringify({ min: cfg.conf_min, elite: cfg.conf_elite }),
      cfg.spread_buckets || "",
      cfg.line_buckets || "",
      cfg.conf_buckets || "",
      "",
      now
    ]);
  },

  _formatLedgerHeader: function (sheet) {
    var headers = [
      "stamp_id", "version", "built_at", "leagues",
      "tier_weights", "conf_thresholds", "spread_buckets",
      "line_buckets", "conf_buckets", "notes", "created_at"
    ];
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(11, 180);
  },

  _findOrCreateStampColumn: function (sheet) {
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0];
    var i;
    for (i = 0; i < headers.length; i++) {
      if (String(headers[i]).toLowerCase().replace(/[\s_]/g, "") === "configstamp") {
        return i + 1;
      }
    }
    var newCol = headers.length + 1;
    sheet.getRange(1, newCol)
      .setValue("config_stamp")
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    return newCol;
  }
};
