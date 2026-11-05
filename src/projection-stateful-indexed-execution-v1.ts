import {types} from 'node:util';
import {assertNegotiatedStatefulOwnerV2,assertStatefulOwnerViewV2,captureStatefulOwnerViewV2,
 STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2} from './projection-stateful-owner-v2.js';
import {captureIndexedRequestV1,captureIndexedResultV1} from './projection-stateful-indexed-query-v1.js';
import type {IndexedLimitsV1,IndexedRequestV1,IndexedResultV1,IndexedSelectionV1} from './projection-stateful-indexed-query-v1.js';
import {canonicalStructuredJsonRecord} from './internal/structured-values.js';
import {withOwnerCompletedRead} from './internal/stateful-owner-read.js';
import {StatefulContractError} from './projection-stateful.js';
import type {StatefulCompletedReadV2,StatefulOwnerAdapterV2,StatefulOwnerDeclarationV2,StatefulOwnerIdentityV2} from './stateful-owner-v2-types.js';
import type {StatefulGuard,StatefulQueryResult,StatefulRecord,StatefulView} from './stateful-types.js';

/** Independent opt-in family. The SDK49 query/result contract remains closed. */
export const STATEFUL_INDEXED_EXECUTION_FAMILY_V1='stateful-owner-indexed-execution' as const;
export type IndexedExecutionCodeV1='execution-error'|'statement-timeout';
export interface IndexedExecutionSemanticsV1 {
 readonly profile:string;
 readonly outcomes:readonly {readonly code:IndexedExecutionCodeV1;readonly requestKinds:readonly ('page'|'count')[]}[];
}
export interface IndexedExecutionDeclarationV1 {
 readonly family:typeof STATEFUL_INDEXED_EXECUTION_FAMILY_V1;readonly interfaceVersion:1;
 readonly ownerDeclarationDigest:string;readonly queryDeclarationDigest:string;readonly revision:string;
 readonly semantics:IndexedExecutionSemanticsV1;readonly digest:string;
}
export interface IndexedExecutionOfferV1 {
 readonly family:typeof STATEFUL_INDEXED_EXECUTION_FAMILY_V1;readonly interfaceVersion:1;
 readonly executionDeclarationDigests:readonly string[];readonly profiles:readonly string[];readonly limits:IndexedLimitsV1;
}
declare const selectionBrand:unique symbol,observerBrand:unique symbol,receiptBrand:unique symbol;
export interface IndexedExecutionSelectionV1 {readonly family:typeof STATEFUL_INDEXED_EXECUTION_FAMILY_V1;readonly interfaceVersion:1;
 readonly declaration:IndexedExecutionDeclarationV1;readonly limits:IndexedLimitsV1;readonly [selectionBrand]:true}
export type IndexedExecutionResultV1={readonly kind:'result';readonly result:IndexedResultV1}|
 {readonly kind:'outcome';readonly code:IndexedExecutionCodeV1;readonly profile:string};
/** An operation identity, not a completion/closure claim or a serving grant. */
export interface IndexedExecutionOperationV1 {readonly executionId:string;readonly receipt:{readonly [receiptBrand]:true}}
export interface IndexedExecutionCandidateV1 {readonly view:StatefulView;readonly executionDeclarationDigest:string;
 readonly executionId:string;readonly result:IndexedExecutionResultV1;readonly attempts:number}
export interface IndexedExecutionAdapterV1 extends StatefulOwnerAdapterV2 {
 readonly indexedExecutionCapabilities:IndexedExecutionOfferV1;
 executeCompleted(read:StatefulCompletedReadV2,expected:StatefulView,request:IndexedRequestV1,remaining:IndexedLimitsV1,
  selected:IndexedExecutionDeclarationV1,operation:IndexedExecutionOperationV1):Promise<IndexedExecutionCandidateV1>;
}
export interface IndexedExecutionReadV1 {readonly view:StatefulView;query(request:IndexedRequestV1):Promise<IndexedExecutionResultV1>}
/** Trusted host/runtime custody boundary. Never supply this port from a domain plugin or result DTO. */
export interface IndexedExecutionObserverPortV1 {
 begin(context:{readonly read:StatefulCompletedReadV2;readonly owner:StatefulOwnerIdentityV2;readonly view:StatefulView;
  readonly declaration:IndexedExecutionDeclarationV1;readonly request:IndexedRequestV1;readonly remaining:IndexedLimitsV1;
  readonly receipt:IndexedExecutionOperationV1['receipt'];readonly guard:StatefulGuard}):Promise<{
   readonly executionId:string;
   /** Independently await/verify terminal native evidence, identity, result semantics and total data attempts.
    * Reject partial cursor batches, safety exhaustion and request/owner/source cancellation. No Boolean grant. */
   verifyTerminal(candidate:IndexedExecutionCandidateV1):Promise<void>;
   /** Close every cursor/session owned by this operation; await native close/release acknowledgement. */
   closeOwned():Promise<void>;
   /** Independently inspect exact native custody after close; throw for unknown, missing or open resources. */
   assertClosed():Promise<void>;
  }>;
}
export interface IndexedExecutionObserverV1 {readonly [observerBrand]:true}
type Binding={owner:StatefulOwnerDeclarationV2;query:IndexedSelectionV1};
const declarations=new WeakMap<object,Binding>(),selections=new WeakMap<object,Binding>();
const observers=new WeakMap<object,{selection:IndexedExecutionSelectionV1;port:IndexedExecutionObserverPortV1;used:WeakSet<object>}>();
const publications=new WeakMap<object,{guard:StatefulGuard;value:StatefulRecord}>();
function check(ok:unknown,message:string,code='stateful.unavailable'):asserts ok {if(!ok)throw new StatefulContractError(code,'Indexed execution: '+message);}
function record(v:unknown,keys:readonly string[]):Record<string,unknown>{
 check(v&&typeof v==='object'&&!types.isProxy(v)&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Object.getOwnPropertySymbols(v).length,'inert record required');
 const d=Object.getOwnPropertyDescriptors(v);check(Object.keys(d).length===keys.length&&keys.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k]!,'value')),'unexpected fields or accessors');
 return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function list(v:unknown,max=256):unknown[]{
 check(Array.isArray(v)&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Array.prototype&&!Object.getOwnPropertySymbols(v).length,'inert array required');
 const d=Object.getOwnPropertyDescriptors(v),n=Object.getOwnPropertyDescriptor(v,'length')!.value as number;
 check(Number.isSafeInteger(n)&&n>=0&&n<=max&&Object.keys(d).length===n+1,'array bound');
 return Array.from({length:n},(_,i)=>{check(d[i]?.enumerable&&Object.hasOwn(d[i]!,'value'),'sparse/accessor array');return d[i]!.value;});
}
function text(v:unknown):string {check(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v),'bounded identity required');return v;}
const limitKeys=['readAttempts','responseRecords','responseBytes','queryBytes','predicates','orderTerms','setValues'] as const;
function offer(selected:IndexedExecutionDeclarationV1,limits:IndexedLimitsV1,input:unknown):void {
 const o=record(input,['family','interfaceVersion','executionDeclarationDigests','profiles','limits']);
 check(o.family===STATEFUL_INDEXED_EXECUTION_FAMILY_V1&&o.interfaceVersion===1,'family unavailable','stateful.capability-unavailable');
 const digests=list(o.executionDeclarationDigests).map(text),profiles=list(o.profiles).map(text),available=record(o.limits,limitKeys);
 check(new Set(digests).size===digests.length&&new Set(profiles).size===profiles.length&&digests.includes(selected.digest)&&profiles.includes(selected.semantics.profile),'explicit declaration/profile unavailable','stateful.capability-unavailable');
 for(const k of limitKeys)check(Number.isSafeInteger(available[k])&&(available[k] as number)>=limits[k],'explicit bound unavailable','stateful.capability-unavailable');
}
function binding(selection:IndexedExecutionSelectionV1):Binding {const found=selection&&selections.get(selection);check(found,'local execution negotiation required','stateful.invalid-contract');assertNegotiatedStatefulOwnerV2(found.owner);return found;}

export async function captureIndexedExecutionDeclarationV1(owner:StatefulOwnerDeclarationV2,query:IndexedSelectionV1,
 revision:string,input:IndexedExecutionSemanticsV1):Promise<IndexedExecutionDeclarationV1>{
 assertNegotiatedStatefulOwnerV2(owner);captureIndexedRequestV1(query,{kind:'count',exact:true,where:[]});
 check(query.declaration.ownerDeclarationDigest===owner.digest,'query owner differs','stateful.invalid-contract');
 const s=record(input,['profile','outcomes']);
 const outcomes=list(s.outcomes,2).map(raw=>{const o=record(raw,['code','requestKinds']);
  check(o.code==='execution-error'||o.code==='statement-timeout','unsupported semantic code');
  const requestKinds=list(o.requestKinds,2);check(requestKinds.length>0&&new Set(requestKinds).size===requestKinds.length&&requestKinds.every(x=>x==='page'||x==='count'),'invalid semantic request kinds');
  return Object.freeze({code:o.code,requestKinds:Object.freeze(requestKinds)}) as IndexedExecutionSemanticsV1['outcomes'][number];});
 check(outcomes.length>0&&new Set(outcomes.map(x=>x.code)).size===outcomes.length,'missing/duplicate outcomes');
 const body={family:STATEFUL_INDEXED_EXECUTION_FAMILY_V1,interfaceVersion:1 as const,ownerDeclarationDigest:owner.digest,
  queryDeclarationDigest:query.declaration.digest,revision:text(revision),semantics:Object.freeze({profile:text(s.profile),outcomes:Object.freeze(outcomes)})};
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)));
 const result=Object.freeze({...body,digest:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')});
 declarations.set(result,{owner,query});return result;
}
export function negotiateIndexedExecutionV1(declaration:IndexedExecutionDeclarationV1,host:IndexedExecutionOfferV1,adapter:IndexedExecutionOfferV1):IndexedExecutionSelectionV1 {
 const found=declaration&&declarations.get(declaration);check(found,'local execution declaration required','stateful.invalid-contract');
 assertNegotiatedStatefulOwnerV2(found.owner);for(const o of [host,adapter])offer(declaration,found.query.limits,o);
 const selected=Object.freeze({family:STATEFUL_INDEXED_EXECUTION_FAMILY_V1,interfaceVersion:1 as const,declaration,limits:found.query.limits}) as IndexedExecutionSelectionV1;
 selections.set(selected,found);return selected;
}
/** Explicit trusted-host registration only. No production offer, physical verifier, or generic completion mint is installed. */
export function createIndexedExecutionObserverV1(selection:IndexedExecutionSelectionV1,capabilities:IndexedExecutionOfferV1,
 port:IndexedExecutionObserverPortV1):IndexedExecutionObserverV1 {
 binding(selection);offer(selection.declaration,selection.limits,capabilities);const p=record(port,['begin']);check(typeof p.begin==='function','host observer unavailable');
 const begin=p.begin as IndexedExecutionObserverPortV1['begin'];
 const captured=Object.freeze({begin:(...args:Parameters<typeof begin>)=>begin.apply(port,args)});
 const observer=Object.freeze({}) as IndexedExecutionObserverV1;observers.set(observer,{selection,port:captured,used:new WeakSet()});return observer;
}
function captureResult(selected:IndexedExecutionSelectionV1,request:IndexedRequestV1,input:unknown):IndexedExecutionResultV1 {
 const found=binding(selected);check(input&&typeof input==='object'&&!types.isProxy(input),'invalid result');
 const d=Object.getOwnPropertyDescriptor(input,'kind');check(d&&Object.hasOwn(d,'value'),'inert result kind required');
 if(d.value==='result'){const o=record(input,['kind','result']);return Object.freeze({kind:'result',result:captureIndexedResultV1(found.query,request,o.result)});}
 const o=record(input,['kind','code','profile']);check(o.kind==='outcome'&&o.profile===selected.declaration.semantics.profile,'outcome profile differs');
 check(selected.declaration.semantics.outcomes.some(x=>x.code===o.code&&x.requestKinds.includes(request.kind)),'semantic code/request not declared');
 return Object.freeze({kind:'outcome',code:o.code as IndexedExecutionCodeV1,profile:o.profile as string});
}

/** Compose under the existing owner read and retained host authority. Native truth belongs to the separately qualified observer. */
export async function composeStatefulOwnerIndexedExecutionV1(selection:IndexedExecutionSelectionV1,adapter:IndexedExecutionAdapterV1,
 observer:IndexedExecutionObserverV1,expectedOwner:StatefulOwnerIdentityV2,expectedView:StatefulView,
 use:(reader:IndexedExecutionReadV1)=>Promise<unknown>,guard:StatefulGuard):Promise<StatefulQueryResult>{
 const {owner,query:querySelection}=binding(selection),limits=selection.limits,declaration=selection.declaration;
 const custody=observer&&observers.get(observer);check(custody&&custody.selection===selection,'local selected host observer required','stateful.invalid-contract');
 const capturedOwner=canonicalStructuredJsonRecord(expectedOwner,[],owner.projection.limits.envelope).value as unknown as StatefulOwnerIdentityV2;
 const receipts=new WeakMap<object,{state:'active'|'terminal'|'closed'|'retired';read:StatefulCompletedReadV2;request:IndexedRequestV1;executionId?:string}>();
 let open=true,accepting=true,busy=false,failed=false,failure:unknown;const ids=new Set<string>();
 const used:Record<keyof IndexedLimitsV1,number>={readAttempts:0,responseRecords:0,responseBytes:0,queryBytes:0,predicates:0,orderTerms:0,setValues:0};
 const poison=(error:unknown)=>{if(!failed){failed=true;failure=error;}return failure;};
 const publicationGuard=()=>{if(failed)throw failure;try{guard();}catch(error){throw poison(error);}};
 const lifetime=()=>{publicationGuard();check(open,'completed-read scope is closed');check(typeof adapter.executeCompleted==='function','execution operation unavailable');offer(declaration,limits,adapter.indexedExecutionCapabilities);};
 const admit=()=>{lifetime();check(accepting,'query port is closed');};
 const remaining=():IndexedLimitsV1=>Object.freeze(Object.fromEntries(limitKeys.map(k=>[k,limits[k]-used[k]])) as unknown as IndexedLimitsV1);
 const charge=(key:keyof IndexedLimitsV1,n:number)=>{check(Number.isSafeInteger(n)&&n>=0&&n<=limits[key]-used[key],key+' total exceeded');used[key]+=n;};
 const snapshot=(input:unknown)=>{
  try{const captured=canonicalStructuredJsonRecord(input,[],{...owner.projection.limits.envelope,
   recordBytes:Math.min(owner.projection.limits.envelope.recordBytes,remaining().responseBytes)});charge('responseBytes',captured.bytes);return captured.value;}
  catch(error){if(error instanceof StatefulContractError)throw error;throw new StatefulContractError('stateful.unavailable','Indexed execution response capture refused');}
 };
 try {
  lifetime();const result=await withOwnerCompletedRead(owner,adapter,expectedOwner,expectedView,lifetime,{
   admit:()=>assertNegotiatedStatefulOwnerV2(owner),view:input=>captureStatefulOwnerViewV2(owner,input),requiredCapabilities:STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2
  },async(read,view)=>{
   const current=async()=>{lifetime();try{assertStatefulOwnerViewV2(owner,await adapter.completedView(read),view);}finally{lifetime();}};
   await current();
   const query=(input:IndexedRequestV1):Promise<IndexedExecutionResultV1>=>{
    const pending=(async()=>{
     let started=false,native:Awaited<ReturnType<IndexedExecutionObserverPortV1['begin']>>|undefined,receipt:IndexedExecutionOperationV1['receipt']|undefined;
     try {
      admit();check(!busy,'concurrent operations are unavailable');const request=captureIndexedRequestV1(querySelection,input),available=remaining();
      charge('queryBytes',new TextEncoder().encode(JSON.stringify(request)).length);charge('predicates',request.where.length);
      charge('orderTerms',request.kind==='page'?request.order.length:0);charge('setValues',request.where.reduce((n,x)=>n+('values' in x?x.values.length:0),0));
      check(available.readAttempts>0&&available.responseBytes>=2&&available.responseRecords>=1,'read total exceeded');
      charge('readAttempts',1);busy=true;started=true;await current();admit();
      receipt=Object.freeze({}) as IndexedExecutionOperationV1['receipt'];const state={state:'active' as 'active'|'terminal'|'closed'|'retired',read,request};receipts.set(receipt,state);
      // The host begins independent custody before the adapter runs. A receipt has no public completion issuer.
      try{native=await custody.port.begin(Object.freeze({read,owner:capturedOwner,view,declaration,request,remaining:available,receipt,guard:lifetime}));}finally{admit();}
      check(native&&typeof native==='object'&&!types.isProxy(native),'host operation unavailable');
      // A rejected previously owned handle is not this request's cleanup authority.
      if(custody.used.has(native)){native=undefined;check(false,'host operation reused');}custody.used.add(native);
      const methods=record(native,['executionId','verifyTerminal','closeOwned','assertClosed']);
      check(['verifyTerminal','closeOwned','assertClosed'].every(k=>typeof methods[k]==='function'),'host custody commands unavailable');
      const executionId=text(methods.executionId);check(!ids.has(executionId),'native execution identity reused');ids.add(executionId);
      const issuer=native;native=Object.freeze({executionId,
       verifyTerminal:(methods.verifyTerminal as typeof native.verifyTerminal).bind(issuer),
       closeOwned:(methods.closeOwned as typeof native.closeOwned).bind(issuer),assertClosed:(methods.assertClosed as typeof native.assertClosed).bind(issuer)});
      const authority=receipts.get(receipt)!;check(authority.state==='active'&&authority.read===read&&authority.request===request,'operation receipt retired');authority.executionId=executionId;
      const operation=Object.freeze({executionId,receipt});
      let raw:IndexedExecutionCandidateV1;try{raw=await adapter.executeCompleted(read,view,request,available,declaration,operation);}finally{admit();}
      const answer=record(raw,['view','executionDeclarationDigest','executionId','result','attempts']);
      check(answer.executionDeclarationDigest===declaration.digest&&answer.executionId===executionId,'execution/model identity differs','stateful.stale-view');
      assertStatefulOwnerViewV2(owner,answer.view,view);check(Number.isSafeInteger(answer.attempts)&&(answer.attempts as number)>=1,'native attempt count unavailable');
      charge('readAttempts',(answer.attempts as number)-1);let captured:IndexedExecutionResultV1;
      try{captured=captureResult(selection,request,answer.result);}catch(error){if(error instanceof StatefulContractError)throw error;throw new StatefulContractError('stateful.unavailable','Indexed execution result capture refused');}
      charge('responseRecords',captured.kind==='outcome'||captured.result.kind==='count'?1:captured.result.rows.length);snapshot(raw);
      const candidate=Object.freeze({view,executionDeclarationDigest:declaration.digest,executionId,result:captured,attempts:answer.attempts as number});
      try{check(await native.verifyTerminal(candidate)===undefined,'host terminal verifier must return no grant');}finally{admit();}
      check(authority.state==='active'&&authority.executionId===executionId,'operation receipt reused');authority.state='terminal';
      // Every owned native resource is awaited and independently inspected before an outcome escapes this query.
      const closing=native;native=undefined;
      let closeFailed=false,closeError:unknown;try{check(await closing.closeOwned()===undefined,'host close must return no grant');}catch(error){closeFailed=true;closeError=error;}
      try{check(await closing.assertClosed()===undefined,'host closure verifier must return no grant');}catch(error){if(!closeFailed)closeError=error;closeFailed=true;}
      if(closeFailed)throw closeError;
      check(authority.state==='terminal','operation completion reused');authority.state='closed';
      await current();admit();return captured;
     }catch(error){throw poison(error);}finally{
      // Malformed host returns cannot make cleanup invoke accessors or proxy traps.
      if(native&&typeof native==='object'&&!types.isProxy(native))for(const name of ['closeOwned','assertClosed'] as const){
       const method=Object.getOwnPropertyDescriptor(native,name);
       if(method&&Object.hasOwn(method,'value')&&typeof method.value==='function')try{
        check(await (method.value as ()=>Promise<void>).call(native)===undefined,'host cleanup must return no grant');
       }catch(error){poison(error);}
      }
      if(receipt){const authority=receipts.get(receipt);if(authority)authority.state='retired';}
      if(started)busy=false;
     }
    })();void pending.catch(()=>{});return pending;
   };
   let value:unknown;try{value=await use(Object.freeze({view,query}));}finally{admit();}
   check(!busy,'unawaited work prevents completion');accepting=false;await current();
   const composed=snapshot({view,value}) as unknown as StatefulQueryResult;lifetime();return composed;
  });
  publicationGuard();publications.set(result,{guard:publicationGuard,value:result.value});return result;
 }catch(error){throw poison(error);}finally{accepting=false;open=false;}
}
export function assertIndexedExecutionPublicationV1(result:StatefulQueryResult):void {const p=publications.get(result);check(p,'locally completed composition required','stateful.invalid-contract');p.guard();}
export function serializeIndexedExecutionResultV1(result:StatefulQueryResult):string {assertIndexedExecutionPublicationV1(result);const p=publications.get(result)!;const text=JSON.stringify(p.value);p.guard();return text;}
