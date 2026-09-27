import type { ScanScope, ScanSphere } from '../../src/game/scan';
import { surveySupercluster, surveyUniverse, type SweepSurvey } from '../../src/game/scanSurvey';
import { civilizationProfileOf, type AnomalyKey } from './anomalyKey';

export interface SweepJob {
  scope: ScanScope;
  sphere: ScanSphere;
  superclusterSeed: number | null;
}

export function runSurvey(key: AnomalyKey, job: SweepJob): SweepSurvey {
  const profileOf = (superclusterSeed: number) => civilizationProfileOf(key, superclusterSeed);
  if (job.scope === 'universe') return surveyUniverse(job.sphere, profileOf);
  return surveySupercluster(job.superclusterSeed!, job.sphere, profileOf);
}
