// Gera dist/servidor.mjs (um arquivo só, com as regras de web/src/lib embutidas) e
// dist/importar-supabase.mjs. O pacote pg fica de fora do bundle e vem do node_modules.
import { build } from "esbuild";

const comum = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["pg"],
  sourcemap: true,
  logLevel: "info",
};

await build({ ...comum, entryPoints: ["src/index.ts"], outfile: "dist/servidor.mjs" });
await build({ ...comum, entryPoints: ["scripts/importar-supabase.ts"], outfile: "dist/importar-supabase.mjs" });
