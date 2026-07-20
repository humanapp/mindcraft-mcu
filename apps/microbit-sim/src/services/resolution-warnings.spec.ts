import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CatalogMoveWarningCode, type ExtensionResolutionWarning } from "@mindcraft-lang/bridge-app";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnresolvedLibrariesNotice } from "../components/ResolutionWarningsBanner";
import { unresolvedLibraryCoordinates } from "./resolution-warnings";

const MOVE_FAILED_WARNING: ExtensionResolutionWarning = {
  kind: "catalog-move-failed",
  origin: "mindcraft-lang/lib-codal-position",
  reference: "embedded:mindcraft-lang/lib-codal-position",
  code: CatalogMoveWarningCode.FETCH_FAILED,
  message: "moved content is not available",
};

const UNRESOLVED_TARGET_WARNING: ExtensionResolutionWarning = {
  kind: "unresolved-target",
  origin: "mindcraft-lang/trg-arcade",
  message: "target resolves to no content",
};

const ADVISORY_WARNINGS: readonly ExtensionResolutionWarning[] = [
  {
    kind: "version-conflict",
    origin: "example-org/lib-a",
    selectedReference: "gh:example-org/lib-a@2",
    rejectedReference: "gh:example-org/lib-a@1",
    selectedVersion: "2.0.0",
    rejectedVersion: "1.0.0",
    message: "selected the higher version",
  },
  {
    kind: "reference-tiebreak",
    origin: "example-org/lib-b",
    selectedReference: "gh:example-org/lib-b@1",
    rejectedReference: "embedded:example-org/lib-b",
    message: "selected the nearest reference",
  },
  {
    kind: "abbreviated-pin",
    origin: "example-org/lib-c",
    reference: "gh:example-org/lib-c@abc1234",
    message: "the pin looks abbreviated",
  },
  {
    kind: "identity-mismatch",
    origin: "fork-org/lib-d",
    reference: "gh:fork-org/lib-d@1",
    declaredIdentity: "upstream-org/lib-d",
    message: "the content declares another identity",
  },
];

describe("unresolvedLibraryCoordinates", () => {
  test("collects the origins of unresolved-kind warnings, unique, in encounter order", () => {
    const duplicate: ExtensionResolutionWarning = {
      ...MOVE_FAILED_WARNING,
      reference: "gh:mindcraft-lang/lib-codal-position@0000000000000000000000000000000000000000",
    };
    assert.deepEqual(unresolvedLibraryCoordinates([MOVE_FAILED_WARNING, duplicate, UNRESOLVED_TARGET_WARNING]), [
      MOVE_FAILED_WARNING.origin,
      UNRESOLVED_TARGET_WARNING.origin,
    ]);
  });

  test("advisory warning kinds contribute no coordinates", () => {
    assert.deepEqual(unresolvedLibraryCoordinates(ADVISORY_WARNINGS), []);
    assert.deepEqual(unresolvedLibraryCoordinates([]), []);
  });
});

describe("UnresolvedLibrariesNotice rendering", () => {
  test("renders the indicator naming every unresolved coordinate", () => {
    const coordinates = [MOVE_FAILED_WARNING.origin, UNRESOLVED_TARGET_WARNING.origin];
    const markup = renderToStaticMarkup(createElement(UnresolvedLibrariesNotice, { coordinates }));
    assert.match(markup, /data-testid="resolution-warnings"/);
    for (const coordinate of coordinates) {
      assert.ok(markup.includes(coordinate), `the indicator names ${coordinate}`);
    }
  });

  test("renders nothing when no library is unresolved", () => {
    assert.equal(renderToStaticMarkup(createElement(UnresolvedLibrariesNotice, { coordinates: [] })), "");
  });
});
