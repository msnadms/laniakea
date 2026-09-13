import { createAlcubierreCannon } from './alcubierreCannon';
import { createAldersonDisk } from './aldersonDisk';
import { createBlackHole } from './blackHole';
import { createCaplanThruster } from './caplanThruster';
import { createDysonSphere } from './dysonSphere';
import { createDysonSwarm } from './dysonSwarm';
import { createHomeworld } from './homeworld';
import { createMatrioshkaBrain } from './matrioshkaBrain';
import { createNicollDysonBeam } from './nicollDysonBeam';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

export type { AnomalyVisual, AnomalyVisualContext } from './types';

export function createAnomalyVisual(context: AnomalyVisualContext): AnomalyVisual {
  switch (context.anomaly.kind) {
    case 'alcubierreCannon': return createAlcubierreCannon(context);
    case 'aldersonDisk': return createAldersonDisk(context);
    case 'blackHole': return createBlackHole(context);
    case 'caplanThruster': return createCaplanThruster(context);
    case 'dysonSphere': return createDysonSphere(context);
    case 'homeworld': return context.anomaly.swarm ? createDysonSwarm(context) : createHomeworld();
    case 'matrioshkaBrain': return createMatrioshkaBrain(context);
    case 'nicollDysonBeam': return createNicollDysonBeam(context);
  }
}
