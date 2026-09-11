import { createBlackHole } from './blackHole';
import { createDysonSphere } from './dysonSphere';
import { createMatrioshkaBrain } from './matrioshkaBrain';
import { createNicollDysonBeam } from './nicollDysonBeam';
import { createShkadovThruster } from './shkadovThruster';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

export type { AnomalyVisual, AnomalyVisualContext } from './types';

export function createAnomalyVisual(context: AnomalyVisualContext): AnomalyVisual {
  switch (context.anomaly.kind) {
    case 'blackHole': return createBlackHole(context);
    case 'dysonSphere': return createDysonSphere(context);
    case 'matrioshkaBrain': return createMatrioshkaBrain(context);
    case 'nicollDysonBeam': return createNicollDysonBeam(context);
    case 'shkadovThruster': return createShkadovThruster(context);
  }
}
