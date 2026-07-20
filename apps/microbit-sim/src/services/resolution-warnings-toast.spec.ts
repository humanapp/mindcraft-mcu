import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExtensionResolutionWarning } from "@mindcraft-lang/bridge-app";
import {
  RESOLUTION_WARNINGS_TOAST_ID,
  type ResolutionWarningsToastSource,
  startResolutionWarningsToast,
  type UnresolvedLibrariesToast,
} from "./resolution-warnings-toast";

function unresolvedTarget(origin: string): ExtensionResolutionWarning {
  return { kind: "unresolved-target", origin, message: "target resolves to no content" };
}

type PresenterEvent = { call: "show"; toast: UnresolvedLibrariesToast } | { call: "dismiss"; id: string };

function createHarness(initialWarnings: readonly ExtensionResolutionWarning[] = []) {
  let warnings = initialWarnings;
  const warningListeners = new Set<() => void>();
  const projectLoadedListeners = new Set<() => void>();
  const events: PresenterEvent[] = [];
  const source: ResolutionWarningsToastSource = {
    subscribeToResolutionWarnings(listener) {
      warningListeners.add(listener);
      return () => warningListeners.delete(listener);
    },
    getResolutionWarningsSnapshot: () => warnings,
    onProjectLoaded(listener) {
      projectLoadedListeners.add(listener);
      return () => projectLoadedListeners.delete(listener);
    },
  };
  return {
    source,
    presenter: {
      showWarning(toast: UnresolvedLibrariesToast) {
        events.push({ call: "show", toast });
      },
      dismiss(id: string) {
        events.push({ call: "dismiss", id });
      },
    },
    events,
    setWarnings(next: readonly ExtensionResolutionWarning[]) {
      warnings = next;
      for (const listener of [...warningListeners]) {
        listener();
      }
    },
    fireProjectLoaded() {
      for (const listener of [...projectLoadedListeners]) {
        listener();
      }
    },
    listenerCount: () => warningListeners.size + projectLoadedListeners.size,
    lastShow(): UnresolvedLibrariesToast {
      const shows = events.filter((event) => event.call === "show");
      assert.ok(shows.length > 0, "a show call was recorded");
      return (shows[shows.length - 1] as { call: "show"; toast: UnresolvedLibrariesToast }).toast;
    },
  };
}

describe("startResolutionWarningsToast", () => {
  test("issues one persistent warning toast for a non-empty initial snapshot", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a"), unresolvedTarget("org/lib-b")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    assert.equal(harness.events.length, 1);
    const shown = harness.lastShow();
    assert.equal(shown.id, RESOLUTION_WARNINGS_TOAST_ID);
    assert.equal(shown.duration, Number.POSITIVE_INFINITY);
    assert.equal(shown.closeButton, true);
    assert.deepEqual(shown.coordinates, ["org/lib-a", "org/lib-b"]);
    assert.equal(shown.overflowCount, 0);
  });

  test("caps displayed coordinates at three and reports the overflow count", () => {
    const origins = ["org/lib-a", "org/lib-b", "org/lib-c", "org/lib-d", "org/lib-e"];
    const harness = createHarness(origins.map(unresolvedTarget));
    startResolutionWarningsToast(harness.source, harness.presenter);
    const shown = harness.lastShow();
    assert.deepEqual(shown.coordinates, ["org/lib-a", "org/lib-b", "org/lib-c"]);
    assert.equal(shown.overflowCount, 2);
  });

  test("an empty snapshot makes no toast calls", () => {
    const harness = createHarness();
    startResolutionWarningsToast(harness.source, harness.presenter);
    harness.setWarnings([]);
    assert.deepEqual(harness.events, []);
  });

  test("an unchanged signature does not re-issue the toast", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a"), unresolvedTarget("org/lib-b")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    // Same coordinate set in a different encounter order: same signature.
    harness.setWarnings([unresolvedTarget("org/lib-b"), unresolvedTarget("org/lib-a")]);
    assert.equal(harness.events.length, 1);
  });

  test("a changed signature updates the toast in place under the same id", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    harness.setWarnings([unresolvedTarget("org/lib-a"), unresolvedTarget("org/lib-b")]);
    assert.deepEqual(
      harness.events.map((event) => event.call),
      ["show", "show"]
    );
    const shown = harness.lastShow();
    assert.equal(shown.id, RESOLUTION_WARNINGS_TOAST_ID);
    assert.deepEqual(shown.coordinates, ["org/lib-a", "org/lib-b"]);
  });

  test("dismisses the toast when the set heals and re-issues when warnings return", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    harness.setWarnings([]);
    assert.deepEqual(harness.events[1], { call: "dismiss", id: RESOLUTION_WARNINGS_TOAST_ID });
    harness.setWarnings([unresolvedTarget("org/lib-a")]);
    assert.deepEqual(
      harness.events.map((event) => event.call),
      ["show", "dismiss", "show"]
    );
  });

  test("a user-dismissed signature stays dismissed until the signature changes", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    harness.lastShow().onDismiss();
    harness.setWarnings([unresolvedTarget("org/lib-a")]);
    assert.equal(harness.events.length, 1);
    harness.setWarnings([unresolvedTarget("org/lib-a"), unresolvedTarget("org/lib-b")]);
    assert.deepEqual(
      harness.events.map((event) => event.call),
      ["show", "show"]
    );
    assert.deepEqual(harness.lastShow().coordinates, ["org/lib-a", "org/lib-b"]);
  });

  test("a project load re-notifies a dismissed signature that still yields warnings", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    harness.lastShow().onDismiss();
    harness.fireProjectLoaded();
    assert.deepEqual(
      harness.events.map((event) => event.call),
      ["show", "show"]
    );
  });

  test("a programmatic heal dismissal does not count as user dismissal", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a")]);
    startResolutionWarningsToast(harness.source, harness.presenter);
    const shown = harness.lastShow();
    harness.setWarnings([]);
    // The presenter may fire the dismissal callback for the toast it removed.
    shown.onDismiss();
    harness.setWarnings([unresolvedTarget("org/lib-a")]);
    assert.deepEqual(
      harness.events.map((event) => event.call),
      ["show", "dismiss", "show"]
    );
  });

  test("stop dismisses the shown toast and stops observing the source", () => {
    const harness = createHarness([unresolvedTarget("org/lib-a")]);
    const stop = startResolutionWarningsToast(harness.source, harness.presenter);
    stop();
    assert.deepEqual(harness.events[1], { call: "dismiss", id: RESOLUTION_WARNINGS_TOAST_ID });
    assert.equal(harness.listenerCount(), 0);
    harness.setWarnings([unresolvedTarget("org/lib-b")]);
    assert.equal(harness.events.length, 2);
  });

  test("stop with no toast showing makes no dismiss call", () => {
    const harness = createHarness();
    const stop = startResolutionWarningsToast(harness.source, harness.presenter);
    stop();
    assert.deepEqual(harness.events, []);
  });
});
