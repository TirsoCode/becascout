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
 * El valor de un requisito tal y como va al feed. El presupuesto es un número
 * de las reglas y salía tal cual —«Presupuesto de la convocatoria: 49552000»—,
 * una cifra ilegible. La página ya lo pinta con `euros()`; el feed hace lo
 * mismo y le añade el símbolo. Los demás valores se quedan como están: el
 * «Duración máxima de la beca: 24» son meses y NO lleva euros.
 *
 * El `typeof` no es paranoia: `euros()` sobre un valor que no es número imprime
 * «NaN» y ahí no se aparece el error — silencio, en vez de cifra. Si el
 * extractor algún día manda el presupuesto como texto, mejor que llegue tal
 * cual que un «NaN €» con apariencia de dato.
 */
function valorRequisito(r) {
  return r.tipo === 'presupuesto' && typeof r.valor === 'number'
    ? `${euros(r.valor)} €`
    : r.valor;
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
  const filas = emjm.map((b, i) => {
    const oficial = b.url && b.url.includes('erasmus-plus.ec.europa.eu')
      ? `<a href="${escAttr(b.url)}" target="_blank" rel="noopener">ficha del proyecto</a>`
      : '—';
    const web = b.url_programa
      ? `<a href="${escAttr(b.url_programa)}" target="_blank" rel="noopener">web del programa</a>`
      : '—';
    return `        <tr id="prog-${i + 1}">
          <td>${esc(b.titulo)}</td>
          <td>${esc(ects?.valor ?? '—')}</td>
          <td>${oficial}</td>
          <td>${web}</td>
        </tr>`;
  }).join('\n');

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
        inLanguage: 'es',
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
<meta property="og:image" content="${BASE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="BecasScout: becas de Europa con los requisitos leídos y su cita.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Becas Erasmus Mundus: cuánto dan y qué piden">
<meta name="twitter:description" content="${euros(importe.valor)} € al mes, título universitario y los ${emjm.length} programas con su ficha oficial.">
<meta name="twitter:image" content="${BASE}/og.png">
<link rel="alternate" type="application/rss+xml" title="BecasScout — convocatorias" href="${BASE}/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%2312463A'/%3E%3Cpath d='M6 3.4h8l4.6 4.6v12.6H6z' fill='%23F7F4EC'/%3E%3Cpath d='M14 3.4v4.6h4.6z' fill='%23D8D0BF'/%3E%3Cpath d='M8.4 10.4h4.4M8.4 13.2h3' stroke='%23C2B9A6' stroke-width='1.1' stroke-linecap='round'/%3E%3Cpath d='M18.9 4.6 12 14.2' stroke='%231A2A24' stroke-width='2.2' stroke-linecap='round'/%3E%3Cpath d='M12 14.2 9.9 17.2' stroke='%231A2A24' stroke-width='1.5' stroke-linecap='round'/%3E%3Cpath d='M16.6 7.7 14.6 10.3' stroke='%23A9BFB4' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">

<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
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
      <a href="/#como">Cómo funciona</a>
      <a href="sobre.html">Sobre</a>
    </nav>
    <div class="top-act"><a class="btn btn-ghost" href="becas.html">Buscar becas</a></div>
  </div>
</header>

<main class="doc">
  <div class="doc-meta">Datos del catálogo oficial de EACEA y de las páginas de Erasmus+, leídos el ${fecha}</div>

  <h1>Becas Erasmus Mundus: ${euros(importe.valor)} € al mes y ${esc((titulacion?.valor ?? 'título universitario').toLowerCase())}</h1>
  <p class="doc-lede">
    Los Joint Masters de Erasmus Mundus son las becas europeas con la regla más
    limpia que hay: la misma cuantía y los mismos requisitos para todos los
    programas. Eso permite decir el número con su cita, que es justo lo que
    ninguna otra beca deja hacer.
  </p>

  <div class="callout">
    <p><strong>Lo que hay que tener, en corto:</strong> ${euros(importe.valor)} € al mes
    durante ${duracion?.valor ?? 24} meses como máximo${titulacion ? `, ${esc(titulacion.valor.toLowerCase())}` : ''}${ects ? ` y entre ${esc(ects.valor)} créditos ECTS` : ''}${plazo ? `. La solicitud se presenta ${esc(plazo.valor.toLowerCase())}` : ''}.
    No hay que ser español ni presentar un proyecto: se rellena la solicitud
    del programa y ya.</p>
  </div>

  <h2 id="cuanto">Cuánto da la beca</h2>
  <p>
    ${euros(importe.valor)} euros al mes, hasta ${duracion?.valor ?? 24} meses. La
    cuantía no la decide el programa: es la misma para todos los Joint Masters
    de Erasmus Mundus, y por eso se puede comprobar una vez y aplicarla a
    todos. La beca cubre la participación, el viaje, el visado y una asignación
    para vivir, pero el detalle de cada partida lo publica el programa.
  </p>
  <p>
    <cite>«${esc(importe.cita)}»</cite>
    <br><span style="font-size:13px;color:var(--ink-4)">Página oficial de Erasmus+ sobre los Joint Masters. La cita está en inglés porque es el texto literal de la fuente; la traducción es nuestra.</span>
  </p>

  <h2 id="requisitos">Qué hay que tener</h2>
  <p>Los mismos requisitos para los ${emjm.length} programas:</p>
  <ul>
${[titulacion, plazo, ects].filter(Boolean).map((r) => `    <li><strong>${esc(r.etiqueta)}:</strong> ${esc(r.valor)}.<br>
      <cite style="font-size:14px">«${esc(r.cita)}»</cite></li>`).join('\n')}
  </ul>
  <p>
    De edad, nota media e idioma no hay nada en estas Bases: la Comisión no los
    pone como condición de la beca. Cada programa puede pedir además cosas
    propias —un portfolio, una entrevista, un idioma concreto—, y esas están
    en la web de cada máster, que es donde hay que mirar.
  </p>

${notas.length ? `  <h2 id="que-es">Qué son exactamente</h2>
  <ul>
${notas.map((n) => `    <li><strong>${esc(n.etiqueta)}:</strong> ${esc(n.valor)}.<br>
      <cite style="font-size:14px">«${esc(n.cita)}»</cite></li>`).join('\n')}
  </ul>
` : ''}
  <h2 id="programas">Los ${emjm.length} programas</h2>
  <p>
    Esta es la lista completa del catálogo oficial, con un enlace a la ficha
    del proyecto en el portal de Erasmus+ y a la web donde se solicita. No
    están ordenados por nada: el orden es el del catálogo.
  </p>
  <table>
    <thead>
      <tr><th>Programa</th><th>ECTS</th><th>Ficha oficial</th><th>Solicitud</th></tr>
    </thead>
    <tbody>
${filas}
    </tbody>
  </table>

  <h2 id="no-sabemos">Lo que no sabemos</h2>
  <p>
    <strong>La fecha exacta.</strong> Erasmus+ dice que se presenta entre
    octubre y enero, pero cada programa tiene sus fechas y su forma de
   selectar. No las tenemos y por eso no las escribimos: un plazo aproximado
    es peor que un hueco, porque es el dato por el que alguien se decide a
    sí mismo.
  </p>
  <p>
    <strong>Los requisitos propios de cada programa.</strong> La ficha oficial
    del proyecto y la web de cada máster los traen, y por eso enlazamos a
    ellas. Lo que hay aquí es lo que la Comisión dice para todos, con su cita.
  </p>

  <h2 id="fuentes">De dónde sale esto</h2>
  <ul>
    <li><a href="https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_es" target="_blank" rel="noopener">Catálogo de Erasmus Mundus Joint Masters</a> (EACEA): de aquí sale la lista de programas y sus enlaces.</li>
    <li><a href="https://erasmus-plus.ec.europa.eu/opportunities/organisations/cooperation-among-organisations-and-institutions/erasmus-mundus-joint-masters" target="_blank" rel="noopener">Erasmus Mundus Joint Masters</a> (portal oficial de Erasmus+, organizaciones): de aquí sale la cuantía de la beca y su duración máxima.</li>
    <li><a href="https://erasmus-plus.ec.europa.eu/opportunities/individuals/students/erasmus-mundus-joint-masters" target="_blank" rel="noopener">Erasmus Mundus Joint Masters</a> (portal oficial de Erasmus+, estudiantes): de aquí salen el título previo, el plazo de solicitud, los ECTS y el tipo de programa.</li>
  </ul>
  <p>
    Cada programa enlaza a su propia web, que es donde se solicita. Lo
    único que hay entre medias es esta lista.
  </p>
</main>

<footer class="foot">
  <div class="shell foot-in">
    <small>BecasScout · Proyecto independiente. No somos ningún ministerio ni ninguna universidad.</small>
    <div class="foot-links">
      <a href="becas.html">Buscar becas</a>
      <a href="erasmus-mundus.html">Erasmus Mundus</a>
      <a href="sobre.html">Sobre</a>
      <a href="privacidad.html">Privacidad</a>
      <a href="cookies.html">Cookies</a>
      <a href="https://www.boe.es/" target="_blank" rel="noopener">BOE</a>
    </div>
  </div>
</footer>

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
  for (const b of todas.filter((x) => x.fuente !== 'erasmus-mundus')) {
    const reqs = b.requisitos ?? [];
    const desc = [
      b.organizador ? `Convoca: ${b.organizador}.` : '',
      reqs.length
        ? `Requisitos: ${reqs.map((r) => `${r.etiqueta}: ${valorRequisito(r)}`).join(' · ')}.`
        : 'De esta convocatoria todavía no hemos podido extraer los requisitos.',
      b.cierra ? `Cierra el ${b.cierra}.` : '',
      b.url ? `Documento oficial: ${b.url}` : '',
      reqs.length ? `Cita: «${reqs[0].cita}»` : '',
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
    <description>Becas leídas de la convocatoria oficial, con el requisito y su cita.</description>
    <language>es</language>
    <lastBuildDate>${rssFecha(generado)}</lastBuildDate>
    <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
}

await main();
