import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { baseOf, type Base } from '../game/base';

export function subscribeBase(uid: string, onBase: (base: Base | null) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid, 'base', 'current'),
    (snap) => onBase(snap.exists() ? baseOf(snap.data()) : null),
    (err) => console.error('subscribeBase failed:', err),
  );
}
