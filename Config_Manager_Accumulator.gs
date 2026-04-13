/******************************************************************************
 * CONFIG MANAGER - Accumulator
 * Manages Accumulator configuration constants with validation
 ******************************************************************************/

// ============================================================================
// ACCUMULATOR CONFIGURATION MANAGER
// ============================================================================

const ConfigManager_Accumulator = {
  
  // --------------------------------------------------------------------------
  // loadConfig - Load Accumulator configuration from Config_Accumulator sheet
  // --------------------------------------------------------------------------
  loadConfig() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("Config_Accumulator");
    
    if (!configSheet) {
      console.warn("Config_Accumulator sheet not found, using defaults");
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
  // saveConfig - Save configuration to Config_Accumulator sheet
  // --------------------------------------------------------------------------
  saveConfig(config) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let configSheet = ss.getSheetByName("Config_Accumulator");
    
    if (!configSheet) {
      configSheet = ss.insertSheet("Config_Accumulator");
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
    
    console.log(`Saved ${rows.length} Accumulator configuration items`);
  },
  
  // --------------------------------------------------------------------------
  // validateConfigState - Validate Accumulator configuration state
  // --------------------------------------------------------------------------
  validateConfigState(config) {
    try {
      // Check required fields
      const required = [
        'MAX_LEGS_PER_ACCA', 'MIN_LEGS_PER_ACCA', 'MAX_TOTAL_ODDS',
        'MIN_LEG_CONFIDENCE', 'MAX_CORRELATION_THRESHOLD', 'ACCUMULATOR_MULTIPLIER'
      ];
      
      for (const field of required) {
        if (config[field] === undefined || config[field] === null) {
          console.warn(`Missing required Accumulator config field: ${field}`);
          return false;
        }
      }
      
      // Validate leg counts
      if (config.MIN_LEGS_PER_ACCA < 2 || config.MIN_LEGS_PER_ACCA > config.MAX_LEGS_PER_ACCA) {
        console.warn('MIN_LEGS_PER_ACCA must be >= 2 and <= MAX_LEGS_PER_ACCA');
        return false;
      }
      
      if (config.MAX_LEGS_PER_ACCA < 2 || config.MAX_LEGS_PER_ACCA > 20) {
        console.warn('MAX_LEGS_PER_ACCA must be between 2 and 20');
        return false;
      }
      
      // Validate odds and confidence
      if (config.MAX_TOTAL_ODDS <= 1 || config.MAX_TOTAL_ODDS > 1000) {
        console.warn('MAX_TOTAL_ODDS must be between 1 and 1000');
        return false;
      }
      
      if (config.MIN_LEG_CONFIDENCE <= 0 || config.MIN_LEG_CONFIDENCE >= 1) {
        console.warn('MIN_LEG_CONFIDENCE must be between 0 and 1');
        return false;
      }
      
      if (config.MAX_CORRELATION_THRESHOLD < 0 || config.MAX_CORRELATION_THRESHOLD > 1) {
        console.warn('MAX_CORRELATION_THRESHOLD must be between 0 and 1');
        return false;
      }
      
      if (config.ACCUMULATOR_MULTIPLIER <= 0 || config.ACCUMULATOR_MULTIPLIER > 5) {
        console.warn('ACCUMULATOR_MULTIPLIER must be between 0 and 5');
        return false;
      }
      
      // Validate risk parameters
      if (config.MAX_ACCA_STAKE <= 0 || config.MAX_ACCA_STAKE > 0.1) {
        console.warn('MAX_ACCA_STAKE must be between 0 and 0.1 (10%)');
        return false;
      }
      
      if (config.MIN_ACCA_EV <= 0) {
        console.warn('MIN_ACCA_EV must be positive');
        return false;
      }
      
      return true;
    } catch (err) {
      console.error(`Accumulator config validation failed: ${err.message}`);
      return false;
    }
  },
  
  // --------------------------------------------------------------------------
  // initializeDefaultConfig - Initialize default Accumulator configuration
  // --------------------------------------------------------------------------
  initializeDefaultConfig() {
    const defaultConfig = this._getDefaultConfig();
    this.saveConfig(defaultConfig);
    console.log("Initialized default Accumulator configuration");
    return defaultConfig;
  },
  
  // ============================================================================
  // Private helpers
  // ============================================================================
  
  _getDefaultConfig() {
    return {
      // Accumulator structure
      MAX_LEGS_PER_ACCA: 8,
      MIN_LEGS_PER_ACCA: 3,
      MAX_TOTAL_ODDS: 100,
      
      // Quality thresholds
      MIN_LEG_CONFIDENCE: 0.55,
      MAX_CORRELATION_THRESHOLD: 0.3,
      MIN_ACCA_EV: 0.05,
      
      // Risk management
      MAX_ACCA_STAKE: 0.02,  // 2% of bankroll max
      ACCUMULATOR_MULTIPLIER: 1.5,  // EV multiplier for accas
      
      // League restrictions
      MAX_LEGS_PER_LEAGUE: 3,
      MAX_SAME_EVENT_LEGS: 1,
      
      // Time restrictions
      MAX_HOURS_BEFORE_EVENT: 24,
      MIN_HOURS_BEFORE_EVENT: 1,
      
      // Performance tracking
      TRACK_ACCA_PERFORMANCE: true,
      MIN_ACCA_SAMPLE_SIZE: 20,
      
      // Correlation analysis
      ENABLE_CORRELATION_CHECK: true,
      CORRELATION_WINDOW_DAYS: 30,
      
      // Version tracking
      CONFIG_VERSION: "ACCUMULATOR-1.0",
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
      'MAX_LEGS_PER_ACCA': 'Maximum number of legs in an accumulator',
      'MIN_LEGS_PER_ACCA': 'Minimum number of legs in an accumulator',
      'MAX_TOTAL_ODDS': 'Maximum total odds for accumulator',
      'MIN_LEG_CONFIDENCE': 'Minimum confidence required for each leg',
      'MAX_CORRELATION_THRESHOLD': 'Maximum allowed correlation between legs',
      'MIN_ACCA_EV': 'Minimum expected value for accumulator',
      'MAX_ACCA_STAKE': 'Maximum stake as fraction of bankroll',
      'ACCUMULATOR_MULTIPLIER': 'EV multiplier for accumulator calculations',
      'MAX_LEGS_PER_LEAGUE': 'Maximum legs from same league',
      'MAX_SAME_EVENT_LEGS': 'Maximum legs from same event',
      'MAX_HOURS_BEFORE_EVENT': 'Maximum hours before event to place acca',
      'MIN_HOURS_BEFORE_EVENT': 'Minimum hours before event to place acca',
      'TRACK_ACCA_PERFORMANCE': 'Track accumulator performance',
      'MIN_ACCA_SAMPLE_SIZE': 'Minimum sample size for acca analysis',
      'ENABLE_CORRELATION_CHECK': 'Enable correlation checking',
      'CORRELATION_WINDOW_DAYS': 'Days window for correlation analysis',
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
