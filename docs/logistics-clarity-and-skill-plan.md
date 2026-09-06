# Logistics Clarity and Skill-Expression Plan

## Purpose

The logistics simulation already supports meaningful network design, but its rules are harder to understand than the decisions they create. The next iteration should preserve the deterministic DAG, instant multi-stage production, recipe placement, slot order, material bandwidth, automation, and route-scoped detection while making cause and effect visible before the player commits to a change.

This plan follows the production redesign in `instant-logistics-production-plan.md`. It is not another economy rewrite. It is a consolidation of the cargo model, route feedback, editing experience, and onboarding.

## Target outcome

A new player should be able to create a useful extractor-to-fabricator route without opening any advanced controls. An experienced player should be able to improve the same network through recipe placement, fabrication order, branching, bandwidth allocation, cargo filters, reserves, and detection management—and should be able to explain why the improved route performs better.

The intended experience is:

1. Build a simple route that works with defaults.
2. See exactly what the next dispatch will do.
3. Dispatch and compare the actual result with the preview.
4. Encounter a specific, named bottleneck.
5. Change one relevant control and see the predicted result change.
6. Introduce automation only after the manual route is understood.
7. Reveal advanced routing controls when the network actually needs them.

## Success criteria

- A first-time player can complete a basic route without external instructions.
- Every blocked route presents one primary reason and at least one useful corrective action.
- Draft changes update predicted collection, production, edge use, surplus, cost, and detection before save or dispatch.
- Manual readiness and automation readiness are displayed separately.
- Preview and committed dispatch use the same simulation result and cannot drift apart.
- Cargo filters only filter cargo; they do not silently change allocation behavior.
- Holding and surplus behavior are configured at the level where they actually apply.
- Ship-stockpile transfers are visible and use the same production rules as routed transfers.
- Direct fabrication cannot bypass route fuel, detection, bandwidth, or byproduct constraints.
- Advanced configuration produces measurably better output in at least one supplied branch scenario.

## Player-facing mental model

The UI should teach these rules in this order:

1. Arrows define cargo direction and the order in which stations run.
2. Extractors contribute only the resources that a reachable recipe requests, unless the player explicitly forces surplus onto an edge.
3. A fabricator runs its configured slots from top to bottom whenever a dispatch reaches it.
4. Raw resources travel freely on an allowed edge; crafted materials consume that edge's displayed capacity.
5. Unused cargo follows the source node's surplus rule: return to ship or remain at that node.
6. A route dispatch costs fuel and may add a displayed number of detection points.

Terms such as DAG, fixed-point pass, topological order, and stockpile injection should remain implementation details. The interface should use route, flow, run order, capacity, ship supply, surplus, and held cargo.

## Product decisions

### One production execution path

Route dispatch must be the canonical operation that moves resources and processes fabricators. Remove `Load from Hold` as a separate, free execution path.

If fabricators must be able to consume ship inventory, represent that as a visible **Ship Supply** operation within the route simulation:

- ship supply is configured per fabricator node;
- the preview lists exactly which materials and raw resources will be supplied;
- supplied materials consume a clearly identified material budget;
- supply happens in a stable, documented place in the node's processing order;
- byproducts follow the same local-consumption, routing, holding, and jamming rules as every other dispatch;
- fuel and detection are charged once for the route, not bypassed through a separate button.

Treat Ship Supply as an explicit route boundary or gateway rather than an ordinary DAG node. This avoids creating a cycle between a ship source and a ship sink while still making transfers visible.

### Node-level surplus policy

Unused cargo exists at a node after all outgoing edges have attempted allocation. Configure its destination on that node:

- `return-to-ship` — default and beginner-friendly;
- `hold-at-node` — advanced behavior.

Remove the per-edge `overflow` label. It currently suggests independent edge behavior even though leftover cargo is resolved collectively after all sibling edges run.

### Separate filtering from allocation

An edge filter answers only: “May this cargo use this edge?”

Add a separate allocation control for sibling edges:

- `demand` — default; send only what reachable consumers request;
- `force` — advanced; allow selected cargo to continue even without downstream demand.

Do not infer forced allocation merely because an allow-list exists.

### One detection unit

The player should see detection points, not raw internal route risk. The preview should display:

- current detection;
- detection added by this dispatch;
- resulting detection;
- automation ceiling;
- which edges or undampened stations contribute to the increase.

Raw risk calculations can remain internal or appear only in a developer/debug view.

### Progressive disclosure

The default editor exposes:

- route name;
- graph editing;
- recipe selection and fabrication order;
- predicted result;
- route cost;
- manual dispatch;
- automation activation.

An **Advanced Routing** section exposes:

- cargo filters;
- demand versus force allocation;
- per-edge material draw;
- node surplus/hold behavior;
- extractor reserve;
- detection ceiling;
- pause-on-jam behavior.

The default route should remain useful without changing an advanced setting.

## Phase 1: Consolidate the simulation model

### Work

- Extract one pure route simulator that accepts a route, a snapshot of relevant stores, and a dispatch mode.
- Have preview call the simulator without committing its mutations.
- Have dispatch commit the exact mutation set returned by the simulator.
- Include collection, ship supply, slot runs, edge allocation, held cargo, deposits, fuel, and detection in the same result.
- Remove the parallel preview implementation once parity is proven.
- Remove or route the current direct `Load from Hold` action through this simulator.
- Add node-level surplus policies.
- Add an explicit allocation mode independent of cargo allow-lists.
- Convert raw detection risk into `detectionPointsAdded` in the simulation result.
- Add a route configuration revision or stable hash to each ephemeral last-run result.
- Clear or mark last-run slot diagnostics stale when a recipe, slot order, route edge, or policy changes.

### Suggested result shape

```ts
interface RouteSimulationResult {
  runnable: boolean;
  primaryBlocker?: RouteBlocker;
  warnings: RouteWarning[];
  cost: { exotic: number; helium: number };
  detection: { before: number; added: number; after: number; ceiling: number };
  nodes: Record<string, NodeRunResult>;
  edges: Record<string, EdgeRunResult>;
  shipSupply: CargoTransfer;
  shipDeposit: CargoTransfer;
  heldCargo: Record<string, Cargo>;
  mutations: RouteMutation[];
  configurationHash: string;
}
```

Blockers and warnings should use stable codes plus display parameters rather than preformatted strings. This lets the UI render a short status, detailed explanation, and suggested fix from the same underlying reason.

### Acceptance criteria

- Preview and dispatch return identical node and edge outcomes from identical state.
- A no-op dispatch commits nothing and spends no fuel.
- Ship-supplied materials appear as an explicit transfer in preview and result data.
- There is no action that processes a fabricator while bypassing route byproduct behavior.
- Toggling an edge allow-list does not change demand behavior for still-allowed cargo.
- A node with mixed outgoing policies cannot produce ambiguous leftover behavior.
- Recipe or route edits cannot display an unlabelled result from an older configuration.

## Phase 2: Add a persistent draft preview and run report

### Work

- Simulate the in-memory draft, not only the last saved route.
- Place a persistent summary beside or below the map; do not hide essential diagnostics in a route-card hover popover.
- Organize the preview into four layers:
  - **Outcome:** final materials, modules, rares, and raw cargo deposited;
  - **Work:** resources collected and batches run at each fabricator;
  - **Bottleneck:** the primary blocker plus specific shortages, jams, and saturated edges;
  - **Cost:** fuel and detection points.
- On dispatch, keep the same layout and change its heading from “Next dispatch” to “Last dispatch.”
- Allow selection of a preview row to highlight its node or edge on the map.
- Show predicted and last-run edge utilization directly on selected edges.
- Show raw cargo flow separately from material capacity so an edge carrying raw resources does not appear unused at `0/N` material capacity.
- Replace counts such as “3 shortages” with the highest-impact shortage and an expandable complete list.
- Preserve diagnostics without requiring hover; hover may add detail but cannot be the only access path.

### Example summary

```text
NEXT DISPATCH — READY

Produces
  2 High-Entropy Alloy Billets → ship

Bottleneck
  Vega Forge needs 1 more Boron Nitride Ceramic
  Sol → Vega is full: 4/4 material capacity

Cost
  62 EM · 31 He-3 · +1 detection
```

### Acceptance criteria

- Adding, removing, or reversing an edge updates the preview immediately.
- Changing a recipe, slot order, filter, material draw, or surplus policy updates the preview immediately.
- A player can identify the first failed production stage without opening a tooltip.
- Every previewed edge amount can be matched to a visible edge on the map.
- The last-run report distinguishes predicted values from actual values and marks obsolete results as stale.

## Phase 3: Clarify readiness, automation, and terminology

### Work

- Display two statuses when relevant:
  - **Manual:** ready, no useful work, invalid, or insufficient actual fuel;
  - **Automation:** active/paused/holding plus its specific policy reason.
- Do not label a route “Ready” merely because manual dispatch may override an automation reserve or ceiling.
- Replace “No Cargo” with specific reasons such as:
  - no reachable recipe requests available extractor cargo;
  - all matching fabricator buffers are full;
  - ship cargo hold has no room;
  - waiting for any source to reach 50%;
  - waiting for a complete recipe batch;
  - holding at fuel floor;
  - holding at detection ceiling;
  - paused after jam.
- Rename the fill policy to “Run when any source reaches …” to match its maximum-source calculation.
- Show that automation checks periodically; exact seconds may remain in a tooltip or secondary text.
- Convert route-card warnings into persistent text or accessible disclosures rather than pointer-only popovers.
- Keep manual policy override, if desired, but label the button with the consequence: for example, “Dispatch anyway · crosses reserve.”

### Acceptance criteria

- A route may be manually ready and automation-blocked without displaying contradictory status.
- Every automation hold state states the policy that caused it.
- Detection preview and ceiling use the same displayed unit.
- Manual overrides require an explicit, consequence-labelled action.

## Phase 4: Simplify graph editing without reducing graph depth

### Work

- Add a small permanent legend for extractor nodes, fabricators, advanced fabricators, selected nodes, jams, shortages, and flowing status.
- Make direction more prominent with larger arrowheads or animated flow indicators on selection.
- During edge creation, label the drag endpoints as `FROM` and `TO`.
- Explain rejected links inline: duplicate, reverse edge already exists, or would create a cycle.
- Replace the footer's linear topological “Flow” chain with one of:
  - a compact stage summary grouped by parallel execution depth; or
  - a selected-path inspector that never implies the entire graph is linear.
- Add explicit `Cancel`/`Revert` and a visible unsaved-changes state.
- Warn before switching routes or closing the modal with unsaved edits.
- Make nodes and edges selectable by click, keyboard, and touch; reserve hover for optional detail.
- Offer a beginner action that connects a selected extractor to a selected fabricator with the correct direction.
- Keep cycle and connected-island validation, but attach the message to the affected map elements.

### Acceptance criteria

- A player can determine edge direction without relying on a tiny arrowhead.
- A branch or merge is never summarized as one misleading linear path.
- Invalid edge creation explains why it failed.
- Unsaved work cannot be silently replaced by selecting another route.
- Essential map information is available without hover.

## Phase 5: Introduce guided logistics onboarding

### Work

- Expand the tutorial with a Logistics section covering only the six player-facing rules.
- Replace the single unlock-only logistics quest with a short sequence:
  1. **First Link:** connect an extractor to a fabricator;
  2. **Production Target:** configure a simple tier-1 recipe;
  3. **First Dispatch:** preview and run the route;
  4. **Read the Network:** open the result and identify its output or shortage;
  5. **Automatic Supply:** activate a working route;
  6. **Advanced Routing:** resolve a later branch bottleneck using material draw, filtering, or allocation.
- Use a byproduct-free recipe for the first production task.
- Introduce tritium residue and jamming only after one successful multi-stage route.
- Add contextual one-time callouts rather than a blocking full-screen tutorial.
- Store tutorial completion independently from route configuration so existing players are not forced through it.

### Acceptance criteria

- The first logistics quest cannot complete merely by purchasing an upgrade.
- The onboarding route works using default policies.
- The player encounters filters, holds, priorities, and detection only after demonstrating the basic loop.
- Existing saves can dismiss or replay the logistics tutorial.

## Phase 6: Advanced planning and balance validation

### Work

- Add “used by” information to material and recipe tooltips.
- Let selecting a desired output highlight its immediate inputs and assigned fabrication lines.
- Add a compact dependency view for multi-tier recipes without turning the main map into a full recipe graph.
- Provide a route optimization scenario in development fixtures:
  - one scarce tier-1 material;
  - two downstream consumers;
  - one saturated branch;
  - a measurable output improvement after changing allocation or material draw.
- Revisit fuel costs and detection only after players can correctly predict route results.
- Decide whether raw cargo should remain capacity-free based on playtests. If it does, consistently label capacity as **material capacity** everywhere.
- Evaluate whether Ship Supply needs a route-wide cap distinct from edge capacity. Do not add one unless players understand both constraints and it creates a separate decision.

### Acceptance criteria

- A player can answer where a required intermediate is produced and consumed.
- The supplied optimization scenario has at least two valid strategies with visible tradeoffs.
- The better-configured route produces more useful output from identical starting state.
- No balance adjustment is used to compensate for unclear feedback.

## Save-data migration

Version the route schema before changing edge and surplus semantics.

Migration work:

- Convert existing per-edge `overflow` values into node-level surplus policies.
- If sibling edges disagree, preserve held cargo and choose `hold-at-node`; show a one-time migration notice on that route.
- Preserve `allowedRaw`, `allowedMaterials`, and `materialDraw` while defaulting allocation to `demand`.
- Convert implicit stockpile access into explicit Ship Supply configuration using compatibility-safe rules.
- Preserve active state, automation policy, held cargo, and extractor reserves.
- Clear ephemeral last-run results after migration.
- Retain a one-version reader for the previous schema and write only the new version.

Migration must be covered with fixtures for a chain, branch, merge, held-cargo route, active automated route, and route containing a fabricator that previously pulled from stockpile.

## Testing strategy

### Pure simulation tests

- preview and commit equality for every supported route shape;
- simple extractor-to-fabricator-to-ship flow;
- multi-tier chain in one dispatch;
- branch allocation by downstream demand;
- explicit force allocation independent of allow-lists;
- filtered cargo remains blocked without changing other cargo's demand behavior;
- per-edge material capacity;
- raw flow reported independently from material capacity;
- node surplus returned to ship;
- node surplus held and restored on a later dispatch;
- explicit Ship Supply flow and capacity accounting;
- byproduct creation, local consumption, routing, holding, and jam;
- route detection converted to displayed points;
- no-op dispatch charges nothing;
- deterministic output under shuffled edge storage order;
- configuration hash changes for every result-affecting edit.

### Store and migration tests

- recipe change clears or invalidates old slot diagnostics;
- route edit invalidates old edge diagnostics;
- manual and automation readiness are derived independently;
- legacy overflow migration;
- implicit stockpile-supply migration;
- route save/load round trip for new node and allocation policies.

### UI and manual playtests

- complete onboarding with only visible instructions;
- build and dispatch a simple route using mouse, keyboard, and touch-sized controls;
- reverse an edge and understand the resulting failure;
- diagnose a missing raw resource;
- diagnose a missing intermediate material;
- diagnose a saturated material edge;
- diagnose and clear a byproduct jam;
- distinguish an automation fuel hold from manual readiness;
- modify a branch and confirm the preview explains the output difference.

Continue running `npm test`, `npm run build`, and `npm run lint` after every phase.

## Likely code areas

- `src/store/logisticsStore.ts` — pure simulation, route policy semantics, detection result, commit path, migration helpers.
- `src/store/fabricatorStore.ts` — removal of the separate hold-loading path, stable node processing, diagnostic invalidation.
- `src/game/types.ts` — versioned route, node surplus, allocation mode, structured preview/result types.
- `src/ui/LogisticsModal.tsx` — draft preview, run report, separate readiness states, progressive disclosure, onboarding hooks.
- `src/ui/LogisticsMap.tsx` — selection, direction feedback, legend, node/edge diagnostic overlays.
- `src/ui/LogisticsModal.css` and `src/ui/LogisticsPolicies.css` — preview hierarchy, responsive layout, accessible selected states.
- `src/hooks/useLogisticsAutomation.ts` — structured hold reasons and scheduling feedback.
- `src/game/quests.ts` and tutorial UI — staged logistics onboarding.
- `src/firebase/logisticsRoutes.ts` — schema versioning and migration.
- `src/store/productionLogistics.test.ts` — expanded parity, semantics, and migration coverage.

## Recommended delivery order

1. Consolidate preview and dispatch into one simulation path.
2. Resolve direct loading, Ship Supply, filtering, surplus, and detection semantics.
3. Add the persistent draft preview and last-run report.
4. Separate manual and automation readiness.
5. Improve graph editing and progressive disclosure.
6. Add onboarding.
7. Playtest and tune fuel, bandwidth, recipe placement, and detection.

Do not begin by removing recipes or reducing the DAG to a linear route. The current depth is valuable. The priority is to make every important outcome attributable to a visible rule and every advanced control optional until the player needs it.
