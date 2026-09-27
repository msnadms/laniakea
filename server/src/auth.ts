import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from './firebase';

export interface AuthedLocals {
  uid: string;
  googleName: string | null;
}

export async function requireUser(req: Request, res: Response<unknown, AuthedLocals>, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing ID token' });
    return;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    res.locals.uid = decoded.uid;
    res.locals.googleName = typeof decoded.name === 'string' ? decoded.name : null;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid ID token' });
  }
}
