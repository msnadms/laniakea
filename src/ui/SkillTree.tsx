import { useEffect, useState } from 'react';
import {
  formatSpeedMpc,
  maxFlightSpeed,
  researchCost,
  scanDecoyFactor,
  scanPrecisionFactor,
  tankCapacity,
  TECH_MAX_LEVEL,
  TECH_PATHS,
  TECH_ROOT_NAME,
  TECH_TREE,
  type TechLevels,
  type TechPath,
} from '../game/tech';
import { ApiError } from '../net/api';
import { research } from '../net/tech';
import { useTechStore } from '../store/techStore';
import './SkillTree.css';

type Selection = { path: TechPath; index: number } | null;
type NodeState = 'owned' | 'next' | 'locked';

const ROOT = { x: 50, y: 92 };
const COLUMN_X: Record<TechPath, number> = { capacity: 18, speed: 50, scanning: 82 };
const TIER_TOP = 14;
const TIER_BOTTOM = 76;
const NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

function tierY(index: number): number {
  return TIER_BOTTOM - (TIER_BOTTOM - TIER_TOP) * index / (TECH_MAX_LEVEL - 1);
}

function nodeState(levels: TechLevels, path: TechPath, index: number): NodeState {
  if (index < levels[path]) return 'owned';
  return index === levels[path] ? 'next' : 'locked';
}

function onChain(selection: Selection, path: TechPath, index: number): boolean {
  return selection !== null && selection.path === path && index <= selection.index;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function topSpeed(level: number): string {
  return formatSpeedMpc(maxFlightSpeed(level));
}

function effectLines(path: TechPath, index: number): string[] {
  const from = index;
  const to = index + 1;
  switch (path) {
    case 'capacity':
      return [`Tank ${tankCapacity(from)} to ${tankCapacity(to)} negative-energy condensate`];
    case 'speed':
      return [`Top cruise ${topSpeed(from)} to ${topSpeed(to)} megaparsecs / s`];
    case 'scanning':
      return [
        `Contact spread ${percent(scanPrecisionFactor(from))} to ${percent(scanPrecisionFactor(to))}`,
        `False readings ${percent(scanDecoyFactor(from))} to ${percent(scanDecoyFactor(to))}`,
      ];
  }
}

function Edge({ from, to, state, lit }: { from: { x: number; y: number }; to: { x: number; y: number }; state: NodeState; lit: boolean }) {
  return (
    <line
      className={`skill-edge skill-edge--${state}${lit ? ' skill-edge--highlight' : ''}`}
      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function Detail({ selection, levels, technology }: { selection: Selection; levels: TechLevels; technology: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!selection) {
    return (
      <div className="skill-detail">
        <div className="skill-detail-kicker">Root</div>
        <div className="skill-detail-name">{TECH_ROOT_NAME}</div>
        <p className="skill-detail-blurb">
          Every upgrade builds on the ship's core systems. Cataloguing a civilisation's works for the first time recovers
          advanced technology, and older civilisations yield more.
        </p>
        <div className="skill-detail-hint">Select an upgrade to inspect it.</div>
      </div>
    );
  }

  const { path, index } = selection;
  const node = TECH_TREE[path].nodes[index];
  const state = nodeState(levels, path, index);
  const cost = researchCost(index) ?? 0;
  const affordable = technology >= cost;

  const buy = () => {
    setBusy(true);
    setError(null);
    research(path)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'The research could not be completed'))
      .finally(() => setBusy(false));
  };

  return (
    <div className={`skill-detail skill-detail--${state}`}>
      <div className="skill-detail-kicker">{TECH_TREE[path].title} {NUMERALS[index]}</div>
      <div className="skill-detail-name">{node.name}</div>
      <p className="skill-detail-blurb">{node.blurb}</p>
      <ul className="skill-detail-effects">
        {effectLines(path, index).map((line) => <li key={line}>{line}</li>)}
      </ul>
      {state === 'owned' ? (
        <div className="skill-detail-status">Researched</div>
      ) : (
        <>
          <div className="skill-detail-cost">
            Cost <span className={affordable ? '' : 'skill-detail-cost--short'}>{cost} advanced technology</span>
          </div>
          <button
            type="button"
            className="skill-research"
            disabled={state !== 'next' || !affordable || busy}
            onClick={buy}
          >
            {state === 'locked' ? 'Requires the previous upgrade' : busy ? 'Researching…' : 'Research'}
          </button>
        </>
      )}
      {error && <div className="skill-detail-error" role="alert">{error}</div>}
    </div>
  );
}

export function SkillTree() {
  const open = useTechStore((s) => s.open);
  const setOpen = useTechStore((s) => s.setOpen);
  const levels = useTechStore((s) => s.levels);
  const technology = useTechStore((s) => s.technology);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const select = (next: Selection) => {
    const same = next && selection && next.path === selection.path && next.index === selection.index;
    setSelection(same ? null : next);
  };

  return (
    <div className="skill-overlay" role="dialog" aria-modal="true" aria-label="Ship upgrades" onClick={() => setOpen(false)}>
      <div className="skill-panel" onClick={(event) => event.stopPropagation()}>
        <header className="skill-header">
          <div className="skill-title">Ship Upgrades</div>
          <div className="skill-balance">
            <span className="skill-balance-value">{technology}</span>
            <span className="skill-balance-label">Advanced technology</span>
          </div>
          <button type="button" className="skill-close" onClick={() => setOpen(false)} aria-label="Close ship upgrades">✕</button>
        </header>

        <div className="skill-body">
          <div className="skill-tree">
            <svg className="skill-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {TECH_PATHS.map((path) => {
                const x = COLUMN_X[path];
                return (
                  <g key={path} className={`skill-branch--${path}`}>
                    <Edge from={ROOT} to={{ x, y: tierY(0) }} state={nodeState(levels, path, 0)} lit={onChain(selection, path, 0)} />
                    {TECH_TREE[path].nodes.slice(1).map((_, i) => (
                      <Edge
                        key={i}
                        from={{ x, y: tierY(i) }}
                        to={{ x, y: tierY(i + 1) }}
                        state={nodeState(levels, path, i + 1)}
                        lit={onChain(selection, path, i + 1)}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>

            {TECH_PATHS.map((path) => (
              <div key={path} className={`skill-column-title skill-branch--${path}`} style={{ left: `${COLUMN_X[path]}%`, top: `${TIER_TOP - 9}%` }}>
                {TECH_TREE[path].title}
              </div>
            ))}

            <button
              type="button"
              className={`skill-node skill-node--root skill-node--owned${selection ? ' skill-node--highlight' : ''}${selection === null ? ' skill-node--selected' : ''}`}
              style={{ left: `${ROOT.x}%`, top: `${ROOT.y}%` }}
              onClick={() => setSelection(null)}
            >
              <span className="skill-node-glyph">◈</span>
              <span className="skill-node-label">{TECH_ROOT_NAME}</span>
            </button>

            {TECH_PATHS.flatMap((path) => TECH_TREE[path].nodes.map((node, index) => {
              const state = nodeState(levels, path, index);
              const selected = selection?.path === path && selection.index === index;
              const lit = onChain(selection, path, index);
              const affordable = state === 'next' && technology >= (researchCost(index) ?? Infinity);
              const classes = [
                'skill-node',
                `skill-branch--${path}`,
                `skill-node--${state}`,
                affordable ? 'skill-node--affordable' : '',
                lit ? 'skill-node--highlight' : '',
                selected ? 'skill-node--selected' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={`${path}-${index}`}
                  type="button"
                  className={classes}
                  style={{ left: `${COLUMN_X[path]}%`, top: `${tierY(index)}%` }}
                  onClick={() => select({ path, index })}
                  aria-pressed={selected}
                  aria-label={node.name}
                >
                  <span className="skill-node-glyph">{NUMERALS[index]}</span>
                  <span className="skill-node-label">{node.name}</span>
                </button>
              );
            }))}
          </div>

          <Detail
            key={selection ? `${selection.path}-${selection.index}` : 'root'}
            selection={selection} levels={levels} technology={technology} />
        </div>
      </div>
    </div>
  );
}
