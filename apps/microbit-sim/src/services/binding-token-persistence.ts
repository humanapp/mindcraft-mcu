import { name as appName } from "../../package.json";

const BINDING_TOKEN_KEY = `${appName}:bridge-binding-token`;

/** Returns the persisted bridge binding token, or undefined when none is stored or storage is unavailable. */
export function loadBindingToken(): string | undefined {
  try {
    return localStorage.getItem(BINDING_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Persists the bridge binding token. No-ops when storage is full or unavailable. */
export function saveBindingToken(token: string): void {
  try {
    localStorage.setItem(BINDING_TOKEN_KEY, token);
  } catch {
    // storage full or unavailable
  }
}

/** Removes the persisted bridge binding token. No-ops when storage is unavailable. */
export function clearBindingToken(): void {
  try {
    localStorage.removeItem(BINDING_TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

/** Returns whether a bridge binding token is currently persisted. */
export function hasBindingToken(): boolean {
  try {
    return localStorage.getItem(BINDING_TOKEN_KEY) !== null;
  } catch {
    return false;
  }
}
