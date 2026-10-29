// Read-only public-schema adjunct. No execution on import and no cluster/auth-row claims.
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const order = (a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b));
const quote = value => '"'+value.replaceAll('"','""')+'"';
const acl = (expression,kind,owner) => `COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'grantor',g.rolname,'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,
 'privilege',x.privilege_type,'isGrantable',x.is_grantable)
 ORDER BY g.rolname COLLATE "C",(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END) COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable)
 FROM aclexplode(COALESCE(${expression},acldefault('${kind}',${owner}))) x
 LEFT JOIN pg_roles g ON g.oid=x.grantor LEFT JOIN pg_roles r ON r.oid=x.grantee),'[]'::jsonb)`;
export const GLOBAL_SQL_V2 = Object.freeze({
 namespace: `/* b9globals:namespace */ SELECT jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',${acl('n.nspacl','n','n.nspowner')}) value FROM pg_namespace n WHERE n.nspname='public'`,
 relations: `/* b9globals:relations */ SELECT jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'persistence',c.relpersistence,'replicaIdentity',c.relreplident,'acl',CASE WHEN c.relkind='S' THEN ${acl('c.relacl','S','c.relowner')}
 WHEN c.relkind IN ('r','v') THEN ${acl('c.relacl','r','c.relowner')} ELSE '[]'::jsonb END) value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname COLLATE "C"`,
 views: `/* b9globals:views */ SELECT jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid,true),
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
 'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE quote_ident(cn.nspname)||'.'||quote_ident(co.collname) END) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb)) value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' ORDER BY c.relname COLLATE "C"`,
 routines: `/* b9globals:routines */ SELECT jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
 'kind',p.prokind,'definition',CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ELSE NULL END,
 'owner',pg_get_userbyid(p.proowner),'acl',${acl('p.proacl','f','p.proowner')}) value
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 ORDER BY p.proname COLLATE "C",pg_get_function_identity_arguments(p.oid) COLLATE "C"`,
 sequences: `/* b9globals:sequences */ SELECT jsonb_build_object('definition',jsonb_build_object('name',c.relname,
 'dataType',format_type(s.seqtypid,NULL),'start',s.seqstart::text,'min',s.seqmin::text,'max',s.seqmax::text,
 'increment',s.seqincrement::text,'cycle',s.seqcycle,'cache',s.seqcache::text),'owner',pg_get_userbyid(c.relowner),
 'acl',${acl('c.relacl','S','c.relowner')},'ownership',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'dependencyKind',d.deptype,'tableSchema',tn.nspname,'table',t.relname,'column',a.attname,'identity',a.attidentity)
 ORDER BY tn.nspname COLLATE "C",t.relname COLLATE "C",a.attname COLLATE "C",d.deptype)
 FROM pg_depend d LEFT JOIN pg_class t ON d.refclassid='pg_class'::regclass AND t.oid=d.refobjid
 LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
 WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')),'[]'::jsonb)) value
 FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' ORDER BY c.relname COLLATE "C"`,
 extensions: `/* b9globals:extensions */ SELECT jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,
 'owner',pg_get_userbyid(e.extowner)) value FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname COLLATE "C"`,
 unsupported: `/* b9globals:unsupported */ SELECT kind,name FROM (
 SELECT 'relation:'||c.relkind::text kind,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind NOT IN ('r','i','S','v')
 UNION ALL SELECT 'routine:'||p.prokind::text,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind NOT IN ('f','p')
 UNION ALL SELECT 'type:'||t.typtype::text,t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
 AND NOT (t.typtype='c' AND EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=t.typrelid AND c.relkind IN ('r','v')))
 AND NOT (t.typelem<>0 AND EXISTS(SELECT 1 FROM pg_type e JOIN pg_class c ON c.oid=e.typrelid WHERE e.oid=t.typelem AND e.typtype='c' AND c.relkind IN ('r','v')))
 UNION ALL SELECT 'default-acl',pg_get_userbyid(d.defaclrole)||':'||d.defaclobjtype::text||':'||COALESCE(n.nspname,'*') FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname='public'
 UNION ALL SELECT 'operator',o.oprname||'('||format_type(o.oprleft,NULL)||','||format_type(o.oprright,NULL)||')' FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'collation',c.collname FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'conversion',c.conname FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'
 UNION ALL SELECT 'text-search-config',x.cfgname FROM pg_ts_config x JOIN pg_namespace n ON n.oid=x.cfgnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'text-search-dictionary',x.dictname FROM pg_ts_dict x JOIN pg_namespace n ON n.oid=x.dictnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'text-search-parser',x.prsname FROM pg_ts_parser x JOIN pg_namespace n ON n.oid=x.prsnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'text-search-template',x.tmplname FROM pg_ts_template x JOIN pg_namespace n ON n.oid=x.tmplnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'operator-class',x.opcname FROM pg_opclass x JOIN pg_namespace n ON n.oid=x.opcnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'operator-family',x.opfname FROM pg_opfamily x JOIN pg_namespace n ON n.oid=x.opfnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'extended-statistics',x.stxname FROM pg_statistic_ext x JOIN pg_namespace n ON n.oid=x.stxnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'column-acl',c.relname||'.'||a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attacl IS NOT NULL
 UNION ALL SELECT 'relation-options',c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.reloptions IS NOT NULL OR c.reltablespace<>0 OR c.relispartition)
 UNION ALL SELECT 'rule',c.relname||'.'||r.rulename FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT(c.relkind='v' AND r.rulename='_RETURN')
 UNION ALL SELECT 'inheritance',c.relname||':'||pn.nspname||'.'||p.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_class p ON p.oid=i.inhparent JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_namespace pn ON pn.oid=p.relnamespace WHERE n.nspname='public' OR pn.nspname='public'
 UNION ALL SELECT 'table-access-method',c.relname||':'||COALESCE(a.amname,'missing') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_am a ON a.oid=c.relam WHERE n.nspname='public' AND c.relkind='r' AND (a.amname IS DISTINCT FROM 'heap')
 UNION ALL SELECT 'event-trigger',e.evtname FROM pg_event_trigger e
 UNION ALL SELECT 'publication',p.pubname FROM pg_publication p WHERE p.puballtables OR EXISTS(SELECT 1 FROM pg_publication_tables t WHERE t.pubname=p.pubname AND t.schemaname='public')
 ) x ORDER BY kind COLLATE "C",name COLLATE "C"`
});
function validateAcl(values) {
  need(Array.isArray(values) && values.length<=10000,'B9_GLOBAL_ACL_LIMIT');
  let previous;
  for (const value of values) {
    need(value && Object.keys(value).sort().join()==='grantee,grantor,isGrantable,privilege' && ['grantor','grantee','privilege'].every(k=>typeof value[k]==='string'&&value[k].length>0)
      && typeof value.isGrantable==='boolean','B9_GLOBAL_ACL_INVALID');
    const key=[value.grantor,value.grantee,value.privilege,value.isGrantable?'1':'0'].join('\0');
    need(previous===undefined||order(previous,key)<0,'B9_GLOBAL_ACL_ORDER'); previous=key;
  }
}
export function validatePublicGlobals(value) {
  need(value?.schemaVersion==='wfc.pf.public-global-sql.v2' && value.namespace && typeof value.namespace.owner==='string','B9_GLOBAL_SCHEMA');
  validateAcl(value.namespace.acl);
  for (const key of ['relations','views','routines','sequences','extensions','unsupportedObjects']) need(Array.isArray(value[key])&&value[key].length<=50000,'B9_GLOBAL_LIMIT');
  for (const item of [...value.relations,...value.routines,...value.sequences]) { need(typeof item.owner==='string'&&item.owner.length>0,'B9_GLOBAL_OWNER'); validateAcl(item.acl); }
  const decimal= v=>typeof v==='string'&&/^-?(?:0|[1-9][0-9]*)$(?![\s\S])/.test(v);
  for (const seq of value.sequences) {
    need(seq.definition && ['start','min','max','increment','cache'].every(k=>decimal(seq.definition[k])) && typeof seq.definition.cycle==='boolean'
      && decimal(seq.state?.lastValue)&&typeof seq.state.isCalled==='boolean'&&Array.isArray(seq.ownership),'B9_GLOBAL_SEQUENCE_INVALID');
    for (const dep of seq.ownership) need(['a','i'].includes(dep.dependencyKind)&&['tableSchema','table','column'].every(k=>typeof dep[k]==='string'&&dep[k].length>0)
      && ['','a','d'].includes(dep.identity),'B9_GLOBAL_SEQUENCE_OWNERSHIP');
  }
  need(Buffer.byteLength(JSON.stringify(value))<=8*1024**2,'B9_GLOBAL_BYTES_LIMIT'); return value;
}
export async function capturePublicGlobals(pool,{signal}={}) {
  const start=Date.now(), check=()=>need(!signal?.aborted&&Date.now()-start<120000,'B9_GLOBAL_INTERRUPTED');
  check(); const client=await pool.connect(); let begun=false;
  const query=async(text,values=[])=>{check();const result=await client.query({text,values,query_timeout:20000});check();need(result.rows.length<=50000,'B9_GLOBAL_ROW_LIMIT');return result.rows;};
  try {
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun=true;
    await query("SET LOCAL statement_timeout='15000ms'"); await query("SET LOCAL lock_timeout='5000ms'");
    await query("SET LOCAL timezone='UTC'"); await query('SET LOCAL search_path=pg_catalog,public');
    const namespace=await query(GLOBAL_SQL_V2.namespace); need(namespace.length===1,'B9_GLOBAL_NAMESPACE');
    const relations=(await query(GLOBAL_SQL_V2.relations)).map(r=>r.value),views=(await query(GLOBAL_SQL_V2.views)).map(r=>r.value),routines=(await query(GLOBAL_SQL_V2.routines)).map(r=>r.value);
    const sequences=[];
    for (const row of await query(GLOBAL_SQL_V2.sequences)) {
      const seq=row.value; need(typeof seq.definition?.name==='string'&&seq.definition.name.length<=63,'B9_GLOBAL_SEQUENCE_NAME');
      const state=await query('SELECT last_value::text AS "lastValue",is_called AS "isCalled" FROM public.'+quote(seq.definition.name));
      need(state.length===1,'B9_GLOBAL_SEQUENCE_STATE');sequences.push({...seq,state:state[0]});
    }
    const value=validatePublicGlobals({schemaVersion:'wfc.pf.public-global-sql.v2',namespace:namespace[0].value,relations,views,routines,sequences,
      extensions:(await query(GLOBAL_SQL_V2.extensions)).map(r=>r.value),unsupportedObjects:await query(GLOBAL_SQL_V2.unsupported)});
    await query('COMMIT'); begun=false; return value;
  } catch(error) { if(begun)await client.query('ROLLBACK').catch(()=>{});throw error; }
  finally { client.release(); }
}
