import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BrainDiagnosticEntry } from "@wendoo-lang/bridge-app";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrainDiagnosticsList, BrainErrorBadge, toggledBrainId } from "./BrainDiagnostics";

function diagnostic(index: number): BrainDiagnosticEntry {
  return { code: 1008, location: `Page 1/Rule ${index + 1}`, message: `message ${index}` };
}

describe("BrainErrorBadge", () => {
  test("renders the badge with the error count and a collapsed chevron state", () => {
    const markup = renderToStaticMarkup(
      createElement(BrainErrorBadge, { count: 3, expanded: false, onToggle: () => undefined, brainName: "Driver" })
    );
    assert.match(markup, /data-testid="brain-error-badge"/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /data-testid="brain-error-count"[^>]*>3</);
  });

  test("reflects the expanded state on the toggle control", () => {
    const markup = renderToStaticMarkup(
      createElement(BrainErrorBadge, { count: 1, expanded: true, onToggle: () => undefined, brainName: "Driver" })
    );
    assert.match(markup, /aria-expanded="true"/);
  });
});

describe("BrainDiagnosticsList", () => {
  test("renders every diagnostic as its own row inside the scroll region", () => {
    const diagnostics = [0, 1, 2, 3, 4, 5].map(diagnostic);
    const markup = renderToStaticMarkup(createElement(BrainDiagnosticsList, { diagnostics }));
    assert.match(markup, /data-testid="brain-diagnostics"/);
    const rows = markup.match(/data-testid="brain-diagnostic-row"/g) ?? [];
    assert.equal(rows.length, 6, "every diagnostic renders as a row; overflow scrolls within the region");
  });

  test("renders each diagnostic's location and message", () => {
    const markup = renderToStaticMarkup(createElement(BrainDiagnosticsList, { diagnostics: [diagnostic(0)] }));
    assert.match(markup, /Page 1\/Rule 1/);
    assert.match(markup, /message 0/);
  });
});

describe("toggledBrainId", () => {
  test("expands an absent id and collapses a present one", () => {
    const expanded = toggledBrainId(new Set(), "b1");
    assert.deepEqual([...expanded], ["b1"]);
    const collapsed = toggledBrainId(expanded, "b1");
    assert.deepEqual([...collapsed], []);
  });

  test("toggles independently per brain", () => {
    const both = toggledBrainId(toggledBrainId(new Set(), "b1"), "b2");
    const withoutFirst = toggledBrainId(both, "b1");
    assert.deepEqual([...withoutFirst], ["b2"]);
  });
});
