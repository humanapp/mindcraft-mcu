/**
 * Mindcraft identity of the target the rehearsal adapter artifact is, replaced
 * at build time from the `identity` this target's own `mindcraft.json`
 * declares. Undeclared in a source run, so read it through a `typeof` guard.
 */
declare const TARGET_IDENTITY: string;

/**
 * This target's tile documentation as raw markdown keyed by content key,
 * replaced at build time so the artifact carries the documentation inside
 * itself. Undeclared in a source run, so read it through a `typeof` guard.
 */
declare const TILE_DOC_CONTENT: Readonly<Record<string, string>>;
