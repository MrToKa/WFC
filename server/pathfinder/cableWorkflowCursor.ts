import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { policyUuidSchema, policyHashSchema } from '../../shared/pathfinderPurposePolicy.js';
import { CABLE_WORKFLOW_LIMITS } from '../../shared/pathfinderCableWorkflow.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { assertLoginNotExpired } from './auth.js';

const payload = z.tuple([z.literal(1), policyUuidSchema, policyUuidSchema, policyHashSchema, policyHashSchema]);
const invalid = (): never => { throw new PathFinderError('WORKFLOW_CURSOR_INVALID', 409, 'The cable list changed or its cursor is invalid. Refresh the list from the beginning.'); };
export function createCableWorkflowCursor(secret: Buffer) {
  if (secret.length < 32) throw new Error('A private cursor key requires at least32bytes.');
  const mac = (body: Buffer, who: JobPrincipal) => createHmac('sha256', secret).update('wfc.pf.cable-workflow-cursor.v1\n').update(who.userId + '\n' + who.loginId + '\n' + who.loginExpiresAt + '\n').update(body).digest();
  return {
    encode(projectId: string, last: string, queryHash: string, contextHash: string, who: JobPrincipal) {
      assertLoginNotExpired(who);
      const body = Buffer.from(JSON.stringify(payload.parse([1, projectId, last, queryHash, contextHash])));
      const value = Buffer.concat([body, mac(body, who)]).toString('base64url');
      if (value.length > CABLE_WORKFLOW_LIMITS.cursorCharacters) return invalid(); return value;
    },
    decode(raw: string | undefined, projectId: string, queryHash: string, contextHash: string, who: JobPrincipal): string | null {
      assertLoginNotExpired(who);
      if (raw === undefined) return null;
      try {
        if (!raw || raw.length > CABLE_WORKFLOW_LIMITS.cursorCharacters || /^[A-Za-z0-9_-]+$/.exec(raw)?.[0] !== raw) return invalid();
        const bytes = Buffer.from(raw, 'base64url'); if (bytes.toString('base64url') !== raw || bytes.length <= 32) return invalid();
        const body = bytes.subarray(0, -32), signature = bytes.subarray(-32);
        if (!timingSafeEqual(signature, mac(body, who))) return invalid();
        const value = payload.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
        if (JSON.stringify(value) !== body.toString('utf8') || value[1] !== projectId || value[3] !== queryHash || value[4] !== contextHash) return invalid();
        return value[2];
      } catch { return invalid(); }
    },
  };
}
