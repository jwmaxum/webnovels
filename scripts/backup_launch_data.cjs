// Read-only emergency logical data backup. Not a substitute for pg_dump/PITR.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEnv, connection, managementToken } = require('./lib/launch-access.cjs');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function query(sql) {
  const env = loadEnv(), { ref } = connection(env);
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${managementToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(120000), redirect: 'error'
  });
  if (!response.ok) throw Error(`BACKUP_QUERY_HTTP_${response.status}`);
  return response.json();
}

async function main() {
  const { ref } = connection(loadEnv());
  const directory = path.resolve('scratch/launch/backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  const tables = await query(`select n.nspname schema,c.relname name,c.relkind kind
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage','authoring','launch_recovery') and c.relkind in ('r','p')
    and not c.relispartition order by 1,2`);
  if (!tables.length || tables.some(t => t.kind !== 'r')) throw Error('UNSUPPORTED_TABLE_LAYOUT');
  const selects = tables.map(t => {
    const qualified = `${quote(t.schema)}.${quote(t.name)}`;
    return `select ${literal(t.schema)} schema,${literal(t.name)} name,count(*)::text row_count,
      coalesce(jsonb_agg(to_jsonb(r)::text order by to_jsonb(r)::text),'[]'::jsonb) rows,
      md5(coalesce(string_agg(to_jsonb(r)::text,'' order by to_jsonb(r)::text),'')) fingerprint from ${qualified} r`;
  });
  // One statement: every table and catalog description uses the same MVCC snapshot.
  // Each row is a JSON string to preserve bigint/numeric values in JavaScript.
  const sql = `select jsonb_build_object(
    'format','webnovels-logical-data-v1','captured_at',clock_timestamp(),'database_version',version(),
    'tables',(select jsonb_agg(to_jsonb(t)) from (${selects.join(' union all ')}) t),
    'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'ordinal',a.attnum,'not_null',a.attnotnull,
      'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)))
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
      where n.nspname in ('public','auth','storage','authoring','launch_recovery') and c.relkind='r' and a.attnum>0 and not a.attisdropped),
    'enums',(select jsonb_agg(to_jsonb(t)) from (select n.nspname schema,t.typname name,
      array_agg(e.enumlabel order by e.enumsortorder) labels from pg_enum e join pg_type t on t.oid=e.enumtypid
      join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','auth','storage','authoring','launch_recovery') group by 1,2) t),
    'constraints',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',co.conname,
      'type',co.contype,'definition',pg_get_constraintdef(co.oid))) from pg_constraint co
      join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage','authoring','launch_recovery')),
    'indexes',(select jsonb_agg(to_jsonb(i)) from pg_indexes i where schemaname in ('public','auth','storage','authoring','launch_recovery')),
    'sequences',(select jsonb_agg(to_jsonb(s)) from pg_sequences s where schemaname in ('public','auth','storage','authoring','launch_recovery')),
    'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','auth','storage','authoring','launch_recovery')),
    'views',(select jsonb_agg(to_jsonb(v)) from pg_views v where schemaname in ('public','auth','storage','authoring','launch_recovery')),
    'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'signature',p.oid::regprocedure::text,
      'definition',pg_get_functiondef(p.oid),'acl',p.proacl)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','auth','storage','authoring','launch_recovery') and p.prokind='f'),
    'triggers',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'definition',pg_get_triggerdef(t.oid)))
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage','authoring','launch_recovery') and not t.tgisinternal),
    'relation_security',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
      'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage','authoring','launch_recovery')),
    'column_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'acl',a.attacl))
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage','authoring','launch_recovery') and a.attacl is not null)
    ) snapshot`;
  const snapshot = (await query(sql))[0]?.snapshot;
  if (!snapshot || snapshot.tables.length !== tables.length || snapshot.tables.some(t => t.rows.length !== Number(t.row_count)))
    throw Error('BACKUP_INCOMPLETE');
  const inventoryAfter = await query(`select n.nspname schema,c.relname name,c.relkind kind from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage','authoring','launch_recovery')
    and c.relkind in ('r','p') and not c.relispartition order by 1,2`);
  if (JSON.stringify(tables) !== JSON.stringify(inventoryAfter)) throw Error('SCHEMA_CHANGED_DURING_BACKUP');
  const bytes = Buffer.from(JSON.stringify(snapshot));
  fs.writeFileSync(path.join(directory, 'snapshot.json'), bytes, { flag: 'wx', mode: 0o600 });
  const report = {
    capturedAt: snapshot.captured_at, projectRef: ref, format: snapshot.format,
    snapshotSha256: hash(bytes), bytes: bytes.length,
    tableCount: tables.length,
    schemas: [...new Set(tables.map(t => t.schema))],
    rowCounts: Object.fromEntries(snapshot.tables.map(t => [`${t.schema}.${t.name}`, Number(t.row_count)])),
    fullPostgresBackup: false, providerRestoreVerified: false,
    limitations: ['Not pg_dump: provider roles, extension internals, large objects, platform configuration and external file bytes are excluded.',
      'Catalog metadata is preserved for investigation; complete schema/security restoration needs pg_dump and an isolated Supabase restore.',
      'Local copy only; encrypted off-device retention has not been verified.']
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/launch-data-backup.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ directory, ...report }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(/^BACKUP_|^UNSUPPORTED_|^SCHEMA_/.test(error.message) ? error.message : 'BACKUP_FAILED_DETAILS_WITHHELD'); process.exitCode = 1; });
module.exports = { query, quote, literal, hash };
