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
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WS = globalThis.WebSocket;
const BASE = process.argv[2] ?? 'http://localhost:5173';
const PUERTO_BASE = 9222 + (Number(process.env.PUERTO_DEBUG ?? 0) || 0);

/**
 * Un puerto libre para el navegador, y no el 9222 a pelo.
 *
 * El protocolo de depuración se elige por puerto, y si otro Chrome lo tiene
 * tomado —una pasada anterior que se quedó colgada, o una captura— el test
 * se engancha a **ese** navegador y mide una pestaña que no es la suya. Se
 * vio: el test daba «75 fichas» con la base de 390, porque estaba mirando la
 * pestaña de otro Chrome que estaba en mitad de su propio bucle de filtros.
 * Fallaba como si fuera un fallo de la web, y no lo era.
 *
 * Por eso se busca un puerto libre antes de abrir el navegador, en vez de
 * confiar en que el anterior soltó el suyo.
 */
async function puertoLibre(base) {
  for (let p = base; p < base + 60; p++) {
    const libre = await new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (libre) return p;
  }
  throw new Error('no hay ningún puerto libre para el navegador');
}
const PUERTO = await puertoLibre(PUERTO_BASE);

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

/**
 * Si el navegador se cierra a mitad de una medición, hay que decirlo.
 *
 * Sin esto, las peticiones pendientes se quedan esperando para siempre: el
 * bucle de eventos se queda vacío, Node avisa «unsettled top-level await» y
 * sale con el código 13, sin decir qué pasó. Con esto, lo que está debajo
 * de `esperarFichas()` falla con un mensaje que sí dice algo: el navegador
 * murió.
 */
ws.addEventListener('close', () => {
  for (const { reject } of pendientes.values()) reject(new Error('el navegador se cerró a mitad de la medición'));
  pendientes.clear();
});

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

/**
 * Va a una página y espera a que esté de verdad.
 *
 * Antes eran 1200 ms fijos. Con la máquina cargada —tres agentes midiendo a
 * la vez— esa espera no bastaba y el test medía la página a medio cargar: el
 * titular salía vacío, el chip de idioma no existía todavía y no se veían
 * fichas. Los fallos que salían no eran fallos del sitio, y encimatapaban
 * los que sí lo son.
 *
 * Ahora se espera a `document.readyState`, que no vuelve a «complete» hasta
 * que los módulos se han ejecutado, y luego se comprueba que la página tiene
 * algo dentro. Si en tres segundos no está, se sigue adelante: el fallo lo
 * tiene que dar la comprobación de después, con su mensaje.
 */
async function ir(url, ancho = 390, movil = true) {
  await enviar('Emulation.setDeviceMetricsOverride', {
    width: ancho, height: 844, deviceScaleFactor: movil ? 2 : 1, mobile: movil,
  });
  await enviar('Page.navigate', { url });

  for (let i = 0; i < 60; i++) {
    let listo = false;
    try {
      listo = await evaluar('document.readyState === "complete" && document.body && document.body.children.length > 0');
    } catch { /* la página todavía no responde */ }
    if (listo) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Un respiro: los módulos ya se han ejecutado, pero el primer pintado
  // —y el fetch de `data/becas.json` en el buscador— van detrás.
  await new Promise((r) => setTimeout(r, 300));
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

/**
 * Cuenta las fichas al terminar el beat de búsqueda.
 *
 * «Comprobar» no pinta la lista al momento: primero enseña ~1 s el titular
 * («Buscando N becas…») y la lista llega al caer el telón. Contar a tiempo
 * fijo —antes, a 400 ms— contaba en mitad del titular, cuando el conteo
 * es cero por diseño. Se espera a que el titular se vaya; lo que queda
 * detrás ya es la lista de verdad.
 */
async function contarTrasBuscar() {
  for (let i = 0; i < 80; i++) {
    const n = await evaluar(`(() => {
      if (document.querySelector('.buscando')) return null;
      return document.querySelectorAll('[data-beca]').length;
    })()`);
    if (n !== null) return n;
    await new Promise((r) => setTimeout(r, 200));
  }
  return evaluar('document.querySelectorAll("[data-beca]").length');
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

// ── La página del alta, sin claves de Google ─────────────────────────────

/* Aquí no hay `GOOGLE_CLIENT_ID` en `.env.local`, así que `/api/config` no
   devuelve `googleId` y la página del alta carga con el formulario y sin el
   botón de Google. Se comprueba la puerta y la página, cada una por su lado:
   la de la portada tiene que ser un enlace a cuenta.html que abra su propia
   pestaña, y esa página, cargada, ocupa la pantalla entera y no trae ni el
   botón de Google ni el separador «o con tu correo», que sin botón queda
   huérfano anunciando una alternativa que no hay. */
console.log('La página del alta');

await ir(`${BASE}/`);
const puerta = await evaluar(`(() => {
  const a = document.querySelector('[data-open-auth]');
  return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null;
})()`);
ok(puerta, 'la portada no trae la puerta de crear cuenta');
ok(puerta && puerta.href.includes('cuenta.html'), `la puerta de crear cuenta no lleva a la página del alta («${puerta ? puerta.href : ''}»)`);
ok(puerta && puerta.target === '_blank', 'la puerta del alta no abre otra pestaña');

await ir(`${BASE}/cuenta.html`);
await new Promise((r) => setTimeout(r, 600));

const alta = await evaluar(`(() => {
  const caja = document.querySelector('.cuenta');
  const d = document.documentElement;
  return {
    caja: !!caja,
    // El viewport de maquetación —clientHeight— y no innerHeight: con la
    // emulación móvil la ventana visual mide 866 en un viewport de 844 y
    // contra esa cuenta ninguna página alcanza el fondo.
    ocupa: caja ? Math.round(caja.getBoundingClientRect().bottom) >= d.clientHeight - 1 : false,
    desborda: d.scrollWidth > d.clientWidth + 1,
    form: !!document.querySelector('#form'),
    titulo: document.querySelector('#modal-t')?.textContent ?? '',
    google: !!document.querySelector('#btn-google'),
    sep: !!document.querySelector('.modal-sep'),
  };
})()`);

ok(alta.caja, 'cuenta.html no trae la página del alta');
ok(alta.form, 'la página del alta no trae el formulario de correo y contraseña');
ok(alta.ocupa, 'la página del alta no llega hasta el fondo de la pantalla');
ok(!alta.desborda, 'la página del alta desborda en 390 px');
ok(/Crea tu cuenta|Create your account/.test(alta.titulo), `la página del alta no trae su título («${alta.titulo}»)`);
ok(!alta.google, 'sale el botón de Google sin claves configuradas');
ok(!alta.sep, 'queda el separador «o con tu correo» sin botón de Google encima');

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

// ── El momento de la búsqueda deja bajar ──────────────────────────────────

/* «No puedo bajar mientras está buscando», reportado el 21 de octubre de
   2026. El cartel sustituye a las 390 fichas, así que el documento pasaba de
   250.000 px a 1.700: el navegador recortaba la posición al nuevo final y el
   estudiante se quedaba contra el borde sin haber tocado nada. Lo que se mide
   es lo que pidió: que se pueda bajar de verdad mientras busca. Se intenta, y
   se vuelve. Y de paso, que el marco no nazca detrás de la barra fija, que en
   un móvil es media pantalla de abajo. */
console.log('El momento de la búsqueda');

await evaluar(`document.querySelector('#buscar').click()`);
await new Promise((r) => setTimeout(r, 300));

const beat = await evaluar(`(() => {
  const barra = document.querySelector('#cartel-acceso');
  const marco = document.querySelector('.buscando');
  const caja = marco ? marco.getBoundingClientRect() : { top: 0 };
  const seVe = innerHeight - (barra ? barra.getBoundingClientRect().height : 0);
  const y = Math.round(scrollY);
  window.scrollTo({ top: y + 300, behavior: 'instant' });
  const avance = Math.round(scrollY) - y;
  window.scrollTo({ top: y, behavior: 'instant' });
  return {
    cartel: !!marco,
    top: Math.round(caja.top),
    seVe: Math.round(seVe),
    avance,
    esqueletos: document.querySelectorAll('.esq').length,
    volver: !!document.querySelector('#buscando-volver'),
  };
})()`);

ok(beat.cartel, 'el momento de la búsqueda no aparece');
ok(beat.top < beat.seVe, `el cartel nace tapado por la barra de abajo (arriba en ${beat.top}, se ve hasta ${beat.seVe})`);
ok(beat.avance >= 240, `mientras busca solo se puede bajar ${beat.avance} px: la página parece congelada`);
ok(beat.esqueletos > 0, 'el beat no enseña ningún hueco de ficha');
ok(beat.volver, 'el beat no tiene la salida a los filtros');

// ── El filtro, medido ─────────────────────────────────────────────────────

console.log('El filtro de destino');

const sinFiltro = buscador.fichas;

for (const cod of ['ES', 'DE', 'FR', 'IT', 'GB']) {
  await evaluar(`(() => {
    const s = document.querySelector('#pais');
    s.value = '${cod}';
    document.querySelector('#buscar').click();
  })()`);
  const n = await contarTrasBuscar();
  ok(n < sinFiltro, `filtrar por ${cod} no ha recortado la lista (siguen ${n})`);
  ok(n > 0, `filtrar por ${cod} ha dejado la lista vacía`);
}

// Y que al quitar el filtro vuelva todo.
await evaluar(`(() => {
  const s = document.querySelector('#pais');
  s.value = '';
  document.querySelector('#buscar').click();
})()`);
const vuelta = await contarTrasBuscar();
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

/* En escritorio el marco ya cabe en la ventana al pulsar «Comprobar», así que
   la página no se toca. Es la otra mitad del fallo del 21 de octubre de 2026:
   el `scrollIntoView` bajaba la página 663 px y el titular «Convocatorias
   abiertas» aparecía cortado bajo la cabecera. */
await evaluar(`document.querySelector('#buscar').click()`);
await new Promise((r) => setTimeout(r, 300));

const beatEscritorio = await evaluar(`(() => {
  const h1 = document.querySelector('.find-top h1');
  return {
    y: Math.round(scrollY),
    h1: Math.round(h1.getBoundingClientRect().top),
    cabecera: Math.round(document.querySelector('header.top').getBoundingClientRect().height),
  };
})()`);

ok(beatEscritorio.y === 0, `en escritorio el beat baja la página ${beatEscritorio.y} px`);
ok(beatEscritorio.h1 >= beatEscritorio.cabecera,
  `el titular queda cortado bajo la cabecera (${beatEscritorio.h1} < ${beatEscritorio.cabecera})`);

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
