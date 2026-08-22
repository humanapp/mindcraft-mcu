import type { ExtensionResolutionWarning } from "@wendoo-lang/bridge-app";
import { unresolvedLibraryCoordinates } from "./resolution-warnings";

/** Stable id of the unresolved-libraries warning toast. Re-issuing with this id updates the toast in place. */
export const RESOLUTION_WARNINGS_TOAST_ID = "unresolved-libraries";

/** Maximum coordinates displayed in the toast; the remainder collapses into the overflow count. */
const MAX_VISIBLE_COORDINATES = 3;

/** Data payload for one issue or in-place update of the unresolved-libraries warning toast. */
export interface UnresolvedLibrariesToast {
  /** Stable toast id ({@link RESOLUTION_WARNINGS_TOAST_ID}). */
  id: string;
  /** Toast lifetime in milliseconds; `Number.POSITIVE_INFINITY` means the toast never auto-dismisses. */
  duration: number;
  /** Whether the toast carries a close button for user dismissal. */
  closeButton: boolean;
  /** Unresolved `<owner>/<repo>` coordinates to display, in encounter order, at most three. */
  coordinates: readonly string[];
  /** Count of unresolved libraries beyond {@link coordinates}; zero when all fit. */
  overflowCount: number;
  /** Reports that the user dismissed the toast. The presenter wires this to its dismissal callback. */
  onDismiss: () => void;
}

/** Toast presentation surface the controller drives. */
export interface ResolutionWarningsToastPresenter {
  /** Issues the warning toast, or updates it in place when one with the same id is already showing. */
  showWarning(warningToast: UnresolvedLibrariesToast): void;
  /** Removes the toast with the given id, if showing. */
  dismiss(id: string): void;
}

/** The store surface the controller observes. */
export interface ResolutionWarningsToastSource {
  /** Subscribes to resolution-warning changes. Returns an unsubscribe function. */
  subscribeToResolutionWarnings(listener: () => void): () => void;
  /** Snapshot of the active project's latest resolution warnings. */
  getResolutionWarningsSnapshot(): readonly ExtensionResolutionWarning[];
  /** Registers a listener fired after a project finishes loading. Returns an unsubscribe function. */
  onProjectLoaded(listener: () => void): () => void;
}

/**
 * Keeps the persistent unresolved-libraries warning toast in sync with the
 * source's resolution warnings: a non-empty unresolved set shows or updates
 * the single stable-id toast, and the toast is dismissed the moment the set
 * empties. A signature the user dismissed stays dismissed while it persists;
 * it re-notifies when the signature changes or on the next project load that
 * still yields a non-empty set. Dismissal state lives only in this controller
 * instance. Returns a stop function that unsubscribes and removes the toast.
 *
 * @param source - Warning snapshots and project-load notifications.
 * @param presenter - The toast surface to drive.
 */
export function startResolutionWarningsToast(
  source: ResolutionWarningsToastSource,
  presenter: ResolutionWarningsToastPresenter
): () => void {
  // Signature of the currently showing toast, or undefined when none shows.
  let shownSignature: string | undefined;
  // Signature the user dismissed; suppresses re-notification while it persists.
  let dismissedSignature: string | undefined;

  const handleUserDismiss = (signature: string): void => {
    // A dismissal for a signature that is no longer showing (already healed
    // or replaced) records nothing.
    if (shownSignature === signature) {
      shownSignature = undefined;
      dismissedSignature = signature;
    }
  };

  const dismissIfShowing = (): void => {
    if (shownSignature !== undefined) {
      shownSignature = undefined;
      presenter.dismiss(RESOLUTION_WARNINGS_TOAST_ID);
    }
  };

  const evaluate = (freshNotification: boolean): void => {
    const coordinates = unresolvedLibraryCoordinates(source.getResolutionWarningsSnapshot());
    const signature = [...coordinates].sort().join("\n");
    if (freshNotification || dismissedSignature !== signature) {
      dismissedSignature = undefined;
    }
    if (coordinates.length === 0) {
      dismissIfShowing();
      return;
    }
    if (dismissedSignature === signature || shownSignature === signature) {
      return;
    }
    shownSignature = signature;
    presenter.showWarning({
      id: RESOLUTION_WARNINGS_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      coordinates: coordinates.slice(0, MAX_VISIBLE_COORDINATES),
      overflowCount: Math.max(0, coordinates.length - MAX_VISIBLE_COORDINATES),
      onDismiss: () => handleUserDismiss(signature),
    });
  };

  const unsubscribeWarnings = source.subscribeToResolutionWarnings(() => evaluate(false));
  const unsubscribeProjectLoaded = source.onProjectLoaded(() => evaluate(true));
  evaluate(false);

  return () => {
    unsubscribeWarnings();
    unsubscribeProjectLoaded();
    dismissIfShowing();
  };
}
