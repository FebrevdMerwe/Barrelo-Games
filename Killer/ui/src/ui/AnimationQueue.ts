import type { GameEvent } from '../rules';

export interface AbortableAnimation {
  /** Resolves when the animation finishes normally OR once abort() is called — never rejects. */
  done: Promise<void>;
  /** Synchronously kill every tween/timer this animation created, then resolve `done` if not already resolved. */
  abort: () => void;
}

export type EventHandler = (event: GameEvent) => AbortableAnimation;

/**
 * Drains queued GameEvents one at a time, awaiting each handler's animation before starting the
 * next — so a burst of events (e.g. multiple throws caught up in one poll) plays back in full,
 * in order, rather than skipping straight to the latest state.
 *
 * cancelAll() is the hard-resync escape hatch used when the event stream stops being an extension of
 * what was already played (an undo, or a board joining mid-match): it drops everything still queued
 * and aborts whatever is currently animating, so a caller can immediately snap all visuals to the
 * derived state with no animation left dangling.
 */
export class AnimationQueue {
  private queue: GameEvent[] = [];
  private current: AbortableAnimation | null = null;
  private draining = false;

  constructor(private readonly handler: EventHandler) {}

  enqueue(events: GameEvent[]): void {
    this.queue.push(...events);
    void this.drain();
  }

  cancelAll(): void {
    this.queue.length = 0;
    this.current?.abort();
  }

  get isIdle(): boolean {
    return !this.draining && this.queue.length === 0;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      const animation = this.handler(event);
      this.current = animation;
      await animation.done;
      if (this.current === animation) this.current = null;
    }
    this.draining = false;
  }
}
