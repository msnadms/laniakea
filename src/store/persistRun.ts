import { useExtractorStore } from './extractorStore';
import { useFabricatorStore } from './fabricatorStore';
import { useStockpileStore } from './stockpileStore';
import { updateExtractorCollected } from '../firebase/extractors';
import { saveExtractorUpgrades } from '../firebase/extractorUpgrades';
import { saveFabricatorState } from '../firebase/fabricators';
import { saveStockpile } from '../firebase/stockpile';
import { saveColony, deleteColony } from '../firebase/colonies';
import { useColonyStore } from './colonyStore';
import { useUIStore } from './uiStore';
import { saveCampaignProgress } from '../firebase/userDoc';
import { saveResearch } from '../firebase/research';
import { useResearchStore } from './researchStore';

const runWrites = new Map<string, Promise<unknown>>();
export function flushRunPersistence(uid: string): Promise<unknown> {
  return runWrites.get(uid) ?? Promise.resolve();
}

export function persistFabricatorRun(
  uid: string,
  touched: { fabricatorKeys?: Iterable<string>; extractorKeys?: Iterable<string>; colonyKeys?: Iterable<string>; campaign?: boolean; research?: boolean },
): Promise<unknown> {
  // Snapshot keys, but read state when the write begins. A queued old tick must
  // never resurrect a colony that a later action has evacuated or destroyed.
  const keys = {
    extractorKeys: [...(touched.extractorKeys ?? [])],
    fabricatorKeys: [...(touched.fabricatorKeys ?? [])],
    colonyKeys: [...(touched.colonyKeys ?? [])],
    campaign: touched.campaign ?? false,
    research: touched.research ?? false,
  };
  const next = (runWrites.get(uid) ?? Promise.resolve()).catch(() => undefined)
    .then(() => writeRun(uid, keys));
  runWrites.set(uid, next);
  return next;
}

interface WrittenSnapshot { materials: unknown; rares: unknown; ownedUpgrades: unknown; nodeEquipped: unknown }
const lastWritten = new Map<string, WrittenSnapshot>();

function writeRun(uid: string, touched: { extractorKeys: string[]; fabricatorKeys: string[]; colonyKeys: string[]; campaign: boolean; research: boolean }): Promise<unknown> {
  const extractors = useExtractorStore.getState();
  const { fabricatorStates } = useFabricatorStore.getState();
  const stockpile = useStockpileStore.getState();
  const writes: Promise<unknown>[] = [];
  if (touched.research) writes.push(saveResearch(uid, { points: useResearchStore.getState().points }));
  if (touched.campaign || touched.colonyKeys.length > 0) {
    const s = useUIStore.getState();
    writes.push(saveCampaignProgress(uid, {
      geneLines: s.geneLines, exposure: s.exposure, lastProbeEscapeAt: s.lastProbeEscapeAt,
      alienMatter: s.alienMatter, kardashevTier: s.kardashevTier, strike: s.strike,
      nextStrikeExposure: s.nextStrikeExposure, evacuatedPopulation: s.evacuatedPopulation,
    }));
  }
  for (const key of touched.colonyKeys ?? []) {
    const colony = useColonyStore.getState().colonies[key];
    writes.push(colony ? saveColony(uid, colony) : deleteColony(uid, key));
  }

  for (const key of touched.extractorKeys ?? []) {
    const collectedAt = extractors.extractors[key]?.lastCollectedAt;
    if (collectedAt !== undefined) writes.push(updateExtractorCollected(uid, key, collectedAt));
  }
  for (const key of touched.fabricatorKeys ?? []) {
    const state = fabricatorStates[key];
    if (state) writes.push(saveFabricatorState(uid, key, state));
  }
  // These two are whole-document rewrites shared by every run; only send them when
  // the store objects they mirror have actually been replaced.
  const written = lastWritten.get(uid);
  if (!written || written.ownedUpgrades !== extractors.ownedUpgrades || written.nodeEquipped !== extractors.nodeEquipped) {
    writes.push(saveExtractorUpgrades(uid, {
      ownedUpgrades: extractors.ownedUpgrades,
      nodeEquipped: extractors.nodeEquipped,
    }));
  }
  if (!written || written.materials !== stockpile.materials || written.rares !== stockpile.rares) {
    writes.push(saveStockpile(uid, stockpile.materials, stockpile.rares));
  }
  lastWritten.set(uid, {
    materials: stockpile.materials, rares: stockpile.rares,
    ownedUpgrades: extractors.ownedUpgrades, nodeEquipped: extractors.nodeEquipped,
  });

  return Promise.all(writes);
}
