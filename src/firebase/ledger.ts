import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';

export function subscribeLedger(uid: string, onBalance: (condensate: number) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'ledger', 'state'),
    (snap) => {
      if (snap.exists()) onBalance(snap.data().condensate as number);
    },
    (err) => console.error('subscribeLedger failed:', err),
  );
}
