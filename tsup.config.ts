import { defineConfig } from "tsup";
import { version } from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  shims: true,
  clean: true,
  // Inlined at build time so `sendmaxx --version` always matches package.json.
  define: {
    __VERSION__: JSON.stringify(version),
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
