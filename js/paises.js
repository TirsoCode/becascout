/**
 * paises.js — el catálogo de países de Europa, con su código y su nombre.
 *
 * ── Por qué esto es un fichero y no una lista dentro del HTML ────────────
 *
 * El `<select>` de destino y el conector de la ingesta necesitan la misma
 * lista, y si son dos listas se desincronizan: el conector aprende a leer un
 * país que el `<select>` no tiene, y el estudiante elige uno que el conector
 * nunca escribió. En un sitio donde una convocatoria puede desaparecer por
 * un detalle del nombre del país, tener dos listas es tener un fallo
 * esperando.
 *
 * El módulo es ESM puro y no toca el DOM, así que lo usan igual el navegador
 * y Node. Sin build, como todo lo demás.
 *
 * ── La lista ─────────────────────────────────────────────────────────────
 *
 * Europa no es la UE. Están los veintisiete de la Unión, más el Espacio
 * Económico Europeo y los que comparten programas de intercambio con la UE:
 *
 *   - Los 27 de la UE.
 *   - Islandia, Liechtenstein, Noruega y Suiza: el EEE y los que comparten
 *     programas de intercambio con la UE.
 *   - Reino Unido: fuera de la UE desde 2020, pero con Erasmus+ y con
 *     becas de intercambio, que es exactamente el caso de este buscador.
 *   - Los Balcanes orientales y el Caucasus: Albania, Bosnia y Herzegovina,
 *     Georgia, Kosovo, Moldavia, Montenegro, Macedonia del Norte, Serbia,
 *     Turquía y Ucrania. Entran por Erasmus+ y por los programas del Consejo
 *     de Europa.
 *
 * Los microestados no están: no tienen programas propios de beca y meterlos
 * sería ruido en un desplegable.
 *
 * El nombre es el que se enseña y el que se compara, en castellano. Los
 * códigos son ISO 3166-1 alfa-2, que es lo que usan las fuentes oficiales.
 */

/** ISO 3166-1 alfa-2, en el orden en que se enseñan. */
export const CODIGOS = [
  'ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'BE', 'AT', 'IE', 'FI',
  'SE', 'DK', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR',
  'SI', 'EE', 'LV', 'LT', 'CY', 'MT',
  'IS', 'LI', 'NO', 'CH', 'GB',
  'AL', 'BA', 'GE', 'XK', 'MD', 'ME', 'MK', 'RS', 'TR', 'UA',
];

/** Nombre en castellano, indexado por código. */
export const NOMBRES = {
  ES: 'España',
  FR: 'Francia',
  DE: 'Alemania',
  IT: 'Italia',
  PT: 'Portugal',
  NL: 'Países Bajos',
  BE: 'Bélgica',
  AT: 'Austria',
  IE: 'Irlanda',
  FI: 'Finlandia',
  SE: 'Suecia',
  DK: 'Dinamarca',
  PL: 'Polonia',
  CZ: 'Chequia',
  SK: 'Eslovaquia',
  HU: 'Hungría',
  RO: 'Rumanía',
  BG: 'Bulgaria',
  GR: 'Grecia',
  HR: 'Croacia',
  SI: 'Eslovenia',
  EE: 'Estonia',
  LV: 'Letonia',
  LT: 'Lituania',
  CY: 'Chipre',
  MT: 'Malta',
  IS: 'Islandia',
  LI: 'Liechtenstein',
  NO: 'Noruega',
  CH: 'Suiza',
  GB: 'Reino Unido',
  AL: 'Albania',
  BA: 'Bosnia y Herzegovina',
  GE: 'Georgia',
  XK: 'Kosovo',
  MD: 'Moldavia',
  ME: 'Montenegro',
  MK: 'Macedonia del Norte',
  RS: 'Serbia',
  TR: 'Turquía',
  UA: 'Ucrania',
};

/**
 * Sinónimos que aparecen en las fuentes.
 *
 * Las fuentes no escriben «Países Bajos»: escriben «Holanda», «the
 * Netherlands», «Netherlands». Y el nombre en castellano tampoco es lo que
 * viene en el dato, sino lo que el estudiante escribe en el desplegable. Esta
 * tabla traduce entre los tres, y es la que permite que un dato que viene en
 * inglés acabe en la fila correcta.
 *
 * Las claves van en minúsculas y sin acentos, que es como se comparan.
 */
const SINONIMOS = {
  espana: 'ES', spain: 'ES',
  francia: 'FR', france: 'FR',
  alemania: 'DE', germany: 'DE', deutschland: 'DE',
  italia: 'IT', italy: 'IT',
  portugal: 'PT',
  paisesbajos: 'NL', holanda: 'NL', netherlands: 'NL', neerland: 'NL',
  belgica: 'BE', belgium: 'BE',
  austria: 'AT',
  irlanda: 'IE', ireland: 'IE',
  finlandia: 'FI', finland: 'FI',
  suecia: 'SE', sweden: 'SE',
  danamarca: 'DK', denmark: 'DK',
  polonia: 'PL', poland: 'PL',
  chequia: 'CZ', czechia: 'CZ', czechrepublic: 'CZ',
  eslovaquia: 'SK', slovakia: 'SK',
  hungria: 'HU', hungary: 'HU',
  rumania: 'RO', romania: 'RO',
  bulgaria: 'BG',
  grecia: 'GR', greece: 'GR',
  croacia: 'HR', croatia: 'HR',
  eslovenia: 'SI', slovenia: 'SI',
  estonia: 'EE',
  letonia: 'LV', latvia: 'LV',
  lituania: 'LT', lithuania: 'LT',
  chipre: 'CY', cyprus: 'CY',
  malta: 'MT',
  islandia: 'IS', iceland: 'IS',
  liechtenstein: 'LI',
  noruega: 'NO', norway: 'NO',
  suiza: 'CH', switzerland: 'CH',
  reinounido: 'GB', unitedkingdom: 'GB', greatbritain: 'GB',
  albania: 'AL',
  bosniaherzegovina: 'BA', bosnia: 'BA',
  georgia: 'GE',
  kosovo: 'XK',
  moldavia: 'MD', moldova: 'MD',
  montenegro: 'ME',
  macedoniadelnorte: 'MK', northmacedonia: 'MK', macedonia: 'MK',
  serbia: 'RS',
  turquia: 'TR', turkey: 'TR', turkiye: 'TR',
  ukrania: 'UA', ukraine: 'UA',
};

/** Minúsculas y sin acentos, para comparar texto que viene de dos sitios. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Convierte lo que diga una fuente en un código ISO, o null si no se sabe.
 *
 * Devuelve null en vez de inventar: un país mal identificado mete una beca
 * en la fila equivocada, y el estudiante la pierde por un error nuestro.
 */
export function aCodigo(texto) {
  if (!texto) return null;
  const s = norm(texto);
  if (!s) return null;

  // Un código de dos letras ya vale: es como lo mandan las fuentes.
  if (/^[a-z]{2}$/.test(s) && NOMBRES[s.toUpperCase()]) return s.toUpperCase();

  // Un nombre exacto del catálogo.
  for (const [cod, nombre] of Object.entries(NOMBRES)) {
    if (norm(nombre) === s) return cod;
  }

  // Un sinónimo conocido.
  if (SINONIMOS[s]) return SINONIMOS[s];

  // Y por último, un nombre que esté dentro de un texto más largo. Se
  // separa por palabras para que «Macedonia del Norte» gane a «Macedonia».
  return codigosEn(s)[0] ?? null;
}

/**
 * Busca todos los países que se mencionan en un texto.
 *
 * Se usa para las Bases del BOE, donde el destino sale en una frase, y para
 * los consorcios de Erasmus, que son tres o más. Un texto puede mencionar
 * varios países, y para Erasmus tiene sentido: el consorcio son tres.
 */
export function codigosEn(texto) {
  const s = norm(texto);
  if (!s) return [];
  const vistos = new Set();
  for (const [clave, cod] of Object.entries(SINONIMOS)) {
    if (clave.length < 5) continue;
    const re = new RegExp(`(^|[^a-z])${clave}([^a-z]|$)`, 'i');
    if (re.test(s)) vistos.add(cod);
  }
  return [...vistos];
}

/** Nombre en castellano de un código, o el propio código si no se conoce. */
export function nombreDe(cod) {
  return NOMBRES[cod] ?? cod ?? '';
}
