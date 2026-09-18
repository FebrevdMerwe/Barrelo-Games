import Phaser from 'phaser';
import type {
  BarreloDisplayMessage,
  BarreloGameStateMessage,
  BarreloMatchCompleteMessage,
  ClientGamePayload,
} from '../../shared/types';
import { hashLog, hashState, replay, type GameState } from './rules';

/**
 * The whole boundary between Barrelo and Killer.
 *
 * Down: Barrelo's page embeds ui/index.html in a sandboxed <iframe> and posts
 * `{ type: "barrelo:gameState", snapshot, playerNames }` on every state change. The snapshot carries
 * the visit log; the rules are re-derived from it here, in replay().
 *
 * Up: Killer owns its own rules, so Barrelo doesn't know whose turn it is, which numbers are still
 * in play, or when the match is over. All of it is reported back — display hints on every state
 * change, and the final result exactly once.
 *
 * Scenes subscribe to GAME_STATE_EVENT rather than reading window.postMessage directly, so they
 * never need to know how any of this arrives.
 */
export const GAME_STATE_EVENT = 'barrelo:gameState';

export interface BoardUpdate {
  state: GameState;
  payload: ClientGamePayload;
  playerNames: Record<string, string>;
}

export const gameStateEvents = new Phaser.Events.EventEmitter();

/**
 * The last update received, retained because Barrelo pushes only when state *changes*. A board that
 * is still booting — Boot and Preloader both run before BoardScene subscribes — would otherwise miss
 * the push that arrives on page load and sit blank until the next dart. Scenes call this in create()
 * to catch up, then rely on the event from then on.
 */
let latestUpdate: BoardUpdate | null = null;

export function getLatestUpdate(): BoardUpdate | null {
  return latestUpdate;
}

/**
 * Production pins the origin: Barrelo serves both its shell and /plugins/killer/ui/index.html from
 * the same origin, so this is an exact match. The dev harness is a file:// page whose origin is the
 * string "null" and can never match the Vite origin this iframe reports — pinning there would make
 * the browser silently drop every message, including the matchComplete you most need to inspect.
 */
const TARGET_ORIGIN = import.meta.env.DEV ? '*' : window.location.origin;

function postToBarrelo(message: BarreloDisplayMessage | BarreloMatchCompleteMessage): void {
  // Only meaningful when embedded; standalone `npm run dev` has no host to talk to.
  if (window.parent === window.self) return;
  window.parent.postMessage(message, TARGET_ORIGIN);
}

let reportedComplete = false;
let warnedUnComplete = false;

function publish(
  snapshot: BarreloGameStateMessage['snapshot'],
  playerNames: Record<string, string>
): void {
  const payload = snapshot.payload;
  const state = replay(payload);

  latestUpdate = { state, payload, playerNames };
  gameStateEvents.emit(GAME_STATE_EVENT, latestUpdate);

  postToBarrelo({
    type: 'barrelo:display',
    currentPlayerId: state.currentPlayerId,
    visitThrows: state.currentVisitThrows,
    deadTargets: state.deadTargets,
    logHash: hashLog(payload),
    stateHash: hashState(state),
  });

  // Reported once and only once: Barrelo ends the session on the first one, so a second would
  // arrive when there is no longer an active match to end. Note the host only treats the match as
  // ended once its own POST /api/session/result succeeds, while this latch flips before posting and
  // never retries — a failed post leaves the match open with no second chance.
  if (state.isComplete && !reportedComplete) {
    reportedComplete = true;
    warnedUnComplete = false;
    postToBarrelo({
      type: 'barrelo:matchComplete',
      winnerPlayerIds: state.winnerPlayerIds,
      finalStandings: state.finalStandings,
    });
  } else if (!state.isComplete && reportedComplete && !warnedUnComplete) {
    // Undo after a victory. The session is already closed host-side, so re-reporting would race
    // against a match that no longer exists; the board still re-renders the reverted state. Warned
    // on the transition only — the latch stays set, so without this every later push would repeat it.
    warnedUnComplete = true;
    console.warn('[killer] match un-completed by an undo — result already reported to Barrelo');
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as Partial<BarreloGameStateMessage> | undefined;
  if (!data || data.type !== 'barrelo:gameState' || !data.snapshot) return;
  publish(data.snapshot, data.playerNames ?? {});
});

// Dev-mode preview: when running standalone via `npm run dev` (no Barrelo host iframe around us),
// there's nothing posting real snapshots in. Feed a canned four-player roster so the board is
// visible while you iterate on rendering. Never runs in a production build or when embedded.
if (import.meta.env.DEV && window.self === window.top) {
  const ids = [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
  ];
  const samplePayload: ClientGamePayload = {
    seed: 12345,
    playerIds: ids,
    options: {},
    playerGroups: Object.fromEntries(ids.map((id, i) => [id, i])),
    visits: [],
  };

  window.setTimeout(() => {
    latestUpdate = {
      state: replay(samplePayload),
      payload: samplePayload,
      playerNames: { [ids[0]]: 'Alex', [ids[1]]: 'Sam', [ids[2]]: 'Robin', [ids[3]]: 'Jo' },
    };
    gameStateEvents.emit(GAME_STATE_EVENT, latestUpdate);
  }, 200);
}
