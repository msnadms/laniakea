import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { CONDENSATE_PER_HOMEWORLD, SC_WORLD_HALF, SCAN_UNIVERSE_MAX_RADIUS } from '../../src/game/constants';
import { scanCost, type ScanScope } from '../../src/game/scan';
import { sweepFinding } from '../../src/game/scanSurvey';
import { deriveAnomalySeeds, galaxyInSupercluster, type AnomalyKey } from './anomalyKey';
import { requireUser, type AuthedLocals } from './auth';
import { catalogue } from './catalogue';
import { superclusterMark } from './debug';
import { discover } from './discovery';
import { db } from './firebase';
import { finiteParam, HttpError, seedParam } from './httpError';
import { ensureLedger, grant, readBalance, writeBalance } from './ledger';
import { paths } from './paths';
import { recordPosition } from './position';
import { setExplorerName } from './profile';
import { TokenBuckets } from './rateLimit';
import type { SweepPool } from './sweepPool';

export interface AppOptions {
  key: AnomalyKey;
  pool: SweepPool;
  devRoutes: boolean;
  corsOrigins: readonly string[];
}

type Authed = Response<unknown, AuthedLocals>;

const SEED_BUCKET = { capacity: 40, refillPerSecond: 0.5 };
const CATALOGUE_BUCKET = { capacity: 10, refillPerSecond: 0.1 };
const DISCOVER_BUCKET = { capacity: 40, refillPerSecond: 0.5 };
const SUPERCLUSTER_MAX_RADIUS = SC_WORLD_HALF * 4;
const DEBUG_MARKS_MAX = 50;

function newScanId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function parseScope(value: unknown): ScanScope {
  if (value !== 'universe' && value !== 'supercluster') throw new HttpError(400, 'scope must be universe or supercluster');
  return value;
}

export function createApp({ key, pool, devRoutes, corsOrigins }: AppOptions) {
  const app = express();
  const seedBuckets = new TokenBuckets(SEED_BUCKET);
  const catalogueBuckets = new TokenBuckets(CATALOGUE_BUCKET);
  const discoverBuckets = new TokenBuckets(DISCOVER_BUCKET);

  const throttle = (buckets: TokenBuckets, res: Authed, message: string) => {
    const wait = buckets.take(res.locals.uid);
    if (wait <= 0) return;
    res.setHeader('Retry-After', String(wait));
    throw new HttpError(429, message);
  };
  const sweeping = new Set<string>();

  app.use(express.json());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') res.sendStatus(204);
    else next();
  });

  const api = express.Router();
  api.use(requireUser);

  api.get('/ledger', async (_req, res: Authed) => {
    res.json({ condensate: await ensureLedger(res.locals.uid) });
  });

  api.get('/galaxy/:superclusterSeed/:galaxySeed/anomaly-seeds', async (req, res: Authed) => {
    const superclusterSeed = seedParam(req.params.superclusterSeed, 'superclusterSeed');
    const galaxySeed = seedParam(req.params.galaxySeed, 'galaxySeed');
    throttle(seedBuckets, res, 'Too many galaxy requests');
    if (!galaxyInSupercluster(superclusterSeed, galaxySeed)) throw new HttpError(404, 'No such galaxy in that supercluster');
    if (req.query.peek !== '1') await recordPosition(res.locals.uid, { superclusterSeed, galaxySeed });
    res.json(deriveAnomalySeeds(key, superclusterSeed, galaxySeed));
  });

  api.post('/scan', async (req, res: Authed) => {
    const uid = res.locals.uid;
    const body = req.body ?? {};
    const scope = parseScope(body.scope);
    const superclusterSeed = scope === 'supercluster' ? seedParam(body.superclusterSeed, 'superclusterSeed') : null;
    const maxRadius = scope === 'universe' ? SCAN_UNIVERSE_MAX_RADIUS : SUPERCLUSTER_MAX_RADIUS;
    const radius = Math.min(maxRadius, finiteParam(body.radius, 'radius'));
    if (radius <= 0) throw new HttpError(400, 'radius must be positive');
    const sphere = { x: finiteParam(body.x, 'x'), y: finiteParam(body.y, 'y'), z: finiteParam(body.z, 'z'), radius };
    const cost = scanCost(scope, radius);

    if (sweeping.has(uid)) throw new HttpError(429, 'A sweep is already running');
    sweeping.add(uid);
    try {
      if (await ensureLedger(uid) < cost) throw new HttpError(402, 'Not enough negative-energy condensate');
      const survey = await pool.run({ scope, sphere, superclusterSeed });
      const finding = sweepFinding(scope, superclusterSeed, survey, newScanId(), Date.now());
      const condensate = await db.runTransaction(async (tx) => {
        const balance = await readBalance(tx, uid);
        if (balance < cost) throw new HttpError(402, 'Not enough negative-energy condensate');
        if (finding) tx.set(paths.scan(uid, finding.id), { ...finding, foundAt: FieldValue.serverTimestamp() });
        return writeBalance(tx, uid, balance, -cost, { type: 'sweep', scope, radius, findingId: finding?.id ?? null });
      });
      res.json({ finding, condensate });
    } finally {
      sweeping.delete(uid);
    }
  });

  api.post('/catalogue', async (req, res: Authed) => {
    const body = req.body ?? {};
    const systemId = body.systemId;
    if (!Number.isInteger(systemId) || systemId < 0) throw new HttpError(400, 'systemId must be a non-negative integer');
    throttle(catalogueBuckets, res, 'Too many catalogue requests');
    res.json(await catalogue(key, res.locals.uid, res.locals.googleName, {
      superclusterSeed: seedParam(body.superclusterSeed, 'superclusterSeed'),
      galaxySeed: seedParam(body.galaxySeed, 'galaxySeed'),
      systemId,
    }));
  });

  api.post('/discover', async (req, res: Authed) => {
    const body = req.body ?? {};
    const superclusterSeed = seedParam(body.superclusterSeed, 'superclusterSeed');
    const galaxySeed = body.galaxySeed === undefined || body.galaxySeed === null ? null : seedParam(body.galaxySeed, 'galaxySeed');
    throttle(discoverBuckets, res, 'Too many discovery requests');
    res.json({ discovery: await discover(res.locals.uid, res.locals.googleName, superclusterSeed, galaxySeed) });
  });

  api.post('/profile', async (req, res: Authed) => {
    res.json({ explorerName: await setExplorerName(res.locals.uid, req.body?.explorerName) });
  });

  if (devRoutes) {
    api.post('/debug/grant', async (_req, res: Authed) => {
      res.json({ condensate: await grant(res.locals.uid, CONDENSATE_PER_HOMEWORLD) });
    });

    api.post('/debug/marks', (req, res: Authed) => {
      const seeds = req.body?.seeds;
      if (!Array.isArray(seeds) || seeds.length > DEBUG_MARKS_MAX) throw new HttpError(400, `seeds must be an array of at most ${DEBUG_MARKS_MAX}`);
      res.json({ marks: seeds.map((seed) => superclusterMark(key, seedParam(seed, 'seed'))) });
    });
  }

  app.use('/api', api);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
