import type { AnomalyVisual } from './types';

export function createHomeworld(): AnomalyVisual {
  return {
    nodes: [],
    extent: 0,
    starAlpha: 1,
    coronaAlpha: 1,
    update: () => undefined,
    destroy: () => undefined,
  };
}
