/**
 * supabase-client.js — Carga el cliente de Supabase desde CDN, sin build.
 *
 * El proyecto no tiene paso de compilación a propósito: son ficheros estáticos
 * que se suben tal cual a cualquier hosting. Eso obliga a cargar la librería
 * de Supabase en tiempo de ejecución en vez de importarla, pero tiene una
 * ventaja: si el CDN falla o el usuario bloquea third-parties, el sitio sigue
 * funcionando entero salvo el botón de Google. Un fallo de red de un tercero no
 * puede dejar la web en blanco.
 */

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const CLIENTE = 'sb';

let promesa = null;

/**
 * Devuelve el cliente de Supabase, o null si no se pudo cargar.
 * Nunca lanza: quien llama tiene que poder seguir sin él.
 */
export function crear(url, anon) {
  if (!url || !anon) return null;

  if (!promesa) {
    promesa = import(/* @vite-ignore */ CDN)
      .then((m) => m.createClient(url, anon, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // El token va en localStorage. La sesión de nuestro servidor, que
          // es la que protege el contenido, va aparte en una cookie httpOnly.
          storage: localStorage,
        },
      }))
      .catch(() => null);
  }
  return promesa;
}

/** Atajo con nombre corto, que es como lo llama auth.js. */
export function createClient(url, anon) {
  let listo = null;
  return new Proxy({}, {
    get(_t, prop) {
      return (...args) => {
        if (!listo) {
          listo = crear(url, anon);
          if (!listo) return Promise.reject(new Error('Supabase no cargado'));
        }
        return listo.then((c) => c?.[prop]?.(...args));
      };
    },
  });
}