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
- `contractCodec` decodes/encodes complete binary contract ABIs and decodes/encodes typed values.
  Its generic `Abi` is portable metadata, preserving protocol-specific fields. An implementation
  must not expose a native decoder handle or convert through a lossy legacy ABI representation.
- `normalizeDelta(input, context)` receives the decoded value, original bytes, stream and presence
  flag. The host supplies chain/block/ordinal provenance and, when needed, the position-valid ABI
  deployment. It returns an explicit `passthrough`, an `ignore` with a reason, or a normalized
  `record` with complete logical identity, record, source, table name and metadata.

Normalization must run before downstream handler filtering; unknown required streams/features
throw instead of silently disappearing. A normalized record's `source.abiDeployment` is mandatory.
The context's optional deployment exists because some system streams do not use a contract ABI.
Contract-dependent streams must fail explicitly without their applicable deployment. The host
owns canonical/fork selection and interval validation; a provider must never substitute the head
ABI for missing historical metadata. An interval's `from` is inclusive and `until` is exclusive.

Complete logical record identity and raw replay metadata remain available independently from a
backend's physical document ID. The SDK exposes no database operations or native-library classes.
Legacy contract plugins still receive their established host payload; this protocol seam does not
replace `@eosrio/hyperion-plugin-core` or change declarative definitions/logical queries.

## Versioning and evidence

SDK package version, metadata schema version and protocol `interfaceVersion` remain separate.
This is private `0.0.0-dev.1` work consumed by exact source pins. Released SDK contracts preserve
compatibility within a major and require a new major for breaking changes. Executable upgrades
remain operator initiated. Host fixtures establish execution behavior; these SDK checks alone
establish only metadata validation and portable exported declarations.
