# Original stateful source input, version2

This is the source representation for the separately selected owner/recovery
version2 family in [#36](https://github.com/eosrio/hyperion-sdk/issues/36) and
[#37](https://github.com/eosrio/hyperion-sdk/issues/37). It does not change
`projection-stateful` version1 declarations, source captures or behavior. Actual
owner/native adapter, provider and HAPI integration must be negotiated and
qualified before execution. Capture functions alone do not activate that path.

`captureStatefulSourceV2` takes the owning family's declaration subset:
`{projection, sourceInputVersion:2, digest}`. The full wrapper, including its
distinct digest, is validated by the owner family. Its `projection` must be the
immutable declaration captured by this SDK instance; recapture an external DTO
through the owning family first. The private registry check precedes all
projection field reads. Input, configured bounds and the wrapper digest detach
before any hashing await.

The source keeps the existing original predecessor, block identity/time, selector,
order, ABI/mapping/codec revisions, action receipt coordinates, transaction
association and raw byte/hash/evidence fields. Table occurrences instead retain
their original identity:

```typescript
type OriginalTableIdentity =
  | {kind: 'contract-row'; scope: string; primaryKey: string}
  | {kind: 'kv-primary'; tableId: number; keyHex: string}
  | {kind: 'kv-secondary'; tableId: number; secondaryKeyHex: string; primaryKeyHex: string};
```

The physical table ID is the offered Wire `uint16` namespace bound in
[ADR0002](adr/0002-original-table-identities-and-raw-target-recovery.md), including
zero. Primary and secondary namespaces remain distinct. Full key bytes retain
leading zeroes and empty keys; KV occurrences have no scope. An original explicitly
empty scoped-row scope remains a scoped-row field. No scope is inferred from a
contract, table name or decoded primary key.

Every table occurrence has an explicit `payer`: the actual original string, or
null only when the selected protocol explicitly lacks that field. It is never
silently dropped or defaulted. A primary/scoped present row requires its decoded
record. A deletion may retain an actual record or null. A physical secondary index
row carries keys and no contract row value, so its `data` is null even when present;
an empty record must not be fabricated for it. Original physical bytes stay retained.

The captured envelope is
`{declarationDigest, sourceInputVersion:2, source, digest}`. It has a distinct
versioned digest and cannot be supplied to the closed version1 capture/adapter.
The existing declaration input, envelope, key, raw-byte and candidate bounds apply.
One delta/row coordinate cannot be emitted twice under different keys/selectors.

`ProtocolProvider.statefulTables` offers the optional `interfaceVersion:2`
normalization port. A stateful source-v2 host requires that exact capability before
using it; it cannot fall back to made-up scope fields or interpret Wire row field
names in Hyperion core. Old providers retain their existing `normalizeDelta` path.
Providers preserve physical identity/payer/presence and position-bound ABI
provenance, and return an explicit null value for secondary index rows. Missing,
malformed or unsupported source throws; ignoring a known irrelevant stream needs
a reason. Installed component pins and the owner declaration remain necessary.

These are shape, byte and provenance-reference checks, not source completeness or
canonical authority. The actual owner consumes all original sections before history
filters, proves every configured selector's applicable ABI, establishes chronology
and retains any pre-decode failure through the existing versioned recovery slot.
No missing section becomes an empty logical block. Native genesis is separately
verified. Source controls do not establish Wire testnet, MongoDB or Atomic API parity.
