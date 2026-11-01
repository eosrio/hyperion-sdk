// Scripted finite native query windows, not an engine, a planner, a scan or a collation oracle.
import assert from 'node:assert/strict';
import * as sdk from '../../dist/projection-stateful-indexed-query-v1.js';
import * as owner from '../../dist/projection-stateful-owner-v2.js';
import * as base from '../../dist/projection-stateful.js';
import {CompleteKindReference} from './stateful-complete-kind-reference.mjs';
import {definition, limits} from './stateful-reference.mjs';

const copy=value=>structuredClone(value);
const signature=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.entries(item).sort(([left],[right])=>left<right?-1:left>right?1:0)):item);
export const indexedLimits=()=>({readAttempts:12,responseRecords:8,responseBytes:65536,queryBytes:8192,predicates:12,orderTerms:8,setValues:16});
export const model=()=>({id:'finite-schema',base:{alias:'schema',kind:'schema'},joins:[
 {alias:'collection',kind:'collection',mode:'inner-one',on:[{basePath:['contract'],joinedPath:['contract']},{basePath:['collection'],joinedPath:['collection']}]},
 {alias:'assets',kind:'config',mode:'left-one',on:[{basePath:['contract'],joinedPath:['contract']},{basePath:['collection'],joinedPath:['collection']},{basePath:['name'],joinedPath:['schema']}]}
],fields:[
 {id:'contract',alias:'schema',path:['contract'],type:'text',nullable:false,operators:['eq','in','not-in']},
 {id:'schema',alias:'schema',path:['name'],type:'text',nullable:false,operators:['eq','in','not-in','gte','gt','lt','text-contains']},
 {id:'created',alias:'schema',path:['created'],type:'int64',nullable:false,operators:['eq','gte','gt','lt']},
 {id:'authorized',alias:'collection',path:['authorized'],type:'text-vector',nullable:false,operators:['array-contains']},
 {id:'assets',alias:'assets',path:['total'],type:'int64',nullable:true,operators:[]}
],textComparison:'controlled-only-v1',orders:[[{field:'created',direction:'desc',nulls:'last'},{field:'schema',direction:'asc',nulls:'last'}],
 [{field:'assets',direction:'asc',nulls:'last'},{field:'schema',direction:'asc',nulls:'last'}]]});
export const page=(changes={})=>({kind:'page',where:[{field:'contract',op:'eq',value:'fixture'}],order:model().orders[0],offset:'0',limit:2,
 select:['schema','created','authorized','assets'],records:['schema','collection','assets'],...changes});
export const count=(changes={})=>({kind:'count',where:[{field:'contract',op:'eq',value:'fixture'}],exact:true,...changes});
export const row=(key='schema-one',assets=null)=>({key,fields:{schema:key,created:'9007199254740993',authorized:['alice','雪'],assets:assets===null?null:assets},
 records:{schema:{contract:'fixture',collection:'collection-one',name:key,created:'9007199254740993',format:[{name:'author',type:'string'}]},
 collection:{contract:'fixture',collection:'collection-one',authorized:['alice','雪'],data:{name:'雪\n"\\'}},
 assets:assets===null?null:{contract:'fixture',collection:'collection-one',schema:key,total:assets}}});
export const pageResult=(rows=[row()])=>({kind:'page',complete:true,rows});
export const offer=(declarations,bounds=indexedLimits())=>({family:sdk.STATEFUL_INDEXED_QUERY_FAMILY_V1,interfaceVersion:1,
 queryDeclarationDigests:declarations.map(d=>d.digest),comparisonProfiles:['controlled-only-v1'],limits:bounds});
const ownerOffer=(supported,bounds)=>({family:owner.STATEFUL_OWNER_FAMILY_V2,interfaceVersion:2,sourceInputVersions:[2],supported,limits:bounds});
const unavailable=message=>{throw new base.StatefulContractError('stateful.unavailable',message);};

/** Issuance/owner validation is inherited from the same controlled owner adapter as legacy tests. */
export class IndexedReference extends CompleteKindReference {
 constructor(declaration,queryDeclaration,bounds){
  super(declaration);this.queryDeclarations=new Map([[queryDeclaration.digest,queryDeclaration]]);
  this.indexedCapabilities=offer([queryDeclaration],bounds);this.plans=new Map();this.queryCalls=0;this.nativeAttempts=0;
  this.remaining=[];this.answered=[];this.flags={cancelled:false,expired:false,fork:false,mapping:false,coverage:false};
  const originalGuard=this.guard;
  this.guard=()=>{originalGuard();for(const [name,invalid] of Object.entries(this.flags))if(invalid)unavailable('Retained '+name+' authority refused');};
 }
 addDeclaration(declaration){this.queryDeclarations.set(declaration.digest,declaration);this.indexedCapabilities=offer([...this.queryDeclarations.values()],this.indexedCapabilities.limits);}
 plan(request,result=pageResult(),attempts=1,declaration=[...this.queryDeclarations.values()][0]){
  this.plans.set(signature([declaration.digest,request]),{result:copy(result),attempts});return this;
 }
 async queryCompleted(read,expected,request,remaining,selected){
  this.use(read,expected);this.queryCalls++;this.remaining.push(copy(remaining));
  if(!selected){if(this.queryDeclarations.size!==1)unavailable('Ambiguous model without selected declaration');selected=[...this.queryDeclarations.values()][0];}
  const qualified=this.queryDeclarations.get(selected.digest);if(!qualified)unavailable('Unqualified indexed declaration');
  assert.deepEqual(copy(selected),copy(qualified));assert.equal(selected.ownerDeclarationDigest,this.declaration.digest);
  assert.equal(Object.isFrozen(request),true);assert.equal(Object.isFrozen(remaining),true);
  const plan=this.plans.get(signature([selected.digest,request]));if(!plan)unavailable('No qualified native access path for this request');
  if(this.beforeQuery)await this.beforeQuery(read,request,remaining,selected);
  this.use(read,expected);
  for(let attempt=1;attempt<=plan.attempts;attempt++){
   if(attempt>remaining.readAttempts)unavailable('Native data attempt budget before retry or cursor advance');
   this.use(read,expected);this.nativeAttempts++;await Promise.resolve();this.use(read,expected);
  }
  const result=copy(plan.result),records=result.kind==='count'?1:result.rows.length;
  if(records>remaining.responseRecords)unavailable('Native response record budget before completion');
  const answer={view:copy(expected),queryDeclarationDigest:selected.digest,result,attempts:plan.attempts};
  if(Buffer.byteLength(JSON.stringify(answer))>remaining.responseBytes)unavailable('Native envelope byte budget');
  if(this.beforeAnswer)await this.beforeAnswer(answer,read,request,selected);
  if(!this.dishonest)this.use(read,expected);this.answered.push(answer);return answer;
 }
}

export async function prepared(requested=indexedLimits(),ownerBounds=limits()){
 const projection=await base.captureStatefulDeclaration(definition(),ownerBounds),declaration=await owner.negotiateStatefulOwnerV2(projection,
  ownerOffer(owner.STATEFUL_OWNER_HOST_CAPABILITIES_V2,ownerBounds),ownerOffer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2,ownerBounds));
 const queryDeclaration=await sdk.captureIndexedDeclarationV1(declaration,'model-one',model());
 const adapter=new IndexedReference(declaration,queryDeclaration,requested);
 const selection=sdk.negotiateIndexedQueryV1(queryDeclaration,requested,offer([queryDeclaration],requested),adapter.indexedCapabilities);
 const compose=(use,guard)=>{
  const identity=copy(adapter.identity),view=copy(adapter.view);
  const authority=guard??(()=>{adapter.guard();assert.deepEqual(adapter.identity,identity);owner.assertStatefulOwnerViewV2(declaration,adapter.view,view);});
  return sdk.composeStatefulOwnerIndexedReadV1(selection,adapter,identity,view,use,authority);
 };
 return {projection,declaration,queryDeclaration,adapter,selection,compose};
}

export function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
