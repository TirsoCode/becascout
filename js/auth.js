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
 *
 * ── La encuesta de llegada ───────────────────────────────────────────────
 *
 * Al crear la cuenta —y solo entonces— sale una pregunta que se puede pasar:
 * de dónde nos ha conocido. La respuesta se guarda en la cuenta, en el
 * servidor, porque es un dato del proyecto y no del navegador; aquí se decide
 * cuándo se enseña. Google con Supabase obliga a saltar a `/auth/callback`, y
 * de ahí sí vuelve la bandera (`bs.encuesta` en `sessionStorage`) para que la
 * página de aterrizaje lance la pregunta una vez. Ver `revisarEncuesta()`.
 */

import { iniciarSupabase, entrarConGoogle, salirSupabase } from './supabase.js';

const API = '/api';
const GOOGLE_CLIENT_ID = '436706781551-o1nquf0ib9lp1p1vs1st0g08bs2a4k8m.apps.googleusercontent.com';
const PERFIL = 'becascout.perfil';

// La encuesta de llegada: `ORIGEN` recuerda en el navegador que ya se
// preguntó (conteste o no) y `ENCUESTA` es la bandera que deja el callback de
// Google para saber que la cuenta es recién creada. La respuesta de verdad va
// a la cuenta, en el servidor.
const ORIGEN = 'becascout.origen';
const ENCUESTA = 'bs.encuesta';

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
      // `avisos` manda en el interruptor de la cuenta. `=== true` a
      // propósito: si el servidor viejo aún no lo manda, lo que queda es
      // `false`, no un `undefined` que el márkup tendría que adivinar.
      cache = { email: d.correo, avisos: d.avisos === true };
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
  return {
    ok: res.ok,
    status: res.status,
    error: cuerpo.error,
    correo: cuerpo.correo,
    nuevo: cuerpo.nuevo,   // solo lo manda registro-google: la cuenta acaba de nacer
    avisos: cuerpo.avisos, // solo lo manda /avisos: el estado RECIÉN escrito, no el pedido
  };
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
    <div class="modal modal-wrap auth" role="dialog" aria-modal="true" aria-labelledby="modal-t">
      <aside class="auth-side">
        <span class="brand auth-brand">
          <svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6.6 3.2h7.2l4.4 4.4v13.2H6.6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M13.8 3.2v4.4h4.4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M19.2 5 12.3 14.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            <path d="M12.3 14.4 10.4 17.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="brand-name">Becas<b>Scout</b></span>
        </span>

        <div class="auth-pitch">
          <h2>Cada requisito, con la cita del boletín del que sale.</h2>
          <p>Nada se enseña sin el fragmento literal que lo sostiene, y no
             inventamos probabilidades: lo que la convocatoria no dice, no lo
             sabemos.</p>
        </div>

        <dl class="auth-stats">
          <div><dt>100 %</dt><dd>requisitos con cita</dd></div>
          <div><dt>0</dt><dd>analítica y publicidad</dd></div>
        </dl>
      </aside>

      <div class="auth-main">
        <button class="modal-x" aria-label="Cerrar">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <h3 id="modal-t">Crea tu cuenta</h3>
        <p id="modal-sub">Con una cuenta te avisamos cuando se acerque el plazo de algo que te sirve.</p>
        <div class="modal-msg"></div>

        <button class="gbtn" id="btn-google">${GOOGLE_SVG} Continuar con Google</button>

        <div class="modal-sep">o con tu correo</div>

        <form id="form">
          <label class="flab" for="f-correo">Correo</label>
          <input id="f-correo" type="email" required autocomplete="email" placeholder="tu@correo.com">
          <label class="flab" for="f-pass">Contraseña</label>
          <input id="f-pass" type="password" required minlength="10" autocomplete="new-password"
                 placeholder="Mínimo 10 caracteres">
          <p class="fhint" id="f-hint">Al menos 10 caracteres.</p>
          <button class="btn btn-brand" type="submit" id="f-enviar">Crear cuenta</button>
        </form>

        <p class="auth-alt" id="modal-alt"></p>

        <p class="modal-fine">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="10.5" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.9"/>
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" stroke-width="1.9"/>
          </svg>
          Tu nota media, tu edad y tu destino se quedan en tu navegador y no se
          envían a ningún sitio.
        </p>
      </div>
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

  // ── Crear / entrar, con un enlace al pie ───────────────────────────────
  // Antes eran dos pestañas. El formulario es el mismo y lo único que cambia
  // es a quién se llama y qué se le pide a la contraseña, así que va como
  // enlace, que además no parte el modal en dos mitades antes de enseñar nada.
  let accion = 'registro';
  const form = scrim.querySelector('#form');
  const pass = scrim.querySelector('#f-pass');
  const enviar = scrim.querySelector('#f-enviar');
  const hint = scrim.querySelector('#f-hint');
  const alt = scrim.querySelector('#modal-alt');

  const pintarModo = (modo) => {
    accion = modo;
    enviar.textContent = accion === 'registro' ? 'Crear cuenta' : 'Iniciar sesión';
    pass.minLength = accion === 'registro' ? 10 : 1;
    pass.autocomplete = accion === 'registro' ? 'new-password' : 'current-password';
    pass.placeholder = accion === 'registro' ? 'Mínimo 10 caracteres' : 'Tu contraseña';
    hint.textContent = accion === 'registro' ? 'Al menos 10 caracteres.' : '';
    hint.style.display = accion === 'registro' ? '' : 'none';
    scrim.querySelector('.modal-msg').innerHTML = '';
    // El encabezado sigue al modo. Poner «Crea tu cuenta» encima de un
    // formulario de iniciar sesión confunde: quien ya tiene cuenta no viene a
    // crearse nada, viene a entrar.
    document.getElementById('modal-t').textContent =
      accion === 'registro' ? 'Crea tu cuenta' : 'Inicia sesión';
    document.getElementById('modal-sub').textContent =
      accion === 'registro'
        ? 'Con una cuenta te avisamos cuando se acerque el plazo de algo que te sirve.'
        : 'Escribe tu correo y tu contraseña para volver a entrar.';
    alt.innerHTML = accion === 'registro'
      ? '¿Ya tienes cuenta? <button type="button" id="modal-cambia">Inicia sesión</button>'
      : '¿No tienes cuenta? <button type="button" id="modal-cambia">Crea una</button>';
    alt.querySelector('#modal-cambia').onclick =
      () => pintarModo(accion === 'registro' ? 'login' : 'registro');
  };

  pintarModo('registro');

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
      // Solo al crear cuenta. A quien entra con una que ya tenía no se le
      // pregunta de dónde nos conoció: ya lo contestó —o lo pasó— el primer día.
      if (accion === 'registro') encuestaDeAlta();
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

/* ── Encuesta de llegada ────────────────────────────────────────────────── */

/**
 * ¿Toca preguntar, en esta carga de página, de dónde nos han conocido?
 *
 * El flujo de Google con Supabase termina en `/auth/callback`, que es otra
 * página: ahí no hay dónde preguntar. Por eso el callback deja la bandera en
 * `sessionStorage` y la página en la que se aterriza llama aquí. La bandera se
 * gasta al leerla —aunque la respuesta se pierda, la pregunta ya se hizo—.
 */
export function revisarEncuesta() {
  let viene = false;
  try {
    viene = sessionStorage.getItem(ENCUESTA) === '1';
    sessionStorage.removeItem(ENCUESTA);
  } catch { return; }
  if (viene) encuestaDeAlta();
}

/** Pregunta, salvo que este navegador ya la haya visto. */
function encuestaDeAlta() {
  // En modo privado, leer puede lanzar. En ese caso se pregunta igual: es
  // preferible molestar una vez a fingir que la memoria funciona.
  try { if (localStorage.getItem(ORIGEN)) return; } catch { /* se pregunta */ }
  abrirEncuesta();
}

// Las respuestas de la lista, con el valor que se guarda y lo que se lee. El
// valor está también en `ORIGENES` de api/[...ruta].js: aquí se elige, allí se
// comprueba. Añadir una opción son dos líneas, una en cada sitio.
//
// Los logotipos son de la plataforma que nombran y se usan solo para
// nombrarla. Los trazos vienen de simple-icons (CC0), salvo el de OpenAI, que
// sale de su propio favicon: simple-icons lo retiró a petición de ellos. Cada
// uno lleva su color de marca; el de «un amigo» no es una marca y va con la
// tinta del sitio. Van `aria-hidden`: la etiqueta de al lado ya dice lo que
// es, y un lector de pantalla no necesita que se lo deletreen.
const ICONOS = {
  chatgpt: `<svg viewBox="29.487 29.964 121.035 119.954" aria-hidden="true"><path fill="#000" d="M75.91 73.628V62.232c0-.96.36-1.68 1.199-2.16l22.912-13.194c3.119-1.8 6.838-2.639 10.676-2.639 14.394 0 23.511 11.157 23.511 23.032 0 .839 0 1.799-.12 2.758l-23.752-13.914c-1.439-.84-2.879-.84-4.318 0L75.91 73.627Zm53.499 44.383v-27.23c0-1.68-.72-2.88-2.159-3.719L97.142 69.55l9.836-5.638c.839-.48 1.559-.48 2.399 0l22.912 13.195c6.598 3.839 11.035 11.995 11.035 19.912 0 9.116-5.397 17.513-13.915 20.992v.001Zm-60.577-23.99-9.836-5.758c-.84-.48-1.2-1.2-1.2-2.16v-26.39c0-12.834 9.837-22.55 23.152-22.55 5.039 0 9.716 1.679 13.676 4.678L70.993 55.516c-1.44.84-2.16 2.039-2.16 3.719v34.787-.002Zm21.173 12.234L75.91 98.339V81.546l14.095-7.917 14.094 7.917v16.793l-14.094 7.916Zm9.056 36.467c-5.038 0-9.716-1.68-13.675-4.678l23.631-13.676c1.439-.839 2.159-2.038 2.159-3.718V85.863l9.956 5.757c.84.48 1.2 1.2 1.2 2.16v26.389c0 12.835-9.957 22.552-23.27 22.552v.001Zm-28.43-26.75L47.72 102.778c-6.599-3.84-11.036-11.996-11.036-19.913 0-9.236 5.518-17.513 14.034-20.992v27.35c0 1.68.72 2.879 2.16 3.718l29.989 17.393-9.837 5.638c-.84.48-1.56.48-2.399 0Zm-1.318 19.673c-13.555 0-23.512-10.196-23.512-22.792 0-.959.12-1.919.24-2.879l23.63 13.675c1.44.84 2.88.84 4.32 0l30.108-17.392v11.395c0 .96-.361 1.68-1.2 2.16l-22.912 13.194c-3.119 1.8-6.837 2.639-10.675 2.639Zm29.748 14.274c14.515 0 26.63-10.316 29.39-23.991 13.434-3.479 22.071-16.074 22.071-28.91 0-8.396-3.598-16.553-10.076-22.43.6-2.52.96-5.039.96-7.557 0-17.153-13.915-29.99-29.989-29.99-3.239 0-6.358.48-9.477 1.56-5.398-5.278-12.835-8.637-20.992-8.637-14.515 0-26.63 10.316-29.39 23.991-13.434 3.48-22.07 16.074-22.07 28.91 0 8.396 3.598 16.553 10.075 22.431-.6 2.519-.96 5.038-.96 7.556 0 17.154 13.915 29.989 29.99 29.989 3.238 0 6.357-.479 9.476-1.559 5.397 5.278 12.835 8.637 20.992 8.637Z"/></svg>`,
  claude: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0069" d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  reddit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF4500" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg>`,
  amigo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5E686D" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"/></svg>`,
};

const ORIGENES = [
  ['chatgpt', 'ChatGPT'],
  ['claude', 'Claude'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['reddit', 'Reddit'],
  ['amigo', 'Un amigo'],
];

/**
 * La pregunta, una sola vez, justo después de crear la cuenta.
 *
 * Se puede pasar de tres maneras —el aspa, el enlace del pie y `Escape`— y
 * ninguna pide explicación. La respuesta es lo que decide cosas del producto
 * —dónde merece la pena escribir— así que una respuesta forzada valdría menos
 * que ninguna: quien pasa, pasa.
 *
 * No es una puerta: no comprueba nada ni desbloquea nada. Por eso el envío se
 * hace sin esperar respuesta. Si el `POST` falla, se pierde una respuesta de
 * cortesía y nada más; dejar el modal abierto esperando a la red sí sería un
 * problema.
 */
function abrirEncuesta() {
  if (document.getElementById('scrim')) return;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.id = 'scrim';
  scrim.innerHTML = `
    <div class="modal modal-wrap encuesta" role="dialog" aria-modal="true" aria-labelledby="enc-t" tabindex="-1">
      <button class="modal-x" aria-label="Pasar">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <h3 id="enc-t">¿Cómo nos has conocido?</h3>
      <p class="enc-sub">Sirve para saber por dónde llega la gente. Si no quieres
         contestar, pasa sin más.</p>

      <div class="enc-opts">
        ${ORIGENES.map(([v, t]) => `<button type="button" data-origen="${v}"><span class="enc-ico">${ICONOS[v]}</span>${t}</button>`).join('')}
      </div>

      <p class="enc-skip"><button type="button">Prefiero no contestar</button></p>
    </div>`;

  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';

  let cerrado = false;
  function cerrar(respuesta) {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alEscape);
    // Que la pregunta no vuelva, conteste o no: se recuerda en el navegador
    // porque la cuenta ya lleva la respuesta de verdad.
    try { localStorage.setItem(ORIGEN, respuesta); } catch { /* modo privado */ }
    scrim.remove();
    document.body.style.overflow = '';
  }
  function alEscape(e) {
    if (e.key === 'Escape') cerrar('pasar');
  }

  scrim.querySelector('.modal-x').onclick = () => cerrar('pasar');
  scrim.querySelector('.enc-skip button').onclick = () => cerrar('pasar');
  scrim.addEventListener('click', (e) => { if (e.target === scrim) cerrar('pasar'); });
  document.addEventListener('keydown', alEscape);

  // El foco va al propio diálogo y no a la primera respuesta: enfocando
  // «ChatGPT» el anillo verde la señala como si estuviera elegida, y aquí no
  // hay nada elegido de antemano. Con el foco en el diálogo, `Tab` entra por
  // la primera opción igual.
  scrim.querySelector('.encuesta').focus();

  scrim.querySelectorAll('[data-origen]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.origen;
      api('origen', { origen: v }).catch(() => {});

      // Un acuse breve antes de cerrar. Sin él, un clic que cierra en el acto
      // no se distingue de un clic que no hizo nada.
      scrim.querySelector('.encuesta').innerHTML = `
        <h3>Anotado</h3>
        <p class="enc-sub">Gracias: con esto sabemos por dónde llega la gente.</p>`;
      setTimeout(() => cerrar(v), 850);
    };
  });
}

/* ── Ajustes de la cuenta ───────────────────────────────────────────────── */

/**
 * Lo que una cuenta tiene de suyo: salir y borrarla.
 *
 * Salir es un clic. Borrar es un paso intermedio que pide escribir el correo a
 * mano, porque es lo único que no tiene vuelta atrás: la fila desaparece con
 * sus sesiones y sin cuenta ni siquiera llegaría un aviso de plazo. El trámite
 * lo comprueba también el servidor —el navegador siempre puede mentir— y por
 * eso la ruta solo lo acepta con el correo bien escrito.
 *
 * No se pide la contraseña a propósito: las cuentas de Google llevan una
 * contraseña de servicio que su dueño no conoce, y exigírsela las dejaría sin
 * poder borrar lo suyo. La sesión abierta más el correo escrito valen para
 * todos los tipos de cuenta.
 */
export async function abrirAjustes() {
  // La sesión de juguete no es cuenta: no hay ajustes que dar. Salir ya está
  // a un clic en la cabecera de donde sí lo hay.
  let s = await sesion();
  if (!s || s.local) return;
  // El cache puede venir sin `avisos`: pasa cuando la cuenta acaba de crear
  // en este mismo navegador y `registro` no es quien la trae. Pintar el
  // interruptor con un estado adivinado —«off» por defecto— sería mentir
  // justo donde el producto promete «un correo cuando se acerca un plazo».
  // Se repregunta al servidor una vez y listo.
  if (s.avisos === undefined) {
    cache = null;
    s = await sesion();
    if (!s || s.local) return;
  }
  if (document.getElementById('scrim')) return;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.id = 'scrim';

  const caja = document.createElement('div');
  caja.className = 'modal modal-wrap ajustes';
  caja.setAttribute('role', 'dialog');
  caja.setAttribute('aria-modal', 'true');
  caja.setAttribute('aria-labelledby', 'ajs-t');
  caja.tabIndex = -1;
  scrim.appendChild(caja);

  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';

  let cerrado = false;
  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alEscape);
    scrim.remove();
    document.body.style.overflow = '';
  }
  function alEscape(e) {
    if (e.key === 'Escape') cerrar();
  }

  // El cierre va por delegación desde el scrim: el aspa se vuelve a crear con
  // el contenido de cada paso y el listener no sabe nada de eso.
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('.modal-x')) cerrar();
  });
  document.addEventListener('keydown', alEscape);

  function pasoInicio() {
    caja.innerHTML = `
      <button class="modal-x" aria-label="Cerrar">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <h3 id="ajs-t">Tu cuenta</h3>

      <p class="ajs-correo"></p>

      <div class="avisos-fila">
        <div class="avisos-txt">
          <span class="avisos-t">Avisos de plazo</span>
          <p>Un correo solo cuando una convocatoria de la lista cierra en los próximos 7 días. Lo quitas aquí mismo.</p>
        </div>
        <button type="button" class="switch" id="ajs-avisos" role="switch"
                aria-checked="false" aria-label="Avisos de plazo">
          <span class="switch-dot"></span>
        </button>
      </div>

      <div class="ajs-act">
        <button type="button" class="btn btn-quiet" id="ajs-salir">Cerrar sesión</button>
        <button type="button" class="btn btn-rust" id="ajs-borrar">Eliminar la cuenta</button>
      </div>

      <div class="modal-msg"></div>`;

    // El correo vuelve de la sesión y lo escribió quien registró la cuenta:
    // por textContent, como en las cabeceras.
    caja.querySelector('.ajs-correo').textContent = s.email ?? '';
    caja.querySelector('#ajs-salir').onclick = salir;
    caja.querySelector('#ajs-borrar').onclick = pasoBorrar;
    avisosDePlazo();
    caja.focus();
  }

  /**
   * La fila de «Avisos de plazo»: un interruptor y su promesa, nada más.
   *
   * El estado al abrir lo dice la sesión. El de después de pulsar lo dice
   * el **servidor**, no la petición que se le mandó: un 401 —la sesión ha
   * caducado mientras se leía la lista— contesta por error, y pintar lo
   * pedido haría creer que va a llegar un correo que no va a llegar. Si no
   * responde, se vuelve al estado de antes y la fila de abajo habla, sin
   * cerrar el modal ni tocar a «Salir» ni a «Borrar cuenta». La respuesta
   * se sincroniza con el cache de sesión para que reabrir el modal —o
   * volver del paso de borrado— no enseñe un estado ya pasado.
   */
  function avisosDePlazo() {
    const interruptor = caja.querySelector('#ajs-avisos');
    const msg = caja.querySelector('.modal-msg');
    let activados = Boolean(s.avisos);

    const pinta = () => interruptor.setAttribute('aria-checked', String(activados));
    pinta();

    interruptor.onclick = async () => {
      const antes = activados;
      interruptor.disabled = true;
      msg.innerHTML = '';

      // Se enseña YA lo que se pide: el beat del POST es lo único que
      // hay de respuesta visual a un dedo en un móvil. La corrección
      // llega abajo, con la verdad del servidor.
      activados = !antes;
      pinta();

      let res = null;
      try {
        res = await api('avisos', { activar: !antes });
      } catch { /* sin respuesta: se deshace */ }

      if (res?.ok) {
        // La verdad es la del servidor, aunque coincida con lo pedido.
        activados = res.avisos === true;
        if (cache) cache.avisos = activados;
      } else {
        activados = antes;
        // El 401 es el caso más probable: la sesión caducó mientras se leía
        // la lista. «sin sesión» es la palabra del servidor, que habla para
        // el servidor; quien tiene el modal delante necesita saber que tiene
        // que volver a entrar.
        msgDelModal(caja, res?.status === 401
          ? 'Tu sesión ha caducado. Entra otra vez para cambiar los avisos.'
          : (res?.error ?? 'Los avisos no se han podido cambiar ahora mismo.'));
      }

      pinta();
      interruptor.disabled = false;
    };
  }

  function pasoBorrar() {
    caja.innerHTML = `
      <button class="modal-x" aria-label="Cerrar">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <h3>Eliminar la cuenta</h3>
      <p class="enc-sub">Se acaba aquí: se pierde la cuenta y la sesión, y no
         llegarán más avisos de plazo. Para confirmar, escribe tu dirección
         de correo.</p>

      <form id="ajs-form">
        <label class="flab" for="ajs-conf">Tu correo</label>
        <input id="ajs-conf" type="email" required autocomplete="email"
               placeholder="El correo con el que creaste la cuenta">
        <button type="submit" class="btn btn-rust" id="ajs-si">Borrar definitivamente</button>
      </form>

      <div class="modal-msg"></div>

      <p class="enc-skip"><button type="button" id="ajs-no">Volver</button></p>`;

    caja.querySelector('#ajs-no').onclick = pasoInicio;
    caja.querySelector('#ajs-form').onsubmit = alEnviar;
    caja.focus();
  }

  async function alEnviar(e) {
    e.preventDefault();
    const btn = caja.querySelector('#ajs-si');
    const confirmar = caja.querySelector('#ajs-conf').value.trim();

    btn.disabled = true;
    btn.textContent = 'Borrando…';

    try {
      const res = await fetch(`${API}/cuenta`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmar }),
      });

      if (res.ok) {
        // La cuenta ya no existe: el perfil guardado en este navegador y el
        // recuerdo de la encuesta tampoco tienen dueño ya. Se van con ella.
        try {
          localStorage.removeItem(PERFIL);
          localStorage.removeItem(ORIGEN);
        } catch { /* modo privado */ }
        cache = null;
        location.reload();
        return;
      }

      const d = await res.json().catch(() => ({}));
      msgDelModal(caja, d.error ?? 'No se pudo borrar la cuenta.');
    } catch {
      msgDelModal(caja, 'No se pudo borrar la cuenta.');
    }

    btn.disabled = false;
    btn.textContent = 'Borrar definitivamente';
  }

  pasoInicio();
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
          // `nuevo` lo dice el servidor al escribir la cuenta: si ya existía
          // —lo normal al volver a entrar con Google— no hay pregunta.
          if (res.nuevo) encuestaDeAlta();
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
  // `avisos: true` a propósito: la fila de ajustes se salta las sesiones de
  // juguete (no es cuenta, no hay nada que dar), así que hoy no se pinta.
  // La bandera viva evita que, si algún día se pinta, el interruptor muestre
  // un estado que su propia sesión nunca ha dicho.
  cache = { email: correo, local: true, avisos: true };
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