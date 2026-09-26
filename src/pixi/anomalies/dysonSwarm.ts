import type { Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import type { ProjectionBasis } from '../projection';
import { createCollectorSwarm, PHOTOVOLTAIC_LOOK, RUINED_PHOTOVOLTAIC_LOOK, type CollectorSwarmStyle } from './collectorSwarm';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const LIVING_COLLECTORS: CollectorSwarmStyle = {
  count: 760,
  minRings: 11,
  extraRings: 5,
  radiusSpread: 0.6,
  inclinationSpread: 3.1,
  size: 5.5,
  tumble: false,
  look: PHOTOVOLTAIC_LOOK,
};

const RUINED_COLLECTORS: CollectorSwarmStyle = {
  ...LIVING_COLLECTORS,
  count: 620,
  tumble: true,
  look: RUINED_PHOTOVOLTAIC_LOOK,
};

export function createDysonSwarm({ anomaly, sunRadius, starColor, innermostOrbit, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const style = anomaly.living ? LIVING_COLLECTORS : RUINED_COLLECTORS;
  const outerFactor = 1 + style.radiusSpread / 2;
  const swarmRadius = Math.min(sunRadius * 2.1, innermostOrbit * 0.85 / outerFactor);
  const swarm = createCollectorSwarm(rng, swarmRadius, anomaly.integrity, starColor, onSelect, style);
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
      swarm.destroy();
    },
  };
}
