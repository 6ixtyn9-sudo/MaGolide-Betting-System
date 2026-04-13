/******************************************************************************
 * HEADER MAP STANDARDIZATION - Phase 5 Patch 9
 * Standardizes all header maps to use Contract_Enforcer functions
 ******************************************************************************/

// ============================================================================
// STANDARDIZED HEADER MAP IMPLEMENTATIONS
// ============================================================================

/**
 * StandardizedHeaderMaps - Centralized header map management
 * All header maps should use these standardized implementations
 */
const StandardizedHeaderMaps = {
  
  // --------------------------------------------------------------------------
  // getStandardHeaderMap - Get standardized header map for any contract
  // @param {Array} contract - Contract array (canonical column names)
  // @param {Array} actualHeaders - Actual headers from sheet
  // @returns {Object} Standardized header map
  // --------------------------------------------------------------------------
  getStandardHeaderMap(contract, actualHeaders) {
    return createCanonicalHeaderMap_(contract, actualHeaders);
  },
  
  // --------------------------------------------------------------------------
  // getStandardHeaderIndex - Find column index using standardized method
  // @param {Array} headers - Sheet headers
  // @param {string} target - Target column name
  // @returns {number} Column index or -1 if not found
  // --------------------------------------------------------------------------
  getStandardHeaderIndex(headers, target) {
    return findHeaderIndex_(headers, target);
  },
  
  // --------------------------------------------------------------------------
  // validateHeaderMap - Validate header map completeness
  // @param {Object} headerMap - Header map object
  // @param {Array} requiredColumns - Required columns
  // @returns {Object} Validation result
  // --------------------------------------------------------------------------
  validateHeaderMap(headerMap, requiredColumns) {
    const missing = [];
    const invalid = [];
    
    requiredColumns.forEach(column => {
      if (headerMap[column] === undefined || headerMap[column] === null) {
        missing.push(column);
      } else if (headerMap[column] < 0) {
        invalid.push(column);
      }
    });
    
    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing: missing,
      invalid: invalid,
      total: requiredColumns.length,
      found: requiredColumns.length - missing.length
    };
  },
  
  // --------------------------------------------------------------------------
  // createHeaderMapWithFallback - Create header map with fallback columns
  // @param {Array} contract - Contract array
  // @param {Array} actualHeaders - Actual headers
  // @param {Object} fallbackMap - Fallback column mappings
  // @returns {Object} Header map with fallbacks applied
  // --------------------------------------------------------------------------
  createHeaderMapWithFallback(contract, actualHeaders, fallbackMap = {}) {
    const standardMap = this.getStandardHeaderMap(contract, actualHeaders);
    
    // Apply fallbacks for missing columns
    Object.keys(standardMap).forEach(canonical => {
      if (standardMap[canonical] < 0 && fallbackMap[canonical]) {
        const fallbackIndex = findHeaderIndex_(actualHeaders, fallbackMap[canonical]);
        if (fallbackIndex >= 0) {
          standardMap[canonical] = fallbackIndex;
          console.log(`Applied fallback for ${canonical}: ${fallbackMap[canonical]}`);
        }
      }
    });
    
    return standardMap;
  },
  
  // --------------------------------------------------------------------------
  // getContractColumnAliases - Get standard column aliases for contracts
  // @param {string} contractType - Type of contract
  // @returns {Object} Column aliases object
  // --------------------------------------------------------------------------
  getContractColumnAliases(contractType) {
    const aliases = {
      'Bet_Slips': {
        bet_id: ['bet_id', 'betid', 'id', 'bet_id'],
        league: ['league', 'lg', 'sport', 'league_name'],
        event_date: ['event_date', 'date', 'game_date', 'event_datetime'],
        team: ['team', 'selection', 'pick', 'team_name'],
        opponent: ['opponent', 'opp', 'vs', 'opponent_name'],
        side_total: ['side_total', 'type', 'bet_type', 'side_total'],
        line: ['line', 'odds', 'price', 'line_value'],
        implied_prob: ['implied_prob', 'prob', 'probability', 'implied_probability'],
        confidence_pct: ['confidence_pct', 'confidence', 'conf', 'confidence_percent'],
        tier_code: ['tier_code', 'tier', 'grade', 'tier_code'],
        tier_display: ['tier_display', 'tier_desc', 'tier_description'],
        ev: ['ev', 'expected_value', 'expected_value'],
        kelly_pct: ['kelly_pct', 'kelly', 'kelly_percent'],
        status: ['status', 'result_status', 'bet_status'],
        result: ['result', 'outcome', 'bet_result'],
        payout: ['payout', 'return', 'winnings'],
        placed_at: ['placed_at', 'created', 'timestamp', 'bet_placed'],
        settled_at: ['settled_at', 'resolved', 'bet_settled'],
        config_stamp: ['config_stamp', 'configstamp', 'cfg_stamp', 'stamp', 'stamp_id'],
        source: ['source', 'origin', 'data_source'],
        gender: ['gender', 'type', 'category'],
        quarter: ['quarter', 'q', 'period', 'time_period'],
        season: ['season', 'year', 'season_year'],
        created_at: ['created_at', 'timestamp', 'creation_time']
      },
      
      'Forensic_Logs': {
        log_id: ['log_id', 'id', 'log_identifier'],
        timestamp: ['timestamp', 'time', 'log_time', 'created_at'],
        league: ['league', 'lg', 'sport', 'league_name'],
        event_id: ['event_id', 'game_id', 'match_id'],
        team: ['team', 'selection', 'pick', 'team_name'],
        opponent: ['opponent', 'opp', 'vs', 'opponent_name'],
        side_total: ['side_total', 'type', 'bet_type'],
        line: ['line', 'odds', 'price', 'line_value'],
        prediction: ['prediction', 'pred', 'forecast'],
        confidence: ['confidence', 'conf', 'confidence_level'],
        tier: ['tier', 'grade', 'tier_code'],
        ev: ['ev', 'expected_value', 'expected_value'],
        status: ['status', 'result_status', 'log_status'],
        result: ['result', 'outcome', 'actual_result'],
        config_stamp: ['config_stamp', 'configstamp', 'cfg_stamp', 'stamp', 'stamp_id'],
        source: ['source', 'origin', 'data_source'],
        notes: ['notes', 'comments', 'remarks']
      },
      
      'Results_Clean': {
        result_id: ['result_id', 'id', 'result_identifier'],
        event_date: ['event_date', 'date', 'game_date'],
        league: ['league', 'lg', 'sport', 'league_name'],
        team: ['team', 'selection', 'pick', 'team_name'],
        opponent: ['opponent', 'opp', 'vs', 'opponent_name'],
        side_total: ['side_total', 'type', 'bet_type'],
        line: ['line', 'odds', 'price', 'line_value'],
        actual_result: ['actual_result', 'result', 'outcome'],
        settled_at: ['settled_at', 'resolved', 'result_date'],
        status: ['status', 'result_status', 'settlement_status'],
        payout: ['payout', 'return', 'winnings'],
        config_stamp: ['config_stamp', 'configstamp', 'cfg_stamp', 'stamp', 'stamp_id'],
        source: ['source', 'origin', 'data_source'],
        season: ['season', 'year', 'season_year'],
        quarter: ['quarter', 'q', 'period', 'time_period'],
        created_at: ['created_at', 'timestamp', 'creation_time']
      }
    };
    
    return aliases[contractType] || {};
  },
  
  // --------------------------------------------------------------------------
  // createEnhancedHeaderMap - Create header map with alias support
  // @param {string} contractType - Type of contract
  // @param {Array} actualHeaders - Actual headers from sheet
  // @returns {Object} Enhanced header map with alias resolution
  // --------------------------------------------------------------------------
  createEnhancedHeaderMap(contractType, actualHeaders) {
    const contracts = {
      'Bet_Slips': BET_SLIPS_CONTRACT,
      'Forensic_Logs': FORENSIC_LOGS_CONTRACT,
      'Results_Clean': RESULTSCLEAN_CONTRACT
    };
    
    const contract = contracts[contractType];
    if (!contract) {
      throw new Error(`Unknown contract type: ${contractType}`);
    }
    
    const aliases = this.getContractColumnAliases(contractType);
    return this.createHeaderMapWithFallback(contract, actualHeaders, aliases);
  },
  
  // --------------------------------------------------------------------------
  // auditHeaderMaps - Audit all header maps for compliance
  // @returns {Object} Audit report
  // --------------------------------------------------------------------------
  auditHeaderMaps() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const auditReport = {
      timestamp: new Date().toISOString(),
      sheets: {},
      summary: {
        total: 0,
        compliant: 0,
        nonCompliant: 0
      }
    };
    
    const contractSheets = [
      { name: 'Bet_Slips', contract: BET_SLIPS_CONTRACT, type: 'Bet_Slips' },
      { name: 'Tier1_Predictions', contract: FORENSIC_LOGS_CONTRACT, type: 'Forensic_Logs' },
      { name: 'Tier2_Log', contract: FORENSIC_LOGS_CONTRACT, type: 'Forensic_Logs' },
      { name: 'OU_Log', contract: FORENSIC_LOGS_CONTRACT, type: 'Forensic_Logs' },
      { name: 'ResultsClean', contract: RESULTSCLEAN_CONTRACT, type: 'Results_Clean' }
    ];
    
    contractSheets.forEach(({ name, contract, type }) => {
      const sheet = ss.getSheetByName(name);
      if (sheet) {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const headerMap = this.createEnhancedHeaderMap(type, headers);
        const validation = this.validateHeaderMap(headerMap, contract);
        
        auditReport.sheets[name] = {
          type: type,
          headersFound: headers.length,
          contractColumns: contract.length,
          validation: validation,
          compliant: validation.valid
        };
        
        auditReport.summary.total++;
        if (validation.valid) {
          auditReport.summary.compliant++;
        } else {
          auditReport.summary.nonCompliant++;
        }
      }
    });
    
    return auditReport;
  },
  
  // --------------------------------------------------------------------------
  // standardizeAllSheets - Apply standardization to all contract sheets
  // @returns {Object} Standardization report
  // --------------------------------------------------------------------------
  standardizeAllSheets() {
    const audit = this.auditHeaderMaps();
    const report = {
      timestamp: new Date().toISOString(),
      audit: audit,
      actions: [],
      success: true
    };
    
    // Log standardization results
    console.log("Header Map Standardization Report");
    console.log("=====================================");
    console.log(`Total sheets: ${audit.summary.total}`);
    console.log(`Compliant: ${audit.summary.compliant}`);
    console.log(`Non-compliant: ${audit.summary.nonCompliant}`);
    
    Object.entries(audit.sheets).forEach(([sheetName, sheetData]) => {
      if (!sheetData.compliant) {
        console.log(`Sheet ${sheetName} needs standardization`);
        console.log(`Missing: ${sheetData.validation.missing.join(', ')}`);
        console.log(`Invalid: ${sheetData.validation.invalid.join(', ')}`);
        report.actions.push({
          sheet: sheetName,
          action: 'NEEDS_STANDARDIZATION',
          missing: sheetData.validation.missing,
          invalid: sheetData.validation.invalid
        });
      } else {
        console.log(`Sheet ${sheetName} is compliant`);
        report.actions.push({
          sheet: sheetName,
          action: 'COMPLIANT'
        });
      }
    });
    
    return report;
  }
};
