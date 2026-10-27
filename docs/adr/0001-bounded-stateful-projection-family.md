---
status: proposed
date: 2026-10-27
---

# Add a bounded stateful family alongside the existing projection contracts

[SDK #32](https://github.com/eosrio/hyperion-sdk/issues/32) needs structured metadata, original
action/table inputs and related records at one view. Propose one separately negotiated compound
projection family, described in the [contract proposal](../projection-stateful-proposal.md).
Keep existing scalar/contextual validators, operations and installed consumers unchanged.
This ADR is not accepted, implemented, exported or qualified.

The plugin performs a bounded deterministic reduction with exact-key reads and block-local staging.
The runtime admits original inputs and owns ordering, failure isolation and canonical recovery.
The adapter atomically fences and commits logical effects, original receipt, undo and progress,
reusing the contextual recovery lifecycle. This applies accepted
[managed mutations](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0023-core-managed-projection-mutations.md),
[ordered staging](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0024-ordered-projections-with-declared-parallelism.md),
[explicit atomic groups](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0025-explicit-atomic-projection-groups.md)
and [recovery ownership](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0048-runtime-coordinates-forks-and-adapters-rollback-state.md).

Prefer a coherent optimistic prior view plus atomic commit fencing for the first tracer; a backend
may use a physical snapshot to supply the same contract. Driver transaction retries reuse a captured
candidate and never invoke plugin hooks. Conflicting source/plan identity fails rather than adopting
new state under an old receipt. A finite exact-key vocabulary is sufficient for required relationship
composition; native plugin queries and a general join language would add unneeded coupling.

Widening the scalar family would silently change existing validation and replacement semantics.
Mint-time formatted responses would need proven invalidation when only a relationship changes.
Putting contract priorities or ownership predicates in core would break the accepted plugin seam.
The separate family avoids those changes at the cost of explicit host/adapter capability work.
MongoDB and WormDB must implement the same behavior before either claims support for this family;
documentation or existing contextual qualification supplies no such support.
