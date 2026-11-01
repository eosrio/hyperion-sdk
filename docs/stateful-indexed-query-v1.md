# Indexed owner query development family

This optional family captures a finite one-projection model, negotiates independent host/adapter
offers and composes indexed reads through the **existing owner-v2 completed-read scope**. Import
from `@eosrio/hyperion-sdk/projection-stateful-indexed-query-v1`. Existing owner/get-only,
complete-kind, scalar and source families retain their closed contracts and capture bytes.

The SDK supplies result/lifetime enforcement, not an engine, materialization, endpoint or release
qualification. Native queries and qualified index/initialization coverage belong to History API
#415; Atomic parameter validation, lists and formatting belong to Atomic #59. No application-side
full-kind scan or comparator is implemented. The PostgreSQL en_US.utf8 observation does not
establish a binary comparison profile.

## Declaration and negotiation

`captureIndexedDeclarationV1` binds a finite model to an already negotiated **local** owner-v2
declaration. `negotiateIndexedQueryV1` requires separate host and adapter offers listing its exact
digest, comparison profile and explicit limits. Copying a declaration or selection grants nothing.
A comparison profile is a negotiated name; the adapter's qualification must establish its actual
source semantics. This family neither assumes binary order nor adds a unique public tiebreaker.

All predicates are conjunctive. `text-contains` is a literal contiguous substring, with no wildcard
expansion, implicit case folding or normalization. `array-contains` is whole-element membership.
Empty `in` is match-none. `not-in` applies only to declared nonnullable text. The plugin owns any
reference-specific validation/transformation before capture. Nulls-last is explicit in each allowed
order tuple. Offsets and exact counts retain nonnegative signed-int64 decimal strings without
Number conversion. A page is the requested OFFSET/LIMIT window; a full window does not promise
global exhaustion. An empty/short window requires actual native completion, not a budget cut or
an intermediate cursor batch.

## Owner-scoped composition

The API host chooses the configured projection, selected declaration, backend/generation, eligible
view, actual live owner and existing request deadline. It implements `IndexedQueryHostV1` by calling:

```ts
const result = await composeStatefulOwnerIndexedReadV1(
  selection, adapter, expectedOwner, expectedView,
  async read => ({schemas: await read.query(request)}), requestAuthorityGuard,
);
// In the actual response serializer, while this request is still authorized:
const body = serializeIndexedQueryResultV1(result);
```

Plugins receive only `{view, query}`. The composer reuses the private owner lifecycle helper used
by get-only composition, calls the same adapter's `completedRead`, and closes that capability on
every exit after acquisition. There is no new owner store, lease, readiness setter, checkpoint
selector, deadline or reopenable read. The adapter must issue a real local opaque capability and
retain the supplied guard. Native `completedView`/query checks must refuse pending, gap,
uninitialized, rollback, unknown coverage and incompatible materialization states in the same
qualified snapshot used by the joined data.

`IndexedOwnerAdapterV1` adds `indexedCapabilities` to the existing owner adapter and indexed
operation. The composer rechecks its offer at asynchronous boundaries. It always passes the
immutable selected declaration as `queryCompleted`'s optional fifth argument, allowing one adapter
to dispatch multiple finite models. That data is not an authority grant. Existing four-argument
single-model implementations remain assignable; they must return the selected digest or refuse.
A multi-model implementation that cannot identify the selected model must refuse ambiguity.

One operation runs at a time. Every observed failure poisons the composition even if plugin code
catches it. Pending dropped work refuses completion; the port retires before the final asynchronous
view validation, and late work cannot publish after closure. Host guard calls surround asynchronous
boundaries and final capture. The guard must revalidate actual cancellation/deadline, owner epoch,
mapping/ABI/selector, canonical/fork and coverage authority. Native view labels do not supply it.

## Result capture and totals

`captureIndexedResultV1` captures an exact count or complete requested page, rejecting extra/missing
fields, wrong operations, duplicate base identities, oversized windows and malformed scalar/vector
values. Requested canonical records retain their definition's exact integer validation. Base and
inner records cannot be null; a left record may be null. Present records must contain the model's
required typed fields. When corresponding records are returned, selected values and declared
equality joins must agree with those canonical records. There is no implicit coercion or missing
field substitution. The adapter remains responsible for coverage, one-to-one cardinality,
predicates, native order and actual complete-window/count truthfulness; a well-formed DTO cannot
independently prove those facts.

The selected limits are **cumulative across the composition**: UTF-8 serialized query bytes,
predicate occurrences, order terms and set-value occurrences, plus native data attempts, returned
base rows and response bytes. A count consumes one response-record slot. Every raw native result
envelope (view, declaration digest, attempts and joined payloads) and the final `{view, value}`
envelope consume the same byte allowance. Repeated data is charged each time it is returned.
Native retries, cursor pages and required data probes must be reported; authority/view checks are
separate guard work and cannot hide data reads. The adapter must enforce the remaining limits
before native work and declare/bound its working set, cursor and count policy. A tiny count answer
does not authorize unbounded execution. No production defaults are selected by the SDK.

## Publication and evidence

The composed DTO is not a transferable serving grant. `serializeIndexedQueryResultV1` serializes
the frozen body under its retained **original** request guard, before and after serialization;
`assertIndexedQueryPublicationV1` checks that guard at cache/onSend boundaries. Copied or foreign
DTOs refuse. Neither helper opens another read or extends a deadline. The actual HTTP host must
wire these fences through its serializer, cache and onSend path, including cache/source retirement
rules. SDK completion does not establish that integration. HTTP metadata and error mapping remain
host/plugin responsibilities.

`tests/stateful-indexed-runtime.test.mjs` executes controlled completed-read composition, joined
page/count capture, multi-model and legacy adapter dispatch, aggregate syntax/resource limits,
poisoning, concurrency/dropped work, closure, view/owner/phase/coverage fences and retained final
publication guards. The package check installs the built tarball and reruns those controls through
its exports alongside existing consumers. These finite scripted native windows establish the SDK
seam only; they provide no MongoDB, PostgreSQL comparison, HTTP, Atomic parity, Wire or performance
qualification. Runtime acceptance uses Node 24 and 26; whole-project Bun checking is a separate
toolchain gate.
