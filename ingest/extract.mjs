/**
 * extract.mjs — De un anuncio del BOE a requisitos estructurados.
 *
 * Hay dos caminos y la elección NO depende de la calidad, sino de si hay
 * presupuesto para el modelo:
 *
 *   - Con OPENROUTER_API_KEY: un modelo lee el texto y devuelve requisitos
 *     tipados. Es el camino bueno, porque las Bases están escritas para
 *     leerse por personas y las frases que importan («no tener titulación
 *     previa», «edad máxima 30 años») no se dejan cazar con una expresión
 *     regular sin producir basura.
 *   - Sin clave: reglas. Más lento de escribir, se pierde en los casos raros,
 *     pero es determinista y gratis, así que el pipeline nunca se queda sin
 *     datos por falta de una tarjeta.
 *
 * Regla que no se rompe nunca: **cada requisito guarda el fragmento literal
 * del que se sacó**. Sin cita, el requisito no se guarda. Si el modelo se
 * equivoca, al menos se equivoca con la fuente a la vista y el estudiante
 * puede comprobarla; si además se equivoca sin cita, no hay forma de
 * detectar el error y el producto pierde lo único que lo hace creíble.
 *
 * ── Por qué OpenRouter ────────────────────────────────────────────────────
 *
 * Porque el modelo que hace bien este trabajo se puede cambiar desde una
 * variable de entorno. La tarea es extraer campos de un texto jurídico, y hay
 * modelos de 0,03 $/M que la hacen casi tan bien como los caros: a quince mil
 * tokens por convocatoria, la diferencia entre el más barato y Claude Haiku
 * sale a céntimos al año. La clave única de OpenRouter además evita repartir
 * credenciales por proyecto.
 *
 * El modelo por defecto es deliberadamente barato. Si algún día hay que subir
 * de gama, es `--model anthropic/claude-haiku-5.5`, sin tocar código.
 */

import { readFile } from 'node:fs/promises';

const MODELO = process.env.BECAS_MODEL || 'google/gemini-2.5-flash-lite';
const API = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_INTENTOS = 3;

/* ── Vocabulario de requisitos ────────────────────────────────────────────
 * Claves que usa el motor de matching. Cada una tiene sus sinónimos: el
 * BOE escribe «edad máxima» y «edad inferior a» para lo mismo, y un patrón
 * que solo case con una de las dos formas falla la mitad de las veces.
 */
export const TIPOS_REQUISITO = {
  nota_minima: ['nota media', 'nota mínima', 'expediente académico', 'promedio'],
  edad_max: ['edad máxima', 'edad inferior a', 'no superar los', 'años cumplidos'],
  edad_min: ['edad mínima', 'edad no inferior'],
  idioma: ['idioma', 'inglés', 'nivel de inglés', 'certificado'],
  titulacion: ['titulación', 'título universitario', 'estudiante de', 'matrícula'],
  destino: ['destino', 'país de destino', 'universidad de destino'],
  ingresos: ['renta', 'ingresos', 'rendimiento', 'nivel de ingresos'],
  justificacion: ['memoria', 'proyecto', 'justificante', 'plan de estudios'],
};

/* Patrones de recompensa: frases que delatan un importe en euros. */
const PATRONES_IMPORTE = [
  /([\d.,]+)\s*euros?\s+(?:al?mes|mesales?|mensuales?)/i,
  /([\d.,]+)\s*euros?\s+(?:anuales?|al año|de importe)/i,
  /([\d.,]+)\s*€/,
  /cuant(?:ía|ia) de ([\d.,]+)\s*euros?/i,
  /importe de ([\d.,]+)\s*euros?/i,
];

/*
 * El plazo, solo si el documento lo escribe con fecha.
 *
 * NO se convierte a fecha un «plazo de quince días hábiles»: eso es una regla
 * relativa, y el día exacto depende de la publicación, del cómputo de hábiles
 * y de los festivos que caigan en medio. Una fecha calculada tendría el
 * aspecto de un dato comprobable y estaría mal, que es justo lo que el
 * producto no puede hacer. Si el documento no dice un día, no hay día.
 */
const PATRONES_PLAZO = [
  /(?:finaliza|termina|expira|vence).{0,40}?el (\d{1,2})\s+de\s+([a-zé]+)\s+de\s+(\d{4})/i,
  /antes del (\d{1,2})\s+de\s+([a-zé]+)\s+de\s+(\d{4})/i,
  /hasta el (\d{1,2})\s+de\s+([a-zé]+)\s+de\s+(\d{4})/i,
];

const MESES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/**
 * Normaliza un número escrito como lo escribe el BOE y descarta lo que no lo
 * es. Acepta las dos convenciones, porque aparecen las dos:
 *
 *   - española: «1.200,50» → 1200.5   (punto de millares, coma decimal)
 *   - inglesa: «1200.50»  → 1200.5   (coma de millares, punto decimal)
 *
 * ── La regla, y por qué no es más complicada ───────────────────────────────
 *
 * El separador **más a la derecha** es el decimal; todos los que quedan a su
 * izquierda son de millares y se quitan. Es la regla que aplica cualquier
 * lector humano y la que resuelve los dos casos que antes salían mal sin
 * tener que adivinar:
 *
 *   «1.200,50»   → el último separador es la coma  → entero 1.200, frac 50
 *   «1200.50»    → el último es el punto          → entero 1200,  frac 50
 *   «18.000»     → el último es el punto          → se va entero… y mal
 *
 * El último caso es el único que necesita una regla aparte, porque «18.000»
 * con el punto de millares vale 18.000 y con punto decimal vale 18. Se
 * resuelve mirando lo que hay detrás: si el punto va seguido de **exactamente
 * tres cifras y no hay ningún otro separador**, es de millares, porque así
 * escribe el BOE las cantidades redondas. «1200.50» tiene dos cifras detrás y
 * es decimal; «1.200.300» tiene dos puntos y es español.
 *
 * Antes se quitaban todos los puntos a lo bruto, y entonces «1200.50» se leía
 * como 120.050: mil veces el valor real.
 *
 * ── Por qué no se usa para las notas ───────────────────────────────────────
 *
 * `buscaNotaMinima` **no** usa esta función, y no por descuido. Una nota se
 * escribe «7,5» y aquí eso vale 75, que es un suspenso con todas las letras
 * pero sobre 100. Durante un tiempo se le dio por válido leerla con el mismo
 * formato que los euros, y el resultado fue que `buscaNotaMinima` devolvía
 * `null` en cada Bases con nota con decimales: el requisito se descartaba sin
 * avisar, porque 75 no es menor que 10. La nota tiene su propio lector,
 * `leeDecimal`, y no comparte nada con este.
 */
export function parseEuros(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  const s = String(raw).trim().replace(/\s/g, '');
  // Ni signo, ni letra, ni exponente: no es una cantidad y no se intenta.
  // El `+` y el `-` se rechazan aquí a propósito; un importe negativo no es una
  // beca y una nota no lleva signo.
  if (!/^[\d.,]+$/.test(s)) return null;

  const seps = s.match(/[.,]/g);
  if (!seps) return num(s);

  /**
   * Millares: todos los separadores son el mismo carácter y cada grupo detrás
   * de ellos mide exactamente tres cifras. «18.000», «1,200,500», «1.200.300».
   *
   * Es la única excepción a «el más a la derecha es el decimal»: «18.000» con
   * punto decimal valdría 18, pero así escribe el BOE las cantidades redondas.
   * Antes se recortaba `slice(0, -4)` con lo que «18.000» salía 18: se perdía
   * el grupo de millares entero. Se quita el separador, no el grupo.
   */
  if (seps.every((c) => c === seps[0])) {
    const grupos = s.split(seps[0]);
    if (grupos.slice(1).every((g) => g.length === 3)) return num(grupos.join(''));
  }

  // Todos los demás casos: el separador más a la derecha es el decimal y los
  // que quedan a su izquierda son de millares. «1.200,50», «1,200.50»,
  // «2.272.514,66».
  const ultimo = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const entero = s.slice(0, ultimo).replace(/[.,]/g, '');
  const frac = s.slice(ultimo + 1).replace(/[.,]/g, '');
  return num(`${entero}.${frac}`);
}

/** Último recurso: un entero o decimal plano. Devuelve null si no es número. */
function num(s) {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lee un número decimal español: «7,5» → 7.5. Para notas y edades, no para
 * euros, y con su propia función a propósito —ver la nota de `parseEuros`—.
 *
 * Una nota nunca lleva separador de millares: siempre se escribe con los
 * decimales separados por coma, del 0 a 10. Por eso aquí la coma es siempre
 * decimal y no hay que adivinar nada.
 */
export function leeDecimal(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim().replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Trocea el texto en párrafos y recuerda de cuál vino cada uno. */
export function parrafosConOrigen(texto) {
  return texto
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40)
    .map((p, i) => ({ indice: i, texto: p }));
}

/**
 * Primer importe que puede ser de una persona, con su frase entera como cita.
 *
 * Antes devolvía el primer número seguido de «euros» que aparecía en el texto,
 * y por eso una convocatoria que no era una beca aportaba su cifra: los
 * 3,85 € de un aval, los 12.042 €/m² de una tasa de ocupación de suelo, los
 * 15 € de derechos de examen de un opuesto o los 80 € de una compensación
 * por accidente laboral. Todos pasaban `citaSostiene`, porque el número
 * estaba de verdad en la frase.
 *
 * La diferencia entre «una beca de 18.000 €» y «una tasa de 12.042 €/m²» no
 * está en la cantidad ni en el formato: está en si la frase habla de un
 * beneficiario. Por eso se recorren todas las cifras del párrafo y se
 * devuelve la primera que lo sea, en vez de la primera que exista.
 */
export function buscaImporte(parrafos) {
  let encontrado = null;

  for (const { texto } of parrafos) {
    for (const re of PATRONES_IMPORTE) {
      // Todos los hallazgos de este patrón, no solo el primero.
      const global = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
      for (const m of texto.matchAll(global)) {
        const euros = parseEuros(m[1]);
        if (!euros) continue;
        const cita = recortar(texto, m.index, m.index + m[0].length);
        const clase = clasificaImporte(cita);
        if (clase === 'persona') return { euros, cita };
        // Se guarda el primer presupuesto como segundo mejor resultado, por si
        // al final no hay ninguna cifra de una persona en toda la convocatoria.
        if (clase === 'presupuesto' && !encontrado) encontrado = { euros, cita };
      }
    }
  }

  return encontrado;
}

/**
 * Fecha límite de solicitud, si el texto la escribe con día concreto.
 *
 * Solo patrones de fecha escrita («hasta el 30 de septiembre de 2026»). El
 * «plazo de quince días hábiles» no se convierte en fecha, y no por descuido:
 * ver `PATRONES_PLAZO`. Si no hay fecha, devuelve null y la interfaz enseña
 * que no la tenemos.
 */
export function buscaPlazo(parrafos) {
  for (const { texto } of parrafos) {
    for (const re of PATRONES_PLAZO) {
      const m = re.exec(texto);
      if (!m) continue;
      const mes = MESES[m[2].toLowerCase()];
      if (mes === undefined) continue;
      const dia = Number(m[1]);
      // En UTC para que la fecha no se corra un día según el huso del que
      // ejecuta la ingesta, y comprobando que el día exista: un «31 de
      // febrero» produciría el 3 de marzo, que es una fecha que el documento
      // no dice.
      const fecha = new Date(Date.UTC(Number(m[3]), mes, dia));
      if (fecha.getUTCMonth() !== mes || fecha.getUTCDate() !== dia) continue;
      return { fecha: fecha.toISOString().slice(0, 10), cita: recortar(texto, m.index, m.index + m[0].length) };
    }
  }
  return null;
}

/** Nota mínima sobre 10, que es como la escriben casi todas las Bases. */
export function buscaNotaMinima(parrafos) {
  for (const { texto } of parrafos) {
    const re = /nota media (?:mínima )?de ([\d.,]+)/i.exec(texto);
    if (re) {
      // `leeDecimal` y no `parseEuros`: una nota se escribe «7,5» y con el
      // lector de euros eso vale 75, que no cabe en un diez y hacía que el
      // requisito desapareciera sin avisar. Ver la nota de `parseEuros`.
      const nota = leeDecimal(re[1]);
      if (nota && nota <= 10) {
        return { nota, cita: recortar(texto, re.index, re.index + re[0].length) };
      }
    }
  }
  return null;
}

/**
 * Edad máxima. El rango habitual es 25–35 y el filtro se queda con él.
 *
 * Entre la etiqueta y el número puede haber de todo: «edad máxima **de** 30
 * años», «edad máxima **que será de** 30», «que **no podrá superar** los
 * 35». Con la etiqueta pegada al número (el patrón natural, `edad máxima
 * (\d+)`) se perdían la mayoría, porque el BOE casi nunca las escribe así de
 * secas. Se admite un relleno corto en medio y se descarta si aparece otro
 * número antes, que es lo que evita «edad máxima inferior a 30 años a fecha de
 * la convocatoria de 2025» cogiendo el 2025.
 */
export function buscaEdadMax(parrafos) {
  const re = /(?:edad m[áa]xima|edad inferior a|no superar los|no podr[áa] superar los)\s+(?:[a-záéíóúñ]{0,24}?\s+)?(\d{1,2})\s*a[ñn]os?/i;

  for (const { texto } of parrafos) {
    const m = re.exec(texto);
    if (!m) continue;
    const edad = Number.parseInt(m[1], 10);
    if (edad >= 18 && edad <= 70) {
      return { edad, cita: recortar(texto, m.index, m.index + m[0].length) };
    }
  }
  return null;
}

/** Aísla la frase que sostiene el dato, para poder citarla entera. */
function recortar(texto, desde, hasta, margen = 90) {
  const ini = Math.max(0, desde - margen);
  const fin = Math.min(texto.length, hasta + margen);
  return ('…' + texto.slice(ini, fin).trim() + '…').replace(/^…\s*/, '');
}

/**
 * Camino por reglas. Devuelve requisitos con cita, o [] si no encuentra
 * ninguno — y [] es una respuesta honesta, no un fallo.
 */
export function extraePorReglas(parrafos) {
  const requisitos = [];
  const anota = (tipo, etiqueta, valor, fuente) => {
    if (!fuente) return;
    requisitos.push({
      tipo,
      etiqueta,
      valor,
      obligatorio: true,
      cita: fuente.cita,
      extractor: 'reglas',
    });
  };

  const nota = buscaNotaMinima(parrafos);
  anota('nota_minima', 'Nota media mínima', nota?.nota, nota);

  const edad = buscaEdadMax(parrafos);
  anota('edad_max', 'Edad máxima', edad?.edad, edad);

  // Aquí se anota siempre como `importe`, y el tipo se corrige después, en
  // `verifica` → `reclasificaImporte`. Esa es la puerta por la que pasan los
  // dos caminos, reglas y modelo, y es el único sitio donde hace falta: si se
  // clasificara aquí, un importe que devuelve el modelo pasaría sin revisar.
  const importe = buscaImporte(parrafos);
  anota('importe', 'Importe', importe?.euros, importe);

  const plazo = buscaPlazo(parrafos);
  anota('fecha_limite', 'Plazo de solicitud', plazo?.fecha, plazo);

  return requisitos;
}

/**
 * Camino con modelo. Devuelve null si no hay clave, para que el llamante caiga
 * al camino por reglas sin tener que preguntar.
 *
 * Reintenta ante errores de red y 5xx, porque la ingesta va por tandas y un
 * parpadeo del proveedor no debería dejar la base a medias. Un 4xx no se
 * reintenta: si la clave está mal, reintentar tres veces solo tarda más.
 */
export async function extraeConLLM(parrafos, { apiKey, model } = {}) {
  if (!apiKey) return null;

  const cuerpo = parrafos.slice(0, 240).map((p) => p.texto).join('\n\n');
  if (cuerpo.length < 200) return null;

  const system = [
    'Extraes requisitos de admisión de convocatorias de becas y ayudas de estudio.',
    'Reglas:',
    '- Solo devuelves requisitos que estén EXPLÍCITOS en el texto.',
    '- Cada requisito incluye "cita": el fragmento literal del texto que lo sustenta, copiado sin cambiar ni una palabra.',
    '- Si no estás seguro, el requisito no va. Es preferible devolver [] que inventar.',
    '- "obligatorio" es true salvo que el texto diga "recomendado" u "opcional".',
    '- Tipos válidos: nota_minima, edad_max, edad_min, idioma, titulacion, destino, ingresos, justificacion, importe, fecha_limite.',
    '- El valor va ya normalizado: nota sobre 10, edad en años enteros, importe en euros (sin símbolo ni separador de miles).',
    '- "fecha_limite" en formato AAAA-MM-DD.',
    '- Si el importe es el presupuesto total de la convocatoria, una línea presupuestaria o una cotización, NO es el importe de la beca: en ese caso no lo incluyas.',
  ].join('\n');

  const payload = {
    model: model || MODELO,
    temperature: 0,
    max_tokens: 4096,
    // JSON mode: OpenRouter lo traduce al modo estructurado del modelo que
    // toque. Es lo que evita la mitad de las respuestas que empiezan con
    // «Aquí tienes los requisitos:» y rompen el parseo.
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `<convocatoria>\n${cuerpo}\n</convocatoria>\n\nDevuelve solo JSON con la forma {"requisitos": [...]}, sin texto alrededor.`,
      },
    ],
  };

  let ultimoError;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          // Cabeceras de atribución que OpenRouter pide para el panel del
          // usuario. No son obligatorias, pero sin ellas la petición sale
          // sin nombre y no se distingue de cualquier otra.
          'http-referer': 'https://becascout.com',
          'x-title': 'BecasScout ingest',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const detalle = (await res.text()).slice(0, 200);
        // 429 y 5xx son transitorios: vale la pena reintentar.
        if (res.status === 429 || res.status >= 500) {
          ultimoError = new Error(`${res.status}: ${detalle}`);
          await espera(1000 * intento);
          continue;
        }
        throw new Error(`${res.status}: ${detalle}`);
      }

      const json = await res.json();
      const contenido = json?.choices?.[0]?.message?.content;
      if (!contenido) throw new Error('respuesta vacía');

      const datos = parsea(contenido);
      return limpia(datos?.requisitos);
    } catch (err) {
      ultimoError = err;
      if (intento < MAX_INTENTOS) await espera(1000 * intento);
    }
  }
  throw ultimoError ?? new Error('fallo desconocido');
}

/** Espera exponencial simple entre reintentos. */
function espera(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * El contenido debería ser JSON puro por el JSON mode, pero un modelo puede
 * devolverlo envuelto en ```json … ``` o con un comentario delante. Se quita
 * la valla en vez de confiar, porque un parseo que falla tira la convocatoria
 * entera.
 */
function parsea(texto) {
  try {
    return JSON.parse(texto);
  } catch { /* sigue con la limpieza */ }

  const valla = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (valla) {
    try {
      return JSON.parse(valla[1]);
    } catch { /* sigue */ }
  }

  const primero = texto.indexOf('{');
  const ultimo = texto.lastIndexOf('}');
  if (primero > -1 && ultimo > primero) {
    return JSON.parse(texto.slice(primero, ultimo + 1));
  }
  throw new Error('la respuesta no es JSON');
}

/**
 * Normaliza lo que devuelve el modelo. La cita es obligatoria: un requisito
 * sin cita se descarta aquí mismo, antes de que llegue a la base, y no se
 * intenta arreglar inventando una cita.
 */
function limpia(requisitos) {
  if (!Array.isArray(requisitos)) return [];
  return requisitos
    .filter((r) => r && r.tipo && r.etiqueta && r.cita && String(r.cita).length > 8)
    .map((r) => ({
      tipo: String(r.tipo).slice(0, 30),
      etiqueta: String(r.etiqueta).slice(0, 80),
      valor: r.valor ?? null,
      obligatorio: r.obligatorio !== false,
      cita: String(r.cita).slice(0, 400),
      extractor: 'llm',
    }));
}

/**
 * Invariante del proyecto: **el valor tiene que aparecer dentro de su cita.**
 *
 * Sin esta comprobación, el camino por reglas produce basura con aire de
 * dato. Ejemplos reales que salieron antes de añadirla:
 *
 *   - «Importe = 450», con cita «…se reembolsará mensualmente al estudiantado
 *     seleccionado…». El 450 no está en la cita: venía de un número de un
 *     párrafo anterior.
 *   - «Plazo de solicitud = 2027-12-30» en un convenio sin convocatoria.
 *
 * El efecto es el peor de los posibles: una cita que parece respaldar el dato
 * y no lo respalda. El estudiante la abre, no encuentra el número, y deja de
 * fiarse de todo lo demás — con razón. Verificar es barato: si el valor no
 * está en el texto del que se dice haber salido, el requisito no existe.
 */
export function citaSostiene(req) {
  if (!req?.cita || req.valor === null || req.valor === undefined) return false;

  const cita = normalizar(req.cita);
  const v = req.valor;

  if (typeof v === 'number') {
    // El número tiene que aparecer tal cual, tolerando las cuatro formas en
    // que el BOE lo escribe. El punto de millares en español es el caso
    // importante: «ocho millones de euros (8.000.000 €)» se guarda como
    // 8000000, y si solo se comparara con la forma canónica, TODOS los
    // importes grandes pasarían el filtro y se perderían. `Intl` por defecto
    // no agrupa los millares de cuatro dígitos, así que hace falta pedirlo
    // explícitamente con `minimumGroupingDigits`.
    const formas = new Set([
      String(v),
      v.toLocaleString('es-ES', { useGrouping: true, minimumGroupingDigits: 3 }),
      v.toLocaleString('en-US', { useGrouping: true }),
      String(v).replace('.', ','),
    ]);
    return [...formas].some((f) => cita.includes(normalizar(f)));
  }

  if (typeof v === 'string') {
    if (cita.includes(normalizar(v))) return true;
    // Las fechas viajan en ISO pero el documento las escribe en castellano.
    // Sin esto, un requisito «fecha_limite = 2026-09-30» con la cita «…hasta
    // el 30 de septiembre de 2026» se descartaba, y por eso `cierra` salía
    // vacío aunque el BOE sí dijera la fecha.
    const formas = formasFecha(v);
    return formas ? formas.some((f) => cita.includes(normalizar(f))) : false;
  }
  return true; // booleanos y objetos: no hay forma de comprobarlo aquí
}

/** Minúsculas y sin acentos, para comparar texto que viene de dos sitios. */
function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Nombres de los meses en castellano, para reconocer una fecha con letra. */
const MESES_TEXTO = [
  ['enero'], ['febrero'], ['marzo'], ['abril'], ['mayo'], ['junio'],
  ['julio'], ['agosto'], ['septiembre', 'setiembre'], ['octubre'],
  ['noviembre'], ['diciembre'],
];

/**
 * Formas en que un documento puede escribir una fecha dada en ISO:
 * «2026-09-30», «30/09/2026», «30-9-2026» o «30 de septiembre de 2026».
 * Devuelve null si el valor no es una fecha ISO, para no confundir «no es una
 * fecha» con «no aparece en la cita».
 */
function formasFecha(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [, anio, mes, dia] = m;
  const nombre = MESES_TEXTO[Number(mes) - 1];
  if (!nombre) return null;

  const formas = new Set([v]);
  for (const d of new Set([dia, String(Number(dia))])) {
    for (const mm of new Set([mes, String(Number(mes))])) {
      formas.add(`${d}/${mm}/${anio}`);
      formas.add(`${d}-${mm}-${anio}`);
      formas.add(`${d}.${mm}.${anio}`);
    }
    for (const n of nombre) {
      formas.add(`${d} de ${n} de ${anio}`);
      formas.add(`${d} de ${n} del ${anio}`);
    }
  }
  return [...formas];
}

/* ── Qué es un importe y qué no lo es ─────────────────────────────────────
 *
 * `citaSostiene` comprueba que el número esté escrito en la cita, y eso es
 * justo lo que hace que la basura pase: el 49.552.000 € de la resolución del
 * CDTI **está** en su cita, la cita solo habla de otra cosa. La comprobación
 * es textual y no puede dar más de sí; para el importe hace falta una
 * segunda pregunta, que es de quién es el dinero.
 *
 * ── Por qué no se decide por la cantidad ─────────────────────────────────
 *
 * Porque hay becas que dan 100.000 € o más: un contrato predoctoral en
 * Suiza o en Países Bajos, un ERC o una beca senior de la Generalitat. Si
 * el filtro fuera «por encima de X no puede ser una beca», tiraría las
 * mejores y dejaría pasar la basura pequeña: los 3,85 € de un aval, los
 * 12,042 €/m² de una tasa de ocupación de suelo o los 15 € de derechos de
 * examen de un opositor. El tamaño no dice de qué va el número; lo dice la
 * frase que lo rodea.
 */

/**
 * De quién es el dinero, según la frase que acompaña al número.
 *
 * Tres salidas y ninguna más:
 *  - `'persona'`     → es lo que cobra un beneficiario. Vale como `importe`.
 *  - `'presupuesto'` → es el dinero de toda la convocatoria. Se guarda aparte,
 *                      porque 40.000.000 € de partida presupuestaria no es lo
 *                      que recibe un estudiante y presentarlo como tal es la
 *                      forma más rápida de que el producto pierda credibilidad.
 *  - `null`          → no se sabe. No se guarda nada.
 *
 * Se mira primero lo que **no** es beca, porque «ayuda» y «subvención» salen
 * en las dos columnas y si se mirara primero la señal positiva, una
 * subvención a una fundación se leería como dinero para un alumno.
 */
const CONTEXTO_NO_PERSONA = [
  // Licitación y contratación pública. El «presupuesto base de licitación»
  // es el dinero de la contrata, no de ninguna convocatoria: se tira aunque
  // lleve la palabra «presupuesto» delante.
  /\blicitaci|adjudicatario|presupuesto base|pliego|garantia exigida|fianza\b/i,
  // Multas y sanciones.
  /\bmulta|sanci[oó]n|infracci|expediente sancionador/i,
  // Precios, subastas y patrimonio.
  /precio de remate|subasta|adjudicaci[oó]n .*bien|expropiaci|finca\b|valor catastral|transmisi[oó]n de la propiedad/i,
  // Tasas, impuestos y precios públicos.
  /tasa de ocupaci|canon\b|\/\s?m2|\/\s?ha\b|iva\b|impuesto|tasa municipal|ibi\b|patrimonio/i,
  // Avales y depósitos.
  /\baval\b|deposito del|5 por ciento del precio|importe del deposito/i,
  // Tasas de examen y matrículas de oposición.
  /derechos? de examen|matricula de oppositor|tasa de oposici/i,
  // Tablas salariales y convenio colectivo.
  /tabla salarial|salario base|plus de|convenio colectivo|compensacion economica|jornada/i,
  // Dinero que no es de nadie en concreto: crédito disponible, partidas.
  // «disponibilidad de crédito» a secas no bastó nunca para enseñar nada; solo
  // cuenta si el texto la liga a la convocatoria («…cuantía adicional
  // efectiva…», que es la frase que usa el BOE). Ver CONTEXTO_PRESUPUESTO.
  /credito disponible|disponibilidad de cr[eé]dito|partida presupuestaria|asignacion presupuestaria/i,
  // Personas jurídicas. Una entidad no es un becario: una subvención a una
  // fundación es dinero para la fundación, aunque lleve la palabra
  // «beneficiaria» delante.
  /\bentidad(es)?\b|fundaci[oó]n|confederaci[oó]n|asociaci[oó]n|sociedad\b|organizaci[oó]n sin/i,
  // Premios. «La dotación económica del premio será de 30.000 €» es dinero
  // por concurso, no una beca: si el estudiante lo lee como importe de la
  // convocatoria, se hace expectativas equivocadas de a qué opta.
  /\bpremios?\b|dotaci[oó]n econ[oó]mica/i,
];

const CONTEXTO_PERSONA = [
  // El vocabulario en inglés es imprescindible y no es adorno: el importe de
  // las 75 fichas de Erasmus Mundus sale de «EU scholarship for individuals:
  // €1,400 per month». Sin el patrón, clasificaImporte las devuelve todas a
  // null y la ingesta tira la única fuente con importes reales de beca.
  /\bbecas?\b|becari|ayudante de investigacion|predoctoral|postdoctoral|contrato de investigacion/i,
  /\bscholarship|grant\b|stipend/i,
  /\bestudiantes?\b|alumnos?|estudiantiles|\bindividuales?\b|\bper month\b/i,
  /\bbeneficiari|titulares?\b|personas?\s*beneficiarias?/i,
  /matricula|cuota de matr/i,
  /\bayudas?\b|subvenci[oó]n a (?:estudiantes|alumnos|becarios)/i,
  /\bbolsa\b|ayuda al estudio|ayuda economica|estancia|becas de movilidad/i,
];

/**
 * Presupuesto de toda la convocatoria, no cantidad de un beneficiario.
 *
 * Se separan porque es un dato que **sí** vale la pena enseñar —dice cuánto
 * dinero se ha puesto en juego— pero como lo que es. Antes el extractor no
 * distinguía nada y esa cifra salía etiquetada como «Importe» en la ficha.
 *
 * Aquí solo entran frases que limitan el dinero a la convocatoria. «Crédito
 * disponible» a secas NO está: salen 49.552.000 € de la resolución del CDTI
 * con ese encabezado en convocatorias que nada tienen que ver, y sin el
 * «…cuantía adicional efectiva…» del original el dato dudoso se tira. Un
 * importe dudoso es peor que ninguno.
 */
const CONTEXTO_PRESUPUESTO = [
  /presupuesto total|importe total|cuantia total|presupuesto de la convocatoria/i,
  /cuantia adicional efectiva/i,
  /total de la convocatoria|en total, se/i,
  // Subvenciones concedidas a personas jurídicas: «la cuantía financiera para
  // la entidad beneficiaria», «la subvención a la Fundación Yehudi Menuhin
  // España ascenderá a 230.076,00 €». Es dinero del programa, no de un
  // estudiante, y por eso se enseña renombrado como presupuesto y no como
  // importe: la frase lo dice y la cita queda a la vista.
  /cuantia financiera para/i,
  // La cita se recorta con un margen a cada lado del número, así que a veces
  // el «cuantía» del principio se queda fuera de la ventana y solo entra
  // «…financiera para la entidad beneficiaria…». Es la misma frase, cortada:
  // se reconoce por la parte que sí llega.
  /financiera para (?:l[ao]s? |el |la )?(?:entidad(?:es)?|fundaci[oó]n|confederaci[oó]n|asociaci[oó]n|federaci[oó]n|sociedad)/i,
  /subvenci[oó]n (?:a|para) (?:l[oa]s?|el) (?:entidad(?:es)?|fundaci[oó]n|confederaci[oó]n|asociaci[oó]n|federaci[oó]n|sociedad)/i,
];

/**
 * Decide qué es un importe en euros según la frase que lo sostiene.
 *
 * @param {string} cita La cita literal del requisito.
 * @returns {'persona'|'presupuesto'|null}
 */
export function clasificaImporte(cita) {
  const t = normalizar(cita ?? '');
  if (!t) return null;

  // El orden importa, y no por gusto: primero lo que **no** es dinero para
  // nadie en concreto, luego si es presupuesto, y solo al final si es de una
  // persona.
  //
  // La razón está en una frase que de verdad sale en el BOE: «la cuantía
  // financiera para la entidad beneficiaria». Una búsqueda ingenua de la
  // palabra «beneficiaria» la leería como dinero para un becario, y leería
  // mal: una entidad no es una persona. Lo mismo con «la subvención a la
  // Fundación Yehudi Menuhin». Por eso «entidad», «fundación»,
  // «confederación» y «asociación» tienen que poder ganar a la señal positiva.
  if (CONTEXTO_NO_PERSONA.some((re) => re.test(t))) {
    return CONTEXTO_PRESUPUESTO.some((re) => re.test(t)) ? 'presupuesto' : null;
  }

  if (CONTEXTO_PRESUPUESTO.some((re) => re.test(t))) return 'presupuesto';
  if (CONTEXTO_PERSONA.some((re) => re.test(t))) return 'persona';

  return null;
}

/**
 * Descarta lo que no se sostiene y marca el resto como verificado o
 * pendiente. Todo lo que sale de aquí a la base pasa por este filtro.
 */
export function verifica(requisitos) {
  return requisitos
    .filter((r) => r.cita)
    .map((r) => ({ ...r, verificado: citaSostiene(r) }))
    .filter((r) => r.verificado)
    .map(reclasificaImporte)
    .filter((r) => r !== null);
}

/**
 * Segunda puerta para el importe, y la que de verdad lo decide.
 *
 * Hasta aquí solo se comprobaba que el número estuviera escrito en la cita, y
 * eso lo cumple cualquier cifra: el 40.670.000 € de un decreto sobre gastos
 * extraordinarios en Ceuta está en su cita, y sale con `verificado: true` y
 * con la etiqueta «Importe» en la ficha de un estudiante que nunca va a verlo.
 *
 * Aquí se lee la frase: si el dinero es de un beneficiario, el requisito se
 * queda como `importe`; si es de toda la convocatoria, pasa a llamarse
 * `presupuesto` y se enseña como lo que es; y si no se entiende de quién es,
 * se descarta. **Se descarta, no se enseña a medias.** Un `importe` dudoso
 * es peor que ningún `importe`: uno se comprueba y el otro hace que el
 * estudiante piense que le van a dar 40 millones.
 *
 * Se aplica a los dos caminos por igual, reglas y modelo, porque el modelo
 * también se equivoca en esto —de hecho el prompt ya le pedía cuidado— y
 * porque la promesa del producto es que **nada se enseña sin cita que lo
 * sostenga**, y aquí la cita existe pero no sostiene lo que dice la etiqueta.
 */
function reclasificaImporte(r) {
  if (r.tipo !== 'importe') return r;

  const clase = clasificaImporte(r.cita);
  if (clase === 'persona') return r;
  if (clase === 'presupuesto') {
    return {
      ...r,
      tipo: 'presupuesto',
      etiqueta: 'Presupuesto de la convocatoria',
    };
  }
  return null;
}

/**
 * Elige camino y devuelve siempre un array ya verificado.
 *
 * El orden importa: primero se extrae (LLM o reglas), después se verifica
 * que cada cita sostenga su valor. La verificación va siempre, también en el
 * camino con LLM, porque un modelo también puede citar mal.
 */
export async function extrae(parrafos, opciones = {}) {
  const crudo = await extraeConLLM(parrafos, opciones)
    .catch(() => null)
    ?? extraePorReglas(parrafos);
  return verifica(crudo);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const txt = await readFile(process.argv[2], 'utf8').catch(() => null);
  if (!txt) {
    console.error('uso: node extract.mjs <ficha.txt>');
    process.exit(1);
  }
  const r = await extrae(parrafosConOrigen(txt), {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.BECAS_MODEL,
  });
  console.log(JSON.stringify(r, null, 2));
}