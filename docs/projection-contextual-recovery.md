# Revision-fenced contextual projection recovery

[SDK #30](https://github.com/eosrio/hyperion-sdk/issues/30) adds a separate opt-in recovery family
for [HAPI #359](https://github.com/eosrio/hyperion-history-api/issues/359). This private development
contract combines [contextual mapping](projection-contextual.md) with the existing
[rollback lifecycle](projection-rollback.md) and [retained inspection](projection-recovery.md).
Existing ordinary, basic contextual and rollback interfaces and closed validators remain unchanged.
The addition does not publish a package, activate production recovery or require a new SDK major.

## Explicit family selection

`validateContextualProjectionRecoveryActivation(definition, binding, hostCapabilities, adapterCapabilities)`
validates the complete contextual definition/binding and both manifests before imports or effects.
Both manifests have `family: 'contextual-table-recovery'`, `interfaceVersion: 1` and `supported`.
Use `CONTEXTUAL_PROJECTION_RECOVERY_HOST_CAPABILITIES` and
`CONTEXTUAL_PROJECTION_RECOVERY_ADAPTER_CAPABILITIES`. The host declares original context, mapping,
absence policy and runtime-coordinated recovery. The adapter declares the basic contextual operations
plus revision fencing, fork rollback and retained-checkpoint inspection. Missing capabilities refuse
activation; basic contextual or legacy rollback capabilities cannot silently substitute for this family.
Definition schema version, capability-family version and SDK package major are separate identities.

`ContextualProjectionRecoveryAdapter` supplies:

| Method | Contract |
|---|---|
| `initialize` | Full contextual definition, binding and explicit zero genesis; returns a fenced view. |
| `open` | Returns a current fenced view only when ready. |
| `recovery` | Returns the existing non-serving revision/coverage/pending/gap/rollback snapshot. |
| `apply` | `{revision, batch: ContextualProjectionApplyRequest}`; returns the existing fenced apply result. |
| `markIncomplete` | Existing `{binding, revision, block, reason}`; no source time or successful batch required. |
| `rollback` | Existing exact resumable operation request/result. |
| `retainedCheckpoints` | Existing revision-fenced request and bounded exact descending applied branch. |
| `query` | Existing fenced view and unchanged logical query/result. |

Adapters persist the whole definition and protect this storage family against unfenced or legacy
writes that bypass preservation policy. No implicit migration may invent original creation fields,
source time, inverse effects or recovery coverage. The existing metadata-only DTOs contain no mapping
syntax, so this family reuses them directly; contextual operations never pass through a schema1 batch.

## Captured requests and current-state guards

`validateContextualProjectionRecoveryApplyInput` captures the full inert `{revision, batch}` before
an awaited durable lookup. The batch retains original source context, candidate values, preserve/absence
policy, immutable binding, predecessor and ordered operations. Use
`canonicalContextualProjectionBatch(captured.batch)` for its logical replay identity, before resolving
any preserving operation against stored data. Revision fences remain separate from logical batch
identity. An exact retry cannot replace the original candidate with the already-preserved record.

The following pure guards take an explicit adapter-supplied current durable recovery snapshot:

- `validateContextualProjectionRecoveryApply(definition, request, current)` checks the complete
  declaration/batch and matching binding/revision, initialization and recovery phase. Pending/gap
  metadata permits exact source recovery; the adapter still checks receipts and source admission.
- `validateContextualProjectionRecoveryIncomplete(request, current)` fences failure admission without
  fabricating unavailable context. Missing original time must remain missing; it cannot become zero,
  wall time or a timestamp obtained from the decoded row.
- `validateContextualProjectionRecoveryQuery(definition, view, query, current)` returns detached
  `{view, query}` only for the exact current revision/checkpoint, initialized state, no pending/gap work
  and no running/unavailable rollback. It uses the unchanged scalar equality/keyset/count vocabulary.
- `validateContextualProjectionRecoveryRetainedRequest(request, current)` requires the matching
  binding/revision but allows inspection during incomplete, uninitialized or recovery states.
  Validate the coherent result with the unchanged `validateProjectionRetainedCheckpoints`.
- `validateContextualProjectionRecoveryRollback(request, current)` validates the existing operation
  protocol described below. `validateProjectionRollbackRequest` remains the pre-I/O capture helper.

Missing or malformed fences fail, and a different supplied current revision produces retryable
`projection.stale-revision`. Wrong binding/definition identities fail validation. Query checkpoint
mismatch produces `projection.stale-view`. All captures are bounded, detached and recursively frozen;
accessors, native syntax, extra fields and oversized input are rejected without evaluating user code.

These guards are not authority or synchronization primitives. A copied, stale or fabricated current
snapshot can pass structural checks. The adapter must obtain a coherent durable snapshot and **recheck
the revision, phase and relevant progress atomically with each effect or query**. The host must retain
and revalidate original source, owner, ABI and mapping authority across awaits. Labels and DTOs grant
no canonical, historical, engine, initialization or serving authority.

## Durable application and recovery transitions

Resolve each preserving mutation against the current transactional record in array order, using
`resolveContextualProjectionMutation`. Repeated keys observe preceding operations in that transaction.
Preserve required null exactly, validate the final merged record's bounds and retain the pre-block
before-image for each distinct key. Effects, original receipt, checkpoint and required undo commit
atomically. Unknown results remain incomplete until exact retry establishes durable progress. SDK
helpers alone implement none of that storage behavior.

Recovery admission, bounded advancement and completion use the existing single `rollback` method;
there are no new begin/complete methods, retry queues or phase labels. A new operation requires the
current revision and exact `from` checkpoint. The runtime selects canonical ancestry and quiesces its
owner. Before undo, the adapter durably rotates the revision and records the original operation ID,
source revision, `from` and ancestor. It restores at most `maxBlocks` complete source blocks per call.

Only that exact retained operation can retry under its original `sourceRevision` after rotation.
Changing the work budget does not change identity. Changed intent with the same operation ID fails
with `projection.conflicting-replay`. A completed exact retry returns `duplicate`, including after
replacement branch progress; it never undoes that branch again. A superseding operation leaves older
retries stale. Old applies, failure markers, inspection requests and read views cannot adopt a newly
read revision automatically, even if rollback returns to the same former checkpoint.

Actual undo availability and branch ancestry remain adapter checks. A structurally valid request
outside coverage or with a wrong ancestor ID is not evidence of availability: the adapter must
durably mark the affected instance unavailable and report `projection.rollback-unavailable`. A pure
request guard must not bypass that durable failure transition. Existing exact coverage/result
validators and limits remain unchanged, including 256 steps per call, 4,096 retained blocks, 1 GiB
retained bytes and the inclusive coverage floor. Recovery completion is progress evidence, not a
canonical or serving grant. Queries resume only after host gating and coherent adapter readiness.

SDK native24/26 tests and normally installed runtime/declaration consumers establish this portable
contract and compatibility only. HAPI359 owns actual MongoDB transactions/restarts/undo qualification;
[HAPI #246](https://github.com/eosrio/hyperion-history-api/issues/246) and
[#221](https://github.com/eosrio/hyperion-history-api/issues/221) retain production canonical recovery
and serving ownership. No engine, HTTP, Wire, WormDB or AtomicAssets/AtomicMarket parity claim follows.
