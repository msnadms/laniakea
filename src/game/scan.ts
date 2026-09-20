import {
  SCAN_COST_MIN,
  SCAN_COST_SUPERCLUSTER_SPAN,
  SCAN_COST_UNIVERSE_SPAN,
  SCAN_PRECISION_FRACTION,
  SCAN_SUPERCLUSTER_FULL_RADIUS,
  SCAN_SUPERCLUSTER_MIN_RADIUS,
  SCAN_UNIVERSE_FULL_RADIUS,
  SCAN_UNIVERSE_MIN_RADIUS,
} from './constants';
import type { CivilizationProfile } from './anomalies';

export type ScanScope = 'universe' | 'supercluster';

export interface ScanSphere {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface ScanSignal {
  x: number;
  y: number;
  z: number;
  profile: CivilizationProfile;
}

export interface ScanContact {
  x: number;
  y: number;
  z: number;
  radius: number;
  strength: number;
  sources: number;
}

export const SCAN_STRENGTH_LABELS = ['Faint', 'Clear', 'Strong', 'Overwhelming'];

export const SCAN_STRENGTH_COLORS = [0x3fd8c8, 0x6ee06a, 0xffc24a, 0xff5a3c];

export function signalStrength(profile: CivilizationProfile): number {
  const tier = profile.stage <= 2 ? 0 : profile.stage <= 4 ? 1 : profile.stage === 5 ? 2 : 3;
  return Math.min(SCAN_STRENGTH_LABELS.length - 1, tier + (profile.living ? 1 : 0));
}

function fullRadius(scope: ScanScope): number {
  return scope === 'universe' ? SCAN_UNIVERSE_FULL_RADIUS : SCAN_SUPERCLUSTER_FULL_RADIUS;
}

export function scanVolumeFraction(scope: ScanScope, radius: number): number {
  const ratio = Math.max(0, radius) / fullRadius(scope);
  return Math.min(1, ratio * ratio * ratio);
}

export function scanCost(scope: ScanScope, radius: number): number {
  const span = scope === 'universe' ? SCAN_COST_UNIVERSE_SPAN : SCAN_COST_SUPERCLUSTER_SPAN;
  return Math.round(SCAN_COST_MIN + span * scanVolumeFraction(scope, radius));
}

export function scanPrecisionRadius(scope: ScanScope, radius: number): number {
  const min = scope === 'universe' ? SCAN_UNIVERSE_MIN_RADIUS : SCAN_SUPERCLUSTER_MIN_RADIUS;
  return Math.max(min, radius * SCAN_PRECISION_FRACTION);
}

export function mergeSignals(signals: readonly ScanSignal[], precisionRadius: number): ScanContact | null {
  if (signals.length === 0) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const signal of signals) {
    cx += signal.x;
    cy += signal.y;
    cz += signal.z;
  }
  cx /= signals.length;
  cy /= signals.length;
  cz /= signals.length;
  let spread = 0;
  let strength = 0;
  for (const signal of signals) {
    spread = Math.max(spread, Math.hypot(signal.x - cx, signal.y - cy, signal.z - cz));
    strength = Math.max(strength, signalStrength(signal.profile));
  }
  return { x: cx, y: cy, z: cz, radius: Math.max(precisionRadius, spread), strength, sources: signals.length };
}
