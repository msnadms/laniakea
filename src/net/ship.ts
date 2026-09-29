import { distance, harvested, isDocked, travelCost, type Point3, type ShipState } from '../game/fuel';
import { locateSupercluster } from '../game/universe';
import { useFuelStore } from '../store/fuelStore';
import { useScanStore } from '../store/scanStore';
import { useTechStore } from '../store/techStore';
import { tankCapacity } from '../game/tech';
import { api, withRetry } from './api';

interface FuelReply {
  ship: ShipState;
  condensate: number;
}

interface TravelReply extends FuelReply {
  arrived: boolean;
}

const live: Point3 = { x: 0, y: 0, z: 0 };
let flying = false;
let boarded = false;
let queue: Promise<unknown> = Promise.resolve();

function apply(reply: FuelReply) {
  useFuelStore.getState().setShip(reply.ship);
  useScanStore.getState().setCondensate(reply.condensate);
}

function enqueue<T>(call: () => Promise<T>): Promise<T> {
  const next = queue.then(call, call);
  queue = next.catch(() => undefined);
  return next;
}

export function setLivePosition(point: Point3 | null) {
  if (point === null) boarded = false;
  if (boarded) return;
  flying = point !== null;
  if (point) {
    live.x = point.x;
    live.y = point.y;
    live.z = point.z;
  }
}

export function fuelAtShip(now = Date.now()): number {
  const ship = useFuelStore.getState().ship;
  const condensate = useScanStore.getState().condensate;
  const capacity = tankCapacity(useTechStore.getState().levels.capacity);
  return ship ? condensate + harvested(ship, condensate, now, capacity) : condensate;
}

export function fuelNow(now = Date.now()): number {
  const ship = useFuelStore.getState().ship;
  const pending = ship && flying ? travelCost(distance(ship, live)) : 0;
  return Math.max(0, fuelAtShip(now) - pending);
}

export function ensureShip(superclusterSeed: number): Promise<ShipState> {
  return enqueue(() => withRetry(() => api<FuelReply>('/ship', { superclusterSeed }))).then((reply) => {
    apply(reply);
    return reply.ship;
  });
}

let syncing = false;

export function isBoarded(): boolean {
  return boarded;
}

export function syncFlight(to: Point3): void {
  if (syncing || boarded) return;
  syncing = true;
  enqueue(() => api<TravelReply>('/ship/travel', { x: to.x, y: to.y, z: to.z }))
    .then(apply)
    .catch((err) => console.error('syncFlight failed:', err))
    .finally(() => { syncing = false; });
}

export function dockedAt(superclusterSeed: number): boolean {
  const ship = useFuelStore.getState().ship;
  const location = locateSupercluster(superclusterSeed);
  return ship !== null && location !== null && isDocked(ship, location);
}

export async function travelTo(superclusterSeed: number): Promise<boolean> {
  if (!flying && dockedAt(superclusterSeed)) return true;
  const from = flying ? { ...live } : useFuelStore.getState().ship;
  if (!from) return false;
  try {
    const reply = await enqueue(() => api<TravelReply>('/ship/travel', { x: from.x, y: from.y, z: from.z, superclusterSeed }));
    if (reply.arrived && flying) {
      boarded = true;
      flying = false;
    }
    apply(reply);
    if (!reply.arrived) useFuelStore.getState().setNotice('Not enough negative-energy condensate to make that crossing');
    return reply.arrived;
  } catch (err) {
    console.error('travelTo failed:', err);
    useFuelStore.getState().setNotice('The crossing could not be plotted');
    return false;
  }
}
