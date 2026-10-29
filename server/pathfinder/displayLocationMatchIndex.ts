import type {LocationDto,LocationMatch} from './contracts.js';
import {normalizeLocation} from './matching.js';

/** Display-only acceleration. Calculation matching and its identity remain unchanged. */
export function createDisplayLocationMatchIndex(locations:LocationDto[]){
  const byName=new Map<string,LocationDto[]>();
  for(const location of locations){
    // A repeated alias matches a row once; repeated rows still count separately.
    for(const key of new Set([location.name,...location.aliases].map(normalizeLocation))){
      if(!key)continue;const candidates=byName.get(key)??[];candidates.push(location);byName.set(key,candidates);
    }
  }
  const candidates=(value:string|null):LocationDto[]=>value?byName.get(normalizeLocation(value))??[]:[];
  return{
    candidateLocationIds:(value:string|null):string[]=>candidates(value).map(location=>location.id),
    match(value:string|null,hasActiveModel:boolean):LocationMatch{
      const values=candidates(value);
      if(values.length!==1)return{status:values.length?'ambiguous':'missing',locationId:null,candidates:values.map(location=>location.id)};
      const location=values[0];
      if(!location.binding)return{status:location.matching?.status==='ambiguous'||location.matching?.status==='unverified'?'ambiguous':'missing',locationId:location.id,candidates:location.matching?.candidateObjectIds??[]};
      return{status:location.binding.status==='confirmed'&&hasActiveModel?'matched':'stale',locationId:location.id,candidates:[location.id]};
    },
  };
}
