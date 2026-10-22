/**
 * Utilidades comunes de las pruebas.
 *
 * Lo importante: los errores de consola se miran, pero no todos son fallos.
 * `/api/yo` contesta 401 cuando no hay sesión —es lo normal, no un error— y
 * el favicon sale 404 en desarrollo. Se filtran esos dos y todo lo demás
 * cuenta como fallo: un error de JavaScript en la web es un error en la web.
 */

export const PAGINAS = [
  { ruta: '/', nombre: 'la portada' },
  { ruta: '/becas.html', nombre: 'el buscador' },
  { ruta: '/sobre.html', nombre: 'la página del método' },
  { ruta: '/erasmus-mundus.html', nombre: 'las becas Erasmus Mundus' },
  { ruta: '/privacidad.html', nombre: 'la privacidad' },
  { ruta: '/cookies.html', nombre: 'las cookies' },
  { ruta: '/404.html', nombre: 'el 404' },
  { ruta: '/supabase-config.html', nombre: 'la pantalla de configuración' },
];

/** Errores de consola que no son fallos del sitio. */
const BENIGNOS = [
  /Failed to load resource.*401/,   // /api/yo sin sesión
  /favicon/i,
  /net::ERR_ABORTED.*favicon/i,
];

export function vigilarErrores(page) {
  const errores = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (BENIGNOS.some((r) => r.test(t))) return;
    errores.push(`consola: ${t}`);
  });
  page.on('pageerror', (e) => errores.push(`excepción: ${e.message}`));
  page.on('requestfailed', (r) => {
    const t = r.failure()?.errorText ?? '';
    if (BENIGNOS.some((re) => re.test(t)) || BENIGNOS.some((re) => re.test(r.url()))) return;
    errores.push(`petición fallida: ${r.url()} (${t})`);
  });
  return errores;
}

/** El documento no puede desbordar la ventana: en horizontal, no. */
export async function desborde(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return { scroll: d.scrollWidth, client: d.clientWidth };
  });
}

/** El elemento tiene que caber entero en la pantalla. */
export async function dentroDeLaPantalla(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      ventana: document.documentElement.clientWidth,
      alto: innerHeight,
    };
  }, selector);
}

/** Cargar una página y esperar a que el DOM esté de verdad. */
export async function irA(page, ruta) {
  await page.goto(ruta, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
}

/** El texto visible de la página, sin los scripts ni los estilos. */
export async function textoVisible(page) {
  return page.evaluate(() => document.body.innerText);
}
