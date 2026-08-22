import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode } from "@wendoo-lang/core/runtime";
import { flashDiagnosticToEntry, runtimeFaultToEntry } from "./brain-diagnostic-entries";
import type { InstanceFiberFault } from "./simulator";

describe("flashDiagnosticToEntry", () => {
  it("carries the flash message verbatim and the WODAL code as the location", () => {
    const entry = flashDiagnosticToEntry({ code: "WODAL_BUILD_BRAIN_LINK_FAILED", message: "linker exploded" });
    assert.equal(entry.message, "linker exploded");
    assert.equal(entry.location, "WODAL_BUILD_BRAIN_LINK_FAILED");
  });
});

describe("runtimeFaultToEntry", () => {
  const baseFault = (err: InstanceFiberFault["err"]): InstanceFiberFault => ({
    instanceId: "instance-1",
    brainId: "brain-1",
    fiberId: 7,
    err,
  });

  it("uses the error's message verbatim when present", () => {
    const entry = runtimeFaultToEntry(baseFault({ code: ErrorCode.ScriptError, message: "Cannot read property x" }));
    assert.equal(entry.message, "Cannot read property x");
    assert.equal(entry.code, ErrorCode.ScriptError);
  });

  it("synthesizes a message only when the error carries none", () => {
    const entry = runtimeFaultToEntry(baseFault({ code: ErrorCode.ScriptError, message: "   " }));
    assert.equal(entry.message.includes(String(ErrorCode.ScriptError)), true);
  });
});
