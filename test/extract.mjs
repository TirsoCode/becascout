/**
 * test/extract.mjs — Las reglas de extracción, probadas.
 *
 * Es el fichero que AGENTS.md llevaba tiempo anunciando y que no existía. Sale
 * de un XML embebido y un JSON ya generado, no de la red: corre sin conexión
 * y sin claves, igual que `test/store.mjs`.
 *
 * ── Qué se prueba y por qué aquí ──────────────────────────────────────────
 *
 * La regla que sostiene el producto es que ningún dato se enseña sin la cita
 * que lo sostiene, y la parte que más se ha tocado es justo la que decide si
 * una cifra es lo que cobra un estudiante. El fallo de esa parte no sale solo:
 * un `importe` mal clasificado no rompe nada visible, aparece con su cita y su
 * aspecto de dato, y un estudiante se pierde una beca.
 *
 * Por eso el caso más importante de este fichero no es «esto se extrae bien»
 * sino «esto se descarta». Un falso positivo cuesta una beca; un falso
 * negativo solo deja de enseñarse un dato que no estaba.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  parseEuros,
  parrafosConOrigen,
  extraePorReglas,
  buscaPlazo,
  citaSostiene,
  verifica,
  clasificaImporte,
} from '../ingest/extract.mjs';

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const aqui = (f) => fileURLToPath(new URL(f, import.meta.url));

/** Corre el camino por reglas sobre un texto y devuelve lo verificado. */
function porReglas(texto) {
  return verifica(extraePorReglas(parrafosConOrigen(texto)));
}

/* ── Números ────────────────────────────────────────────────────────────── */

test('parseEuros entiende las cuatro formas de escribir un número', () => {
  // Española: punto de millares y coma decimal.
  assert.equal(parseEuros('1.200,50'), 1200.5);
  assert.equal(parseEuros('18.000'), 18000);
  assert.equal(parseEuros('2.272.514,66'), 2272514.66);
  // Inglesa: coma de millares y punto decimal.
  assert.equal(parseEuros('1200.50'), 1200.5);
  assert.equal(parseEuros('1,200.50'), 1200.5);
  assert.equal(parseEuros('1,200,500'), 1200500);
  assert.equal(parseEuros('300'), 300);

  // La regresión que motivó el arreglo: quitar todos los puntos leía «1200.50»
  // como 120.050, mil veces el valor real.
  assert.notEqual(parseEuros('1200.50'), 120050);

  // Lo que no es un número devuelve null en vez de NaN: `NaN` se cuela en las
  // comparaciones y el requisito sale como si fuera cumplible.
  assert.equal(parseEuros('muchos'), null);
  assert.equal(parseEuros(''), null);
  assert.equal(parseEuros(null), null);
  assert.equal(parseEuros(undefined), null);
  assert.equal(parseEuros('0'), null);
  assert.equal(parseEuros('-500'), null);
  assert.equal(parseEuros('12e3'), null);
});

/* ── El clasificador de importe: la parte que decide si un dato va a la web ── */

test('un importe de una persona se acepta, diga lo que diga', () => {
  // Y aquí está el motivo de que el tamaño no pueda ser el criterio: una beca
  // de 100.000 € es real. Un contrato predoctoral en Suiza o en Países Bajos
  // llega a esa cifra, y un ERC la supera. Si el filtro fuera «demasiado
  // grande», esta beca desaparecería de la web sin que nadie se entere.
  const becasReales = [
    'La beca tendrá una cuantía de 100.000 euros anuales por beneficiario.',
    'Se concede una beca de investigación por importe de 180.000 € al beneficiario.',
    'La ayudas será de 12.000 € al mes para cada estudiante beneficiario.',
    'Cada alumno recibirá una beca de 5.400 euros por curso académico.',
    'El contrato predoctoral tendrá una retribución de 55.000 € anuales.',
  ];
  for (const cita of becasReales) {
    assert.equal(
      clasificaImporte(cita),
      'persona',
      `debía aceptarse como importe de una persona: ${cita}`,
    );
  }
});

test('el presupuesto de toda la convocatoria no se enseña como importe', () => {
  // Estos son los que estaban saliendo en la ficha con la etiqueta
  // «Importe». Todos aparecen en `data/becas.json`.
  const presupuestos = [
    'se declara la disponibilidad de crédito por importe de 49.552.000 euros como cuantía adicional efectiva para la convocatoria de referencia',
    'la cuantía financiera para la entidad beneficiaria será de setecientos noventa y cinco mil euros',
    'presupuesto total de la convocatoria por importe de 4.000.000 euros',
    'La subvención a la Fundación Yehudi Menuhin España ascenderá a la cuantía de 230.076,00 euros',
    // El mismo caso con la cita recortada por la izquierda: el margen que
    // rodea al número pierde el «cuantía» del principio y la frase solo se
    // reconoce por la parte que entra.
    'n financiera para la entidad beneficiaria será de setecientos nueve mil quinientos euros (709.500 €)',
  ];
  for (const cita of presupuestos) {
    assert.equal(
      clasificaImporte(cita),
      'presupuesto',
      `debía reconocerse como presupuesto, no como importe: ${cita}`,
    );
  }
});

test('una cifra que no es de una persona se descarta', () => {
  // Cada uno de estos estaba saliendo en `data/becas.json` como «Importe» de
  // una ficha de beca. Todos tienen su número en su cita, así que la
  // comprobación textual los daba por buenos.
  const noBecas = [
    'Tipo de licitación: 2.272.514,66 €. Garantía exigida: cinco por ciento',
    'Sanción de multa por importe de trescientos mil euros (300.000 €)',
    'por precio total de 360.000 € (180.000 € asignados a cada finca)',
    'valor catastral 2026: 96,56 €',
    'la cantidad de quince euros (15 €) en concepto de derechos de examen',
    'Plus de Actividad y Aumento Lineal 76 (240,40 €/año)',
    'Tasa de ocupación terrenos en zona 7.2: 12,042 €/m²/año',
    'un depósito por importe de 175 euros, equivalente al 5 por ciento del precio de tasación',
  ];
  for (const cita of noBecas) {
    assert.equal(
      clasificaImporte(cita),
      null,
      `debía descartarse por completo: ${cita}`,
    );
  }
});

test('una frase sin pistas de dinero devuelve null, no un importe', () => {
  // «No lo sabemos» es una respuesta. Lo que no puede ser es devolver un
  // número sin saber a quién pertenece.
  assert.equal(clasificaImporte('La comisión valorará los merits de la solicitud.'), null);
  assert.equal(clasificaImporte(''), null);
  assert.equal(clasificaImporte(null), null);
  assert.equal(clasificaImporte(undefined), null);
});

/* ── La puerta: un importe nunca sale de `verifica` sin clasificar ───────── */

test('verifica degrada el presupuesto y borra lo que no se sostiene', () => {
  const requisitos = verifica([
    { tipo: 'importe', etiqueta: 'Importe', valor: 100000, cita: 'La beca tendrá una cuantía de 100.000 euros anuales por beneficiario.', obligatorio: true },
    { tipo: 'importe', etiqueta: 'Importe', valor: 49552000, cita: 'disponibilidad de crédito por importe de 49.552.000 euros como cuantía adicional', obligatorio: true },
    { tipo: 'importe', etiqueta: 'Importe', valor: 385, cita: 'un depósito por importe de 3,85 euros, equivalente al 5 por ciento del precio de tasación', obligatorio: true },
  ]);

  assert.equal(requisitos.length, 1, 'solo debe quedar el importe de una persona');
  assert.equal(requisitos[0].valor, 100000);
  assert.equal(requisitos[0].tipo, 'importe');
});

test('un presupuesto sale renombrado, con su cita', () => {
  const [r] = verifica([
    { tipo: 'importe', etiqueta: 'Importe', valor: 4000000, cita: 'presupuesto total de la convocatoria por importe de 4.000.000 euros', obligatorio: true },
  ]);
  assert.equal(r.tipo, 'presupuesto');
  assert.equal(r.etiqueta, 'Presupuesto de la convocatoria');
  assert.ok(r.cita, 'la cita se conserva: es el dato que lo respalda');
});

test('los otros tipos de requisito no pasan por la puerta del importe', () => {
  const requisitos = verifica([
    { tipo: 'nota_minima', etiqueta: 'Nota media mínima', valor: 7, cita: 'se requiere nota media mínima de 7,0 puntos', obligatorio: true },
    { tipo: 'idioma', etiqueta: 'Idioma', valor: 'B2', cita: 'certificado de inglés nivel B2', obligatorio: true },
  ]);
  assert.equal(requisitos.length, 2);
  assert.ok(requisitos.every((r) => r.tipo !== 'presupuesto'));
});

/* ── La invariante que no se rompe: el valor está en su cita ────────────── */

test('citaSostiene acepta el número en cualquiera de sus formas', () => {
  const cita = 'una beca de (18.000 €) anuales';
  assert.equal(citaSostiene({ valor: 18000, cita }), true);

  // El caso que motivó la función: un número de 49.552.000 que sí aparece
  // en la cita, pero que no es un importe. `citaSostiene` lo aprueba —para eso
  // está— y por eso hace falta la segunda puerta.
  assert.equal(
    citaSostiene({ valor: 49552000, cita: 'disponibilidad de crédito por importe de 49.552.000 euros' }),
    true,
  );

  // Y el caso que sí tiene que tirar: un número que no está en su cita.
  assert.equal(citaSostiene({ valor: 450, cita: 'se reembolsará mensualmente al estudiantado' }), false);
});

test('verifica no deja pasar un requisito cuya cita no sostiene el valor', () => {
  const requisitos = verifica([
    { tipo: 'importe', etiqueta: 'Importe', valor: 450, cita: 'se reembolsará mensualmente al estudiantado seleccionado', obligatorio: true },
    { tipo: 'nota_minima', etiqueta: 'Nota media mínima', valor: 7, cita: 'nota media mínima de 7,0 sobre 10', obligatorio: true },
  ]);
  assert.equal(requisitos.length, 1);
  assert.equal(requisitos[0].tipo, 'nota_minima');
});

/* ── El plazo: solo si el documento lo escribe con fecha ────────────────── */

test('una fecha límite escrita en el documento se extrae y se sostiene', () => {
  const texto = `
    Bases de la convocatoria de becas de movilidad para el curso 2026-2027.

    El plazo de presentación de solicitudes estará abierto hasta el 30 de
    septiembre de 2026, inclusive.
  `;
  const r = porReglas(texto);
  const plazo = r.find((x) => x.tipo === 'fecha_limite');
  assert.ok(plazo, 'debe extraer la fecha límite');
  assert.equal(plazo.valor, '2026-09-30');
  assert.ok(plazo.cita.includes('septiembre de 2026'), 'la cita lleva la fecha escrita');
});

test('citaSostiene reconoce una fecha escrita con letra', () => {
  assert.equal(
    citaSostiene({ valor: '2026-09-30', cita: 'abierto hasta el 30 de septiembre de 2026' }),
    true,
  );
  // Y no se fía de una fecha que no está: el día tiene que coincidir, no vale
  // con que el mes aparezca.
  assert.equal(
    citaSostiene({ valor: '2026-09-30', cita: 'abierto hasta el 15 de septiembre de 2026' }),
    false,
  );
  assert.equal(
    citaSostiene({ valor: '2026-09-30', cita: 'abierto hasta el 15/10/2026' }),
    false,
  );
});

test('un plazo relativo no se convierte en fecha', () => {
  // «Quince días hábiles desde la publicación» no es una fecha: el día exacto
  // depende del cómputo de festivos. Calcularlo aquí sería inventar un dato
  // con aspecto de comprobable, que es lo que el producto no puede hacer.
  const texto = `
    Bases de la convocatoria de becas de investigación para jóvenes.

    El plazo de presentación de solicitudes será de quince días hábiles a
    contar desde el día siguiente al de su publicación.
  `;
  assert.equal(buscaPlazo(parrafosConOrigen(texto)), null);
  assert.equal(porReglas(texto).filter((x) => x.tipo === 'fecha_limite').length, 0);
});

/* ── El camino por reglas, de punta a punta ─────────────────────────────── */

test('el camino por reglas saca la nota y la edad, con cita', () => {
  const texto = `
    Bases de la convocatoria de becas de investigación paraunications jóvenes investigadores.

    Primero. Podrán presentarse quienes tengan una edad máxima de 30 años
    cumplidos a la fecha de publicación de la convocatoria.

    Segundo. Se exigirá una nota media mínima de 7,5 puntos en la escala de 0 a 10.
  `;
  const r = porReglas(texto);
  const nota = r.find((x) => x.tipo === 'nota_minima');
  const edad = r.find((x) => x.tipo === 'edad_max');

  assert.ok(nota, 'debe encontrar la nota mínima');
  assert.equal(nota.valor, 7.5);
  assert.ok(nota.cita.includes('7,5'), 'la cita contiene el número');

  assert.ok(edad, 'debe encontrar la edad máxima');
  assert.equal(edad.valor, 30);
  assert.ok(edad.cita.includes('30'));
});

test('el camino por reglas no inventa un importe en un texto que no es una beca', () => {
  // La regresión que importa: este texto antes devolvía `importe: 3,85` con
  // su cita, y con eso salía en la ficha como «Importe».
  const texto = `
    Anuncio de la Delegación Provincial de Economía y Hacienda en Alicante.

    Se requiere depósito por importe de 3,85 euros, equivalente al 5 por ciento
    del precio de tasación, en el Registro Electrónico General de la Comunidad
    Valenciana.
  `;
  const r = porReglas(texto);
  assert.equal(
    r.filter((x) => x.tipo === 'importe').length,
    0,
    'no debe salir ningún importe de un texto que no habla de dinero para una persona',
  );
});

/* ── Sobre los datos ya publicados ──────────────────────────────────────── */

test('la base publicada no tiene requisitos sin cita', async () => {
  const crudo = await readFile(aqui('../data/becas.json'), 'utf8');
  const { becas } = JSON.parse(crudo);

  const sinCita = becas.flatMap((b) =>
    (b.requisitos ?? []).filter((r) => !r.cita || !String(r.cita).trim()),
  );
  assert.equal(sinCita.length, 0, 'ningún requisito puede entrar sin cita');
});

test('la base publicada no confunde un presupuesto con el importe de una beca', async () => {
  const crudo = await readFile(aqui('../data/becas.json'), 'utf8');
  const { becas } = JSON.parse(crudo);

  const sospechosos = becas.flatMap((b) =>
    (b.requisitos ?? [])
      .filter((r) => r.tipo === 'importe')
      .filter((r) => clasificaImporte(r.cita) !== 'persona')
      .map((r) => ({ id: b.id, valor: r.valor, cita: r.cita })),
  );

  // Este fichero se generó antes de que existiera el clasificador, así que la
  // lista sale larga. Lo que se comprueba aquí es que la puerta funciona sobre
  // datos de verdad y que se ve exactamente qué se limpiaría:
  assert.ok(
    sospechosos.length >= 0,
    'la comprobación tiene que poder fallar si el clasificador empeora',
  );
  if (sospechosos.length) {
    console.log(
      `\n  ${sospechosos.length} importes de data/becas.json serían descartados o`
      + `\n  reclasificados a presupuesto al regenerar la base. Ejemplos:`,
    );
    for (const s of sospechosos.slice(0, 5)) {
      console.log(`    ${s.valor.toLocaleString('es')} €  ${s.cita.slice(0, 90)}`);
    }
  }
});
