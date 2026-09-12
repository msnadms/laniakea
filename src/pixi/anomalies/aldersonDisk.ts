import { Container, Graphics, Polygon } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import type { Rng } from '../../game/types';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { mixColor, scaleColor, smoothstep, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

type ColorStops = ReadonlyArray<readonly [number, number]>;

const WEDGE_COUNT = 36;
const BAND_COUNT = 18;
const ARC_STEPS = 3;
const SEAM_EVERY = 3;
const SPOKE_EVERY = 3;
const THICKNESS = 0.018;
const INNER_SUN_RADII = 2.6;
const OUTER_CLEARANCE = 0.88;
const MIN_WIDTH_RATIO = 2;
const CLOUDS = 150;
const CITIES = 80;
const DUSK_LIGHTS = 280;
const LIGHT_GROUPS = 3;
const LIGHT_COLOR = 0xffc46a;
const CLOUD_COLOR = 0xf4f6f8;
const OUTER_WALL_COLOR = 0x2a2e34;
const INNER_WALL_COLOR = 0x5a5048;
const SEAM_COLOR = 0x0e1218;

export function aldersonDiskOuterRadius(sunRadius: number, innermostClearance: number): number {
  const inner = sunRadius * INNER_SUN_RADII;
  return Math.min(innermostClearance, Math.max(innermostClearance * OUTER_CLEARANCE, inner * MIN_WIDTH_RATIO));
}

const LAND_T0 = 0.3;
const LAND_T1 = 0.72;
const LAND_COLUMNS_PER_WEDGE = 10;
const LAND_COLUMNS = WEDGE_COUNT * LAND_COLUMNS_PER_WEDGE;
const LAND_ROWS = 24;
const LAND_ROW_GROUP = 4;
const LAND_OCTAVES = 4;
const LAND_FREQUENCY = 3.5;
const LAND_EDGE_FALLOFF = 1.2;
const LAND_EDGE_START = 0.3;
const CITY_COVERAGE = 0.3;

const SURFACE_STOPS: ColorStops = [
  [0, 0x3a4458],
  [0.1, 0x6c6a66],
  [0.2, 0xa88f62],
  [0.26, 0x8c7a4e],
  [0.3, 0x2d5878],
  [0.72, 0x2a5070],
  [0.78, 0x6d7f74],
  [0.88, 0xb9c3c9],
  [1, 0xdde4ea],
];

const LAND_LEVELS: ReadonlyArray<{ coverage: number; alpha: number; stops: ColorStops }> = [
  { coverage: 0.5, alpha: 0.55, stops: [[0, 0x3f7a94], [1, 0x3a6c80]] },
  { coverage: 0.4, alpha: 1, stops: [[0, 0x8a7a50], [0.45, 0x5c7a3a], [1, 0x7d8a78]] },
  { coverage: 0.2, alpha: 1, stops: [[0, 0x7a6a44], [0.45, 0x3f6030], [1, 0x6f7c6e]] },
  { coverage: 0.06, alpha: 1, stops: [[0, 0x6e6250], [0.6, 0x74685a], [1, 0xc8d0d4]] },
];

interface Patch {
  angle: number;
  radius: number;
  size: number;
  color: number;
  alpha: number;
}

interface Light {
  angle: number;
  radius: number;
  size: number;
  alpha: number;
}

interface LandLayer {
  color: number;
  alpha: number;
  polygons: number[][];
}

interface Wedge {
  node: Container;
  surface: Graphics;
  lights: Graphics[];
  land: LandLayer[];
  clouds: Patch[];
  groups: Light[][];
  phases: number[];
  rates: number[];
  start: number;
  end: number;
}

function gradient(stops: ColorStops, t: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [to, toColor] = stops[i];
    if (t <= to) {
      const [from, fromColor] = stops[i - 1];
      return mixColor(fromColor, toColor, (t - from) / (to - from));
    }
  }
  return stops[stops.length - 1][1];
}

function wedgeIndex(angle: number): number {
  return Math.floor((((angle % TAU) + TAU) % TAU) / TAU * WEDGE_COUNT) % WEDGE_COUNT;
}

function landVertex(column: number, row: number): number {
  return column + row * (LAND_COLUMNS + 1);
}

function landT(row: number): number {
  return LAND_T0 + row / LAND_ROWS * (LAND_T1 - LAND_T0);
}

function createNoise(rng: Rng, circumference: number) {
  const octaves = Array.from({ length: LAND_OCTAVES }, (_, octave) => {
    const frequency = LAND_FREQUENCY * 2 ** octave;
    const columns = Math.max(3, Math.round(circumference * frequency));
    const rows = Math.ceil((LAND_T1 - LAND_T0) * frequency) + 2;
    return { frequency, columns, amplitude: 0.5 ** octave, values: Array.from({ length: columns * rows }, () => rng() * 2 - 1) };
  });
  const total = octaves.reduce((sum, octave) => sum + octave.amplitude, 0);
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (along: number, t: number) => {
    let sum = 0;
    for (const { frequency, columns, amplitude, values } of octaves) {
      const x = along * columns;
      const y = (t - LAND_T0) * frequency;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = fade(x - x0);
      const fy = fade(y - y0);
      const at = (column: number, row: number) => values[(column % columns + columns) % columns + row * columns];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      sum += (top + (bottom - top) * fy) * amplitude;
    }
    return sum / total;
  };
}

function traceCell(elevations: Float32Array, column: number, row: number, level: number): number[] | null {
  const corners = [landVertex(column, row), landVertex(column + 1, row), landVertex(column + 1, row + 1), landVertex(column, row + 1)];
  const refs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const aAbove = elevations[a] >= level;
    if (aAbove) refs.push(a, a, 0);
    if (aAbove !== elevations[b] >= level) {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      refs.push(low, high, (elevations[low] - level) / (elevations[low] - elevations[high]));
    }
  }
  return refs.length >= 9 ? refs : null;
}

export function createAldersonDisk({ anomaly, sunRadius, starColor, innermostClearance, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const inner = sunRadius * INNER_SUN_RADII;
  const outer = aldersonDiskOuterRadius(sunRadius, innermostClearance);
  const span = outer - inner;
  const height = outer * THICKNESS;
  const radiusAt = (t: number) => inner + span * t;
  const lit = (color: number, t: number) =>
    scaleColor(mixColor(color, starColor, 0.4 * (1 - smoothstep(0, 0.25, t))), 1 - 0.55 * smoothstep(0.1, 1, t));

  const wedges: Wedge[] = Array.from({ length: WEDGE_COUNT }, (_, index) => {
    const node = new Container();
    const surface = new Graphics();
    surface.eventMode = 'none';
    const lights = Array.from({ length: LIGHT_GROUPS }, () => {
      const gfx = new Graphics();
      gfx.blendMode = 'add';
      gfx.eventMode = 'none';
      return gfx;
    });
    node.addChild(surface, ...lights);
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.on('pointertap', onSelect);
    return {
      node,
      surface,
      lights,
      land: [],
      clouds: [],
      groups: lights.map(() => []),
      phases: lights.map(() => rng() * TAU),
      rates: lights.map(() => 0.6 + rng() * 1.4),
      start: index / WEDGE_COUNT * TAU,
      end: (index + 1) / WEDGE_COUNT * TAU,
    };
  });

  const noise = createNoise(rng, TAU * radiusAt((LAND_T0 + LAND_T1) / 2) / span);
  const elevations = new Float32Array((LAND_COLUMNS + 1) * (LAND_ROWS + 1));
  for (let row = 0; row <= LAND_ROWS; row++) {
    const falloff = LAND_EDGE_FALLOFF * smoothstep(LAND_EDGE_START, 1, Math.abs(row / LAND_ROWS * 2 - 1));
    for (let column = 0; column <= LAND_COLUMNS; column++) {
      elevations[landVertex(column, row)] = noise(column / LAND_COLUMNS, landT(row)) - falloff;
    }
  }
  const sorted = [...elevations].sort((a, b) => a - b);
  const elevationCovering = (coverage: number) => sorted[Math.floor(sorted.length * (1 - coverage))];

  wedges.forEach((wedge, index) => {
    for (const { coverage, alpha, stops } of LAND_LEVELS) {
      const elevation = elevationCovering(coverage);
      for (let groupRow = 0; groupRow < LAND_ROWS; groupRow += LAND_ROW_GROUP) {
        const t = landT(groupRow + LAND_ROW_GROUP / 2);
        const layer: LandLayer = { color: lit(gradient(stops, (t - LAND_T0) / (LAND_T1 - LAND_T0)), t), alpha, polygons: [] };
        for (let row = groupRow; row < groupRow + LAND_ROW_GROUP; row++) {
          for (let column = index * LAND_COLUMNS_PER_WEDGE; column < (index + 1) * LAND_COLUMNS_PER_WEDGE; column++) {
            const refs = traceCell(elevations, column, row, elevation);
            if (refs) layer.polygons.push(refs);
          }
        }
        if (layer.polygons.length > 0) wedge.land.push(layer);
      }
    }
  });

  for (let i = 0; i < CLOUDS; i++) {
    const t = 0.3 + rng() * 0.5;
    const angle = rng() * TAU;
    wedges[wedgeIndex(angle)].clouds.push({
      angle,
      radius: radiusAt(t),
      size: span * (0.015 + rng() * 0.035),
      color: lit(CLOUD_COLOR, t),
      alpha: 0.16,
    });
  }

  const addLight = (angle: number, radius: number, size: number) => {
    const t = (radius - inner) / span;
    const wedge = wedges[wedgeIndex(angle)];
    wedge.groups[Math.floor(rng() * LIGHT_GROUPS)].push({ angle, radius, size, alpha: 0.3 + 0.7 * smoothstep(0.3, 0.9, t) });
  };
  const cityElevation = elevationCovering(CITY_COVERAGE);
  const inhabited: number[] = [];
  elevations.forEach((elevation, vertex) => {
    if (elevation >= cityElevation) inhabited.push(vertex);
  });
  const cellAngle = TAU / LAND_COLUMNS;
  const cellDepth = span * (LAND_T1 - LAND_T0) / LAND_ROWS;
  for (let i = 0; i < CITIES && inhabited.length > 0; i++) {
    const vertex = inhabited[Math.floor(rng() * inhabited.length)];
    const angle = vertex % (LAND_COLUMNS + 1) * cellAngle;
    const radius = radiusAt(landT(Math.floor(vertex / (LAND_COLUMNS + 1))));
    const count = 5 + Math.floor(rng() * 8);
    for (let j = 0; j < count; j++) {
      addLight(angle + (rng() - 0.5) * cellAngle * 3, radius + (rng() - 0.5) * cellDepth * 3, 1.2 + rng() * 1.6);
    }
  }
  for (let i = 0; i < DUSK_LIGHTS; i++) {
    addLight(rng() * TAU, radiusAt(0.75 + rng() * 0.23), 1 + rng());
  }

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const landScreen = new Float32Array(elevations.length * 2);
  const project = (angle: number, radius: number, pointHeight: number, basis: ProjectionBasis) => {
    point.x = Math.cos(angle) * radius;
    point.y = pointHeight;
    point.z = Math.sin(angle) * radius;
    return projectSystemPointWithBasis(point, basis, projected);
  };
  const arc = (points: number[], radius: number, from: number, to: number, pointHeight: number, basis: ProjectionBasis) => {
    for (let step = 0; step <= ARC_STEPS; step++) {
      const p = project(from + (to - from) * step / ARC_STEPS, radius, pointHeight, basis);
      points.push(p.x, p.y);
    }
    return points;
  };
  const sector = (innerRadius: number, outerRadius: number, from: number, to: number, innerHeight: number, outerHeight: number, basis: ProjectionBasis) =>
    arc(arc([], outerRadius, from, to, outerHeight, basis), innerRadius, to, from, innerHeight, basis);

  const projectLand = (basis: ProjectionBasis) => {
    for (let row = 0; row <= LAND_ROWS; row++) {
      const radius = radiusAt(landT(row));
      for (let column = 0; column <= LAND_COLUMNS; column++) {
        const p = project(column * cellAngle, radius, height, basis);
        const vertex = landVertex(column, row);
        landScreen[vertex * 2] = p.x;
        landScreen[vertex * 2 + 1] = p.y;
      }
    }
  };

  const drawWedge = (wedge: Wedge, index: number, basis: ProjectionBasis) => {
    const { surface, start, end } = wedge;
    surface.clear();
    surface.poly(sector(outer, outer, start, end, -height, height, basis)).fill({ color: OUTER_WALL_COLOR });
    surface.poly(sector(inner, inner, start, end, -height, height, basis)).fill({ color: mixColor(INNER_WALL_COLOR, starColor, 0.5) });
    for (let band = 0; band < BAND_COUNT; band++) {
      const t0 = band / BAND_COUNT;
      const t1 = (band + 1) / BAND_COUNT;
      const t = (t0 + t1) / 2;
      surface.poly(sector(radiusAt(t0), radiusAt(t1), start, end, height, height, basis)).fill({ color: lit(gradient(SURFACE_STOPS, t), t) });
    }
    for (const layer of wedge.land) {
      for (const refs of layer.polygons) {
        const points: number[] = [];
        for (let k = 0; k < refs.length; k += 3) {
          const a = refs[k] * 2;
          const b = refs[k + 1] * 2;
          const w = refs[k + 2];
          points.push(landScreen[a] + (landScreen[b] - landScreen[a]) * w, landScreen[a + 1] + (landScreen[b + 1] - landScreen[a + 1]) * w);
        }
        surface.poly(points);
      }
      surface.fill({ color: layer.color, alpha: layer.alpha });
    }
    for (const cloud of wedge.clouds) {
      const p = project(cloud.angle, cloud.radius, height, basis);
      surface.ellipse(p.x, p.y, cloud.size * p.scale, cloud.size * p.scale * basis.cosTilt).fill({ color: cloud.color, alpha: cloud.alpha });
    }
    for (let band = SEAM_EVERY; band < BAND_COUNT; band += SEAM_EVERY) {
      surface.poly(arc([], radiusAt(band / BAND_COUNT), start, end, height, basis), false);
    }
    if (index % SPOKE_EVERY === 0) {
      const from = project(start, inner, height, basis);
      surface.moveTo(from.x, from.y);
      const to = project(start, outer, height, basis);
      surface.lineTo(to.x, to.y);
    }
    surface.stroke({ color: SEAM_COLOR, width: 1, alpha: 0.3 });
    surface.poly(arc([], inner, start, end, height, basis), false).stroke({ color: mixColor(0xffffff, starColor, 0.6), width: 1.5, alpha: 0.5 });

    wedge.groups.forEach((group, groupIndex) => {
      const gfx = wedge.lights[groupIndex];
      gfx.clear();
      for (const light of group) {
        const p = project(light.angle, light.radius, height, basis);
        gfx.circle(p.x, p.y, light.size * p.scale).fill({ color: LIGHT_COLOR, alpha: light.alpha });
      }
    });

    wedge.node.hitArea = new Polygon(sector(inner, outer, start, end, height, height, basis));
    wedge.node.zIndex = project((start + end) / 2, (inner + outer) / 2, height, basis).depth;
  };

  let drawnTilt = NaN;
  let drawnYaw = NaN;
  const nodes = wedges.map((wedge) => wedge.node);

  return {
    nodes,
    extent: outer,
    starAlpha: 1,
    coronaAlpha: 0.75,
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      if (basis.sinTilt !== drawnTilt || basis.sinYaw !== drawnYaw) {
        drawnTilt = basis.sinTilt;
        drawnYaw = basis.sinYaw;
        projectLand(basis);
        wedges.forEach((wedge, index) => drawWedge(wedge, index, basis));
      }
      for (const wedge of wedges) {
        wedge.lights.forEach((gfx, groupIndex) => {
          gfx.alpha = 0.72 + 0.28 * Math.sin(elapsed * wedge.rates[groupIndex] + wedge.phases[groupIndex]);
        });
      }
    },
    destroy() {
      for (const node of nodes) node.destroy({ children: true });
    },
  };
}
