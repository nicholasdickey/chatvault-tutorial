import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const profile = process.env.CHATVAULT_TOOL_METADATA_PROFILE === "gpt" ? "gpt" : "full";
const widgetVersion = process.env.WIDGET_VERSION?.trim() || "1.0.13";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __CHATVAULT_PROFILE__: JSON.stringify(profile),
    __CHATVAULT_WIDGET_VERSION__: JSON.stringify(widgetVersion),
  },
  build: {
    outDir: "dist",
  },
});
