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
import { idDesdeBoe, render, aRegistro as aRegistroBdns } from './bdns.mjs';
import { recolectar as recolectarErasmus } from './erasmus.mjs';
import { parrafosConOrigen, extrae } from './extract.mjs';

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
    url: ficha.url,
    eli: ficha.eli,
    // Los requisitos sin cita no entran. Ver AGENTS.md.
    requisitos: requisitos.filter((r) => r.cita),
    texto_len: ficha.texto.length,
    // El texto entero no viaja al front: pesa y no se muestra.
  };
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
 * El id del anuncio del BOE del que salió un registro guardado.
 *
 * Las fichas nuevas lo traen en `boeIdAnuncio`. Las antiguas solo lo tienen
 * dentro de `url` (`…txt.php?id=BOE-B-2026-…`), porque al enriquecer con BDNS
 * el `id` del registro se renombró a `BDNS-…` y el id del anuncio dejó de
 * estar suelto. Sin las dos vías la caché no acierta con nada de lo ya
 * publicado: `boeIdBases` es el id del documento de **Bases** (BOE-A-…), que
 * no es el anuncio que recorre el sumario (BOE-B-…).
 */
function idAnuncio(b) {
  return b.boeIdAnuncio
    ?? /boe\.es\/diario_boe\/txt\.php\?id=([^&\s]+)/.exec(b.url ?? '')?.[1]
    ?? b.id;
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

const { fichas } = await recolectar(desde, hasta, {
  concurrencia: CONCURRENCIA,
  omitir: new Set(cache.keys()),
  alProgresar: ({ fase, avance, total, dia, saltados: s }) => {
    if (fase === 'indice') process.stdout.write(`\r  ${dia}  `);
    else if (fase === 'cache') reutilizadas = s;
    else process.stdout.write(`\r  texto ${avance}/${total} días · ${s ?? 0} ya en caché   `);
  },
});
process.stdout.write('\n');

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
 * Filtra qué registros se publican y cuántas fichas se descartan por motivo,
 * para que el descarte no sea invisible.
 *
 * ── Por qué aquí y no al recolectar ───────────────────────────────────────
 *
 * `esBeca()` descarta por el título y el epígrafe del sumario, pero hay
 * anuncios que pasan ese filtro y no son becas: el epígrafe es solo una pista
 * y el título de un extracto de BDNS no siempre dice «beca» («ayudas»,
 * «subvención» del Servicio de Títulos…). La certeza última es el texto
 * descargado: si extraer requisitos no saca nada y no hay ficha de BDNS ni
 * Bases localizadas, el documento no convoca a nadie a pedir dinero y no se
 * publica.
 *
 * ── Qué se publica ────────────────────────────────────────────────────────
 *
 * Solo se publica lo que tiene requisitos con cita, o ficha de BDNS, o
 * presupuesto, o Bases localizadas. El resto se descarta del fichero:
 * es un anuncio del BOE revisado y descartado, no una beca que enseñar.
 */
function motivoDescartado(r) {
  const t = String(r?.titulo ?? '').toLowerCase();
  if (!r.esEducacion) return 'no es materia de educacion';
  if (/jubilaci|nombramiento|\bcese\b|proceso selectiv|oposici|provisi[oó]n de puesto|subasta|informaci[oó]n p[uú]blica|convenio|correcci[oó]n de errores/i.test(t)) return 'no es convocatoria';
  return 'sin requisitos ni ficha';
}

function publicable(r) {
  if (r.requisitos.length > 0) return true;
  if (r.boeIdBases) return true;      // las Bases estan en el BOE, se pueden leer
  if (String(r.id).startsWith('BDNS')) return true;   // hay ficha oficial de BDNS
  if (r.presupuesto != null) return true;   // BDNS relleno el presupuesto
  return false;
}

let publicadas = 0;
const descartadas = new Map();
for (const r of registros) {
  if (publicable(r)) { publicadas++; continue; }
  const m = motivoDescartado(r);
  descartadas.set(m, (descartadas.get(m) || 0) + 1);
}

process.stdout.write(`  ${publicadas} publicables · ${registros.length - publicadas} descartadas   `);
for (const [m, n] of descartadas) process.stdout.write(`[${m}: ${n}] `);
process.stdout.write('\n');

/**
 * Lo que ya estaba guardado y no ha aparecido en esta ventana se arrastra.
 *
 * Esto es lo que convierte `--dias` en algo que no hay que tocar a diario. Sin
 * esto, `data/becas.json` contendría solo lo publicado en las últimas tres
 * semanas, y ampliar la ventana a seis meses sería una tarea que habría que
 * repetir cada día para no perder nada. Con esto el fichero es un archivo que
 * crece: la ventana de 21 días solo decide qué se mira hoy, no qué sobrevive.
 *
 * Y de paso es lo que hace posible la pasada de seis meses: al arrastrar lo
 * viejo, una única pasada profunda rellena el archivo entero y las siguientes
 * solo traen lo nuevo.
 */
const vistos = new Set(registros.map(idAnuncio));
let arrastradas = 0;
for (const [clave, registro] of cache) {
  if (vistos.has(clave)) continue;
  // La condición por `id` es la que evita el duplicado de Erasmus. Su clave de
  // caché es `EMJM-1-…` y coincide con su `id`, así que el `vistos` de arriba
  // no la pilla y el programa arrastraba las 75 del catálogo anterior… y el
  // conector las bajaba otra vez. Resultado: 727 fichas con 75 repetidas dos
  // veces. En la lista de la web eso son dos fichas idénticas seguidas.
  if (vistos.has(registro.id)) continue;
  if (!publicable(registro)) continue;   // el filtro de publicación también limpia lo arrastrado
  vistos.add(registro.id);
  registros.push(registro);
  arrastradas++;
}
if (arrastradas) {
  console.log(`  ${arrastradas} fichas de pasadas anteriores fuera de la ventana, arrastradas.`);
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
// Aquí ya están todas las fuentes, así que esta comprobación las pilla a
// todas. Y donde se hace es el sitio donde tiene que estar de verdad: añadir una
// fuente nueva no debería poder volver a colar duplicados.
const unicos = new Map();
let repetidas = 0;
for (const r of registros) {
  // Se queda la última: si una fuente y la caché dicen lo mismo, la recién
  // bajada es la buena.
  if (unicos.has(r.id)) repetidas++;
  unicos.set(r.id, r);
}
const publicables = [...unicos.values()];
if (repetidas) {
  console.log(`  ${repetidas} fichas repetidas, eliminadas al escribir.`);
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../data/becas.json', import.meta.url),
  JSON.stringify({ generado: new Date().toISOString(), rango: { desde, hasta }, becas: publicables }, null, 1),
);

const conReq = publicables.filter((r) => r.requisitos.length > 0).length;
const totalReq = publicables.reduce((n, r) => n + r.requisitos.length, 0);
const conCita = publicables.every((r) => r.requisitos.every((x) => Boolean(x.cita)));

console.log(`\n  ${publicables.length} publicadas · ${registros.length - publicables.length} descartadas`);
console.log(`  ${conReq} con requisitos · ${totalReq} requisitos en total`);
console.log(`  ${publicables.filter((r) => r.boeIdBases).length} con Bases localizadas en el BOE`);
console.log(`  ${reutilizadas} reutilizadas de la pasada anterior`);
console.log(`  todos con cita: ${conCita ? 'sí' : 'NO — revisar'}`);
console.log(`\n  → data/becas.json\n`);