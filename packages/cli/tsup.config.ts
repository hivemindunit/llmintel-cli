import { defineConfig } from "tsup";

/**
 * Bundle the CLI into a single standalone ESM file for npm publishing. `@llmintel/schema` is a
 * private workspace package used only for types here, so it erases at build time and is not a
 * runtime dependency of the published artifact. The shebang is preserved from `src/index.ts`, so
 * the emitted bin is directly executable.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
});
