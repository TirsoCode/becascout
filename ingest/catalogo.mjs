/**
 * catalogo.mjs — La versión pública de `data/becas.json`.
 *
 * ── Por qué hay dos ficheros ─────────────────────────────────────────────
 *
 * El buscador enseña la lista antes de pedir la cuenta: las fichas se pintan
 * y se cubren con el velo, para que quien llega vea que hay algo detrás. Eso
 * obliga a que el navegador tenga los títulos, los plazos y los importes. Lo
 * que **no** puede tener sin cuenta son los requisitos ni sus citas: eso es
 * el producto, y hasta el 30 de octubre de 2026 viajaba en el mismo JSON
 * público. Cualquiera lo descargaba con un `curl` sin registrarse.
 *
 * La solución no es esconder el fichero entero —entonces la portada del
 * buscador sería un formulario en blanco— sino partirlo:
 *
 *   · `data/becas-catalogo.json` se sirve tal cual. Tiene lo justo para
 *     pintar la lista y los filtros. No tiene `requisitos`, ni valores de
 *     requisito, ni citas.
 *   · `data/becas.json` sigue siendo la fuente completa. No se sirve por
 *     URL; solo lo lee `/api/becas`, que exige sesión. Ver `.vercelignore`
 *     y `vercel.json`.
 *
 * El catálogo conserva `n_requisitos` para que el contador de la lista
 * («N con requisitos») siga siendo verdad sin enseñar cuáles son. Es un
 * número, no un dato del documento.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/**
 * Los campos que puede ver quien no tiene cuenta.
 *
 * Es una lista blanca y no una lista negra a propósito: si mañana la ingesta
 * añade un campo con texto extraído, no se cuela por olvido. Lo que no esté
 * aquí no sale.
 */
const CAMPOS = new Set([
  'id',
  'boeIdAnuncio',
  'titulo',
  'organizador',
  'ambito',
  'seccion',
  'pagina',
  'publicada',
  'cierra',
  'cerrada',
  'importe',
  'nivel',
  'paises',
  'url',
  'eli',
  'fuente',
  'presupuesto',
  'boeIdBases',
  'url_programa',
]);

/** Una ficha sin lo que se paga con la cuenta. */
export function aCatalogo(beca) {
  const publica = {};
  for (const [clave, valor] of Object.entries(beca ?? {})) {
    if (CAMPOS.has(clave)) publica[clave] = valor;
  }

  // `requisitos: []` y no `undefined`: el buscador recorre el array en varios
  // sitios y un `undefined` lo revienta. El número aparte es lo que permite
  // contar sin enseñar.
  publica.requisitos = [];
  publica.n_requisitos = Array.isArray(beca?.requisitos) ? beca.requisitos.length : 0;

  // Marca para que la tarjeta sepa que las filas son un hueco y no datos.
  // Sin ella, el buscador diría «sin requisitos comprobables» de una ficha
  // que sí los tiene, que es justo la clase de mentira que este sitio evita.
  publica.oculto = true;
  return publica;
}

/** El documento público completo, a partir del completo. */
export function aDocumentoPublico(datos) {
  return {
    generado: datos?.generado ?? null,
    version_reglas: datos?.version_reglas ?? null,
    rango: datos?.rango ?? null,
    catalogo: true,
    becas: (datos?.becas ?? []).map(aCatalogo),
  };
}

/**
 * Escribe el catálogo junto al fichero completo. La llama `run.mjs` después
 * de escribir `data/becas.json`, y también se puede lanzar a mano:
 *
 *   node ingest/catalogo.mjs
 *
 * Sin argumentos lee y escribe en `data/`. Con `--datos` y `--salida` acepta
 * otras rutas, que es lo que usan las pruebas.
 */
export async function escribirCatalogo(rutaDatos, rutaSalida) {
  const datos = JSON.parse(await readFile(rutaDatos, 'utf8'));
  await writeFile(rutaSalida, JSON.stringify(aDocumentoPublico(datos), null, 0));
  return datos?.becas?.length ?? 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const aqui = new URL('.', import.meta.url);
  const rutaDatos = new URL('../data/becas.json', aqui);
  const rutaSalida = new URL('../data/becas-catalogo.json', aqui);
  const n = await escribirCatalogo(rutaDatos, rutaSalida);
  console.log(`  → data/becas-catalogo.json · ${n} fichas sin requisitos ni citas`);
}
