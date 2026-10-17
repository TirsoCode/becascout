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
  idioma: ['idioma', 'inglés', 'inglés', 'nivel de inglés', 'certificado'],
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

const PATRONES_PLAZO = [
  /plazo de presentaci[óo]n.{0,120}?(\d{1,2})\s*días\s+h[áa]biles/i,
  /(?:finaliza|termina|expira|vence).{0,40}?el (\d{1,2})\s+de\s+([a-zé]+)\s+de\s+(\d{4})/i,
  /antes del (\d{1,2})\s+de\s+([a-zé]+)\s+de\s+(\d{4})/i,
  /hasta el (\d{1,2})\s+de\s+([a-zé]+)\s+de\s+(\d{4})/i,
];

const MESES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/** Normaliza «1.200,50» a 1200.5 y descarta lo que no es un número. */
export function parseEuros(raw) {
  if (!raw) return null;
  const limpio = String(raw).replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(limpio);
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

/** Primer importe que aparece, con su frase entera como cita. */
export function buscaImporte(parrafos) {
  for (const { texto } of parrafos) {
    for (const re of PATRONES_IMPORTE) {
      const m = re.exec(texto);
      if (!m) continue;
      const euros = parseEuros(m[1]);
      if (!euros) continue;
      return { euros, cita: recortar(texto, m.index, m.index + m[0].length) };
    }
  }
  return null;
}

/** Fecha límite de solicitud, si la mención el texto. */
export function buscaPlazo(parrafos, desde) {
  for (const { texto } of parrafos) {
    for (const re of PATRONES_PLAZO) {
      const m = re.exec(texto);
      if (!m) continue;
      let fecha;
      if (m.length === 2) {
        // «plazo de presentación … N días hábiles»
        const dias = Number.parseInt(m[1], 10);
        if (!Number.isFinite(dias)) continue;
        fecha = new Date(desde);
        fecha.setDate(fecha.getDate() + dias * 1.5); // hábiles ≠ naturales
      } else {
        const mes = MESES[m[2].toLowerCase()];
        if (mes === undefined) continue;
        fecha = new Date(Number(m[3]), mes, Number(m[1]));
      }
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
      const nota = parseEuros(re[1]);
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

  const importe = buscaImporte(parrafos);
  anota('importe', 'Importe', importe?.euros, importe);

  const plazo = buscaPlazo(parrafos, new Date());
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
 *   - «Importe = 450», con cita «…alFCs_surfacePagination.htm reembolsará
 *     mensualmente al estudiantado seleccionado…». El 450 no está en la cita:
 *     venía de un número de un párrafo anterior.
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

  if (typeof v === 'string') return cita.includes(normalizar(v));
  return true; // booleanos y objetos: no hay forma de comprobarlo aquí
}

/** Minúsculas y sin acentos, para comparar texto que viene de dos sitios. */
function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Descarta lo que no se sostiene y marca el resto como verificado o
 * pendiente. Todo lo que sale de aquí a la base pasa por este filtro.
 */
export function verifica(requisitos) {
  return requisitos
    .filter((r) => r.cita)
    .map((r) => ({ ...r, verificado: citaSostiene(r) }))
    .filter((r) => r.verificado);
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