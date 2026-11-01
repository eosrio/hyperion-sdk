import {STATEFUL_INDEXED_QUERY_FAMILY_V1, composeStatefulOwnerIndexedReadV1, assertIndexedQueryPublicationV1,
 serializeIndexedQueryResultV1, type IndexedRequestV1, type IndexedOfferV1, type IndexedOwnerAdapterV1,
 type IndexedAdapterV1, type IndexedSelectionV1} from '@eosrio/hyperion-sdk/projection-stateful-indexed-query-v1';
import type {StatefulOwnerIdentityV2} from '@eosrio/hyperion-sdk/projection-stateful-owner-v2';
import type {StatefulView, StatefulGuard} from '@eosrio/hyperion-sdk/projection-stateful';
const count: IndexedRequestV1 = {kind:'count',where:[],exact:true};
const offer: IndexedOfferV1 = {family:STATEFUL_INDEXED_QUERY_FAMILY_V1,interfaceVersion:1,queryDeclarationDigests:[],comparisonProfiles:[],limits:{readAttempts:1,responseRecords:1,responseBytes:1,queryBytes:1,predicates:0,orderTerms:1,setValues:0}};
if(count.kind!=='count'||offer.family!=='stateful-owner-indexed-query')throw new Error('indexed exports');
// Existing four-argument, single-model implementations remain source-compatible.
const fourArguments:IndexedAdapterV1={async queryCompleted(_read,view,_request,_remaining){
 return {view,queryDeclarationDigest:'a'.repeat(64),result:{kind:'count',exact:true,value:'9007199254740993'},attempts:1};
}};
async function installedHost(selection:IndexedSelectionV1,adapter:IndexedOwnerAdapterV1,identity:StatefulOwnerIdentityV2,view:StatefulView,guard:StatefulGuard){
 const result=await composeStatefulOwnerIndexedReadV1(selection,adapter,identity,view,async read=>({result:await read.query(count)}),guard);
 assertIndexedQueryPublicationV1(result);return serializeIndexedQueryResultV1(result);
}
if(typeof installedHost!=='function'||fourArguments.queryCompleted.length!==4)throw new Error('indexed runtime declarations');
