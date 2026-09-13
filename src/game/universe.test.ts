import { describe, expect, it } from 'vitest';
import {
  encodeSuperclusterSeed,
  getSuperclusterCoords,
  getUniverseChunk,
  locateSupercluster,
  universeChunksNear,
  universeWebWeight,
} from './universe';
import { generateSupercluster, generateSuperclusterName } from './superclusters';
import { createRng } from './galaxyGen';
import { LANIAKEA_NAME, LANIAKEA_SEED } from './hardcoded';
import {
  UNIVERSE_CHUNK_SPAN,
  UNIVERSE_FOG_FAR,
  UNIVERSE_LATTICE_RADIUS,
  UNIVERSE_RADIUS,
  UNIVERSE_VOID_CELL,
} from './constants';

const POSITIONS_DIGEST = 465355129;
const NAMES_DIGEST = 140157739;

const SAMPLE_CHUNKS: [number, number, number][] = [[0, 0, 0], [-1, 0, -1], [5, -3, 12], [-40, 20, 7], [30, -50, -9], [62, 0, 0]];

function digest(fields: string[]) {
  let hash = 2166136261;
  for (const field of fields) {
    for (let i = 0; i < field.length; i++) {
      hash ^= field.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function homeChunk() {
  const [home] = universeChunksNear(0, 0, 0, 0);
  return getUniverseChunk(home.ci, home.cj, home.ck);
}

describe('universe generation', () => {
  const chunks = SAMPLE_CHUNKS.map(([ci, cj, ck]) => getUniverseChunk(ci, cj, ck));

  it('keeps every supercluster seed, position and brightness fixed', () => {
    const fields: string[] = [];
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count; i++) {
        fields.push(`${chunk.seeds[i]}|${chunk.x[i].toFixed(2)}|${chunk.y[i].toFixed(2)}|${chunk.z[i].toFixed(2)}|${chunk.brightness[i].toFixed(4)}`);
      }
    }
    expect(digest(fields)).toBe(POSITIONS_DIGEST);
  });

  it('keeps supercluster names fixed', () => {
    const names: string[] = [];
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count && names.length < 1000; i++) names.push(generateSuperclusterName(chunk.seeds[i]));
    }
    expect(names.length).toBe(1000);
    expect(digest(names)).toBe(NAMES_DIGEST);
  });

  it('finds every supercluster from its seed alone', () => {
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count; i++) {
        expect(locateSupercluster(chunk.seeds[i])).toEqual({
          seed: chunk.seeds[i],
          x: chunk.x[i],
          y: chunk.y[i],
          z: chunk.z[i],
          brightness: chunk.brightness[i],
        });
      }
    }
  });

  it('generates a chunk the same way however it was reached', () => {
    const chunk = getUniverseChunk(-40, 20, 7);
    const location = locateSupercluster(chunk.seeds[chunk.count - 1]);
    getUniverseChunk(5, -3, 12);
    expect(getUniverseChunk(-40, 20, 7)).toBe(chunk);
    expect(location?.x).toBe(chunk.x[chunk.count - 1]);
  });

  it('gives every supercluster its own seed', () => {
    const seeds = [...chunks, homeChunk()].flatMap((chunk) => Array.from(chunk.seeds));
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seeds.filter((seed) => seed === LANIAKEA_SEED)).toHaveLength(1);
  });

  it('puts Laniakea at the centre of its observable universe', () => {
    const home = homeChunk();
    expect(home.seeds[0]).toBe(LANIAKEA_SEED);
    expect([home.x[0], home.y[0], home.z[0]]).toEqual([0, 0, 0]);
    expect(generateSuperclusterName(LANIAKEA_SEED)).toBe(LANIAKEA_NAME);
    expect(getSuperclusterCoords(LANIAKEA_SEED)).toEqual([0, 0, 0]);
  });

  it('keeps every supercluster inside the observable radius', () => {
    const edge = getUniverseChunk(62, 0, 0);
    expect(edge.count).toBeGreaterThan(0);
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count; i++) {
        expect(Math.hypot(chunk.x[i], chunk.y[i], chunk.z[i])).toBeLessThanOrEqual(UNIVERSE_RADIUS * 1.0001);
      }
    }
    expect(getUniverseChunk(UNIVERSE_CHUNK_SPAN, 0, 0).count).toBe(0);
    expect(universeChunksNear(UNIVERSE_RADIUS * 1.2, 0, 0, UNIVERSE_FOG_FAR)).toHaveLength(0);
  });

  it('spans 93 billion light years with superclusters out to its edge', () => {
    expect(UNIVERSE_RADIUS * 2).toBe(93_000);
    const edge = getUniverseChunk(62, 0, 0);
    let farthest = 0;
    for (let i = 0; i < edge.count; i++) farthest = Math.max(farthest, Math.hypot(edge.x[i], edge.y[i], edge.z[i]));
    expect(farthest).toBeGreaterThan(UNIVERSE_RADIUS * 0.95);
  });

  it('holds hundreds of millions of superclusters', () => {
    const interior = chunks.slice(0, 5);
    const perChunk = interior.reduce((sum, chunk) => sum + chunk.count, 0) / interior.length;
    const chunksInBall = (4 / 3) * Math.PI * (UNIVERSE_LATTICE_RADIUS / UNIVERSE_VOID_CELL) ** 3;
    expect(perChunk * chunksInBall).toBeGreaterThan(100_000_000);
  });

  it('names a supercluster the way the supercluster view will', () => {
    const chunk = chunks[2];
    for (const index of [0, Math.floor(chunk.count / 2), chunk.count - 1]) {
      expect(generateSuperclusterName(chunk.seeds[index])).toBe(generateSupercluster(chunk.seeds[index]).name);
    }
  });

  it('gathers superclusters onto walls and filaments rather than scattering them', () => {
    let onWeb = 0;
    let dots = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count; i += 5) {
        onWeb += universeWebWeight(chunk.x[i], chunk.y[i], chunk.z[i]);
        dots++;
      }
    }
    onWeb /= dots;

    const rng = createRng(99);
    let uniform = 0;
    for (let samples = 0; samples < 10_000; samples++) {
      const span = UNIVERSE_RADIUS * 0.3;
      uniform += universeWebWeight((rng() * 2 - 1) * span, (rng() * 2 - 1) * span, (rng() * 2 - 1) * span);
    }
    uniform /= 10_000;

    expect(onWeb).toBeGreaterThan(uniform * 3);
  });

  it('places no coordinates for a seed that names no supercluster', () => {
    const chunk = getUniverseChunk(5, -3, 12);
    const taken = new Set(chunk.seeds);
    let trial = 0;
    while (taken.has(encodeSuperclusterSeed(5, -3, 12, trial))) trial++;
    const empty = encodeSuperclusterSeed(5, -3, 12, trial);
    expect(locateSupercluster(empty)).toBeNull();
    expect(getSuperclusterCoords(empty)).toEqual([0, 0, 0]);
    expect(locateSupercluster(-1)).toBeNull();
  });

  it('lists the chunks around a point nearest first', () => {
    const refs = universeChunksNear(8_300, -530, 3_020, UNIVERSE_FOG_FAR);
    expect(refs.length).toBeGreaterThan(50);
    for (let i = 1; i < refs.length; i++) expect(refs[i].distSq).toBeGreaterThanOrEqual(refs[i - 1].distSq);
    expect(refs[0].distSq).toBe(0);
    for (const ref of refs) expect(ref.distSq).toBeLessThanOrEqual(UNIVERSE_FOG_FAR * UNIVERSE_FOG_FAR * (1 + 1e-9));
  });
});
