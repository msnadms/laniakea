import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from './firebase';

export interface AuthedLocals {
  uid: string;
}

export async function requireUser(req: Request, res: Response<unknown, AuthedLocals>, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing ID token' });
    return;
  }
  try {
    res.locals.uid = (await adminAuth.verifyIdToken(token)).uid;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid ID token' });
  }
}
