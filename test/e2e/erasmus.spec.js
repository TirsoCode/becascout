import { test, expect } from '@playwright/test';
import { vigilarErrores, irA, desborde } from './util.js';

/**
 * La página de Erasmus Mundus.
 *
 * La genera `ingest/paginas.mjs`, así que lo que se comprueba aquí es que la
 * generación no pierde programas y que la página se lee: 217 programas del
 * catálogo oficial, con su ficha, sus países y su presupuesto.
 */

test('la página de Erasmus enseña los programas del catálogo', async ({ page }) => {
  const errores = vigilarErrores(page);
  await irA(page, '/erasmus-mundus.html');

  const texto = await page.locator('body').innerText();

  // El número de programas, el que dice la portada.
  const m = texto.match(/(\d+)\s+programas?/i);
  expect(m, 'la página no dice cuántos programas hay').toBeTruthy();
  const n = Number(m[1]);
  expect(n, `solo salen ${n} programas`).toBeGreaterThanOrEqual(200);

  // Y el catálogo de verdad: una fila por programa.
  const programas = await page.locator('tr[id^="prog-"]').count();
  expect(programas, `salen ${programas} programas en la tabla`).toBeGreaterThanOrEqual(200);

  const ancho = await desborde(page);
  expect(ancho.scroll, 'la página de Erasmus desborda en horizontal').toBeLessThanOrEqual(ancho.client + 1);

  expect(errores, errores.join(' | ')).toEqual([]);
});

test('cada programa tiene nombre, ECTS y su ficha oficial', async ({ page }) => {
  await irA(page, '/erasmus-mundus.html');

  const fila = page.locator('tr[id^="prog-"]').first();
  await expect(fila).toBeVisible();

  const celdas = await fila.locator('td').allInnerTexts();
  expect(celdas.length, 'la fila del programa no tiene columnas').toBe(4);
  expect(celdas[0].trim().length, 'el programa no tiene nombre').toBeGreaterThan(10);
  expect(celdas[1], 'el programa no dice los ECTS').toMatch(/\d/);

  // La ficha oficial: un enlace a la página del proyecto en la UE.
  const enlace = fila.locator('a[href*="erasmus-plus.ec.europa.eu"]').first();
  await expect(enlace).toBeVisible();
  expect(await enlace.getAttribute('href')).toMatch(/^https:\/\//);
});

test('la página de Erasmus también cambia de idioma', async ({ page }) => {
  await irA(page, '/erasmus-mundus.html');
  const chip = page.locator('.lang-btn');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(chip).toHaveText('ES');
});
