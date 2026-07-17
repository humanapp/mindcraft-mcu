import { DocsPage as SharedDocsPage } from "@mindcraft-lang/docs";
import { useMemo } from "react";
import { createMicrobitTileVisualResolver } from "./brain/editor-config";
import { useMicrobitSimEnvironment } from "./contexts/microbit-sim-environment";
import { createDocsTileCatalog, createMicrobitDocsRegistry } from "./docs/docs-registry";

/** Full-page documentation view served at `/docs`. */
export function DocsPage() {
  const store = useMicrobitSimEnvironment();
  const docsRegistry = useMemo(() => createMicrobitDocsRegistry(store.env, store.host.lastUserTileMetadata), [store]);
  const docsTileCatalog = useMemo(() => createDocsTileCatalog(store.env), [store]);
  const resolveTileVisual = useMemo(
    () => createMicrobitTileVisualResolver((url) => store.resolveVfsAssetUrl(url)),
    [store]
  );

  return (
    <SharedDocsPage
      registry={docsRegistry}
      tileCatalog={docsTileCatalog}
      brainServices={store.env.brainServices}
      resolveTileVisual={resolveTileVisual}
      backLabel="Simulator"
      backHref="/"
    />
  );
}
