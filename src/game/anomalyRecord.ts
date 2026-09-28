import type { AnomalyKind } from './anomalies';

export interface AnomalyRecord {
  kind: AnomalyKind;
  living: boolean;
  superclusterSeed: number;
  superclusterName: string;
  galaxySeed: number;
  galaxyName: string;
  systemId: number;
  systemName: string;
  discoveredAt: number;
}

export interface WorldAnomaly {
  firstBy: string;
  firstAt: number;
  count: number;
}

export function anomalyRecordKey(superclusterSeed: number, galaxySeed: number, systemId: number | string): string {
  return `${superclusterSeed}-${galaxySeed}-${systemId}`;
}
