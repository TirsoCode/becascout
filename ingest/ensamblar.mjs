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

  return { publicables, repetidas };
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
export const FUENTES_EXTERNAS = new Set(['daad', 'ue']);

export function faltan(publicables, { fichas = [], omitidas = [] } = {}) {
  // `omitidas` llega como `Set` desde el conector, y un `Set` no tiene
  // `length`: tiene `size`. Con `.length` a secas salía `undefined`, la suma
  // daba `NaN`, y `NaN` es *falsy* —así que el invariante no disparaba nunca.
  // El fallo que este invariante existe para cazar estaba, justamente, en
  // este contador.
  const esperadas = fichas.length + (omitidas.size ?? omitidas.length ?? 0);
  // Las de fuera del BOE no cuentan: el invariante vigila al BOE.
  const emitidas = publicables.filter((r) => !FUENTES_EXTERNAS.has(r.fuente)).length;
  return { esperadas, emitidas, faltan: esperadas - emitidas };
}
