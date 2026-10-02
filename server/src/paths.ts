import { db } from './firebase';

export const paths = {
  user: (uid: string) => db.doc(`users/${uid}`),
  ledger: (uid: string) => db.doc(`users/${uid}/ledger/state`),
  entries: (uid: string) => db.collection(`users/${uid}/ledger/state/entries`),
  catalogued: (uid: string, key: string) => db.doc(`users/${uid}/ledger/state/catalogued/${key}`),
  civilization: (uid: string, key: string) => db.doc(`users/${uid}/ledger/state/civilizations/${key}`),
  position: (uid: string) => db.doc(`users/${uid}/position/current`),
  ship: (uid: string) => db.doc(`users/${uid}/position/ship`),
  base: (uid: string) => db.doc(`users/${uid}/base/current`),
  baseClaim: (key: string) => db.doc(`baseClaims/${key}`),
  baseClaims: () => db.collection('baseClaims'),
  scan: (uid: string, id: string) => db.doc(`users/${uid}/scans/${id}`),
  anomaly: (uid: string, key: string) => db.doc(`users/${uid}/anomalies/${key}`),
  world: (key: string) => db.doc(`world/anomalies/records/${key}`),
  discovery: (kind: 'superclusters' | 'galaxies' | 'systems', id: string) => db.doc(`world/discoveries/${kind}/${id}`),
};
