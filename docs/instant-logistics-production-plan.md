# Instant Production and Logistics Skill Plan

## Goal

Move production difficulty out of real-time waiting and into network design. A good route should turn a useful batch of accumulated raw resources into finished goods in one dispatch, while poor routing should expose visible shortages, congestion, waste, or risk.

The intended player skill is:

- finding and choosing useful resource and fabrication sites;
- deciding where each recipe runs;
- ordering fabrication stages correctly;
- configuring branches, merges, filters, priorities, and reserve rules;
- balancing material throughput against route cost and detection;
- adapting the network to the resources actually available nearby.

The intended challenge is not:

- waiting several real hours for a recipe;
- repeatedly pressing Dispatch to advance one production step;
- building a new fabricator merely because every recipe consumes a scarce slot;
- searching multiple galaxies because a required rare resource failed two independent rarity rolls.

## Current balance findings

### Fabricator access

Ordinary systems generate a possible habitable-zone planet in four of the five planet-count layouts. Only 12% of those candidates remain habitable; the rest become marginal. The resulting probability is approximately 9.6% per ordinary system, or one buildable world per 10.4 systems.

The fixed starting neighborhood is friendlier than the general distribution: Proxima Centauri, Epsilon Eridani, and Procyon A contain habitable worlds. This protects onboarding, but later expansion still inherits the sparse general distribution.

The recipe catalog contains:

- 13 canonical craftable materials;
- 2 alternate material recipes;
- 7 extractor modules;
- 5 rare assemblies.

A fabricator starts with one slot and caps at three. Its second slot costs 2,000 alloys; its third costs 3,000 alloys and 1,500 exotic matter. This makes additional one-slot fabricators competitive with upgrading an existing site and turns habitable-world discovery into recipe capacity.

With one dedicated slot per canonical recipe, the full catalog needs 25 active slots, or nine fully expanded fabricators. A single rare-assembly chain uses roughly five to nine distinct recipes, so even one focused chain commonly asks for two or three habitable sites.

### Rare extraction

Brown-dwarf extraction is sufficiently available:

- every galaxy receives exactly three brown dwarfs;
- each has two to four ice-zone planets;
- each planet has a 40% exotic-matter roll;
- approximately 98.7% of galaxies contain at least one productive exotic-matter source.

Neutron-star matter stacks too many rarity gates:

- eligible non-disk stars have a 0.5% neutron-star roll;
- a typical galaxy has approximately two neutron stars;
- each neutron star has two to four planets;
- each planet has only a 10% neutron-star-matter roll;
- only about 26.9% of neutron-star systems are productive;
- approximately 58% of galaxies have no neutron-star-matter source at all.

Neutron-star matter can remain an endgame discovery, but the rare star itself should be the primary gate. A discovered neutron-star system should not usually be barren.

### Logistics

The current DAG model has the correct foundation. Topological traversal, in-route material chaining, per-edge material capacity, merges, and local byproduct consumption can all support meaningful network design.

The current limitations are:

- cargo at a branch is divided evenly rather than by downstream demand or player policy;
- edges cannot filter materials or raw resources;
- there are no priority or split-ratio controls;
- displayed throughput is theoretical node output rather than measured edge flow;
- disconnected DAG components can share one route and one flat dispatch fee;
- stockpile fallback can rescue inefficient networks in ways that obscure routing mistakes;
- dispatch is manual, so higher production can become more clicking;
- detection is based on the global count of undampened extractors in a supercluster, not on route design.

The accelerated extractor rate is a testing setting and is not a production-balance input for this plan.

## Target production model

### Dispatch is the production event

Fabricators no longer advance from elapsed wall-clock time. When a route reaches a fabricator node, that node immediately processes the cargo and local buffers available to it.

Each visit follows this order:

1. Merge all incoming edge cargo with the node's partial-input buffers.
2. Evaluate enabled recipe slots in configured priority order.
3. Execute recipes repeatedly while their inputs are available and their outputs can leave or be stored.
4. Repeat the slot pass until no recipe can make further progress.
5. Put products and unconsumed cargo onto outgoing edges according to their policies.
6. Send sink output and explicit overflow to the ship stockpile.

This fixed-point pass lets a fabricator containing both deuterium and tritium-getter recipes consume its own new byproduct during the same visit. It must terminate when a complete pass consumes no inputs and produces no output.

### Preserve useful state, remove waiting state

Keep:

- partial raw-resource input buffers;
- partial intermediate-material input buffers;
- local byproduct buffers;
- recipe assignment and recipe priority;
- buffer depth as a tier benefit;
- jammed and starved status reporting.

Remove:

- `startedAt`;
- elapsed-time replay;
- recipe countdowns and completion timestamps;
- output queues whose only purpose is waiting for pickup;
- `producing` as a persistent time-based status;
- `output-full` as a timer/backpressure state.

Suggested node/slot statuses after the change:

- `idle`: no recipe assigned;
- `ready`: inputs are currently sufficient;
- `starved`: one or more required inputs are missing;
- `jammed`: a byproduct cannot be consumed, routed, or stored;
- `flowing`: the most recent dispatch produced output.

### Process the available batch, not one click-sized craft

A dispatch must not execute only one craft per slot. Each fabricator should process the largest batch permitted by available input, local buffer capacity, outgoing edge capacity, and explicit route limits. This prevents dispatch spam from becoming the optimal production strategy.

Outputs produced at one node are immediately available to later nodes in the same topological traversal. A correctly ordered extractor to tier-1 fabricator to tier-2 fabricator to sink route can therefore complete the whole chain in one dispatch.

## Fabricator capacity rebalance

### Slot targets

Recommended initial values:

| Fabricator tier | Included slots | Maximum slots | Buffer depth |
| --- | ---: | ---: | ---: |
| Basic | 5 | 6 | 3 batches |
| Advanced | 8 | 8 | 5 batches |

The exact values should be playtested, but the target outcome is more important than the first numbers:

- a focused early material chain fits on one basic fabricator;
- a focused rare chain fits on one or two sites;
- the full canonical material graph fits on approximately three basic fabricators;
- advanced fabricators feel like dense production hubs, not basic fabricators with only a rare-recipe permission flag.

Slot unlocks should be free or inexpensive configuration progression. They should not compete with the cost of establishing another fabricator. If an unlock cost remains, the total cost to maximize one site should be clearly lower than constructing the equivalent number of default slots elsewhere.

### Build costs

Retain the first fabricator as a meaningful progression milestone, including its storage-cap prerequisite if desired. Re-evaluate its raw cost only after larger included slot counts are playable; changing cost and capacity simultaneously would make it difficult to identify which adjustment fixed the experience.

Advanced-fabricator material costs can remain because they create a useful bootstrap objective. Revisit the raw portion after instant rare production is working.

## Route-control model

### Connected routes

A saved route must be a single weakly connected DAG. Direction does not matter for the connectedness check; every node must belong to the same underlying network.

This closes the ability to bundle unrelated components under one base dispatch fee and makes route slots describe actual networks.

The editor should explain invalid disconnected islands and highlight them rather than failing silently.

### Edge policies

Each edge should support:

- allowed cargo types: selected raw resources and materials;
- priority relative to sibling outgoing edges;
- either a weight or an explicit unit cap;
- overflow behavior: next eligible edge, hold locally, or ship stockpile;
- optional minimum reserve at the source node.

Default behavior should remain usable without configuration:

- allow all cargo;
- distribute according to reachable recipe demand;
- use equal priority;
- send true surplus to the ship.

Demand-aware defaults prevent the current failure mode where an equal split sends inputs down a branch that cannot use them. Explicit policies then let skilled players override that behavior.

### Material bandwidth

Keep bandwidth as the main non-fungible logistics constraint, but define it consistently:

- every edge has a material-unit capacity per route run;
- carried materials consume edge capacity;
- stockpile injection occurs through an explicit ship/source node or consumes the destination edge's capacity;
- stockpile overflow must not teleport into a downstream fabricator during the same dispatch;
- raw-resource capacity may remain separate, but its behavior must be visible.

Avoid maintaining both a global dispatch budget and unrelated full capacity on every edge unless the UI clearly presents both constraints. Prefer per-edge capacity for route skill and a route-wide drone capacity only if it creates a separate, understandable decision.

### Accurate feedback

Replace theoretical throughput labels with results from the most recent route run:

- units moved on each edge, grouped by cargo type;
- capacity used and remaining;
- material rejected or redirected by a filter;
- inputs missing at each fabricator;
- recipe batches executed at each fabricator;
- byproducts created, consumed locally, routed, or jammed;
- cargo deposited into the ship stockpile.

Keep a compact default label such as `7/10`, with detailed composition available on hover or node selection.

## Route automation

Saved routes should be activatable rather than requiring every run to be manually dispatched.

Recommended activation policies:

- run when any source station reaches a chosen fill percentage;
- run when all required inputs for at least one downstream recipe are available;
- run when a sink has room for output;
- maintain a minimum ship reserve of exotic matter and helium-3;
- pause when a configured detection ceiling would be exceeded;
- pause on a persistent jam and notify the player once.

Automation should use the same pure dispatch simulation as manual dispatch. Do not create a second set of transfer rules.

The UI should provide a dry-run preview before activation:

- expected route cost;
- recipes that would execute;
- expected edge utilization;
- unresolved shortages;
- detection effect;
- reason the route is currently waiting.

Manual dispatch remains useful for testing and emergency operation, but repeated manual clicks should never increase the amount processed from an unchanged state.

## Detection redesign

Replace the global `more than four undampened extractors` trigger with route-scoped risk. Detection should create a routing tradeoff rather than a mandatory module tax.

Candidate model:

- base risk from the number of undampened extractor nodes active on this route;
- additional risk from long inter-system or inter-galaxy edges;
- optional high-risk regions or node traits;
- reductions from dampeners, shorter routes, lower dispatch frequency, or a quiet-route policy;
- previewed probability or detection points before activation.

Signal Dampeners then enable compact aggressive routes, while careful players can operate a larger but slower or more fragmented network without crafting one dampener for nearly every extractor.

Tune detection only after automatic routes exist, because dispatch frequency changes the total risk dramatically.

## World-generation adjustments

### Neutron-star matter

Recommended rule:

- every neutron-star system contains at least one neutron-star-matter source;
- additional planets keep their existing random chance;
- preserve the full-logistics requirement for placing the extractor;
- vary rate and position to preserve discovery value.

If cross-galaxy sourcing is intended as mandatory endgame play, guarantee at least one productive neutron-star system in each small group of nearby galaxies rather than relying on independent rolls. The player should choose among difficult sources, not wonder whether a required source exists.

### Habitable worlds

Do not raise the global habitable chance until the expanded slot counts have been tested. More slots may solve the actual fabrication pressure while retaining valuable geography.

After that test, use these targets:

- focused rare production should normally require no more than one or two additional habitable discoveries beyond the first fabricator;
- a player should encounter meaningful choices between two fabrication locations, rather than always using the only one found;
- the starting neighborhood must retain at least two accessible fabrication sites.

If more sites are still needed, raise the habitable-candidate survival chance from 12% to approximately 18%. That produces about one habitable system per seven ordinary systems without making them commonplace.

## Implementation phases

### Phase 1: Instant production core

Change the production state and pure simulation first.

Work:

- remove `startedAt` and `outputCount` from `FabricatorProductionSlot`;
- remove elapsed-time ticking from `fabricatorStore`;
- add a pure fixed-point fabricator processing function;
- process all feasible batches per visit;
- expose consumed inputs, produced outputs, byproducts, jams, and shortages in its result;
- deliver new output to outgoing cargo immediately;
- update Firestore serialization to the new state shape;
- remove countdown and output-queue UI;
- update recipe tooltips so craft time is no longer displayed;
- retain `craftHours` temporarily only if needed for a short compatibility step, then delete it from JSON and TypeScript types.

Acceptance criteria:

- a multi-tier correctly ordered route produces its final output in one dispatch;
- dispatching again without new input changes nothing and charges nothing;
- co-located byproduct production and consumption resolves in one visit;
- a byproduct with no valid destination visibly jams the producing slot;
- changing a recipe refunds partial buffered inputs without duplicating output;
- save/load preserves all remaining production state.

### Phase 2: Fabricator capacity

Work:

- apply the new included and maximum slot counts;
- remove or sharply reduce slot unlock prices;
- make advanced fabricators visibly denser production hubs;
- update sidebar layout for the larger recipe list;
- add per-slot processing priority controls;
- ensure old one-to-three-slot saved state expands safely on load if compatibility is still required.

Acceptance criteria:

- an early material chain fits on one basic fabricator;
- each rare assembly can be automated with at most two well-configured fabricators;
- building another fabricator is primarily a geographic or throughput choice.

### Phase 3: Correct DAG semantics

Work:

- add weak-connectedness validation;
- reject disconnected saves and identify island nodes in the editor;
- replace equal cargo splitting with downstream-demand-aware distribution;
- prevent stockpile overflow from reappearing downstream during the same run;
- make route execution deterministic independent of edge creation order;
- define stable tie-breaking for equal-priority slots and edges.

Acceptance criteria:

- identical saved graphs produce identical results regardless of edit history;
- cargo does not enter a branch with no reachable consumer unless explicitly allowed;
- unrelated subgraphs cannot share a route fee;
- no material can exceed an edge's capacity through stockpile fallback.

### Phase 4: Player-controlled routing

Work:

- add edge cargo filters;
- add priority and split controls;
- add overflow policies and source reserve settings;
- show last-run edge flow and utilization;
- show shortages and blocked output directly on the map;
- provide a dry-run route simulator used by both the editor and dispatch readiness checks.

Acceptance criteria:

- the player can prioritize a scarce intermediate toward one consumer;
- changing only edge policy can change final output without moving or rebuilding facilities;
- the UI explains why the result changed;
- a better-configured route demonstrably produces more useful output from the same starting inventory.

### Phase 5: Automatic operation

Work:

- add active/paused state to routes;
- add activation conditions and reserve thresholds;
- run automation through the same dispatch function;
- persist route policy and active state;
- notify once for jams, unaffordable routes, and detection pauses;
- prevent unchanged state from triggering repeated paid runs.

Acceptance criteria:

- a configured production chain runs without repeated clicking;
- a route does not spend fuel when it cannot collect, craft, or deliver anything;
- a jammed route pauses or waits according to policy rather than draining resources;
- manual and automatic runs produce identical results from identical state.

### Phase 6: Rarity and detection balance

Work:

- guarantee one neutron-star-matter source per neutron-star system;
- collect telemetry or deterministic simulations for source availability;
- replace global extractor-count detection with route-scoped risk;
- evaluate habitable frequency after larger fabricators are in use;
- adjust habitable survival chance only if geographic capacity remains restrictive.

Acceptance criteria:

- neutron-star discovery reliably unlocks a usable endgame source;
- detection can be mitigated through both equipment and route design;
- expanding the network does not automatically require dampening every extractor;
- a focused rare chain normally needs no more than two fabricator sites.

## Data and type changes

Expected removals:

- `CraftMaterial.craftHours`;
- `ExtractorUpgrade.craftHours`;
- `RareResource.craftHours`;
- `Craftable.craftHours`;
- `FabricatorProductionSlot.startedAt`;
- `FabricatorProductionSlot.outputCount`;
- time-derived ticking helpers and countdown UI.

Expected additions:

- stable slot priority/order;
- last-run slot result for UI feedback, or a non-persisted dispatch result carrying it;
- edge cargo filters;
- edge priority and weight/cap;
- edge overflow policy;
- route automation policy and active/paused state;
- connectedness validation;
- dry-run simulation result types.

Prefer keeping last-run diagnostics ephemeral unless persistence materially improves the return experience. Persist configuration and production buffers; derive previews and statuses.

## Verification strategy

The project now has focused Vitest coverage around pure production and logistics logic. Continue expanding it alongside automatic-route behavior and save migrations.

Minimum test matrix:

- single raw recipe with exact, insufficient, and excess input;
- multi-output recipe;
- alternate recipe producing the canonical material id;
- byproduct creation, local consumption, routing, and jam;
- two slots competing for one input under different priorities;
- chain, branch, merge, diamond, and disconnected graphs;
- edge filters and weighted splits;
- per-edge bandwidth enforcement;
- stockpile overflow isolation;
- deterministic results under shuffled edge storage order;
- dry-run and committed-run equality;
- no-op dispatch does not spend fuel;
- save/load round trip for buffers and route policies;
- generation sampling for habitable worlds, brown-dwarf exotic matter, and neutron-star matter.

Continue to run `npm run build` and `npm run lint` after every phase. Add a small deterministic balance-report script that samples fixed seeds and prints source frequencies, fabricator-site spacing, and raw input totals for each top-level recipe.

## Tuning metrics

Evaluate the redesign against outcomes rather than individual costs:

- median systems visited before the first fabricator;
- median systems visited before the second useful fabricator site;
- number of fabricator sites needed for each rare assembly;
- useful output per route run;
- percentage of edge capacity used;
- number of manual dispatches per meaningful network change;
- frequency and cause of jams;
- proportion of material moved directly through the DAG versus ship-stockpile fallback;
- frequency of player-authored filters, priorities, and split settings;
- detection generated per useful output;
- galaxies searched before the first neutron-star-matter extractor.

The redesign succeeds when experienced players get materially better results from the same sites and resources by improving their graph, while a new player can still build a simple chain that works with defaults.

## Recommended delivery order

Implement Phases 1 and 2 together as the first playable milestone. Instant crafting without additional recipe capacity still leaves fabricators feeling scarce, while additional slots without instant processing preserves the waiting problem.

Then complete Phase 3 before exposing advanced edge controls. Filters and priorities should sit on deterministic, correctly constrained transfer rules.

Add automation after route results are predictable and explainable. Finish with detection and generation tuning, using the new production model's observed site requirements rather than the old timer-based economy.
