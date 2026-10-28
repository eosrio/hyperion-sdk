---
status: proposed
date: 2026-10-28
---

# Preserve original table identity and recover raw-source failures

Owning work: [SDK #36](https://github.com/eosrio/hyperion-sdk/issues/36),
[SDK #37](https://github.com/eosrio/hyperion-sdk/issues/37),
[HAPI #382](https://github.com/eosrio/hyperion-history-api/issues/382) and
[HAPI #366](https://github.com/eosrio/hyperion-history-api/issues/366).
This implements the accepted protocol/backend-neutral boundaries; it changes no release obligation.
The complete version2 source/runtime/adapter lifecycle below is not implemented or activated.
Private identity/raw-target capture prototypes exercise the proposed field/byte boundaries; they
have no package export, capability negotiation, storage implementation or serving authority.

## Concrete gaps

The stateful v1 table occurrence requires nonempty `scope` and `primaryKey`. Wire KV primary
identity instead consists of contract, physical table identifier and all original key bytes;
it has no scope. A decoded display key, artificial scope or scalar projection is not equivalent.

Wire's pinned node source at `6508c9e8f4044df8d5acb082a7af3be6a80cd9a0` defines `uint16_t
table_id` in `libraries/chain/include/sysio/chain/kv_table_objects.hpp`, emits `uint16 table_id`
in the SHiP ABI at `libraries/state_history/abi.cpp`, and packs that field as `uint16_t` in
`libraries/state_history/include/sysio/state_history/serialization.hpp`. The captured schema
in Wire plugin commit `3e4e8cf6f3ae38396192137f398466244c17266c`,
`fixtures/codec/ship.abi.json`, likewise records `contract_row_kv_v0` as code/payer/table_id/key/value
and `contract_index_kv_v0` as code/payer/table_id/sec_key/pri_key, with no scope. Its provider and
ABI codec preserve those physical IDs and complete byte fields. Width is established by these
source/capture bindings, not by observing that the JavaScript decoder returns a number.

Separately, v1 `markIncomplete` requires a captured decoded source. A malformed original source
can fail before capture. Fabricating decoded input to record that failure would create a false
source identity. The existing native recovery metadata slot is the preferred home for raw-target
failure admission; another completeness/sequence journal is not proposed.

## Proposed compatibility boundary

Keep the existing `projection-stateful` subpath, interface version1, public types, capture bytes,
digests and runtime/adapter behavior closed. Add an explicitly selected version2 subpath and
definition/capability negotiation. Its table occurrence replaces the v1 scope/key pair with a
discriminated original identity:

```typescript
type OriginalTableIdentity =
  | {kind: 'contract-row'; scope: string; primaryKey: string}
  | {kind: 'kv-primary'; tableId: number; keyHex: string}
  | {kind: 'kv-secondary'; tableId: number; secondaryKeyHex: string; primaryKeyHex: string};
```

The primary and secondary namespace identifiers are the actual source fields, including zero;
Wire's offered representation requires integers in `[0,65535]`. Key fields preserve every original
byte, including leading zeroes and empty keys, with no prefix stripping, numeric conversion or
recalculation of IDs from table names. KV variants must not contain scope. Contract-row scope/key
remain their actual original fields; an absent scope is different from an explicitly empty scope.
Original row bytes, payer, presence/deletion, delta/row occurrence, contract, block/time and known
transaction association remain retained separately. Selected logical table names bind through
the applicable ABI; a physical secondary namespace cannot be relabelled as its primary table ID.

Version2 shares bounded implementation internals with version1 rather than copying the recovery
engine or translating KV records into fake scoped rows. Host/provider/adapter version and
capability agreement is mandatory before executable activation. A version2 consumer never silently
loads version1 storage. Any unavoidable breaking change to a shared public API requires an explicit
new SDK major; a separate opt-in interface must not be described as a compatible mutation of v1.

## Proposed recovery obligations

The real worker/controller retains a raw-target admission tied to its existing recovery owner:
declaration digest, exact predecessor revision/checkpoint, canonical target, source selection,
observation/capture references and owner generation. Stored labels are references, never source
authority. Only the existing canonical source/ABI readers and actual owner can authorize work.

Use distinct raw-target/reference and decoded-source failure variants in the version2 recovery
slot. A raw failure cannot claim a decoded-source digest. Failure admission must be durable even
when decoding never produces a valid source; an unknown admission/write result remains unavailable.
Crash before a failure write must leave a retained raw-target recovery obligation that cold startup
reconciles before issuing a new ready context. This must be wired through the actual owner, not
assumed from a private in-memory worker census or successful DTO validation.

Keep private bounded reduction reads distinct from public serving. Internal recovery cannot pass
an adapter facade with forged ready phase into a public query. Successful normal in-flight work
does not by itself make the completed coherent snapshot unavailable; source failure, unknown
recovery, gaps and forks retain their existing retryable/default last-valid policy. The actual
owner must prove its active/recovered status when that distinction is necessary; a cold unknown
raw target cannot be assumed to be successful in-flight work.

Retry/restart uses the exact original input and candidate custody at checkpoint+1. Apply-before-
retirement recovery inspects original source, receipt and durable progress, with no reducer rerun
for a retained candidate. Only exact current-owner/generation/revision recovery can retire its
failure; clearing metadata alone grants no serving authority. Stale-owner, cross-declaration,
orphaned/reorg and late-clear operations cannot erase a current failure. Reuse existing rollback
and physical owner quiescence; no new broker, worker pool or default runtime is introduced.

## Acceptance before activation

- Preserve exact v1 source/declaration/candidate captures, digests and existing consumer behavior.
- Refuse mixed/unknown identity fields, malformed/oversized key hex, width overflow, primary versus
  secondary confusion and scope substitution. Exercise zero/max IDs and leading-zero/empty keys
  against retained source/capture/provider evidence.
- Prove full unfiltered mixed action/table source selection, applicable occurrence ABI epochs,
  original key/scope/block/time/mapping bindings and every configured selector.
- Cover pre-decode/hook failures, missing source, uncertain writes, crash before failure persistence,
  apply-before-retire restart, stale owner, reorg, cross-declaration clear and private-port leakage.
- Prove ordinary completed-view reads remain eligible during successful in-flight work while
  failed/forked/unknown work cannot issue a new serving context; unrelated domains continue.
- Run native and packed Node24/26 checks and coordinated exact consumer/lock pins. Source controls
  remain separate from actual backend, original PostgreSQL/HTTP and full Wire/domain acceptance.
