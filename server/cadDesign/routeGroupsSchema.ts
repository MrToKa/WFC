import type { Pool } from 'pg';

/** Route groups own proposal metadata, never source SVF identities. */
export async function initializeCadRouteGroupsSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-cad-route-groups-v1'))");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS cad_design_instance_scoped_identity
        ON cad_design_instances(project_id,design_id,id);
      CREATE UNIQUE INDEX IF NOT EXISTS cad_route_project_tray_identity ON trays(project_id,id);
      CREATE TABLE IF NOT EXISTS cad_route_groups (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        design_id UUID NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
        tag TEXT NOT NULL CHECK (tag ~ '^[A-Z0-9][A-Z0-9_.-]{0,199}$' AND tag<>'SECONDARY'),
        color TEXT NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
        purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 500),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        project_tray_id UUID,
        publication JSONB,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (project_id,id), UNIQUE (project_id,design_id,id),
        UNIQUE (project_id,tag),
        FOREIGN KEY (project_id,design_id) REFERENCES cad_designs(project_id,id) ON DELETE CASCADE,
        CONSTRAINT cad_route_groups_project_tray_fk FOREIGN KEY (project_id,project_tray_id)
          REFERENCES trays(project_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE,
        CONSTRAINT cad_route_groups_publication_state_check CHECK ((status='draft' AND project_tray_id IS NULL AND (publication IS NULL OR jsonb_typeof(publication)='object')) OR
               (status='published' AND project_tray_id IS NOT NULL AND publication IS NOT NULL AND jsonb_typeof(publication)='object'))
      );
      -- Earlier PoC drafts required publication=NULL. Retired overlay proofs
      -- remain as audit evidence without keeping a generated tray in the catalog.
      ALTER TABLE cad_route_groups DROP CONSTRAINT IF EXISTS cad_route_groups_check;
      ALTER TABLE cad_route_groups DROP CONSTRAINT IF EXISTS cad_route_groups_publication_state_check;
      ALTER TABLE cad_route_groups ADD CONSTRAINT cad_route_groups_publication_state_check
        CHECK ((status='draft' AND project_tray_id IS NULL AND (publication IS NULL OR jsonb_typeof(publication)='object')) OR
               (status='published' AND project_tray_id IS NOT NULL AND publication IS NOT NULL AND jsonb_typeof(publication)='object'));
      ALTER TABLE cad_route_groups DROP CONSTRAINT IF EXISTS cad_route_groups_project_id_project_tray_id_fkey;
      ALTER TABLE cad_route_groups DROP CONSTRAINT IF EXISTS cad_route_groups_project_tray_fk;
      ALTER TABLE cad_route_groups ADD CONSTRAINT cad_route_groups_project_tray_fk
        FOREIGN KEY (project_id,project_tray_id) REFERENCES trays(project_id,id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
      CREATE TABLE IF NOT EXISTS cad_route_group_members (
        project_id UUID NOT NULL,
        design_id UUID NOT NULL,
        route_group_id UUID NOT NULL,
        instance_id UUID NOT NULL,
        PRIMARY KEY (route_group_id,instance_id),
        UNIQUE (project_id,instance_id),
        FOREIGN KEY (project_id,design_id,route_group_id)
          REFERENCES cad_route_groups(project_id,design_id,id) ON DELETE CASCADE,
        CONSTRAINT cad_route_group_members_instance_fk FOREIGN KEY (project_id,design_id,instance_id)
          REFERENCES cad_design_instances(project_id,design_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE
      );
      -- Keep standalone deletes checked at statement end, while allowing all
      -- new route records to disappear together during an existing parent cascade.
      ALTER TABLE cad_route_group_members DROP CONSTRAINT IF EXISTS cad_route_group_members_project_id_design_id_instance_id_fkey;
      ALTER TABLE cad_route_group_members DROP CONSTRAINT IF EXISTS cad_route_group_members_instance_fk;
      ALTER TABLE cad_route_group_members ADD CONSTRAINT cad_route_group_members_instance_fk
        FOREIGN KEY (project_id,design_id,instance_id) REFERENCES cad_design_instances(project_id,design_id,id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
      CREATE INDEX IF NOT EXISTS cad_route_groups_design ON cad_route_groups(project_id,design_id,created_at,id);

      -- An instance published into routing is immutable until explicit withdrawal.
      CREATE OR REPLACE FUNCTION cad_protect_published_route_instance() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$ BEGIN
        IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
        -- Fence legacy instance writers before inspecting publication status.
        PERFORM 1 FROM cad_designs WHERE project_id=OLD.project_id AND id=OLD.design_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM cad_route_group_members m JOIN cad_route_groups g
            ON g.project_id=m.project_id AND g.id=m.route_group_id
          WHERE m.project_id=OLD.project_id AND m.design_id=OLD.design_id AND m.instance_id=OLD.id AND g.status='published') THEN
          RAISE EXCEPTION 'Withdraw the published CAD route before editing a member' USING ERRCODE='23514';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END; $guard$;
      DROP TRIGGER IF EXISTS cad_protect_published_route_instance ON cad_design_instances;
      CREATE TRIGGER cad_protect_published_route_instance BEFORE UPDATE OR DELETE ON cad_design_instances
        FOR EACH ROW EXECUTE FUNCTION cad_protect_published_route_instance();

      -- Both ends of a connector relationship participate in routing topology.
      -- Fence ordinary connector writes as well as the route publication APIs.
      CREATE OR REPLACE FUNCTION cad_protect_published_route_connection() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$
      DECLARE
        old_project UUID; old_design UUID; old_source UUID; old_target UUID;
        new_project UUID; new_design UUID; new_source UUID; new_target UUID;
      BEGIN
        IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
        IF TG_OP<>'INSERT' THEN
          old_project:=OLD.project_id; old_design:=OLD.design_id;
          old_source:=OLD.source_instance_id; old_target:=OLD.target_instance_id;
        END IF;
        IF TG_OP<>'DELETE' THEN
          new_project:=NEW.project_id; new_design:=NEW.design_id;
          new_source:=NEW.source_instance_id; new_target:=NEW.target_instance_id;
        END IF;
        PERFORM 1 FROM cad_designs d
          WHERE (d.project_id=old_project AND d.id=old_design) OR (d.project_id=new_project AND d.id=new_design)
          ORDER BY d.project_id,d.id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM cad_route_group_members m JOIN cad_route_groups g
            ON g.project_id=m.project_id AND g.id=m.route_group_id
          WHERE g.status='published' AND (
            (m.project_id=old_project AND m.design_id=old_design AND m.instance_id=ANY(ARRAY[old_source,old_target])) OR
            (m.project_id=new_project AND m.design_id=new_design AND m.instance_id=ANY(ARRAY[new_source,new_target]))
          )) THEN
          RAISE EXCEPTION 'Withdraw the published CAD route before editing a connection' USING ERRCODE='23514';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END; $guard$;
      DROP TRIGGER IF EXISTS cad_protect_published_route_connection ON cad_design_connections;
      CREATE TRIGGER cad_protect_published_route_connection BEFORE INSERT OR UPDATE OR DELETE ON cad_design_connections
        FOR EACH ROW EXECUTE FUNCTION cad_protect_published_route_connection();
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}


