# Explicit raw-owner recovery v2

`@eosrio/hyperion-sdk/projection-stateful-owner-v2` is a separately negotiated
host/native extension. Its wrapper retains a genuinely captured, unchanged v1
projection definition and limits, selects `sourceInputVersion: 2`, and has its own
digest. The v1 declaration, source, candidate, execution and storage formats do
not adopt this family. [Original input v2](projection-stateful-source-v2.md)
preserves scoped rows and scope-less primary/secondary KV identities explicitly.

The actual host acquires a native owner lease using the exact inspected metadata
version, view and previous claim. Before reading or decoding retained input, it
captures and admits the current canonical checkpoint+1 target with its real
commit, selection and observation references. A raw failure has no invented
decoded source digest. Once decoding succeeds, `bindSource` binds the real v2
capture to that original target. A takeover retains the original target and its
original owner; it does not rewrite source references to the new owner.

`executeStatefulOwnerBlockV2` uses the same private fixed-candidate execution and
reduction kernel as v1, with actual version-specific capture and native ports.
The host retains candidate custody before apply. A pending or unknown apply can
only recover its original candidate; it cannot rerun hooks to guess the result.
The native adapter commits observations, mutations, undo, receipt and progress
together. Raw/failure recovery remains until `retireRaw` proves that exact
original target/source/candidate receipt and completed progress. Clearing a slot
alone never grants serving authority. A stale owner, different declaration,
different target or revision cannot retire another operation's recovery.

The worker-local lease and private reduction read capability are opaque and
adapter-local. Neither is a plugin query port or a serialized IPC capability.
The SDK passes plugins only a bounded reduction callback. Its capability is
closed even when authority fails immediately after acquisition.

`composeStatefulOwnerReadV2` uses a distinct API-local completed-read capability.
The host must first obtain actual request-scoped authority from the current live
projection owner and revalidate canonical source, every selector/ABI epoch,
declaration, revision, checkpoint, cancellation and deadline. The supplied guard
must retain those checks around awaits, and the host must revalidate again at
final response publication. Native labels, `recovery()` DTOs and successful
composition results cannot replace this authority. Known successful in-flight
input may permit a coherent completed checkpoint; raw/source failure, rollback,
unknown or cold unreconciled ownership must remain unavailable in the host.

Rollback uses the original bounded undo lifecycle and rotates revision, thereby
invalidating old leases and private read capabilities. A cold owner must inspect
and reconcile retained raw/candidate/receipt state before issuing any serving
grant. This source contract and controlled conformance evidence do not establish
physical MongoDB crash safety, Wire workload acceptance, or full AtomicAssets/
AtomicMarket SQL and HTTP parity.

The optional [complete-kind interface version 1](adr/0003-optional-complete-kind-reads.md)
adds a separately negotiated callback with `all(kind)` through that same completed
read capability. Host and adapter offer `stateful-owner-complete-kind` version 1
with explicit shared attempt/record/byte totals. `negotiateStatefulCompleteKindV1`
returns a local selection for `composeStatefulOwnerCompleteKindReadV1`; ordinary
get-only declarations, captures, capabilities and callbacks remain unchanged.
Missing support refuses before acquisition or callback execution. No public order,
filter or pagination is introduced. Database exhaustion remains an adapter proof
obligation and final HTTP publication remains the host's responsibility.
