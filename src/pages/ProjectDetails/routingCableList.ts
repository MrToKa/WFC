import type { RoutingCable } from '@/api/routingCables';

/** Search keys are independent of route parsing; displayed tags remain original data. */
export const cableTagSearchKey = (value: string): string => value.normalize('NFKC').trim().toUpperCase();
export const hasCableTag = (cable: RoutingCable): cable is RoutingCable & { tag: string } => typeof cable.tag === 'string' && cable.tag.trim().length > 0;

export function projectCableRows(cables: readonly RoutingCable[], search: string) {
  const tagged = cables.filter(hasCableTag);
  const key = cableTagSearchKey(search);
  return { rows: key ? tagged.filter(cable => cableTagSearchKey(cable.tag).includes(key)) : tagged, omittedCount: cables.length - tagged.length, taggedCount: tagged.length };
}
