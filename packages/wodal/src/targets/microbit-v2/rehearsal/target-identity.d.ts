/**
 * Mindcraft identity of the target the rehearsal adapter artifact is, replaced
 * at build time from the `identity` this target's own `mindcraft.json`
 * declares. Undeclared in a source run, so read it through a `typeof` guard.
 */
declare const TARGET_IDENTITY: string;
