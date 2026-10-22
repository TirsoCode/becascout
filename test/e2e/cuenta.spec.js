import { test, expect } from '@playwright/test';
import { vigilarErrores, irA } from './util.js';

/**
 * La cuenta: la puerta, la página del alta, la encuesta de llegada, los
 * ajustes y la vuelta del foco.
 *
 * El alta ya no es un modal sobre la página que lo pidió: vive en
 * `cuenta.html`, que la puerta —el enlace «Crear cuenta»— abre en **otra
 * pestaña** con `target="_blank"`. Por eso todas las pruebas aquí manejan dos
 * páginas: la que movió el clic y la pestaña que devuelven los ayudantes.
 * Al terminar el alta, esa pestaña vuelve sola a la página de origen
 * (`location.replace`, ver js/cuenta.js) y la página de fondo repregunta al
 * servidor al recobrar el foco (`sesionFresca`, ver js/landing.js y
 * js/becas.js): lo que más interesa probar es ese relevo.
 *
 * El alta va contra la API en su modo de fichero —la que levanta
 * `serve.mjs`, arrancado por el webServer con `BS_SIN_ENV` para que ni
 * vea las claves de .env.local—, así que las cuentas nacen en `data/` y no
 * se toca ninguna base de credenciales. El botón de Google sale solo si
 * `/api/config` trae `googleId`, y en local no lo trae: por eso se comprueba
 * que **no** está.
 */

/**
 * La puerta: pulsa «Crear cuenta» y devuelve la pestaña que se abrió.
 *
 * `waitForEvent('popup')` ha de registrarse ANTES del clic: si va después,
 * la pestaña ya ha nacido y la promesa se queda esperando un evento pasado.
 */
async function abrirAlta(pagina) {
  const [pestaña] = await Promise.all([
    pagina.waitForEvent('popup'),
    pagina.locator('[data-open-auth]').first().click(),
  ]);
  await pestaña.waitForLoadState('domcontentloaded');
  return pestaña;
}

/**
 * El alta completa, sobre la pestaña que devolvió `abrirAlta`.
 *
 * Es determinista y no un `Promise.race` a propósito: un `registro` marca
 * `bs.encuesta` en sessionStorage y la gasta la página de llegada sacando la
 * pregunta al cargar. En un contexto de prueba recién abierto nadie ha
 * contestado nunca, así que la pregunta SIEMPRE sale y SIEMPRE antes de que
 * siga nada más. Apostar a qué aparece primero —la encuesta o la sesión— era
 * una carrera que de vez en cuando se perdía y tapaba la ficha de ajustes.
 */
async function alta(pestaña, correo) {
  await pestaña.locator('#f-correo').fill(correo);
  await pestaña.locator('#f-pass').fill('una-clave-larga-123');
  await pestaña.locator('#f-enviar').click();

  // La pestaña salta a la página de origen y allí la encuesta de llegada.
  await expect(pestaña.locator('#enc-t')).toBeVisible({ timeout: 30_000 });

  // Se puede pasar, y se pasa con el enlace del pie.
  await pestaña.locator('.enc-skip button').click();
  await expect(pestaña.locator('#enc-t')).toBeHidden({ timeout: 15_000 });

  // Y la cabecera de la página de llegada pinta la sesión.
  await expect(pestaña.locator('.session')).toBeVisible({ timeout: 30_000 });
}

test('la puerta abre el alta en otra pestaña, a pantalla entera', async ({ page }) => {
  const errores = vigilarErrores(page);
  await irA(page, '/');

  const pestaña = await abrirAlta(page);
  const erroresPestaña = vigilarErrores(pestaña);

  expect(new URL(pestaña.url()).pathname).toBe('/cuenta.html');

  // Los id conservan el nombre del modal de antes a propósito: un solo
  // sitio donde mirar (y las pruebas no dependen de que se renombre nada).
  await expect(pestaña.locator('#modal-t')).toBeVisible();
  await expect(pestaña.locator('#f-correo')).toBeVisible();
  await expect(pestaña.locator('#f-pass')).toBeVisible();
  await expect(pestaña.locator('#f-enviar')).toBeVisible();

  // Es una página, no un recuadro flotante: llega hasta el fondo de la
  // ventana que la contiene. Se mide contra el viewport de MAQUETACIÓN
  // (`clientHeight`) y no contra `innerHeight`: con emulación móvil la
  // ventana visual mide 866 en un viewport de 844 y el documento no
  // cambia por esa cuenta.
  const caja = await pestaña.locator('.cuenta').evaluate((el) => ({
    abajo: Math.round(el.getBoundingClientRect().bottom),
    ventana: document.documentElement.clientHeight,
  }));
  expect(caja.abajo).toBeGreaterThanOrEqual(caja.ventana - 1);

  expect(errores, errores.join(' | ')).toEqual([]);
  expect(erroresPestaña, erroresPestaña.join(' | ')).toEqual([]);
});

test('sin claves de Google el botón de Google no sale', async ({ page }) => {
  const config = await page.request.get('/api/config');
  const json = await config.json();
  test.skip(!!json.googleId, 'hay GOOGLE_CLIENT_ID: el botón sí tiene que salir');

  await irA(page, '/');
  const pestaña = await abrirAlta(page);
  await expect(pestaña.locator('#modal-t')).toBeVisible();
  await expect(pestaña.locator('#btn-google')).toHaveCount(0);
});

test('el alta vuelve a la portada con la encuesta y la sesión', async ({ page }) => {
  await irA(page, '/');
  const pestaña = await abrirAlta(page);
  await alta(pestaña, `encuesta${Date.now()}@ejemplo.es`);

  // La pestaña del alta se convierte en la de origen: la portada desde la
  // que se abrió, con la sesión ya puesta.
  expect(new URL(pestaña.url()).pathname).toBe('/');
});

test('la puerta del buscador lleva ?desde del buscador', async ({ page }) => {
  await irA(page, '/becas.html');
  const pestaña = await abrirAlta(page);
  // El parámetro decide a dónde vuelve la pestaña al terminar; el `"?"` va
  // con URL-encoding (`%2F`) y `desdeDeVuelta()` lo valida contra una lista
  // cerrada de páginas reales.
  expect(new URL(pestaña.url()).searchParams.get('desde')).toBe('/becas.html');
});

test('un ?desde que no existe cae al buscador', async ({ page }) => {
  await irA(page, '/cuenta.html?desde=%2Fpaginas-inventada');

  // El alta es la de siempre: la lista cerrada de `DESTINOS` no lleva a un
  // 404 ni a un sitio ajeno, manda al buscador.
  const correo = `desde${Date.now()}@ejemplo.es`;
  await page.locator('#f-correo').fill(correo);
  await page.locator('#f-pass').fill('una-clave-larga-123');
  await page.locator('#f-enviar').click();

  await expect(page.locator('#enc-t')).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe('/becas.html');
});

test('los ajustes abren, avisan y cierran la sesión', async ({ page }) => {
  await irA(page, '/');
  const pestaña = await abrirAlta(page);
  await alta(pestaña, `ajustes${Date.now()}@ejemplo.es`);

  // Los ajustes: el interruptor de avisos y el botón de salir.
  await pestaña.locator('.session-perfil').click();
  await expect(pestaña.locator('#ajs-t')).toBeVisible();
  await expect(pestaña.locator('#ajs-avisos')).toBeVisible();
  await expect(pestaña.locator('#ajs-salir')).toBeVisible();

  // El interruptor de avisos es un `role="switch"` con el estado en
  // `aria-checked`, no una casilla: mirar `e.checked` era mirar un
  // atributo que el interruptor no tiene.
  const antes = await pestaña.locator('#ajs-avisos').getAttribute('aria-checked');
  await pestaña.locator('#ajs-avisos').click();
  // La pintada es inmediata y la corrección —la del servidor— la remata;
  // las dos dicen lo mismo si la petición fue bien.
  const esperado = antes === 'true' ? 'false' : 'true';
  await expect(pestaña.locator('#ajs-avisos'))
    .toHaveAttribute('aria-checked', esperado, { timeout: 15_000 });

  // Salir deja la cabecera como estaba — y devuelve las puertas (en la
  // portada hay dos, la de arriba y la del héroe).
  await pestaña.locator('#ajs-salir').click();
  await expect(pestaña.locator('.session')).toHaveCount(0, { timeout: 15_000 });
  await expect(pestaña.locator('[data-open-auth]')).toHaveCount(2, { timeout: 15_000 });
});

test('la portada se entera de la cuenta cuando la pestaña vuelve', async ({ page }) => {
  await irA(page, '/');
  const pestaña = await abrirAlta(page);
  await alta(pestaña, `vuelta${Date.now()}@ejemplo.es`);

  // La pestaña del alta se cierra: lo único que queda de ella es la sesión
  // en la cookie. La portada se quedó al fondo y no se ha enterado de nada.
  await pestaña.close();

  // En headed, `bringToFront` activa la pestaña de verdad. En headless el
  // foco no se mueve, así que se despiertan los mismos escuchadores a mano —
  // los que `alVolver` tiene puestos: lo que importa es lo que corre por
  // debajo, `sesionFresca()` contra la cookie y el repinte de la cabecera.
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Al recobrar el foco: la puerta, fuera; la sesión, dentro. El repinte se
  // hace en la primera vuelta — no en ninguna tercera: la firma ya no cambia.
  await expect(page.locator('[data-open-auth]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.session')).toBeVisible({ timeout: 15_000 });
});
