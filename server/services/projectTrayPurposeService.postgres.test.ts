// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, type Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { PURPOSE_POLICY_SCHEMA_SQL } from '../pathfinder/policySchema.js';
import { changeProjectTrayPurpose, initializeProjectTrayPurposeSchema, listProjectTrayPurposes } from './projectTrayPurposeService.js';

const databaseUrl = process.env.WFC_TRAY_PURPOSE_TEST_DATABASE_URL ?? process.env.WFC_TRAY_LENGTH_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('project tray purpose CRUD against dedicated PostgreSQL', () => {
  it('preserves active permissions, Word mappings and project isolation through real incarnation triggers', async () => {
    if (!['/wfc_tray_purpose_test', '/wfc_tray_auto_length_test'].includes(new URL(databaseUrl!).pathname)) throw new Error('Use a dedicated wfc_tray_purpose_test or wfc_tray_auto_length_test database.');
    const schema = 'purpose_' + randomUUID().replaceAll('-', '');
    const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    await db.connect();
    try {
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.query("SELECT set_config('search_path',$1,false)", [schema]);
      await db.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
        CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean,role text);
        CREATE TABLE user_project_access(user_id uuid,project_id uuid,PRIMARY KEY(user_id,project_id));
        CREATE TABLE trays(id uuid PRIMARY KEY,project_id uuid,name text,purpose text,updated_at timestamptz,
          tray_type text,width_mm numeric,height_mm numeric,length_mm numeric,length_source text,length_calculation jsonb,
          include_grounding_cable boolean,grounding_cable_type_id uuid,use_trefoil_clamps boolean,trefoil_clamp_spacing_mm numeric);
        CREATE TABLE project_tray_purpose_templates(project_id uuid,tray_purpose text,project_file_id uuid,updated_at timestamptz,
          PRIMARY KEY(project_id,tray_purpose));`);
      await db.query(PURPOSE_POLICY_SCHEMA_SQL);
      for (const [file, table] of [['purposePolicy.js', 'pf_routing_purpose_rules'], ['drawingPolicy.js', 'pf_drawing_purpose_rules']]) {
        const source = readFileSync(new URL('../pathfinder/' + file.replace('.js', '.ts'), import.meta.url), 'utf8');
        const definition = source.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\s*\\([\\s\\S]*?;'))?.[0];
        if (!definition) throw new Error('Production purpose rule migration not found.');
        await db.query(definition);
      }
      const project = randomUUID(), other = randomUUID(), admin = randomUUID(), engineer = randomUUID(), outsider = randomUUID(), template = randomUUID();
      await db.query('INSERT INTO projects VALUES($1),($2)', [project, other]);
      await db.query("INSERT INTO users VALUES($1,true,'admin'),($2,false,'engineer'),($3,false,'engineer')", [admin, engineer, outsider]);
      await db.query('INSERT INTO user_project_access VALUES($1,$2)', [engineer, project]);
      await db.query('INSERT INTO user_project_access VALUES($1,$2)', [outsider, other]);
      await db.query("INSERT INTO trays(id,project_id,name,purpose) VALUES($1,$2,'B001','Power'),($3,$2,'B002','Power'),($4,$5,'Other','Power')", [randomUUID(), project, randomUUID(), randomUUID(), other]);
      await db.query("INSERT INTO project_tray_purpose_templates VALUES($1,'Power',$2,now()),($1,'Template only',$2,now())", [project, template]);
      const migrationPool = { connect: async () => ({ query: db.query.bind(db), release() {} }) } as unknown as Pool;
      await initializeProjectTrayPurposeSchema(migrationPool);
      await initializeProjectTrayPurposeSchema(migrationPool);
      const old = (await db.query('SELECT incarnation_id FROM pf_catalog_purpose_incarnations WHERE project_id=$1 AND active', [project])).rows[0].incarnation_id;
      await db.query("INSERT INTO pf_routing_purpose_rules VALUES($1,'Power',$2,'[\"Control\",\"Power\"]')", [project, old]);
      const modes = { mv: 'left', power: 'right', control: 'left', vfd: 'right' };
      await db.query("INSERT INTO pf_drawing_purpose_rules VALUES($1,'Power',$2,$3)", [project, old, modes]);
      const transaction = async (actor: string, command: Parameters<typeof changeProjectTrayPurpose>[3]) => {
        await db.query('BEGIN');
        try { const result = await changeProjectTrayPurpose(db as unknown as PoolClient, project, actor, command); await db.query('COMMIT'); return result; }
        catch (error) { await db.query('ROLLBACK'); throw error; }
      };
      await expect(transaction(outsider, { operation: 'rename', name: 'Power', nextName: 'LV' })).rejects.toMatchObject({ status: 403 });
      await db.query("UPDATE users SET role='technician' WHERE id=$1", [engineer]);
      await expect(transaction(engineer, { operation: 'rename', name: 'Power', nextName: 'LV' })).rejects.toMatchObject({ status: 403 });
      await db.query("UPDATE users SET role='engineer' WHERE id=$1", [engineer]);
      await expect(transaction(randomUUID(), { operation: 'create', name: 'No account' })).rejects.toMatchObject({ status: 401 });
      await transaction(engineer, { operation: 'rename', name: 'Power', nextName: 'LV' });
      expect((await db.query('SELECT purpose FROM trays WHERE project_id=$1', [project])).rows).toEqual([{ purpose: 'LV' }, { purpose: 'LV' }]);
      expect((await db.query('SELECT purpose FROM trays WHERE project_id=$1', [other])).rows).toEqual([{ purpose: 'Power' }]);
      expect((await db.query("SELECT project_file_id FROM project_tray_purpose_templates WHERE project_id=$1 AND tray_purpose='LV'", [project])).rows[0].project_file_id).toBe(template);
      expect((await db.query("SELECT r.allowed_categories FROM pf_routing_purpose_rules r JOIN pf_catalog_purpose_incarnations i USING(project_id,purpose_key) WHERE r.project_id=$1 AND i.active AND r.purpose_incarnation_id=i.incarnation_id", [project])).rows).toEqual([{ allowed_categories: ['Control', 'Power'] }]);
      expect((await db.query("SELECT r.category_modes FROM pf_drawing_purpose_rules r JOIN pf_catalog_purpose_incarnations i USING(project_id,purpose_key) WHERE r.project_id=$1 AND i.active AND r.purpose_incarnation_id=i.incarnation_id", [project])).rows).toEqual([{ category_modes: modes }]);
      expect((await db.query('SELECT active FROM pf_catalog_purpose_incarnations WHERE incarnation_id=$1', [old])).rows[0].active).toBe(false);
      expect((await listProjectTrayPurposes(db as unknown as PoolClient, project)).purposes).toEqual([{ name: 'LV', trayCount: 2 }, { name: 'Template only', trayCount: 0 }]);
      await expect(transaction(admin, { operation: 'delete', name: 'LV' })).rejects.toMatchObject({ code: 'TRAY_PURPOSE_IN_USE' });
      // Ordinary import/edit retains the previous catalog name after its last tray leaves.
      await db.query("UPDATE trays SET purpose='Imported' WHERE project_id=$1", [project]);
      expect((await listProjectTrayPurposes(db as unknown as PoolClient, project)).purposes).toContainEqual({ name: 'LV', trayCount: 0 });
      await transaction(admin, { operation: 'delete', name: 'LV' });
      expect((await listProjectTrayPurposes(db as unknown as PoolClient, project)).purposes).not.toContainEqual({ name: 'LV', trayCount: 0 });
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.end();
    }
  });
});
