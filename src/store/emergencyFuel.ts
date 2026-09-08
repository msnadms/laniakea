/** A sealed tank that ordinary spending and automated logistics cannot touch. */
export const EMERGENCY_RESERVE_EXOTIC = 30;
export const EMERGENCY_RESERVE_HELIUM = 25;

/** Recovery services leave enough operational fuel for any intra-galaxy jump. */
export const EMERGENCY_ALLOTMENT_EXOTIC = 30;
export const EMERGENCY_ALLOTMENT_HELIUM = 25;

export type FuelPair = { exotic: number; helium: number };

export function totalFuel(
  operational: FuelPair,
  reserve: FuelPair,
): FuelPair {
  return {
    exotic: operational.exotic + reserve.exotic,
    helium: operational.helium + reserve.helium,
  };
}

export function canAffordFuel(available: FuelPair, cost: FuelPair): boolean {
  return available.exotic >= cost.exotic && available.helium >= cost.helium;
}

export function spendOperationalThenReserve(
  operational: FuelPair,
  reserve: FuelPair,
  cost: FuelPair,
): { operational: FuelPair; reserve: FuelPair } {
  const exoticFromOperational = Math.min(operational.exotic, cost.exotic);
  const heliumFromOperational = Math.min(operational.helium, cost.helium);
  return {
    operational: {
      exotic: operational.exotic - exoticFromOperational,
      helium: operational.helium - heliumFromOperational,
    },
    reserve: {
      exotic: reserve.exotic - (cost.exotic - exoticFromOperational),
      helium: reserve.helium - (cost.helium - heliumFromOperational),
    },
  };
}
