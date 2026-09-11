import { Container, Graphics, Text } from 'pixi.js';
import { generateAnomalies, hasCivilization, type AnomalyKind, type GalaxyAnomalies } from '../game/anomalies';
import { generateGalaxy } from '../game/galaxyGen';
import type { StarSystem, SuperclusterDot } from '../game/types';
import { projectPlanePointWithBasis, type ProjectedPoint, type ProjectionBasis } from './projection';

const KIND_COLORS: Record<AnomalyKind, number> = {
  matrioshkaBrain: 0xff3030,
  nicollDysonBeam: 0xffd040,
  shkadovThruster: 0x40e0ff,
  dysonSphere: 0xff8a30,
  blackHole: 0xb070ff,
};

const KIND_LABELS: Record<AnomalyKind, string> = {
  matrioshkaBrain: 'BRAIN',
  nicollDysonBeam: 'BEAM',
  shkadovThruster: 'SHKADOV',
  dysonSphere: 'DYSON',
  blackHole: 'BLACK HOLE',
};

const KIND_RANK: AnomalyKind[] = ['matrioshkaBrain', 'nicollDysonBeam', 'shkadovThruster', 'dysonSphere', 'blackHole'];

const LIVING_COLOR = 0xffe080;

const REGION_STEPS = 64;

const SCAN_BUDGET_MS = 6;

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

export function createSuperclusterAnomalyDebug(dots: readonly SuperclusterDot[]) {
  const groups = new Map<number, SuperclusterDot[]>();
  const living: SuperclusterDot[] = [];
  let cursor = 0;
  const scan = () => {
    const deadline = performance.now() + SCAN_BUDGET_MS;
    while (cursor < dots.length) {
      const dot = dots[cursor++];
      if (!hasCivilization(dot.seed)) continue;
      const anomalies = generateAnomalies(generateGalaxy(dot.seed));
      const kinds = new Set([...anomalies.byHost.values()].map((anomaly) => anomaly.kind));
      const color = KIND_COLORS[KIND_RANK.find((kind) => kinds.has(kind)) ?? 'dysonSphere'];
      const group = groups.get(color);
      if (group) group.push(dot);
      else groups.set(color, [dot]);
      if (anomalies.civilization?.living) living.push(dot);
      if (performance.now() > deadline) return;
    }
  };

  const gfx = new Graphics();
  gfx.eventMode = 'none';
  const projected = emptyPoint();

  return {
    node: gfx,
    draw(basis: ProjectionBasis, cameraScale: number) {
      if (cursor < dots.length) scan();
      gfx.clear();
      const radius = 10 / cameraScale;
      for (const [color, group] of groups) {
        for (const dot of group) {
          projectPlanePointWithBasis(dot.x, dot.y, dot.z, basis, projected);
          gfx.circle(projected.x, projected.y, radius);
        }
        gfx.stroke({ color, width: 1.5 / cameraScale, alpha: 0.9 });
      }
      // Drawn last, in front of every kind-color ring, so living civilisations are never lost among them.
      const livingRadius = 16 / cameraScale;
      for (const dot of living) {
        projectPlanePointWithBasis(dot.x, dot.y, dot.z, basis, projected);
        gfx.circle(projected.x, projected.y, livingRadius);
      }
      if (living.length > 0) gfx.stroke({ color: LIVING_COLOR, width: 3 / cameraScale, alpha: 1 });
    },
  };
}

export function createGalaxyAnomalyDebug(root: Container, systems: readonly StarSystem[], anomalies: GalaxyAnomalies) {
  const container = new Container();
  container.zIndex = 100000;
  container.eventMode = 'none';
  const rings = new Graphics();
  container.addChild(rings);

  const entries = [...anomalies.byHost.values()].map((anomaly) => {
    const color = anomaly.living ? LIVING_COLOR : KIND_COLORS[anomaly.kind];
    const label = new Text({
      text: `${KIND_LABELS[anomaly.kind]}${anomaly.living ? ' (living)' : ''}${anomaly.active ? ' (active)' : ''}`,
      style: { fontFamily: 'IBM Plex Sans', fontSize: 12, fill: color },
    });
    label.anchor.set(0, 0.5);
    container.addChild(label);
    return { host: systems[anomaly.hostId], color, ringWidth: anomaly.living ? 3 : 1.5, label, projected: emptyPoint() };
  });

  const region = anomalies.civilization;
  const regionPoints = region ? Array.from({ length: REGION_STEPS }, emptyPoint) : [];
  root.addChild(container);

  let scale = 1;
  const redraw = () => {
    rings.clear();
    if (regionPoints.length > 0) {
      rings.moveTo(regionPoints[0].x, regionPoints[0].y);
      for (const point of regionPoints) rings.lineTo(point.x, point.y);
      rings.closePath().stroke({ color: 0xff8a30, width: 1 / scale, alpha: 0.5 });
    }
    for (const entry of entries) {
      rings.circle(entry.projected.x, entry.projected.y, 12 / scale).stroke({ color: entry.color, width: entry.ringWidth / scale, alpha: 0.95 });
      entry.label.position.set(entry.projected.x + 16 / scale, entry.projected.y);
      entry.label.scale.set(1 / scale);
    }
  };

  return {
    project(basis: ProjectionBasis) {
      for (const entry of entries) projectPlanePointWithBasis(entry.host.x, entry.host.y, entry.host.z, basis, entry.projected);
      if (region) {
        regionPoints.forEach((point, i) => {
          const angle = i / REGION_STEPS * Math.PI * 2;
          projectPlanePointWithBasis(region.x + Math.cos(angle) * region.radius, region.y + Math.sin(angle) * region.radius, 0, basis, point);
        });
      }
      redraw();
    },
    tick(cameraScale: number) {
      if (cameraScale === scale) return;
      scale = cameraScale;
      redraw();
    },
    destroy() {
      root.removeChild(container);
      container.destroy({ children: true });
    },
  };
}
