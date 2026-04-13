/******************************************************************************
 * CONFIG MANAGER - Tier2
 * Manages Tier2 configuration constants with validation
 ******************************************************************************/

// ============================================================================
// TIER2 CONFIGURATION MANAGER
// ============================================================================

const ConfigManager_Tier2 = {
  
  // --------------------------------------------------------------------------
  // loadConfig - Load Tier2 configuration from Config_Tier2 sheet
  // --------------------------------------------------------------------------
  loadConfig() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("Config_Tier2");
    
    if (!configSheet) {
      console.warn("Config_Tier2 sheet not found, using defaults");
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
  // saveConfig - Save configuration to Config_Tier2 sheet
  // --------------------------------------------------------------------------
  saveConfig(config) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let configSheet = ss.getSheetByName("Config_Tier2");
    
    if (!configSheet) {
      configSheet = ss.insertSheet("Config_Tier2");
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
    
    console.log(`Saved ${rows.length} Tier2 configuration items`);
  },
  
  // --------------------------------------------------------------------------
  // validateConfigState - Validate Tier2 configuration state
  // --------------------------------------------------------------------------
  validateConfigState(config) {
    try {
      // Check required fields
      const required = [
        'SPREAD_BUCKETS', 'LINE_BUCKETS', 'CONF_BUCKETS',
        'KELLY_MULTIPLIER', 'SHRINKAGE_STRENGTH', 'MIN_SAMPLE_SIZE'
      ];
      
      for (const field of required) {
        if (config[field] === undefined || config[field] === null) {
          console.warn(`Missing required Tier2 config field: ${field}`);
          return false;
        }
      }
      
      // Validate bucket arrays
      if (!Array.isArray(config.SPREAD_BUCKETS) || config.SPREAD_BUCKETS.length < 2) {
        console.warn('SPREAD_BUCKETS must be an array with at least 2 elements');
        return false;
      }
      
      if (!Array.isArray(config.LINE_BUCKETS) || config.LINE_BUCKETS.length < 2) {
        console.warn('LINE_BUCKETS must be an array with at least 2 elements');
        return false;
      }
      
      if (!Array.isArray(config.CONF_BUCKETS) || config.CONF_BUCKETS.length < 2) {
        console.warn('CONF_BUCKETS must be an array with at least 2 elements');
        return false;
      }
      
      // Check that buckets are sorted
      const isSorted = (arr) => {
        for (let i = 1; i < arr.length; i++) {
          if (arr[i] <= arr[i-1]) return false;
        }
        return true;
      };
      
      if (!isSorted(config.SPREAD_BUCKETS)) {
        console.warn('SPREAD_BUCKETS must be sorted in ascending order');
        return false;
      }
      
      if (!isSorted(config.LINE_BUCKETS)) {
        console.warn('LINE_BUCKETS must be sorted in ascending order');
        return false;
      }
      
      if (!isSorted(config.CONF_BUCKETS)) {
        console.warn('CONF_BUCKETS must be sorted in ascending order');
        return false;
      }
      
      // Validate numeric parameters
      if (config.KELLY_MULTIPLIER <= 0 || config.KELLY_MULTIPLIER > 1) {
        console.warn('KELLY_MULTIPLIER must be between 0 and 1');
        return false;
      }
      
      if (config.SHRINKAGE_STRENGTH <= 0) {
        console.warn('SHRINKAGE_STRENGTH must be positive');
        return false;
      }
      
      if (config.MIN_SAMPLE_SIZE <= 0 || config.MIN_SAMPLE_SIZE > 1000) {
        console.warn('MIN_SAMPLE_SIZE must be between 1 and 1000');
        return false;
      }
      
      return true;
    } catch (err) {
      console.error(`Tier2 config validation failed: ${err.message}`);
      return false;
    }
  },
  
  // --------------------------------------------------------------------------
  // initializeDefaultConfig - Initialize default Tier2 configuration
  // --------------------------------------------------------------------------
  initializeDefaultConfig() {
    const defaultConfig = this._getDefaultConfig();
    this.saveConfig(defaultConfig);
    console.log("Initialized default Tier2 configuration");
    return defaultConfig;
  },
  
  // ============================================================================
  // Private helpers
  // ============================================================================
  
  _getDefaultConfig() {
    return {
      // Bucket boundaries
      SPREAD_BUCKETS: [-10, -7, -4, -3, -2, -1, 0, 1, 2, 3, 4, 7, 10],
      LINE_BUCKETS: [195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 245, 250],
      CONF_BUCKETS: [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95],
      
      // Betting parameters
      KELLY_MULTIPLIER: 0.25,  // Quarter Kelly
      SHRINKAGE_STRENGTH: 0.1,
      MIN_SAMPLE_SIZE: 10,
      
      // Risk management
      MAX_BET_SIZE: 0.05,  // 5% of bankroll max
      DIVERSIFICATION_THRESHOLD: 0.02,  // 2% per bet min
      
      // Performance thresholds
      MIN_WIN_RATE: 0.52,
      TARGET_WIN_RATE: 0.55,
      MAX_DRAWDOWN: 0.20,
      
      // Analysis parameters
      CONFIDENCE_LEVEL: 0.95,
      Z_SCORE_THRESHOLD: 1.96,
      
      // Version tracking
      CONFIG_VERSION: "TIER2-1.0",
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
      'SPREAD_BUCKETS': 'Array of spread bucket boundaries for analysis',
      'LINE_BUCKETS': 'Array of line bucket boundaries for analysis',
      'CONF_BUCKETS': 'Array of confidence bucket boundaries for analysis',
      'KELLY_MULTIPLIER': 'Kelly multiplier for bet sizing (0.25 = quarter Kelly)',
      'SHRINKAGE_STRENGTH': 'Shrinkage strength for rate adjustment',
      'MIN_SAMPLE_SIZE': 'Minimum sample size for statistical significance',
      'MAX_BET_SIZE': 'Maximum bet size as fraction of bankroll',
      'DIVERSIFICATION_THRESHOLD': 'Minimum diversification threshold',
      'MIN_WIN_RATE': 'Minimum acceptable win rate',
      'TARGET_WIN_RATE': 'Target win rate for performance',
      'MAX_DRAWDOWN': 'Maximum allowable drawdown',
      'CONFIDENCE_LEVEL': 'Confidence level for statistical tests',
      'Z_SCORE_THRESHOLD': 'Z-score threshold for significance',
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
