/**
 * supabase-client.js — Carga el cliente de Supabase desde el propio sitio.
 *
 * ── Por qué ya no viene de un CDN ────────────────────────────────────────
 *
 * Hasta el 30 de octubre de 2026 esto hacía
 * `import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')`.
 * Tres problemas en una línea:
 *
 *   1. `@2` es una etiqueta flotante: el código que se ejecuta hoy no es
 *      necesariamente el de ayer. Un tercero puede cambiar lo que corre en
 *      tu página sin que tú despliegues nada. La auditoría lo señaló.
 *   2. La CSP tenía que abrir `script-src` y `connect-src` a
 *      `cdn.jsdelivr.net` y a `*.supabase.co`, y cada origen abierto es una
 *      puerta más.
 *   3. Si el CDN falla o el usuario bloquea terceros, el botón de Google
 *      deja de funcionar sin explicación.
 *
 * La librería va vendorizada en `js/vendor/supabase.js` (build UMD oficial de
 * `@supabase/supabase-js@2.118.0`, 218 KB). Se carga con un `<script>` del
 * mismo origen, así que la CSP puede quedarse en `script-src 'self'`. Sigue
 * sin haber build: es un fichero estático más.
 *
 * ── Cómo se actualiza ────────────────────────────────────────────────────
 *
 *   curl -sL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js \
 *     -o js/vendor/supabase.js
 *
 * y se cambia la versión de arriba **a mano**. No se usa `@2` ni `latest`: la
 * versión que corre en producción tiene que ser una que alguien eligió.
 *
 * El resto del módulo no cambia: sigue devolviendo una promesa que puede ser
 * `null`, y el proxy de abajo mantiene la misma interfaz para que
 * `supabase.js` no se entere de dónde viene la librería.
 */

const RUTA = new URL('./vendor/supabase.js', import.meta.url).href;

let carga = null;

/**
 * Mete el `<script>` una sola vez y resuelve con `window.supabase`.
 *
 * No usa `import()` porque el build UMD no es un módulo ES. Si ya está en la
 * página —dos llamadas seguidas— se reutiliza la misma promesa.
 */
function cargarLibreria() {
  if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);

  if (!carga) {
    carga = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = RUTA;
      s.async = true;
      s.onload = () => {
        if (globalThis.supabase?.createClient) ok(globalThis.supabase);
        else mal(new Error('la librería no expuso createClient'));
      };
      s.onerror = () => mal(new Error('no se pudo cargar la librería'));
      document.head.append(s);
    }).catch((err) => {
      // Si falló, que la siguiente llamada lo vuelva a intentar: puede haber
      // sido un corte de red puntual, no una librería que no existe.
      carga = null;
      throw err;
    });
  }
  return carga;
}

/**
 * Devuelve la promesa del cliente de Supabase, o null si no se pudo cargar.
 * Nunca lanza: quien llama tiene que poder seguir sin él.
 */
export function crear(url, anon) {
  if (!url || !anon) return null;

  return cargarLibreria()
    .then((lib) => lib.createClient(url, anon, {
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

/**
 * Envoltorio perezoso: cada propiedad y cada llamada se encadena sobre la
 * misma promesa, así que quien llama puede escribir `cliente.auth.getUser()`
 * sin esperar a que la librería esté descargada.
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
 * Como la librería se carga después, no se puede importar arriba del todo; de
 * ahí el proxy. Lo que hace falta es que `get` devuelva **la propiedad**,
 * seguida por otro proxy que espera lo mismo, y que la invocación final se
 * reenvíe a la función cuando exista.
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
  let promesa = null;
  return envolver(() => {
    if (!promesa) {
      const p = crear(url, anon);
      if (!p) return Promise.resolve(null);
      promesa = p;
    }
    return promesa;
  }, null);
}
