/**
 * test/web.mjs — lo que se ve en el navegador, en un móvil de verdad.
 *
 * ── Por qué esto y no solo tests de lógica ───────────────────────────────
 *
 * Los tests de `test/` comprueban reglas: que el filtro aparta lo que
 * debe, que la cita sostiene el dato, que el catálogo tiene los países.
 * Ninguno de ellos **mira la página**.
 *
 * Y lo que se rompe mirando la página es distinto: una cita con un
 * identificador de 40 caracteres que empuja la tarjeta fuera de la
 * pantalla, un desplegable con 37 países que no cabe en 390 píxeles, una
 * píldora de 589 píxeles que se come media pantalla. Nada de eso falla en
 * los tests de lógica, y las dos reglas del proyecto —«¿se lee bien en
 * 390 px?» y «¿hay una fuente pública para cada dato?»— son de la
 * página.
 *
 * ── Cómo funciona ────────────────────────────────────────────────────────
 *
 * Abre Chrome con el protocolo de depuración, carga la página en un
 * viewport de 390 × 844 y **mide** lo que hay: cuánto se sale, qué
 * elementos son los culpables, cuántas fichas enseña el filtro.
 *
 * ── Cómo se ejecuta ──────────────────────────────────────────────────────
 *
 *   node serve.mjs &
 *   node test/web.mjs http://localhost:5173
 *
 * Corre sin red y sin claves. Solo necesita Chrome, que ya hace falta
 * para la ingesta.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WS = globalThis.WebSocket;
const BASE = process.argv[2] ?? 'http://localhost:5173';
const PUERTO = 9222 + (Number(process.env.PUERTO_DEBUG ?? 0) || 0);

let fallos = 0;
function ok(cond, mensaje) {
  if (cond) return;
  fallos++;
  console.error(`  FALLA: ${mensaje}`);
}

// ── El navegador ──────────────────────────────────────────────────────────

const perfil = await mkdtemp(join(tmpdir(), 'bs-web-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', `--user-data-dir=${perfil}`,
  `--remote-debugging-port=${PUERTO}`, 'about:blank',
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
    const page = tabs.find((t) => t.type === 'page');
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* el navegador aún no está */ }
}
if (!wsUrl) {
  console.error('  No se pudo abrir Chrome.');
  chrome.kill();
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
}

const ws = new WS(wsUrl);
let id = 0;
const pendientes = new Map();
const erroresConsola = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { resolve, reject } = pendientes.get(m.id);
    pendientes.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const t = m.params.entry.text ?? '';
    // Los 401 son la API sin sesión, que es lo normal sin cuenta.
    if (!/401|Unauthorized|Failed to load resource/.test(t)) erroresConsola.push(t);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

function enviar(method, params = {}) {
  id++;
  const mid = id;
  return new Promise((resolve, reject) => {
    pendientes.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluar(expr) {
  const r = await enviar('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'error en la página');
  }
  return r.result.value;
}

async function ir(url, ancho = 390, movil = true) {
  await enviar('Emulation.setDeviceMetricsOverride', {
    width: ancho, height: 844, deviceScaleFactor: movil ? 2 : 1, mobile: movil,
  });
  await enviar('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1200));
}

/**
 * Espera a que el buscador haya pintado su lista.
 *
 * El buscador carga `data/becas.json` con un `fetch`, así que la página
 * aparece antes de que haya fichas. Y la espera «por estabilidad» —medir
 * dos veces y que coincidan— no sirve: en el momento en que la página está
 * vacía, el ancho es estable y la espera se termina con cero fichas.
 *
 * Lo que se espera es lo que importa: que haya fichas en la lista.
 */
async function esperarFichas(minimo = 1) {
  for (let i = 0; i < 40; i++) {
    const n = await evaluar('document.querySelectorAll("[data-beca]").length');
    if (n >= minimo) return n;
    await new Promise((r) => setTimeout(r, 300));
  }
  return 0;
}

await enviar('Page.enable');
await enviar('Runtime.enable');
await enviar('Log.enable');

// ── La portada ────────────────────────────────────────────────────────────

console.log('La portada');

await ir(`${BASE}/`);

const kicker = await evaluar(`(() => {
  const k = document.querySelector('.kicker');
  return k ? k.textContent.trim() : null;
})()`);
ok(kicker === null, `sigue el kicker de la portada: «${kicker}»`);

const ancho = await evaluar(`(() => {
  const d = document.documentElement;
  return { scroll: d.scrollWidth, client: d.clientWidth };
})()`);
ok(ancho.scroll <= ancho.client + 1,
  `la portada desborda en 390 px: ${ancho.scroll}px con ventana de ${ancho.client}px`);

const titular = await evaluar(`(() => {
  const h = document.querySelector('.hero h1');
  return h ? h.textContent.replace(/\\s+/g, ' ').trim() : null;
})()`);
ok(titular && titular.length > 20, 'el titular no se lee');

// ── El buscador ───────────────────────────────────────────────────────────

console.log('El buscador');

await ir(`${BASE}/becas.html`);
const pintadas = await esperarFichas();

const buscador = await evaluar(`(() => {
  const d = document.documentElement;
  const sel = document.querySelector('#pais');
  return {
    scroll: d.scrollWidth,
    client: d.clientWidth,
    paises: sel ? sel.options.length : 0,
    fichas: document.querySelectorAll('[data-beca]').length,
    velo: document.querySelectorAll('.lock-body').length,
    barra: !!document.querySelector('#cartel-acceso'),
  };
})()`);

ok(buscador.scroll <= buscador.client + 1,
  `el buscador desborda en 390 px: ${buscador.scroll}px con ventana de ${buscador.client}px`);
ok(buscador.paises > 1, 'el desplegable de destino no tiene países');
ok(buscador.fichas > 0, 'no se ve ninguna ficha');
ok(buscador.velo === buscador.fichas, 'el velo no tapa todas las fichas');
ok(buscador.barra, 'no está la barra de acceso al pie');

// ── El filtro, medido ─────────────────────────────────────────────────────

console.log('El filtro de destino');

const sinFiltro = buscador.fichas;

for (const cod of ['ES', 'DE', 'FR', 'IT', 'GB']) {
  const n = await evaluar(`(() => {
    const s = document.querySelector('#pais');
    s.value = '${cod}';
    document.querySelector('#buscar').click();
    return new Promise(r => setTimeout(() => r(document.querySelectorAll('[data-beca]').length), 400));
  })()`);
  ok(n < sinFiltro, `filtrar por ${cod} no ha recortado la lista (siguen ${n})`);
  ok(n > 0, `filtrar por ${cod} ha dejado la lista vacía`);
}

// Y que al quitar el filtro vuelva todo.
const vuelta = await evaluar(`(() => {
  const s = document.querySelector('#pais');
  s.value = '';
  document.querySelector('#buscar').click();
  return new Promise(r => setTimeout(() => r(document.querySelectorAll('[data-beca]').length), 400));
})()`);
ok(vuelta === sinFiltro, `quitar el filtro no ha restaurado la lista (${vuelta} de ${sinFiltro})`);

// ── La píldora de destino ─────────────────────────────────────────────────

console.log('La píldora de destino');

const pill = await evaluar(`(() => {
  const pills = [...document.querySelectorAll('.beca-meta .pill[title^="Destino"]')];
  if (!pills.length) return { ninguna: true };
  const anchos = pills.map(p => Math.round(p.getBoundingClientRect().width));
  const textos = pills.map(p => p.textContent.trim());
  return {
    total: pills.length,
    maxAncho: Math.max(...anchos),
    masLarga: textos.reduce((a, b) => (b.length > a.length ? b : a), ''),
  };
})()`);

ok(!pill.ninguna, 'no hay ninguna píldora de destino');
if (!pill.ninguna) {
  ok(pill.maxAncho <= 320,
    `la píldora de destino más ancha mide ${pill.maxAncho}px: «${pill.masLarga}»`);
}

// ── En escritorio ─────────────────────────────────────────────────────────

console.log('En escritorio');

await ir(`${BASE}/becas.html`, 1280, false);
await esperarFichas();

const escritorio = await evaluar(`(() => {
  const d = document.documentElement;
  const carta = document.querySelector('.beca');
  const cs = getComputedStyle(carta);
  return {
    scroll: d.scrollWidth,
    client: d.clientWidth,
    columnas: cs.gridTemplateColumns,
  };
})()`);

ok(escritorio.scroll <= escritorio.client + 1, 'el buscador desborda en escritorio');
ok(escritorio.columnas.includes(' '), 'la tarjeta no tiene dos columnas en escritorio');

// ── Los errores de consola ────────────────────────────────────────────────

if (erroresConsola.length) {
  console.error('\nErrores en la consola:');
  for (const e of erroresConsola) console.error(`  ${e}`);
  fallos += erroresConsola.length;
}

ws.close();
chrome.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});

console.log('');
if (fallos) {
  console.error(`  ${fallos} fallos.`);
  process.exit(1);
}
console.log('  Todo en verde.');
