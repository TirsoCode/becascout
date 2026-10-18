/**
 * landing.js — Portada.
 *
 * La portada no enseña ni una beca. Eso es deliberado y no por austeridad:
 * si las enseñáramos, la cuenta dejaría de tener motivo de existir. Lo que
 * hace el panel lateral es enseñar la forma del problema —un listado con el
 * texto tapado— sin ningún dato real.
 */

import { sesion, pedirAcceso } from './auth.js';

/* Si ya hay sesión, el botón de la cabecera pasa a ser el de buscar. */
async function pintarCabecera() {
  const s = await sesion();
  const cont = document.querySelector('.top-act');
  if (!cont) return;

  const crear = cont.querySelector('[data-open-auth]');
  if (!s) return;

  if (crear) crear.remove();
  if (cont.querySelector('.session')) return;

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

  const av = document.createElement('span');
  av.className = 'session-av';
  av.textContent = (s.email?.[0] ?? '?').toUpperCase();

  const nombre = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = String(s.email ?? '').split('@')[0];
  nombre.appendChild(b);

  div.append(av, nombre);
  cont.appendChild(div);
}

/* Todos los botones de la portada abren el mismo modal. */
function conectarBotones() {
  document.querySelectorAll('[data-open-auth]').forEach((b) => {
    b.addEventListener('click', () => pedirAcceso());
  });
}

/* La cabecera ya trae el botón en la plantilla, así que aquí no se inserta
   otro: `pintarCabecera()` es para páginas que no lo tienen escrito a mano. */
pintarCabecera();
conectarBotones();
