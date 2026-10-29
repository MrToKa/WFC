-- Run only in the separately owned WFC PathFinder local database. Entire fixture rolls back.
BEGIN;
DO $$
DECLARE project_a uuid := gen_random_uuid(); project_b uuid := gen_random_uuid(); actor uuid := gen_random_uuid();
  cable_type uuid := gen_random_uuid(); cable uuid := gen_random_uuid(); location_a uuid := gen_random_uuid(); location_b uuid := gen_random_uuid();
  current_revision bigint; accepted boolean;
BEGIN
  IF current_database() <> 'wfc_pathfinder_local' THEN RAISE EXCEPTION 'Isolated PF database required'; END IF;
  INSERT INTO users(id,email,password_hash,is_admin,role) VALUES(actor,actor::text || '@pf-sql-fixture.invalid','No login credential; rolled back fixture',true,'admin');
  INSERT INTO projects(id,project_number,name,customer) VALUES(project_a,'PF3-A-' || project_a,'PF3 SQL fixture','Isolated'),(project_b,'PF3-B-' || project_b,'PF3 SQL fixture','Isolated');
  IF (SELECT count(*) FROM pf_project_state WHERE project_id IN(project_a,project_b)) <> 2 THEN RAISE EXCEPTION 'New project state trigger failed'; END IF;
  INSERT INTO cable_types(id,project_id,name) VALUES(cable_type,project_a,'PF3 fixture type');
  INSERT INTO cables(id,project_id,cable_id,cable_type_id,from_location,to_location,routing,design_length,install_length,cable_write_revision)
    VALUES(cable,project_a,1,cable_type,'=A001','=B001','/A',10,33,999);
  SELECT cable_write_revision INTO current_revision FROM cables WHERE id=cable;
  IF current_revision <> 0 THEN RAISE EXCEPTION 'Client controlled initial write revision'; END IF;
  UPDATE cables SET routing='/B',design_length=11,cable_write_revision=999 WHERE id=cable;
  UPDATE cables SET routing='/A',design_length=10,cable_write_revision=0 WHERE id=cable;
  SELECT cable_write_revision INTO current_revision FROM cables WHERE id=cable;
  IF current_revision <> 2 THEN RAISE EXCEPTION 'A to B to A was not detected'; END IF;
  UPDATE cables SET cable_write_revision=999,updated_at=NOW() WHERE id=cable;
  IF (SELECT cable_write_revision FROM cables WHERE id=cable) <> 2 THEN RAISE EXCEPTION 'Client spoofed revision-only write'; END IF;
  UPDATE cables SET from_location='=A002' WHERE id=cable;
  IF (SELECT cable_write_revision FROM cables WHERE id=cable) <> 3 THEN RAISE EXCEPTION 'Endpoint change was not detected'; END IF;
  UPDATE cables SET materials_initialized=true,change_log='[]'::jsonb WHERE id=cable;
  IF (SELECT cable_write_revision FROM cables WHERE id=cable) <> 3 THEN RAISE EXCEPTION 'Material bookkeeping changed cable write revision'; END IF;
  IF (SELECT install_length FROM cables WHERE id=cable) <> 33 THEN RAISE EXCEPTION 'Installation length was changed'; END IF;
  INSERT INTO pf_locations(id,project_id,name,created_by) VALUES(location_a,project_a,'=A001',actor),(location_b,project_b,'=A001',actor);
  INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES(project_a,'=A001','=A001',location_a),(project_b,'=A001','=A001',location_b);
  accepted := false;
  BEGIN
    INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES(project_a,'=A001','duplicate',location_a);
    accepted := true;
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF accepted THEN RAISE EXCEPTION 'Duplicate project alias was accepted'; END IF;
  accepted := false;
  BEGIN
    INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES(project_a,'=C001','cross project',location_b);
    accepted := true;
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF accepted THEN RAISE EXCEPTION 'Cross-project alias was accepted'; END IF;
  RAISE NOTICE 'PASS: 10 isolated registry/revision SQL assertions; all fixture rows rolled back';
END $$;
ROLLBACK;
