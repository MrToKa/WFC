// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {LocationDto} from './contracts.js';
import {matchLocation} from './matching.js';
import {createDisplayLocationMatchIndex} from './displayLocationMatchIndex.js';
const location=(id:string,name:string,aliases:string[]=[]):LocationDto=>({id,name,aliases,revision:'1',binding:null});
const binding=(status:'confirmed'|'stale'):NonNullable<LocationDto['binding']>=>({modelVersionId:'model',revision:'1',point:[1,2,3],objectId:null,externalId:null,source:'manual',status});

describe('display-only location matching index',()=>{
  it('matches the unchanged baseline for blanks, punctuation, NFC, aliases, duplicates, stale/model state and candidate order',()=>{
    const first=location('first',' Café ',['CAFE\u0301',' /A-01 ','/A-01']),second=location('second','/A-01',['Alternate']),unverified={...location('unverified','EQ-2'),matching:{status:'unverified' as const,candidateObjectIds:['dbid:9']}},ambiguous={...location('ambiguous','EQ-3'),matching:{status:'ambiguous' as const,candidateObjectIds:['dbid:6','dbid:5']}},confirmed={...location('confirmed','EQ-4'),binding:binding('confirmed')},stale={...location('stale','EQ-5'),binding:binding('stale')};
    const cases=[[],[first],[first,second,unverified,ambiguous,confirmed,stale],[second,first,first],[first,first], [location('same','Name'),location('same','name')], [location('blank',' ',[''])]];
    for(const locations of cases){const before=structuredClone(locations),index=createDisplayLocationMatchIndex(locations);for(const value of [null,'',' ','\t','unknown','café','CAFE\u0301','/A-01',' /a-01 ','alternate','A-01','EQ-2','eq-3','EQ-4','eq-5','name'])for(const active of [true,false])expect(index.match(value,active)).toEqual(matchLocation(value,locations,active));expect(locations).toEqual(before);}
    const indexed=createDisplayLocationMatchIndex([second,first,first]);expect(indexed.candidateLocationIds('/a-01')).toEqual(['second','first','first']);expect(indexed.match('/a-01',true).candidates).toEqual(['second','first','first']);
  });
  it('normalizes the location/alias rows once for repeated cable ends rather than rescanning their aliases',()=>{
    const row=location('shared','Shared',['Alias','Alias']);let reads=0;Object.defineProperty(row,'aliases',{get(){reads++;return['Alias','Alias'];}});
    const index=createDisplayLocationMatchIndex([row]);expect(reads).toBe(1);
    for(let n=0;n<10000;n++){expect(index.match(' alias ',true)).toEqual({status:'missing',locationId:'shared',candidates:[]});expect(index.candidateLocationIds('SHARED')).toEqual(['shared']);}
    expect(reads).toBe(1);
  });
  it('keeps duplicate row identities ambiguous while duplicate aliases within one row remain a single match',()=>{
    const row=location('same','Tag',['tag',' TAG ','Tag']);expect(createDisplayLocationMatchIndex([row]).match('tag',true)).toEqual(matchLocation('tag',[row],true));expect(createDisplayLocationMatchIndex([row,row]).match('tag',true)).toEqual({status:'ambiguous',locationId:null,candidates:['same','same']});
  });
});
