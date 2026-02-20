import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget =
  typeof process !== "undefined" && typeof process.env.VITE_SETTLD_API_PROXY_TARGET === "string" && process.env.VITE_SETTLD_API_PROXY_TARGET.trim() !== ""
    ? process.env.VITE_SETTLD_API_PROXY_TARGET.trim()
    : "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    // Avoid clashing with Settld API default port (3000).
    port: 5173,
    open: true,
    proxy: {
      "/__settld": {
        target: proxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__settld/, "")
      }
    }
  }
});
