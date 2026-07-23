import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allow importing the shared engine from ../src (the sibling core package).
  server: { port: 5174, fs: { allow: [".."] } },
});
