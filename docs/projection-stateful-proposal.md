# Proposed bounded stateful projection contract

Status: **architecture proposed; executable SDK development candidate, no host/engine qualification**.
This is [SDK #32](https://github.com/eosrio/hyperion-sdk/issues/32), prerequisite to
[HAPI #366](https://github.com/eosrio/hyperion-history-api/issues/366) and
[plugin #10](https://github.com/eosrio/hyperion-atomicassets-plugin/issues/10).
The [proposed ADR](adr/0001-bounded-stateful-projection-family.md) records the trade-off;
[terms](../CONTEXT.md) distinguish source occurrences, staging and completed state.
The [development contract](projection-stateful.md) identifies the implemented opt-in SDK seam and
reference conformance evidence. The broader proposal is not adopted by these exports; installed
hosts/adapters do not gain support, and illustrative bounds below select no production values.

## Evidence and the smallest addition

The baseline is SDK `8d37e932df5e0e7d671c9682505de3dd55f0edb4`, whose
[scalar](projection.md), [contextual](projection-contextual.md) and
[contextual recovery](projection-contextual-recovery.md) contracts stay closed and unchanged.
They cannot represent nested metadata, a compound action/table reducer or coherent relationship reads.
Propose one opt-in `stateful-projection-recovery` family, interface version 1, for these capabilities.
Its family/definition version, SDK package major, ABI deployment and hook revision remain independent.
Reuse recovery semantics and metadata shapes where applicable; never cast compound inputs to a
single-table contextual batch or reinterpret the existing single-source ABI binding.

The concrete oracle is AtomicAssets API 2.7.0
[`0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e`](https://github.com/atomicassets/atomicassets-api/tree/0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e),
its [actual processors](https://github.com/atomicassets/atomicassets-api/blob/0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e/src/filler/handlers/atomicassets/processors/assets.ts),
[scheduler](https://github.com/atomicassets/atomicassets-api/blob/0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e/src/filler/processor.ts),
and [SQL view](https://github.com/atomicassets/atomicassets-api/blob/0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e/definitions/views/atomicassets_assets_master.sql).
Plugin `e4799bfd7faf13c9ac4042ed9e7fb1e7145e0e55` retains
[original processor/codec controls](https://github.com/eosrio/hyperion-atomicassets-plugin/blob/e4799bfd7faf13c9ac4042ed9e7fb1e7145e0e55/docs/parity/atomicassets/lifecycle.md)
with `@atomichub/atomicassets` 2.2.0. Their constructed events and scripted SQL effects are not
chain captures, PostgreSQL transactions or physical MongoDB parity. HAPI
`31356f34b9d63e34fd3d02f1ba7193b00749c4bc` supplies the inspected contextual foundation,
not this missing compound path. Full AtomicAssets/AtomicMarket 2.7.0 parity remains open.

## Declaration, values and bounds

One immutable definition declares a finite set of input selectors and logical record kinds in one
atomic group. Bind chain, selected backend, generation, mapping revision, hook artifact/revision,
metadata codec and normalization revisions, and each selector's contract/action or table plus exact
ABI deployment/hash. Hash the complete declaration; changed content under the same identity fails.
Under the operator-selected
[full-auto policy](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0012-generate-state-mappings-for-allowed-accounts.md),
compatible declarative ABI/mapping epochs are generated, validated and
[live activated](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/adr/0038-require-live-declarative-mapping-reload-for-45.md)
without per-deployment human approval or indexer restart. An incompatible epoch remains scoped
incomplete until compatible processing is available; stage backfill/rebuild only when needed, not
for every on-chain `setabi`. Executable hook/native updates remain audited, pinned, operator-initiated
code changes and may require controlled restarts. Declarative reload does not authorize executable
replacement. No domain names, original processor priorities or database schema enter generic core.

Records contain bounded inert JSON trees: well-formed strings, booleans, explicit null, ordered arrays,
objects and finite numeric leaves. Declared int64/uint64 leaves, including vectors, use canonical
decimal strings (`0` or a nonzero-leading decimal, optionally negative for int64) with exact
signed/unsigned range validation without conversion through `Number`.
Pinned plugin codecs retain the distinction between such strings, ordinary strings and finite float
numbers. A textual `"NaN"` or overflow value emitted as a string stays a string; numeric NaN/Infinity
is invalid. Finite fractional leaves retain their JSON numeric meaning; JSON canonicalization maps
negative zero to zero. Object-property order is canonicalized; array and input/mutation order remain.

Missing object members differ from present null. Every mutation is a complete `put` or `delete` in a
declared record kind. `put` replaces the whole record, including arrays/nested objects. There is no
implicit recursive merge, increment or database operator. The plugin may read then emit a complete
record preserving required creation/immutable fields; a replacement mutable object drops removed
members. It models original asset upsert and mint-fact insert-if-absent separately using exact reads.

The table gives **initial illustrative engineering-tracer bounds**, pending representative metadata,
mass-mint workloads and resource profiling. These are not selected production SDK ceilings or a
reduction of the full 2.7.0 parity requirement; the existing recovery-contract limits below stay intact.

| Illustrative tracer maximum | Value pending profiling |
| --- | ---: |
| Declared input selectors / record kinds | 16 / 8 |
| Top-level record fields / structured depth | 64 / 16 |
| Tree nodes per record / array elements | 4,096 / 1,000 |
| Encoded logical key / scalar string / record | 1,024 B / 64 KiB / 256 KiB |
| Selected input occurrences / ordered mutations per block | 1,000 / 1,000 |
| Exact keys per read call / read attempts per reduction | 32 / 128 |
| Canonical candidate, including inputs, observed records and mutations | 4 MiB |
| Response records and canonical response bytes | 32 / 4 MiB |

The staged overlay counts toward the candidate budget, including repeated-key operations. Reject
accessors, functions, cycles, sparse arrays, malformed Unicode and excess traversal before effects.
Adapters may advertise lower bounds; activation refuses a definition requiring more. Over-bound
work stays incomplete without advancing progress; larger valid blocks need a qualified bounded
processing strategy, with no silent data loss. Existing host attempt deadlines and cancellation apply
across awaits and before commit. These limits do not promise preemption of arbitrary trusted
JavaScript or a new sandbox.

These per-candidate/value bounds are separate from
[HAPI #277](https://github.com/eosrio/hyperion-history-api/issues/277)'s experimental per-chain
aggregate budget policy. Its explicit budget requirement is approved; numeric value, default,
units, syntax and activation policy remain unselected. This proposal chooses none of them and
authorizes no production activation.

## Original inputs and deterministic staging

The runtime supplies every contiguous block, including an empty selected-input vector, with exact
predecessor/block IDs and original normalized block time. An action retains transaction ID, action
ordinal, receiver/receipt occurrence coordinates, exact sequence strings when present, contract/name,
payload bytes/hash and selected source evidence. A table occurrence retains original contract, scope,
primary key, present/deleted status, delta/row ordinal and bytes/hash. Table changes without a source
transaction association explicitly say so; never invent one. Every input retains applicable original
ABI deployment/hash, mapping/codec/normalizer identities and its position in the source vector.

Capture kind-specific order and a pinned deterministic dispatch/merge policy. Cross-kind processing
order is not a fabricated chain chronology. Qualify the normalizer against original dispatch; a
provider that loses original scope/key or required occurrence identity is refused. Retained bytes
and copied DTOs do not grant canonical authority. The host revalidates source ownership, canonical
association, ABI/mapping applicability and cancellation after awaits and before application.

A trusted plugin reduction receives that captured vector and a bounded processing view. It reads
only declared exact logical keys, stages full replacements/deletes, then returns an inert candidate.
The overlay serves earlier staged records/deletions before the coherent base view; repeated keys
retain logical mutation order. No native session/query, arbitrary filter, join language, network,
wall-clock time or random value may determine these persisted effects. Required enrichment would
need a separate captured/versioned input. Notifications and HTTP side effects are outside reduction.
This is a conformance obligation for trusted code, not a universal determinism-enforcement claim.

The AtomicAssets plugin owns stable processing by priority 10 (config), 20 (collection/schema),
50 (mint) and 60 (updates), preserving original insertion order at equal priority. Its reducer flushes
the mint buffer into staging before updates, just as the original priority-complete callback does.
Core preserves the supplied order and ordered block execution; it does not acquire AtomicAssets
scheduling rules. The hook must validate final required relationship closure before completing
the atomic group. An original mint callback succeeding alone does not prove that closure.

## Coherent reads, commit fencing and recovery

Use a processing view bound to the complete definition, backend/generation, durable recovery revision
and exact completed predecessor checkpoint. The first implementation may optimistically validate
that revision **and checkpoint** around coherent exact-key reads, then atomically compare both again
at commit. Recovery revision alone is insufficient: ordinary block application advances checkpoint
without rotating it. A backend snapshot may implement the same semantics. A stale view fails rather
than relabeling newer rows with an older checkpoint; no database handle is exposed to plugin code.

Exact-key results distinguish a present record from covered absence. Unknown source/relationship
coverage is unavailable, not null, an empty array or a successful not-found. All lookups in a reduction
use one base view; staged changes remain local until commit. A changed view aborts the candidate.
Only the runtime can schedule a fresh attempt using the original source and eligible predecessor;
queued work never adopts a new recovery revision by inspecting current metadata.

Capture two related identities before application: the canonical original source/declaration digest,
and the candidate digest covering that source, predecessor, observed values/absences and ordered
mutations. Keep the original candidate in bounded recoverable input custody before a commit attempt.
The adapter retains these identities in its existing receipt/pending machinery. Exact committed
redelivery returns the retained result/current progress without rerunning the hook against newer
state; conflicting source or candidate content fails. Duplicates cannot bypass pending/gap/rollback
markers or grant serving readiness. An older source outside receipt coverage fails
explicitly. Recovery revision remains a separate fence, not a license to change logical replay data.

The adapter atomically verifies the current revision, predecessor, phase and declaration, then commits
records, original receipt, pre-block undo and completed progress. Repeated keys have one original
before-image; undo restores prior existence and values for every changed group key. Its driver may retry this
fixed storage plan under the same fence, **never call the hook inside automatic transaction retries**.
An unknown commit result stays incomplete until inspection/exact candidate retry establishes outcome;
the hook cannot produce new effects from external responses or current state during that recovery.

Reuse contextual recovery's durable pending/gap admission, exact rollback operation identity,
revision rotation, retained-checkpoint inspection and bounded undo. Keep its existing limits
(256 blocks per call, 4,096 retained blocks, 1 GiB retained bytes) and byte accounting obligations.
No new begin/finish protocol or canonical authority is added. The runtime quiesces the owner, gates
affected reads, selects the canonical ancestor, resumes the exact rollback and admits replacement
blocks. Outside retained coverage, preserve incomplete state and request qualified historical inputs
or reinitialization; do not invent inverses or stop unrelated indexing.

For API composition, the plugin opens one eligible view and reads the asset key, then its exact
collection/schema keys at that same revision/checkpoint. Multiple bounded calls must validate the
same view before and after access; a concurrent apply/rollback invalidates the response. The endpoint
declares this coherent snapshot requirement. The adapter owns isolation; host readiness/canonical
checks still apply before response publication. Bind caches to the backend, complete definition,
generation, revision and checkpoint. This introduces no cross-projection or state/history barrier.

## Concrete A / B / C and read

Use contract `atomicassets`, collection `fixturecoll`, schema `fixture`, asset
`9007199254740993`, original minter `author`, and transaction bytes from the retained controls.
A denotes a block after a verified contiguous genesis prefix. The retained constructed height
123456 by itself is not proof of that prefix or a valid arbitrary-height initialization.

| Source block | Reduction and expected coherent read |
| --- | --- |
| A | Complete original config/collection/schema/descriptor inputs; collection fee `0.05` and ordered schema arrays. Untemplated `logmint` (`template_id: -1`) creates asset plus immutable mint fact; staged mint flush precedes same-block `logsetdata`. Mutable data becomes `{name: "replacement mutable", signed: "-9223372036854775808"}` with `old` missing; immutable `serial: "18446744073709551615"` stays a string. Wrong-owner `mallory → wrong` changes no asset; matched `alice → bob` does. Read owner `bob`, template null, distinct original mint/transfer/update fields, complete required relationships. |
| B, successor of A | Original `logburnasset` retains the row, sets owner null, burner and burn/update block/time; mint and transfer facts remain. Read at B returns the burned asset, not asset-not-found. |
| Rollback B → A | Runtime gates reads and selects exact A; adapter rotates revision and restores all B effects/progress atomically with recovery. Old B views and the old A view remain stale even when the checkpoint again equals A. |
| C, canonical successor of A with a different block ID from B | Collection name and schema media descriptors change, with no asset mutation. A fresh coherent read returns owner `bob` and the new light relationships; asset freshness remains A while the compound completed view is C. Old cached relationship data cannot be reused. |

Read assembly follows the actual SQL light view, then the existing formatter. Collection
`name/img/images` use PostgreSQL `data ->>` text/null semantics, not raw arbitrary collection metadata
or JavaScript object stringification. Schema has its light format/types/creation fields, not a nested
standalone-schema collection object. Preserve baseline decimal-string block/time response fields;
never substitute wall time or the response's compound checkpoint for a row's original lifecycle time.
Never persist a final formatted mint-time response that silently
goes stale on C. Required collection/schema absence leaves this family incomplete. A genuinely absent
asset at a complete view may produce baseline HTTP 416; missing coverage may not imitate that result.

The restricted fixture must prove absent template/backing/bridge relationships from input coverage
and domain facts, not absent storage alone. Keep the view's template-mint default distinct from proof
of mint reconciliation and original-mint coverage. Observed unsupported backing/template/bridge input
cannot be ignored while claiming a complete asset response.

## Negotiation, initialization and implementation acceptance

Validate separate host and adapter family/version, required capabilities and quantitative bounds
before importing hooks, creating storage or serving. The host must declare original ordered inputs,
authority revalidation, bounded staged reduction and runtime recovery. The adapter must declare
structured records, coherent keyed reads, atomic group commit with revision/checkpoint fencing,
original replay receipts, bounded undo and retained inspection. Missing support refuses activation;
old scalar/contextual/installed consumers neither gain nor require this capability. Metadata agreement
is eligibility, not evidence of support. One active backend per chain remains the operator's choice.

Initially require verified complete genesis inputs for this compound family, including relationships
and original lifecycle chronology. A current table snapshot cannot reconstruct earlier mint, transfer,
burn or creation time. A separately qualified seed plus historical backfill could be proposed later;
it must declare coverage and cannot guess missing facts or require a full Elasticsearch history reindex.
Fail only the affected required projection/query scope with retryable unavailable; do not claim an
older checkpoint reconstructs a safe last-valid snapshot. Reuse existing workers and RabbitMQ default.

Implementation acceptance must include all of the following; none was executed by this docs change:

- Node 24/26 normal committed-lock installs, full contract checks and packed ESM/TypeScript consumers;
  unchanged scalar, contextual, contextual-recovery and installed protocol consumers.
- Actual pinned original processors **plus PostgreSQL view and HTTP**, compared with independently
  inspected physical MongoDB records, original receipts, undo/progress and the portable coherent read.
  Use asset ID `9007199254740993` within PostgreSQL signed bigint range; max-uint64 codec controls
  alone do not prove PostgreSQL storage parity. Include relationship-only C and actual SQL text casts.
- A/B/C, same-block repeated keys and stable priority ties; exact/conflicting replay; process restart,
  uncertain commit, driver retry without hook rerun; missing source/ABI/time/schema, false covered
  absence, stale/coincident reads, and malformed/over-bound trees, vectors, keys, plans and outputs.
- Rollback interruption/exact retry, exhausted undo coverage, canonical replacement and lost-response
  replay; no premature readiness or acknowledgment, with unrelated indexing continuing. Source/ABI
  authority and production fork/serving gates remain host qualifications, not DTO validation.
- The identical portable conformance requirements for MongoDB and WormDB. WormDB implementation
  and real-engine qualification remain required before support is offered; MongoDB success cannot
  imply WormDB support, deployed-contract Wire support or complete API parity.

The original NUL/literal-backslash JSON conversion exception remains an **undecided policy**. Retain
its failing controls; exclude it from the first successful tracer and refuse affected input as
unsupported/incomplete pending a deliberate policy. Do not silently repair or bless it. Templates,
backing/tokens, mint reconciliation, bridge links, lists/stats/logs/sockets and all remaining 2.7.0
inventory stay open. Review this proposal before interface implementation; documentation checks
do not establish implementation acceptance.
