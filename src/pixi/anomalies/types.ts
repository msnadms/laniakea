import type { Container } from 'pixi.js';
import type { Anomaly } from '../../game/anomalies';
import type { ProjectionBasis } from '../projection';

export interface AnomalyVisualContext {
  anomaly: Anomaly;
  sunRadius: number;
  starColor: number;
  innermostOrbit: number;
  planetExtent: number;
  onSelect: () => void;
}

export interface AnomalyVisual {
  nodes: Container[];
  extent: number;
  starAlpha: number;
  coronaAlpha: number;
  nebulaColor?: number;
  update(dt: number, elapsed: number, basis: ProjectionBasis): void;
  destroy(): void;
}
