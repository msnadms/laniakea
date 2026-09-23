import {
  SCAN_COST_MIN,
  SCAN_COST_RADIUS_EXPONENT,
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

export const SCAN_STRENGTH_TIERS = 4;

export function signalStrength(profile: CivilizationProfile): number {
  const tier = profile.stage <= 2 ? 0 : profile.stage <= 4 ? 1 : profile.stage === 5 ? 2 : 3;
  return Math.min(SCAN_STRENGTH_TIERS - 1, tier + (profile.living ? 1 : 0));
}

function fullRadius(scope: ScanScope): number {
  return scope === 'universe' ? SCAN_UNIVERSE_FULL_RADIUS : SCAN_SUPERCLUSTER_FULL_RADIUS;
}

export function scanRadiusFraction(scope: ScanScope, radius: number): number {
  return Math.min(1, Math.max(0, radius) / fullRadius(scope));
}

export function scanVolumeFraction(scope: ScanScope, radius: number): number {
  const ratio = scanRadiusFraction(scope, radius);
  return ratio * ratio * ratio;
}

export function scanCost(scope: ScanScope, radius: number): number {
  const span = scope === 'universe' ? SCAN_COST_UNIVERSE_SPAN : SCAN_COST_SUPERCLUSTER_SPAN;
  const reach = Math.pow(scanRadiusFraction(scope, radius), SCAN_COST_RADIUS_EXPONENT);
  return Math.round(SCAN_COST_MIN + span * reach);
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
