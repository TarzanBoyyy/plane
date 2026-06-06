import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const getHostname = (value?: string) => {
  if (!value) return null;

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

const allowedHosts = Array.from(
  new Set(
    [
      "localhost",
      "127.0.0.1",
      getHostname(process.env.VITE_WEB_BASE_URL),
      getHostname(process.env.VITE_API_BASE_URL),
      getHostname(process.env.VITE_ADMIN_BASE_URL),
      getHostname(process.env.VITE_SPACE_BASE_URL),
      getHostname(process.env.VITE_LIVE_BASE_URL),
    ].filter((host): host is string => Boolean(host))
  )
);

const apiProxyTarget = process.env.PLANE_API_PROXY_TARGET || process.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

export default defineConfig(() => ({
  define: {
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [reactRouter(), tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
  resolve: {
    alias: {
      // Next.js compatibility shims used within web
      "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
      "next/script": path.resolve(__dirname, "app/compat/next/script.tsx"),
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/auth": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // No SSR-specific overrides needed; alias resolves to ESM build
}));
