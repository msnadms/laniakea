import { researchCost, type TechLevels, type TechPath } from '../../src/game/tech';
import { db } from './firebase';
import { HttpError } from './httpError';
import { readLedger, writeTechnology } from './ledger';

export interface TechState {
  technology: number;
  tech: TechLevels;
}

export async function research(uid: string, path: TechPath): Promise<TechState> {
  return db.runTransaction(async (tx) => {
    const ledger = await readLedger(tx, uid);
    const level = ledger.tech[path];
    const cost = researchCost(level);
    if (cost === null) throw new HttpError(409, 'That path is fully researched');
    if (ledger.technology < cost) throw new HttpError(402, 'Not enough advanced technology');
    const tech = { ...ledger.tech, [path]: level + 1 };
    const technology = writeTechnology(tx, uid, ledger, -cost, tech, { type: 'research', path, level: level + 1 });
    return { technology, tech };
  });
}

export async function grantTechnology(uid: string, amount: number): Promise<TechState> {
  return db.runTransaction(async (tx) => {
    const ledger = await readLedger(tx, uid);
    const technology = writeTechnology(tx, uid, ledger, amount, ledger.tech, { type: 'technologyGrant' });
    return { technology, tech: ledger.tech };
  });
}
