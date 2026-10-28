import type { Pool, PoolClient } from 'pg';
import type { JobPrincipal } from './jobContracts.js';
import { principalTransaction } from './auth.js';
import { grantTransaction, type CalculationGrantAuthority } from './calculationAuthority.js';
import type { CalculationGrantOperation, CalculationGrantProvenance } from '../../shared/pathfinderCalculationGrant.js';
import { PathFinderError } from './errors.js';

/** An issuer is audit provenance, never a fabricated authenticated login. */
export type GrantOperationPrincipal = {
  kind: 'calculation-grant'; userId: string; authority: CalculationGrantAuthority;
  loginId?: never; loginExpiresAt?: never;
};
export type OperationPrincipal = JobPrincipal | GrantOperationPrincipal;
export function isGrantPrincipal(who: OperationPrincipal): who is GrantOperationPrincipal {
  return 'kind' in who && who.kind === 'calculation-grant';
}
export function grantOperationPrincipal(authority: CalculationGrantAuthority): GrantOperationPrincipal {
  return { kind: 'calculation-grant', userId: authority.issuerId, authority };
}
export function requireHumanPrincipal(who: OperationPrincipal): asserts who is JobPrincipal {
  if (isGrantPrincipal(who)) throw new PathFinderError('HUMAN_ADMINISTRATOR_REQUIRED',403,'A current human administrator must review and confirm this operation.');
}
export function requireGrantModelScope(who:OperationPrincipal,scope:{projectId?:string;modelVersionId:string;selectionRevision:string;contentFingerprint:string}):void {
  if(!isGrantPrincipal(who))return;
  const a=who.authority;
  if(scope.projectId!==undefined&&scope.projectId!==a.projectId || scope.modelVersionId!==a.modelVersionId || scope.selectionRevision!==a.selectionRevision || scope.contentFingerprint!==a.contentFingerprint)
    throw new PathFinderError('CALCULATION_GRANT_MODEL_SCOPE_DENIED',403);
}
/** Only immutable non-secret authority provenance may enter sessions and artifacts. */
export function grantProvenance(who: GrantOperationPrincipal): CalculationGrantProvenance {
  const a=who.authority;
  return {kind:'calculation-grant',projectId:a.projectId,grantId:a.grantId,grantRevision:a.grantRevision,
    grantEpoch:a.grantEpoch,installationEpoch:a.installationEpoch,issuerId:a.issuerId,issuerAdminRevision:a.issuerAdminRevision};
}
export function operationTransaction<T>(pool:Pool,projectId:string,who:OperationPrincipal,operation:CalculationGrantOperation,
  callback:(client:PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T> {
  if (!isGrantPrincipal(who)) return principalTransaction(pool,projectId,who,async c=>{
    signal?.throwIfAborted();const value=await callback(c);signal?.throwIfAborted();return value;
  });
  if (who.userId!==who.authority.issuerId || projectId!==who.authority.projectId)
    throw new PathFinderError('CALCULATION_GRANT_SCOPE_DENIED',403);
  return grantTransaction(pool,who.authority,operation,callback,signal);
}
