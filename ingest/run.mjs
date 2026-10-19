/**
 * run.mjs — Orquestador de la ingesta.
 *
 *   node ingest/run.mjs --desde 2025-09-01 --hasta 2025-09-30
 *
 * Los requisitos salen por reglas, no por un modelo: ver `ingest/extract.mjs`.
 *
 * Escribe data/becas.json. El formato es JSON plano y no una base de datos
 * a propósito: el frontend tiene que poder abrirlo con un `fetch` desde
 * cualquier hosting estático, y cuando el volumen justifique Neon se cambia
 * el origen sin tocar la forma de los registros.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { recolectar, textoCompleto } from './boe.mjs';
import { codigosEn } from '../js/paises.js';
import { idDesdeBoe, render, aRegistro as aRegistroBdns } from './bdns.mjs';
import { recolectar as recolectarErasmus } from './erasmus.mjs';
import { recolectar as recolectarDaad } from './daad.mjs';
import { recolectar as recolectarUe } from './ue.mjs';
import { parrafosConOrigen, extrae } from './extract.mjs';
import { idAnuncio, ensambla, faltan } from './ensamblar.mjs';

const BDNS_BASE = 'https://www.infosubvenciones.es/bdnstrans/GE/es';

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

/**
 * Limpia el texto de cada ficha y le saca lo que el extractor sí entiende.
 * Los datos que no se pueden verificar (fecha de cierre, importe) se dejan a
 * null en lugar de estimarse: la interfaz muestra «—» y el estudiante mira
 * el original.
 */
function aRegistro(ficha, requisitos) {
  const publicada = ficha.fechaPublicacion || null;
  const cierra = requisitos.find((r) => r.tipo === 'fecha_limite')?.valor ?? null;
  const importe = requisitos.find((r) => r.tipo === 'importe')?.valor ?? null;
  const nota = requisitos.find((r) => r.tipo === 'nota_minima')?.valor ?? null;
  const edad = requisitos.find((r) => r.tipo === 'edad_max')?.valor ?? null;
  const nivel = requisitos.find((r) => r.tipo === 'nivel')?.valor ?? null;

  return {
    id: ficha.id,
    // El id del anuncio se conserva aparte porque, al enriquecer con BDNS, el
    // registro se renombra a `BDNS-…` y la caché necesita saber qué anuncio ya
    // está guardado. Ver `idAnuncio`.
    boeIdAnuncio: ficha.id,
    titulo: ficha.titulo,
    organizador: ficha.departamento || 'Sin especificar',
    ambito: /junta|consejería|diputación|ayuntamiento|mancomunidad|provincia|cabildo|ayuntamiento/i
      .test(ficha.departamento || '') ? 'local' : 'estatal',
    seccion: ficha.seccion,
    pagina: ficha.paginaInicio ? Number(ficha.paginaInicio) : null,
    publicada,
    cierra,
    cerrada: cierra ? new Date(cierra) < new Date() : false,
    importe,
    nota_minima: nota,
    edad_max: edad,
    // El nivel de estudios, para el filtro. Lo dice el documento.
    nivel,
    // Los países de destino. Los dice el documento, y solo se guardan los
    // que se han podido confirmar: una convocatoria sin destino conocido
    // se queda sin destino, y el filtro la enseña igualmente.
    paises: paisesDe(ficha, requisitos),
    url: ficha.url,
    eli: ficha.eli,
    // Los requisitos sin cita no entran. Ver AGENTS.md.
    requisitos: requisitos.filter((r) => r.cita),
    texto_len: ficha.texto.length,
    // El texto entero no viaja al front: pesa y no se muestra.
  };
}

/**
 * Los países de destino de una convocatoria.
 *
 * ── Por qué casi todas son España ────────────────────────────────────────
 *
 * El BOE es el boletín del Estado: lo que publica son ayudas de la
 * Administración General, de las comunidades y de las universidades
 * españolas. Casi todas son para estudiar **en España**, y esa es la
 * lectura por defecto.
 *
 * Pero no todas. Hay becas de movilidad, de intercambio, de prácticas en
 * el extranjero, y ahí el destino es otro país —a veces varios, y a veces
 * «cualquier país de la UE»—. Para esas, el destino se busca en el texto.
 *
 * ── La regla que decide ──────────────────────────────────────────────────
 *
 * Se mira el texto de la convocatoria y se busca un país **junto a una
 * palabra de destino**: «destino», «país de destino», «universidad de
 * destino», «estancia en», «movilidad en», «permanencia en».
 *
 * La palabra de destino es lo que evita el error grande: sin ella, un
 * documento que menciona «Francia» en una lista de países con los que
 * hay acuerdo would dejaría a todas las becas como Idleonas. Con ella, el
 * país solo cuenta si el documento dice que ahí se estudia.
 *
 * ── Lo que no se hace ────────────────────────────────────────────────────
 *
 * No se deduce el destino de quien convoca. Que lo convoque la
 * «Consejería de Educación de Andalucía» no significa que la beca sea
 * para Andalucía: el BOE es el mismo para todo el Estado.
 */
function paisesDe(ficha, requisitos) {
  const texto = String(ficha.texto ?? '');

  // Las palabras quereddicen «aquí se estudia».
  const senales = /(?:pa[ií]s|universidad|instituto|centro)\s+de\s+destino|destino\s+(?:en|de|para)|estancias?\s+en|movilidad\s+en|permanencia\s+en|estudios\s+en|se\s+destinan\s+a|destinatarios?\s+en/i;

  const encontrados = new Set();

  // Se parte el texto en frases, para que la palabra de destino y el país
  // tienen que estar en la misma frase y no a dos páginas de distancia.
  for (const frase of texto.split(/[.;:]\s+/)) {
    if (!senales.test(frase)) continue;
    for (const cod of codigosEn(frase)) {
      // España sale siempre: es el Estado. Los demás solo si la frase dice
      // que el destino está allí.
      if (cod === 'ES') continue;
      encontrados.add(cod);
    }
  }

  // Si el texto nombra un destino fuera de España, ese es el destino. Si
  // no, es España.
  if (encontrados.size) return [...encontrados];
  return ['ES'];
}

const desde = arg('desde', diasAtras(arg('dias', 21)));
const hasta = arg('hasta', fechaPorDefecto(0));
// BDNS necesita un Chrome. En local y en los runners de GitHub Actions ya
// lo hay, pero si no, la ingesta sigue con BOE solo en vez de romperse.
const usarBdns = !process.argv.includes('--sin-bdns');

/** Fecha de hace N días, para el modo `--dias 21` que usa el cron. */
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - (Number(n) || 21));
  return d.toISOString().slice(0, 10);
}

/**
 * Caché de lo ya bajado, por identificador del anuncio del BOE.
 *
 * El BOE es inmutable: una convocatoria publicada en septiembre no cambia en
 * diciembre. Así que una vez bajada y extraída, esa ficha no hay que volver a
 * tocarla nunca.
 *
 * ── Por qué la clave es el id del anuncio ────────────────────────────────
 *
 * `recolectar` y `procesar` preguntan por el id del anuncio que trae el
 * sumario (`BOE-B-2026-…`), así que esa es la clave con la que hay que
 * guardar: cualquier otra no coincide nunca. La versión anterior indexaba por
 * `b.boeIdBases ?? b.id` y de 577 fichas se reutilizaron 0 — se volvía a
 * bajar el texto y a pedirle la extracción a convocatorias que ya estaban
 * guardadas dos líneas más abajo.
 */
async function cachePrevia() {
  try {
    const previa = JSON.parse(await readFile(new URL('../data/becas.json', import.meta.url), 'utf8'));
    const mapa = new Map();
    for (const b of previa.becas) {
      mapa.set(idAnuncio(b), b);
    }
    return mapa;
  } catch {
    return new Map();
  }
}

function fechaPorDefecto(deltaDias) {
  const d = new Date();
  d.setDate(d.getDate() + deltaDias);
  return d.toISOString().slice(0, 10);
}

console.log(`BecasScout · ingesta ${desde} → ${hasta}`);
console.log('Extractor: reglas (determinista, sin modelo)');
console.log(`Fuentes:   BOE${usarBdns ? ' + BDNS (Chrome) + Bases' : ''} + Erasmus Mundus`);

/**
 * Cuántas descargas se solapan.
 *
 * ── Por qué hay pool y no un `for` con `await` ───────────────────────────
 *
 * Antes cada ficha se procesaba sola: página de BDNS con Chrome (unos 2
 * segundos) y luego el XML de las Bases. Con doscientas
 * fichas eso son siete minutos de reloj en los que solo hay una cosa
 * esperando. El trabajo es independiente ficha a ficha —no comparten nada—,
 * así que no hay motivo para no hacerlo a la vez.
 *
 * Y no es solo que vaya más rápido, que es lo de menos. El job de GitHub tiene
 * `timeout-minutes: 45`: si la pasada no cabe, el cron se la come entera y ese
 * día la base no se actualiza. Ir en paralelo es lo que hace que la pasada
 * quepa de sobra, y de eso va la estabilidad de los datos.
 *
 * ── El número ───────────────────────────────────────────────────────────
 *
 * Seis. No por prudencia, sino por cómo falla el otro extremo: BDNS va
 * detrás de un WAF y cuando te corta **no lo dice**. Responde con una página
 * de «Acceso Denegado» y el programa la trata como «esta ficha no trae nada»,
 * así que la beca se queda sin presupuesto ni plazo sin que nada se caiga ni
 * salte un error. Ese fallo es invisible, y por eso el número va en una
 * bandera y no escrito en el código.
 *
 * Con `--concurrencia N` se cambia sin tocar nada, y vale para los dos pools:
 * el de descarga del BOE —que antes llevaba un 5 fijo y la bandera no lo
 * tocaba— y el de fichas.
 */
const CONCURRENCIA = Math.max(1, Number(arg('concurrencia', 6)) || 6);

/**
 * La caché se carga ANTES de `recolectar`, al revés de antes, y no es un
 * detalle de orden sino el motivo de que esto sea utilizable.
 *
 * Si se cargase después no habría forma de saltarse nada: para descartar la
 * descarga de un anuncio ya guardado hay que saber que estaba guardado antes
 * de empezar a bajarlo. Con la caché delante, `omitir` le dice al conector qué
 * no tocar, y una pasada diaria solo baja lo nuevo —que son unas pocas fichas—
 * en vez de las 577 que hay en tres días, y de las 26.000 que habría en seis
 * meses.
 */
const cache = await cachePrevia();
console.log(`Caché:     ${cache.size} fichas ya bajadas de una pasada anterior`);

// `reutilizadas` es lo que se ha saltado por estar en la caché. Antes vivía
// dentro de `procesar`, y eso contaba cero: las fichas cacheadas ya no llegan
// a `procesar`, porque el conector no se las descarga. Un contador que siempre
// dice 0 no informa de nada, y era justo el número que hacía falta mirar para
// saber si la caché funcionaba.
let reutilizadas = 0;

const { fichas, omitidas, descartes } = await recolectar(desde, hasta, {
  concurrencia: CONCURRENCIA,
  omitir: new Set(cache.keys()),
  alProgresar: ({ fase, avance, total, dia, saltados: s }) => {
    if (fase === 'indice') process.stdout.write(`\r  ${dia}  `);
    else if (fase === 'cache') reutilizadas = s;
    else process.stdout.write(`\r  texto ${avance}/${total} días · ${s ?? 0} ya en caché   `);
  },
});
process.stdout.write('\n');

// Las que la caché ha perdonado: están en la ventana, han pasado el filtro y
// no se han vuelto a bajar. Vuelven al fichero al final, desde la caché.
console.log(`  ${fichas.length} nuevas · ${omitidas.size} reutilizadas · ${[...descartes.values()].reduce((a, b) => a + b, 0)} descartadas por el filtro`);
for (const [m, n] of descartes) console.log(`    [${m}: ${n}]`);

/**
 * ── Por qué esto va en pool y no en un `for` con `await` ─────────────────
 *
 * El número y el porqué están en `CONCURRENCIA`, arriba del todo, porque
 * gobierna tanto la descarga como el procesado.
 */

/** Una ficha, de principio a fin. Devuelve su registro. */

async function procesar(f) {
  const previa = cache.get(f.id);
  if (previa) {
    // El BOE no cambia una convocatoria ya publicada, así que se devuelve el
    // registro tal cual estaba, con sus requisitos y su cita. Si algún día
    // cambian las reglas de extracción hay que acordarse de esto: un registro
    // cacheado no se vuelve a mirar nunca.
    return previa;
  }

  // ── El salto de calidad ────────────────────────────────────────────────
  // Un extracto del BOE es una nota de una página que remite a la ficha de
  // BDNS. Ahí están el presupuesto, el plazo y el enlace a las Bases, que
  // es donde de verdad viven los requisitos. Si nos saltamos ese paso, el
  // producto se queda con «se convocan becas» y cinco números sueltos.
  const bdnsId = idDesdeBoe(f.texto);
  let registro = aRegistro(f, []);
  // Local a la ficha, y no una variable compartida por el bucle. Antes
  // `requisitos` vivía fuera y se reasignaba dentro: hoy salía bien porque
  // el bucle era secuencial, y en cuanto hay dos fichas en vuelo una le
  // pisa los requisitos a la otra. Con esto dentro, no hay nada que pisar.
  let requisitos = [];

  if (bdnsId && usarBdns) {
    const html = await render(`${BDNS_BASE}/convocatoria/${bdnsId}`).catch(() => null);
    if (html && !/Acceso Denegado/i.test(html)) {
      const ficha = aRegistroBdns(html, bdnsId);
      // Se mezclan los dos documentos: la identidad y el enlace oficial
      // vienen del BOE, que es la fuente primaria, y el presupuesto y el
      // plazo de BDNS, que es el registro administrativo.
      registro = {
        ...registro,
        id: `BDNS-${bdnsId}`,
        presupuesto: ficha.presupuesto ?? registro.presupuesto,
        // La fecha de fin del periodo no está en el extracto del BOE: viene
        // de la ficha de BDNS. Sin este `??` el dato se quedaba en el camino
        // y todas las fichas salían sin plazo.
        cierra: ficha.cierra ?? registro.cierra,
        sede: ficha.sede ?? registro.sede,
        boeIdBases: ficha.boeId,
        titulo: ficha.titulo ?? registro.titulo,
      };
      // Las Bases están en el BOE y el BOE se lee sin navegador: se baja el
      // texto y se extraen los requisitos de ahí, que es donde se pueden
      // citar.
      if (ficha.boeId) {
        const bases = await textoCompleto({
          id: ficha.boeId,
          urlXml: `https://www.boe.es/diario_boe/xml.php?id=${ficha.boeId}`,
        }).catch(() => null);

        if (bases?.texto?.length > 300) {
          registro = { ...registro, texto_bases_len: bases.texto.length };
          requisitos = await extrae(parrafosConOrigen(bases.texto));
        }
      }
    }
  }

  if (!requisitos.length) {
    requisitos = await extrae(parrafosConOrigen(f.texto));
  }
  registro.requisitos = requisitos;

  // El plazo puede venir de la ficha de BDNS (fecha explícita), de un
  // requisito extraído de las Bases, o de ningún sitio. Si no viene, se queda
  // en null y la interfaz dice «Plazo no extraído»: un «15 días hábiles desde
  // la publicación» no es una fecha y no se calcula.
  registro.cierra = registro.cierra
    ?? requisitos.find((r) => r.tipo === 'fecha_limite')?.valor
    ?? null;
  registro.cerrada = registro.cierra ? new Date(registro.cierra) < new Date() : false;
  return registro;
}

// El pool va por tandas y no con un semáforo porque así el orden de salida
// es el mismo que el de entrada, y `data/becas.json` sale siempre igual con
// la misma entrada. Importa: el fichero se commitea dos veces al día y un
// diff que reordena las filas enteras cada vez no dice nada de qué ha cambiado.
const registros = [];
let fallidas = 0;
for (let i = 0; i < fichas.length; i += CONCURRENCIA) {
  const tanda = fichas.slice(i, i + CONCURRENCIA);
  const hechos = await Promise.all(tanda.map((f) =>
    procesar(f).catch((err) => {
      // Una ficha que revienta no puede tumbar la pasada entera: las otras
      // quinientas están bien y sirven igual.
      fallidas++;
      if (fallidas <= 5) {
        console.warn(`\n  ${f.id} falló (${err.message}); se publica sin requisitos.`);
      }
      return aRegistro(f, []);
    })));
  registros.push(...hechos);
  process.stdout.write(`\r  fichas ${Math.min(i + CONCURRENCIA, fichas.length)}/${fichas.length}   `);
}
process.stdout.write('\n');

/**
 * ── Lo que se publica, y lo que no ───────────────────────────────────────
 *
 * Antes esto era un filtro: «solo lo que traiga ficha de BDNS o requisitos
 * extraídos», y el resto se descartaba por ruido. Se quitó por dos razones
 * que conviene leer.
 *
 * La primera es de criterio: una convocatoria no es ruido porque el título no
 * encaje con lo que yo esperaba. Puede ser una beca de investigación, una
 * ayuda a una asociación o un programa raro, y quien la busca por su cuenta
 * sabe lo que busca. Filtrar por palabras del título es sustituir el criterio
 * del estudiante por el mío.
 *
 * La segunda es práctica: un filtro que se equivoca es invisible. Si quita de
 * más, quien busca no ve el hueco y no sabe que faltaba algo. Enseñar de más
 * cuesta un clic; quitar de más pierde la beca sin dejar rastro.
 *
 * Lo que sí se mantiene es el filtro de verdad —el del sumario, por epígrafe
 * y por título, que vive en `boe.mjs` y se cuenta por motivo en cada
 * pasada— y la etiqueta. Cada registro dice de dónde viene y qué se ha
 * podido sacar, para que nadie confunda una convocatoria completa con una de
 * la que solo tenemos el título.
 */

/** ¿La ficha trae algo que se pueda enseñar aparte del título? */
function conAlgoQueEnseñar(r) {
  return Boolean(r.requisitos.length || r.presupuesto != null || r.boeIdBases);
}

// Esto se añadió después de que pasara. Un `catch` que publica «sin
// requisitos» es lo correcto —una ficha rota no puede tirar la pasada— y a la
// vez es un peligro: el 17 de octubre de 2026 un `previvas is not defined`
// tumbó las 577 fichas y la pasada terminó con «652 publicadas · todos con
// cita: sí», que es exactamente lo que habría que leer si nada hubiera dicho
// nada. El bug era de una letra, pero el que de verdad costó caro fue que se
// viera como un resultado normal.
//
// Por eso el recuento va fuera y en grande. Si se cae una de cada diez fichas
// es una fuente caída y hay que enterarse; si se cae una de cada quinientas
// es ruido y no pasa nada.
if (fallidas) {
  const pct = ((fallidas / fichas.length) * 100).toFixed(1);
  console.warn(`  ${fallidas} fichas fallaron (${pct} %).`);
}
if (fallidas > fichas.length * 0.1 && fichas.length > 20) {
  console.warn('\n  Más del 10 % de las fichas ha fallado. Esto no es ruido:');
  console.warn('  revisa el log antes de fiarte de este becas.json.\n');
}


// Erasmus Mundus se suma al final. Es una fuente independiente y sin WAF,
// así que aunque el BOE o el BDNS fallen, el resultado no se queda a cero.
if (!process.argv.includes('--sin-erasmus')) {
  try {
    const em = await recolectarErasmus({ alProgresar: ({ pagina, total }) =>
      process.stdout.write(`\r  Erasmus Mundus · página ${pagina + 1} · ${total} programas   `) });
    process.stdout.write('\n');
    registros.push(...em);
  } catch (err) {
    console.warn(`  Erasmus Mundus falló (${err.message}); se sigue sin él.`);
  }
}

// ── Las fuentes de fuera de España ───────────────────────────────────────
//
// El BOE es el boletín del Estado: España. Y el producto promete «becas de
// Europa», así que sin más fuentes la promesa es falsa. Estas tres son las
// que se han podido montar sin clave y con datos citables:
//
//   - **Erasmus Mundus**: programas de máster de consorcios europeos. Ya
//     estaba, y ahora trae los países de cada consorcio.
//   - **DAAD**: el catálogo oficial de becas de Alemania. Es el país con
//     más programas de los que se pueden pedir en nombre propio.
//   - **La Comisión (SEDIA)**: las convocatorias de la UE que se piden en
//     nombre propio — MSCA, que son las de doctorado y postdoctorado.
//
// Las tres van **al final y aparte**, y cada una avisa por log si falla:
// una fuente caída no puede tumbar la pasada. Y ninguna entra si el
// fichero ya las tiene: el catálogo de DAAD y el de Erasmus son los
// mismos mañana, y volver a bajarlos dos veces al día es tirar ancho de
// banda a cambio de nada.
const fuentes = [
  {
    nombre: 'DAAD',
    flag: '--sin-daad',
    fn: recolectarDaad,
    esEstable: true,
  },
  {
    nombre: 'UE (SEDIA)',
    flag: '--sin-ue',
    fn: recolectarUe,
    esEstable: true,
  },
];

for (const fuente of fuentes) {
  if (process.argv.includes(fuente.flag)) continue;
  try {
    const antes = registros.length;
    const nuevos = await fuente.fn();
    registros.push(...nuevos);
    console.log(`  ${fuente.nombre}: ${nuevos.length} convocatorias`);
  } catch (err) {
    console.warn(`  ${fuente.nombre} falló (${err.message}); se sigue sin él.`);
  }
}

// ── No se descarta nada ─────────────────────────────────────────────────
//
// Había un filtro que publicaba solo lo que traía ficha de BDNS o requisitos
// extraídos, y descartaba el resto por «ruido». Se ha quitado, por dos
// razones que conviene leer.
//
// La primera es de criterio: una convocatoria no es ruido porque el título no
// encaje con lo que yo esperaba. Puede ser una beca de investigación, una
// ayuda a una asociación o un programa raro, y quien la busca por su cuenta
// sabe lo que busca. Filtrar por palabras del título es sustituir el criterio
// del estudiante por el mío.
//
// La segunda es práctica: un filtro que se equivoca es invisible. Si quita de
// más, quien busca no ve el hueco y no sabe que faltaba algo. Enseñar de más
// cuesta un clic; quitar de más pierde la beca sin dejar rastro.
//
// Lo que sí se mantiene es la etiqueta. Cada registro dice de dónde viene y
// qué se ha podido sacar, para que nadie confunde una convocatoria completa con
// una de la que solo tenemos el título.
// Estaba en el arrastre, y no podía funcionar: Erasmus se suma después de
// arrastrar, así que cuando se comprobaba si un identificador ya estaba visto
// todavía no se sabía nada de los 75 de Erasmus. El resultado eran 727 fichas
// con 75 repetidas dos veces, que en la web son dos tarjetas idénticas seguidas.
//
// ── El fichero ────────────────────────────────────────────────────────────
//
// Aquí es donde se decide qué se escribe, y es el punto donde el 19 de
// octubre de 2026 se perdió la base. Lo que hace falta está en
// `ingest/ensamblar.mjs`, que está fuera de aquí para poder probarlo: la
// regla se rompió una vez y se rompió en silencio.
//
// La regla, en una línea: todo anuncio que el BOE ha publicado en esta
// ventana y ha pasado el filtro tiene que estar en el fichero, o se acaba de
// descargar o sale de la caché. Lo que se salga de la ventana, fuera.
const { publicables, repetidas } = ensambla({ registros, omitidas, cache });
if (repetidas) {
  console.log(`  ${repetidas} fichas repetidas, eliminadas al escribir.`);
}

// ── El invariante ────────────────────────────────────────────────────────
//
// Ni una menos. Si el BOE ha dado N convocatorias en la ventana y en el
// fichero hay menos, se ha perdido alguna, y no se escribe: una base a la
// que se le caen fichas sin que nadie se entere es justo lo que vació la
// base el 19 de octubre de 2026, y se salvó porque el paso terminó en
// verde.
//
// El paso se para con un error y el fichero no se escribe. La web sigue
// sirviendo el último `becas.json` bueno, que es justo para lo que está.
const { esperadas, emitidas, faltan: perdidas } = faltan(publicables, { fichas, omitidas });
if (perdidas) {
  console.error(`\n  FALTAN FICHAS: el BOE ha dado ${esperadas} convocatorias en la ventana y en el fichero hay ${emitidas}.`);
  console.error('  No se escribe data/becas.json. Revisa el log antes de fiarte de la pasada.\n');
  process.exit(1);
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../data/becas.json', import.meta.url),
  JSON.stringify({ generado: new Date().toISOString(), rango: { desde, hasta }, becas: publicables }, null, 1),
);

const conReq = publicables.filter((r) => r.requisitos.length > 0).length;
const totalReq = publicables.reduce((n, r) => n + r.requisitos.length, 0);
const conCita = publicables.every((r) => r.requisitos.every((x) => Boolean(x.cita)));

console.log(`\n  ${publicables.length} publicadas · ${esperadas} del BOE + ${publicables.length - esperadas} de Erasmus`);
console.log(`  ${conReq} con requisitos · ${totalReq} requisitos en total`);
console.log(`  ${publicables.filter((r) => conAlgoQueEnseñar(r)).length} con algo que enseñar aparte del título`);
console.log(`  ${publicables.filter((r) => r.boeIdBases).length} con Bases localizadas en el BOE`);
console.log(`  ${reutilizadas} reutilizadas de la pasada anterior`);
console.log(`  todos con cita: ${conCita ? 'sí' : 'NO — revisar'}`);
console.log(`\n  → data/becas.json\n`);