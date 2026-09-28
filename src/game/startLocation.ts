import { UNIVERSE_RADIUS, START_RADIUS_FRACTION, START_ATTEMPTS } from './constants';
import { getUniverseChunk, universeChunksNear } from './universe';
import { generateSupercluster, pushAttractorAddress } from './superclusters';
import { buildAddressComponent, type AddressComponent } from './types';
import { DEFAULT_ADDRESS, LANIAKEA_SEED } from './hardcoded';

export interface StartLocation {
  superclusterSeed: number;
  superclusterName: string;
  galaxySeed: number;
  galaxyName: string;
  address: AddressComponent[];
}

function randomSupercluster(random: () => number): { seed: number; x: number; y: number; z: number } | null {
  const limit = START_RADIUS_FRACTION * UNIVERSE_RADIUS;
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    const r = limit * Math.cbrt(random());
    const z = 2 * random() - 1;
    const theta = 2 * Math.PI * random();
    const ring = Math.sqrt(1 - z * z);
    const x = r * ring * Math.cos(theta);
    const y = r * ring * Math.sin(theta);
    const ref = universeChunksNear(x, y, r * z, 0)[0];
    if (!ref) continue;
    const chunk = getUniverseChunk(ref.ci, ref.cj, ref.ck);
    if (chunk.count === 0) continue;
    const i = Math.floor(random() * chunk.count);
    if (chunk.seeds[i] === LANIAKEA_SEED) continue;
    if (Math.hypot(chunk.x[i], chunk.y[i], chunk.z[i]) > limit) continue;
    return { seed: chunk.seeds[i], x: chunk.x[i], y: chunk.y[i], z: chunk.z[i] };
  }
  return null;
}

export function randomStartLocation(random: () => number = Math.random): StartLocation | null {
  const picked = randomSupercluster(random);
  if (!picked) return null;
  const superclusterSeed = picked.seed;
  const supercluster = generateSupercluster(superclusterSeed);
  const dot = supercluster.dots[Math.floor(random() * supercluster.dots.length)];
  const address: AddressComponent[] = [
    DEFAULT_ADDRESS[0],
    buildAddressComponent(supercluster.name, picked.x, picked.y, picked.z, 'supercluster'),
  ];
  pushAttractorAddress(supercluster.attractors, dot.x, dot.y, (a) => address.push(a), () => {});
  address.push(buildAddressComponent(dot.name, dot.x, dot.y, dot.z, 'galaxy'));
  return {
    superclusterSeed,
    superclusterName: supercluster.name,
    galaxySeed: dot.seed,
    galaxyName: dot.name,
    address,
  };
}
