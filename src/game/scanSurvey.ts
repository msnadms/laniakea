import type { CivilizationProfile } from './anomalies';
import { SCAN_UNIVERSE_MAX_TARGETS } from './constants';
import {
  mergeSignals,
  scanPrecisionRadius,
  signalStrength,
  type ScanFinding,
  type ScanScope,
  type ScanSignal,
  type ScanSphere,
} from './scan';
import { buildScanGraph, NO_CONTACT_STRENGTH, type ScanGraph } from './scanGraph';
import { superclusterDotAt } from './superclusters';
import { getUniverseChunk, universeChunksNear } from './universe';

export interface SuperclusterCivilization {
  index: number;
  profile: CivilizationProfile;
}

export type ProfileOf = (superclusterSeed: number) => SuperclusterCivilization | null;

export type DotAt = (superclusterSeed: number, index: number) => { x: number; y: number; z: number } | null;

export interface ScanTarget {
  seed: number;
  x: number;
  y: number;
  z: number;
}

export interface SweepSurvey {
  sphere: ScanSphere;
  precisionRadius: number;
  confidence: number;
  signals: ScanSignal[];
  graph: ScanGraph;
}

function inSphere(sphere: ScanSphere, x: number, y: number, z: number): boolean {
  const dx = x - sphere.x;
  const dy = y - sphere.y;
  const dz = z - sphere.z;
  return dx * dx + dy * dy + dz * dz <= sphere.radius * sphere.radius;
}

function distanceSq(sphere: ScanSphere, target: ScanTarget): number {
  return (target.x - sphere.x) ** 2 + (target.y - sphere.y) ** 2 + (target.z - sphere.z) ** 2;
}

export function sampleTargets<T>(targets: readonly T[], max: number): T[] {
  if (targets.length <= max) return [...targets];
  const stride = targets.length / max;
  const sampled: T[] = [];
  for (let i = 0; i < max; i++) sampled.push(targets[Math.floor(i * stride)]);
  return sampled;
}

export function universeScanCandidates(sphere: ScanSphere): ScanTarget[] {
  const candidates: ScanTarget[] = [];
  for (const ref of universeChunksNear(sphere.x, sphere.y, sphere.z, sphere.radius)) {
    const chunk = getUniverseChunk(ref.ci, ref.cj, ref.ck);
    for (let i = 0; i < chunk.count; i++) {
      if (!inSphere(sphere, chunk.x[i], chunk.y[i], chunk.z[i])) continue;
      candidates.push({ seed: chunk.seeds[i], x: chunk.x[i], y: chunk.y[i], z: chunk.z[i] });
    }
  }
  return candidates.sort((a, b) => distanceSq(sphere, a) - distanceSq(sphere, b));
}

export function surveyUniverse(sphere: ScanSphere, profileOf: ProfileOf, maxTargets = SCAN_UNIVERSE_MAX_TARGETS): SweepSurvey {
  const candidates = universeScanCandidates(sphere);
  const targets = sampleTargets(candidates, maxTargets);
  const signals: ScanSignal[] = [];
  for (const target of targets) {
    const civilization = profileOf(target.seed);
    if (civilization) signals.push({ x: target.x, y: target.y, z: target.z, profile: civilization.profile });
  }
  return {
    sphere,
    precisionRadius: scanPrecisionRadius('universe', sphere.radius),
    confidence: candidates.length === 0 ? 1 : targets.length / candidates.length,
    signals,
    graph: buildScanGraph(sphere, candidates),
  };
}

export function surveySupercluster(
  superclusterSeed: number,
  sphere: ScanSphere,
  profileOf: ProfileOf,
  dotAt: DotAt = superclusterDotAt,
): SweepSurvey {
  const signals: ScanSignal[] = [];
  const civilization = profileOf(superclusterSeed);
  const dot = civilization ? dotAt(superclusterSeed, civilization.index) : null;
  if (civilization && dot && inSphere(sphere, dot.x, dot.y, dot.z)) {
    signals.push({ x: dot.x, y: dot.y, z: dot.z, profile: civilization.profile });
  }
  return {
    sphere,
    precisionRadius: scanPrecisionRadius('supercluster', sphere.radius),
    confidence: 1,
    signals,
    graph: { nodes: [], edges: [] },
  };
}

function flattenSignals(signals: readonly ScanSignal[]): number[] {
  const flat: number[] = [];
  for (const signal of signals) flat.push(signal.x, signal.y, signal.z, signalStrength(signal.profile));
  return flat;
}

export function sweepFinding(
  scope: ScanScope,
  superclusterSeed: number | null,
  survey: SweepSurvey,
  id: string,
  foundAt: number,
): ScanFinding | null {
  const contact = mergeSignals(survey.signals, survey.precisionRadius);
  const drawable = contact !== null || (scope === 'universe' && survey.graph.nodes.length > 3);
  if (!drawable) return null;
  const { sphere } = survey;
  return {
    id,
    scope,
    superclusterSeed,
    x: sphere.x,
    y: sphere.y,
    z: sphere.z,
    radius: sphere.radius,
    markX: contact?.x ?? sphere.x,
    markY: contact?.y ?? sphere.y,
    markZ: contact?.z ?? sphere.z,
    bloom: survey.precisionRadius,
    confidence: survey.confidence,
    signals: flattenSignals(survey.signals),
    strength: contact?.strength ?? NO_CONTACT_STRENGTH,
    sources: contact?.sources ?? 0,
    nodes: survey.graph.nodes,
    edges: survey.graph.edges,
    foundAt,
  };
}

export function sweepOutcome(finding: ScanFinding | null): { text: string; strength: number | null } {
  if (!finding) return { text: 'No contact', strength: null };
  if (finding.sources > 0) return { text: 'Contact', strength: finding.strength };
  return { text: finding.confidence >= 1 ? 'No contact — volume swept' : 'No contact — volume sampled', strength: null };
}
