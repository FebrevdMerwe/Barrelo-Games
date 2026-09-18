/*
 * Rules tests for replay(). Run with `npm test` in ui/.
 *
 * No test framework and no build step: replay() is a pure function whose only imports are types and
 * board.ts, so Node's built-in type stripping loads rules.ts directly.
 */
import assert from 'node:assert/strict';
import {
  replay,
  hashState,
  deadTargetsFor,
  teamsOf,
  maxRoundsFor,
  DARTS_PER_TURN,
  MAX_SHIELD,
} from './rules.ts';
import {
  adjacentTo,
  homeTerritoryIds,
  hitsFor,
  RING_IDS,
  territoryFor,
  TERRITORY_IDS,
  WEDGE_ORDER,
  wedgeIndexOf,
} from './board.ts';

let pass = 0;
const fail = [];
function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail.push(`${name}: ${e.message}`);
  }
}

const P = (n) =>
  Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(8, '0')}-0000-0000-0000-000000000000`);

let throwSeq = 0;
const T = (segment, ring = 'OuterSingle') => ({
  throwId: `th-${++throwSeq}`,
  segment,
  ring,
  score: 0,
  rawNotation: `${ring}-${segment}`,
  position: { x: 0, y: 0 },
  confidence: null,
  boardId: 'test',
  cameraIndex: null,
  detectedAtUtc: '2026-01-01T00:00:00Z',
  source: 'Simulator',
});

const V = (throws, ended = false) => ({ throws, ended });

/** Solo sides: every player in their own group, which is how N teams of one reach replay(). */
const solo = (ids) => Object.fromEntries(ids.map((id, i) => [id, i]));

const payload = (playerIds, visits, playerGroups = solo(playerIds), seed = 12345, options = {}) => ({
  seed,
  playerIds,
  options,
  playerGroups,
  visits,
});

/** Two solo sides, whose Homes are 6 and 11 — three and nine o'clock on the wire. */
const duel = (visits) => replay(payload(P(2), visits));

const owner = (state, id) => state.territories[id].ownerId;
const shield = (state, id) => state.territories[id].shield;

// ---------------------------------------------------------------- board model
t('the ring is the dartboard wire, not the numeric order', () => {
  assert.deepEqual([...adjacentTo('20')].sort(), ['1', '5', 'BULL'].sort());
  assert.deepEqual([...adjacentTo('11')].sort(), ['14', '8', 'BULL'].sort());
  assert.deepEqual([...adjacentTo('1')].sort(), ['20', '18', 'BULL'].sort());
  assert.ok(!adjacentTo('1').includes('2'), 'numeric neighbours are not neighbours');
});
t('adjacency is exactly the two wedges either side, plus the bull', () => {
  for (const id of RING_IDS) {
    const i = wedgeIndexOf(id);
    assert.deepEqual(
      [...adjacentTo(id)].sort(),
      [WEDGE_ORDER[(i + 19) % 20], WEDGE_ORDER[(i + 1) % 20], 'BULL'].sort(),
      id
    );
  }
});
t('the bull touches all twenty numbers and nothing else', () => {
  const bull = adjacentTo('BULL');
  assert.equal(bull.length, 20);
  assert.ok(!bull.includes('BULL'));
});
t('adjacency is symmetric across all 21 territories', () => {
  for (const id of TERRITORY_IDS) {
    for (const neighbour of adjacentTo(id)) {
      assert.ok(adjacentTo(neighbour).includes(id), `${id} <-> ${neighbour}`);
    }
  }
});
t('singles are 1 hit, doubles 2, triples 3', () => {
  assert.equal(hitsFor(T(12, 'OuterSingle')), 1);
  assert.equal(hitsFor(T(12, 'InnerSingle')), 1);
  assert.equal(hitsFor(T(12, 'Double')), 2);
  assert.equal(hitsFor(T(12, 'Triple')), 3);
});
t('both bull rings are 1 hit on the one bull territory', () => {
  assert.equal(territoryFor(T(25, 'Single')), 'BULL');
  assert.equal(territoryFor(T(25, 'Double')), 'BULL');
  assert.equal(hitsFor(T(25, 'Single')), 1);
  assert.equal(hitsFor(T(25, 'Double')), 1, 'a bullseye must not read as a double');
});
t('a miss lands nowhere', () => {
  assert.equal(territoryFor(T(0, 'Miss')), null);
  assert.equal(hitsFor(T(0, 'Miss')), 0);
});

// ---------------------------------------------------------------- the drawn board
// WEDGE_ORDER is presentation only, but it is twenty hand-typed numbers and a transposition in it
// would draw a board that looks right at a glance and is wrong.
t('the wedge order is the real dartboard, starting at 20', () => {
  assert.deepEqual(
    [...WEDGE_ORDER],
    ['20','1','18','4','13','6','10','15','2','17','3','19','7','16','8','11','14','9','12','5']
  );
});
t('the wedge order holds each number exactly once and no bull', () => {
  assert.equal(new Set(WEDGE_ORDER).size, 20);
  assert.deepEqual([...WEDGE_ORDER].sort((a, b) => a - b), [...RING_IDS].sort((a, b) => a - b));
  assert.ok(!WEDGE_ORDER.includes('BULL'));
});
t('wedges sit between the numbers they really do on a board', () => {
  const flankedBy = (id) => {
    const i = wedgeIndexOf(id);
    return [WEDGE_ORDER[(i + 19) % 20], WEDGE_ORDER[(i + 1) % 20]].sort();
  };
  assert.deepEqual(flankedBy('20'), ['1', '5']);
  assert.deepEqual(flankedBy('3'), ['17', '19']);
  assert.deepEqual(flankedBy('6'), ['10', '13']);
  assert.deepEqual(flankedBy('11'), ['14', '8'].sort());
});
t('the drawn ring and the rules ring are the same ring', () => {
  // The whole point of the wire adjacency: what a player can reach is what they can see next to
  // their own colour. If these ever diverged again the board would be lying about the rules.
  const rulesNeighbours = adjacentTo('20').filter((id) => id !== 'BULL').sort();
  const i = wedgeIndexOf('20');
  const drawnNeighbours = [WEDGE_ORDER[(i + 19) % 20], WEDGE_ORDER[(i + 1) % 20]].sort();
  assert.deepEqual(rulesNeighbours, drawnNeighbours);
  assert.deepEqual(rulesNeighbours, ['1', '5']);
});
t('the bull has no place on the drawn ring', () => {
  assert.equal(wedgeIndexOf('BULL'), -1);
  assert.equal(wedgeIndexOf('20'), 0);
});

// ---------------------------------------------------------------- starting positions
t('2 teams start dead opposite on the board, not in the numbers', () => {
  assert.deepEqual(homeTerritoryIds(2), ['6', '11']);
  // Ten wedges apart is half the board — 6 at three o'clock, 11 at nine.
  assert.equal(Math.abs(wedgeIndexOf('6') - wedgeIndexOf('11')), 10);
});
t('3 teams start roughly 120 degrees apart', () => {
  assert.deepEqual(homeTerritoryIds(3), ['4', '3', '14']);
});
t('4 teams start exactly 90 degrees apart', () => {
  assert.deepEqual(homeTerritoryIds(4), ['18', '15', '7', '9']);
});
t('homes are always distinct and never the bull', () => {
  for (let count = 2; count <= 4; count++) {
    const homes = homeTerritoryIds(count);
    assert.equal(new Set(homes).size, count);
    assert.ok(!homes.includes('BULL'));
  }
});
t('homes are evenly spaced around the drawn board', () => {
  for (let count = 2; count <= 4; count++) {
    const gaps = homeTerritoryIds(count).map((id, i, all) => {
      const next = wedgeIndexOf(all[(i + 1) % count]);
      return (next - wedgeIndexOf(id) + 20) % 20;
    });
    const spread = Math.max(...gaps) - Math.min(...gaps);
    assert.ok(spread <= 1, `${count} teams: gaps ${gaps}`);
  }
});
t('no side opens within reach of another side', () => {
  // Homes a single dart apart would make the opening move "attack" rather than "expand".
  for (let count = 2; count <= 4; count++) {
    const homes = homeTerritoryIds(count);
    for (const home of homes) {
      for (const neighbour of adjacentTo(home)) {
        assert.ok(!homes.includes(neighbour), `${count} teams: ${home} touches ${neighbour}`);
      }
    }
  }
});
t('each side opens owning only its unshielded home', () => {
  const s = duel([]);
  assert.equal(owner(s, '6'), s.teams[0].id);
  assert.equal(owner(s, '11'), s.teams[1].id);
  assert.equal(shield(s, '6'), 0);
  assert.ok(s.territories['6'].isHome);
  assert.equal(owner(s, 'BULL'), null, 'the bull starts neutral');
  assert.deepEqual(Object.values(s.territoryCount), [1, 1]);
});

// ---------------------------------------------------------------- roster guards
t('an empty roster idles without a configError', () => {
  const s = replay(payload([], []));
  assert.equal(s.configError, null);
  assert.equal(s.currentPlayerId, null);
  assert.equal(s.isComplete, false);
});
t('one team reports a configError and never completes', () => {
  const s = replay(payload(P(1), []));
  assert.ok(s.configError);
  assert.equal(s.isComplete, false, 'a lone side must not instantly win');
});
t('five teams report a configError', () => {
  const s = replay(payload(P(5), []));
  assert.ok(s.configError);
});
t('teams of many players are one side, not many', () => {
  const ids = P(4);
  const teams = teamsOf(ids, { [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 0, [ids[3]]: 1 });
  assert.equal(teams.length, 2);
  assert.deepEqual(teams[0].playerIds, [ids[0], ids[2]]);
  assert.deepEqual(teams[1].playerIds, [ids[1], ids[3]]);
});
t('a payload with no playerGroups is solo sides, not one enormous team', () => {
  assert.equal(teamsOf(P(3), undefined).length, 3);
});

// ---------------------------------------------------------------- claiming
t('claims an adjacent neutral territory', () => {
  // Home 6 sits between 13 and 10 on the wire, so those are the two opening moves.
  const s = duel([V([T(10)])]);
  assert.equal(owner(s, '10'), s.teams[0].id);
  assert.equal(shield(s, '10'), 0);
  assert.equal(s.territoryCount[s.teams[0].id], 2);
});
t('either wedge beside home is claimable from the first dart', () => {
  const a = duel([]).teams[0].id;
  assert.equal(owner(duel([V([T(13)])]), '13'), a);
  assert.equal(owner(duel([V([T(10)])]), '10'), a);
});
t('a single claims neutral ground unshielded', () => {
  const s = duel([V([T(10)])]);
  assert.equal(shield(s, '10'), 0);
});
t('a double claims neutral ground with one shield', () => {
  // Two rungs of the ladder in one dart: the first hit claims it, the second shields it.
  const s = duel([V([T(10, 'Double')])]);
  assert.equal(owner(s, '10'), s.teams[0].id);
  assert.equal(shield(s, '10'), 1);
});
t('a triple claims neutral ground with two shields', () => {
  const s = duel([V([T(10, 'Triple')])]);
  assert.equal(owner(s, '10'), s.teams[0].id);
  assert.equal(shield(s, '10'), 2);
});
t('a non-adjacent neutral territory is untouched', () => {
  const s = duel([V([T(12)])]);
  assert.equal(owner(s, '12'), null);
  assert.equal(s.events.some((e) => e.type === 'noEffect' && e.reason === 'unreachable'), true);
});
t('expansion continues from newly claimed ground', () => {
  // 6 -> 10 on dart one, then 10 -> 15, which only touches 6's owner through 10.
  const s = duel([V([T(10), T(15)])]);
  assert.equal(owner(s, '15'), s.teams[0].id);
});
t('the bull is claimable from the first dart, being adjacent to everything', () => {
  const s = duel([V([T(25, 'Single')])]);
  assert.equal(owner(s, 'BULL'), s.teams[0].id);
});
t('holding the bull puts every number in reach', () => {
  const s = duel([V([T(25, 'Single'), T(12)])]);
  assert.equal(owner(s, '12'), s.teams[0].id, '12 touches nothing else the side owns');
});
t('a miss does nothing but still spends a dart', () => {
  const s = duel([V([T(0, 'Miss'), T(10)])]);
  assert.equal(owner(s, '10'), s.teams[0].id);
  assert.equal(s.currentVisitThrows.length, 2);
});

// ---------------------------------------------------------------- shielding
t('a double adds two shields to your own territory', () => {
  const s = duel([V([T(6, 'Double')])]);
  assert.equal(shield(s, '6'), 2);
});
t('a triple onto one shield reaches the cap, not four', () => {
  const s = duel([V([T(6), T(6, 'Triple')])]);
  assert.equal(shield(s, '6'), MAX_SHIELD);
});
t('hitting your own territory at the cap does nothing', () => {
  const s = duel([V([T(6, 'Triple'), T(6, 'Triple')])]);
  assert.equal(shield(s, '6'), MAX_SHIELD);
  assert.ok(s.events.some((e) => e.type === 'noEffect' && e.reason === 'maxShield'));
});
t('home reinforces exactly like anything else', () => {
  const s = duel([V([T(6, 'Double')])]);
  assert.ok(s.territories['6'].isHome);
  assert.equal(shield(s, '6'), 2);
});
t('your own territory is always reachable, however far from the rest', () => {
  // Take the bull, then 12 (which touches nothing else the side owns), then reinforce it.
  const s = duel([V([T(25, 'Single'), T(12), T(12, 'Double')])]);
  assert.equal(shield(s, '12'), 2);
});

// ---------------------------------------------------------------- attacking
/** Walks side A's territory around to touch side B's home at 11, then hands over to B. */
function frontLine() {
  // A: 6 -> bull -> 8 (the bull makes 8 reachable), and 8 sits beside B's home 11 on the wire.
  return [V([T(25, 'Single'), T(8)], true)];
}

/**
 * The same front line, with B taking 14 as well as its home before it throws `bDarts`, then A
 * throwing `aDarts` at it. B holding two wedges is what makes losing 11 cost the wedge and not the
 * match, so a test can watch a territory walk down the ladder and back up it.
 */
function standoff(bDarts, aDarts) {
  return [...frontLine(), V([T(14), ...bDarts], true), V(aDarts, true)];
}

t('a single strips one shield and leaves the territory held', () => {
  const s = duel(standoff([T(11, 'Triple')], [T(11)])); // B shields its home to 3
  assert.equal(owner(s, '11'), s.teams[1].id);
  assert.equal(shield(s, '11'), 2);
});
t('a double takes two shields off but takes no ground', () => {
  const s = duel(standoff([T(11, 'Double')], [T(11, 'Double')]));
  assert.equal(owner(s, '11'), s.teams[1].id);
  assert.equal(shield(s, '11'), 0, 'vulnerable, not lost');
});
t('a triple into three shields breaks them all but takes nothing', () => {
  const s = duel(standoff([T(11, 'Triple')], [T(11, 'Triple')]));
  assert.equal(owner(s, '11'), s.teams[1].id);
  assert.equal(shield(s, '11'), 0);
});
t('a single into an unshielded enemy clears it rather than taking it', () => {
  const s = duel(standoff([], [T(11)]));
  assert.equal(owner(s, '11'), null, 'off its owner, and nobody holds it');
  assert.equal(shield(s, '11'), 0);
  assert.ok(s.events.some((e) => e.type === 'neutralised' && e.territoryId === '11'));
  assert.ok(!s.events.some((e) => e.type === 'claimed' && e.territoryId === '11'));
});
t('the wedge it cleared is claimable by the next dart into it', () => {
  const s = duel([...standoff([], [T(11)]), V([], true), V([T(11)], true)]);
  assert.equal(owner(s, '11'), s.teams[0].id);
  assert.equal(shield(s, '11'), 0);
});
t('a double clears an unshielded enemy wedge and claims it in the one dart', () => {
  const s = duel(standoff([], [T(11, 'Double')]));
  assert.equal(owner(s, '11'), s.teams[0].id);
  assert.equal(shield(s, '11'), 0, 'the second hit claims it, it does not shield it');
});
t('a triple clears, claims and shields in the one dart', () => {
  const s = duel(standoff([], [T(11, 'Triple')]));
  assert.equal(owner(s, '11'), s.teams[0].id);
  assert.equal(shield(s, '11'), 1);
});
t('a double into one shield clears the wedge without claiming it', () => {
  const s = duel(standoff([T(11)], [T(11, 'Double')])); // one hit takes the shield, one clears it
  assert.equal(owner(s, '11'), null);
  assert.equal(shield(s, '11'), 0);
});
t('excess damage carries down the ladder and straight back up it', () => {
  const s = duel(standoff([T(11)], [T(11, 'Triple')])); // shield off, cleared, claimed
  assert.equal(owner(s, '11'), s.teams[0].id);
  assert.equal(shield(s, '11'), 0);
});
t('the ladder runs the whole way down and back up, one rung per hit', () => {
  // B on three shields; A throws two triples at it. Six hits: 3 -> 2 -> 1 -> 0 -> unclaimed ->
  // claimed by A -> one shield.
  const s = duel(standoff([T(11, 'Triple')], [T(11, 'Triple'), T(11, 'Triple')]));
  assert.equal(owner(s, '11'), s.teams[0].id);
  assert.equal(shield(s, '11'), 1);
  // Everything that happened to 11 bar B's own shielding of it.
  const steps = s.events
    .filter((e) => e.territoryId === '11' && e.teamId !== s.teams[1].id)
    .map((e) => e.type);
  assert.deepEqual(steps, ['shieldsBroken', 'neutralised', 'claimed', 'reinforced']);
});
t('an enemy territory out of reach is untouched', () => {
  const s = duel([V([T(11)])]); // A's only ground is 6; 11 touches nothing of theirs
  assert.equal(owner(s, '11'), s.teams[1].id);
  assert.ok(s.events.some((e) => e.type === 'noEffect' && e.reason === 'unreachable'));
});
t('home carries no protection at all', () => {
  const visits = [...frontLine(), V([], true), V([T(11)], true)];
  const s = duel(visits);
  const cleared = s.events.find((e) => e.type === 'neutralised');
  assert.equal(cleared.wasHome, true);
  assert.equal(owner(s, '11'), null);
  assert.equal(s.isEliminated[s.teams[1].id], true, 'a side down to its home alone goes out with it');
});

// ---------------------------------------------------------------- turns
t('a turn is three darts', () => {
  const s = duel([V([T(7), T(8), T(9)])]);
  assert.equal(s.currentTeamId, s.teams[1].id, 'the third dart hands over');
});
t('a fourth dart in one visit belongs to the next side', () => {
  // 7, 8 and 9 touch nothing side A holds, so they change nothing; 14 sits beside B's home 11.
  const s = duel([V([T(7), T(8), T(9), T(14)])]);
  assert.equal(owner(s, '14'), s.teams[1].id, "side B's dart, thrown from B's home at 11");
});
t('an ended visit hands over early', () => {
  const s = duel([V([T(7)], true)]);
  assert.equal(s.currentTeamId, s.teams[1].id);
});
t('ending a visit that already handed over does not skip a side', () => {
  const s = duel([V([T(7), T(8), T(9)], true)]);
  assert.equal(s.currentTeamId, s.teams[1].id, 'not back round to A');
});
t('team-mates take it in turns to throw for the side', () => {
  const ids = P(4);
  const groups = { [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 0, [ids[3]]: 1 };
  const s0 = replay(payload(ids, [], groups));
  assert.equal(s0.currentPlayerId, ids[0]);

  const s1 = replay(payload(ids, [V([], true)], groups));
  assert.equal(s1.currentPlayerId, ids[1], "side B's first member");

  const s2 = replay(payload(ids, [V([], true), V([], true)], groups));
  assert.equal(s2.currentPlayerId, ids[2], "back to side A, now its second member");
});
t('the rotation is per side, not over the flat roster', () => {
  // A has three players, B has one. Each side must still get one visit per round.
  const ids = P(4);
  const groups = { [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 0, [ids[3]]: 0 };
  const s = replay(payload(ids, [V([], true)], groups));
  assert.equal(s.currentTeamId, s.teams[1].id);
});
t('the darts of the turn in progress are reported for the slots', () => {
  const s = duel([V([T(7), T(8)])]);
  assert.equal(s.currentVisitThrows.length, 2);
  assert.equal(duel([V([T(7)], true)]).currentVisitThrows.length, 0);
});
t('the slots clear when the third dart ends the turn, even on an open visit', () => {
  // The host only flags a visit ended when it tells us to; three darts end the turn on their own.
  const s = duel([V([T(7), T(8), T(9)])]);
  assert.equal(s.currentTeamId, s.teams[1].id);
  assert.deepEqual(s.currentVisitThrows, [], "the next side must not inherit the last side's darts");
});
t('a fourth dart in an open visit shows as the first of the next side', () => {
  const s = duel([V([T(7), T(8), T(9), T(14)])]);
  assert.equal(s.currentVisitThrows.length, 1);
});
t('rounds count completed rotations', () => {
  assert.equal(duel([]).round, 1);
  assert.equal(duel([V([], true)]).round, 1, 'still round one until it wraps');
  assert.equal(duel([V([], true), V([], true)]).round, 2);
});

// ---------------------------------------------------------------- elimination and victory
/** Side A takes the bull, then B's only territory — B is out and A has won. */
const conquest = [V([T(25, 'Single'), T(11)])];

t('a side holding nothing is eliminated', () => {
  const s = duel(conquest);
  assert.equal(s.territoryCount[s.teams[1].id], 0);
  assert.equal(s.isEliminated[s.teams[1].id], true);
  assert.deepEqual(s.eliminationOrder, [s.teams[1].id]);
});
t('the last side standing wins', () => {
  const s = duel(conquest);
  assert.equal(s.isComplete, true);
  assert.equal(s.winnerTeamId, s.teams[0].id);
  assert.deepEqual(s.winnerPlayerIds, s.teams[0].playerIds);
});
t('the turn indicator clears once the match is over', () => {
  const s = duel(conquest);
  assert.equal(s.currentPlayerId, null);
  assert.equal(s.currentTeamId, null);
});
t('the dart slots empty once the match is over', () => {
  assert.deepEqual(duel(conquest).currentVisitThrows, []);
});
t('darts thrown after the win are ignored', () => {
  const after = [...conquest, V([T(1, 'Triple')], true), V([T(2, 'Triple')], true)];
  assert.equal(hashState(duel(after)), hashState(duel(conquest)));
});
t('the match does not end while two sides still hold ground', () => {
  const s = duel([V([T(7), T(8), T(9)], true)]);
  assert.equal(s.isComplete, false);
});
t('standings rank the winner first and the first side out last', () => {
  const ids = P(3);
  const s = replay(
    payload(ids, [
      // Homes are 4, 3, 14. A takes the bull, then everything the other two hold.
      V([T(25, 'Single'), T(3), T(14)]),
    ])
  );
  assert.equal(s.isComplete, true);
  assert.deepEqual(s.winnerPlayerIds, [ids[0]]);
  assert.deepEqual(s.finalStandings, [ids[0], ids[2], ids[1]], 'last out ranks above first out');
});
t('standings list every player exactly once, team-mates consecutive', () => {
  const ids = P(4);
  const groups = { [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 0, [ids[3]]: 1 };
  const s = replay(payload(ids, [V([T(25, 'Single'), T(11)])], groups));
  assert.equal(s.isComplete, true);
  assert.equal(s.finalStandings.length, 4);
  assert.equal(new Set(s.finalStandings).size, 4);
  assert.deepEqual(s.finalStandings.slice(0, 2), [ids[0], ids[2]]);
});
t('an eliminated side is skipped in the rotation', () => {
  const ids = P(3);
  // Homes 4, 3, 14. A takes the bull then wipes out B (home 3) — three darts, turn passes.
  const s = replay(payload(ids, [V([T(25, 'Single'), T(3), T(3)], true)]));
  assert.equal(s.isComplete, false, 'C still holds 14');
  assert.equal(s.isEliminated[s.teams[1].id], true);
  assert.equal(s.currentTeamId, s.teams[2].id, 'B is skipped');
});

// ---------------------------------------------------------------- round cap (optional match length)
t('maxRoundsFor accepts a positive integer and treats anything else as unlimited', () => {
  assert.equal(maxRoundsFor({ maxRounds: '10' }), 10);
  assert.equal(maxRoundsFor({ maxRounds: '1' }), 1);
  assert.equal(maxRoundsFor({ maxRounds: '0' }), null);
  assert.equal(maxRoundsFor({ maxRounds: '-5' }), null);
  assert.equal(maxRoundsFor({ maxRounds: 'abc' }), null);
  assert.equal(maxRoundsFor({}), null);
  assert.equal(maxRoundsFor(undefined), null);
});
t('with no maxRounds set the match stays unlimited through many rounds', () => {
  const passes = Array.from({ length: 12 }, () => V([], true));
  const s = duel(passes);
  assert.equal(s.maxRounds, null);
  assert.equal(s.isComplete, false);
  assert.ok(s.round > 6);
});
t('a round cap ends the match once reached, most territory wins', () => {
  const ids = P(2);
  const visits = [
    V([T(10)], true), // A claims 10, on top of home 6
    V([], true), // B passes — round 1 -> 2
    V([], true), // A passes
    V([], true), // B passes — round 2 -> 3, cap reached
  ];
  const s = replay(payload(ids, visits, solo(ids), 12345, { maxRounds: '2' }));
  assert.equal(s.isComplete, true);
  assert.equal(s.maxRounds, 2);
  assert.equal(s.territoryCount[s.teams[0].id], 2);
  assert.equal(s.territoryCount[s.teams[1].id], 1);
  assert.equal(s.winnerTeamId, s.teams[0].id, 'A holds two territories to B\'s one');
});
t('a round cap tie on territory is broken by shields banked', () => {
  const ids = P(2);
  const visits = [
    V([T(6, 'Double')], true), // A reinforces home to 2 shields
    V([T(11)], true), // B reinforces home to 1 shield — round 1 -> 2, cap reached
  ];
  const s = replay(payload(ids, visits, solo(ids), 12345, { maxRounds: '1' }));
  assert.equal(s.isComplete, true);
  assert.equal(s.territoryCount[s.teams[0].id], 1);
  assert.equal(s.territoryCount[s.teams[1].id], 1);
  assert.equal(s.winnerTeamId, s.teams[0].id, 'tied on territory, A has more shields banked');
});
t('a round cap full tie is broken by seat order, deterministically', () => {
  const ids = P(2);
  const visits = [V([], true), V([], true)]; // both pass — round 1 -> 2, cap reached
  const s = replay(payload(ids, visits, solo(ids), 12345, { maxRounds: '1' }));
  assert.equal(s.isComplete, true);
  assert.equal(s.territoryCount[s.teams[0].id], 1);
  assert.equal(s.territoryCount[s.teams[1].id], 1);
  assert.equal(s.winnerTeamId, s.teams[0].id, 'tied in every respect, seat order decides');
});
t('round-cap standings list the runner-up behind the winner, not among the eliminated', () => {
  const ids = P(2);
  const visits = [V([], true), V([], true)];
  const s = replay(payload(ids, visits, solo(ids), 12345, { maxRounds: '1' }));
  assert.deepEqual(s.finalStandings, [ids[0], ids[1]]);
  assert.deepEqual(s.eliminationOrder, [], 'nobody was eliminated — the cap ended it');
});
t('a round cap does not delay a win that elimination already decided', () => {
  const ids = P(2);
  const s = replay(payload(ids, conquest, solo(ids), 12345, { maxRounds: '20' }));
  assert.equal(s.isComplete, true);
  assert.equal(s.winnerTeamId, s.teams[0].id);
  assert.ok(s.round < 20);
});

// ---------------------------------------------------------------- display hints
t('unreachable targets are greyed out', () => {
  const s = duel([]);
  // A holds only 6, whose wire neighbours are 13 and 10, so those and the bull are live.
  assert.ok(!s.deadTargets.includes(13));
  assert.ok(!s.deadTargets.includes(10));
  assert.ok(!s.deadTargets.includes('BULL'));
  assert.ok(!s.deadTargets.includes(6), 'your own territory is always a legal target');
  assert.ok(s.deadTargets.includes(12));
  assert.ok(s.deadTargets.includes(7), 'the numeric neighbour is not the board neighbour');
});
t('holding the bull leaves nothing greyed out', () => {
  const s = duel([V([T(25, 'Single')])]);
  assert.deepEqual(s.deadTargets, []);
});
t('everything is dead once the match is over', () => {
  assert.equal(deadTargetsFor(duel(conquest).territories, null).length, TERRITORY_IDS.length);
});

// ---------------------------------------------------------------- determinism
t('replaying the same log twice gives the same state', () => {
  const visits = [V([T(13), T(25, 'Single'), T(15)], true), V([T(14, 'Double')], true)];
  assert.equal(hashState(duel(visits)), hashState(duel(visits)));
});
t('the state hash moves when the map does', () => {
  assert.notEqual(hashState(duel([])), hashState(duel([V([T(10)])])));
});
t('event keys are stable as darts are appended', () => {
  const prefix = [V([T(7), T(8)])];
  const longer = [V([prefix[0].throws[0], prefix[0].throws[1], T(9)])];
  const before = duel(prefix).events.map((e) => e.key);
  const after = duel(longer).events.map((e) => e.key);
  assert.deepEqual(after.slice(0, before.length), before);
});
t('every event key in a match is unique', () => {
  const ids = P(3);
  const s = replay(
    payload(ids, [
      V([T(25, 'Single'), T(5), T(3, 'Double')], true),
      V([T(12), T(10), T(11, 'Triple')], true),
      V([T(18), T(16), T(17, 'Double')], true),
      V([T(11), T(11), T(11)], true),
    ])
  );
  const keys = s.events.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------- a full four-team match
t('a four-team match plays through to one winner', () => {
  const ids = P(4); // homes 18, 15, 7, 9
  const visits = [];
  // A grabs the bull, which puts every number in reach.
  visits.push(V([T(25, 'Single'), T(2), T(4)], true));
  for (let i = 1; i < 4; i++) visits.push(V([], true)); // the rest pass
  // A then takes each opponent's home in turn. Every other side still standing passes, so the darts
  // come back round to A — one fewer pass each time, because the side just knocked out is skipped.
  let alive = 4;
  for (const home of ['15', '7', '9']) {
    visits.push(V([T(Number(home)), T(Number(home)), T(Number(home))], true));
    alive -= 1;
    for (let i = 1; i < alive; i++) visits.push(V([], true));
  }
  const s = replay(payload(ids, visits));
  assert.equal(s.isComplete, true);
  assert.deepEqual(s.winnerPlayerIds, [ids[0]]);
  assert.deepEqual(s.finalStandings, [ids[0], ids[3], ids[2], ids[1]]);
  assert.equal(s.territoryCount[s.teams[0].id] > 0, true);
  assert.equal(DARTS_PER_TURN, 3);
});

console.log(`\n  ${pass} passed, ${fail.length} failed`);
if (fail.length) {
  fail.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(1);
}
