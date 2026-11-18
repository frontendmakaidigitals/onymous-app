// Entry for the popup iframe page (/embed/consent, /embed/consent/preview, /login).
// Bundled by scripts/build-client.mjs into dist/public/consent.js; styles come from
// styles.css (Tailwind), inlined into the page by src/embed/index.ts.
import { createRoot } from "react-dom/client";
import type { PopupBootstrap } from "@/lib/consent/templates";
import { App } from "./app";

const boot = JSON.parse(document.getElementById("onymous-bootstrap")?.textContent || "{}") as PopupBootstrap;
createRoot(document.getElementById("onymous-root")!).render(<App boot={boot} />);
