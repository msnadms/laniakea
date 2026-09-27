import { config } from './config';
import { createApp } from './app';
import { SweepPool } from './sweepPool';

const pool = new SweepPool(config.anomalyKeyHex, config.sweepWorkers);
const app = createApp({ key: config.anomalyKey, pool, devRoutes: config.devRoutes, corsOrigins: config.corsOrigins });

const server = app.listen(config.port, () => {
  console.log(`galaxy-game server on :${config.port}${config.devRoutes ? ' (dev routes on)' : ''}`);
});

const shutdown = () => {
  server.close();
  void pool.close();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
