import type { GameEvent } from '../rules';

export interface AbortableAnimation {
  /** Resolves when the animation finishes normally OR once abort() is called — never rejects. */
  done: Promise<void>;
  /** Synchronously kill everything this animation started, then resolve `done` if not already. */
  abort: () => void;
}

export type EventHandler = (event: GameEvent, pending: number) => AbortableAnimation;

/**
 * Drains queued GameEvents one at a time, awaiting each animation before starting the next — so a
 * burst of darts plays back in full and in order rather than jumping to the latest state.
 *
 * The handler is told how many events are still queued behind the one it is about to play, which is
 * how playback speeds up when the operator is throwing faster than the balls can roll.
 *
 * cancelAll() is the hard-resync escape hatch used when the event stream stops being an extension of
 * what was already played (an undo, or a board joining mid-match): it drops everything queued and
 * aborts whatever is animating, so the caller can snap straight to the derived state.
 *
 * `onIdle` fires once the queue has fully drained. It exists because the HUD must not repaint while
 * anything is still moving, and an animation cannot detect that itself: its own settle() runs while
 * drain() is still awaiting it, so `isIdle` is necessarily false at that moment. Only the queue
 * knows when the last event has actually finished.
 */
export class AnimationQueue {
  private queue: GameEvent[] = [];
  private current: AbortableAnimation | null = null;
  private draining = false;

  constructor(
    private readonly handler: EventHandler,
    private readonly onIdle: () => void = () => {}
  ) {}

  enqueue(events: GameEvent[]): void {
    this.queue.push(...events);
    void this.drain();
  }

  cancelAll(): void {
    this.queue.length = 0;
    this.current?.abort();
    this.current = null;
  }

  get isIdle(): boolean {
    return !this.draining && this.queue.length === 0;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      const animation = this.handler(event, this.queue.length);
      this.current = animation;
      await animation.done;
      if (this.current === animation) this.current = null;
    }
    this.draining = false;
    this.onIdle();
  }
}
