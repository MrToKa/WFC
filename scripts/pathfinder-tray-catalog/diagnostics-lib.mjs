import { createHash } from 'node:crypto';
import { canonical, validateSourceProjection, sourceProjectionHashes, LIMITS } from './source-lib.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const compare = (left,right) => left < right ? -1 : left > right ? 1 : 0;
const key = value => value === null ? null : value.normalize('NFC').trim();
const present = value => value !== null && value.trim().length > 0;
const captureKey = value => value.normalize('NFC').trim().toUpperCase().replace(/^\/+|\/+$/g,'');
const rows = (source,table) => source.groups[table].rows.map(entry=>JSON.parse(entry.rowText));
const ordered = values => [...values].sort((left,right)=>compare(left.id,right.id));
const rowCount = groups => groups.reduce((count,group)=>count+group.rowCount,0);

/** Mirror model-capture.mjs requestContract routeCodes predicate, including its operation order. */
export function routeCodeDiagnostic(rawName) {
  if(typeof rawName!=='string')return {supported:false,reasons:['NOT_TEXT'],guardToken:null,captureLookupKey:null};
  const guardToken=rawName.replace(/^\/+|\/+$/g,'').trim(),captureLookupKey=captureKey(rawName),reasons=[];
  if(rawName.length>256)reasons.push('OVER_256_UTF16');
  if(!/^[A-Z0-9][A-Z0-9_.-]*$/i.test(guardToken))reasons.push('UNSUPPORTED_ROUTE_CODE');
  if(captureLookupKey==='SECONDARY')reasons.push('RESERVED_SECONDARY');
  return {supported:reasons.length===0,reasons,guardToken,captureLookupKey};
}

function collisions(values,rawField,derive,{distinctRawOnly=false,skipEmpty=false}={}) {
  const grouped=new Map();
  for(const row of ordered(values)) {
    const raw=row[rawField],normalized=derive(raw);
    if(normalized===null||skipEmpty&&normalized==='')continue;
    const members=grouped.get(normalized)??[];members.push({id:row.id,rawValue:raw});grouped.set(normalized,members);
  }
  return [...grouped].sort(([a],[b])=>compare(a,b)).flatMap(([normalized,members])=>{
    const rawDistinctCount=new Set(members.map(row=>row.rawValue)).size;
    return members.length>1&&(!distinctRawOnly||rawDistinctCount>1)?[{key:normalized,rowCount:members.length,rawDistinctCount,members}]:[];
  });
}

/** PostgreSQL TRIM(text) removes U+0020, unlike ECMAScript trim().
 * This key is a candidate, not proof of database LOWER/equality collation (including Turkish I).
 */
const materialKey = value => value===null||/[^\x00-\x7f]/u.test(value)?null:value.replace(/^ +| +$/g,'').toLowerCase();
const check = (groups,count=rowCount(groups)) => ({status:groups.length?'ATTENTION':'PASS',groups:groups.length,rows:count});

/** Pure source observations only. No policy, matching, mutation or engineering acceptance is implied. */
export function catalogDiagnostics(sourceProjection) {
  validateSourceProjection(sourceProjection);
  const trays=rows(sourceProjection,'trays'),cableTypes=rows(sourceProjection,'cable_types'),materialTrays=rows(sourceProjection,'material_trays');
  const purposeNormalizationCollisions=collisions(trays,'purpose',key,{distinctRawOnly:true,skipEmpty:true});
  const trayNameNormalizationCollisions=collisions(trays,'name',key);
  const captureLookupKeyCollisions=collisions(trays,'name',captureKey);
  const missingTrayPurpose=ordered(trays).filter(row=>!present(row.purpose)).map(row=>({id:row.id,rawPurpose:row.purpose}));
  const missingTrayType=ordered(trays).filter(row=>!present(row.tray_type)).map(row=>({id:row.id,rawTrayType:row.tray_type}));
  const missingCableTypePurpose=ordered(cableTypes).filter(row=>!present(row.purpose)).map(row=>({id:row.id,rawPurpose:row.purpose}));
  const unsupportedRouteCodes=ordered(trays).flatMap(row=>{const diagnostic=routeCodeDiagnostic(row.name);return diagnostic.supported?[]:[{id:row.id,rawName:row.name,...diagnostic}];});
  const materialTypeCollisions=collisions(materialTrays,'tray_type',materialKey);
  const materialTypeSqlVerification=ordered(materialTrays).filter(row=>materialKey(row.tray_type)===null).map(row=>({table:'material_trays',id:row.id,rawTrayType:row.tray_type}));
  const trayTypeSqlVerification=ordered(trays).filter(row=>present(row.tray_type)&&materialKey(row.tray_type)===null).map(row=>({table:'trays',id:row.id,rawTrayType:row.tray_type}));
  const materialByType=new Map();
  for(const row of ordered(materialTrays)){const normalized=materialKey(row.tray_type);if(normalized===null)continue;const values=materialByType.get(normalized)??[];values.push(row.id);materialByType.set(normalized,values);}
  const missingMaterialMatch=[],ambiguousMaterialMatch=[],unverifiedMaterialMatch=[];
  for(const row of ordered(trays)) {
    if(!present(row.tray_type))continue;
    const normalized=materialKey(row.tray_type),matches=normalized===null?[]:materialByType.get(normalized)??[];
    const entry={id:row.id,rawTrayType:row.tray_type,materialTypeKey:normalized,materialTrayIds:matches};
    // Non-ASCII catalog types can fold onto ASCII under a particular DB collation.
    // Do not turn the absence of a proven complete Unicode fold into a missing match.
    if(normalized===null||materialTypeSqlVerification.length)unverifiedMaterialMatch.push(entry);
    else if(matches.length===0)missingMaterialMatch.push(entry);
    else if(matches.length>1)ambiguousMaterialMatch.push(entry);
  }
  const sourceProjectionSha256=sourceProjectionHashes(sourceProjection).sha256;
  const privateDetails={schemaVersion:'wfc.pf.tray-catalog-diagnostics-private.v1',sourceProjectionSha256,
    normalizationVersion:'nfc-trim-case-sensitive-v1',captureLookupNormalizationVersion:'model-capture-nfc-trim-uppercase-strip-slashes-v1',
    routeCodeValidationVersion:'model-capture-request-routeCodes-v1',materialTypeNormalizationVersion:'candidate-ascii-space-ecmascript-lower-v1',
    purposeNormalizationCollisions,trayNameNormalizationCollisions,captureLookupKeyCollisions,missingTrayPurpose,missingTrayType,missingCableTypePurpose,
    unsupportedRouteCodes,materialTypeCollisions,materialTypeSqlVerification,trayTypeSqlVerification,missingMaterialMatch,ambiguousMaterialMatch,unverifiedMaterialMatch};
  const encoded=canonical(privateDetails);
  if(Buffer.byteLength(encoded)>LIMITS.outputBytes)throw Object.assign(new Error('CATALOG_DIAGNOSTICS_BUDGET'),{code:'CATALOG_DIAGNOSTICS_BUDGET'});
  const checks={purposeNormalization:check(purposeNormalizationCollisions),trayNameNormalization:check(trayNameNormalizationCollisions),captureLookupKeyAmbiguity:check(captureLookupKeyCollisions),
    missingTrayPurpose:check(missingTrayPurpose,missingTrayPurpose.length),missingTrayType:check(missingTrayType,missingTrayType.length),missingCableTypePurpose:check(missingCableTypePurpose,missingCableTypePurpose.length),
    unsupportedRouteCodes:check(unsupportedRouteCodes,unsupportedRouteCodes.length),materialTypeCollisions:check(materialTypeCollisions),
    materialSqlCollation:{status:trays.length||materialTrays.length?'NOT_VERIFIED':'PASS',rows:trays.length+materialTrays.length},
    materialTypeSqlVerification:{status:materialTypeSqlVerification.length||trayTypeSqlVerification.length?'NOT_VERIFIED':'PASS',rows:materialTypeSqlVerification.length+trayTypeSqlVerification.length},
    missingMaterialMatch:check(missingMaterialMatch,missingMaterialMatch.length),ambiguousMaterialMatch:check(ambiguousMaterialMatch,ambiguousMaterialMatch.length),
    unverifiedMaterialMatch:{status:unverifiedMaterialMatch.length?'NOT_VERIFIED':'PASS',rows:unverifiedMaterialMatch.length}};
  const publicSummary={schemaVersion:'wfc.pf.tray-catalog-diagnostics-summary.v1',status:'OBSERVED',sourceProjectionSha256,privateDetailsSha256:sha256(encoded),
    counts:{trays:trays.length,cableTypes:cableTypes.length,materialTrays:materialTrays.length,rawPurposeDistinct:new Set(trays.filter(row=>present(row.purpose)).map(row=>row.purpose)).size,
      purposeKeyDistinct:new Set(trays.filter(row=>present(row.purpose)).map(row=>key(row.purpose))).size,rawTrayNameDistinct:new Set(trays.map(row=>row.name)).size,
      trayNameKeyDistinct:new Set(trays.map(row=>key(row.name))).size,captureLookupKeyDistinct:new Set(trays.map(row=>captureKey(row.name))).size},
    checks,tables:{trays:{rows:trays.length,status:[checks.purposeNormalization,checks.trayNameNormalization,checks.captureLookupKeyAmbiguity,checks.missingTrayPurpose,checks.missingTrayType,checks.unsupportedRouteCodes,checks.missingMaterialMatch,checks.ambiguousMaterialMatch,checks.unverifiedMaterialMatch].some(value=>value.status!=='PASS')?'ATTENTION':'PASS'},
      cable_types:{rows:cableTypes.length,status:checks.missingCableTypePurpose.status},material_trays:{rows:materialTrays.length,status:checks.materialTypeCollisions.status==='ATTENTION'?'ATTENTION':checks.materialSqlCollation.status}}};
  return {publicSummary,privateDetails};
}
