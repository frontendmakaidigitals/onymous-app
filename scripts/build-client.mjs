// Bundles the browser code served by onymous-app:
//   src/client/consent/main.ts   -> dist/public/consent.js          (popup iframe page)
//   src/client/consent/loader.ts -> dist/public/onymous-consent.js  (storefront <script>)
//
//   node scripts/build-client.mjs          one-off production build
//   node scripts/build-client.mjs --watch  rebuild on change (dev)
import "dotenv/config";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    consent: "src/client/consent/main.ts",
    "onymous-consent": "src/client/consent/loader.ts",
  },
  outdir: "dist/public",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  tsconfig: "tsconfig.json",
  // fp-client.ts was written for Next; give it the public key at build time
  define: {
    "process.env.NEXT_PUBLIC_FP_PUBLIC_KEY": JSON.stringify(process.env.FP_PUBLIC_KEY ?? ""),
  },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
