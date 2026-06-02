/**
 * Generate the propuesta PDF from the print route.
 *
 * Flow:
 *   1. Spawn `astro preview` against the freshly built `dist/`.
 *   2. Wait until the preview server is responding.
 *   3. Launch Puppeteer, render /propuesta-pdf, save the PDF into dist/.
 *   4. Shut the server down cleanly.
 *
 * The PDF lands at dist/eco-paseo-san-francisco.pdf so the deployed site
 * serves it at /eco-paseo-san-francisco.pdf.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";

const ROOT = resolve(process.cwd());
const HOST = "127.0.0.1";
const PORT = 4322; // distinto del dev (4321) para evitar choques locales
const PRINT_URL = `http://${HOST}:${PORT}/propuesta-pdf`;
const PDF_OUT = resolve(ROOT, "dist/eco-paseo-san-francisco.pdf");

function startPreview(): ChildProcess {
  const proc = spawn(
    "npx",
    ["astro", "preview", "--host", HOST, "--port", String(PORT)],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    }
  );

  proc.stdout?.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.log(`[preview] ${text}`);
  });

  proc.stderr?.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[preview:err] ${text}`);
  });

  return proc;
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 404) {
        return;
      }
    } catch {
      /* connection refused — keep waiting */
    }
    await wait(250);
  }
  throw new Error(`Preview server never responded at ${url}`);
}

async function generatePdf(): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });

    console.log(`[pdf] Navigating to ${PRINT_URL}`);
    await page.goto(PRINT_URL, { waitUntil: "networkidle0", timeout: 60000 });

    // Give web fonts a beat to settle before snapshotting the PDF.
    await page.evaluateHandle("document.fonts.ready");

    await page.pdf({
      path: PDF_OUT,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });

    console.log(`[pdf] Saved: ${PDF_OUT}`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(resolve(ROOT, "dist"))) {
    throw new Error(
      "dist/ does not exist. Run `npm run build:site` (or `npm run build`) first."
    );
  }

  console.log("[pdf] Starting astro preview…");
  const server = startPreview();

  try {
    await waitForServer(`http://${HOST}:${PORT}/`);
    console.log("[pdf] Preview server is up.");
    await generatePdf();
  } finally {
    server.kill("SIGTERM");
    // Give the child a moment to clean up its own socket.
    await wait(200);
  }
}

main().catch((err) => {
  console.error("[pdf] Failed:", err);
  process.exit(1);
});
