# Retained applied-branch inspection

This additive development contract supports [SDK #16](https://github.com/eosrio/hyperion-sdk/issues/16)
and [History API #246](https://github.com/eosrio/hyperion-history-api/issues/246). It extends the
[rollback interface](projection-rollback.md) for runtime-coordinated canonical recovery.

`ProjectionRecoveryAdapter extends ProjectionRollbackAdapter` adds
`retainedCheckpoints({binding, revision})`. It declares a separate `recoveryCapabilities` object:

```typescript
{interfaceVersion: 1, supported: ['retained-checkpoints']}
```

`validateProjectionRecoveryActivation(definition, binding, capabilities, recoveryCapabilities)`
checks both manifests independently. Existing v1/v2 manifests, validators and factories retain
their exact contracts; adding this capability to the closed v2 `supported` list is invalid.

The method returns `{recovery, checkpoints}`. `recovery` is the existing v2 recovery snapshot.
`checkpoints` lists exact `{blockNum, blockId}` applied-branch identities in descending height,
starting at `recovery.checkpoint` and ending at `recovery.coverage.floor`, inclusive. Every
intermediate height occurs exactly once, block IDs are distinct, and the list length equals
`retainedBlocks + 1`. Empty retained coverage returns the single current/floor checkpoint.
An upgraded v1 instance therefore starts at its actual migrated floor, without invented ancestry.

Adapters capture inert request data before native I/O, validate the binding and current revision,
then derive both members from one validated durable metadata read. Revision mismatches fail with
retryable `projection.stale-revision`; missing, corrupt or unavailable metadata fails rather than
inventing progress. The result remains available for truthful inspection during pending/gap work
and running or unavailable rollback. It contains no undo images, native descriptors or database
handles. It does not grant serving readiness or establish canonical ancestry: the runtime must
compare these applied identities with its separately qualified canonical source evidence.

`validateProjectionRetainedCheckpointRequest` and `validateProjectionRetainedCheckpoints` return
detached, recursively frozen bounded data. The result reuses the strict v2 recovery validation and
allows at most 4,097 checkpoints: 4,096 retained blocks plus their floor. Existing 4 MiB traversal
and encoded-input bounds apply. Callers should use the returned value rather than mutable inputs.

Native storage consistency, durable rollback, source evidence and worker restart behavior require
the adapter/runtime qualification fixtures. SDK tests and packed consumers establish this portable
contract only.
