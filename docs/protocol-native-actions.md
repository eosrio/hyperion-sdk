# Protocol-native action foundation

This additive contract belongs to [SDK #19](https://github.com/eosrio/hyperion-sdk/issues/19).
It supplies portable declarations, inert capability negotiation and runtime shape checks.
It does not implement a native source classifier, canonical proof, host activation or qualified
chain support. [Protocol-provider selection](protocol-provider.md) and its component pins still apply.

## Negotiate before importing code

A `ProtocolProfile` can require `nativeActions: {interfaceVersion: 1}`. The host must explicitly
pass `nativeActionInterfaceVersions: [1]` to `validateProtocolSelection` when it implements that
interface throughout the affected ingestion and serving paths. An omitted list means no native
interface support. A required version that the host does not advertise fails inert validation
before executable import. Installed versions/source/artifact digests remain separate checks.

Existing descriptors and providers need no new field. Their selected snapshots retain the
existing shape. The supported-version list is optional, dense and contains at most 16 distinct
positive uint16 values; declaring another version does not satisfy interface 1. Unsupported
requirements fail explicitly. Version declarations never establish runtime qualification.

After inert selection, a host can load the selected provider and call:

```typescript
const selected = validateProtocolSelection(descriptor, {
  profileId, environment, components, nativeActionInterfaceVersions: [1],
});
if (!selected.valid) throw new Error('Unsupported profile');
if (selected.profile.nativeActions) {
  const checked = validateProtocolNativeActions(provider.nativeActions, selected.profile.nativeActions);
  if (!checked.valid) throw new Error('Native runtime interface mismatch');
  // Use checked.nativeActions only after the host grants exact source/occurrence authority.
}
```

`validateProtocolNativeActions` checks the version and own data-function properties `observe`,
`decodeValue` and `encodeValue` without invoking them or an accessor. It returns a frozen method
snapshot bound to the original receiver through a captured invocation intrinsic. Callable-owned
`bind` properties or `name`/`length` accessors are not evaluated, and later replacement of the
original methods cannot change the snapshot. It does not execute conformance probes, validate a
method's output or create authority. Validate observed output separately; the host owns original
input validation, resource lifetimes, codec behavior and cancellation.

## Observe detached per-origin decisions

`ProtocolNativeActions.observe(input, source)` is synchronous. `input` contains the exact retained
handshake text (`schemaJson`), original packed `block` bytes and full original `traces` bytes as
`Uint8Array`. The host supplies `ProtocolBlockAbiSource`; a null predecessor stays null.
Call before filtering, truncation, grouping, numeric conversion or enrichment. Do not mutate input.

Return `{schemaVersion: 1, decisions: [...]}`. Each decision's `origin` contains `transactionId`,
positive safe-integer `actionOrdinal` and lowercase 64-character `rawSha256`. The ordinal names the
original first receiver, not a notification copy. The host must match that origin to its certified
`inputActionOrdinal`, exact original raw hash and selected source. A detached label does not prove
that the claimed occurrence was a first receiver. Notifications inherit only a separately proven
origin, with consistent original bytes and source evidence.

| Kind | Additional data | Meaning |
| --- | --- | --- |
| `contract` | None | Requires the host's ordinary applicable contract-ABI path |
| `native` | `nativeKind` | Opaque provider-owned kind, requiring independent host source authorization |
| `incomplete` | `error: {code, message}` | Ambiguous or unsupported work remains explicitly incomplete per origin |

Classification belongs to the selected provider's source rules. Account/name, type name, payload
shape, decoder success/failure or a missing ABI mapping cannot alone authorize native treatment.
Contradictory source membership must be rejected. Compressed packed receipts require bounded
decoding or explicit incomplete affected origins; silently ignoring unsupported membership is
invalid. Native failures must not reset unrelated ABI/state coverage or halt unrelated indexing.

`validateProtocolNativeActionObservations` checks strict data shapes, unique origins, dense arrays,
lowercase digests and well-formed bounded strings; it rejects accessors without invoking them.
It returns an immutable snapshot. `protocolNativeActionBounds` declares the limits: 100,000
decisions, 256 characters per native kind, 128 per error code, 4,096 per message and 64 Mi characters
in aggregate origin/kind/error text. An empty array is representable but proves neither empty source
membership nor complete classification. Malformed outer source or failed extraction cannot be
disguised as empty facts.

## Decode only after host authority

`decodeValue(nativeKind, bytes)` and `encodeValue(nativeKind, value)` use the selected provider's
pinned immutable native schema, independently from any deployed contract ABI. The kind is opaque
to core; no runtime schema or ABI argument is accepted. Preserve the action's native wrapper and
portable values. Decoding must consume all bytes, and encoding must exactly reproduce the original
input; appended, truncated, unsupported or malformed inputs fail. Native failure is not a request
to retry the contract codec.

The host retains original bytes and decisions with source selection, capture digest and exact
profile/component pins, reruns the provider's verification from retained source, and independently
checks canonical/fork authority. Journaled facts alone grant no canonicality, durability, decoding
or readiness authority. Source membership, first-receiver/notification proof, fork recovery and
queries remain host responsibilities. ABI reduction and native decision failures remain separate.

Host ingestion, versioned action metadata, API encoding, caches and streams must all resolve and
revalidate native occurrence authority before a native-required profile is activated. This SDK
foundation authorizes no package publication or profile activation. Coordinated provider Node/Rust
behavior and actual chain qualification remain separate release work.
