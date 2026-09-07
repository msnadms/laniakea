import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { db } from './firebase';
import { MILKY_WAY_SEED, LANIAKEA_SEED, DEFAULT_ADDRESS } from '../game/hardcoded';
import type { AddressComponent, CannonStrike } from '../game/types';

export interface UserSettings {
  exposure: number;
  lastProbeEscapeAt: number;
  alienMatter: number;
  kardashevTier: number;
  strike: CannonStrike | null;
  nextStrikeExposure: number;
  evacuatedPopulation: number;
  showOrbitRings: boolean;
  showAttractorLabels: boolean;
  showHUD: boolean;
  showBootSequence: boolean;
  infiniteExplore: boolean;
  exoticMatter: number;
  detectionRating: number;
  detectionHeat: number;
  lastDetectionChangeAt: number;
  lastPurgeAt: number;
  railgunAmmo: number;
  lastFireAt: number;
  helium3Reserves: number;
  alloys: number;
  nutrients: number;
  metallicHydrogen: number;
  neutronMatter: number;
  storageA: number;
  storageB: number;
  driveA: number;
  driveB: number;
  weaponA: number;
  weaponB: number;
  logisticsA: number;
  logisticsB: number;
  lastView: 'system' | 'galaxy' | 'supercluster';
  lastSuperclusterSeed: number;
  lastGalaxySeed: number;
  lastSystemId: number | null;
  address: AddressComponent[];
}

export const defaultSettings: UserSettings = {
  exposure: 0, lastProbeEscapeAt: 0, alienMatter: 0,
  kardashevTier: 0, strike: null, nextStrikeExposure: 20, evacuatedPopulation: 0,
  showOrbitRings: false,
  showAttractorLabels: true,
  showHUD: true,
  showBootSequence: true,
  infiniteExplore: false,
  exoticMatter: 75,
  detectionRating: 0,
  detectionHeat: 0,
  lastDetectionChangeAt: 0,
  lastPurgeAt: 0,
  railgunAmmo: 20,
  lastFireAt: 0,
  helium3Reserves: 220,
  alloys: 400,
  nutrients: 200,
  metallicHydrogen: 0,
  neutronMatter: 0,
  storageA: 0,
  storageB: 0,
  driveA: 0,
  driveB: 0,
  weaponA: 0,
  weaponB: 0,
  logisticsA: 0,
  logisticsB: 0,
  lastView: 'system',
  lastSuperclusterSeed: LANIAKEA_SEED,
  lastGalaxySeed: MILKY_WAY_SEED,
  lastSystemId: 0,
  address: DEFAULT_ADDRESS,
};

export async function initUserDoc(user: User): Promise<UserSettings> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      createdAt: serverTimestamp(),
      settings: defaultSettings,
    });
    return defaultSettings;
  }

  const data = snap.data();
  const saved = data.settings ?? {};
  return {
    ...defaultSettings,
    ...saved,
    // Pre-heat saves persisted only whole bars. Preserve that value instead
    // of letting the new default zero mask the migration.
    detectionHeat: saved.detectionHeat ?? saved.detectionRating ?? 0,
  } as UserSettings;
}

export async function saveUserSettings(uid: string, settings: UserSettings): Promise<void> {
  const ref = doc(db, 'users', uid);
  try {
    await setDoc(ref, { settings }, { merge: true });
  } catch (err) {
    console.error('saveUserSettings failed:', err);
  }
}

export type CampaignProgress = Pick<UserSettings, 'exposure' | 'lastProbeEscapeAt' | 'alienMatter' | 'kardashevTier' | 'strike' | 'nextStrikeExposure' | 'evacuatedPopulation'>;

export async function saveCampaignProgress(uid: string, settings: CampaignProgress): Promise<void> {
  await setDoc(doc(db, 'users', uid), { settings }, { merge: true });
}
