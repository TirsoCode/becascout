/**
 * ensamblar.mjs — Qué se escribe en `data/becas.json`.
 *
 * Está fuera de `run.mjs` por una razón concreta: para poder probarlo. La
 * regla que decide qué fichas llegan al fichero se rompió una vez —el 19 de
 * octubre de 2026— y se rompió en silencio: la base pasó de 2.626 fichas a
 * 76 y el paso terminó en verde. Un fallo así solo lo pilla una prueba, y
 * la prueba necesita la regla en un sitio al que se pueda llamar sin
 * arrancar la ingesta entera.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * La caché no es solo un ahorro de tiempo. El conector **no baja** los
 * anuncios que ya tiene guardados —el BOE es inmutable—, así que esas fichas
 * no pasan por `procesar` y nunca están en `registros`. Si al escribir el
 * fichero solo se escriben las de `registros`, la caché se come las fichas.
 *
 * La regla que sale de ahí, y que `faltan()` vigila: **todo anuncio que el
 * BOE ha publicado en la ventana y ha pasado el filtro tiene que estar en el
 * fichero**, o se acaba de descargar o sale de la caché. Lo que se salga de
 * la ventana, fuera.
 */

/**
 * El id del anuncio del BOE del que salió un registro guardado.
 *
 * Las fichas nuevas lo traen en `boeIdAnuncio`. Las antiguas solo lo tienen
 * dentro de `url` (`…txt.php?id=BOE-B-2026-…`), porque al enriquecer con BDNS
 * el `id` del registro se renombró a `BDNS-…` y el id del anuncio dejó de
 * estar suelto. Sin las dos vías la caché no acierta con nada de lo ya
 * publicado: `boeIdBases` es el id del documento de **Bases** (BOE-A-…), que
 * no es el anuncio que recorre el sumario (BOE-B-…).
 */
export function idAnuncio(b) {
  return b.boeIdAnuncio
    ?? /boe\.es\/diario_boe\/txt\.php\?id=([^&\s]+)/.exec(b.url ?? '')?.[1]
    ?? b.id;
}

/**
 * La clave con la que se reconoce que dos fichas son la misma convocatoria.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * El BOE publica la misma convocatoria más de una vez, y en la web eso son
 * dos fichas de la misma beca: la que convo-ca y la que la modifica, o la
 * resolución y el anuncio que la publica. Quien busca una beca no quiere ver
 * la misma dos veces, y encima la segunda suele traer menos datos.
 *
 * Hay dos formas de reconocerlas:
 *
 * 1. **El mismo documento de Bases.** `boeIdBases` es el id del BOE-A-… que
 *    contiene las bases. Dos anuncios que remiten a las mismas bases son la
 *    misma convocatoria, y es la señal más fiable: no depende del texto.
 *
 * 2. **El mismo título.** Cuando no hay Bases —la mayoría de las fichas del
 *    BOE— el título es lo único que hay. Se comparan los títulos **sin
 *    tildes, sin números y sin las palabras que no distinguen nada** («de»,
 *    «por la que», «correspondientes al año»), porque dos anuncios de la
 *    misma convocatoria suelen diferir en la fecha o en el número de plazas.
 *
 * Lo que se hace es quedarse con la ficha que más información tiene, que es
 * la que tiene requisitos con cita y fecha de cierre.
 */
function claveDuplicado(b) {
  if (b.boeIdBases) return `bases:${b.boeIdBases}`;
  const palabras = plano(b.titulo ?? '')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 3 && !VACIAS.has(p));
  if (!palabras.length) return null;
  return `titulo:${palabras.join(' ')}`;
}

/** Palabras que no distinguen una convocatoria de otra. */
const VACIAS = new Set([
  'para', 'por', 'que', 'las', 'los', 'del', 'con', 'una', 'uno', 'unos',
  'unas', 'correspondientes', 'correspondiente', 'relativa', 'relativo',
  'mediante', 'sobre', 'segun', 'según', 'entre', 'este', 'esta', 'estos',
  'estas', 'aquel', 'aquella', 'siguiente', 'anual', 'anuales',
]);

/** Sin tildes y en minúsculas, para comparar dos textos. */
function plano(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Qué ficha se queda cuando dos son la misma convocatoria.
 *
 * Se queda la que más sabe: la que tiene requisitos con cita, la que tiene
 * fecha de cierre y la que tiene presupuesto. Y a igualdad, la más reciente,
 * que es la que trae el estado del plazo al día.
 */
function mejorFicha(a, b) {
  const puntos = (x) => [
    (x.requisitos ?? []).length,
    x.cierra ? 1 : 0,
    x.presupuesto != null ? 1 : 0,
    x.publicada ?? '',
  ].join('|');
  return puntos(b) > puntos(a) ? b : a;
}

/**
 * Junta lo recién bajado con lo que la caché perdonó y deja la lista final.
 *
 * `registros` son las fichas procesadas en esta pasada, más las de Erasmus
 * Mundus. `omitidas` son los ids de los anuncios que la caché perdonó: están
 * en la ventana, han pasado el filtro y no se han vuelto a bajar, así que hay
 * que sacarlos de `cache` y ponerlos en el fichero.
 *
 * `cache` es un `Map` de id de anuncio a registro, el mismo que se le pasa al
 * conector como `omitir`.
 */
export function ensambla({ registros = [], omitidas = [], cache = new Map(), ahora = new Date() }) {
  const salida = new Map();

  // 1. Lo que la caché perdonó. Va primero para que la posición de cada
  //    ficha no cambie de una pasada a otra.
  for (const id of omitidas) {
    const previa = cache.get(id);
    if (!previa) continue;
    // `cerrada` se recalcula: el de la caché tiene la fecha del día en que se
    // extrajo, y un plazo puede haber vencido desde entonces. Sin esto, una
    // convocatoria cerrada hacía tres semanas seguía enseñándose como abierta.
    salida.set(id, {
      ...previa,
      cerrada: previa.cierra ? new Date(previa.cierra) < ahora : false,
    });
  }

  // 2. Lo recién bajado, que pisa a lo de la caché: es el mismo anuncio, pero
  //    con la extracción de hoy. Y las fichas de Erasmus, que se suman al
  //    final y no pasan por la caché.
  //
  // La clave es el id del anuncio del BOE y no el del registro: al enriquecer
  // con BDNS el registro se renombra a `BDNS-…` y el id del anuncio deja de
  // estar suelto. Con la clave equivocada, la misma convocatoria entra dos
  // veces en el fichero.
  let repetidas = 0;
  for (const r of registros) {
    const clave = idAnuncio(r);
    if (salida.has(clave)) repetidas++;
    salida.set(clave, r);
  }

  // ── El orden del fichero ─────────────────────────────────────────────────
  //
  // Por fecha de publicación y, a igualdad, por identificador. El motivo no
  // es que se vea mejor —la web los ordena por su cuenta— sino el diff: el
  // fichero se commitea dos veces al día, y uno que reordena sus filas cada
  // vez no dice nada de qué ha cambiado. Con este orden, una ficha nueva
  // entra en su sitio, una que se sale de la ventana se va, y el resto no se
  // mueve.
  const publicables = [...salida.values()].sort((a, b) => {
    const pa = a.publicada ?? '';
    const pb = b.publicada ?? '';
    if (pa !== pb) return pb.localeCompare(pa);
    return String(a.id).localeCompare(String(b.id));
  });

  // ── La misma convocatoria, dos veces ──────────────────────────────────────
  //
  // Se quita antes de escribir, no en la web: es un dato del fichero, y el
  // feed y el catálogo público salen de aquí. La web lo repite como red de
  // seguridad, pero el sitio del problema es la ingesta.
  const unicas = [];
  const vistas = new Map();
  let duplicadas = 0;
  let duplicadasBoe = 0;
  for (const b of publicables) {
    const clave = claveDuplicado(b);
    if (!clave) { unicas.push(b); continue; }
    const anterior = vistas.get(clave);
    if (!anterior) {
      vistas.set(clave, b);
      unicas.push(b);
      continue;
    }
    duplicadas++;
    if (!FUENTES_EXTERNAS.has(b.fuente)) duplicadasBoe++;
    const buena = mejorFicha(anterior, b);
    // Se sustituye en el sitio donde estaba, para no mover el orden.
    unicas[unicas.indexOf(anterior)] = buena;
    vistas.set(clave, buena);
  }

  return { publicables: unicas, repetidas, duplicadas, duplicadasBoe };
}

/**
 * El invariante: ni una ficha menos.
 *
 * Si el BOE ha dado N convocatorias en la ventana —las nuevas más las que la
 * caché perdonó— y en el fichero hay menos, se ha perdido alguna. Una base a
 * la que se le caen fichas sin que nadie se entere es justo lo que vació la
 * base el 19 de octubre de 2026, y se salvó porque el paso terminó en
 * verde.
 *
 * Devuelve el recuento en lugar de lanzar, para que quien lo llama decida
 * qué hacer: `run.mjs` para la pasada y no escribe el fichero.
 */

/**
 * Las fuentes que **no** vienen del BOE.
 *
 * El invariante compara lo que el BOE dio con lo que hay en el fichero, así
 * que las fichas de otras fuentes tienen que quedar fuera de la cuenta. Con
 * una lista explícita y no con «todo lo que no sea Erasmus», porque cuando
 * se añadieron DAAD y la Comisión el invariante empezó a dar `faltan = -154`
 * y a **no disparar nunca**: el fallo que este invariante existe para
 * cazar quedaba libre otra vez.
 */
export const FUENTES_EXTERNAS = new Set(['erasmus-mundus', 'daad', 'ue']);

export function faltan(publicables, { fichas = [], omitidas = [], duplicadas = 0 } = {}) {
  // `omitidas` llega como `Set` desde el conector, y un `Set` no tiene
  // `length`: tiene `size`. Con `.length` a secas salía `undefined`, la suma
  // daba `NaN`, y `NaN` es *falsy* —así que el invariante no disparaba nunca.
  // El fallo que este invariante existe para cazar estaba, justamente, en
  // este contador.
  //
  // Las duplicadas del BOE se restan porque no son una ficha perdida: son dos
  // anuncios de la misma convocatoria, y quedarse con una no es perder nada.
  // Sin esta resta, el invariante dispararía en cada pasada que duplicara
  // algo —que es lo normal— y bloquearía la escritura del fichero.
  const esperadas = fichas.length + (omitidas.size ?? omitidas.length ?? 0) - duplicadas;
  // Las de fuera del BOE no cuentan: el invariante vigila al BOE.
  const emitidas = publicables.filter((r) => !FUENTES_EXTERNAS.has(r.fuente)).length;
  return { esperadas, emitidas, faltan: esperadas - emitidas };
}
