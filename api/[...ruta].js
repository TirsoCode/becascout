/**
 * auth.js — Rutas de autenticación.
 *
 * Corre con `node:http` sin framework, para no meter Express solo por esto.
 * En Vercel se despliega como función y el resto del proyecto no sabe si hay
 * servidor o no.
 *
 * ── El `export default` no es negociable ───────────────────────────────────
 *
 * Vercel invoca la **exportación por defecto** del módulo. Con
 * `export function handler` —que es lo que parece natural y lo que `serve.mjs`
 * aceptaba sin problema— el despliegue se construye bien, sale `Ready`, la web
 * carga… y la API devuelve `FUNCTION_INVOCATION_FAILED` en todas las rutas.
 * El error real solo aparece en los logs de la función:
 *
 *     Invalid export found in module "/var/task/api/[...ruta].js".
 *     The default export must be a function or server.
 *
 * Es decir: un despliegue verde que no sirve ni un endpoint. Pasó en producción
 * el 17 de octubre de 2026.
 *
 * ── Sobre el nombre del fichero ────────────────────────────────────────────
 *
 * `[...ruta].js` es lo que hace que las nueve rutas (`/api/registro`,
 * `/api/login`, `/api/yo`…) lleguen al mismo handler. Vercel mapea cada
 * fichero de `api/` a su propia ruta, así que un `api/auth.js` solo
 * respondería en `/api/auth` y lo demás caería en un 404. Con el comodín,
 * `store.js` puede vivir en `lib/` y no se despliega como función aparte.
 *
 * ── Sobre `registro-google`: el token se verifica aquí ────────────────────
 *
 * Esta rutaSOLO aceptaba un `{ correo }` que el navegador declaraba. Eso no es
 * iniciar sesión, es escribir a quién te apetece: un `curl` con
 * `{"correo":"el.correo.de.otro@ejemplo.com"}` recibía una cookie de sesión
 * válida de treinta días sin ninguna credencial. Se comprobó en producción el
 * 17 de octubre de 2026: `POST /api/registro-google` con un correo inventado
 * devolvió `200` y `Set-Cookie`, y esa cookie pasó `/api/yo`.
 *
 * El motivo de fondo es que el navegador nunca es una fuente de confianza:
 * quien llama a esta ruta puede ser la página o un `curl`. El correo tiene que
 * salir de quien ha autenticado de verdad, así que ahora el cliente manda el
 * token y el servidor pregunta a Google o a Supabase quién lo es. Si no se
 * puede comprobar, no hay cuenta.
 *
 * ── Sobre el hash ────────────────────────────────────────────────────────
 *
 * scrypt con un salt por usuario. No es MD5 ni SHA-256 pelado — esos se
 * rompen con una GPU. scrypt es intencionadamente lento y de memoria
 *fangosa, que es justo lo que se quiere en un hash de contraseña. Se usa el
 * de la librería estándar (`node:crypto`), así que ni una dependencia.
 *
 * ── Sobre el timing ───────────────────────────────────────────────────────
 *
 * Dos errores que hay que evitar:
 *
 *  1. Comparar el hash con `===` filtra información por tiempo de ejecución.
 *     Siempre `timingSafeEqual`.
 *  2. Devolver «ese correo no existe» en el login regala una forma de saber
 *     qué correos están dados de alta. El login dice «correo o contraseña
 *     incorrectos» siempre, y hace el hash igual en los dos casos para que el
 *     tiempo tampoco lo delate.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { crear, buscar, guardarOrigen, guardarToken, porToken, quitarToken, borrarCuenta,
  cambiarAvisos, correosConAvisos, avisosEnviados, guardarAvisos } from '../lib/store.js';

const scryptAsync = promisify(scrypt);

const LLAVE = 64;          // bytes de hash
const OPS = { N: 16384, r: 8, p: 1 };  // coste; subir OPS = más lento y más seguro
const COOKIE = 'bs_sesion';
const DIAS = 30;

async function hash(password, salt) {
  const buf = await scryptAsync(password.normalize('NFKC'), salt, LLAVE, OPS);
  return buf.toString('base64');
}

function seguro(a, b) {
  const ba = Buffer.from(a ?? '', 'base64');
  const bb = Buffer.from(b ?? '', 'base64');
  // Si las longitudes no casan, timingSafeEqual lanza. Comparamos el_sizes
  // de todos modos para no filtrar por excepción.
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function cookie(valor, maxAge) {
  // httpOnly: el JavaScript de la página no lo lee, así que un XSS no puede
  // robar la sesión. SameSite=Lax: el navegador no lo manda en peticiones
  // venidas de otro sitio, lo que neutraliza el CSRF de un formulário.
  const partes = [
    `${COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === 'production') partes.push('Secure');
  return partes.join('; ');
}

function leerCookie(cabecera) {
  return (cabecera ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

/* ── Validación ─────────────────────────────────────────────────────────── */

/**
 * Un correo es un correo, en minúsculas y sin espacios.
 *
 * Sin esto `Ana@ejemplo.com` y `ana@ejemplo.com` son dos cuentas distintas:
 * quien se da de alta con mayúsculas no puede volver a entrar escribiendo su
 * dirección en minúsculas, y el mismo correo puede quedar registrado dos
 * veces. Aquí solo hacen falta `trim` y `toLowerCase`.
 */
function normaliza(c) {
  return typeof c === 'string' ? c.trim().toLowerCase() : '';
}

/**
 * `fetch` con reloj. Una llamada a Google o Supabase que se queda colgada no
 * puede tener en pie la petición: en un entorno serverless el runtime mata la
 * función a los 10-15 segundos y el cliente se queda esperando.
 */
async function conTimeout(url, opciones, ms) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opciones, signal: ctrl.signal });
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * El patrón es deliberadamente más estrecho que el de RFC 5322, que es un
 * documento de 1982 y acepta casi cualquier cosa. Aquí no hace falta aceptar
 * `Ana" Lopez <a@b.com>`: si un correo lleva comillas, ángulos o espacios es
 * que algo va mal, y además ese texto acaba pintado en la web.
 */
function correoValido(c) {
  const s = normaliza(c);
  return typeof c === 'string'
    && s.length <= 254
    && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s);
}

function politica(c) {
  return typeof c === 'string' && c.length >= 10;
}

/**
 * Lee el cuerpo de la petición, con un techo.
 *
 * Sin el techo, `for await (const t of req)` acepta tanto como le manden y lo
 * acumula en memoria: un `POST` con un cuerpo de un gigabyte tumba la función
 * con un OOM antes de llegar al `catch`. Un formulario de alta no pasa de un
 * kilobyte, así que 16 KB es holgado de sobra.
 */
async function cuerpo(req, tope = 16 * 1024) {
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > tope) {
      const err = new Error('cuerpo demasiado grande');
      err.codigo = 413;
      throw err;
    }
    trozos.push(t);
  }
  if (!trozos.length) return {};
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8'));
  } catch {
    return {};
  }
}

function json(res, codigo, datos, cabeceras = {}) {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', ...cabeceras });
  res.end(JSON.stringify(datos));
}

/* ── Rutas ──────────────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname.replace(/^\/api\/?/, '');

  try {
    if (ruta === 'registro' && req.method === 'POST') return await registro(req, res);
    if (ruta === 'registro-google' && req.method === 'POST') return await registroGoogle(req, res);
    if (ruta === 'login' && req.method === 'POST') return await login(req, res);
    if (ruta === 'salir' && req.method === 'POST') return await salir(req, res);
    if (ruta === 'yo' && req.method === 'GET') return await yo(req, res);
    if (ruta === 'cuenta' && req.method === 'DELETE') return await borrarCuentaRuta(req, res);
    if (ruta === 'origen' && req.method === 'POST') return await anotarOrigen(req, res);
    if (ruta === 'avisos' && req.method === 'POST') return await cambiarAvisosRuta(req, res);
    if (ruta === 'cron-avisos' && req.method === 'GET') return await cronAvisos(req, res);
    if (ruta === 'config' && req.method === 'GET') return await config(req, res);

    json(res, 404, { error: 'ruta desconocida' });
  } catch (err) {
    // Un cuerpo que pasa del techo no es un fallo de la web: es 413, no un 503
    // que le dice al visitante que vuelva más tarde sin explicarle qué pasó.
    if (err?.codigo === 413) {
      return json(res, 413, { error: 'La petición es demasiado grande.' });
    }

    // Sin `SUPABASE_URL` el almacén cae al fichero JSON, y en Vercel el disco
    // es de solo lectura: todo alta de cuenta revienta con EROFS. Sin este
    // `catch`, quien lo sufre ve la página de error de Vercel con un stack
    // trace dentro —que además se lleva por delante el nombre de la variable
    // que falta—. Se responde en JSON y con un texto que se puede enseñar.
    console.error('api:', ruta, err.message);
    json(res, 503, {
      error: 'El registro de cuentas no está disponible ahora mismo. Inténtalo más tarde.',
    });
  }
}

/**
 * Alta de una cuenta que se valida con Google.
 *
 * El cliente manda `token`, no `correo`. El correo se deduce del token contra
 * Google o Supabase, nunca de lo que diga el navegador.
 *
 * Se genera una contraseña aleatoria que no se le enseña a nadie. Es una
 * contraseña de servicio: existe para que la fila tenga un hash consistente
 * y no un hueco, y no sirve para entrar — entrar es con Google.
 *
 * Si la cuenta ya existe no se toca. Eso importa: si alguien entra con
 * Google, borra la cookie y vuelve a entrar, no debe perder su perfil ni ver
 * su contraseña sustituida por otra.
 */
async function registroGoogle(req, res) {
  const { token } = await cuerpo(req);
  if (typeof token !== 'string' || !token.trim()) {
    return json(res, 400, { error: 'Falta el token de acceso.' });
  }

  const correo = await correoDeToken(token.trim());
  if (!correo) {
    return json(res, 401, { error: 'No hemos podido comprobar tu sesión con Google.' });
  }

  let usuario = await buscar(correo);
  let nuevo = false;
  if (!usuario) {
    const salt = randomBytes(16).toString('base64');
    const hashPass = await hash(randomBytes(32).toString('base64'), salt);
    usuario = await crear(correo, hashPass, salt);
    // `crear` devuelve null si otra petición dio de alta el mismo correo en
    // paralelo; en ese caso la cuenta ya existía y tampoco es un alta nueva.
    nuevo = Boolean(usuario);
  }

  const tokenSesion = randomBytes(32).toString('base64url');
  await guardarToken(usuario.correo, tokenSesion);

  // `nuevo` es lo que decide si la web enseña la encuesta de llegada: se
  // pregunta al crear la cuenta, no cada vez que alguien entra con Google.
  json(res, 200, { ok: true, correo: usuario.correo, nuevo }, {
    'Set-Cookie': cookie(tokenSesion, DIAS * 24 * 60 * 60),
  });
}

/**
 * Dice qué correo es ese token, o `null` si no se puede saber.
 *
 * Hay dos formatos porque hay dos flujos en marcha, y cada uno se valida
 * contra quien lo emitió:
 *
 *  - Un **JWT de Supabase** (tres trozos separados por puntos) se pregunta a
 *    `GET /auth/v1/user` de Supabase. Supabase comprueba la firma; aquí solo
 *    se lee el `email` que devuelve.
 *  - Un **access token de Google** —el que da Google Identity Services— se
 *    pregunta a `tokeninfo`, que es la forma canónica de validarlo.
 *
 * En los dos casos quien responde es el proveedor, no el cliente. Cualquier
 * otro formato devuelve `null` y la ruta responde 401.
 */
async function correoDeToken(token) {
  // ── JWT de Supabase ──
  if (token.split('.').length === 3) {
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      console.error('registro-google: falta SUPABASE_URL o SUPABASE_ANON_KEY');
      return null;
    }
    try {
      const r = await conTimeout(`${url}/auth/v1/user`, {
        headers: { apikey: anon, authorization: `Bearer ${token}` },
      }, 8000);
      if (!r.ok) return null;
      return normaliza((await r.json())?.email);
    } catch (err) {
      console.error('registro-google: Supabase no respondió:', err.message);
      return null;
    }
  }

  // ── Access token de Google ──
  try {
    const r = await conTimeout(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
      {},
      8000,
    );
    if (!r.ok) return null;
    const d = await r.json();

    // `email_verified` llega como cadena. Sin comprobarlo, una cuenta de Google
    // con el correo sin confirmar podría quedarse con la dirección de otra
    // persona —y esa fila es la que luego se le devuelve a quien entre.
    if (String(d?.email_verified) !== 'true') return null;

    // Que el token se emitió para *nuestra* app. No es imprescindible: el
    // token sigue atado a la cuenta de Google que lo concedió, así que no
    // permite hacerse pasar por nadie. Es defensa en profundidad, y solo
    // funciona si la variable está puesta; si falta, se avisa por log en vez
    // de dejar que la comprobación parezca activa cuando no lo está.
    const esperado = process.env.GOOGLE_CLIENT_ID;
    if (esperado && d?.aud !== esperado) {
      console.error('registro-google: el token es de otra aplicación de Google');
      return null;
    }
    if (!esperado) {
      console.error('registro-google: falta GOOGLE_CLIENT_ID, no se puede comprobar el `aud`');
    }

    return normaliza(d?.email);
  } catch (err) {
    console.error('registro-google: Google no respondió:', err.message);
    return null;
  }
}

async function registro(req, res) {
  const { correo, password } = await cuerpo(req);
  const mail = normaliza(correo);

  if (!correoValido(mail)) return json(res, 400, { error: 'El correo no es válido.' });
  if (!politica(password)) {
    return json(res, 400, { error: 'La contraseña necesita al menos 10 caracteres.' });
  }

  const salt = randomBytes(16).toString('base64');
  const hashPass = await hash(password, salt);

  const usuario = await crear(mail, hashPass, salt);
  if (!usuario) {
    return json(res, 409, { error: 'Ya hay una cuenta con ese correo.' });
  }

  const token = randomBytes(32).toString('base64url');
  await guardarToken(usuario.correo, token);

  json(res, 201, { ok: true }, {
    'Set-Cookie': cookie(token, DIAS * 24 * 60 * 60),
  });
}

async function login(req, res) {
  const { correo, password } = await cuerpo(req);
  const usuario = await buscar(normaliza(correo));

  // Se hashea **siempre dos veces**, haya cuenta o no. La cuenta que existe usa
  // su propio salt y la que no, uno de mentira; las dos ramas hacen el mismo
  // trabajo.
  //
  // Antes solo se hacía el hash de relleno cuando el correo no estaba en la
  // base, así que un login correcto gastaba un scrypt y uno con correo
  // inexistente gastaba dos: medido en este repositorio, 325 ms frente a 846
  // ms. Eso es una diferencia de 2,6× que se lee desde fuera con unas pocas
  // peticiones y permite enumerar qué correos están dados de alta, que es
  // justo lo que el comentario de este fichero dice que hay que evitar.
  const saltReal = usuario?.salt ?? 'falsofalsofalsofalso';
  const [calculado, relleno] = await Promise.all([
    hash(password ?? '', saltReal),
    // El relleno se calcula siempre. Cuando el usuario existe, no se compara
    // con nada: solo se pierde el tiempo.
    hash('relleno', saltReal),
  ]);

  const referencia = usuario?.hash ?? relleno;
  const coincide = seguro(referencia, calculado);
  if (!usuario || !coincide) {
    return json(res, 401, { error: 'Correo o contraseña incorrectos.' });
  }

  const token = randomBytes(32).toString('base64url');
  await guardarToken(usuario.correo, token);

  json(res, 200, { ok: true }, {
    'Set-Cookie': cookie(token, DIAS * 24 * 60 * 60),
  });
}

async function salir(req, res) {
  const token = leerCookie(req.headers.cookie);
  if (token) await quitarToken(token);
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
}

/**
 * Configuración pública para el navegador.
 *
 * Se devuelve lo justo para que el login con Google funcione y nada más. La
 * `anon key` de Supabase es pública por diseño — lo que protege las tablas son
 * las reglas de Postgres, no la clave — pero sigue siendo mejor servirla
 * desde aquí que escribirla en el HTML: si mañana se rota la clave, se cambia
 * en un sitio y no en cuatro ficheros.
 *
 * La `service_role` nunca sale de aquí. No se lee, no se responde y no se
 * registra en ningún sitio.
 */
async function config(req, res) {
  json(res, 200, {
    url: process.env.SUPABASE_URL ?? '',
    anon: process.env.SUPABASE_ANON_KEY ?? '',
    googleId: process.env.GOOGLE_CLIENT_ID ?? '',
  });
}

async function yo(req, res) {
  const token = leerCookie(req.headers.cookie);
  const usuario = await porToken(token);
  if (!usuario) return json(res, 401, { error: 'sin sesión' });
  // El aviso es opt-out: solo un `false` escrito a propósito lo apaga. Con
  // `!== false` las cuentas anteriores a la columna —y el modo fichero—
  // cuentan como activas, igual que la migración 0003 (`default true`).
  json(res, 200, { correo: usuario.correo, avisos: Boolean(usuario.avisos !== false) });
}

/**
 * Borrar la cuenta de quien tiene la sesión abierta.
 *
 * Irreversible, así que no vale con estar dentro: el cuerpo tiene que traer
 * `confirmar` con la dirección de la cuenta escrita a mano. Si un clic
 * accidental no tuviera ese trámite, una rúa en el móvil haría lo que nunca
 * se puede deshacer.
 *
 * Funciona igual para cuentas de Google, que llevan una contraseña de
 * servicio que su dueño no conoce: pedir una contraseña aquí las dejaría sin
 * salir. La confirmación vale para todos los tipos de cuenta.
 */
async function borrarCuentaRuta(req, res) {
  const token = leerCookie(req.headers.cookie);
  const usuario = await porToken(token);
  if (!usuario) return json(res, 401, { error: 'sin sesión' });

  const { confirmar: dicho } = await cuerpo(req);
  if (normaliza(dicho) !== usuario.correo) {
    return json(res, 400, { error: 'Escribe tu dirección de correo para confirmar.' });
  }

  await borrarCuenta(usuario.correo);
  if (token) await quitarToken(token);
  json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
}

/**
 * La encuesta de llegada: de dónde ha conocido la web quien acaba de
 * registrarse.
 *
 * Hay lista cerrada de respuestas, y aunque la web solo ofrezca esas siete, el
 * filtro está aquí: el navegador nunca es una fuente de confianza —por esta
 * misma ruta, sin filtro, un `curl` podría escribir cualquier cosa en la fila
 * de su cuenta, y esa columna es la que luego se lee para decidir cosas del
 * producto—. Si mañana se añade una opción, se añade en `ORIGENES` y en la
 * web, y nada más.
 *
 * Se contesta una vez y se puede pasar; no hay respuesta obligatoria.
 */
const ORIGENES = new Set(['chatgpt', 'claude', 'instagram', 'tiktok', 'youtube', 'reddit', 'amigo']);

async function anotarOrigen(req, res) {
  const usuario = await porToken(leerCookie(req.headers.cookie));
  if (!usuario) return json(res, 401, { error: 'sin sesión' });

  const { origen: respuesta } = await cuerpo(req);
  const o = normaliza(respuesta);
  if (!ORIGENES.has(o)) {
    return json(res, 400, { error: 'Esa respuesta no está en la lista.' });
  }

  await guardarOrigen(usuario.correo, o);
  json(res, 200, { ok: true });
}

/* ── Avisos de plazo ─────────────────────────────────────────────────────── */

/**
 * La cuenta existe para avisar cuando se acerca un plazo —la promesa del FAQ
 * de la portada—. Del aviso salen dos piezas: `/api/avisos`, el interruptor
 * que la página de cuenta enciende y apaga, y `/api/cron-avisos`, la pasada
 * diaria que manda los correos.
 *
 * La programación del cron está en `vercel.json` con `"15 7 * * *"` (07:15
 * UTC = 08:15 Madrid en invierno). Va explicada aquí porque `vercel.json` es
 * JSON y no admite comentarios.
 *
 * Sobre la autorización: cuando la variable `CRON_SECRET` está definida,
 * Vercel manda `Authorization: Bearer <secret>` en cada invocación
 * programada —es la forma documentada de cerrar un endpoint de cron—. Si la
 * variable no está, la ruta queda abierta y se avisa por log sin romper,
 * igual que con el `aud` de Google: mejor un cron accesible que un cron
 * muerto por un secreto sin estrenar. Una llamada ajena fuerza, como mucho,
 * una pasada de más; la fila de `avisos` solo se escribe tras un envío real.
 */
const DIAS_AVISO = 7;

/**
 * Dos techos, y por lo mismo: un correo con 85 enlaces no se lee y una
 * pasada que intentara dos mil envíos tumba la función de Vercel. Lo que se
 * sale del techo no se marca como enviado —sigue pendiente—, así que lo
 * cortado reparte su trabajo entre las pasadas siguientes. No son
 * constantes de diseño, son de caída.
 */
const TOPE_CORREO = 10;
const TOPE_ENVIOS = 50;

/**
 * El interruptor del aviso: un clic en la página de cuenta.
 *
 * Sesión obligatoria, patrón de `borrarCuentaRuta`: toca la fila de la
 * cuenta. `activar` debe ser booleano estricto: el navegador manda el estado
 * del interruptor, y un «true» como cadena es un bug del front, no un estado
 * —grabado tal cual se va a la columna, el filtro `avisos=eq.true` del cron
 * no lo encuentra y la cuenta dejaría de recibir avisos en silencio.
 */
async function cambiarAvisosRuta(req, res) {
  const usuario = await porToken(leerCookie(req.headers.cookie));
  if (!usuario) return json(res, 401, { error: 'sin sesión' });

  const { activar } = await cuerpo(req);
  if (typeof activar !== 'boolean') {
    return json(res, 400, { error: 'Hace falta «activar»: true o false.' });
  }

  // `cambiarAvisos` devuelve `false` cuando la fila no está: alguien pudo
  // borrar la cuenta entre la comprobación de sesión y este `PATCH`. No es
  // un fallo, pero **no se puede contestar `ok`**: el interruptor se
  // pondría como dice el navegador y el servidor no tiene esa fila. Se
  // responde con un error y el front vuelve al estado de antes.
  const guardado = await cambiarAvisos(usuario.correo, activar);
  if (!guardado) {
    return json(res, 404, { error: 'La cuenta ya no existe.' });
  }

  json(res, 200, { ok: true, avisos: activar });
}

/**
 * «Hoy», en Madrid.
 *
 * Los plazos son de España, y que el runtime corra en UTC —lo normal en
 * Vercel— no puede cambiar la ventana: a las 01:00 de Madrid, un «hoy»
 * calculado en UTC aún es ayer.
 *
 * La fecha se monta con `formatToParts` y no con `format`: el resultado de
 * `format` depende del **patrón de la configuración regional**, y una ICU
 * que no conociera `en-CA` devolvería «10/20/2026». Con ese formato,
 * `hoy.split('-')` da `NaN` y `fechaDe` revienta con un `RangeError` —la
 * fecha es un `Invalid Date` y `toISOString` no puede con él—. Las partes
 * llevan su tipo (`year`, `month`, `day`), así que el orden no depende de
 * nadie.
 */
function hoyMadrid() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const de = (tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${de('year')}-${de('month')}-${de('day')}`;
}

/**
 * AAAA-MM-DD más `dias` días.
 *
 * El salto se hace en `Date.UTC` y se vuelve a formato: sumar a un objeto
 * `Date` con la zona del runtime (UTC en Vercel, la local en tu máquina)
 * desborda el mes con un día de desfase.
 */
function fechaDe(hoy, dias) {
  const [a, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function diasRestantes(cierra, hoy) {
  const [a1, m1, d1] = cierra.split('-').map(Number);
  const [a2, m2, d2] = hoy.split('-').map(Number);
  return Math.round((Date.UTC(a1, m1 - 1, d1) - Date.UTC(a2, m2 - 1, d2)) / 864e5);
}

function plazo(cierra, hoy) {
  const dias = diasRestantes(cierra, hoy);
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

function fechaHumana(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Un título del BOE lleva `&` y puede llevar `<`: se escapa, siempre. */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Las convocatorias que cierran en la ventana de `hoy`, la más urgente
 * primera.
 *
 * - **Las fechas comparan como cadenas.** AAAA-MM-DD se ordena
 *   lexicográficamente igual que cronológicamente; con `Date` habría una
 *   conversión más y una zona horaria de por medio.
 * - **La fecha manda, no `cerrada`.** El campo viene del día en que se
 *   generó la base y puede mentir: hay ficha marcada cerrada que sigue
 *   abierta, y la Comisión marcaba «abierta» un plazo de 2023. El cron saca
 *   el suyo de `cierra`, que es el dato del documento.
 * - **Sin `id` o sin título, fuera.** Sin `id` no hay (correo, beca) que
 *   deduplicar y la ficha volvería en cada pasada; una ficha sin
 *   identificador es datos rotos, no una ficha más.
 */
function seleccionar(becas, hoy) {
  const limite = fechaDe(hoy, DIAS_AVISO);
  const porId = new Map();
  for (const b of Array.isArray(becas) ? becas : []) {
    if (
      typeof b?.id === 'string' && b.id
      && typeof b?.titulo === 'string' && b.titulo
      && typeof b?.cierra === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(b.cierra)
      && b.cierra >= hoy
      && b.cierra <= limite
    ) {
      porId.set(b.id, b);
    }
  }
  return [...porId.values()].sort((x, y) => (x.cierra < y.cierra ? -1 : x.cierra > y.cierra ? 1 : 0));
}

/**
 * Redacta el correo. No inventa ningún dato: título, fecha de cierre,
 * enlace y los días restantes calculados sobre la fecha del documento. Sin
 * porcentaje de encaje ni tinte personal: son fechas, no probabilidades
 * —ver «El otro límite» de AGENTS.md—.
 *
 * Devuelve también `anunciadas` porque lo que se marca en `avisos` es lo
 * que el correo efectivamente lista. Lo que queda detrás del tope de 10 es
 * un recuento («y N más»), no lo avisado: el día siguiente sube en la cola
 * —lo ya marcado no participa— y sale nombrado con su enlace. Si se
 * marcaran todos, lo cortado jamás aparecería; el caso límite, una ficha
 * fuera del tope que cierra ese mismo día, queda avisada por recuento y ya
 * está.
 */
function redactar(fichas, hoy, base) {
  const anunciadas = fichas.slice(0, TOPE_CORREO);
  const restantes = fichas.length - anunciadas.length;

  const encabezado = fichas.length === 1
    ? '1 convocatoria cierra esta semana'
    : `${fichas.length} convocatorias cierran esta semana`;

  const mas = restantes > 0
    ? `<p style="font-size:14px;color:#6b6559;margin:12px 0 0;">y ${restantes} más, en <a href="${esc(base)}/becas.html" style="color:#12463A;">becas.html</a></p>`
    : '';

  const filas = anunciadas.map((b) => [
    '<tr>',
    '<td style="padding:16px 0;border-bottom:1px solid #ddd6c8;">',
    b.url
      ? `<div style="font-size:16px;line-height:1.45;"><a href="${esc(b.url)}" style="color:#12463A;">${esc(b.titulo)}</a></div>`
      : `<div style="font-size:16px;line-height:1.45;">${esc(b.titulo)}</div>`,
    `<div style="font-size:14px;color:#6b6559;padding-top:4px;">Cierra el ${fechaHumana(b.cierra)} — ${plazo(b.cierra, hoy)}</div>`,
    '</td>',
    '</tr>',
  ].join('')).join('');

  const html = '<div style="font-family:Arial,sans-serif;"><div style="max-width:560px;margin:0 auto;padding:16px 0;">'
    + '<p style="font-size:13px;color:#6b6559;margin:0 0 6px;">BecasScout</p>'
    + `<h1 style="font-size:20px;line-height:1.3;color:#1c1a16;margin:0 0 16px;">${esc(encabezado)}</h1>`
    + `<table style="width:100%;border-collapse:collapse;" role="presentation">${filas}</table>`
    + mas
    + '<p style="font-size:14px;line-height:1.5;color:#6b6559;margin:16px 0 0;">'
    + `<a href="${esc(base)}/becas.html" style="color:#12463A;">Todas las becas</a><br>`
    + 'Los avisos se quitan en tu cuenta, en la misma página.'
    + '</p></div></div>';

  const texto = [
    `BecasScout — ${encabezado}`,
    '',
    ...anunciadas.map((b, i) => {
      const trozos = [
        `${i + 1}. ${b.titulo}`,
        `   Cierra el ${fechaHumana(b.cierra)} (${plazo(b.cierra, hoy)})`,
      ];
      if (b.url) trozos.push(`   Enlace: ${b.url}`);
      return trozos.join('\n');
    }),
    ...(restantes > 0 ? ['', `y ${restantes} más, en ${base}/becas.html`] : []),
    '',
    `Todas las becas: ${base}/becas.html`,
    'Los avisos se quitan en tu cuenta, en la misma página.',
  ].join('\n');

  return { asunto: `BecasScout: ${encabezado}`, html, texto, anunciadas };
}

/**
 * Compara dos secretos sin que el tiempo de la respuesta los delate.
 *
 * `===` devuelve en cuanto encuentra la primera diferencia, así que con la
 * cabecera `Authorization` se puede medir cuánto tarda en fallar y sacar el
 * secreto del cron carácter a carácter. La cuenta ya usa `timingSafeEqual`
 * para las contraseñas; el secreto del cron es la misma clase de dato, y
 * cuesta lo mismo tratarlo bien.
 */
function mismoSecreto(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  // `timingSafeEqual` exige la misma longitud: sin esta comprobación
  // lanzaría, y la excepción también mide.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * `fetch` con reloj que cubre también la lectura del cuerpo.
 *
 * `conTimeout` quita el reloj cuando llegan las cabeceras. Para una API que
 * contesta con un cuerpo corto da igual, pero la base son cientos de
 * kilobytes y una conexión que se abre y luego se atasca al mandar el JSON
 * —justo lo que hace un WAF cuando no quiere atender a nadie— dejaría el
 * `fetch` colgado para siempre: la función de Vercel se quedaría sin
 * responder y el cron de mañana tampoco. Aquí el reloj sigue vivo hasta que
 * el JSON está leído.
 */
async function conCuerpo(url, opciones, ms) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opciones, signal: ctrl.signal });
    if (!r.ok) throw new Error(`la base respondió HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * La raíz del anfitrión que ha servido la petición.
 *
 * En producción es https siempre: Vercel termina el TLS en el borde. En
 * local, el cron se prueba contra `node serve.mjs`, que corre en http, y
 * pedir https a un puerto de http no falla con «el servidor no está»: cae
 * con un error TLS que no dice nada del servidor. Por eso el esquema se
 * elige por el anfitrión; en producción sale el mismo https de antes.
 */
function baseURL(req) {
  const host = String(req.headers.host ?? '');
  if (!host) return null;
  const esLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return `${esLocal ? 'http' : 'https'}://${host}`;
}

/**
 * La base del día, leída del propio anfitrión de la petición.
 *
 * Por qué fetch y no leer el disco: en Vercel el disco de una función no
 * tiene los ficheros del repositorio —la función corre desde su bundle de
 * despliegue—, así que una lectura relativa a `data/becas.json` ahí no
 * existe. Con el host funciona en los dos sitios: en local porque
 * serve.mjs sirve `/data/`, y en producción porque `.vercelignore` deja
 * subir el fichero —el que el buscador pide desde el navegador, el
 * producto—.
 */
async function baseDe(req) {
  const datos = await conCuerpo(`${baseURL(req)}/data/becas.json`, {}, 10000);
  const lista = Array.isArray(datos) ? datos : datos.becas;
  if (!Array.isArray(lista)) throw new Error('la base no trae la lista de becas');
  return lista;
}

/**
 * La pasada diaria.
 *
 * Contrato propio: SIEMPRE 200 con `{ ok, motivo, … }`. No se deja caer al
 * `catch` general del handler —que responde 503 con un mensaje de «el
 * registro de cuentas no está disponible», que no describe este fallo— porque
 * entonces una pasada sin envíos y una función caída se leerían igual desde
 * fuera, sin log que las separe. Cada paso que habla con algo externo lleva
 * el suyo, y esta capa es la red de seguridad del último: si algo se rompe
 * entre medias, la pasada responde 200 y dice por log qué pasó.
 */
async function cronAvisos(req, res) {
  try {
    return await pasadaDelCron(req, res);
  } catch (err) {
    console.error('cron-avisos: la pasada se rompió:', err.message);
    // `headersSent` evita el segundo intento cuando el fallo viene de
    // escribir la respuesta: `writeHead` por segunda vez lanza, y esa
    // excepción se quedaría sin registrar.
    if (!res.headersSent) {
      json(res, 200, { ok: false, motivo: 'la pasada se rompió' });
    }
  }
}

/**
 * La pasada en sí: lee la base, elige las fichas de la ventana, y manda un
 * correo a cada cuenta con el aviso puesto.
 *
 * Va separada de `cronAvisos` para que el envoltorio de arriba sea el único
 * que decide qué se contesta cuando algo se rompe por el camino.
 */
async function pasadaDelCron(req, res) {
  // ── Autorización ──
  const secreto = process.env.CRON_SECRET;
  if (secreto) {
    const mandado = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!mismoSecreto(mandado, secreto)) {
      return json(res, 401, { ok: false, error: 'no autorizado' });
    }
  } else {
    console.error('cron-avisos: falta CRON_SECRET; la ruta contesta sin comprobar a nadie');
  }

  // ── La base del día ──
  let fichas;
  try {
    fichas = await baseDe(req);
  } catch (err) {
    console.error('cron-avisos:', err.message);
    return json(res, 200, { ok: false, motivo: 'no se pudo leer la base' });
  }

  const hoy = hoyMadrid();
  const elegidas = seleccionar(fichas, hoy);

  // ── Cuentas activas y lo ya enviado ──
  let correos;
  let enviados;
  try {
    [correos, enviados] = await Promise.all([correosConAvisos(), avisosEnviados()]);
  } catch (err) {
    console.error('cron-avisos:', err.message);
    return json(res, 200, { ok: false, motivo: 'el almacén no respondió' });
  }

  const pendiente = correos
    .map((correo) => ({ correo, fichas: elegidas.filter((b) => !enviados.get(correo)?.has(b.id)) }))
    .filter((conFichas) => conFichas.fichas.length);

  if (!pendiente.length) {
    return json(res, 200, { ok: true, motivo: 'no hay avisos que mandar', emails: 0 });
  }

  // ── Sin correo configurado, no se envía y NO se marca ──
  // Marcar antes de enviar sería agendar avisos para siempre perdidos: la
  // fila de `avisos` nace como «ya enviado», y un plazo consumido no vuelve
  // a anunciarse. Con la configuración ausente la pasada se acaba aquí sin
  // tocar nada; el día que se definan las variables, la pasada siguiente
  // toma el relevo —siempre que el plazo siga en la ventana, que es el
  // coste de este orden, y es menos malo que avisos que nadie recibió—.
  if (!process.env.RESEND_API_KEY || !process.env.CORREO_DE) {
    console.error('cron-avisos: falta RESEND_API_KEY o CORREO_DE');
    return json(res, 200, { ok: true, motivo: 'sin configuración de envío', pendientes: pendiente.length });
  }

  // ── Envío, uno a uno, cada uno con su catch ──
  // La URL con su variable a propósito: el test apunta Resend a un servidor
  // de mentira con `RESEND_API_URL`. En producción no se define y va a la
  // API real.
  const url = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
  const origen = baseURL(req);
  const fuera = Math.max(0, pendiente.length - TOPE_ENVIOS);
  if (fuera) {
    console.error(`cron-avisos: ${fuera} correos quedan fuera del techo de ${TOPE_ENVIOS}; reintentan mañana`);
  }

  let emails = 0;
  let fallidos = 0;
  for (const { correo, fichas } of pendiente.slice(0, TOPE_ENVIOS)) {
    try {
      const carta = redactar(fichas, hoy, origen);
      const r = await conTimeout(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.CORREO_DE,
          to: [correo],
          subject: carta.asunto,
          html: carta.html,
          text: carta.texto,
        }),
      }, 10000);
      if (!r.ok) throw new Error(`Resend contestó ${r.status}`);

      // Marcado tras el envío confirmado. Al revés, un Resend que diga no
      // consumiría el aviso para siempre. Y es correo a correo: un fallo no
      // tumba la pasada —el siguiente correo sigue— y lo fallido reintenta
      // mañana porque su fila no se escribió. Cuando falla solo el guardado
      // (el correo ya salió), el duplicado de mañana es el mal menor frente
      // a no marcar nunca.
      await guardarAvisos(correo, carta.anunciadas.map((b) => b.id));
      emails++;
    } catch (err) {
      fallidos++;
      console.error(`cron-avisos: ${correo}:`, err.message);
    }
  }

  json(res, 200, {
    ok: true,
    motivo: fallidos ? 'la pasada terminó con fallos' : 'la pasada terminó',
    emails,
    fallidos,
  });
}

/**
 * Los helpers puros del cron, exportados para que el test pueda fijar por su
 * nombre el contrato que solo se ve mirando: qué entra en la ventana, qué
 * se recorta y cómo se redacta. El `export default` no cambia.
 */
export { hoyMadrid, fechaDe, diasRestantes, plazo, seleccionar, redactar };

