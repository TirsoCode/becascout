/**
 * consultas.mjs — las piezas de red que se Repiten en los conectores.
 *
 * ── Por qué este fichero ──────────────────────────────────────────────────
 *
 * Los conectores hacen tres cosas siempre: bajar una página, bajar un JSON y
 * no tumbarse cuando la fuente falla. Las tres estaban repetidas en cada
 * conector, y cada copia era una ocasión para que una de ellas quedara mal.
 *
 * Lo que se repite aquí tiene un nombre y una regla, y las dos importan:
 *
 *   1. **Timeout.** Toda petición de red lo tiene. Una fuente que se cuelga
 *      no puede Comer una pasada entera de la ingesta: el 19 de octubre de
 *      2026 una fuente caída dejó el job del cron corriendo hasta que GitHub
 *      lo mató, y la base se quedó como estaba.
 *   2. **`catch` y vacío.** Una fuente que falla devuelve `null` o `[]`, nunca
 *      una excepción. La diferencia importa: `null` es «esta fuente hoy no
 *      dice nada» y una excepción es «el programa está roto». La primera se
 *      avisa por log y se sigue; la segunda para la pasada.
 *   3. **Nada de reintentos.** Un reintento contra un WAF no mejora nada y
 *      empeora elapedido: el WAF ve más tráfico de golpe y corta antes. Si
 *      una fuente falla, se dice y se sigue con la siguiente.
 */

/** User-Agent identificable. Los portales públicos piden poder saber quién es. */
export const UA = 'becascout/0.1 (+https://becascout.vercel.app)';

/** Cuánto espera una petición antes de darse por muerta. */
export const TIMEOUT_MS = 30_000;

/**
 * Una petición con timeout, que nunca lanza.
 *
 * Devuelve el `Response` si todo fue bien y `null` si no. El cuerpo lo lee
 * quien llama, porque cada fuente devuelve algo distinto y algunas veces lo
 * que interesa es leer el error.
 */
export async function pedir(url, { timeout = TIMEOUT_MS, headers = {}, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      method,
      body,
      headers: {
        'user-agent': UA,
        accept: 'application/json, text/html;q=0.9, */*;q=0.8',
        ...headers,
      },
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Un JSON, o `null` si no se pudo bajar o no era JSON. */
export async function pedirJson(url, opciones = {}) {
  const res = await pedir(url, {
    ...opciones,
    headers: { accept: 'application/json', ...(opciones.headers ?? {}) },
  });
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Un JSON con el cuerpo en `multipart/form-data`.
 *
 * Va aparte porque es un caso con una trampa: el `Content-Type` con el
 * límite de las partes **no se puede poner a mano**. Node lo calcula solo
 * cuando el cuerpo es un `FormData`, y si se le pone uno a mano —o el de
 * `application/json`— el servidor recibe un cuerpo mal formado y contesta
 * 500 con «An internal error occurred», que no dice nada de cuál fue el
 * fallo.
 *
 * El API de la Comisión de financiación es el que lo exige, y es la razón
 * de que este helper exista aparte.
 */
export async function pedirJsonMultipart(url, form, { timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      method: 'POST',
      body: form,
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Un texto, o `null` si no se pudo bajar. */
export async function pedirTexto(url, opciones = {}) {
  const res = await pedir(url, opciones);
  if (!res || !res.ok) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Reparte un trabajo entre varias veces a la vez.
 *
 * El orden de salida es el de entrada, que es lo que hace que el fichero
 * generado salga igual con la misma entrada y el diff no reordene las filas
 * cada vez. Ver la nota de `run.mjs` sobre por qué importa.
 */
export async function enTandas(items, n, tarea) {
  const salida = [];
  for (let i = 0; i < items.length; i += n) {
    const grupo = items.slice(i, i + n);
    const hechos = await Promise.all(grupo.map((x) => Promise.resolve(tarea(x)).catch(() => null)));
    salida.push(...hechos);
  }
  return salida;
}

/**
 * Convierte una fecha de la UE en ISO (`YYYY-MM-DD`).
 *
 * La Comisión escribe `2026-11-24T00:00:00.000+0000`, que es ISO con la
 * hora de Greenwich y sin dos puntos. `new Date()` la entiende, pero la
 * fecha que se guarda es la que va en la ficha y tiene que ser la misma
 * cadena en todos los sitios, o el plazo no cuadra con lo que dice la
 * convocatoria.
 */
export function aFechaISO(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
