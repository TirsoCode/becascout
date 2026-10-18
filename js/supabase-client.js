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

let promesa = null;

/**
 * Devuelve la promesa del cliente de Supabase, o null si no se pudo cargar.
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

/**
 * Envoltorio perezoso: cada propiedad y cada llamada se encadena sobre la
 * misma promesa, así que quien llama puede escribir `cliente.auth.getUser()`
 * sin esperar a que el módulo del CDN esté descargado.
 *
 * ── Por qué esto es un `Proxy` y no algo más simple ──────────────────────
 *
 * La versión anterior tenía `get` devolviendo una función, y con
 * `listo.then((c) => c?.[prop]?.(...args))`. Parecía equivalente, pero
 * `c?.[prop]?.(...)` **invoca** lo que devuelve `prop`: al escribir
 * `cliente.auth.getUser()`, `cliente.auth` llamaba a `c.auth()`, que no es una
 * función, y reventaba dentro del `.then`. El resultado era un `TypeError` en
 * cada llamada de Supabase, y `cliente.auth` valía `undefined`.
 *
 * Como la librería vive detrás de un `import()` dinámico, no se puede importar
 * arriba del todo; de ahí el proxy. Lo que hace falta es que `get` devuelva
 * **la propiedad**, seguida por otro proxy que espera lo mismo, y que la
 * invocación final se reenvíe a la función cuando exista.
 *
 * Con `prop === null` se está en la raíz: el valor es el cliente entero.
 */
function envolver(obtener, prop) {
  const valor = () => obtener().then((c) => {
    if (prop === null) return c;
    const v = c?.[prop];
    // Se ata al padre: sin esto, `cliente.auth.getUser()` llamaría a la función
    // con `this` undefined y dentro de la librería no encontraría nada.
    return typeof v === 'function' ? v.bind(c) : v;
  });

  return new Proxy(function () {}, {
    get(_t, p) {
      // Los símbolos son de uso interno de los motores. Envolverlos rompería
      // cosas como la inspección desde la consola.
      if (typeof p === 'symbol') return undefined;

      // `then` tiene que devolver la firma de un thenable de verdad, o `await`
      // sobre el envoltorio se queda esperando para siempre.
      if (p === 'then') {
        return (cumplido, rechazado) => valor().then(
          (v) => (typeof cumplido === 'function' ? cumplido(v) : v),
          rechazado,
        );
      }
      if (p === 'catch' || p === 'finally') {
        return (...args) => valor()[p](...args);
      }

      return envolver(valor, p);
    },

    apply(_t, _este, args) {
      return valor().then((v) => (typeof v === 'function' ? v(...args) : v));
    },
  });
}

/** Atajo con nombre corto, que es como lo llama supabase.js. */
export function createClient(url, anon) {
  return envolver(() => {
    if (!promesa) {
      const p = crear(url, anon);
      if (!p) return Promise.resolve(null);
      promesa = p;
    }
    return promesa;
  }, null);
}