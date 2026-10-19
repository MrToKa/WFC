import type { RoutingCategory } from './protocol.mjs';
export const PREPARATION_VIEWER_LIMITS: Readonly<{ names:number; pageObjects:number; pageBytes:number; selectedObjects:number; indexedObjects:number; depth:number }>;
export const PREPARATION_MATCHING_POLICY: 'wfc.pf.project-exact-candidates.v1';
export interface PreparationDiscoveryRequest { schemaVersion:'wfc.pf.viewer-discovery.v1'; mode:'names'|'equipment'|'subtree'|'ancestors'; names:string[]; rootObjectId:number|null; cursor:number; limit:number }
export interface PreparationDiscoveryObject { objectId:number; parentId:number|null; name:string; hasGeometry:boolean; isPhysicalLeaf:boolean; orderIndex:number; matchedNames:string[] }
export interface PreparationDiscoveryPage { schemaVersion:'wfc.pf.viewer-discovery.v1'; mode:'names'|'equipment'|'subtree'|'ancestors'; names:string[]; rootObjectId:number|null; cursor:number; matchingPolicyVersion:typeof PREPARATION_MATCHING_POLICY; indexedObjectCount:number; propertyScan:null|{attemptedObjectCount:number;returnedObjectCount:number;omittedObjectCount:number;complete:boolean}; objects:PreparationDiscoveryObject[]; nextCursor:number|null; complete:boolean }
export interface PreparationSliceObject { objectId:number; rootObjectId:number; projectTrayId:string; routeName:string; shapeName:string; allowedCategories:RoutingCategory[] }
export interface PreparationSlice { schemaVersion:'wfc.pf.viewer-slice.v1'; sessionId:string; partId:string; planSha256:string; coordinateFrameId:string; objects:PreparationSliceObject[]; equipmentObjectIds:number[] }
export function validatePreparationDiscoveryRequest(value:unknown):value is PreparationDiscoveryRequest;
export function validatePreparationDiscoveryPage(value:unknown):value is PreparationDiscoveryPage;
export function validatePreparationSlice(value:unknown):value is PreparationSlice;
