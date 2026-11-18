// Bundles the browser code served by onymous-app:
//   src/client/consent/main.tsx   -> dist/public/consent.js          (popup iframe page, React)
//   src/client/consent/styles.css -> dist/public/consent.css         (Tailwind, inlined into the page)
//   src/client/consent/loader.ts  -> dist/public/onymous-consent.js  (storefront <script>, plain JS)
//   Inter font + Onymous logo      -> dist/public/assets/             (served at /embed/assets/*)
//
//   node scripts/build-client.mjs          one-off production build
//   node scripts/build-client.mjs --watch  rebuild on change (dev)
import "dotenv/config";
import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  outdir: "dist/public",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  tsconfig: "tsconfig.json",
  logLevel: "info",
};

// Popup page (React)
const popup = {
  ...shared,
  entryPoints: { consent: "src/client/consent/main.tsx" },
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
    // fp-client.ts was written for Next; give it the public key at build time
    "process.env.NEXT_PUBLIC_FP_PUBLIC_KEY": JSON.stringify(process.env.FP_PUBLIC_KEY ?? ""),
  },
};

// Storefront loader: runs on every page view, so no React here
const loader = {
  ...shared,
  entryPoints: { "onymous-consent": "src/client/consent/loader.ts" },
};

function tailwind() {
  const args = ["-i", "src/client/consent/styles.css", "-o", "dist/public/consent.css"];
  args.push(watch ? "--watch" : "--minify");
  const child = spawn("node_modules/.bin/tailwindcss", args, { stdio: "inherit" });
  return new Promise((resolve, reject) => {
    if (watch) return resolve(child);
    child.on("exit", (code) => (code === 0 ? resolve(child) : reject(new Error(`tailwindcss exited with ${code}`))));
  });
}

// Static files the popup page loads (allow-listed in src/embed/index.ts)
async function assets() {
  await mkdir("dist/public/assets", { recursive: true });
  await copyFile("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "dist/public/assets/inter.woff2");
  await copyFile("src/client/consent/assets/onymous-logo.png", "dist/public/assets/onymous-logo.png");
}

await assets();
if (watch) {
  for (const opts of [popup, loader]) await (await esbuild.context(opts)).watch();
  await tailwind();
} else {
  await Promise.all([esbuild.build(popup), esbuild.build(loader), tailwind()]);
}
