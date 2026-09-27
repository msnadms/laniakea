import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { db } from './firebase';
import { MILKY_WAY_SEED, LANIAKEA_SEED, DEFAULT_ADDRESS } from '../game/hardcoded';
import type { AddressComponent } from '../game/types';
import type { AppView } from '../store/uiStore';

export interface UserSettings {
  showOrbitRings: boolean;
  showAttractorLabels: boolean;
  showHUD: boolean;
  lastView: AppView;
  lastSuperclusterSeed: number;
  lastGalaxySeed: number;
  lastSystemId: number | null;
  address: AddressComponent[];
}

export const defaultSettings: UserSettings = {
  showOrbitRings: false,
  showAttractorLabels: true,
  showHUD: true,
  lastView: 'system',
  lastSuperclusterSeed: LANIAKEA_SEED,
  lastGalaxySeed: MILKY_WAY_SEED,
  lastSystemId: 0,
  address: DEFAULT_ADDRESS,
};

export interface UserDoc {
  settings: UserSettings;
  explorerName: string | null;
}

export async function initUserDoc(user: User): Promise<UserDoc> {
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
    return { settings: defaultSettings, explorerName: null };
  }

  const data = snap.data();
  return {
    settings: { ...defaultSettings, ...(data.settings ?? {}) } as UserSettings,
    explorerName: (data.explorerName as string | undefined) ?? null,
  };
}

export async function saveUserSettings(uid: string, settings: UserSettings): Promise<void> {
  const ref = doc(db, 'users', uid);
  try {
    await setDoc(ref, { settings }, { merge: true });
  } catch (err) {
    console.error('saveUserSettings failed:', err);
  }
}
