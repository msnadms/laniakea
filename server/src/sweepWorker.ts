import { parentPort, workerData } from 'node:worker_threads';
import { parseAnomalyKey } from './anomalyKey';
import { runSurvey, type SweepJob } from './sweep';

const key = parseAnomalyKey((workerData as { key: string }).key);

parentPort!.on('message', ({ id, job }: { id: number; job: SweepJob }) => {
  try {
    parentPort!.postMessage({ id, survey: runSurvey(key, job) });
  } catch (err) {
    parentPort!.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
