import { FieldValue } from 'firebase-admin/firestore';
import { paths } from './paths';

export interface Position {
  superclusterSeed: number;
  galaxySeed: number;
}

export async function recordPosition(uid: string, position: Position): Promise<void> {
  await paths.position(uid).set({ ...position, at: FieldValue.serverTimestamp() });
}

export async function readPosition(uid: string): Promise<Position | null> {
  const snap = await paths.position(uid).get();
  if (!snap.exists) return null;
  return { superclusterSeed: snap.get('superclusterSeed') as number, galaxySeed: snap.get('galaxySeed') as number };
}
