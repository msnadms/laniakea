# Raids

A raid is played live by the attacker against the defender's layout while the defender is away. It takes resources, never population and never the world.

What a raid looks like on screen is still open. The default is the attacker's ships against orbital defences in the system view. Settle it before Phase 1.

## Rules

- **Verified by the server.** The attacker's inputs are sent up and the server replays them through the same deterministic simulation in `src/game/`, which decides what was taken. The client's result is never trusted.
- **Loot is capped** at a fraction of the defender's stored resources, with collectors raided more heavily than storage.
- **Shield after a loss.** The defender's base goes silent for some hours.
- **A raid leaves a trail.** Launching one burns negative-energy condensate loudly, and the defender receives a free contact on the attacker's area: a starting point for revenge, never a pin.
- **The ship must be there.** The attacker flies the ship to the defender's system, paying the crossing as any flight does.

## Phase 1: Simulation

- A deterministic raid simulation in `src/game/`, driven by a timestamped input list and the defender's layout, with no floating-point operation that could differ between engines (the same rule the universe generator follows).
- Tests that a recorded input list replays to the same result.

## Phase 2: Server

- `POST /api/raid/start`: charges the launch, snapshots the defender's layout and stores it with the raid, so the defender changing their base mid-raid changes nothing.
- `POST /api/raid/finish`: replays the inputs against the snapshot, applies the capped loot and the defender's shield in one transaction, and records the trail contact for the defender.

## Phase 3: Raid view

- The attacker's view in the system, against the snapshot.
- A raid log for the defender, with the trail contact linked to their scans.
