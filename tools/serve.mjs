#!/usr/bin/env node
// Local dev server (npm start). Like `python3 -m http.server`, plus
// "Cache-Control: no-cache" on every file: without it the browser guesses how
// long to keep each file, and after a `git pull` it can keep running the old
// JavaScript until a hard reload. With it, a normal reload always picks up
// changes (unchanged files are answered with a cheap 304).
//
// Usage: node tools/serve.mjs [port]   (default 8000)

import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.argv[2]) || 8000;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".blend": "application/octet-stream",
};

createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400).end(); return; }
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) { file = join(file, "index.html"); st = statSync(file); }
  } catch { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache", etag };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers).end(); console.log(`304 ${path}`); return; }
  res.writeHead(200, { ...headers, "content-length": st.size });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
  console.log(`200 ${path}`);
}).listen(PORT, () => console.log(`TrackED on http://localhost:${PORT} (files are revalidated on every load)`));
