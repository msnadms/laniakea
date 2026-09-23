import { civilizationProfile, superclusterMayHoldCivilization, type CivilizationProfile } from '../game/anomalies';
import { superclusterGalaxySeeds } from '../game/superclusters';
import { getUniverseChunk, type ChunkRef } from '../game/universe';
import { mergeSignals, signalStrength, type ScanContact, type ScanScope, type ScanSignal, type ScanSphere } from '../game/scan';
import { buildScanGraph, NO_CONTACT_STRENGTH, type ScanGraph } from '../game/scanGraph';
import { SCAN_SEEDS_PER_STEP } from '../game/constants';
import { auth } from '../firebase/firebase';
import { saveScanFinding, type ScanFinding } from '../firebase/scans';
import { useScanStore } from '../store/scanStore';

export interface ScanTarget {
  seed: number;
  x: number;
  y: number;
  z: number;
}

export interface ScanRun {
  sphere: ScanSphere;
  precisionRadius: number;
  total: number;
  done: number;
  step: () => boolean;
  confidence: () => number;
  contact: () => ScanContact | null;
  signals: () => number[];
  graph: () => ScanGraph;
}

const superclusterProfiles = new Map<number, CivilizationProfile | null>();

function stronger(a: CivilizationProfile | null, b: CivilizationProfile): CivilizationProfile {
  if (!a) return b;
  if (b.stage > a.stage) return b;
  if (b.stage === a.stage && b.living && !a.living) return b;
  return a;
}

function flattenSignals(signals: readonly ScanSignal[]): number[] {
  const flat: number[] = [];
  for (const signal of signals) flat.push(signal.x, signal.y, signal.z, signalStrength(signal.profile));
  return flat;
}

export function sampleTargets<T>(targets: readonly T[], max: number): T[] {
  if (targets.length <= max) return [...targets];
  const stride = targets.length / max;
  const sampled: T[] = [];
  for (let i = 0; i < max; i++) sampled.push(targets[Math.floor(i * stride)]);
  return sampled;
}

export interface UniverseScanSource {
  sphere: ScanSphere;
  refs: readonly ChunkRef[];
  maxTargets: number;
}

export function createUniverseScanRun(source: UniverseScanSource, precisionRadius: number): ScanRun {
  const { sphere, refs, maxTargets } = source;
  const radiusSq = sphere.radius * sphere.radius;
  const candidates: ScanTarget[] = [];
  const signals: ScanSignal[] = [];
  let refIndex = 0;
  let targets: ScanTarget[] | null = null;
  let index = 0;
  let seeds: Generator<number> | null = null;
  let best: CivilizationProfile | null = null;

  const finishTarget = (profile: CivilizationProfile | null) => {
    const target = targets![index];
    superclusterProfiles.set(target.seed, profile);
    if (profile) signals.push({ x: target.x, y: target.y, z: target.z, profile });
    seeds = null;
    best = null;
    index++;
  };

  const gather = () => {
    const ref = refs[refIndex++];
    const chunk = getUniverseChunk(ref.ci, ref.cj, ref.ck);
    for (let i = 0; i < chunk.count; i++) {
      const dx = chunk.x[i] - sphere.x;
      const dy = chunk.y[i] - sphere.y;
      const dz = chunk.z[i] - sphere.z;
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
      candidates.push({ seed: chunk.seeds[i], x: chunk.x[i], y: chunk.y[i], z: chunk.z[i] });
    }
  };

  const run: ScanRun = {
    sphere,
    precisionRadius,
    total: refs.length,
    done: 0,
    step: () => {
      if (!targets) {
        if (refIndex < refs.length) {
          gather();
          run.done = refIndex;
          if (refIndex < refs.length) return true;
        }
        candidates.sort((a, b) =>
          (a.x - sphere.x) ** 2 + (a.y - sphere.y) ** 2 + (a.z - sphere.z) ** 2
          - ((b.x - sphere.x) ** 2 + (b.y - sphere.y) ** 2 + (b.z - sphere.z) ** 2));
        targets = sampleTargets(candidates, maxTargets);
        run.total = refs.length + targets.length;
        return targets.length > 0;
      }
      if (index >= targets.length) return false;
      const target = targets[index];
      if (!seeds) {
        const cached = superclusterProfiles.get(target.seed);
        if (cached !== undefined) {
          finishTarget(cached);
          run.done = refs.length + index;
          return index < targets.length;
        }
        if (!superclusterMayHoldCivilization(target.seed)) {
          finishTarget(null);
          run.done = refs.length + index;
          return index < targets.length;
        }
        seeds = superclusterGalaxySeeds(target.seed);
      }
      for (let walked = 0; walked < SCAN_SEEDS_PER_STEP; walked++) {
        const next = seeds.next();
        if (next.done) {
          finishTarget(best);
          break;
        }
        const profile = civilizationProfile(next.value);
        if (profile) best = stronger(best, profile);
      }
      run.done = refs.length + index;
      return index < targets.length;
    },
    confidence: () => (candidates.length === 0 ? 1 : (targets?.length ?? 0) / candidates.length),
    contact: () => mergeSignals(signals, precisionRadius),
    signals: () => flattenSignals(signals),
    graph: () => buildScanGraph(sphere, candidates),
  };
  return run;
}

export function createSuperclusterScanRun(
  targets: readonly ScanTarget[],
  sphere: ScanSphere,
  precisionRadius: number,
): ScanRun {
  const signals: ScanSignal[] = [];
  let index = 0;

  const run: ScanRun = {
    sphere,
    precisionRadius,
    total: targets.length,
    done: 0,
    step: () => {
      const end = Math.min(targets.length, index + SCAN_SEEDS_PER_STEP);
      while (index < end) {
        const target = targets[index++];
        const profile = civilizationProfile(target.seed);
        if (profile) signals.push({ x: target.x, y: target.y, z: target.z, profile });
      }
      run.done = index;
      return index < targets.length;
    },
    confidence: () => 1,
    contact: () => mergeSignals(signals, precisionRadius),
    signals: () => flattenSignals(signals),
    graph: () => ({ nodes: [], edges: [] }),
  };
  return run;
}

function newScanId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

export function recordSweep(scope: ScanScope, superclusterSeed: number | null, run: ScanRun): void {
  const store = useScanStore.getState();
  const contact = run.contact();
  const graph = run.graph();
  const drawable = scope === 'universe' ? contact !== null || graph.nodes.length > 3 : contact !== null;
  const finding: ScanFinding = {
    id: newScanId(),
    scope,
    superclusterSeed,
    x: run.sphere.x,
    y: run.sphere.y,
    z: run.sphere.z,
    radius: run.sphere.radius,
    markX: contact?.x ?? run.sphere.x,
    markY: contact?.y ?? run.sphere.y,
    markZ: contact?.z ?? run.sphere.z,
    bloom: run.precisionRadius,
    confidence: run.confidence(),
    signals: run.signals(),
    strength: contact?.strength ?? NO_CONTACT_STRENGTH,
    sources: contact?.sources ?? 0,
    nodes: graph.nodes,
    edges: graph.edges,
    foundAt: Date.now(),
  };
  if (!drawable) {
    store.setOutcome('No contact', null);
    return;
  }
  store.addFinding(finding);
  const barren = finding.confidence >= 1 ? 'No contact — volume swept' : 'No contact — volume sampled';
  store.setOutcome(contact ? 'Contact' : barren, contact?.strength ?? null);
  const uid = auth.currentUser?.uid;
  if (uid) saveScanFinding(uid, finding).catch((err) => console.error('saveScanFinding failed:', err));
}
