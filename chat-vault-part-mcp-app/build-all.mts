import { build } from "vite";
import path from "path";
import fs from "fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const outDir = "assets";
const mcpAppHtmlPath = path.resolve("mcp-app.html");

if (!fs.existsSync(mcpAppHtmlPath)) {
  console.error("mcp-app.html not found");
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });

console.log("Building mcp-app (single-file)");
await build({
  root: path.resolve("."),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  esbuild: { jsx: "automatic", jsxImportSource: "react", target: "es2022" },
  build: {
    outDir,
    emptyOutDir: false,
    target: "es2022",
    minify: "esbuild",
    cssCodeSplit: false,
    rollupOptions: {
      input: mcpAppHtmlPath,
      output: {
        entryFileNames: "mcp-app.js",
        assetFileNames: "mcp-app.[ext]",
      },
    },
  },
});
console.log("Built assets/mcp-app.html");
