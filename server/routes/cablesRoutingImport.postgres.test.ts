// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express, { Router } from 'express';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CABLE_ROUTING_PALETTE } from '../../shared/cableRoutingControl.js';

/**
 * Explicit opt-in. A verified local test container receives a fresh random DB;
 * production initialization, JWT/role/project gates, multipart upload, SQL and
 * XLSX export are real. No application DB or runtime dependency is mocked.
 */
describe.skipIf(process.env.WFC_ROUTING_IMPORT_POSTGRES !== '1')(
  'routing Excel import/export through actual authenticated HTTP and PostgreSQL',
  () => {
    const database = `wfc_routing_import_${randomUUID().replaceAll('-', '')}`;
    const owner = randomUUID(),
      actorId = randomUUID(),
      basicId = randomUUID();
    const originalEnvironment = new Map<string, string | undefined>();
    let admin: Pool | undefined, pool: Pool | undefined, server: Server | undefined;
    let created = false,
      baseUrl = '',
      token = '',
      basicToken = '';
    let projectId = '',
      typeId = '';
    const typeName = 'Routing integration cable';

    beforeAll(async () => {
      const inspected = JSON.parse(
        execFileSync('docker', ['inspect', 'wfc-test-postgres'], { encoding: 'utf8' }),
      )[0];
      const ports = inspected.NetworkSettings.Ports['5432/tcp'];
      if (ports?.length !== 1 || ports[0].HostIp !== '127.0.0.1' || ports[0].HostPort !== '55432')
        throw Error('Unexpected test PostgreSQL boundary. Refusing to create a database.');
      const variables = Object.fromEntries(
        inspected.Config.Env.map((value: string) => {
          const at = value.indexOf('=');
          return [value.slice(0, at), value.slice(at + 1)];
        }),
      );
      const connection = {
        host: '127.0.0.1',
        port: 55432,
        user: variables.POSTGRES_USER ?? 'postgres',
        password: variables.POSTGRES_PASSWORD,
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000,
        lock_timeout: 5000,
      };
      if (!/^wfc_routing_import_[a-f0-9]{32}$/.test(database))
        throw Error('Invalid owned test database.');
      admin = new Pool({ ...connection, database: 'postgres', max: 1 });
      await admin.query(`CREATE DATABASE ${database}`);
      created = true;
      // Bind the actual module before its first import. Never fall back to the
      // application's .env URL, including during failed test bootstrap.
      const url = new URL('postgresql://127.0.0.1:55432');
      url.username = connection.user;
      url.password = connection.password;
      url.pathname = `/${database}`;
      const environment: Record<string, string> = {
        DATABASE_URL: url.href,
        JWT_SECRET: `owned-routing-import-test-${owner}`,
        MINIO_ACCESS_KEY: 'owned-test-unused',
        MINIO_SECRET_KEY: 'owned-test-unused',
        API_USE_HTTPS: 'false',
        PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=5000',
      };
      for (const [key, value] of Object.entries(environment)) {
        originalEnvironment.set(key, process.env[key]);
        process.env[key] = value;
      }
      const { config } = await import('../config.js');
      if (config.databaseUrl !== url.href)
        throw Error('Runtime configuration is not bound to the owned test database.');
      const db = await import('../db.js');
      if (db.pool.options.connectionString !== url.href)
        throw Error('Runtime pool is not bound to the owned test database.');
      pool = db.pool;
      expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
      await pool.query('CREATE TABLE routing_import_test_owner(owner uuid PRIMARY KEY)');
      await pool.query('INSERT INTO routing_import_test_owner VALUES($1)', [owner]);
      await db.initializeDatabase();
      await pool.query(
        `INSERT INTO users(id,email,password_hash,first_name,last_name,is_admin,role)
        VALUES($1,$3,'unused','Routing','Verifier',true,'admin'),($2,$4,'unused','Read','Only',false,'basic')`,
        [actorId, basicId, `${actorId}@fixture.invalid`, `${basicId}@fixture.invalid`],
      );
      const { signAccessToken } = await import('../auth.js');
      token = signAccessToken(actorId, `${actorId}@fixture.invalid`, true).token;
      basicToken = signAccessToken(basicId, `${basicId}@fixture.invalid`, false).token;
      const { authenticate, loadCurrentUserRole, requireProjectReadOnly, requireProjectAccess } =
        await import('../middleware.js');
      const { cablesRouter } = await import('./cablesRoutes.js');
      const routes = Router();
      routes.use(authenticate, loadCurrentUserRole, requireProjectReadOnly);
      routes.use('/:projectId', requireProjectAccess);
      routes.use('/:projectId/cables', cablesRouter);
      const app = express();
      app.use(express.json());
      app.use('/api/projects', routes);
      await new Promise<void>((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', resolve);
        server.once('error', reject);
      });
      const address = server!.address();
      if (!address || typeof address === 'string') throw Error('Test HTTP listener unavailable.');
      baseUrl = `http://127.0.0.1:${address.port}`;
      console.info(`Owned routing import fixture created: ${database}`);
    }, 120000);

    async function dropOwnedDatabase() {
      if (!created || !admin) return;
      if (!/^wfc_routing_import_[a-f0-9]{32}$/.test(database))
        throw Error('Invalid test cleanup target.');
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      expect(
        (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount,
      ).toBe(0);
      console.info(`Owned routing import fixture dropped: ${database}`);
    }

    afterAll(async () => {
      try {
        if (server)
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()));
            server!.closeAllConnections();
          });
        if (pool) {
          expect(
            (
              await pool.query(
                'SELECT current_database() AS name,owner FROM routing_import_test_owner',
              )
            ).rows,
          ).toEqual([{ name: database, owner }]);
          await pool.end();
        }
      } finally {
        await dropOwnedDatabase();
        await admin?.end();
        for (const [key, value] of originalEnvironment) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    }, 60000);

    beforeEach(async () => {
      projectId = randomUUID();
      typeId = randomUUID();
      await pool!.query(
        'INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)',
        [projectId, `IMPORT-${projectId}`, 'Owned routing test', 'Fixture'],
      );
      await pool!.query('INSERT INTO cable_types(id,project_id,name) VALUES($1,$2,$3)', [
        typeId,
        projectId,
        typeName,
      ]);
    });

    type Facts = {
      installLength?: number;
      pullDate?: string;
      connectedFrom?: string;
      connectedTo?: string;
      tested?: string;
    };
    async function seed(cableId: number, routing: string | null = null, facts: Facts = {}) {
      const id = randomUUID();
      await pool!.query(
        `INSERT INTO cables(id,project_id,cable_id,cable_type_id,tag,routing,install_length,pull_date,connected_from,connected_to,tested)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          projectId,
          cableId,
          typeId,
          `-WG-${cableId}`,
          routing,
          facts.installLength ?? null,
          facts.pullDate ?? null,
          facts.connectedFrom ?? null,
          facts.connectedTo ?? null,
          facts.tested ?? null,
        ],
      );
      return id;
    }
    function workbook(headers: string[], rows: unknown[][], date1904 = false, formatDates = false) {
      const book = XLSX.utils.book_new(),
        sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      if (formatDates)
        for (let row = 1; row <= rows.length; row++)
          for (let col = 1; col < headers.length; col++) {
            const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
            if (cell) cell.z = 'yyyy-mm-dd';
          }
      XLSX.utils.book_append_sheet(book, sheet, 'Cables');
      book.Workbook = { WBProps: { date1904 } };
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
    }
    type ImportOptions = {
      preview?: boolean;
      protectRouting?: boolean;
      expectedRevisionDigest?: string;
    };
    async function upload(
      file: Buffer,
      options: ImportOptions = {},
      auth: string | null = token,
      timeout = 30000,
    ) {
      const params = new URLSearchParams(
        Object.entries(options).map(([key, value]) => [key, String(value)]),
      );
      const body = new FormData();
      body.append(
        'file',
        new Blob([new Uint8Array(file)], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'routing.xlsx',
      );
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/cables/import?${params}`, {
        method: 'POST',
        body,
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
        signal: AbortSignal.timeout(timeout),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    }
    async function patch(id: string, input: Record<string, unknown>, auth = token) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/cables/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    }
    async function create(input: Record<string, unknown>, auth = token) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}/cables`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    }
    async function freshLogin() {
      const { signAccessToken, verifyAccessToken } = await import('../auth.js');
      const auth = signAccessToken(actorId, `${actorId}@fixture.invalid`, true).token;
      const claims = verifyAccessToken(auth);
      expect(
        (await pool!.query('SELECT 1 FROM viewer_login_bindings WHERE login_id=$1', [claims.jti]))
          .rowCount,
      ).toBe(0);
      return { auth, claims };
    }
    async function expectEligibleManualJob(id: string, claims: { jti?: string; exp?: number }) {
      const jobs = (
        await pool!.query(
          `SELECT m.actor_id,m.login_id,m.state,m.login_expires_at,
        b.user_id,b.revoked_at,b.expires_at,
        m.authority_admin_revision=u.pf_admin_revision AS current_admin,
        m.authority_installation_epoch=s.installation_epoch AS current_installation
        FROM pf_manual_route_jobs m JOIN users u ON u.id=m.actor_id
        JOIN viewer_login_bindings b ON b.login_id=m.login_id
        CROSS JOIN pf_installation_state s
        WHERE m.project_id=$1 AND m.cable_id=$2 AND s.singleton=true`,
          [projectId, id],
        )
      ).rows;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        actor_id: actorId,
        login_id: claims.jti,
        user_id: actorId,
        revoked_at: null,
        state: 'pending',
        current_admin: true,
        current_installation: true,
      });
      expect(jobs[0].login_expires_at.toISOString()).toBe(
        new Date(claims.exp! * 1000).toISOString(),
      );
      expect(jobs[0].expires_at.toISOString()).toBe(jobs[0].login_expires_at.toISOString());
    }
    async function state(cableId: number) {
      return (
        await pool!.query(
          `SELECT b.id,b.routing,b.delivery,b.cable_write_revision::text,b.install_length,
        b.pull_date::text,b.connected_from::text,b.connected_to::text,b.tested::text,c.manual_routing,c.manual_protected,
        c.execution_locked,c.execution_routing,c.revision::text,c.manual_revision::text,m.state AS job_state
        FROM cables b JOIN pf_cable_routing_controls c ON c.project_id=b.project_id AND c.cable_id=b.id
        LEFT JOIN pf_manual_route_jobs m ON m.project_id=b.project_id AND m.cable_id=b.id
        WHERE b.project_id=$1 AND b.cable_id=$2`,
          [projectId, cableId],
        )
      ).rows[0];
    }
    async function snapshot() {
      const result: Record<string, unknown> = {};
      for (const table of [
        'cables',
        'pf_cable_routing_controls',
        'pf_cable_routing_events',
        'pf_manual_route_jobs',
        'cable_versions',
        'cable_materials',
      ]) {
        const condition =
          table === 'cable_versions' || table === 'cable_materials'
            ? 'cable_id IN(SELECT id FROM cables WHERE project_id=$1)'
            : 'project_id=$1';
        result[table] = (
          await pool!.query(
            `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS records
          FROM ${table} t WHERE ${condition}`,
            [projectId],
          )
        ).rows[0].records;
      }
      return result;
    }

    it('rejects unauthenticated and basic-role uploads without writing any project state', async () => {
      const file = workbook(['Cable Id', 'Type', 'Routing'], [[1, typeName, '/A']]),
        before = await snapshot();
      expect((await upload(file, {}, null)).status).toBe(401);
      expect((await upload(file, {}, basicToken)).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it('persists cable Remarks through authenticated create, edit, history, Excel export and import', async () => {
      const original = 'Монтажна бележка\n[PathFinder obstacles] Crosses obstacles: #123, #456.';
      const created = await create({ cableId: 101, cableTypeId: typeId, remarks: original });
      expect(created.status).toBe(201); expect(created.body.cable.remarks).toBe(original);
      const id = created.body.cable.id;
      expect((await pool!.query('SELECT remarks FROM cables WHERE id=$1', [id])).rows[0].remarks).toBe(original);
      expect((await pool!.query('SELECT remarks FROM cable_versions WHERE cable_id=$1 ORDER BY version_number', [id])).rows.map(row => row.remarks)).toEqual([original]);
      const updated = `${original}\nПотвърдено.`;
      expect((await patch(id, { remarks: updated })).body.cable.remarks).toBe(updated);
      const exported = await fetch(`${baseUrl}/api/projects/${projectId}/cables/export?view=list&columns=cableId,remarks`, { headers: { Authorization: `Bearer ${token}` } });
      expect(exported.status).toBe(200);
      const book = XLSX.read(Buffer.from(await exported.arrayBuffer()), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]]);
      expect(rows).toContainEqual({ 'Cable Id': 101, Remarks: updated });
      const imported = 'От импорт\n[PathFinder obstacles] Crosses obstacles: #789.';
      const response = await upload(workbook(['Cable Id', 'Remarks'], [[101, imported]]));
      expect(response.status).toBe(200);
      expect(response.body.cables.find((row: { id: string }) => row.id === id).remarks).toBe(imported);
      expect((await pool!.query('SELECT remarks FROM cable_versions WHERE cable_id=$1 ORDER BY version_number', [id])).rows.map(row => row.remarks)).toEqual([original, updated, imported]);
      const revision = (await pool!.query('SELECT cable_write_revision::text AS revision FROM cables WHERE id=$1', [id])).rows[0].revision;
      expect((await upload(workbook(['Cable Id', 'Remarks'], [[101, imported]]))).body.summary).toMatchObject({ unchanged: 1, updated: 0 });
      expect((await pool!.query('SELECT cable_write_revision::text AS revision FROM cables WHERE id=$1', [id])).rows[0].revision).toBe(revision);
    });

    it('removes stale generated crossing notes on a real manual route change, retaining user text in cable and history', async () => {
      const created = await create({ cableId: 102, cableTypeId: typeId, routing: '/A', remarks: 'User instruction\r\n[PathFinder obstacles] Crosses obstacles: #123.' });
      expect(created.status).toBe(201);
      const changed = await patch(created.body.cable.id, { routing: '/B' });
      expect(changed.status).toBe(200); expect(changed.body.cable).toMatchObject({ routing: '/B', remarks: 'User instruction' });
      expect((await pool!.query('SELECT routing,remarks FROM cable_versions WHERE cable_id=$1 ORDER BY version_number DESC LIMIT 1', [created.body.cable.id])).rows[0])
        .toEqual({ routing: '/B', remarks: 'User instruction' });
    });

    it.each([
      { routing: '/CREATED_AUTO', protect: false },
      { routing: '/CREATED_MANUAL', protect: true },
      { routing: '', protect: false },
    ])(
      'creates an ordinary cable with routing="$routing" and manual protection=$protect',
      async ({ routing, protect }) => {
        const { auth, claims } = await freshLogin();
        const result = await create(
          {
            cableId: 1,
            tag: '-WG-CREATED',
            cableTypeId: typeId,
            routing,
            manualRoutingProtected: protect,
          },
          auth,
        );
        expect(result.status).toBe(201);
        expect(result.body.cable).toMatchObject({
          cableId: 1,
          tag: '-WG-CREATED',
          routing: routing || null,
          routingControl: {
            manualRouting: routing || null,
            manualProtected: protect,
            executionLocked: false,
          },
        });
        const saved = await state(1);
        expect(saved).toMatchObject({
          routing: routing || null,
          manual_routing: routing || null,
          manual_protected: protect,
          execution_locked: false,
          job_state: routing ? 'pending' : null,
        });
        if (routing) await expectEligibleManualJob(saved.id, claims);
        else
          expect(
            (
              await pool!.query('SELECT 1 FROM pf_manual_route_jobs WHERE project_id=$1', [
                projectId,
              ])
            ).rowCount,
          ).toBe(0);
        if (routing && !protect)
          expect(
            (
              await pool!.query(
                'SELECT reason FROM pf_cable_routing_events WHERE project_id=$1 AND cable_id=$2',
                [projectId, saved.id],
              )
            ).rows,
          ).toEqual([{ reason: 'Cable creation' }]);
        expect(
          (
            await pool!.query(
              'SELECT change_source,change_type,changed_by FROM cable_versions WHERE cable_id=$1',
              [saved.id],
            )
          ).rows,
        ).toEqual([{ change_source: 'manual', change_type: 'create', changed_by: actorId }]);
      },
    );

    it('binds a fresh ordinary PATCH login before enqueuing manual calculation without a Path Finder visit', async () => {
      const id = await seed(1, '/OLD'),
        { auth, claims } = await freshLogin();
      const result = await patch(id, { routing: '/FRESH', manualRoutingProtected: true }, auth);
      expect(result.status).toBe(200);
      expect(await state(1)).toMatchObject({
        routing: '/FRESH',
        manual_routing: '/FRESH',
        manual_protected: true,
        job_state: 'pending',
      });
      await expectEligibleManualJob(id, claims);
    });

    it('retains the used automatic route on an unchanged blank manual full-form save and freezes it with first Pull date', async () => {
      const id = await seed(1);
      await pool!.query('UPDATE cables SET routing=$2 WHERE id=$1', [id, '/AUTO']);
      const initial = await state(1);
      expect(initial).toMatchObject({
        routing: '/AUTO',
        manual_routing: null,
        manual_protected: false,
        execution_locked: false,
      });
      const form = {
        cableId: 1,
        cableTypeId: typeId,
        tag: '-WG-1',
        revision: '',
        mto: null,
        fromLocation: '',
        toLocation: '',
        routing: '',
        manualRoutingProtected: false,
        delivery: 'Received',
        designLength: null,
        installLength: null,
        pullDate: null,
        connectedFrom: null,
        connectedTo: null,
        tested: null,
      };
      const delivery = await patch(id, {
        ...form,
        expectedCableWriteRevision: initial.cable_write_revision,
        expectedRoutingControlRevision: initial.revision,
      });
      expect(delivery.status).toBe(200);
      expect(delivery.body.cable).toMatchObject({
        routing: '/AUTO',
        delivery: 'Received',
        routingControl: { manualRouting: null, manualProtected: false, executionLocked: false },
      });
      const beforePull = await state(1);
      const pulled = await patch(id, {
        ...form,
        pullDate: '2026-11-15',
        expectedCableWriteRevision: beforePull.cable_write_revision,
        expectedRoutingControlRevision: beforePull.revision,
      });
      expect(pulled.status).toBe(200);
      expect(pulled.body.cable).toMatchObject({
        routing: '/AUTO',
        pullDate: '2026-11-15',
        routingControl: {
          manualRouting: null,
          manualProtected: false,
          executionLocked: true,
          executionRouting: '/AUTO',
        },
      });
      expect(await state(1)).toMatchObject({
        routing: '/AUTO',
        delivery: 'Received',
        pull_date: '2026-11-15',
        manual_routing: null,
        manual_protected: false,
        execution_locked: true,
        execution_routing: '/AUTO',
        job_state: null,
      });
    });

    it.each(['POST', 'PATCH'])(
      'rejects an impossible calendar date through ordinary %s without writes',
      async (method) => {
        const id = method === 'PATCH' ? await seed(1, '/KEPT') : null;
        const before = await snapshot();
        const input = {
          routing: '/MUST_NOT_SAVE',
          manualRoutingProtected: true,
          pullDate: '2026-02-30',
        };
        const result = id
          ? await patch(id, input)
          : await create({ cableId: 1, tag: '-WG-INVALID', cableTypeId: typeId, ...input });
        expect(result.status).toBe(400);
        expect(JSON.stringify(result.body)).toContain('pullDate');
        expect(await snapshot()).toEqual(before);
      },
    );

    it('resolves an engineer assignment from the database rather than the old admin JWT claim', async () => {
      const file = workbook(['Cable Id', 'Type', 'Routing'], [[1, typeName, '/ASSIGNED']]);
      await pool!.query("UPDATE users SET is_admin=false,role='engineer' WHERE id=$1", [actorId]);
      try {
        const before = await snapshot();
        expect((await upload(file)).status).toBe(403);
        expect(await snapshot()).toEqual(before);
        await pool!.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [
          actorId,
          projectId,
        ]);
        expect((await upload(file)).status).toBe(200);
        expect(await state(1)).toMatchObject({ routing: '/ASSIGNED', manual_protected: false });
      } finally {
        await pool!.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1", [actorId]);
      }
    });

    it('rolls preview back for existing and new rows, including controls, jobs, history and defaults', async () => {
      await seed(1, '/OLD');
      const file = workbook(
        ['Cable Id', 'Type', 'Routing', 'Delivery'],
        [
          [1, typeName, '/NEW', 'Changed'],
          [2, typeName, '/FRESH', 'New'],
        ],
      );
      const before = await snapshot(),
        first = await upload(file, { preview: true, protectRouting: true });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        preview: true,
        cables: [],
        summary: { inserted: 1, updated: 1 },
      });
      expect(first.body.revisionDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(await snapshot()).toEqual(before);
      const repeat = await upload(file, { preview: true, protectRouting: true });
      expect(repeat.body.revisionDigest).toBe(first.body.revisionDigest);
      expect(await snapshot()).toEqual(before);
      const committed = await upload(file, {
        protectRouting: true,
        expectedRevisionDigest: first.body.revisionDigest,
      });
      expect(committed.status).toBe(200);
      expect(committed.body.summary).toMatchObject({ inserted: 1, updated: 1 });
      expect(await state(1)).toMatchObject({
        routing: '/NEW',
        delivery: 'Changed',
        manual_protected: true,
      });
      expect(await state(2)).toMatchObject({
        routing: '/FRESH',
        manual_protected: true,
        job_state: 'pending',
      });
      expect(
        (
          await pool!.query(
            'SELECT DISTINCT actor_id,login_id IS NOT NULL AS has_login FROM pf_manual_route_jobs WHERE project_id=$1',
            [projectId],
          )
        ).rows,
      ).toEqual([{ actor_id: actorId, has_login: true }]);
      expect(
        (
          await pool!.query(
            'SELECT DISTINCT changed_by,change_source FROM cable_versions WHERE cable_id IN(SELECT id FROM cables WHERE project_id=$1)',
            [projectId],
          )
        ).rows,
      ).toEqual([{ changed_by: actorId, change_source: 'import' }]);
    });

    it('rejects a commit from a stale preview before any imported mutation', async () => {
      const id = await seed(1, '/A'),
        file = workbook(['Cable Id', 'Routing'], [[1, '/B']]);
      const preview = await upload(file, { preview: true, protectRouting: true });
      expect(preview.status).toBe(200);
      await pool!.query('UPDATE cables SET delivery=$2 WHERE id=$1', [id, 'Concurrent delivery']);
      const changed = await snapshot(),
        result = await upload(file, {
          protectRouting: true,
          expectedRevisionDigest: preview.body.revisionDigest,
        });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('IMPORT_PREVIEW_CHANGED');
      expect(await snapshot()).toEqual(changed);
    });

    it.each([false, true])(
      'keeps an absent Routing column a no-op with protection=%s',
      async (protectRouting) => {
        await seed(1, '/KEPT');
        const before = await state(1);
        const result = await upload(workbook(['Cable Id'], [[1]]), { protectRouting });
        expect(result.status).toBe(200);
        expect(result.body.summary).toMatchObject({ updated: 0, unchanged: 1 });
        expect(await state(1)).toEqual(before);
      },
    );

    it('keeps a blank Routing cell a no-op with protection OFF, including an incidental automatic value', async () => {
      const id = await seed(1);
      await seed(2, '/MANUAL');
      await pool!.query('UPDATE cables SET routing=$2 WHERE id=$1', [id, '/CURRENT_AUTO']);
      const before = await snapshot(),
        result = await upload(
          workbook(
            ['Cable Id', 'Routing'],
            [
              [1, ''],
              [2, ''],
            ],
          ),
          { protectRouting: false },
        );
      expect(result.status).toBe(200);
      expect(result.body.summary).toMatchObject({ unchanged: 2, updated: 0 });
      expect(await snapshot()).toEqual(before);
    });

    it('clears a blank Routing cell with protection ON, retires its job and makes a repeated import inert', async () => {
      const file = workbook(['Cable Id', 'Type', 'Routing'], [[1, typeName, '/A']]);
      expect((await upload(file, { protectRouting: true })).status).toBe(200);
      const clear = workbook(['Cable Id', 'Routing'], [[1, '']]);
      const first = await upload(clear, { protectRouting: true });
      expect(first.status).toBe(200);
      expect(first.body.summary).toMatchObject({ routesCleared: 1, updated: 1 });
      expect(await state(1)).toMatchObject({
        routing: null,
        manual_routing: null,
        manual_protected: false,
        job_state: null,
      });
      const before = await snapshot(),
        repeat = await upload(clear, { protectRouting: true });
      expect(repeat.status).toBe(200);
      expect(repeat.body.summary).toMatchObject({ unchanged: 1, updated: 0 });
      expect(await snapshot()).toEqual(before);
    });

    it.each([false, true])(
      'imports a filled existing route with requested protection=%s and is idempotent',
      async (protectRouting) => {
        await seed(1);
        const file = workbook(['Cable Id', 'Routing'], [[1, '/BC182/BC183']]);
        const result = await upload(file, { protectRouting });
        expect(result.status).toBe(200);
        expect(await state(1)).toMatchObject({
          routing: '/BC182/BC183',
          manual_routing: '/BC182/BC183',
          manual_protected: protectRouting,
          job_state: 'pending',
        });
        const before = await snapshot(),
          repeat = await upload(file, { protectRouting });
        expect(repeat.status).toBe(200);
        expect(repeat.body.summary).toMatchObject({ unchanged: 1, updated: 0 });
        expect(await snapshot()).toEqual(before);
      },
    );

    it('initially imports a filled route without metadata or protection and preserves that intent on replay', async () => {
      const file = workbook(['Cable Id', 'Type', 'Routing'], [[1, typeName, '/INITIAL']]);
      const first = await upload(file);
      expect(first.status).toBe(200);
      expect(first.body.summary.inserted).toBe(1);
      expect(await state(1)).toMatchObject({
        routing: '/INITIAL',
        manual_routing: '/INITIAL',
        manual_protected: false,
        execution_locked: false,
      });
      const before = await snapshot(),
        repeat = await upload(file);
      expect(repeat.status).toBe(200);
      expect(repeat.body.summary.unchanged).toBe(1);
      expect(await snapshot()).toEqual(before);
    });

    it.each([false, true])(
      'freezes a newly imported execution report while preserving requested manual protection=%s',
      async (protectRouting) => {
        const file = workbook(
          ['Cable Id', 'Type', 'Routing', 'Pull date'],
          [[1, typeName, '/INITIAL_EXECUTED', '2026-11-15']],
        );
        const first = await upload(file, { protectRouting });
        expect(first.status).toBe(200);
        expect(first.body.summary).toMatchObject({ inserted: 1, executionLocksAdded: 1 });
        expect(await state(1)).toMatchObject({
          routing: '/INITIAL_EXECUTED',
          manual_routing: '/INITIAL_EXECUTED',
          manual_protected: protectRouting,
          execution_locked: true,
          execution_routing: '/INITIAL_EXECUTED',
        });
        const refused = await upload(workbook(['Cable Id', 'Routing'], [[1, '/REPLACED']]), {
          protectRouting: true,
        });
        expect(refused.status).toBe(200);
        expect(refused.body.summary.blockedRouting).toEqual([
          { cableId: 1, tag: null, reasons: ['PULL_DATE_RECORDED'] },
        ]);
        expect(await state(1)).toMatchObject({
          routing: '/INITIAL_EXECUTED',
          manual_protected: protectRouting,
        });
      },
    );

    it('reports every locked cable and reason while saving unrelated fields and another cable', async () => {
      const definitions: Array<{ number: number; facts: Facts; reasons: string[] }> = [
        { number: 1, facts: { installLength: 12 }, reasons: ['INSTALL_LENGTH_RECORDED'] },
        { number: 2, facts: { pullDate: '2026-11-15' }, reasons: ['PULL_DATE_RECORDED'] },
        { number: 3, facts: { connectedFrom: '2026-11-15' }, reasons: ['CONNECTED_FROM_RECORDED'] },
        { number: 4, facts: { connectedTo: '2026-11-15' }, reasons: ['CONNECTED_TO_RECORDED'] },
        { number: 5, facts: { tested: '2026-11-15' }, reasons: ['TESTED_DATE_RECORDED'] },
        {
          number: 6,
          facts: {
            installLength: 12,
            pullDate: '2026-11-15',
            connectedFrom: '2026-11-15',
            connectedTo: '2026-11-15',
            tested: '2026-11-15',
          },
          reasons: [
            'INSTALL_LENGTH_RECORDED',
            'PULL_DATE_RECORDED',
            'CONNECTED_FROM_RECORDED',
            'CONNECTED_TO_RECORDED',
            'TESTED_DATE_RECORDED',
          ],
        },
      ];
      for (const item of definitions) await seed(item.number, `/KEPT${item.number}`, item.facts);
      const retained = await seed(7, '/KEPT7', { tested: '2026-11-15' });
      await pool!.query('UPDATE cables SET tested=NULL WHERE id=$1', [retained]);
      definitions.push({ number: 7, facts: {}, reasons: ['EXECUTION_LOCK_RETAINED'] });
      await seed(8);
      const result = await upload(
        workbook(
          ['Cable Id', 'Routing', 'Delivery'],
          Array.from({ length: 8 }, (_, i) => [i + 1, '/CHANGED', 'Received']),
        ),
        { protectRouting: true },
      );
      expect(result.status).toBe(200);
      expect(result.body.summary.updated).toBe(8);
      expect(result.body.summary.blockedRouting).toEqual(
        definitions.map((item) => ({
          cableId: item.number,
          tag: `-WG-${item.number}`,
          reasons: item.reasons,
        })),
      );
      for (const item of definitions)
        expect(await state(item.number)).toMatchObject({
          routing: `/KEPT${item.number}`,
          delivery: 'Received',
          execution_locked: true,
        });
      expect(await state(8)).toMatchObject({
        routing: '/CHANGED',
        delivery: 'Received',
        manual_protected: true,
        execution_locked: false,
      });
    });

    it('accepts an imported route with the first execution report, then retains the route after clearing the fact', async () => {
      await seed(1, '/A');
      const accepted = await upload(
        workbook(['Cable Id', 'Routing', 'Pull date'], [[1, '/B', '2026-11-15']]),
        { protectRouting: true },
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.summary.blockedRouting).toEqual([]);
      expect(accepted.body.summary.executionLocksAdded).toBe(1);
      expect(await state(1)).toMatchObject({
        routing: '/B',
        pull_date: '2026-11-15',
        execution_locked: true,
        execution_routing: '/B',
      });
      const refused = await upload(
        workbook(
          ['Cable Id', 'Routing', 'Pull date', 'Delivery'],
          [[1, '/C', '', 'Keep this delivery']],
        ),
        { protectRouting: true },
      );
      expect(refused.status).toBe(200);
      expect(refused.body.summary.blockedRouting).toEqual([
        { cableId: 1, tag: '-WG-1', reasons: ['PULL_DATE_RECORDED'] },
      ]);
      expect(await state(1)).toMatchObject({
        routing: '/B',
        pull_date: null,
        delivery: 'Keep this delivery',
        execution_locked: true,
        execution_routing: '/B',
      });
      const retained = await upload(workbook(['Cable Id', 'Routing'], [[1, '/D']]), {
        protectRouting: true,
      });
      expect(retained.body.summary.blockedRouting[0].reasons).toEqual(['EXECUTION_LOCK_RETAINED']);
    });

    it('accepts PATCH route plus first execution report and atomically refuses later replacement', async () => {
      const id = await seed(1, '/A');
      const accepted = await patch(id, {
        routing: '/B',
        manualRoutingProtected: true,
        pullDate: '2026-11-15',
      });
      expect(accepted.status).toBe(200);
      expect(await state(1)).toMatchObject({
        routing: '/B',
        execution_locked: true,
        execution_routing: '/B',
      });
      const before = await snapshot(),
        refused = await patch(id, {
          routing: '/C',
          pullDate: null,
          delivery: 'Must not claim saved',
        });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('ROUTING_EXECUTION_PROTECTED');
      expect(await snapshot()).toEqual(before);
      expect((await patch(id, { pullDate: null })).status).toBe(200);
      const retained = await patch(id, { routing: '/C' });
      expect(retained.status).toBe(409);
      expect(retained.body.routingConflict.reasons).toContain('EXECUTION_LOCK_RETAINED');
      expect(await state(1)).toMatchObject({
        routing: '/B',
        pull_date: null,
        execution_locked: true,
      });
    });

    it.each([false, true])(
      'reads actual formatted raw Excel serial dates with date1904=%s',
      async (date1904) => {
        await seed(1);
        const day = Date.UTC(2026, 10, 15),
          serial = date1904
            ? (day - Date.UTC(1904, 0, 1)) / 86400000
            : (day - Date.UTC(1899, 11, 30)) / 86400000;
        const result = await upload(
          workbook(
            ['Cable Id', 'Pull date', 'Connected From', 'Connected To', 'Cable tested'],
            [[1, serial, serial + 1, serial + 2, serial + 3]],
            date1904,
            true,
          ),
        );
        expect(result.status).toBe(200);
        expect(await state(1)).toMatchObject({
          pull_date: '2026-11-15',
          connected_from: '2026-11-16',
          connected_to: '2026-11-17',
          tested: '2026-11-18',
          execution_locked: true,
        });
      },
    );

    it('rejects an invalid calendar date before mutations on any workbook row', async () => {
      await seed(1);
      await seed(2);
      const before = await snapshot(),
        result = await upload(
          workbook(
            ['Cable Id', 'Routing', 'Pull date'],
            [
              [1, '/VALID', '2026-11-15'],
              [2, '/INVALID', '2026-02-30'],
            ],
          ),
          { protectRouting: true },
        );
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toContain('Pull date');
      expect(await snapshot()).toEqual(before);
    });

    it('exports selected execution dates as dates and routes with shared colors and explanatory comments', async () => {
      const auto = await seed(1);
      await seed(2, '/MANUAL');
      await pool!.query('UPDATE cables SET routing=$2 WHERE id=$1', [auto, '/AUTO']);
      await seed(3, '/AS_BUILT', {
        installLength: 27,
        pullDate: '2026-11-15',
        connectedFrom: '2026-11-16',
        connectedTo: '2026-11-17',
        tested: '2026-11-18',
      });
      const invalid = await seed(4, '/MISSING');
      await pool!.query(
        `INSERT INTO pf_manual_route_jobs(project_id,cable_id,manual_revision,state,diagnostics) VALUES($1,$2,1,'invalid',$3)`,
        [projectId, invalid, JSON.stringify(['BC182 was deleted. The saved route is retained.'])],
      );
      const columns = [
        'cableId',
        'tag',
        'routing',
        'installLength',
        'pullDate',
        'connectedFrom',
        'connectedTo',
        'tested',
      ];
      const beforeExport = await snapshot();
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/cables/export?view=list&columns=${columns.join(',')}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('spreadsheetml');
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await response.arrayBuffer());
      const sheet = book.getWorksheet('Cables')!;
      expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
        'Cable Id',
        'Tag',
        'Routing',
        'Install length [m]',
        'Pull date',
        'Connected From',
        'Connected To',
        'Cable tested',
      ]);
      expect(sheet.getCell('D4').value).toBe(27);
      for (const [index, date] of [
        '2026-11-15',
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
      ].entries()) {
        const cell = sheet.getCell(4, index + 5);
        expect(cell.value).toBeInstanceOf(Date);
        expect((cell.value as Date).toISOString().slice(0, 10)).toBe(date);
        expect(cell.numFmt).toBe('yyyy-mm-dd');
      }
      for (const [index, tone] of (
        ['automatic', 'manual', 'execution', 'warning'] as const
      ).entries()) {
        const cell = sheet.getCell(index + 2, 3),
          fill = cell.fill as ExcelJS.FillPattern;
        expect(fill.fgColor?.argb).toBe(`FF${CABLE_ROUTING_PALETTE[tone].light.slice(1)}`);
        const text =
          typeof cell.note === 'string'
            ? cell.note
            : cell.note?.texts?.map((item) => item.text).join('');
        expect(text).toContain(CABLE_ROUTING_PALETTE[tone].label);
        expect(text).toContain('Used route:');
        if (tone === 'warning') expect(text).toContain('BC182 was deleted.');
      }
      expect(await snapshot()).toEqual(beforeExport);
    });

    it.skipIf(process.env.WFC_ROUTING_IMPORT_5000 !== '1')(
      'imports 5000 rows and replays them without duplicate writes within a bounded request',
      async () => {
        const file = workbook(
          ['Cable Id', 'Type', 'Tag', 'Routing'],
          Array.from({ length: 5000 }, (_, i) => [
            i + 1,
            typeName,
            `LOAD-${i + 1}`,
            '/BC182/BC183',
          ]),
        );
        expect(file.length).toBeLessThan(5 * 1024 * 1024);
        const started = Date.now(),
          first = await upload(file, { protectRouting: false }, token, 150000);
        expect(first.status).toBe(200);
        expect(first.body.summary).toMatchObject({ inserted: 5000, updated: 0 });
        const counts = (
          await pool!.query(
            `SELECT (SELECT count(*)::int FROM cables WHERE project_id=$1) AS cables,
        (SELECT count(*)::int FROM cable_versions WHERE cable_id IN(SELECT id FROM cables WHERE project_id=$1)) AS versions,
        (SELECT count(*)::int FROM pf_manual_route_jobs WHERE project_id=$1) AS jobs`,
            [projectId],
          )
        ).rows[0];
        expect(counts).toEqual({ cables: 5000, versions: 5000, jobs: 5000 });
        const repeated = await upload(file, { protectRouting: false }, token, 150000);
        expect(repeated.status).toBe(200);
        expect(repeated.body.summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 5000 });
        expect(
          (
            await pool!.query(
              'SELECT count(*)::int AS count FROM cable_versions WHERE cable_id IN(SELECT id FROM cables WHERE project_id=$1)',
              [projectId],
            )
          ).rows[0].count,
        ).toBe(5000);
        expect(Date.now() - started).toBeLessThan(240000);
        console.info(
          `Owned 5000-row import/replay completed in ${Date.now() - started}ms (${file.length} XLSX bytes).`,
        );
      },
      250000,
    );
  },
);
