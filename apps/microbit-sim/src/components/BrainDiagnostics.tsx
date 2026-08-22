import type { BrainDiagnosticEntry } from "@wendoo-lang/bridge-app";
import { Bug, ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import { ConsoleOutputList } from "./ConsoleOutputList";

/** The expanded-set after toggling one brain's diagnostics list: removes a present id, adds an absent one. */
export function toggledBrainId(expanded: ReadonlySet<string>, brainId: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (next.has(brainId)) {
    next.delete(brainId);
  } else {
    next.add(brainId);
  }
  return next;
}

interface BrainErrorBadgeProps {
  /** Number of error diagnostics the badge reports. */
  count: number;
  /** Whether the diagnostics list below the row is expanded. */
  expanded: boolean;
  /** Toggles the diagnostics list. */
  onToggle: () => void;
  /** Display name of the brain, for the accessible label. */
  brainName: string;
}

/** Error badge on a brain row: an icon, the error count, and the chevron toggling the diagnostics list. */
export function BrainErrorBadge({ count, expanded, onToggle, brainName }: BrainErrorBadgeProps) {
  return (
    <button
      type="button"
      data-testid="brain-error-badge"
      aria-expanded={expanded}
      aria-label={`Problems in ${brainName}`}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-muted"
      onClick={onToggle}
    >
      <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
      <span data-testid="brain-error-count">{count}</span>
      {expanded ? (
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
      ) : (
        <ChevronRight aria-hidden="true" className="h-3 w-3" />
      )}
    </button>
  );
}

interface BrainRuntimeFaultBadgeProps {
  /** Number of buffered runtime faults the badge reports. */
  count: number;
  /** Whether the diagnostics panel below the row is expanded. */
  expanded: boolean;
  /** Toggles the diagnostics panel. */
  onToggle: () => void;
  /** Display name of the brain, for the accessible label. */
  brainName: string;
}

/**
 * Runtime-fault badge on a brain row: a distinct icon and the fault count,
 * toggling the same expandable panel as the error badge. Separate from the
 * compile-error badge so a transient runtime fault never inflates the
 * persistent problem count.
 */
export function BrainRuntimeFaultBadge({ count, expanded, onToggle, brainName }: BrainRuntimeFaultBadgeProps) {
  return (
    <button
      type="button"
      data-testid="brain-runtime-fault-badge"
      aria-expanded={expanded}
      aria-label={`Runtime faults in ${brainName}`}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-amber-600 hover:bg-muted dark:text-amber-500"
      onClick={onToggle}
    >
      <Bug aria-hidden="true" className="h-3.5 w-3.5" />
      <span data-testid="brain-runtime-fault-count">{count}</span>
    </button>
  );
}

interface BrainDiagnosticsListProps {
  /** The diagnostics to list, one row each. */
  diagnostics: readonly BrainDiagnosticEntry[];
}

/**
 * The expanded diagnostics list below a brain row: one console-style row per
 * diagnostic, on the shared console-output control capped at about five
 * single-line rows.
 */
export function BrainDiagnosticsList({ diagnostics }: BrainDiagnosticsListProps) {
  return (
    <ConsoleOutputList
      testId="brain-diagnostics"
      rowTestId="brain-diagnostic-row"
      maxVisibleRows={5}
      className="border-t border-border"
      rows={diagnostics.map((diagnostic) => ({ location: diagnostic.location, message: diagnostic.message }))}
    />
  );
}

interface BrainRuntimeFaultsListProps {
  /** The buffered runtime faults to list, one row each. */
  faults: readonly BrainDiagnosticEntry[];
}

/**
 * The runtime-fault section below a brain row: a distinct console-style list of
 * buffered VM fiber faults, separate from the compile-diagnostics list.
 */
export function BrainRuntimeFaultsList({ faults }: BrainRuntimeFaultsListProps) {
  return (
    <ConsoleOutputList
      testId="brain-runtime-faults"
      rowTestId="brain-runtime-fault-row"
      maxVisibleRows={5}
      className="border-t border-border"
      rows={faults.map((fault) => ({ location: fault.location, message: fault.message }))}
    />
  );
}
