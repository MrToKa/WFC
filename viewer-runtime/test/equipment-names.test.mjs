import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_NAME_MATCHING_POLICY, modelEquipmentMatchKeys, humanScalarPropertyValues, equipmentObjectIdentity } from '../equipment-names.mjs';

test('equipment model keys retain exact Unicode spelling and expose only a single leading-slash alternative', () => {
  assert.equal(EQUIPMENT_NAME_MATCHING_POLICY, 'wfc.pf.equipment-model-leading-slash.v1');
  assert.deepEqual(modelEquipmentMatchKeys(' /=h1=jg2=bfb001 '), ['/=H1=JG2=BFB001', '=H1=JG2=BFB001']);
  assert.deepEqual(modelEquipmentMatchKeys('/cafe\u0301'), ['/CAF\u00c9', 'CAF\u00c9']);
  assert.deepEqual(modelEquipmentMatchKeys('=A001'), ['=A001']);
  assert.deepEqual(modelEquipmentMatchKeys(''), []);
});
test('equipment model keys preserve repeated, internal and trailing slashes, punctuation and leading zeroes', () => {
  for (const value of ['//=A001', '=A001/', '=A001/PART', '=A001-2']) assert.deepEqual(modelEquipmentMatchKeys(value), [value]);
  assert.deepEqual(modelEquipmentMatchKeys('/=A001/'), ['/=A001/', '=A001/']);
  assert.deepEqual(modelEquipmentMatchKeys('/'), ['/']);
  assert.ok(!modelEquipmentMatchKeys('/=A001').includes('A001'));
  assert.ok(!modelEquipmentMatchKeys('/=A001').includes('=A1'));
});
test('all own readable scalar SDK and canonical human property values are candidates irrespective of their human label',()=>{
  const properties=[{displayName:'Custom ACS consumer reference',displayValue:' /=h1=jg2=bfb001 '},{category:'Custom',name:'Circuit designation',value:'Café'},
    {displayName:'Feeder number',displayValue:101},{name:'Commissioned',value:false},{displayName:'Child',displayValue:'Human child label'},
    {displayName:'__ACS tag__',displayCategory:'Custom',displayValue:'CUSTOM'}];
  assert.deepEqual(humanScalarPropertyValues(properties),[' /=h1=jg2=bfb001 ','Café','101','false','Human child label','CUSTOM']);
  assert.deepEqual(humanScalarPropertyValues(properties).flatMap(modelEquipmentMatchKeys).slice(0,2),['/=H1=JG2=BFB001','=H1=JG2=BFB001']);
});
test('hidden and reserved SDK structural properties cannot become equipment aliases or copy parent references',()=>{
  const properties=[{displayName:'Tag',displayValue:'HIDDEN',hidden:true},{name:'Tag',value:'INTERNAL',isInternal:true},{name:'Tag',value:'HIDDEN2',isHidden:true},
    {displayName:'child',displayCategory:'__child__',displayValue:991},{name:'parent',category:'__parent__',value:8},
    {attributeName:'__ref__',displayValue:'REFERENCE'},{displayName:'__instanceof__',displayValue:'TYPE'},{name:'__internal__',value:'PRIVATE'},
    {displayName:'Tag',displayValue:'VISIBLE',hidden:false}];
  assert.deepEqual(humanScalarPropertyValues(properties),['VISIBLE']);
});
test('nonfinite/container/non-JSON values and accessor-backed metadata are unreadable and never evaluated',()=>{
  let reads=0;const accessor={displayName:'Tag'};Object.defineProperty(accessor,'displayValue',{get(){reads++;return'NO';},enumerable:true});
  const hiddenAccessor={displayValue:'NO'};Object.defineProperty(hiddenAccessor,'hidden',{get(){reads++;return false;},enumerable:true});
  const categoryAccessor={displayValue:'NO'};Object.defineProperty(categoryAccessor,'category',{get(){reads++;return'__internal__';},enumerable:true});
  const inherited=Object.create({value:'PARENT'});inherited.name='Custom';
  const values=[null,1,'primitive',[],{value:null},{value:undefined},{value:{}},{value:[]},{value:NaN},{value:Infinity},{value:1n},{value:Symbol('x')},accessor,hiddenAccessor,categoryAccessor,{value:'NO',hidden:'true'},{value:'NO',isInternal:1},inherited];
  assert.deepEqual(humanScalarPropertyValues(values),[]);assert.equal(reads,0);
});
test('long or multiline human descriptions stay readable without truncation or invented substring aliases',()=>{
  const long='Description '.repeat(400),multiline='A\nB',properties=[{name:'Description',value:long},{displayName:'Notes',displayValue:multiline}];
  assert.deepEqual(humanScalarPropertyValues(properties),[long,multiline]);assert.ok(!humanScalarPropertyValues(properties).flatMap(modelEquipmentMatchKeys).includes('DESCRIPTION'));
  const canonical=Object.assign(Object.create(null),{name:'Reference',value:'P-001'});assert.deepEqual(humanScalarPropertyValues([canonical]),['P-001']);
});

test('numeric zero visibility flags are readable while true, nonzero and unknown flags remain excluded',()=>{
  const value=hidden=>({displayName:'Tag',displayValue:'15-FT-4018',hidden});
  assert.deepEqual(humanScalarPropertyValues([value(false),value(0),{...value(0),isHidden:0,isInternal:0}]),['15-FT-4018','15-FT-4018','15-FT-4018']);
  for(const hidden of [true,1,2,'false','0',null])assert.deepEqual(humanScalarPropertyValues([value(hidden)]),[]);
});

test('source object identity uses unambiguous Item GUID and exact normalized full source path',()=>{
  const guid='7586ffbb-1d0a-5942-b687-06884123c866';
  const item={displayCategory:'Item',displayName:'GUID',displayValue:` {${guid.toUpperCase()}} `,hidden:0};
  const source={displayCategory:'Item',displayName:'Source File',displayValue:' Models\\01-50_MSR_Kabeltassen.dwg '};
  assert.deepEqual(equipmentObjectIdentity([item,source,{displayName:'Tag',displayValue:'15-FT-4018'}]),{guid,sourceFile:'models/01-50_msr_kabeltassen.dwg'});
  assert.deepEqual(equipmentObjectIdentity([item,source,item,{...source,displayValue:'models/01-50_msr_kabeltassen.dwg'}]),{guid,sourceFile:'models/01-50_msr_kabeltassen.dwg'});
  assert.deepEqual(equipmentObjectIdentity([{...item,displayCategory:'Element'},source]),{guid,sourceFile:'models/01-50_msr_kabeltassen.dwg'});
  assert.equal(equipmentObjectIdentity([{...item,displayName:'PnPGuid'},source]),null);
  assert.equal(equipmentObjectIdentity([{...item,displayCategory:'__child__'},source]),null);
  for(const props of [[item],[source],[item,source,{...item,displayValue:'00000000-0000-4000-8000-000000000099'}],
    [item,source,{...source,displayValue:'Other/01-50_MSR_Kabeltassen.dwg'}],[item,source,{...item,displayValue:'bad-guid'}],
    [item,{...source,displayValue:''}],[item,{...source,displayValue:'x'.repeat(1025)}]])assert.equal(equipmentObjectIdentity(props),null);
  assert.deepEqual(equipmentObjectIdentity([{...item,hidden:1},source]),{guid,sourceFile:'models/01-50_msr_kabeltassen.dwg'});
  let reads=0;const accessor={...source};Object.defineProperty(accessor,'displayValue',{get(){reads++;return source.displayValue;}});
  assert.equal(equipmentObjectIdentity([item,accessor]),null);assert.equal(reads,0);
});
