import { getApiBaseUrl } from '@/api/http';
import { PathFinderApiError } from '@/api/pathfinder';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';
import type { CadRouteGroup } from '../../shared/cadRouteGroups';
import type { CadSectionMetadata, CadSectionRoute } from '../../viewer-runtime/cad-properties.mjs';
import type { ViewerController } from './ViewerController';

type Instance = {
  id: string; catalogItemId: string; revision: number; lengthMm?: number | null;
  xMm: number; yMm: number; zMm: number; qx: number; qy: number; qz: number; qw: number;
  metadata?: CadSectionMetadata; route?: CadSectionRoute;
};
type Options = {
  viewer: Pick<ViewerController, 'showCadComponent' | 'removeCadComponent' | 'setCadComponentColor' | 'setCadComponentProperties' | 'setCadComponentRoute' | 'setCadComponentVisibility' | 'showCadTray'>;
  projectId: string; token: string; modelVersionId: string;
  isCurrent: () => boolean; onError: (error: unknown) => void;
};
export type PublishedCadDisplay = { refresh: () => Promise<void>; showTray: (projectTrayId: string, routeGroupId?: string) => Promise<boolean>; hideTray: () => Promise<boolean>; dispose: () => void };

/** Display saved CAD route components without changing the model or its capture. */
export function createPublishedCadDisplay({ viewer, projectId, token, modelVersionId, isCurrent, onError }: Options): PublishedCadDisplay {
  const abort = new AbortController();
  const displayed = new Map<string, string>();
  const base = `${getApiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/cad-design`;
  let pending: Promise<void> | null = null;
  let preview: { projectTrayId: string; routeGroupId?: string } | null = null;
  let selectedRoute: CadRouteGroup | null = null;
  let synchronized = false;
  const current = () => !abort.signal.aborted && isCurrent();
  const read = async <T,>(path: string, optional = false): Promise<T | null> => {
    const deadline = pathFinderRequestDeadline(abort.signal, 30_000,
      () => new Error('Loading saved route geometry timed out.'));
    try {
      return await deadline.wait(async () => {
        const response = await fetch(`${base}${path}`, { signal: deadline.signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (optional && response.status === 404) return null;
        if (!response.ok) throw new PathFinderApiError('CAD_DISPLAY_UNAVAILABLE', response.status);
        return response.json() as Promise<T>;
      });
    } finally { deadline.dispose(); }
  };
  const synchronize = async () => {
    synchronized = false;
    try {
      if (!current()) return;
      selectedRoute = null;
      const listing = await read<{ designs: { id: string; modelVersionId: string; activeModel: boolean; status: string }[] }>('/designs', true);
      if (!current()) return;
      const design = listing?.designs.find(value => value.activeModel && value.modelVersionId === modelVersionId && value.status === 'proposed');
      const members = new Map<string, { instance: Instance; route: CadRouteGroup }>();
      if (design) {
        const [groups, placements] = await Promise.all([
          read<{ routes: CadRouteGroup[] }>(`/designs/${design.id}/routes`),
          read<{ instances: Instance[] }>(`/designs/${design.id}/instances`),
        ]);
        if (!current()) return;
        const instances = new Map(placements!.instances.map(instance => [instance.id, instance]));
        selectedRoute = preview ? groups!.routes.find(value => preview!.routeGroupId
          ? value.id === preview!.routeGroupId : value.projectTrayId === preview!.projectTrayId) ?? null : null;
        for (const route of groups!.routes) {
          for (const id of route.instanceIds) {
            const instance = instances.get(id);
            if (!instance) {
              onError(new Error(`Saved route ${route.name} has a component missing from the saved placements.`));
              continue;
            }
            members.set(id, { instance, route });
          }
        }
      }
      for (const id of displayed.keys()) {
        if (!current()) return;
        if (!members.has(id)) { await viewer.removeCadComponent(id); displayed.delete(id); }
      }
      for (const [id, { instance, route }] of members) {
        if (!current()) return;
        const signature = JSON.stringify([design!.id, instance, route]);
        if (displayed.get(id) === signature) continue;
        try {
          if (displayed.has(id)) {
            await viewer.removeCadComponent(id);
            displayed.delete(id);
            if (!current()) return;
          }
          const mesh = await read<unknown>(instance.lengthMm != null
            ? `/designs/${design!.id}/instances/${id}/mesh` : `/catalog/${instance.catalogItemId}/mesh`);
          if (!current()) return;
          await viewer.showCadComponent(id, mesh, {
            positionMm: { x: instance.xMm, y: instance.yMm, z: instance.zMm },
            rotation: { x: instance.qx, y: instance.qy, z: instance.qz, w: instance.qw },
          });
          displayed.set(id, '');
          if (!current()) return;
          await viewer.setCadComponentColor(id, route.color);
          if (!current()) return;
          // Membership is authoritative even when optional section properties
          // are absent or still describe an earlier route assignment.
          await viewer.setCadComponentRoute(id, route.name);
          if (!current()) return;
          if (instance.metadata && instance.route) await viewer.setCadComponentProperties(id, instance.metadata, instance.route);
          if (!current()) return;
          displayed.set(id, signature);
        } catch (error) { if (current()) onError(error); }
      }
      synchronized = current();
    } catch (error) { if (current()) onError(error); }
  };
  const refresh = () => {
      if (!current()) return Promise.resolve();
      if (!pending) pending = synchronize().finally(() => { pending = null; });
      return pending;
  };
  return {
    refresh,
    showTray: async (projectTrayId, routeGroupId) => {
      if (!current()) return false;
      const request = { projectTrayId, routeGroupId };
      preview = request;
      if (pending) await pending;
      if (!current() || preview !== request) return false;
      await refresh();
      const route = selectedRoute;
      if (!synchronized || !current() || preview !== request || !route?.instanceIds.length
        || route.instanceIds.some(id => !displayed.get(id))) return false;
      try {
        if (!current() || preview !== request) return false;
        await viewer.showCadTray([...route.instanceIds]);
        return current() && preview === request;
      } catch (error) { if (current()) onError(error); return false; }
    },
    hideTray: async () => {
      if (!current()) return false;
      if (!preview) return true;
      const previous = preview;
      preview = null;
      if (pending) await pending;
      if (!current() || preview !== null) return false;
      await refresh();
      if (!synchronized && current() && preview === null) preview = previous;
      return synchronized && current();
    },
    dispose: () => { abort.abort(); displayed.clear(); },
  };
}
