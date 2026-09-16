import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Keep heavy, shared libraries in stable vendor chunks. This reduces the
// amount of application code that must be re-downloaded when a page changes
// and improves caching for the web/mobile access point.
export default defineConfig(async () => ({
  plugins: [
    react(),
    {
      name: "labos-local-resource-viewer",
      resolveId(source: string, importer?: string) {
        if (
          source === "../components/ResourceViewerModal" &&
          importer &&
          /[\\/]pages[\\/]ResourcesPage\.tsx$/.test(importer)
        ) {
          return path.resolve(projectRoot, "src/components/ResourceViewerModalLocal.tsx");
        }
        return null;
      },
    },
  ],
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          router: ["react-router-dom"],
          query: ["@tanstack/react-query"],
          charts: ["recharts"],
          icons: ["lucide-react"],
          pdf: ["react-pdf", "pdfjs-dist"],
        },
      },
    },
  },
}));
