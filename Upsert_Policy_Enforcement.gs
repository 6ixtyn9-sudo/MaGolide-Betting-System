/******************************************************************************
 * UPSERT POLICY ENFORCEMENT - Phase 5 Patch 10
 * Documents and enforces upsert policies across all modules
 ******************************************************************************/

// ============================================================================
// UPSERT POLICY DEFINITIONS
// ============================================================================

/**
 * UpsertPolicy - Centralized upsert policy management
 */
const UpsertPolicy = {
  
  // --------------------------------------------------------------------------
  // POLICY DEFINITIONS
  // --------------------------------------------------------------------------
  
  policies: {
    // Bet_Slips: Use bet_id as unique key
    'Bet_Slips': {
      keyColumn: 'bet_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: true
    },
    
    // Config sheets: Use config_key as unique key
    'Config_Tier1': {
      keyColumn: 'config_key',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: false
    },
    
    'Config_Tier2': {
      keyColumn: 'config_key',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: false
    },
    
    'Config_Accumulator': {
      keyColumn: 'config_key',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: true,
      validation: 'required',
      conflictResolution: 'LATEST_WINS',
      auditTrail: false
    },
    
    // Satellite_Identity: Use satellite_id as unique key
    'Satellite_Identity': {
      keyColumn: 'satellite_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Identity should not be updated
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true
    },
    
    // ResultsClean: Use result_id as unique key
    'ResultsClean': {
      keyColumn: 'result_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Results should not be updated once settled
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true
    },
    
    // Forensic logs: Use log_id as unique key
    'Tier1_Predictions': {
      keyColumn: 'log_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Logs should be immutable
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true
    },
    
    'Tier2_Log': {
      keyColumn: 'log_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Logs should be immutable
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true
    },
    
    'OU_Log': {
      keyColumn: 'log_id',
      strategy: 'UPDATE_IF_EXISTS',
      allowCreate: true,
      allowUpdate: false,  // Logs should be immutable
      validation: 'required',
      conflictResolution: 'FIRST_WINS',
      auditTrail: true
    }
  },
  
  // --------------------------------------------------------------------------
  // UPSERT OPERATIONS
  // --------------------------------------------------------------------------
  
  /**
   * performUpsert - Perform standardized upsert operation
   * @param {Sheet} sheet - Target sheet
   * @param {Array} rowData - Row data to upsert
   * @param {string} sheetName - Sheet name for policy lookup
   * @returns {Object} Upsert result
   */
  performUpsert(sheet, rowData, sheetName) {
    const policy = this.policies[sheetName];
    if (!policy) {
      throw new Error(`No upsert policy defined for sheet: ${sheetName}`);
    }
    
    const result = {
      success: false,
      action: null,
      key: null,
      timestamp: new Date().toISOString(),
      policy: policy
    };
    
    try {
      // Validate policy requirements
      const validationResult = this.validateUpsertData(rowData, policy);
      if (!validationResult.valid) {
        result.error = `Validation failed: ${validationResult.errors.join(', ')}`;
        return result;
      }
      
      // Find existing row
      const existingRowIndex = this.findExistingRow(sheet, rowData, policy);
      
      if (existingRowIndex >= 0) {
        // Row exists
        if (policy.allowUpdate) {
          this.updateRow(sheet, existingRowIndex, rowData, policy);
          result.action = 'UPDATED';
          result.key = rowData[policy.keyColumn];
          result.success = true;
          
          if (policy.auditTrail) {
            this.logUpsertAction(sheetName, 'UPDATE', rowData[policy.keyColumn], policy);
          }
        } else {
          result.action = 'SKIPPED_UPDATE_NOT_ALLOWED';
          result.key = rowData[policy.keyColumn];
          result.success = false;
          result.error = 'Update not allowed by policy';
        }
      } else {
        // Row does not exist
        if (policy.allowCreate) {
          this.insertRow(sheet, rowData, policy);
          result.action = 'INSERTED';
          result.key = rowData[policy.keyColumn];
          result.success = true;
          
          if (policy.auditTrail) {
            this.logUpsertAction(sheetName, 'INSERT', rowData[policy.keyColumn], policy);
          }
        } else {
          result.action = 'SKIPPED_CREATE_NOT_ALLOWED';
          result.key = rowData[policy.keyColumn];
          result.success = false;
          result.error = 'Create not allowed by policy';
        }
      }
      
    } catch (err) {
      result.error = err.message;
      result.success = false;
    }
    
    return result;
  },
  
  /**
   * performBatchUpsert - Perform batch upsert operations
   * @param {Sheet} sheet - Target sheet
   * @param {Array} batchData - Array of row data
   * @param {string} sheetName - Sheet name for policy lookup
   * @returns {Object} Batch upsert result
   */
  performBatchUpsert(sheet, batchData, sheetName) {
    const policy = this.policies[sheetName];
    if (!policy) {
      throw new Error(`No upsert policy defined for sheet: ${sheetName}`);
    }
    
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    
    batchData.forEach((rowData, index) => {
      const result = this.performUpsert(sheet, rowData, sheetName);
      result.batchIndex = index;
      results.push(result);
      
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    });
    
    return {
      sheetName: sheetName,
      totalRows: batchData.length,
      successCount: successCount,
      failureCount: failureCount,
      results: results,
      timestamp: new Date().toISOString()
    };
  },
  
  // --------------------------------------------------------------------------
  // VALIDATION FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * validateUpsertData - Validate data against upsert policy
   * @param {Array} rowData - Row data
   * @param {Object} policy - Upsert policy
   * @returns {Object} Validation result
   */
  validateUpsertData(rowData, policy) {
    const errors = [];
    const warnings = [];
    
    // Check required key column
    if (policy.validation === 'required' && !rowData[policy.keyColumn]) {
      errors.push(`Required key column '${policy.keyColumn}' is missing or empty`);
    }
    
    // Check data length
    if (!Array.isArray(rowData) || rowData.length === 0) {
      errors.push('Row data must be a non-empty array');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  },
  
  // --------------------------------------------------------------------------
  // SEARCH AND UPDATE FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * findExistingRow - Find existing row based on key column
   * @param {Sheet} sheet - Target sheet
   * @param {Array} rowData - Row data
   * @param {Object} policy - Upsert policy
   * @returns {number} Row index or -1 if not found
   */
  findExistingRow(sheet, rowData, policy) {
    if (!sheet || sheet.getLastRow() <= 1) return -1;
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyColumnIndex = headers.findIndex(h => 
      String(h).toLowerCase().replace(/[\s_]/g, "") === 
      policy.keyColumn.toLowerCase().replace(/[\s_]/g, "")
    );
    
    if (keyColumnIndex < 0) {
      console.warn(`Key column '${policy.keyColumn}' not found in sheet`);
      return -1;
    }
    
    const keyValue = rowData[keyColumnIndex];
    if (!keyValue) return -1;
    
    // Search for existing row
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyColumnIndex] === keyValue) {
        return i; // Found existing row
      }
    }
    
    return -1; // Not found
  },
  
  /**
   * updateRow - Update existing row
   * @param {Sheet} sheet - Target sheet
   * @param {number} rowIndex - Row index (0-based from data range)
   * @param {Array} rowData - New row data
   * @param {Object} policy - Upsert policy
   */
  updateRow(sheet, rowIndex, rowData, policy) {
    const actualRowIndex = rowIndex + 1; // Convert to 1-based for Apps Script
    
    if (policy.conflictResolution === 'LATEST_WINS') {
      sheet.getRange(actualRowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else if (policy.conflictResolution === 'FIRST_WINS') {
      // Don't update, keep existing data
      console.log(`Skipping update for ${rowData[policy.keyColumn]} - FIRST_WINS policy`);
    }
  },
  
  /**
   * insertRow - Insert new row
   * @param {Sheet} sheet - Target sheet
   * @param {Array} rowData - Row data
   * @param {Object} policy - Upsert policy
   */
  insertRow(sheet, rowData, policy) {
    sheet.appendRow(rowData);
  },
  
  // --------------------------------------------------------------------------
  // AUDIT AND LOGGING FUNCTIONS
  // --------------------------------------------------------------------------
  
  /**
   * logUpsertAction - Log upsert action for audit trail
   * @param {string} sheetName - Sheet name
   * @param {string} action - Action performed
   * @param {string} key - Record key
   * @param {Object} policy - Upsert policy
   */
  logUpsertAction(sheetName, action, key, policy) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      sheet: sheetName,
      action: action,
      key: key,
      policy: policy.keyColumn,
      user: Session.getActiveUser().getEmail()
    };
    
    console.log(`UPSERT AUDIT: ${JSON.stringify(logEntry)}`);
    
    // Could also write to a dedicated audit sheet if needed
  },
  
  /**
   * generateUpsertPolicyReport - Generate comprehensive upsert policy report
   * @returns {Object} Policy report
   */
  generateUpsertPolicyReport() {
    const report = {
      timestamp: new Date().toISOString(),
      policies: this.policies,
      summary: {
        totalPolicies: Object.keys(this.policies).length,
        allowUpdateCount: 0,
        allowCreateCount: 0,
        auditTrailCount: 0
      },
      recommendations: []
    };
    
    // Calculate summary statistics
    Object.values(this.policies).forEach(policy => {
      if (policy.allowUpdate) report.summary.allowUpdateCount++;
      if (policy.allowCreate) report.summary.allowCreateCount++;
      if (policy.auditTrail) report.summary.auditTrailCount++;
    });
    
    // Generate recommendations
    if (report.summary.auditTrailCount < report.summary.totalPolicies) {
      report.recommendations.push('Consider enabling audit trail for all critical sheets');
    }
    
    report.recommendations.push('Regularly review upsert policies for compliance');
    report.recommendations.push('Monitor upsert operations for anomalies');
    
    return report;
  },
  
  /**
   * validateAllPolicies - Validate all upsert policies
   * @returns {Object} Validation report
   */
  validateAllPolicies() {
    const validation = {
      timestamp: new Date().toISOString(),
      valid: true,
      issues: [],
      warnings: []
    };
    
    Object.entries(this.policies).forEach(([sheetName, policy]) => {
      // Check required fields
      if (!policy.keyColumn) {
        validation.issues.push(`${sheetName}: Missing keyColumn`);
        validation.valid = false;
      }
      
      if (!policy.strategy) {
        validation.issues.push(`${sheetName}: Missing strategy`);
        validation.valid = false;
      }
      
      // Check for logical inconsistencies
      if (!policy.allowCreate && !policy.allowUpdate) {
        validation.issues.push(`${sheetName}: Neither create nor update allowed`);
        validation.valid = false;
      }
      
      // Warnings
      if (policy.allowUpdate && !policy.auditTrail) {
        validation.warnings.push(`${sheetName}: Updates allowed but no audit trail`);
      }
    });
    
    return validation;
  }
};
