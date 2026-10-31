---
status: accepted
date: 2026-10-31
---

# Negotiate complete declared-kind reads separately from owner-v2

Owning work: [SDK #42](https://github.com/eosrio/hyperion-sdk/issues/42), with
[HAPI #402](https://github.com/eosrio/hyperion-history-api/issues/402) and
[Atomic #50](https://github.com/eosrio/hyperion-atomicassets-plugin/issues/50).
The reviewed use is the original unpaginated AtomicMarket marketplace list.

The SDK versions independently and preserves compatibility within each major.
Add the optional `stateful-owner-complete-kind` interface version 1 through the
existing `projection-stateful-owner-v2` export. It selects an actually negotiated
owner-v2 declaration; it does not change that declaration, its digest, any v1/v2
capture bytes, the existing get-only callback, or the closed owner capabilities.
The development package remains unpublished at its existing version. A future
release must pin the tested SDK/host/adapter/plugin set explicitly.

Host and adapter separately offer this closed extension record:
`{family: 'stateful-owner-complete-kind', interfaceVersion: 1, limits}`.
`negotiateStatefulCompleteKindV1` selects explicit `readAttempts`,
`responseRecords` and `responseBytes` totals no greater than the owner's existing
projection limits or either offer. No default, implicit capability adoption or
automatic bound increase is permitted. The returned selection is local and
nontransferable; a copied DTO does not authorize execution. Old hosts/adapters
refuse before acquisition or plugin execution. Existing get-only callers and
implementers need no changes.

`composeStatefulOwnerCompleteKindReadV1` uses the existing owner-v2 completed-read
capability, owner identity, declaration/generation/revision/checkpoint binding,
native checks and request authority. Only its separate callback receives
`get(kind, key)` and `all(kind)`. `all` returns all validated `{key, value}` rows
of exactly one declared kind, including a successful empty array. It exposes no
filter, database handle, cursor, limit, ordering guarantee or new authority.
It must not be used to cast the scalar projection-query family into owner-v2.

The adapter extension adds `completeKindCapabilities`, a counted
`readCompletedKey(read, expectedView, key, remaining)` operation and
`readCompletedKind(read, expectedView, kind, remaining)`. The counted key response
is exactly `{view, result, attempts}`. The new callback never uses the legacy
`readCompleted` method, whose interface has no native-attempt accounting. The
complete-kind response is exactly
`{view, kind, complete: true, rows, attempts}`. `attempts` is a positive safe
integer accounting for every native read/page/probe attempt of this call,
including retries and the work establishing exhaustion. The adapter must remain
within the supplied remaining attempts/rows/serialized bytes and retain the
same completed capability's owner, lease, readiness and host guard around native
awaits. It returns `complete: true` only after genuine native exhaustion. A
native limit, short page, byte cut, cancellation or unknown cursor outcome is
never exhaustion. A one-extra-row probe may establish overflow; it cannot make
the partial rows a successful complete result.

Both counted operations must stop before starting any data read/page/probe that
would exceed the supplied remaining total, and report every such attempt,
including failed attempts that they recover through a retry. SDK validation of
the positive reported count is additional to that native enforcement. Existing
`completedRead`/`completedView`, retained owner/lease/canonicality guards and
readiness inspection are authority checks, not projection data reads; they do
not consume this data-read attempt total. They retain the existing deadline and
cancellation boundary. Implementations cannot hide projection data reads or
their retries inside authority inspections to evade the selected total.

The SDK reserves at least one attempt before each operation, shares selected
totals across all `get`/`all` calls, and charges additional reported native
attempts. Each get consumes one record slot, including covered absence; each
enumerated row consumes one. It charges canonical UTF-8 bytes of every returned
read envelope and the final composed record to the same byte total. The adapter
receives the remaining total, never an expanded per-call allowance. Concurrent
native operations are refused because their remaining allowance cannot safely
be promised twice. Any observed failure poisons the composition even if plugin
code catches the operation's rejection. Unawaited work prevents completion.

The SDK rejects missing/changed capabilities, unknown kinds, malformed or
duplicate keys/rows, wrong kinds/views, nonliteral or missing completion,
overflow, closed ports and late results. It preserves row order as returned,
without interpreting that incidental order as a public sort contract. Native
exhaustion and truthful native attempt reporting remain adapter obligations:
SDK DTO validation cannot detect records a dishonest adapter omitted or native
operations it concealed. Actual MongoDB conformance must prove those facts.

The existing host guard owns cancellation/deadline, canonical source, selector
ABI epochs, live owner, raw-gap and fork/rollback gating. Native guards and
completed-view checks run before and after reads and before composition returns;
the native read is closed on every exit. The host must still fence final HTTP
serialization/publication and caches. A returned record is no serving grant.

Native Node24/26 controls and an actually installed packed consumer establish
this SDK boundary. They do not qualify physical MongoDB exhaustion, managed
owner/API/onSend acceptance, original PostgreSQL/HTTP behavior or full Atomic
parity. Preserve both actual arrays and report incidental order differences in
later comparisons. MongoDB is the 4.5 state target, Elasticsearch holds history,
and WormDB qualification remains follow-up work.
