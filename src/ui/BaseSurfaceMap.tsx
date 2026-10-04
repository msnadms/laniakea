import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { Base, BaseAddress } from '../game/base';
import { decodeBlockers, surfaceSeed, type BlockerKind } from '../game/baseSurface';
import { BASE_SURFACE_COLS, BASE_SURFACE_ROWS } from '../game/constants';
import { WHOLE_MAP, type TerrainRegion } from '../pixi/baseTerrain';
import type { TerrainTileRequest, TerrainTileResult } from '../pixi/baseTerrain.worker';

const ZOOM_STAGES = [24, 48, 72];
const OVERVIEW_CELL_PX = 4;
const OVERVIEW_KEY = 'overview';
const TILE_CELLS = 8;
const TERRAIN_WORKERS = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
const PAINT_SCALE = 0.5;
const MAX_PIXEL_RATIO = 2;
const TILE_CACHE_PIXELS = 16_000_000;
const ZOOM_MS = 260;
const WHEEL_STEP_MS = 200;
const DRAG_THRESHOLD_PX = 4;
const MENU_WIDTH_PX = 240;
const MENU_HEIGHT_PX = 180;
const MENU_GAP_PX = 6;
const MENU_INSET_PX = 8;

const NO_IMAGES: ReadonlyMap<string, ImageData> = new Map();

type BlockerGrid = readonly (BlockerKind | null)[];

const BLOCKER_NAMES: Record<BlockerKind, string> = { ocean: 'Ocean', ridge: 'Mountain range', lake: 'Inland sea' };

interface Camera {
  cx: number;
  cy: number;
  cellPx: number;
}

interface Size {
  width: number;
  height: number;
}

interface Tile {
  key: string;
  region: TerrainRegion;
  cellPx: number;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  cx: number;
  cy: number;
  moved: boolean;
}

interface ZoomAnimation {
  fromPx: number;
  toPx: number;
  anchorX: number;
  anchorY: number;
  screenX: number;
  screenY: number;
  start: number;
}

function sectorName(index: number): string {
  return `${(index % BASE_SURFACE_COLS) + 1}-${Math.floor(index / BASE_SURFACE_COLS) + 1}`;
}

function clampAxis(center: number, cells: number, viewport: number, cellPx: number): number {
  const half = viewport / 2 / cellPx;
  if (cells <= half * 2) return cells / 2;
  return Math.min(cells - half, Math.max(half, center));
}

function coverPx(size: Size): number {
  return Math.max(size.width / BASE_SURFACE_COLS, size.height / BASE_SURFACE_ROWS);
}

function clampCamera(camera: Camera, size: Size): Camera {
  const cellPx = Math.max(camera.cellPx, coverPx(size));
  return {
    cellPx,
    cx: clampAxis(camera.cx, BASE_SURFACE_COLS, size.width, cellPx),
    cy: clampAxis(camera.cy, BASE_SURFACE_ROWS, size.height, cellPx),
  };
}

function tilePosition(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

function tileAt(tx: number, ty: number, cellPx: number): Tile {
  const col = tx * TILE_CELLS;
  const row = ty * TILE_CELLS;
  return {
    key: `${cellPx}:${tilePosition(tx, ty)}`,
    cellPx,
    region: { col, row, cols: Math.min(TILE_CELLS, BASE_SURFACE_COLS - col), rows: Math.min(TILE_CELLS, BASE_SURFACE_ROWS - row) },
  };
}

function visibleTiles(camera: Camera, size: Size, cellPx: number): Tile[] {
  const halfW = size.width / 2 / camera.cellPx;
  const halfH = size.height / 2 / camera.cellPx;
  const lastX = Math.ceil(BASE_SURFACE_COLS / TILE_CELLS) - 1;
  const lastY = Math.ceil(BASE_SURFACE_ROWS / TILE_CELLS) - 1;
  const x0 = Math.max(0, Math.floor((camera.cx - halfW) / TILE_CELLS));
  const x1 = Math.min(lastX, Math.floor((camera.cx + halfW) / TILE_CELLS));
  const y0 = Math.max(0, Math.floor((camera.cy - halfH) / TILE_CELLS));
  const y1 = Math.min(lastY, Math.floor((camera.cy + halfH) / TILE_CELLS));
  const tiles: { tile: Tile; distance: number }[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const dx = (tx + 0.5) * TILE_CELLS - camera.cx;
      const dy = (ty + 0.5) * TILE_CELLS - camera.cy;
      tiles.push({ tile: tileAt(tx, ty, cellPx), distance: dx * dx + dy * dy });
    }
  }
  return tiles.sort((a, b) => a.distance - b.distance).map(({ tile }) => tile);
}

function useTerrainTiles(address: BaseAddress, seed: number, wanted: readonly Tile[]) {
  const wantedRef = useRef(wanted);
  const syncRef = useRef<() => void>(() => {});
  const [painted, setPainted] = useState<{ seed: number; images: ReadonlyMap<string, ImageData> } | null>(null);
  const [surveyed, setSurveyed] = useState<{ seed: number; grid: BlockerGrid } | null>(null);

  useLayoutEffect(() => {
    wantedRef.current = wanted;
    syncRef.current();
  }, [wanted]);

  const { superclusterSeed, galaxySeed, systemId, ring } = address;
  useEffect(() => {
    const world = { superclusterSeed, galaxySeed, systemId, ring };
    const images = new Map<string, ImageData>();
    const inFlight = new Set<string>();
    const idle: Worker[] = [];
    let surveyRequested = false;
    const isWanted = (key: string) => key === OVERVIEW_KEY || wantedRef.current.some((tile) => tile.key === key);

    const touch = () => {
      for (const { key } of wantedRef.current) {
        const image = images.get(key);
        if (!image) continue;
        images.delete(key);
        images.set(key, image);
      }
    };

    const store = (key: string, image: ImageData) => {
      images.set(key, image);
      let pixels = 0;
      for (const stored of images.values()) pixels += stored.width * stored.height;
      for (const [old, stored] of images) {
        if (pixels <= TILE_CACHE_PIXELS) break;
        if (isWanted(old)) continue;
        images.delete(old);
        pixels -= stored.width * stored.height;
      }
      setPainted({ seed, images: new Map(images) });
    };

    const dispatch = () => {
      while (idle.length > 0) {
        const next = wantedRef.current.find((tile) => !images.has(tile.key) && !inFlight.has(tile.key));
        if (!next) return;
        inFlight.add(next.key);
        const request: TerrainTileRequest = {
          key: next.key,
          address: world,
          region: next.region,
          cellPx: next.cellPx,
          withBlockers: !surveyRequested,
        };
        surveyRequested = true;
        idle.pop()!.postMessage(request);
      }
    };

    const workers = Array.from({ length: TERRAIN_WORKERS }, () => {
      const worker = new Worker(new URL('../pixi/baseTerrain.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<TerrainTileResult>) => {
        const { key, width, height, pixels, blockers } = event.data;
        inFlight.delete(key);
        if (blockers) setSurveyed({ seed, grid: decodeBlockers(blockers) });
        store(key, new ImageData(pixels, width, height));
        idle.push(worker);
        dispatch();
      };
      idle.push(worker);
      return worker;
    });

    syncRef.current = () => {
      touch();
      dispatch();
    };
    dispatch();
    return () => {
      syncRef.current = () => {};
      for (const worker of workers) worker.terminate();
    };
  }, [superclusterSeed, galaxySeed, systemId, ring, seed]);

  return {
    images: painted?.seed === seed ? painted.images : NO_IMAGES,
    grid: surveyed?.seed === seed ? surveyed.grid : null,
  };
}

function sharpestTiles(images: ReadonlyMap<string, ImageData>): Map<string, string> {
  const best = new Map<string, { key: string; cellPx: number }>();
  for (const key of images.keys()) {
    if (key === OVERVIEW_KEY) continue;
    const [cellPx, tx, ty] = key.split(':').map(Number);
    const position = tilePosition(tx, ty);
    const current = best.get(position);
    if (!current || cellPx > current.cellPx) best.set(position, { key, cellPx });
  }
  return new Map(Array.from(best, ([position, { key }]) => [position, key]));
}

function TerrainImage({ image, style }: { image: ImageData; style: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    ref.current?.getContext('2d')?.putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className="base-map-image" width={image.width} height={image.height} style={style} />;
}

function FactoryMenu({ index, left, top, onClose }: { index: number; left: number; top: number; onClose: () => void }) {
  return (
    <div
      className="base-factory-menu"
      style={{ left, top }}
      data-map-overlay
      role="dialog"
      aria-label={`Sector ${sectorName(index)}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="base-card-head">
        <span className="base-card-name">Place factory</span>
        <button type="button" className="base-factory-close" onClick={onClose} aria-label="Close menu">✕</button>
      </div>
      <div className="base-note">Sector {sectorName(index)}</div>
      <div className="base-factory-body" />
    </div>
  );
}

export function SurfaceMap({ base, children }: { base: Base; children?: ReactNode }) {
  const { superclusterSeed, galaxySeed, systemId, ring } = base;
  const seed = useMemo(() => surfaceSeed({ superclusterSeed, galaxySeed, systemId, ring }), [superclusterSeed, galaxySeed, systemId, ring]);
  const [size, setSize] = useState<Size | null>(null);
  const [camera, setCamera] = useState<Camera>({ cx: BASE_SURFACE_COLS / 2, cy: BASE_SURFACE_ROWS / 2, cellPx: ZOOM_STAGES[0] });
  const [stage, setStage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const animation = useRef<ZoomAnimation | null>(null);
  const animationFrame = useRef(0);
  const lastWheel = useRef(0);

  const view = size ? clampCamera(camera, size) : camera;
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const stageRef = useRef(stage);
  useLayoutEffect(() => {
    viewRef.current = view;
    sizeRef.current = size;
    stageRef.current = stage;
  });

  const pixelRatio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  const paintPx = Math.round(Math.max(ZOOM_STAGES[stage], size ? coverPx(size) : 0) * PAINT_SCALE * pixelRatio);
  const visible = useMemo(() => (size ? visibleTiles(view, size, paintPx) : []), [view, size, paintPx]);
  const wanted = useMemo(() => [{ key: OVERVIEW_KEY, region: WHOLE_MAP, cellPx: OVERVIEW_CELL_PX }, ...visible], [visible]);
  const { images, grid } = useTerrainTiles(base, seed, wanted);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelAnimationFrame(animationFrame.current), []);

  useEffect(() => {
    if (selected === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setSelected(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected]);

  const zoomTo = (next: number, screenX: number, screenY: number) => {
    const target = Math.min(ZOOM_STAGES.length - 1, Math.max(0, next));
    if (target === stageRef.current || !sizeRef.current) return;
    const from = viewRef.current;
    animation.current = {
      fromPx: from.cellPx,
      toPx: ZOOM_STAGES[target],
      anchorX: from.cx + screenX / from.cellPx,
      anchorY: from.cy + screenY / from.cellPx,
      screenX,
      screenY,
      start: performance.now(),
    };
    setStage(target);
    cancelAnimationFrame(animationFrame.current);
    const step = () => {
      const anim = animation.current;
      const bounds = sizeRef.current;
      if (!anim || !bounds) return;
      const t = Math.min(1, (performance.now() - anim.start) / ZOOM_MS);
      const eased = t * t * (3 - 2 * t);
      const cellPx = t === 1 ? anim.toPx : anim.fromPx * (anim.toPx / anim.fromPx) ** eased;
      setCamera(clampCamera({ cellPx, cx: anim.anchorX - anim.screenX / cellPx, cy: anim.anchorY - anim.screenY / cellPx }, bounds));
      if (t < 1) animationFrame.current = requestAnimationFrame(step);
      else animation.current = null;
    };
    animationFrame.current = requestAnimationFrame(step);
  };

  const zoomRef = useRef(zoomTo);
  useLayoutEffect(() => {
    zoomRef.current = zoomTo;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0 || drag.current?.moved || event.timeStamp - lastWheel.current < WHEEL_STEP_MS) return;
      lastWheel.current = event.timeStamp;
      const rect = frame.getBoundingClientRect();
      zoomRef.current(
        stageRef.current + (event.deltaY < 0 ? 1 : -1),
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2,
      );
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  const cellAt = (clientX: number, clientY: number): number | null => {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    const col = Math.floor(view.cx + (clientX - rect.left - rect.width / 2) / view.cellPx);
    const row = Math.floor(view.cy + (clientY - rect.top - rect.height / 2) / view.cellPx);
    if (col < 0 || col >= BASE_SURFACE_COLS || row < 0 || row >= BASE_SURFACE_ROWS) return null;
    return row * BASE_SURFACE_COLS + col;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cx: view.cx, cy: view.cy, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      const overOverlay = event.target instanceof Element && event.target.closest('[data-map-overlay]') !== null;
      setHovered(overOverlay ? null : cellAt(event.clientX, event.clientY));
      return;
    }
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      current.moved = true;
      animation.current = null;
      cancelAnimationFrame(animationFrame.current);
      setDragging(true);
      setHovered(null);
    }
    const bounds = sizeRef.current;
    if (!bounds) return;
    setCamera((c) => {
      const cellPx = clampCamera(c, bounds).cellPx;
      const panned = clampCamera({ ...c, cx: current.cx - dx / cellPx, cy: current.cy - dy / cellPx }, bounds);
      return { ...c, cx: panned.cx, cy: panned.cy };
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.moved) {
      setDragging(false);
      return;
    }
    if (event.type !== 'pointerup') return;
    const index = cellAt(event.clientX, event.clientY);
    setSelected(index === null || !grid || grid[index] || index === selected ? null : index);
  };

  const fallbacks = sharpestTiles(images);
  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const offsetX = Math.round(width / 2 - view.cx * view.cellPx);
  const offsetY = Math.round(height / 2 - view.cy * view.cellPx);
  const px = view.cellPx;
  const overview = images.get(OVERVIEW_KEY);

  const tiles = visible.flatMap((tile) => {
    const { col, row, cols, rows } = tile.region;
    const key = images.has(tile.key) ? tile.key : fallbacks.get(tilePosition(col / TILE_CELLS, row / TILE_CELLS));
    if (!key) return [];
    return [{ key, image: images.get(key)!, style: { left: col * px, top: row * px, width: cols * px, height: rows * px } }];
  });

  const marker = (index: number): CSSProperties => ({
    left: (index % BASE_SURFACE_COLS) * px,
    top: Math.floor(index / BASE_SURFACE_COLS) * px,
    width: px,
    height: px,
  });

  let menu: ReactNode = null;
  if (selected !== null) {
    const col = selected % BASE_SURFACE_COLS;
    const row = Math.floor(selected / BASE_SURFACE_COLS);
    const right = offsetX + (col + 1) * px + MENU_GAP_PX;
    const beside = right + MENU_WIDTH_PX > width ? offsetX + col * px - MENU_GAP_PX - MENU_WIDTH_PX : right;
    const left = Math.min(Math.max(MENU_INSET_PX, width - MENU_WIDTH_PX - MENU_INSET_PX), Math.max(MENU_INSET_PX, beside));
    const top = Math.min(Math.max(MENU_INSET_PX, height - MENU_HEIGHT_PX - MENU_INSET_PX), Math.max(MENU_INSET_PX, offsetY + row * px));
    menu = <FactoryMenu index={selected} left={left} top={top} onClose={() => setSelected(null)} />;
  }

  const hoveredKind = hovered === null || !grid ? null : grid[hovered];
  const layerStyle = {
    width: BASE_SURFACE_COLS * px,
    height: BASE_SURFACE_ROWS * px,
    transform: `translate(${offsetX}px, ${offsetY}px)`,
    '--cell': `${px}px`,
    '--grid-alpha': Math.min(0.22, 0.06 + px / 220),
  } as CSSProperties;

  return (
    <div
      ref={frameRef}
      className={`base-map${dragging ? ' base-map--dragging' : ''}${hoveredKind ? ' base-map--blocked' : ''}`}
      aria-label={`Surface of ${base.planetName}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => setHovered(null)}
    >
      <div className="base-map-layer" style={layerStyle}>
        {overview && <TerrainImage image={overview} style={{ inset: 0, width: '100%', height: '100%' }} />}
        {tiles.map(({ key, image, style }) => <TerrainImage key={key} image={image} style={style} />)}
        <div className="base-map-grid" />
        {hovered !== null && hovered !== selected && (
          <div className={`base-map-marker base-map-marker--hover${hoveredKind ? ' base-map-marker--blocked' : ''}`} style={marker(hovered)} />
        )}
        {selected !== null && <div className="base-map-marker base-map-marker--selected" style={marker(selected)} />}
      </div>
      <div className="base-map-overlays" data-map-overlay>{children}</div>
      {menu}
      {hovered !== null && (
        <div className="base-map-readout" data-map-overlay>
          Sector {sectorName(hovered)} · {grid ? (hoveredKind ? BLOCKER_NAMES[hoveredKind] : 'Open ground') : 'Surveying…'}
        </div>
      )}
      <div className="base-zoom" data-map-overlay onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="base-zoom-btn" disabled={stage === 0} onClick={() => zoomTo(stage - 1, 0, 0)} aria-label="Zoom out">−</button>
        <span className="base-zoom-level">×{ZOOM_STAGES[stage] / ZOOM_STAGES[0]}</span>
        <button
          type="button"
          className="base-zoom-btn"
          disabled={stage === ZOOM_STAGES.length - 1}
          onClick={() => zoomTo(stage + 1, 0, 0)}
          aria-label="Zoom in"
        >+</button>
      </div>
    </div>
  );
}
