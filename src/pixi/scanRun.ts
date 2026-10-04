import type { ScanFinding, ScanScope, ScanSphere } from '../game/scan';
import { sweepOutcome } from '../game/scanSurvey';
import { api, ApiError } from '../net/api';
import { useScanStore } from '../store/scanStore';

const PROGRESS_EASE_SECS = 1.2;
const PROGRESS_CEILING = 0.95;
const PROGRESS_INTERVAL_MS = 50;

interface SweepResponse {
  finding: ScanFinding | null;
  condensate: number;
}

export interface PendingSweep {
  sphere: ScanSphere;
  settled: boolean;
}

let running: PendingSweep | null = null;

export function sweepRunning(): boolean {
  return running !== null;
}

function failureText(err: unknown): string {
  if (err instanceof ApiError && err.status === 402) return 'Not enough negative-energy condensate';
  if (err instanceof ApiError && err.status === 429) return 'Probes still away';
  console.error('sweep failed:', err);
  return 'Probes lost, sweep failed';
}

export function startSweep(scope: ScanScope, sphere: ScanSphere, superclusterSeed: number | null): PendingSweep {
  const sweep: PendingSweep = { sphere, settled: false };
  running = sweep;
  const startedAt = performance.now();
  const ease = () => {
    const elapsed = (performance.now() - startedAt) / 1000;
    useScanStore.getState().setProgress({ scope, fraction: PROGRESS_CEILING * (1 - Math.exp(-elapsed / PROGRESS_EASE_SECS)) });
  };
  ease();
  const timer = window.setInterval(ease, PROGRESS_INTERVAL_MS);

  api<SweepResponse>('/scan', { scope, superclusterSeed, x: sphere.x, y: sphere.y, z: sphere.z, radius: sphere.radius })
    .then(({ finding, condensate }) => {
      const store = useScanStore.getState();
      store.setCondensate(condensate);
      if (finding) store.addFinding(finding);
      const outcome = sweepOutcome(finding);
      store.setOutcome(outcome.text, outcome.strength);
    })
    .catch((err) => useScanStore.getState().setOutcome(failureText(err), null))
    .finally(() => {
      window.clearInterval(timer);
      sweep.settled = true;
      if (running !== sweep) return;
      running = null;
      useScanStore.getState().setProgress(null);
    });
  return sweep;
}
