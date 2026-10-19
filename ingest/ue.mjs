import { pedirJsonMultipart, aFechaISO } from './consultas.mjs';
import { codigosEn } from '../js/paises.js';

// La clave va en la URL, pero **una sola vez**: si la constante la lleva
// y `url()` la vuelve a poner, sale `…?apiKey=SEDIA?apiKey=SEDIA&…` y el
// API contesta 200 con la lista vacía, sin decir nada. Un 200 con cero
// resultados parece «no hay convocatorias», que es justo lo que pasó.
const API = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PORTAL = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal';

/** Códigos del diccionario del portal. Salen del `/facet`, no de memoria. */
const ABIERTO = '31094502';
const SUBVENCION = '1';        // type: grant

/**
 * Los programas de la Comisión que son de personas, no de organizaciones.
 *
 * `programmeDivision` es la división. Los dos de MSCA que se buscan son
 * los de personal en formación: doctoral networks y postdocs.
 */
const DIVISIONES_PERSONAS = new Set([
  '43108473',   // MSCA Actions
  '43108486',   // MSCA Doctoral Networks
  '43108487',   // MSCA Postdoctoral Fellowships
]);

/** Programa marco de Erasmus. */
const ERASMUS = '43353764';

function cuerpo(query) {
  const fd = new FormData();
  fd.append('query', new Blob([JSON.stringify(query)], { type: 'application/json' }));
  fd.append('languages', new Blob([JSON.stringify(['en'])], { type: 'application/json' }));
  fd.append('displayLanguage', 'en');
  return fd;
}

function url(page, size, sortBy) {
  const q = new URLSearchParams({
    apiKey: 'SEDIA',
    text: '*',
    pageSize: String(size),
    pageNumber: String(page),
  });
  if (sortBy) {
    q.set('sortBy', sortBy);
    q.set('orderBy', 'ASC');
  }
  return `${API}?${q}`;
}

export async function pagina(must, { page = 1, size = 50, sortBy = 'deadlineDate' } = {}) {
  const query = { bool: { must } };
  const res = await pedirJsonMultipart(url(page, size, sortBy), cuerpo(query));
  return res?.results ?? [];
}

/**
 * Trae las convocatorias de la UE que se piden en nombre propio y siguen
 * con plazo abierto.
 */
export async function recolectar({ alProgresar } = {}) {
  const vistos = new Map();

  const consultas = [
    // Subvenciones abiertas (type=1): aquí están las fellowships y los
    // programas de personal. Es el tipo que va a una persona.
    [{ terms: { status: [ABIERTO] } }, { terms: { type: [SUBVENCION] } }],
    // Y las de las divisiones de MSCA, que se piden por su división. Van
    // aparte porque el filtro por división **no** se puede combinar con
    // el de tipo: con las dos a la vez la búsqueda se queda sin nada, y
    // la convocatoria de MSCA —que sí es de una persona— no salía nunca.
    [{ terms: { status: [ABIERTO] } }, { terms: { programmeDivision: [...DIVISIONES_PERSONAS] } }],
  ];

  for (const must of consultas) {
    for (let page = 1; page <= 6; page++) {
      const res = await pagina(must, { page, size: 50 });
      if (!res.length) break;
      for (const x of res) {
        const r = aRegistro(x);
        if (r) vistos.set(r.id, r);
      }
      alProgresar?.({ fase: 'ue', total: vistos.size, pagina: page });
      if (res.length < 50) break;
    }
  }

  return [...vistos.values()];
}

/**
 * Convierte un resultado del API en un registro, o `null` si no vale.
 */
export function aRegistro(x) {
  const m = x?.metadata ?? {};
  const titulo = primero(m.title) ?? primero(x.title) ?? null;
  if (!titulo) return null;

  const fp = primero(m.frameworkProgramme);
  // `programmeDivision` es una **lista**: una convocatoria pertenece a
  // varias divisiones a la vez, y con la primera no basta. Por eso se
  // mira la lista entera y no un valor suelto.
  const divs = lista(m.programmeDivision);
  const prog = primero(m.programme) ?? primero(m.esST_programme) ?? '';

  // El filtro de personas.
  const esDePersonas = divs.some((d) => DIVISIONES_PERSONAS.has(d))
    || (fp === ERASMUS && /erasmus/i.test(prog));
  if (!esDePersonas) return null;

  // El plazo. Sin fecha no hay convocatoria que se pueda seguir.
  const fechas = Array.isArray(m.deadlineDate) ? m.deadlineDate : [m.deadlineDate];
  const candidatas = fechas
    .map((f) => aFechaISO(f))
    .filter(Boolean)
    .filter((f) => f >= HOY())
    .sort();
  if (!candidatas.length) return null;

  const cierra = candidatas[0];

  const ref = x.reference ?? m.REFERENCE ?? null;
  if (!ref) return null;

  const url = oficial(x.url, ref);

  // ── El país ─────────────────────────────────────────────────────────────
  //
  // La convocatoria no lo dice, y no se inventa. Una fellowship de MSCA es
  // para hacer la tesis **donde contrate la universidad**, que no se sabe
  // hasta que se elige: la convocatoria es la misma para un laboratorio en
  // Barcelona y para otro en Bolonia.
  //
  // Un destino inventado hace que el filtro de la web esconda la beca o la
  // enseñe donde no es. Así que solo se guarda el país que la propia
  // convocatoria nombra en su metadato, y si no lo nombra se queda sin
  // destino. El buscador la enseña igualmente bajo el filtro de cualquier
  // destino, que es lo que corresponde a una convocatoria que vale para
  // toda Europa.
  const paises = codigosEn(primero(m.esST_country) ?? '');

  const requisitos = [];

  if (cierra) {
    requisitos.push({
      tipo: 'fecha_limite',
      etiqueta: 'Plazo de solicitud',
      valor: cierra,
      cita: `${titulo} — ${m.callIdentifier?.[0] ?? ref} — deadline: ${fechas.find((f) => aFechaISO(f) === cierra)}`,
      obligatorio: true,
      extractor: 'oficial',
    });
  }

  const callId = primero(m.callIdentifier);
  if (callId) {
    requisitos.push({
      tipo: 'convocatoria',
      etiqueta: 'Identificador de la convocatoria',
      valor: callId,
      cita: `${titulo} — call identifier: ${callId}`,
      obligatorio: true,
      extractor: 'oficial',
    });
  }

  return {
    id: `UE-${ref}`,
    titulo,
    organizador: prog || 'Unión Europea',
    ambito: 'europeo',
    fuente: 'ue',
    paises,
    presupuesto: presupuestoDe(m),
    requisitos,
    url,
    url_oficial: url,
    cierra,
    cerrada: false,
    pagina: null,
  };
}

/**
 * El presupuesto, si la convocatoria lo dice.
 *
 * Viene en `budgetOverview` como una cadena JSON con esta forma:
 *
 *   {
 *     "budgetYearsColumns": ["2026"],
 *     "budgetTopicActionMap": {
 *       "113402": [{
 *         "action": "…",
 *         "budgetYearMap": {"2026": "628033846"},
 *         …
 *       }]
 *     }
 *   }
 *
 * El dinero está en `budgetYearMap`, que es un año → cantidad. Es un dato
 * estructurado del portal, así que se puede citar.
 *
 * Pero hay una trampa: la **primera clave** del objeto no es el dinero, es
 * `budgetYearsColumns`, y `Number(['2026'])` da `NaN`… y `Number('2026')`
 * da el año. La versión anterior leía la primera clave que|clubiera con
 * «budget» y guardaba **2026** como si fuera el presupuesto: un año
 * playing de presupuesto, que es justo el tipo de cifra sin sentido que
 * hace que alguien renuncie a una beca.
 *
 * Por eso se baja hasta `budgetYearMap` y se queda con el mayor de los
 * importes: cada acción es una parte de la misma bolsa, y sumarlas
 * contaría dos veces el mismo dinero.
 */
function presupuestoDe(m) {
  const bruto = m.budgetOverview?.[0];
  if (!bruto) return null;
  let d;
  try {
    d = JSON.parse(bruto);
  } catch {
    return null;
  }

  const acciones = d?.budgetTopicActionMap;
  if (!acciones || typeof acciones !== 'object') return null;

  let total = 0;
  for (const lista of Object.values(acciones)) {
    if (!Array.isArray(lista)) continue;
    for (const accion of lista) {
      const porAnio = accion?.budgetYearMap;
      if (!porAnio || typeof porAnio !== 'object') continue;
      for (const cantidad of Object.values(porAnio)) {
        const n = Number(cantidad);
        if (Number.isFinite(n) && n > 0) total = Math.max(total, n);
      }
    }
  }
  return total > 0 ? total : null;
}

/**
 * El enlace oficial a la convocatoria.
 *
 * El API devuelve dos registros por cada `callIdentifier`, y uno de ellos
 * lleva una URL que **no existe**: `…/data/topicDetails/<id>.json` es un
 * 404, y la página de verdad es `…/topic-details/<id>`.
 */
function oficial(url, ref) {
  if (url && !/topicDetails\/.*\.json$/i.test(url)) {
    if (url.startsWith('/')) return `https://ec.europa.eu/info/funding-tenders/opportunities/portal${url}`;
    if (/^https?:\/\//.test(url)) return url;
  }
  return `${PORTAL}/screen/opportunities/topic-details/${ref}`;
}

function primero(v) {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Un campo que puede venir como lista, siempre como lista. */
function lista(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

function HOY() {
  return new Date().toISOString().slice(0, 10);
}
