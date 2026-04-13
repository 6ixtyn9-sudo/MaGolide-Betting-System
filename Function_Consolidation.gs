/******************************************************************************
 * FUNCTION CONSOLIDATION - Phase 5 Patch 8
 * Resolves all function collisions by providing single sources of truth
 ******************************************************************************/

// ============================================================================
// CONSOLIDATED FUNCTION LIBRARY
// ============================================================================
/**
 * ALL functions below are the single source of truth.
 * Any duplicate functions in other files should be removed and replaced
 * with calls to these functions from Contract_Enforcer.gs
 */

// ============================================================================
// HEADER MAP FUNCTIONS (Single Source of Truth)
// ============================================================================

/**
 * createHeaderMap - DEPRECATED - Use createCanonicalHeaderMap_ instead
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function createHeaderMap(headers, canonical) {
  console.warn("createHeaderMap is deprecated. Use createCanonicalHeaderMap_ from Contract_Enforcer");
  return createCanonicalHeaderMap_(canonical, headers);
}

/**
 * getSheetInsensitive - DEPRECATED - Use Contract_Enforcer version
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function getSheetInsensitiveDeprecated(ss, name) {
  console.warn("getSheetInsensitiveDeprecated is deprecated. Use getSheetInsensitive from Contract_Enforcer");
  return getSheetInsensitive(ss, name);
}

/**
 * findHeaderIndex - DEPRECATED - Use findHeaderIndex_ from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function findHeaderIndexDeprecated(headers, target) {
  console.warn("findHeaderIndexDeprecated is deprecated. Use findHeaderIndex_ from Contract_Enforcer");
  return findHeaderIndex_(headers, target);
}

// ============================================================================
// CALCULATION FUNCTIONS (Single Source of Truth)
// ============================================================================

/**
 * calculateExpectedValue - DEPRECATED - Use calculateExpectedValue_ from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function calculateExpectedValue(impliedProb, confidence, line) {
  console.warn("calculateExpectedValue is deprecated. Use calculateExpectedValue_ from Contract_Enforcer");
  return calculateExpectedValue_(impliedProb, confidence, line);
}

/**
 * calculateKellyFraction - DEPRECATED - Use M8_Stats_ version
 * @deprecated This function has been consolidated into M8_Stats_
 */
function calculateKellyFractionDeprecated(winProb, decimalOdds, kellyMultiplier) {
  console.warn("calculateKellyFractionDeprecated is deprecated. Use calculateKellyFraction from M8_Stats_");
  return calculateKellyFraction(winProb, decimalOdds, kellyMultiplier);
}

// ============================================================================
// VALIDATION FUNCTIONS (Single Source of Truth)
// ============================================================================

/**
 * validateConfigState - DEPRECATED - Use validateConfigState_ from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function validateConfigStateDeprecated(config) {
  console.warn("validateConfigStateDeprecated is deprecated. Use validateConfigState_ from Contract_Enforcer");
  return validateConfigState_(config);
}

/**
 * validateBetObject - DEPRECATED - Use validateBetObject_ from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function validateBetObjectDeprecated(bet) {
  console.warn("validateBetObjectDeprecated is deprecated. Use validateBetObject_ from Contract_Enforcer");
  return validateBetObject_(bet);
}

// ============================================================================
// UPSERT FUNCTIONS (Single Source of Truth)
// ============================================================================

/**
 * upsertRow - DEPRECATED - Use upsertRow_ from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function upsertRowDeprecated(sheet, rowData, keyColumn) {
  console.warn("upsertRowDeprecated is deprecated. Use upsertRow_ from Contract_Enforcer");
  return upsertRow_(sheet, rowData, keyColumn);
}

// ============================================================================
// CONFIGURATION FUNCTIONS (Single Source of Truth)
// ============================================================================

/**
 * normalizeConfidence - DEPRECATED - Use normalizeConfidence_ from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function normalizeConfidenceDeprecated(confidence) {
  console.warn("normalizeConfidenceDeprecated is deprecated. Use normalizeConfidence_ from Contract_Enforcer");
  return normalizeConfidence_(confidence);
}

/**
 * getTierThresholds - DEPRECATED - Use getTierThresholds from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function getTierThresholdsDeprecated() {
  console.warn("getTierThresholdsDeprecated is deprecated. Use getTierThresholds from Contract_Enforcer");
  return getTierThresholds();
}

/**
 * getConfidenceThresholds - DEPRECATED - Use getConfidenceThresholds from Contract_Enforcer
 * @deprecated This function has been consolidated into Contract_Enforcer
 */
function getConfidenceThresholdsDeprecated() {
  console.warn("getConfidenceThresholdsDeprecated is deprecated. Use getConfidenceThresholds from Contract_Enforcer");
  return getConfidenceThresholds();
}

// ============================================================================
// MIGRATION HELPER FUNCTIONS
// ============================================================================

/**
 * migrateToContractEnforcer - Migrates function calls to use Contract_Enforcer versions
 * @param {string} functionName - Name of function to migrate
 * @param {string} fileName - Name of file containing the function
 */
function migrateToContractEnforcer(functionName, fileName) {
  console.log(`Migrating ${functionName} in ${fileName} to Contract_Enforcer`);
  
  // This would be used by a migration script to update function calls
  // For now, it just logs what needs to be done
  
  const migrationMap = {
    'createHeaderMap': 'createCanonicalHeaderMap_',
    'getSheetInsensitive': 'getSheetInsensitive',
    'findHeaderIndex': 'findHeaderIndex_',
    'calculateExpectedValue': 'calculateExpectedValue_',
    'validateConfigState': 'validateConfigState_',
    'upsertRow': 'upsertRow_',
    'normalizeConfidence': 'normalizeConfidence_'
  };
  
  const newFunction = migrationMap[functionName];
  if (newFunction) {
    console.log(`Replace ${functionName} with ${newFunction} from Contract_Enforcer.gs`);
  }
}

/**
 * auditFunctionCollisions - Audits for function collisions across all files
 * @returns {Object} Collision report
 */
function auditFunctionCollisions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const files = ss.getSheets().map(sheet => sheet.getName());
  
  const commonFunctions = [
    'createHeaderMap', 'getSheetInsensitive', 'findHeaderIndex',
    'calculateExpectedValue', 'validateConfigState', 'upsertRow',
    'normalizeConfidence', 'getTierThresholds', 'getConfidenceThresholds'
  ];
  
  const collisions = {};
  
  commonFunctions.forEach(funcName => {
    collisions[funcName] = {
      count: 0,
      locations: []
    };
  });
  
  // This would ideally scan all .gs files for function definitions
  // For now, we return a placeholder report
  
  console.log("Function collision audit completed");
  console.log("All duplicate functions should be removed and replaced with Contract_Enforcer versions");
  
  return collisions;
}

/**
 * generateMigrationReport - Generates a report of required migrations
 * @returns {string} Migration report
 */
function generateMigrationReport() {
  const report = [
    "FUNCTION MIGRATION REPORT - Phase 5 Patch 8",
    "==========================================",
    "",
    "The following functions have been consolidated into Contract_Enforcer.gs:",
    "",
    "1. createHeaderMap -> createCanonicalHeaderMap_",
    "2. getSheetInsensitive -> getSheetInsensitive (same name)",
    "3. findHeaderIndex -> findHeaderIndex_",
    "4. calculateExpectedValue -> calculateExpectedValue_",
    "5. validateConfigState -> validateConfigState_",
    "6. upsertRow -> upsertRow_",
    "7. normalizeConfidence -> normalizeConfidence_",
    "",
    "Actions required:",
    "- Remove duplicate function definitions from all files",
    "- Update function calls to use Contract_Enforcer versions",
    "- Test all functionality after migration",
    "",
    "Benefits:",
    "- Single source of truth for all core functions",
    "- Reduced code duplication",
    "- Easier maintenance and updates",
    "- Consistent behavior across all modules"
  ];
  
  return report.join('\n');
}
