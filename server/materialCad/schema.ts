import type { Pool } from 'pg';

/** Additive global Materials catalogue. Runs only behind the CAD PoC feature flag.
 * Existing trays remain the owner of curves/images/prices; only straight components
 * may link them. No project owns product identities or original STEP revisions.
 */
export async function initializeMaterialTrayCadSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-material-components-v1'))");
    await client.query(`
      -- Retain the original attachment table and IDs for old project references.
      CREATE TABLE IF NOT EXISTS material_tray_cad_assets (
        id UUID PRIMARY KEY,
        material_tray_id UUID NOT NULL REFERENCES material_trays(id) ON DELETE RESTRICT,
        part_number TEXT NOT NULL CHECK (length(trim(part_number)) BETWEEN 1 AND 200),
        component_kind TEXT NOT NULL CHECK (component_kind IN ('straight','bend','tee','reducer','connector','accessory','other')),
        revision INTEGER NOT NULL CHECK (revision > 0),
        original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
        source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
        source_bytes BIGINT NOT NULL CHECK (source_bytes BETWEEN 1 AND 8388608),
        source_object_key TEXT NOT NULL UNIQUE,
        mesh_object_key TEXT NOT NULL UNIQUE,
        mesh_metadata JSONB NOT NULL CHECK (jsonb_typeof(mesh_metadata) = 'object'),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (material_tray_id,part_number,revision), UNIQUE (material_tray_id,id)
      );
      CREATE TABLE IF NOT EXISTS material_product_families (
        id UUID PRIMARY KEY,
        manufacturer TEXT NOT NULL CHECK (length(trim(manufacturer)) BETWEEN 1 AND 200),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 240),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (id,manufacturer)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS material_product_family_identity
        ON material_product_families(lower(trim(manufacturer)),lower(trim(name)));
      CREATE TABLE IF NOT EXISTS material_components (
        id UUID PRIMARY KEY,
        family_id UUID NOT NULL,
        manufacturer TEXT NOT NULL,
        part_number TEXT NOT NULL CHECK (length(trim(part_number)) BETWEEN 1 AND 200),
        component_kind TEXT NOT NULL CHECK (component_kind IN ('straight','bend','tee','reducer','connector','accessory','other')),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
        material_tray_id UUID UNIQUE REFERENCES material_trays(id) ON DELETE RESTRICT,
        width_mm DOUBLE PRECISION CHECK (width_mm > 0 AND width_mm <= 1000000),
        height_mm DOUBLE PRECISION CHECK (height_mm > 0 AND height_mm <= 1000000),
        length_mm DOUBLE PRECISION CHECK (length_mm > 0 AND length_mm <= 1000000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        FOREIGN KEY (family_id,manufacturer) REFERENCES material_product_families(id,manufacturer) ON UPDATE CASCADE,
        CHECK (material_tray_id IS NULL OR component_kind='straight')
      );
      CREATE UNIQUE INDEX IF NOT EXISTS material_component_manufacturer_sku
        ON material_components(lower(trim(manufacturer)),lower(trim(part_number)));
      CREATE TABLE IF NOT EXISTS material_component_cad_assets (
        id UUID PRIMARY KEY,
        component_id UUID NOT NULL REFERENCES material_components(id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
        source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
        source_bytes BIGINT NOT NULL CHECK (source_bytes BETWEEN 1 AND 8388608),
        source_object_key TEXT NOT NULL UNIQUE,
        mesh_object_key TEXT NOT NULL UNIQUE,
        mesh_metadata JSONB NOT NULL CHECK (jsonb_typeof(mesh_metadata) = 'object'),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (component_id,revision), UNIQUE (component_id,id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS material_component_active_cad
        ON material_component_cad_assets(component_id) WHERE active;
      CREATE INDEX IF NOT EXISTS material_components_by_family ON material_components(family_id);

      -- tray_type is the existing tray catalogue identifier. The migration does not
      -- guess fitting SKUs or assign any fitting the straight product identity.
      INSERT INTO material_product_families(id,manufacturer,name)
        SELECT md5('wfc-material-family:'||id::text)::uuid,
               COALESCE(NULLIF(trim(manufacturer),''),'Unspecified'),
               'Imported tray: '||tray_type FROM material_trays
        ON CONFLICT (id) DO NOTHING;
      INSERT INTO material_components(id,family_id,manufacturer,part_number,component_kind,name,material_tray_id,width_mm,height_mm)
        SELECT id,md5('wfc-material-family:'||id::text)::uuid,
               COALESCE(NULLIF(trim(manufacturer),''),'Unspecified'),tray_type,'straight',tray_type,id,
               CASE WHEN width_mm>0 AND width_mm<=1000000 THEN width_mm ELSE NULL END,
               CASE WHEN height_mm>0 AND height_mm<=1000000 THEN height_mm ELSE NULL END
          FROM material_trays ON CONFLICT (id) DO NOTHING;

      -- Inconsistent historical kind/SKU data must be reviewed, never silently merged.
      DO $migration$ BEGIN
        IF EXISTS (SELECT 1 FROM material_tray_cad_assets GROUP BY material_tray_id,part_number
                    HAVING count(DISTINCT component_kind)>1) OR
           EXISTS (SELECT 1 FROM material_tray_cad_assets GROUP BY material_tray_id,lower(trim(part_number))
                    HAVING count(DISTINCT part_number)>1) OR
           EXISTS (SELECT 1 FROM material_tray_cad_assets a JOIN material_trays t ON t.id=a.material_tray_id
                    WHERE lower(trim(a.part_number))=lower(trim(t.tray_type)) AND a.component_kind<>'straight') THEN
          RAISE EXCEPTION 'Legacy CAD component kind conflicts with SKU; review Materials before migrating';
        END IF;
      END; $migration$;
      INSERT INTO material_components(id,family_id,manufacturer,part_number,component_kind,name)
        SELECT DISTINCT md5('wfc-material-component:'||a.material_tray_id::text||':'||a.part_number)::uuid,
               md5('wfc-material-family:'||a.material_tray_id::text)::uuid,
               COALESCE(NULLIF(trim(t.manufacturer),''),'Unspecified'),a.part_number,a.component_kind,a.part_number
          FROM material_tray_cad_assets a JOIN material_trays t ON t.id=a.material_tray_id
         WHERE lower(trim(a.part_number))<>lower(trim(t.tray_type))
        ON CONFLICT (id) DO NOTHING;
      INSERT INTO material_component_cad_assets
        (id,component_id,revision,original_filename,source_sha256,source_bytes,source_object_key,mesh_object_key,mesh_metadata,active,created_by,created_at)
        SELECT a.id,c.id,a.revision,a.original_filename,a.source_sha256,a.source_bytes,a.source_object_key,
               a.mesh_object_key,a.mesh_metadata,a.active,a.created_by,a.created_at
          FROM material_tray_cad_assets a JOIN material_trays t ON t.id=a.material_tray_id
          JOIN material_components c ON c.id=CASE WHEN lower(trim(a.part_number))=lower(trim(t.tray_type))
            THEN t.id ELSE md5('wfc-material-component:'||a.material_tray_id::text||':'||a.part_number)::uuid END
        ON CONFLICT (id) DO NOTHING;

      -- Keep new/edited legacy straight tray entries visible without a restart.
      CREATE OR REPLACE FUNCTION material_sync_straight_component() RETURNS TRIGGER
      LANGUAGE plpgsql AS $sync$ BEGIN
        INSERT INTO material_product_families(id,manufacturer,name)
          VALUES (md5('wfc-material-family:'||NEW.id::text)::uuid,
            COALESCE(NULLIF(trim(NEW.manufacturer),''),'Unspecified'),'Imported tray: '||NEW.tray_type)
          ON CONFLICT (id) DO UPDATE SET manufacturer=EXCLUDED.manufacturer,name=EXCLUDED.name;
        INSERT INTO material_components(id,family_id,manufacturer,part_number,component_kind,name,material_tray_id,width_mm,height_mm)
          VALUES (NEW.id,md5('wfc-material-family:'||NEW.id::text)::uuid,
            COALESCE(NULLIF(trim(NEW.manufacturer),''),'Unspecified'),NEW.tray_type,'straight',NEW.tray_type,NEW.id,
            CASE WHEN NEW.width_mm>0 AND NEW.width_mm<=1000000 THEN NEW.width_mm ELSE NULL END,
            CASE WHEN NEW.height_mm>0 AND NEW.height_mm<=1000000 THEN NEW.height_mm ELSE NULL END)
          ON CONFLICT (id) DO UPDATE SET part_number=EXCLUDED.part_number,name=EXCLUDED.name,
            width_mm=EXCLUDED.width_mm,height_mm=EXCLUDED.height_mm;
        RETURN NEW;
      END; $sync$;
      DROP TRIGGER IF EXISTS material_sync_straight_component ON material_trays;
      CREATE TRIGGER material_sync_straight_component AFTER INSERT OR UPDATE OF tray_type,manufacturer,width_mm,height_mm ON material_trays
        FOR EACH ROW EXECUTE FUNCTION material_sync_straight_component();

      -- Source bytes and revision identity cannot be altered after publication.
      CREATE OR REPLACE FUNCTION material_protect_cad_revision() RETURNS TRIGGER
      LANGUAGE plpgsql AS $guard$ BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CAD revisions must be retained' USING ERRCODE='23514'; END IF;
        IF (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') THEN
          RAISE EXCEPTION 'CAD revisions are immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $guard$;
      DROP TRIGGER IF EXISTS material_protect_cad_revision ON material_component_cad_assets;
      CREATE TRIGGER material_protect_cad_revision BEFORE UPDATE OR DELETE ON material_component_cad_assets
        FOR EACH ROW EXECUTE FUNCTION material_protect_cad_revision();
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
