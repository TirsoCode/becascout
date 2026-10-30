/**
 * paginas.mjs — genera las páginas estáticas que salen de los datos.
 *
 * ── Por qué esto existe ───────────────────────────────────────────────────
 *
 * La capa indexable del sitio no puede ser una copia escrita a mano de los
 * datos: en cuanto los datos cambian, la copia se queda vieja y empieza a
 * decir cosas que ya no son ciertas. Y el producto entero se apoya en una
 * regla —*ningún dato sin su cita*—, así que una página escrita a mano
 * rompe esa regla por construcción: nadie puede comprobar de dónde salió un
 * número que alguien tecleó en un `<h2>`.
 *
 * Por eso estas páginas se generan: cada frase con un dato sale del registro
 * y de su `cita`, y el HTML sale de ahí. Si el conector cambia un importe,
 * cambia la cita, y la página cambia con él.
 *
 * ── Qué NO hace ───────────────────────────────────────────────────────────
 *
 * No inventa. Si un dato no viene con cita, no se escribe. En vez de eso la
 * página lo dice: hay un apartado «lo que no sabemos» que es parte del
 * producto, no un parche.
 *
 * ── Cómo se ejecuta ───────────────────────────────────────────────────────
 *
 *   node ingest/paginas.mjs
 *
 * Escribe `erasmus-mundus.html` en la raíz. No hay build: el fichero se
 * sube tal cual a Vercel.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { refrescarBase } from './erasmus.mjs';

const RAIZ = new URL('..', import.meta.url);
const BASE = 'https://becascout.vercel.app';
const RUTA_DATOS = new URL('data/becas.json', RAIZ);

/** Escapa lo que va dentro de HTML. Los títulos vienen de una web externa. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Los atributos de enlace se rompen con una comilla o un espacio. */
function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «2026-10-19» → «19 de octubre de 2026». */
function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return 'sin fecha';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** «2026-10-19» → «2026-10-19», que es lo que entiende `lastmod`. */
function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? m[0] : '2026-01-01';
}

/**
 * 1400 → «1.400». En español los millares van con punto, y un «1400 €» en
 * el título de una página es una señal de que la página la escribió una
 * máquina.
 */
function euros(n) {
  return Number(n).toLocaleString('es-ES');
}

/**
 * Busca un requisito por su tipo. Si no está, no se escribe nada de él: es
 * preferible un hueco visible a un dato que parece bueno y no lo es.
 */
function req(beca, tipo) {
  return (beca.requisitos ?? []).find((r) => r.tipo === tipo) ?? null;
}

async function main() {
  // ── Primero, los hechos ────────────────────────────────────────────────
  //
  // Los requisitos de Erasmus Mundus se comprueban contra las páginas
  // oficiales de la Comisión antes de escribir nada. Si la cita ya no está
  // donde estaba, el requisito no se escribe: es preferible un hueco
  // visible a un dato que parece bueno y no lo es.
  console.log('  Comprobando los hechos de Erasmus Mundus contra las páginas oficiales…');
  const refresco = await refrescarBase(RUTA_DATOS);
  console.log(`  ${refresco.registros} registros · ${refresco.hechos} requisitos verificados · ${refresco.notas} notas`);

  const datos = JSON.parse(await readFile(RUTA_DATOS, 'utf8'));
  const todas = datos.becas ?? [];
  const emjm = todas.filter((b) => b.fuente === 'erasmus-mundus');
  if (!emjm.length) {
    console.error('  No hay programas de Erasmus Mundus en data/becas.json. No se escribe nada.');
    process.exit(1);
  }

  // El primero trae los hechos comunes: el conector los verifica contra la
  // página oficial de la Comisión antes de pegarlos a todos los programas,
  // así que si el importe o el título previo cambian, cambian aquí también.
  const ref = emjm[0];
  const importe = req(ref, 'importe');
  const duracion = req(ref, 'duracion_max');
  const titulacion = req(ref, 'titulacion');
  const plazo = req(ref, 'plazo');
  const ects = req(ref, 'ects');
  const notas = ref.notas ?? [];
  if (!importe || !importe.cita) {
    console.error('  El importe no viene con cita. No se escribe la página.');
    process.exit(1);
  }

  const generado = datos.generado ?? new Date().toISOString();
  const fecha = fechaLarga(generado);
  const fechaIso = fechaCorta(generado);

  // ── Tabla de programas ────────────────────────────────────────────────
  // Cada fila lleva un ancla propia: el feed apunta a ella, para que quien
  // llega desde el RSS aterrice en el programa exacto y no en el principio
  // de una lista de 75.
  //
  // El nombre del programa y su cifra de ECTS no llevan `data-i18n`: son el
  // dato del catálogo oficial, y un nombre propio traducido deja de ser el
  // que se busca en la EACEA. Lo que sí se traduce es el rótulo del enlace
  // que hay a su lado, que es texto nuestro.
  const filas = emjm.map((b, i) => {
    const oficial = b.url && b.url.includes('erasmus-plus.ec.europa.eu')
      ? `<a href="${escAttr(b.url)}" target="_blank" rel="noopener" data-i18n="em.tabla.fichaProyecto">ficha del proyecto</a>`
      : '—';
    const web = b.url_programa
      ? `<a href="${escAttr(b.url_programa)}" target="_blank" rel="noopener" data-i18n="em.tabla.webPrograma">web del programa</a>`
      : '—';
    return `        <tr id="prog-${i + 1}">
          <td>${esc(b.titulo)}</td>
          <td>${esc(ects?.valor ?? '—')}</td>
          <td>${oficial}</td>
          <td>${web}</td>
        </tr>`;
  }).join('\n');

  // ── Requisitos y notas: etiqueta y valor traducibles, cita intacta ─────
  //
  // La clave sale del `tipo` del requisito (`em.req.titulacion`) porque el
  // tipo no cambia nunca. La de la nota sale del índice, porque las notas no
  // tienen tipo: siguen el orden de `NOTAS` en `ingest/erasmus.mjs`. Si se
  // añade una nota, su clave no existirá todavía y la página enseñará el
  // castellano, que es el fallo bueno: se ve y no se inventa una traducción.
  //
  // La `<cite>` no se toca ni se traduce: es el texto literal de la fuente y
  // es lo único que permite comprobar el requisito en diez segundos.
  const filasRequisitos = [titulacion, plazo, ects].filter(Boolean).map((r) => `    <li><strong data-i18n="em.req.${r.tipo}">${esc(r.etiqueta)}</strong>: <span data-i18n="em.req.${r.tipo}.valor">${esc(r.valor)}</span>.<br>
      <cite style="font-size:14px">«${esc(r.cita)}»</cite></li>`).join('\n');

  const filasNotas = notas.map((n, i) => `    <li><strong data-i18n="em.nota.${i + 1}">${esc(n.etiqueta)}</strong>: <span data-i18n="em.nota.${i + 1}.valor">${esc(n.valor)}</span>.<br>
      <cite style="font-size:14px">«${esc(n.cita)}»</cite></li>`).join('\n');

  // ── JSON-LD ───────────────────────────────────────────────────────────
  const lista = {
    '@type': 'ItemList',
    '@id': `${BASE}/erasmus-mundus.html#lista`,
    name: 'Programas Erasmus Mundus Joint Master',
    numberOfItems: emjm.length,
    itemListElement: emjm.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.titulo,
      url: b.url_programa || b.url,
    })),
  };

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${BASE}/erasmus-mundus.html#webpage`,
        url: `${BASE}/erasmus-mundus.html`,
        name: 'Becas Erasmus Mundus: cuánto dan, qué piden y los programas',
        // Los dos idiomas: desde el 22 de octubre de 2026 la página se puede
        // leer en inglés con el interruptor. El castellano es el que está en
        // el HTML —el rastreo no ejecuta JavaScript— y el inglés el que
        // encuentra quien llega desde un asistente.
        inLanguage: ['es', 'en'],
        datePublished: fechaIso,
        dateModified: fechaIso,
        isPartOf: { '@id': `${BASE}/#website` },
        about: { '@id': `${BASE}/#organization` },
        breadcrumb: { '@id': `${BASE}/erasmus-mundus.html#migas` },
        mainEntity: { '@id': `${BASE}/erasmus-mundus.html#lista` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${BASE}/erasmus-mundus.html#migas`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${BASE}/` },
          { '@type': 'ListItem', position: 2, name: 'Becas Erasmus Mundus', item: `${BASE}/erasmus-mundus.html` },
        ],
      },
      lista,
    ],
  };

  // ── El HTML ────────────────────────────────────────────────────────────
  //
  // Esta página es de las tres indexables, y era la única del sitio que no
  // cambiaba de idioma: quien navegaba en inglés aterrizaba aquí y se comía
  // el castellano entero. Los textos fijos llevan ahora `data-i18n`, con las
  // claves que el diccionario de `js/i18n.js` tendrá que conocer. El
  // conmutador es el fragmento de siempre —`div.top-lang`, hermano de
  // `.top-act` y no dentro, porque al entrar la cabecera reescribe esa zona—
  // y el módulo es el mismo `<script type="module">` que las demás páginas:
  // nada de guiones inline, que la CSP no los deja pasar.
  //
  // Lo que NO se marca, y por qué:
  //
  // - **Los metadatos.** `<title>`, `description`, `og:*`, `canonical` y el
  //   JSON-LD se quedan en castellano porque el rastreador no ejecuta
  //   JavaScript: traducirlos crearía una versión inglesa que ninguna URL
  //   sirve ni ningún sitemap anuncia.
  // - **Los datos del catálogo.** Nombre del programa, países, importes,
  //   fechas y ECTS. Un nombre propio traducido ya no es el nombre con el
  //   que se busca ese máster en la EACEA.
  // - **Las citas.** Son el texto literal de la fuente y lo único que
  //   permite comprobar el requisito en diez segundos. Una cita traducida
  //   deja de ser una cita.
  //
  // Los valores de los requisitos sí se traducen, con una salvedad: son
  // nuestra paráfrasis del texto oficial («Grado universitario (o último año
  // de grado)» resume «have a bachelor’s degree …»), no el texto de la
  // Comisión. La cita literal queda debajo, así que traducir el resumen no
  // cambia el dato; sigue habiendo de dónde tirar para comprobarlo.
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Becas Erasmus Mundus: ${euros(importe.valor)} € al mes y los ${emjm.length} programas</title>
<meta name="description" content="Beca Erasmus Mundus: ${euros(importe.valor)} € al mes hasta ${duracion?.valor ?? 24} meses, título universitario y solicitud de octubre a enero. Los ${emjm.length} programas, con su ficha y la cita oficial.">
<meta name="author" content="BecasScout">
<meta name="theme-color" content="#12463A">
<link rel="canonical" href="${BASE}/erasmus-mundus.html">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BecasScout">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="Becas Erasmus Mundus: ${euros(importe.valor)} € al mes y los ${emjm.length} programas">
<meta property="og:description" content="${euros(importe.valor)} € al mes hasta ${duracion?.valor ?? 24} meses, título universitario y solicitud entre octubre y enero. Los ${emjm.length} programas, con su ficha y la cita.">
<meta property="og:url" content="${BASE}/erasmus-mundus.html">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="BecasScout: becas de Europa con los requisitos leídos y su cita.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Becas Erasmus Mundus: cuánto dan y qué piden">
<meta name="twitter:description" content="${euros(importe.valor)} € al mes, título universitario y los ${emjm.length} programas con su ficha oficial.">
<link rel="alternate" type="application/rss+xml" title="BecasScout — convocatorias" href="${BASE}/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%2312463A'/%3E%3Cpath d='M6 3.4h8l4.6 4.6v12.6H6z' fill='%23F7F4EC'/%3E%3Cpath d='M14 3.4v4.6h4.6z' fill='%23D8D0BF'/%3E%3Cpath d='M8.4 10.4h4.4M8.4 13.2h3' stroke='%23C2B9A6' stroke-width='1.1' stroke-linecap='round'/%3E%3Cpath d='M18.9 4.6 12 14.2' stroke='%231A2A24' stroke-width='2.2' stroke-linecap='round'/%3E%3Cpath d='M12 14.2 9.9 17.2' stroke='%231A2A24' stroke-width='1.5' stroke-linecap='round'/%3E%3Cpath d='M16.6 7.7 14.6 10.3' stroke='%23A9BFB4' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="lang.css">

<!-- La tabla del catálogo es la única del sitio con cuatro columnas, y a
     390 px no cabe: los nombres de los programas son largos y las dos
     columnas de enlaces no se pueden partir. Medido el 21 de octubre de
     2026, la página salía con 448 px de ancho en una ventana de 390 —scroll
     horizontal, que es el fallo que el resto del sitio evita—. Esto aprieta
     el relleno, baja un punto el cuerpo y deja partir las palabras que no
     entren. Va aquí y no en styles.css porque es de esta página: el sistema
     de diseño no tiene tablas con enlaces en las dos últimas columnas. -->
<style>
  @media (max-width: 640px) {
    .doc table { font-size: 13px; }
    .doc th, .doc td { padding: 9px 7px; }
    /* Solo la primera columna —los nombres de los programas— puede partir
       palabras: son los que estiran la tabla. Los rótulos de las otras dos
       se parten por los espacios, que se leen mejor que un «Fich/a». */
    .doc td:first-child { overflow-wrap: anywhere; }
  }
</style>

<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>

<header class="top">
  <div class="shell top-in">
    <a class="brand" href="/">
      <svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6.6 3.2h7.2l4.4 4.4v13.2H6.6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path d="M13.8 3.2v4.4h4.4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path d="M19.2 5 12.3 14.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M12.3 14.4 10.4 17.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span class="brand-name">Becas<b>Scout</b></span>
    </a>
    <nav class="top-nav">
      <a href="/#como" data-i18n="nav.como">Cómo funciona</a>
      <a href="sobre.html" data-i18n="nav.sobre">Sobre</a>
    </nav>
    <div class="top-act"><a class="btn btn-ghost" href="becas.html" data-i18n="nav.buscar">Buscar becas</a></div>
    <!-- El conmutador va aquí, hermano de .top-act, por lo mismo que en la
         portada: lo que viva dentro de .top-act se lo lleva por delante la
         cabecera al pintar la sesión. -->
    <div class="top-lang" data-lang-switch></div>
  </div>
</header>

<main class="doc">
  <div class="doc-meta"><span data-i18n="em.meta">Datos del catálogo oficial de EACEA y de las páginas de Erasmus+, leídos el</span> <time datetime="${fechaIso}">${fecha}</time></div>

  <h1><span data-i18n="em.h1">Becas Erasmus Mundus:</span> ${euros(importe.valor)} € <span data-i18n="em.h1.mes">al mes</span> <span data-i18n="em.h1.dos">y título universitario</span></h1>
  <p class="doc-lede" data-i18n="em.lede">
    Los Joint Masters de Erasmus Mundus son las becas europeas con la regla más
    limpia que hay: la misma cuantía y los mismos requisitos para todos los
    programas. Eso permite decir el número con su cita, que es justo lo que
    ninguna otra beca deja hacer.
  </p>

  <div class="callout">
    <p><strong data-i18n="em.corto.h">Lo que hay que tener, en corto:</strong>
    ${titulacion ? `<span data-i18n="em.req.titulacion.valor">${esc(titulacion.valor)}</span>, ` : ''}${euros(importe.valor)} € <span data-i18n="em.alMes">al mes, hasta</span> ${duracion?.valor ?? 24} <span data-i18n="em.meses">meses</span>${ects ? ` <span data-i18n="em.corto.y">y entre</span> <span data-i18n="em.req.ects.valor">${esc(ects.valor)}</span> <span data-i18n="em.corto.ects">créditos ECTS</span>` : ''}.
    <span data-i18n="em.corto.p">No hay que ser español ni presentar un proyecto: la solicitud se rellena en la web del programa y ya.</span></p>
  </div>

  <h2 id="cuanto" data-i18n="em.cuanto.h2">Cuánto da la beca</h2>
  <p>
    ${euros(importe.valor)} € <span data-i18n="em.alMes">al mes, hasta</span> ${duracion?.valor ?? 24} <span data-i18n="em.meses">meses</span>.
    <span data-i18n="em.cuanto.p1">La cuantía no la decide el programa: es la misma para todos los Joint Masters
    de Erasmus Mundus, y por eso se puede comprobar una vez y aplicarla a
    todos. La beca cubre la participación, el viaje, el visado y una asignación
    para vivir, pero el detalle de cada partida lo publica el programa.</span>
  </p>
  <p>
    <cite>«${esc(importe.cita)}»</cite>
    <br><span style="font-size:13px;color:var(--ink-4)" data-i18n="em.cuanto.cita">Página oficial de Erasmus+ sobre los Joint Masters. La cita está en inglés porque es el texto literal de la fuente; la traducción es nuestra.</span>
  </p>

  <h2 id="requisitos" data-i18n="em.requisitos.h2">Qué hay que tener</h2>
  <p><span data-i18n="em.requisitos.p">Los mismos requisitos para los</span> ${emjm.length} <span data-i18n="em.requisitos.programas">programas:</span></p>
  <ul>
${filasRequisitos}
  </ul>
  <p data-i18n="em.requisitos.p2">
    De edad, nota media e idioma no hay nada en estas Bases: la Comisión no los
    pone como condición de la beca. Cada programa puede pedir además cosas
    propias —un portfolio, una entrevista, un idioma concreto—, y esas están
    en la web de cada máster, que es donde hay que mirar.
  </p>

${notas.length ? `  <h2 id="que-es" data-i18n="em.queEs.h2">Qué son exactamente</h2>
  <ul>
${filasNotas}
  </ul>
` : ''}
  <h2 id="programas"><span data-i18n="em.programas.h2">Los</span> ${emjm.length} <span data-i18n="em.programas.h2b">programas</span></h2>
  <p data-i18n="em.programas.p">
    Esta es la lista completa del catálogo oficial, con un enlace a la ficha
    del proyecto en el portal de Erasmus+ y a la web donde se solicita. No
    están ordenados por nada: el orden es el del catálogo.
  </p>
  <table>
    <thead>
      <tr><th data-i18n="em.tabla.programa">Programa</th><th>ECTS</th><th data-i18n="em.tabla.ficha">Ficha oficial</th><th data-i18n="em.tabla.solicitud">Solicitud</th></tr>
    </thead>
    <tbody>
${filas}
    </tbody>
  </table>

  <h2 id="no-sabemos" data-i18n="em.nosabemos.h2">Lo que no sabemos</h2>
  <p data-i18n-html="em.nosabemos.p1">
    <strong>La fecha exacta.</strong> Erasmus+ dice que se presenta entre
    octubre y enero, pero cada programa tiene sus fechas y su forma de
    seleccionar. No las tenemos y por eso no las escribimos: un plazo aproximado
    es peor que un hueco, porque es el dato por el que alguien se decide a
    sí mismo.
  </p>
  <p data-i18n-html="em.nosabemos.p2">
    <strong>Los requisitos propios de cada programa.</strong> La ficha oficial
    del proyecto y la web de cada máster los traen, y por eso enlazamos a
    ellas. Lo que hay aquí es lo que la Comisión dice para todos, con su cita.
  </p>

  <h2 id="fuentes" data-i18n="em.fuentes.h2">De dónde sale esto</h2>
  <ul>
    <li data-i18n-html="em.fuentes.li1"><a href="https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_es" target="_blank" rel="noopener">Catálogo de Erasmus Mundus Joint Masters</a> (EACEA): de aquí sale la lista de programas y sus enlaces.</li>
    <li data-i18n-html="em.fuentes.li2"><a href="https://erasmus-plus.ec.europa.eu/opportunities/organisations/cooperation-among-organisations-and-institutions/erasmus-mundus-joint-masters" target="_blank" rel="noopener">Erasmus Mundus Joint Masters</a> (portal oficial de Erasmus+, organizaciones): de aquí sale la cuantía de la beca y su duración máxima.</li>
    <li data-i18n-html="em.fuentes.li3"><a href="https://erasmus-plus.ec.europa.eu/opportunities/individuals/students/erasmus-mundus-joint-masters" target="_blank" rel="noopener">Erasmus Mundus Joint Masters</a> (portal oficial de Erasmus+, estudiantes): de aquí salen el título previo, el plazo de solicitud, los ECTS y el tipo de programa.</li>
  </ul>
  <p data-i18n="em.fuentes.p">
    Cada programa enlaza a su propia web, que es donde se solicita. Lo
    único que hay entre medias es esta lista.
  </p>
</main>

<footer class="foot">
  <div class="shell foot-in">
    <small data-i18n="pie.independiente">BecasScout · Proyecto independiente. No somos ningún ministerio ni ninguna universidad.</small>
    <div class="foot-links">
      <a href="becas.html" data-i18n="pie.buscar">Buscar becas</a>
      <a href="erasmus-mundus.html" data-i18n="pie.erasmus">Erasmus Mundus</a>
      <a href="sobre.html" data-i18n="pie.sobre">Sobre</a>
      <a href="privacidad.html" data-i18n="pie.privacidad">Privacidad</a>
      <a href="cookies.html" data-i18n="pie.cookies">Cookies</a>
      <a href="https://www.boe.es/" target="_blank" rel="noopener">BOE</a>
    </div>
  </div>
</footer>

<!-- El módulo del idioma es el mismo de todas las páginas. No hay guion
     propio: aquí no se pinta nada desde JavaScript salvo el propio
     conmutador, y con este basta. -->
<script type="module" src="js/i18n.js"></script>
</body>
</html>
`;

  await writeFile(new URL('erasmus-mundus.html', RAIZ), html, 'utf8');
  console.log(`  erasmus-mundus.html · ${emjm.length} programas · ${importe.valor} €/mes · cita verificada el ${fechaIso}`);

  const feedXml = await feed(todas, emjm, importe, duracion, ects, plazo, generado);
  await writeFile(new URL('feed.xml', RAIZ), feedXml, 'utf8');
  console.log(`  feed.xml · ${(feedXml.match(/<item>/g) ?? []).length} items`);

  await writeFile(new URL('llms-full.txt', RAIZ), await llmsFull(emjm, importe, duracion, titulacion, plazo, ects, notas, fecha, fechaIso), 'utf8');
  console.log(`  llms-full.txt · ${emjm.length} programas`);
}

/**
 * La versión extendida de llms.txt.
 *
 * ── Por qué no repite llms.txt ───────────────────────────────────────────
 *
 * `llms.txt` es el mapa: qué es el sitio, qué páginas hay, de dónde sale
 * cada dato. `llms-full.txt` es el texto de esas páginas. Si los dos
 * copiaran lo mismo, el segundo no aportaría nada y alguien que fora a los
 * dos leería lo mismo dos veces. Aquí va solo el detalle que el mapa no
 * contiene: los requisitos con sus citas, la lista de programas y lo que no
 * sabemos.
 *
 * Se genera aquí, y no a mano, por la misma razón que el resto: si el
 * conector cambia el importe, la cita de la Comisión que va pegada debajo
 * cambia con él, y no puede quedar una copia que diga 1.200 €.
 */
async function llmsFull(emjm, importe, duracion, titulacion, plazo, ects, notas, fecha, fechaIso) {
  const programas = emjm.map((b) => `- ${b.titulo}${b.url_programa ? ` — ${b.url_programa}` : ''}`).join('\n');

  return `# BecasScout — texto completo

> Becas de Europa leídas de la convocatoria oficial, con los requisitos como
> lista comprobable y la cita literal de cada uno.

Actualizado el ${fecha}. El mapa del sitio, con las páginas y las fuentes, está
en https://becascout.vercel.app/llms.txt

## Becas Erasmus Mundus

Los Joint Masters de Erasmus Mundus son las becas europeas con la regla más
limpia: la misma cuantía y los mismos requisitos para todos los programas. Por
eso se puede dar el dato con su cita.

### Cuánto da

${euros(importe.valor)} € al mes durante ${duracion?.valor ?? 24} meses como máximo.
La cuantía no la decide cada programa: es la misma para todos los Joint Masters
de Erasmus Mundus.

Cita literal de la página oficial de Erasmus+:

> ${importe.cita}

### Qué hay que tener

${[titulacion, plazo, ects].filter(Boolean).map((r) => `- **${r.etiqueta}:** ${r.valor}\n  > ${r.cita}`).join('\n')}

De edad, nota media e idioma no hay nada en estas Bases: la Comisión no los
pone como condición de la beca. Cada programa puede pedir cosas propias, y
esas están en la web de cada máster.

${notas.length ? `### Qué son exactamente

${notas.map((n) => `- **${n.etiqueta}:** ${n.valor}\n  > ${n.cita}`).join('\n')}

` : ''}
### Los ${emjm.length} programas

${programas}

### Lo que no sabemos

- **La fecha exacta.** Erasmus+ dice que se presenta entre octubre y enero,
  pero cada programa tiene sus fechas. No las tenemos y por eso no las
  escribimos: un plazo aproximado es peor que un hueco.
- **Los requisitos propios de cada programa.** La ficha oficial del proyecto
  y la web de cada máster los traen, y por eso cada programa enlaza a ellas.

## Cómo se extrae

Del sumario oficial se baja el documento entero y se buscan los requisitos —
nota mínima, edad, idioma, plazo, importe— por reglas, sin modelo de
lenguaje: determinista, gratuito y sin depender de ninguna clave. Cada
requisito guarda el fragmento literal del que se sacó. Si la cita no se
puede comprobar, el requisito no se guarda.
`;
}

/** «2026-10-19» → «Mon, 19 Oct 2026 00:00:00 GMT», que es lo que pide RSS 2.0. */
function rssFecha(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

/**
 * El feed.
 *
 * ── Por qué no es una copia de la página ─────────────────────────────────
 *
 * Un feed que repite lo mismo que la página de al lado no aporta nada: quien
 * se suscribe quiere enterarse de lo que **nueva**, no volver a leer lo de
 * antes. Así que el feed lleva las convocatorias completas —las del BOE y las
 * de Erasmus Mundus—, con su fecha y su fuente, y la página de Erasmus Mundus
 * lleva el catálogo. Son dos cosas distintas.
 *
 * Lo que se publica aquí es lo mismo que hay en la web, con la cita al lado:
 * si una cifra no viene con su cita, no entra en el feed tampoco.
 */
async function feed(todas, emjm, importe, duracion, ects, plazo, generado) {
  const items = [];

  // Las del BOE, con la fecha de publicación del anuncio.
  //
  // El feed **no** lleva los requisitos ni sus citas. Hasta el 30 de octubre
  // de 2026 los llevaba, y era la misma fuga que `data/becas.json`: un RSS
  // público servía el producto que la puerta dice reservar. Un feed se lee
  // sin cuenta por definición, así que aquí solo va lo que ya es público en
  // el catálogo —quién convoca, cuándo cierra y el enlace al documento— y una
  // frase que dice dónde están los requisitos.
  for (const b of todas.filter((x) => x.fuente !== 'erasmus-mundus')) {
    const desc = [
      b.organizador ? `Convoca: ${b.organizador}.` : '',
      b.cierra ? `Cierra el ${b.cierra}.` : '',
      b.url ? `Documento oficial: ${b.url}` : '',
      'Los requisitos, con su cita literal, se ven en la web con cuenta.',
    ].filter(Boolean).join(' ');

    items.push(`    <item>
      <title>${esc(b.titulo)}</title>
      <link>${BASE}/becas.html</link>
      <guid isPermaLink="false">${esc(b.id)}</guid>
      <pubDate>${rssFecha(b.publicada ? `${String(b.publicada).slice(0, 4)}-${String(b.publicada).slice(4, 6)}-${String(b.publicada).slice(6, 8)}` : generado)}</pubDate>
      <description>${esc(desc)}</description>
    </item>`);
  }

  // Las de Erasmus Mundus, con el ancla de su programa en la página.
  for (const [i, b] of emjm.entries()) {
    const desc = [
      `Beca Erasmus Mundus (Joint Master). ${euros(importe.valor)} € al mes hasta ${duracion?.valor ?? 24} meses.`,
      `ECTS: ${ects?.valor ?? '60, 90 o 120'}.`,
      plazo ? `Plazo: ${plazo.valor}.` : '',
      `Solicitud en la web del programa.`,
      b.url_programa ? `Web del programa: ${b.url_programa}` : '',
      `Cita de la fuente: «${importe.cita}»`,
    ].filter(Boolean).join(' ');

    items.push(`    <item>
      <title>${esc(b.titulo)}</title>
      <link>${BASE}/erasmus-mundus.html#prog-${i + 1}</link>
      <guid isPermaLink="true">${BASE}/erasmus-mundus.html#prog-${i + 1}</guid>
      <pubDate>${rssFecha(generado)}</pubDate>
      <description>${esc(desc)}</description>
    </item>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Feed de las convocatorias de la base. Se genera con
  \`node ingest/paginas.mjs\`, a la vez que las páginas, para que el feed no
  pueda contar una convocatoria que la web ya no enseña.
-->
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BecasScout — convocatorias</title>
    <link>${BASE}/</link>
    <description>Becas leídas de la convocatoria oficial: quién convoca, cuándo cierra y el enlace al documento.</description>
    <language>es</language>
    <lastBuildDate>${rssFecha(generado)}</lastBuildDate>
    <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
}

/**
 * Regenera **solo** el feed, sin tocar las páginas y sin red.
 *
 * La pasada completa comprueba los hechos de Erasmus Mundus contra las
 * páginas oficiales antes de escribir nada, y para cambiar una frase del RSS
 * no hace falta eso. Este modo lee `data/becas.json`, que ya tiene los hechos
 * verificados de la última pasada, y escribe `feed.xml`.
 *
 *   node ingest/paginas.mjs --solo-feed
 */
export async function regenerarFeed() {
  const datos = JSON.parse(await readFile(RUTA_DATOS, 'utf8'));
  const todas = datos.becas ?? [];
  const emjm = todas.filter((b) => b.fuente === 'erasmus-mundus');
  const ref = emjm[0];
  if (!ref) throw new Error('no hay programas de Erasmus Mundus en data/becas.json');

  const importe = req(ref, 'importe');
  if (!importe?.cita) throw new Error('el importe de Erasmus Mundus no viene con cita');

  const xml = await feed(
    todas,
    emjm,
    importe,
    req(ref, 'duracion_max'),
    req(ref, 'ects'),
    req(ref, 'plazo'),
    datos.generado ?? new Date().toISOString(),
  );
  await writeFile(new URL('feed.xml', RAIZ), xml, 'utf8');
  return (xml.match(/<item>/g) ?? []).length;
}

// Solo se ejecuta al llamarlo como programa, no al importarlo desde una
// prueba. Antes el `await main()` estaba suelto y cualquier `import` de este
// módulo regeneraba la web entera y salía a la red.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--solo-feed')) {
    const n = await regenerarFeed();
    console.log(`  feed.xml · ${n} items (sin requisitos ni citas)`);
  } else {
    await main();
  }
}
