import { z } from 'zod';
import { request, ApiError } from './http';

const responseSchema = z.object({ purposes: z.array(z.object({ name: z.string().min(1).max(200), trayCount: z.number().int().nonnegative() })) });
export type ProjectTrayPurpose = z.infer<typeof responseSchema>['purposes'][number];
export async function projectTrayPurposesRequest(projectId: string, token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: { name: string; nextName?: string }): Promise<ProjectTrayPurpose[]> {
  const result = responseSchema.safeParse(await request('/api/projects/' + projectId + '/tray-purposes', { token, method, ...(body ? { body } : {}) }));
  if (!result.success) throw new ApiError(502, 'Tray purposes could not be read. Refresh the project.');
  return result.data.purposes;
}
