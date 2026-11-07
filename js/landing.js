/**
 * landing.js — Portada.
 *
 * La portada no enseña ni una beca. Eso es deliberado y no por austeridad:
 * si las enseñáramos, la cuenta dejaría de tener motivo de existir. Lo que
 * hace el panel lateral es enseñar la forma del problema —un listado con el
 * texto tapado— sin ningún dato real.
 */

import { sesion, sesionFresca, revisarEncuesta } from './auth.js';
import { t } from './i18n.js';

/* Si ya hay sesión, el botón de la cabecera pasa a ser el de buscar. */
async function pintarCabecera() {
  const cont = document.querySelector('.top-act');
  if (!cont) return;
  // Evita el parpadeo de «Crear cuenta» mientras se resuelve la sesión
  const s = await sesion();
  // Lo que esta pintada representa es también el estado que `alVolver`
  // compara. Empezar en `null` era una trampa: el primer repinte tras el alta
  // en la otra pestaña ve `null`, no repinta, y deja escrito el nuevo valor —
  // el «Crear cuenta» se quedaría ahí para siempre con la cuenta ya hecha.
  vista = s ? (s.local ? 'local' : 'si') : 'no';

  const crear = cont.querySelector('[data-open-auth]');
  if (!s) {
    // Sin sesión, restauramos los botones originales con la marca de creación
    cont.innerHTML = `
      <a class="btn btn-quiet" href="becas.html" data-i18n="nav.buscarCorto" data-ocultar-movil>Buscar</a>
      <a class="btn btn-brand" href="cuenta.html?desde=%2F" target="_blank" rel="noopener" data-open-auth data-i18n="nav.crear">Crear cuenta</a>
    `;
    return;
  }

  if (crear) crear.remove();
  if (cont.querySelector('.session')) return;

  /* La otra puerta de la portada —la grande del héroe— también anuncia
     «Crear cuenta gratis». Con sesión es un problema doble: la cuenta ya
     está y el enlace manda al alta de todos modos, en otra pestaña, como si
     nada hubiera pasado. Pasa a ser el camino siguiente: «Buscar becas» al
     buscador. */
  const hero = document.querySelector('[data-open-auth]');
  if (hero) {
    hero.removeAttribute('data-open-auth');
    hero.setAttribute('href', '/becas.html');
    hero.setAttribute('data-i18n', 'nav.buscar');
    hero.textContent = t('nav.buscar');
  }
  // Cuando hay sesión, el botón "Ver cómo se ve" es redundante con "Buscar becas"
  const verComo = document.querySelector('.hero-cta a.btn-ghost[data-i18n="inicio.hero.ver"]');
  if (verComo) verComo.style.display = 'none';

  // El correo se pinta con `textContent` y no con `innerHTML`.
  //
  // Antes iba interpolado en una plantilla: `${s.email.split('@')[0]}`. El
  // correo es un dato que elige quien se registra, y el patrón de validación
  // del servidor llegaba a aceptar `<`, `>` y comillas, así que un correo con
  // `<img src=x onerror=…>` se ejecutaba como HTML en la cabecera de la
  // portada. Comprobado el 17 de octubre de 2026: un alta con
  // `<img/src=x/onerror=alert(1)>@a.co` se guardaba tal cual y `/api/yo` lo
  // devolvía sin tocar.
  //
  // Con `textContent` no hay plantilla, no hay qué escapar y el problema no
  // puede volver a aparecer por este camino. Además se arregla de paso el
  // `s.email.split()` revienta con un `undefined` si el correo falta.
  const div = document.createElement('div');
  div.className = 'session';

  const nombre = document.createElement('span');
  const b = document.createElement('b');
  const parte = String(s.email ?? '').split('@')[0];
  b.textContent = parte.charAt(0).toUpperCase() + parte.slice(1);
  nombre.appendChild(b);

  // El nombre ya no abre nada: el perfil —salir, cerrar sesiones, borrar la
  // cuenta— vive en su propia página (`perfil.html`), a la que se llega por
  // cualquiera de los dos caminos. En la sesión de juguete no hay cuenta que
  // gestionar, así que el nombre queda como texto suelto.
  if (!s.local) {
    const pf = document.createElement('a');
    pf.className = 'session-perfil';
    pf.href = '/perfil.html';
    pf.title = t('cuenta.ajustes.tooltip');
    pf.append(nombre);
    div.append(pf);
  } else {
    div.append(nombre);
  }

  cont.appendChild(div);
}

/* La pestaña, cuando recupera el foco.
 *
 * El alta vive en `cuenta.html`, que las puertas de esta página abren en
 * OTRA PESTAÑA — son enlaces, no botones: el navegador la abre y esta página
 * no tiene nada que hacer con el clic. Pero mientras el alta se hacía, aquí
 * uno quedaba mirando el «Crear cuenta» de siempre con la cuenta ya hecha
 * en la otra pestaña. Al volver, se repregunta sin cache (`sesionFresca`)
 * y solo si cambió se repinta la cabecera. */
let vista = null;
async function alVolver() {
  if (document.visibilityState !== 'visible') return;
  const s = await sesionFresca();
  const ahora = s ? (s.local ? 'local' : 'si') : 'no';
  if (vista !== null && ahora !== vista) pintarCabecera();
  vista = ahora;
}
document.addEventListener('visibilitychange', alVolver);
window.addEventListener('focus', alVolver);

/* La cabecera ya trae el botón en la plantilla, así que aquí no se inserta
   otro: `pintarCabecera()` es para páginas que no lo tienen escrito a mano. */
pintarCabecera();

// Si se aterriza aquí después de crear cuenta con Google —o tras el salto de
// vuelta de cuenta.html con el alta recién hecha—, toca la pregunta de
// llegada. La bandera la dejó auth/callback.js o js/cuenta.js (ver
// js/auth.js).
revisarEncuesta();
