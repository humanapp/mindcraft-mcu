import type { FolderAppDataCodec, FolderHostMessage, FolderHostPort, FolderHostSession } from "@wendoo-lang/bridge-app";
import {
  connectFolderHostSession,
  FOLDER_HOST_MODE_FOLDER,
  FOLDER_HOST_MODE_GLOBAL,
  FOLDER_HOST_MODE_URL_PARAM,
  FolderSessionError,
  FolderSessionErrorCode,
} from "@wendoo-lang/bridge-app";
import { name as appName } from "../../package.json";
import {
  BRAINS_INDEX_KEY,
  parseMicrobitSimAppChunk,
  SIMULATOR_STATE_KEY,
  translateMicrobitSimAppChunk,
} from "./project-io";

/**
 * True when the page carries the folder host-mode bootstrap flag -- as the
 * URL search parameter or as the host-defined global: the app is embedded by
 * a host that owns the project as a workspace folder.
 */
export function isFolderHostMode(
  search: string = window.location.search,
  hostGlobals: Readonly<Record<string, unknown>> = globalThis as Record<string, unknown>
): boolean {
  if (new URLSearchParams(search).get(FOLDER_HOST_MODE_URL_PARAM) === FOLDER_HOST_MODE_FOLDER) {
    return true;
  }
  return hostGlobals[FOLDER_HOST_MODE_GLOBAL] === FOLDER_HOST_MODE_FOLDER;
}

/** True when `error` reports that the target removable drive is not mounted. */
export function isRemovableDriveMissingError(error: unknown): boolean {
  return error instanceof FolderSessionError && error.code === FolderSessionErrorCode.REMOVABLE_VOLUME_NOT_FOUND;
}

/** Visibility of the app's top-level chrome sections. */
export interface AppChrome {
  /** Project dropdown menu (new, open, import, export, extensions). */
  readonly showProjectMenu: boolean;
  /** VS Code Bridge panel with the join-code flow. */
  readonly showBridgePanel: boolean;
  /** Global app settings button. */
  readonly showSettings: boolean;
  /** Standalone extensions button shown when the project menu is absent. */
  readonly showExtensionsButton: boolean;
  /** Docs panel links to the app's standalone docs pages. */
  readonly showDocsPageLinks: boolean;
}

/**
 * The chrome contract for an app mode. Default (browser) mode shows the full
 * project-management chrome; folder host mode hides it and keeps extension
 * management reachable through a standalone button.
 */
export function appChromeForMode(folderHostMode: boolean): AppChrome {
  return folderHostMode
    ? {
        showProjectMenu: false,
        showBridgePanel: false,
        showSettings: false,
        showExtensionsButton: true,
        showDocsPageLinks: false,
      }
    : {
        showProjectMenu: true,
        showBridgePanel: true,
        showSettings: true,
        showExtensionsButton: false,
        showDocsPageLinks: true,
      };
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Translates microbit-sim's app-data entries (brain order and simulator
 * fleet) to and from its session chunk in the manifest's `app` map.
 */
export const microbitSimFolderAppDataCodec: FolderAppDataCodec = {
  chunkFromAppData(appData: ReadonlyMap<string, string>): unknown {
    const chunk = parseMicrobitSimAppChunk({
      brainOrder: parseJson(appData.get(BRAINS_INDEX_KEY)),
      simulator: parseJson(appData.get(SIMULATOR_STATE_KEY)),
    });
    if (chunk.brainOrder.length === 0 && chunk.simulator === undefined) {
      return undefined;
    }
    return chunk;
  },
  appDataFromChunk(chunk: unknown): Record<string, string> {
    return translateMicrobitSimAppChunk(chunk).appData ?? {};
  },
};

function isFolderHostMessage(value: unknown): value is FolderHostMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("folder:");
}

/**
 * A {@link FolderHostPort} over the embedding page: messages post to the
 * parent window (the host's webview wrapper relays them), and folder-session
 * messages arriving on this window are delivered to the listener.
 */
export function createWebviewFolderHostPort(): FolderHostPort {
  return {
    postMessage(message): void {
      window.parent.postMessage(message, "*");
    },
    onMessage(listener): () => void {
      const handler = (event: MessageEvent): void => {
        const data: unknown = event.data;
        if (isFolderHostMessage(data)) {
          listener(data);
        }
      };
      window.addEventListener("message", handler);
      return () => {
        window.removeEventListener("message", handler);
      };
    },
  };
}

/**
 * Open microbit-sim's folder session: the handshake over `port` plus this
 * app's name and app-data codec.
 */
export async function connectMicrobitFolderSession(
  port: FolderHostPort = createWebviewFolderHostPort()
): Promise<FolderHostSession> {
  return connectFolderHostSession({ port, appName, appDataCodec: microbitSimFolderAppDataCodec });
}
