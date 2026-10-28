export function validateRestoreFencing(beforeInventory: unknown, afterInventory: unknown, receipt: unknown, targetId: string): Readonly<{
  schemaVersion: 'wfc.restore-fencing-validation.v1'; status: 'PASS'; targetId: string; tablesChecked: number;
  qualifiedTables: number; installationEpochRotated: boolean; unjoinedLeaseRowsPreserved: true;
}>;
export function validateRestoredInventory(sourceInventory: unknown, restoredInventory: unknown): Readonly<{
  schemaVersion: 'wfc.restore-inventory-validation.v1'; status: 'PASS'; tablesChecked: number;
  authenticationTablesChecked: 2; fullInventorySha256: string;
}>;
