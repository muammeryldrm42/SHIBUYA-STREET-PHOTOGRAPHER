import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", chunkSizeWarningLimit: 8000 },
  server: { port: 5173, strictPort: true },
});
