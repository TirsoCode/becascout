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
 * `[...ruta].js` es lo que hace que las seis rutas (`/api/registro`,
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
import { crear, buscar, guardarToken, porToken, quitarToken } from '../lib/store.js';

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
  if (!usuario) {
    const salt = randomBytes(16).toString('base64');
    const hashPass = await hash(randomBytes(32).toString('base64'), salt);
    usuario = await crear(correo, hashPass, salt);
  }

  const tokenSesion = randomBytes(32).toString('base64url');
  await guardarToken(usuario.correo, tokenSesion);

  json(res, 200, { ok: true, correo: usuario.correo }, {
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
  json(res, 200, { correo: usuario.correo });
}