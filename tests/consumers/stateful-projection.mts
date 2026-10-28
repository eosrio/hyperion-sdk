import {STATEFUL_FAMILY, STATEFUL_HOST_CAPABILITIES, STATEFUL_ADAPTER_CAPABILITIES,
  negotiateStatefulProjection, canonicalStatefulRecord, type StatefulDefinition,
  type StatefulLimits, type StatefulAdapter, type StatefulCandidateStore,
  type StatefulQueryHost, type StatefulQueryResult} from '@eosrio/hyperion-sdk/projection-stateful';
const limits: StatefulLimits = {value: {depth: 16, nodes: 1000, fields: 8, arrayElements: 32, stringBytes: 1024,
  recordBytes: 4096, integerFields: 4, pathSegments: 8},
  envelope: {depth: 32, nodes: 10000, fields: 64, arrayElements: 64, stringBytes: 4096,
    recordBytes: 65536, integerFields: 4, pathSegments: 8}, selectors: 4, recordKinds: 4, inputOccurrences: 32,
  inputBytes: 4096, keyBytes: 128, readKeys: 8, readAttempts: 16, mutations: 32,
  candidateBytes: 65536, responseRecords: 8, responseBytes: 32768};
const definition: StatefulDefinition = {family: STATEFUL_FAMILY, interfaceVersion: 1, id: 'packed-development',
  binding: {chainId:'a'.repeat(64),backendId:'memory',generation:'genesis',mappingRevision:'b'.repeat(64),
    hookArtifact:'c'.repeat(64),hookRevision:'d'.repeat(64),codecRevision:'e'.repeat(64),normalizerRevision:'f'.repeat(64)},
  selectors:[{id:'one',kind:'table',contract:'fixture',name:'rows',abiDeployment:'epoch',abiSha256:'1'.repeat(64)}],
  records:[{kind:'row',integers:[{path:['id'],type:'uint64',vector:false}]}]};
const host={family:STATEFUL_FAMILY,interfaceVersion:1,supported:STATEFUL_HOST_CAPABILITIES,limits};
const adapter={family:STATEFUL_FAMILY,interfaceVersion:1,supported:STATEFUL_ADAPTER_CAPABILITIES,limits};
const declaration=await negotiateStatefulProjection(definition,limits,host,adapter);
if(canonicalStatefulRecord(declaration,'row',{id:'18446744073709551615',text:'a\0b'}).value.id!=='18446744073709551615')
  throw new Error('Packed stateful value contract missing');
let rejected=false;try{await negotiateStatefulProjection(definition,limits,host,{...adapter,supported:[]});}catch{rejected=true;}
if(!rejected)throw new Error('Packed missing stateful capability was accepted');
const implementation: StatefulAdapter|null=null, custody: StatefulCandidateStore|null=null;
void implementation;void custody;
// Type-only domain/host boundary. No source authority or HTTP implementation is supplied here.
async function composeDomain(query: StatefulQueryHost): Promise<StatefulQueryResult> {
  return query.compose('packed-development', async reader => {
    const row = await reader.get('row', 'one');
    return {row: row.status === 'present' ? row.value : null};
  });
}
void composeDomain;
