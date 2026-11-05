# Indexed completed execution development family

SDK [#50](https://github.com/eosrio/hyperion-sdk/issues/50) adds the independent
`@eosrio/hyperion-sdk/projection-stateful-indexed-execution-v1` export. The existing
indexed-query family, page/count result union, thrown-error poisoning and capture
bytes remain unchanged. No adapter, host, domain route or default offer is activated.

## Declaration and compatibility

`captureIndexedExecutionDeclarationV1` binds an already locally negotiated owner
and indexed selection to a revision and explicit semantic profile. A profile lists
the supported `execution-error` and/or `statement-timeout` codes and the exact page
or count operations for each. This is model semantics, not a native error-message
matcher. Independent host and adapter offers must name the exact execution digest,
profile and existing cumulative limits. The host observer registers a third explicit
matching offer. Copied, foreign or mismatched selections and observers refuse.

Successful values have `{kind:'result', result: <existing page or exact count>}`;
the inner value is captured through the original family without coercing decimal
counts. Qualified semantic values have `{kind:'outcome', code, profile}` and no
fabricated rows. Domain plugins own compatible HTTP statuses and bodies. Adapters
and the native observer retain database-specific diagnostics outside the portable
response. Arbitrary thrown errors always poison; no exception catch converts them
into a semantic outcome.

## Host custody and authority

The exact issuer is the private operation coordinator inside
`composeStatefulOwnerIndexedExecutionV1`, using the locally registered observer
from `createIndexedExecutionObserverV1`. The factory receives an existing trusted
host/runtime custody port; it is not a plugin-facing registration service or a new
process. A domain plugin or adapter candidate must never supply that port. There
is no exported receipt/completion mint, no `closed:true` capture and no Boolean
authority grant. The factory and private receipt state use module-local WeakMaps.

Before each native call the coordinator creates a fresh opaque receipt and invokes
the host's `begin` with the exact owner-read capability, detached owner, selected
view/model/semantics, normalized request, remaining budget and retained authority
guard. The host must bind that receipt to its actual native execution and exact
owned cursor/session identities, retaining independent driver/engine custody.
Each returned operation instance and native execution identity can finish only
once in that composition. The adapter receives the operation identity and receipt;
neither is a completion grant.

The independently registered host operation must implement all three commands:

1. `verifyTerminal` awaits and checks the actual terminal native evidence against
   the exact candidate, read, receipt, model/request, execution identity, semantic
   profile and total native data attempts. A partial cursor batch is not terminal.
2. `closeOwned` awaits closure/release acknowledgement for every owned native cursor
   and session, including error and timeout cleanup.
3. `assertClosed` independently checks native custody after closure. Unknown or
   missing closure evidence must throw. An adapter's self-reported completion or
   closure is insufficient. All commands return no grant (`undefined`) on success;
   Boolean results and every rejection reason, including `undefined`, refuse.

The SDK seals a result only after those commands and the unchanged owner/view/
source guard succeed. It also attempts cleanup after failures. The host must clean
partial acquisitions if `begin` rejects before returning its operation. Native
callback references are captured once. Reusing an operation, a wrong native/model
identity, missing commands, closure failure, incomplete result, resource exhaustion
or cancellation poisons the composition even if plugin code catches the failure.

This contract cannot independently prove physical closure from JavaScript callbacks.
The port is an explicit trust and qualification boundary. Scripted tests prove only
SDK lifecycle and binding enforcement. A real independently audited host observer
and native event custody remain required before offering this family in production.

The original owner-v2 completed read, source/owner/model/generation checks, bounded
single-operation lifetime and cumulative query/read/record/byte accounting remain.
A semantic outcome consumes one response record. Both native envelopes and final
composition consume bytes. A tiny timeout result does not authorize unbounded
native execution; the observer must account for native retries/cursor advances.
Request abort, expired safety deadline, source/fork/owner change and exhausted
safety budgets remain unavailable failures, even when a native candidate says timeout.

## Final publication

`assertIndexedExecutionPublicationV1` and `serializeIndexedExecutionResultV1` retain
the original request authority, including semantic outcomes. The host must use these
at its actual serializer, cache and onSend boundaries. A copied DTO has no authority;
neither helper opens a new read or extends a deadline. Owner read close failure also
prevents the composition from being published.

## Pinned original SQL characterization and pending gates

The original is AtomicAssets API 2.7.0 at
`0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e`. The SDK's existing retained handler
fixture has SHA-256
`9af0899d2e53e538f34abff204abdbc9aba08807b1f03be72ae718ff4d41887e`
([original handler](https://github.com/atomicassets/atomicassets-api/blob/0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e/src/api/namespaces/atomicassets/handlers/schemas.ts)).
It computes `SUM(assets)::INT` in a joined CTE, then applies the requested order
and page. Count-only wraps that query in `SELECT COUNT(*)`. The original
[response wrapper](https://github.com/atomicassets/atomicassets-api/blob/0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e/src/api/utils.ts)
maps SQL errors to 500 and recognized statement/query timeouts to 408. Those HTTP
semantics are owned by the domain, not this SDK.

The Atomic repository's source-pinned
[`sdk50-outcomes.mjs`](https://github.com/eosrio/hyperion-atomicassets-plugin/blob/main/harness/atomicassets/postgres/sdk50-outcomes.mjs)
characterizes selected-page int32 overflow (`22003`), off-page overflow, count-only
success and a real 100 ms transaction-local server statement timeout (`57014`)
blocked by an independent exclusive lock. Both rollback/releases are retained before
assertion. Off-page overflow is explicitly observed as either 200 or 500 depending
on the actual PostgreSQL plan; the SDK must not force one answer from source text.
Count-only can prune the unused cast and preserve the exact decimal count. A server
terminal timeout after verified cleanup differs from cancelling an SDK request.

That harness and its synthetic gate fixtures are not physical acceptance evidence.
This SDK change ran no database or HTTP listener. Source-pinned actual PostgreSQL
reports for those cases, a real MongoDB outcome/closure observer, original-versus-
MongoDB execution comparison, and installed HAPI HTTP/final-fence qualification
remain pending. No complete Atomic parity, physical closure or production support
is claimed by these Node 24/26 scripted-port and installed-package controls.
