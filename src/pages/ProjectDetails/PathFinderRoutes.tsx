import type { usePathFinder } from './hooks/usePathFinder';
import { ProjectPreparationPanel } from './ProjectPreparationPanel';

type Props = { pf: ReturnType<typeof usePathFinder>; active: boolean; onBusyChange?: (busy: boolean) => void; onNetworkReady?: (key: string) => void };
export function PathFinderRoutes({ pf, active, onBusyChange, onNetworkReady }: Props) {
  return <ProjectPreparationPanel pf={pf} active={active} onBusyChange={onBusyChange} onNetworkReady={onNetworkReady} />;
}
