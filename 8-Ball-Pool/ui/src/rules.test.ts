import { describe, expect, it } from "vitest";
import { buildTeams, effectiveGroupIndex, hashLog, hashState, replay } from "./rules";
import { makeThrow } from "./rules/testUtils";
import type { ClientGamePayload } from "../../shared/types";

const PLAYER_IDS = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];

function payload(overrides: Partial<ClientGamePayload> = {}): ClientGamePayload {
  return {
    seed: 12345,
    playerIds: PLAYER_IDS,
    options: {},
    playerGroups: { [PLAYER_IDS[0]]: 0, [PLAYER_IDS[1]]: 1 },
    visits: [],
    ...overrides,
  };
}

describe("replay()", () => {
  it("returns an empty, non-throwing state for a match with no players", () => {
    const state = replay({ seed: 0, playerIds: [], options: {}, playerGroups: {}, visits: [] });
    expect(state.teams).toEqual([]);
    expect(state.isComplete).toBe(false);
    expect(state.table.balls).toHaveLength(16);
  });

  it("starts with a full rack, an open table, and the breaking team's player up", () => {
    const state = replay(payload());
    expect(state.table.balls.filter((b) => !b.pocketed)).toHaveLength(16);
    expect(state.table.tableOpen).toBe(true);
    expect(PLAYER_IDS).toContain(state.currentPlayerId);
    expect(state.isComplete).toBe(false);
  });

  it("is a pure function: replaying the same payload twice gives identical hashes", () => {
    const p = payload({
      visits: [{ throws: [makeThrow({ segment: 20, ring: "OuterSingle" })], ended: false }],
    });
    const a = replay(p);
    const b = replay(p);
    expect(hashState(a)).toBe(hashState(b));
    expect(hashLog(p)).toBe(hashLog(p));
  });

  it("shows a partial visit's darts without firing a shot", () => {
    const p = payload({
      options: { difficulty: "advanced" },
      visits: [{ throws: [makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 1, y: 0 } })], ended: false }],
    });
    const state = replay(p);
    expect(state.currentVisitThrows).toHaveLength(1);
    expect(state.lastShot).toBeNull();
    expect(state.shotPhase.kind).toBe("collecting");
  });

  it("resolves the break shot into a completed shot with a trajectory", () => {
    const p = payload({
      options: { difficulty: "advanced" },
      visits: [
        {
          throws: [
            makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 0, y: 1 } }), // straight at the rack
            makeThrow({ segment: 20, ring: "OuterSingle" }), // full power
            makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }), // no spin
          ],
          ended: false,
        },
      ],
    });
    const state = replay(p);
    expect(state.lastShot).not.toBeNull();
    expect(state.lastShot!.isBreak).toBe(true);
    expect(state.lastShot!.trajectory).toBeDefined();
    expect(state.lastShot!.trajectory!.length).toBeGreaterThan(1);
  });

  it("exposes a non-null lastShotId once a shot has fired, keyed off the visit and darts consumed", () => {
    const p = payload({
      options: { difficulty: "advanced" },
      visits: [
        {
          throws: [
            makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 0, y: 1 } }), // straight at the rack
            makeThrow({ segment: 20, ring: "OuterSingle" }), // full power
            makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }), // no spin
          ],
          ended: false,
        },
      ],
    });
    const state = replay(p);
    // See turnEngine.test.ts's "gives a second shot folded into the same visit its own dartsIntoVisit" for
    // the regression this id exists to fix: BoardScene keys its replay-animation trigger off `lastShotId`
    // changing, instead of a latch that only ever fired once per visit (see boardscene-animation memory).
    expect(state.lastShotId).toBe(`0:${state.lastShot!.dartsIntoVisit}`);
  });

  it("previews the auto-placed cue ball on the table during ball-in-hand, instead of leaving it hidden", () => {
    const p = payload({
      options: { difficulty: "advanced" },
      visits: [
        {
          // Straight up off the head spot: clears the top rail well away from any pocket and nowhere
          // near the racked balls (clustered around the foot spot), so this is a clean "no contact" foul.
          throws: [
            makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 0, y: 1 } }),
            makeThrow({ segment: 20, ring: "OuterSingle" }),
            makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }),
          ],
          ended: false,
        },
      ],
    });
    const state = replay(p);

    expect(state.lastShot!.foul).toBe("noContact");
    expect(state.shotPhase.kind).toBe("ballInHand");
    expect(state.ballInHandPending).toBe(true);

    // Before this fix, the cue ball stayed wherever the fouling shot left it (or hidden if pocketed)
    // until the next player's darts were actually thrown — nothing on the table told them where a shot
    // would even start from.
    const cue = state.table.balls.find((b) => b.id === "cue")!;
    expect(cue.pocketed).toBe(false);
    expect(cue.pos.x).toBeGreaterThanOrEqual(0);
    expect(cue.pos.x).toBeLessThanOrEqual(2);
    expect(cue.pos.y).toBeGreaterThanOrEqual(0);
    expect(cue.pos.y).toBeLessThanOrEqual(1);
  });

  it("accumulates pocketedOrder for the sunk-balls tray, excluding the cue ball", () => {
    const p = payload({
      options: { difficulty: "advanced" },
      visits: [
        {
          throws: [
            makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 0, y: 1 } }),
            makeThrow({ segment: 20, ring: "OuterSingle" }),
            makeThrow({ segment: 20, ring: "OuterSingle", position: { x: 0, y: 0 } }),
          ],
          ended: false,
        },
      ],
    });
    const state = replay(p);
    expect(state.pocketedOrder.every((b) => b.ballId !== "cue")).toBe(true);
    const pocketedIds = new Set(state.table.balls.filter((b) => b.pocketed && b.id !== "cue").map((b) => b.id));
    expect(new Set(state.pocketedOrder.map((b) => b.ballId))).toEqual(pocketedIds);
  });
});

describe("buildTeams / effectiveGroupIndex", () => {
  it("groups an ungrouped roster into teams of one", () => {
    const p = { seed: 0, playerIds: PLAYER_IDS, options: {}, playerGroups: {}, visits: [] };
    expect(effectiveGroupIndex(p, PLAYER_IDS[1])).toBe(1);
    expect(buildTeams(p)).toEqual([
      { groupIndex: 0, playerIds: [PLAYER_IDS[0]] },
      { groupIndex: 1, playerIds: [PLAYER_IDS[1]] },
    ]);
  });
});
