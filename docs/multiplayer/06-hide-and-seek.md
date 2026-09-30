# Hide and seek: defence against being found

Being hard to find is a defence of its own, before any raid starts.

## Tools

- **Spend.** A poor base is quiet. This needs nothing new beyond [loudness](04-base-economy.md).
- **Jammers** widen the bearing anyone takes on the base.
- **Decoy beacons** are real objects placed away from the base, and they do triangulate. An attacker who flies to one finds nothing and pays for the trip.
- **Listener warning.** A bearing aimed at a base registers as a faint contact the other way.
- **Relocation** is the expensive escape once found: an Alcubierre move to another claimed world.

## Phase 1: Jammers and listener warnings

- A jammer building raises the angular error of every bearing taken on the base.
- A bearing whose cone holds a base writes a faint contact into that base's owner's scans.

## Phase 2: Decoy beacons

- Placed by the ship at a chosen supercluster, with a loudness the owner pays to keep up.
- Beacons are signal sources in the surveys, and a sweep that resolves one reports `No contact` once it reaches the galaxy.

## Phase 3: Relocation

- `POST /api/base/relocate`: moves the base to another habitable world, releasing the old claim, at a cost scaled by distance.
