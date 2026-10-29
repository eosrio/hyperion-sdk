import {captureStatefulDeclaration, type StatefulLimits} from '@eosrio/hyperion-sdk/projection-stateful';
import {captureStatefulOwnerDeclarationV2, captureStatefulRawTargetV2,
  type StatefulOwnerLeaseV2, type StatefulOwnerAdapterV2} from '@eosrio/hyperion-sdk/projection-stateful-owner-v2';
import {captureStatefulSourceV2, negotiateStatefulActionMetadataV2, STATEFUL_ACTION_AUTHORIZATION_CAPABILITY_V1,
  type StatefulInputV2, type StatefulActionAuthorizationV1} from '@eosrio/hyperion-sdk/projection-stateful-source-v2';
const hash = (n: number) => String(n).padStart(64, '0');
const bounds: StatefulLimits = {value:{depth:32,nodes:10000,fields:64,arrayElements:100,stringBytes:65536,recordBytes:262144,integerFields:8,pathSegments:16},
  envelope:{depth:48,nodes:100000,fields:64,arrayElements:2000,stringBytes:2097152,recordBytes:4194304,integerFields:8,pathSegments:16},
  selectors:8,recordKinds:8,inputOccurrences:100,inputBytes:1048576,keyBytes:1024,readKeys:32,readAttempts:128,mutations:100,
  candidateBytes:4194304,responseRecords:32,responseBytes:4194304};
const projection = await captureStatefulDeclaration({family:'stateful-projection-recovery',interfaceVersion:1,id:'packed-owner',
  binding:{chainId:hash(1),backendId:'packed',generation:'one',mappingRevision:hash(2),hookArtifact:hash(3),hookRevision:hash(4),codecRevision:hash(5),normalizerRevision:hash(6)},
  selectors:[{id:'changes',kind:'table',contract:'fixture',name:'changes',abiDeployment:'one',abiSha256:hash(7)}],records:[{kind:'asset',integers:[]}]},bounds);
const declaration = await captureStatefulOwnerDeclarationV2(projection,2);
const previous = {declarationDigest:declaration.digest,backendId:'packed',generation:'one',revision:hash(8),checkpoint:{blockNum:0,blockId:hash(0)}};
const target = await captureStatefulRawTargetV2(declaration,{schemaVersion:2,chainId:hash(1),declarationDigest:declaration.digest,owner:{id:'worker',generation:'one'},previous,
  block:{blockNum:1,blockId:hash(9),previousBlockId:hash(0)},rawSource:{commitId:'commit',selectionId:'selection',observationId:'observation',observationDigest:hash(10)}});
const source = await captureStatefulSourceV2(declaration,{previous:previous.checkpoint,block:{...target.target.block,timeMs:'1'},inputs:[]});
if (source.sourceInputVersion !== 2 || declaration.projection !== projection || declaration.digest === projection.digest) throw new Error('Packed v2 binding differs');
const metadata=negotiateStatefulActionMetadataV2([STATEFUL_ACTION_AUTHORIZATION_CAPABILITY_V1],[STATEFUL_ACTION_AUTHORIZATION_CAPABILITY_V1]);
const marked=await captureStatefulSourceV2(declaration,{...source.source,...metadata});
if(marked.source.actionMetadataVersion!==1 || marked.digest===source.digest)throw new Error('Packed action metadata selection missing');
const permission:StatefulActionAuthorizationV1={actor:'fixture',permission:'active'};
void permission;
type TableInput = Extract<StatefulInputV2,{kind:'table'}>;
const identity: TableInput['identity'] = {kind:'kv-primary',tableId:0,keyHex:'0000'};
if ('scope' in identity) throw new Error('Invented scope');
// @ts-expect-error an inert DTO is not an issued owner lease
const forged: StatefulOwnerLeaseV2 = {};
const adapterType = (adapter: StatefulOwnerAdapterV2) => adapter.recovery();
void forged; void adapterType;
