/**
 * serve.mjs — Servidor estático mínimo para desarrollo.
 * Uso: node serve.mjs [puerto]
 *
 * En producción no hace falta nada: los ficheros son estáticos y valen para
 * Vercel, Netlify, Cloudflare Pages o GitHub Pages.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import api from './api/[...ruta].js';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // Las rutas de la API salen antes que los ficheros estáticos. En
    // desarrollo hace falta el mismo servidor que sirve la web, porque si no
    // el `fetch` a /api saldría a otro puerto y CORS lo bloquearía — que es
    // un rato perdido antes de llegar a la conclusión de que el problema es
    // que nunca se enruta.
    if (url.pathname.startsWith('/api/')) {
      return api(req, res);
    }

    let path = normalize(decodeURIComponent(url.pathname));
    if (path.includes('..')) throw new Error('traversal');
    if (path === '/' || path.endsWith('/')) path += 'index.html';

    const file = join(ROOT, path);
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — no encontrado');
  }
}).listen(PORT, () => {
  console.log(`\n  BecasScout → http://localhost:${PORT}\n`);
});