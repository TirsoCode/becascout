import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;

// Las claves de Supabase viven en .env.local (no se sube a ningún sitio).
// Se cargan aquí, antes de importar la API, porque api/[...ruta].js y
// lib/store.js leen process.env al cargarse. Sin esto, el servidor de
// desarrollo siempre cae al modo fichero aunque las claves existan.
//
// `BS_SIN_ENV` salta esa carga a propósito: es lo que usa la suite e2e. Sin
// el flag, las claves del fichero meten el alta de las pruebas en la base
// real de Supabase y cualquier corte de red durante la suite sale como 503
// del registro, que se lee como un fallo del test y no como lo que es.
async function cargarEnv() {
  if (process.env.BS_SIN_ENV === '1') return;
  for (const nombre of ['.env', '.env.local']) {
    try {
      const raw = await readFile(new URL(nombre, import.meta.url), 'utf8');
      for (const linea of raw.split('\n')) {
        const limpia = linea.trim();
        if (!limpia || limpia.startsWith('#')) continue;
        const idx = limpia.indexOf('=');
        if (idx < 0) continue;
        const key = limpia.slice(0, idx).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        let v = limpia.slice(idx + 1).trim();
        if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = v;
      }
    } catch { /* fichero opcional */ }
  }
}
await cargarEnv();

const api = (await import('./api/[...ruta].js')).default;

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