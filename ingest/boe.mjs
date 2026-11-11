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

/**
 * Quita tildes y pasa a minúsculas.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * Los patrones de este fichero se escriben sin tilde —`calificacion`,
 * `retribucion`— porque en un archivo de código la tilde dentro de una
 * expresión regular es un`的` que se lee regular y se escribe regular. El BOE,
 * en cambio, escribe «calificación», «retribución» y «expediente».
 *
 * El resultado era un filtro con agujeros: la lista de ruido apartaba
 * «calificación» con la patrón `calificacion`… que no matchea con la tilde, y
 * por eso una resolución de un recurso contra la nota de calificación entró en
 * la base como si fuera una beca. El 11 de noviembre de 2026 lo Complainió
 * quien usa la web: «en vez de becas hay leyes».
 *
 * Normalizar **las dos partes** —el título y el patrón— resuelve el problema
 * sin tener que escribir cada patrón con su `[óo]`: `[óo]` se convierte en
 * `[oo]`, que sigue funcionando, y `calificacion` pasa a comparar con
 * `calificacion`.
 */
function plano(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Precompila una lista de expresiones regulares contra el texto normalizado.
 *
 * Se hace una vez al cargar el módulo: si no, cada anuncio normalizaría los
 * mismos patrones, y una pasada de tres semanas son miles de anuncios.
 */
function planas(lista) {
  return lista.map((re) => new RegExp(plano(re.source), re.flags.replace(/g/g, '')));
}


/** Materias del BOE que Concentran becas y ayudas al estudio. */
const MATERIAS_EDUCACION = [
  'educación', 'educacion', 'enseñanza universitaria', 'enseñanza no universitaria',
  'universidad', 'universidades', 'investigación', 'becas', 'ayudas al estudio',
  'exchanges', 'erasmus', 'juventud',
];

/**
 * Palabras que delatan una convocatoria de ayudas en el título.
 *
 * Están en minúsculas y se buscan con `includes` sobre el título en minúsculas,
 * no como expresión regular: el BOE escribe «BECAS», «Becas» y «becas» en el
 * mismo día, y escapar cada variante en un patrón es una fuente de fallos
 * silenciosos que no vale la pena.
 *
 * ── Por qué esta lista es más corta que la del 18 de octubre de 2026 ──────
 *
 * Antes llevaba «estancia», «movilidad», «prácticas», «intercambio» y
 * «beneficiari». Cada una de esas palabras matchea en un documento que no
 * convoca a nadie:
 *
 * - «movilidad» está en «Ministerio de Transportes y **Movilidad** Sostenible»,
 *   que aparece en el título de casi todas sus resoluciones.
 * - «estancia» está dentro de «const**ancia**», que sale en cualquier texto
 *   que hable de un acuerdo anterior.
 * - «prácticas» matchea con cualquier «prácticas de empresa» o «prácticas
 *   de empresa» de un acuerdo delgado.
 * - «beneficiari» matchea con la palabra que aparece en la *resolución* de un
 *   premio, donde ya se han elegido los beneficiarios.
 *
 * Con esas palabras dentro, el filtro dejaba pasar el «Real Decreto … por el
 * que se regula la concesión directa de subvenciones en materia de vivienda»
 * y media docena de(layeretes. La lista se ha quedado con lo que de verdad
 * nombra dinero para el destinatario, y el resto de la decisión la toma
 * `CONVOCA`.
 */
const PALABRAS_BECA = [
  'beca', 'becas', 'becario', 'becaria', 'bolsa de', 'bolsas de estudio',
  'ayuda al estudio', 'ayudas al estudio', 'ayudas para estudiar',
  'subvenci', 'dotaci', 'premio', 'erasmus',
];

/**
 * Lo que se reparte, y lo que significa «estás llamando a alguien».
 *
 * ── Por qué van en dos listas y no en una ─────────────────────────────────
 *
 * La palabra «convocatoria» no significa «convocatoria de dinero». El BOE la
 * usa para todo: la convocatoria de una ayuda y la convocatoria de una junta
 * de regantes son la misma palabra en el mismo boletín. Lo que las
 * distingue no es el verbo, es el objeto: a quién o a qué se llama.
 *
 * Y el objeto importa porque el ruido de este boletín es enorme: de cada
 * veinte anuncios que trae el sumario, uno es una ayuda y los otros diecinueve
 * son Confederaciones Hidrográficas, subastas y juntas de regantes. La
 * «convocatoria de Junta General ordinaria» de una Comunidad de Regantes salió
 * en la lista como beca con el filtro del 18 de octubre de 2026, y no tiene
 * nada que ver con estudiar.
 *
 * Por eso la señal de convocatoria solo cuenta si va **cerca de una palabra
 * de dinero**. «Se convocan ayudas» ✓. «Convocatoria de Junta» ✗.
 */
const DINERO = 'becas?|becarios?|becarias?|bolsas? de (?:estudio|investigaci[óo]n)|ayudas?|subvenciones?|premios?|dotaciones?';

/**
 * Las palabras de llamada, y lo que **ya no** está aquí.
 *
 * ── Por qué «bases reguladoras» salió ──────────────────────────────────────
 *
 * Estaba, y metía en la base las normas que no convocan a nadie. El caso que
 * más se complained: «Orden JUI/1097/2026 … por la que se establecen las bases
 * reguladoras para la concesión de subvenciones para el mantenimiento de
 * asociaciones juveniles». Eso es una norma: la convocatoria sale otro día, en
 * otro documento. Y como el epígrafe del BOE es «Subvenciones», entraba como
 * si fuera una convocatoria. Lo mismo con «Orden DCA/1079/2026 … bases
 * reguladoras para la concesión de subvenciones a entidades locales» y con
 * «Orden APA/1111/2026 … por la que se modifica la Orden AAA/839/2015 … por la
 * que se establecen las bases reguladoras de la concesión de Premios de
 * Excelencia a la Innovación para Mujeres Rurales»: tres normas, cero
 * convocatorias.
 *
 * «Bases reguladoras» es la forma que tiene una convocatoria **de nombrar las
 * bases**, no la de **convocar**. Con ella sola no se llama a nadie. Para que
 * un documento sea una convocatoria hace falta que el título diga que convoca:
 * «convocatoria», «se convocan», «plazo de presentación».
 *
 * La norma que sí es convocatoria —«se aprueban las bases reguladoras **y la
 * convocatoria**»— entra por la palabra «convocatoria», que sigue aquí.
 *
 * Lo que se conserva es la excepción de `motivoDescarte`: una norma con
 * epígrafe «Becas» o «Ayudas» y con «beca» o «bolsa de estudio» en el título
 * se queda, porque ahí la norma y la convocatoria son la misma frase.
 */
const LLAMADA = 'se convocan?|se procede a la convocatoria|convocatorias?|convocan|se abre el plazo|plazo de presentaci[óo]n|presentar solicitudes?';

/**
 * Las mismas palabras de llamada, sin exigir que haya dinero cerca.
 *
 * Sirve para la excepción: un documento que dice «se conceden» no es una
 * convocatoria, **salvo que también diga que convoca**. Y para eso no hace
 * falta que la palabra de dinero esté al lado: con que aparezca una llamada
 * en el título, el documento está llamando a alguien.
 */
const LLAMADA_SOLA = planas([new RegExp(LLAMADA, 'i')])[0];

/**
 * El verbo de la decisión ya tomada.
 *
 * ── Por qué esto no es un juicio sobre la beca ───────────────────────────
 *
 * «Se conceden los Premios Nacionales de Investigación» no es una beca mala:
 * es un documento que **da fe de un premio que ya se ha entregado**. La
 * convocatoria de esos premios se publicó otro día, y ese día también salió
 * aquí.
 *
 * Esto no decide si una beca es buena o mala. Decide si el documento delante
 * está llamando a alguien o si ya está todo resuelto, y es la misma pregunta
 * que ya hace el veto de los nombramientos y las ceses. La diferencia entre
 * un premio y una beca nunca se juzga: lo que se mira es el verbo.
 */
const DECIDE = planas([/\bse (concede|conceden|otorgan|otorgan|concedido|otorgado|adjudica|adjudican|adjudicado)\b/i])[0];

/**
 * La forma que tiene una convocatoria de dinero en el título del BOE.
 *
 * Se construye con dos direcciones —llamada antes de dinero, o dinero antes
 * de llamada— porque el BOE las usa las dos: «por la que se convocan las
 * ayudas» y «ayudas para el incentivo a la lectura: convocatoria 2026».
 *
 * La ventana son 110 caracteres, que es aproximadamente una línea de título
 * del BOE. Se cruzan los puntos, no las frases: la llamada y el dinero tienen
 * que estar en la misma proposición, no en el mismo documento.
 */
const CONVOCA = planas([new RegExp(
  `(?:${LLAMADA})(?=.{0,110}?(?:${DINERO}))` +
  `|(?:${DINERO})(?=.{0,110}?(?:${LLAMADA}))`,
  'is',
)])[0];

/**
 * Los epígrafes del BOE que son una convocatoria de dinero para estudiantes.
 *
 * Son los dos que el propio boletín usa para las becas y las ayudas al
 * estudio. Sirven para la excepción del veto de las normas: si el BOE dice que
 * esto es una beca y el título lo nombra, es una beca aunque el verbo sea
 * «se establecen las bases reguladoras».
 */
const EPIGRAFES_BECA = planas([/^(becas?|ayudas?|bolsas?)\b/i])[0];

/**
 * Las palabras del título que hablan de una beca de estudiante.
 *
 * Van aparte de `PALABRAS_BECA` porque estas son las que, junto con el
 * epígrafe, salvan una norma de una beca real. «Subvención» no entra: hay
 * demasiadas subvenciones que no son de estudio.
 */
const PALABRAS_BECA_ESTUDIANTE = [
  'beca', 'becas', 'becario', 'becaria', 'bolsa de', 'bolsas de',
  'ayuda al estudio', 'ayudas al estudio', 'ayudas para estudiar',
  'ayuda para estudiar', 'erasmus',
];

/**
 * Epígrafes con los que el propio BOE clasifica una convocatoria de dinero.
 *
 * ── Por qué se usa la clasificación del BOE y no la nuestra ───────────────
 *
 * El sumario agrupa cada anuncio bajo un `epigrafe` que pone el propio
 * boletín: «Becas», «Ayudas», «Subvenciones», «Premios». Eso es un dato de la
 * fuente, no una interpretación nuestra, así que un anuncio bajo «Becas» es
 * una beca por definición del boletín, y ahí no hay manera de equivocarse.
 *
 * El epígrafe se pierde hoy en `aplanar()`, que no arrastra el contexto del
 * departamento y del epígrafe hasta el anuncio. Se arrastra a propósito: es la
 * señal más fiable que da el sumario y la única que no depende de interpretar
 * un título.
 */
const EPIGRAFES_CONVOCATORIA = planas([/^(becas?|ayudas?|subvenciones?|premios?|dotaciones?|estancias?|movilidad|pr[aá]cticas?)\b/i])[0];

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
 *
 * `ctx` arrastra el nombre del departamento y del epígrafe que envuelven al
 * anuncio. No es decorativo: el epígrafe es la clasificación que hace el
 * propio BOE («Becas», «Ayudas», «Subvenciones» frente a «Nombramientos»,
 * «Destinos», «Subvenciones»), y `textoCompleto` no la puede reconstruir
 * después porque el XML del documento no la trae. Si se pierde aquí, se
 * pierde para siempre y solo queda el título, que es lo que metía las
 * noticias como si fueran becas.
 */
function aplanar(nodo, ctx = {}, acc = []) {
  if (nodo == null) return acc;
  if (Array.isArray(nodo)) {
    nodo.forEach((x) => aplanar(x, ctx, acc));
    return acc;
  }
  if (typeof nodo !== 'object') return acc;
  if (nodo.identificador && nodo.titulo) {
    // `url_xml` llega como cadena, pero algunas respuestas lo anidan en un
    // objeto `{texto: «…»}`. Con `nodo.url_xml ?? nodo.url_xml?.texto` el `??`
    // nunca llegaba al segundo término —el primero ya era truthy— y a `fetch`
    // se le pasaba el objeto, que lo convierte en «[object Object]»: el
    // anuncio se perdía en silencio y, con la caché puesta, no volvía nunca.
    const urlXml = typeof nodo.url_xml === 'object' && nodo.url_xml !== null
      ? nodo.url_xml.texto
      : nodo.url_xml;
    acc.push({
      id: nodo.identificador,
      titulo: String(nodo.titulo).replace(/\s+/g, ' ').trim(),
      urlXml: urlXml ?? `${TEXTO}?id=${nodo.identificador}`,
      urlHtml: nodo.url_html ?? '',
      seccion: nodo.seccion ?? '',
      epigrafe: ctx.epigrafe ?? null,
      departamento: ctx.departamento ?? null,
    });
    return acc;
  }

  for (const [clave, v] of Object.entries(nodo)) {
    if (clave === 'epigrafe') {
      const eps = Array.isArray(v) ? v : [v];
      for (const e of eps) {
        if (typeof e === 'string') continue;   // epígrafe suelto, sin items
        aplanar(e, { ...ctx, epigrafe: e.nombre ?? ctx.epigrafe }, acc);
      }
    } else if (clave === 'departamento') {
      const deps = Array.isArray(v) ? v : [v];
      for (const d of deps) {
        if (typeof d === 'string') continue;
        aplanar(d, { ...ctx, departamento: d.nombre ?? ctx.departamento, epigrafe: null }, acc);
      }
    } else {
      aplanar(v, ctx, acc);
    }
  }
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
 * Lo que el BOE publica con el mismo formato que una convocatoria y no lo es.
 *
 * ── El bug que arregla esta lista ────────────────────────────────────────
 *
 * Hasta el 18 de octubre de 2026 la ingesta publicaba TODO lo que traía el
 * sumario: de 2.626 fichas, 209 tenían requisitos y 19 enlazaban con una ficha
 * de BDNS. El resto eran noticias administrativas —jubilaciones, nombramientos,
 * ceses, destinos, concursos para proveer plazas, subastas de Hacienda,
 * información pública de confederaciones hidrográficas, planes de estudios— que
 * salían en la web como si fueran becas. El caso que lo enseñó: «Anuncio del
 * Servicio de Títulos, Becas y Ayudas al Estudiante … sobre extravío de
 * título», donde «Becas» está en el nombre de la oficina y no en lo que el
 * documento hace.
 *
 * El error no fue dejar de filtrar por la palabra «beca», fue dejar de filtrar
 * del todo. Estas expresiones no buscan becas: descartan documentos que
 * **dan fe de algo ya ocurrido** (un nombramiento, una adjudicación) o que
 * **regulan** (un reglamento, un plan de estudios), y ninguno de esos convoca
 * a nadie a pedir dinero. Es un filtro por lo que el documento *es*, no por lo
 * que dice su título sobre becas.
 *
 * Se aplica ANTES de bajar el texto, que es una petición por anuncio: descartar
 * aquí es lo que hace que una pasada de seis meses quepa en el job.
 */
const RUIDO = planas([
  // Personal y carrera: el documento da fe de un nombramiento, un cese o un
  // destino, no convoca a nadie.
  /jubilaci[óo]n/i,
  /\bceses?\b|se dispone el cese/i,
  /se nombra|nombramientos?/i,
  /se destina|otorga destino|\bdestinos\b|adscripci[óo]n/i,
  /provisi[óo]n de (puesto|plaza)|a proveer|para proveer|libre designaci[óo]n/i,
  /proceso selectiv|oposici[óo]n|concurso-oposici|pruebas? (selectiv|de acceso|de aptitud)|concurso de (traslados?|m[eé]ritos|acceso)|concurso (general|espec[ií]fico)/i,
  /personal (funcionario|laboral|estatutario|docente)|cuerpos? de|escala de|carrera (judicial|profesional)/i,
  /tribunal|jurado|admitid|excluid|aspirantes|calificacion/i,
  /excedencia|reingreso|retribucion|escalaf[oó]n|servicios m[ií]nimos/i,

  // Anuncios y avisos que no convocan: notificaciones, licitaciones, subastas,
  // información pública, expropiaciones.
  /notificaci|notifica(r|ndo|do)?\b|emplazamiento|citaci[óo]n|requerimiento|subsanaci|edicto|extrav[ií]o/i,
  /subasta|licitaci|formalizaci[óo]n|adjudicaci[óo]n (del contrato|definitiva)|contrato de|concesi[óo]n (administrativa|de obra|dem)/i,
  /informaci[óo]n p[uú]blica|declaraci[óo]n de (impacto|utilidad|inter[eé]s)|expropiaci[óo]n/i,

  // Normas, acuerdos y estructura: regulan, no convocan.
  /convenio|acuerdo|protocolo|encomienda|delegaci[óo]n de competencias/i,
  /correcci[óo]n de errores/i,
  /plan de estudios|reglamento|estatutos|calendario|horario|normas? de/i,
  /condecoraci|t[ií]tulos nobiliarios|indulto|gran cruz|collar de la orden/i,
  /inconstitucionalidad|conflicto (positivo|de competencia)|fiscalizaci[óo]n/i,
  /carta de servicios|delegaci[óo]n de firmas|estructura org[aá]nica/i,

  // ── Lo que faltaba: las leyes y los decretos que conceden por su cuenta ──
  //
  // Una ley no convoca a nadie: dice lo que va a pasar. Y un «Real Decreto …
  // por el que se regula la concesión directa de una subvención al Obispado
  // de …» reparte el dinero sin que haya convocatoria, porque no hay a quién
  // ).
  //
  // «Ley del Principado de Asturias 6/2026, de 10 de septiembre, de
  // modificación de la Ley 3/2021, de 30 de junio …» salió en la lista como
  // beca el 18 de octubre de 2026. Es exactamente el caso del que se quejó
  // el usuario: «salen noticias o leyes y aparecen como becas».
  //
  // El patrón es «^ley», no «ley»: una convocatoria de verdad puede citar la
  // ley que la habilita («ayudas al amparo de la Ley 8/2025»), y vetar eso
  // sería tirar una beca de verdad.
  /^ley\b/i,
  /^leyes\b/i,
  /decreto-ley/i,
  // Concesión directa: la administración decide a quién se le da el dinero.
  // No hay plazo, no hay solicitud, no hay candidata.
  /concesi[óo]n directa/i,
  // El gasto que se autoriza, que es como el BOE titula los de correos y los
  // que se paga a un tercero. No es una convocatoria de nada.
  /se autoriza el gasto|sellos de correo/i,
  // «Se hace público»: el BOE publica el resultado de algo que ya está
  // hecho —una concesión de puerto, un acuerdo, un pliego— y lo publica para
  // que se pueda recurrir. No está llamando a nadie.
  /se hace p[uú]blico/i,
  // El mismo caso, escrito de otra manera: «Anuncio de la Comisaría de Aguas
  // de la Confederación Hidrográfica del Ebro sobre la resolución del
  // expediente de concesión de aguas». El expediente está resuelto y lo que
  // se publica es el resultado. Con el epígrafe «Ayudas» que le pone el
  // BOE, esto se colaba.
  /resoluci[óo]n del expediente/i,
  // Un procedimiento que ha quedado desierto: no se ha concedido nada.
  /desiert[oa]/i,
  // El otorgamiento de una concesión, que es un acto administrativo ya hecho.
  /otorgamiento/i,

  // ── Lo que se complained el 11 de noviembre de 2026: «leyes» en vez de becas ──
  //
  // Los cuatro casos que se vieron en la base y que son normas o resultados,
  // no convocatorias. Salieron con epígrafe «Subvenciones» o «Premios», que
  // es la clasificación del tema, no de la clase de documento.
  //
  // 1. «Resolución … por la que se publican las subvenciones estatales anuales
  //    para atender los gastos de funcionamiento ordinario a las diferentes
  //    formaciones políticas…». Se publica lo que ya se ha repartido: no hay
  //    a quién presentarse.
  /\bse publica(n|dos|das)\b/i,
  // 2. «Orden HAC/1062/2026 … por la que se fijan las cantidades de las
  //    subvenciones a los gastos originados por actividades electorales…». Se
  //    fija una cantidad, no se llama a nadie. La ventanilla de dinero en la
  //    misma frase es la que hace la diferencia con una convocatoria que
  //    también habla de cantidades.
  /\bse (fijan|determinan|distribuyen|asignan|consignan|reparten)\b(?=.{0,90}?(cantidades|cuotas|importes?|presupuestos?|subvenciones?))/i,
  // 3. «Resolución … en el recurso interpuesto contra la nota de calificación
  //    emitida por el registrador… no procede …». Es una sentencia: el
  //    «calificación» no se leía antes porque el patrón no llevaba tilde.
  /\brecurso (interpuesto|contra)\b/i,
  /\bimpugna/i,
  /\bno procede\b/i,
  // 4. «Orden … por la que se deroga la Orden …». Derogar no es convocar.
  /\bse deroga(n)?\b/i,
  // Crear un plan o un programa es legislar, no convocar.
  /\bse crea(n)?\b(?=.{0,60}?\b(plan|programa)\b)/i,
]);

/**
 * Documentos que fijan una norma en vez de convocar a alguien.
 *
 * Va aparte de `RUIDO` por una razón concreta: «Resolución … por la que se
 * modifica la convocatoria de ayudas» es una convocatoria modificada, y vetarla
 * sería tirar una beca de verdad. En cuanto el título dice que convoca, deja
 * de ser una norma.
 *
 * ── Y lo que sí se veta, desde el 11 de noviembre de 2026 ─────────────────
 *
 * Antes, una norma pasaba siempre que el título tuviera «bases reguladoras»
 * al lado de una palabra de dinero. Eso metía en la base tres normas seguidas
 * («Orden JUI/1097/2026», «Orden DCA/1079/2026» y «Orden APA/1111/2026»):
 * las tres son «se establecen las bases reguladoras para la concesión de
 * subvenciones…» y ninguna convoca a nadie.
 *
 * Ahora una norma solo pasa si el título dice que convoca de verdad —«se
 * convocan», «convocatoria», «plazo de presentación»— o si el BOE la clasifica
 * como beca o ayuda y el título nombra la beca. Ese es el criterio: una norma
 * que además es convocatoria es una convocatoria; una norma que solo es norma,
 * no.
 */
const REGULA = planas([/\bse (regula|regulan|modifica|modifican|establece|establecen|inscribe|inscriben|aprueba|aprueban)\b/i])[0];

/**
 * ¿Es este anuncio una convocatoria de becas, ayudas o subvenciones?
 *
 * ── Por qué allowlist y no solo blocklist ────────────────────────────────
 *
 * Una blocklist sola deja pasar todo lo que no se le ocurrió a quien la
 * escribió, y el BOE publica cientos de formas distintas de decir «esto no es
 * una beca». Por eso el filtro pide una **señal positiva** para publicar, y
 * usa el departamento y el epígrafe del sumario además del título. La parte de
 * blocklist sigue ahí, delante, porque hay títulos que dan la señal positiva
 * de rebote: el extravío de títulos de un «Servicio de Becas» la da, y no es
 * una beca.
 *
 * ── Lo que este filtro NO decide ─────────────────────────────────────────
 *
 * No decide si la ayuda es para un estudiante o para una empresa: eso está en
 * el texto y se enseña con su cita. Aquí solo se separa lo que convoca de lo
 * que no. Quien busca una subvención para su asociación también es bienvenido.
 *
 * ── El riesgo, dicho claro ───────────────────────────────────────────────
 *
 * Un filtro que se equivoca es invisible: si se cae una beca real, quien la
 * buscaba no ve el hueco. Por eso el epígrafe (que lo pone el BOE, no
 * nosotros) va primero, la lista de palabras positivas es ancha, y el
 * orquestador **cuenta y enseña lo descartado por motivo** en cada pasada. Un
 * descarte con volumen raro se ve en el log y se revisa; un descarte mudo, no.
 */
/**
 * Por qué este anuncio NO es una convocatoria. `null` si lo es.
 *
 * ── Por qué el motivo va aquí y no solo el sí o el no ─────────────────────
 *
 * `esBeca` devuelve un booleano y con eso no se puede revisar nada: si una
 * pasada deja 2.488 anuncios fuera, no hay forma de saber si eran noticias
 * administrativas —que es lo que tienen que ser— o si el filtro se comió
 * media docena de becas de verdad. El descarte con motivo se ve en el log y
 * se revisa; el descarte mudo no.
 *
 * Los dos motivos se distinguen a propósito:
 *
 *   · `ruido` — el título dice que el documento da fe de algo ya ocurrido o
 *     que regula. No es una duda sobre el filtro: es una categoría.
 *   · `sin señal` — el título no dice ni que es una convocatoria ni que no
 *     es. Aquí el filtro está opinando, y es donde hay que mirar.
 */
export function motivoDescarte(anuncio) {
  const t = plano(anuncio?.titulo ?? '');
  const ep = plano(anuncio?.epigrafe ?? '');

  // ── 1. El veto, PRIMERO ────────────────────────────────────────────────
  //
  // El orden importa y estaba al revés. Antes el epígrafe se miraba antes que
  // la lista de ruido, así que un documento bajo el epígrafe «Premios» o
  // «Subvenciones» se colaba siempre, ruido o no:
  //
  //   «Orden CLT/1014/2026 … por la que se designa el jurado para la concesión
  //    del Premio de Literatura en …» —epígrafe «Premios»— y no es una
  //    convocatoria: se designa el jurado de un premio que ya está fallado.
  //
  //   «Real Decreto 762/2026 … por el que se regula la concesión directa de
  //    una subvención al Obispado de …» —epígrafe «Subvenciones»— y tampoco:
  //    el dinero ya está repartido, no hay a nadie que se postule.
  //
  // El epígrafe del BOE dice de qué tema va el documento, no de qué clase es.
  // La lista de ruido dice de qué clase es. Cuando las dos se contradicen, la
  // que describe el documento gana.
  if (RUIDO.some((r) => r.test(t))) return 'ruido';

  // Norma y no convocatoria, salvo que el título diga que convoca.
  //
  // Aquí lo que cuenta es la **llamada**, no la cercanía con una palabra de
  // dinero: «Resolución … por la que se aprueba la convocatoria para el año
  // 2026 del Programa …» es una convocatoria aunque la palabra «subvención» no
  // aparezca en los 110 caracteres siguientes. Y «Orden … por la que se
  // aprueban las bases reguladoras y la convocatoria para la selección de
  // operaciones …» también.
  //
  // Y con una excepción más, que es la que hace falta para no perder becas de
  // verdad: si el BOE clasifica el documento como «Becas» o «Ayudas» —su
  // epígrafe, que es dato de la fuente— y el título nombra la beca, es una
  // convocatoria aunque el verbo sea «se establecen las bases reguladoras».
  // Las bases de las becas de estudio son una norma y una convocatoria en la
  // misma frase, y sin esta excepción se perdían.
  if (REGULA.test(t) && !LLAMADA_SOLA.test(t)) {
    const esBecaDeEstudiante = EPIGRAFES_BECA.test(ep)
      && PALABRAS_BECA_ESTUDIANTE.some((p) => t.includes(p));
    if (!esBecaDeEstudiante) return 'ruido';
  }

  // Decisión ya tomada y no convocatoria, salvo que el título diga que convoca.
  // «Se conceden los Premios Nacionales de Investigación» da fe de un premio
  // ya entregado; la convocatoria de esos premios se publicó otro día.
  if (DECIDE.test(t) && !LLAMADA_SOLA.test(t)) return 'ruido';

  // ── 2. Señal positiva del BOE ───────────────────────────────────────────
  //
  // El BOE ya lo clasificó como convocatoria de dinero: manda su criterio.
  if (EPIGRAFES_CONVOCATORIA.test(ep)) return null;

  // ── 3. Señal positiva del título ───────────────────────────────────────
  //
  // «se convocan», «convocatoria», «bases reguladoras»: la forma que tiene
  // una convocatoria en el BOE, que es media de los extractos.
  if (CONVOCA.test(t)) return null;

  // Y las palabras que nombran el dinero: beca, bolsa de estudio, subvención.
  if (PALABRAS_BECA.some((p) => t.includes(p))) return null;

  return 'sin señal de convocatoria';
}

/** ¿Es este anuncio una convocatoria de becas, ayudas o subvenciones? */
export function esBeca(anuncio) {
  return motivoDescarte(anuncio) === null;
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
 *
 * ── Lo que devuelve, y por qué importa ────────────────────────────────────
 *
 * `omitidas` son los anuncios que la caché perdonó: están en la ventana, han
 * pasado el filtro y **no se han vuelto a bajar**. No vienen en `fichas`, así
 * que quien escribe el fichero tiene que sacarlos de la caché. Si no, se
 * pierden: el 19 de octubre de 2026 la base pasó de 2.626 fichas a 76 porque
 * el conector se saltó 62 anuncios y nadie los volvió a poner.
 *
 * `descartes` son los anuncios que no pasaron el filtro, con su motivo.
 */
export async function recolectar(desde, hasta, { concurrencia = 4, alProgresar, omitir } = {}) {
  const dias = diasRango(desde, hasta);
  const fuera = omitir ?? new Set();
  const out = [];
  const omitidas = new Set();
  const descartes = new Map();
  let vistos = 0;
  let saltados = 0;

  for (let i = 0; i < dias.length; i += concurrencia) {
    const tanda = dias.slice(i, i + concurrencia);
    const sumarios = await Promise.all(
      tanda.map((d) => sumario(d).catch(() => [])),
    );

    // El descarte se cuenta aquí, con su motivo, antes de filtrar. Es el
    // número que hay que mirar cuando el filtro se equivoca: si de un día
    // salen 300 anuncios de «ruido» y de otro salen 3, algo cambió en el BOE
    // o en las reglas, y tiene que verse sin tener que diffear el log.
    const todos = sumarios.flat();
    for (const c of todos) {
      const m = motivoDescarte(c);
      if (m) descartes.set(m, (descartes.get(m) || 0) + 1);
    }
    const candidatos = todos.filter(esBeca);
    alProgresar?.({ fase: 'indice', dia: tanda[0], candidatos: candidatos.length });

    // Esto también va en pool. Antes era un `for` con `await` y, con la
    // caché puesta, casi todas las peticiones se salían —que es justo lo que
    // se quería— pero las que quedaban iban una detrás de otra.
    for (let j = 0; j < candidatos.length; j += concurrencia) {
      const grupo = candidatos.slice(j, j + concurrencia);
      const fichas = await Promise.all(grupo.map(async (c) => {
        if (fuera.has(c.id)) {
          saltados++;
          omitidas.add(c.id);
          return null;
        }
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
  return { fichas: out, saltados, omitidas, descartes };
}