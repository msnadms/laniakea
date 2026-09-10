import { RESOURCE_LABELS, extractorNodeId, type Extractor } from '../game/types';
import type { DispatchResult } from '../store/logisticsStore';
import { computeMaterialBandwidth, useUIStore } from '../store/uiStore';
import { materialName } from '../data/materials';
import { fmt } from './strings';

export type AnimLine = { text: string; isCost: boolean; revealStep: number };

export function buildDispatchLines(
  result: DispatchResult,
  cost: { exotic: number; helium: number },
  extractors: Record<string, Extractor>,
): AnimLine[] {
  const { collected, deliveries, order: orderedNodeIds, carried, materialsMoved } = result;
  const { logisticsA, logisticsB } = useUIStore.getState();
  const bandwidth = computeMaterialBandwidth(logisticsA, logisticsB);

  const nodeCollected = new Map<string, Map<string, number>>();
  for (const { key, amount } of collected) {
    const ext = extractors[key];
    if (!ext || amount <= 0) continue;
    const nid = extractorNodeId(ext.galaxySeed, ext.systemId);
    if (!nodeCollected.has(nid)) nodeCollected.set(nid, new Map());
    const resMap = nodeCollected.get(nid)!;
    resMap.set(ext.resourceType, (resMap.get(ext.resourceType) ?? 0) + amount);
  }

  const lines: AnimLine[] = [];
  if (cost.exotic > 0) lines.push({ text: `-${fmt(cost.exotic)} EM`, isCost: true, revealStep: 0 });
  if (cost.helium > 0) lines.push({ text: `-${fmt(cost.helium)} He-3`, isCost: true, revealStep: 0 });
  for (let i = 0; i < orderedNodeIds.length; i++) {
    const resMap = nodeCollected.get(orderedNodeIds[i]);
    if (resMap) {
      for (const [resType, amt] of resMap) {
        lines.push({
          text: `+${fmt(amt)} ${RESOURCE_LABELS[resType as keyof typeof RESOURCE_LABELS] ?? resType}`,
          isCost: false,
          revealStep: i,
        });
      }
    }
  }

  const lastStep = Math.max(0, orderedNodeIds.length - 1);
  for (const [matId, count] of Object.entries(carried)) {
    if (count > 0) {
      lines.push({ text: `⇢ ${count}x ${materialName(matId)} carried`, isCost: false, revealStep: lastStep });
    }
  }
  for (const d of deliveries) {
    lines.push({ text: `+${d.count}x ${d.name}`, isCost: false, revealStep: lastStep });
  }
  if (materialsMoved > 0) {
    lines.push({ text: `${materialsMoved} material-edge units moved - ${bandwidth} cap/edge`, isCost: true, revealStep: lastStep });
  }

  return lines;
}
