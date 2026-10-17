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

function correoValido(c) {
  return typeof c === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.trim());
}

function politica(c) {
  return typeof c === 'string' && c.length >= 10;
}

async function cuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
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
    // Sin `SUPABASE_URL` el almacén cae al fichero JSON, y en Vercel el disco
    // es de solo lectura: todo alta de cuenta revienta con EROFS. Sin este
    // `catch`, quien lo Suffre ve la página de error de Vercel con un stack
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
 * Se genera una contraseña aleatoria que no se le enseña a nadie. Es una
 * contraseña de servicio: existe para que la fila tenga un hash consistente
 * y no un hueco, y no sirve para entrar — entrar es con Google.
 *
 * Si la cuenta ya existe no se toca. Eso importa: si alguien entra con
 * Google, borra la cookie y vuelve a entrar, no debe perder su perfil ni ver
 * su contraseña sustituida por otra.
 */
async function registroGoogle(req, res) {
  const { correo } = await cuerpo(req);
  if (!correoValido(correo)) return json(res, 400, { error: 'El correo no es válido.' });

  let usuario = await buscar(correo);
  if (!usuario) {
    const salt = randomBytes(16).toString('base64');
    const hashPass = await hash(randomBytes(32).toString('base64'), salt);
    usuario = await crear(correo, hashPass, salt);
  }

  const token = randomBytes(32).toString('base64url');
  await guardarToken(usuario.correo, token);

  json(res, 200, { ok: true, correo: usuario.correo }, {
    'Set-Cookie': cookie(token, DIAS * 24 * 60 * 60),
  });
}

async function registro(req, res) {
  const { correo, password } = await cuerpo(req);

  if (!correoValido(correo)) return json(res, 400, { error: 'El correo no es válido.' });
  if (!politica(password)) {
    return json(res, 400, { error: 'La contraseña necesita al menos 10 caracteres.' });
  }

  const salt = randomBytes(16).toString('base64');
  const hashPass = await hash(password, salt);

  const usuario = await crear(correo, hashPass, salt);
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
  const usuario = await buscar(correo ?? '');

  // Se calcula el hash aunque el usuario no exista, para que el tiempo de
  // respuesta sea el mismo en los dos casos y no revele qué correos hay.
  const saltFalso = 'falsofalsofalsofalso';
  const referencia = usuario ? usuario.hash : await hash(password ?? '', saltFalso);
  const calculado = await hash(password ?? '', usuario ? usuario.salt : saltFalso);

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