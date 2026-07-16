import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { uiPlugin } from "../../../external/mindcraft-lang/packages/ui/src/vite-plugin.ts";
import { embeddedExtensions } from "./embedded-extensions.mjs";

export default defineConfig({
  // Relative base: the built app must load both from a server root and from a
  // non-root path (VS Code webview resource hosting).
  base: "./",
  plugins: [react(), uiPlugin(), embeddedExtensions()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      "@mindcraft-lang/ui": path.resolve(process.cwd(), "../../external/mindcraft-lang/packages/ui/src"),
      "@mindcraft-lang/docs": path.resolve(process.cwd(), "../../external/mindcraft-lang/packages/docs/src"),
    },
  },
  logLevel: "warning",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
