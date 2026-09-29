import type { TechPath } from '../game/tech';
import { useTechStore, type TechLedger } from '../store/techStore';
import { api } from './api';

export async function research(path: TechPath): Promise<void> {
  useTechStore.getState().setLedger(await api<TechLedger>('/tech/research', { path }));
}

export async function grantTechnology(): Promise<void> {
  useTechStore.getState().setLedger(await api<TechLedger>('/debug/grant-technology', {}));
}
