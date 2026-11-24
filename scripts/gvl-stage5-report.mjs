// Stage 5 is an observation of WFC. Reading a report never enrolls work.
export const projectId = 'da667921-1f13-4c1d-9f87-063d127b98ce';
const normalize = text => text?.normalize('NFC').trim().toUpperCase() ?? '';
const keyById = rows => new Map(rows.map(row => [row.id, row]));
const preparationFields = ['aggregateId','artifactId','projectionSha256','captureFrameId','geometryRevision','traceId'];

function scopeChangeReason(original, current) {
  if (!current) return 'MODEL_SCOPE_UNAVAILABLE';
  if (current.modelVersionId !== original.modelVersionId || current.contentFingerprint !== original.contentFingerprint) {
    return 'MODEL_SCOPE_CHANGED';
  }
  // Selection revisions fence writes. Pilot evidence depends on the model and preparation it references.
  return preparationFields.some(field => current[field] !== original[field]) ? 'PREPARATION_SCOPE_CHANGED' : null;
}

export async function captureSnapshot(pool, project, repository) {
  if (project !== projectId) throw Error('GVL244_PROJECT_MISMATCH');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    // Repository readiness uses shared row locks for writers. MVCC pins this
    // read-only view, so remove just the trailing shared-lock clause.
    const readClient = {query(sql, args) {
      const read = sql.replace(/\s+FOR SHARE(?: OF [a-z_, ]+)?\s*$/i, '');
      if (!/^SELECT\s/i.test(read.trim()) || /;|\bFOR\s+(?:UPDATE|SHARE)\b/i.test(read)) throw Error('READ_ONLY_QUERY_REQUIRED');
      return client.query(read, args);
    }};
    const current = await repository.readCurrentEndpointBindingContext(readClient,project);
    const heads = await repository.readEndpointBindingHeads(readClient,project,current);
    const rows = async sql => (await client.query(sql,[project])).rows;
    const [meta] = await rows('SELECT transaction_timestamp() AS at, registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1');
    if (!meta) throw Error('GVL244_PROJECT_MISSING');
    const locations = await rows('SELECT id,name FROM pf_locations WHERE project_id=$1 ORDER BY id');
    const aliases = await rows('SELECT normalized_alias AS name,location_id AS id FROM pf_location_aliases WHERE project_id=$1');
    const cables = await rows(`SELECT c.id,c.tag,c.from_location AS "from",c.to_location AS "to",c.routing,c.mto,
      coalesce(k.manual_protected,false) AS manual,coalesce(k.execution_locked,false) AS locked
      FROM cables c LEFT JOIN pf_cable_routing_controls k ON k.project_id=c.project_id AND k.cable_id=c.id
      WHERE c.project_id=$1 ORDER BY c.tag,c.id`);
    const receipts = await rows(`SELECT c.idempotency_key AS "receiptId", c.actor_id AS "actorId",
      r.location_id AS "locationId",r.id AS "bindingId",i.id AS "impactId",e.job_id AS "jobId",j.state AS "jobStatus",d.status AS "dispatchStatus"
      FROM pf_endpoint_binding_commands c
      JOIN pf_location_impacts i ON i.project_id=c.project_id AND i.id::text=c.receipt#>>'{receipt,locationImpact,id}'
        AND i.actor_id=c.actor_id AND i.idempotency_key=c.idempotency_key AND i.command_sha256=c.receipt#>>'{receipt,commandSha256}'
      JOIN pf_endpoint_binding_revisions r ON r.project_id=c.project_id AND r.id::text=c.receipt#>>'{receipt,binding,binding,id}'
        AND r.record_sha256=c.receipt#>>'{receipt,binding,binding,contentSha256}' AND r.location_id::text=c.receipt#>>'{receipt,locationId}'
      LEFT JOIN pf_location_impact_enrollments e ON e.project_id=i.project_id AND e.impact_id=i.id
      LEFT JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id
      LEFT JOIN pf_location_impact_dispatch d ON d.project_id=i.project_id AND d.impact_id=i.id
      WHERE c.project_id=$1 AND c.kind='confirm' AND c.receipt->>'status'='saved'
        AND left(c.request#>>'{command,reason}',length('GVL244 stage4 405440ad'))='GVL244 stage4 405440ad'`);
    const latestJobs = await rows(`SELECT DISTINCT ON (i.cable_id) i.cable_id AS id,j.id AS "jobId",i.status,i.message,
      j.created_at AS at FROM pf_job_items i JOIN pf_jobs j ON j.project_id=i.project_id AND j.id=i.job_id
      WHERE i.project_id=$1 ORDER BY i.cable_id,j.created_at DESC,j.id DESC`);
    await client.query('COMMIT');
    return {projectId:project, capturedAt:new Date(meta.at).toISOString(),registryRevision:meta.revision,
      current,locations:locations.map(location=>{
        const head=heads.get(location.id);
        return {...location,bindingId:head?.binding.id??null,bindingStatus:head?.binding.status??'missing',ready:head?.ready===true};
      }),aliases,cables,receipts,latestJobs};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}

const actions = {
  SHARED_NAME_MULTIPLE_CABLE_LOOPS:'Сверете засегнатите кабели и контури по клемната или кабелната схема.',
  NO_OWN_TAG_OR_PROVEN_PARENT:'Потвърдете тага на оборудването или приложете схема, която свързва сигнала с него.',
  DOCUMENT_RELATION_NEEDS_REVIEW:'Проверете графичната връзка между сигнала и предложеното оборудване на посочената страница.',
  DOCUMENT_PARENT_NOT_IN_MODEL:'Сверете означението на оборудването от документа с тага му в актуалния 3D модел.',
  MODEL_TAG_QUESTION_MARK:'Проверете маркирания като несигурен таг и потвърдете правилния моделен обект.',
  OBSOLETE_BINDING:'Проверете отново обекта и точката в текущия модел.',
  MODEL_SCOPE_CHANGED:'Повторете търсенето в индекса на текущия модел.',
  PREPARATION_SCOPE_CHANGED:'Проверете локацията спрямо текущата подготовка за маршрутизиране.',
  MODEL_SCOPE_UNAVAILABLE:'Проверете дали има активен модел с налична подготовка за маршрутизиране.',
  BINDING_MISSING:'Потвърдете обекта за тази локация в текущия модел.'
};

export function buildReport(baseline, snapshot) {
  if (baseline.projectId!==projectId || snapshot.projectId!==projectId) throw Error('GVL244_PROJECT_MISMATCH');
  const scopeReason=scopeChangeReason(baseline.current,snapshot.current);
  const currentScope=scopeReason===null;
  const locations=keyById(snapshot.locations), prior=keyById(baseline.locations);
  const source=new Map(baseline.evidence.map(row=>[row.locationId,row]));
  const receipts=new Map(snapshot.receipts.map(r=>[r.impactId,r]));
  if(receipts.size !== snapshot.receipts.length) throw Error('DUPLICATE_ASSIGNMENT_RECEIPT');
  const names=new Map(), groups=new Map(), changedNames=[], originalCables=keyById(baseline.cables);
  for(const entry of [...snapshot.locations,...snapshot.aliases]) {
    const key=normalize(entry.name);
    if(names.has(key)&&names.get(key)!==entry.id) throw Error('CONFLICTING_LOCATION_ALIASES');
    names.set(key,entry.id);
  }
  const jobs=keyById(snapshot.latestJobs), routingBlocked=[];
  let blankSides=0,routed=0,manualProtected=0;
  for(const cable of snapshot.cables){
    const before=originalCables.get(cable.id);
    if(before&&(before.tag!==cable.tag || before.from!==cable.from || before.to!==cable.to)) changedNames.push(cable.id);
    const missing=[];
    for(const side of ['from','to']){
      const name=cable[side], normalized=normalize(name);
      if(!normalized){missing.push(side);blankSides++;continue;}
      const locationId=names.get(normalized)??null, key=locationId??'unregistered:'+normalized;
      if(!groups.has(key))groups.set(key,{locationId,name:locations.get(locationId)?.name??name,cables:[]});
      groups.get(key).cables.push({id:cable.id,tag:cable.tag,side});
      if(!locations.get(locationId)?.ready)missing.push(side);
    }
    if(cable.manual)manualProtected++;
    if(cable.routing?.trim()) {routed++;continue;}
    const job=jobs.get(cable.id);
    const reason=missing.length?'Липсва валидна локация ('+missing.join(', ')+').'
      :cable.manual?'Маршрутът е защитен ръчно.':cable.locked?'Маршрутът е заключен за изпълнение.'
      :'Няма записан маршрут.';
    routingBlocked.push({id:cable.id,tag:cable.tag,from:cable.from,to:cable.to,reason,
      latestJobId:job?.jobId??null,latestJobStatus:job?.status??null,latestJobMessage:job?.message??null});
  }
  const unresolved=[], assigned=[], audit=[], counts={preserved:0,otherReady:0};
  for(const row of baseline.evidence.filter(row=>row.method)){
    const receipt=receipts.get(row.impactId),head=locations.get(row.locationId);
    const verified=!!receipt && receipt.bindingId===row.bindingId && receipt.locationId===row.locationId;
    const status=verified&&currentScope&&head?.ready&&head.bindingId===receipt.bindingId?'assigned'
      :!verified?'unverified':!currentScope?'changed-scope':'superseded';
    const entry={locationId:row.locationId,name:row.name,bindingId:row.bindingId,receiptId:verified?receipt.receiptId:null,
      impactId:row.impactId??null,jobId:verified?receipt.jobId:null,jobStatus:verified?receipt.jobStatus:null,dispatchStatus:verified?receipt.dispatchStatus:null,objectIds:row.objectIds,evidence:row.method,
      equipmentTag:row.equipmentTag,documents:row.documents,status};
    audit.push(entry);
    if(status==='assigned'&&groups.has(row.locationId))assigned.push(entry);
  }
  const assignedIds=new Set(assigned.map(e=>e.locationId));
  for(const group of groups.values()){
    const loc=locations.get(group.locationId), evidence=source.get(group.locationId);
    if(loc?.ready){
      if(!assignedIds.has(loc.id)){
        if(prior.get(loc.id)?.bindingId===loc.bindingId)counts.preserved++;
        else counts.otherReady++;
      }
      continue;
    }
    const obsolete=!!loc?.bindingId&&['confirmed','stale'].includes(loc.bindingStatus);
    const reason=scopeReason??(obsolete?'OBSOLETE_BINDING':evidence?.reason??'BINDING_MISSING');
    unresolved.push({...group,status:obsolete?'obsolete':!currentScope?'recheck':evidence?.status==='not-found'?'not-found':'review',
      reason,nextAction:actions[reason]??actions.BINDING_MISSING,candidates:currentScope?evidence?.candidates??[]:[],
      documents:evidence?.documents??[],conflictingCableLoops:evidence?.conflictingCableLoops??[]});
  }
  const nowIds=new Set(snapshot.cables.map(c=>c.id));
  return {schemaVersion:'wfc.gvl244.stage5.v1',projectId,capturedAt:snapshot.capturedAt,
    modelLabel:currentScope||scopeReason==='PREPARATION_SCOPE_CHANGED'?baseline.modelLabel:snapshot.current?.modelVersionId??'Липсва готов модел за маршрутизиране',
    scopeStatus:currentScope?'current':'changed',
    summary:{locations:groups.size,assigned:assigned.length,preserved:counts.preserved,otherReady:counts.otherReady,unresolved:unresolved.length,
      cables:snapshot.cables.length,routed,unrouted:routingBlocked.length,manualProtected,changedTags:changedNames.length,blankSides},
    unresolved,assigned,audit,routingBlocked,provenance:{pilotSha256:baseline.resultsSha256,baselineCapturedAt:baseline.capturedAt,
      current:snapshot.current,registryRevision:snapshot.registryRevision,originalModel:baseline.current,
      renamedOrRetaggedCableIds:changedNames,addedCables:snapshot.cables.filter(c=>!originalCables.has(c.id)).length,
      removedCables:baseline.cables.filter(c=>!nowIds.has(c.id)).length}};
}
