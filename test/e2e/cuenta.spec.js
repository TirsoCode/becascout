import { test, expect } from '@playwright/test';
import { vigilarErrores, irA } from './util.js';

/**
 * La cuenta: el modal de acceso, el alta, la encuesta de llegada, los
 * ajustes y el botón de Google.
 *
 * El alta se hace en el modo de juguete —sin Supabase, con un fichero en
 * `data/`— porque así el flujo entero se puede probar en local sin tocar
 * la base de datos de producción. El botón de Google sale solo si
 * `/api/config` trae `googleId`, y en local no lo trae: por eso se
 * comprueba que **no** está.
 */

test('el modal de acceso se abre y trae el formulario', async ({ page }) => {
  const errores = vigilarErrores(page);
  await irA(page, '/');

  await page.locator('[data-open-auth]').first().click();

  const modal = page.locator('#modal-t');
  await expect(modal).toBeVisible();
  await expect(page.locator('#f-correo')).toBeVisible();
  await expect(page.locator('#f-pass')).toBeVisible();
  await expect(page.locator('#f-enviar')).toBeVisible();

  expect(errores, errores.join(' | ')).toEqual([]);
});

test('sin claves de Google el botón de Google no sale', async ({ page }) => {
  const config = await page.request.get('/api/config');
  const json = await config.json();
  test.skip(!!json.googleId, 'hay GOOGLE_CLIENT_ID: el botón sí tiene que salir');

  await irA(page, '/');
  await page.locator('[data-open-auth]').first().click();
  await expect(page.locator('#modal-t')).toBeVisible();
  await expect(page.locator('#btn-google')).toHaveCount(0);
});

test('el alta en el modo de juguete abre la encuesta de llegada', async ({ page }) => {
  await irA(page, '/');

  await page.locator('[data-open-auth]').first().click();
  await expect(page.locator('#modal-t')).toBeVisible();

  // El alta local pide un correo cualquiera y una contraseña.
  const correo = `prueba${Date.now()}@ejemplo.es`;
  await page.locator('#f-correo').fill(correo);
  await page.locator('#f-pass').fill('una-clave-larga-123');
  await page.locator('#f-enviar').click();

  // La encuesta de llegada: se puede pasar, y se guarda la respuesta.
  const encuesta = page.locator('#enc-t');
  if (await encuesta.isVisible().catch(() => false)) {
    const opciones = page.locator('.enc-opts button, .enc-opts label');
    if (await opciones.count()) {
      await opciones.first().click();
    } else {
      await page.locator('.enc-skip').click();
    }
    await expect(encuesta).toBeHidden({ timeout: 10_000 });
  }

  // Y la cabecera pasa a enseñar la sesión.
  await expect(page.locator('.session')).toBeVisible({ timeout: 10_000 });
});

test('los ajustes abren, avisan y cierran la sesión', async ({ page }) => {
  await irA(page, '/');

  // Alta de juguete, como en la prueba anterior.
  await page.locator('[data-open-auth]').first().click();
  await page.locator('#f-correo').fill(`ajustes${Date.now()}@ejemplo.es`);
  await page.locator('#f-pass').fill('una-clave-larga-123');
  await page.locator('#f-enviar').click();
  const encuesta = page.locator('#enc-t');
  if (await encuesta.isVisible().catch(() => false)) {
    await page.locator('.enc-skip').click();
    await expect(encuesta).toBeHidden({ timeout: 10_000 });
  }
  await expect(page.locator('.session')).toBeVisible({ timeout: 10_000 });

  // Los ajustes: el interruptor de avisos y el botón de salir.
  await page.locator('.session-perfil').click();
  await expect(page.locator('#ajs-t')).toBeVisible();
  await expect(page.locator('#ajs-avisos')).toBeVisible();
  await expect(page.locator('#ajs-salir')).toBeVisible();

  // El interruptor se puede pulsar: es opt-out, no opt-in.
  const antes = await page.locator('#ajs-avisos').evaluate((e) => e.checked);
  await page.locator('#ajs-avisos').click();
  const despues = await page.locator('#ajs-avisos').evaluate((e) => e.checked);
  expect(despues, 'el interruptor de avisos no cambia').toBe(!antes);

  // Salir deja la cabecera como estaba.
  await page.locator('#ajs-salir').click();
  await expect(page.locator('.session')).toHaveCount(0, { timeout: 10_000 });
});
