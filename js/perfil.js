/**
 * perfil.js — La página de perfil.
 *
 * Antes, la cuenta se gestionaba desde un modal que se abría en la cabecera,
 * con el nombre del usuario al lado. Se movió aquí: la cabecera queda limpia
 * —solo dice quién eres— y todo lo que se puede hacer con la cuenta vive en
 * una página con columna lateral, donde hay sitio para explicarlo.
 *
 * Lo que hay aquí:
 *
 *  1. **El perfil académico** —la nota, la edad, el nivel y el destino— que
 *     hasta ahora se rellenaba en el buscador y se guardaba en el navegador.
 *     Se enseña aquí y se guarda en el mismo sitio, para que quien venga a
 *     gestionar la cuenta vea también de qué datos se trata.
 *  2. **Las sesiones** —cerrar esta, cerrar todas.
 *  3. **La cuenta** —borrarla.
 *
 * El correo sale de la sesión (que la emite el servidor), nunca de
 * `localStorage`: es el dato que decide qué fila se toca.
 */

import { sesion, sesionFresca, salir } from './auth.js';
import { perfil } from './auth.js';
import { t, alCambiarIdioma, idiomaActual } from './i18n.js';
import { CODIGOS, nombreDe } from './paises.js';

const API = '/api';

/* ── El perfil académico ─────────────────────────────────────────────────── */

/**
 * El perfil vive en `localStorage`: la nota, la edad, el nivel y el destino no
 * salen del navegador. Se escribe con los mismos ids que usa el buscador
 * (`nota`, `edad`, `nivel`, `pais`) porque es el mismo dato, y así quien
 * escribe aquí y quien lo rellena allí terminan con lo mismo.
 */
function pintarPerfil() {
  const p = perfil.leer();

  const nota = document.getElementById('pf-nota');
  if (nota) nota.value = p.nota ?? '';

  const edad = document.getElementById('pf-edad');
  if (edad) edad.value = p.edad ?? '';

  const nivel = document.getElementById('pf-nivel');
  if (nivel) {
    const v = p.nivel ?? '';
    // El `value` se escribe y no se deja que el navegador lo tome del texto:
    // el perfil guarda el nombre castellano y el selector enseña el del
    // idioma. Si se tomara del texto, un navegador en inglés guardaría
    // «Bachelor's» y el filtro no encontraría nada.
    nivel.value = [...nivel.options].some((o) => o.value === v) ? v : '';
  }

  const pais = document.getElementById('pf-pais');
  if (pais) pais.value = p.pais ?? '';
}

function guardarPerfil() {
  const val = (id) => document.getElementById(id)?.value ?? '';
  perfil.guardar({
    nota: val('pf-nota'),
    edad: val('pf-edad'),
    nivel: val('pf-nivel'),
    pais: val('pf-pais'),
  });
}

/* ── La página ───────────────────────────────────────────────────────────── */

/** Pinta el cuerpo de la página con los datos de la sesión. */
function pintar(s) {
  const cuerpo = document.getElementById('perfil-cuerpo');
  const email = document.getElementById('perfil-email');
  if (email) email.textContent = s?.email ?? '';

  if (!s) {
    // Sin sesión no hay perfil que enseñar. La puerta al alta está aquí
    // también, y es la única: se llega a esta página desde la cabecera, que
    // solo la enseña cuando hay sesión, pero la URL es pública.
    cuerpo.innerHTML = `
      <div class="perfil-vacio">
        <h2>${t('perfil.sin.h')}</h2>
        <p>${t('perfil.sin.p')}</p>
        <a class="btn btn-brand" href="cuenta.html?desde=%2Fperfil.html" target="_blank" rel="noopener">${t('perfil.sin.btn')}</a>
      </div>`;
    return;
  }

  cuerpo.innerHTML = `
    <section class="perfil-bloque">
      <h2>${t('perfil.datos.h')}</h2>
      <p class="perfil-bloque-p">${t('perfil.datos.p')}</p>

      <div class="perfil-campos">
        <div class="f">
          <label for="pf-nota">${t('becas.nota')}</label>
          <input id="pf-nota" type="text" inputmode="decimal" placeholder="7,5" maxlength="5">
        </div>
        <div class="f">
          <label for="pf-edad">${t('becas.edad')}</label>
          <input id="pf-edad" type="number" min="15" max="80" placeholder="21" inputmode="numeric">
        </div>
        <div class="f">
          <label for="pf-nivel">${t('becas.nivel')}</label>
          <select id="pf-nivel">
            <option value="">${t('becas.cualquiera')}</option>
            <option value="Grado">${t('nivel.grado')}</option>
            <option value="Máster">${t('nivel.master')}</option>
            <option value="Doctorado">${t('nivel.doctorado')}</option>
          </select>
        </div>
        <!-- El destino se rellena en pintarPaises(), que corre justo
             después de este innerHTML: si se pintara aquí, las opciones
             nacerían antes que el select y no entrarían nunca. -->
        <div class="f">
          <label for="pf-pais">${t('becas.destino')}</label>
          <select id="pf-pais"><option value="">${t('becas.cualquiera')}</option></select>
        </div>
      </div>

      <div class="perfil-acciones">
        <button class="btn btn-brand" id="pf-guardar">${t('perfil.datos.guardar')}</button>
        <span class="perfil-guardado" id="pf-aviso"></span>
      </div>
    </section>

    <section class="perfil-bloque">
      <h2>${t('perfil.cuenta.h')}</h2>
      <p class="perfil-bloque-p">${t('perfil.cuenta.p')}</p>

      <div class="perfil-correo" id="pf-correo"></div>

      <div class="perfil-lista">
        <div class="perfil-fila">
          <div>
            <strong>${t('perfil.sesiones.h')}</strong>
            <p>${t('perfil.sesiones.p')}</p>
          </div>
          <button class="btn btn-quiet" id="pf-sesiones">${t('perfil.sesiones.btn')}</button>
        </div>

        <div class="perfil-fila">
          <div>
            <strong>${t('perfil.borrar.h')}</strong>
            <p>${t('perfil.borrar.p')}</p>
          </div>
          <button class="btn btn-quiet" id="pf-borrar">${t('perfil.borrar.btn')}</button>
        </div>
      </div>

      <div class="perfil-msg" id="pf-msg"></div>
    </section>

    <section class="perfil-bloque" id="pf-borrar-zona" hidden>
      <h2>${t('cuenta.borrar.h')}</h2>
      <p class="perfil-bloque-p">${t('cuenta.borrar.p')}</p>

      <form id="pf-form-borrar">
        <label class="flab" for="pf-conf">${t('cuenta.borrar.lab')}</label>
        <input id="pf-conf" type="email" required autocomplete="email"
               placeholder="${t('cuenta.borrar.ph')}">
        <div class="perfil-acciones">
          <button type="submit" class="btn btn-brand" id="pf-si">${t('cuenta.borrar.btn')}</button>
          <button type="button" class="btn btn-quiet" id="pf-no">${t('cuenta.borrar.volver')}</button>
        </div>
      </form>
    </section>`;

  // El correo sale de la sesión y lo escribió quien registró la cuenta: por
  // `textContent`, como en las cabeceras. Interpolarlo en una plantilla
  // permitiría inyectar HTML con un correo.
  document.getElementById('pf-correo').textContent = s.email ?? '';

  // El orden importa: primero el `<select>` de destino, luego sus opciones
  // y solo al final el valor guardado. Al revés, `pintarPerfil()` busca un
  // país que todavía no está en la lista y lo deja en blanco.
  pintarPaises();
  pintarPerfil();
  conectar();
}

/** Los botones de la página, ya con el markup en su sitio. */
function conectar() {
  document.getElementById('pf-guardar')?.addEventListener('click', () => {
    guardarPerfil();
    const aviso = document.getElementById('pf-aviso');
    aviso.textContent = t('perfil.datos.guardado');
    setTimeout(() => { aviso.textContent = ''; }, 2500);
  });

  document.getElementById('pf-sesiones')?.addEventListener('click', cerrarTodas);

  document.getElementById('pf-borrar')?.addEventListener('click', () => {
    const zona = document.getElementById('pf-borrar-zona');
    zona.hidden = false;
    zona.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('pf-conf')?.focus();
  });

  document.getElementById('pf-no')?.addEventListener('click', () => {
    document.getElementById('pf-borrar-zona').hidden = true;
  });

  document.getElementById('pf-form-borrar')?.addEventListener('submit', borrar);

  document.getElementById('perfil-salir')?.addEventListener('click', salir);
}

/**
 * Cierra todas las sesiones, también esta. El servidor borra las filas y la
 * cookie se va con la respuesta; recargar deja la puerta puesta. No hay paso
 * de confirmación: lo peor que puede pasar es tener que volver a entrar, y
 * eso no es irreversible —a diferencia de borrar la cuenta—.
 */
async function cerrarTodas() {
  const b = document.getElementById('pf-sesiones');
  b.disabled = true;
  try {
    const res = await fetch(`${API}/sesiones`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(String(res.status));
    location.reload();
  } catch {
    b.disabled = false;
    mensaje(t('cuenta.ajustes.sesionesError'));
  }
}

/**
 * Borrar la cuenta. El servidor lo comprueba también —el navegador siempre
 * puede mentir— y por eso la ruta solo lo acepta con el correo bien escrito.
 */
async function borrar(e) {
  e.preventDefault();
  const btn = document.getElementById('pf-si');
  const confirmar = document.getElementById('pf-conf').value.trim();

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
        localStorage.removeItem('becascout.perfil');
        localStorage.removeItem('becascout.origen');
      } catch { /* modo privado */ }
      location.reload();
      return;
    }

    const d = await res.json().catch(() => ({}));
    mensaje(d.error ?? t('cuenta.borrar.error'));
  } catch {
    mensaje(t('cuenta.borrar.error'));
  }

  btn.disabled = false;
  btn.textContent = t('cuenta.borrar.btn');
}

/** Un mensaje de error en la página. */
function mensaje(texto) {
  const c = document.getElementById('pf-msg');
  if (!c) return;
  // `textContent` y no una plantilla: el texto viene del servidor, pero un
  // mensaje de error no es sitio para confiar en que nunca traerá un `<`.
  const d = document.createElement('div');
  d.className = 'modal-err';
  d.textContent = String(texto);
  c.replaceChildren(d);
}

/* ── Arranque ────────────────────────────────────────────────────────────── */

/** El nombre del país en el idioma puesto, igual que en el buscador. */
function paisDe(cod) {
  if (idiomaActual() === 'es') return nombreDe(cod);
  const clave = `pais.${cod}`;
  const texto = t(clave);
  return texto === clave ? nombreDe(cod) : texto;
}

/**
 * El destino: los países los pone `js/paises.js`, que es la lista única —
 * la usan el desplegable y los conectores de la ingesta, y si son dos se
 * desincronizan.
 */
function pintarPaises() {
  const sel = document.getElementById('pf-pais');
  if (!sel) return;
  for (const c of CODIGOS) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = paisDe(c);
    sel.appendChild(o);
  }
}

async function iniciar() {
  const s = await sesion();
  pintar(s);

  // El idioma se puede cambiar desde aquí, así que lo que se ha pintado
  // vuelve a pintarse.
  alCambiarIdioma(async () => {
    const ahora = await sesionFresca();
    pintar(ahora);
  });
}

iniciar();
