import type {
  ProtocolBlockAbiObservations as RootObservations,
  ProtocolNativeGenesisFacts as RootGenesisFacts,
  ProtocolNativeGenesisInput as RootGenesisInput,
} from '@eosrio/hyperion-sdk';
import type {
  ProtocolAbiActionInput,
  ProtocolBlockAbiInput,
  ProtocolBlockAbiObservations,
  ProtocolBlockAbiSource,
  ProtocolNativeGenesisFacts,
  ProtocolNativeGenesisInput,
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
if (legacyProvider.verifyNativeGenesis !== undefined) throw new Error('Legacy provider gained a required genesis hook');

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

const genesisSource: ProtocolBlockAbiSource = {...source, blockNum: 1};
const genesisInput: RootGenesisInput = {
  schemaJson: '{"consumerFixture":true}', block: new Uint8Array([1]), traces: null,
  deltas: new Uint8Array([2]),
};
const genesisProvider: ProtocolProvider = {
  ...provider,
  verifyNativeGenesis(input, block) {
    if (input.traces !== null || block.blockNum !== 1 || block.previousBlockId !== null) {
      throw new Error('Wrong native genesis consumer source');
    }
    if (input.schemaJson !== genesisInput.schemaJson || input.block[0] !== 1 || input.deltas[0] !== 2) {
      throw new Error('Retained native genesis sections changed');
    }
    // Portable consumer facts only; native protocol verification belongs to the selected extension.
    return {
      schemaVersion: 1, previousBlockId: '0'.repeat(64), applicationState: 'empty',
      abiStates: [
        {account: 'sysio', present: true, abiHex: '0102', deltaOrdinal: 0},
        {account: 'sysio.null', present: true, abiHex: '', deltaOrdinal: 1},
        {account: 'sysio.prods', present: true, abiHex: '', deltaOrdinal: 2},
      ],
    };
  },
};
const genesisFacts: RootGenesisFacts = genesisProvider.verifyNativeGenesis!(genesisInput, genesisSource);
const genesisRoundTrip = JSON.parse(JSON.stringify(genesisFacts)) as ProtocolNativeGenesisFacts;
const retainedInput: ProtocolNativeGenesisInput = genesisInput;
if (genesisRoundTrip.schemaVersion !== 1 || genesisRoundTrip.previousBlockId !== '0'.repeat(64)
  || genesisRoundTrip.applicationState !== 'empty' || genesisRoundTrip.abiStates.length !== 3
  || genesisRoundTrip.abiStates[0]?.abiHex !== '0102'
  || !genesisRoundTrip.abiStates[1]?.present || genesisRoundTrip.abiStates[1]?.abiHex !== ''
  || genesisRoundTrip.abiStates[2]?.account !== 'sysio.prods'
  || genesisRoundTrip.abiStates[2]?.deltaOrdinal !== 2) throw new Error('Native genesis facts lost source evidence');
if (genesisSource.previousBlockId !== null || retainedInput.traces !== null) {
  throw new Error('Native genesis rewrote an absent source field');
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

function genesisDeclarationChecks(facts: ProtocolNativeGenesisFacts): void {
  // @ts-expect-error Encoded empty traces are not an absent trace section.
  const encodedTraces: ProtocolNativeGenesisInput = {...genesisInput, traces: new Uint8Array([0])};
  // @ts-expect-error Missing source must be explicitly represented by null.
  const missingTraces: ProtocolNativeGenesisInput = {schemaJson: '{}', block: new Uint8Array(), deltas: new Uint8Array()};
  // @ts-expect-error Native genesis requires a known actual header predecessor.
  const missingParent: ProtocolNativeGenesisFacts = {...facts, previousBlockId: null};
  // @ts-expect-error Only the versioned native genesis facts shape is supported.
  const wrongVersion: ProtocolNativeGenesisFacts = {...facts, schemaVersion: 2};
  // @ts-expect-error Native genesis cannot claim arbitrary application-state coverage.
  const unknownApplication: ProtocolNativeGenesisFacts = {...facts, applicationState: 'unknown'};
  // @ts-expect-error ABI states retain their original account-row ordinal.
  const missingOrdinal: ProtocolNativeGenesisFacts = {...facts, abiStates: [{account: 'sysio', present: true, abiHex: ''}]};
  // @ts-expect-error Genesis verification is synchronous, not a deferred provider assertion.
  const asyncHook: NonNullable<ProtocolProvider['verifyNativeGenesis']> = async () => facts;
  // @ts-expect-error Native genesis ABI states are immutable observations.
  facts.abiStates[0]!.abiHex = 'ff';
  // @ts-expect-error Native genesis facts expose no readiness authority.
  facts.ready = true;
  void encodedTraces;
  void missingTraces;
  void missingParent;
  void wrongVersion;
  void unknownApplication;
  void missingOrdinal;
  void asyncHook;
}
void genesisDeclarationChecks;
