import { test, expect } from '@playwright/test';
import { desborde } from './util.js';

/**
 * La cabecera con una cuenta dentro.
 *
 * El correo lo elige quien se registra, y un nombre largo —«nombre.apellido.
 * larguisimo@ejemplo.es»— no es un caso raro. Antes empujaba el botón de
 * salir y el chip de idioma fuera de la ventana, y la página ganaba scroll
 * horizontal. El correo se parte con puntos suspensivos; lo que no puede
 * pasar es que el nombre empuje a los demás.
 *
 * El correo lleva marca de tiempo a propósito: el almacén de fichero
 * acumula cuentas entre pasadas, y un alta con la MISMA dirección dos
 * veces —dos proyectos seguidos aquí, o la pasada de ayer— contesta 409
 * «Ya hay una cuenta con ese correo». El sufijo no arruina lo que se
 * prueba: lo que importa es que el trozo de delante sea largo.
 */
const CORREOS = [
  'nombre.apellido.larguisimo',
  'ana.maria.garcia.fernandez',
];

for (const base of CORREOS) {
  for (const ancho of [320, 390]) {
    test(`la cabecera aguanta «${base}@…» a ${ancho} px`, async ({ page, context, request }) => {
      // Alta real contra la API, para tener una sesión de verdad.
      const correo = `${base}.${Date.now()}@ejemplo.es`;
      const r = await request.post('/api/registro', {
        data: { correo, password: 'una-clave-larga-123' },
      });
      expect(r.ok(), `el alta falló: ${r.status()} ${await r.text()}`).toBe(true);

      const cookie = (r.headers()['set-cookie'] || '').split(';')[0];
      expect(cookie, 'la API no devolvió cookie de sesión').toContain('bs_sesion=');
      const valor = cookie.split('=')[1];
      await context.addCookies([{ name: 'bs_sesion', value: valor, domain: 'localhost', path: '/' }]);

      await page.setViewportSize({ width: ancho, height: 844 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const sesion = page.locator('.session');
      await expect(sesion).toBeVisible();

      const medidas = await desborde(page);
      expect(medidas.scroll, `la cabecera desborda a ${ancho}px: ${medidas.scroll}px`).toBeLessThanOrEqual(medidas.client + 1);

      // El chip de idioma y la píldora de la sesión siguen dentro de la
      // ventana, aunque el correo pida palmo.
      const dentro = await page.evaluate(() => {
        const d = document.documentElement.clientWidth;
        const caja = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right) }; };
        return {
          chip: caja(document.querySelector('.lang-btn')),
          sesion: caja(document.querySelector('.session')),
          ventana: d,
        };
      });
      expect(dentro.chip, 'no hay chip de idioma').toBeTruthy();
      expect(dentro.chip.r, `el chip se sale de la ventana (${dentro.chip.r} > ${dentro.ventana})`)
        .toBeLessThanOrEqual(dentro.ventana);
      expect(dentro.sesion.r, `la sesión se sale de la ventana (${dentro.sesion.r} > ${dentro.ventana})`)
        .toBeLessThanOrEqual(dentro.ventana);

      // El correo se parte, pero donde se parte de verdad: la caja del
      // nombre —el `span` que lleva `overflow` y puntos suspensivos—. La
      // píldora fuera no descuadra a nadie, así que su `scrollWidth` mide
      // igual a la vista y engañaba.
      const cortado = await page.evaluate(() => {
        const s = [...document.querySelectorAll('.session span:not(.session-av)')][0];
        if (!s) return false;
        return s.scrollWidth > s.clientWidth + 1;
      });
      expect(cortado, 'el correo no se parte: se sale de la píldora').toBe(true);
    });
  }
}
