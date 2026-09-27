import { Worker } from 'node:worker_threads';
import type { SweepSurvey } from '../../src/game/scanSurvey';
import type { SweepJob } from './sweep';

interface Pending {
  id: number;
  job: SweepJob;
  resolve: (survey: SweepSurvey) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  running: Pending | null;
  timer: NodeJS.Timeout | null;
  failure: Error | null;
}

const SWEEP_TIMEOUT_MS = 45_000;

type Reply = { id: number; survey: SweepSurvey } | { id: number; error: string };

export class SweepPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Pending[] = [];
  private nextId = 0;
  private closed = false;
  private readonly keyHex: string;

  constructor(keyHex: string, size: number) {
    this.keyHex = keyHex;
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  run(job: SweepJob): Promise<SweepSurvey> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, job, resolve, reject });
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const pending of this.queue.splice(0)) pending.reject(new Error('Sweep pool closed'));
    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('./sweepWorker.mjs', import.meta.url), { workerData: { key: this.keyHex } });
    const slot: Slot = { worker, running: null, timer: null, failure: null };
    worker.on('message', (reply: Reply) => {
      const pending = slot.running;
      if (!pending || pending.id !== reply.id) return;
      this.settle(slot);
      if ('error' in reply) pending.reject(new Error(reply.error));
      else pending.resolve(reply.survey);
      this.dispatch();
    });
    worker.on('error', (err) => {
      slot.failure = err;
    });
    worker.on('exit', (code) => {
      const pending = slot.running;
      this.settle(slot);
      pending?.reject(slot.failure ?? new Error(`Sweep worker exited with code ${code}`));
      if (this.closed) return;
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots[index] = this.spawn();
      this.dispatch();
    });
    return slot;
  }

  private settle(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.running = null;
  }

  private dispatch() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.running) continue;
      const next = this.queue.shift();
      if (!next) return;
      slot.running = next;
      slot.timer = setTimeout(() => {
        slot.failure = new Error('Sweep timed out');
        void slot.worker.terminate();
      }, SWEEP_TIMEOUT_MS);
      slot.worker.postMessage({ id: next.id, job: next.job });
    }
  }
}
