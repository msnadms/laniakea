import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { LANIAKEA_SEED, MILKY_WAY_SEED } from '../../src/game/hardcoded';
import { locateSupercluster } from '../../src/game/universe';
import { galaxyInSupercluster } from './anomalyKey';
import { db } from './firebase';
import { HttpError } from './httpError';
import { paths } from './paths';
import { explorerNameOf } from './profile';

export interface Discovery {
  firstBy: string;
  firstAt: number;
}

export async function discover(uid: string, superclusterSeed: number, galaxySeed: number | null): Promise<Discovery | null> {
  if (locateSupercluster(superclusterSeed) === null) throw new HttpError(404, 'No such supercluster');
  if (galaxySeed !== null && !galaxyInSupercluster(superclusterSeed, galaxySeed)) throw new HttpError(404, 'No such galaxy in that supercluster');
  if (galaxySeed === null ? superclusterSeed === LANIAKEA_SEED : galaxySeed === MILKY_WAY_SEED) return null;
  const ref = galaxySeed === null ? paths.discovery('superclusters', superclusterSeed) : paths.discovery('galaxies', galaxySeed);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return {
        firstBy: snap.get('firstBy') as string,
        firstAt: (snap.get('firstAt') as Timestamp | undefined)?.toMillis() ?? Date.now(),
      };
    }
    const firstBy = explorerNameOf(await tx.get(paths.user(uid)));
    tx.create(ref, { firstBy, firstAt: FieldValue.serverTimestamp() });
    return { firstBy, firstAt: Date.now() };
  });
}
