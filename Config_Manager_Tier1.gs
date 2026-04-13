/******************************************************************************
 * CONFIG MANAGER - Tier1
 * Manages Tier1 configuration constants with validation
 ******************************************************************************/

// ============================================================================
// TIER1 CONFIGURATION MANAGER
// ============================================================================

const ConfigManager_Tier1 = {
  
  // --------------------------------------------------------------------------
  // loadConfig - Load Tier1 configuration from Config_Tier1 sheet
  // --------------------------------------------------------------------------
  loadConfig() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("Config_Tier1");
    
    if (!configSheet) {
      console.warn("Config_Tier1 sheet not found, using defaults");
      return this._getDefaultConfig();
    }
    
    const data = configSheet.getDataRange().getValues();
    const config = {};
    
    // Parse config rows (skip header)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 3 && row[0]) {
        const key = String(row[0]).trim();
        const value = row[1];
        const description = row[2];
        
        // Parse different value types
        config[key] = this._parseConfigValue(value);
      }
    }
    
    return config;
  },
  
  // --------------------------------------------------------------------------
  // saveConfig - Save configuration to Config_Tier1 sheet
  // --------------------------------------------------------------------------
  saveConfig(config) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let configSheet = ss.getSheetByName("Config_Tier1");
    
    if (!configSheet) {
      configSheet = ss.insertSheet("Config_Tier1");
      this._formatConfigSheet(configSheet);
    }
    
    // Clear existing data (preserve header)
    const lastRow = configSheet.getLastRow();
    if (lastRow > 1) {
      configSheet.getRange(2, 1, lastRow - 1, 3).clearContent();
    }
    
    // Write configuration
    const rows = [];
    Object.entries(config).forEach(([key, value]) => {
      rows.push([key, this._serializeConfigValue(value), this._getConfigDescription(key)]);
    });
    
    if (rows.length > 0) {
      configSheet.getRange(2, 1, rows.length, 3).setValues(rows);
      configSheet.getRange(2, 3, rows.length, 1).setWrap(true);
    }
    
    console.log(`Saved ${rows.length} Tier1 configuration items`);
  },
  
  // --------------------------------------------------------------------------
  // validateConfigState - Validate Tier1 configuration state
  // --------------------------------------------------------------------------
  validateConfigState(config) {
    try {
      // Check required fields
      const required = [
        'BREAKEVEN_PROB', 'JUICE', 'FALLBACK_SD', 
        'TIER_STRONG_MIN', 'TIER_MEDIUM_MIN', 'TIER_WEAK_MIN',
        'CONF_MIN', 'CONF_ELITE'
      ];
      
      for (const field of required) {
        if (config[field] === undefined || config[field] === null) {
          console.warn(`Missing required Tier1 config field: ${field}`);
          return false;
        }
      }
      
      // Validate probability values
      if (config.BREAKEVEN_PROB <= 0 || config.BREAKEVEN_PROB >= 1) {
        console.warn('BREAKEVEN_PROB must be between 0 and 1');
        return false;
      }
      
      if (config.JUICE <= 0 || config.JUICE >= 1) {
        console.warn('JUICE must be between 0 and 1');
        return false;
      }
      
      if (config.FALLBACK_SD <= 0) {
        console.warn('FALLBACK_SD must be positive');
        return false;
      }
      
      // Validate tier thresholds
      if (config.TIER_STRONG_MIN <= config.TIER_MEDIUM_MIN ||
          config.TIER_MEDIUM_MIN <= config.TIER_WEAK_MIN ||
          config.TIER_WEAK_MIN <= 0) {
        console.warn('Tier thresholds must be strictly decreasing and positive');
        return false;
      }
      
      // Validate confidence thresholds
      if (config.CONF_MIN <= 0 || config.CONF_MIN >= 1 ||
          config.CONF_ELITE <= 0 || config.CONF_ELITE >= 1 ||
          config.CONF_ELITE <= config.CONF_MIN) {
        console.warn('Confidence thresholds must be valid probabilities with elite > min');
        return false;
      }
      
      return true;
    } catch (err) {
      console.error(`Tier1 config validation failed: ${err.message}`);
      return false;
    }
  },
  
  // --------------------------------------------------------------------------
  // initializeDefaultConfig - Initialize default Tier1 configuration
  // --------------------------------------------------------------------------
  initializeDefaultConfig() {
    const defaultConfig = this._getDefaultConfig();
    this.saveConfig(defaultConfig);
    console.log("Initialized default Tier1 configuration");
    return defaultConfig;
  },
  
  // ============================================================================
  // Private helpers
  // ============================================================================
  
  _getDefaultConfig() {
    return {
      // Core probabilities
      BREAKEVEN_PROB: 0.5238,
      JUICE: 0.05,
      FALLBACK_SD: 0.12,
      
      // Tier thresholds
      TIER_STRONG_MIN: 0.65,
      TIER_MEDIUM_MIN: 0.55,
      TIER_WEAK_MIN: 0.45,
      
      // Confidence thresholds
      CONF_MIN: 0.60,
      CONF_ELITE: 0.85,
      
      // League scope
      ACTIVE_LEAGUES: JSON.stringify(["NBA", "NFL", "MLB", "NHL", "NCAAF", "NCAAB"]),
      
      // Enforcement flags
      ENFORCE_STRICT_SIDE: true,
      OUTRIGHT_ONLY: true,
      
      // Version tracking
      CONFIG_VERSION: "TIER1-1.0",
      LAST_UPDATED: new Date().toISOString()
    };
  },
  
  _parseConfigValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    
    const str = String(value).trim();
    
    // Boolean values
    if (str.toLowerCase() === "true") return true;
    if (str.toLowerCase() === "false") return false;
    
    // JSON values
    if (str.startsWith("[") || str.startsWith("{")) {
      try {
        return JSON.parse(str);
      } catch (e) {
        console.warn(`Failed to parse JSON value: ${str}`);
        return str;
      }
    }
    
    // Numeric values
    const num = parseFloat(str);
    if (!isNaN(num)) {
      return num;
    }
    
    // String values
    return str;
  },
  
  _serializeConfigValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    
    return String(value);
  },
  
  _getConfigDescription(key) {
    const descriptions = {
      'BREAKEVEN_PROB': 'Break-even probability for betting calculations',
      'JUICE': 'Bookmaker juice/vig percentage',
      'FALLBACK_SD': 'Fallback standard deviation for uncertainty',
      'TIER_STRONG_MIN': 'Minimum confidence for Strong tier',
      'TIER_MEDIUM_MIN': 'Minimum confidence for Medium tier',
      'TIER_WEAK_MIN': 'Minimum confidence for Weak tier',
      'CONF_MIN': 'Minimum confidence threshold',
      'CONF_ELITE': 'Elite confidence threshold',
      'ACTIVE_LEAGUES': 'JSON array of active leagues',
      'ENFORCE_STRICT_SIDE': 'Enforce strict side betting rules',
      'OUTRIGHT_ONLY': 'Only allow outright bets',
      'CONFIG_VERSION': 'Configuration version',
      'LAST_UPDATED': 'Last update timestamp'
    };
    
    return descriptions[key] || 'Configuration parameter';
  },
  
  _formatConfigSheet(sheet) {
    const headers = ["config_key", "config_value", "description"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold")
      .setBackground("#1a1a2e")
      .setFontColor("#FFD700");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);  // config_key
    sheet.setColumnWidth(2, 200);  // config_value
    sheet.setColumnWidth(3, 300);  // description
  }
};
