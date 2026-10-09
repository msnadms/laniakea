import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { placeDefence as planPlaceDefence, type Base, type Outcome } from '../game/base';
import { BASE_PLATFORM_LIMIT, DEFENCE_ORBIT_SLOTS } from '../game/constants';
import {
  DEFENCE_KINDS,
  DEFENCES,
  ORBIT_NAMES,
  platformAt,
  type DefenceKind,
  type Platform,
  type SlotRef,
} from '../game/defences';
import { ApiError } from '../net/api';
import { moveDefence, placeDefence, removeDefence } from '../net/base';
import { useBaseStore, type BaseTab } from '../store/baseStore';
import { SurfaceMap } from './BaseSurfaceMap';
import './BasePanel.css';

const TABS: { id: BaseTab; label: string }[] = [
  { id: 'surface', label: 'Surface' },
  { id: 'defences', label: 'Defences' },
];

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const DEFENCE_GLYPHS: Record<DefenceKind, string> = { pointDefence: '✦', missile: '◆', railgun: '▲', shield: '⬡' };

function refusalOf(outcome: Outcome): string | null {
  return outcome.ok ? null : outcome.refusal.message;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    call()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'The order could not be given'))
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}

const ORBIT_RADII = [30, 40, 48];

function slotPosition({ orbit, slot }: SlotRef): { x: number; y: number } {
  const angle = (slot / DEFENCE_ORBIT_SLOTS[orbit]) * Math.PI * 2 - Math.PI / 2 + orbit * 0.3;
  return { x: 50 + ORBIT_RADII[orbit] * Math.cos(angle), y: 50 + ORBIT_RADII[orbit] * Math.sin(angle) };
}

function sameSlot(a: SlotRef | null, b: SlotRef): boolean {
  return a !== null && a.orbit === b.orbit && a.slot === b.slot;
}

function PlatformDetail({ platform, moving, onMove }: { platform: Platform; moving: boolean; onMove: () => void }) {
  const { busy, error, run } = useAction();
  const spec = DEFENCES[platform.kind];
  return (
    <div className="base-defence-detail">
      <div className="base-card-name">{spec.name}</div>
      <div className="base-note">{ORBIT_NAMES[platform.orbit]}, slot {platform.slot + 1}</div>
      <p className="base-card-blurb">{spec.blurb}</p>
      <dl className="base-ship-stats">
        <dt>Hull</dt><dd>{spec.hull}</dd>
        {spec.damage > 0 && <><dt>Damage</dt><dd>{spec.damage}</dd></>}
        {spec.range > 0 && <><dt>Range</dt><dd>{spec.range}</dd></>}
        {spec.shield > 0 && <><dt>Shield</dt><dd>{spec.shield}</dd></>}
      </dl>
      <button type="button" className={`base-action base-action--quiet${moving ? ' base-action--active' : ''}`} onClick={onMove}>
        {moving ? 'Choose an empty slot…' : 'Move platform'}
      </button>
      <button type="button" className="base-action base-action--quiet" disabled={busy} onClick={() => run(() => removeDefence(platform))}>
        {busy ? 'Removing…' : 'Remove platform'}
      </button>
      {error && <div className="base-error" role="alert">{error}</div>}
    </div>
  );
}

function SlotDetail({ base, slot }: { base: Base; slot: SlotRef }) {
  const { busy, error, run } = useAction();
  return (
    <div className="base-defence-detail">
      <div className="base-card-name">{ORBIT_NAMES[slot.orbit]}, slot {slot.slot + 1}</div>
      <div className="base-note">{base.defences.length} / {BASE_PLATFORM_LIMIT} platforms</div>
      {DEFENCE_KINDS.map((kind) => {
        const refusal = refusalOf(planPlaceDefence(base, slot, kind));
        return (
          <div key={kind} className="base-defence-option">
            <div className="base-card-head">
              <span className="base-card-name">{DEFENCE_GLYPHS[kind]} {DEFENCES[kind].name}</span>
            </div>
            <button type="button" className="base-action" disabled={refusal !== null || busy} onClick={() => run(() => placeDefence(slot, kind))}>
              {busy ? 'Ordering…' : refusal ?? 'Place'}
            </button>
          </div>
        );
      })}
      {error && <div className="base-error" role="alert">{error}</div>}
    </div>
  );
}

function Defences({ base }: { base: Base }) {
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [moving, setMoving] = useState(false);
  const [arriving, setArriving] = useState<SlotRef | null>(null);
  const { error, run } = useAction();
  const selectedPlatform = selected ? platformAt(base.defences, selected) : undefined;
  const awaitingMove = selected !== null && !selectedPlatform && sameSlot(arriving, selected);

  const pick = (slot: SlotRef) => {
    const occupant = platformAt(base.defences, slot);
    setArriving(null);
    if (moving && selected && selectedPlatform && !occupant) {
      const from = selected;
      setMoving(false);
      setSelected(slot);
      setArriving(slot);
      run(() => moveDefence(from, slot).catch((err) => {
        setArriving(null);
        setSelected(from);
        throw err;
      }));
      return;
    }
    setMoving(false);
    setSelected(sameSlot(selected, slot) ? null : slot);
  };

  return (
    <div className="base-defences">
      <svg className="base-orbits" viewBox="0 0 100 100" role="group" aria-label="Orbital defence layout">
        <circle className="base-orbit-world" cx="50" cy="50" r="13" />
        <text className="base-orbit-world-label" x="50" y="51.5">{base.planetName}</text>
        {ORBIT_RADII.map((r, orbit) => <circle key={orbit} className="base-orbit-ring" cx="50" cy="50" r={r} />)}
        {DEFENCE_ORBIT_SLOTS.flatMap((count, orbit) => Array.from({ length: count }, (_, slot) => {
          const ref = { orbit, slot };
          const { x, y } = slotPosition(ref);
          const platform = platformAt(base.defences, ref);
          const classes = [
            'base-slot',
            platform ? `base-slot--${platform.kind}` : 'base-slot--empty',
            sameSlot(selected, ref) ? 'base-slot--selected' : '',
            moving && !platform ? 'base-slot--target' : '',
          ].filter(Boolean).join(' ');
          return (
            <g key={`${orbit}-${slot}`} className={classes} onClick={() => pick(ref)} role="button" aria-label={`${ORBIT_NAMES[orbit]} slot ${slot + 1}`}>
              <circle cx={x} cy={y} r="3.2" />
              {platform && <text x={x} y={y + 1.1}>{DEFENCE_GLYPHS[platform.kind]}</text>}
            </g>
          );
        }))}
      </svg>
      <div className="base-defence-side">
        {selected === null && (
          <div className="base-defence-detail">
            <div className="base-card-name">Orbital layout</div>
            <p className="base-card-blurb">
              Platforms hold three orbits around {base.planetName}. Select an empty slot to place one, or a platform to move or remove it.
            </p>
            <div className="base-note">{base.defences.length} / {BASE_PLATFORM_LIMIT} platforms</div>
          </div>
        )}
        {selected && selectedPlatform && (
          <PlatformDetail
            key={`${selected.orbit}-${selected.slot}`}
            platform={selectedPlatform}
            moving={moving} onMove={() => setMoving(!moving)}
          />
        )}
        {awaitingMove && (
          <div className="base-defence-detail">
            <div className="base-card-name">{ORBIT_NAMES[selected.orbit]}, slot {selected.slot + 1}</div>
            <div className="base-card-status">Moving platform…</div>
          </div>
        )}
        {selected && !selectedPlatform && !awaitingMove && <SlotDetail key={`${selected.orbit}-${selected.slot}`} base={base} slot={selected} />}
        {error && <div className="base-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

export function BaseButton() {
  const hasBase = useBaseStore((s) => s.base !== null);
  if (!hasBase) return null;
  return (
    <button type="button" className="hud-anomaly hud-base-btn" onClick={() => useBaseStore.getState().setOpen(true)}>
      ⌂ Base
    </button>
  );
}

export function BasePanel() {
  const open = useBaseStore((s) => s.open);
  const tab = useBaseStore((s) => s.tab);
  const setOpen = useBaseStore((s) => s.setOpen);
  const setTab = useBaseStore((s) => s.setTab);
  const base = useBaseStore((s) => s.base);
  const screenRef = useRef<HTMLDivElement>(null);
  const shown = open && base !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!shown) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    screenRef.current?.focus();
    return () => previous?.focus();
  }, [shown]);

  if (!open || !base) return null;

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={screenRef}
      className="base-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Base"
      tabIndex={-1}
      onKeyDown={trapFocus}
    >
      <header className="base-header">
        <div className="base-heading">
          <div className="base-title">{base.planetName}</div>
          <div className="base-subtitle">{base.systemName}, {base.galaxyName}, {base.superclusterName}</div>
        </div>
        <nav className="base-tabs">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" className={`base-tab${tab === id ? ' base-tab--active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button type="button" className="base-close" onClick={() => setOpen(false)} aria-label="Close base">✕</button>
      </header>
      <div className="base-body">
        {tab === 'surface' && <SurfaceMap base={base} />}
        {tab === 'defences' && <Defences base={base} />}
      </div>
    </div>
  );
}
