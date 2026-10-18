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
 * Ventaja que importa: **la sesión queda en una cookie httpOnly**, porque el
 * cliente usa `@supabase/ssr`. Con el script de Google, la sesión acaba en
 * localStorage y cualquier XSS se la lleva. Ese detalle no es menor: en este
 * proyecto la sesión es lo que desbloquea las becas.
 *
 * ── Qué se guarda ────────────────────────────────────────────────────────
 *
 * Del usuario de Supabase solo se lee `email`. El perfil académico (nota,
 * edad, destino) sigue en localStorage y no se manda a ninguna parte.
 *
 * ── Cómo se activa ───────────────────────────────────────────────────────
 *
 * Rellenar SUPABASE_URL y SUPABASE_ANON_KEY en config.js, y en Supabase:
 *   Authentication → Providers → Google → activar, con el client id y el
 *   secret de Google Cloud.
 * Las redirect URIs que hay que autorizar en Google son:
 *   http://localhost:5173/auth/callback      ← desarrollo
 *   https://TU-DOMINIO/auth/callback         ← producción
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
  await fetch(`${API}/salir`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
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