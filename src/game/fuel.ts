import {
  FUEL_DOCK_RADIUS,
  FUEL_HARVEST_CAP,
  FUEL_HARVEST_FLOOR,
  FUEL_HARVEST_PER_HOUR,
  FUEL_PER_MLY,
  FUEL_TANK_CAPACITY,
  UNIVERSE_RADIUS,
  UNIVERSE_START_BACKOFF,
} from './constants';
import { universeVoidDepth } from './universe';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface ShipState extends Point3 {
  at: number;
}

export function distance(a: Point3, b: Point3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function travelCost(mly: number): number {
  return mly * FUEL_PER_MLY;
}

export function travelReach(condensate: number): number {
  return Math.max(0, condensate) / FUEL_PER_MLY;
}

export function creditable(balance: number, amount: number): number {
  if (amount <= 0) return amount;
  return Math.max(0, Math.min(amount, FUEL_TANK_CAPACITY - balance));
}

export function harvestPerHour(point: Point3): number {
  const depth = universeVoidDepth(point.x, point.y, point.z);
  return FUEL_HARVEST_PER_HOUR * (FUEL_HARVEST_FLOOR + (1 - FUEL_HARVEST_FLOOR) * depth * depth);
}

export function harvested(ship: ShipState, condensate: number, now: number): number {
  const room = FUEL_HARVEST_CAP - condensate;
  if (room <= 0 || now <= ship.at) return 0;
  return Math.min(room, harvestPerHour(ship) * (now - ship.at) / 3_600_000);
}

export function clampToUniverse(point: Point3): Point3 {
  const radius = Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
  if (radius <= UNIVERSE_RADIUS) return { x: point.x, y: point.y, z: point.z };
  const k = UNIVERSE_RADIUS / radius;
  return { x: point.x * k, y: point.y * k, z: point.z * k };
}

export function towards(from: Point3, to: Point3, mly: number): Point3 {
  const span = distance(from, to);
  if (span <= mly) return { x: to.x, y: to.y, z: to.z };
  const t = mly / span;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
}

export function isDocked(ship: Point3, supercluster: Point3): boolean {
  return distance(ship, supercluster) <= FUEL_DOCK_RADIUS;
}

export function approachPoint(from: Point3, supercluster: Point3): Point3 {
  if (isDocked(from, supercluster)) return { x: from.x, y: from.y, z: from.z };
  const span = distance(from, supercluster);
  const t = UNIVERSE_START_BACKOFF / span;
  return {
    x: supercluster.x + (from.x - supercluster.x) * t,
    y: supercluster.y + (from.y - supercluster.y) * t,
    z: supercluster.z + (from.z - supercluster.z) * t,
  };
}

export function startingBerth(supercluster: Point3): Point3 {
  const radius = Math.sqrt(supercluster.x * supercluster.x + supercluster.y * supercluster.y + supercluster.z * supercluster.z);
  if (radius < UNIVERSE_START_BACKOFF) return { x: supercluster.x, y: supercluster.y, z: supercluster.z - UNIVERSE_START_BACKOFF };
  return approachPoint({ x: 0, y: 0, z: 0 }, supercluster);
}
