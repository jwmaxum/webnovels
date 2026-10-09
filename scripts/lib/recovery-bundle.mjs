import { z } from 'zod';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const safeName = value => !/[\\\x00-\x1f\x7f:]/.test(value) && !value.startsWith('/') &&
  !value.split('/').some(part => !part || part === '.' || part === '..');
const relative = z.string().min(1).max(1024).refine(safeName);
const bucket = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/);
const fileSchema = z.object({ file: relative, bytes: z.number().int().positive().max(64 * 1024 ** 3), sha256: digest }).strict();
const objectSchema = fileSchema.extend({ bytes:z.number().int().nonnegative().max(64 * 1024 ** 3), bucket, object: relative }).strict();
const referenceSchema = z.object({ bucket, object: relative, sha256: digest }).strict();
const stateSchema = z.object({
  schemaVersion: z.literal(1), schemaSha256: digest, securitySha256: digest,
  tables: z.array(z.object({ name: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/), rows: z.string().regex(/^(0|[1-9]\d*)$/), sha256: digest }).strict()).min(1).max(10000),
  buckets: z.array(z.object({ id: bucket, public: z.boolean() }).strict()).max(1000),
  references: z.array(referenceSchema).max(100000)
}).strict();
const manifestSchema = z.object({
  format: z.literal('webnovels-recovery-v1'), snapshotId: z.string().uuid(),
  capturedAt: z.string().datetime(), kind: z.enum(['SYNTHETIC','HOSTED_BACKUP']),
  consistentSnapshotConfirmed: z.boolean(),
  database: fileSchema.extend({ format: z.enum(['POSTGRES_CUSTOM','PGLITE_DATA_DIR']) }).strict(),
  state: fileSchema, objects: z.array(objectSchema).max(100000)
}).strict();
const reject = code => { throw Error(code); };
export async function safeBundleFile(directory, name) {
  if (!safeName(name)) reject('RECOVERY_UNSAFE_PATH');
  const root = await realpath(directory);
  let file = root;
  for (const part of name.split('/')) {
    file = path.join(file, part);
    const info = await lstat(file);
    if (info.isSymbolicLink()) reject('RECOVERY_LINK_FORBIDDEN');
  }
  if (!(await lstat(file)).isFile()) reject('RECOVERY_FILE_REQUIRED');
  return file;
}
async function verifyBytes(directory, descriptor) {
  const file = await safeBundleFile(directory, descriptor.file);
  if ((await lstat(file)).size !== descriptor.bytes) reject('RECOVERY_SIZE_MISMATCH');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > descriptor.bytes) reject('RECOVERY_SIZE_MISMATCH');
    hash.update(chunk);
  }
  if (bytes !== descriptor.bytes || hash.digest('hex') !== descriptor.sha256) reject('RECOVERY_HASH_MISMATCH');
  return file;
}
const key = row => row.bucket + '/' + row.object;
function unique(values, label) { if (new Set(values).size !== values.length) reject('RECOVERY_DUPLICATE_' + label); }
function normalizedState(state) {
  return { ...state, tables: [...state.tables].sort((a,b) => a.name.localeCompare(b.name)),
    buckets: [...state.buckets].sort((a,b) => a.id.localeCompare(b.id)),
    references: [...state.references].sort((a,b) => key(a).localeCompare(key(b))) };
}
export async function inspectRecoveryBundle(directory) {
  const manifestFile = await safeBundleFile(directory, 'manifest.json');
  if ((await lstat(manifestFile)).size > 16 * 1024 * 1024) reject('RECOVERY_MANIFEST_TOO_LARGE');
  const parsed = manifestSchema.safeParse(JSON.parse(await readFile(manifestFile,'utf8')));
  if (!parsed.success) reject('RECOVERY_INVALID_MANIFEST');
  const manifest = parsed.data;
  if (!manifest.consistentSnapshotConfirmed) reject('RECOVERY_SNAPSHOT_NOT_CONFIRMED');
  if (manifest.kind === 'HOSTED_BACKUP' && manifest.database.format !== 'POSTGRES_CUSTOM') reject('RECOVERY_HOSTED_ARCHIVE_REQUIRED');
  unique(manifest.objects.map(key), 'OBJECT');
  unique([manifest.database.file,manifest.state.file,...manifest.objects.map(row => row.file)], 'FILE');
  const archiveFile = await verifyBytes(directory, manifest.database);
  if (manifest.database.format === 'POSTGRES_CUSTOM') {
    let header;
    for await (const chunk of createReadStream(archiveFile, { start: 0, end: 4 })) { header = chunk; }
    if (header?.toString('ascii') !== 'PGDMP') reject('RECOVERY_ARCHIVE_FORMAT_MISMATCH');
  }
  const stateFile = await verifyBytes(directory, manifest.state);
  if (manifest.state.bytes > 16 * 1024 * 1024) reject('RECOVERY_STATE_TOO_LARGE');
  const parsedState = stateSchema.safeParse(JSON.parse(await readFile(stateFile,'utf8')));
  if (!parsedState.success) reject('RECOVERY_INVALID_STATE');
  const state = parsedState.data;
  unique(state.tables.map(row => row.name), 'TABLE');
  unique(state.buckets.map(row => row.id), 'BUCKET');
  unique(state.references.map(key), 'REFERENCE');
  const buckets = new Map(state.buckets.map(row => [row.id,row]));
  for (const id of ['authoring-originals','authoring-webtoons']) if (buckets.get(id)?.public) reject('RECOVERY_PRIVATE_BUCKET_PUBLIC');
  const objects = new Map(manifest.objects.map(row => [key(row),row]));
  for (const row of manifest.objects) {
    if (!buckets.has(row.bucket)) reject('RECOVERY_BUCKET_MISSING');
    await verifyBytes(directory, row);
  }
  for (const row of state.references) {
    if (objects.get(key(row))?.sha256 !== row.sha256) reject('RECOVERY_REFERENCE_MISSING');
  }
  return { manifest, state: normalizedState(state) };
}
export async function compareRecoveryBundles(source, restored) {
  if (await realpath(source) === await realpath(restored)) reject('RECOVERY_TARGET_NOT_ISOLATED');
  const before = await inspectRecoveryBundle(source), after = await inspectRecoveryBundle(restored);
  if (before.manifest.snapshotId !== after.manifest.snapshotId || before.manifest.capturedAt !== after.manifest.capturedAt ||
      before.manifest.kind !== after.manifest.kind) reject('RECOVERY_SNAPSHOT_MISMATCH');
  const inventory = manifest => JSON.stringify(manifest.objects.map(row => ({ bucket:row.bucket,object:row.object,bytes:row.bytes,sha256:row.sha256 })).sort((a,b) => key(a).localeCompare(key(b))));
  if (inventory(before.manifest) !== inventory(after.manifest)) reject('RECOVERY_OBJECT_INVENTORY_MISMATCH');
  if (JSON.stringify(before.state) !== JSON.stringify(after.state)) reject('RECOVERY_DATABASE_STATE_MISMATCH');
  return { format:'webnovels-recovery-verification-v1', snapshotId:before.manifest.snapshotId,
    kind:before.manifest.kind, tables:before.state.tables.length, objects:before.manifest.objects.length,
    bytes:before.manifest.objects.reduce((sum,row) => sum + row.bytes,0), byteHashesMatched:true, databaseFingerprintsMatched:true,
    hostedRestoreAccepted:false, limitation:'Verifies supplied archive bytes, state fingerprints and Storage bytes. It does not execute pg_restore or authenticate supplied state evidence; hosted RPC/RLS/Auth/Storage and external configuration need independent acceptance.' };
}
