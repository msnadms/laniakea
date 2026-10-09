import { BASE_SURFACE_COLS, BASE_SURFACE_ROWS, EXTRACTOR_STORAGE } from './constants';
import { DEPOSIT_GRADES, DEPOSIT_RATE_PER_HOUR, RESOURCE_KINDS, type DepositGrade, type ResourceKind } from './resources';
import type { SurfaceCell } from './baseSurface';

const HOUR_MS = 3_600_000;

export interface Extractor extends SurfaceCell {
  resource: ResourceKind;
  grade: DepositGrade;
  stored: number;
  settledAt: number;
}

export function extractorRate({ grade }: Extractor): number {
  return DEPOSIT_RATE_PER_HOUR[grade];
}

export function extractorStock(extractor: Extractor, now: number): number {
  const elapsed = Math.max(0, now - extractor.settledAt);
  return Math.min(EXTRACTOR_STORAGE, extractor.stored + Math.floor((extractorRate(extractor) * elapsed) / HOUR_MS));
}

export function settleExtractor(extractor: Extractor, now: number): Extractor {
  const stored = extractorStock(extractor, now);
  const settledAt = stored >= EXTRACTOR_STORAGE
    ? Math.max(now, extractor.settledAt)
    : extractor.settledAt + Math.floor(((stored - extractor.stored) * HOUR_MS) / extractorRate(extractor));
  return { ...extractor, stored, settledAt };
}

export function extractorAt(extractors: readonly Extractor[], { col, row }: SurfaceCell): Extractor | undefined {
  return extractors.find((extractor) => extractor.col === col && extractor.row === row);
}

export function isSurfaceCell({ col, row }: SurfaceCell): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < BASE_SURFACE_COLS && row >= 0 && row < BASE_SURFACE_ROWS;
}

export function stockByResource(extractors: readonly Extractor[], now: number): Record<ResourceKind, number> {
  const totals = Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind, 0])) as Record<ResourceKind, number>;
  for (const extractor of extractors) totals[extractor.resource] += extractorStock(extractor, now);
  return totals;
}

export function isExtractor(value: unknown): value is Extractor {
  const raw = value as Partial<Extractor> | null;
  return typeof raw === 'object' && raw !== null
    && isSurfaceCell(raw as SurfaceCell)
    && (RESOURCE_KINDS as readonly unknown[]).includes(raw.resource)
    && (DEPOSIT_GRADES as readonly unknown[]).includes(raw.grade)
    && Number.isFinite(raw.stored)
    && Number.isFinite(raw.settledAt);
}
