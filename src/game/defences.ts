import { BASE_PLATFORM_LIMIT, DEFENCE_ORBIT_SLOTS } from './constants';

export type DefenceKind = 'pointDefence' | 'missile' | 'railgun' | 'shield';

export interface Platform {
  orbit: number;
  slot: number;
  kind: DefenceKind;
}

export interface SlotRef {
  orbit: number;
  slot: number;
}

export interface DefenceSpec {
  name: string;
  blurb: string;
  hull: number;
  damage: number;
  range: number;
  fireTicks: number;
  splash: number;
  shield: number;
}

export const DEFENCE_KINDS: readonly DefenceKind[] = ['pointDefence', 'missile', 'railgun', 'shield'];

export const ORBIT_NAMES = ['Inner orbit', 'Middle orbit', 'Outer orbit'];

export const DEFENCES: Record<DefenceKind, DefenceSpec> = {
  pointDefence: {
    name: 'Point-Defence Array',
    blurb: 'Rapid-firing turrets that fill near space with shot. Deadly to corvettes, useless beyond a short reach.',
    hull: 80,
    damage: 4,
    range: 1,
    fireTicks: 1,
    splash: 0,
    shield: 0,
  },
  missile: {
    name: 'Missile Battery',
    blurb: 'Launches salvos that burst among a formation. Good against ships that bunch together.',
    hull: 100,
    damage: 12,
    range: 3,
    fireTicks: 4,
    splash: 1,
    shield: 0,
  },
  railgun: {
    name: 'Railgun Platform',
    blurb: 'A long magnetic barrel that fires slowly and hits hard at great range. Cruisers fear it; corvettes are too quick for it.',
    hull: 140,
    damage: 30,
    range: 5,
    fireTicks: 8,
    splash: 0,
    shield: 0,
  },
  shield: {
    name: 'Shield Projector',
    blurb: 'Carries no weapon. It projects a shield over every other platform in its orbit.',
    hull: 120,
    damage: 0,
    range: 0,
    fireTicks: 0,
    splash: 0,
    shield: 60,
  },
};

export function orbitSlots(orbit: number): number {
  return DEFENCE_ORBIT_SLOTS[orbit] ?? 0;
}

export function isSlot({ orbit, slot }: SlotRef): boolean {
  return Number.isInteger(orbit) && Number.isInteger(slot) && orbit >= 0 && orbit < DEFENCE_ORBIT_SLOTS.length && slot >= 0 && slot < orbitSlots(orbit);
}

export function platformAt(defences: readonly Platform[], { orbit, slot }: SlotRef): Platform | undefined {
  return defences.find((platform) => platform.orbit === orbit && platform.slot === slot);
}

export function validateLayout(defences: readonly Platform[]): string | null {
  if (defences.length > BASE_PLATFORM_LIMIT) return 'Too many platforms';
  const taken = new Set<string>();
  for (const platform of defences) {
    if (!isSlot(platform)) return 'A platform sits outside the orbital slots';
    if (!isDefenceKind(platform.kind)) return 'Unknown platform';
    const key = `${platform.orbit}:${platform.slot}`;
    if (taken.has(key)) return 'Two platforms share a slot';
    taken.add(key);
  }
  return null;
}

export function isDefenceKind(value: unknown): value is DefenceKind {
  return typeof value === 'string' && (DEFENCE_KINDS as readonly string[]).includes(value);
}
