import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { uiPlugin } from "../../../external/mindcraft-lang/packages/ui/src/vite-plugin.ts";

export default defineConfig({
  base: "/",
  appType: "spa",
  plugins: [react(), uiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      "@mindcraft-lang/ui": path.resolve(process.cwd(), "../../external/mindcraft-lang/packages/ui/src"),
      "@mindcraft-lang/docs": path.resolve(process.cwd(), "../../external/mindcraft-lang/packages/docs/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@mindcraft-lang/core", "@mindcraft-lang/ui"],
  },
  server: {
    fs: {
      allow: [path.resolve(process.cwd(), "../..")],
    },
  },
});
