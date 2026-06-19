import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { StarSystem, StarType } from '../game/types';

export interface SystemRecord {
  name: string;
  starType: StarType;
  seed: number;
  discoveredAt: number;
}

export interface GalaxyRecord {
  galaxySeed: number;
  galaxyName: string;
  discoveredAt: number;
  systems: Record<string, SystemRecord>;
}

export interface SuperclusterRecord {
  superclusterSeed: number;
  superclusterName: string;
  discoveredAt: number;
  galaxies: Record<string, GalaxyRecord>;
}

type FirestoreTimestamp = { toMillis?: () => number };

export async function saveSuperclusterDiscovery(
  uid: string,
  superclusterSeed: number,
  superclusterName: string
): Promise<void> {
  const ref = doc(db, 'users', uid, 'discoveries', String(superclusterSeed));
  await setDoc(
    ref,
    {
      superclusterName,
      superclusterSeed,
      discoveredAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function saveGalaxyDiscovery(
  uid: string,
  superclusterSeed: number,
  galaxySeed: number,
  galaxyName: string,
): Promise<void> {
  const ref = doc(db, 'users', uid, 'discoveries', String(superclusterSeed), 'galaxies', String(galaxySeed));
  await setDoc(
    ref,
    {
      galaxyName,
      galaxySeed,
      discoveredAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function saveSystemDiscovery(
  uid: string,
  superclusterSeed: number,
  galaxySeed: number,
  system: StarSystem,
): Promise<void> {
  const ref = doc(db, 'users', uid, 'discoveries', String(superclusterSeed), 'galaxies', String(galaxySeed));
  await setDoc(
    ref,
    {
      systems: {
        [String(system.id)]: {
          name: system.name,
          starType: system.starType,
          seed: system.seed,
          discoveredAt: serverTimestamp(),
        },
      },
    },
    { merge: true },
  );
}

export async function deleteSystemDiscovery(
  uid: string,
  superclusterSeed: number,
  galaxySeed: number,
  systemId: string,
): Promise<void> {
  const ref = doc(db, 'users', uid, 'discoveries', String(superclusterSeed), 'galaxies', String(galaxySeed));
  await updateDoc(ref, { [`systems.${systemId}`]: deleteField() });
}

export async function deleteGalaxyDiscovery(
  uid: string,
  superclusterSeed: number,
  galaxySeed: number,
): Promise<void> {
  const ref = doc(db, 'users', uid, 'discoveries', String(superclusterSeed), 'galaxies', String(galaxySeed));
  await deleteDoc(ref);
}

export async function deleteSuperclusterDiscovery(
  uid: string,
  superclusterSeed: number,
): Promise<void> {
  const galaxySnap = await getDocs(
    collection(db, 'users', uid, 'discoveries', String(superclusterSeed), 'galaxies'),
  );
  await Promise.all(galaxySnap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'users', uid, 'discoveries', String(superclusterSeed)));
}

export async function loadAllDiscoveries(uid: string): Promise<SuperclusterRecord[]> {
  const scSnap = await getDocs(collection(db, 'users', uid, 'discoveries'));

  return Promise.all(
    scSnap.docs.map(async (scDoc) => {
      const scData = scDoc.data();
      const galaxySnap = await getDocs(
        collection(db, 'users', uid, 'discoveries', scDoc.id, 'galaxies'),
      );
      const galaxies: Record<string, GalaxyRecord> = {};

      for (const gDoc of galaxySnap.docs) {
        const gData = gDoc.data();
        const systems: Record<string, SystemRecord> = {};
        if (gData.systems) {
          for (const [id, s] of Object.entries(
            gData.systems as Record<string, SystemRecord & { discoveredAt: FirestoreTimestamp }>,
          )) {
            systems[id] = {
              name: s.name,
              starType: s.starType,
              seed: s.seed,
              discoveredAt: s.discoveredAt?.toMillis?.() ?? Date.now(),
            };
          }
        }
        galaxies[gDoc.id] = {
          galaxySeed: gData.galaxySeed as number,
          galaxyName: gData.galaxyName as string,
          discoveredAt: (gData.discoveredAt as FirestoreTimestamp)?.toMillis?.() ?? Date.now(),
          systems,
        };
      }

      return {
        superclusterSeed: scData.superclusterSeed as number,
        superclusterName: scData.superclusterName as string,
        discoveredAt: (scData.discoveredAt as FirestoreTimestamp)?.toMillis?.() ?? Date.now(),
        galaxies,
      };
    }),
  );
}
