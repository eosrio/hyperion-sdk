import type {ProtocolBlockAbiObservations as RootObservations} from '@eosrio/hyperion-sdk';
import type {
  ProtocolAbiActionInput,
  ProtocolBlockAbiInput,
  ProtocolBlockAbiObservations,
  ProtocolBlockAbiSource,
  ProtocolProvider,
} from '@eosrio/hyperion-sdk/protocol';

// An existing provider remains a valid consumer without the optional observation hook.
const legacyProvider: ProtocolProvider = {
  profileId: 'example',
  contractCodec: {
    decodeAbi: bytes => ({bytes: Array.from(bytes)}), encodeAbi: () => new Uint8Array(),
    decodeValue: () => ({}), encodeValue: () => new Uint8Array(),
  },
  createShipSession: () => ({
    encodeRequest: () => new Uint8Array(), decodeResult: () => ({}), decodeBlock: () => ({}),
    decodeTraces: () => [], decodeDeltas: () => [], decodeRow: () => ({}),
  }),
  normalizeDelta: input => ({kind: 'passthrough', value: input.value}),
};
if (legacyProvider.observeBlockAbi !== undefined) throw new Error('Legacy provider gained a required hook');

const source: ProtocolBlockAbiSource = {
  chainId: 'a'.repeat(64), blockId: 'b'.repeat(64), previousBlockId: null, blockNum: 12,
};
const transactionId = 'c'.repeat(64);
const actionInput: ProtocolAbiActionInput = {
  transactionId, actionOrdinal: 3, receiver: 'sysio', account: 'sysio', name: 'setabi',
  rawHex: '07000000', globalSequence: '9007199254740993', receiptAbiSequence: '4294967295',
  inputActionOrdinal: 3,
};
const provider: ProtocolProvider = {
  ...legacyProvider,
  observeBlockAbi(input, block) {
    if (input.traces === undefined || input.accountRows === undefined) throw new Error('Missing source');
    if (!Array.isArray(input.traces)) throw new Error('Unsupported consumer fixture');
    if (block.blockId !== source.blockId) throw new Error('Wrong source');
    // This consumer fixture supplies already-observed action facts, not chain-specific extraction.
    const actionInputs = input.traces as ProtocolAbiActionInput[];
    return {
      schemaVersion: 1,
      actionInputs,
      // Malformed and empty ABI bytes remain representable facts, independent from codec parsing.
      deployments: actionInputs.map(action => ({account: 'target', abiHex: 'ff',
        action: {transactionId: action.transactionId, actionOrdinal: action.actionOrdinal},
        globalSequence: action.globalSequence, effect: 'native-before-receipt'})),
      finalStates: input.accountRows.map(row => ({account: 'target', present: row.present,
        abiHex: '', deltaOrdinal: row.ordinal})),
    };
  },
};
const input: ProtocolBlockAbiInput = {
  traces: [actionInput], accountRows: [{ordinal: 0, present: true, raw: new Uint8Array([0]), value: {abi: ''}}],
};
const observations: RootObservations = provider.observeBlockAbi!(input, source);
const roundTrip = JSON.parse(JSON.stringify(observations)) as ProtocolBlockAbiObservations;
if (roundTrip.actionInputs[0]?.globalSequence !== '9007199254740993'
  || roundTrip.actionInputs[0]?.receiptAbiSequence !== '4294967295'
  || roundTrip.deployments[0]?.effect !== 'native-before-receipt'
  || roundTrip.deployments[0]?.abiHex !== 'ff'
  || roundTrip.finalStates[0]?.abiHex !== '') throw new Error('Portable ABI facts lost evidence');
if (source.previousBlockId !== null) throw new Error('Unknown predecessor was invented');
let missingInputRejected = false;
try { provider.observeBlockAbi!({traces: undefined, accountRows: undefined}, source); }
catch { missingInputRejected = true; }
if (!missingInputRejected) throw new Error('Missing source became empty facts');
const empty = provider.observeBlockAbi!({traces: [], accountRows: []}, source);
if (empty.actionInputs.length || empty.deployments.length || empty.finalStates.length) {
  throw new Error('Empty source did not remain empty');
}

// Compile-only assertions exercise the declarations exported by the installed tarball.
function declarationChecks(facts: ProtocolBlockAbiObservations): void {
  // @ts-expect-error Sequence evidence must remain a decimal string, never a Number.
  const lossy: ProtocolAbiActionInput = {...actionInput, globalSequence: 9007199254740993};
  // @ts-expect-error Existing facts cannot be rewritten through the public declaration.
  facts.finalStates[0]!.abiHex = 'ff';
  // @ts-expect-error Lists expose immutable observations.
  facts.actionInputs.push(actionInput);
  // @ts-expect-error A predecessor must be explicitly known or null, not silently omitted.
  const unbound: ProtocolBlockAbiSource = {chainId: source.chainId, blockId: source.blockId, blockNum: 12};
  // @ts-expect-error Observations expose no canonical readiness authority.
  facts.ready = true;
  void lossy;
  void unbound;
}
void declarationChecks;
