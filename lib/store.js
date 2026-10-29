/**
 * store.js — Dónde viven las cuentas y sus sesiones.
 *
 * Ahora es Postgres (Supabase), que es donde tiene que estar. Antes era un
 * fichero JSON y no podía funcionar en Vercel: las funciones tienen el disco
 * en solo lectura, así que el primer alta de cuenta lanzaba `EROFS`, y además
 * cada petición corría en una instancia distinta, con lo que dos registros
 * simultáneos se pisaban sin que ninguno se enterara.
 *
 * ── Por qué el JSON no se ha borrado del todo ─────────────────────────────
 *
 * Sigue estando como respaldo cuando no hay `SUPABASE_URL`. Es lo que permite
 * `node serve.mjs` levantar la web entera sin base de datos, que es como se
 * desarrolla. En cuanto las variables están puestas manda Postgres y el JSON
 * no se toca.
 *
 * ── Sobre la clave ─────────────────────────────────────────────────────────
 *
 * Se habla con Supabase por REST y con la `service_role`, que salta el RLS.
 * Es lo correcto aquí: estas llamadas solo ocurren desde el servidor, que es
 * quien ya ha comprobado la contraseña. La `anon` nunca entra en este
 * fichero; esa vive en el navegador y solo lee lo que el RLS le deja.
 *
 * ── Sesiones, no tokens ────────────────────────────────────────────────────
 *
 * El token se guarda en su propia tabla y no como columna de la cuenta. Antes
 * estaba en `cuentas`, que hacía que cada login sobrescribiera el token
 * anterior: entrar desde el móvil te cerraba la sesión del portátil. Ahora hay
 * una fila por sesión y todas viven a la vez. Cerrar sesión borra la suya y
 * solo la suya.
 *
 * ── La interfaz no ha cambiado ──────────────────────────────────────────────
 *
 * `crear`, `buscar`, `guardarToken`, `porToken` y `quitarToken` son las cinco
 * operaciones que necesita la API, con los mismos nombres y las mismas
 * promesas. Quien migra desde el fichero solo tiene que cambiar lo de abajo;
 * `api/[...ruta].js` no se entera.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CABECERA = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };

/** Sin base de datos configurada se usa el fichero. Ver cabecera del módulo. */
const haySupabase = Boolean(URL_BASE && SERVICE);

const CUENTAS = new URL('../data/usuarios.json', import.meta.url);
const SESIONES = new URL('../data/sesiones.json', import.meta.url);
/** Caducidad por defecto de una sesión. La cookie dice lo mismo. */
const DIAS = 30;

/**
 * Una consulta a Supabase. Lanza si la respuesta no es 2xx, y devuelve `null`
 * cuando no hay filas: pedir un rango vacío da 406, y lo que interesa es «no
 * está», no un error.
 *
 * Lleva reloj porque una llamada a la red que se queda colgada tumba la
 * petición entera, y aquí no hay cola que la absorba. Treinta segundos es de
 * sobra para un `GET` de una fila.
 */
async function consultar(destino, params) {
  const r = await pedir(`${URL_BASE}/rest/v1/${destino}?${params}`, {
    headers: { ...CABECERA, prefer: 'return=representation' },
  });
  if (r.status === 404 || r.status === 406) return null;
  if (!r.ok) throw new Error(`Supabase ${destino}: ${r.status} ${await r.text()}`);
  const datos = await r.json();
  return Array.isArray(datos) ? datos[0] ?? null : datos;
}

async function insertar(tabla, cuerpo) {
  const r = await pedir(`${URL_BASE}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: { ...CABECERA, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`Supabase ${tabla}: ${r.status} ${await r.text()}`);
  const datos = await r.json();
  return Array.isArray(datos) ? datos[0] ?? null : datos;
}

async function borrar(tabla, params) {
  const r = await pedir(`${URL_BASE}/rest/v1/${tabla}?${params}`, {
    method: 'DELETE',
    headers: CABECERA,
  });
  // 204 es lo normal; con `count=exact` también vale un 200 con lista vacía.
  if (!r.ok && r.status !== 204) {
    throw new Error(`Supabase ${tabla}: ${r.status} ${await r.text()}`);
  }
  return true;
}

/**
 * `fetch` con reloj.
 *
 * El reloj se quita cuando llegan las cabeceras, no cuando termina el cuerpo.
 * Una respuesta que abre la conexión y luego se atasca al mandar el JSON —que
 * es justo lo que hace un WAF cuando no quiere atender a alguien— deja el
 * `fetch` colgado para siempre si no se corta también la lectura del cuerpo.
 */
async function pedir(url, opciones, ms = 30000) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opciones, signal: ctrl.signal });
    return r;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Supabase: no respondió en ${ms} ms`);
    throw err;
  } finally {
    clearTimeout(reloj);
  }
}

/* ── Fichero ─────────────────────────────────────────────────────────────── */

async function leer(ruta) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Escritura atómica: se escribe a un temporal y se renombra. Sin esto, si el
 * proceso muere a mitad de una escritura, el fichero queda truncado y se
 * pierden todas las cuentas de golpe.
 */
async function volcar(ruta, datos) {
  const tmp = new URL(ruta.href.replace(/\.json$/, '.tmp.json'));
  await writeFile(tmp, JSON.stringify(datos, null, 1));
  await rename(tmp, ruta);
}

/* ── Interfaz ────────────────────────────────────────────────────────────── */

function clave(correo) {
  return String(correo ?? '').toLowerCase().trim();
}

/**
 * Un valor para la gramática de filtros de PostgREST.
 *
 * El parser parte la consulta por puntos y comas: `correo=eq.ana@x.com` se lee
 * como columna `correo`, operador `eq`, valor `ana@x.com`. Un correo con más
 * puntos —`ana.maria@x.com`, que es un correo perfectamente normal— introduce
 * puntos que el parser interpreta como separadores de operador, y la consulta
 * se rompe con un 400 que el visitante ve como «el registro no está
 * disponible».
 *
 * Entrecomillado, un punto deja de ser separador. Y como `encodeURIComponent`
 * deja fuera `! * ' ( ) - _ . ~`, las comillas dobles nunca llegan crudas:
 * salen como `%22`, que es justamente cómo se escapan dentro de una cadena.
 * Así que el entrecomillado no se puede romper desde fuera.
 */
function valor(v) {
  return encodeURIComponent(v);
}

export async function crear(correo, hash, salt) {
  const cuerpo = { correo: clave(correo), hash, salt, creado: new Date().toISOString() };

  if (haySupabase) {
    // 409 es la violación de la clave única: ya hay una cuenta con ese correo.
    // No es un fallo del alta, es el contrato, y por eso devuelve `null` en
    // vez de lanzar —que es lo que espera quien llama.
    const r = await fetch(`${URL_BASE}/rest/v1/cuentas`, {
      method: 'POST',
      headers: { ...CABECERA, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify(cuerpo),
    });
    if (r.status === 409) return null;
    if (!r.ok) throw new Error(`Supabase cuentas: ${r.status} ${await r.text()}`);
    const datos = await r.json();
    return Array.isArray(datos) ? datos[0] ?? null : datos;
  }

  const d = await leer(CUENTAS);
  if (d[cuerpo.correo]) return null;
  const u = { id: randomUUID(), ...cuerpo };
  d[cuerpo.correo] = u;
  await volcar(CUENTAS, d);
  return u;
}

export async function buscar(correo) {
  if (haySupabase) {
    return consultar('cuentas', `correo=eq.${valor(clave(correo))}&select=*`);
  }
  return (await leer(CUENTAS))[clave(correo)] ?? null;
}

/**
 * Anota en la cuenta de dónde ha llegado quien se registra.
 *
 * Es un dato del sitio, no del navegador: en `localStorage` no serviría para
 * nada —no se puede contar desde fuera— así que vive en `cuentas`, igual que
 * el correo. Una respuesta por cuenta, la primera vez que se pregunta.
 *
 * Devuelve `false` si la cuenta no está, que aquí no es un error: alguien
 * pudo borrarla entre la respuesta y este `PATCH`, y perder una respuesta no
 * puede tumbar nada.
 */
export async function guardarOrigen(correo, origen) {
  const c = clave(correo);
  const cuando = new Date().toISOString();

  if (haySupabase) {
    const r = await pedir(`${URL_BASE}/rest/v1/cuentas?correo=eq.${valor(c)}`, {
      method: 'PATCH',
      headers: { ...CABECERA, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ origen, origen_en: cuando }),
    });
    // PostgREST contesta 404 cuando se pide la representación y el filtro no
    // toca ninguna fila; con lista vacía también se lee como «no está». Ni
    // una cosa ni la otra son un fallo que haya que propagar.
    if (r.status === 404 || r.status === 406) return false;
    if (!r.ok) throw new Error(`Supabase cuentas: ${r.status} ${await r.text()}`);
    const datos = await r.json();
    return Boolean(Array.isArray(datos) ? datos[0] : datos);
  }

  const d = await leer(CUENTAS);
  if (!d[c]) return false;
  d[c].origen = origen;
  d[c].origen_en = cuando;
  await volcar(CUENTAS, d);
  return true;
}

export async function guardarToken(correo, token, dias = DIAS) {
  const c = clave(correo);
  const expira = new Date(Date.now() + dias * 864e5).toISOString();

  if (haySupabase) {
    if (!(await buscar(c))) return false;
    await insertar('sesiones', { token, correo: c, expira });
    return true;
  }

  const d = await leer(CUENTAS);
  if (!d[c]) return false;
  const s = await leer(SESIONES);
  s[token] = { correo: c, expira };
  await volcar(SESIONES, s);
  return true;
}

export async function porToken(token) {
  if (!token) return null;

  if (haySupabase) {
    // La caducidad se filtra en la consulta y no con un cron que la limpie: un
    // token caducado ya no da ninguna sesión, y borrarlo aparte es un proceso
    // más que mantener vivo sin cambiar nada de lo que ve nadie.
    const s = await consultar('sesiones',
      `token=eq.${valor(token)}&expira=gt.${new Date().toISOString()}&select=correo`);
    return s ? buscar(s.correo) : null;
  }

  const s = (await leer(SESIONES))[token];
  if (!s || s.expira <= new Date().toISOString()) return null;
  return (await leer(CUENTAS))[s.correo] ?? null;
}

export async function quitarToken(token) {
  if (!token) return false;

  if (haySupabase) {
    return borrar('sesiones', `token=eq.${valor(token)}`);
  }

  const s = await leer(SESIONES);
  if (!s[token]) return false;
  delete s[token];
  await volcar(SESIONES, s);
  return true;
}

/**
 * Borra la cuenta, y con ella la sesión que la pidió.
 *
 * Solo quien tiene sesión abierta puede llegar aquí —la ruta comprueba el
 * token— y además la web exige escribir el correo de la cuenta a mano antes
 * de mandar nada: una acción que no tiene vuelta atrás no puede vivir a un
 * clic de distancia.
 *
 * En Supabase el `on delete cascade` de la clave ajena borra las sesiones
 * junto con la fila; en el modo fichero hay que recorrerlas a mano, porque el
 * JSON no tiene cascadas.
 */
export async function borrarCuenta(correo) {
  const c = clave(correo);

  if (haySupabase) {
    // PostgREST contesta 204 aunque el filtro no haya tocado ninguna fila:
    // sin mirar antes no hay forma de saber si la cuenta existía, y una
    // consulta más por algo irreversible y raro no pesa. La ruta que llama no
    // usa el dato —acaba cerrando la sesión igual—, pero el bucle promete lo
    // mismo en los dos modos y el test lo mantiene.
    if (!await buscar(c)) return false;
    return borrar('cuentas', `correo=eq.${valor(c)}`);
  }

  const d = await leer(CUENTAS);
  if (!d[c]) return false;
  delete d[c];
  await volcar(CUENTAS, d);

  const s = await leer(SESIONES);
  const quedan = Object.entries(s).filter(([, v]) => v.correo !== c);
  await volcar(SESIONES, Object.fromEntries(quedan));
  return true;
}