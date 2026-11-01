import {types as nodeTypes} from 'node:util';
/** Operator-managed data: no state projection or chain authority is granted. */
export const OPERATOR_LIST_FAMILY_V1 = 'operator-list-read' as const;
export interface OperatorListLimitsV1 {readonly names: number; readonly items: number; readonly bytes: number; readonly attempts: number}
export interface OperatorListCapabilitiesV1 {readonly family: typeof OPERATOR_LIST_FAMILY_V1; readonly interfaceVersion: 1; readonly limits: OperatorListLimitsV1}
export interface OperatorListEntryV1 {readonly name: string; readonly items: readonly string[]}
export interface OperatorListResultV1 {readonly source: string; readonly generation: string; readonly entries: readonly OperatorListEntryV1[]}
export interface OperatorListProviderV1 {
  readonly capabilities: OperatorListCapabilitiesV1;
  read(names: readonly string[], limits: OperatorListLimitsV1): Promise<unknown>;
}
export class OperatorListError extends Error {
  readonly code = 'operator-list.unavailable'; readonly retryable = true;
  constructor(message: string) {super(message); this.name = 'OperatorListError';}
}
const selections = new WeakSet<object>();
function fail(message: string): never {throw new OperatorListError(message);}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || nodeTypes.isProxy(value) || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Expected inert record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== keys.length ||
      keys.some(k => !descriptors[k]?.enumerable || !Object.hasOwn(descriptors[k]!, 'value'))) fail('Unexpected fields or accessors');
  return Object.fromEntries(keys.map(k => [k, descriptors[k]!.value]));
}
function limits(value: unknown): OperatorListLimitsV1 {
  const v = record(value, ['names','items','bytes','attempts']);
  for (const k of ['names','items','bytes','attempts']) if (!Number.isSafeInteger(v[k]) || (v[k] as number) < (k === 'items' ? 0 : 1)) fail('Invalid limit');
  return Object.freeze({names:v.names as number, items:v.items as number, bytes:v.bytes as number, attempts:v.attempts as number});
}
function offer(value: unknown): OperatorListCapabilitiesV1 {
  const v = record(value, ['family','interfaceVersion','limits']);
  if (v.family !== OPERATOR_LIST_FAMILY_V1 || v.interfaceVersion !== 1) fail('Unsupported capability');
  return Object.freeze({family:OPERATOR_LIST_FAMILY_V1, interfaceVersion:1, limits:limits(v.limits)});
}
function fits(a: OperatorListLimitsV1, b: OperatorListLimitsV1): boolean {
  return a.names <= b.names && a.items <= b.items && a.bytes <= b.bytes && a.attempts <= b.attempts;
}
function text(v: unknown): string {
  if (typeof v !== 'string') fail('Expected string');
  for (let i=0; i<v.length; i++) {const c=v.charCodeAt(i); if (c>=0xd800 && c<=0xdbff) {const d=v.charCodeAt(++i); if (!(d>=0xdc00 && d<=0xdfff)) fail('Malformed UTF-16');} else if (c>=0xdc00 && c<=0xdfff) fail('Malformed UTF-16');}
  return v;
}
function array(v: unknown, maximum: number): readonly unknown[] {
  if (!v || typeof v !== 'object' || nodeTypes.isProxy(v) || !Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || Object.getOwnPropertySymbols(v).length) fail('Expected inert array');
  const length = Object.getOwnPropertyDescriptor(v, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) fail('Array limit exceeded');
  const ds=Object.getOwnPropertyDescriptors(v); if (Object.keys(ds).length !== length+1) fail('Sparse or extended array');
  const captured: unknown[]=[];
  for (let i=0;i<length;i++) {const d=ds[i]; if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('Array accessor'); captured.push(d.value);}
  return captured;
}
export interface OperatorListSelectionV1 {readonly family: typeof OPERATOR_LIST_FAMILY_V1; readonly interfaceVersion: 1; readonly limits: OperatorListLimitsV1}
/** Explicit independent negotiation; requested budgets are never expanded. */
export function negotiateOperatorListsV1(requested: OperatorListLimitsV1, host: OperatorListCapabilitiesV1, provider: OperatorListCapabilitiesV1): OperatorListSelectionV1 {
  const l=limits(requested), h=offer(host), p=offer(provider); if (!fits(l,h.limits) || !fits(l,p.limits)) fail('Capability unavailable');
  const result=Object.freeze({family:OPERATOR_LIST_FAMILY_V1, interfaceVersion:1 as const, limits:l}); selections.add(result); return result;
}
/** Host guard owns cancellation, deadline, configured source and final publication fencing. */
export async function readOperatorListsV1(selection: OperatorListSelectionV1, provider: OperatorListProviderV1,
  names: readonly string[], source: string, generation: string, guard: () => void): Promise<OperatorListResultV1> {
  if (!selection || !selections.has(selection)) fail('Negotiation required');
  guard(); const l=selection.limits; if (!fits(l,offer(provider.capabilities).limits) || typeof provider.read !== 'function') fail('Capability unavailable');
  const src=text(source), gen=text(generation); if (!src || !gen) fail('Source binding required');
  const ns=array(names, l.names).map(text); if (ns.length > l.names || new Set(ns).size !== ns.length) fail('Distinct name limit exceeded');
  const enc=new TextEncoder(); let bytes=ns.reduce((n,s)=>n+enc.encode(s).length,0), count=0;
  if (bytes > l.bytes) fail('Byte limit exceeded');
  const request=Object.freeze([...ns]); let raw: unknown;
  try {raw=await provider.read(request,l);} finally {guard();}
  if (!fits(l,offer(provider.capabilities).limits) || typeof provider.read !== 'function') fail('Capability unavailable');
  const result=record(raw,['source','generation','complete','attempts','entries']);
  if (result.source !== src || result.generation !== gen || result.complete !== true || !Number.isSafeInteger(result.attempts) || (result.attempts as number)<(ns.length ? 1 : 0) || (result.attempts as number)>l.attempts) fail('Incomplete or mismatched result');
  const entries=array(result.entries, ns.length); if (entries.length !== ns.length) fail('Incomplete entries');
  const captured=entries.map((entry,i) => {
    const e=record(entry,['name','items']); if (e.name !== ns[i]) fail('Entry mismatch');
    const items=array(e.items, l.items-count).map(item=> {const s=text(item); count++; bytes+=enc.encode(s).length; if (count>l.items || bytes>l.bytes) fail('Result budget exceeded'); return s;});
    return Object.freeze({name:ns[i]!, items:Object.freeze(items)});
  });
  guard(); return Object.freeze({source:src,generation:gen,entries:Object.freeze(captured)});
}
