import { z } from 'zod';
import { getApiBaseUrl } from '@/api/http';
import { gvlPilotQualitySchema } from '../../../shared/gvlPilotQuality';

const count = z.number().int().nonnegative();
const objectId = z.union([z.string(), count]);
const identifier = z.string().nullable();
const documents = z.array(z.object({source:z.string(),page:count.nullable()}));
const unresolved = z.object({
  locationId: identifier, name: z.string(), status: z.string(), reason: z.string(), nextAction: z.string(),
  cables: z.array(z.object({ id: z.string(), tag: identifier, side: z.string() })),
  candidates: z.array(z.object({ tag: identifier, objectIds: z.array(objectId) })),
  documents, conflictingCableLoops: z.array(z.string()).optional(),
});
const assigned = z.object({
  locationId: z.string(), name: z.string(), status: z.string(), bindingId: identifier, receiptId: identifier,
  impactId: identifier, jobId: identifier, objectIds: z.array(objectId), evidence: z.string(),
  equipmentTag: identifier.optional(), documents: documents.optional(), jobStatus: identifier.optional(), dispatchStatus: identifier.optional(),
});
export const reportSchema = z.object({
  schemaVersion: z.literal('wfc.gvl244.stage5.v1'), projectId: z.string(), modelLabel: z.string(),
  quality: gvlPilotQualitySchema.nullable().optional(),
  capturedAt: z.string().datetime({offset:true}), scopeStatus: z.enum(['current','changed','historical']),
  summary: z.object({ locations: count, assigned: count, preserved: count, otherReady: count.optional(), unresolved: count, cables: count,
    routed: count, unrouted: count, manualProtected: count, changedTags: count }),
  unresolved: z.array(unresolved), assigned: z.array(assigned), audit: z.array(assigned).optional(),
  routingBlocked: z.array(z.object({id: z.string(), tag: identifier, from: identifier, to: identifier, reason: z.string(), latestJobStatus: identifier.optional(), latestJobId: identifier.optional(), latestJobMessage: identifier.optional()})),
});
export type PilotReport = z.infer<typeof reportSchema>;

export async function readPilotReport(projectId: string, token: string, signal: AbortSignal) {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/gvl-stage5/report`, {
    headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store',
  });
  if (response.status === 401 || response.status === 403) throw Error('Липсват права за преглед на отчета.');
  if (response.status === 404) throw Error('Все още няма публикуван отчет за този проект.');
  if (!response.ok) throw Error('WFC не успя да зареди отчета.');
  const report = reportSchema.safeParse(await response.json());
  if (!report.success || report.data.projectId !== projectId) throw Error('Полученият отчет е невалиден за избрания проект.');
  return report.data;
}
