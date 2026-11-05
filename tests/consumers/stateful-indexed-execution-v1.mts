import {STATEFUL_INDEXED_EXECUTION_FAMILY_V1,createIndexedExecutionObserverV1,negotiateIndexedExecutionV1,
 composeStatefulOwnerIndexedExecutionV1,serializeIndexedExecutionResultV1,assertIndexedExecutionPublicationV1,
 type IndexedExecutionResultV1,type IndexedExecutionObserverPortV1,type IndexedExecutionSelectionV1,
 type IndexedExecutionAdapterV1,type IndexedExecutionOfferV1} from '@eosrio/hyperion-sdk/projection-stateful-indexed-execution-v1';
import type {IndexedResultV1} from '@eosrio/hyperion-sdk/projection-stateful-indexed-query-v1';
import type {StatefulOwnerIdentityV2} from '@eosrio/hyperion-sdk/projection-stateful-owner-v2';
import type {StatefulGuard,StatefulView} from '@eosrio/hyperion-sdk/projection-stateful';
const exact:IndexedResultV1={kind:'count',exact:true,value:'9007199254740993'};
const result:IndexedExecutionResultV1={kind:'result',result:exact};
// The old closed family does not accept the new envelope or semantic outcomes.
// @ts-expect-error the independent family never widens SDK49's union
const legacy:IndexedResultV1={kind:'outcome',code:'execution-error',profile:'controlled'};
async function host(selection:IndexedExecutionSelectionV1,offer:IndexedExecutionOfferV1,port:IndexedExecutionObserverPortV1,
 adapter:IndexedExecutionAdapterV1,identity:StatefulOwnerIdentityV2,view:StatefulView,guard:StatefulGuard){
 const observer=createIndexedExecutionObserverV1(selection,offer,port);
 const completed=await composeStatefulOwnerIndexedExecutionV1(selection,adapter,observer,identity,view,
  async read=>({result:await read.query({kind:'count',exact:true,where:[]})}),guard);
 assertIndexedExecutionPublicationV1(completed);return serializeIndexedExecutionResultV1(completed);
}
if(STATEFUL_INDEXED_EXECUTION_FAMILY_V1!=='stateful-owner-indexed-execution'||result.result.kind!=='count'||result.result.value!=='9007199254740993'||typeof host!=='function'||typeof negotiateIndexedExecutionV1!=='function')throw Error('execution exports');
