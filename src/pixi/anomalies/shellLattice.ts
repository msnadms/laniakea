import { BufferImageSource } from 'pixi.js';
import type { Rng } from '../../game/types';
import type { Point3D } from '../projection';

export interface ShellLattice {
  cells: number;
  normals: Point3D[];
  data: Uint8Array;
  source: BufferImageSource;
}

const FACES = 6;
const TEAR_COUNT = 6;
const TEAR_JITTER = 0.18;
const DAMAGE_BAND = 0.45;

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function orthonormalFrame(normal: Point3D): { tangent: Point3D; bitangent: Point3D } {
  let tx = normal.z;
  let tz = -normal.x;
  let length = Math.hypot(tx, tz);
  if (length < 1e-6) {
    tx = 1;
    tz = 0;
    length = 1;
  }
  const tangent = { x: tx / length, y: 0, z: tz / length };
  const bitangent = {
    x: normal.y * tangent.z - normal.z * tangent.y,
    y: normal.z * tangent.x - normal.x * tangent.z,
    z: normal.x * tangent.y - normal.y * tangent.x,
  };
  return { tangent, bitangent };
}

function faceNormal(face: number, u: number, v: number): Point3D {
  const sign = face % 2 === 0 ? 1 : -1;
  const axis = face >> 1;
  const x = axis === 0 ? sign : u;
  const y = axis === 0 ? v : axis === 1 ? sign : v;
  const z = axis === 0 ? u : axis === 1 ? v : sign;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

function integrityScores(normals: Point3D[], rng: Rng): number[] {
  const tears = Array.from({ length: TEAR_COUNT }, () => ({
    centre: normals[Math.floor(rng() * normals.length)],
    reach: 0.25 + rng() * 0.55,
    weight: 0.6 + rng() * 0.8,
  }));
  return normals.map((normal) => {
    let score = rng() * TEAR_JITTER;
    for (const tear of tears) {
      const angle = Math.acos(Math.min(1, Math.max(-1, dot(normal, tear.centre))));
      score += tear.weight * Math.exp(-((angle / tear.reach) ** 2));
    }
    return score;
  });
}

export function buildShellLattice(panelCount: number, integrity: number, rng: Rng): ShellLattice {
  const cells = Math.max(3, Math.round(Math.sqrt(panelCount / FACES)));
  const width = FACES * cells;
  const normals: Point3D[] = [];
  for (let j = 0; j < cells; j++) {
    const v = Math.tan(((j + 0.5) / cells * 2 - 1) * Math.PI / 4);
    for (let face = 0; face < FACES; face++) {
      for (let i = 0; i < cells; i++) {
        normals.push(faceNormal(face, Math.tan(((i + 0.5) / cells * 2 - 1) * Math.PI / 4), v));
      }
    }
  }

  const scores = integrityScores(normals, rng);
  const removeCount = Math.round(normals.length * (1 - integrity));
  const threshold = removeCount > 0 ? [...scores].sort((a, b) => b - a)[removeCount - 1] : Infinity;
  const data = new Uint8Array(width * cells * 4);
  for (let k = 0; k < normals.length; k++) {
    const present = scores[k] < threshold;
    const damage = present && removeCount > 0 ? Math.max(0, 1 - (threshold - scores[k]) / DAMAGE_BAND) : 0;
    data[k * 4] = present ? 255 : 0;
    data[k * 4 + 1] = Math.round(damage * 255);
    data[k * 4 + 2] = Math.round(rng() * 255);
    data[k * 4 + 3] = 0;
  }

  const source = new BufferImageSource({
    resource: data,
    width,
    height: cells,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  return { cells, normals, data, source };
}

export function paintActivity(lattice: ShellLattice, activity: (normal: Point3D) => number) {
  const { normals, data } = lattice;
  for (let k = 0; k < normals.length; k++) {
    data[k * 4 + 3] = data[k * 4] ? Math.round(Math.min(1, Math.max(0, activity(normals[k]))) * 255) : 0;
  }
  lattice.source.update();
}
