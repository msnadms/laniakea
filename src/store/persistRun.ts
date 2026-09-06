import { useExtractorStore } from './extractorStore';
import { useFabricatorStore } from './fabricatorStore';
import { useStockpileStore } from './stockpileStore';
import { updateExtractorCollected } from '../firebase/extractors';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveFabricatorState } from '../firebase/fabricators';
import { saveStockpile } from '../firebase/stockpile';

export function persistFabricatorRun(
  uid: string,
  touched: { fabricatorKeys?: Iterable<string>; extractorKeys?: Iterable<string> },
): Promise<unknown> {
  const extractors = useExtractorStore.getState();
  const { fabricatorStates } = useFabricatorStore.getState();
  const stockpile = useStockpileStore.getState();
  const writes: Promise<unknown>[] = [];

  for (const key of touched.extractorKeys ?? []) {
    const collectedAt = extractors.extractors[key]?.lastCollectedAt;
    if (collectedAt !== undefined) writes.push(updateExtractorCollected(uid, key, collectedAt));
  }
  for (const key of touched.fabricatorKeys ?? []) {
    const state = fabricatorStates[key];
    if (state) writes.push(saveFabricatorState(uid, key, state));
  }
  writes.push(saveExtractorUpgrades(uid, {
    ownedUpgrades: extractors.ownedUpgrades,
    nodeEquipped: extractors.nodeEquipped,
  }));
  writes.push(saveStockpile(uid, stockpile.materials, stockpile.rares));

  return Promise.all(writes);
}
