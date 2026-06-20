import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { db } from './firebase';

export interface UserSettings {
  showOrbitRings: boolean;
  showAttractorLabels: boolean;
  showHUD: boolean;
  infiniteExplore: boolean;
  exoticMatter: number;
  driveIntegrity: number;
  railgunAmmo: number;
  helium3Reserves: number;
  alloys: number;
  nutrients: number;
}

const defaultSettings: UserSettings = {
  showOrbitRings: false,
  showAttractorLabels: true,
  showHUD: true,
  infiniteExplore: false,
  exoticMatter: 75,
  driveIntegrity: 98,
  railgunAmmo: 350,
  helium3Reserves: 220,
  alloys: 400,
  nutrients: 200,
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
  return { ...defaultSettings, ...data.settings } as UserSettings;
}

export async function saveUserSettings(uid: string, settings: UserSettings): Promise<void> {
  const ref = doc(db, 'users', uid);
  await updateDoc(ref, { settings });
}
