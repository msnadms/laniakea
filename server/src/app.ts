import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { CONDENSATE_PER_HOMEWORLD, SC_WORLD_HALF, SCAN_UNIVERSE_MAX_RADIUS, TECH_NODE_COSTS } from '../../src/game/constants';
import { scanCost, type ScanScope } from '../../src/game/scan';
import { sweepFinding } from '../../src/game/scanSurvey';
import { moveDefence, placeDefence, placeExtractor, removeDefence, removeExtractor } from '../../src/game/base';
import type { SurfaceCell } from '../../src/game/baseSurface';
import { isDefenceKind, type SlotRef } from '../../src/game/defences';
import { isTechPath, scanDecoyFactor, scanPrecisionFactor } from '../../src/game/tech';
import { locateSupercluster } from '../../src/game/universe';
import { deriveAnomalySeeds, galaxyInSupercluster, type AnomalyKey } from './anomalyKey';
import { requireUser, type AuthedLocals } from './auth';
import { act, claimedRings, found, surfaceDepositAt } from './base';
import { catalogue, surveyGalaxy } from './catalogue';
import { superclusterMark } from './debug';
import { discover } from './discovery';
import { db } from './firebase';
import { finiteParam, HttpError, seedParam } from './httpError';
import { ensureLedger, writeBalance } from './ledger';
import { paths } from './paths';
import { readPosition, recordPosition } from './position';
import { setExplorerName } from './profile';
import { grantTechnology, research } from './tech';
import { availableFuel, ensureShip, grant, readFuel, settleHarvest, shipIsAt, travel } from './ship';
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
const CLAIM_BUCKET = { capacity: 30, refillPerSecond: 1 / 120 };
const SYSTEM_CLAIM_BUCKET = { capacity: 30, refillPerSecond: 1 / 30 };
const SUPERCLUSTER_MAX_RADIUS = SC_WORLD_HALF * 4;
const DEBUG_MARKS_MAX = 50;
const TRAVEL_BUCKET = { capacity: 20, refillPerSecond: 1 };
const RESEARCH_BUCKET = { capacity: 10, refillPerSecond: 0.5 };
const BASE_BUCKET = { capacity: 20, refillPerSecond: 0.5 };
const CLAIMED_BUCKET = { capacity: 10, refillPerSecond: 0.1 };

function newScanId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function slotParam(value: unknown, name: string): SlotRef {
  const raw = (value ?? {}) as { orbit?: unknown; slot?: unknown };
  if (!Number.isInteger(raw.orbit) || !Number.isInteger(raw.slot)) throw new HttpError(400, `${name} must have integer orbit and slot`);
  return { orbit: raw.orbit as number, slot: raw.slot as number };
}

function cellParam(value: unknown): SurfaceCell {
  const raw = (value ?? {}) as { col?: unknown; row?: unknown };
  if (!Number.isInteger(raw.col) || !Number.isInteger(raw.row)) throw new HttpError(400, 'col and row must be integers');
  return { col: raw.col as number, row: raw.row as number };
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
  const claimBuckets = new TokenBuckets(CLAIM_BUCKET);
  const systemClaimBuckets = new TokenBuckets(SYSTEM_CLAIM_BUCKET);

  const throttle = (buckets: TokenBuckets, res: Authed, message: string) => {
    const wait = buckets.take(res.locals.uid);
    if (wait <= 0) return;
    res.setHeader('Retry-After', String(wait));
    throw new HttpError(429, message);
  };
  const travelBuckets = new TokenBuckets(TRAVEL_BUCKET);
  const researchBuckets = new TokenBuckets(RESEARCH_BUCKET);
  const baseBuckets = new TokenBuckets(BASE_BUCKET);
  const claimedBuckets = new TokenBuckets(CLAIMED_BUCKET);
  const mayClaim = (res: Authed) => () => claimBuckets.take(res.locals.uid) <= 0;
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
    const { condensate, technology, tech } = await ensureLedger(res.locals.uid);
    res.json({ condensate, technology, tech });
  });

  api.post('/tech/research', async (req, res: Authed) => {
    const path = req.body?.path;
    if (!isTechPath(path)) throw new HttpError(400, 'path must be capacity, speed or scanning');
    throttle(researchBuckets, res, 'Too many research requests');
    res.json(await research(res.locals.uid, path));
  });

  api.post('/base/found', async (req, res: Authed) => {
    const body = req.body ?? {};
    const { systemId, ring } = body;
    if (!Number.isInteger(systemId) || systemId < 0) throw new HttpError(400, 'systemId must be a non-negative integer');
    if (!Number.isInteger(ring) || ring < 0) throw new HttpError(400, 'ring must be a non-negative integer');
    throttle(baseBuckets, res, 'Too many base requests');
    res.json(await found(key, res.locals.uid, {
      superclusterSeed: seedParam(body.superclusterSeed, 'superclusterSeed'),
      galaxySeed: seedParam(body.galaxySeed, 'galaxySeed'),
      systemId,
      ring,
    }));
  });

  api.post('/base/defence', async (req, res: Authed) => {
    const kind = req.body?.kind;
    if (!isDefenceKind(kind)) throw new HttpError(400, 'kind must be a defence');
    const slot = slotParam(req.body, 'slot');
    throttle(baseBuckets, res, 'Too many base requests');
    res.json(await act(res.locals.uid, (base) => placeDefence(base, slot, kind)));
  });

  api.post('/base/defence/remove', async (req, res: Authed) => {
    const slot = slotParam(req.body, 'slot');
    throttle(baseBuckets, res, 'Too many base requests');
    res.json(await act(res.locals.uid, (base) => removeDefence(base, slot)));
  });

  api.post('/base/defence/move', async (req, res: Authed) => {
    const from = slotParam(req.body?.from, 'from');
    const to = slotParam(req.body?.to, 'to');
    throttle(baseBuckets, res, 'Too many base requests');
    res.json(await act(res.locals.uid, (base) => moveDefence(base, from, to)));
  });

  api.post('/base/extractor', async (req, res: Authed) => {
    const cell = cellParam(req.body);
    throttle(baseBuckets, res, 'Too many base requests');
    res.json(await act(res.locals.uid, (base) => placeExtractor(base, cell, surfaceDepositAt(base, cell), Date.now())));
  });

  api.post('/base/extractor/remove', async (req, res: Authed) => {
    const cell = cellParam(req.body);
    throttle(baseBuckets, res, 'Too many base requests');
    res.json(await act(res.locals.uid, (base) => removeExtractor(base, cell)));
  });

  api.get('/base/claimed/:superclusterSeed/:galaxySeed/:systemId', async (req, res: Authed) => {
    const superclusterSeed = seedParam(req.params.superclusterSeed, 'superclusterSeed');
    const galaxySeed = seedParam(req.params.galaxySeed, 'galaxySeed');
    const systemId = Number(req.params.systemId);
    if (!Number.isInteger(systemId) || systemId < 0) throw new HttpError(400, 'systemId must be a non-negative integer');
    throttle(claimedBuckets, res, 'Too many survey requests');
    res.json({ rings: await claimedRings(res.locals.uid, superclusterSeed, galaxySeed, systemId) });
  });

  api.post('/ship', async (req, res: Authed) => {
    res.json(await ensureShip(res.locals.uid, seedParam(req.body?.superclusterSeed, 'superclusterSeed')));
  });

  api.post('/ship/travel', async (req, res: Authed) => {
    const body = req.body ?? {};
    const to = { x: finiteParam(body.x, 'x'), y: finiteParam(body.y, 'y'), z: finiteParam(body.z, 'z') };
    const superclusterSeed = body.superclusterSeed === undefined || body.superclusterSeed === null
      ? null
      : seedParam(body.superclusterSeed, 'superclusterSeed');
    throttle(travelBuckets, res, 'Too many travel requests');
    res.json(await travel(res.locals.uid, to, superclusterSeed));
  });

  api.get('/galaxy/:superclusterSeed/:galaxySeed/anomaly-seeds', async (req, res: Authed) => {
    const superclusterSeed = seedParam(req.params.superclusterSeed, 'superclusterSeed');
    const galaxySeed = seedParam(req.params.galaxySeed, 'galaxySeed');
    throttle(seedBuckets, res, 'Too many galaxy requests');
    if (!galaxyInSupercluster(superclusterSeed, galaxySeed)) throw new HttpError(404, 'No such galaxy in that supercluster');
    const seeds = deriveAnomalySeeds(key, superclusterSeed, galaxySeed);
    if (req.query.peek === '1') {
      res.json({ seeds, discovery: null });
      return;
    }
    if (!await shipIsAt(res.locals.uid, superclusterSeed)) throw new HttpError(409, 'Your ship is not at that supercluster');
    const [, discovery] = await Promise.all([
      recordPosition(res.locals.uid, { superclusterSeed, galaxySeed }),
      discover(res.locals.uid, superclusterSeed, galaxySeed, null, mayClaim(res)),
    ]);
    res.json({ seeds, discovery });
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
      const { fuel, ledger } = await availableFuel(uid);
      if (fuel < cost) throw new HttpError(402, 'Not enough negative-energy condensate');
      const scanning = ledger.tech.scanning;
      const survey = await pool.run({ scope, sphere, superclusterSeed });
      const tuned = { ...survey, precisionRadius: survey.precisionRadius * scanPrecisionFactor(scanning) };
      const finding = sweepFinding(scope, superclusterSeed, tuned, newScanId(), Date.now(), scanDecoyFactor(scanning));
      const condensate = await db.runTransaction(async (tx) => {
        const current = await readFuel(tx, uid);
        const balance = settleHarvest(tx, uid, current, Date.now());
        if (balance < cost) throw new HttpError(402, 'Not enough negative-energy condensate');
        if (finding) tx.set(paths.scan(uid, finding.id), { ...finding, foundAt: FieldValue.serverTimestamp() });
        return writeBalance(tx, uid, balance, -cost, current.ledger.capacity, { type: 'sweep', scope, radius, findingId: finding?.id ?? null });
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
    res.json(await catalogue(key, res.locals.uid, {
      superclusterSeed: seedParam(body.superclusterSeed, 'superclusterSeed'),
      galaxySeed: seedParam(body.galaxySeed, 'galaxySeed'),
      systemId,
    }));
  });

  api.post('/discover', async (req, res: Authed) => {
    const superclusterSeed = seedParam(req.body?.superclusterSeed, 'superclusterSeed');
    throttle(discoverBuckets, res, 'Too many discovery requests');
    if (locateSupercluster(superclusterSeed) === null) throw new HttpError(404, 'No such supercluster');
    const uid = res.locals.uid;
    const mayClaimSupercluster = async () => await shipIsAt(uid, superclusterSeed) && claimBuckets.take(uid) <= 0;
    res.json({ discovery: await discover(uid, superclusterSeed, null, null, mayClaimSupercluster) });
  });

  api.post('/discover/system', async (req, res: Authed) => {
    const uid = res.locals.uid;
    const body = req.body ?? {};
    const superclusterSeed = seedParam(body.superclusterSeed, 'superclusterSeed');
    const galaxySeed = seedParam(body.galaxySeed, 'galaxySeed');
    const systemId = body.systemId;
    if (!Number.isInteger(systemId) || systemId < 0) throw new HttpError(400, 'systemId must be a non-negative integer');
    throttle(discoverBuckets, res, 'Too many discovery requests');
    if (!galaxyInSupercluster(superclusterSeed, galaxySeed)) throw new HttpError(404, 'No such galaxy in that supercluster');
    if (!surveyGalaxy(key, superclusterSeed, galaxySeed).galaxy.systems[systemId]) throw new HttpError(404, 'No such system in that galaxy');
    const mayClaimSystem = async () => {
      const position = await readPosition(uid);
      if (position?.superclusterSeed !== superclusterSeed || position.galaxySeed !== galaxySeed) return false;
      return systemClaimBuckets.take(uid) <= 0;
    };
    res.json({ discovery: await discover(uid, superclusterSeed, galaxySeed, systemId, mayClaimSystem) });
  });

  api.post('/profile', async (req, res: Authed) => {
    res.json({ explorerName: await setExplorerName(res.locals.uid, req.body?.explorerName) });
  });

  if (devRoutes) {
    api.post('/debug/grant', async (_req, res: Authed) => {
      res.json({ condensate: await grant(res.locals.uid, CONDENSATE_PER_HOMEWORLD) });
    });

    api.post('/debug/grant-technology', async (_req, res: Authed) => {
      res.json(await grantTechnology(res.locals.uid, TECH_NODE_COSTS[TECH_NODE_COSTS.length - 1]));
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
