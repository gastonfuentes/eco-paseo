/**
 * Capture preview screenshots of the landing and the print page.
 * Run after `npm run build:site`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import puppeteer from "puppeteer";

const ROOT = resolve(process.cwd());
const HOST = "127.0.0.1";
const PORT = 4323;
const OUT_DIR = resolve(ROOT, ".preview");

const SHOTS: Array<{
  name: string;
  url: string;
  viewport: { width: number; height: number };
  fullPage?: boolean;
}> = [
  {
    name: "landing-desktop",
    url: `http://${HOST}:${PORT}/`,
    viewport: { width: 1440, height: 900 },
    fullPage: true,
  },
  {
    name: "landing-mobile",
    url: `http://${HOST}:${PORT}/`,
    viewport: { width: 390, height: 844 },
    fullPage: true,
  },
  {
    name: "print-view",
    url: `http://${HOST}:${PORT}/propuesta-pdf`,
    viewport: { width: 794, height: 1123 },
    fullPage: true,
  },
];

function startPreview(): ChildProcess {
  return spawn(
    "npx",
    ["astro", "preview", "--host", HOST, "--port", String(PORT)],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    }
  );
}

async function waitForServer(url: string, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* keep trying */
    }
    await wait(250);
  }
  throw new Error(`Preview server never responded at ${url}`);
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log("[shots] Starting preview server…");
  const server = startPreview();

  try {
    await waitForServer(`http://${HOST}:${PORT}/`);
    console.log("[shots] Preview is up.");

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      protocolTimeout: 120000,
    });

    try {
      for (const shot of SHOTS) {
        const page = await browser.newPage();
        await page.setViewport(shot.viewport);
        console.log(`[shots] → ${shot.name} (${shot.url})`);
        await page.goto(shot.url, { waitUntil: "networkidle0", timeout: 60000 });
        await page.evaluateHandle("document.fonts.ready");

        // Force lazy-loaded images to load by walking the page from Node.
        const totalHeight = (await page.evaluate(
          () => document.body.scrollHeight
        )) as number;
        const step = 800;
        for (let y = 0; y < totalHeight + step; y += step) {
          await page.evaluate((pos) => window.scrollTo(0, pos), y);
          await wait(180);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await wait(800);
        await wait(500);
        const outPath = resolve(OUT_DIR, `${shot.name}.png`);
        await page.screenshot({ path: outPath, fullPage: shot.fullPage ?? false });
        console.log(`[shots]   saved ${outPath}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
    await wait(200);
  }
}

main().catch((err) => {
  console.error("[shots] Failed:", err);
  process.exit(1);
});
