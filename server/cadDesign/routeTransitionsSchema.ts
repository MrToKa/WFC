import type { Pool } from 'pg';

/** Installation joints are topology only; never fabricated fittings or STEP geometry. */
export async function initializeCadRouteTransitionsSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-cad-route-transitions-v1'))");
    await client.query(`
      -- Keep standalone source deletion forbidden while allowing all project
      -- children to disappear together during a parent cascade. Existing guard
      -- queries can flush immediate FK checks mid-cascade; enforce this pin at
      -- commit instead. A standalone catalogue DELETE still cannot commit.
      ALTER TABLE cad_design_instances ALTER CONSTRAINT cad_design_instances_project_id_catalog_item_id_fkey
        DEFERRABLE INITIALLY DEFERRED;
      CREATE UNIQUE INDEX IF NOT EXISTS cad_route_member_scoped_identity
        ON cad_route_group_members(project_id,design_id,route_group_id,instance_id);
      CREATE TABLE IF NOT EXISTS cad_route_transition_links (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL,
        design_id UUID NOT NULL,
        route_group_id UUID NOT NULL,
        source_instance_id UUID NOT NULL,
        source_port_name TEXT NOT NULL CHECK (source_port_name IN ('start','end')),
        target_instance_id UUID NOT NULL,
        target_port_name TEXT NOT NULL CHECK (target_port_name IN ('start','end')),
        kind TEXT NOT NULL DEFAULT 'routing-transition' CHECK (kind='routing-transition'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (source_instance_id<>target_instance_id),
        UNIQUE (project_id,design_id,source_instance_id,source_port_name),
        UNIQUE (project_id,design_id,target_instance_id,target_port_name),
        FOREIGN KEY (project_id,design_id,route_group_id)
          REFERENCES cad_route_groups(project_id,design_id,id) ON DELETE CASCADE,
        FOREIGN KEY (project_id,design_id,route_group_id,source_instance_id)
          REFERENCES cad_route_group_members(project_id,design_id,route_group_id,instance_id) ON DELETE CASCADE,
        FOREIGN KEY (project_id,design_id,route_group_id,target_instance_id)
          REFERENCES cad_route_group_members(project_id,design_id,route_group_id,instance_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS cad_route_transition_links_group
        ON cad_route_transition_links(project_id,design_id,route_group_id,id);

      CREATE OR REPLACE FUNCTION cad_protect_published_route_transition() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$
      DECLARE
        old_project UUID; old_design UUID; old_group UUID;
        new_project UUID; new_design UUID; new_group UUID;
      BEGIN
        IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
        IF TG_OP<>'INSERT' THEN old_project:=OLD.project_id; old_design:=OLD.design_id; old_group:=OLD.route_group_id; END IF;
        IF TG_OP<>'DELETE' THEN new_project:=NEW.project_id; new_design:=NEW.design_id; new_group:=NEW.route_group_id; END IF;
        -- Use the same design fence as physical connectors and publication.
        PERFORM 1 FROM cad_designs d WHERE (d.project_id=old_project AND d.id=old_design)
          OR (d.project_id=new_project AND d.id=new_design) ORDER BY d.project_id,d.id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM cad_route_groups g WHERE g.status='published' AND (
          (g.project_id=old_project AND g.design_id=old_design AND g.id=old_group) OR
          (g.project_id=new_project AND g.design_id=new_design AND g.id=new_group))) THEN
          RAISE EXCEPTION 'Withdraw the published CAD route before editing an installation transition' USING ERRCODE='23514';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END; $guard$;
      DROP TRIGGER IF EXISTS cad_protect_published_route_transition ON cad_route_transition_links;
      CREATE TRIGGER cad_protect_published_route_transition BEFORE INSERT OR UPDATE OR DELETE ON cad_route_transition_links
        FOR EACH ROW EXECUTE FUNCTION cad_protect_published_route_transition();

      CREATE OR REPLACE FUNCTION cad_check_transition_port_occupancy() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$ BEGIN
        PERFORM 1 FROM cad_designs WHERE project_id=NEW.project_id AND id=NEW.design_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM cad_route_transition_links t WHERE t.project_id=NEW.project_id AND t.design_id=NEW.design_id AND t.id<>NEW.id AND (
          (t.source_instance_id,t.source_port_name) IN ((NEW.source_instance_id,NEW.source_port_name),(NEW.target_instance_id,NEW.target_port_name)) OR
          (t.target_instance_id,t.target_port_name) IN ((NEW.source_instance_id,NEW.source_port_name),(NEW.target_instance_id,NEW.target_port_name))))
          OR EXISTS (SELECT 1 FROM cad_design_connections c
            JOIN cad_catalog_ports s ON s.project_id=c.project_id AND s.catalog_item_id=c.source_catalog_item_id AND s.id=c.source_port_id
            JOIN cad_catalog_ports t ON t.project_id=c.project_id AND t.catalog_item_id=c.target_catalog_item_id AND t.id=c.target_port_id
            WHERE c.project_id=NEW.project_id AND c.design_id=NEW.design_id AND (
              (c.source_instance_id,s.name) IN ((NEW.source_instance_id,NEW.source_port_name),(NEW.target_instance_id,NEW.target_port_name)) OR
              (c.target_instance_id,t.name) IN ((NEW.source_instance_id,NEW.source_port_name),(NEW.target_instance_id,NEW.target_port_name)))) THEN
          RAISE EXCEPTION 'A CAD port already participates in a physical connection or installation transition' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $guard$;
      DROP TRIGGER IF EXISTS cad_check_transition_port_occupancy ON cad_route_transition_links;
      CREATE TRIGGER cad_check_transition_port_occupancy BEFORE INSERT OR UPDATE ON cad_route_transition_links
        FOR EACH ROW EXECUTE FUNCTION cad_check_transition_port_occupancy();

      CREATE OR REPLACE FUNCTION cad_check_physical_transition_occupancy() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$
      DECLARE source_name TEXT; target_name TEXT;
      BEGIN
        PERFORM 1 FROM cad_designs WHERE project_id=NEW.project_id AND id=NEW.design_id FOR UPDATE;
        SELECT name INTO source_name FROM cad_catalog_ports WHERE project_id=NEW.project_id AND catalog_item_id=NEW.source_catalog_item_id AND id=NEW.source_port_id;
        SELECT name INTO target_name FROM cad_catalog_ports WHERE project_id=NEW.project_id AND catalog_item_id=NEW.target_catalog_item_id AND id=NEW.target_port_id;
        IF EXISTS (SELECT 1 FROM cad_route_transition_links t WHERE t.project_id=NEW.project_id AND t.design_id=NEW.design_id AND (
          (t.source_instance_id,t.source_port_name) IN ((NEW.source_instance_id,source_name),(NEW.target_instance_id,target_name)) OR
          (t.target_instance_id,t.target_port_name) IN ((NEW.source_instance_id,source_name),(NEW.target_instance_id,target_name)))) THEN
          RAISE EXCEPTION 'A CAD port already participates in an installation transition' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $guard$;
      DROP TRIGGER IF EXISTS cad_check_physical_transition_occupancy ON cad_design_connections;
      CREATE TRIGGER cad_check_physical_transition_occupancy BEFORE INSERT OR UPDATE ON cad_design_connections
        FOR EACH ROW EXECUTE FUNCTION cad_check_physical_transition_occupancy();

      -- A group cascade otherwise removes the parent before a child trigger can
      -- inspect its published state. Existing project teardown remains allowed.
      CREATE OR REPLACE FUNCTION cad_protect_published_transition_group() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$ BEGIN
        IF OLD.status='published' AND EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id)
          AND EXISTS (SELECT 1 FROM cad_route_transition_links t WHERE t.project_id=OLD.project_id AND t.design_id=OLD.design_id AND t.route_group_id=OLD.id) THEN
          RAISE EXCEPTION 'Withdraw the published CAD route before deleting its installation transitions' USING ERRCODE='23514';
        END IF;
        RETURN OLD;
      END; $guard$;
      DROP TRIGGER IF EXISTS cad_protect_published_transition_group ON cad_route_groups;
      CREATE TRIGGER cad_protect_published_transition_group BEFORE DELETE ON cad_route_groups
        FOR EACH ROW EXECUTE FUNCTION cad_protect_published_transition_group();

      DROP TRIGGER IF EXISTS cad_transition_revision_trigger ON cad_route_transition_links;
      CREATE TRIGGER cad_transition_revision_trigger AFTER INSERT OR UPDATE OR DELETE ON cad_route_transition_links
        FOR EACH ROW EXECUTE FUNCTION cad_touch_design_revision();
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
