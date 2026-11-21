
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    global: "globalThis",
  },
  resolve: {
    // The XO engine pulls in its state package, which imports Node-only modules for an SQLite store the site never
    // opens. They resolve to small stand-ins (the same ones the invitation tool in templates/web uses).
    alias: {
      fs: here("stubs/fs.ts"),
      path: here("stubs/path.ts"),
      "node:path": here("stubs/path.ts"),
      "better-sqlite3": here("stubs/better-sqlite3.ts"),
      indexeddbshim: here("stubs/indexeddbshim.ts"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
