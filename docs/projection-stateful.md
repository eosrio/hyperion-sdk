# Stateful projection recovery: SDK development contract

Status: executable SDK acceptance candidate for SDK #32; architecture proposal remains under review.
No installed host or adapter gains support automatically. No package release, production activation,
engine durability, chain authority or complete AtomicAssets/AtomicMarket parity is established.
The [proposal](projection-stateful-proposal.md) and [ADR](adr/0001-bounded-stateful-projection-family.md)
remain the scope. Existing scalar/contextual/recovery implementations are unchanged.

Import this family explicitly from `@eosrio/hyperion-sdk/projection-stateful`. It is not added to the
root, protocol or existing projection subpaths. The family is `stateful-projection-recovery`, version1.

## Working vertical seam

1. Supply explicit `StatefulLimits`, a complete `StatefulDefinition`, and separate host/adapter
   capabilities to `negotiateStatefulProjection`. Required capabilities and every quantitative bound
   are checked before this helper imports a hook or touches storage. Labels are eligibility only.
2. The host initializes its opted-in adapter, with verified complete genesis coverage. Adapter
   initialization persists the complete declaration identity; changed content under that identity
   conflicts. This SDK supplies no snapshot seed or deployment mechanism.
3. Call `executeStatefulBlock` with the original ordered block inputs, adapter, durable host candidate
   custody, deterministic hook and mandatory host guard. It inspects receipts first. Exact committed
   replay returns retained progress without invoking the hook. Original stored candidates are
   validated and reused for uncertain retries; an absent original pending candidate fails.
4. For a new block, the hook gets a captured `source` and predecessor `view`, exact `get(kind,key)` and
   full `put(kind,key,value)`/`delete(kind,key)` staging. Earlier staged records/deletions shadow the
   coherent base. Repeated keys preserve mutation order. No database query, filter or join is exposed.
5. The immutable candidate includes source/declaration digests, the predecessor view, base record and
   covered-absence observations, and ordered mutations. The full candidate is bounded, hashed and
   retained in host input custody before the adapter receives it. A driver retry receives only this
   fixed plan, never a hook callback.
6. Compose API reads using `composeStatefulRead` and one eligible view. It checks the complete view
   before and after reads. Both recovery revision and checkpoint must match: ordinary application
   advances the checkpoint without rotating the revision. Progress returned by duplicate application
   is not a serving grant; `open` and `read` must still enforce durable readiness.

The composition helper bounds total keyed attempts, response records, cumulative read bytes and the
final inert response object across the callback, then closes its port. `readStatefulRecords` is the
lower-level single-call batch primitive, returning explicit coverage results; endpoint composition
must not omit the enclosing aggregate/output checks. No relationship absence can grant completeness.

The additive `StatefulQueryHost` type is the request-scoped API domain port: `compose(projectionId,
callback)` supplies the existing `StatefulQueryRead` and returns `StatefulQueryResult`. A domain
plugin does not select a native backend, construct a serving context, publish readiness or reopen
views per relationship. This type supplies no implementation, Fastify loader, canonical authority
or automatic activation. HAPI #366/#191 owns the production implementation and final response gate.
The host must refuse calls after request closure and retain source/owner, all selector ABI epochs,
declaration, revision/checkpoint, cancellation and deadline checks through serialization and final
publication. A returned result or its view DTO cannot authorize a later response/cache hit. The
existing HTTP host owns shared state headers and retryable unavailability. Existing scalar consumers
and the standalone `composeStatefulRead` helper are unchanged.

Hooks own domain ordering, metadata conversion, ownership predicates and final relationship closure.
The fixture's config10/relationship20/mint50/update60 priorities and mint-buffer flush are fixture
code, not generic SDK scheduling. Missing coverage is `unavailable`, never an empty value or covered
absence. Known absence is explicitly `covered-absent`. The generic SDK does not decide that missing
domain relationships are optional. Notifications and other external effects remain outside reduction.

## Capture and values

Definitions bind chain/backend/generation, mapping revision, hook artifact/revision, codec and
normalizer revisions, finite selected actions/tables and per-selector ABI deployment/hash. Record
kinds declare object-path scalar/vector integer leaves. The complete declaration plus limits has a
SHA-256 digest. Capture results are detached and deeply frozen.

Declaration handles are local captured objects. After decoding persisted/transported declaration
data, recapture its definition/limits and negotiate at the receiving boundary; a JSON clone is not
an execution handle. This prevents caller mutation/forged digests without implying source authority.

Action inputs retain transaction, receiver, action/receipt ordinals and exact optional sequence
strings. Table inputs retain contract/scope/key, present/deleted status and delta/row ordinals; an
unknown transaction association is explicitly null. Every occurrence retains original bytes/hash,
source-evidence identity, ABI/mapping/codec/normalizer identities and original vector position.
Occurrence uniqueness is independent of selector aliases and processing order. Captured hashes and
synthetic fixtures do not establish raw/decoded equivalence, canonical membership or ABI applicability.

`value` bounds apply to each stored record; independent `envelope` bounds cover declarations,
sources, candidates and read responses. Selector/kind counts, raw input occurrences/bytes, logical
key bytes, read keys/attempts, mutations, canonical candidate bytes and response records/bytes are
also explicit. All applicable bounds apply, including the smaller enclosing byte bound. No numeric
production defaults or aggregate per-chain budget value, units, syntax or activation are selected.
Larger valid workloads need a separately qualified bounded strategy, not truncation or progress skip.

Generic records preserve finite fractions, null versus missing, arrays and well-formed strings.
Declared int64/uint64 scalar/vector leaves use exact canonical decimal strings without Number or
unbounded BigInt parsing. Whole puts replace objects; the plugin explicitly preserves required facts.
`canonicalStatefulRecord` returns the frozen value, canonical JSON and UTF-8 bytes. Object key order
is UTF-16 code-unit lexical; array order remains numeric. Candidate identity separately binds the
complete declaration, original source and view; record text alone is not a candidate identity.

Unlike the retained private first-tracer experiment, **generic JSON accepts NUL and literal `\u0000`
without normalization**. The shared implementation has an explicit generic path and retains the
private legacy refusal wrapper. Original AtomicHub/PostgreSQL NUL-to-space/literal-escape failures
remain plugin/codec policy and separate controls. The first AtomicAssets tracer must refuse affected
inputs until that compatibility policy is decided; this SDK does not repair or bless the codec.

Accessors, cycles, sparse arrays, custom prototypes, nonfinite numbers, malformed Unicode and excess
traversal are rejected. Own special-name data stays inert. Trusted hook determinism, time/cancellation
and actual source ownership are host obligations; this is not a Proxy detector or JavaScript sandbox.

## Adapter and recovery conformance

`StatefulAdapter` is a separate backend-neutral interface. Every adapter must atomically recheck
declaration, revision, predecessor checkpoint and phase with logical effects, original receipt,
pre-block before-images and completed progress. A repeated key has one original before-image;
undo restores prior existence and values. Unknown commits remain incomplete until inspection or
exact original-candidate retry establishes the result. Committed duplicates cannot bypass pending,
gap, rollback or expired-receipt coverage. Runtime input custody must reject conflicting retention.

The adapter reuses the existing durable pending/gap and rollback operation lifecycle. No new
begin/finish protocol is added. `captureStatefulRecovery` and `captureStatefulRollback` check the
portable metadata and original-operation retry identity. Rollback rotates revision durably before
undo, preserves exact retry across interruption, gates affected reads, and accounts retained bytes
including block descriptors. Existing ceilings remain256 blocks/call,4096 retained blocks and1GiB.
Unavailable ancestry stays incomplete; the runtime selects canonical recovery and historical sources.
Retention inspection returns the complete bounded applied branch; callers must provision envelope
bounds for their offered coverage. A metadata validator supplies neither atomicity nor authority.

The mandatory guard is called before and after awaited adapter, custody and hook work. It must
revalidate source/canonical/ABI ownership, caller cancellation and the existing deadline. It grants
no new timeout and cannot preempt arbitrary trusted code. On failure the helper throws without an
acknowledgment; the host still owns durable failure/gap admission, owner quiescence and serving gates.
There is no automatic retry, new worker pool or change to RabbitMQ or Elasticsearch history.

The reusable test conformance exercise runs A/B/rollback/C against two separately initialized
reference-memory backends. It covers full staged replacement/delete, owner/burn/null, relationship-only
C, source and capability negatives, exact/conflicting replay, stale/coincident reads, simulated
unknown commits, fixed driver retries, cancellation/deadline and interrupted rollback/coverage loss.
Packed ESM/TypeScript consumers exercise the new subpath and unchanged existing consumers.

These are working SDK/reference semantics, not production host or MongoDB/WormDB implementations.
HAPI #366 still owns journal/provider integration, runtime authority/serving and actual worker gates;
plugin #10 owns original domain behavior and PostgreSQL comparisons. Real adapter transactions,
durable restart/fork/byte-accounting qualification, deployment live-reload integration and all remaining
API inventory remain outstanding. Completing this seam does not close SDK #32 or the full parity gate.
