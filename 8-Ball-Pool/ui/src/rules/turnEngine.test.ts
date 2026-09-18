import { describe, expect, it } from "vitest";
import type { Ball } from "../physics/ball";
import { HEAD_SPOT, POCKETS } from "../physics/table";
import { evaluatePotCandidate } from "./geometry";
import { makeThrow } from "./testUtils";
import { applyVisit, computeRecommendation } from "./turnEngine";
import type { TableState, Team, TurnState } from "./types";

const teams: Team[] = [
  { groupIndex: 0, playerIds: ["p1"] },
  { groupIndex: 1, playerIds: ["p2"] },
];

function freshTurn(overrides: Partial<TurnState> = {}): TurnState {
  return {
    teamIndex: 0,
    memberIndexByGroup: { 0: 0, 1: 0 },
    breakingTeamIndex: 0,
    hasBroken: true,
    ballInHandPending: false,
    ballInHandIsScratch: false,
    ...overrides,
  };
}

function ball(id: string, kind: Ball["kind"], number: number, pos: { x: number; y: number }): Ball {
  return { id, kind, number, pos, vel: { x: 0, y: 0 }, pocketed: false };
}

describe("applyVisit (§16-18, §23)", () => {
  it("pots a ball, assigns groups, and continues the shooter's turn", () => {
    const cuePos = { x: 0.5, y: 0.5 };
    const one = ball("1", "solid", 1, { x: 1.0, y: 0.5 });
    const table: TableState = {
      // Kept well clear of the cue->object->pocket line so they don't accidentally block the shot.
      balls: [ball("cue", "cue", 0, cuePos), one, ball("9", "stripe", 9, { x: 0.2, y: 0.85 }), ball("8", "eight", 8, { x: 0.2, y: 0.15 })],
      tableOpen: true,
      groupByTeam: {},
    };
    const pocket = POCKETS.find((p) => p.id === "bottomRight")!;
    const candidate = evaluatePotCandidate(cuePos, one, pocket)!;
    expect(candidate).not.toBeNull();

    const darts = [
      makeThrow({ segment: 6, ring: "OuterSingle", position: candidate.cueToGhostUnit }),
      makeThrow({ segment: 20, ring: "OuterSingle" }),
      makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }),
    ];

    const result = applyVisit(table, freshTurn(), teams, "advanced", { throws: darts, ended: false }, false);

    expect(result.shot).not.toBeNull();
    expect(result.shot!.foul).toBeNull();
    expect(result.table.balls.find((b) => b.id === "1")!.pocketed).toBe(true);
    expect(result.table.tableOpen).toBe(false);
    expect(result.table.groupByTeam[0]).toBe("solids");
    expect(result.table.groupByTeam[1]).toBe("stripes");
    expect(result.shot!.groupAssigned).toBe(true);
    expect(result.shot!.turnContinues).toBe(true);
    expect(result.shot!.dartsIntoVisit).toBe(3); // all 3 darts consumed by this one shot
    // Turn continues: same team, same member.
    expect(result.turnState.teamIndex).toBe(0);
    expect(result.turnState.memberIndexByGroup[0]).toBe(0);
    expect(result.pocketedThisVisit).toEqual([{ ballId: "1", number: 1, kind: "solid" }]);
  });

  it("gives a second shot folded into the same visit its own dartsIntoVisit, distinct from the first", () => {
    const cuePos = { x: 0.5, y: 0.5 };
    const one = ball("1", "solid", 1, { x: 1.0, y: 0.5 });
    const table: TableState = {
      balls: [ball("cue", "cue", 0, cuePos), one, ball("9", "stripe", 9, { x: 0.2, y: 0.85 }), ball("8", "eight", 8, { x: 0.2, y: 0.15 })],
      tableOpen: true,
      groupByTeam: {},
    };
    const pocket = POCKETS.find((p) => p.id === "bottomRight")!;
    const candidate = evaluatePotCandidate(cuePos, one, pocket)!;
    expect(candidate).not.toBeNull();

    const darts = [
      // Shot 1: pots ball 1, keeping the turn (see the test above).
      makeThrow({ segment: 6, ring: "OuterSingle", position: candidate.cueToGhostUnit }),
      makeThrow({ segment: 20, ring: "OuterSingle" }),
      makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }),
      // Shot 2: Advanced always fires once 3 darts have landed (§10-13), regardless of whether any of
      // them actually hit anything, so this always folds into the same visit as a second, distinct shot.
      makeThrow({ segment: 11, ring: "OuterSingle", position: { x: 0.3, y: 0.4 } }),
      makeThrow({ segment: 20, ring: "OuterSingle" }),
      makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0.1, y: -0.2 } }),
    ];

    const result = applyVisit(table, freshTurn(), teams, "advanced", { throws: darts, ended: false }, false);

    expect(result.shot).not.toBeNull();
    // Regression: previously the board's animation gate (BoardScene's `lastShotId`) only ever changed once
    // per visit, so this second shot — despite firing with genuinely new physics — would never be detected
    // as "new" and would silently skip its roll animation.
    expect(result.shot!.dartsIntoVisit).toBe(6);
    expect(result.currentVisitThrows).toHaveLength(0);
  });

  it("keeps folding the same shooter's next shot out of the same still-open visit, no End Turn needed (§23.1)", () => {
    const cuePos = { x: 0.5, y: 0.5 };
    const one = ball("1", "solid", 1, { x: 1.0, y: 0.5 });
    const table: TableState = {
      balls: [ball("cue", "cue", 0, cuePos), one, ball("9", "stripe", 9, { x: 0.2, y: 0.85 }), ball("8", "eight", 8, { x: 0.2, y: 0.15 })],
      tableOpen: true,
      groupByTeam: {},
    };
    const recommended = computeRecommendation(table, teams, freshTurn());
    expect(recommended.tier).toBe("pot"); // sanity: this layout has a makeable pot for the recommender to aim

    // Beginner fires on the first hit and snaps to the recommender's exact aim (§6.4), so dart 1 alone
    // completes a shot that pots the recommended ball and keeps the shooter's turn. Dart 2 lands right
    // after, for the *next* shot, in the same visit — Barrelo hasn't closed it (`ended: false`) because
    // it's still the same player's turn.
    const darts = [
      makeThrow({ segment: recommended.recommendedSegment, ring: "OuterSingle" }),
      makeThrow({ segment: 0, ring: "Miss" }), // never a hit, whatever the next shot's recommended number is
    ];

    const result = applyVisit(table, freshTurn(), teams, "beginner", { throws: darts, ended: false }, false);

    expect(result.shot).not.toBeNull();
    expect(result.shot!.turnContinues).toBe(true);
    // Only dart 1 was consumed by this shot — proves a *second* shot folded into the same still-open
    // visit gets its own distinct `dartsIntoVisit` rather than inheriting the first shot's, which is what
    // lets the board (see BoardScene's `lastShotId`) tell the two shots apart and animate both.
    expect(result.shot!.dartsIntoVisit).toBe(1);
    expect(result.table.balls.find((b) => b.number === recommended.targetBallNumber)!.pocketed).toBe(true);
    // Dart 2 is already registered as in-progress toward the next shot — nobody had to press End Turn.
    expect(result.currentVisitThrows).toHaveLength(1);
    expect(result.currentVisitThrows[0]).toBe(darts[1]);
    const targetBall = table.balls.find((b) => b.number === recommended.targetBallNumber)!;
    expect(result.pocketedThisVisit).toEqual([{ ballId: targetBall.id, number: targetBall.number, kind: targetBall.kind }]);
  });

  it("a scratch fouls, passes the turn, and flags ball-in-hand for the opponent", () => {
    const cuePos = { x: 1.0, y: 0.5 };
    const table: TableState = {
      balls: [ball("cue", "cue", 0, cuePos), ball("1", "solid", 1, { x: 1.8, y: 0.15 })],
      tableOpen: true,
      groupByTeam: {},
    };
    // Aim straight at the top-middle pocket; nothing is in the way, so this both scratches and never
    // contacts an object ball. detectFoul checks the scratch condition first.
    const direction = { x: 0, y: 1 };
    const darts = [
      makeThrow({ segment: 20, ring: "OuterSingle", position: direction }),
      makeThrow({ segment: 20, ring: "OuterSingle" }),
      makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }),
    ];

    const result = applyVisit(table, freshTurn(), teams, "advanced", { throws: darts, ended: false }, false);

    expect(result.shot).not.toBeNull();
    expect(result.shot!.foul).toBe("scratch");
    expect(result.shot!.turnContinues).toBe(false);
    expect(result.shot!.groupAssigned).toBe(false);
    expect(result.table.tableOpen).toBe(true); // a foul shot never assigns groups (§16.3)
    expect(result.turnState.teamIndex).toBe(1); // turn passed to the other team
    expect(result.turnState.ballInHandPending).toBe(true);
    expect(result.turnState.ballInHandIsScratch).toBe(true);
    expect(result.pocketedThisVisit).toEqual([]); // the cue ball's own scratch never counts as a "pot"
  });

  it("excludes the break's re-spotted 8-ball from pocketedThisVisit even though it physically drops", () => {
    const cuePos = { x: 0.5, y: 0.5 };
    const eight = ball("8", "eight", 8, { x: 1.0, y: 0.5 });
    const table: TableState = {
      // breakRecommendation (used for the shot preview, not the actual aim here) needs an apex ball.
      balls: [ball("cue", "cue", 0, cuePos), eight, ball("1", "solid", 1, { x: 0.2, y: 0.85 })],
      tableOpen: true,
      groupByTeam: {},
    };
    const pocket = POCKETS.find((p) => p.id === "bottomRight")!;
    const candidate = evaluatePotCandidate(cuePos, eight, pocket)!;
    expect(candidate).not.toBeNull();

    const darts = [
      makeThrow({ segment: 6, ring: "OuterSingle", position: candidate.cueToGhostUnit }),
      makeThrow({ segment: 20, ring: "OuterSingle" }),
      makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }),
    ];

    const result = applyVisit(table, freshTurn({ hasBroken: false }), teams, "advanced", { throws: darts, ended: false }, false);

    expect(result.shot).not.toBeNull();
    expect(result.shot!.isBreak).toBe(true);
    expect(result.table.balls.find((b) => b.id === "8")!.pocketed).toBe(false); // re-spotted, §16.2
    expect(result.pocketedThisVisit).toEqual([]);
  });

  it("places the cue ball automatically before the next shot when ball-in-hand is pending", () => {
    const table: TableState = {
      balls: [ball("cue", "cue", 0, { x: -5, y: -5 }), ball("1", "solid", 1, { x: 1.0, y: 0.5 })],
      tableOpen: true,
      groupByTeam: {},
    };
    const turn = freshTurn({ ballInHandPending: true });
    const darts = [makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 1, y: 0 } })];

    const result = applyVisit(table, turn, teams, "advanced", { throws: darts, ended: false }, false);

    const cue = result.table.balls.find((b) => b.id === "cue")!;
    expect(cue.pos.x).toBeGreaterThanOrEqual(0);
    expect(cue.pos.x).toBeLessThanOrEqual(2);
    expect(cue.pos.y).toBeGreaterThanOrEqual(0);
    expect(cue.pos.y).toBeLessThanOrEqual(1);
    expect(result.turnState.ballInHandPending).toBe(false);
  });

  it("respots the cue ball at the break position (HEAD_SPOT) after a scratch, not the auto-placement grid", () => {
    const table: TableState = {
      balls: [ball("cue", "cue", 0, { x: -5, y: -5 }), ball("1", "solid", 1, { x: 1.0, y: 0.5 })],
      tableOpen: true,
      groupByTeam: {},
    };
    const turn = freshTurn({ ballInHandPending: true, ballInHandIsScratch: true });
    const darts = [makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 1, y: 0 } })];

    const result = applyVisit(table, turn, teams, "advanced", { throws: darts, ended: false }, false);

    const cue = result.table.balls.find((b) => b.id === "cue")!;
    expect(cue.pos).toEqual(HEAD_SPOT);
    expect(result.turnState.ballInHandPending).toBe(false);
    expect(result.turnState.ballInHandIsScratch).toBe(false);
  });

  it("an empty visit produces no shot and leaves state untouched", () => {
    const table: TableState = { balls: [ball("cue", "cue", 0, { x: 0.5, y: 0.5 })], tableOpen: true, groupByTeam: {} };
    const result = applyVisit(table, freshTurn(), teams, "beginner", { throws: [], ended: true }, false);
    expect(result.shot).toBeNull();
    expect(result.outcome).toBeNull();
    expect(result.turnState).toEqual(freshTurn());
  });
});
