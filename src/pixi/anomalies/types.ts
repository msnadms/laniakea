import type { Container, Texture } from 'pixi.js';
import type { Anomaly } from '../../game/anomalies';
import type { SurfaceJob } from '../planetSurfaces';
import type { ProjectionBasis } from '../projection';

export interface AnomalyVisualContext {
  anomaly: Anomaly;
  sunRadius: number;
  starColor: number;
  innermostOrbit: number;
  innermostClearance: number;
  planetExtent: number;
  onSelect: () => void;
}

export interface AnomalyVisual {
  nodes: Container[];
  extent: number;
  starAlpha: number;
  coronaAlpha: number;
  nebulaColor?: number;
  surface?: { job: SurfaceJob; textures: Texture[] };
  update(dt: number, elapsed: number, basis: ProjectionBasis): void;
  destroy(): void;
}
