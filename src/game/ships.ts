export type ShipClass = 'corvette' | 'destroyer' | 'cruiser';

export type ShipCounts = Record<ShipClass, number>;

export interface ShipSpec {
  name: string;
  blurb: string;
  hull: number;
  damage: number;
  range: number;
  speed: number;
  hullUnits: number;
  crew: number;
  alloys: number;
  technology: number;
  buildSeconds: number;
  shipyardLevel: number;
  strongAgainst: readonly string[];
}

export const SHIP_CLASSES: readonly ShipClass[] = ['corvette', 'destroyer', 'cruiser'];

export const NO_SHIPS: ShipCounts = { corvette: 0, destroyer: 0, cruiser: 0 };

export const SHIPS: Record<ShipClass, ShipSpec> = {
  corvette: {
    name: 'Corvette',
    blurb: 'Small, fast and cheap. Corvettes come in swarms and slip under the aim of heavy guns to strike the platforms themselves.',
    hull: 40,
    damage: 6,
    range: 2,
    speed: 5,
    hullUnits: 1,
    crew: 2,
    alloys: 40,
    technology: 0,
    buildSeconds: 120,
    shipyardLevel: 1,
    strongAgainst: ['railgun'],
  },
  destroyer: {
    name: 'Destroyer',
    blurb: 'An escort built to screen heavier hulls. Its rapid batteries tear through corvettes and point-defence arrays.',
    hull: 160,
    damage: 14,
    range: 3,
    speed: 3,
    hullUnits: 3,
    crew: 6,
    alloys: 180,
    technology: 0,
    buildSeconds: 900,
    shipyardLevel: 2,
    strongAgainst: ['corvette', 'pointDefence'],
  },
  cruiser: {
    name: 'Cruiser',
    blurb: 'Slow and long-reaching, its spinal gun is built around recovered technology. Cruisers break shields and missile batteries from beyond their range.',
    hull: 520,
    damage: 40,
    range: 5,
    speed: 2,
    hullUnits: 8,
    crew: 15,
    alloys: 600,
    technology: 1,
    buildSeconds: 3600,
    shipyardLevel: 4,
    strongAgainst: ['shield', 'missile'],
  },
};

export function hullUnits(counts: ShipCounts): number {
  return SHIP_CLASSES.reduce((sum, shipClass) => sum + counts[shipClass] * SHIPS[shipClass].hullUnits, 0);
}

export function fleetCrew(counts: ShipCounts): number {
  return SHIP_CLASSES.reduce((sum, shipClass) => sum + counts[shipClass] * SHIPS[shipClass].crew, 0);
}

export function isShipClass(value: unknown): value is ShipClass {
  return value === 'corvette' || value === 'destroyer' || value === 'cruiser';
}
