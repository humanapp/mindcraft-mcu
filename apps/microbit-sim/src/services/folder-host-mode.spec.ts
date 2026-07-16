import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FolderAppMessage, FolderHostMessage, FolderHostPort } from "@mindcraft-lang/bridge-app";
import { WORKSPACE_FOLDER_PROJECT_COLLECTION_ID } from "@mindcraft-lang/bridge-app";
import {
  appChromeForMode,
  connectMicrobitFolderSession,
  isFolderHostMode,
  microbitSimFolderAppDataCodec,
} from "./folder-host-mode";
import { BRAINS_INDEX_KEY, SIMULATOR_STATE_KEY } from "./project-io";

describe("isFolderHostMode", () => {
  it("is true only for the folder host-mode bootstrap flag", () => {
    assert.strictEqual(isFolderHostMode("?mindcraftHostMode=folder"), true);
    assert.strictEqual(isFolderHostMode(""), false);
    assert.strictEqual(isFolderHostMode("?mindcraftHostMode=other"), false);
    assert.strictEqual(isFolderHostMode("?other=folder"), false);
  });
});

describe("appChromeForMode", () => {
  it("keeps the full default-mode chrome", () => {
    assert.deepStrictEqual(appChromeForMode(false), {
      showProjectMenu: true,
      showBridgePanel: true,
      showSettings: true,
      showExtensionsButton: false,
    });
  });

  it("hides project-management and bridge chrome in folder host mode", () => {
    assert.deepStrictEqual(appChromeForMode(true), {
      showProjectMenu: false,
      showBridgePanel: false,
      showSettings: false,
      showExtensionsButton: true,
    });
  });
});

describe("microbitSimFolderAppDataCodec", () => {
  it("round-trips brain order and simulator fleet through the app chunk", () => {
    const appData = new Map<string, string>([
      [BRAINS_INDEX_KEY, JSON.stringify(["brain-1", "brain-2"])],
      [SIMULATOR_STATE_KEY, JSON.stringify({ order: ["sim-1"], flash: { "sim-1": "brain-1" } })],
    ]);

    const chunk = microbitSimFolderAppDataCodec.chunkFromAppData(appData);
    const restored = microbitSimFolderAppDataCodec.appDataFromChunk(chunk);

    assert.deepStrictEqual(restored, {
      [BRAINS_INDEX_KEY]: JSON.stringify(["brain-1", "brain-2"]),
      [SIMULATOR_STATE_KEY]: JSON.stringify({ order: ["sim-1"], flash: { "sim-1": "brain-1" } }),
    });
  });

  it("produces no chunk when the app data carries no session state", () => {
    assert.strictEqual(microbitSimFolderAppDataCodec.chunkFromAppData(new Map()), undefined);
  });
});

function fakeHostPort(manifestContent: string): FolderHostPort {
  let listener: ((message: FolderHostMessage) => void) | undefined;
  return {
    postMessage(message: FolderAppMessage): void {
      queueMicrotask(() => {
        if (message.type === "folder:hello") {
          listener?.({
            type: "folder:welcome",
            id: message.id,
            payload: {
              protocolVersion: message.payload.protocolVersion,
              projectId: "the-folder-project",
              manifest: { content: manifestContent, etag: "disk-1" },
            },
          });
        } else if (message.type === "folder:loadFiles") {
          listener?.({ type: "folder:files", id: message.id, payload: { entries: [] } });
        } else if (message.type === "folder:change" || message.type === "folder:manifestWrite") {
          listener?.({ type: "folder:ack", id: message.id });
        }
      });
    },
    onMessage(next: (message: FolderHostMessage) => void): () => void {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
}

describe("connectMicrobitFolderSession", () => {
  it("selects a workspace-folder store hosting the handshake project", async () => {
    const session = await connectMicrobitFolderSession(
      fakeHostPort(JSON.stringify({ name: "Hosted Project", version: "0.1.0" }))
    );

    const tabSession = session.store.getProjectSession();
    assert.strictEqual(tabSession?.projectCollectionId, WORKSPACE_FOLDER_PROJECT_COLLECTION_ID);
    assert.strictEqual(tabSession.activeProjectId, "the-folder-project");
    const project = await session.store.getProject("the-folder-project");
    assert.strictEqual(project?.name, "Hosted Project");
    session.dispose();
  });
});
