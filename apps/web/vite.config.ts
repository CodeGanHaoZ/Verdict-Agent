import { defineConfig } from "vite";
// The workspace contains local signing keys and databases. Never serve them via /@fs.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      deny: [
        "**/.local/**",
        "**/.env*",
        "**/*.key",
        "**/*.pem",
        "**/*.sqlite*",
        "**/*.db",
        "**/.git/**",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
});
