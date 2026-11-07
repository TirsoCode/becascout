/**
 * auth.js — Cuentas de usuario: la sesión, la encuesta de llegada y los
 * ajustes.
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
 * La primera **solo existe si el despliegue trae sus claves**: el botón se
 * pinta cuando `/api/config` devuelve un `googleId`, y no antes. Las otras dos
 * no dependen de nada de fuera. El formulario del alta vive desde octubre de
 * 2026 en la página `cuenta.html` —abierta en otra pestaña por las puertas de
 * «Crear cuenta»— con su lógica en `js/cuenta.js`; aquí queda lo que una
 * sesión tiene de suyo: leerla y cerrarla, la encuesta de llegada y los
 * ajustes.
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
 * cuándo se enseña. Google con Supabase obliga a saltar a `/auth/callback`,
 * y el alta a mano con cuenta nueva deja la misma bandera (`bs.encuesta` en
 * `sessionStorage`) en js/cuenta.js antes de volver a la página de origen.
 * En los dos casos la gasta `revisarEncuesta()`, que corre al cargar las
 * páginas donde aterriza el salto. Ver `revisarEncuesta()`.
 */

import { salirSupabase } from './supabase.js';
// Los textos del modal salen del diccionario: el mismo formulario sirve en
// castellano y en inglés sin duplicar el marcado. Importar `t` arranca también
// i18n.js, así que el conmutador de la cabecera funciona aunque esta página no
// cargue ningún otro módulo.
import { t } from './i18n.js';

const API = '/api';

const PERFIL = 'becascout.perfil';

// La encuesta de llegada: `ORIGEN` recuerda en el navegador que ya se
// preguntó (conteste o no) y `ENCUESTA` es la bandera que deja el callback de
// Google para saber que la cuenta es recién creada. La respuesta de verdad va
// a la cuenta, en el servidor.
const ORIGEN = 'becascout.origen';
const ENCUESTA = 'bs.encuesta';

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
    /* sin respuesta: no hay sesión */
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
 * Repregunta al servidor, sin el cache.
 *
 * El alta vive desde octubre de 2026 en `cuenta.html`, en **otra pestaña**:
 * mientras esta estaba al fondo, aquí la sesión pudo haber nacido —o haberse
 * caído—. Al recobrar el foco, las páginas repreguntan con esto y repintan
 * solo si cambió (ver `alVolver()` en js/landing.js y js/becas.js).
 *
 * La sesión de juguete se conserva: vive solo en la memoria del módulo y el
 * servidor no la conoce — `/api/yo` la invalidaría a cada vuelta de foco y
 * la cabecera perdería su aviso aunque nadie hubiera tocado nada.
 */
export async function sesionFresca() {
  const antes = cache;
  cache = null;
  const s = await sesion();
  if (!s && antes?.local) { cache = antes; return antes; }
  return s;
}

/* ── API ────────────────────────────────────────────────────────────────── */

export async function api(camino, datos) {
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
  };
}

export async function salir() {
  await salirSupabase();
  try { await api('salir'); } catch { /* si falla, se limpia igual */ }
  cache = null;
  localStorage.removeItem(PERFIL);
  location.reload();
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
// Los logotipos se han retirado: la regla general del proyecto es que no hay
// ni un SVG en la web.
const ORIGENES = [
  ['chatgpt', 'ChatGPT'],
  ['claude', 'Claude'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['reddit', 'Reddit'],
  // «Un amigo» no es una marca: es lo único de la lista que se traduce.
  ['amigo', null],
];

/**
 * La pregunta, una sola vez, justo después de crear la cuenta.
 *
 * Se puede pasar de tres maneras —el aspa, el enlace del pie y `Escape`) y
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
  // El tamaño del modal va en línea a propósito: styles.css la sigue tocando.
  // Cuando el otro agente deje de tocar ese fichero, moverlo a CSS.
  const caja = document.createElement('div');
  caja.className = 'modal modal-wrap encuesta';
  caja.setAttribute('role', 'dialog');
  caja.setAttribute('aria-modal', 'true');
  caja.setAttribute('aria-labelledby', 'enc-t');
  caja.tabIndex = -1;
  caja.style.maxWidth = '560px';
  caja.style.padding = '40px';

  caja.innerHTML = `
    <button class="modal-x" aria-label="${t('cuenta.pasar')}">×</button>

    <h3 id="enc-t">${t('cuenta.encuesta.h')}</h3>
    <p class="enc-sub">${t('cuenta.encuesta.p')}</p>

    <div class="enc-opts">
      ${ORIGENES.map(([v, nombre]) => `<button type="button" data-origen="${v}">${nombre ?? t('cuenta.origen.amigo')}</button>`).join('')}
    </div>

    <p class="enc-skip"><button type="button">${t('cuenta.encuesta.skip')}</button></p>
  `;

  scrim.appendChild(caja);
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';

  let cerrado = false;
  function cerrar(respuesta, pregunta = null) {
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

  function mostrarPasoPregunta(origen) {
    caja.innerHTML = `
      <button class="modal-x" aria-label="${t('cuenta.pasar')}">×</button>

      <h3 id="enc-t">${t('cuenta.encuesta.pregunta.h')}</h3>
      <p class="enc-sub">${t('cuenta.encuesta.pregunta.p')}</p>

      <form id="paso-pregunta">
        <input type="text" id="pregunta-input" class="enc-input"
               placeholder="${t('cuenta.encuesta.pregunta.ph')}"
               autocomplete="off" maxlength="500">
        <div class="enc-acciones">
          <button type="button" id="volver-btn">${t('cuenta.encuesta.pregunta.volver')}</button>
          <button type="submit" id="enviar-pregunta" class="btn btn-rust">${t('cuenta.encuesta.pregunta.enviar')}</button>
        </div>
      </form>

      <p class="enc-skip"><button type="button">${t('cuenta.encuesta.skip')}</button></p>
    `;

    // Referencias a elementos
    const volverBtn = caja.querySelector('#volver-btn');
    const skipBtn = caja.querySelector('.enc-skip button');
    const formulario = caja.querySelector('#paso-pregunta');
    const inputPregunta = caja.querySelector('#pregunta-input');
    const enviarBtn = caja.querySelector('#enviar-pregunta');
    const modalX = caja.querySelector('.modal-x');

    // Volver al paso anterior
    volverBtn.onclick = () => mostrarPasoInicial();

    skipBtn.onclick = () => {
      api('origen', { origen }).catch(() => {});
      caja.innerHTML = `
        <h3>${t('cuenta.encuesta.ok')}</h3>
        <p class="enc-sub">${t('cuenta.encuesta.gracias')}</p>`;
      setTimeout(() => cerrar('pasar'), 850);
    };

    // Enviar el formulario
    formulario.onsubmit = async (e) => {
      e.preventDefault();
      const pregunta = inputPregunta.value.trim();
      enviarBtn.disabled = true;
      enviarBtn.textContent = t('cuenta.encuesta.pregunta.enviando');

      try {
        api('origen', { origen, pregunta }).catch(() => {});

        // Un acuse breve antes de cerrar
        caja.innerHTML = `
          <h3>${t('cuenta.encuesta.ok')}</h3>
          <p class="enc-sub">${t('cuenta.encuesta.gracias')}</p>`;
        setTimeout(() => {
          cerrar(origen, pregunta || null);
        }, 850);
      } catch {
        enviarBtn.disabled = false;
        enviarBtn.textContent = t('cuenta.encuesta.pregunta.enviar');
      }
    };

    // Click en el aspa o fuera del modal
    modalX.onclick = () => {
      api('origen', { origen }).catch(() => {});
      caja.innerHTML = `
        <h3>${t('cuenta.encuesta.ok')}</h3>
        <p class="enc-sub">${t('cuenta.encuesta.gracias')}</p>`;
      setTimeout(() => cerrar(origen), 850);
    };
    caja.addEventListener('click', (e) => {
      if (e.target === scrim) {
        api('origen', { origen }).catch(() => {});
        caja.innerHTML = `<h3>${t('cuenta.encuesta.ok')}</h3><p class="enc-sub">${t('cuenta.encuesta.gracias')}</p>`;
        setTimeout(() => cerrar(origen), 850);
      }
    });

    inputPregunta.focus();
  }

  function mostrarPasoInicial() {
    caja.innerHTML = `
      <button class="modal-x" aria-label="${t('cuenta.pasar')}">×</button>

      <h3 id="enc-t">${t('cuenta.encuesta.h')}</h3>
      <p class="enc-sub">${t('cuenta.encuesta.p')}</p>

      <div class="enc-opts">
        ${ORIGENES.map(([v, nombre]) => `<button type="button" data-origen="${v}">${nombre ?? t('cuenta.origen.amigo')}</button>`).join('')}
      </div>

      <p class="enc-skip"><button type="button">${t('cuenta.encuesta.skip')}</button></p>
    `;

    // Reconfigurar listeners
    caja.focus();

    const conPasoSegundo = new Set(['chatgpt', 'claude']);
    scrim.querySelectorAll('[data-origen]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.origen;
        if (conPasoSegundo.has(v)) {
          mostrarPasoPregunta(v);
        } else {
          api('origen', { origen: v }).catch(() => {});
          caja.innerHTML = `<h3>${t('cuenta.encuesta.ok')}</h3><p class="enc-sub">${t('cuenta.encuesta.gracias')}</p>`;
          setTimeout(() => cerrar(v), 850);
        }
      };
    });
  }

  scrim.querySelector('.modal-x').onclick = () => cerrar('pasar');
  scrim.querySelector('.enc-skip button').onclick = () => cerrar('pasar');
  scrim.addEventListener('click', (e) => { if (e.target === scrim) cerrar('pasar'); });
  document.addEventListener('keydown', alEscape);

  // El foco va al propio diálogo y no a la primera respuesta: enfocando
  // «ChatGPT» el anillo verde la señala como si estuviera elegida, y aquí no
  // hay nada elegido de antemano. Con el foco en el diálogo, `Tab` entra por
  // la primera opción igual.
  caja.focus();

  // Opciones que tienen segundo paso: ChatGPT y Claude
  const conPasoSegundo = new Set(['chatgpt', 'claude']);

  scrim.querySelectorAll('[data-origen]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.origen;

      if (conPasoSegundo.has(v)) {
        // Mostrar el segundo paso
        mostrarPasoPregunta(v);
      } else {
        // Los demás orígenes: enviar directamente y cerrar
        api('origen', { origen: v }).catch(() => {});

        // Un acuse breve antes de cerrar. Sin él, un clic que cierra en el acto
        // no se distingue de un clic que no hizo nada.
        caja.innerHTML = `
          <h3>${t('cuenta.encuesta.ok')}</h3>
          <p class="enc-sub">${t('cuenta.encuesta.gracias')}</p>`;
        setTimeout(() => cerrar(v), 850);
      }
    };
  });
}

/**
 * Un mensaje de error dentro del modal de ajustes. Con `innerHTML`: el
 * texto llega del propio servidor (`d.error`), que lo escribe el sitio, no
 * quien mira la página. No hay correo ni dato de usuario dentro.
 */
function msgDelModal(caja, texto) {
  const c = caja.querySelector(`.modal-msg`);
  if (c) c.innerHTML = `<div class="modal-err">${esc(texto)}</div>`;
}

/* ── Ajustes de la cuenta ───────────────────────────────────────────────── */

/**
 * Lo que una cuenta tiene de suyo: salir y borrarla.
 *
 * Salir es un clic. Borrar es un paso intermedio que pide escribir el correo a
 * mano, porque es lo único que no tiene vuelta atrás: la fila desaparece con
 * sus sesiones. El trámite
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
      <button class="modal-x" aria-label="${t('cuenta.cerrar')}">×</button>

      <h3 id="ajs-t">${t('cuenta.ajustes.t')}</h3>

      <p class="ajs-correo"></p>

      <div class="ajs-act">
        <button type="button" class="btn btn-quiet" id="ajs-salir">${t('cuenta.ajustes.salir')}</button>
        <button type="button" class="btn btn-quiet" id="ajs-sesiones">${t('cuenta.ajustes.sesiones')}</button>
        <button type="button" class="btn btn-rust" id="ajs-borrar">${t('cuenta.ajustes.borrar')}</button>
      </div>

      <div class="modal-msg"></div>`;

    // El correo vuelve de la sesión y lo escribió quien registró la cuenta:
    // por textContent, como en las cabeceras.
    caja.querySelector('.ajs-correo').textContent = s.email ?? '';
    caja.querySelector('#ajs-salir').onclick = salir;
    caja.querySelector('#ajs-sesiones').onclick = cerrarTodas;
    caja.querySelector('#ajs-borrar').onclick = pasoBorrar;
    caja.focus();
  }

  /**
   * Cierra todas las sesiones, también esta. El servidor borra las filas y
   * la cookie se va con la respuesta; recargar deja la puerta puesta y la
   * cabecera como estaba antes de entrar. No hay paso de confirmación: lo
   * peor que puede pasar es tener que volver a entrar, y eso no es
   * irreversible —a diferencia de borrar la cuenta—.
   */
  async function cerrarTodas() {
    const b = caja.querySelector('#ajs-sesiones');
    b.disabled = true;
    try {
      const res = await fetch(`${API}/sesiones`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      cache = null;
      location.reload();
    } catch {
      b.disabled = false;
      msgDelModal(caja, t('cuenta.ajustes.sesionesError'));
    }
  }

  function pasoBorrar() {
    caja.innerHTML = `
      <button class="modal-x" aria-label="${t('cuenta.cerrar')}">×</button>

      <h3>${t('cuenta.borrar.h')}</h3>
      <p class="enc-sub">${t('cuenta.borrar.p')}</p>

      <form id="ajs-form">
        <label class="flab" for="ajs-conf">${t('cuenta.borrar.lab')}</label>
        <input id="ajs-conf" type="email" required autocomplete="email"
               placeholder="${t('cuenta.borrar.ph')}">
        <button type="submit" class="btn btn-rust" id="ajs-si">${t('cuenta.borrar.btn')}</button>
      </form>

      <div class="modal-msg"></div>

      <p class="enc-skip"><button type="button" id="ajs-no">${t('cuenta.borrar.volver')}</button></p>`;

    caja.querySelector('#ajs-no').onclick = pasoInicio;
    caja.querySelector('#ajs-form').onsubmit = alEnviar;
    caja.focus();
  }

  async function alEnviar(e) {
    e.preventDefault();
    const btn = caja.querySelector('#ajs-si');
    const confirmar = caja.querySelector('#ajs-conf').value.trim();

    btn.disabled = true;
    btn.textContent = t('cuenta.borrar.haciendo');

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
      msgDelModal(caja, d.error ?? t('cuenta.borrar.error'));
    } catch {
      msgDelModal(caja, t('cuenta.borrar.error'));
    }

    btn.disabled = false;
    btn.textContent = t('cuenta.borrar.btn');
  }

  pasoInicio();
}

/* ── Modo local ─────────────────────────────────────────────────────────── */

/**
 * Sesión de juguete: existe para poder ver la web sin servidor, y se marca
 * siempre con `local: true` para que la cabecera avise.
 *
 * Lo que NO hace es desbloquear contenido. Antes ponía un `cache` con valor
 * truthy y el buscador lo leía como «hay sesión», así que `velar()` no se
 * llamaba y las fichas se veían enteras sin cuenta. Lo grave: ocurrió justo
 * cuando la API estaba rota —el 17 de octubre de 2026, FUNCTION_INVOCATION_FAILED
 * en todas las rutas—, que es cuando menos tiene sentido regalar la puerta.
 * El velo es el producto; un modo de emergencia que lo levanta miente en la
 * única parte que hay que sustentar.
 *
 * La ofrece la página del alta (js/cuenta.js) cuando el `POST` contesta sin
 * servidor. Allí no se redirige después de crearla: vive solo en la memoria
 * de ese módulo, y saltar a otra página la perdería al instante.
 */
export function sesionJuguete(correo) {
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