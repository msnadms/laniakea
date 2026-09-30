# Clans

Joining another player's base is the alternative to raiding it.

## Rules

- **Shared findings.** Members see each other's sweeps and bearings. Combined heat and combined bearings are the biggest advantage a group has, since a clan spread out across the sky has baselines no single ship can afford.
- **Reinforcements.** Members add to each other's defences.
- **Refuelling.** Members' ships dock and refuel at each other's bases, extending their range.
- **Members cannot raid each other.**

## Phase 1: Membership

- `world/clans/{clanId}` with its members, server-written. Invite and accept through the API; a player belongs to one clan.

## Phase 2: Shared findings

- Scans of every member combine in `readHeat` and in triangulation, drawn with a mark for whose they were.

## Phase 3: Reinforcements and refuelling

- Reinforcements join the defender's layout in the raid snapshot.
- Docking at a member's base counts as docked for refuelling.
