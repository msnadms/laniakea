import { useEffect, useRef } from 'react';
import { UNIVERSE_RADIUS } from '../game/constants';
import type { Point3 } from '../game/fuel';
import { flyForward } from '../pixi/flyProjection';
import { subscribeFlightCamera } from '../store/flightStore';
import { useFuelStore } from '../store/fuelStore';
import './Minimap.css';

const RADIUS_PX = 52;
const VIEW_PX = RADIUS_PX + 6;
const ELEVATION = 26 * Math.PI / 180;
const SIN_ELEVATION = Math.sin(ELEVATION);
const COS_ELEVATION = Math.cos(ELEVATION);
const RING_SEGMENTS = 48;
const HEADING_PX = 14;
const SWEEP_SECTORS = 14;
const SWEEP_SECTOR_DEGREES = 4;
const SWEEP_SECONDS = 6;

function mapX(x: number): number {
  return x / UNIVERSE_RADIUS * RADIUS_PX;
}

function mapY(y: number, z: number): number {
  return -(z * SIN_ELEVATION + y * COS_ELEVATION) / UNIVERSE_RADIUS * RADIUS_PX;
}

function equatorPath(from: number, to: number): string {
  return Array.from({ length: RING_SEGMENTS + 1 }, (_, s) => {
    const angle = from + (to - from) * s / RING_SEGMENTS;
    const x = Math.cos(angle) * RADIUS_PX;
    const y = -Math.sin(angle) * RADIUS_PX * SIN_ELEVATION;
    return `${s === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function sectorPath(fromDegrees: number, toDegrees: number): string {
  const from = fromDegrees * Math.PI / 180;
  const to = toDegrees * Math.PI / 180;
  const r = RADIUS_PX;
  return `M 0 0 L ${(Math.cos(from) * r).toFixed(2)} ${(Math.sin(from) * r).toFixed(2)} A ${r} ${r} 0 0 1 ${(Math.cos(to) * r).toFixed(2)} ${(Math.sin(to) * r).toFixed(2)} Z`;
}

const SWEEP = Array.from({ length: SWEEP_SECTORS }, (_, i) => ({
  d: sectorPath(-(i + 1) * SWEEP_SECTOR_DEGREES, -i * SWEEP_SECTOR_DEGREES),
  opacity: 0.22 * (1 - i / SWEEP_SECTORS),
}));

const EQUATOR_BACK = equatorPath(0, Math.PI);
const EQUATOR_FRONT = equatorPath(Math.PI, Math.PI * 2);

export function Minimap() {
  const markerRef = useRef<SVGGElement>(null);
  const footRef = useRef<SVGEllipseElement>(null);
  const stalkRef = useRef<SVGLineElement>(null);
  const headingRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const forward = { x: 0, y: 0, z: 0 };
    let live = false;
    let drawn = '';

    const place = (point: Point3 | null, heading: Point3 | null) => {
      const marker = markerRef.current;
      const foot = footRef.current;
      const stalk = stalkRef.current;
      const headingLine = headingRef.current;
      const dot = dotRef.current;
      if (!marker || !foot || !stalk || !headingLine || !dot) return;
      if (!point) {
        marker.setAttribute('visibility', 'hidden');
        drawn = '';
        return;
      }
      const footX = mapX(point.x);
      const footY = mapY(0, point.z);
      const dotY = mapY(point.y, point.z);
      const headingX = heading ? heading.x * HEADING_PX : 0;
      const headingY = heading ? -(heading.z * SIN_ELEVATION + heading.y * COS_ELEVATION) * HEADING_PX : 0;
      const key = `${footX.toFixed(2)} ${footY.toFixed(2)} ${dotY.toFixed(2)} ${headingX.toFixed(2)} ${headingY.toFixed(2)}`;
      if (key === drawn) return;
      drawn = key;
      marker.setAttribute('visibility', 'visible');
      foot.setAttribute('cx', String(footX));
      foot.setAttribute('cy', String(footY));
      stalk.setAttribute('x1', String(footX));
      stalk.setAttribute('y1', String(footY));
      stalk.setAttribute('x2', String(footX));
      stalk.setAttribute('y2', String(dotY));
      headingLine.setAttribute('visibility', heading ? 'visible' : 'hidden');
      headingLine.setAttribute('x1', String(footX));
      headingLine.setAttribute('y1', String(dotY));
      headingLine.setAttribute('x2', String(footX + headingX));
      headingLine.setAttribute('y2', String(dotY + headingY));
      dot.setAttribute('transform', `translate(${footX} ${dotY})`);
    };

    place(useFuelStore.getState().ship, null);
    const stopShip = useFuelStore.subscribe((state) => {
      if (!live) place(state.ship, null);
    });
    const stopCamera = subscribeFlightCamera((camera) => {
      live = camera !== null;
      if (camera) place(camera, flyForward(camera, forward));
      else place(useFuelStore.getState().ship, null);
    });
    return () => {
      stopShip();
      stopCamera();
    };
  }, []);

  return (
    <svg
      className="minimap"
      width={VIEW_PX * 2}
      height={VIEW_PX * 2}
      viewBox={`${-VIEW_PX} ${-VIEW_PX} ${VIEW_PX * 2} ${VIEW_PX * 2}`}
      role="img"
      aria-label="Ship position in the observable universe"
    >
      <circle className="minimap-limb" r={RADIUS_PX} />
      <ellipse className="minimap-meridian" rx={RADIUS_PX} ry={RADIUS_PX * COS_ELEVATION} />
      <path className="minimap-equator minimap-equator--back" d={EQUATOR_BACK} />
      <path className="minimap-equator" d={EQUATOR_FRONT} />
      <ellipse className="minimap-inner" rx={RADIUS_PX / 2} ry={RADIUS_PX / 2 * SIN_ELEVATION} />
      <path
        className="minimap-axes"
        d={`M ${-RADIUS_PX} 0 H ${RADIUS_PX} M 0 ${-RADIUS_PX * SIN_ELEVATION} V ${RADIUS_PX * SIN_ELEVATION}`}
      />
      <g className="minimap-sweep" transform={`scale(1 ${SIN_ELEVATION})`}>
        <g>
          {SWEEP.map((sector, i) => <path key={i} d={sector.d} fillOpacity={sector.opacity} />)}
          <line className="minimap-sweep-edge" x2={RADIUS_PX} vectorEffect="non-scaling-stroke" />
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur={`${SWEEP_SECONDS}s`} repeatCount="indefinite" />
        </g>
      </g>
      <circle className="minimap-origin" r={1.5} />
      <g ref={markerRef} visibility="hidden">
        <ellipse ref={footRef} className="minimap-foot" rx={3} ry={3 * SIN_ELEVATION} />
        <line ref={stalkRef} className="minimap-stalk" />
        <line ref={headingRef} className="minimap-heading" />
        <g ref={dotRef}>
          <circle className="minimap-pulse" r={5.5} />
          <circle className="minimap-dot" r={2.5} />
        </g>
      </g>
    </svg>
  );
}
