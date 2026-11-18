import type { usePathFinder } from './hooks/usePathFinder';
import type { Ref } from 'react';
import { ProjectPreparationPanel, type EnsureCalculationNetwork } from './ProjectPreparationPanel';

type Props = { pf: ReturnType<typeof usePathFinder>; active: boolean; onBusyChange?: (busy: boolean) => void; onNetworkReady?: (key: string) => void;
  calculationNetworkRef?: Ref<EnsureCalculationNetwork> };
export function PathFinderRoutes(props: Props) {
  return <ProjectPreparationPanel {...props} />;
}
