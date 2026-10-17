/**
 * landing.js — Portada.
 *
 * La portada no enseña ni una beca. Eso es deliberado y no por austeridad:
 * si las enseñáramos, la cuenta dejaría de tener motivo de existir. Lo que
 * hace el panel lateral es enseñar la forma del problema —un listado con el
 * texto tapado— sinchsel ningún dato real.
 */

import { sesion, pedirAcceso } from './auth.js';

/* Si ya hay sesión, el botón de la cabecera pasa a ser el de buscar. */
async function pintarCabecera() {
  const s = await sesion();
  const cont = document.querySelector('.top-act');
  if (!cont) return;

  const crear = cont.querySelector('[data-open-auth]');
  if (s) {
    if (crear) crear.remove();
    if (!cont.querySelector('.session')) {
      const div = document.createElement('div');
      div.className = 'session';
      const ini = (s.email?.[0] ?? '?').toUpperCase();
      div.innerHTML = `
        <span class="session-av">${ini}</span>
        <span><b>${s.email.split('@')[0]}</b></span>`;
      cont.appendChild(div);
    }
  } else if (crear) {
    crear.onclick = () => pedirAcceso();
  }
}

/* Todos los botones de la portada abren el mismo modal. */
function conectarBotones() {
  document.querySelectorAll('[data-open-auth]').forEach((b) => {
    b.addEventListener('click', () => pedirAcceso());
  });
}

/* La cabecera ya trae el botón en la plantilla, así que aquí no se inserta
   otro: `montarSesion()` es para páginas que no lo tienen escrito a mano. */
pintarCabecera();
conectarBotones();