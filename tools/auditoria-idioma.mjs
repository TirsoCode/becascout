/**
 * auditoria-idioma.mjs — busca el castellano que sobrevive a ?lang=en.
 *
 * Dos pases:
 *   1. estático: toda clave data‑i18n / t('…') de HTML y JS tiene que existir en
 *      el diccionario de js/i18n.js. Una clave que falta deja el castellano
 *      original sin avisar y la página sale en español con EN puesto.
 *   2. dinámico (con --web o --url): con Playwright carga cada página con
 *      ?lang=en y manda el texto visible; aquí en Node se busca palabras que
 *      no existen en buen inglés. Cae lo que el pase 1 no ve: un elemento sin
 *      data-i18n y una cadena de JS pintada fuera de t().
 *
 * Uso:  node tools/auditoria-idioma.mjs            (solo pase 1)
 *       node tools/auditoria-idioma.mjs --web      (los dos, contra serve.mjs)
 *       node tools/auditoria-idioma.mjs --url http://localhost:5173
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/* ── el diccionario, tal cual lo lee i18n.js ───────────────────────────── */

const fuenteDict = readFileSync(join(RAIZ, 'js/i18n.js'), 'utf8');
const cuerpo = fuenteDict.slice(fuenteDict.indexOf('const DICC = {'), fuenteDict.indexOf('const CLAVE ='));
const clavesDict = new Set();
const esDeClave = new Map();
/* Las entradas van en una línea o en tres — «clave': { en: '…' },» con
   plantillas {n} dentro y comillas escapadas. El escaneo cuenta llaves mirando
   cuándo va dentro de una cadena, así que ni unas ni otras lo confunden. */
function barrido(d, desde) {
  let dentro = false, esc = false, hondo = 0;
  for (let i = desde; i < d.length; i++) {
    const c = d[i];
    if (dentro) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === "'") dentro = false;
    } else {
      if (c === "'") dentro = true;
      else if (c === '{') hondo++;
      else if (c === '}') {
        hondo--;
        if (hondo === 0) return i;
      }
    }
  }
  return d.length;
}
let ultima = fuenteDict.indexOf("const DICC = {");
const finDict = fuenteDict.indexOf('const CLAVE =');
const cuerpos = [];
const reClave = /'([^']+)':\s*\{/g;
let m;
while ((m = reClave.exec(fuenteDict)) && m.index < finDict) {
  const fin = barrido(fuenteDict, m.index + m[0].length - 1);
  cuerpos.push({ clave: m[1], cuerpo: fuenteDict.slice(m.index, fin) });
  reClave.lastIndex = fin;
}
for (const { clave, cuerpo: cu } of cuerpos) {
  clavesDict.add(clave);
  const es = cu.match(/es:\s*'((?:[^'\\]|\\.)*)'/);
  if (es) esDeClave.set(clave, es[1]);
}
if (cuerpos.length < 300) {
  console.error(`pocos: el parser del diccionario solo vio ${cuerpos.length} entradas`);
  process.exit(2);
}

/* ── 1. referencias que no están en el diccionario ─────────────────────── */

const paginas = readdirSync(RAIZ).filter((f) => f.endsWith('.html'));
const faltantes = [];

for (const pag of paginas) {
  const html = readFileSync(join(RAIZ, pag), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-html|-title|-aria|-ph)?="([^"]+)"/g)) {
    if (!clavesDict.has(m[1])) faltantes.push(`[data-i18n] ${pag}: ${m[1]}`);
  }
}

const jsDir = join(RAIZ, 'js');
for (const nombre of readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
  const js = readFileSync(join(jsDir, nombre), 'utf8');
  for (const m of js.matchAll(/\bt\('([^']+)'/g)) {
    /* i18n.js documenta la forma en su cabecera con un ejemplo; ahí la clave
       es de mentira y no es un fallo. */
    if (nombre === 'i18n.js') continue;
    if (!clavesDict.has(m[1])) faltantes.push(`[t()] js/${nombre}: ${m[1]}`);
  }
}

console.log(`diccionario: ${clavesDict.size} claves`);
if (faltantes.length === 0) {
  console.log('pase 1 ✓  todas las claves referenciadas existen');
} else {
  console.log(`pase 1 ✗  ${faltantes.length} claves referenciadas que NO están en el diccionario:`);
  for (const f of faltantes) console.log(`   ${f}`);
}

/* ── 2. lo que se ve en el navegador ───────────────────────────────────── */

if (!process.argv.includes('--web') && !process.argv.includes('--url')) process.exit(faltantes.length ? 1 : 0);

const base = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5173';
const { chromium } = await import(join(RAIZ, 'node_modules/playwright/index.mjs'));

/* Palabras y marcas que delatan castellano cuando el navegador está en EN.
   Nombres propios (BOE, Erasmus, BecasScout) quedan fuera a propósito y los
   signos «» y ¿ son huella sola. Sin palabras sueltas como «de» o «la»:
   sin texto que las acompañe no delatan nada y traen falsos positivos. */
const HUELLAS = [/«|»|¿|¡/, /á|é|í|ó|ú|ñ/i, /\b(becas?|plazos?|convocatorias?|requisitos?|usuario|cuentas?|correos?|sesión|contraseña|avisos?|cierr(?:e|a|an)|cerro|prefiero|sobre|como|los|las)\b/];

let navegador;
try {
  navegador = await chromium.launch({ channel: 'chrome' });
} catch {
  navegador = await chromium.launch();
}

let totales = 0;
for (const pag of paginas) {
  if (pag === '404.html') continue;
  const url = `${base}/${pag}?lang=en`;
  const pagina = await navegador.newPage({ viewport: { width: 390, height: 844 } });
  await pagina.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await pagina.waitForTimeout(700);

  /* La página ya está en EN: lo que miramos son los nodos visibles y los
     atributos de los controles. Cada cadena llega con quién la escribió. */
  const cadenas = await pagina.evaluate(() => {
    const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const fuera = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'];
    const salida = [];

    const uw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (fuera.includes(n.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
        if (!n.textContent.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement.offsetParent === null) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = uw.nextNode(); n; n = uw.nextNode()) {
      const el = n.parentElement;
      /* La lista con el velo es contenido: las fichas del BOE son castellanas
         en todos los idiomas porque son datos. No delatan nada. */
      if (el.closest('.lock, .velo, .lock-barra')) continue;
      /* Las citas van en el idioma de la fuente, y los nombres de los
         programas de Erasmus son del catálogo: se citan tal cual. */
      if (el.closest('cite')) continue;
      if (el.closest('td') && !el.closest('td').querySelector('[data-i18n]')) continue;
      salida.push(`[texto ${el.tagName.toLowerCase()}${el.dataset.i18n ? ` #${el.dataset.i18n}` : ''}] ${limpio(n.textContent)}`);
    }
    for (const el of document.querySelectorAll('input, textarea, button, [title], [aria-label]')) {
      if (!document.body.contains(el)) continue;
      if (el.closest('.lock, .velo')) continue;
      if (el instanceof HTMLInputElement && el.type !== 'hidden') {
        if (el.placeholder) salida.push(`[placeholder ${el.name || el.id || el.type}] ${el.placeholder}`);
      }
      for (const [atr, nombre] of [[el.getAttribute('title'), 'title'], [el.getAttribute('aria-label'), 'aria']]) {
        if (atr) salida.push(`[${nombre} ${el.tagName.toLowerCase()}] ${atr}`);
      }
    }
    return salida;
  });

  /* Falsos positivos por diseño: claves cuya única versión es la castellana.
     El modo en-EN las repinta con ese mismo texto y no es un fallo. */
  const deDiseno = new Set([...esDeClave.values()]);

  /* Los nombres de instituciones se citan igual en los dos idiomas
     («se citan tal cual», AGENTS.md): no delatan traducción perdida. */
  const propios = new Set(['Boletín Oficial del Estado']);

  const sospechosos = cadenas.filter((c) => {
    const texto = c.replace(/^\[[^\]]+\]\s*/, '');
    if (deDiseno.has(texto) || deDiseno.has(texto.toLowerCase())) return false;
    if (propios.has(texto) || /(^|\W)Boletín Oficial del Estado/.test(texto)) return false;
    return HUELLAS.some((re) => re.test(texto));
  });

  const unicos = [...new Set(sospechosos)];
  console.log(`\n${pag}: ${unicos.length} sospechosos`);
  for (const s of unicos) console.log(`   ${s}`);
  totales += unicos.length;
  await pagina.close();
}

await navegador.close();
console.log(`\ntotal: ${totales}`);
process.exit(totales ? 1 : 0);
