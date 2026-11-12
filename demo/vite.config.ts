import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only demo for <FrontalTank>; not part of the published build.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5199, host: "127.0.0.1" },
});
