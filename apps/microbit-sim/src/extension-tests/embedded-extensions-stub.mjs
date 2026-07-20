/**
 * Headless stand-in for the Vite-provided `virtual:mindcraft-embedded-extensions`
 * module. Specs that load app modules importing the virtual bundle map the
 * specifier here through a `node:module` resolve hook; the bundle is empty
 * because those specs assemble their own embed record and never read the
 * app-bundled one.
 */
export default [];
