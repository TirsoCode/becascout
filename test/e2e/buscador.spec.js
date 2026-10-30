import { test, expect } from '@playwright/test';
import { vigilarErrores, irA, desborde } from './util.js';

/**
 * El buscador entero: los filtros, la búsqueda, el cartel, la lista, el velo
 * y el filtro de destino.
 *
 * El fallo que motivó la prueba del 21 de octubre de 2026 —«no puedo bajar
 * mientras está buscando»— no se ve mirando el HTML: se ve midiendo si la
 * página deja bajar. Aquí se mide.
 */

/** El buscador carga su base y pinta las fichas. */
async function cargarBuscador(page) {
  await irA(page, '/becas.html');
  await expect(page.locator('#buscar')).toBeVisible();
  await expect(page.locator('.beca').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Crea una cuenta de prueba y deja la cookie en el contexto del navegador.
 *
 * Desde el 30 de octubre de 2026 los requisitos no viajan sin sesión: viven
 * en `/api/becas`, y el catálogo público solo trae títulos, plazos e importes.
 * Para mirar una ficha entera hay que entrar como entraría una persona.
 */
async function entrar(page) {
  const correo = `e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@ejemplo.com`;
  const r = await page.request.post('/api/registro', {
    data: { correo, password: 'contrasena-de-prueba' },
  });
  expect(r.status(), await r.text()).toBe(201);
  return correo;
}

test('el buscador pinta las fichas y el velo', async ({ page }) => {
  const errores = vigilarErrores(page);
  await cargarBuscador(page);

  const fichas = await page.locator('.beca').count();
  expect(fichas, 'no se ve ninguna ficha').toBeGreaterThan(100);

  // Las cuatro cosas del perfil: nota, edad, nivel y destino. Son las que
  // se comparan con los requisitos, así que si falta una, el buscador
  // miente: dice que cumples lo que no has dicho.
  for (const id of ['#nota', '#edad', '#nivel', '#pais']) {
    await expect(page.locator(id), `falta ${id} en el buscador`).toBeVisible();
  }
  const paises = await page.locator('#pais option').count();
  expect(paises, 'el desplegable de destino está vacío').toBeGreaterThan(10);

  // El velo: las fichas están en el DOM y se pueden leer. El bloqueo es
  // visual, no de permiso. El desenfoque va en el cuerpo de la ficha, no en
  // la envoltura.
  const velo = await page.evaluate(() => {
    const b = document.querySelector('.lock > .lock-body');
    return b ? getComputedStyle(b).filter : null;
  });
  expect(velo, 'no hay velo sobre las fichas').toContain('blur');

  // Lo que se puede leer en el DOM es el catálogo: título, organizador,
  // plazo. Los requisitos y sus citas NO, desde el 30 de octubre de 2026: eso
  // es lo que la cuenta abre y no puede viajar en un fichero público.
  const hayTexto = await page.evaluate(() => {
    const t = document.querySelector('.lock');
    return t ? t.textContent.trim().length : 0;
  });
  expect(hayTexto, 'las fichas del catálogo no están en el DOM').toBeGreaterThan(40);
  expect(await page.locator('.req-src').count(), 'una cita se ha colado sin sesión').toBe(0);

  const catalogo = await page.request.get('/data/becas-catalogo.json');
  expect(catalogo.ok(), 'el catálogo público no se sirve').toBe(true);
  const publico = await catalogo.json();
  expect(
    publico.becas.some((b) => (b.requisitos ?? []).length),
    'el catálogo público lleva requisitos',
  ).toBe(false);

  // Y la barra que pide la cuenta, abajo y fuera de la lista.
  await expect(page.locator('#cartel-acceso')).toBeVisible();

  const ancho = await desborde(page);
  expect(ancho.scroll).toBeLessThanOrEqual(ancho.client + 1);

  expect(errores, errores.join(' | ')).toEqual([]);
});

test('al comprobar se ve el cartel y la página deja bajar', async ({ page }) => {
  const errores = vigilarErrores(page);
  await cargarBuscador(page);

  const yAntes = await page.evaluate(() => Math.round(scrollY));

  await page.locator('#buscar').click();

  // El cartel y, en la misma medición, si la página deja bajar.
  //
  // Las dos cosas van juntas a propósito: el cartel dura 1,4 segundos y, en
  // un equipo lento, comprobarlo por partes acababa con el beat ya
  // terminado y con un «element not found» que no era un fallo del sitio.
  await page.waitForSelector('.buscando', { timeout: 15_000 });

  const medida = await page.evaluate(() => {
    const c = document.querySelector('.buscando');
    const y = Math.round(scrollY);
    window.scrollTo({ top: y + 300, behavior: 'instant' });
    const avance = Math.round(scrollY) - y;
    window.scrollTo({ top: y, behavior: 'instant' });

    if (!c) return { cartel: null, avance, y };
    return {
      cartel: {
        titulo: !!c.querySelector('.buscando-h'),
        pasos: c.querySelectorAll('.buscando-pasos li').length,
        esqueletos: c.querySelectorAll('.esq').length,
        volver: !!c.querySelector('#buscando-volver'),
        promesa: !!c.querySelector('.buscando-sub'),
        cuenta: !!c.querySelector('.cuenta'),
      },
      avance,
      y,
    };
  });

  expect(medida.cartel, 'el cartel de la búsqueda no aparece').toBeTruthy();
  expect(medida.cartel.titulo, 'el cartel no tiene titular').toBe(true);
  expect(medida.cartel.pasos, 'el cartel no explica los tres pasos').toBe(3);
  expect(medida.cartel.esqueletos, 'el cartel no enseña huecos de ficha').toBeGreaterThan(0);
  expect(medida.cartel.volver, 'el cartel no tiene la salida a los filtros').toBe(true);
  expect(medida.cartel.promesa, 'el cartel no dice lo que va a hacer').toBe(true);
  expect(medida.cartel.cuenta, 'el cartel no enseña la cuenta de becas').toBe(true);

  // Y se puede bajar de verdad mientras busca. Es lo que se reportó.
  expect(medida.avance, `mientras busca solo se puede bajar ${medida.avance}px`).toBeGreaterThanOrEqual(200);

  // En escritorio la página no se mueve: el titular no puede quedar cortado
  // bajo la cabecera.
  if (page.viewportSize().width > 900) {
    expect(Math.abs(medida.y - yAntes), 'en escritorio el beat baja la página').toBeLessThanOrEqual(40);
    const h1 = await page.evaluate(() => {
      const h = document.querySelector('.find-top h1');
      const c = document.querySelector('header.top');
      if (!h || !c) return null;
      return { h1: Math.round(h.getBoundingClientRect().top), cabecera: Math.round(c.getBoundingClientRect().height) };
    });
    if (h1) expect(h1.h1, 'el titular queda cortado bajo la cabecera').toBeGreaterThanOrEqual(h1.cabecera);
  }

  // Y al terminar vuelve la lista.
  await expect(page.locator('.beca').first()).toBeVisible({ timeout: 20_000 });

  expect(errores, errores.join(' | ')).toEqual([]);
});

test('el filtro de destino aparta las becas que no son de ese país', async ({ page }) => {
  await cargarBuscador(page);

  const antes = await page.locator('.beca').count();

  // Un país que exista en el desplegable.
  const paises = await page.locator('#pais option').evaluateAll((os) =>
    os.map((o) => ({ v: o.value, t: o.textContent.trim() })).filter((o) => o.v));
  expect(paises.length, 'el desplegable de destino no tiene países').toBeGreaterThan(10);

  const elegido = paises.find((p) => p.v && p.t) ?? paises[0];
  await page.selectOption('#pais', elegido.v);
  await page.locator('#buscar').click();
  await expect(page.locator('.beca').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);

  const despues = await page.locator('.beca').count();
  expect(despues, 'el filtro de destino no ha recortado nada').toBeLessThan(antes);

  // La píldora de destino no puede ser un muro de texto: tres países y un +N.
  const pila = page.locator('.pill').filter({ hasText: elegido.t }).first();
  if (await pila.count()) {
    const ancho = await pila.evaluate((e) => Math.round(e.getBoundingClientRect().width));
    expect(ancho, `la píldora de destino mide ${ancho}px`).toBeLessThan(420);
  }
});

test('con cuenta, la ficha enseña los requisitos con su cita', async ({ page }) => {
  const correo = await entrar(page);
  await cargarBuscador(page);

  // La primera ficha con requisitos: cada requisito lleva su cita.
  const conRequisitos = page.locator('.beca').filter({ has: page.locator('.reqs .req-v') }).first();
  await expect(conRequisitos).toBeVisible();

  const detalle = await conRequisitos.evaluate((el) => {
    // Cada bloque `.req` es un requisito. El valor (`.req-v`) no está
    // siempre: un plazo no lo lleva, porque el plazo es la fecha, no una
    // cifra. Lo que sí tiene que estar siempre es la cita.
    const reqs = [...el.querySelectorAll('.req')];
    return {
      total: reqs.length,
      sinCita: reqs
        .filter((r) => !(r.querySelector('.req-src')?.textContent || '').trim().length)
        .map((r) => (r.querySelector('.req-k')?.textContent || '?').trim()),
      conCita: reqs.filter((r) => (r.querySelector('.req-src')?.textContent || '').trim().length).length,
    };
  });
  expect(detalle.total, 'la ficha no tiene requisitos').toBeGreaterThan(0);
  expect(detalle.conCita, 'ningún requisito lleva la cita literal del documento').toBe(detalle.total);
  expect(detalle.sinCita, 'un requisito sin la cita literal del documento').toEqual([]);

  // La cuenta de prueba no se queda en el almacén local del servidor.
  await page.request.delete('/api/cuenta', { data: { confirmar: correo } });
});
