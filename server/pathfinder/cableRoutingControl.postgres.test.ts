// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeCableRoutingControlSchema } from './cableRoutingControlSchema.js';
import { applyCableRoutingControlInTransaction, assertAutomaticRoutingControl, initializeImportedCableRoutingControl, readCableRoutingControl } from './cableRoutingControlRepository.js';
import { readAutomaticPairOwnership } from './automaticPairOwnership.js';

// Opt-in tests create and drop a uniquely owned database on the 5181 test
// PostgreSQL container. They never bootstrap or edit either application DB.
describe.skipIf(process.env.WFC_ROUTING_CONTROL_POSTGRES !== '1')('routing control on an isolated actual PostgreSQL database', () => {
  const database = 'wfc_routing_control_' + randomUUID().replaceAll('-', '');
  const projectId = randomUUID(), actorId = randomUUID(), loginId = randomUUID();
  const principal = { userId: actorId, loginId, loginExpiresAt: Date.now() + 3600000 };
  let admin: Pool, pool: Pool;
  let created = false,closing=false;
  const oldManualId = randomUUID(), oldBlankId = randomUUID();
  beforeAll(async () => {
    const inspected = JSON.parse(execFileSync('docker', ['inspect', 'wfc-test-postgres'], { encoding: 'utf8' }))[0];
    const ports = inspected.NetworkSettings.Ports['5432/tcp'];
    if (ports.length !== 1 || ports[0].HostIp !== '127.0.0.1' || ports[0].HostPort !== '55432') throw Error('Unexpected test PostgreSQL boundary.');
    const variables = Object.fromEntries(inspected.Config.Env.map((value: string) => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
    const config = { host: '127.0.0.1', port: 55432, user: variables.POSTGRES_USER ?? 'postgres', password: variables.POSTGRES_PASSWORD,
      connectionTimeoutMillis: 5000, statement_timeout: 10000 };
    admin = new Pool({ ...config, database: 'postgres', max: 1 });
    if (!/^wfc_routing_control_[a-f0-9]{32}$/.test(database)) throw Error('Invalid owned test database.');
    await admin.query(`CREATE DATABASE ${database}`); created = true;
    pool = new Pool({ ...config, database, max: 4 });
    pool.on('error',(error:Error&{code?:string})=>{if(closing&&error.code==='57P01')return;throw new Error('Owned PostgreSQL pool failed: '+(error.code??'UNKNOWN'));});
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
    await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,pf_admin_revision bigint NOT NULL DEFAULT 1);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY,installation_epoch uuid NOT NULL);
      CREATE TABLE pf_auto_lengths(project_id uuid,cable_id uuid,proposal_id uuid,source jsonb,source_sha256 text);
      CREATE TABLE pf_proposals(project_id uuid,cable_id uuid,id uuid,status text,dependencies jsonb,result jsonb);
      CREATE TABLE pf_revision_results(project_id uuid,cable_id uuid,proposal_id uuid,record jsonb);
      CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL,tag text,mto text DEFAULT 'LV',routing text,
      design_length numeric,install_length numeric,pull_date date,connected_from date,connected_to date,tested date,
      delivery text,cable_write_revision bigint NOT NULL DEFAULT 1,UNIQUE(project_id,id));`);
    await pool.query('INSERT INTO users(id,is_admin) VALUES($1,true)',[actorId]);
    await pool.query('INSERT INTO pf_installation_state VALUES(true,$1)',[randomUUID()]);
    await pool.query('INSERT INTO cables(id,project_id,routing) VALUES($1,$3,$4),($2,$3,NULL)', [oldManualId, oldBlankId, projectId, '/BC182']);
    await initializeCableRoutingControlSchema(pool);
    await initializeCableRoutingControlSchema(pool);
  });
  afterAll(async () => {
    closing=true;
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin?.end();
  });
  async function seed(routing: string | null = null) {
    const id = randomUUID();
    return (await pool.query('INSERT INTO cables(id,project_id,tag,routing) VALUES($1,$2,$3,$4) RETURNING *', [id, projectId, 'Fixture ' + id, routing])).rows[0];
  }
  async function transact<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function edit(before: Record<string, any>, routing: string | null, manualProtected?: boolean, extra: Record<string, any> = {}) {
    return transact(async client => {
      const result = await applyCableRoutingControlInTransaction(client, { projectId, cableId: before.id, actorId, principal, before,
        after: { ...before, routing }, automaticRouting: '/AUTO', mutation: { kind: 'manual', routing, manualProtected }, ...extra });
      if (!result.blockedReasons.length) await client.query('UPDATE cables SET routing=$2 WHERE id=$1', [before.id, result.routing]);
      return result;
    });
  }
  it('backfills exactly once and never reclassifies later automatic values', async () => {
    expect((await readCableRoutingControl(pool, projectId, oldManualId))?.control).toMatchObject({ manualRouting: '/BC182', manualProtected: true });
    expect((await readCableRoutingControl(pool, projectId, oldBlankId))?.control).toMatchObject({ manualRouting: null, manualProtected: false });
    await pool.query('UPDATE cables SET routing=$2 WHERE id=$1', [oldBlankId, '/NEW_AUTO']);
    await initializeCableRoutingControlSchema(pool);
    expect((await readCableRoutingControl(pool, projectId, oldBlankId))?.control).toMatchObject({ manualRouting: null, manualProtected: false });
    expect((await pool.query('SELECT actor_id,login_id FROM pf_manual_route_jobs WHERE cable_id=$1', [oldManualId])).rows[0]).toEqual({ actor_id: null, login_id: null });
  });
  it('persists edits, causal manual revisions, audit and authenticated pending jobs together', async () => {
    const row = await seed(); const saved = await edit(row, '/A/B');
    expect(saved).toMatchObject({ revision: '2', manualRevision: '2', routing: '/A/B', control: { manualProtected: true } });
    expect((await pool.query('SELECT manual_revision::text,actor_id,login_id,state,length_metres FROM pf_manual_route_jobs WHERE cable_id=$1', [row.id])).rows[0])
      .toEqual({ manual_revision: '2', actor_id: actorId, login_id: loginId, state: 'pending', length_metres: null });
    const unchecked = await edit({ ...row, routing: '/A/B' }, '/A/B', false);
    expect(unchecked).toMatchObject({ routing: null, control: { manualRouting: '/A/B', manualProtected: false } });
    expect((await pool.query('SELECT manual_revision::text FROM pf_manual_route_jobs WHERE cable_id=$1', [row.id])).rows).toEqual([{ manual_revision: '3' }]);
    const cleared = await edit({ ...row, routing: '/AUTO' }, null);
    expect(cleared).toMatchObject({ routing: null, control: { manualRouting: null, manualProtected: false } });
    expect((await pool.query('SELECT * FROM pf_manual_route_jobs WHERE cable_id=$1', [row.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM pf_cable_routing_events WHERE cable_id=$1', [row.id])).rows[0].count).toBe(3);
  });
  it.each([false,true])('initializes a fresh imported row before applying protection and execution freeze, protect=%s',async protect=>{
    const row=await seed('/IMPORTED');
    // The test row is fresh and still has only the INSERT trigger seed.
    const saved=await transact(client=>initializeImportedCableRoutingControl(client,{projectId,cableId:row.id,actorId,principal,after:row,protect}));
    expect(saved.control).toMatchObject({manualRouting:'/IMPORTED',manualProtected:protect,executionLocked:false});
    expect((await pool.query('SELECT actor_id,login_id FROM pf_manual_route_jobs WHERE cable_id=$1',[row.id])).rows[0]).toEqual({actor_id:actorId,login_id:loginId});
    const installed=await seed('/ALREADY_PULLED');
    await pool.query('UPDATE cables SET pull_date=$2 WHERE id=$1',[installed.id,'2026-11-15']);
    // Production initialization occurs inside the original INSERT transaction,
    // where facts are part of INSERT, rather than a separate UPDATE/latch.
    const newId=randomUUID();
    await transact(async client=>{
      const inserted=(await client.query('INSERT INTO cables(id,project_id,routing,pull_date) VALUES($1,$2,$3,$4) RETURNING *',[newId,projectId,'/ALREADY_PULLED','2026-11-15'])).rows[0];
      const initialized=await initializeImportedCableRoutingControl(client,{projectId,cableId:newId,actorId,principal,after:inserted,protect});
      expect(initialized.control).toMatchObject({manualProtected:protect,executionLocked:true,executionRouting:'/ALREADY_PULLED'});
    });
  });
  it.each([false,true])('keeps effective routing for missing or blank non-protected import cells, missing=%s',async missing=>{
    const row=await seed();await pool.query('UPDATE cables SET routing=$2 WHERE id=$1',[row.id,'/KEPT_AUTO']);row.routing='/KEPT_AUTO';
    const result=await transact(client=>applyCableRoutingControlInTransaction(client,{projectId,cableId:row.id,actorId,principal,before:row,after:row,
      automaticRouting:'/DIFFERENT_LAST_RESULT',mutation:{kind:'import',present:!missing,routing:null,protect:false}}));
    expect(result).toMatchObject({routing:'/KEPT_AUTO',revision:'1',control:{manualRouting:null,manualProtected:false}});
  });
  it.each(['install_length', 'pull_date', 'connected_from', 'connected_to', 'tested'])('latches %s and retains the freeze when the fact is cleared', async column => {
    const row = await seed('/INSTALLED'); const value = column === 'install_length' ? 20 : '2026-11-15';
    await pool.query(`UPDATE cables SET ${column}=$2 WHERE id=$1`, [row.id, value]);
    const locked = await readCableRoutingControl(pool, projectId, row.id);
    expect(locked?.control).toMatchObject({ executionLocked: true, executionRouting: '/INSTALLED' });
    // Latching execution does not invalidate the manual text's causal revision.
    expect(locked?.manualRevision).toBe('1'); expect(locked?.revision).toBe('2');
    await expect(edit({ ...row, [column]: value }, null)).resolves.toMatchObject({ routing: '/INSTALLED', blockedReasons: expect.any(Array) });
    await pool.query(`UPDATE cables SET ${column}=NULL WHERE id=$1`, [row.id]);
    await expect(pool.query('UPDATE cables SET routing=$2 WHERE id=$1', [row.id, '/WRONG'])).rejects.toThrow('ROUTING_EXECUTION_PROTECTED');
    const retained = await edit(row, null);
    expect(retained.blockedReasons).toEqual(['EXECUTION_LOCK_RETAINED']);
    const released = await edit(row, null, false, { unlockReason: 'Installation report was corrected' });
    expect(released.control.executionLocked).toBe(false); expect(released.routing).toBe(null);
    expect((await pool.query('SELECT reason FROM pf_cable_routing_events WHERE cable_id=$1 ORDER BY id DESC LIMIT 1', [row.id])).rows[0].reason).toBe('Installation report was corrected');
  });
  it('refuses unlock while execution facts remain and refuses a stale control revision', async () => {
    const row = await seed('/A');
    await pool.query('UPDATE cables SET tested=$2 WHERE id=$1', [row.id, '2026-11-15']);
    await expect(edit({ ...row, tested: '2026-11-15' }, '/B', true, { unlockReason: 'Correction' })).rejects.toMatchObject({ code: 'ROUTING_EXECUTION_FACTS_PRESENT' });
    const other = await seed(); await edit(other, '/A');
    await expect(edit(other, '/B', true, { expectedRevision: '1' })).rejects.toMatchObject({ code: 'ROUTING_CONTROL_CHANGED' });
    expect((await pool.query('SELECT routing FROM cables WHERE id=$1', [other.id])).rows[0].routing).toBe('/A');
  });
  it('keeps blocked import routing while allowing other fields and other cables in one transaction', async () => {
    const locked = await seed('/A'), free = await seed();
    await pool.query('UPDATE cables SET pull_date=$2 WHERE id=$1', [locked.id, '2026-11-15']);
    const result = await transact(async client => {
      const blocked = await applyCableRoutingControlInTransaction(client, { projectId, cableId: locked.id, actorId, principal,
        before: { ...locked, pull_date: '2026-11-15' }, after: { ...locked, pull_date: '2026-11-15', delivery: 'Received' },
        automaticRouting: '/AUTO', mutation: { kind: 'import', present: true, routing: '/CHANGED', protect: true } });
      await client.query('UPDATE cables SET routing=$2,delivery=$3 WHERE id=$1', [locked.id, blocked.routing, 'Received']);
      const allowed = await applyCableRoutingControlInTransaction(client, { projectId, cableId: free.id, actorId, principal, before: free, after: free,
        automaticRouting: '/AUTO', mutation: { kind: 'import', present: true, routing: '/B', protect: true } });
      await client.query('UPDATE cables SET routing=$2 WHERE id=$1', [free.id, allowed.routing]);
      return blocked;
    });
    expect(result.blockedReasons).toEqual(['PULL_DATE_RECORDED']);
    expect((await pool.query('SELECT routing,delivery FROM cables WHERE id=$1', [locked.id])).rows[0]).toEqual({ routing: '/A', delivery: 'Received' });
    expect((await pool.query('SELECT routing FROM cables WHERE id=$1', [free.id])).rows[0].routing).toBe('/B');
  });
  it('uses persisted intent for admission despite incidental cable revision changes and checks writer guards', async () => {
    const row = await seed(); await pool.query('UPDATE cables SET routing=$2,cable_write_revision=77,delivery=$3 WHERE id=$1', [row.id, '/PREVIOUS_AUTO', 'New delivery']);
    const current = (await pool.query('SELECT * FROM cables WHERE id=$1', [row.id])).rows[0]; current.cable_write_revision = String(current.cable_write_revision);
    await transact(async client => { expect(await readAutomaticPairOwnership(client, { projectId, cableId: row.id, currentSnapshot: current })).toEqual({ kind: 'policy', controlRevision: '1' }); });
    await edit(current, '/MANUAL');
    await transact(async client => { await expect(assertAutomaticRoutingControl(client, projectId, row.id, current)).rejects.toMatchObject({ code: 'ROUTING_PROTECTED' }); });
  });
  it('exposes queued work only after the manual save commits', async () => {
    const row = await seed();
    await transact(async client => {
      await applyCableRoutingControlInTransaction(client, { projectId, cableId: row.id, actorId, principal, before: row, after: row,
        automaticRouting: null, mutation: { kind: 'manual', routing: '/A' } });
      expect((await pool.query('SELECT * FROM pf_manual_route_jobs WHERE cable_id=$1', [row.id])).rowCount).toBe(0);
    });
    expect((await pool.query('SELECT * FROM pf_manual_route_jobs WHERE cable_id=$1', [row.id])).rowCount).toBe(1);
  });
  it('keeps an unchanged locked automatic route when an unrelated full-form save includes an empty manual field',async()=>{
    const row=await seed();await pool.query('UPDATE cables SET routing=$2 WHERE id=$1',[row.id,'/FROZEN_AUTO']);
    await pool.query('UPDATE cables SET tested=$2 WHERE id=$1',[row.id,'2026-11-15']);
    const result=await edit({...row,routing:'/FROZEN_AUTO',tested:'2026-11-15'},null,false);
    expect(result).toMatchObject({routing:'/FROZEN_AUTO',blockedReasons:[],control:{executionLocked:true,executionRouting:'/FROZEN_AUTO'}});
  });
  it('accepts a first execution report together with a route correction, then freezes that accepted route',async()=>{
    const row=await seed('/A');
    await transact(async client=>{
      const next={...row,routing:'/B',pull_date:'2026-11-15'};
      const result=await applyCableRoutingControlInTransaction(client,{projectId,cableId:row.id,actorId,principal,before:row,after:next,
        automaticRouting:null,mutation:{kind:'manual',routing:'/B',manualProtected:true}});
      expect(result.blockedReasons).toEqual([]);expect(result.control.executionLocked).toBe(false);
      await client.query('UPDATE cables SET routing=$2,pull_date=$3 WHERE id=$1',[row.id,result.routing,next.pull_date]);
    });
    expect((await readCableRoutingControl(pool,projectId,row.id))?.control).toMatchObject({manualRouting:'/B',executionLocked:true,executionRouting:'/B'});
    expect((await pool.query('SELECT reason FROM pf_cable_routing_events WHERE cable_id=$1 ORDER BY id',[row.id])).rows.map(row=>row.reason))
      .toEqual(['Cable routing edit','Execution facts recorded']);
    await expect(edit({...row,routing:'/B',pull_date:'2026-11-15'},'/C')).resolves.toMatchObject({routing:'/B',blockedReasons:['PULL_DATE_RECORDED']});
  });
  it('retains an unprotected automatic route during unrelated full-form edits and freezes it on a first date',async()=>{
    const row=await seed();await pool.query('UPDATE cables SET routing=$2 WHERE id=$1',[row.id,'/CURRENT_AUTO']);row.routing='/CURRENT_AUTO';
    await transact(async client=>{
      const after={...row,routing:null,delivery:'Received',pull_date:'2026-11-15'};
      const result=await applyCableRoutingControlInTransaction(client,{projectId,cableId:row.id,actorId,principal,before:row,after,
        automaticRouting:'/STALE_DISPLAY_VALUE',mutation:{kind:'manual',routing:null,manualProtected:false}});
      expect(result.routing).toBe('/CURRENT_AUTO');
      await client.query('UPDATE cables SET routing=$2,delivery=$3,pull_date=$4 WHERE id=$1',[row.id,result.routing,after.delivery,after.pull_date]);
    });
    expect((await readCableRoutingControl(pool,projectId,row.id))?.control).toMatchObject({manualRouting:null,manualProtected:false,executionLocked:true,executionRouting:'/CURRENT_AUTO'});
  });
  it('preserves unchanged legacy invalid text during an unrelated save so it remains explicitly correctable',async()=>{
    const row=await seed('/A\n/B');
    const result=await transact(client=>applyCableRoutingControlInTransaction(client,{projectId,cableId:row.id,actorId,principal,before:row,after:{...row,delivery:'Received'},
      automaticRouting:null,mutation:{kind:'manual',routing:'/A\n/B',manualProtected:true}}));
    expect(result).toMatchObject({routing:'/A\n/B',control:{manualRouting:'/A\n/B',manualProtected:true}});
  });
});
