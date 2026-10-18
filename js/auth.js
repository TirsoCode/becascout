/**
 * auth.js — Cuentas de usuario.
 *
 * Hay tres formas de entrar y se explican en un momento. Antes de nada, lo que
 * este archivo ya no hace, porque es un error que estaba antes: **no escribe
 * la sesión a mano en localStorage**. Esa versión era una cuenta de mentira —
 * no había contraseña, no había servidor, y cualquier persona podía teclear
 * un correo y ver las becas. Ahora la sesión llega del servidor, en una cookie
 * httpOnly que el JavaScript de la página no puede leer ni copiar.
 *
 * ── Las tres formas ──────────────────────────────────────────────────────
 *
 *  1. **Google.** Un clic, sin contraseña. Pide solo el scope `email`, que es
 *     el único que no dispara la revisión manual de la pantalla de
 *     consentimiento: los scopes sensibles obligan a pasar por Google, tardan
 *     días y a veces lo rechazan.
 *  2. **Correo y contraseña.** La cuenta normal. La contraseña se guarda
 *     hasheada con scrypt y sal por usuario; el servidor nunca ve la tuya en
 *     claro.
 *  3. **Modo local.** Solo si el servidor no está. Sirve para abrir la web
 *     sin levantar nada, y **avisa de que es una sesión de juguete** en lugar
 *     de fingir que es una cuenta. Un producto que aparenta seguridad que no
 *     tiene es peor que uno que no promete nada.
 *
 * ── Por qué el token de Google no se guarda ─────────────────────────────
 *
 * Porque no hace falta. Lo que hace falta es el correo. Se pide el token, se
 * llama a la API de perfil de Google, se lee el correo, y el token se tira.
 * Guardarlo en localStorage sería dejar una credencial con una hora de vida
 * escrita en el disco del usuario.
 */

import { iniciarSupabase, entrarConGoogle, salirSupabase } from './supabase.js';

const API = '/api';
const GOOGLE_CLIENT_ID = '436706781551-o1nquf0ib9lp1p1vs1st0g08bs2a4k8m.apps.googleusercontent.com';
const PERFIL = 'becascout.perfil';

let modo = 'servidor';   // 'servidor' | 'local'
let pendiente = null;

/* ── Sesión ─────────────────────────────────────────────────────────────── */

let cache = null;         // null = aún no comprobado

/** Consulta al servidor si hay sesión. Nunca lanza: si falla, no hay sesión. */
export async function sesion() {
  if (cache) return cache;
  try {
    const res = await fetch(`${API}/yo`, { credentials: 'same-origin' });
    if (res.ok) {
      const d = await res.json();
      cache = { email: d.correo };
      return cache;
    }
  } catch {
    modo = 'local';
  }
  cache = false;
  return cache;
}

/**
 * ¿Hay una cuenta de verdad? La sesión de juguete del modo local **no** cuenta.
 *
 * `sesion()` también devuelve la sesión de prueba, porque hace falta para
 * pintarla en la cabecera con su aviso. Pero esa no puede abrir el velo: el
 * modo local existe para ver la web sin servidor, no para dejar pasar el
 * contenido. Con `Boolean(await sesion())` la lista se desbloqueaba sola en
 * cuanto fallaba la API —el 17 de octubre de 2026, FUNCTION_INVOCATION_FAILED
 * en todas las rutas—, que es justo el momento en que menos se puede prometer.
 */
export async function haySesion() {
  const s = await sesion();
  return Boolean(s) && !s.local;
}

/**
 * Además del propio formulario del modal, los dos botones fijos de la portada
 * abren `pedirAcceso`. Un doble disparo sobre el mismo botón —onclick y
 * addEventListener conviviendo un tiempo— resolvía `pendiente` al segundo
 * clic y dejaba la primera promesa colgada para siempre: quien llamaba con
 * `.then()` no volvía a saber de ella. Si el modal ya está abierto, la promesa
 * en curso es la respuesta, no una segunda.
 */
let accesoEnCurso = null;

export function pedirAcceso() {
  if (accesoEnCurso) return accesoEnCurso;
  accesoEnCurso = new Promise((resolve) => {
    pendiente = (r) => {
      accesoEnCurso = null;
      resolve(r);
    };
    abrirModal();
  });
  return accesoEnCurso;
}

/* ── API ────────────────────────────────────────────────────────────────── */

async function api(camino, datos) {
  const res = await fetch(`${API}/${camino}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(datos ?? {}),
  });
  let cuerpo = {};
  try { cuerpo = await res.json(); } catch { /* respuesta sin cuerpo */ }
  return { ok: res.ok, status: res.status, error: cuerpo.error, correo: cuerpo.correo };
}

export async function salir() {
  await salirSupabase();
  try { await api('salir'); } catch { /* si falla, se limpia igual */ }
  cache = null;
  localStorage.removeItem(PERFIL);
  location.reload();
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

const GOOGLE_SVG = `<svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H1v2.34A9 9 0 0 0 9 18z"/>
  <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H1a9 9 0 0 0 0 8.12l2.97-2.34z"/>
  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 1 4.94l2.97 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
</svg>`;

function abrirModal() {
  if (document.getElementById('scrim')) return;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.id = 'scrim';
  scrim.innerHTML = `
    <div class="modal-wrap modal" role="dialog" aria-modal="true" aria-labelledby="modal-t">
      <button class="modal-x" aria-label="Cerrar">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <h3 id="modal-t">Desbloquea las becas</h3>
      <p>Con una cuenta te avisamos cuando se acerque el plazo de algo que te sirve.</p>
      <div class="modal-msg"></div>

      <button class="gbtn" id="btn-google">${GOOGLE_SVG} Continuar con Google</button>

      <div class="modal-sep">o con tu correo</div>

      <div class="tabs" role="tablist">
        <button class="tab on" data-modo="registro" role="tab">Crear cuenta</button>
        <button class="tab" data-modo="login" role="tab">Iniciar sesión</button>
      </div>

      <form id="form">
        <label class="flab" for="f-correo">Correo</label>
        <input id="f-correo" type="email" required autocomplete="email" placeholder="tu@correo.com">
        <label class="flab" for="f-pass">Contraseña</label>
        <input id="f-pass" type="password" required minlength="10" autocomplete="new-password"
               placeholder="Mínimo 10 caracteres">
        <p class="fhint" id="f-hint">Al menos 10 caracteres.</p>
        <button class="btn btn-brand" type="submit" id="f-enviar" style="width:100%;margin-top:14px">Crear cuenta</button>
      </form>

      <p class="modal-fine">
        Tu nota media, tu edad y tu destino se quedan en tu navegador y no se
        envían a ningún sitio. Cada beca que ves enlaza a su convocatoria oficial.
      </p>
    </div>`;

  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';

  const cerrar = (r) => {
    scrim.remove();
    document.body.style.overflow = '';
    pendiente?.(r);
    pendiente = null;
  };

  scrim.querySelector('.modal-x').onclick = () => cerrar(null);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) cerrar(null); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', esc); cerrar(null); }
  });

  // ── Pestañas: crear / entrar ───────────────────────────────────────────
  let accion = 'registro';
  const form = scrim.querySelector('#form');
  const pass = scrim.querySelector('#f-pass');
  const enviar = scrim.querySelector('#f-enviar');
  const hint = scrim.querySelector('#f-hint');

  scrim.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      accion = t.dataset.modo;
      scrim.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
      enviar.textContent = accion === 'registro' ? 'Crear cuenta' : 'Iniciar sesión';
      pass.minLength = accion === 'registro' ? 10 : 1;
      pass.autocomplete = accion === 'registro' ? 'new-password' : 'current-password';
      hint.textContent = accion === 'registro' ? 'Mínimo 10 caracteres.' : '';
      hint.style.display = accion === 'registro' ? '' : 'none';
      scrim.querySelector('.modal-msg').innerHTML = '';
      // El encabezado sigue a la pestaña. Poner «Desbloquea las becas»
      // encima de un formulario de iniciar sesión confunde: quien ya tiene
      // cuenta no viene a desbloquear nada, viene a entrar.
      document.getElementById('modal-t').textContent =
        accion === 'registro' ? 'Desbloquea las becas' : 'Iniciar sesión';
      document.querySelector('.modal > p').textContent =
        accion === 'registro'
          ? 'Con una cuenta te avisamos cuando se acerque el plazo de algo que te sirve.'
          : 'Escribe tu correo y tu contraseña para volver a entrar.';
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = scrim.querySelector('.modal-msg');
    const correo = scrim.querySelector('#f-correo').value.trim();
    const password = pass.value;

    if (modo === 'local') return cerrar(sesionJuguete(correo));

    enviar.disabled = true;
    enviar.textContent = accion === 'registro' ? 'Creando cuenta…' : 'Entrando…';

    const r = await api(accion, { correo, password });

    if (r.ok) {
      cache = { email: correo };
      cerrar(cache);
      return;
    }

    enviar.disabled = false;
    enviar.textContent = accion === 'registro' ? 'Crear cuenta' : 'Iniciar sesión';

    if (r.status === 0 || r.status === 404) {
      // No hay servidor. Se ofrece el modo local en lugar de un error seco,
      // pero se dice que es de juguete: si alguien lo toma por una cuenta de
      // verdad, el sitio le ha mentido.
      modo = 'local';
      msg.innerHTML = `<div class="modal-msg amber">No hay servidor en marcha. Puedes seguir con una
        sesión local de prueba, que <b>no es una cuenta</b>: solo vive en este navegador.
        <button id="btn-local" style="margin-top:8px;width:100%">Seguir en modo local</button></div>`;
      msg.querySelector('#btn-local').onclick = () => cerrar(sesionJuguete(correo));
      return;
    }

    msg.innerHTML = `<div class="modal-err">${esc(r.error ?? 'No se pudo completar.')}</div>`;
  };

  scrim.querySelector('#btn-google').onclick = async () => {
    // Se intenta Supabase primero. Si no está configurado —en desarrollo, o
    // antes de crear el proyecto— se cae al flujo con Google Identity Services,
    // que funciona sin ningún servicio de por medio. Tener las dos rutas
    // significa que el botón nunca queda muerto.
    if (await iniciarSupabase()) {
      try {
        sessionStorage.setItem('bs.destino', location.pathname);
        await entrarConGoogle();
        return;   // Supabase redirige; no hay callback
      } catch (err) {
        msgDelModal(scrim, err.message);
      }
    }
    conGoogle(scrim, cerrar);
  };
}

function msgDelModal(scrim, texto) {
  const c = scrim.querySelector('.modal-msg');
  if (c) c.innerHTML = `<div class="modal-err">${esc(texto)}</div>`;
}

/* ── Google ─────────────────────────────────────────────────────────────── */

function conGoogle(scrim, cerrar) {
  const btn = scrim.querySelector('#btn-google');
  const msg = scrim.querySelector('.modal-msg');
  btn.disabled = true;
  btn.innerHTML = 'Conectando…';

  if (!window.google?.accounts?.oauth2) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => lanzar(scrim, cerrar, msg);
    s.onerror = () => {
      msg.innerHTML = `<div class="modal-err">No se pudo cargar Google. Revisa la conexión.</div>`;
      btn.disabled = false;
      btn.innerHTML = `${GOOGLE_SVG} Continuar con Google`;
    };
    document.head.appendChild(s);
    return;
  }
  lanzar(scrim, cerrar, msg);
}

function lanzar(scrim, cerrar, msg) {
  try {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'email',
      callback: async (r) => {
        if (r.error) { msg.innerHTML = `<div class="modal-err">Google devolvió un error: ${esc(r.error)}</div>`; return; }
        try {
          // Se manda el **access token**, no el correo que devuelve el perfil.
          // El servidor no puede fiarse de lo que dice esta página: si aceptara
          // un correo, cualquiera podría escribir el de otra persona y entrar
          // como ella. Con el token, el servidor pregunta a Google quién es y
          // solo entonces existe la cuenta.
          //
          // El correo que se pinta en la sesión es el que devuelve el servidor,
          // que es el único que ha comprobado algo. Antes se leía del perfil de
          // Google y se metía en `cache` sin contrastar: dos verdades, y la que
          // se enseñaba era justo la que nadie había verificado.
          const res = await api('registro-google', { token: r.access_token });
          if (!res.ok) throw new Error(res.error ?? 'No se pudo crear la cuenta.');
          cache = { email: res.correo };
          cerrar(cache);
        } catch (err) {
          msg.innerHTML = `<div class="modal-err">${esc(err.message)}</div>`;
        }
      },
      error_callback: () => { msg.innerHTML = `<div class="modal-err">Se canceló el acceso.</div>`; },
    });
    client.requestAccessToken({ prompt: '' });
  } catch (err) {
    msg.innerHTML = `<div class="modal-err">${esc(err.message)}</div>`;
  }
}

/* ── Modo local ─────────────────────────────────────────────────────────── */

/**
 * Sesión de juguete: existe para poder ver la web sin servidor, y se marca
 * siempre con `local: true` para que la cabecera avise.
 *
 * Lo que NO hace es desbloquear contenido. Antes ponía un `cache` con valor
 * truthy y el buscador lo leía como «hay sesión», así que `velar()` no se
 * llamaba y las fichas se veían enteras sin cuenta. Lo grave: ocurría justo
 * cuando la API estaba rota —el 17 de octubre de 2026, FUNCTION_INVOCATION_FAILED
 * en todas las rutas—, que es cuando menos tiene sentido regalar la puerta.
 * El velo es el producto; un modo de emergencia que lo levanta miente en la
 * única parte que hay que sustentar.
 */
function sesionJuguete(correo) {
  modo = 'local';
  cache = { email: correo, local: true };
  return cache;
}

/* ── Perfil académico ───────────────────────────────────────────────────── */

export const perfil = {
  leer() {
    try { return JSON.parse(localStorage.getItem(PERFIL)) ?? {}; } catch { return {}; }
  },
  guardar(p) { localStorage.setItem(PERFIL, JSON.stringify(p)); },
  borrar() { localStorage.removeItem(PERFIL); },
};

/* ── Utilidades ─────────────────────────────────────────────────────────── */

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}