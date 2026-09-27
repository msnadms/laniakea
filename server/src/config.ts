import { existsSync } from 'node:fs';
import { parseAnomalyKey, type AnomalyKey } from './anomalyKey';

const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export interface ServerConfig {
  port: number;
  anomalyKeyHex: string;
  anomalyKey: AnomalyKey;
  devRoutes: boolean;
  sweepWorkers: number;
  corsOrigins: string[];
}

function readSweepWorkers(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 2;
  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1) throw new Error('SWEEP_WORKERS must be a positive integer');
  return workers;
}

function readConfig(): ServerConfig {
  const anomalyKeyHex = (process.env.ANOMALY_KEY ?? '').trim();
  return {
    port: Number(process.env.PORT ?? 8787),
    anomalyKeyHex,
    anomalyKey: parseAnomalyKey(anomalyKeyHex),
    devRoutes: process.env.DEV_ROUTES === '1',
    sweepWorkers: readSweepWorkers(process.env.SWEEP_WORKERS),
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}

export const config = readConfig();
