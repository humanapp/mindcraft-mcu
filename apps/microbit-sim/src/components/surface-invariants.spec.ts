import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

function componentSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

/**
 * Identifiers of brain-diagnostic state. Device surfaces render device state
 * only and the toast path carries no diagnostics, so none of these may appear
 * in those components.
 */
const BRAIN_DIAGNOSTIC_IDENTIFIERS = [
  /flashState\.errors/,
  /flash\.errors/,
  /FlashDiagnostic/,
  /typecheckResult/i,
  /BrainDiagnosticEntry/,
  /newProblems/,
  /resolvedProblems/,
];

const DEVICE_COMPONENTS = ["InstanceCard.tsx", "MicrobitDevice.tsx", "Simulator.tsx"];

describe("device surfaces consume no brain-diagnostic state", () => {
  for (const component of DEVICE_COMPONENTS) {
    test(`${component} references no brain-diagnostic identifier`, () => {
      const source = componentSource(component);
      for (const identifier of BRAIN_DIAGNOSTIC_IDENTIFIERS) {
        assert.doesNotMatch(source, identifier);
      }
    });
  }
});

/**
 * Diagnostic-payload accesses of the install report. The toast path presents
 * through the shared presenter, whose payloads carry no diagnostics, so the
 * component never reads the report's problem lists.
 */
const REPORT_DIAGNOSTIC_ACCESSES = [
  /outcome\.newProblems/,
  /outcome\.resolvedProblems/,
  /typecheckResult/i,
  /BrainDiagnosticEntry/,
  /FlashDiagnostic/,
];

describe("the extension toast path consumes no brain-diagnostic state", () => {
  test("ProjectHeader.tsx references no diagnostic payload of the install report", () => {
    const source = componentSource("ProjectHeader.tsx");
    for (const identifier of REPORT_DIAGNOSTIC_ACCESSES) {
      assert.doesNotMatch(source, identifier);
    }
  });
});
