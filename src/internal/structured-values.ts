/** Shared pure record capture. Public family exports own negotiation; legacy wrapper stays private. */
export type StructuredValue = null | boolean | number | string | readonly StructuredValue[] | StructuredRecord;
export interface StructuredRecord {readonly [key: string]: StructuredValue}
export interface StructuredValueLimits {
  readonly depth: number;
  readonly nodes: number;
  readonly fields: number;
  readonly arrayElements: number;
  readonly stringBytes: number;
  readonly recordBytes: number;
  readonly integerFields: number;
  readonly pathSegments: number;
}
/** Object-key paths only; a present leaf is a decimal string or a vector of those strings. */
export interface IntegerField {
  readonly path: readonly string[];
  readonly type: 'int64' | 'uint64';
  readonly vector: boolean;
}
interface Schema {children: Map<string, Schema>; integer?: IntegerField}
type Properties = Record<string, PropertyDescriptor>;
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new TypeError(`Structured record: ${message}`);
}
function properties(input: unknown, array: boolean, maximum: number): Properties {
  check(typeof input === 'object' && input !== null && Array.isArray(input) === array, 'expected inert data');
  const prototype = Object.getPrototypeOf(input);
  check(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'nonordinary prototype');
  check(Object.getOwnPropertySymbols(input).length === 0, 'symbol properties');
  if (array) check(Object.getOwnPropertyDescriptor(input, 'length')!.value <= maximum, 'array bound');
  check(Object.getOwnPropertyNames(input).length <= maximum + (array ? 1 : 0), 'field bound');
  const result = Object.getOwnPropertyDescriptors(input);
  for (const key of Object.keys(result)) {
    const descriptor = result[key]!;
    if (array && key === 'length') continue;
    check(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'accessor or nonenumerable property');
  }
  if (array) {
    const length = result.length!.value as number;
    check(Object.keys(result).length === length + 1, 'sparse or extended array');
    for (let i = 0; i < length; i++) check(Object.hasOwn(result, String(i)), 'sparse or extended array');
  }
  return result;
}
function textBytes(value: string, maximum: number, legacy: boolean): {raw: number; json: number} {
  check(value.length <= maximum, 'string byte bound');
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      check(next >= 0xdc00 && next <= 0xdfff, 'malformed Unicode');
    } else check(unit < 0xdc00 || unit > 0xdfff, 'malformed Unicode');
  }
  // The original NUL/literal-escape policy is unresolved; this experiment refuses both.
  if (legacy) check(!value.includes('\0') && !value.includes('\\u0000'), 'unsupported NUL conversion policy');
  let raw = 0, json = 2;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    const bytes = unit < 0x80 ? 1 : unit < 0x800 ? 2 : unit < 0xd800 || unit > 0xdbff ? 3 : 4;
    raw += bytes;
    json += unit === 0x22 || unit === 0x5c || [8, 9, 10, 12, 13].includes(unit) ? 2 : unit < 0x20 ? 6 : bytes;
    if (bytes === 4) i++;
  }
  check(raw <= maximum, 'string byte bound');
  return {raw, json};
}
export function validateStructuredInteger(value: unknown, type: IntegerField['type']): void {
  check(typeof value === 'string' && value.length <= 20, 'exact integer decimal string');
  check(/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value), 'noncanonical integer');
  const negative = value.startsWith('-'), magnitude = negative ? value.slice(1) : value;
  check(type === 'int64' || !negative, 'unsigned integer is negative');
  const maximum = type === 'uint64' ? '18446744073709551615' : negative ? '9223372036854775808' : '9223372036854775807';
  check(magnitude.length < maximum.length || magnitude.length === maximum.length && magnitude <= maximum, 'integer range');
}
function declaration(input: readonly IntegerField[], limits: StructuredValueLimits, legacy: boolean): Schema {
  const entries = properties(input, true, limits.integerFields), length = entries.length!.value as number;
  check(length <= limits.integerFields, 'integer declaration bound');
  const root: Schema = {children: new Map()};
  for (let i = 0; i < length; i++) {
    const entry = properties(entries[String(i)]!.value, false, 3);
    check(Object.keys(entry).sort().join(',') === 'path,type,vector', 'integer declaration fields');
    const type = entry.type!.value, vector = entry.vector!.value;
    check((type === 'int64' || type === 'uint64') && typeof vector === 'boolean', 'integer declaration type');
    const path = properties(entry.path!.value, true, limits.pathSegments), size = path.length!.value as number;
    check(size > 0 && size <= limits.pathSegments, 'integer path bound');
    let current = root;
    const parts: string[] = [];
    for (let j = 0; j < size; j++) {
      const key = path[String(j)]!.value;
      check(typeof key === 'string', 'integer path segment');
      textBytes(key, limits.stringBytes, legacy); parts.push(key);
      check(!current.integer, 'overlapping integer paths');
      let child = current.children.get(key);
      if (!child) {child = {children: new Map()}; current.children.set(key, child);}
      current = child;
    }
    check(!current.integer && current.children.size === 0, 'duplicate or overlapping integer paths');
    current.integer = {path: parts, type, vector};
  }
  return root;
}
/**
 * Validate before creating the detached frozen record/canonical text. Explicit limits are required;
 * they are caller experiment inputs, not production defaults. This is not a general Proxy detector
 * or preemption boundary for trusted code. Integer declarations belong to the separately pinned
 * definition identity; the returned canonical text identifies only the record value.
 */
function capture(input: unknown, integerFields: readonly IntegerField[], requested: StructuredValueLimits, legacy: boolean):
  {readonly value: StructuredRecord; readonly canonical: string; readonly bytes: number} {
  const settings = properties(requested, false, 8);
  const names = ['depth', 'nodes', 'fields', 'arrayElements', 'stringBytes', 'recordBytes', 'integerFields', 'pathSegments'] as const;
  check(Object.keys(settings).length === names.length, 'explicit limits required');
  const limits = Object.create(null) as Record<typeof names[number], number>;
  for (const name of names) {
    const value = settings[name]?.value;
    check(Number.isSafeInteger(value) && value >= 0, 'explicit nonnegative safe limits required'); limits[name] = value;
  }
  check(limits.nodes > 0 && limits.recordBytes >= 2, 'record admission bound');
  const schema = declaration(integerFields, limits, legacy), captured = new Map<object, Properties>(), ancestors = new Set<object>();
  const work: {value: unknown; depth: number; schema?: Schema; integer?: IntegerField['type']; exit?: object}[] = [{value: input, depth: 0, schema}];
  let nodes = 0, bytes = 0;
  const account = (size: number) => {check(size <= limits.recordBytes - bytes, 'record byte bound'); bytes += size;};
  check(typeof input === 'object' && input !== null && !Array.isArray(input), 'record root must be an object');
  while (work.length) {
    const item = work.pop()!;
    if (item.exit) {ancestors.delete(item.exit); continue;}
    check(++nodes <= limits.nodes && item.depth <= limits.depth, 'node or depth bound');
    const value = item.value, field = item.schema?.integer;
    if (field) check(Array.isArray(value) === field.vector, 'integer scalar/vector shape');
    const integer = item.integer ?? (field && !field.vector ? field.type : undefined);
    if (integer) validateStructuredInteger(value, integer);
    if (item.schema?.children.size) check(typeof value === 'object' && value !== null && !Array.isArray(value), 'integer path parent must be an object');
    if (typeof value === 'string') {account(textBytes(value, limits.stringBytes, legacy).json); continue;}
    if (typeof value === 'number') {check(Number.isFinite(value), 'nonfinite number'); account(JSON.stringify(value).length); continue;}
    if (value === null || typeof value === 'boolean') {account(value === false ? 5 : 4); continue;}
    check(typeof value === 'object' && value !== null, 'non-JSON value');
    check(!ancestors.has(value), 'cyclic data');
    const array = Array.isArray(value), props = captured.get(value) ?? properties(value, array, array ? limits.arrayElements : limits.fields);
    captured.set(value, props);
    const keys = Object.keys(props).filter(key => !array || key !== 'length');
    check(keys.length <= (array ? limits.arrayElements : limits.fields), 'array or field bound');
    // Each child consumes a node, so reject oversized containers before stacking their entries.
    check(keys.length <= limits.nodes - nodes, 'node bound');
    account(2 + Math.max(0, keys.length - 1)); ancestors.add(value); work.push({value: null, depth: 0, exit: value});
    for (const key of keys) {
      if (!array) account(textBytes(key, limits.stringBytes, legacy).json + 1);
      const child = {value: props[key]!.value as unknown, depth: item.depth + 1};
      const nextSchema = array ? undefined : item.schema?.children.get(key);
      const nextInteger = array && field?.vector ? field.type : undefined;
      work.push({...child, ...(nextSchema ? {schema: nextSchema} : {}), ...(nextInteger ? {integer: nextInteger} : {})});
    }
  }
  const clone = (value: unknown): StructuredValue => value !== null && typeof value === 'object'
    ? Array.isArray(value) ? [] : Object.create(null) as StructuredRecord : Object.is(value, -0) ? 0 : value as StructuredValue;
  const result = clone(input) as StructuredRecord;
  const copies = [{source: input, target: result as object}];
  while (copies.length) {
    const {source, target} = copies.pop()!, props = captured.get(source)!;
    for (const key of Object.keys(props).filter(k => !Array.isArray(source) || k !== 'length').sort()) {
      const original: unknown = props[key]!.value, value = clone(original);
      Object.defineProperty(target, key, {value, enumerable: true, writable: false, configurable: false});
      if (original !== null && typeof original === 'object') copies.push({source: original, target: value as object});
    }
    Object.freeze(target);
  }
  const tokens: (string | {value: StructuredValue})[] = [{value: result}], output: string[] = [];
  while (tokens.length) {
    const token = tokens.pop()!;
    if (typeof token === 'string') {output.push(token); continue;}
    const value = token.value;
    if (value === null || typeof value !== 'object') {output.push(JSON.stringify(value)); continue;}
    const array = Array.isArray(value), keys = Object.keys(value).sort();
    output.push(array ? '[' : '{'); tokens.push(array ? ']' : '}');
    // Array order is numeric, even for indexes >=10; object order is UTF-16 code-unit lexical.
    const ordered = array ? Array.from({length: value.length}, (_, i) => String(i)) : keys;
    for (let i = ordered.length - 1; i >= 0; i--) {
      const key = ordered[i]!;
      tokens.push({value: (value as StructuredRecord)[key]!});
      if (!array) tokens.push(`${JSON.stringify(key)}:`);
      if (i > 0) tokens.push(',');
    }
  }
  return Object.freeze({value: result, canonical: output.join(''), bytes});
}

/** Retained private first-tracer restriction; this does not define generic JSON or codec parity. */
export function canonicalStructuredRecord(input: unknown, fields: readonly IntegerField[], limits: StructuredValueLimits) {
  return capture(input, fields, limits, true);
}
/** Generic inert JSON preserves well-formed NUL and literal escapes; codecs own their own policy. */
export function canonicalStructuredJsonRecord(input: unknown, fields: readonly IntegerField[], limits: StructuredValueLimits) {
  return capture(input, fields, limits, false);
}
