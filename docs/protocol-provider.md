# Protocol-provider development contract

This additive contract belongs to [SDK #4](https://github.com/eosrio/hyperion-sdk/issues/4) and
the real [History API integration #212](https://github.com/eosrio/hyperion-history-api/issues/212).
It implements the separation accepted in ADR 0005 and the coordinated package boundary in ADR 0030.
It does not establish a stable SDK major, native module ABI, or selected Wire testnet support.

Import the portable types and selection validator from `@eosrio/hyperion-sdk/protocol`.
They are also exported from the existing package root. The existing component-manifest schema,
metadata validators and compatibility semantics remain unchanged.

## Select before importing code

The host reads a `ProtocolDescriptor` as inert JSON before importing any affected provider module
or constructing a native decoder. It has `interfaceVersion: 1`, an existing `kind: "protocol"`
component manifest, and named profiles. Each profile declares its coordinated `components` array.
Each component requires:

| Field | Meaning |
| --- | --- |
| `id` | Lowercase identifier, unique together with its runtime within the profile |
| `runtime` | `node` or `rust` |
| `version` | Exact semantic version, including prerelease/build identifiers |
| `sourceRevision` | Exact 40-character lowercase Git source revision |
| `sha256` | Lowercase digest of the verified artifact or canonical artifact manifest |

`validateProtocolSelection(descriptor, {profileId, environment, components})` validates the manifest
and exact installed Hyperion/SDK versions, the selected profile, and every required component pin.
It returns `{valid: true, descriptor, profile}` with frozen snapshots, or `{valid: false, errors}`
with diagnostic codes, JSON Pointer paths and messages. Missing Rust artifacts fail even when the
immediate caller runs in Node, when that profile declares Rust as part of its coordinated set.
Component source/build digests are compared independently from versions. No first-profile fallback
is permitted. Extra installed components are permitted but must be well formed and unambiguous.

The host must compute or independently verify the installed artifact digests before passing its
snapshot. Repeating claimed metadata on both sides is insufficient artifact verification. A
source-manifest digest is useful for a source-only engineering component, but must be labeled as
such; it proves neither a built binary's integrity nor production runtime qualification. This SDK
validator does not inspect files, import code, or establish tested runtime compatibility.

The descriptor and selection must contain plain, finite, acyclic JSON data. Accessors, functions,
non-JSON objects, sparse arrays and unsupported fields fail validation. The validator bounds
metadata traversal; each descriptor supports at most 64 profiles and 64 components per profile.
Identifiers start with a lowercase letter and contain up to 128 lowercase letters, digits,
periods, underscores or hyphens.

## Execute behind separate interfaces

`ProtocolProvider<Abi = unknown>` is instantiated per chain/worker after selection. Its `profileId`
must equal the selected profile. The host enforces that binding and controls executable loading.

- `createShipSession(handshake)` creates a session for the advertised SHiP ABI and selected scalar
  interpretation. `encodeRequest`, `decodeResult`, `decodeBlock`, `decodeTraces`, `decodeDeltas`
  and `decodeRow(stream, bytes)` use portable values and `Uint8Array` inputs/outputs. Each method is
  synchronous; asynchronous module loading and transport remain host responsibilities.
  Sessions that retain resources can implement optional `close(): void`. It must release only
  that session's resources, be idempotent, and reject later encode/decode use. The host closes
  replaced sessions and temporary preflight sessions; closing one session cannot invalidate
  another session or contract codec. Stateless sessions need not implement `close`.
- `contractCodec` decodes/encodes complete binary contract ABIs and decodes/encodes typed values.
  Its generic `Abi` is portable metadata, preserving protocol-specific fields. An implementation
  must not expose a native decoder handle or convert through a lossy legacy ABI representation.
- `normalizeDelta(input, context)` receives the decoded value, original bytes, stream and presence
  flag. The host supplies chain/block/ordinal provenance and, when needed, the position-valid ABI
  deployment. It returns an explicit `passthrough`, an `ignore` with a reason, an `abi-required`
  request, or a normalized `record` with complete logical identity, record, source, table name
  and metadata.

Normalization must run before downstream handler filtering; unknown required streams/features
throw instead of silently disappearing. A normalized record's `source.abiDeployment` is mandatory.
The context's optional deployment exists because some system streams do not use a contract ABI.
For a contract-dependent stream, a provider can return `{kind: "abi-required", account}` when the
context has no applicable deployment. The account is the host's contract identifier for lookup;
it does not replace the record's complete raw physical identity. This keeps protocol-specific
stream/account extraction inside the provider. The host validates the account, selects a
position-bound deployment from its canonical view, then invokes normalization once more with that
deployment. A repeated request when a deployment was supplied must fail, without an unbounded
retry loop or mutation before binding. Missing historical metadata fails explicitly. The host owns
canonical/fork selection and interval validation; a provider must never substitute the head ABI.
An interval's `from` is inclusive and `until` is exclusive.

Complete logical record identity and raw replay metadata remain available independently from a
backend's physical document ID. The SDK exposes no database operations or native-library classes.
Legacy contract plugins still receive their established host payload; this protocol seam does not
replace `@eosrio/hyperion-plugin-core` or change declarative definitions/logical queries.

## Observe ABI source facts before filtering

The optional synchronous `observeBlockAbi(input, source)` hook is the additive contract for
[SDK #6](https://github.com/eosrio/hyperion-sdk/issues/6) and
[History API #213](https://github.com/eosrio/hyperion-history-api/issues/213). Existing providers
remain valid without the hook. An absent hook cannot authorize ABI applicability or projection
readiness.

`ProtocolBlockAbiInput` contains the full decoded `traces` and decoded `accountRows`. Each account
row retains its source `ordinal`, `present` flag, original `Uint8Array` bytes and portable decoded
`value`. `undefined` records missing input; an empty array records a genuinely empty source list.
The host calls the hook before whitelists, blacklists, root-action filtering, action truncation,
grouping or lossy numeric conversion. Capture native ABI mutations even when operators exclude
the system contract from indexed history.

The host supplies `ProtocolBlockAbiSource`: chain ID, block ID, block number and the preceding
block ID. `previousBlockId: null` explicitly records an unavailable predecessor, including an
initial snapshot envelope. It must not be replaced with an invented predecessor. Known IDs must
match the selected protocol's identifiers. The host binds the captured facts to the verified
provider profile/component pins and retained raw source; the provider does not declare canonical
membership, storage durability or readiness.

`ProtocolBlockAbiObservations` has `schemaVersion: 1` and three separate readonly lists:

| List | Source facts |
| --- | --- |
| `actionInputs` | Transaction/action occurrence, receiver, action account/name, exact `rawHex`, receipt `globalSequence` and `receiptAbiSequence`, and the originating `inputActionOrdinal` |
| `deployments` | Target account, exact `abiHex`, mutating action anchor, its receipt `globalSequence`, and `effect: "native-before-receipt"` |
| `finalStates` | Account presence and raw `abiHex` observed at block end, with the original `deltaOrdinal` |

`transactionId` plus `actionOrdinal` identifies an occurrence within the supplied block. Ordinals
are safe integers: action/input ordinals are positive; account/delta ordinals are nonnegative.
Allocation ordinals are not execution order. Sequence evidence uses canonical unsigned decimal
strings without leading zeros: `globalSequence` is in `[1, 18446744073709551615]`, while
`receiptAbiSequence` is in `[0, 4294967295]`. Compare sequence values without converting them to
JavaScript `Number`. Return action/deployment observations in numeric receipt execution order,
which can differ from their order in an allocation-ordered source array. Hexadecimal fields are
lowercase, even-length original bytes and may be empty. TypeScript declarations do not validate
these runtime constraints; the provider and capturing host must enforce them.

For the pinned Wire native handler, a first-receiver `sysio::setabi` changes the target ABI before
its own receipt. Retain empty, malformed, unsupported and byte-identical deployments as distinct
observations; ABI-body parsing is not required to capture a mutation. Notification copies do not
repeat the native mutation. Their `inputActionOrdinal` links to the original first receiver's
input, with matching account, name, authorization and raw bytes checked against the full source.
Reject missing/cyclic ancestry, duplicate occurrence ordinals, and duplicate/zero receipt sequences.
Retain source-backed onblock actions. Unsupported transaction-status, failure or scheduled-action
semantics must fail extraction rather than guessing that a mutation committed.

A receipt samples ABI metadata after native execution. In particular, self-setabi can expose its
new sequence on the receipt while its action input precedes the mutation. Receipt sequence equality
does not prove the applicable input ABI. A final account row describes block-end state and cannot
select the ABI for an earlier action in that block. Neither list establishes canonical continuity
or a usable ABI interval. A snapshot at the end of block S cannot prove inputs before or within S.

Missing required input, malformed source data or unsupported semantics must throw. The host keeps
the raw source and durably records incomplete extraction; failure must never become a successful
empty observation. Returned facts must be detached from mutable input objects. The host snapshots
and validates them before persistence and source acknowledgment. Canonical coverage, recovery,
fork generations and ABI applicability remain runtime responsibilities, outside this SDK hook.
Capturing observations alone must not enable action decoding or remove an unavailable response.
Existing retained Elasticsearch history stays usable; this separate projection does not require
a full history reindex.

## Versioning and evidence

SDK package version, metadata schema version and protocol `interfaceVersion` remain separate.
This is private `0.0.0-dev.1` work consumed by exact source pins. Released SDK contracts preserve
compatibility within a major and require a new major for breaking changes. Executable upgrades
remain operator initiated. Host fixtures establish execution behavior; these SDK checks alone
establish only metadata validation and portable exported declarations.
