import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import * as v1 from '../dist/projection-stateful.js';
import * as owner from '../dist/projection-stateful-owner-v2.js';
import {completeLimits, offer, prepared} from './fixtures/stateful-complete-kind-reference.mjs';
import {hex, limits} from './fixtures/stateful-reference.mjs';
import {legacyCaptures} from './fixtures/stateful-legacy-captures.mjs';

const rows = () => new Map([['z-last', {name: 'z-last', created: '9007199254740993'}],
  ['a-first', {name: 'a-first', created: '18446744073709551615'}], ['m-middle', {name: 'm-middle', created: '1'}]]);
const plain = value => JSON.parse(JSON.stringify(value));
const call = (state, callback = async reader => ({rows: await reader.all('collection')})) => state.compose(callback);

test('v1 and owner-v2 declaration/source/raw-target/candidate bytes match frozen pre-extension main', async () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/complete-kind-legacy.json', import.meta.url)));
  assert.equal(golden.baseline, '203c8dd5b3cdbef9d6ca8ba4aca5477ef21a0013');
  assert.deepEqual(await legacyCaptures(), golden.captures);
});

test('separate negotiated selection preserves the existing closed captures and get-only behavior', async () => {
  const state = await prepared(), {declaration, projection, adapter} = state;
  assert.equal(Object.isFrozen(state.selection), true); assert.equal(Object.isFrozen(state.selection.limits), true);
  assert.equal(state.selection.declarationDigest, declaration.digest);
  assert.deepEqual(Object.keys(declaration), ['family', 'interfaceVersion', 'sourceInputVersion', 'projection', 'digest']);
  assert.equal(Object.hasOwn(projection.limits, 'completeKind'), false);
  assert.throws(() => owner.negotiateStatefulCompleteKindV1(structuredClone(declaration), completeLimits(), offer(), offer()), /Recapture/);
  const inert = await owner.captureStatefulOwnerDeclarationV2(projection, 2);
  assert.throws(() => owner.negotiateStatefulCompleteKindV1(inert, completeLimits(), offer(), offer()), /negotiation/);
  const result = await owner.composeStatefulOwnerReadV2(declaration, adapter, adapter.identity, adapter.view,
    async reader => {assert.deepEqual(Object.keys(reader), ['view', 'get']); return {result: await reader.get('collection', 'none')};}, adapter.guard);
  assert.equal(result.value.result.status, 'covered-absent');
  await assert.rejects(v1.captureStatefulDeclaration({...projection.definition, completeKind: true}, projection.limits));
  await assert.rejects(owner.receiveStatefulOwnerDeclarationV2({...declaration, completeKind: true}));
});

test('required unsupported/malformed offers and implicit or expanded limits refuse negotiation', async () => {
  const {declaration} = await prepared();
  for (const offered of [undefined, {}, {...offer(), interfaceVersion: 2}, {...offer(), extra: true},
    {...offer(), family: 'foreign'}, {...offer(), limits: {...completeLimits(), responseRecords: -1}},
    {...offer(), limits: {...completeLimits(), readAttempts: Infinity}}])
    assert.throws(() => owner.negotiateStatefulCompleteKindV1(declaration, completeLimits(), offered, offer()));
  for (const requested of [undefined, {}, {...completeLimits(), responseRecords: 9}, {...completeLimits(), readAttempts: 0},
    {...completeLimits(), responseBytes: 1}, {...completeLimits(), responseRecords: 1.5}, {...completeLimits(), extra: 1}])
    assert.throws(() => owner.negotiateStatefulCompleteKindV1(declaration, requested, offer(), offer()));
  assert.throws(() => owner.negotiateStatefulCompleteKindV1(declaration, {...completeLimits(), readAttempts: 129},
    offer({...completeLimits(), readAttempts: 129}), offer({...completeLimits(), readAttempts: 129})), /unavailable/);
  let getters = 0;
  const bad = {...offer()}; Object.defineProperty(bad, 'limits', {enumerable: true, get() {getters++; return completeLimits();}});
  assert.throws(() => owner.negotiateStatefulCompleteKindV1(declaration, completeLimits(), bad, offer())); assert.equal(getters, 0);
});

test('copied, foreign-module and absent selections never acquire a read or execute the callback', async () => {
  const state = await prepared(); let callbacks = 0;
  for (const selection of [structuredClone(state.selection), null, undefined, {}])
    await assert.rejects(owner.composeStatefulOwnerCompleteKindReadV1(selection, state.adapter, state.adapter.identity,
      state.adapter.view, async () => {callbacks++; return {};}, state.adapter.guard), /negotiation/);
  const independent = await import('../dist/projection-stateful-owner-v2.js?independent-complete-kind');
  await assert.rejects(independent.composeStatefulOwnerCompleteKindReadV1(state.selection, state.adapter,
    state.adapter.identity, state.adapter.view, async () => {callbacks++; return {};}, state.adapter.guard), /negotiation/);
  assert.equal(state.adapter.acquired, 0); assert.equal(callbacks, 0);
});

test('capability removal, decrease or absent operation refuses before native acquisition and plugin code', async () => {
  for (const mutate of [adapter => {adapter.completeKindCapabilities = undefined;},
    adapter => {adapter.completeKindCapabilities = offer({...completeLimits(), responseRecords: 1});},
    adapter => {adapter.readCompletedKind = undefined;}, adapter => {adapter.readCompletedKey = undefined;},
    adapter => {adapter.capabilities = {...adapter.capabilities, supported: []};}]) {
    const state = await prepared(); mutate(state.adapter); let callbacks = 0;
    await assert.rejects(call(state, async () => {callbacks++; return {};}));
    assert.equal(state.adapter.acquired, 0); assert.equal(callbacks, 0);
  }
});

test('genuine controlled exhaustion includes empty success even with zero available row slots', async () => {
  const state = await prepared({...completeLimits(), responseRecords: 0});
  const result = await call(state);
  assert.deepEqual(plain(result.value), {rows: []}); assert.equal(state.adapter.kindCalls, 1);
  assert.equal(state.adapter.closed, 1); assert.equal(state.adapter.requests[0].responseRecords, 0);
});

test('all rows retain adapter order, every field, exact integer strings and one pinned view', async () => {
  const state = await prepared(); state.adapter.rows.set('collection', rows());
  state.adapter.rows.set('schema', new Map([['foreign', {name: 'other-kind'}]]));
  const result = await call(state);
  assert.deepEqual(plain(result.value.rows), [...rows()].map(([key, value]) => ({key, value})));
  assert.deepEqual(plain(result.view), state.adapter.view); assert.equal(result.value.rows[1].value.created, '18446744073709551615');
  assert.equal(Object.isFrozen(result.value.rows[0].value), true); assert.equal(state.adapter.closed, 1);
});

test('unknown/forged kinds and malformed keys refuse without native enumeration', async () => {
  for (const kind of ['undeclared', '', null, {}, new String('collection')]) {
    const state = await prepared(); await assert.rejects(call(state, async reader => ({rows: await reader.all(kind)})));
    assert.equal(state.adapter.kindCalls, 0); assert.equal(state.adapter.closed, 1);
  }
  const state = await prepared(); await assert.rejects(call(state, async reader => ({value: await reader.get('collection', '')})));
  assert.equal(state.adapter.getCalls, 0);
});

test('completion is literal and explicit; missing/false completion and partial page records refuse', async () => {
  for (const change of [answer => {answer.complete = false;}, answer => {delete answer.complete;},
    answer => {answer.complete = 'true';}, answer => {answer.complete = 1;}, answer => {answer.next = 'more';}]) {
    const state = await prepared(); state.adapter.beforeReturn = async (_, answer) => change(answer);
    await assert.rejects(call(state)); assert.equal(state.adapter.closed, 1);
  }
});

test('native attempts include explicit terminal exhaustion, so a short page does not complete', async () => {
  const state = await prepared({...completeLimits(), readAttempts: 2});
  state.adapter.rows.set('collection', rows());
  await assert.rejects(call(state), /before exhaustion/); assert.equal(state.adapter.closed, 1);
  const accepted = await prepared({...completeLimits(), readAttempts: 3}); accepted.adapter.rows.set('collection', rows());
  assert.equal((await call(accepted)).value.rows.length, 3);
});

test('duplicate, malformed, accessor and integer-invalid rows refuse instead of being filtered', async () => {
  const invalid = [answer => {answer.rows = [{key: 'same', value: {}}, {key: 'same', value: {}}];},
    answer => {answer.rows = [{key: '', value: {}}];}, answer => {answer.rows = [{key: 'x'}];},
    answer => {answer.rows = [{key: 'x', value: {}, kind: 'other'}];}, answer => {answer.rows = [{key: 'x', value: []}];},
    answer => {answer.rows = [{key: 'x', value: {asset_id: 9007199254740992}}];}];
  for (const change of invalid) {
    const state = await prepared(); state.adapter.beforeReturn = async (_, answer) => change(answer);
    await assert.rejects(call(state, async reader => ({rows: await reader.all('mint')}))); assert.equal(state.adapter.closed, 1);
  }
  const state = await prepared(); let getters = 0;
  state.adapter.beforeReturn = async (_, answer) => {answer.rows = [{key: 'x', value: {}}];
    Object.defineProperty(answer.rows[0], 'key', {enumerable: true, get() {getters++; return 'x';}});};
  await assert.rejects(call(state)); assert.equal(getters, 0);
});

test('wrong declaration/backend/generation/revision/checkpoint or kind refuses the native answer', async () => {
  for (const change of [answer => {answer.kind = 'schema';}, answer => {answer.view.declarationDigest = hex(98);},
    answer => {answer.view.backendId = 'foreign';}, answer => {answer.view.generation = 'other';},
    answer => {answer.view.revision = hex(99);}, answer => {answer.view.checkpoint.blockId = hex(99);},
    answer => {answer.view.checkpoint.blockNum++;}]) {
    const state = await prepared(); state.adapter.beforeReturn = async (_, answer) => change(answer);
    await assert.rejects(call(state)); assert.equal(state.adapter.closed, 1);
  }
});

test('native row overflow probes and SDK-observed row overflow both refuse partial success', async () => {
  const native = await prepared({...completeLimits(), responseRecords: 2}); native.adapter.rows.set('collection', rows());
  await assert.rejects(call(native), /overflow/);
  const sdk = await prepared({...completeLimits(), responseRecords: 2});
  sdk.adapter.beforeReturn = async (_, answer) => {answer.rows = [...rows()].map(([key, value]) => ({key, value}));};
  await assert.rejects(call(sdk), /record total/);
});

test('get and repeated all calls consume one shared record and attempt allowance', async () => {
  const state = await prepared({...completeLimits(), responseRecords: 3}); state.adapter.rows.set('collection', new Map([['one', {}], ['two', {}]]));
  await assert.rejects(call(state, async reader => {await reader.get('schema', 'absent'); await reader.all('collection');
    await reader.get('schema', 'absent'); return {};}), /record total/);
  assert.equal(state.adapter.getCalls, 1); assert.equal(state.adapter.requests[0].responseRecords, 2);
  const attempts = await prepared({...completeLimits(), readAttempts: 2});
  await assert.rejects(call(attempts, async reader => {await reader.get('schema', 'a'); await reader.all('collection');
    await reader.all('collection'); return {};}), /read total/);
  assert.equal(attempts.adapter.kindCalls, 1); assert.equal(attempts.adapter.requests[0].readAttempts, 1);
});

test('the new callback preserves the existing zero keyed-read bound without constraining all', async () => {
  const state = await prepared(completeLimits(), {...limits(), readKeys: 0});
  await assert.rejects(call(state, async reader => ({value: await reader.get('schema', 'known')})), /Key\/read/);
  assert.equal(state.adapter.getCalls, 0);
  assert.deepEqual(plain((await call(state)).value), {rows: []});
});

test('keyed data-read retries cannot exceed the selected shared native attempt total', async () => {
  const state = await prepared({...completeLimits(), readAttempts: 1}); state.adapter.keyedAttempts = 3;
  await assert.rejects(call(state, async reader => ({value: await reader.get('collection', 'x')})), /attempt budget/);
  assert.equal(state.adapter.nativeDataAttempts, 1); assert.equal(state.adapter.closed, 1);
});

test('reported keyed retry attempts and enumeration share one selected data-read allowance', async () => {
  const state = await prepared({...completeLimits(), readAttempts: 4}); state.adapter.keyedAttempts = 3;
  await call(state, async reader => {await reader.get('collection', 'x'); await reader.all('collection'); return {};});
  assert.equal(state.adapter.nativeDataAttempts, 4); assert.equal(state.adapter.keyRequests[0].readAttempts, 4);
  assert.equal(state.adapter.requests[0].readAttempts, 1);
  const exhausted = await prepared({...completeLimits(), readAttempts: 3}); exhausted.adapter.keyedAttempts = 3;
  await assert.rejects(call(exhausted, async reader => {await reader.get('collection', 'x'); await reader.all('collection'); return {};}), /read total/);
  assert.equal(exhausted.adapter.nativeDataAttempts, 3); assert.equal(exhausted.adapter.kindCalls, 0);
});

test('invalid or excess reported keyed retries refuse and catching a native keyed overflow cannot complete', async () => {
  for (const attempts of [0, -1, 1.5, 13, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    const state = await prepared(); state.adapter.beforeReturn = async (_, answer) => {answer.attempts = attempts;};
    await assert.rejects(call(state, async reader => ({value: await reader.get('collection', 'x')})), /attempt total/);
  }
  const state = await prepared({...completeLimits(), readAttempts: 1}); state.adapter.keyedAttempts = 3;
  await assert.rejects(call(state, async reader => {try {await reader.get('collection', 'x');} catch {} return {}; }), /attempt budget/);
  assert.equal(state.adapter.nativeDataAttempts, 1);
});

test('owner/completed-view authority checks do not consume projection data-read attempts', async () => {
  const state = await prepared({...completeLimits(), readAttempts: 1}), current = state.adapter.completedView.bind(state.adapter);
  let checks = 0;
  state.adapter.completedView = async read => {checks++; return current(read);};
  await call(state, async () => ({})); assert.ok(checks >= 2); assert.equal(state.adapter.nativeDataAttempts, 0);
  await call(state, async reader => ({value: await reader.get('collection', 'x')}));
  assert.ok(checks >= 6); assert.equal(state.adapter.nativeDataAttempts, 1);
});

test('invalid, zero, unsafe and excess reported native attempts all refuse', async () => {
  for (const attempts of [0, -1, 1.5, 13, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    const state = await prepared(); state.adapter.beforeReturn = async (_, answer) => {answer.attempts = attempts;};
    await assert.rejects(call(state), /attempt total/);
  }
});

test('native and SDK byte bounds refuse overflow; read envelopes plus final output share the total', async () => {
  const native = await prepared({...completeLimits(), responseBytes: 256});
  await assert.rejects(call(native), /serialized byte/);
  const sdk = await prepared({...completeLimits(), responseBytes: 1024});
  sdk.adapter.beforeReturn = async (_, answer) => {answer.rows = [{key: 'large', value: {text: 'x'.repeat(1024)}}];};
  await assert.rejects(call(sdk), /byte bound/);
  const final = await prepared({...completeLimits(), responseBytes: 600});
  await assert.rejects(call(final, async reader => {await reader.all('collection'); return {text: 'x'.repeat(300)};}), /byte bound/);
});

test('aggregate byte equality succeeds and one byte less refuses, including UTF8/escaping', async () => {
  const raw = {name: 'quote"\\\n\u0000🙂'}, expected = {rows: [{key: 'unicode', value: raw}]};
  const probe = await prepared(); probe.adapter.rows.set('collection', new Map([['unicode', raw]]));
  let measured;
  probe.adapter.beforeReturn = async (_, answer) => {measured = Buffer.byteLength(JSON.stringify(answer)) + Buffer.byteLength(JSON.stringify(expected));};
  await call(probe); assert.ok(measured > 0);
  const exact = await prepared({...completeLimits(), responseBytes: measured}); exact.adapter.rows.set('collection', new Map([['unicode', raw]]));
  assert.deepEqual(plain((await call(exact)).value), expected);
  const overflow = await prepared({...completeLimits(), responseBytes: measured - 1}); overflow.adapter.rows.set('collection', new Map([['unicode', raw]]));
  await assert.rejects(call(overflow), /byte bound/);
});

test('a caught malformed/incomplete/overflow read poisons completion', async () => {
  for (const mutate of [answer => {answer.complete = false;}, answer => {answer.rows = [{key: '', value: {}}];},
    answer => {answer.attempts = 99;}]) {
    const state = await prepared(); state.adapter.beforeReturn = async (_, answer) => mutate(answer);
    await assert.rejects(call(state, async reader => {try {await reader.all('collection');} catch {} return {caught: true};}));
    assert.equal(state.adapter.closed, 1);
  }
});

test('completed capability is closed on callback error and post-acquisition cancellation', async () => {
  const state = await prepared(); await assert.rejects(call(state, async () => {throw new Error('callback failed');}), /callback failed/);
  assert.equal(state.adapter.closed, 1);
  const cancelled = await prepared(), acquire = cancelled.adapter.completedRead.bind(cancelled.adapter);
  cancelled.adapter.completedRead = async (...args) => {const read = await acquire(...args); cancelled.adapter.live = false; return read;};
  let callbacks = 0;
  await assert.rejects(call(cancelled, async () => {callbacks++; return {};}), /authority/);
  assert.equal(cancelled.adapter.closed, 1); assert.equal(callbacks, 0);
});

test('deadline/cancellation at native read and after compose refuse with no successful return', async () => {
  for (const late of ['all', 'compose']) {
    const state = await prepared(); let now = 1;
    const guard = () => {state.adapter.guard(); if (now >= 2) throw new Error('request deadline exceeded');};
    state.adapter.beforeReturn = async () => {if (late === 'all') now = 2;};
    await assert.rejects(state.compose(async reader => {await reader.all('collection'); if (late === 'compose') now = 2; return {};}, guard), /deadline/);
    assert.equal(state.adapter.closed, 1);
  }
});

test('raw gap, pending failure, cold owner and fork/rollback authority remain host/native-owned', async () => {
  for (const phase of ['raw-gap', 'pending-failure', 'cold', 'fork', 'rollback']) {
    const state = await prepared(); state.adapter.phase = phase;
    await assert.rejects(call(state), /authority/); assert.equal(state.adapter.acquired, 0);
    const changed = await prepared(); changed.adapter.beforeReturn = async () => {changed.adapter.phase = phase;};
    await assert.rejects(call(changed), /authority/); assert.equal(changed.adapter.closed, 1);
  }
});

test('owner takeover, fork revision, generation or checkpoint change during a native read refuses', async () => {
  for (const mutate of [adapter => {adapter.identity.generation = 'takeover';}, adapter => {adapter.view.revision = hex(90);},
    adapter => {adapter.view.generation = 'activated';}, adapter => {adapter.view.checkpoint = {blockNum: 2, blockId: hex(2)};}]) {
    const state = await prepared(); state.adapter.beforeReturn = async () => mutate(state.adapter);
    await assert.rejects(call(state)); assert.equal(state.adapter.closed, 1);
  }
});

test('a dishonest port bypassing its own native checks is still fenced by SDK completedView', async () => {
  const state = await prepared(), original = state.adapter.readCompletedKind.bind(state.adapter);
  state.adapter.readCompletedKind = async (...args) => {const answer = await original(...args); state.adapter.view.revision = hex(90); return answer;};
  await assert.rejects(call(state)); assert.equal(state.adapter.closed, 1);
});

test('escaped SDK readers and copied native capabilities cannot be reused', async () => {
  const state = await prepared(); let saved;
  await call(state, async reader => {saved = reader; return {};});
  await assert.rejects(saved.all('collection'), /closed/); await assert.rejects(saved.get('collection', 'x'), /closed/);
  await assert.rejects(state.adapter.readCompletedKind({}, state.adapter.view, 'collection', completeLimits()), /Foreign/);
  assert.equal(state.adapter.kindCalls, 0); assert.equal(state.adapter.closed, 1);
});

test('pending late result cannot finish after the callback has returned and closed the read', async () => {
  const state = await prepared(); let release, started, pending;
  const gate = new Promise(resolve => {release = resolve;}); const entered = new Promise(resolve => {started = resolve;});
  state.adapter.beforeReturn = async () => {started(); await gate;};
  await assert.rejects(call(state, async reader => {pending = reader.all('collection'); pending.catch(() => {}); await entered; return {}; }), /Unawaited/);
  assert.equal(state.adapter.closed, 1); release(); await assert.rejects(pending, /closed|capability/);
});

test('an escaped reader cannot start new work during the final completedView await', async () => {
  const state = await prepared(), current = state.adapter.completedView.bind(state.adapter);
  let views = 0, escaped, pending;
  state.adapter.completedView = async read => {
    const view = await current(read);
    if (++views === 4) {pending = escaped.all('collection'); pending.catch(() => {}); await Promise.resolve();}
    return view;
  };
  await assert.rejects(call(state, async reader => {escaped = reader; await reader.all('collection'); return {}; }), /closed/);
  await assert.rejects(pending, /closed/); assert.equal(state.adapter.kindCalls, 1); assert.equal(state.adapter.closed, 1);
});

test('concurrent operations cannot obtain the same remaining allowance twice', async () => {
  const state = await prepared(); let release, started;
  const gate = new Promise(resolve => {release = resolve;}), entered = new Promise(resolve => {started = resolve;});
  state.adapter.beforeReturn = async () => {started(); await gate;};
  await assert.rejects(call(state, async reader => {
    const first = reader.all('collection'); first.catch(() => {}); await entered;
    try {await reader.get('schema', 'x');} finally {release(); await first;}
    return {};
  }), /Concurrent/);
  assert.equal(state.adapter.kindCalls, 1); assert.equal(state.adapter.getCalls, 0); assert.equal(state.adapter.closed, 1);
});

test('mismatched expected declaration fails before native acquisition', async () => {
  const state = await prepared(); const view = {...state.adapter.view, declarationDigest: hex(99)};
  await assert.rejects(owner.composeStatefulOwnerCompleteKindReadV1(state.selection, state.adapter,
    state.adapter.identity, view, async () => ({}), state.adapter.guard)); assert.equal(state.adapter.acquired, 0);
});

test('a write after the last enumeration but before composition completion is fenced', async () => {
  const state = await prepared();
  await assert.rejects(call(state, async reader => {await reader.all('collection');
    state.adapter.view.checkpoint = {blockNum: 2, blockId: hex(2)}; return {rows: []};}));
  assert.equal(state.adapter.closed, 1);
});

test('a well-formed completion DTO cannot independently prove that a native adapter omitted no rows', async () => {
  const state = await prepared(); state.adapter.rows.set('collection', rows());
  state.adapter.beforeReturn = async (_, answer) => {answer.rows = answer.rows.slice(0, 1);};
  // Deliberately dishonest adapter: only its actual engine conformance can establish true exhaustion.
  assert.equal((await call(state)).value.rows.length, 1);
});
