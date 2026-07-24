import type { BrainDiagnosticEntry } from "@mindcraft-lang/bridge-app";
import type { FlashDiagnostic, InstanceFiberFault } from "./simulator";

/**
 * Maps a failed flash's diagnostic into a {@link BrainDiagnosticEntry} for the
 * brain diagnostics surfaces. The WODAL build code becomes the row's location
 * prefix and the message is carried verbatim. A flash failure has no numeric
 * parse/type code, so `code` is 0.
 *
 * @param diagnostic - The flash failure to map.
 */
export function flashDiagnosticToEntry(diagnostic: FlashDiagnostic): BrainDiagnosticEntry {
  return { code: 0, location: diagnostic.code, message: diagnostic.message };
}

/**
 * Maps a VM fiber fault into a {@link BrainDiagnosticEntry} for the brain
 * runtime-fault panel. The error's own message is used verbatim when present;
 * a fault with no usable message gets a synthesized message naming its code.
 *
 * @param fault - The runtime fiber fault to map.
 */
export function runtimeFaultToEntry(fault: InstanceFiberFault): BrainDiagnosticEntry {
  const message = fault.err.message.trim().length > 0 ? fault.err.message : `Runtime fault (code ${fault.err.code}).`;
  return { code: fault.err.code, location: `fiber ${fault.fiberId}`, message };
}
