/**
 * bdns.mjs — Conector de la Base de Datos Nacional de Subvenciones.
 *
 * ── El problema ──────────────────────────────────────────────────────────
 *
 * BDNS es LA fuente de las becas españolas: todas las administraciones del Estado, de
 * las comunidades y de los ministerios, con presupuesto, plazos y requisitos.
 * El problema es que `www.infosubvenciones.es` va detrás de un WAF del
 * Ministerio de Hacienda que rechaza cualquier `fetch`. Ni con cabeceras de
 * navegador ni con User-Agent: se probó y responde «Acceso Denegado».
 *
 * ── La solución ──────────────────────────────────────────────────────────
 *
 * Un Chrome de verdad sí pasa, porque el WAF no mira solo la cabecera sino
 * que ejecuta la página: la BDNS es una SPA de Angular que carga sus datos
 * con JavaScript, así que sin un motor de JS no hay nada. `curl` no puede
 * con una SPA ni con el WAF; Chrome puede con las dos.
 *
 * Aquí no se usa Playwright sino el Chrome del sistema con `--dump-dom`:
 * pesa cero dependencias, ya está instalado (en local y en los runners de
 * GitHub Actions), y para extraer HTML ya renderizado es suficiente. Si
 * algún día hace falta interactuar con la página, ahí sí valdrá la pena
 * pagar el peso de Playwright.
 *
 * ── El coste ─────────────────────────────────────────────────────────────
 *
 * Un proceso de Chrome cuesta ~2 s y unos 150 MB. Para 400 fichas son
 * unos 15 minutos y, si se lanzan en paralelo, mucho menos. Es asumible en
 * un cron diario, y no lo es si se lanzaran miles al día. Por eso el
 * conector se limita a un rango de fechas y no barre el histórico entero.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);

const BASE = 'https://www.infosubvenciones.es/bdnstrans/GE/es';
const CHROME = process.env.CHROME_BIN || 'google-chrome';
const TIMEOUT_MS = 45_000;

/** Navegadores donde encontrar Chrome, por si cambia el nombre en el runner. */
const CANDIDATOS = [
  'google-chrome', 'google-chrome-stable',
  'chromium', 'chromium-browser',
  '/usr/bin/google-chrome',
];

/* ── El navegador ───────────────────────────────────────────────────────── */

/**
 * Descarga una página y devuelve el HTML ya renderizado.
 *
 * `curl` aquí no sirve por dos motivos independientes, y por eso no es un
 * «fallo de la fuente» sino una decisión de diseño del portal: es una SPA
 * (sin JS no hay datos) y está detrás de un WAF (sin JS también no hay
 * datos). Un solo camino que funciona vale más que dos que fallan.
 */
export async function render(url, { timeout = TIMEOUT_MS, chrome = true } = {}) {
  // ── Por qué algunos catálogos no necesitan Chrome ──────────────────────
  //
  // El navegador se usa porque la BDNS es una SPA detrás de un WAF: sin
  // JavaScript no hay datos. Pero **no todas** las fuentes lo necesitan, y
  // pagar un proceso de Chrome —dos segundos y 150 MB— por cada página de
  // un catálogo que ya viene en HTML plano es un desperdicio.
  //
  // El catálogo de EACEA es ese caso: su HTML trae las tarjetas. Con `fetch`
  // y las cabeceras de un navegador, la misma página sale en milisegundos.
  // Antes esto costaba once procesos de Chrome por pasada; ahora son once
  // peticiones de red.
  //
  // La diferencia se nota en la eleventh página del catálogo, que antes
  // tardaba lo que tardara Chrome en arrancar.
  if (!chrome) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      return await res.text();
    } catch {
      return '';
    } finally {
      clearTimeout(t);
    }
  }

  const perfil = await mkdtemp(join(tmpdir(), 'bs-'));
  try {
    const { stdout } = await exec(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
      '--virtual-time-budget=15000',   // deja que la SPA termine de pedir datos
      `--user-data-dir=${perfil}`,     // perfil limpio: sin cookies ni estado previo
      '--dump-dom',
      url,
    ], { timeout, maxBuffer: 64 * 1024 * 1024 });

    return stdout;
  } finally {
    // El perfil temporal ocupa ~50 MB. Si se queda, el runner se llena en
    // unas pocas pasadas.
    await rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}

/** ¿Hay Chrome en alguna parte? Se llama una vez al arrancar. */
export async function hayChrome() {
  for (const bin of CANDIDATOS) {
    try {
      await exec(bin, ['--version'], { timeout: 8000 });
      return bin;
    } catch { /* siguiente */ }
  }
  return null;
}

/* ── Lectura de la ficha ────────────────────────────────────────────────── */

/**
 * Saca el texto plano de un HTML.
 *
 * Se eliminan `<script>` y `<style>` enteros y no solo sus etiquetas: una
 * SPA de Angular deja el estado serializado dentro de un `<script>`, y si
 * no se quita, sus números se cuelan en el texto y contaminan los importes
 * que se leen después.
 */
export function textoDe(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primer valor que aparece tras una etiqueta, en el texto plano. */
function tras(texto, etiqueta, hasta = '·') {
  const i = texto.indexOf(etiqueta);
  if (i < 0) return null;
  const resto = texto.slice(i + etiqueta.length);
  const corte = resto.indexOf(hasta);
  return (corte > -1 ? resto.slice(0, corte) : resto.slice(0, 120)).trim() || null;
}

/** «910.000,00 €» → 910000 */
export function euros(valor) {
  if (!valor) return null;
  const n = Number.parseFloat(
    String(valor).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  );
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Convierte una ficha de BDNS en el mismo registro que usa el resto del
 * proyecto, para que el resto del código no tenga que saber de dónde salió.
 *
 * Lo que se guarda aquí es **metadato estructurado de la propia BDNS**, con
 * el enlace a la convocatoria como cita. Los requisitos concretos (nota,
 * edad) no están en la ficha: están en las Bases, que enlaza en
 * `boeId`. Por eso `requisitos` va vacío aquí y lo rellena `run.mjs`
 * bajando el texto del BOE, que es donde están y donde se puede citar.
 */
export function aRegistro(html, id) {
  const texto = textoDe(html);

  const presupuesto = euros(tras(texto, 'Presupuesto total de la convocatoria'));
  const titulo = tras(texto, 'Título de la convocatoria en español', '·Título de la convocatoria en otra lengua');
  const organo = tras(texto, 'Órgano convocante');
  const sede = /https:\/\/[^\s·]*sede\.gob\.es[^\s·]*/.exec(texto)?.[0] ?? null;

  // El identificador del BOE donde están las Bases. Es el puente con el
  // conector que ya funciona sin navegador, y lo que permite citar.
  const boeId = /BOE-[AB]-\d{4}-\d+/.exec(html)?.[0] ?? null;

  const indefinido = /¿Se puede solicitar indefinidamente\?\s*SI/i.test(texto);
  const fin = tras(texto, 'Fecha de finalización del periodo de solicitud', '·');

  // La fecha llega como «10/07/2026» y el corte por «·» se lleva a veces
  // texto de más detrás, así que se extrae con un patrón y no se parsea la
  // cadena entera. Si la convocatoria se puede solicitar indefinidamente, o
  // no trae fecha, se queda en null: la interfaz enseña «Plazo no extraído»,
  // que es mejor que una fecha calculada por nuestra cuenta.
  const corte = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(fin ?? '');
  const dia = Number(corte?.[1]);
  const mes = Number(corte?.[2]);
  const cierra = !indefinido && corte && dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12
    ? `${corte[3]}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    : null;

  return {
    id: `BDNS-${id}`,
    titulo: titulo ?? `Convocatoria BDNS ${id}`,
    organizador: organo ?? 'Sin especificar',
    ambito: 'estatal',
    fuente: 'bdns',
    presupuesto,
    boeId,
    sede,
    url: `${BASE}/convocatoria/${id}`,
    // La fecha de fin del periodo la publica la propia BDNS y se enseña tal
    // cual. Antes esta línea era `cierra: indefinido ? null : null` —los dos
    // brazos iguales— y el dato de `fin` se tiraba: las 652 fichas salían sin
    // plazo, y sin plazo no hay aviso ni estados ámbar/óxido.
    cierra,
    requisitos: [],
    texto_len: texto.length,
  };
}

/* ── El listado ─────────────────────────────────────────────────────────── */

/**
 * IDs de convocatorias del listado.
 *
 * Solo se entra por el listado y no por rango de IDs: los identificadores
 * son correlativos, pero no todos existen y barrer del 1 al 50 son casi
 * todos 404. El listado es la única forma fiable de saber qué hay.
 *
 * El enlace del listado va en plural (`convocatorias/935976`) mientras que
 * la ficha responde a los dos. El patrón acepta ambos: escrito solo como
 * `convocatoria\/` no casa con nada, porque la `s` del plural rompe la
 * coincidencia y el listado parece vacío sin dar ningún error. Es el fallo
 * silencioso que cuesta una tarde.
 */
export async function listado({ paginas = 1 } = {}) {
  const vistos = new Set();
  for (let p = 1; p <= paginas; p++) {
    const html = await render(`${BASE}/convocatorias?page=${p}`);
    if (/Acceso Denegado|denegado/i.test(html)) {
      // El WAF bloquea de forma intermitente. Se para en lugar de
      // reintentar: si estamos fuera, insistir solo empeora la situación.
      break;
    }
    const ids = html.match(/convocatorias?\/\d+/g) ?? [];
    const antes = vistos.size;
    ids.forEach((m) => vistos.add(m.split('/')[1]));
    if (vistos.size === antes) break;   // última página: no hay más
  }
  // De más reciente a más antigua: es el orden en que se van a producir.
  return [...vistos].sort((a, b) => Number(b) - Number(a));
}

/**
 * Saca el identificador de BDNS que un extracto del BOE lleva dentro.
 *
 * Este es el truco que hace viable todo el conector, y conviene entenderlo
 * porque no es evidente.
 *
 * El listado de BDNS está paginado en el navegador y no admite parámetros
 * en la URL, así que recorrerlo con Chrome costaría una llamada del
 * navegador por cada diez convocatorias. En cambio, el extracto del BOE de
 * cada convocatoria **enlaza a su propia ficha de BDNS**, y ese extracto ya
 * lo descarga el conector del BOE con una API pública, sin navegador y sin
 * coste.
 *
 * Es decir: el descubrimiento sale gratis y llega antes de tiempo, y el
 * Chrome solo se usa para enriquecer las fichas que ya sabemos que existen.
 */
export function idDesdeBoe(texto) {
  const m = /infosubvenciones\.es[^\s)"'<>]*?convocatorias?\/(\d+)/i.exec(texto ?? '');
  return m ? m[1] : null;
}

/**
 * Recorre el listado y trae las fichas completas, en tandas.
 *
 * Las tandas importan: lanzar 20 Chromes a la vez come la RAM del runner y
 * Chrome se cae por OOM sin mensaje útil. Cuatro de golpe es lo que aguanta
 * un ubuntu-latest (7 GB) sin nervioso.
 */
export async function recolectar({ paginas = 1, tanda = 4, alProgresar } = {}) {
  const bin = await hayChrome();
  if (!bin) throw new Error('No se encuentra Chrome. Instálalo o define CHROME_BIN.');

  const ids = await listado({ paginas });
  alProgresar?.({ fase: 'listado', total: ids.length });

  const salida = [];
  for (let i = 0; i < ids.length; i += tanda) {
    const grupo = ids.slice(i, i + tanda);
    const fichas = await Promise.all(grupo.map(async (id) => {
      try {
        const html = await render(`${BASE}/convocatoria/${id}`);
        if (/Acceso Denegado/i.test(html)) return null;
        const reg = aRegistro(html, id);
        return reg.titulo.includes('BDNS') && !reg.organizador ? null : reg;
      } catch {
        return null;   // una ficha rota no puede tumbar la tanda
      }
    }));

    salida.push(...fichas.filter(Boolean));
    alProgresar?.({ fase: 'fichas', avance: Math.min(i + tanda, ids.length), total: ids.length });
  }
  return salida;
}