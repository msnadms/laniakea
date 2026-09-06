# Logistics Economy and Simulation Plan

## Purpose

The logistics network's structure is sound: routes are DAGs with derived membership, `processFabricator`
is a pure fixed point, and manual dispatch and automation share one code path. The problems are in the
*economy* those structures produce and in a small number of places where the simulation charges, reports,
or recomputes something incorrectly.

This plan does not revisit the DAG model, the instant-dispatch production model, or the cargo/filter
semantics settled in `instant-logistics-production-plan.md` and `logistics-clarity-and-skill-plan.md`.
It covers six changes: two to the economy, one to correctness, one refactor, one to performance, and a
group of smaller fixes.

Work items are ordered by value. Items 1 and 4 are the two that matter most — the first fixes the
economy's central knob, the second stops the simulation's two halves from drifting while it is retuned.

---

## 1. Fractional detection accumulation

### Problem

`routeDetectionRisk` produces a fine-grained number but `dispatchRoute` spends it as
`Math.floor(preview.detectionRisk / 5)` (`logisticsStore.ts:960`), and the same floor gates the
automation ceiling (`:581`). With `localHopRisk = m(m-1)/2` (`:198`) the result is a cliff, not a curve:

| hops in one supercluster | risk | bars charged |
|---|---|---|
| 3 | 3 | 0 |
| 4 | 6 | 1 |
| 5 | 10 | 2 |

A three-hop route is free in perpetuity. A four-hop route costs a full bar on every dispatch.

The two clocks make it worse. Automation polls every 15s (`useLogisticsAutomation.ts:8`) while detection
decays one bar per 15 minutes (`uiStore.ts:11`). A route at risk >= 5 generates ~4 bars/min against a
0.067 bars/min drain, so it pins against its `detectionCeiling` and throttles to roughly one dispatch per
quarter hour; a route at risk < 5 runs sixty times more often at zero cost. There is no middle band.

The dominant strategy is therefore to shard one large network into many three-hop routes — the exact
opposite of the meter's stated intent, which is to push the player outward.

### Change

Introduce a continuous heat pool in `uiStore`:

- Add `detectionHeat: number` alongside `detectionRating`. `dispatchRoute` adds the full
  `preview.detectionRisk` to heat rather than converting to bars at the call site.
- Bars become `Math.floor(detectionHeat / DETECTION_HEAT_PER_BAR)`; the remainder persists.
- Decay operates on heat, not on bars, and continuously: `decayDetection` becomes a heat drain of
  `DETECTION_HEAT_DECAY_PER_MS * elapsed`, replacing the current stepped 15-minute subtraction. Keep
  `lastDetectionChangeAt` as the accrual anchor.
- `checkDetectionLethal`, `purgeDetection`, and railgun fire continue to operate on bars, but must zero or
  reduce the underlying heat rather than the derived rating, or the bar reappears on the next tick.
- Persist `detectionHeat` through `setShipStats` and the Firebase ship-stat path.

Every hop then costs something proportional, and the 3-to-4 hop cliff becomes a slope.

### Retuning

Once heat is continuous, re-derive the constants so that:

- A modest three-hop route is *cheap but not free* — visible heat, decaying faster than it accrues at a
  sensible automation cadence.
- A dense ten-hop single-supercluster network is unsustainable without a Signal Dampener.
- A long jump to a fresh supercluster remains near-free, preserving the outward-pressure design.

Expect `DETECTION_DENSITY_DIVISOR`, `DETECTION_CROSSING_POINTS`, and the decay rate all to move. Set the
decay rate relative to `AUTOMATION_POLL_MS`, not to wall-clock intuition — see item 2.

### Acceptance

- A four-hop route no longer costs strictly more per dispatch than two three-hop routes covering the same
  stations.
- Heat is visible to the player as sub-bar progress on `DetectionBars`, so accumulation is legible before a
  bar lands.
- Tests cover: heat accrual across several dispatches summing to the expected bar count; decay across a
  known elapsed time; purge and railgun both clearing heat, not just bars.

---

## 2. Dispatch cadence and the flat fuel fee

### Problem

Two independent issues that compound.

`computeRouteCost` starts from a flat 50 exotic / 25 helium (`logisticsStore.ts:244`) plus per-edge
`hopCost`, entirely independent of how much cargo the run actually moves. A dispatch that hauls two units
of alloy costs exactly as much as one that saturates every edge.

`runAutomation` then computes source fill with `Math.max` over the route's extractors (`:988`), so the
route fires as soon as *any single* extractor crosses `sourceFillPercent`. A route with one fast well and
four slow ones dispatches constantly, pays the full flat fee each time, and collects almost nothing from
four of five nodes.

The trigger encourages exactly the behaviour the fee punishes, and the player's only recourse is to
hand-tune a percentage that does not express what they mean.

### Change

**Fill aggregation becomes a policy.** Extend `RouteAutomationPolicy` with
`fillAggregate: 'any' | 'all' | 'weighted'`, defaulting to `weighted`:

- `any` — current `Math.max` behaviour. Legitimate for feeding a starved fabricator; keep it available.
- `all` — `Math.min`, for routes that should only run when the whole network is worth visiting.
- `weighted` — fill weighted by each source's share of downstream demand, so a source nothing asks for
  cannot trigger a dispatch on its own.

Migrate existing saved policies to `any` in `migrateAutomationPolicy` so no live route changes behaviour on
load; `weighted` applies to newly created routes.

**Fuel gains a throughput component.** Split the flat base into a smaller fixed dispatch fee plus a term
scaled by units actually moved. Because the fee must be known before the run, take the volume estimate from
the preview simulation (which item 4 makes authoritative) rather than from the committed run. A near-empty
run becomes cheap rather than wasteful, which removes most of the pressure to micro-tune fill percentages
at all.

### Acceptance

- A route with one fast and four slow sources does not dispatch on the fast source alone under the default
  policy.
- Cost shown on the route card moves when expected throughput moves.
- `restoreRoutes` tests confirm old routes load as `any` and behave identically to today.

---

## 3. Correctness: preview under-collects, and fuel is charged before the work

### 3a. Preview extractor collection ignores ship hold room

`simulateRoutePreview` collects `Math.min(spare, reachableCollection(...))` (`logisticsStore.ts:399-400`) —
purely fabricator demand. The committed run collects
`Math.min(available, room + demand + (canHold ? available : 0))` (`:812`), which also accounts for free
space in the ship's hold and for a `hold` surplus edge.

So for any route whose extractors feed the ship rather than a downstream recipe, the preview simulation
collects **zero** while the real dispatch collects a full load. Today this is masked for the readiness
verdict by the separate `anyCargo` check in `routePreview`, but it is not masked for what the player reads:
`expectedBatches`, `expectedEdgeUse` and `expectedRecipes` are all computed from the under-collecting
simulation. In `batch` dispatch mode it becomes a live bug — `expectedBatches === 0` sets
`reason = 'Waiting for a complete recipe batch'` (`:582`) and holds a route that would in fact have run.

Fix by giving the preview the same collection ceiling as the run. Item 4 makes this structural rather than a
second copy of the same expression.

### 3b. Charge-then-refund burns fuel on the boundary

`dispatchRoute` calls `consumeResources` before doing any work and refunds via `addCargo` on `!didWork`
(`:955`). `consumeResources` does not clamp; `addCargo` clamps to `computeStorageCap` (`uiStore.ts:308`).
Any path where the hold gains exotic or helium mid-run — a sink node depositing carried fuel — and still
ends with `didWork === false` silently destroys the fee. The run has also already mutated `stockpileStore`
and extractor timestamps before it decides it did nothing.

Since `routePreview` already performs a faithful dry run, decide both affordability and usefulness from the
preview and charge once, after `didWork` is known. The refund path then disappears entirely, along with the
clamp asymmetry.

### Acceptance

- A hold-bound route reports non-zero `expectedEdgeUse` in its dry run.
- A `batch`-mode route that would collect for the hold is not held by the batch gate.
- No code path calls `addCargo` to return a fee. A test asserts ship fuel is unchanged after a dispatch that
  returns `false`, including when the hold is at cap.

---

## 4. Unify preview and dispatch into one traversal

### Problem

`simulateRoutePreview` (`logisticsStore.ts:290-500`) and `dispatchRoute` (`:790-950`) are two ~200-line
implementations of one algorithm: demand collection, reachability claiming, stockpile injection,
`allocateUnits` fan-out, byproduct routing, downstream carry. They are kept in step by hand.

They are already unequal. Item 3a is a divergence with player-visible consequences. Others are latent: the
preview never models `deposit()`, spill, or hold-cap rejection at sinks; it does not populate
`flow.rejected`; it clones `heldCargo` where the run consumes it. Every future change to routing policy has
to be made twice, correctly, in two different shapes.

### Change

Extract a single traversal parameterised over its effects:

```ts
interface RouteWorld {
  peekExtractor(key: ExtractorKey): number;
  collectExtractor(key: ExtractorKey, max: number): number;
  feedFabricator(key: string, raw: RawCost, materials: MaterialCost, budget: MaterialBudget,
                 canRouteByproduct: (id: string) => boolean, stockpile: MaterialCost): FeedResult;
  depositRaw(type: Resource['type'], amount: number): number;
  depositMaterial(id: string, amount: number): void;
  readStockpile(): MaterialCost;
  holdRoom(type: Resource['type']): number;
}

function runRouteTraversal(
  route: LogisticsRoute, groups: Map<string, NodeGroup>, edges: RouteEdge[],
  world: RouteWorld, bandwidth: number,
): TraversalResult
```

- `LiveWorld` delegates to the real stores — this is what `dispatchRoute` passes.
- `ShadowWorld` wraps a copy-on-write snapshot (cloned fabricator slots, a mutable ledger of hold and
  stockpile balances) and discards it — this is what `routePreview` passes.

`TraversalResult` carries everything both callers need today: `order`, `collected`, `edgeFlows`,
`slotResults`, `carried`, `deposited`, `heldCargo`, `didWork`, plus the derived `expectedBatches` /
`expectedRecipes` / `shortages` the preview reports. `DispatchResult` and `RoutePreview` both become thin
projections of it.

The preview and the run are then identical by construction, which is a stated success criterion in
`logistics-clarity-and-skill-plan.md` that the current code does not actually meet.

### Notes for the implementation

- Keep the traversal pure with respect to ordering: the existing lexical tie-breaking (`edgeKey` sorts,
  sorted node ids, sorted extractor keys) is load-bearing for determinism and must be preserved exactly.
- Do the extraction *before* items 1 and 2 land if they are worked in parallel, so the retuning happens
  against one implementation rather than two.
- `productionLogistics.test.ts` gains a property-style test: for a set of fixture routes, the preview's
  projected numbers equal the committed run's actual numbers.

### Acceptance

- One traversal function; `simulateRoutePreview` deleted.
- A test asserts preview-equals-dispatch across fixture routes covering: branch splitting, material
  bandwidth saturation, byproduct jam, hold surplus, stockpile injection, and cross-supercluster hops.

---

## 5. Performance: preview cost per render

### Problem

`LogisticsModal.tsx:522` calls `previewRoute(route.id)` inline inside `routes.map`, alongside
`computeRouteCost`, `resolveNodeGroups`, `routeIsValid` and `fabricatorNodeStatus` — none memoised. The
component re-renders every second because of `useNow()` (`:210`), which also invalidates the `projected`
memo.

Each preview deep-clones every fabricator state and replays the whole topological pass. Inside it,
`cargoReaches` (`:107`) runs a fresh DFS per (node, target, cargo-id) triple, called inside a `reduce` over
all targets, inside a loop over all raw types: roughly O(N² · T · (V+E)) per preview, per route, per second.
Fine at five nodes; it will stutter at twenty with a full logistics tier and a wide material tree.

### Change

**Precompute reachability once per traversal.** For each cargo id in play, run one reverse BFS from each
demand node to produce a per-cargo `Map<nodeId, number>` of reachable demand. Every `cargoReaches` call and
every `reachable*` reduce becomes a lookup. Build it once at the top of `runRouteTraversal` (item 4), where
it serves both callers.

**Memoise previews on a real key.** Recompute a route's preview when its edges, the fabricator states, the
extractor set, or the ship's relevant balances change — not on the wall-clock tick. A store revision counter
bumped by the mutating actions is the simplest sufficient key. The 1s tick genuinely affects only
`peekAccumulated`, so let accumulation-sensitive readouts refresh on the tick while the simulation does not.

Also memoise `computeRouteCost`, `resolveNodeGroups` and `routeIsValid` per route rather than calling them
inside the render map.

### Acceptance

- A twenty-node, three-route network holds a steady frame rate with the modal open.
- No full simulation runs on a wall-clock tick where no store state changed.

---

## 6. Smaller items

**Inter-supercluster hops are flat-priced.** `hopCost` falls through to `flatTravelCost(100)`
(`logisticsStore.ts:85`) for any cross-supercluster edge, so a neighbouring supercluster and a distant one
cost the same. Since the design intent is outward pressure, give this a real distance term — the
supercluster field has world coordinates available.

**No route throughput readout.** The UI reports expected edge units, shortages and risk, but never the
number a player actually optimises: yield per unit fuel, or per unit time. All the inputs exist once item 4
lands. Add a derived rate line to the route card — "N graphene lattice / hr at M exotic / hr". This is the
highest-value UI change in the set.

**`heldCargo` is invisible.** Cargo stranded at a node persists across dispatches and silently changes what
the next run does. `StationMap` should badge nodes holding cargo, and `NodeSidebar` should list it with a
control to flush it to the ship. A player debugging a stalled route currently has no way to see it.

**`fabricatorNodeStatus` over-reports failure.** It collapses to a single worst-status ranking in which
`jammed` outranks `flowing`, so one jammed slot on an eight-slot advanced fabricator renders a productive
node as dead on the map. Show the modal status, or split the indicator into a productive component and a
fault component.

**`routeIslandNodes` is O(V·E).** It rescans every edge per dequeue (`:157`). Irrelevant at current sizes,
but it is called from render; give it an adjacency map while item 5 is in hand.

---

## Suggested order

1. Item 4 — unify the traversal. Everything else is cheaper afterwards, and item 3a falls out of it.
2. Item 3b — move the fuel charge after `didWork`.
3. Item 5 — reachability precompute and preview memoisation, inside the unified traversal.
4. Item 1 — fractional detection, then retune.
5. Item 2 — fill aggregation policy and throughput-scaled fuel, retuned against item 1.
6. Item 6 — the smaller fixes, with the throughput readout first.

Items 1 and 2 change the economy and should land together in a single tuning pass, after the simulation is
trustworthy enough to measure against.
