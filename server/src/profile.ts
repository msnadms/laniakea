import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpError } from './httpError';
import { paths } from './paths';

export const UNNAMED_EXPLORER = 'An unnamed explorer';

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'_-]{1,23}$/u;

export function normalizeExplorerName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!NAME_PATTERN.test(name)) throw new HttpError(400, 'An explorer name is 2 to 24 letters, digits, spaces or . \' _ -');
  return name;
}

export function explorerNameOf(user: DocumentSnapshot): string {
  return (user.get('explorerName') as string | undefined) ?? UNNAMED_EXPLORER;
}

export async function setExplorerName(uid: string, value: unknown): Promise<string> {
  const explorerName = normalizeExplorerName(value);
  await paths.user(uid).set({ explorerName }, { merge: true });
  return explorerName;
}
