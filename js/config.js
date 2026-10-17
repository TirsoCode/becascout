/**
 * config.js — Configuración y API.
 *
 * Las claves de Supabase son **públicas por diseño**: la `anon key` va en el
 * código del navegador y no da acceso a los datos, porque lo que protege las
 * tablas son las reglas de seguridad (RLS) de Postgres. Es lo mismo que hace
 * la clave de Google, y por eso no hay que esconderse: si no está aquí, es
 * que no hay.
 *
 * Lo que sí NO se pone nunca aquí es la `service_role`: esa da acceso total y
 * solo puede vivir en el servidor.
 */

export const API = {
  base: '/api',

  async config() {
    const r = await fetch(`${this.base}/config`);
    if (!r.ok) return {};
    return r.json();
  },

  post(camino, cuerpo) {
    return fetch(`${this.base}/${camino}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
    });
  },

  get(camino) {
    return fetch(`${this.base}/${camino}`, { credentials: 'same-origin' });
  },
};