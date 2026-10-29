import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @tauri-apps/cli 会在开发时注入 TAURI_DEV_HOST（用于真机/局域网调试）
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Tauri 需要固定端口，失败时直接退出而不是自动切换
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome110",
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
