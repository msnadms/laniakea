import { CIVILIZATION_STAGE_PLANS, CIVILIZATION_STAGES, hasCivilization, MEGASTRUCTURE_KINDS, type CivilizationStage, type StagePlan } from './anomalies';
import {
  ANOMALY_LIVING_CHANCE,
  ANOMALY_MEGASTRUCTURES_SOME_MAX,
  ANOMALY_MEGASTRUCTURES_SOME_MIN,
  ANOMALY_RUINED_MIN_STAGE,
  ANOMALY_STAGE_WEIGHTS,
} from './constants';

export function findCivilizationSeeds(count: number, start: number) {
  const seeds: number[] = [];
  for (let seed = start; seeds.length < count; seed = (seed + 7919) >>> 0) {
    if (hasCivilization(seed)) seeds.push(seed);
  }
  return seeds;
}

function totalWeight(stages: readonly CivilizationStage[]) {
  return stages.reduce((sum, stage) => sum + ANOMALY_STAGE_WEIGHTS[stage], 0);
}

export function expectedStageShare(stage: CivilizationStage): number {
  const weight = ANOMALY_STAGE_WEIGHTS[stage];
  const ruinedStages = CIVILIZATION_STAGES.filter((s) => s >= ANOMALY_RUINED_MIN_STAGE);
  const ruinedShare = stage >= ANOMALY_RUINED_MIN_STAGE ? weight / totalWeight(ruinedStages) : 0;
  return ANOMALY_LIVING_CHANCE * weight / totalWeight(CIVILIZATION_STAGES) + (1 - ANOMALY_LIVING_CHANCE) * ruinedShare;
}

export function expectedShareWhere(chance: (plan: StagePlan) => number): number {
  return CIVILIZATION_STAGES.reduce((sum, stage) => sum + expectedStageShare(stage) * chance(CIVILIZATION_STAGE_PLANS[stage]), 0);
}

export function megastructureChance(plan: StagePlan): number {
  if (plan.megastructures === 'none') return 0;
  if (plan.megastructures === 'all') return 1;
  return (ANOMALY_MEGASTRUCTURES_SOME_MIN + ANOMALY_MEGASTRUCTURES_SOME_MAX) / 2 / MEGASTRUCTURE_KINDS.length;
}
