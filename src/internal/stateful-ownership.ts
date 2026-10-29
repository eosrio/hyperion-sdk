import type {StatefulDeclaration} from '../stateful-types.js';

// Same local ownership as v1; private shared capture checks must precede field access.
const declarations = new WeakSet<object>(), negotiated = new WeakSet<object>();
export function isCapturedStatefulDeclaration(value: unknown): value is StatefulDeclaration {
  return typeof value === 'object' && value !== null && declarations.has(value);
}
export function isNegotiatedStatefulDeclaration(value: unknown): value is StatefulDeclaration {
  return typeof value === 'object' && value !== null && negotiated.has(value);
}
export function registerStatefulDeclaration(value: StatefulDeclaration): void {declarations.add(value);}
export function registerNegotiatedStatefulDeclaration(value: StatefulDeclaration): void {negotiated.add(value);}
