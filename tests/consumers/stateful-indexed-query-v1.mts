import {STATEFUL_INDEXED_QUERY_FAMILY_V1, type IndexedRequestV1, type IndexedOfferV1} from '@eosrio/hyperion-sdk/projection-stateful-indexed-query-v1';
const count: IndexedRequestV1 = {kind:'count',where:[],exact:true};
const offer: IndexedOfferV1 = {family:STATEFUL_INDEXED_QUERY_FAMILY_V1,interfaceVersion:1,queryDeclarationDigests:[],comparisonProfiles:[],limits:{readAttempts:1,responseRecords:1,responseBytes:1,queryBytes:1,predicates:0,orderTerms:1,setValues:0}};
if(count.kind!=='count'||offer.family!=='stateful-owner-indexed-query')throw new Error('indexed exports');
