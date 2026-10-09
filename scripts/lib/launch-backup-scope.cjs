// One scope for logical snapshots and native archives, including later private domains.
const schemas = Object.freeze(['public','auth','storage','authoring','launch_recovery','commerce','growth']);
const applicationSchemas = Object.freeze(['public','authoring','launch_recovery','commerce','growth']);
const schemaSql = schemas.map(s=>"'"+s+"'").join(',');
const inventorySql = `select n.nspname schema,c.relname name,c.relkind kind from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemaSql})
  and c.relkind in ('r','p') and not c.relispartition order by 1,2`;
function inventoryKeys(tables) {
  if (!tables.length || tables.some(t=>!schemas.includes(t.schema)||!t.name||t.kind!=='r')) throw Error('BACKUP_UNSUPPORTED_TABLE_LAYOUT');
  const keys=tables.map(t=>t.schema+'.'+t.name).sort();
  if(new Set(keys).size!==keys.length)throw Error('BACKUP_DUPLICATE_TABLE');
  return keys;
}
function assertInventory(before,after) {
  if(JSON.stringify(inventoryKeys(before))!==JSON.stringify(inventoryKeys(after)))throw Error('BACKUP_SCHEMA_CHANGED');
}
function nativeSchemaArgs(tables) { inventoryKeys(tables);return [...new Set(tables.map(t=>t.schema))].sort().map(s=>'--schema='+s); }
function assertArchiveInventory(tables,toc) {
  const lines=toc.split('\n').filter(line=>/ TABLE DATA /.test(line));
  const matches=lines.map(line=>line.match(/^\d+; \d+ \d+ TABLE DATA (\S+) (\S+) \S+\r?$/));
  if(matches.some(m=>!m))throw Error('BACKUP_ARCHIVE_TABLE_MISMATCH');
  const actual=matches.map(m=>m[1]+'.'+m[2]).sort();
  if(JSON.stringify(inventoryKeys(tables))!==JSON.stringify(actual))throw Error('BACKUP_ARCHIVE_TABLE_MISMATCH');
}
function reportFile(kind,args=process.argv.slice(2)) {
  const flag=args.find(s=>s.startsWith('--report-prefix='));
  const prefix=flag?flag.slice('--report-prefix='.length):'launch';
  if(!/^(launch|stage[1-9][0-9]*)$/.test(prefix))throw Error('BACKUP_INVALID_REPORT_PREFIX');
  return 'artifacts/'+prefix+'-'+kind+'.json';
}
module.exports={schemas,applicationSchemas,schemaSql,inventorySql,inventoryKeys,assertInventory,nativeSchemaArgs,assertArchiveInventory,reportFile};
