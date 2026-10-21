# Portable projection rollback development contract

[SDK #14](https://github.com/eosrio/hyperion-sdk/issues/14) adds an explicit recovery interface for
[Tools #21](https://github.com/eosrio/hyperion-tools/issues/21) and the real MongoDB implementation in
[History API #244](https://github.com/eosrio/hyperion-history-api/issues/244). The package remains
private development work. SDK contract checks alone do not qualify database rollback, process-crash
recovery, live SHiP fork handling or a Hyperion release.

The shared runtime selects the canonical branch and ancestor, fences its local owner, coordinates
recovery and applies the replacement branch. Adapters restore stored effects. Plugins keep the same
backend-neutral `ProjectionApplyRequest` batches and logical queries. Native undo documents and
transaction execution stay inside adapters, following
[ADR 0048](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0048-runtime-coordinates-forks-and-adapters-rollback-state.md).

## Explicit opt-in and fenced operations

Import `ProjectionRollbackAdapter`, its types and validators from
`@eosrio/hyperion-sdk/projection` or the root export. This separate interface uses capability
`interfaceVersion: 2` and `PROJECTION_ROLLBACK_CAPABILITIES`, comprising the unchanged v1 capabilities
plus `fork-rollback`. `validateProjectionRollbackActivation(definition, binding, capabilities)`
requires every capability before activation. The existing `ProjectionAdapter`, capability constant
and v1 activation/apply/view validators retain their exact contracts. A v1 adapter is not implicitly
eligible for rollback. This is an additive SDK export, not a replacement SDK major.

| Method | Input and result |
|---|---|
| `initialize` | Existing definition, immutable binding and zero genesis; returns a fenced read view |
| `open` | Binding; returns a fenced read view only when ready |
| `recovery` | Binding; returns non-serving durable progress, coverage and recovery intent |
| `apply` | `{revision, batch}`; existing portable batch, result with fenced completed view |
| `markIncomplete` | `{binding, revision, block, reason}`; durable source/failure admission |
| `rollback` | `{binding, revision, operationId, from, ancestor, maxBlocks}`; bounded recovery progress |
| `query` | Fenced read view and unchanged logical query; result with the actual fenced view |

A fenced read view contains `{binding, checkpoint, revision}`. `revision` is an opaque lowercase
64-character hexadecimal identity persisted by the adapter. It is separate from immutable
`binding.generation`. Ordinary applies do not rotate it, so redelivery and restart retain a stable
writer context. The adapter checks it for every mutable operation, including source-gap and failure
admission, and for reads. It rotates the revision durably when admitting recovery, before undo begins.
An earlier view stays stale even after rollback returns to its exact former block ID and height.

Activating this interface on existing storage is explicit and durable. Unfenced v1 access to that
instance must then fail; a compatibility wrapper cannot inject a newly read revision into old work.
The runtime captures a revision before enqueueing a frame and invalidates its old owner during
recovery. A queued frame cannot adopt the new revision by inspecting the adapter later.

## Exact, resumable rollback

`from` and `ancestor` are exact `{blockNum, blockId}` checkpoints, without `previousBlockId`.
A new operation must match the current completed `from`; a stale starting point fails without
changing storage. The adapter checks the requested ancestor against its retained branch ancestry.
Heights alone never establish identity. An ancestor equal to `from` with the same ID may cancel
orphan pending/gap work and rotate the revision without undoing a committed block.

Before restoring effects, the adapter persists the operation ID, original `sourceRevision`, starting
checkpoint and ancestor together with the new revision. `rollback` undoes at most `maxBlocks` source
blocks per call, each preserving effects, checkpoint and recovery progress atomically. It returns
`{status: "in-progress" | "rolled-back" | "duplicate", recovery}`. In-progress state remains
unavailable to `initialize`/`open`/`query` and to ordinary writes.

Exact retries use the original operation ID, revision, `from` and ancestor. `maxBlocks` is only a
per-call scheduling budget and may change without changing operation identity. After interruption,
`recovery` exposes the original intent so a newly started runtime can resume it. The adapter retains
the last completed operation receipt: retrying a lost completion response returns `duplicate`,
including after replacement blocks have advanced, and never undoes that replacement branch again.
A subsequent new recovery may supersede the old receipt; older requests then fail their revision
check. Reusing an operation ID for conflicting intent must fail.

## Coverage and unavailable inputs

`recovery` contains the existing binding, checkpoint, initialization, pending and gap fields, plus
the revision, `coverage` and nullable `rollback` state. Recovery state has `operationId`,
`sourceRevision`, `from`, `ancestor`, status `running`, `complete` or `unavailable`, and a nullable
failure reason. The completed checkpoint is the cursor during undo; inspection never grants serving
readiness, even when its operation is complete or an `apply` succeeds.

Coverage reports the oldest reachable exact `floor`, `retainedBlocks`, `retainedBytes`, and configured
`maxBlocks`/`maxBytes`. The window is contiguous and ends at the completed checkpoint, including empty
source blocks. Adapters document their encoded byte accounting, including descriptors. Retention
must be bounded by both blocks and bytes; a small delete batch can need large before-images. An
adapter must refuse effects it cannot retain safely under its supported per-block budget.

Existing v1 receipts do not contain inverse effects. Migration therefore starts with an empty undo
window at the actual current checkpoint, not an invented genesis floor. Wrong branch identity or an
ancestor outside actual coverage durably leaves the affected instance incomplete before throwing
retryable `projection.rollback-unavailable`. The runtime must use separately qualified historical
sources/reinitialization when required; it cannot skip missing effects, claim readiness or stop
unrelated projections. A stale fence reports retryable `projection.stale-revision`.

`validateProjectionRollbackApplyInput` captures the complete fenced batch before any awaited
definition lookup. The adapter then uses `validateProjectionRollbackApply(definition, captured)` to
enforce declared fields and types. This follows the existing query-input capture pattern.
`validateProjectionRollbackView`, `Incomplete`, `Request` and `Recovery` likewise capture inert,
detached, recursively frozen bounded inputs. Per-call undo is limited to 256 blocks, configured
retention to 4,096 blocks and 1 GiB, operation IDs to 128 UTF-8 bytes, and reasons to 4,096 UTF-8
bytes. Adapters may select smaller limits. The existing mutation and query bounds still apply.
These development maxima are contract bounds, not performance claims or retention recommendations.
