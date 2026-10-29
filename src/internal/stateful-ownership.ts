import type {StatefulDeclaration} from '../stateful-types.js';

// Same local ownership as v1; private shared capture checks must precede field access.
const canonicalModule = new URL('../projection-stateful.js', import.meta.url).href;
const declarations = new WeakMap<object, string>(), negotiated = new WeakMap<object, string>();
export function isCapturedStatefulDeclaration(value: unknown, moduleId = canonicalModule): value is StatefulDeclaration {
  return typeof value === 'object' && value !== null && declarations.get(value) === moduleId;
}
export function isNegotiatedStatefulDeclaration(value: unknown, moduleId = canonicalModule): value is StatefulDeclaration {
  return typeof value === 'object' && value !== null && negotiated.get(value) === moduleId;
}
export function registerStatefulDeclaration(value: StatefulDeclaration, moduleId = canonicalModule): void {declarations.set(value, moduleId);}
export function registerNegotiatedStatefulDeclaration(value: StatefulDeclaration, moduleId = canonicalModule): void {negotiated.set(value, moduleId);}
