import { test, expect } from '@playwright/test';
import { PAGINAS, vigilarErrores, desborde, irA } from './util.js';

/**
 * Toda página del sitio tiene que cargar, no desbordar y no soltar errores
 * de JavaScript.
 *
 * El desbordamiento en horizontal es el fallo que más se repite en este
 * proyecto: un correo largo, una píldora con tres países y un «+N», un
 * identificador de cita de cuarenta caracteres. Ninguno de los tres falla en
 * las pruebas de lógica; los tres se ven en el navegador.
 */
for (const { ruta, nombre } of PAGINAS) {
  test(`${nombre} carga sin errores ni desbordamiento`, async ({ page }) => {
    const errores = vigilarErrores(page);
    await irA(page, ruta);

    await expect(page).toHaveTitle(/.+/);

    const ancho = await desborde(page);
    expect(ancho.scroll, `${ruta} desborda en horizontal: ${ancho.scroll}px con ventana de ${ancho.client}px`)
      .toBeLessThanOrEqual(ancho.client + 1);

    expect(errores, `${ruta}: ${errores.join(' | ')}`).toEqual([]);
  });
}

test('la portada enseña lo que promete', async ({ page }) => {
  const errores = vigilarErrores(page);
  await irA(page, '/');

  // El titular: el mensaje entero, con la parte resaltada dentro.
  const h1 = page.locator('.hero h1');
  await expect(h1).toBeVisible();
  const titular = (await h1.innerText()).replace(/\s+/g, ' ').trim();
  expect(titular.length, `el titular se lee «${titular}»`).toBeGreaterThan(20);

  // La navegación principal y el pie.
  await expect(page.locator('header.top nav a').first()).toBeVisible();
  await expect(page.locator('.foot-links a[href$="privacidad.html"]')).toBeVisible();
  await expect(page.locator('.foot-links a[href$="cookies.html"]')).toBeVisible();

  // Y que nada de eso esté en negrita: los enlaces legales pesan lo mismo
  // que los demás.
  const pesos = await page.evaluate(() =>
    [...document.querySelectorAll('.foot-links a')].map((a) => getComputedStyle(a).fontWeight));
  expect(pesos.every((p) => p === pesos[0]), `los enlaces del pie no pesan igual: ${pesos.join(', ')}`).toBe(true);

  expect(errores).toEqual([]);
});

test('el 404 se sirve con su página y su estado', async ({ page, request }) => {
  const r = await request.get('/no-existe-esta-pagina');
  expect(r.status()).toBe(404);

  await irA(page, '/404.html');
  await expect(page.locator('h1')).toBeVisible();
  expect((await page.locator('body').innerText()).length).toBeGreaterThan(50);
});
