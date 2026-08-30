import { build } from "vite";
import path from "path";
import fs from "fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const outDir = "assets";
const mcpAppHtmlPath = path.resolve("mcp-app.html");

const rawProfile = (
  process.env.CHATVAULT_TOOL_METADATA_PROFILE?.trim().toLowerCase() || "gpt"
);
if (rawProfile !== "gpt" && rawProfile !== "full") {
  console.error("CHATVAULT_TOOL_METADATA_PROFILE must be gpt or full");
  process.exit(1);
}
const widgetVersion =
  process.env.WIDGET_VERSION?.trim() ||
  process.env.ACTIVE_WIDGET_VERSION?.trim() ||
  "1.0.13";

if (!fs.existsSync(mcpAppHtmlPath)) {
  console.error("mcp-app.html not found");
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });

console.log(`Building mcp-app (single-file, profile=${rawProfile}, version=${widgetVersion})`);
await build({
  root: path.resolve("."),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  define: {
    __CHATVAULT_PROFILE__: JSON.stringify(rawProfile),
    __CHATVAULT_WIDGET_VERSION__: JSON.stringify(widgetVersion),
  },
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
