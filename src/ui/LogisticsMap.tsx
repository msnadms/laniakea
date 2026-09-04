import { useMemo } from 'react';
import { ICON_PATHS } from './iconPaths';
import { MAP_SIZE, NODE_R } from './logisticsProject';
import type { ProjectedMapNode } from './logisticsProject';

const ICON_SIZE = NODE_R * 1.6;
const ICON_HALF = ICON_SIZE / 2;

function NodeIcon({ cx, cy, resourceType, color }: { cx: number; cy: number; resourceType: string; color: string }) {
  const d = ICON_PATHS[resourceType as keyof typeof ICON_PATHS];
  if (!d) return null;
  return (
    <path
      d={d}
      fill={color}
      transform={`translate(${cx - ICON_HALF},${cy - ICON_HALF}) scale(${ICON_SIZE / 960}) translate(0,960)`}
      style={{ pointerEvents: 'none' }}
    />
  );
}

export function StationMap({
  projected,
  draftNodeKeys,
  onToggle,
  onNodeHover,
  onBackgroundClick,
  animActiveNodeId,
}: {
  projected: ProjectedMapNode[];
  draftNodeKeys: string[];
  onToggle: (keys: string[]) => void;
  onNodeHover: (nodeId: string) => void;
  onBackgroundClick?: () => void;
  animActiveNodeId?: string | null;
}) {
  const byNodeId = useMemo(
    () => Object.fromEntries(projected.map((p) => [p.nodeId, p])),
    [projected],
  );

  const keyToNodeId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projected) for (const k of p.keys) m[k] = p.nodeId;
    return m;
  }, [projected]);

  if (projected.length === 0) {
    return (
      <div className="station-map-empty">No extraction stations or fabricators placed</div>
    );
  }

  const routeNodeIds: string[] = [];
  const seenInRoute = new Set<string>();
  for (const k of draftNodeKeys) {
    const nid = keyToNodeId[k];
    if (nid && !seenInRoute.has(nid)) { seenInRoute.add(nid); routeNodeIds.push(nid); }
  }

  const edges: { x1: number; y1: number; x2: number; y2: number; i: number }[] = [];
  for (let i = 0; i < routeNodeIds.length - 1; i++) {
    const a = byNodeId[routeNodeIds[i]];
    const b = byNodeId[routeNodeIds[i + 1]];
    if (a && b) {
      const dx = b.svgX - a.svgX;
      const dy = b.svgY - a.svgY;
      const len = Math.hypot(dx, dy) || 1;
      const pad = NODE_R + 2;
      edges.push({
        x1: a.svgX + (dx / len) * pad,
        y1: a.svgY + (dy / len) * pad,
        x2: b.svgX - (dx / len) * pad,
        y2: b.svgY - (dy / len) * pad,
        i,
      });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
      className="station-map-svg"
      xmlns="http://www.w3.org/2000/svg"
      onClick={onBackgroundClick}
    >
      <defs>
        <marker id="lm-arrow" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0, 5 2, 0 4" fill="rgba(0,180,220,0.55)" />
        </marker>
        <marker id="lm-arrow-col" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0, 5 2, 0 4" fill="rgba(60,200,100,0.55)" />
        </marker>
      </defs>

      {edges.map((e) => {
        const toNode = byNodeId[routeNodeIds[e.i + 1]];
        const toFabricator = toNode?.nodeType === 'fabricator';
        return (
          <line
            key={e.i}
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke={toFabricator ? 'rgba(60,200,100,0.45)' : 'rgba(0,180,220,0.45)'}
            strokeWidth="1.2"
            strokeDasharray="5 3"
            markerEnd={toFabricator ? 'url(#lm-arrow-col)' : 'url(#lm-arrow)'}
          />
        );
      })}

      {projected.map((p) => {
        const inRoute = p.keys.some((k) => draftNodeKeys.includes(k));
        const shortName = p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name;
        const isFabricator = p.nodeType === 'fabricator';
        const isAdvanced = isFabricator && !!p.advanced;

        const fabStrokeActive = isAdvanced ? 'rgba(255,190,80,0.9)' : 'rgba(60,220,100,0.9)';
        const fabStrokeIdle = isAdvanced ? 'rgba(150,105,30,0.5)' : 'rgba(30,140,60,0.5)';
        const fabFillActive = isAdvanced ? 'rgba(110,70,10,0.4)' : 'rgba(20,100,40,0.4)';
        const fabFillIdle = isAdvanced ? 'rgba(30,20,0,0.5)' : 'rgba(0,30,10,0.5)';
        const fabGlow = isAdvanced ? 'rgba(220,170,60,0.2)' : 'rgba(60,200,80,0.2)';
        const fabLabelActive = isAdvanced ? 'rgba(255,200,90,0.8)' : 'rgba(60,220,100,0.8)';
        const fabLabelIdle = isAdvanced ? 'rgba(150,110,35,0.55)' : 'rgba(30,140,60,0.55)';

        const strokeActive = isFabricator ? fabStrokeActive : 'rgba(0,215,255,0.85)';
        const strokeIdle = isFabricator ? fabStrokeIdle : 'rgba(0,130,180,0.45)';
        const fillActive = isFabricator ? fabFillActive : 'rgba(0,140,190,0.35)';
        const fillIdle = isFabricator ? fabFillIdle : 'rgba(0,50,80,0.5)';
        const glowActive = isFabricator ? fabGlow : 'rgba(0,210,240,0.2)';
        const labelActive = isFabricator ? fabLabelActive : 'rgba(0,200,232,0.75)';
        const labelIdle = isFabricator ? fabLabelIdle : 'rgba(0,130,170,0.5)';

        const primaryRes = p.resources?.reduce(
          (a, b) => (a.accumulated >= b.accumulated ? a : b),
          p.resources[0],
        );
        const iconColor = inRoute
          ? (isFabricator ? (isAdvanced ? 'rgba(255,205,100,0.9)' : 'rgba(80,230,120,0.9)') : 'rgba(0,230,255,0.9)')
          : (isFabricator ? (isAdvanced ? 'rgba(150,110,35,0.55)' : 'rgba(30,140,60,0.55)') : 'rgba(0,150,190,0.55)');

        return (
          <g
            key={p.nodeId}
            onClick={(e) => { e.stopPropagation(); onToggle(p.keys); }}
            onMouseEnter={() => onNodeHover(p.nodeId)}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={p.svgX} cy={p.svgY} r={NODE_R + 6} fill="transparent" />
            {p.nodeId === animActiveNodeId && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 7}
                fill="rgba(255, 230, 80, 0.07)"
                stroke="rgba(255, 220, 60, 0.85)"
                strokeWidth="1.5"
                className="dispatch-node-pulse"
              />
            )}
            {inRoute && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 3}
                fill="none"
                stroke={glowActive}
                strokeWidth="3"
              />
            )}
            <circle
              cx={p.svgX} cy={p.svgY} r={NODE_R}
              fill={inRoute ? fillActive : fillIdle}
              stroke={inRoute ? strokeActive : strokeIdle}
              strokeWidth="1.5"
            />
            {isFabricator ? (
              <>
                <polygon
                  points={`${p.svgX},${p.svgY - ICON_HALF * 0.85} ${p.svgX + ICON_HALF * 0.65},${p.svgY} ${p.svgX},${p.svgY + ICON_HALF * 0.85} ${p.svgX - ICON_HALF * 0.65},${p.svgY}`}
                  fill={iconColor}
                  style={{ pointerEvents: 'none' }}
                />
                {isAdvanced && (
                  <polygon
                    points={`${p.svgX},${p.svgY - ICON_HALF * 1.45} ${p.svgX + ICON_HALF * 1.1},${p.svgY} ${p.svgX},${p.svgY + ICON_HALF * 1.45} ${p.svgX - ICON_HALF * 1.1},${p.svgY}`}
                    fill="none"
                    stroke={iconColor}
                    strokeWidth="0.9"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              </>
            ) : p.resources && p.resources.length > 1 ? (
              <NodeIcon cx={p.svgX} cy={p.svgY} resourceType="multiSystem" color={iconColor} />
            ) : primaryRes ? (
              <NodeIcon cx={p.svgX} cy={p.svgY} resourceType={primaryRes.type} color={iconColor} />
            ) : null}
            <text
              x={p.svgX} y={p.svgY + NODE_R + 5}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill={inRoute ? labelActive : labelIdle}
              fontSize="6"
              fontFamily="monospace"
              letterSpacing="0.5"
              style={{ pointerEvents: 'none' }}
            >
              {shortName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
