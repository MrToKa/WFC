import type { Pool } from 'pg';

/** Publication replacements retain their exact previous proof without nesting it. */
export async function initializeCadNetworkPreparationSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS cad_route_network_publication_history (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    design_id UUID NOT NULL,
    route_group_id UUID NOT NULL,
    previous_revision INTEGER NOT NULL CHECK(previous_revision>0),
    base_artifact_id UUID NOT NULL,
    previous_publication JSONB,
    publication JSONB NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id,route_group_id,previous_revision),
    FOREIGN KEY(project_id,design_id,route_group_id)
      REFERENCES cad_route_groups(project_id,design_id,id) ON DELETE CASCADE
  );
  CREATE OR REPLACE FUNCTION protect_cad_route_network_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM cad_route_groups WHERE project_id=OLD.project_id AND id=OLD.route_group_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'CAD network publication history is immutable'; END $$;
  DROP TRIGGER IF EXISTS cad_route_network_history_immutable ON cad_route_network_publication_history;
  CREATE TRIGGER cad_route_network_history_immutable BEFORE UPDATE OR DELETE ON cad_route_network_publication_history
    FOR EACH ROW EXECUTE FUNCTION protect_cad_route_network_history();`);
}
