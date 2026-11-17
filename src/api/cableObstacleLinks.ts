import { cableObstacleLinksSchema } from '../../shared/pathfinderCableObstacleLinks';
import { getApiBaseUrl } from './http';

export async function fetchCableObstacleLinks(projectId: string, cableId: string, token: string, signal: AbortSignal) {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/cables/${encodeURIComponent(cableId)}/obstacle-links`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
  });
  if (!response.ok) throw new Error('The saved obstacle references could not be read. Refresh the cable and try again.');
  const parsed = cableObstacleLinksSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The saved obstacle references could not be read. Refresh the cable and try again.');
  const value = parsed.data;
  if (value.projectId !== projectId || value.cableId !== cableId) throw new Error('The cable changed. Refresh it and try again.');
  return value;
}
