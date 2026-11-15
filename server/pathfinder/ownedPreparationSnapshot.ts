import { z } from 'zod';
import { PREPARATION_LIMITS } from '../../shared/pathfinderPreparation.js';
import { snapshotSchema, snapshotObject, hasValidEquipmentEligibilityEnvelope, type ComputationalSnapshot } from './contracts.js';

const snapshotHeaderSchema = snapshotSchema.innerType().omit({ objects: true });
const snapshotObjectSlots = z.array(z.unknown()).min(1).max(PREPARATION_LIMITS.objects);
export function requireEquipmentEligibilityEnvelope(snapshot: ComputationalSnapshot): void {
  if (!hasValidEquipmentEligibilityEnvelope(snapshot)) throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ['capture'], message: 'Equipment display eligibility has an unsupported capture envelope.' }]);
}

/** Consumes only a freshly decoded, privately owned snapshot. Strict DTO parsing
 * and all transformations are unchanged; relinquish each raw object slot after
 * parsing it so a second complete mesh never has to coexist on the worker heap.
 * This module has no worker entry point and is safe in either worker lane. */
export function parseOwnedPreparationSnapshot(value: unknown): ComputationalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return snapshotSchema.parse(value);
  const { objects, ...header } = value as Record<string, unknown>, parsedHeader = snapshotHeaderSchema.parse(header), slots = snapshotObjectSlots.parse(objects);
  for (let index = 0; index < slots.length; index++) {
    slots[index] = snapshotObject.parse(slots[index]);
    (objects as unknown[])[index] = undefined;
  }
  const parsed = { ...parsedHeader, objects: slots as ComputationalSnapshot['objects'] };
  requireEquipmentEligibilityEnvelope(parsed);
  return parsed;
}
