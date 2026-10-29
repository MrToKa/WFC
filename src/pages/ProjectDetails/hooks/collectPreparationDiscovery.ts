import { collectPreparationDiscovery as collect } from '../../../../shared/collectPreparationDiscovery';
import type { PreparationContext, PreparationDiscovery } from '../../../../shared/pathfinderPreparation';
import type { ProjectPreparationViewer } from './usePathFinder';

/** Preserve the human adapter API while sharing the exact complete algorithm. */
export function collectPreparationDiscovery(context:PreparationContext,viewer:ProjectPreparationViewer,progress?:(message:string)=>void,options?:{skipEquipment?:boolean}):Promise<PreparationDiscovery> {
  return collect(context,viewer,progress,options);
}
