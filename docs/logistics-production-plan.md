# Logistics & Production Depth Plan

> Superseded by [Instant Production and Logistics Skill Plan](instant-logistics-production-plan.md).
> This file is retained as historical context; its timer-based recommendations are not the
> current implementation target.

Goal: make the crafting/logistics layer feel like Factorio — deep chains, rates and
ratios, bottlenecks you can see, and layout decisions that matter — without
abandoning the global stockpile or the exotic-matter / helium-3 economy.

Implement phases in order. Each phase is independently shippable.

---

## Current-state findings (verified in this codebase — do not re-derive)

These are the facts that motivate the plan.

1. **Materials teleport, and moving them is free.**
   `fabricatorStore.feedFabricator` pulls intermediates straight out of
   `useStockpileStore.getState().materials`. The stockpile is global and uncapped, so a
   material crafted anywhere is instantly available to every fabricator everywhere.

2. **Distance is priced per *visit*, not per unit moved.**
   `logisticsStore.computeRouteCost` charges a flat `50 EM / 25 He-3` base (drive-tier
   scaled) plus `hopCost` between consecutive stops. That is a toll for the drone showing
   up. It does not scale with volume and materials do not ride it at all.
   Sharpest illustration: `muon_cell` in `src/data/materials.json` has `"cost": {}` — the
   deepest tier-3 recipe needs zero raw resources, so it can be crafted for one flat base
   fee regardless of where its inputs were made.

3. **EM/He-3 are fungible, so distance cost collapses into an income problem.**
   Factorio's constraints (space, throughput, time) can't be bought past. A currency cost
   can. Every new constraint added below should be non-fungible.

4. **Route order barely matters.**
   In `logisticsStore.dispatchRoute` the station loop runs to completion building a shared
   `pool`, and *then* the fabricator loop runs. Interleaving extractor/fab/extractor/fab in
   `nodeKeys` has no effect on logic — only on `computeRouteCost` and the dispatch
   animation. Fabricators are fed in list order from one common pool, so the first fab
   silently wins contention for scarce resources. This priority is real and invisible.

5. **Production only advances on dispatch, and a slot holds at most one finished item.**
   `feedFabricator` *does* restart a slot within a single call (it nulls `inProduction`
   after pushing to `readyItems`, then the `if (!inProduction)` block refills). But nothing
   calls it between dispatches, and `pendingResources` is capped at exactly one recipe's
   worth. So a fab crafts one item, stalls holding it, and waits. There is no rate.

6. **The recipe graph is nearly linear.**
   In `src/data/materials.json`, only `graphene_lattice` has more than one consumer
   (`hea_billet`, `metamaterial_film`). Everything else is a chain. No contention, no
   ratios, no shared intermediates.

---

## Cross-cutting constraints

- **No code comments.** See `CLAUDE.md`. Applies to every phase.
- **Firestore mirroring.** Anything touching `fabricatorStates`, `routes`, extractor
  `lastCollectedAt`, `ownedUpgrades`/`nodeEquipped`/`pendingUpgrades`, or the stockpile must
  mirror to Firestore immediately after the local store update
  (`firebase/fabricators.ts`, `firebase/logisticsRoutes.ts`, `firebase/extractors.ts`,
  `firebase/extractorUpgrades.ts`, `firebase/stockpile.ts`).
- **No migrations needed.** The app has no users yet. `FabricatorState` and
  `LogisticsRoute` are persisted, but shape changes below can be breaking — change the type,
  change the Firestore read/write, done. Do not write defaulting read paths or legacy
  sentinels for the new fields.
  While in here: the existing legacy paths are also dead weight and can be deleted — the
  one-time `settlements` collection migration in `firebase/fabricators.ts`, the
  `first_colony` quest-id migration in `firebase/quests.ts`, and the `superclusSeed === 0`
  sentinel branches in `logisticsStore.hopCost` / `willRaiseDetection`.
- **Derive from elapsed time; don't add a tick loop.** The codebase already does this with
  `extractorStore.peekAccumulated` / `collectExtractor`. Offline progress falls out for
  free. Keep that pattern.

---

## Phase 1 — Material bandwidth (the non-fungible constraint)

**Why:** introduces a limit that money cannot solve. Raw resources are already bounded by
`computeStorageCap`; intermediates are bounded by nothing.

**Design**

- Add `computeMaterialBandwidth(logisticsA, logisticsB)` to `uiStore`, next to the existing
  `computeLogisticsCap` / `computeStorageCap` helpers. Returns material units movable per
  dispatch.
- `dispatchRoute` computes a budget once and threads a mutable counter through each
  `feedFabricator` call: `feedFabricator(key, pool, budget)`.
- In `feedFabricator`'s `recipe.materials` loop, clamp the take:
  `Math.min(remainingMaterials[matId] ?? 0, need, budget.remaining)`, then decrement
  `budget.remaining`. Leave the `recipe.cost` (raw resource) loop alone — already capped.
- Bandwidth is an upgrade axis on the existing `logisticsA`/`logisticsB` tiers.

**UI**

- Dispatch preview in `LogisticsModal` shows `materials moved / bandwidth`.
- `FabricatorSidebar` marks a slot **starved** when it wants materials the budget couldn't
  deliver, so the bottleneck is visible.

**Optional, cheap, high value:** explicit per-fabricator resource priority, to fix finding
#4. Keep `nodeKeys` as-is; just let the player order contention. Forward-compatible —
these allocations become edge weights in Phase 4.

**Files:** `store/uiStore.ts`, `store/logisticsStore.ts`, `store/fabricatorStore.ts`,
`ui/LogisticsModal.tsx`.

---

## Phase 2 — Input buffers and output queues (rates)

**Why:** Phase 1 throttles flow, but there is nothing to throttle until a fabricator can
consume continuously. This is what creates ratios.

**Design**

- `FabricatorProductionSlot` gains capacity beyond one recipe:
  - `pendingResources` / `pendingMaterials` may hold up to N recipes' worth
    (N scaled by fabricator tier — suggest 3 for tier 1, 5 for tier 2).
  - Replace `inProduction: FabricatorProductionItem | null` with an output queue plus a
    `startedAt`.
- Add a pure `tickFabricator(state, now)` that derives, from `startedAt` + buffered inputs +
  `craftHours`, how many crafts completed since the last touch — mirroring
  `peekAccumulated`. Call it from `dispatchRoute` **and** on modal open, so the player sees
  live progress. No `setInterval`.
- Output queue is drained by the next dispatch (`readyItems`).
- Cap the output queue. A full queue **halts production** — this is the backpressure signal
  and it is the point of the phase.

**UI**

- `FabricatorSidebar` slot rows show buffered inputs, queue depth, and a
  starved / producing / output-full state.

**Files:** `game/types.ts`, `store/fabricatorStore.ts`, `store/logisticsStore.ts`,
`firebase/fabricators.ts`, `ui/LogisticsModal.tsx`.

---

## Phase 3 — Widen the recipe graph (data only)

**Why:** ratios need contention. Currently there is almost none (finding #6). This phase is
pure JSON + type work, no engine changes, and can land any time after Phase 2.

**Design**

- **Shared intermediates.** Every tier-1 material should feed 3–4 downstream recipes.
  Rebalance `src/data/materials.json`, `upgrades.json`, `rareResources.json` so tier-1
  demand genuinely competes.
- **Multi-output.** Add an optional `outputs: number` to `CraftMaterial` (default 1) so
  ratios aren't all integers. `feedFabricator` multiplies queue deposits by it.
- **Byproducts that clog.** Add optional `byproducts: MaterialCost` to a recipe. Output goes
  into the fabricator's local queue; if the byproduct buffer fills, the slot **stalls**
  until something consumes it. Requires Phase 2's buffers. This is the single best
  puzzle-generator in Factorio (oil cracking) — e.g. deuterium distillation emits tritium
  residue, forcing the player to build a consumer they didn't want.
- **Alternate recipes.** Two routes to the same material with different raw inputs (one
  helium-heavy, one exotic-heavy), so players adapt to what their systems actually produce.

**Lore note:** material descriptions follow the established prose style — brief, flowing,
active voice, haunting understatement. No punchy fragments. Match the existing entries.

**Files:** `src/data/*.json`, `src/data/materials.ts`, `upgrades.ts`, `rareResources.ts`,
`game/types.ts`.

---

## Phase 4 — Routes become DAGs, with in-route chaining

**Why:** the expressiveness payoff. Do it *after* Phases 1–2, because with unlimited flow a
DAG is informationally identical to a set — branch structure only means something once
edges have capacity.

**Use a DAG, not a tree.** A rooted tree expresses splitting but not merging, and merging
(three alloy extractors → one graphene fab) is the more important shape.

**Design**

- `LogisticsRoute.nodeKeys: string[]` → `edges: { from: string; to: string }[]`.
  Straight replacement — drop `nodeKeys` rather than supporting both.
- `computeRouteCost` sums `hopCost` over edges rather than over path segments. This is
  simpler than the current hop-dedup logic, and it stops mispricing hub-and-spoke: three
  fabs in one system fed by one extractor should cost a star, not a zigzag traversal.
- `dispatchRoute` traverses in topological order. Reject cycles at edit time.
- **In-route chaining — the headline feature.** Carry fabricator *output* forward along
  edges instead of dumping everything to the ship:

  ```
  [alloy extractor] ──→ [Fab A: graphene] ──→ [Fab B: metamaterial film] ──→ ship
                                            ↗
  [exotic extractor] ────────────────────────
  ```

  One dispatch: collect alloys, feed A, pick up A's finished graphene, carry it to B with
  the exotic, feed B, bring the film home. Today that is three dispatches across three
  waits. Anything not consumed en route still falls back to the global stockpile, so the
  stockpile stays intact as a safety net — a well-ordered route just beats it.
- Per-edge bandwidth (from Phase 1) so branch structure determines how flow splits. This is
  where the player is actually designing splitters and priority.

**UI (the expensive part)**

- `StationMap` (`ui/LogisticsMap.tsx`): drag-from-node-to-node edge creation, edge
  hit-testing and deletion, cycle prevention. Existing edge rendering (dashed lines +
  `lm-arrow` markers) mostly carries over.
- `LogisticsModal` middle panel: replace the linear order-chain widget with a graph view.
- `logisticsProject.ts`: projection is unchanged; `resolveOverlaps` matters more with
  branching layouts.

**Files:** `game/types.ts`, `store/logisticsStore.ts`, `ui/LogisticsMap.tsx`,
`ui/LogisticsModal.tsx`, `ui/logisticsProject.ts`, `firebase/logisticsRoutes.ts`.

---

## Phase 5 — Make the network legible

**Why:** backpressure only teaches if the player can see it. This is what turns the map into
a factory floor.

**Design**

- Per-node status on `StationMap`: **starved** / **producing** / **output-full** /
  **jammed** (byproduct clog), as a ring color or badge on the node circle.
- Route-level warning when any node on the route is stalled.
- Throughput readout per edge — units/hour on the link — so ratio math is doable in-game
  rather than on paper.
- Extend the existing `hudNotify` toast for "Fab X jammed on tritium residue".

**Files:** `ui/LogisticsMap.tsx`, `ui/LogisticsModal.tsx`, `ui/ShipHUD.tsx`.

---

## Deferred / rejected

- **Local-only material inventories (no global stockpile).** The purest Factorio model, and
  the original proposal. Rejected as the *first* step: it's a large rewrite of the stockpile
  and its Firestore mirror, and Phases 1+2+4 recover most of the property (rates,
  backpressure, geography-dependent chains) while keeping the stockpile's UX. Revisit only
  if the network still feels frictionless after Phase 4.
- **Distance-scaled transit delay** — materials from far sources arrive later. Time is
  non-fungible, so this is a legitimate alternative to more EM cost. Cheap to add on top of
  Phase 4; hold until the throughput model is tuned, to avoid stacking two new frictions at
  once.
- **Drones as entities** (fleet, per-drone capacity, in-transit time, loadout modules
  mirroring the extractor 2-slot system). Real depth, but it is *fleet management* depth,
  not *production chain* depth. Out of scope for the Factorio goal; revisit separately.
- **Detection per-hop through hot regions** instead of the current binary
  `willRaiseDetection` (>4 undampened extractors in a supercluster). Makes shortest and
  safest routes diverge. Good, but orthogonal to production depth.

---

## Suggested first session

Phase 1 end to end — `computeMaterialBandwidth`, the budget thread through
`dispatchRoute` → `feedFabricator`, the dispatch-preview readout, and the starved marker in
`FabricatorSidebar`. It is self-contained and immediately makes the existing tree feel like
it has a bottleneck.
