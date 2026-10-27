# Contextual scalar projection development contract

[SDK #28](https://github.com/eosrio/hyperion-sdk/issues/28) adds a separate opt-in family to the
private development package. It does not change the [v1 table contract](projection.md), its closed
validators, full `put`/`delete` meanings, or existing consumers. Import the additive
`ContextualProjection*` types and functions through `@eosrio/hyperion-sdk/projection` or the root.
This is backward-compatible SDK development, not a new stable SDK major or a published release.

The concrete need is the pinned AtomicMarket processor's configured contract, original block/time
and first-creation preservation. Domain declarations belong to the plugin. No AtomicMarket names,
native database queries, generic hooks, nested-record model or new query language live here.
[HAPI #359](https://github.com/eosrio/hyperion-history-api/issues/359) owns runtime/MongoDB execution;
[plugin #6](https://github.com/eosrio/hyperion-atomicassets-plugin/issues/6) owns the actual marketplace
source-to-read slice. SDK checks do not qualify either integration.

## Definition and explicit negotiation

`ContextualProjectionDefinition` has `schemaVersion: 2`, the existing fixed contract/table/ABI
source, immutable mapping revision and genesis-only initialization. Each field declares a scalar
`type` and one `source`:

| Source | Meaning |
| --- | --- |
| `{kind: 'row', path: [...]}` | Required own-property path in the decoded row; existing scalar rules apply. |
| `{kind: 'context', field: 'contract'}` | The configured contract, as an exact string. |
| `{kind: 'context', field: 'blockNum', format: 'decimal'}` | Original positive safe-integer source block, formatted as a decimal string. |
| `{kind: 'context', field: 'blockTimeMs', format: 'decimal'}` | Original nonnegative safe-integer epoch milliseconds, formatted as a decimal string. |

Context fields require output type `string`; there is no implicit numeric coercion or date parsing.
Field/path/count/string/record/batch bounds remain the existing `PROJECTION_LIMITS`. The definition
also declares a bounded duplicate-free `preserveOnReplace` list of declared field names and an
explicit `onAbsent: 'delete' | 'incomplete'`. No declaration may silently skip a missing source row.

`validateContextualProjectionActivation(definition, binding, hostCapabilities, adapterCapabilities)`
checks the full declaration and binding plus both independently supplied capability records before
imports, initialization or native effects. Each has `family: 'contextual-table'`, `interfaceVersion: 1`
and `supported`; use `CONTEXTUAL_PROJECTION_HOST_CAPABILITIES` and
`CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES` respectively. These are distinct from the old projection
capability family. Missing/unsupported/malformed declarations are refused, not downgraded. Successful
validators produce detached recursively frozen inert JSON; they do not load code or grant authority.

The contextual definition version, contextual capability-interface version, rollback-interface version
and SDK package major are separate identities. A schemaVersion2 declaration does not activate the
existing rollback interface. Existing v1 objects/consumers remain usable and reject contextual syntax.

## Original source context and mapping

`ContextualProjectionContext` contains the existing immutable `binding` and exact `block`, plus
`source: {contract, table, blockTimeMs}`. The binding carries chain/backend/generation, mapping
revision and ABI deployment/hash; the block carries original height, ID and predecessor. Context
validation requires the configured source contract/table and matching definition identities.

The host must derive these facts from the selected provider's original source and revalidate its
actual source/owner/ABI authority across awaits. Structurally valid or copied JSON is not a canonical,
historical, durability, initialization or serving grant. The SDK cannot authenticate a caller's source
time. It does not use wall time, current head/ABI, snapshot height or a timestamp taken from row data.
The host/provider must qualify timestamp normalization; missing original time cannot become zero or
a guessed local date. Zero is accepted only as an explicitly supplied, independently verified fact.

`projectContextualTableChange(definition, context, {key, present, value?})` maps one already normalized
source identity. Context stays separate from the decoded row, so row fields with matching names cannot
override trusted metadata. `value` is required for present rows and forbidden for absent ones. A
present row produces a complete `put` when preservation is empty, otherwise a distinct
`{kind: 'put-preserving', key, value, preserveFields}`. An absent row produces `delete` only when
declared; `incomplete` returns a `projection.incomplete` diagnostic for the runtime to durably mark.
No failure advances a checkpoint or establishes an empty source block.

## Preserving replacements and ordered durable application

`ContextualProjectionApplyRequest` contains `binding`, `previous`, `block`, `source`, `policy`
and ordered `mutations`. The policy explicitly captures both definition decisions. Every candidate
contains exactly every declared field with its declared type. A preserving operation has the exact
nonempty declared field list; ordinary `put` cannot bypass a definition's preservation policy.
Only declared logical top-level field names are accepted, never native update paths/operators.

`resolveContextualProjectionMutation(definition, mutation, previous)` supplies pure reference
semantics for an adapter, returning a complete record or null for deletion. `previous: null` means
the key is absent, so the complete candidate is inserted. Otherwise the candidate replaces ordinary
fields and retains every declared preserved field from the current record. Required null is retained
exactly; it is not missing or an invitation to substitute a candidate value. Both inputs and the final
merged record must satisfy type/completeness/byte bounds. Inputs remain unchanged.

This helper does not read or write storage. An adapter **must** read/resolve/write against its current
transactional record, in mutation-array order, atomically with durable progress and required undo
evidence. A separate serving read followed by an ordinary put is insufficient. Repeated keys see the
earlier operations in that transaction. Keep the pre-block before-image for rollback; rolling back
an original insert removes the key, and a later canonical insertion gets its own creation values.
The helper alone proves no atomicity, crash recovery, canonical rollback or backend qualification.

The separate `ContextualProjectionAdapter` interface uses existing view/result/recovery shapes.
Adapters persist the entire contextual definition and reject altered content under the same binding.
Activation/storage migration must prevent v1 writes from bypassing policy in the same instance; do not
silently reinterpret pre-existing records or invent first-creation fields. Source gaps and unknown or
partial writes remain incomplete until exact recovery. Initialization still requires complete input
from block one or a separately qualified future initialization mechanism.

## Replay identity, reads and qualification limits

`validateContextualProjectionApplyInput` captures bounded inert batches before an awaited definition
lookup; `validateContextualProjectionApply` additionally enforces the exact definition, binding,
policy, source and complete records. `canonicalContextualProjectionBatch` returns canonical JSON
of the **original** logical candidate, preserve/absence policy, source context and full block/binding.
Object-key insertion order does not matter; mutation-array order is retained. Do not hash a candidate
after merging prior state. Exact retries retain the original operation even when the stored record
already preserves older values. Adapters own hashing, receipts, conflict detection and durable writes.

`validateContextualProjectionQuery` applies the unchanged scalar equality/keyset/count vocabulary to
the new declaration; it adds no native syntax or richer query capability. Serving views, caches,
headers and canonical gating remain host obligations. Production fork/finality activation stays in
[HAPI #246](https://github.com/eosrio/hyperion-history-api/issues/246), and serving contexts stay in
[#221](https://github.com/eosrio/hyperion-history-api/issues/221).

SDK tests and the installed tarball consumer exercise pure mapping, policy/refusal, exact identity,
complete candidates, null, ordered preservation and legacy compatibility on Node24/26. No engine,
chain, production rollback, Hyperion HTTP, Wire, WormDB or full AtomicAssets/AtomicMarket qualification
follows from these checks. The package remains private and this change publishes or activates nothing.
