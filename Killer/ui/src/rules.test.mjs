/*
 * Rules tests for replay(). Run with `npm test` in ui/.
 *
 * No test framework and no build step: replay() is a pure function whose only imports are types, so
 * Node's built-in type stripping loads rules.ts directly.
 */
import assert from 'node:assert/strict';
import { replay, assignNumbers, hashState, STARTING_LIVES } from './rules.ts';

let pass = 0;
const fail = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail.push(`${name}: ${e.message}`); }
}

const P = (n) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(8, '0')}-0000-0000-0000-000000000000`);

let throwSeq = 0;
const T = (segment, ring) => ({
  throwId: `th-${++throwSeq}`, segment, ring, score: 0, rawNotation: `${ring}-${segment}`,
  position: { x: 0, y: 0 }, confidence: null, boardId: 'test', cameraIndex: null,
  detectedAtUtc: '2026-01-01T00:00:00Z', source: 'Simulator',
});

const payload = (playerIds, visits, seed = 12345) => ({ seed, playerIds, options: {}, playerGroups: {}, visits });
const V = (throws, ended = false) => ({ throws, ended });

// ---------------------------------------------------------------- number assignment
t('assignNumbers is deterministic for a seed', () => {
  const ids = P(4);
  assert.deepEqual(assignNumbers(ids, 12345), assignNumbers(ids, 12345));
});
t('assignNumbers gives every player a unique 1-20', () => {
  const ids = P(20);
  const n = assignNumbers(ids, 999);
  const vals = ids.map((id) => n[id]);
  assert.equal(new Set(vals).size, 20);
  assert.ok(vals.every((v) => v >= 1 && v <= 20));
});
t('assignNumbers draw count is independent of roster size', () => {
  const a = assignNumbers(P(2), 7);
  const b = assignNumbers(P(20), 7);
  assert.equal(a[P(2)[0]], b[P(20)[0]]);
  assert.equal(a[P(2)[1]], b[P(20)[1]]);
});
t('a different seed gives different numbers', () => {
  const ids = P(4);
  assert.notDeepEqual(assignNumbers(ids, 1), assignNumbers(ids, 2));
});

// ---------------------------------------------------------------- roster guards
t('empty roster idles without a configError', () => {
  const s = replay(payload([], []));
  assert.equal(s.configError, null);
  assert.equal(s.currentPlayerId, null);
  assert.equal(s.isComplete, false);
});
t('1 player reports a configError and never completes', () => {
  const s = replay(payload(P(1), []));
  assert.match(s.configError, /at least 2/);
  assert.equal(s.isComplete, false);
  assert.deepEqual(s.finalStandings, []);
});
t('21 players reports a configError', () => {
  const s = replay(payload(P(21), []));
  assert.match(s.configError, /at most 20/);
  assert.equal(s.isComplete, false);
});
t('replay survives a null payload', () => {
  const s = replay(undefined);
  assert.equal(s.currentPlayerId, null);
});

// ---------------------------------------------------------------- turn model
t('turn advances after exactly 3 darts', () => {
  const ids = P(3);
  const s = replay(payload(ids, [V([T(1, 'Single'), T(1, 'Single'), T(1, 'Single')])]));
  assert.equal(s.currentPlayerId, ids[1]);
  assert.deepEqual(s.currentVisitThrows, []);
});
t('3 darts AND ended:true advances exactly once', () => {
  const ids = P(3);
  const s = replay(payload(ids, [V([T(1, 'Single'), T(1, 'Single'), T(1, 'Single')], true)]));
  assert.equal(s.currentPlayerId, ids[1], 'must not double-advance');
});
t('2 darts + ended advances once', () => {
  const ids = P(3);
  const s = replay(payload(ids, [V([T(1, 'Single'), T(1, 'Single')], true)]));
  assert.equal(s.currentPlayerId, ids[1]);
});
t('an empty ended visit advances', () => {
  const ids = P(3);
  const s = replay(payload(ids, [V([], true)]));
  assert.equal(s.currentPlayerId, ids[1]);
});
t('a 4-dart visit credits the 4th dart to the next player', () => {
  const ids = P(3);
  const s = replay(payload(ids, [V([T(1, 'Single'), T(1, 'Single'), T(1, 'Single'), T(2, 'Single')], true)]));
  const throwEvents = s.events.filter((e) => e.type === 'throw');
  assert.equal(throwEvents[3].throwerId, ids[1], '4th dart belongs to player 2');
  assert.equal(s.currentPlayerId, ids[2], 'ended then advances again');
});
t('an open visit keeps currentVisitThrows', () => {
  const ids = P(3);
  const s = replay(payload(ids, [V([T(1, 'Single'), T(1, 'Single')])]));
  assert.equal(s.currentVisitThrows.length, 2);
  assert.equal(s.currentPlayerId, ids[0]);
});

// ---------------------------------------------------------------- killer rules
function killerSetup(playerCount, seed = 12345) {
  const ids = P(playerCount);
  const numbers = assignNumbers(ids, seed);
  return { ids, numbers };
}

t('own double makes you the killer; own single/triple does not', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]];
  let s = replay(payload(ids, [V([T(mine, 'Single'), T(mine, 'Triple')])]));
  assert.equal(s.isKiller[ids[0]], false);
  s = replay(payload(ids, [V([T(mine, 'Double')])]));
  assert.equal(s.isKiller[ids[0]], true);
  assert.ok(s.events.some((e) => e.type === 'becameKiller' && e.playerId === ids[0]));
});
t('a non-killer hitting an opponent number does nothing', () => {
  const { ids, numbers } = killerSetup(2);
  const theirs = numbers[ids[1]];
  const s = replay(payload(ids, [V([T(theirs, 'Triple')])]));
  assert.equal(s.lives[ids[1]], STARTING_LIVES);
});
t('a killer takes a life off a live opponent on any ring', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]], theirs = numbers[ids[1]];
  const s = replay(payload(ids, [V([T(mine, 'Double'), T(theirs, 'Single')])]));
  assert.equal(s.lives[ids[1]], STARTING_LIVES - 1);
  assert.ok(s.events.some((e) => e.type === 'lifeLost' && e.playerId === ids[1] && e.livesRemaining === 2));
});
t('bull is inert even for a killer', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]];
  const s = replay(payload(ids, [V([T(mine, 'Double'), T(25, 'Double'), T(25, 'Single')])]));
  assert.equal(s.lives[ids[1]], STARTING_LIVES);
});
t('a killer cannot lose a life to their own number', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]];
  const s = replay(payload(ids, [V([T(mine, 'Double'), T(mine, 'Triple')])]));
  assert.equal(s.lives[ids[0]], STARTING_LIVES);
});

// ---------------------------------------------------------------- elimination + completion
t('3 hits eliminate, match completes, standings are full and winner-first', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]], theirs = numbers[ids[1]];
  const s = replay(payload(ids, [
    V([T(mine, 'Double'), T(theirs, 'Single'), T(theirs, 'Single')]),
    V([], true),                        // p2's turn, ends it
    V([T(theirs, 'Single')]),           // back to p1, killer status persists
  ]));
  assert.equal(s.lives[ids[1]], 0);
  assert.equal(s.isComplete, true);
  assert.deepEqual(s.winnerPlayerIds, [ids[0]]);
  assert.deepEqual(s.finalStandings, [ids[0], ids[1]]);
  assert.equal(s.currentPlayerId, null);
  assert.ok(s.events.some((e) => e.type === 'eliminated' && e.playerId === ids[1]));
  assert.equal(s.events[s.events.length - 1].type, 'victory', 'victory is last');
});
t('turn order skips eliminated players', () => {
  const { ids, numbers } = killerSetup(3);
  const mine = numbers[ids[0]], p2 = numbers[ids[1]];
  // p1 becomes killer and knocks p2 out over two visits, then ends turn.
  const s = replay(payload(ids, [
    V([T(mine, 'Double'), T(p2, 'Single'), T(p2, 'Single')]),
    V([], true), V([], true),                       // p2, p3 pass
    V([T(p2, 'Single')], true),                     // p1 finishes p2 off, ends turn
  ]));
  assert.equal(s.lives[ids[1]], 0);
  assert.equal(s.isComplete, false);
  assert.equal(s.currentPlayerId, ids[2], 'skips the eliminated p2');
});
t('no trailing turnChanged survives completion', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]], theirs = numbers[ids[1]];
  const s = replay(payload(ids, [
    V([T(mine, 'Double'), T(theirs, 'Single'), T(theirs, 'Single')]),
    V([], true),
    V([T(theirs, 'Single'), T(1, 'Miss'), T(1, 'Miss')]),   // 3 darts would normally advance
  ]));
  assert.equal(s.isComplete, true);
  const types = s.events.map((e) => e.type);
  assert.equal(types[types.length - 1], 'victory');
  assert.ok(!types.slice(-2, -1).includes('turnChanged'), 'trailing turnChanged popped');
});

// ---------------------------------------------------------------- deadTargets
t('deadTargets covers bull, unassigned numbers, and the eliminated', () => {
  const { ids, numbers } = killerSetup(2);
  let s = replay(payload(ids, []));
  assert.ok(s.deadTargets.includes('BULL'));
  assert.ok(!s.deadTargets.includes(numbers[ids[0]]));
  assert.ok(!s.deadTargets.includes(numbers[ids[1]]));
  assert.equal(s.deadTargets.length, 20 - 2 + 1, '18 unassigned + BULL');

  const mine = numbers[ids[0]], theirs = numbers[ids[1]];
  s = replay(payload(ids, [
    V([T(mine, 'Double'), T(theirs, 'Single'), T(theirs, 'Single')]),
    V([], true),
    V([T(theirs, 'Single')]),
  ]));
  assert.ok(s.deadTargets.includes(theirs), 'eliminated player number is dead');
});

// ---------------------------------------------------------------- event-key prefix stability
t('appending a dart never changes an earlier event key', () => {
  const { ids, numbers } = killerSetup(3);
  const mine = numbers[ids[0]], p2 = numbers[ids[1]];
  const throws = [T(mine, 'Double'), T(p2, 'Single'), T(p2, 'Single'), T(p2, 'Single')];
  let prev = [];
  for (let n = 0; n <= throws.length; n++) {
    const keys = replay(payload(ids, [V(throws.slice(0, n))])).events.map((e) => e.key);
    for (let i = 0; i < prev.length; i++) {
      assert.equal(keys[i], prev[i], `key ${i} changed when growing the log to ${n} darts`);
    }
    prev = keys;
  }
});
t('undo (a shorter log) is not a prefix extension', () => {
  const { ids, numbers } = killerSetup(2);
  const mine = numbers[ids[0]];
  const long = replay(payload(ids, [V([T(mine, 'Double'), T(1, 'Miss')])])).events.map((e) => e.key);
  const short = replay(payload(ids, [V([T(mine, 'Double')])])).events.map((e) => e.key);
  assert.ok(short.length < long.length);
});
t('two-player A->B->A turnChanged keys stay distinct', () => {
  const ids = P(2);
  const s = replay(payload(ids, [V([], true), V([], true), V([], true)]));
  const keys = s.events.filter((e) => e.type === 'turnChanged').map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, 'no key collisions across the cycle');
  assert.equal(keys.length, 3);
});

// ---------------------------------------------------------------- determinism
t('two independent replays of the same log agree on hashState', () => {
  const { ids, numbers } = killerSetup(4);
  const mine = numbers[ids[0]];
  const log = [V([T(mine, 'Double'), T(numbers[ids[2]], 'Triple')], true), V([T(7, 'Single')], true)];
  assert.equal(hashState(replay(payload(ids, log))), hashState(replay(payload(ids, log))));
});
t('hashState changes when the seed does', () => {
  const ids = P(3);
  assert.notEqual(hashState(replay(payload(ids, [], 1))), hashState(replay(payload(ids, [], 2))));
});

// ---------------------------------------------------------------- full 20-player smoke
t('a 20-player match plays to a single winner with full standings', () => {
  const ids = P(20);
  const numbers = assignNumbers(ids, 4242);
  const visits = [V([T(numbers[ids[0]], 'Double')], true)];       // p1 becomes killer
  for (let i = 1; i < 20; i++) visits.push(V([], true));           // everyone else passes
  // p1 now grinds each opponent down, 3 hits each, one visit per opponent, everyone else passing.
  for (let victim = 1; victim < 20; victim++) {
    const n = numbers[ids[victim]];
    visits.push(V([T(n, 'Single'), T(n, 'Single'), T(n, 'Single')]));
    const remaining = 20 - victim - 1;
    for (let k = 0; k < remaining; k++) visits.push(V([], true));
  }
  const s = replay(payload(ids, visits, 4242));
  assert.equal(s.isComplete, true);
  assert.deepEqual(s.winnerPlayerIds, [ids[0]]);
  assert.equal(s.finalStandings.length, 20);
  assert.equal(new Set(s.finalStandings).size, 20, 'no duplicates');
  assert.equal(s.finalStandings[0], ids[0]);
  assert.equal(s.finalStandings[19], ids[1], 'first eliminated ranks last');
});

console.log(`\n  ${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  FAIL  ' + f)); process.exit(1); }
