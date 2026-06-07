import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { uiPlugin } from "../../../external/mindcraft-lang/packages/ui/src/vite-plugin.ts";

export default defineConfig({
  base: "/",
  plugins: [react(), uiPlugin()],
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
    rollupOptions: {
      input: {
        main: path.resolve(process.cwd(), "index.html"),
        "vfs-service-worker": path.resolve(process.cwd(), "src/vfs-sw-entry.ts"),
      },
      output: {
        entryFileNames(chunkInfo) {
          if (chunkInfo.name === "vfs-service-worker") {
            return "vfs-service-worker.js";
          }
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
