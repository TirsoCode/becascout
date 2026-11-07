/**
 * cuenta.js — La página del alta (cuenta.html).
 *
 * Crear cuenta ya no es un modal flotante sobre la página que lo pidió: es
 * una página propia, a pantalla entera, que las puertas —los botones de
 * «Crear cuenta»— abren en **otra pestaña** con `target="_blank"`. Al
 * terminar, esta pestaña vuelve sola al sitio del que se vino, con la sesión
 * ya puesta en la cookie (`bs_sesion`, la escribe el servidor), y la pestaña
 * de origen repregunta al servidor al recobrar el foco (`sesionFresca()` en
 * js/auth.js). Una cuenta creada, el alta no duerme en una promesa de
 * JavaScript: es camino de vuelta visible.
 *
 * ── Y si el servidor no está ─────────────────────────────────────────────
 *
 * El modo de juguete sigue existiendo (ver js/auth.js, donde se define), y
 * se ofrece aquí igual que en el modal de antes cuando el `POST` contesta
 * sin servidor. La diferencia: **aquí la sesión de juguete no vuelve a
 * ninguna parte**. Vive solo en la memoria de este módulo, así que
 * redirigir al buscador la perdería al instante y el usuario habría visto
 * desaparecer la sesión que acaba de crear. Por eso se queda en la página,
 * con el aviso a la vista de que se acaba al cerrar la pestaña.
 *
 * ── El salto de vuelta, y de dónde sale ─────────────────────────────────
 *
 * Los enlaces de las puertas llevan `cuenta.html?desde=%2F` o
 * `?desde=%2Fbecas.html`. La lista de abajo cierra el parámetro a páginas
 * reales del sitio: un `?desde` inventado no debe llevar a un 404 ni, con
 * un parámetro más suelto, a un sitio ajeno. El mismo gesto lleva la
 * bandera `bs.encuesta` (sessionStorage): como el callback de Google, se
 * pone antes de saltar y la gasta `revisarEncuesta()` en la página de
 * llegada, que es donde se pregunta de dónde se ha conocido el sitio.
 */

import { api, sesion, sesionJuguete } from './auth.js';
import { iniciarSupabase, entrarConGoogle } from './supabase.js';
// Importar `t` arranca i18n.js: el conmutador de la barra de arriba funciona
// aunque esta página no cargue ningún otro módulo.
import { t, alCambiarIdioma } from './i18n.js';

// ── Si ya hay sesión, no hay por qué crear otra cuenta ────────────────────
// La página de alta es solo para quien no tiene cuenta. Si ya hay sesión
// (cookie del servidor o juguete en memoria), se vuelve al buscador.
async function irSiYaHaySesion() {
  const s = await sesion();
  if (s) {
    const desde = new URLSearchParams(location.search).get('desde') || DESTINO_DEFECTO;
    if (!DESTINOS.includes(desde)) location.replace(DESTINO_DEFECTO);
    else location.replace(desde);
  }
}
irSiYaHaySesion();

// El id del proyecto de Google —el mismo de `GOOGLE_CLIENT_ID` en Vercel—. No
// es un secreto: viaja al navegador en cualquier flujo OAuth. Es el último
// recurso del camino sin Supabase; el id que manda es el que sirve
// `/api/config`.
const MARCA_GOOGLE = '436706781551-o1nquf0ib9lp1p1vs1st0g08bs2a4k8m.apps.googleusercontent.com';

// La bandera que lee `revisarEncuesta()` en la página de llegada. El valor
// vive definido en js/auth.js; aquí se usa el mismo literal con la nota de
// arriba, y callback.js lo lleva igual: tres ficheros, un solo significado.
const ENCUESTA = 'bs.encuesta';

/** Las páginas del sitio a las que tiene sentido volver tras el alta. */
const DESTINOS = ['/', '/becas.html', '/erasmus-mundus.html'];
const DESTINO_DEFECTO = '/becas.html';

const $ = (s) => document.querySelector(s);

/** La página de origen validada, para partir hacia ella. */
function destinoDeVuelta() {
  let pedido = null;
  try {
    pedido = new URLSearchParams(location.search).get('desde');
  } catch { /* location rara: cae al defecto */ }
  if (pedido && DESTINOS.includes(pedido)) return pedido;
  return DESTINO_DEFECTO;
}

/** Vuelve a la página de origen: esta pestaña sigue el camino de quien abrió
 *  el alta y deja de ser una página de formulario. */
function volver() {
  location.replace(destinoDeVuelta());
}

/* ── Mensajes ───────────────────────────────────────────────────────────── */

function ponerError(texto) {
  const msg = $('.modal-msg');
  if (msg) msg.innerHTML = `<div class="modal-err">${esc(texto)}</div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ── Google ─────────────────────────────────────────────────────────────── */

/* Sin logotipo: el sitio no lleva iconos. El botón dice «Continuar con
   Google» y el color de Google lo pone la propia marca al abrirse la
   ventana de consentimientos. */
async function pintarGoogle() {
  let config = {};
  try {
    config = await fetch('/api/config').then((r) => (r.ok ? r.json() : {}));
  } catch { /* sin servidor delante: lo mismo que no hay claves */ }

  if (!config.googleId) return;
  const sitio = document.getElementById('google-sitio');
  sitio.innerHTML = `
    <button class="gbtn" id="btn-google" type="button">${t('cuenta.google')}</button>

    <div class="modal-sep">${t('cuenta.sep')}</div>`;

  document.getElementById('btn-google').onclick = async () => {
    const btn = document.getElementById('btn-google');

    // Supabase primero. Si no está configurado —en desarrollo, o antes de
    // crear el proyecto— se cae al flujo con Google Identity Services, que
    // funciona sin ningún servicio de por medio. Tener las dos rutas
    // significa que el botón nunca queda muerto.
    if (await iniciarSupabase()) {
      try {
        // El callback de Google (auth/callback.js) lee `bs.destino` y vuelve
        // a esa página. Aquí como modal: no a esta, que ya no tiene nada que
        // enseñar, sino a la de origen, con la sesión ya puesta.
        sessionStorage.setItem('bs.destino', destinoDeVuelta());
        await entrarConGoogle();
        return;   // Supabase redirige; no hay callback en esta página
      } catch (err) {
        ponerError(err.message);
        return;
      }
    }

    conGoogle(config.googleId);
  };
}

function conGoogle(clientId) {
  const btn = document.getElementById('btn-google');
  btn.disabled = true;
  btn.innerHTML = `${GOOGLE_SVG} ${t('cuenta.google.cargando')}`;

  if (!window.google?.accounts?.oauth2) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => lanzar(clientId);
    s.onerror = () => {
      ponerError(t('cuenta.google.error'));
      btn.disabled = false;
      btn.innerHTML = `${GOOGLE_SVG} ${t('cuenta.google')}`;
    };
    document.head.appendChild(s);
    return;
  }
  lanzar(clientId);
}

function lanzar(clientId) {
  try {
    const client = window.google.accounts.oauth2.initTokenClient({
      // El id del servidor manda; la constante de arriba es la del proyecto,
      // para cuando `/api/config` no contestara.
      client_id: clientId || MARCA_GOOGLE,
      scope: 'email',
      callback: async (r) => {
        if (r.error) { ponerError(t('cuenta.google.devuelto', { c: r.error })); return; }
        try {
          // Se manda el **access token**, no el correo que devuelve el
          // perfil: el servidor pregunta a Google quién es y solo entonces
          // existe la cuenta. Ver js/auth.js y auth/callback.js.
          const res = await api('registro-google', { token: r.access_token });
          if (!res.ok) throw new Error(res.error ?? t('cuenta.error.generico'));
          // `nuevo` lo dice el servidor al escribir la cuenta: si ya existía
          // —lo normal al volver a entrar con Google— no hay pregunta.
          if (res.nuevo) sessionStorage.setItem(ENCUESTA, '1');
          volver();
        } catch (err) {
          ponerError(err.message);
        }
      },
      error_callback: () => ponerError(t('cuenta.google.cancelado')),
    });
    client.requestAccessToken({ prompt: '' });
  } catch (err) {
    ponerError(err.message);
  }
}

/* ── Crear o entrar ─────────────────────────────────────────────────────── */

/**
 * El formulario es el mismo para crear y para entrar; lo único que cambia es
 * a quién se llama y qué se le pide a la contraseña, así que va como enlace
 * al pie (`#modal-cambia`), que además no parte la pantalla en dos mitades
 * antes de enseñar nada. Es el mismo mecanismo que tenía el modal.
 */
let accion = 'registro';
let enLocal = false;   // tras un fallo de red se ofrece, y luego ya no se repregunta

const form = $('#form');
const pass = $('#f-pass');
const enviar = $('#f-enviar');
const hint = $('#f-hint');
const alt = $('#modal-alt');
const msg = $('.modal-msg');

function pintarModo() {
  enviar.textContent = accion === 'registro'
    ? t('cuenta.enviar.registro')
    : t('cuenta.enviar.login');
  pass.minLength = accion === 'registro' ? 10 : 1;
  pass.autocomplete = accion === 'registro' ? 'new-password' : 'current-password';
  pass.placeholder = accion === 'registro'
    ? t('cuenta.pass.ph')
    : t('cuenta.pass.ph.login');
  hint.textContent = accion === 'registro' ? t('cuenta.pista') : '';
  hint.style.display = accion === 'registro' ? '' : 'none';
  msg.innerHTML = '';
  // El encabezado sigue al modo. Poner «Crea tu cuenta» encima de un
  // formulario de iniciar sesión confunde: quien ya tiene cuenta no viene a
  // crearse nada, viene a entrar.
  $('#modal-t').textContent = accion === 'registro'
    ? t('cuenta.titulo.registro')
    : t('cuenta.titulo.login');
  $('#modal-sub').textContent = accion === 'registro'
    ? t('cuenta.sub.registro')
    : t('cuenta.sub.login');
  alt.innerHTML = accion === 'registro'
    ? `${t('cuenta.alt.login')} <button type="button" id="modal-cambia">${t('cuenta.alt.login.btn')}</button>`
    : `${t('cuenta.alt.crear')} <button type="button" id="modal-cambia">${t('cuenta.alt.crear.btn')}</button>`;
  alt.querySelector('#modal-cambia').onclick =
    () => { accion = accion === 'registro' ? 'login' : 'registro'; pintarModo(); };
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const correo = $('#f-correo').value.trim();
  const password = pass.value;

  // En modo local, ya creado el modo de juguete, los envíos no van a la red.
  if (enLocal) {
    sesionJuguete(correo);
    msg.innerHTML = `<div class="modal-ok">${t('cuenta.local.ok')}</div>`;
    return;
  }

  enviar.disabled = true;
  enviar.textContent = accion === 'registro'
    ? t('cuenta.enviando.registro')
    : t('cuenta.enviando.login');

  const r = await api(accion, { correo, password });

  if (r.ok) {
    // Solo al crear cuenta. A quien entra con una que ya tenía no se le
    // pregunta de dónde nos conoció: ya lo contestó —o lo pasó— el primer
    // día. La bandera la gasta `revisarEncuesta()` en la página de llegada.
    if (accion === 'registro') {
      try { sessionStorage.setItem(ENCUESTA, '1'); } catch { /* modo privado */ }
    }
    volver();
    return;
  }

  enviar.disabled = false;
  enviar.textContent = accion === 'registro'
    ? t('cuenta.enviar.registro')
    : t('cuenta.enviar.login');

  if (r.status === 0 || r.status === 404) {
    // No hay servidor. Se ofrece el modo local en lugar de un error seco,
    // pero se dice que es de juguete: si alguien lo toma por una cuenta de
    // verdad, el sitio le ha mentido.
    enLocal = true;
    msg.innerHTML = `<div class="modal-msg amber">${t('cuenta.local.aviso')}
      <button id="btn-local" type="button" style="margin-top:8px;width:100%">${t('cuenta.local.btn')}</button></div>`;
    msg.querySelector('#btn-local').onclick = () => {
      sesionJuguete(correo);
      msg.innerHTML = `<div class="modal-ok">${t('cuenta.local.ok')}</div>`;
    };
    return;
  }

  ponerError(r.error ?? t('cuenta.error.generico'));
};

/* El foco va al correo en escritorio; en móvil no: un teclado que sale solo
   tapa la mitad de la página y pisa el botón de Google. */
pintarModo();
if (matchMedia('(min-width: 861px)').matches) $('#f-correo').focus();

pintarGoogle();

/* Al cambiar el idioma se reescribe lo que pinta JavaScript: el título, el
 * botón, el enlace del pie y los marcadores. Lo estático lo repinta i18n.js
 * solo, con sus data-i18n. */
alCambiarIdioma(pintarModo);

/* La marca vuelve a la página de origen; si nadie abrió esta pestaña con
   `?desde`, la marca lleva al buscador, que es el destino por defecto. */
document.getElementById('marca').href = destinoDeVuelta();
