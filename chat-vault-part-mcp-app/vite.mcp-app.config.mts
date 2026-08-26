import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const profile = process.env.CHATVAULT_TOOL_METADATA_PROFILE === "gpt" ? "gpt" : "full";
const widgetVersion = process.env.WIDGET_VERSION?.trim() || "1.0.13";

export default defineConfig({
  plugins: [viteSingleFile()],
  define: {
    __CHATVAULT_PROFILE__: JSON.stringify(profile),
    __CHATVAULT_WIDGET_VERSION__: JSON.stringify(widgetVersion),
  },
  build: {
    outDir: "assets",
    rollupOptions: {
      input: process.env.INPUT,
    },
  },
});
