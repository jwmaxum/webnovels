// Restore real backed-up rows into a fresh in-memory PostgreSQL engine.
// This validates data/types/public constraints, not hosted Supabase or full DDL recovery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
const q = v => '"' + v.replaceAll('"', '""') + '"';
const lit = v => "'" + v.replaceAll("'", "''") + "'";
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const fingerprint = rows => sha([...rows].sort().join('\n'));

export async function restoreSnapshot(snapshot) {
  const db = await PGlite.create();
  try {
    await db.exec("set timezone='UTC'");
    for (const schema of new Set(snapshot.tables.map(t => t.schema))) await db.exec(`create schema if not exists ${q(schema)}`);
    for (const t of snapshot.enums || []) await db.exec(`create type ${q(t.schema)}.${q(t.name)} as enum (${t.labels.map(lit).join(',')})`);
    for (const table of snapshot.tables) {
      const columns = snapshot.columns.filter(c => c.schema === table.schema && c.table === table.name).sort((a,b) => a.ordinal-b.ordinal);
      if (!columns.length) throw Error('BACKUP_COLUMNS_MISSING');
      const name = `${q(table.schema)}.${q(table.name)}`;
      // Values of generated columns are preserved as data; hosted defaults/triggers are intentionally not executed.
      await db.exec(`create table ${name} (${columns.map(c => `${q(c.name)} ${c.type}${c.not_null ? ' not null' : ''}`).join(',')})`);
      for (let offset = 0; offset < table.rows.length; offset += 100) {
        await db.query(`insert into ${name} select * from jsonb_populate_recordset(null::${name},$1::jsonb)`,
          ['[' + table.rows.slice(offset, offset+100).join(',') + ']']);
      }
    }
    // Restore referenced keys in managed schemas too (e.g. auth.users.id).
    const constraints = (snapshot.constraints || []).filter(c => c.schema === 'public' || ['p','u'].includes(c.type));
    for (const c of [...constraints.filter(c => c.type !== 'f'), ...constraints.filter(c => c.type === 'f')])
      await db.exec(`alter table ${q(c.schema)}.${q(c.table)} add constraint ${q(c.name)} ${c.definition}`);
    const verified = [];
    for (const t of snapshot.tables) {
      const rows = (await db.query(`select to_jsonb(r)::text row from ${q(t.schema)}.${q(t.name)} r`)).rows.map(r => r.row);
      if (rows.length !== Number(t.row_count) || fingerprint(rows) !== fingerprint(t.rows))
        throw Object.assign(Error(`RESTORE_ROW_MISMATCH:${t.schema}.${t.name}`), { expectedRows: t.rows, actualRows: rows });
      verified.push({ schema: t.schema, name: t.name, rows: rows.length, sha256: fingerprint(rows) });
    }
    return { db, verified, publicConstraints: constraints.filter(c=>c.schema==='public').length };
  } catch (error) { await db.close(); throw error; }
}

async function main() {
  const directory = path.resolve(process.argv[2] || '');
  const allowed = path.resolve('scratch/launch/backups') + path.sep;
  if (!directory.startsWith(allowed)) throw Error('BACKUP_DIRECTORY_REQUIRED');
  const bytes = fs.readFileSync(path.join(directory, 'snapshot.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  if (sha(bytes) !== manifest.snapshotSha256) throw Error('BACKUP_CHECKSUM_MISMATCH');
  const snapshot = JSON.parse(bytes);
  const { db, verified, publicConstraints } = await restoreSnapshot(snapshot);
  await db.close();
  const report = { verifiedAt: new Date().toISOString(), snapshotSha256: sha(bytes),
    engine: 'PGlite isolated in-memory PostgreSQL', source: 'actual production rows',
    tablesVerified: verified.length, rowsVerified: verified.reduce((n,t) => n+t.rows,0),
    publicConstraintsVerified: publicConstraints, allRowsMatch: true,
    fullSchemaRestore: false, hostedSupabaseRestore: false,
    limitations: ['Generated values restored as ordinary values; defaults, triggers, roles, ACLs, RLS, sequences, views and RPC behavior not restored or accepted.'],
    tables: verified };
  fs.writeFileSync(path.join(directory, 'data-restore-verification.json'), JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync('artifacts/launch-data-restore.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ ...report, tables: undefined },null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(/^BACKUP_|^RESTORE_/.test(error.message) ? error.message : 'DATA_RESTORE_FAILED_DETAILS_WITHHELD'); process.exitCode=1; });
