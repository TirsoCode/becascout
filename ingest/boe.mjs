/**
 * boe.mjs — Conector del Boletín Oficial del Estado.
 *
 * Es la única fuente del MVP que da datos estructurados de verdad, y por eso
 * merece una nota sobre cómo está construida, porque es lo no obvio:
 *
 * 1. El sumario diario (`/datosabiertos/api/boe/sumario/{fecha}`) NO trae el
 *    texto, solo el índice: identificador, título, sección y departamento.
 *    Sirve para decidir qué mirar.
 * 2. El texto hay que bajarlo aparte, documento a documento, en
 *    `/diario_boe/xml.php?id=...`. Son peticiones separadas, así que el
 *    filtro barato va ANTES de pagar el coste de traer el texto entero.
 * 3. El XML trae `metadatos` (fecha, rango, sección, páginas, ELI) y
 *    `analisis/materias`, que es una clasificación oficial por tema. Las
 *    becas caen en materia «Educación» / «Enseñanza Universitaria», así que
 *    sirve como segundo filtro, más fino que buscar palabras en el título.
 *
 * Las dos APIs son públicas y no piden clave. Quien las mantiene pide, a
 * cambio, un User-Agent identificable y un ritmo que no los tumbe.
 */

import { xml2jsonlite } from './xml.mjs';

const SUMARIO = 'https://www.boe.es/datosabiertos/api/boe/sumario';
const TEXTO = 'https://www.boe.es/diario_boe/xml.php';

const UA = 'becascout/0.1 (+https://github.com/becascout)';

/** Materias del BOE que Concentran becas y ayudas al estudio. */
const MATERIAS_EDUCACION = [
  'educación', 'educacion', 'enseñanza universitaria', 'enseñanza no universitaria',
  'universidad', 'universidades', 'investigación', 'becas', 'ayudas al estudio',
  'exchanges', 'erasmus', 'juventud',
];

/** Palabras que delatan una convocatoria de becas en el título. */
const PALABRAS_BECA = [
  'beca', 'becas', 'becario', 'becaria', 'bolsa', 'bolsas de estudio',
  'ayuda al estudio', 'ayudas al estudio', 'ayudas para estudiar',
  'movilidad', 'intercambio', 'erasmus', 'estancias', 'practical',
  'prácticas', 'proyectos de cooperación', 'becas de investigación',
];

/** Departamento que casi nunca trae becas: se salta antes de bajar el texto. */
const DEPARTAMENTOS_RUIDO = /banco de españa|cnmv|agencia tributaria|seguridad social|mutualidades/i;

async function pedir(url, { timeout = 30_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'accept': 'application/json, application/xml;q=0.9', 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** Normaliza YYYYMMDD a Date en UTC (los días del BOE son siempre completos). */
export function fechaISO(d) {
  return d.toISOString().slice(0, 10);
}

/** Cada día del rango, en orden. El BOE no publica fines de semana ni festivos. */
export function diasRango(desde, hasta) {
  const dias = [];
  const d = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  while (d <= fin) {
    dias.push(fechaISO(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

/**
 * Aplana el sumario. El XML del BOE anida de forma irregular (un
 * departamento puede traer varios epígrafes, un epígrafe varios items, y a
 * veces `epigrafe` es un string suelto cuando no hay jerarquía), así que se
 * recoge todo de forma recursiva en vez de suponer una forma fija.
 */
function aplanar(nodo, acc = []) {
  if (nodo == null) return acc;
  if (Array.isArray(nodo)) {
    nodo.forEach((x) => aplanar(x, acc));
    return acc;
  }
  if (typeof nodo !== 'object') return acc;
  if (nodo.identificador && nodo.titulo) {
    acc.push({
      id: nodo.identificador,
      titulo: String(nodo.titulo).replace(/\s+/g, ' ').trim(),
      urlXml: nodo.url_xml ?? nodo.url_xml?.texto ?? `${TEXTO}?id=${nodo.identificador}`,
      urlHtml: nodo.url_html ?? '',
      seccion: nodo.seccion ?? '',
    });
    return acc;
  }
  for (const v of Object.values(nodo)) aplanar(v, acc);
  return acc;
}

/** Descarga el índice de un día. Devuelve [] si no hay número (fin de semana). */
export async function sumario(dia) {
  const ymd = dia.replaceAll('-', '');
  const res = await pedir(`${SUMARIO}/${ymd}`);
  const json = await res.json();
  if (json?.status?.code !== '200') return [];
  const sumario_ = json?.data?.sumario;
  if (!sumario_) return [];
  return aplanar(sumario_.diario);
}

/**
 * Ruido que parece beca y no lo es.
 *
 * El BOE publica con el mismo formato las oposiciones, los ceses y los
 * acuerdos entre instituciones, y el título tiene la misma forma que el de
 * una beca. Medido en una ventana de tres semanas: de 20 candidatos, tres
 * eran oposiciones («proceso selectivo para ingreso, como personal laboral
 * fijo», «se nombra Directora General»).
 *
 * Son ruido puro. No se descartan por la palabra «beca», sino por lo que
 * piden: si el título habla de cubrir un puesto, no es una beca por mucho que
 * la palabra aparezca en algún punto de la línea.
 */
const RUIDO_CONVENIO = [
  /se publica el [Cc]onvenio/i,
  /publicaci[óo]n del [Cc]onvenio/i,
  /celebraci[óo]n de [Cc]onvenio/i,
  /se publica el acuerdo/i,
  /se publica la [Cc]onvenci[óo]n/i,
];

/** Puestos de trabajo público, ceses y nombramientos: nunca son becas. */
const RUIDO_PERSONAL = [
  /proceso selectiv/i,
  /personal laboral/i,
  /funcionari[ao]s? de carrera/i,
  /cuerpo de maestros/i,
  /cuerpos? de (profesores|maestros)/i,
  /se dispone del cese/i,
  /se nombra [Dd]irector/i,
  /nombramientos?/i,
  /expediente de personal/i,
  /concurso de traslados/i,
  /oposici[óo]n/i,
  /provisi[óo]n de puesto/i,
  /retribuci[óo]n/i,
];

/**
 * ¿Vale la pena bajar el texto de este anuncio?
 *
 * Este filtro ya NO descarta por la palabra «beca», y es un cambio de
 * criterio que conviene explicar. Se quitó porque suprime entradas según el
 * título, y el título de una convocatoria de ayuda no siempre dice «beca»:
 * dice «subvención», «ayuda», «premio», «convocatoria de plazas» o directamente
 * el nombre del programa. Quien busca una beca de investigación concreta se
 * queda sin ella porque el título decía otra cosa, y no hay forma de que se
 * entere de que se la hemos quitado. Un filtro que se equivoca es invisible.
 *
 * Lo único que se descarta aquí es lo que no puede ser una convocatoria
 * individual: los acuerdos ya firmados y los ceses. Ese filtro es seguro
 * porque no se apoya en palabras de beca, sino en que el documento no convoca
 * a nadie.
 *
 * El coste de aflojarlo es descargar más XML: unos cientos de anuncios al día,
 * todos de texto plano. Es asumible.
 */
export function esBeca(anuncio) {
  const t = anuncio.titulo.toLowerCase();

  // Convenios publicados y ceses: el documento da fe de un acuerdo ya
  // firmado o de una baja. No convoca a nadie, luego no hay nada que buscar.
  if (RUIDO_CONVENIO.some((r) => r.test(t))) return false;
  if (/se dispone del cese/i.test(t)) return false;
  return true;
}

/** Filtro por departamento emisor: fuera de educación casi no hay becas. */
export function departamentoPlausible(dep) {
  return !DEPARTAMENTOS_RUIDO.test(dep ?? '');
}

/**
 * Baja el texto completo de un anuncio y lo devuelve ya plano.
 * Devuelve null si el XML no trae <texto> (hay avisos sin cuerpo).
 */
export async function textoCompleto(anuncio) {
  const res = await pedir(anuncio.urlXml);
  const xml = await res.text();
  const doc = xml2jsonlite(xml);

  // xml2jsonlite() ya devuelve el contenido de <documento>, sin la envoltura.
  const meta = doc.metadatos ?? {};
  const cuerpo = doc.texto;
  // <texto> envuelve los párrafos en <p>, así que llega como objeto. Se
  // recorren en orden y se unen con punto y coma, que es lo que separa las
  // frases del BOE cuando se leen seguidas.
  const partes = [];
  (function recolectarTexto(n) {
    if (n == null) return;
    if (typeof n === 'string') { if (n.trim()) partes.push(n.trim()); return; }
    if (Array.isArray(n)) { n.forEach(recolectarTexto); return; }
    if (typeof n === 'object') {
      if (typeof n.p === 'string') partes.push(n.p.trim());
      else if (n.p) recolectarTexto(n.p);
      if (typeof n.p_2 === 'string') partes.push(n.p_2.trim());
      else if (n.p_2) recolectarTexto(n.p_2);
    }
  })(cuerpo);
  const texto = partes.join(' ').replace(/\s+/g, ' ').trim();

  const materias = (doc.analisis?.materias?.materia ?? [])
    .map((m) => String(m).toLowerCase());

  return {
    id: anuncio.id,
    titulo: meta.titulo || anuncio.titulo,
    fechaDisposicion: meta.fecha_disposicion ?? null,
    fechaPublicacion: meta.fecha_publicacion ?? null,
    rango: meta.rango ?? null,
    departamento: meta.departamento ?? null,
    seccion: meta.seccion ?? null,
    paginaInicio: meta.pagina_inicial ?? null,
    url: `https://www.boe.es/diario_boe/txt.php?id=${anuncio.id}`,
    urlPdf: meta.url_pdf ?? '',
    eli: meta.url_eli ?? '',
    materias,
    esEducacion: materias.some((m) => MATERIAS_EDUCACION.some((k) => m.includes(k))),
    texto,
  };
}

/**
 * Recorre un rango entero y devuelve solo los anuncios que parecen becas,
 * ya con su texto. Se apoya en `concurrencia` porque el cuello de botella es
 * la latencia, no el ancho de banda.
 *
 * `omitir` es un conjunto de identificadores ya descargados y guardados. Es la
 * diferencia entre una pasada que tarda dos minutos y una que tarda dos horas:
 * el sumario es una petición por día y sale muy barato, pero bajar el XML de
 * cada anuncio es una petición por ficha, y en una ventana de seis meses son
 * decenas de miles. El BOE es inmutable, así que un anuncio que ya está
 * guardado no hay que volver a bajarlo nunca.
 */
export async function recolectar(desde, hasta, { concurrencia = 4, alProgresar, omitir } = {}) {
  const dias = diasRango(desde, hasta);
  const fuera = omitir ?? new Set();
  const out = [];
  let vistos = 0;
  let saltados = 0;

  for (let i = 0; i < dias.length; i += concurrencia) {
    const tanda = dias.slice(i, i + concurrencia);
    const sumarios = await Promise.all(
      tanda.map((d) => sumario(d).catch(() => [])),
    );
    const candidatos = sumarios.flat().filter(esBeca);
    alProgresar?.({ fase: 'indice', dia: tanda[0], candidatos: candidatos.length });

    // Esto también va en pool. Antes era un `for` con `await` y, con la
    // caché puesta, casi todas las peticiones se salían —que es justo lo que
    // se quería— pero las que quedaban iban una detrás de otra.
    for (let j = 0; j < candidatos.length; j += concurrencia) {
      const grupo = candidatos.slice(j, j + concurrencia);
      const fichas = await Promise.all(grupo.map(async (c) => {
        if (fuera.has(c.id)) { saltados++; return null; }
        return textoCompleto(c).catch(() => null);
      }));
      for (const f of fichas) {
        if (f && f.texto.length > 300) out.push(f);
      }
    }
    alProgresar?.({ fase: 'cache', saltados });
    vistos += tanda.length;
    alProgresar?.({ fase: 'texto', avance: vistos, total: dias.length, saltados });
  }
  return { fichas: out, saltados };
}