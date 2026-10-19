/**
 * test/filtro.mjs — Qué es una beca y qué no, probado.
 *
 * Sale de títulos reales del BOE, no de la red: corre sin conexión y sin
 * claves, igual que `test/store.mjs` y `test/extract.mjs`.
 *
 * ── Por qué este fichero existe ───────────────────────────────────────────
 *
 * El filtro decide qué ve el estudiante. Un fallo en él se ve de dos maneras, y
 * las dos malas:
 *
 *   · Un falso positivo publica un layerete como si fuera una beca, y eso es
 *     justo lo que se quejó el 19 de octubre de 2026: «salen noticias o leyes
 *     y aparecen como becas».
 *   · Un falso negativo tira una beca. Y esa es peor, porque quien la buscaba
 *     no ve el hueco: no sabe que faltaba.
 *
 * Los casos de aquí son reales, con el título tal cual lo escribió el BOE y el
 * epígrafe que le puso el boletín. Si mañana el BOE cambia y estos casos
 * empiezan a fallar, el filtro ha cambiado de forma y hay que mirarlo.
 *
 * ── Lo que este filtro NO hace ────────────────────────────────────────────
 *
 * El filtro no dice si una beca es buena o mala. Eso no existe aquí y no se
 * puede saber: no hay histórico de solicitudes ni de adjudicaciones, así que
 * cualquier juicio sería inventado. El filtro responde a una sola pregunta, y
 * la pregunta es sobre el **documento**, no sobre la beca:
 *
 *   «¿Este documento está llamando a alguien, o da fe de algo que ya está
 *    resuelto?»
 *
 * Que una beca convenga o no lo decide el estudiante, comparando su nota y su
 * edad con los requisitos de cada convocatoria. Un filtro que juzgara las
 * becas una por una convertiría la lista en un ranking, y un ranking sin datos
 * detrás es una invención con formato de estadística.
 */

/* ── Datos reales ────────────────────────────────────────────────────────── */

/**
 * Las 23 convocatorias que el BOE publicó en la ventana del 19 de octubre de
 * 2026 y que pasaron el filtro. Con el epígrafe que les puso el boletín.
 *
 * Ninguna puede dejar de pasar. Esta es la prueba que pilla un filtro que se
 * ha pasado de estricto, que es el fallo caro: la beca desaparece y nadie
 * sabe que faltaba.
 */
const CONVOCATORIAS = [
  ["Subvenciones", "Orden JUI/1097/2026, de 5 de octubre, por la que se establecen las bases reguladoras para la concesión de subvenciones para el mantenimiento, funcionamiento y equipamiento de asociaciones juveniles, organizaciones juveniles y entidades prestadoras de servicios a la juventud de ámbito estatal."],
  ["Subvenciones", "Resolución de 1 de octubre de 2026, de la Dirección General de Política Interior, por la que se publican las subvenciones estatales anuales para atender los gastos de funcionamiento ordinario a las diferentes formaciones políticas con representación en el Congreso de los Diputados, durante el tercer trimestre del ejercicio 2026."],
  ["Subvenciones", "Resolución de 1 de octubre de 2026, de la Dirección General de Política Interior, por la que se publican las subvenciones estatales anuales para sufragar los gastos de seguridad a las diferentes formaciones políticas con representación en el Congreso de los Diputados, durante el tercer trimestre del ejercicio 2026."],
  ["Subvenciones", "Orden DCA/1079/2026, de 7 de octubre, por la que se establecen las bases reguladoras para la concesión de subvenciones a entidades locales para la erradicación de asentamientos irregulares de personas trabajadoras temporeras."],
  [null, "Extracto de la Orden del Ministerio de Economía, Comercio y Empresa por la que se convoca, por tramitación anticipada, la concesión de dos becas Fulbright para el curso académico 2027/2028"],
  [null, "Extracto de la Resolución de 8 de octubre de 2026 de ICEX España Exportación e Inversiones E.P.E. por la que se aprueba la convocatoria para la concesión de las subvenciones del «Programa ICEX NEXT» de ICEX España Exportación e Inversiones E.P.E."],
  [null, "Extracto de la Resolución de 3 de marzo de 2026, la Presidencia del Consejo Superior de Deportes, por la que se convocan subvenciones para los gastos de organización de los Campeonatos de España Universitarios realizados en el 2026"],
  ["Subvenciones", "Orden HAC/1062/2026, de 7 de octubre, por la que se fijan las cantidades de las subvenciones a los gastos originados por actividades electorales para las elecciones generales de 29 de noviembre de 2026."],
  ["Ayudas", "Orden SND/1063/2026, de 28 de septiembre, por la que se aprueban las bases reguladoras y la convocatoria para la selección de operaciones «Acciones para el acompañamiento a centros, servicios y equipos de atención temprana para su adaptación a los nuevos estándares del Consenso Estatal para la Mejora de la Atención Temprana», en el marco del Programa de Inclusión Social, Garantía Infantil y Lucha contra la Pobreza, cofinanciado por el Fondo Social Europeo Plus (FSE+)."],
  [null, "Extracto de la Orden de 5 de octubre de 2026 por la que se convoca, por tramitación anticipada, la concesión de una beca Fulbright para el curso 2027/2028"],
  [null, "Extracto de la Resolución de 5 de octubre de 2026 de la Subsecretaría de Cultura, por la que se convocan las ayudas para la internacionalización del videojuego, el podcast y la cultura digital correspondientes al 2026."],
  [null, "Extracto de la Orden de 28 de septiembre de 2026 por la que se convocan subvenciones para la financiación de proyectos innovadores para la transformación territorial y la lucha contra la despoblación, promovidos por entidades locales, durante el ejercicio de 2026"],
  [null, "Extracto de la Resolución de 30 de septiembre de 2026 de la Dirección General de la entidad pública empresarial Red.es, M.P., por la que se convocan las ayudas 2026 para la creación de infraestructuras para la investigación en tecnologías de uso dual."],
  ["Ayudas", "Orden TDF/1027/2026, de 23 de septiembre, por la que se modifica la Orden ETD/1236/2023, de 14 de noviembre, por la que se establecen las bases reguladoras para la concesión de ayudas a los participantes en proyectos importantes de interés común europeo y primera convocatoria, en el marco del Plan de Recuperación, Transformación y Resiliencia -financiado por la Unión Europea- Next Generation EU."],
  [null, "Extracto de la Resolución de 30 de septiembre de 2026 de la Presidencia de la Agencia Estatal de Investigación, por la que se aprueba la convocatoria 2026 de ayudas para personal técnico y de gestión de I+D+i."],
  [null, "Extracto de la Resolución de 30 de septiembre de 2026 de la Presidencia de la Agencia Estatal de Investigación por la que se aprueba la convocatoria 2026 de ayudas a Proyectos de Generación de Conocimiento y actuaciones para formación de personal investigador predoctoral."],
  [null, "Extracto de la Resolución de 30 de septiembre de 2026 de la Presidencia de la Agencia Estatal de Investigación por la que se aprueba la convocatoria 2026 de ayudas a Plataformas Tecnológicas."],
  [null, "Extracto de la Resolución de la Secretaría General de Formación Profesional de fecha 25 de Septiembre de 2026 por la que se procede a la convocatoria, de ámbito estatal, de concesión de subvenciones a entidades de formación para la financiación de acciones formativas vinculadas al catálogo nacional de estándares de competencias profesionales, en oficios y desempeños estratégicos, para el año 2026."],
  [null, "Extracto de la Resolución de la Secretaría General de Formación Profesional de fecha 25 de Septiembre de 2026, por la que se procede a la convocatoria, de ámbito estatal, de concesión de subvenciones a entidades de formación para la financiación de acciones formativas vinculadas al catálogo nacional de estándares de competencias profesionales, en el sector de la construcción, para el año 2026."],
  [null, "Extracto de la Resolución de la Secretaría General de Formación Profesional de fecha 25 de Septiembre de 2026 por la que se procede a la convocatoria de ámbito estatal para la concesión de subvenciones a entidades de formación destinadas a la financiación de acciones formativas vinculadas al catálogo nacional de estándares de competencias profesionales, en el sector del turismo patrimonial, cultural y sostenible, así como de acciones formativas de apoyo a dicho sector, para el año 2026."],
  [null, "Extracto de la Resolución de la Secretaría General de Formación Profesional de fecha 25 de Septiembre de 2026, por la que se procede a la convocatoria, de ámbito estatal, de concesión de subvenciones a entidades de formación profesional para la financiación de acciones formativas vinculadas al catálogo nacional de estándares de competencias profesionales, en sectores de alta demanda, priorizando la atención de personas en situación de especial vulnerabilidad, para el año 2026."],
  ["Subvenciones", "Orden TRM/1019/2026, de 14 de septiembre, por la que se establecen las bases reguladoras para la concesión de subvenciones públicas a las sociedades de garantía recíproca que otorguen avales a empresas del sector del transporte por carretera para la adquisición de vehículos."],
  [null, "Extracto de la Resolución de la Dirección General del Instituto de la Juventud, por la que se convocan ayudas del Programa «Erasmus+», línea de Juventud, correspondientes a la ronda de octubre de 2026"],
];

/**
 * Las 4 que el BOE publicó bajo el epígrafe «Premios» y que **no** son
 * convocatorias: dan fe de un premio que ya se ha entregado.
 *
 * No es un juicio sobre el premio. La convocatoria de esos premios se publicó
 * otro día, y ese día también salió aquí.
 */
const DECISIONES_TOMADAS = [
  ["Premios", "Resolución de 29 de septiembre de 2026, de la Secretaría de Estado de Juventud e Infancia, por la que se concede el Premio Nacional del Juguete 2026."],
  ["Premios", "Orden CLT/1059/2026, de 22 de septiembre, por la que se concede el Premio Nacional de Literatura en la modalidad de Literatura Dramática, correspondiente al año 2026."],
  ["Premios", "Orden CLT/1020/2026, de 7 de septiembre, por la que se concede el Premio Nacional de Diseño de Moda, correspondiente al año 2026."],
  ["Premios", "Orden CNU/1009/2026, de 21 de septiembre, por la que se conceden los Premios Nacionales de Investigación y los Premios Nacionales de Investigación para Jóvenes, correspondientes al año 2026."],
];

/**
 * Ruido real, sacado de la base de 2.626 fichas que había el 18 de octubre de
 * 2026. De cada categoría, un ejemplo.
 */
const RUIDO = [
  "Anuncio de la Facultad de Enfermeria de la Universidad de Barcelona sobre extravío de título universitario.",
  "Orden de 15 de septiembre de 2026, por la que se destina a los Jueces y Juezas en situación de expectativa de destino, pertenecientes a la 74.ª Promoción de la Escuela Judicial, como consecuencia del concurso resuelto por Acuerdo de la Comisión Permanente del Consejo General del Poder Judicial.",
  "Resolución de 25 de septiembre de 2026, de la Dirección General del Tesoro y Política Financiera, por la que se disponen determinadas emisiones de Obligaciones del Estado en el mes de octubre de 2026 y se convocan las correspondientes subastas.",
  "Anuncio del Administrador de Infraestructuras Ferroviarias por el que se somete a información pública a efectos de declaración de la necesidad de ocupación el Proyecto constructivo para la supresión de los pasos a nivel de los PP.KK. 155/014, 155/378 y 158/165 de la línea RFIG 430 Bif. Córdoba-El Higuerón – Los Prados. Término municipal de Álora (Málaga).",
  "Anuncio de la Confederación Hidrográfica del Júcar, O.A. por el que se somete a información pública la solicitud de una concesión de aguas subterráneas, T.M. Formiche Alto (Teruel) Expediente 2025CP0088.",
  "Cuestión de inconstitucionalidad n.º 5551-2026, en relación con las disposiciones adicionales sexta y octava de la Ley 20/2021, de 28 de diciembre, de medidas urgentes para la reducción de la temporalidad en el empleo público, por posible vulneración de los arts. 23.2 y 149.1.18 CE.",
  "Real Decreto-ley 24/2026, de 29 de septiembre, por el que se establecen medidas relacionadas con el plan de respuesta inmediata, reconstrucción y relanzamiento frente a los daños causados por la Depresión Aislada en Niveles Altos (DANA) en diferentes municipios entre el 28 de octubre y el 4 de noviembre de 2024.",
  "Anuncio de la Comunidad de Regantes Beas de Segura sobre convocatoria de Junta.",
  "Anuncio de la Comunidad General de Regantes de los Canales de Urgel sobre convocatoria de Junta General ordinaria.",
  "Anuncio de la Delegación del Gobierno en Castilla y León por el que se convoca para el levantamiento de actas previas a la ocupación de dominio público.",
];

/* ── Utilidades ──────────────────────────────────────────────────────────── */

import test from 'node:test';
import assert from 'node:assert/strict';

import { motivoDescarte, esBeca } from '../ingest/boe.mjs';

/** El filtro solo mira el título y el epígrafe del sumario. */
const filtrar = (titulo, epigrafe = null) => motivoDescarte({ titulo, epigrafe });

/** Se descarta, por el motivo que sea. */
function descarta(titulo, epigrafe = null) {
  const m = filtrar(titulo, epigrafe);
  assert.ok(
    m === 'ruido' || m === 'sin señal de convocatoria',
    `debería descartarse (${m}): ${titulo}`,
  );
}

/** Pasa el filtro. */
function pasa(titulo, epigrafe = null) {
  assert.equal(filtrar(titulo, epigrafe), null, `debería pasar: ${titulo}`);
}

/* ── Las convocatorias ───────────────────────────────────────────────────── */

test('ninguna convocatoria real se descarta', () => {
  for (const [epigrafe, titulo] of CONVOCATORIAS) {
    assert.equal(
      motivoDescarte({ titulo, epigrafe }),
      null,
      `debería pasar: ${titulo}`,
    );
  }
});

test('lo que ya está decidido no es una convocatoria', () => {
  // El epígrafe «Premios» los ponía el BOE, y por eso entraban: el epígrafe
  // se miraba antes que la lista de ruido. Ahora el veto va primero.
  for (const [epigrafe, titulo] of DECISIONES_TOMADAS) {
    assert.equal(
      motivoDescarte({ titulo, epigrafe }),
      'ruido',
      `debería descartarse: ${titulo}`,
    );
  }
});

test('el ruido real se descarta entero', () => {
  for (const titulo of RUIDO) {
    descarta(titulo);
  }
});

/* ── Las reglas, una por una ────────────────────────────────────────────── */

test('las leyes no son becas', () => {
  // Esta es la queja original: «salen noticias o leyes y aparecen como becas».
  // La ley de Asturias salía porque su título habla de «ayudas».
  descarta('Ley del Principado de Asturias 6/2026, de 10 de septiembre, de modificación de la Ley 3/2021, de 30 de junio');
  descarta('Ley 20/2021, de 28 de diciembre, de medidas urgentes para la reducción de la temporalidad en el empleo público');
  descarta('Ley Orgánica 2/2026, de 3 de marzo, por la que se modifica la Ley Orgánica del Derecho de Sufragio');
  descarta('Decreto-ley 4/2026, de 12 de junio, de medidas de apoyo a la vivienda');

  // Pero una convocatoria que cita la ley que la habilita sí es una beca.
  // Vetar «ley» sin anclarlo tiraría una convocatoria de verdad.
  pasa(
    'Extracto de la Resolución de 3 de junio de 2026, de la Consejería de Educación, por la que se convocan ayudas al amparo de la Ley 8/2025, de 28 de febrero',
  );
});

test('el epígrafe no puede salvar a un documento que no convoca', () => {
  // El fallo de orden que llenó la base: el epígrafe «Premios» o
  // «Subvenciones» lo ponía el BOE, y eso se miraba antes que la lista de
  // ruido, así que el documento se colaba sin mirarlo.
  descarta(
    'Orden CLT/1014/2026, de 24 de septiembre, por la que se designa el jurado para la concesión del Premio de Literatura en la modalidad de Literatura Dramática',
    'Premios',
  );
  descarta(
    'Real Decreto 762/2026, de 30 de septiembre, por el que se regula la concesión directa de una subvención al Obispado de…',
    'Subvenciones',
  );
  // Y al revés: el veto manda aunque el título no lleve ninguna de las
  // palabras que delatan dinero.
  descarta(
    'Anuncio de la Comisaría de Aguas de la Confederación Hidrográfica del Ebro sobre la resolución del expediente de concesión de aguas',
    'Ayudas',
  );
});

test('una palabra suelta no hace una beca', () => {
  // «movilidad» está en «Transportes y Movilidad Sostenible» y sale en el
  // título de casi todas sus resoluciones.
  descarta(
    'Resolución de 17 de agosto de 2026, de la Dirección General de Estrategias de Movilidad, por la que se publica la relación de solicitudes',
  );
  // «estancia» está dentro de «constancia».
  descarta(
    'Resolución de 3 de marzo de 2026, de la Dirección General de Costes, por la que se hace constar la constancia de la solicitud',
  );
});

test('«convocatoria» cuenta cuando va cerca de dinero', () => {
  // Al revés también: el dinero antes de la llamada.
  pasa('Subvenciones a entidades de formación para la financiación de acciones formativas: convocatoria 2026');
  // Y si el dinero está lejos, no es una convocatoria de dinero: es otra cosa.
  descarta(
    'Convocatoria de Junta General ordinaria. El acuerdo que se adopte hoy incluye además la concesión de una ayuda a la haha',
  );
});

/* ── El contrato con quien llame ────────────────────────────────────────── */

test('esBeca y motivoDescarte dicen lo mismo', () => {
  // `esBeca` se usa como predicado de `filter` en el conector, y
  // `motivoDescarte` es lo que va al log. Si se separan, el log miente.
  const casos = [
    ['Anuncio de la Comunidad de Regantes de Miralbueno sobre convocatoria de Junta', null],
    ['Extracto de la Resolución del Instituto de la Juventud, por la que se convocan ayudas del Programa Erasmus+', null],
    ['Orden CLT/1014/2026, por la que se designa el jurado para la concesión del Premio', 'Premios'],
  ];
  for (const [titulo, epigrafe] of casos) {
    assert.equal(esBeca({ titulo, epigrafe }), motivoDescarte({ titulo, epigrafe }) === null);
  }
});

test('todo descarte tiene uno de los dos motivos', () => {
  // Un descarte sin motivo no se puede revisar, y un motivo nuevo obliga a
  // mirarlo. La lista es cerrada a propósito.
  for (const titulo of RUIDO) {
    const m = filtrar(titulo);
    assert.ok(
      m === 'ruido' || m === 'sin señal de convocatoria',
      `motivo inesperado: ${m}`,
    );
  }
});
