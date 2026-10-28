// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { initializeModelRegistry } from './schema.js';
import { createModelRegistryRepository } from './repository.js';
import type { VerificationReport } from './types.js';

// Explicit opt-in only. This suite never reads DATABASE_URL or application configuration.
const connection = process.env.WFC_TEST_DATABASE_URL;
if (connection) {
  const target = new URL(connection);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.pathname !== '/codex_wfc_package_test' || target.username !== 'codex_test') {
    throw new Error('WFC_TEST_DATABASE_URL must identify the isolated loopback codex_wfc_package_test fixture.');
  }
}
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

describe.skipIf(!connection)('retained ZIP ownership against isolated PostgreSQL', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: connection, max: 8, connectionTimeoutMillis: 10_000 });
    const actual = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== 'codex_wfc_package_test') throw new Error('Unexpected integration database.');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users(id UUID PRIMARY KEY,is_admin BOOLEAN NOT NULL DEFAULT FALSE,role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id UUID PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_project_access(user_id UUID REFERENCES users(id),project_id UUID REFERENCES projects(id),PRIMARY KEY(user_id,project_id));
    `);
    await initializeModelRegistry(pool);
  });
  afterAll(async () => { await pool?.end(); });

  async function fixture() {
    const projectId = randomUUID(), userId = randomUUID(), fingerprint = sha(projectId);
    await pool.query("INSERT INTO users(id,role) VALUES($1,'engineer')", [userId]);
    await pool.query("INSERT INTO projects(id,name) VALUES($1,'Synthetic isolated ZIP integration fixture')", [projectId]);
    await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [userId, projectId]);
    const repository = createModelRegistryRepository(pool);
    const makeReport = (salt = randomUUID()): VerificationReport => {
      const packageId = randomUUID(), resource = { path: 'resources/output/0/0.svf', bytes: 4, sha256: sha('test') };
      const manifest = { schemaVersion: 1 as const, packageId, label: 'Original fixture label',
        source: { name: 'synthetic.nwd', bytes: 50, sha256: sha('synthetic source'), identityBasis: 'captured-at-conversion' as const },
        preparedAt: '2026-10-20T00:00:00.000Z', supportProfile: 'svf-local-7.130.0-v1' as const, format: 'svf' as const,
        sdkVersion: '7.130.0' as const, entrypoint: 'resources/output/0/0.svf' as const, resources: [resource], contentFingerprint: fingerprint };
      return { reportSchemaVersion: 1, toolVersion: 'synthetic-repository-fixture', nodeVersion: process.version, operation: 'verify', status: 'PASS',
        startedAt: manifest.preparedAt, finishedAt: manifest.preparedAt, package: { path: 'synthetic.zip', bytes: 100, sha256: sha(salt), packageId },
        contentFingerprint: fingerprint, canonicalBytes: 4, resourceCount: 1, totalRawBytes: 4,
        limits: { maxArchiveBytes: 2147483648, maxTotalResourceBytes: 8589934592, maxFiles: 100000, maxFileBytes: 2147483648,
          maxManifestBytes: 33554432, maxNestedBytes: 268435456, maxNestedTotalBytes: 1073741824, maxDepth: 16, maxExpansionRatio: 1200, maxMs: 600000 },
        checks: { portableManifest: 'PASS', safeArchive: 'PASS', rawInventory: 'PASS', fingerprint: 'PASS', supportedProfile: 'PASS', nestedReferences: 'PASS' },
        profile: {}, extraction: null, manifest, resources: [{ ...resource, verifiedSha256: resource.sha256 }],
        limitations: ['Synthetic repository receipt; not a package-byte or MinIO integration test.'] };
    };
    const reserve = async (report = makeReport()) => {
      const begun = await repository.beginImport({ projectId, requestedBy: userId, idempotencyKey: randomUUID(), archiveSha256: report.package.sha256, expectedBytes: report.package.bytes });
      try {
        let job = await repository.updateProgress(begun.job, 'staging', report.package.bytes);
        job = await repository.updateProgress(job, 'validating');
        const reservation = await repository.reserve(job, report);
        if (reservation.kind === 'busy') throw new Error('Unexpected concurrent fixture reservation');
        return { job, report, reservation, release: begun.lock!.release };
      } catch (error) { await begun.lock!.release(); throw error; }
    };
    const publish = async () => {
      const candidate = await reserve();
      try {
        if (candidate.reservation.kind !== 'reserved') throw new Error('Expected a new version');
        const job = await repository.markPublishing(candidate.job);
        const version = await repository.publish(job, candidate.reservation.version, candidate.report, { resourceCount: 1, totalBytes: 4 });
        return { version, job: (await repository.getImport(projectId, job.id))! };
      } finally { await candidate.release(); }
    };
    return { projectId, userId, repository, makeReport, reserve, publish };
  }

  it('adds the missing archive table and initializes twice without changing an existing ready model or selection', async () => {
    const f = await fixture(), original = await f.publish();
    await f.repository.selectModel(f.projectId, original.version.id, 0, f.userId);
    const before = await f.repository.listVersions(f.projectId);
    // Recreate the pre-retention schema only inside this explicitly gated disposable database.
    await pool.query('DROP TABLE model_package_archives');
    await initializeModelRegistry(pool);
    await initializeModelRegistry(pool);
    expect(await f.repository.listVersions(f.projectId)).toEqual(before);
    expect(await f.repository.getPublishedArchive(f.projectId, original.version.id)).toBeNull();
  });

  it('publishes a new archive and a different original ZIP for a legacy content duplicate atomically', async () => {
    const f = await fixture(), original = await f.publish();
    const originalArchive = await f.repository.getPublishedArchive(f.projectId, original.version.id);
    expect(originalArchive).toMatchObject({ importId: original.job.id, published: true, bytes: 100, sha256: original.job.archiveSha256 });
    // Emulate an older ready version from before ZIP retention, only in the disposable fixture.
    await pool.query('DELETE FROM model_package_archives WHERE import_id=$1', [original.job.id]);
    const before = await f.repository.listVersions(f.projectId), candidate = await f.reserve();
    try {
      expect(candidate.reservation.kind).toBe('duplicate');
      expect((await f.repository.getImport(f.projectId, candidate.job.id))?.state).toBe('validating');
      expect(await f.repository.getPublishedArchive(f.projectId, original.version.id)).toBeNull();
      const job = await f.repository.markPublishing(candidate.job);
      await f.repository.publishDuplicate(job, candidate.reservation.version, candidate.report);
      expect((await f.repository.getImport(f.projectId, job.id))?.state).toBe('complete');
      const archive = await f.repository.getPublishedArchive(f.projectId, original.version.id);
      expect(archive).toMatchObject({ importId: job.id, modelVersionId: original.version.id, published: true, sha256: candidate.report.package.sha256 });
      expect(archive?.sha256).not.toBe(original.job.archiveSha256);
      expect(archive?.storagePrefix).toBe(`archives/${f.projectId}/${job.id}/`);
      expect(await f.repository.listVersions(f.projectId)).toEqual(before);
      expect(Number((await pool.query('SELECT COUNT(*) FROM model_package_aliases WHERE project_id=$1', [f.projectId])).rows[0].count)).toBe(2);
    } finally { await candidate.release(); }
  });

  it.each(['role', 'assignment'] as const)('rolls back duplicate archive publication after current %s is revoked', async kind => {
    const f = await fixture(), original = await f.publish(), candidate = await f.reserve();
    const before = await f.repository.listVersions(f.projectId);
    try {
      const job = await f.repository.markPublishing(candidate.job);
      if (kind === 'role') await pool.query("UPDATE users SET role='basic' WHERE id=$1", [f.userId]);
      else await pool.query('DELETE FROM user_project_access WHERE user_id=$1 AND project_id=$2', [f.userId, f.projectId]);
      await expect(f.repository.publishDuplicate(job, candidate.reservation.version, candidate.report)).rejects.toMatchObject({ code: 'IMPORT_ACCESS_REVOKED' });
      expect(await f.repository.getArchiveOwnership(job.id)).toMatchObject({ published: false });
      expect((await f.repository.getImport(f.projectId, job.id))?.state).toBe('publishing');
      expect((await f.repository.getPublishedArchive(f.projectId, original.version.id))?.importId).toBe(original.job.id);
      expect(await f.repository.listVersions(f.projectId)).toEqual(before);
    } finally { await candidate.release(); }
  });

  it('rejects ownership/hash rewrites and unpublishing a published archive through the real trigger', async () => {
    const f = await fixture(), original = await f.publish();
    for (const statement of [
      "UPDATE model_package_archives SET archive_sha256='" + 'f'.repeat(64) + "' WHERE import_id=$1",
      'UPDATE model_package_archives SET published=FALSE WHERE import_id=$1',
    ]) {
      await expect(pool.query(statement, [original.job.id])).rejects.toMatchObject({ code: '23514', constraint: 'model_storage_ownership_immutable' });
    }
    expect(await f.repository.getArchiveOwnership(original.job.id)).toMatchObject({ published: true, sha256: original.job.archiveSha256 });
  });
});
