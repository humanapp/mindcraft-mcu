import { findBuiltInSound } from "./mindcraft/built-in-sounds";

/** The sound currently holding the speaker lease, as exposed to app adapters. */
export interface SpeakerPlayingSnapshot {
  /** Name of the playing built-in sound. */
  readonly name: string;

  /** Logical tick time at which the play began. */
  readonly startedAt: number;

  /** Nominal total duration in milliseconds; the lease runs to `startedAt + durationMs`. */
  readonly durationMs: number;

  /** Monotonic per-play nonce; a new value marks a new play. */
  readonly playId: number;
}

/** Snapshot of the speaker state exposed to app adapters. */
export interface MicroBitSpeakerSnapshot {
  /** The playing sound, or undefined while the speaker is idle. */
  readonly playing: SpeakerPlayingSnapshot | undefined;
}

/** A built-in sound play holding the speaker lease until its nominal duration elapses. */
interface ActivePlay {
  /** Name of the playing built-in sound. */
  readonly name: string;

  /** Logical tick time at which the play began. */
  readonly startedAt: number;

  /** Nominal total duration in milliseconds. */
  readonly durationMs: number;

  /** Monotonic per-play nonce. */
  readonly playId: number;

  /** Invoked once when the play completes. */
  readonly onComplete: () => void;
}

/**
 * CODAL-style speaker facade: a single sound output leased by the playing
 * built-in sound for its nominal duration against logical tick time,
 * mirroring the display lease mechanics.
 */
export class MicroBitSpeaker {
  /** The play holding the speaker lease, or undefined while idle. */
  private activePlay: ActivePlay | undefined;

  /** Per-play nonce source; increments on every accepted play. */
  private nextPlayId = 0;

  /**
   * Starts an asynchronous built-in sound play requested at logical tick time
   * `requestTime`. An accepted play takes the speaker lease for the sound's
   * nominal total duration; the lease is settled by {@link advancePlay} and
   * `onComplete` fires once the duration has elapsed. When the speaker is
   * already busy the new play is silently dropped: nothing plays and
   * `onComplete` fires at once, so the dispatching fiber continues without
   * blocking. A name outside the built-in set is a silent no-op: nothing
   * plays, no lease is taken, and `onComplete` fires at once.
   *
   * @param name - Name of the built-in sound to play.
   * @param requestTime - Logical tick time the play was requested.
   * @param onComplete - Invoked once when the play completes (or at once when dropped or a no-op).
   */
  playSoundEmoji(name: string, requestTime: number, onComplete: () => void): void {
    if (this.activePlay !== undefined) {
      onComplete();
      return;
    }
    const def = findBuiltInSound(name);
    if (def === undefined) {
      onComplete();
      return;
    }
    this.nextPlayId += 1;
    this.activePlay = {
      name,
      startedAt: requestTime,
      durationMs: def.durationMs,
      playId: this.nextPlayId,
      onComplete,
    };
  }

  /** True while a play holds the speaker lease. */
  isBusy(): boolean {
    return this.activePlay !== undefined;
  }

  /**
   * Releases the current speaker lease at once: the held play is dropped and
   * its handle resolved, so its awaiting rule resumes as if the sound
   * finished. A no-op when no lease is held.
   */
  preempt(): void {
    const play = this.activePlay;
    if (play === undefined) {
      return;
    }
    this.activePlay = undefined;
    play.onComplete();
  }

  /**
   * Completes the active play (firing `onComplete`) once its nominal duration
   * has elapsed by `now`. This is the per-think speaker poll: it settles the
   * play holding the lease.
   *
   * @param now - Current logical tick time.
   */
  advancePlay(now: number): void {
    const play = this.activePlay;
    if (play === undefined || now < play.startedAt + play.durationMs) {
      return;
    }
    this.activePlay = undefined;
    play.onComplete();
  }

  /**
   * Resets the speaker to its power-on state: drops any held play without
   * resolving its handle (the whole runtime is resetting). Call whenever the
   * device timer resets.
   */
  reset(): void {
    this.activePlay = undefined;
  }

  /** Returns a serializable view of the speaker state. */
  snapshot(): MicroBitSpeakerSnapshot {
    const play = this.activePlay;
    return {
      playing:
        play === undefined
          ? undefined
          : { name: play.name, startedAt: play.startedAt, durationMs: play.durationMs, playId: play.playId },
    };
  }
}
