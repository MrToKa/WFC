-- Root executes only in the separately owned demonstration database. Entire fixture rolls back.
BEGIN;
DO $$
DECLARE pid uuid:=gen_random_uuid();tid uuid:=gen_random_uuid();before_cr bigint;before_dr bigint;first_epoch uuid;next_epoch uuid;rev bigint;
BEGIN
 IF current_database()<>'wfc_pathfinder_local' THEN RAISE EXCEPTION 'Owned PF database required';END IF;
 INSERT INTO projects(id,project_number,name,customer) VALUES(pid,'PF-R2-'||pid,'Purpose SQL fixture','Synthetic rollback');
 SELECT catalog_revision,drawing_input_revision INTO before_cr,before_dr FROM pf_purpose_project_state WHERE project_id=pid;
 INSERT INTO trays(id,project_id,name,purpose,length_mm) VALUES(tid,pid,'R2-TRAY','Shared',100);
 IF(SELECT catalog_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_cr+1 THEN RAISE EXCEPTION 'Insert routing revision missing';END IF;
 SELECT incarnation_id INTO first_epoch FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND purpose_key='Shared' AND active;
 SELECT catalog_revision,drawing_input_revision INTO before_cr,before_dr FROM pf_purpose_project_state WHERE project_id=pid;
 UPDATE trays SET length_mm=200,include_grounding_cable=true,use_trefoil_clamps=true WHERE id=tid;
 IF(SELECT catalog_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_cr OR(SELECT drawing_input_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_dr+1 THEN RAISE EXCEPTION 'Drawing mutation crossed routing domain';END IF;
 SELECT drawing_input_revision INTO before_dr FROM pf_purpose_project_state WHERE project_id=pid;
 UPDATE trays SET updated_at=clock_timestamp(),change_log='[]'::jsonb WHERE id=tid;
 IF(SELECT catalog_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_cr OR(SELECT drawing_input_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_dr THEN RAISE EXCEPTION 'Timestamp/log bumped catalog';END IF;
 UPDATE trays SET purpose='Other' WHERE id=tid;UPDATE trays SET purpose='Shared' WHERE id=tid;
 SELECT incarnation_id INTO next_epoch FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND purpose_key='Shared' AND active;
 IF next_epoch=first_epoch OR EXISTS(SELECT 1 FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND incarnation_id=first_epoch AND active) THEN RAISE EXCEPTION 'ABA revived purpose incarnation';END IF;
 IF(SELECT catalog_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_cr+2 THEN RAISE EXCEPTION 'ABA revision was lost';END IF;
 SELECT catalog_revision INTO before_cr FROM pf_purpose_project_state WHERE project_id=pid;
 BEGIN UPDATE trays SET name='Rollback-name' WHERE id=tid;RAISE EXCEPTION 'rollback-control';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'rollback-control' THEN RAISE;END IF;END;
 IF(SELECT catalog_revision FROM pf_purpose_project_state WHERE project_id=pid)<>before_cr THEN RAISE EXCEPTION 'Rolled back revision survived';END IF;
 UPDATE trays SET purpose=U&'\00A0Cafe\0301\FEFF' WHERE id=tid;
 IF NOT EXISTS(SELECT 1 FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND purpose_key=U&'Caf\00E9' AND active) THEN RAISE EXCEPTION 'SQL NFC/ECMAScript trim mismatch';END IF;
 DELETE FROM trays WHERE project_id=pid;
 IF EXISTS(SELECT 1 FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND active) THEN RAISE EXCEPTION 'Project clear retained active purpose';END IF;
 INSERT INTO trays(id,project_id,name,purpose) VALUES(tid,pid,'Readded','Shared');
 IF EXISTS(SELECT 1 FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND incarnation_id=first_epoch AND active) THEN RAISE EXCEPTION 'Delete/re-add revived purpose';END IF;
 IF(SELECT routing_policy_revision FROM pf_purpose_project_state WHERE project_id=pid)<>0 THEN RAISE EXCEPTION 'Catalog trigger invented policy save';END IF;
END $$;
ROLLBACK;
