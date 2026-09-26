import { Container, type Geometry, Graphics, Mesh, Polygon, type Shader } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import { createSurfaceTexture } from '../planetBody';
import { paintAldersonDisk } from '../planetSurfaces';
import { projectSystemPointWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { createDiskGeometry, createDiskSurfaceShader, type DiskLook } from './diskSurface';
import { mixColor, smoothstep, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const WEDGE_COUNT = 36;
const WEDGE_COLUMNS = 6;
const WEDGE_ROWS = 16;
const ARC_STEPS = 3;
const THICKNESS_SUN_RADII = 0.025;
const INNER_SUN_RADII = 2.6;
const OUTER_CLEARANCE = 0.88;
const MIN_WIDTH_RATIO = 2;
const CITY_LIGHTS_MIN = 6;
const CITY_LIGHTS_PER_SPAN = 200;
const CITY_LIGHT_TRIES = 4;
const DUSK_LIGHTS = 220;
const DUSK_MIN_T = 0.75;
const DUSK_SPAN = 0.23;
const LIGHT_GROUPS = 3;
const LIGHT_COLOR = 0xffc46a;
const OUTER_WALL_COLOR = 0x2a2e34;
const INNER_WALL_COLOR = 0x5a5048;
const BROKEN_WALL_COLOR = 0x191512;
const RUINED_LIGHT_FRACTION = 0.08;
const RUINED_SCHEDULE_RATE = 0.3;
const BREACH_RUNS_MAX = 5;
const BREACH_RUN_LENGTH_MAX = 4;
const BREACH_MIN_REACH = 0.38;
const BREACH_REACH_SPREAD = 0.45;

const LIVING_LOOK: DiskLook = { bump: 14, ambient: 0.05, haze: 0.14, hazeColor: 0x8fb4e0, cloudColor: 0xf2f4f6, cloudShadow: 0.012 };
const RUINED_LOOK: DiskLook = { bump: 16, ambient: 0.04, haze: 0.12, hazeColor: 0x9a8268, cloudColor: 0xa08a70, cloudShadow: 0.008 };

export function aldersonDiskOuterRadius(sunRadius: number, innermostClearance: number): number {
  const inner = sunRadius * INNER_SUN_RADII;
  return Math.min(innermostClearance, Math.max(innermostClearance * OUTER_CLEARANCE, inner * MIN_WIDTH_RATIO));
}

interface Light {
  angle: number;
  radius: number;
  size: number;
  alpha: number;
}

interface Wedge {
  node: Container;
  walls: Graphics;
  rim: Graphics;
  geometry: Geometry;
  lights: Graphics[];
  groups: Light[][];
  phases: number[];
  rates: number[];
  start: number;
  end: number;
  reach: number;
}

function wedgeIndex(angle: number): number {
  return Math.floor((((angle % TAU) + TAU) % TAU) / TAU * WEDGE_COUNT) % WEDGE_COUNT;
}

export function createAldersonDisk({ anomaly, sunRadius, starColor, innermostClearance, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const inner = sunRadius * INNER_SUN_RADII;
  const outer = aldersonDiskOuterRadius(sunRadius, innermostClearance);
  const span = outer - inner;
  const height = sunRadius * THICKNESS_SUN_RADII;
  const radiusAt = (t: number) => inner + span * t;
  const { living, integrity } = anomaly;

  const job = paintAldersonDisk(Math.floor(rng() * 0x7fffffff), inner / span, living);
  const albedo = createSurfaceTexture(job.surface.albedo);
  const detail = createSurfaceTexture(job.surface.detail);
  const surface = createDiskSurfaceShader(albedo, detail, living ? LIVING_LOOK : RUINED_LOOK, starColor, inner, sunRadius / inner, span / inner);

  const breaches = new Float32Array(WEDGE_COUNT).fill(1);
  if (!living) {
    const runs = 1 + Math.floor((1 - integrity) * BREACH_RUNS_MAX);
    for (let run = 0; run < runs; run++) {
      const first = Math.floor(rng() * WEDGE_COUNT);
      const length = 1 + Math.floor(rng() * BREACH_RUN_LENGTH_MAX);
      for (let k = 0; k < length; k++) {
        const index = (first + k) % WEDGE_COUNT;
        breaches[index] = Math.min(breaches[index], BREACH_MIN_REACH + rng() * BREACH_REACH_SPREAD);
      }
    }
  }

  const wedges: Wedge[] = Array.from({ length: WEDGE_COUNT }, (_, index) => {
    const start = index / WEDGE_COUNT * TAU;
    const end = (index + 1) / WEDGE_COUNT * TAU;
    const reach = breaches[index];
    const node = new Container();
    const walls = new Graphics();
    const rim = new Graphics();
    const geometry = createDiskGeometry(WEDGE_COLUMNS, WEDGE_ROWS, (column, row) => [
      (start + (end - start) * column / WEDGE_COLUMNS) / TAU,
      reach * row / WEDGE_ROWS,
    ]);
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader: surface.shader });
    const lights = Array.from({ length: LIGHT_GROUPS }, () => {
      const gfx = new Graphics();
      gfx.blendMode = 'add';
      gfx.eventMode = 'none';
      return gfx;
    });
    for (const child of [walls, mesh, rim]) child.eventMode = 'none';
    node.addChild(walls, mesh, rim, ...lights);
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.on('pointertap', onSelect);
    return {
      node,
      walls,
      rim,
      geometry,
      lights,
      groups: lights.map(() => []),
      phases: lights.map(() => rng() * TAU),
      rates: lights.map(() => 0.6 + rng() * 1.4),
      start,
      end,
      reach,
    };
  });

  const addLight = (angle: number, t: number, size: number) => {
    const wedge = wedges[wedgeIndex(angle)];
    if (t > wedge.reach) return;
    wedge.groups[Math.floor(rng() * LIGHT_GROUPS)].push({ angle, radius: radiusAt(t), size, alpha: 0.3 + 0.7 * smoothstep(0.3, 0.9, t) });
  };
  for (const city of job.cities) {
    if (!living && rng() >= RUINED_LIGHT_FRACTION) continue;
    const count = CITY_LIGHTS_MIN + Math.round(city.radius * CITY_LIGHTS_PER_SPAN);
    const around = inner / span + city.t;
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < CITY_LIGHT_TRIES; attempt++) {
        const distance = city.radius * 0.8 * Math.sqrt(rng());
        const bearing = rng() * TAU;
        const angle = city.angle + Math.cos(bearing) * distance / around;
        const t = city.t + Math.sin(bearing) * distance;
        if (!job.landAt(angle, t)) continue;
        addLight(angle, t, 1.2 + rng() * 1.6);
        break;
      }
    }
  }
  for (let i = 0; i < Math.round(DUSK_LIGHTS * (living ? 1 : RUINED_LIGHT_FRACTION)); i++) {
    const angle = rng() * TAU;
    const t = DUSK_MIN_T + rng() * DUSK_SPAN;
    if (job.landAt(angle, t)) addLight(angle, t, 1 + rng());
  }

  const point: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
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

  const drawWedge = (wedge: Wedge, basis: ProjectionBasis) => {
    const { walls, rim, start, end, reach } = wedge;
    const edge = radiusAt(reach);
    walls.clear();
    walls.poly(sector(edge, edge, start, end, -height, height, basis)).fill({ color: reach < 1 ? BROKEN_WALL_COLOR : OUTER_WALL_COLOR });
    walls.poly(sector(inner, inner, start, end, -height, height, basis)).fill({ color: mixColor(INNER_WALL_COLOR, starColor, 0.5) });

    const buffer = wedge.geometry.getBuffer('aPosition');
    const positions = buffer.data as Float32Array;
    for (let row = 0; row <= WEDGE_ROWS; row++) {
      const radius = radiusAt(reach * row / WEDGE_ROWS);
      for (let column = 0; column <= WEDGE_COLUMNS; column++) {
        const p = project(start + (end - start) * column / WEDGE_COLUMNS, radius, height, basis);
        const vertex = (row * (WEDGE_COLUMNS + 1) + column) * 2;
        positions[vertex] = p.x;
        positions[vertex + 1] = p.y;
      }
    }
    buffer.update();

    rim.clear();
    rim.poly(arc([], inner, start, end, height, basis), false).stroke({ color: mixColor(0xffffff, starColor, 0.6), width: 1.5, alpha: 0.5 });

    wedge.groups.forEach((group, groupIndex) => {
      const gfx = wedge.lights[groupIndex];
      gfx.clear();
      for (const light of group) {
        const p = project(light.angle, light.radius, height, basis);
        gfx.circle(p.x, p.y, light.size * p.scale).fill({ color: LIGHT_COLOR, alpha: light.alpha });
      }
    });

    wedge.node.hitArea = new Polygon(sector(inner, edge, start, end, height, height, basis));
    wedge.node.zIndex = project((start + end) / 2, (inner + edge) / 2, height, basis).depth;
  };

  let drawnTilt = NaN;
  let drawnYaw = NaN;
  const nodes = wedges.map((wedge) => wedge.node);

  return {
    nodes,
    extent: outer,
    starAlpha: 1,
    coronaAlpha: 0.75,
    surface: { job, textures: [albedo, detail] },
    update(_dt: number, elapsed: number, basis: ProjectionBasis) {
      if (basis.sinTilt !== drawnTilt || basis.sinYaw !== drawnYaw) {
        drawnTilt = basis.sinTilt;
        drawnYaw = basis.sinYaw;
        surface.setView(Math.abs(basis.sinTilt));
        for (const wedge of wedges) drawWedge(wedge, basis);
      }
      for (const wedge of wedges) {
        wedge.lights.forEach((gfx, groupIndex) => {
          gfx.alpha = living
            ? 0.72 + 0.28 * Math.sin(elapsed * wedge.rates[groupIndex] + wedge.phases[groupIndex])
            : smoothstep(0.4, 0.9, Math.sin(elapsed * wedge.rates[groupIndex] * RUINED_SCHEDULE_RATE + wedge.phases[groupIndex]));
        });
      }
    },
    destroy() {
      for (const node of nodes) node.destroy({ children: true });
      for (const wedge of wedges) wedge.geometry.destroy();
      job.cancel();
      surface.destroy();
      albedo.destroy(true);
      detail.destroy(true);
    },
  };
}
