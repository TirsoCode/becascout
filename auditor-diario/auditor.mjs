#!/usr/bin/env node
/**
 * auditor-diario — la revisión con IA de BecasScout, desde GitHub Actions.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────────
 *
 * 1. PATRULLA: dos rondas completas por las siete páginas en móvil (390px) y
 *    escritorio (1280px), midiendo lo que solo se ve mirando: desbordes,
 *    errores de consola, recursos que fallan, enlaces internos rotos, botones
 *    mudos, imágenes sin alt, ids repetidos.
 *
 * 2. CUENTA: la visita que solo Playwright puede hacer. Pulsa la puerta de la
 *    portada (`data-open-auth`), comprueba que abre `cuenta.html` en OTRA
 *    pestaña, entra con la cuenta de prueba (secrets) o crea una efímera,
 *    pasa la encuesta de llegada, revisa el buscador autenticado en móvil y
 *    en escritorio, abre los ajustes en lectura y —si la cuenta la creó él
 *    mismo— la borra al terminar con `DELETE /api/cuenta`, sin dejar rastro
 *    en la base de producción.
 *
 * 3. INFORME: manda todo a la nube con tres proveedores en cadena (NVIDIA
 *    con MiniMax → OpenRouter → Google AI Studio, cada uno con candidatos
 *    propios) y escribe UN informe `.md` en `reports/`, junto a un
 *    `raw-*.json` con los datos en crudo.
 *
 * ── Por qué no hay bucle infinito ─────────────────────────────────────────
 *
 * Llamar a la web en bucle sin fin, en poco tiempo, es un ataque de
 * denegación involuntario y quemar el navegador. Lo que sí hay: 2 rondas
 * completas, 3 reintentos por página con espera creciente, y doble intento
 * por proveedor de IA. Y SIEMPRE se escribe algo: aunque todo falle, queda
 * un informe determinista con los datos en crudo y el job sale en rojo.
 *
 * ── Por qué no tumba la web ───────────────────────────────────────────────
 *
 * Todo va en serie (una página a la vez), con `timeout` en todo, esperas
 * cortas entre páginas, cabecera identificativa y una sola cuenta efímera
 * por pasada con un correo del dominio `.test`, que se borra al final. Nada
 * más escribe en el sitio: ni el interruptor de avisos ni el botón de salir
 * se pulan, solo se leen.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/* ── Config ─────────────────────────────────────────────────────────────── */

// La raíz es la carpeta de arriba del auditor: `auditor-diario/` cuelga de ella.
const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CARPETA_INFORMES = path.join(RAIZ, 'reports');

const BASE = (process.env.SITE_URL || 'https://becascout.vercel.app').replace(/\/+$/, '');
const NTFY = process.env.NTFY_TOPIC || '';

// Cuenta permanente opcional (secrets TEST_EMAIL / TEST_PASSWORD). Si no hay,
// cada pasada crea una efímera y la borra al final.
const TEST_EMAIL = process.env.TEST_EMAIL || '';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

const PAGINAS = ['/', '/becas.html', '/sobre.html', '/erasmus-mundus.html', '/privacidad.html', '/cookies.html', '/cuenta.html'];
const RONDAS = 2;
const REINTENTOS_PAGINA = 3;
const TOPE_MALLOC_HTML = 16000; // recorte del HTML por página que llega a la IA
const CANDIDATOS_POR_PROVEEDOR = 3; // modelos distintos que se prueban antes de caer al siguiente proveedor

/* ── Los modelos, elegidos cada pasada ──────────────────────────────────────
 *
 * Los identificadores de modelos rotan: el que hoy es el mejor de allí
 * el mes que viene puede estar retirado, y un id escrito a mano es una
 * escritura que muere sin que nada avise. Por eso cada pasada pregunta al
 * PROPIO proveedor qué modelos viven HOY y elige el mejor de los que hay,
 * por esta lista de preferencia. Si uno de la lista no está, el siguiente.
 * Si ninguno está, cae al proveedor de atrás, y si no hay nada, al informe
 * determinista. Nada depende de un id concreto: la lista es una preferencia,
 * no un requisito.
 */
const NVIDIA = {
  key: process.env.NVIDIA_API_KEY || '',
  fijado: process.env.NVIDIA_MODEL || '',      // casilla para clavar UN modelo si algún día hace falta
  url: 'https://integrate.api.nvidia.com/v1',
  // El pedido fue explícito: NVIDIA con MiniMax. Hoy vive `minimax-m3.1-flash`
  // y contesta con `content` limpio (el razonamiento va en otro campo). Si
  // mañana el id rota, el catálogo dirá cuál hay y la lista de preferencia
  // sigue mandando: todo `minimaxai/` delante del resto.
  preferidas: ['minimaxai/minimax'],
  // Familias de chat conocidas del catálogo de NVIDIA, por si MiniMax desaparece.
  // Ids completos y verificados hoy (el listado los trae); si mañana alguno
  // rota, la pasada siguiente lo verá en el log y el relevo manda igual.
  deRelevo: ['minimaxai/minimax-m3.1-flash', 'deepseek-ai/deepseek-v4.1-flash'],
  // El catálogo de NVIDIA mezcla chat con embeddings, rerankers, visión y
  // OCR: ninguno de esos sabe escribir un informe.
  gachosNvidia: /embed|rerank|guard|retriev|ocr|specter|fuyu|vit|paddle|deplot|neva|kosmos|clip|sdxl|stable|diffusion|whisper|tts|riva|nmt|translate|dolly|arc/i,
};
const OPENROUTER = {
  key: process.env.OPENROUTER_API_KEY || '',
  fijado: process.env.OPENROUTER_MODEL || '',  // casilla para clavar UN modelo si algún día hace falta
  url: 'https://openrouter.ai/api/v1',
  // El mejor free de OpenRouter hoy, en orden de gusto. Gemini-Flash va
  // EXCLUIDO a propósito: en OpenRouter su free se queda sin cuota a diario
  // y en Google AI Studio va mejor de fuente — no hay otro motivo.
  preferidas: [
    'deepseek/deepseek-chat-v3.1',
    'deepseek/deepseek-chat-v3-0324',
    'deepseek/deepseek-r1-0528',
    'qwen/qwen3-coder',
    'moonshotai/kimi-k2',
    'meta-llama/llama-3.3-70b-instruct',
    'mistralai/mistral-small-3.2-24b-instruct',
  ],
  // Por si el catálogo propiamente dicho no contesta: los mismos, con su `:free`.
  deRelevo: [
    'deepseek/deepseek-chat-v3.1:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ],
  // Lo que se descarta del catálogo estático: los que su free acaban sin
  // cuota (el pedido lo dice explícito) y los de visión/imagen.
  gachosOpenRouter: /gemini[^,]*flash|gemini-flash|dall-e|sd-|stable-|flux|kling|midjourney|whisper|tts|embed/i,
};
const GEMINI = {
  key: process.env.GEMINI_API_KEY || '',
  fijado: process.env.GEMINI_MODEL || '',       // casilla para clavar UN modelo si algún día hace falta
  url: 'https://generativelanguage.googleapis.com/v1beta',
  // El mejor de Google AI Studio hoy, en orden de gusto: Flash es rápido, gratuito
  // y suficiente para este trabajo; Pro solo si Flash no vive.
  preferidas: [
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
    'gemini-2.5-pro',
  ],
  deRelevo: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  gachosGemini: /embedding|aqa|imagen|veo|tts|ticket|guess-/i,
};

const AGENTE = 'BecasScout-Auditor/2.0 (+https://becascout.vercel.app, revisión amable)';

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }
function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ── Hallazgos y métricas ───────────────────────────────────────────────── */

// Dedupe por firma: la segunda ronda vuelve a encontrar lo mismo, y el mismo
// bug dos veces NO son dos bugs.
const hallazgos = [];
const metricas = [];

function anotar(pagina, tipo, gravedad, descripcion, evidencia = '') {
  const firma = `${pagina}|${tipo}|${gravedad}|${descripcion}`;
  if (hallazgos.some((h) => h.firma === firma)) return;
  hallazgos.push({ firma, pagina, tipo, gravedad, descripcion, evidencia: String(evidencia).slice(0, 600) });
}

function metrica(pagina, datos) {
  metricas.push({ pagina, fecha: new Date().toISOString(), ...datos });
}

/* ── El navegador ───────────────────────────────────────────────────────── */

async function abrirNavegador() {
  // En el runner de GitHub hay Chrome del sistema preinstalado; en local, el
  // chromium de Playwright. Uno de los dos basta.
  for (const canal of [undefined, 'chrome']) {
    try {
      return await chromium.launch({
        headless: true,
        ...(canal ? { channel: canal } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    } catch (e) {
      log(`  navegador con canal ${canal ?? 'chromium'} no disponible: ${String(e.message || e).split('\n')[0].slice(0, 120)}`);
    }
  }
  throw new Error('no hay navegador disponible (ni chromium ni google-chrome)');
}

function nuevoContexto(browser, movil) {
  return browser.newContext({
    viewport: movil ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    userAgent: `${AGENTE} (${movil ? 'movil' : 'escritorio'})`,
    deviceScaleFactor: movil ? 2 : 1,
    isMobile: movil,
    timeout: 60000,
  });
}

/** Reintentos con espera creciente: la red del runner tiene días malos. */
async function conReintentos(fn, etiqueta, intentos = REINTENTOS_PAGINA) {
  let ultimo;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      log(`  reintento ${etiqueta} (${i}/${intentos}): ${String(e.message || e).slice(0, 120)}`);
      await dormir(2000 * i);
    }
  }
  throw ultimo;
}

/* ── Patrulla de una página ─────────────────────────────────────────────── */

/**
 * Todo lo determinista, sin IA: lo que se rompe mirando la página es lo que
 * los tests de lógica no ven (test/web.mjs) — y lo que quedaba para el
 * agente de vez en cuando.
 */
async function patrullar(contexto, ruta, movil, capturasHTML) {
  const vista = `${ruta}${movil ? ' (390px)' : ' (1280px)'}`;
  const pagina = await contexto.newPage();
  pagina.setDefaultTimeout(45000);

  const consola = [];
  const pagError = [];
  const recursosFallando = [];
  const peticionesFallando = [];

  pagina.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const texto = m.text();
    // «Failed to load resource» sin URL no dice nada por sí solo — el que
    // falla de verdad ya lo apunta el listener de `response`, con su URL y
    // su estado. Y el 401 de `/api/yo` sin sesión es el sondeo normal de la
    // página, no un fallo: lo mismo que filtra test/web.mjs desde siempre.
    if (/Failed to load resource/.test(texto)) return;
    consola.push({ tipo: m.type(), texto: texto.slice(0, 300) });
  });
  pagina.on('pageerror', (e) => pagError.push(String(e.message || e).slice(0, 300)));

  pagina.on('response', (r) => {
    try {
      if (!r.url().startsWith(BASE)) return;
      // El sondeo de sesión sin cuenta contesta 401 por diseño: `/api/yo`
      // es la pregunta «¿quién eres?» y sin cookie la respuesta es no.
      if (r.status() === 401 && r.url().includes('/api/yo')) return;
      if (r.status() >= 400) {
        recursosFallando.push({ url: r.url().replace(BASE, '') || '/', status: r.status() });
      }
    } catch { /* la URL a veces no se forma a mitad de cierre */ }
  });
  pagina.on('requestfailed', (r) => {
    try {
      if (r.url().startsWith(BASE)) {
        peticionesFallando.push({ url: r.url().replace(BASE, '') || '/', fallo: r.failure()?.errorText });
      }
    } catch { /* idem */ }
  });

  let estado = null;
  let titulo = '';
  let medidas = null;

  try {
    const res = await pagina.goto(BASE + ruta, { waitUntil: 'domcontentloaded', timeout: 60000 });
    estado = res?.status() ?? null;
    await pagina.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await dormir(1800);

    titulo = await pagina.title();

    medidas = await pagina.evaluate(async (origen) => {
      const d = document.documentElement;
      const retrato = (el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60), right: Math.round(r.right), ancho: Math.round(r.width) };
      };

      // Ids repetidos: un id duplicado significa un `getElementById` que pinta
      // o borra en el sitio equivocado.
      const ids = {};
      for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;

      // Imágenes rotas: `complete` con `naturalWidth === 0` es la firma del 404.
      const imgs = [...document.querySelectorAll('img')];
      const rotas = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 160));

      // Interactivos mudos: sin texto, sin aria-label y sin svg/img etiquetados
      // dentro. La CSP del sitio bloquea scripts inline, así que nada de botones
      // sin altar.
      const mudos = [...document.querySelectorAll('a,button')].filter((el) => {
        const txt = (el.textContent || '').trim();
        return !txt && !el.getAttribute('aria-label') && !el.querySelector('svg[aria-label],img[alt]');
      }).length;

      const hrefsVacios = [...document.querySelectorAll('a')].filter((a) => {
        const h = a.getAttribute('href');
        return !h || h === '#' || h.trim() === '';
      }).length;

      const imgsSinAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;

      // Enlaces internos: GET sobre el mismo origen con abort a 8s (HEAD a
      // veces contesta 403 y leería bien como roto). Tope de 25 por página:
      // el objetivo es pillar rutas rotas, no rastrear todo el sitio.
      const internos = [...new Set(
        [...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.startsWith('/'))
          .map((h) => h.replace(/#.*$/, ''))
          .filter((h) => h && h !== '/404.html')
      )].slice(0, 25);

      const enlaces404 = [];
      await Promise.all(internos.map(async (h) => {
        try {
          const ctrl = new AbortController();
          const reloj = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(`${location.origin}${h}`, { redirect: 'follow', signal: ctrl.signal });
          clearTimeout(reloj);
          if (r.status >= 400) enlaces404.push({ ruta: h, status: r.status });
        } catch { /* red del momento: la otra ronda lo dirá */ }
      }));

      return {
        scrollAncho: d.scrollWidth,
        clientAncho: d.clientWidth,
        desbordes: [...document.querySelectorAll('body *')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.right > d.clientWidth + 2 && r.width > 0; })
          .slice(0, 6)
          .map(retrato),
        idsRepetidos: Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`),
        imgsRotas: rotas,
        interactivosMudos: mudos,
        hrefsVacios,
        imgsSinAlt,
        enlaces404,
      };
    }, BASE);

    // El HTML de la página, una sola vez por página y solo en móvil: es la
    // vista que manda en este proyecto, y es la materia con la que la IA
    // puede juzgar lo que las métricas no ven.
    if (movil && !capturasHTML.has(ruta)) {
      const html = await pagina.content();
      capturasHTML.set(ruta, html.slice(0, TOPE_MALLOC_HTML));
    }

    // ── Los contrastes, con la gravedad que les toca ──────────────────────
    if (estado === 404 || estado === 500) {
      anotar(ruta, 'http', 'CRITICO', `la página responde ${estado}`);
    }
    if (medidas.scrollAncho > medidas.clientAncho + 1) {
      anotar(ruta, 'layout', 'IMPORTANTE',
        `desborde horizontal en ${movil ? '390' : '1280'} px: ${medidas.scrollAncho}px con ventana de ${medidas.clientAncho}px`,
        JSON.stringify(medidas.desbordes));
    }
    for (const e of pagError) anotar(ruta, 'js', 'CRITICO', `error de JavaScript sin capturar: ${e}`);
    for (const c of consola.filter((c) => c.tipo === 'error')) anotar(ruta, 'consola', 'IMPORTANTE', `error de consola: ${c.texto}`);
    for (const r of recursosFallando) anotar(ruta, 'red', 'IMPORTANTE', `recurso del propio origen que falla: ${r.url} → ${r.status}`);
    for (const r of peticionesFallando) anotar(ruta, 'red', 'IMPORTANTE', `petición sin respuesta: ${r.url} (${r.fallo})`);
    for (const e of medidas.enlaces404) anotar(ruta, 'enlace', 'IMPORTANTE', `enlace interno roto: ${e.ruta} → ${e.status}`);
    if (medidas.imgsRotas.length) anotar(ruta, 'media', 'MENOR', `${medidas.imgsRotas.length} imagen(es) rota(s)`, medidas.imgsRotas.join(', '));
    if (medidas.interactivosMudos > 0) anotar(ruta, 'a11y', 'MENOR', `${medidas.interactivosMudos} botón/enlace sin texto ni aria-label`);
    if (medidas.hrefsVacios > 0) anotar(ruta, 'a11y', 'MENOR', `${medidas.hrefsVacios} enlace(s) con href vacío o «#»`);
    if (medidas.imgsSinAlt > 0) anotar(ruta, 'a11y', 'MENOR', `${medidas.imgsSinAlt} imagen(es) sin alt`);
    if (medidas.idsRepetidos.length) anotar(ruta, 'dom', 'MENOR', `ids repetidos: ${medidas.idsRepetidos.join(', ')}`);

    // ── El contrato del buscador, sin sesión ──────────────────────────────
    if (ruta === '/becas.html') {
      // Espera activa también aquí: la lista llega con un `fetch` y en la
      // máquina lenta el respiro fijo contó cero fichas de una web bien.
      // Sin fichas no hay nada que medir: velo, barra y píldoras salen todas
      // del mismo pintado.
      await esperarFichas(pagina);
      const fichas = await pagina.evaluate(() => ({
        fichas: document.querySelectorAll('[data-beca]').length,
        velo: document.querySelectorAll('.lock-body').length,
        barra: !!document.querySelector('#cartel-acceso'),
        paises: document.querySelector('#pais')?.options.length ?? 0,
        pillMuralla: [...document.querySelectorAll('.beca-meta .pill')].filter((p) => p.getBoundingClientRect().width > 320).length,
        pillMasAncha: Math.max(0, ...[...document.querySelectorAll('.beca-meta .pill')].map((p) => Math.round(p.getBoundingClientRect().width))),
      }));
      metrica(vista, fichas);
      if (fichas.fichas === 0) anotar('/becas.html', 'lista', 'CRITICO', 'sin sesión no se ve ninguna ficha');
      if (fichas.velo === 0 && fichas.fichas > 0) {
        anotar('/becas.html', 'tema', 'CRITICO', 'FICHAS VISIBLES SIN SESIÓN: el velo no cubre las fichas');
      }
      if (fichas.velo > 0 && fichas.fichas === 0) {
        anotar('/becas.html', 'tema', 'CRITICO', 'hay velo pero no hay fichas debajo que cubrir');
      }
      if (fichas.paises <= 1) anotar('/becas.html', 'lista', 'IMPORTANTE', 'el desplegable de destino no trae países');
      if (!fichas.barra) anotar('/becas.html', 'tema', 'IMPORTANTE', 'no está la barra de acceso al pie del velo');
      if (fichas.pillMuralla > 0) anotar('/becas.html', 'layout', 'IMPORTANTE',
        `píldora(s) de más de 320px (${fichas.pillMuralla}): muro de texto en la ficha (más ancha: ${fichas.pillMasAncha}px)`);
    }
  } catch (e) {
    anotar(ruta, 'carga', 'CRITICO',
      `no se pudo revisar tras ${REINTENTOS_PAGINA} intentos: ${String(e.message || e).slice(0, 200)}`);
  }

  metrica(vista, {
    estado,
    titulo,
    ...medidas,
    consola: consola.slice(0, 10),
    pageErrors: pagError.slice(0, 6),
    recursosFallando: recursosFallando.slice(0, 8),
  });

  await pagina.close().catch(() => {});
}

/* ── El flujo de cuenta ─────────────────────────────────────────────────── */

/**
 * Devuelve { pestaña, correo, creado, sesion }. La pestaña es la del alta, ya
 * autenticada y aparada en la página de origen. Es la pestaña que devuelve el
 * popup de la puerta: su contexto comparte la cookie de sesión.
 *
 * Si hay secrets de cuenta permanente entra con ellos (sin crear nada). Si no
 * va el login, o no hay secrets, crea una efímera con el flujo completo de
 * alta — que es exactamente lo que hay que vigilar: la puerta, cuenta.html,
 * el registro, la encuesta y la sesión pintada.
 */
async function flujoCuenta(contexto) {
  const resumen = { correo: '', creado: false, sesion: false };
  const origen = await contexto.newPage();
  origen.setDefaultTimeout(45000);

  try {
    log('flujo de cuenta: portada → puerta → cuenta.html');
    await conReintentos(() => origen.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }), 'portada');
    await dormir(1200);

    if (!(await origen.locator('[data-open-auth]').count())) {
      anotar('/', 'cuenta', 'CRITICO', 'la portada no trae ninguna puerta de crear cuenta ([data-open-auth])');
      return resumen;
    }

    // Popup registrado ANTES del clic: si va después, la pestaña ya nació y
    // la promesa espera un evento pasado (la misma trampa de la prueba e2e).
    let alta;
    try {
      const [popup] = await Promise.all([
        contexto.waitForEvent('page', { timeout: 30000 }),
        origen.locator('[data-open-auth]').first().click(),
      ]);
      alta = popup;
    } catch (e) {
      anotar('/', 'cuenta', 'CRITICO', `la puerta no abre pestaña nueva al pulsarla: ${String(e.message || e).slice(0, 150)}`);
      return resumen;
    }
    await alta.waitForLoadState('domcontentloaded').catch(() => {});
    await dormir(1000);

    const rutaAlta = new URL(alta.url()).pathname;
    if (rutaAlta !== '/cuenta.html') {
      anotar('/', 'cuenta', 'CRITICO', `la puerta abre «${rutaAlta}» y no cuenta.html`);
      return resumen;
    }

    const listaAlta = await alta.evaluate(() => ({
      correo: !!document.querySelector('#f-correo'),
      clave: !!document.querySelector('#f-pass'),
      boton: !!document.querySelector('#f-enviar'),
      cambia: !!document.querySelector('#modal-cambia'),
    })).catch(() => ({ correo: false, clave: false, boton: false, cambia: false }));
    if (!listaAlta.correo || !listaAlta.clave || !listaAlta.boton) {
      anotar('/cuenta.html', 'cuenta', 'CRITICO', 'la página del alta no trae el formulario completo (f-correo / f-pass / f-enviar)');
      return resumen;
    }

    let dentro = null;
    if (TEST_EMAIL && TEST_PASSWORD && listaAlta.cambia) {
      await alta.locator('#modal-cambia').click();
      await dormir(300);
      await alta.locator('#f-correo').fill(TEST_EMAIL);
      await alta.locator('#f-pass').fill(TEST_PASSWORD);
      await alta.locator('#f-enviar').click();
      const volvio = await alta.waitForURL((u) => u.pathname !== '/cuenta.html', { timeout: 30000 }).then(() => true).catch(() => false);
      const sesionAlta = volvio && (await alta.evaluate(() => !!document.querySelector('.session')).catch(() => false));
      if (sesionAlta) {
        dentro = alta;
        resumen.correo = '(cuenta de prueba)';
      } else {
        const err = await alta.evaluate(() => document.querySelector('.modal-err')?.textContent?.trim() ?? '').catch(() => '');
        anotar('/cuenta.html', 'cuenta', 'IMPORTANTE',
          `la cuenta permanente no puede entrar${err ? `: «${err}»` : ' (no hay vuelta del alta en 30s)'}. Se continúa con el alta efímera.`);
        await alta.close().catch(() => {});
        dentro = await altaEphemeral(contexto);
        if (!dentro) return resumen;
        resumen.correo = await dentro.evaluate(() => window.__auditorCorreo || '').catch(() => '');
        resumen.creado = true;
      }
    } else {
      dentro = await altaEphemeral(contexto);
      if (!dentro) return resumen;
      resumen.correo = await dentro.evaluate(() => window.__auditorCorreo || '').catch(() => '');
      resumen.creado = true;
    }

    const rutaLlegada = new URL(dentro.url()).pathname;
    const sesion = await dentro.evaluate(() => !!document.querySelector('.session')).catch(() => false);
    anotarSi(!sesion, rutaLlegada === '/' ? '/' : rutaLlegada, 'cuenta', 'CRITICO',
      'la cabecera no pinta la sesión tras crear/entrar en la cuenta');
    if (!sesion) return resumen;
    resumen.sesion = true;

    // Con sesión, las puertas se van: al repintar la cabecera no queda ningún
    // «Crear cuenta» para quien ya tiene cuenta.
    const puertas = await dentro.locator('[data-open-auth]').count().catch(() => -1);
    anotarSi(puertas === -1, rutaLlegada, 'cuenta', 'MENOR', 'no se pudo contar las puertas tras la sesión');
    anotarSi(puertas > 0 && rutaLlegada === '/', '/', 'cuenta', 'IMPORTANTE',
      `la portada sigue mostrando ${puertas} puerta(s) de crear cuenta con la sesión puesta`);

    /* ── Revisión autenticada, en móvil (la pestaña ya está dentro) ─────── */
    await revisarAutenticado(dentro, 'movil');

    /* ── Ajustes, en lectura: abrir, mirar las tres piezas, recargar ────── */
    try {
      await dentro.locator('.session-perfil').click();
      await dentro.waitForFunction(() => !!document.querySelector('#ajs-t'), null, { timeout: 10000 });
      const ajustes = await dentro.evaluate(() => ({
        titulo: document.querySelector('#ajs-t')?.textContent?.trim() ?? '',
        avisos: document.querySelector('#ajs-avisos')?.getAttribute('aria-checked') ?? null,
        salir: !!document.querySelector('#ajs-salir'),
      }));
      metrica('ajustes', ajustes);
      if (!ajustes.titulo) anotar('/', 'cuenta', 'MENOR', 'los ajustes no enseñan título (#ajs-t vacío)');
      if (!ajustes.salir) anotar('/', 'cuenta', 'MENOR', 'los ajustes no traen el botón de salir (#ajs-salir)');
      // Ni el interruptor de avisos ni el salir se pulan: el auditor no cambia
      // nada del que ve. Recargar los cierra sin tocar nada.
      await dentro.reload({ waitUntil: 'domcontentloaded' });
      await dormir(1200);
    } catch (e) {
      anotar('/', 'cuenta', 'MENOR', `los ajustes no abren al pulsar el perfil: ${String(e.message || e).slice(0, 150)}`);
    }

    /* ── Las otras tres páginas autenticadas, en móvil ──────────────────── */
    for (const ruta of ['/', '/erasmus-mundus.html', '/privacidad.html']) {
      const p2 = await contexto.newPage();
      p2.on('pageerror', (e) => anotar(ruta, 'js', 'CRITICO', `error de JS con sesión: ${String(e.message || e).slice(0, 200)}`));
      p2.on('console', (m) => { if (m.type() === 'error') anotar(ruta, 'consola', 'IMPORTANTE', `error de consola con sesión: ${m.text().slice(0, 200)}`); });
      try {
        await p2.goto(BASE + ruta, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await dormir(1500);
        const d = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        if (d.sw > d.cw + 1) anotar(ruta, 'layout', 'IMPORTANTE', `desborde horizontal 390px con sesión: ${d.sw}px con ventana de ${d.cw}px`);
      } catch (e) {
        anotar(ruta, 'carga', 'IMPORTANTE', `no carga con sesión: ${String(e.message || e).slice(0, 150)}`);
      }
      await p2.close().catch(() => {});
    }

    /* ── Escritorio, autenticado: la sesión viaja en cookie ─────────────── */
    try {
      const cookies = await contexto.cookies(BASE);
      const ctxDesk = await nuevoContexto(contexto.browser(), false);
      await ctxDesk.addCookies(cookies);
      const p3 = await ctxDesk.newPage();
      await p3.goto(`${BASE}/becas.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Espera activa, no fija: el contexto es recién nacido y sin caché, y
      // en la máquina lenta el `fetch` de la base llegó tarde. Contar a tiempo
      // fijo contó cero fichas de una web que estaba bien.
      const nEscritorio = await esperarFichas(p3);
      const escritorio = await p3.evaluate(() => ({
        fichas: document.querySelectorAll('[data-beca]').length,
        velo: document.querySelectorAll('.lock-body').length,
        columnas: document.querySelector('.beca')
          ? getComputedStyle(document.querySelector('.beca')).gridTemplateColumns
          : '',
        desborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      metrica('becas autenticado (1280px)', escritorio);
      anotarSi(escritorio.fichas === 0, '/becas.html', 'lista', 'IMPORTANTE', 'escritorio autenticado: ninguna ficha tras esperar 15s a la lista');
      anotarSi(escritorio.velo > 0, '/becas.html', 'tema', 'IMPORTANTE', 'escritorio autenticado: sigue el velo con la sesión puesta');
      // La columna solo se mide con ficha delante: sin ficha, el estilo que se
      // lee es el del `body` y diría «sin columna» de una web que está bien.
      anotarSi(escritorio.fichas > 0 && !escritorio.columnas.includes(' '), '/becas.html', 'layout', 'MENOR', 'escritorio: la ficha no se reparte en dos columnas (grid sin columna)');
      anotarSi(escritorio.desborde, '/becas.html', 'layout', 'IMPORTANTE', 'escritorio autenticado: desborde horizontal');
      await p3.close().catch(() => {});
      await ctxDesk.close();
    } catch (e) {
      anotar('/becas.html', 'layout', 'MENOR', `no se pudo la pasada de escritorio autenticada: ${String(e.message || e).slice(0, 150)}`);
    }

    return resumen;
  } catch (e) {
    anotar('/', 'cuenta', 'CRITICO', `el flujo de cuenta reventó de punta a punta: ${String(e.message || e).slice(0, 200)}`);
    return resumen;
  } finally {
    await origen.close().catch(() => {});
  }
}

/**
 * El alta efímera: correo y contraseña que nacen aquí, prueban TODO el camino
 * del alta (registro → encuesta → sesión) y la cuenta se borra al final de la
 * pasada. La cuenta permanente, si hay, no se toca NUNCA.
 *
 * La contraseña no se escribe en ningún log. La fichas del informe llevará el
 * correo solo si la cuenta no se pudo borrar, para que se elimine a mano.
 */
async function altaEphemeral(contexto) {
  const correo = `auditor.${Date.now()}.${crypto.randomBytes(2).toString('hex')}@bs-auditor.test`;
  const clave = `Bs${crypto.randomBytes(8).toString('base64url')}`; // ≥10 y con mayúscula
  log(`  alta efímera: ${correo} (la contraseña no se registra)`);

  const alta = await contexto.newPage();
  alta.setDefaultTimeout(45000);

  try {
    await alta.goto(`${BASE}/cuenta.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dormir(800);
    await alta.evaluate((c) => { window.__auditorCorreo = c; }, correo);

    await alta.locator('#f-correo').fill(correo);
    await alta.locator('#f-pass').fill(clave);
    await alta.locator('#f-enviar').click();

    const volvio = await alta.waitForURL((u) => u.pathname !== '/cuenta.html', { timeout: 30000 }).then(() => true).catch(() => false);
    if (!volvio) {
      const err = await alta.evaluate(() => document.querySelector('.modal-err')?.textContent?.trim() ?? '').catch(() => '');
      anotar('/cuenta.html', 'cuenta', 'CRITICO',
        `el registro de una cuenta nueva falla: ${err || 'sin error visible y sin vuelta al origen en 30s'}`);
      await alta.close().catch(() => {});
      return null;
    }

    // En un contexto recién nacido la encuesta SIEMPRE sale (así está en la
    // prueba e2e: nadie ha contestado nunca en este navegador). Se pasa con su
    // «pasar»: no se anota ningún origen falso en la base.
    const encuesta = await alta.waitForSelector('#enc-t', { timeout: 30000 }).then(() => true).catch(() => false);
    if (!encuesta) {
      anotar('/becas.html', 'cuenta', 'IMPORTANTE', 'la encuesta de llegada no aparece tras crear cuenta (#enc-t en 30s)');
    } else {
      await alta.locator('.enc-skip button').click();
      const seFue = await alta.waitForFunction(() => {
        const e = document.querySelector('#enc-t');
        return !e || getComputedStyle(e).display === 'none';
      }, null, { timeout: 15000 }).then(() => true).catch(() => false);
      anotarSi(!seFue, '/becas.html', 'cuenta', 'MENOR', 'pasar la encuesta no la quita de la pantalla en 15s');
    }

    return alta;
  } catch (e) {
    anotar('/cuenta.html', 'cuenta', 'CRITICO', `el alta efímera no se pudo completar: ${String(e.message || e).slice(0, 200)}`);
    await alta.close().catch(() => {});
    return null;
  }
}

/**
 * Espera a que la lista tenga fichas, con tope. La espera FIJA de 2,5 s se
 * quedó corta en la máquina lenta de la primera prueba: en escritorio, con el
 * contexto recién nacido y sin caché, el `fetch` de `data/becas.json` llegó
 * tarde y el auditor contó cero fichas de una web que estaba bien. Lo que se
 * espera es lo que importa — que haya fichas —, no que pasen milisegundos.
 */
async function esperarFichas(pagina, topeMs = 15000) {
  const n = await pagina.waitForFunction(
    () => document.querySelectorAll('[data-beca]').length,
    null,
    { timeout: topeMs, polling: 400 },
  ).then((h) => h.jsonValue()).catch(() => 0);
  return n;
}

async function revisarAutenticado(pagina, etiqueta) {
  try {
    await conReintentos(() => pagina.goto(`${BASE}/becas.html`, { waitUntil: 'domcontentloaded', timeout: 60000 }), `becas con sesión ${etiqueta}`);
    const fichas = await esperarFichas(pagina);
    const datos = await pagina.evaluate(() => ({
      fichas: document.querySelectorAll('[data-beca]').length,
      velo: document.querySelectorAll('.lock-body').length,
      cartelAcceso: !!document.querySelector('#cartel-acceso'),
      requisito: document.querySelectorAll('.req').length,
      sinCita: [...document.querySelectorAll('.req')].filter((r) => !r.querySelector('.req-src')).length,
      conReqs: [...document.querySelectorAll('[data-beca]')].filter((b) => b.querySelector('.req')).length,
    }));
    metrica(`becas autenticado ${etiqueta}`, datos);

    anotarSi(datos.fichas === 0, '/becas.html', 'lista', 'CRITICO', 'con sesión la lista no enseña ninguna ficha');
    anotarSi(datos.velo > 0, '/becas.html', 'tema', 'CRITICO', `con sesión sigue el velo (lock-body) sobre las fichas`);
    anotarSi(datos.cartelAcceso, '/becas.html', 'tema', 'IMPORTANTE', 'con sesión sigue la barra «inicia sesión» al pie');
    anotarSi(datos.requisito > 0 && datos.sinCita > 0, '/becas.html', 'datos', 'CRITICO',
      `LA REGLA DEL PROYECTO: ${datos.sinCita} requisito(s) se muestra(n) SIN su cita (.req-src)`);
    anotarSi(datos.fichas > 0 && datos.conReqs === 0, '/becas.html', 'datos', 'IMPORTANTE',
      `${datos.fichas} fichas y ninguna trae requisitos (.req): la extracción no llega a nada visible`);

    // Y el momento de la búsqueda: el beat termina y vuelve la lista.
    await pagina.evaluate(() => document.querySelector('#buscar')?.click());
    const finBeat = await pagina.waitForFunction(() => !document.querySelector('.buscando'), null, { timeout: 20000 }).then(() => true).catch(() => false);
    anotarSi(!finBeat, '/becas.html', 'lista', 'IMPORTANTE', 'el beat de búsqueda no termina (el cartel .buscando no se va en 20s)');

    return datos;
  } catch (e) {
    anotar('/becas.html', 'carga', 'IMPORTANTE', `la revisión autenticada falló: ${String(e.message || e).slice(0, 150)}`);
    return null;
  }
}

function anotarSi(cond, ...resto) { if (cond) anotar(...resto); }

/**
 * La limpieza. Solo la cuenta creada en esta pasada se borra, con el trámite
 * del servidor (`confirmar` con el correo). Después se comprueba que la sesión
 * murió con ella: una sesión que sobrevive a su cuenta sería un bug grave que
 * esta comprobación atraparía.
 */
async function borrarCuenta(contexto, correo) {
  if (!correo || !correo.includes('@bs-auditor.test')) return;
  const p = await contexto.newPage();
  try {
    const estado = await p.evaluate(async (c) => {
      const r = await fetch('/api/cuenta', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmar: c }),
      });
      const y = await fetch('/api/yo');
      return { borrar: r.status, yoDespues: y.status };
    }, correo);
    metrica('limpieza', estado);
    if (estado.borrar !== 200) {
      anotar('/', 'limpieza', 'IMPORTANTE',
        `no se pudo borrar la cuenta efímera (DELETE → ${estado.borrar}): queda en la base, borrarla a mano con el correo «${correo}»`);
    } else if (estado.yoDespues !== 401) {
      anotar('/', 'cuenta', 'CRITICO',
        'tras borrar la cuenta la sesión sigue viva (/api/yo no contesta 401): sesiones que no mueren con su cuenta');
    }
  } catch (e) {
    anotar('/', 'limpieza', 'IMPORTANTE', `no se pudo borrar la cuenta efímera: ${String(e.message || e).slice(0, 150)}`);
  } finally {
    await p.close().catch(() => {});
  }
}

/* ── La IA en la nube, en cadena ────────────────────────────────────────── */

/** Recorta lo que no ayuda: solo una traza de lo que sobra, nada de llaves. */
function paqueteParaIA(datos) {
  return JSON.stringify({
    web: BASE,
    fecha: new Date().toISOString(),
    hallazgos: datos.hallazgos.map(({ pagina, tipo, gravedad, descripcion, evidencia }) => ({ pagina, tipo, gravedad, descripcion, evidencia })),
    metricas: datos.metricas,
    html: datos.capturas,
  }, null, 2);
}

function instruccionesIA() {
  return `Actúas como auditor QA senior de becascout.

# EL PROYECTO (tres reglas que deciden si algo es bug)
1. "Ningún dato se muestra sin su cita": todo requisito visible va con su cita
   (.req-src). Un requisito sin cita es un bug CRÍTICO.
2. Nunca se muestra probabilidad de éxito ni porcentajes de encaje: si ves uno,
   es CRÍTICO (es un dato inventado).
3. Sin cuenta, la lista de becas se ve TAPIADA (blur + retícula) y se puede
   leer el DOM. Fichas visibles sin sesión (sin velo) es CRÍTICO. El velo debe
   ir SIN marcas dentro y con UNA barra de acceso fuera, al pie.

# LO QUE SÍ ES BUG
- Errores JS / consola, recursos o enlaces internos rotos, páginas 404/500.
- Desbordes horizontales (390px y 1280px), píldoras/muros de más de 320px.
- El alta: puerta que no abre pestaña, formulario muerto, sin vuelta al
  origen, sin encuesta tras crear cuenta, cabecera sin sesión, puertas que no
  desaparecen con sesión, ajustes que no abren.
- Una sesión que sobrevive a la cuenta borrada.
- Datos: fichas sin requisitos visibles, fechas de cierre absurdas,
  citas vacías o cortadas ilegibles, importes que parecen presupuesto
  mostrados como importe de la beca.
- Flujos muertos: el beat de búsqueda que no termina, filtro que no recorta.

# LO QUE NO ES BUG (no lo pongas)
- Ruido estético: colores, tipografía, jerarquía visual, "se mostraría mejor".
- Recursos externos que fallan (BOE, fuentes de Google, CDNs): el repositorio
  no puede arreglarlos; márcalos como observación si acaso.
- El HTML revisado solo llega hasta el usuario con sesión; lo que NO ves no lo
  inventes: si algo no está en los datos, di "no observado en estos datos".

# FORMATO EXACTO DE TU RESPUESTA (markdown)
# Auditoría IA BecasScout — {FECHA}
## Estado general
(2-4 líneas: qué tal está, cuántos críticos/importantes/menores)
## Hallazgos críticos
Para cada uno: **Título** — página. Qué pasa. Cómo se reproduce. Evidencia
(la de los datos). Fix sugerido con archivo probable (js/*.js, *.html, styles.css).
Si no hay: «Sin hallazgos críticos.»
## Hallazgos importantes
(Mismo formato. Si no hay: «Sin hallazgos importantes.»)
## Hallazgos menores
(Mismo formato, sin detalle de reproducción si es trivial.)
## Sugerencias
Ideas concretas y verificables de mejora técnica NO bloqueante (robustez,
accesibilidad, rendimiento). Máximo 5, y nada de pura estética.
## Checklist para el agente que arregla
Lista accionable con casillas, una por bug, con el fichero al que ir.
## Sin observados
Lo que no se pudo comprobar con estos datos.

Sé seco y concreto. NO la marees: nada de genérico sin evidencia.`.replace('{FECHA}', new Date().toISOString().slice(0, 10));
}

/* ── La IA en la nube, en cadena ────────────────────────────────────────── */

/**
 * Cada proveedor contesta ANTES de llamarse qué modelos viven hoy. Con la
 * lista en la mano se elige el mejor de los que hay — el id escrito a mano
 * era una escritura que muere silenciosa; la lista viva no puede estar vieja,
 * porque se acaba de bajar.
 *
 * Orden: OpenRouter → Google AI Studio → informe determinista. Dentro de cada
 * proveedor, hasta `CANDIDATOS_POR_PROVEEDOR` modelos distintos, uno a uno.
 */

/** El catálogo de NVIDIA: ids vivos hoy, sin embeddings ni visión. */
async function modelosNvidia() {
  const resp = await fetch(`${NVIDIA.url}/models`, {
    headers: { authorization: `Bearer ${NVIDIA.key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`catálogo NVIDIA ${resp.status}`);
  const { data } = await resp.json();
  if (!Array.isArray(data)) throw new Error('catálogo NVIDIA con forma rara');

  return data
    .map((m) => ({ id: m.id, ctx: 0 }))   // el listado no trae contexto: la calidad decide por familia
    .filter((m) => !NVIDIA.gachosNvidia.test(m.id));
}

/** El catálogo de OpenRouter, a lista de {id, contexto} vivos y gratis. */
async function modelosOpenRouter() {
  const resp = await fetch(`${OPENROUTER.url}/models`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`catálogo OpenRouter ${resp.status}`);
  const { data } = await resp.json();
  if (!Array.isArray(data)) throw new Error('catálogo OpenRouter con forma rara');

  return data
    .filter((m) => {
      // Free de verdad: el precio de entrada y de salida, a cero. Un id con
      // prefijo `:free` que cobre por algo entra igual — el catálogo manda.
      const p = m.pricing || {};
      return (String(p.prompt) === '0' && String(p.completion) === '0')
        || String(m.id).endsWith(':free');
    })
    .filter((m) => (m.context_length || 0) >= 65536)          // el paquete (métricas + 7 HTML) ronda los 40k tokens: 32k se queda corto
    .filter((m) => !OPENROUTER.gachosOpenRouter.test(m.id))   // sin gemini-flash ni de imagen
    .map((m) => ({ id: m.id, ctx: m.context_length || 0 }));
}

/** El catálogo de Google AI Studio: qué modelos aceptan generateContent HOY. */
async function modelosGemini() {
  const resp = await fetch(`${GEMINI.url}/models?key=${GEMINI.key}&pageSize=200`, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`catálogo Gemini ${resp.status}`);
  const { models } = await resp.json();
  if (!Array.isArray(models)) throw new Error('catálogo Gemini con forma rara');

  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .filter((m) => !GEMINI.gachosGemini.test(m.name))
    .map((m) => ({ id: String(m.name).replace(/^models\//, ''), ctx: m.inputTokenLimit || 0 }));
}

/**
 * La calidad de un modelo que NO está en la lista de preferidas, a ojo de
 * catálogo: las familias grandes conocidas delante, lo pequeño y lo
 * especializado (clasificadores, previews, modelos de 3b) atrás, y el
 * contexto como desempate. No es ciencia: es para que, el día que la lista
 * de preferidas entera haya rotado —y rotan, se ha visto—, el elegido sea
 * el grande de turno y no el primer id corto que aparezca.
 */
function calidad({ id, ctx }) {
  let puntos = 0;
  if (/deepseek|nemotron.*ultra|qwen3|llama-?[34]|kimi|glm-4|minimax|mistral-(large|medium)|gpt-oss/i.test(id)) puntos += 60;
  if (/70b|72b|120b|235b|405b|480b|550b|253b/i.test(id)) puntos += 20;
  if (/nano|mini|-xs\b|content-safety|safety|guard|lightning|preview|omni|\b[0-9.]+b\b/i.test(id) && !/70b|72b|120b|235b|405b|480b|550b|253b/i.test(id)) puntos -= 50;
  return puntos + Math.min(ctx / 100000, 10);
}

/**
 * De la lista de preferencia, los que están vivos hoy, en ese orden. Si la
 * casilla fija (`OPENROUTER_MODEL`/`GEMINI_MODEL`) está puesta y vive, manda
 * ella delante; si está puesta y MURIO, se cae al resto sin drama.
 */
function ordenarVivas(preferidas, vivas) {
  const indice = (id) => {
    for (let i = 0; i < preferidas.length; i++) if (id.startsWith(preferidas[i])) return i;
    return preferidas.length; // vivos pero no en la lista: los ordena `calidad`
  };
  return [...vivas].sort((a, b) =>
    (indice(a.id) - indice(b.id))
    || (indice(a.id) < preferidas.length ? 0 : calidad(b) - calidad(a))
    || b.ctx - a.ctx
  ).map((m) => m.id);
}

/** La cola entera de candidatos de NVIDIA, lista de vivos hoy. */
async function colaNvidia() {
  const cola = [];
  if (NVIDIA.fijado) cola.push(NVIDIA.fijado);
  try {
    const vivas = await modelosNvidia();
    if (!vivas.length) throw new Error('el catálogo no trae ningún modelo de chat');
    for (const id of ordenarVivas(NVIDIA.preferidas, vivas)) if (!cola.includes(id)) cola.push(id);
    log(`  NVIDIA: ${vivas.length} modelos de chat vivos hoy; primero «${cola[0]}»`);
  } catch (e) {
    log(`  NVIDIA: catálogo no contestó (${String(e.message || e).slice(0, 120)}): relevo fijo`);
    for (const id of NVIDIA.deRelevo) if (!cola.includes(id)) cola.push(id);
  }
  return cola.slice(0, CANDIDATOS_POR_PROVEEDOR);
}

/** La cola entera de candidatos de OpenRouter, lista de vivos hoy. */
async function colaOpenRouter() {
  const cola = [];
  if (OPENROUTER.fijado) cola.push(OPENROUTER.fijado); // la casilla manda, si está
  try {
    const vivas = await modelosOpenRouter();
    if (!vivas.length) throw new Error('el catálogo no trae ningún free con contexto ≥32k');
    for (const id of ordenarVivas(OPENROUTER.preferidas, vivas)) if (!cola.includes(id)) cola.push(id);
    log(`  OpenRouter: ${vivas.length} modelos free vivos hoy; primero «${cola[0]}»`);
  } catch (e) {
    log(`  OpenRouter: catálogo no contestó (${String(e.message || e).slice(0, 120)}): relevo fijo`);
    for (const id of OPENROUTER.deRelevo) if (!cola.includes(id)) cola.push(id);
  }
  return cola.slice(0, CANDIDATOS_POR_PROVEEDOR);
}

async function colaGemini() {
  const cola = [];
  if (GEMINI.fijado) cola.push(GEMINI.fijado);
  try {
    const vivas = await modelosGemini();
    if (!vivas.length) throw new Error('el catálogo no trae ningún modelo de texto');
    for (const id of ordenarVivas(GEMINI.preferidas, vivas)) if (!cola.includes(id)) cola.push(id);
    log(`  Gemini: ${vivas.length} modelos de texto vivos hoy; primero «${cola[0]}»`);
  } catch (e) {
    log(`  Gemini: catálogo no contestó (${String(e.message || e).slice(0, 120)}): relevo fijo`);
    for (const id of GEMINI.deRelevo) if (!cola.includes(id)) cola.push(id);
  }
  return cola.slice(0, CANDIDATOS_POR_PROVEEDOR);
}

async function pedirIA(paquete) {
  const prompt = `${instruccionesIA()}\n\n# LOS DATOS RECOGIDOS\n${paquete}`;

  // Un intento por candidato: tres candidatos por proveedor dan ya tres
  // apuestas distintas, que gastan mejor que tres al mismo id.
  const probarModelo = async (modelo, fn, proveedor) => {
    try {
      const texto = await fn(prompt, modelo);
      log(`  informe via ${proveedor} con «${modelo}»`);
      return { texto, proveedor: `${proveedor} · ${modelo}` };
    } catch (e) {
      log(`  ${proveedor} «${modelo}» falló: ${String(e.message || e).slice(0, 160)}`);
      await dormir(2000);
      return null;
    }
  };

  if (NVIDIA.key) {
    for (const modelo of await colaNvidia()) {
      const r = await probarModelo(modelo, llamarNvidia, 'NVIDIA');
      if (r) return r;
    }
  } else {
    log('  sin NVIDIA_API_KEY, se salta');
  }

  if (OPENROUTER.key) {
    for (const modelo of await colaOpenRouter()) {
      const r = await probarModelo(modelo, llamarOpenRouter, 'OpenRouter');
      if (r) return r;
    }
  } else {
    log('  sin OPENROUTER_API_KEY, se salta');
  }

  if (GEMINI.key) {
    for (const modelo of await colaGemini()) {
      const r = await probarModelo(modelo, llamarGemini, 'Gemini');
      if (r) return r;
    }
  } else {
    log('  sin GEMINI_API_KEY, se salta');
  }

  return null;
}

async function llamarNvidia(prompt, modelo) {
  const resp = await fetch(`${NVIDIA.url}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(240000),
    headers: {
      authorization: `Bearer ${NVIDIA.key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      temperature: 0.2,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const mensaje = data.choices?.[0]?.message ?? {};
  // MiniMax deja el razonamiento en `reasoning_content` y la respuesta en
  // `content`. Si un día el modelo pone todo en el razonamiento y `content`
  // vacío, el informe seguiría saliendo — mejor un informe con el hilo
  // pensado de por medio que ninguno.
  const texto = mensaje.content || mensaje.reasoning_content || '';
  if (!texto) throw new Error('respuesta vacía');
  return texto;
}

async function llamarOpenRouter(prompt, modelo) {
  const resp = await fetch(`${OPENROUTER.url}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(240000),
    headers: {
      authorization: `Bearer ${OPENROUTER.key}`,
      'content-type': 'application/json',
      'HTTP-Referer': BASE,
      'X-Title': 'BecasScout Auditor',
    },
    body: JSON.stringify({
      model: modelo,
      temperature: 0.2,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const texto = data.choices?.[0]?.message?.content;
  if (!texto) throw new Error('respuesta vacía');
  return texto;
}

async function llamarGemini(prompt, modelo) {
  const resp = await fetch(`${GEMINI.url}/models/${modelo}:generateContent?key=${GEMINI.key}`, {
    method: 'POST',
    signal: AbortSignal.timeout(240000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
    }),
  });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const texto = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n');
  if (!texto) throw new Error(`respuesta vacía: ${JSON.stringify(data).slice(0, 200)}`);
  return texto;
}

/* ── El informe determinista (cuando la IA no responde) ─────────────────── */

function informeSinIA(datos) {
  const c = datos.hallazgos.filter((h) => h.gravedad === 'CRITICO');
  const i = datos.hallazgos.filter((h) => h.gravedad === 'IMPORTANTE');
  const m = datos.hallazgos.filter((h) => h.gravedad === 'MENOR');
  const fecha = new Date().toISOString();

  const linea = (h) => `- **${h.gravedad}** \`${h.pagina}\` — ${h.tipo}: ${h.descripcion}${h.evidencia ? `\n  Evidencia: ${h.evidencia}` : ''}`;

  return `# Auditoría BecasScout — ${fecha}
> Informe determinista: la IA no respondió (ninguno de los dos proveedores),
> pero los datos están en \`reports/raw-*.json\` para pasarlos a mano.

## Estado general
${c.length} críticos · ${i.length} importantes · ${m.length} menores.

## Hallazgos críticos
${c.length ? c.map(linea).join('\n') : 'Sin hallazgos críticos.'}

## Hallazgos importantes
${i.length ? i.map(linea).join('\n') : 'Sin hallazgos importantes.'}

## Hallazgos menores
${m.length ? m.map(linea).join('\n') : 'Sin hallazgos menores.'}

## Checklist para el agente que arregla
${datos.hallazgos.length
    ? datos.hallazgos.map((h, n) => `${n + 1}. [ ] ${h.gravedad} — ${h.pagina}: ${h.descripcion}`).join('\n')
    : '1. [ ] Sin hallazgos en esta pasada.'}
`;
}

/* ── Aviso ntfy ─────────────────────────────────────────────────────────── */

async function avisar(fichas, criticos) {
  if (!NTFY) return;
  try {
    await fetch(`https://ntfy.sh/${NTFY}`, {
      method: 'POST',
      headers: { Title: `Auditoría: ${criticos ? `${criticos} CRÍTICOS` : 'sin críticos'}`, Priority: criticos > 3 ? 'high' : 'default', Tags: 'bug' },
      body: `Informe: ${fichas.join(', ')}\nCríticos: ${criticos}\nSe usa reports/ → opencode.`,
    });
    log('  aviso ntfy enviado');
  } catch (e) {
    log(`  ntfy no pudo avisar: ${String(e.message || e).slice(0, 120)}`);
  }
}

/* ── La pasada entera ───────────────────────────────────────────────────── */

async function main() {
  log(`auditor de ${BASE}`);
  fs.mkdirSync(CARPETA_INFORMES, { recursive: true });

  const browser = await abrirNavegador();
  const capturas = new Map(); // ruta → HTML recortado, una muestra por página

  let resumenCuenta = { correo: '', creado: false, sesion: false };

  try {
    for (let ronda = 1; ronda <= RONDAS; ronda++) {
      log(`── ronda ${ronda}/${RONDAS} ──`);
      for (const movil of [true, false]) {
        const ctx = await nuevoContexto(browser, movil);
        for (const ruta of PAGINAS) {
          await patrullar(ctx, ruta, movil, capturas);
          await dormir(400); // respiro entre páginas: la web no es safari
        }
        if (movil && ronda === 1) {
          // El flujo de cuenta, una sola vez y en móvil: es donde vive el
          // estudiante y donde la rendija del alta pica más.
          resumenCuenta = await flujoCuenta(ctx);
          if (resumenCuenta.creado) {
            await borrarCuenta(ctx, resumenCuenta.correo);
          }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const datos = { hallazgos, metricas, capturas: Object.fromEntries(capturas), resumenCuenta: { ...resumenCuenta, correo: undefined } };
  const g = (n) => hallazgos.filter((h) => h.gravedad === n).length;
  log(`hallazgos: ${g('CRITICO')} críticos · ${g('IMPORTANTE')} importantes · ${g('MENOR')} menores`);

  // ── Guardar el raw SIEMPRE, informe IA si la nube responde ─────────────
  const sello = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const rawPath = path.join(CARPETA_INFORMES, `raw-${sello}.json`);
  fs.writeFileSync(rawPath, JSON.stringify(datos, null, 2));
  log(`raw guardado: reports/${path.basename(rawPath)}`);

  let informes = [];
  let exitoIA = false;

  const ia = await pedirIA(paqueteParaIA(datos));
  if (ia) {
    const reporteAI = `# (informe via ${ia.proveedor})\n\n${ia.texto}`;
    informes.push(path.basename(`bug-report-${sello}.md`));
    fs.writeFileSync(path.join(CARPETA_INFORMES, informes[0]), reporteAI);
    exitoIA = true;
  } else {
    informes.push(path.basename(`bug-report-sinIA-${sello}.md`));
    fs.writeFileSync(path.join(CARPETA_INFORMES, informes[0]), informeSinIA(datos));
  }

  // ── Resumen de consola, para ver sin abrir el fichero ───────────────────
  console.log('\n' + '='.repeat(64));
  console.log(`AUDITORÍA COMPLETADA${exitoIA ? '' : ' (SIN IA: informe determinista)'}`);
  console.log(`  Críticos:     ${g('CRITICO')}`);
  console.log(`  Importantes:  ${g('IMPORTANTE')}`);
  console.log(`  Menores:      ${g('MENOR')}`);
  console.log(`  Informe:      reports/${informes[0]}`);
  console.log(`  Datos crudos: reports/${path.basename(rawPath)}`);
  for (const h of hallazgos.slice(0, 12)) console.log(`  [${h.gravedad}] ${h.pagina}: ${h.descripcion.slice(0, 110)}`);
  console.log('='.repeat(64) + '\n');

  await avisar(informes, g('CRITICO'));

  // Hallazgos críticos → salida 1: el job rojo cuenta como un bug más.
  if (!exitoIA) process.exitCode = 1;
  if (g('CRITICO') > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('AUDITOR ROTO:', e);
  process.exit(1);
});
