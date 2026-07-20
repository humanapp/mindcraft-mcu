import { TriangleAlert } from "lucide-react";
import * as React from "react";
import { useMicrobitSimEnvironment } from "../contexts/microbit-sim-environment";
import { unresolvedLibraryCoordinates } from "../services/resolution-warnings";

/** Props for {@link UnresolvedLibrariesNotice}. */
export interface UnresolvedLibrariesNoticeProps {
  /** The `<owner>/<repo>` coordinates of the unresolved libraries. */
  coordinates: readonly string[];
}

/**
 * Status strip naming each library whose content did not resolve. Renders
 * nothing when the list is empty.
 */
export function UnresolvedLibrariesNotice({ coordinates }: UnresolvedLibrariesNoticeProps) {
  if (coordinates.length === 0) {
    return null;
  }
  return (
    <output
      data-testid="resolution-warnings"
      className="flex items-center gap-2 border-b border-border bg-warning/15 px-4 py-2 text-sm sm:px-6"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0">
        {coordinates.length === 1 ? "A library" : "Some libraries"} could not be loaded:{" "}
        <span className="font-mono" data-testid="resolution-warning-coordinates">
          {coordinates.join(", ")}
        </span>
        . Tiles from {coordinates.length === 1 ? "it" : "them"} show as missing until the next successful load.
      </p>
    </output>
  );
}

/**
 * Persistent banner shown while the active project has libraries whose content
 * failed to resolve on the last load or install. Clears on its own once a
 * later load or install resolves them.
 */
export function ResolutionWarningsBanner() {
  const store = useMicrobitSimEnvironment();
  const warnings = React.useSyncExternalStore(store.subscribeToResolutionWarnings, store.getResolutionWarningsSnapshot);
  const coordinates = React.useMemo(() => unresolvedLibraryCoordinates(warnings), [warnings]);
  return <UnresolvedLibrariesNotice coordinates={coordinates} />;
}
