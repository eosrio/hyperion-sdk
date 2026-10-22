import {
  validateProtocolNativeActionObservations as rootFactsValidator,
  type ProtocolNativeActionObservations as RootObservations,
} from '@eosrio/hyperion-sdk';
import {
  validateProtocolNativeActionObservations, validateProtocolNativeActions, validateProtocolSelection,
  type ProtocolDescriptor, type ProtocolNativeActionBlockInput, type ProtocolNativeActionDecision,
  type ProtocolNativeActionOrigin, type ProtocolNativeActions, type ProtocolProvider,
} from '@eosrio/hyperion-sdk/protocol';

const source = {chainId: 'a'.repeat(64), blockId: 'b'.repeat(64), blockNum: 12, previousBlockId: 'c'.repeat(64)};
const input: ProtocolNativeActionBlockInput = {
  schemaJson: '{"consumer":"original formatting"}', block: new Uint8Array([7]), traces: new Uint8Array([1, 2]),
};
const origin: ProtocolNativeActionOrigin = {transactionId: 'd'.repeat(64), actionOrdinal: 3, rawSha256: 'e'.repeat(64)};
const facts: RootObservations = {schemaVersion: 1, decisions: [{origin, kind: 'native', nativeKind: 'consumer-envelope-v1'}]};
const nativeActions: ProtocolNativeActions = {
  interfaceVersion: 1,
  observe(retained, position) {
    if (retained.schemaJson !== input.schemaJson || retained.block[0] !== 7 || retained.traces.length !== 2
      || position.blockId !== source.blockId) throw new Error('Original consumer input changed');
    return facts;
  },
  decodeValue(kind, bytes) {
    if (kind !== 'consumer-envelope-v1' || bytes.length !== 2) throw new Error('Wrong native source');
    return {payload: Array.from(bytes)};
  },
  encodeValue(kind, value) {
    if (kind !== 'consumer-envelope-v1' || typeof value !== 'object' || value === null || !('payload' in value)
      || !Array.isArray(value.payload) || value.payload.length !== 2) throw new Error('Wrong native value');
    return new Uint8Array(value.payload);
  },
};
const provider: ProtocolProvider = {
  profileId: 'consumer', nativeActions,
  contractCodec: {
    decodeAbi() {throw new Error('Contract ABI used by native consumer');},
    encodeAbi() {throw new Error('Contract ABI used by native consumer');},
    decodeValue() {throw new Error('Contract ABI used by native consumer');},
    encodeValue() {throw new Error('Contract ABI used by native consumer');},
  },
  createShipSession: () => ({encodeRequest: () => new Uint8Array(), decodeResult: () => ({}), decodeBlock: () => ({}),
    decodeTraces: () => [], decodeDeltas: () => [], decodeRow: () => ({})}),
  normalizeDelta: item => ({kind: 'passthrough', value: item.value}),
};
const component = {id: 'consumer', runtime: 'node' as const, version: '0.0.0-dev.1',
  sourceRevision: 'f'.repeat(40), sha256: '1'.repeat(64)};
const descriptor: ProtocolDescriptor = {interfaceVersion: 1,
  manifest: {schemaVersion: 1, package: '@example/native-consumer', version: '0.0.0-dev.1', kind: 'protocol',
    compatibility: {hyperion: '^4.5.0-dev.1', sdk: '^0.0.0-dev.1'}},
  profiles: [{id: 'consumer', components: [component], nativeActions: {interfaceVersion: 1}}]};
const selection = {profileId: 'consumer', components: [component],
  environment: {hyperion: '4.5.0-dev.1', sdk: '0.0.0-dev.1'}};
if (validateProtocolSelection(descriptor, selection).valid) throw new Error('Implicit host capability granted');
const selected = validateProtocolSelection(descriptor, {...selection, nativeActionInterfaceVersions: [1]});
if (!selected.valid || !selected.profile.nativeActions) throw new Error('Native interface negotiation failed');
const checked = validateProtocolNativeActions(provider.nativeActions, selected.profile.nativeActions);
if (!checked.valid) throw new Error('Runtime capability mismatch');
const observed = checked.nativeActions.observe(input, source);
const validated = validateProtocolNativeActionObservations(observed);
if (!validated.valid || rootFactsValidator !== validateProtocolNativeActionObservations) throw new Error('Portable native facts missing');
const encoded = checked.nativeActions.encodeValue('consumer-envelope-v1',
  checked.nativeActions.decodeValue('consumer-envelope-v1', input.traces));
if (encoded.length !== input.traces.length || encoded.some((byte, index) => byte !== input.traces[index])) {
  throw new Error('Native consumer lost original bytes');
}
// Detached labels are not source proof: the host must match origin/raw digest and fork authority.
if (validated.observations.decisions[0]?.origin.actionOrdinal !== 3) throw new Error('First-receiver origin lost');

function declarationChecks(): void {
  // @ts-expect-error Native interface version is independently fixed.
  const version: ProtocolNativeActions = {...nativeActions, interfaceVersion: 2};
  // @ts-expect-error Original trace bytes are required.
  const missing: ProtocolNativeActionBlockInput = {...input, traces: null};
  // @ts-expect-error Original raw sections are portable bytes, not number arrays.
  const array: ProtocolNativeActionBlockInput = {...input, block: [7]};
  // @ts-expect-error Native observations remain synchronous detached data.
  const deferred: ProtocolNativeActions['observe'] = async () => facts;
  // @ts-expect-error Raw digest is required independently from action identity.
  const noDigest: ProtocolNativeActionOrigin = {transactionId: origin.transactionId, actionOrdinal: 3};
  // @ts-expect-error A contract decision cannot claim a native kind.
  const contract: ProtocolNativeActionDecision = {origin, kind: 'contract', nativeKind: 'hidden'};
  // @ts-expect-error Incomplete work must retain an explicit reason.
  const incomplete: ProtocolNativeActionDecision = {origin, kind: 'incomplete'};
  // @ts-expect-error Detached native labels cannot grant canonical authority.
  facts.canonical = true;
  // @ts-expect-error Consumers cannot rewrite retained observations.
  facts.decisions.push({origin, kind: 'contract'});
  void version; void missing; void array; void deferred; void noDigest; void contract; void incomplete;
}
void declarationChecks;
