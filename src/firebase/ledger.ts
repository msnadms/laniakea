import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import type { ShipState } from '../game/fuel';

export function subscribeLedger(uid: string, onBalance: (condensate: number) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'ledger', 'state'),
    (snap) => {
      if (snap.exists()) onBalance(snap.data().condensate as number);
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
