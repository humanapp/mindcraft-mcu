import { OperationEnd, type OperationEndListener } from "../../core/operation-end";
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

  /** Invoked once with how the play ended. */
  readonly onEnd: OperationEndListener;
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
   * `onEnd` fires once the duration has elapsed. When the speaker is already
   * busy the new play is dropped: nothing plays and `onEnd` fires at once with
   * {@link OperationEnd.Dropped}, so the dispatching fiber continues without
   * blocking. A name outside the built-in set is dropped the same way: nothing
   * plays and no lease is taken.
   *
   * @param name - Name of the built-in sound to play.
   * @param requestTime - Logical tick time the play was requested.
   * @param onEnd - Invoked once with how the play ended, at the moment it ends.
   */
  playSoundEmoji(name: string, requestTime: number, onEnd: OperationEndListener): void {
    if (this.activePlay !== undefined) {
      onEnd(OperationEnd.Dropped);
      return;
    }
    const def = findBuiltInSound(name);
    if (def === undefined) {
      onEnd(OperationEnd.Dropped);
      return;
    }
    this.nextPlayId += 1;
    this.activePlay = {
      name,
      startedAt: requestTime,
      durationMs: def.durationMs,
      playId: this.nextPlayId,
      onEnd,
    };
  }

  /** True while a play holds the speaker lease. */
  isBusy(): boolean {
    return this.activePlay !== undefined;
  }

  /**
   * Releases the current speaker lease at once: the held play ends as
   * {@link OperationEnd.Preempted}. A no-op when no lease is held.
   */
  preempt(): void {
    const play = this.activePlay;
    if (play === undefined) {
      return;
    }
    this.activePlay = undefined;
    play.onEnd(OperationEnd.Preempted);
  }

  /**
   * Completes the active play (firing `onEnd`) once its nominal duration has
   * elapsed by `now`. This is the per-think speaker poll: it settles the play
   * holding the lease.
   *
   * @param now - Current logical tick time.
   */
  advancePlay(now: number): void {
    const play = this.activePlay;
    if (play === undefined || now < play.startedAt + play.durationMs) {
      return;
    }
    this.activePlay = undefined;
    play.onEnd(OperationEnd.Completed);
  }

  /**
   * Resets the speaker to its power-on state: drops any held play without
   * firing its `onEnd`. Call whenever the device timer resets.
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
