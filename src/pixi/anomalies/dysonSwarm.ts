import type { Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import type { ProjectionBasis } from '../projection';
import { createCollectorSwarm, type CollectorSwarmStyle } from './collectorSwarm';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const LIVING_COLLECTORS: CollectorSwarmStyle = {
  count: 760,
  minRings: 11,
  extraRings: 5,
  radiusSpread: 0.6,
  inclinationSpread: 3.1,
  size: 3.6,
  backColor: 0xcdb68a,
  backAlpha: 0.35,
  frontColor: 0xffe8bc,
  frontAlpha: 0.9,
};

const RUINED_COLLECTORS: CollectorSwarmStyle = {
  ...LIVING_COLLECTORS,
  count: 620,
  backColor: 0x3a322b,
  backAlpha: 0.5,
  frontColor: 0x6e604f,
  frontAlpha: 0.92,
};

export function createDysonSwarm({ anomaly, sunRadius, innermostOrbit, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const style = anomaly.living ? LIVING_COLLECTORS : RUINED_COLLECTORS;
  const outerFactor = 1 + style.radiusSpread / 2;
  const swarmRadius = Math.min(sunRadius * 2.1, innermostOrbit * 0.85 / outerFactor);
  const swarm = createCollectorSwarm(rng, swarmRadius, anomaly.integrity, onSelect, style);
  const nodes: Container[] = [swarm.back, swarm.front];

  return {
    nodes,
    extent: swarmRadius * outerFactor,
    starAlpha: anomaly.living ? 1 - 0.15 * anomaly.integrity : 1,
    coronaAlpha: anomaly.living ? 1 - 0.3 * anomaly.integrity : 0.9,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      swarm.update(elapsed, basis);
    },
    destroy() {
      for (const node of nodes) node.destroy();
    },
  };
}
