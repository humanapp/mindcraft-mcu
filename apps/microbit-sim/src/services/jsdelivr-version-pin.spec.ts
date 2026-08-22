/**
 * Pins the production fetch path for a version-form `gh:` pin. The published
 * chassis manifests declare their Position dependency as
 * `gh:wendoo-lang/lib-codal-position@0.1.4`: the pin is the bare release
 * version while the GitHub tag is `v0.1.4`. jsDelivr resolves a bare-version
 * specifier against v-prefixed tags, so the production URL builder must
 * forward the pin verbatim -- neither normalized to the tag spelling nor
 * rejected -- for the CDN to serve it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createJsDelivrExtensionTransport, parseExtensionReference } from "@wendoo-lang/app-host";
import { CODAL_POSITION_VERSION_REF } from "../extension-tests/published-library-fixtures";

const CDN_BASE = "https://cdn.example.invalid";

/** A fetch stub recording every requested URL and answering 200 with an empty body. */
function recordingFetch(): { urls: string[]; fetchImpl: typeof fetch } {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response(new Uint8Array(), { status: 200 }));
  };
  return { urls, fetchImpl };
}

describe("jsDelivr transport -- version-form pin URL construction", () => {
  test("the version-form Position pin is forwarded verbatim into the CDN URL", async () => {
    const parsed = parseExtensionReference(CODAL_POSITION_VERSION_REF);
    assert.ok(parsed?.transport === "gh" && parsed.routing.kind === "pin", "the declared dep is a pinned gh: ref");
    // The pin the published manifests carry is the bare release version, with
    // no tag `v` prefix.
    assert.match(parsed.routing.pin, /^\d+\.\d+\.\d+$/);

    const { urls, fetchImpl } = recordingFetch();
    const transport = createJsDelivrExtensionTransport({ cdnBaseUrl: CDN_BASE, fetchImpl });
    const result = await transport.fetchFile(parsed.owner, parsed.repo, parsed.routing.pin, "wendoo.json");
    assert.equal(result.ok, true, "the transport accepts a version-form pin");
    assert.deepEqual(urls, [`${CDN_BASE}/gh/${parsed.owner}/${parsed.repo}@${parsed.routing.pin}/wendoo.json`]);
  });
});
