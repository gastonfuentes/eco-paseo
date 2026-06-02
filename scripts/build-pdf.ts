/**
 * Generate the propuesta PDF from the print route.
 *
 * Flow:
 *   1. Serve the freshly built `dist/` from an in-process static server.
 *   2. Launch Puppeteer, render /propuesta-pdf, save the PDF into dist/.
 *   3. Close the server and exit.
 *
 * No child process is spawned: everything runs in this single Node process so
 * there is nothing to leak. A previous version shelled out to `astro preview`,
 * which left an orphaned server process holding the port and hung CI builds
 * (Netlify) until their timeout.
 *
 * The PDF lands at dist/eco-paseo-san-francisco.pdf so the deployed site
 * serves it at /eco-paseo-san-francisco.pdf.
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, resolve, extname } from "node:path";
import puppeteer from "puppeteer";

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, "dist");
const HOST = "127.0.0.1";
const PORT = 4322; // distinto del dev (4321) para evitar choques locales
const PRINT_URL = `http://${HOST}:${PORT}/propuesta-pdf`;
const PDF_OUT = join(DIST, "eco-paseo-san-francisco.pdf");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Map a request URL to a file inside dist/, serving index.html for directory
 * routes (e.g. `/propuesta-pdf`). Path traversal outside dist/ is rejected.
 */
function resolveFile(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  let candidate = normalize(join(DIST, clean));
  if (!candidate.startsWith(DIST)) return null; // traversal guard

  if (!extname(candidate)) {
    candidate = join(candidate, "index.html"); // directory route -> index.html
  }
  return existsSync(candidate) ? candidate : null;
}

function startServer(): Promise<Server> {
  const server = createServer(async (req, res) => {
    const file = resolveFile(req.url ?? "/");
    if (!file) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    try {
      const body = await readFile(file);
      res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
      res.end(body);
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(PORT, HOST, () => res(server));
  });
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
  if (!existsSync(DIST)) {
    throw new Error(
      "dist/ does not exist. Run `npm run build:site` (or `npm run build`) first."
    );
  }

  console.log("[pdf] Starting static server…");
  const server = await startServer();
  console.log(`[pdf] Serving dist/ at http://${HOST}:${PORT}`);

  try {
    await generatePdf();
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

main()
  .then(() => {
    // Force a clean exit so any lingering handle can't hang CI builds.
    process.exit(0);
  })
  .catch((err) => {
    console.error("[pdf] Failed:", err);
    process.exit(1);
  });
