/**
 * cookies.js — Aviso de cookies.
 *
 * Se muestra una vez y no vuelve a aparecer. No hay botones de «aceptar» y
 * «rechazar» porque sería una decisión falsa: usamos **una** cookie
 * técnica, y sin ella la web sigue funcionando (simplemente te pide la
 * contraseña cada vez). Enseñar dos botones iguales para una cookie
 * obligatoria por contrato es el patrón que hace que la gente klikée en
 * cualquier cosa sin leer.
 *
 * El aviso vive en `localStorage` y no en una cookie, porque si se guardara
 * en una cookie el aviso generaría su propia excepción y habría que explicarlo.
 */

const CLAVE = 'becascout.cookies';

export function avisoCookies() {
  let visto = null;
  try { visto = localStorage.getItem(CLAVE); } catch { /* modo privado */ }

  // En modo privado el localStorage puede fallar al escribir. En ese caso se
  // enseña el aviso aunque se repita: es preferible molestarse a fingir que
  // la memoria no funciona.
  if (visto === 'ok') return;

  const barra = document.createElement('div');
  barra.className = 'cookies';
  barra.setAttribute('role', 'note');
  barra.setAttribute('aria-label', 'Aviso de cookies');
  barra.innerHTML = `
    <p>
      Usamos una cookie para saber que has iniciado sesión, y nada más: no hay
      analítica ni seguimiento. <a href="cookies.html">Ver la política</a>.
    </p>
    <button class="cookies-ok">Entendido</button>`;

  // Al final del documento, después del pie. Va en el flujo normal y no
  // posicionado: así hace scroll con la página y no se cruza con el contenido.
  document.body.appendChild(barra);

  barra.querySelector('.cookies-ok').onclick = () => {
    try { localStorage.setItem(CLAVE, 'ok'); } catch { /* da igual */ }
    barra.remove();
  };
}

// El aviso bloquea el final de la página, así que en móvil se deja sitio.
document.addEventListener('DOMContentLoaded', avisoCookies);