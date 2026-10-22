import { test, expect } from '@playwright/test';
import { PAGINAS, vigilarErrores, irA } from './util.js';

/**
 * El interruptor de idioma.
 *
 * Lo que se comprueba, en todas las páginas: que el chip está, que gira, que
 * el texto cambia de verdad, que el idioma se recuerda al recargar y que
 * `?lang=en` funciona y desaparece de la barra de direcciones.
 */

/** Palabras que en inglés no aparecen sueltas y en castellano sí. */
const CASTELLANO = /\b(el|los|las|una|para|desde|porque|también|cuando|nuestro|nuestra|puedes|tienes|aquí|buscar|becas)\b/i;

/** Los trocitos que se pueden quedar en castellano sin que sea un fallo. */
const PERMITIDOS = ['English', 'Erasmus Mundus', 'Boletín Oficial del Estado'];

for (const { ruta, nombre } of PAGINAS) {
  test(`${nombre} cambia de idioma y lo recuerda`, async ({ page }) => {
    const errores = vigilarErrores(page);
    await irA(page, ruta);

    const chip = page.locator('.lang-btn');
    await expect(chip, `${ruta} no trae el chip de idioma`).toBeVisible();
    await expect(chip).toHaveAttribute('aria-label', /\w/);

    const antes = await page.locator('body').innerText();
    await chip.click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(chip, `en ${ruta} el chip no se gira`).toHaveText('ES');
    await expect(chip).toHaveAttribute('aria-label', /\w/);

    const despues = await page.locator('body').innerText();
    expect(despues, `${ruta} el texto no cambia al pasar a inglés`).not.toBe(antes);

    // Al recargar sigue en inglés: no es una variable de la pestaña.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.lang-btn')).toHaveText('ES');

    expect(errores, `${ruta}: ${errores.join(' | ')}`).toEqual([]);
  });
}

test('?lang=en aplica el inglés y se gasta', async ({ page }) => {
  await irA(page, '/?lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.lang-btn')).toHaveText('ES');
  expect(page.url(), 'el parámetro ?lang=en sigue en la barra de direcciones').not.toContain('lang=');
});

test('el inglés no deja castellano suelto en las páginas de texto', async ({ page }) => {
  for (const ruta of ['/', '/sobre.html', '/erasmus-mundus.html']) {
    await irA(page, ruta);

    // El bucle comparte la pestaña y el idioma vive en localStorage: si la
    // ruta anterior acabó en inglés, esta cargó ya traducida y el chip nace
    // con «ES». Cada ruta se mide desde la misma salida, así que se vuelve
    // al castellano de partida.
    if ((await page.locator('html').getAttribute('lang')) === 'en') {
      await page.evaluate(() => localStorage.removeItem('becascout.idioma'));
      await page.reload({ waitUntil: 'domcontentloaded' });
    }

    // El chip no está en el HTML: lo pinta el módulo de idioma al arrancar y
    // en la misma creación engancha su listener. Esperar su texto espera de
    // paso al módulo, que es quien tiene que estar dentro antes del clic.
    await expect(page.locator('.lang-btn')).toHaveText('EN');
    await page.locator('.lang-btn').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const intruso = await page.evaluate(() => {
      const malos = [];
      const re = /\b(el|los|las|una|para|desde|porque|también|cuando|nuestro|nuestra|puedes|tienes|aquí|buscar|becas|consejo|guía|sobre)\b/i;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        if (el.closest('.foot, nav, .top, [data-i18n]')) continue;
        const t = (el.textContent || '').trim();
        if (t.length > 3 && re.test(t) && !['English', 'Erasmus Mundus', 'Boletín Oficial del Estado'].some((p) => t.includes(p))) malos.push(t.slice(0, 60));
      }
      return [...new Set(malos)];
    });

    expect(intruso, `${ruta} en inglés quedan textos en castellano: ${intruso.join(' | ')}`).toEqual([]);
  }
});

test('el idioma se puede volver a castellano', async ({ page }) => {
  await irA(page, '/');
  const chip = page.locator('.lang-btn');
  await chip.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await chip.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(chip).toHaveText('EN');
});
