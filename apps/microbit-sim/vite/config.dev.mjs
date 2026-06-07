import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { uiPlugin } from "../../../external/mindcraft-lang/packages/ui/src/vite-plugin.ts";

// The VFS service worker is served from /src in dev but must control the whole origin;
// broadening its scope past the script path requires the Service-Worker-Allowed header.
function vfsServiceWorkerPlugin() {
  return {
    name: "vfs-sw-allowed",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Service-Worker-Allowed", "/");
        next();
      });
    },
  };
}

export default defineConfig({
  base: "/",
  appType: "spa",
  plugins: [vfsServiceWorkerPlugin(), react(), uiPlugin()],
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
