// @vitest-environment node
import { describe,expect,it } from 'vitest';
import {createCableTypeSchema,updateCableTypeSchema,createMaterialCableTypeSchema,updateMaterialCableTypeSchema} from './validators.js';

describe('cable Purpose authoring',()=>{
  for(const [name,schema] of [['project create',createCableTypeSchema],['project update',updateCableTypeSchema],['material create',createMaterialCableTypeSchema],['material update',updateMaterialCableTypeSchema]] as const){
    it(`${name} normalizes Purpose and permits unset values`,()=>{
      expect(schema.parse({name:'Cable',purpose:' Cafe\u0301 '})).toHaveProperty('purpose','Café');
      for(const purpose of ['',null])expect(schema.safeParse({name:'Cable',purpose}).success).toBe(true);
    });
    it(`${name} refuses control characters and an oversized routing key`,()=>{
      for(const purpose of ['Power\nVFD','Bad\u0000Purpose','X'.repeat(501)])expect(schema.safeParse({name:'Cable',purpose}).success).toBe(false);
    });
  }
});
