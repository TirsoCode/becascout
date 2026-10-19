/**
 * auth/callback.js — Lógica del receptor del token de Google.
 *
 * Está en un fichero aparte y no incrustado en `callback.html` por la CSP:
 * con `script-src 'self'` un `<script>` inline se bloquea, y este es justo el
 * que cierra el login. Separarlo deja la política estricta sin romper nada.
 *
 * Existe por un motivo técnico concreto. Google devuelve el token en el
 * fragmento de la URL (`#access_token=…`), y ese fragmento no se envía nunca
 * al servidor por diseño. Si se deja que Supabase lo recoja en la página de
 * origen, el proceso se parte en dos: la página que pide el login y la que
 * vuelve son distintas, y la segunda no tiene el estado del formulario.
 *
 * Saltando aquí, se espera a que Supabase canjee el token, se registra la
 * cuenta en nuestro servidor para poder avisar de plazos, y se vuelve a donde
 * el usuario estaba. Si algo falla, el mensaje lo dice en vez de dejar una
 * pantalla en blanco.
 *
 * ── Por qué se manda el token y no el correo ─────────────────────────────
 *
 * Antes esta página hacía `POST /api/registro-google` con `{ correo }`, y eso
 * era un agujero: el servidor se fiaba del correo que escribiera quien llama,
 * y basta un `curl` con el correo de otra persona para recibir su sesión.
 *
 * Ahora se manda el JWT de sesión y el servidor lo pasa por `auth/v1/user` de
 * Supabase; si Supabase no lo reconoce, no hay cuenta. El correo sale de la
 * respuesta de Supabase, no de esta página.
 */
import { iniciarSupabase, tokenSupabase } from '../js/supabase.js';
import { API } from '../js/config.js';

const t = document.getElementById('t');
const m = document.getElementById('m');
const destino = sessionStorage.getItem('bs.destino') || '/becas.html';

try {
  if (!(await iniciarSupabase())) {
    throw new Error('Supabase no está configurado en este entorno.');
  }

  // Supabase tarda un momento en canjear el token tras redirigir.
  let token = null;
  for (let i = 0; i < 20 && !token; i++) {
    token = await tokenSupabase();
    if (!token) await new Promise((r) => setTimeout(r, 300));
  }
  if (!token) throw new Error('Google no devolvió ninguna cuenta.');

  m.textContent = 'Creando tu cuenta…';
  const r = await API.post('registro-google', { token });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(datos.error || 'No se pudo crear la cuenta.');
  }

  // Si la cuenta acaba de nacer, la página de destino enseña la encuesta de
  // llegada antes de seguir. La bandera va en `sessionStorage` y no en la
  // URL: un enlace con `?nuevo=1` se reenvía, se guarda en favoritos y acaba
  // preguntando a quien no le toca.
  if (datos.nuevo) sessionStorage.setItem('bs.encuesta', '1');

  location.replace(destino);
} catch (err) {
  t.textContent = 'No hemos podido entrar';
  m.textContent = err.message;
  m.style.color = 'var(--rust)';

  const volver = document.createElement('a');
  volver.className = 'btn btn-brand';
  volver.href = '/becas.html';
  volver.textContent = 'Volver al buscador';
  volver.style.marginTop = '18px';
  document.getElementById('estado').appendChild(volver);
}
