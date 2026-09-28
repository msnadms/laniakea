import { FieldValue, type DocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import { discoveryId, isChartedHome, type Discovery } from '../../src/game/discovery';
import { db } from './firebase';
import { paths } from './paths';
import { explorerNameOf } from './profile';

function readDiscovery(snap: DocumentSnapshot): Discovery {
  return {
    firstBy: snap.get('firstBy') as string,
    firstAt: (snap.get('firstAt') as Timestamp | undefined)?.toMillis() ?? Date.now(),
  };
}

export async function discover(
  uid: string,
  superclusterSeed: number,
  galaxySeed: number | null,
  systemId: number | null,
  mayClaim: () => boolean | Promise<boolean>,
): Promise<Discovery | null> {
  if (isChartedHome(superclusterSeed, galaxySeed)) return null;
  const kind = galaxySeed === null ? 'superclusters' : systemId === null ? 'galaxies' : 'systems';
  const ref = paths.discovery(kind, discoveryId(superclusterSeed, galaxySeed, systemId));
  const known = await ref.get();
  if (known.exists) return readDiscovery(known);
  if (!await mayClaim()) return null;
  return db.runTransaction(async (tx) => {
    const [snap, user] = await Promise.all([tx.get(ref), tx.get(paths.user(uid))]);
    if (snap.exists) return readDiscovery(snap);
    const firstBy = explorerNameOf(user);
    if (!firstBy) return null;
    tx.create(ref, { firstBy, firstAt: FieldValue.serverTimestamp() });
    return { firstBy, firstAt: Date.now() };
  });
}
