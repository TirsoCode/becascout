/**
 * supabase.js — Inicio de sesión con Google, vía Supabase.
 *
 * ── Por qué Supabase y no el script de Google directamente ───────────────
 *
 * Con Google Identity Services hay que validar el token a mano, guardar el
 * id de usuario en algún sitio y decidir qué pasa con el correo. Supabase ya
 * hace las tres cosas: autentica, guarda el usuario en Postgres y pone a
 * disposición un JWT que el backend puede verificar. Aquí lo que hace falta es
 * una llamada.
 *
 * Hay **dos sesiones** y no son la misma. La de Supabase vive en el
 * navegador: supabase-client.js carga el cliente con `persistSession` sobre
 * localStorage, y de ahí sale el JWT que `tokenSupabase()` manda al backend,
 * que lo confirma contra `GET /auth/v1/user` antes de dar nada por bueno. La
 * del producto es otra: el propio servidor la emite como cookie `bs_sesion`
 * (HttpOnly, tabla `sesiones`). No va en cookie httpOnly por gusto: el
 * guion de la página puede leer todo lo que hay en localStorage, así que si
 * esta app la protegiera con el token de Supabase, un XSS se llevaría las
 * becas. La cookie el guion no la ve, y por eso es ella la que desbloquea.
 *
 * ── Qué se guarda ────────────────────────────────────────────────────────
 *
 * Del usuario de Supabase solo se lee `email`. El perfil académico (nota,
 * edad, destino) sigue en localStorage y no se manda a ninguna parte.
 *
 * ── Cómo se activa ───────────────────────────────────────────────────────
 *
 * Nadie escribe las claves aquí: el front las pide a `API.config()` (ver
 * `iniciarSupabase()`), que las sirve `GET /api/config` con las variables de
 * Vercel — `vercel env add SUPABASE_URL production`,
 * `vercel env add SUPABASE_ANON_KEY production`, etc. Sin variables el
 * despliegue sale sin Supabase. Cada cambio de entorno exige redesplegar:
 * Vercel no las inyecta en caliente.
 *
 * Y en Supabase: Authentication → Providers → Google → activar, con el
 * client id y el secret de Google Cloud.
 *
 * Redirect URIs que hay que autorizar en Google:
 *   https://pvyszdazcqsynvnkbeme.supabase.co/auth/v1/callback
 *       ← la que Google autoriza de verdad: es donde Supabase canjea el
 *         código por el token. Sin esta, el flujo muere en Google.
 *   http://localhost:5173/auth/callback        ← desarrollo (redirectTo)
 *   https://becascout.vercel.app/auth/callback ← producción (redirectTo)
 *
 * Las /auth/callback no van en la petición a Google: son a donde Supabase
 * manda al usuario una vez canjeado el token. Es otra cosa distinta, así
 * que las tres constan.
 */

import { createClient } from './supabase-client.js';
import { API } from './config.js';

let cliente = null;
let activo = false;

export function disponible() {
  return activo;
}

/** Configura el cliente. Si faltan las claves, se queda inactivo sin fallar. */
export async function iniciarSupabase() {
  try {
    const { url, anon } = await API.config();
    if (!url || !anon) return false;

    cliente = createClient(url, anon);
    activo = true;
    return true;
  } catch (err) {
    console.warn('Supabase no disponible:', err.message);
    return false;
  }
}

/**
 * Abre el popup de Google.
 *
 * `redirectTo` apunta a /auth/callback, que es la página que recibe el token
 * antes de volver. Sin esa página intermedia, Supabase mete el fragmento en la
 * URL de origen y el flujo se queda a medias.
 */
export async function entrarConGoogle() {
  if (!activo) throw new Error('Supabase no está configurado.');
  const { data, error } = await cliente.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/auth/callback` },
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Cierra sesión en Supabase y en nuestro servidor. */
export async function salirSupabase() {
  if (activo) await cliente.auth.signOut().catch(() => {});
  await fetch(`${API.base}/salir`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}

/** El email del usuario autenticado, o null. */
export async function correoSupabase() {
  if (!activo) return null;
  const { data } = await cliente.auth.getUser();
  return data?.user?.email ?? null;
}

/**
 * El JWT de sesión de Supabase, o null.
 *
 * Lo necesita `/auth/callback.html` para que el servidor sepa quién es. Se
 * manda el token y no el correo a propósito: el correo que dice el navegador
 * no prueba nada —cualquiera puede escribir el que quiera en una petición— y
 * el servidor solo lo acepta si Supabase confirma que el token es bueno. Por
 * eso esta función devuelve el token y no el correo.
 */
export async function tokenSupabase() {
  if (!activo) return null;
  const { data } = await cliente.auth.getSession();
  return data?.session?.access_token ?? null;
}