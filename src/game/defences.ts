import {
  BASE_MAX_LEVEL,
  DEFENCE_LEVEL_ALLOY_FACTORS,
  DEFENCE_LEVEL_SECONDS,
  DEFENCE_LEVEL_TECHNOLOGY,
  DEFENCE_ORBIT_SLOTS,
} from './constants';
import type { LevelCost } from './baseBuildings';

export type DefenceKind = 'pointDefence' | 'missile' | 'railgun' | 'shield';

export interface Platform {
  orbit: number;
  slot: number;
  kind: DefenceKind;
  level: number;
  readyAt: number | null;
}

export interface SlotRef {
  orbit: number;
  slot: number;
}

export interface DefenceSpec {
  name: string;
  blurb: string;
  alloys: number;
  crew: number;
  commandLevel: number;
  hull: number;
  hullPerLevel: number;
  damage: number;
  damagePerLevel: number;
  range: number;
  fireTicks: number;
  splash: number;
  shield: number;
  shieldPerLevel: number;
}

export interface DefenceStats {
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
    alloys: 50,
    crew: 2,
    commandLevel: 1,
    hull: 80,
    hullPerLevel: 40,
    damage: 4,
    damagePerLevel: 2,
    range: 1,
    fireTicks: 1,
    splash: 0,
    shield: 0,
    shieldPerLevel: 0,
  },
  missile: {
    name: 'Missile Battery',
    blurb: 'Launches salvos that burst among a formation. Good against ships that bunch together.',
    alloys: 90,
    crew: 3,
    commandLevel: 1,
    hull: 100,
    hullPerLevel: 50,
    damage: 12,
    damagePerLevel: 6,
    range: 3,
    fireTicks: 4,
    splash: 1,
    shield: 0,
    shieldPerLevel: 0,
  },
  railgun: {
    name: 'Railgun Platform',
    blurb: 'A long magnetic barrel that fires slowly and hits hard at great range. Cruisers fear it; corvettes are too quick for it.',
    alloys: 140,
    crew: 4,
    commandLevel: 2,
    hull: 140,
    hullPerLevel: 70,
    damage: 30,
    damagePerLevel: 15,
    range: 5,
    fireTicks: 8,
    splash: 0,
    shield: 0,
    shieldPerLevel: 0,
  },
  shield: {
    name: 'Shield Projector',
    blurb: 'Carries no weapon. It projects a shield over every other platform in its orbit.',
    alloys: 120,
    crew: 3,
    commandLevel: 3,
    hull: 120,
    hullPerLevel: 60,
    damage: 0,
    damagePerLevel: 0,
    range: 0,
    fireTicks: 0,
    splash: 0,
    shield: 60,
    shieldPerLevel: 40,
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

export function defenceCost(kind: DefenceKind, level: number): LevelCost | null {
  if (level >= BASE_MAX_LEVEL) return null;
  return {
    alloys: Math.round(DEFENCES[kind].alloys * DEFENCE_LEVEL_ALLOY_FACTORS[level]),
    technology: DEFENCE_LEVEL_TECHNOLOGY[level],
    crew: level === 0 ? DEFENCES[kind].crew : 0,
    seconds: DEFENCE_LEVEL_SECONDS[level],
  };
}

export function defenceStats(kind: DefenceKind, level: number): DefenceStats {
  const spec = DEFENCES[kind];
  const step = Math.max(0, level - 1);
  return {
    hull: spec.hull + spec.hullPerLevel * step,
    damage: spec.damage + spec.damagePerLevel * step,
    range: spec.range,
    fireTicks: spec.fireTicks,
    splash: spec.splash,
    shield: spec.shield === 0 ? 0 : spec.shield + spec.shieldPerLevel * step,
  };
}

export function defenceCrew(defences: readonly Platform[]): number {
  return defences.reduce((sum, platform) => sum + DEFENCES[platform.kind].crew, 0);
}

export function validateLayout(defences: readonly Platform[], limit: number): string | null {
  if (defences.length > limit) return 'More platforms than the Command Nexus can hold';
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
