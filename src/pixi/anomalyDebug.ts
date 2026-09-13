import { Container, Graphics, Text } from 'pixi.js';
import { generateAnomalies, hasCivilization, type AnomalyKind, type GalaxyAnomalies } from '../game/anomalies';
import { generateGalaxy } from '../game/galaxyGen';
import { generateSuperclusterGalaxySeeds } from '../game/superclusters';
import { UNIVERSE_PICK_MIN_ALPHA } from '../game/constants';
import type { FlyCamera, StarSystem, SuperclusterDot, UniverseChunk } from '../game/types';
import { projectPlanePointWithBasis, type ProjectedPoint, type ProjectionBasis } from './projection';
import { projectUniversePoint, type FlyBasis } from './flyProjection';

const KIND_COLORS: Record<AnomalyKind, number> = {
  matrioshkaBrain: 0xff3030,
  nicollDysonBeam: 0xffd040,
  caplanThruster: 0x40e0ff,
  dysonSphere: 0xff8a30,
  homeworld: 0x60ff9a,
  blackHole: 0xb070ff,
  aldersonDisk: 0xff70d0,
  alcubierreCannon: 0x5a8cff,
};

const KIND_LABELS: Record<AnomalyKind, string> = {
  matrioshkaBrain: 'BRAIN',
  nicollDysonBeam: 'BEAM',
  caplanThruster: 'CAPLAN',
  dysonSphere: 'DYSON',
  homeworld: 'HOMEWORLD',
  blackHole: 'BLACK HOLE',
  aldersonDisk: 'ALDERSON DISK',
  alcubierreCannon: 'CANNON',
};

const KIND_RANK: AnomalyKind[] = ['alcubierreCannon', 'aldersonDisk','matrioshkaBrain','nicollDysonBeam', 'caplanThruster', 'dysonSphere', 'homeworld', 'blackHole'];

const LIVING_COLOR = 0xffe080;

const POPULATED_COLOR = 0x9affc8;

const REGION_COLOR = 0xff8a30;

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
      const topKind = KIND_RANK.find((kind) => kinds.has(kind));
      const color = topKind ? KIND_COLORS[topKind] : POPULATED_COLOR;
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

const UNIVERSE_SCAN_RADIUS = 600;

const UNIVERSE_RESCAN_MOVE = 100;

interface UniverseMark {
  kind: AnomalyKind | null;
  living: boolean;
}

interface UniverseScan {
  seed: number;
  x: number;
  y: number;
  z: number;
  distSq: number;
  civilizationSeeds: number[] | null;
  next: number;
  best: UniverseMark | null;
  bestRank: number;
}

interface UniverseEntry {
  x: number;
  y: number;
  z: number;
  mark: UniverseMark;
  label: Text;
}

const universeMarks = new Map<number, UniverseMark | null>();

function markRank(mark: UniverseMark): number {
  return mark.kind ? KIND_RANK.indexOf(mark.kind) : KIND_RANK.length;
}

function considerGalaxy(scan: UniverseScan, galaxySeed: number) {
  const anomalies = generateAnomalies(generateGalaxy(galaxySeed));
  const candidates: UniverseMark[] = [...anomalies.byHost.values()].map((anomaly) => ({ kind: anomaly.kind, living: anomaly.living }));
  if (anomalies.civilization) candidates.push({ kind: null, living: anomalies.civilization.living });
  for (const candidate of candidates) {
    const rank = markRank(candidate);
    if (rank < scan.bestRank || (rank === scan.bestRank && candidate.living && !scan.best?.living)) {
      scan.best = candidate;
      scan.bestRank = rank;
    }
  }
}

export function createUniverseAnomalyDebug() {
  const container = new Container();
  container.eventMode = 'none';
  const rings = new Graphics();
  container.addChild(rings);

  const queue: UniverseScan[] = [];
  const entries = new Map<number, UniverseEntry>();
  let queueIndex = 0;
  let scan: UniverseScan | null = null;
  const scannedAt = { x: NaN, y: NaN, z: NaN, chunks: -1 };
  const projected = emptyPoint();

  const addEntry = (seed: number, x: number, y: number, z: number, mark: UniverseMark) => {
    const color = mark.kind ? KIND_COLORS[mark.kind] : POPULATED_COLOR;
    const text = `${mark.kind ? KIND_LABELS[mark.kind] : 'POPULATED'}${mark.living ? ' (living)' : ''}`;
    const label = new Text({ text, style: { fontFamily: 'IBM Plex Sans', fontSize: 11, fill: color } });
    label.anchor.set(0, 0.5);
    container.addChild(label);
    entries.set(seed, { x, y, z, mark, label });
  };

  const rebuild = (chunks: readonly UniverseChunk[], camera: FlyCamera) => {
    scannedAt.x = camera.x;
    scannedAt.y = camera.y;
    scannedAt.z = camera.z;
    scannedAt.chunks = chunks.length;
    queue.length = 0;
    queueIndex = 0;
    const inRange = new Set<number>();
    const radiusSq = UNIVERSE_SCAN_RADIUS * UNIVERSE_SCAN_RADIUS;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.count; i++) {
        const dx = chunk.x[i] - camera.x;
        const dy = chunk.y[i] - camera.y;
        const dz = chunk.z[i] - camera.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > radiusSq) continue;
        const seed = chunk.seeds[i];
        inRange.add(seed);
        const mark = universeMarks.get(seed);
        if (mark === undefined) {
          if (seed !== scan?.seed) queue.push({ seed, x: chunk.x[i], y: chunk.y[i], z: chunk.z[i], distSq, civilizationSeeds: null, next: 0, best: null, bestRank: Infinity });
        } else if (mark && !entries.has(seed)) {
          addEntry(seed, chunk.x[i], chunk.y[i], chunk.z[i], mark);
        }
      }
    }
    queue.sort((a, b) => a.distSq - b.distSq);
    for (const [seed, entry] of entries) {
      if (inRange.has(seed)) continue;
      entry.label.destroy();
      entries.delete(seed);
    }
  };

  const step = () => {
    if (!scan) {
      while (queueIndex < queue.length && universeMarks.has(queue[queueIndex].seed)) queueIndex++;
      if (queueIndex >= queue.length) return false;
      scan = queue[queueIndex++];
      return true;
    }
    if (!scan.civilizationSeeds) {
      scan.civilizationSeeds = generateSuperclusterGalaxySeeds(scan.seed).filter(hasCivilization);
      return true;
    }
    if (scan.next < scan.civilizationSeeds.length) {
      considerGalaxy(scan, scan.civilizationSeeds[scan.next++]);
      return true;
    }
    universeMarks.set(scan.seed, scan.best);
    if (scan.best) addEntry(scan.seed, scan.x, scan.y, scan.z, scan.best);
    scan = null;
    return true;
  };

  return {
    node: container,
    update(chunks: readonly UniverseChunk[], camera: FlyCamera, basis: FlyBasis, cameraScale: number) {
      const moveX = camera.x - scannedAt.x;
      const moveY = camera.y - scannedAt.y;
      const moveZ = camera.z - scannedAt.z;
      if (chunks.length !== scannedAt.chunks || !(moveX * moveX + moveY * moveY + moveZ * moveZ <= UNIVERSE_RESCAN_MOVE * UNIVERSE_RESCAN_MOVE)) {
        rebuild(chunks, camera);
      }
      const deadline = performance.now() + SCAN_BUDGET_MS;
      while (step() && performance.now() < deadline);

      rings.clear();
      for (const entry of entries.values()) {
        const alpha = projectUniversePoint(entry.x, entry.y, entry.z, basis, projected);
        entry.label.visible = alpha >= UNIVERSE_PICK_MIN_ALPHA;
        if (!entry.label.visible) continue;
        const color = entry.mark.kind ? KIND_COLORS[entry.mark.kind] : POPULATED_COLOR;
        const radius = (projected.scale / 2 + 7) / cameraScale;
        rings.circle(projected.x, projected.y, radius).stroke({ color, width: 1.5 / cameraScale, alpha });
        if (entry.mark.living) rings.circle(projected.x, projected.y, radius + 4 / cameraScale).stroke({ color: LIVING_COLOR, width: 2 / cameraScale, alpha });
        entry.label.position.set(projected.x + radius + 6 / cameraScale, projected.y);
        entry.label.scale.set(1 / cameraScale);
        entry.label.alpha = alpha;
      }
    },
  };
}

export function createGalaxyAnomalyDebug(root: Container, systems: readonly StarSystem[], anomalies: GalaxyAnomalies) {
  const container = new Container();
  container.zIndex = 100000;
  container.eventMode = 'none';
  const rings = new Graphics();
  container.addChild(rings);

  const marks = [
    ...[...anomalies.byHost.values()].map((anomaly) => ({
      hostId: anomaly.hostId,
      color: anomaly.living ? LIVING_COLOR : KIND_COLORS[anomaly.kind],
      ringWidth: anomaly.living ? 3 : 1.5,
      text: `${KIND_LABELS[anomaly.kind]}${anomaly.swarm ? ' + SWARM' : ''}${anomaly.living ? ' (living)' : ''}${anomaly.active ? ' (active)' : ''}`,
    })),
    ...[...anomalies.populated].map((hostId) => ({ hostId, color: POPULATED_COLOR, ringWidth: 1.5, text: 'POPULATED' })),
  ];
  const entries = marks.map(({ hostId, color, ringWidth, text }) => {
    const label = new Text({ text, style: { fontFamily: 'IBM Plex Sans', fontSize: 12, fill: color } });
    label.anchor.set(0, 0.5);
    container.addChild(label);
    return { host: systems[hostId], color, ringWidth, label, projected: emptyPoint() };
  });

  const region = anomalies.civilization;
  const regionPoints = region ? Array.from({ length: REGION_STEPS }, emptyPoint) : [];
  const regionCentre = emptyPoint();
  const stageLabel = region
    ? new Text({ text: `STAGE ${region.stage} ${region.living ? 'LIVING' : 'RUINED'}`, style: { fontFamily: 'IBM Plex Sans', fontSize: 13, fill: REGION_COLOR } })
    : null;
  if (stageLabel) {
    stageLabel.anchor.set(0.5, 1);
    container.addChild(stageLabel);
  }
  root.addChild(container);

  let scale = 1;
  const redraw = () => {
    rings.clear();
    if (regionPoints.length > 0) {
      rings.moveTo(regionPoints[0].x, regionPoints[0].y);
      for (const point of regionPoints) rings.lineTo(point.x, point.y);
      rings.closePath().stroke({ color: REGION_COLOR, width: 1 / scale, alpha: 0.5 });
    }
    if (stageLabel) {
      stageLabel.position.set(regionCentre.x, regionCentre.y - 20 / scale);
      stageLabel.scale.set(1 / scale);
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
        projectPlanePointWithBasis(region.x, region.y, 0, basis, regionCentre);
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
