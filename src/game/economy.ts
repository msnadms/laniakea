export const EXTRACTION_UNITS_PER_RATING_PER_HOUR = 10;
export const MINING_STATION_COST = 50;
export const MINING_STATION_REFUND = 25;

export function effectiveExtractionPerHour(
  rating: number,
  logisticsMultiplier = 1,
  moduleMultiplier = 1,
): number {
  return rating * EXTRACTION_UNITS_PER_RATING_PER_HOUR * logisticsMultiplier * moduleMultiplier;
}

export function extractorHoldFillHours(hold: number, unitsPerHour: number): number {
  return unitsPerHour > 0 ? hold / unitsPerHour : Infinity;
}

export function miningStationPaybackHours(rating: number): number {
  return MINING_STATION_COST / effectiveExtractionPerHour(rating);
}
