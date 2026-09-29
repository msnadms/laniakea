import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { ShipState } from '../game/fuel';
import { techLevelsOf, type TechLevels } from '../game/tech';

export interface LedgerState {
  condensate: number;
  technology: number;
  tech: TechLevels;
}

export function subscribeLedger(uid: string, onLedger: (ledger: LedgerState) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'ledger', 'state'),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      onLedger({
        condensate: data.condensate as number,
        technology: (data.technology as number | undefined) ?? 0,
        tech: techLevelsOf(data.tech),
      });
    },
    (err) => console.error('subscribeLedger failed:', err),
  );
}

export function subscribeShip(uid: string, onShip: (ship: ShipState) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'position', 'ship'),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      onShip({ x: data.x as number, y: data.y as number, z: data.z as number, at: data.at as number });
    },
    (err) => console.error('subscribeShip failed:', err),
  );
}
