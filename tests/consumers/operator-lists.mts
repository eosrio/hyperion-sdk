import {negotiateOperatorListsV1, readOperatorListsV1, type OperatorListCapabilitiesV1, type OperatorListProviderV1} from '@eosrio/hyperion-sdk/operator-lists';
const limits={names:2,items:2,bytes:100,attempts:1};
const capabilities: OperatorListCapabilitiesV1={family:'operator-list-read',interfaceVersion:1,limits};
const provider: OperatorListProviderV1={capabilities, async read(names) {return {source:'s',generation:'g',complete:true,attempts:1,entries:names.map(name=>({name,items:[]}))};}};
const value=await readOperatorListsV1(negotiateOperatorListsV1(limits,capabilities,capabilities),provider,['missing'],'s','g',()=>{});
if(value.entries[0]?.items.length!==0) throw Error('missing list');
