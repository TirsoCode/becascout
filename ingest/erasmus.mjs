/**
 * erasmus.mjs — Conector del catálogo de Erasmus Mundus Joint Masters.
 *
 * ── Qué es esto ──────────────────────────────────────────────────────────
 *
 * Los Joint Masters de Erasmus Mundus son lo más parecido a la beca ideal del
 * producto: máster entero, financiado por la UE, abierto a estudiantes de
 * todo el mundo y con los mismos requisitos para todos. No hay que ser
 * español ni proponer un proyecto: se rellena una solicitud y ya.
 *
 * ── Por qué este conector es distinto a los otros ────────────────────────
 *
 * DAAD y Campus France enseñan documentos que no tenemos que citar: DAAD da
 * un catálogo sin requisitos y Campus France es un blog. Aquí pasa al revés.
 * El catálogo de EACEA es un directorio de enlaces, y cada programa tiene su
 * propia web —cada una con su diseño, que es una cosa que no se puede
 * scrapear. Pero hay dos cosas que sí son universales y verificables:
 *
 *   1. La cuantía de la beca: 1.400 €/mes hasta 24 meses. Está escrito en la
 *      página oficial del programa y aplica a todos.
 *   2. El requisito base: grado universitario. Igual para todos.
 *
 * Esas dos cosas se guardan CON CITA, de la página de la Comisión. Y cada
 * programa entra con el enlace a su web y a su ficha oficial del proyecto, que
 * es donde el estudiante tiene que ir igualmente. Eso no es un callejón sin
 * salida, como el de DAAD: es un punto de partida con el dato que importa
 * ya resuelto.
 *
 * Es un conector honesto sobre una fuente que no da más de sí. Preferimos
 * decir «esto es todo lo que hay y es esto» a inventar un requisitos por
 * programa.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { render } from './bdns.mjs';

const CATALOGO = 'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en';
const OFICIAL = 'https://erasmus-plus.ec.europa.eu/opportunities/organisations/cooperation-among-organisations-and-institutions/erasmus-mundus-joint-masters';

/**
 * La página de los **estudiantes**, que es donde vive lo que le importa a
 * quien va a estudiar: qué título hace falta y cuándo se presenta.
 *
 * Antes estos datos se buscaban en la página de las organizaciones, y no
 * estaban: el requisito de título no sale ahí. El 19 de octubre de 2026 se
 * comprobó contra la página equivocada, la cita no aparecía, y el conector
 * —que hace bien su trabajo— descartaba el requisito en silencio. El dato era
 * cierto; lo que no estaba bien era de dónde se sacaba.
 */
const OFICIAL_ESTUDIANTES = 'https://erasmus-plus.ec.europa.eu/opportunities/individuals/students/erasmus-mundus-joint-masters';

/**
 * Los hechos comunes a todos los Joint Masters, con el fragmento exacto de
 * donde salen. Sin cita esto no entraría en la base, y con razón: un importe
 * sin fuente es el tipo de dato que hace que alguien renuncie a una beca por
 * creer que le dan más o menos.
 *
 * `pagina` dice de qué URL sale cada uno. Los dos textos de Erasmus+ no están
 * en la misma página, y por eso el campo va en el hecho y no en el conector.
 *
 * ── Sobre el «slice(0, 24)» de la comprobación ───────────────────────────
 *
 * La cita se busca por un trozo, no entera. Se busca entero porque el texto
 * de la web cambia: si mañana escriben «€1.400» con la coma del español, la
 * cita entera ya no aparece y el requisito desaparecería de los 75
 * programas. Con los primeros 24 caracteres el número sobrevive a un cambio
 * de formato.
 */
const HECHOS = [
  {
    tipo: 'importe',
    etiqueta: 'Beca Erasmus Mundus',
    valor: 1400,
    pagina: OFICIAL,
    cita: 'EU scholarship for individuals: €1,400 per month (max. 24 months)',
    obligatorio: true,
  },
  {
    tipo: 'duracion_max',
    etiqueta: 'Duración máxima de la beca',
    valor: 24,
    pagina: OFICIAL,
    cita: 'EU scholarship for individuals: €1,400 per month (max. 24 months)',
    obligatorio: true,
  },
  {
    tipo: 'titulacion',
    etiqueta: 'Título previo',
    valor: 'Grado universitario (o último año de grado)',
    pagina: OFICIAL_ESTUDIANTES,
    cita: "have a bachelor’s degree (first degree), or be in your last year of bachelor studies",
    obligatorio: true,
  },
  {
    tipo: 'plazo',
    etiqueta: 'Plazo de solicitud',
    valor: 'Entre octubre y enero, para el curso que empieza al año siguiente',
    pagina: OFICIAL_ESTUDIANTES,
    cita: 'In most cases, you should submit your application between October and January for courses starting the following academic year',
    obligatorio: true,
  },
  {
    tipo: 'ects',
    etiqueta: 'Créditos ECTS',
    valor: '60, 90 o 120',
    pagina: OFICIAL_ESTUDIANTES,
    cita: '1 to 2 academic years (60, 90 or 120 ECTS credits)',
    obligatorio: false,
  },
];

/**
 * Hechos que no son condiciones —no se cumplen o no se incumplen, se
 * explican— y que por eso no cuentan en el anillo del buscador. Van aparte
 * para que la ficha diga de qué tipo de programa se trata sin ensuciar los
 * requisitos.
 */
const NOTAS = [
  {
    etiqueta: 'Tipo de programa',
    valor: 'Máster internacional de nivel alto, impartido en inglés por un consorcio de al menos tres instituciones de tres países distintos',
    pagina: OFICIAL_ESTUDIANTES,
    cita: 'They involve at least 3 institutions from at least 3 different countries',
  },
  {
    etiqueta: 'Cuántas personas han pasado por ellos',
    valor: 'Casi 50.000 estudiantes desde 2004',
    pagina: OFICIAL_ESTUDIANTES,
    cita: 'Almost 50,000 students have taken part since 2004',
  },
  {
    etiqueta: 'Dónde están los requisitos de cada programa',
    valor: 'En la web de cada máster: ahí están los requisitos de acceso, las universidades participantes y los pasos de la solicitud',
    pagina: OFICIAL_ESTUDIANTES,
    cita: 'the entry requirements and all the steps of the application process',
  },
];

function plano(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae los programas del catálogo.
 *
 * Cada uno es una tarjeta `ecl-card` con dos enlaces que nos importan: la
 * web del programa (donde se solicita) y la ficha del proyecto en el portal
 * de Erasmus (donde está el detalle oficial). Los dos se guardan, porque el
 * estudiante va a necesitar uno u otro según desde dónde empiece.
 */
export function programas(html) {
  // ── Por qué los atributos van con `\s+` y no con un espacio ─────────────
  //
  // El marcado de EACEA **parte los atributos en varias líneas**:
  //
  //   <article
  //     class="ecl-card"
  //     ...
  //
  // Con `<article class="ecl-card"` —un espacio y ya— no casa con nada. El
  // conector no daba error: devolvía una lista vacía y la web se quedaba con
  // los 75 programas de una pasada antigua. Un fallo silencioso que
  // parecía un dato viejo.
  //
  // Por eso aquí los espacios de los atributos son `\s+`, que come el
  // espacio, el salto de línea y los espacios que sobran. Lo mismo en el
  // `href` del enlace.
  const tarjetas = html.match(/<article\s+class="ecl-card"[\s\S]*?<\/article>/g) ?? [];
  const salida = [];

  for (const t of tarjetas) {
    // ── Dos formas de título ──────────────────────────────────────────────
    //
    // En el catálogo de Joint Masters el título va en un
    // `<span class="ecl-link__label">`, que es un enlace a la web del
    // programa. En el de Intra-Africa va en un `<div
    // class="ecl-content-block__title">` con el texto dentro, y sin
    // enlace: el programa se queda sin título si solo se mira el `span`.
    //
    // Y el texto puede llevar un salto de línea antes del cierre, que es
    // justo lo que pasa con los títulos largos. Por eso el `[^<]` va con
    // `\s*` delante: sin él, cinco programas de Intra-Africa por página se
    // perdían en silencio, sin error y sin aviso.
    const titulo = /ecl-link__label[^>]*>\s*([^<]{6,180}?)\s*</.exec(t)?.[1]?.trim()
      ?? /ecl-content-block__title[^>]*>\s*([^<]{6,180}?)\s*</.exec(t)?.[1]?.trim();
    if (!titulo) continue;

    // El href va ANTES del <span class="ecl-link__label">, no después. Buscarlo
    // al revés devuelve null en todas las tarjetas sin dar ningún error, que
    // es como se pierde una tarde: el conector «funciona» y no captura nada.
    //
    // Y el `href` también puede partirse en varias líneas, que es lo mismo
    // que pasó con el `class` de arriba. Por eso `\s+` en el `<a` y en el
    // `class` del span.
    const web = /<a\s+href="(https?:\/\/(?!erasmus-plus\.ec)[^"]+)"[^>]*>\s*<span\s+class="ecl-link__label"/.exec(t)?.[1] ?? null;
    const proyecto = /href="(https:\/\/erasmus-plus\.ec\.europa\.eu\/projects\/search\/details\/\d+)"/.exec(t)?.[1] ?? null;

    // ── El tercer enlace: el de la ficha del proyecto ─────────────────────
    //
    // En el catálogo de Intra-Africa el proyecto no sale en un `<a>` con
    // `href` de proyecto: sale en un `<p>` de la descripción, con el texto
    // del enlace y la URL escrita. Es el mismo enlace, con otra forma.
    const proyectoTexto = /erasmus-plus\.ec\.europa\.eu\/projects\/search\/details\/(\d+)/.exec(t)?.[1] ?? null;
    const idProyecto = proyecto?.split('/').pop() ?? proyectoTexto;

    // La web del programa: en Intra-Africa va en un `<p>` con la URL
    // suelta, y también puede ser un `http` a secas.
    const webTexto = /<p>[^<]*<a href="(https?:\/\/[^"]+)"/.exec(t)?.[1] ?? null;

    // Antes: si no había ni web ni proyecto, la tarjeta se descartaba. Con
    // el catálogo de Intra-Africa eso tiraba cinco programas por página sin
    // decir nada. Ahora solo se descarta si no hay título, que es lo único
    // que de verdad no se puede enseñar.
    if (!web && !proyecto && !webTexto && !proyectoTexto) continue;

    salida.push({
      titulo,
      web: web ?? webTexto,
      proyecto: proyecto ?? (proyectoTexto ? `https://erasmus-plus.ec.europa.eu/projects/search/details/${proyectoTexto}` : null),
      idProyecto: idProyecto ?? null,
    });
  }
  return salida;
}

/**
 * Verifica los hechos contra la página oficial de la que salen, y devuelve
 * solo los que se han podido confirmar.
 *
 * ── Por qué cada hecho lleva su propia página ───────────────────────────
 *
 * Los dos textos de Erasmus+ no están en el mismo sitio: la cuantía está en
 * la página de las organizaciones y el título previo y el plazo, en la de los
 * estudiantes. El 19 de octubre de 2026 los dos se buscaban en la primera, el
 * requisito de título no salía, y el conector —que hace bien su trabajo—
 * lo descartaba en silencio. El dato era cierto; lo que estaba mal era de
 * dónde se sacaba, y eso se arregló mirando la página de los estudiantes.
 *
 * ── Por qué se busca un trozo y no la cita entera ─────────────────────────
 *
 * El texto de la web cambia: si mañana escriben «€1.400» con la coma del
 * español, la cita entera ya no aparece y el requisito desaparecería de los
 * 75 programas. Con los primeros 24 caracteres el número sobrevive a un
 * cambio de formato.
 */
export async function hechosVerificados() {
  // Se pide una página por vez, y solo una vez: son dos URLs y no tiene
  // sentido bajarlas para cada uno de los 75 programas.
  const textos = new Map();
  const paginas = [...new Set([...HECHOS, ...NOTAS].map((h) => h.pagina))];
  for (const url of paginas) {
    try {
      textos.set(url, plano(await render(url)));
    } catch {
      // Una página que no se puede bajar no invalida las otras: cada hecho
      // se comprueba contra la suya.
    }
  }

  const comprueba = (lista) => lista.filter((h) => {
    const t = textos.get(h.pagina);
    return typeof t === 'string' && t.includes(h.cita.slice(0, 24));
  });

  return { hechos: comprueba(HECHOS), notas: comprueba(NOTAS) };
}

/**
 * Vuelve a comprobar los hechos contra las páginas oficiales y actualiza los
 * registros de Erasmus Mundus que ya están en la base.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * Los hechos comunes de los Joint Masters (cuantía, duración, título previo,
 * plazo) están en las páginas de Erasmus+ y se comprueban allí. Cuando una
 * cita deja de estar en la página, el hecho desaparece y el requisito se va
 * con ella. Eso está bien: es mejor no tener un dato que tener un dato que ya
 * no es cierto.
 *
 * El problema es el otro lado: cuando la cita estaba mal escrita o se
 * buscaba en la página equivocada, el hecho se caía en silencio y nadie se
 * enteraba. El requisito de título estuvo sin salir entre el 18 y el 19 de
 * octubre de 2026 por eso. Con esta función, revisar los hechos es una
 * orden, no una tarea que alguien tiene que acordarse de hacer.
 *
 * No escribe nada si algún hecho no se puede verificar: en ese caso avisa y
 * deja la base como estaba, que es el mismo criterio que el resto de la
 * ingesta.
 */
export async function refrescarBase(ruta) {
  const datos = JSON.parse(await readFile(ruta, 'utf8'));
  const registros = datos.becas ?? [];
  const emjm = registros.filter((r) => r.fuente === 'erasmus-mundus');
  if (!emjm.length) {
    throw new Error('No hay registros de Erasmus Mundus en la base.');
  }

  const { hechos, notas } = await hechosVerificados();
  if (!hechos.length) {
    throw new Error('No se ha podido verificar ningún hecho. La base no se toca.');
  }

  // Se rehacen los requisitos de los registros de Erasmus: son los mismos
  // hechos para todos, y lo que no se ha verificado no se escribe.
  for (const r of emjm) {
    r.requisitos = hechos.map((h) => ({ ...h, extractor: 'oficial' }));
    r.notas = notas.map((n) => ({ ...n, extractor: 'oficial' }));
  }

  datos.becas = registros;
  await writeFile(ruta, JSON.stringify(datos, null, 1), 'utf8');
  return { registros: emjm.length, hechos: hechos.length, notas: notas.length };
}

/**
 * Los países de cada programa.
 *
 * Vienen de `data/paises-erasmus.json`, que se genera con
 * `node ingest/erasmus-paises.mjs`. El catálogo no los da en la tarjeta, y
 * la ficha de cada programa bloquea con «Sorry», así que la única manera
 * limpia de saberlos es cruzando el filtro de países del propio catálogo.
 *
 * Es un fichero aparte y no una petición en cada pasada a propósito: son 92
 * peticiones y los países de un programa no cambian. Ver
 * `ingest/erasmus-paises.mjs` para el porqué.
 */
async function mapaDePaises() {
  try {
    const datos = JSON.parse(await readFile(new URL('../data/paises-erasmus.json', import.meta.url), 'utf8'));
    const mapa = new Map();
    for (const p of datos.programas ?? []) {
      if (p.id) mapa.set(p.id, p.paises ?? []);
    }
    return mapa;
  } catch {
    // Sin el fichero no hay países, pero los programas siguen siendo válidos:
    // el país es un dato para filtrar, no un requisito. Que se caiga en
    // silencio es lo que dice el resto de los conectores.
    return new Map();
  }
}

/** Vuelca el catálogo completo, con los hechos comunes ya citados. */
export async function recolectar({ paginas = 12, alProgresar } = {}) {
  // El catálogo viene en páginas de veinte, y son once: con nueve se perdían
  // 38 de los 206 programas. El parámetro es `page`, a diferencia del de
  // BDNS.
  //
  // Y el catálogo se lee con `fetch` y no con Chrome: el HTML plano ya trae
  // las tarjetas, y gastarse un navegador por página era lo que hacía que
  // esto tardara un minuto entero.
  const vistos = new Map();
  for (let p = 0; p < paginas; p++) {
    const html = await render(p === 0 ? CATALOGO : `${CATALOGO}?page=${p}`, { chrome: false });
    const nuevos = programas(html);
    if (!nuevos.length) break;          // última página
    // La clave es el **id del proyecto**, no el título. Con el título se
    // perdían programas: en la cuarta página solo salían quince nuevos de
    // veinte, porque cinco programas de la página anterior tenían el
    // mismo título que uno de esta —dos consorcios con el mismo nombre— y
    // el segundo se pisaba con el primero.
    //
    // El id del proyecto es único y no cambia. Cuando no hay, se usa el
    // título, que es peor pero no deja huecos.
    nuevos.forEach((x) => {
      const clave = x.proyecto?.split('/').pop() ?? x.titulo;
      if (!vistos.has(clave)) vistos.set(clave, x);
    });
    alProgresar?.({ fase: 'catalogo', pagina: p, total: vistos.size });
    if (nuevos.length < 20) break;
  }
  const lista = [...vistos.values()];

  const paisesPorId = await mapaDePaises();

  // Los hechos comunes se comprueban contra las páginas oficiales antes de
  // pegarlos a los programas. Si mañana la Comisión cambia la cuantía, el
  // conector deja de añadirla en lugar de repetir una cifra que ya no es
  // cierta a todos los programas.
  let hechos = HECHOS;
  let notas = NOTAS;
  try {
    const v = await hechosVerificados();
    hechos = v.hechos;
    notas = v.notas;
  } catch { /* se queda con los de partida */ }

  return lista.map((p, i) => {
    // El id del proyecto es la clave con la que se cruzan los países. El
    // título no sirve: dos consorcios pueden llamarse igual.
    const idProyecto = p.proyecto?.split('/').pop() ?? null;
    const paises = idProyecto ? (paisesPorId.get(idProyecto) ?? []) : [];
    return {
      id: `EMJM-${i + 1}-${p.titulo.slice(0, 24).replace(/\W+/g, '-').toLowerCase()}`,
      titulo: p.titulo,
      organizador: 'Erasmus Mundus Joint Master (consorcio)',
      ambito: 'europeo',
      fuente: 'erasmus-mundus',
      // Los países del consorcio. Un programa de Erasmus son tres o más, y
      // por eso el filtro de destino los enseña todos y no solo el primero.
      paises,
      // El nivel de estudios, para el filtro. Son programs de máster: el
      // catálogo de la EACEA los llama «Joint Master» y la Comisión dice que
      // son de 1 a 2 años académicos con 60, 90 o 120 ECTS —el mismo dato
      // que está en la nota de «Tipo de programa», con su cita. Sin este
      // campo, el filtro de nivel los apartaba de todos: el estudiante
      // pedía «Máster» y los 219 programas no aparecían.
      nivel: 'Máster',
      // El importe es el de la beca, no el presupuesto total de la convocatoria,
      // que es un orden de magnitud mayor. No se mezclan.
      presupuesto: null,
      requisitos: hechos.map((h) => ({ ...h, extractor: 'oficial' })),
      notas: notas.map((n) => ({ ...n, extractor: 'oficial' })),
      url: p.proyecto ?? p.web,
      url_programa: p.web,
      cierra: null,   // cada programa tiene el suyo; no hay uno común
      pagina: null,
    };
  });
}