# Portable table projection development contract

This is the bounded first slice of [SDK #1](https://github.com/eosrio/hyperion-sdk/issues/1),
not a stable SDK release or complete Hyperion 4.5 projection lifecycle. The package remains private.
The same definition, mutations and logical query are consumed by backend adapters without native
database operations in the definition or Hyperion's generic runtime.

## Ownership and activation

Import contracts and pure validators from `@eosrio/hyperion-sdk/projection` or the root export.
The [component source homes](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/architecture/hyperion-4.5-component-homes.md)
assign shared runtime integration to History API and native MongoDB operations to
`packages/backend-mongodb` there. A future WormDB adapter consumes these same contracts.

The definition declares one source contract/table, a fixed ABI deployment and exact ABI SHA-256,
an immutable mapping revision, required scalar fields and genesis initialization. Field paths select
own properties from a decoded source object and produce a complete flat record. Missing required
members, type mismatches and incompatible ABI deployments fail the affected projection; they do not
silently drop rows or stop unrelated indexing. Protocol providers own decoding and source-key
normalization. This contract does not select the correct historical ABI or prove canonical input.

`validateProjectionActivation(definition, binding, capabilities)` checks all baseline capabilities
before initialization/native storage creation. All successful validators return detached recursively
frozen JSON snapshots. Inert validation rejects accessors, functions, cycles, sparse arrays, malformed
Unicode, unsafe numbers and excessive traversal/byte budgets. It does not load a plugin or run a
database operation. Adapters persist the full validated definition and reject changed content under
the same immutable binding, even if a caller reuses a mapping revision.

`ProjectionBinding` identifies the chain, backend, projection, mapping revision, ABI deployment,
ABI hash and generation. The generation identifies one fixed initialized instance; it is not a
mutable block counter. Each adapter must also enforce its configured backend identity. This slice
has no API for switching an active generation or treating an ABI change as compatible.

## Source coverage and ordered application

`initialize(definition, binding, genesis)` accepts only the explicit checkpoint
`{blockNum: 0, blockId: "0".repeat(64)}`. The chain's genesis digest stays in `binding.chainId`;
it is distinct from the all-zero parent of the first block. Initialization is idempotent only for
the same full definition, binding and genesis. An empty database at an arbitrary source height is
not complete state. No snapshot/bootstrap readiness is inferred from this contract.

For an existing pending instance, `initialize` may throw `projection.incomplete` only after verifying
its full immutable definition, binding and storage. The runtime may then attach a recovery-capable
instance without publishing a serving view. Other identity, corruption or storage verification
errors cannot be swallowed as this recovery case. `open` and queries remain unavailable until
successful recovery of the exact failed source.

Production schedulers may require the optional `recovery(binding)` method before activation.
It returns a detached durable `ProjectionRecoveryView` containing the validated binding,
completed checkpoint, initialization status and any pending application or observed future
gap (exact source block, opaque mutation digest and bounded failure reason). This additive
method preserves compatibility with existing adapters. An adapter must validate storage and
binding integrity before returning it; missing storage or unavailable reads fail explicitly.
The scheduler resumes at checkpoint plus one and retries the original pending source. It
must not replay from block zero beyond retained receipts or treat this inspection as a read
view: `open`/`query` and the host's canonical coverage checks still govern serving readiness.

The runtime must provide every contiguous source block starting with block one, including blocks
that contain no matching row changes. `previous` is exactly `{blockNum: block.blockNum - 1,
blockId: block.previousBlockId}`. This can be reconstructed for an old redelivery after newer
blocks complete; it must not be replaced by the adapter's latest progress.

Each block's ordered mutation list uses only complete `put` replacement records and `delete`.
Repeated keys preserve mutation-array order. A `put` includes exactly every declared scalar field;
there are no implicit increments, partial patches or native query/update fragments. Strings retain
their exact well-formed Unicode content, booleans remain booleans, `null` is explicit and required
when declared, and numbers are finite safe integers. Exact wider numeric values need a declared
string representation; the SDK never coerces them through JavaScript `Number`.

`projectionRowKey(scope, primaryKey)` encodes a JSON string tuple. Both inputs are opaque normalized
strings; canonical decimal, hex or other source encodings are the protocol provider's responsibility.
The tuple prevents delimiter collisions and preserves wide integer strings. Key ordering is binary
UTF-8 lexicographic ordering of the complete encoded key, with no numeric primary-key ordering or
locale normalization promise. Lone surrogates are rejected before UTF-8 encoding.

`canonicalProjectionBatch(request)` returns bounded canonical JSON text for a replay receipt's
SHA-256. It sorts object property names and retains mutation-array order; it includes the complete
binding, predecessor, source block and mutation values. The SDK neither hashes the text nor writes
receipts. Adapters perform native hashing/storage and verify the full definition separately.

An adapter reports `applied` only after durable effects and recoverable completed progress. A
retained exact duplicate reports `duplicate` without rewriting records or regressing progress;
its returned view describes the current durably completed checkpoint. This `apply` result is not a
readiness or serving grant: contiguous gap-recovery blocks may complete while the projection remains
unavailable for queries. Conflicting payloads for the same source and older replays outside retained
receipts are explicitly rejected. A retained duplicate cannot bypass a failed-contract/applying
marker or publish a fictitious ready view. Implementations may use different physical durability
protocols, but cannot acknowledge incomplete block work as completed.

## Incomplete work and request views

`markIncomplete(binding, failedBlock, reason)` durably records failures that occur before `apply`,
including source-coverage or declarative mapping validation failures. A process restart cannot
reopen the prior checkpoint as implicitly ready. Failed-contract/applying markers require successful
recovery/replay of the exact failed source. If an adapter has already captured an applying batch's
digest, recovery must also match that exact payload.

A known future source gap is a distinct durable incomplete condition. Observing a noncontiguous
future source must retain a bounded gap target before refusing that work; it cannot leave the older
checkpoint implicitly ready after restart. Recovery may apply and acknowledge successive missing
blocks in exact contiguous order while preserving the query-unavailable gap marker. The observed
target source must then be successfully replayed with its exact identity and any previously captured
batch digest before that gap can clear. A different later block cannot skip the missing range or
silently clear the target. The returned `apply` checkpoint records only the blocks actually completed;
it does not claim recovery is finished. When required source input is unavailable, the runtime
preserves the incomplete state and keeps unrelated projections/indexing running.

`open(binding)` returns a completed `ProjectionReadView`. `query(view, query)` uses that exact
binding and checkpoint for rows, pagination and count. An incomplete or stale view returns a
retryable unavailable error. These methods validate serving readiness; a structurally valid view
or successful `apply` result alone does not. A checkpoint describes actual completed data, not a reconstructable
historical snapshot. A query against a newer state may not merely label the result with an old
checkpoint. Runtime request/cache validation must retain this context and reject known invalidation
before returning a response.

The adapter owns native read isolation and final checkpoint validation. The shared runtime owns
source coverage, ordering, failure isolation, initialization orchestration and eventual canonical
fork coordination. The separate opt-in [rollback contract](projection-rollback.md) adds fenced
recovery without changing this v1 interface. Neither contract authorizes serving last-valid state
after a failure.

## Bounded logical queries

The first vocabulary is an AND of typed equality predicates on declared logical fields, ascending
binary UTF-8 record-key order, an exclusive `afterKey`, maximum row count and optional capped count.
There are no native database paths/operators, joins, arbitrary sorting or aggregations. Unsupported
syntax fails explicitly before database access; a backend must not silently weaken it.

`count: {upTo}` counts all filter matches independently of pagination. An adapter probes at most
`upTo + 1` matching rows. Exactly `upTo` matches returns `{value: upTo, exact: true}`; more matches
returns `{value: upTo, exact: false}`. The latter is a lower bound, not a complete count.

`limit` is a maximum. A page can be shorter because of the 4 MiB canonical JSON row-array budget,
but must make progress whenever a matching row exists. `nextAfterKey` is the last returned key and
is present only when a further matching row exists. Each record fits below the page budget. Rows,
continuation detection and the independent count use the same completed view.

`validateProjectionQueryInput(input)` captures bounded syntax before an adapter awaits its durable
definition lookup. It cannot establish that a logical field exists. The adapter then calls
`validateProjectionQuery(definition, captured)` to validate required field identities and types.
The remaining helpers validate definitions, bindings, activation, apply requests and read views.

| Bound | Value |
|---|---:|
| Declared fields / source path segments | 64 / 16 |
| Encoded record key | 1,024 UTF-8 bytes |
| Scalar string / canonical projected record | 64 KiB / 256 KiB |
| Ordered mutations / canonical batch | 1,000 / 4 MiB |
| Query predicates / rows per page | 16 / 1,000 |
| Canonical JSON row array per page | 4 MiB |
| Capped count `upTo` | 100,000 |

These development bounds reject excessive input; they do not discard the remaining work or advance
completed progress. A larger source block needs a separately implemented bounded processing strategy.

## Reusable engineering example

The packaged `@eosrio/hyperion-sdk/examples/table-projection` export provides
`exampleTableDefinition`, `exampleTableAbiJson`, `exampleTableQuery` and
`createTableProjectionExample(binding)`. Its synthetic ABI JSON has an exact checked hash; its
deployment and mapping identities are fixture metadata, not a live-chain qualification pin.

```typescript
import {PROJECTION_CAPABILITIES, validateProjectionActivation} from '@eosrio/hyperion-sdk/projection';
import {exampleTableDefinition, createTableProjectionExample} from '@eosrio/hyperion-sdk/examples/table-projection';

const binding = {
  chainId: 'c'.repeat(64), backendId: 'engineering-mongodb', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision,
  abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'engineering-run-1',
};
const activation = validateProjectionActivation(exampleTableDefinition, binding,
  {interfaceVersion: 1, supported: PROJECTION_CAPABILITIES});
if (!activation.valid) throw new Error('Unsupported projection');
const example = createTableProjectionExample(activation.value.binding);
// With a qualified adapter implementing ProjectionAdapter:
// await adapter.initialize(activation.value.definition, activation.value.binding, example.genesis);
// for (const request of example.requests) await adapter.apply(request);
// const result = await adapter.query(await adapter.open(activation.value.binding), example.query);
```

The three source blocks insert Alice and Bob, fully replace Alice's quantity, then delete Bob.
The unchanged query returns Alice with quantity seven. SDK tests exercise mapping/contract behavior
and a packed TypeScript consumer. Actual write failure/retry, persistence, counts/pagination and
duplicate/conflict behavior require the real-database fixture in the adapter-owning repository.
An in-memory example does not establish MongoDB/WormDB qualification, AtomicAssets parity, canonical
rollback, worker/API integration, dynamic mapping reload or release support.
