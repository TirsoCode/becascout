/**
 * test/idioma.mjs — el cambio castellano/inglés, de punta a punta.
 *
 * ── Qué se comprueba, y por qué estas cosas ─────────────────────────────
 *
 * El idioma no lo resuelve el servidor: lo resuelve `js/i18n.js` en el
 * navegador, cambiando el texto de los elementos `data-i18n` al pulsar un
 * botón. Eso significa que un fallo aquí no rompe ninguna prueba de lógica:
 * la página carga, no hay ningún error, y media página se queda en castellano
 * sin que nada lo diga. Es exactamente el tipo de fallo que solo se ve
 * mirando, y por eso se mira con Chrome.
 *
 * Se exige, en la portada y en `sobre.html` como mínimo:
 *
 *   · el chip de idioma existe, se ve y cabe en 390 px, y está por encima de
 *     la cabecera (nada lo tapa);
 *   · al pulsarlo los textos pasan a inglés y `<html lang>` pasa a `en`;
 *   · `localStorage` lo recuerda y una recarga sigue en inglés;
 *   · `?lang=en` entra en inglés y **el parámetro desaparece** de la barra;
 *   · al volver a castellano los textos son los mismos de antes, letra a
 *     letra: el idioma original no se puede gastar traduciendo;
 *   · no queda ningún texto castellano largo sin traducir.
 *
 * ── Cómo se detecta un texto sin traducir sin ver el diccionario ─────────
 *
 * El test no importa `i18n.js` (es un módulo de navegador y además el
 * diccionario es un detalle suyo). Lo que hace es leer el texto de todos los
 * `[data-i18n]` en castellano, cambiar de idioma y comparar. De ahí salen dos
 * comprobaciones que se complementan:
 *
 *   1. Un porcentaje alto de elementos tiene que cambiar. No exige el 100 %
 *      porque hay textos que en inglés son iguales a propósito: «Erasmus
 *      Mundus», «pdf», «Cookies» o el nombre propio «Boletín Oficial del
 *      Estado».
 *   2. Ningún elemento **largo** (más de 60 caracteres) puede quedarse igual.
 *      Una párrafo sin traducir es el fallo de verdad; una sigla repetida no
 *      es un fallo de nadie.
 *   3. Y la red de seguridad: en inglés no puede quedar ninguna palabra
 *      castellana evidente («el», «los», «para», «desde»…) dentro de un
 *      elemento. En las páginas legales se toleran hasta tres, porque un
 *      término jurídico puede sobrevivir a la traducción a propósito.
 *
 * ── Cómo se ejecuta ──────────────────────────────────────────────────────
 *
 *   node serve.mjs &
 *   node test/idioma.mjs http://localhost:5173
 *
 * Sin red más allá de localhost, sin claves y sin dependencias. Solo Chrome,
 * que ya hace falta para la ingesta.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WS = globalThis.WebSocket;
const BASE = process.argv[2] ?? 'http://localhost:5173';

/**
 * Un puerto libre, y no el 9222 a pelo. Es la lección de `test/web.mjs`: el
 * protocolo de depuración se elige por puerto, así que engancharse a un Chrome
 * que dejó colgado otra pasada mide una pestaña que no es la de este test y el
 * diagnóstico sale falso.
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
const PUERTO = await puertoLibre(9222 + (Number(process.env.PUERTO_DEBUG ?? 0) || 0));

let fallos = 0;
function ok(cond, mensaje) {
  if (cond) return;
  fallos++;
  console.error(`  FALLA: ${mensaje}`);
}

// ── El navegador ──────────────────────────────────────────────────────────

const perfil = await mkdtemp(join(tmpdir(), 'bs-idioma-'));
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
  // `Log.entryAdded` es lo que Chrome apunta como error de carga o de script;
  // `Runtime.exceptionThrown` es una excepción que nadie atrapó. Las dos cuentan.
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const t = m.params.entry.text ?? '';
    // El 401 de `/api/yo` es la API sin sesión: lo normal aquí, no un fallo.
    if (!/401|Unauthorized|Failed to load resource/.test(t)) erroresConsola.push(t);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    erroresConsola.push(m.params.exceptionDetails?.exception?.description ?? 'excepción sin mensaje');
  }
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
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

async function ir(ruta) {
  await enviar('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await enviar('Page.navigate', { url: `${BASE}${ruta}` });
  // Se espera al chip, no a un tiempo fijo. El chip lo pinta `i18n.js` al
  // ejecutarse, así que en cuanto está, el diccionario ya se aplicó; y con una
  // espera fija, una pasada con la máquina cargada medía la página a medias y
  // daba «no hay chip» como si fuera un fallo de la web.
  //
  // El margen es de nueve segundos, no de cuatro y medio: con la máquina
  // cargada —tres navegadores midiendo a la vez— el módulo tardaba más y la
  // espera se agotaba. Que se agote no es un fallo del sitio: el chip llega
  // tarde, y el fallo lo tiene que dar la comprobación de después.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      if (await evaluar("document.readyState === 'complete' && !!document.querySelector('.lang-btn')")) return;
    } catch { /* aún navegando */ }
  }
}

/** El texto de cada elemento traducible, en el orden del documento. */
function capturar() {
  return evaluar(`(() => [...document.querySelectorAll('[data-i18n],[data-i18n-html]')]
    .map((el) => {
      const clave = el.dataset.i18n || el.dataset.i18nHtml;
      return { clave, texto: (el.textContent || '').replace(/\\s+/g, ' ').trim() };
    }))()`);
}

/**
 * El chip: existe, se ve, cabe y no lo tapa nada.
 *
 * `elementFromPoint` en el centro es lo que distingue «está en el DOM» de
 * «está a la vista»: un botón metido debajo de la cabecera, o fuera de la
 * pantalla, también se encuentra con `querySelector`.
 */
function mirarChip() {
  return evaluar(`(() => {
    const b = document.querySelector('.lang-btn');
    if (!b) return { existe: false };
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const arriba = document.elementFromPoint(x, y);
    return {
      existe: true,
      texto: b.textContent.trim(),
      etiqueta: b.getAttribute('aria-label') || '',
      title: b.title || '',
      width: Math.round(r.width),
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      ventana: document.documentElement.clientWidth,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
      dentro: r.left >= -1 && r.right <= document.documentElement.clientWidth + 1,
      enPantalla: r.top >= 0 && r.bottom <= innerHeight,
      tapado: !(arriba === b || b.contains(arriba)),
    };
  })()`);
}

/* Las palabras que en inglés no aparecen sueltas y en castellano sí. «del» no
   está: «Boletín Oficial del Estado» es un nombre propio y va tal cual en las
   dos versiones. Tampoco están «la» ni «con», que en inglés existen como parte
   de otras cosas y darían falsos positivos. */
const CASTELLANO = /\b(el|los|las|una|para|desde|porque|también|cuando|nuestro|nuestra|puedes|tienes)\b/i;

function cargarPagina(ruta) {
  return ir(ruta);
}

await enviar('Page.enable');
await enviar('Runtime.enable');
await enviar('Log.enable');

// Un origen limpio: si otro test dejó `becascout.idioma` en inglés, la primera
// carga saldría en inglés y el test fallaría por una herencia, no por un fallo.
await ir('/404.html');
await evaluar('localStorage.clear(); sessionStorage.clear()');

// ── La portada y sobre.html, paso a paso ─────────────────────────────────

for (const ruta of ['/', '/sobre.html']) {
  console.log(`El cambio de idioma en ${ruta}`);

  await evaluar("localStorage.removeItem('becascout.idioma')");
  await cargarPagina(ruta);

  const chipEs = await mirarChip();
  ok(chipEs.existe, `${ruta} no trae el chip de idioma`);
  if (chipEs.existe) {
    ok(chipEs.visible, `${ruta}: el chip de idioma no se ve a 390 px`);
    ok(chipEs.dentro, `${ruta}: el chip se sale de la ventana (${chipEs.left}–${chipEs.right} de ${chipEs.ventana} px)`);
    ok(chipEs.enPantalla, `${ruta}: el chip nace fuera de la pantalla (arriba en ${chipEs.top} px)`);
    ok(!chipEs.tapado, `${ruta}: hay algo encima del chip de idioma`);
    ok(chipEs.etiqueta && chipEs.etiqueta !== 'idioma.cambiar',
      `${ruta}: el chip no tiene etiqueta accesible (${chipEs.etiqueta || 'vacía'})`);
  }

  const es = await capturar();
  ok(es.length > 10, `${ruta} no tiene ni un puñado de textos marcados con data-i18n (${es.length})`);

  await evaluar("document.querySelector('.lang-btn').click()");
  await new Promise((r) => setTimeout(r, 400));

  const lang = await evaluar('document.documentElement.lang');
  ok(lang === 'en', `${ruta}: <html lang> no pasa a «en» (queda «${lang}»)`);

  const chipEn = await mirarChip();
  ok(chipEn.existe && chipEn.texto === 'ES',
    `${ruta}: el chip no se gira al idioma al que lleva (dice «${chipEn.texto}»)`);
  ok(chipEn.etiqueta && chipEn.etiqueta !== 'idioma.cambiar',
    `${ruta}: el chip se queda sin etiqueta accesible en inglés`);

  const en = await capturar();
  const iguales = [];
  const sospechosos = [];
  for (let i = 0; i < es.length; i++) {
    const antes = es[i];
    const ahora = en[i];
    if (!ahora || antes.clave !== ahora.clave) continue;
    if (antes.texto === ahora.texto) iguales.push(antes);
    if (CASTELLANO.test(ahora.texto)) sospechosos.push(ahora);
  }

  const cambiados = es.length - iguales.length;
  const proporcion = cambiados / Math.max(1, es.length);
  ok(proporcion >= 0.75,
    `${ruta}: solo el ${Math.round(proporcion * 100)} % de los textos cambia al inglés (${cambiados} de ${es.length})`);

  // Un párrafo sin traducir es el fallo que importa: los textos largos.
  const largosIguales = iguales.filter((e) => e.texto.length > 60);
  ok(largosIguales.length === 0,
    `${ruta}: ${largosIguales.length} texto(s) largo(s) siguen en castellano: ${largosIguales.map((e) => `${e.clave} «${e.texto.slice(0, 50)}…»`).join(', ')}`);

  ok(sospechosos.length === 0,
    `${ruta}: quedan ${sospechosos.length} texto(s) con castellano dentro en inglés: ${sospechosos.map((e) => `${e.clave} «${e.texto.slice(0, 50)}»`).join(', ')}`);

  const recordado = await evaluar("localStorage.getItem('becascout.idioma')");
  ok(recordado === 'en', `${ruta}: el idioma no se recuerda (localStorage dice «${recordado}»)`);

  // La recarga es la prueba de que se recuerda de verdad, y no solo de que la
  // variable vive en memoria mientras la pestaña está abierta.
  await cargarPagina(ruta);
  const trasRecarga = await evaluar('document.documentElement.lang');
  ok(trasRecarga === 'en', `${ruta}: al recargar vuelve al castellano (lang=«${trasRecarga}»)`);
  const chipRecarga = await mirarChip();
  ok(chipRecarga.existe && chipRecarga.texto === 'ES',
    `${ruta}: al recargar el chip no está en inglés (dice «${chipRecarga.texto}»)`);

  // Y la vuelta: el castellano tiene que ser el de antes, no una traducción
  // de ida y vuelta. `i18n.js` guarda el texto original del HTML; si se
  // perdiera, volver dejaría el idioma a medias.
  await evaluar("document.querySelector('.lang-btn').click()");
  await new Promise((r) => setTimeout(r, 400));
  const vuelta = await capturar();
  const distintas = vuelta.filter((e, i) => es[i] && e.texto !== es[i].texto);
  ok(vuelta.length === es.length && distintas.length === 0,
    `${ruta}: al volver al castellano ${distintas.length} texto(s) no son los de antes: ${distintas.slice(0, 3).map((e) => e.clave).join(', ')}`);
  ok(await evaluar('document.documentElement.lang') === 'es',
    `${ruta}: al volver, <html lang> no queda en «es»`);
  console.log('');
}

// ── Las otras cuatro páginas: que no se quede nada en castellano ─────────

/* Las legales se miran con manga ancha a propósito: un término jurídico puede
   quedarse igual, y el test no está para discutir traducciones, sino para
   pillar párrafos enteros sin traducir. */
const LEGALES = new Set(['/privacidad.html', '/cookies.html']);

console.log('Las demás páginas');

for (const ruta of ['/privacidad.html', '/cookies.html', '/404.html', '/supabase-config.html', '/cuenta.html']) {
  await evaluar("localStorage.removeItem('becascout.idioma')");
  await cargarPagina(ruta);

  const chip = await mirarChip();
  ok(chip.existe && chip.visible && chip.dentro && !chip.tapado && chip.enPantalla,
    `${ruta}: el chip de idioma no está a la vista a 390 px`);

  const es = await capturar();
  await evaluar("document.querySelector('.lang-btn').click()");
  await new Promise((r) => setTimeout(r, 400));

  const en = await capturar();
  const iguales = [];
  const sospechosos = [];
  for (let i = 0; i < es.length; i++) {
    if (!en[i]) break;
    if (es[i].texto === en[i].texto) iguales.push(es[i]);
    if (CASTELLANO.test(en[i].texto)) sospechosos.push(en[i]);
  }

  const proporcion = (es.length - iguales.length) / Math.max(1, es.length);
  ok(proporcion >= 0.75,
    `${ruta}: solo el ${Math.round(proporcion * 100)} % de los textos cambia al inglés`);
  ok(iguales.filter((e) => e.texto.length > 60).length === 0,
    `${ruta}: hay un párrafo largo sin traducir (${iguales.filter((e) => e.texto.length > 60).map((e) => e.clave).join(', ')})`);

  const tope = LEGALES.has(ruta) ? 3 : 0;
  ok(sospechosos.length <= tope,
    `${ruta}: quedan ${sospechosos.length} texto(s) con castellano dentro en inglés: ${sospechosos.map((e) => e.clave).join(', ')}`);

  // El chip, ya en inglés: las etiquetas inglesas son más largas que las
  // castellanas («Create account» por «Crear cuenta»), y el ancho que se mide
  // a 390 es el de la cabecera con el idioma puesto, no el de nacimiento.
  const chipEn = await mirarChip();
  ok(chipEn.existe && chipEn.visible && chipEn.dentro && !chipEn.tapado,
    `${ruta}: con el inglés puesto el chip se sale o lo tapan (${chipEn.left}–${chipEn.right} de ${chipEn.ventana} px)`);
}

console.log('');

// ── La página del alta, en inglés ────────────────────────────────────────

/* La página del alta lleva `data-i18n` en lo estático —las etiquetas, el
   argumento del panel verde— y lo que cambia con el modo lo escribe
   `js/cuenta.js` con `t()` (título, botón, enlace del pie), así que un texto
   que se quede en castellano no lo pilla el barrido de arriba. Se carga de
   verdad, con el inglés ya puesto, y se lee lo que sale. */
console.log('La página de la cuenta');

await evaluar("localStorage.setItem('becascout.idioma', 'en')");

await cargarPagina('/cuenta.html');
await new Promise((r) => setTimeout(r, 500));

const alta = await evaluar(`(() => {
  const c = document.querySelector('.cuenta');
  if (!c) return { abierta: false };
  const etiquetas = [...c.querySelectorAll('label.flab')].map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim());
  return {
    abierta: true,
    titulo: c.querySelector('#modal-t')?.textContent ?? '',
    sub: c.querySelector('#modal-sub')?.textContent ?? '',
    enviar: c.querySelector('#f-enviar')?.textContent ?? '',
    etiquetas,
    marcadores: [...c.querySelectorAll('input')].map((i) => i.placeholder),
    pitch: ((c.querySelector('.auth-pitch h2')?.textContent ?? '') + ' ' +
            (c.querySelector('.auth-pitch p')?.textContent ?? '')).replace(/\\s+/g, ' ').trim(),
    google: !!c.querySelector('#btn-google'),
  };
})()`);

ok(alta.abierta, 'la página del alta no carga');
if (alta.abierta) {
  ok(alta.titulo === 'Create your account', `el título del alta no está en inglés («${alta.titulo}»)`);
  ok(alta.enviar === 'Create account', `el botón del alta no está en inglés («${alta.enviar}»)`);
  ok(alta.etiquetas.join('|') === 'Email|Password', `las etiquetas del formulario no están en inglés («${alta.etiquetas.join('|')}»)`);
  ok(alta.marcadores[0] === 'you@example.com', `el marcador del correo no está en inglés («${alta.marcadores[0]}»)`);
  const cabecera = [alta.titulo, alta.sub, alta.enviar, alta.pitch, ...alta.etiquetas, ...alta.marcadores].join(' ');
  ok(!CASTELLANO.test(cabecera), `queda castellano en la página del alta: «${cabecera.trim()}»`);
}

// Sin `googleId` —en local `/api/config` no lo trae— el botón no se pinta.
ok(!alta.google, 'sale el botón de Google sin que /api/config traiga googleId');

// El enlace al pie cambia la página a «entrar», también en inglés.
await evaluar("document.querySelector('#modal-cambia')?.click()");
await new Promise((r) => setTimeout(r, 400));
const altaEntrar = await evaluar(`(() => {
  const c = document.querySelector('.cuenta');
  return {
    titulo: c?.querySelector('#modal-t')?.textContent ?? '',
    enviar: c?.querySelector('#f-enviar')?.textContent ?? '',
    alt: (c?.querySelector('#modal-alt')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
  };
})()`);
ok(altaEntrar.titulo === 'Sign in', `la página de entrar no está en inglés («${altaEntrar.titulo}»)`);
ok(altaEntrar.enviar === 'Sign in', `el botón de entrar no está en inglés («${altaEntrar.enviar}»)`);
ok(!CASTELLANO.test(altaEntrar.alt), `queda castellano en el pie de la página del alta («${altaEntrar.alt}»)`);
console.log('');

// ── La encuesta de llegada, en inglés ────────────────────────────────────

/* Se dispara con la bandera que deja `auth/callback`, y solo una vez por
   navegador: aquí se fuerza para poder leerla. Las seis marcas no se
   traducen (son su nombre); «Un amigo» sí. */
console.log('La encuesta de llegada');

await evaluar("sessionStorage.setItem('bs.encuesta', '1'); localStorage.removeItem('becascout.origen')");
await cargarPagina('/');
for (let i = 0; i < 25; i++) {
  if (await evaluar("!!document.querySelector('.encuesta')")) break;
  await new Promise((r) => setTimeout(r, 200));
}

const encuesta = await evaluar(`(() => {
  const m = document.querySelector('#scrim .encuesta');
  if (!m) return { abierta: false };
  return {
    abierta: true,
    titulo: m.querySelector('#enc-t')?.textContent ?? '',
    sub: m.querySelector('.enc-sub')?.textContent ?? '',
    opciones: [...m.querySelectorAll('[data-origen]')].map((b) => b.textContent.trim()),
    pasar: m.querySelector('.enc-skip button')?.textContent ?? '',
  };
})()`);

ok(encuesta.abierta, 'la encuesta de llegada no se abre con la bandera puesta');
if (encuesta.abierta) {
  ok(encuesta.opciones.length === 7, `la encuesta no trae sus siete opciones (${encuesta.opciones.length})`);
  ok(encuesta.opciones[6] === 'A friend', `la séptima opción no está en inglés ("${encuesta.opciones[6]}")`);
  ok(!CASTELLANO.test(encuesta.titulo + ' ' + encuesta.sub + ' ' + encuesta.pasar),
    `queda castellano en la encuesta ("${encuesta.titulo}" · "${encuesta.pasar}")`);
}

// ── Segundo paso de la encuesta (ChatGPT y Claude) en inglés ─────────

/* Al pulsar ChatGPT en inglés debe aparecer el campo de pregunta. */
console.log('El segundo paso de la encuesta al pulsar ChatGPT en inglés');

await evaluar("document.querySelector('.encuesta [data-origen=\"chatgpt\"]').click()");
await new Promise((r) => setTimeout(r, 300));

const segundoPaso = await evaluar(`(() => {
  const m = document.querySelector('#scrim .encuesta');
  if (!m) return { abierto: false };
  const titulo = m.querySelector('#enc-t')?.textContent ?? '';
  const input = m.querySelector('#pregunta-input');
  const enviar = m.querySelector('#enviar-pregunta')?.textContent ?? '';
  const volver = m.querySelector('#volver-btn')?.textContent ?? '';
  return {
    abierto: true,
    titulo: titulo,
    tieneInput: !!input,
    placeholder: input?.placeholder ?? '',
    botonEnviar: enviar,
    botonVolver: volver,
  };
})()`);

ok(segundoPaso.abierto, 'el segundo paso no se abre al pulsar ChatGPT');
if (segundoPaso.abierto) {
  ok(segundoPaso.titulo === 'What did you ask?',
    `el título del segundo paso no está en inglés ("${segundoPaso.titulo}")`);
  ok(segundoPaso.tieneInput, 'el segundo paso no tiene el campo de pregunta');
  ok(!CASTELLANO.test(segundoPaso.titulo + ' ' + segundoPaso.botonEnviar + ' ' + segundoPaso.botonVolver),
    `queda castellano en el segundo paso ("${segundoPaso.titulo}" · "${segundoPaso.botonEnviar}" · "${segundoPaso.botonVolver}")`);
}

console.log('');

// ── El enlace `?lang=en` ─────────────────────────────────────────────────

/* El parámetro sirve para el primer aterrizaje —un enlace compartido en
   inglés— y se gasta al aplicarlo. Si se quedara en la barra, pisaría para
   siempre la elección de quien después pulse «ES» y recargue. */
console.log('El enlace con ?lang=en');

for (const ruta of ['/?lang=en', '/sobre.html?lang=en']) {
  // El castellano de referencia se toma antes, sin parámetro y con el idioma
  // recordado limpio: comparar con el diccionario desde aquí no es posible.
  const limpia = ruta.split('?')[0];
  await evaluar("localStorage.removeItem('becascout.idioma')");
  await cargarPagina(limpia);
  const es = await capturar();

  // Y ahora el enlace, con el castellano a propósito en `localStorage`: lo que
  // manda es la URL, no lo recordado.
  await evaluar("localStorage.setItem('becascout.idioma', 'es')");
  await cargarPagina(ruta);

  const lang = await evaluar('document.documentElement.lang');
  ok(lang === 'en', `${ruta}: no entra en inglés (lang=«${lang}»)`);

  const barra = await evaluar('location.search');
  ok(!/[?&]lang=/.test(barra), `${ruta}: el parámetro lang se queda en la URL («${barra}»)`);

  const guardado = await evaluar("localStorage.getItem('becascout.idioma')");
  ok(guardado === 'en', `${ruta}: el idioma del enlace no se recuerda («${guardado}»)`);

  const en = await capturar();
  const cambiados = en.filter((e, i) => es[i] && e.texto !== es[i].texto).length;
  ok(cambiados / Math.max(1, es.length) >= 0.75,
    `${ruta}: la página dice estar en inglés pero el ${Math.round(100 * cambiados / Math.max(1, es.length))} % de los textos sigue en castellano`);
}

// ── La consola ───────────────────────────────────────────────────────────

console.log('');

if (erroresConsola.length) {
  console.error('Errores en la consola:');
  for (const e of erroresConsola.slice(0, 10)) console.error(`  ${e}`);
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
