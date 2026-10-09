import scope from './launch-backup-scope.cjs';
export function restorePreparation(logical,native,toc,targetRef=null) {
  const fail=code=>{throw Error('RESTORE_PLAN_'+code);};
  if(!/^[a-z0-9]{20}$/.test(logical.projectRef)||logical.projectRef!==native.projectRef)fail('SOURCE_PROJECT_MISMATCH');
  if(targetRef!==null&&(!/^[a-z0-9]{20}$/.test(targetRef)||targetRef===logical.projectRef))fail('ISOLATED_TARGET_REQUIRED');
  for(const manifest of [logical,native])if(JSON.stringify([...(manifest.requestedSchemas||[])].sort())!==JSON.stringify([...scope.schemas].sort()))fail('INCOMPLETE_SCHEMA_SCOPE');
  const tables=Object.keys(logical.rowCounts).map(key=>{const [schema,name]=key.split('.');return {schema,name,kind:'r'};});
  scope.assertArchiveInventory(tables,toc);
  if(native.format!=='PostgreSQL custom archive'||!native.archiveReadable||native.tableDataEntries!==tables.length)fail('NATIVE_ARCHIVE_REQUIRED');
  return {format:'webnovels-restore-preparation-v1',sourceProjectRef:logical.projectRef,targetProjectRef:targetRef,
    logicalSnapshotSha256:logical.snapshotSha256,nativeArchiveSha256:native.sha256,
    requestedSchemas:scope.schemas,tables:tables.length,
    independentSnapshotTimes:true,combinedConsistentSnapshotConfirmed:false,
    targetConfigured:targetRef!==null,targetOwnershipVerified:false,restoreExecuted:false,hostedRestoreAccepted:false,
    pending:['CONFIRM_ISOLATED_PROJECT_OWNERSHIP_AND_COST','REVIEW_MANAGED_SCHEMA_AND_CLUSTER_ROLE_RESTORE',
      'OFF_DEVICE_ENCRYPTED_BACKUP','RESTORE_NATIVE_ARCHIVE_IN_ISOLATED_PROJECT','VERIFY_ROWS_ACL_RLS_RPC_AUTH_STORAGE',
      'VERIFY_EXTERNAL_IMAGE_BYTES_AND_RIGHTS','ROLE_AND_FREE_RUNTIME_ACCEPTANCE'],
    limitations:['Logical and native backups are independent consistent DB captures; equal table inventory does not prove equal row state.',
      'Native pg_dump excludes cluster roles, provider configuration and Storage/external file bytes.',
      'Supplied manifests and archive checks do not authenticate hosted restore or project ownership.']};
}
