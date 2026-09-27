import type { AddressComponent } from '../game/types';
import type { AppView } from '../store/uiStore';

interface StoredNav {
  lastView: AppView;
  lastSuperclusterSeed: number;
  lastGalaxySeed: number;
  lastSystemId: number | null;
  address: AddressComponent[];
  savedAt: number;
}

// Must outlive the Firebase 2s debounce + network round-trip, but short enough
// that cross-device sessions don't override each other across long gaps.
const NAV_TTL = 30_000;

const navKey = (uid: string) => `galaxy-nav-${uid}`;

export function saveNav(uid: string, nav: Omit<StoredNav, 'savedAt'>): void {
  try {
    localStorage.setItem(navKey(uid), JSON.stringify({ ...nav, savedAt: Date.now() }));
  } catch {
    return;
  }
}

export function loadNav(uid: string): Omit<StoredNav, 'savedAt'> | null {
  try {
    const raw = localStorage.getItem(navKey(uid));
    if (!raw) return null;
    const { savedAt, ...nav } = JSON.parse(raw) as StoredNav;
    if (!savedAt || Date.now() - savedAt > NAV_TTL) return null;
    return nav;
  } catch {
    return null;
  }
}
