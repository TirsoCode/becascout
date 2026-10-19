/**
 * test/ensamblar.mjs — Lo que llega a `data/becas.json`, probado.
 *
 * Sale de una caché y una lista de fichas de mentira: corre sin conexión y
 * sin claves, igual que `test/store.mjs` y `test/extract.mjs`.
 *
 * ── Qué se prueba y por qué aquí ───────────────────────────────────────────
 *
 * La regla que se rompió el 19 de octubre de 2026: la caché no ahorra solo
 * descargas, sino que **decide qué fichas existen**. El conector no baja los
 * anuncios que ya tiene guardados, así que esas fichas no pasan por
 * `procesar`; si al escribir el fichero solo se escriben las recién bajadas,
 * la caché se come las demás.
 *
 * El resultado fue una base de 76 fichas donde había 2.626, con la web
 * sirviendo el 3 % de lo que tenía, y un paso que terminó en verde. Es
 * justamente el tipo de fallo que no se ve en el log: el log decía «76
 * publicadas» y no decía que faltaban 2.550.
 *
 * Por eso lo que se prueba aquí no es «se ensambla bien», sino «no se puede
 * perder una ficha sin que se note».
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ensambla, faltan, idAnuncio } from '../ingest/ensamblar.mjs';

/* ── Utilidades ─────────────────────────────────────────────────────────── */

/** Una ficha del BOE tal y como sale de `aRegistro`. */
function boe(id, extra = {}) {
  return {
    id,
    boeIdAnuncio: id,
    titulo: `Convocatoria ${id}`,
    publicada: '20261001',
    cierra: null,
    cerrada: false,
    presupuesto: null,
    requisitos: [],
    ...extra,
  };
}

/** Una ficha de Erasmus Mundus, que viene de otra fuente y sin fecha. */
function erasmus(n) {
  return {
    id: `EMJM-${n}`,
    titulo: `Programa ${n}`,
    fuente: 'erasmus-mundus',
    publicada: undefined,
    cierra: null,
    cerrada: false,
    requisitos: [],
  };
}

/* ── La caché decide qué fichas existen ─────────────────────────────────── */

test('una ficha que la caché perdonó llega al fichero', () => {
  // La regresión. El conector no baja la ficha porque está en la caché, así
  // que no está en `registros`: si no se saca de la caché, desaparece.
  const cache = new Map([['BOE-A-2026-1', boe('BOE-A-2026-1')]]);
  const { publicables } = ensambla({
    registros: [],
    omitidas: ['BOE-A-2026-1'],
    cache,
  });

  assert.equal(publicables.length, 1);
  assert.equal(publicables[0].id, 'BOE-A-2026-1');
});

test('la caché y lo recién bajado no dejan la convocatoria partida en dos', () => {
  // La misma convocatoria, guardada antes con el id del BOE y bajada ahora
  // enriquecida con BDNS. Su `id` es distinto, pero el anuncio es el mismo.
  const cache = new Map([['BOE-A-2026-1', boe('BOE-A-2026-1')]]);
  const { publicables } = ensambla({
    registros: [boe('BDNS-910610', { boeIdAnuncio: 'BOE-A-2026-1' })],
    omitidas: ['BOE-A-2026-1'],
    cache,
  });

  assert.equal(publicables.length, 1, 'no puede aparecer dos veces');
  assert.equal(publicables[0].id, 'BDNS-910610', 'gana la recién bajada');
});

test('una convocatoria repetida en la misma pasada se deja una', () => {
  // Si el conector devolviera dos veces el mismo anuncio, en el fichero
  // tiene que quedar una: en la web serían dos tarjetas idénticas seguidas.
  const cache = new Map([['BOE-A-2026-1', boe('BOE-A-2026-1')]]);
  const { publicables, repetidas } = ensambla({
    registros: [boe('BOE-A-2026-1', { requisitos: [] }), boe('BOE-A-2026-1', { requisitos: [] })],
    omitidas: [],
    cache,
  });

  assert.equal(publicables.length, 1);
  assert.equal(repetidas, 1, 'el duplicado se cuenta');
});

test('el id del anuncio se saca del sitio correcto', () => {
  // El caso viejo: la ficha viene de BDNS y su `id` es `BDNS-…`, pero el
  // anuncio del BOE sigue siendo `BOE-A-…`. Con la clave equivocada la
  // caché no acierta nunca y la misma convocatoria entra dos veces.
  assert.equal(idAnuncio(boe('BOE-A-2026-1')), 'BOE-A-2026-1');
  assert.equal(
    idAnuncio({ id: 'BDNS-910610', url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-1' }),
    'BOE-A-2026-1',
  );
  // Y el de Erasmus, que no viene del BOE: se queda con su propio id.
  assert.equal(idAnuncio(erasmus(1)), 'EMJM-1');
});

/* ── El invariante ──────────────────────────────────────────────────────── */

test('el invariante ve la ficha que falta', () => {
  const publicables = [boe('BOE-A-2026-1'), boe('BOE-A-2026-2')];
  const cuenta = faltan(publicables, { fichas: [boe('BOE-A-2026-1')], omitidas: [] });

  assert.equal(cuenta.esperadas, 1);
  assert.equal(cuenta.emitidas, 2);
  assert.equal(cuenta.faltan, -1, 'sobran, que también hay que mirarlo');
});

test('el invariante ve la ficha que falta de verdad', () => {
  // El caso del 19 de octubre: el BOE dio 63, el fichero tiene 1.
  const publicables = [boe('BOE-A-2026-1')];
  const cuenta = faltan(publicables, {
    fichas: [boe('BOE-A-2026-1')],
    omitidas: Array.from({ length: 62 }, (_, i) => `BOE-A-2026-${i + 10}`),
  });

  assert.equal(cuenta.esperadas, 63);
  assert.equal(cuenta.emitidas, 1);
  assert.equal(cuenta.faltan, 62);
});

test('las fichas de Erasmus no cuentan para el invariante', () => {
  // Vienen de otra fuente: no son convocatorias del BOE y no pueden hacer
  // fallar la comprobación.
  const publicables = [boe('BOE-A-2026-1'), erasmus(1), erasmus(2)];
  const cuenta = faltan(publicables, { fichas: [boe('BOE-A-2026-1')], omitidas: [] });

  assert.equal(cuenta.esperadas, 1);
  assert.equal(cuenta.emitidas, 1);
  assert.equal(cuenta.faltan, 0);
});

/* ── Lo que se escribe ──────────────────────────────────────────────────── */

test('`cerrada` se recalcula con la fecha de hoy', () => {
  // El registro de la caché tiene la fecha del día en que se extrajo. Un
  // plazo puede haber vencido desde entonces, y una convocatoria cerrada
  // seguía enseñándose como abierta es peor que no saberlo.
  const vencida = boe('BOE-A-2026-1', { cierra: '2020-01-01T00:00:00.000Z', cerrada: false });
  const cache = new Map([['BOE-A-2026-1', vencida]]);
  const { publicables } = ensambla({ registros: [], omitidas: ['BOE-A-2026-1'], cache });

  assert.equal(publicables[0].cerrada, true);
});

test('una convocatoria sin plazo no está cerrada', () => {
  // Lo contrario también importa: no saber el plazo no es saber que está
  // cerrada. La web ya avisa de que el plazo no se ha extraído.
  const cache = new Map([['BOE-A-2026-1', boe('BOE-A-2026-1')]]);
  const { publicables } = ensambla({ registros: [], omitidas: ['BOE-A-2026-1'], cache });

  assert.equal(publicables[0].cerrada, false);
});

test('el fichero sale ordenado por fecha de publicación', () => {
  // El fichero se commitea dos veces al día: si reordena sus filas cada vez,
  // el diff no dice nada de qué ha cambiado.
  const registros = [
    boe('BOE-A-2026-1', { publicada: '20260930' }),
    boe('BOE-A-2026-2', { publicada: '20261010' }),
    boe('BOE-A-2026-3', { publicada: '20261005' }),
  ];
  const { publicables } = ensambla({ registros, omitidas: [], cache: new Map() });

  assert.deepEqual(
    publicables.map((r) => r.publicada),
    ['20261010', '20261005', '20260930'],
  );
});

test('una convocatoria sin fecha de publicación se queda al final', () => {
  const registros = [erasmus(1), boe('BOE-A-2026-2', { publicada: '20261010' })];
  const { publicables } = ensambla({ registros, omitidas: [], cache: new Map() });

  assert.equal(publicables[0].id, 'BOE-A-2026-2');
  assert.equal(publicables[1].id, 'EMJM-1');
});
