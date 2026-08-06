/**
 * Name of the package the rehearsal adapter artifact is built from, replaced at
 * build time from this package's own `package.json`. Undeclared in a source
 * run, so read it through a `typeof` guard.
 */
declare const TARGET_PACKAGE_NAME: string;
