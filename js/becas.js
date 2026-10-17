/**
 * becas.js — Buscador, con la puerta puesta encima.
 *
 * ── Cómo funciona el bloqueo ─────────────────────────────────────────────
 *
 * El contenido se pinta entero y luego se cubre con un velo. No se pide el
 * dato primero y se pinta después. La diferencia parece de detalle y no lo
 * es: si el texto no llega a pintarse nunca, entonces no está en el DOM, y no
 * se puede leer con el inspector ni con «ver código fuente». Aquí sí está, y
 * eso es una decisión consciente en la dirección contraria a la habitual —
 * este contenido es público, lo que se esconde es la lista, no el secreto.
 *
 * Por eso el bloqueo es puramente visual: `filter: blur()` sobre el contenido
 * real, más una retícula de píxeles encima. El texto se sigue dibujando (se
 * ve borroso, que es justo el efecto buscado), no se sustituye por un
 * placeholder. Consecuencia: el ancho de banda y el trabajo de render son
 * los mismos tengas cuenta o no.
 */

import { sesion, pedirAcceso, perfil, salir } from './auth.js';

const R = 34;                  // radio del anillo
const CIRC = 2 * Math.PI * R;
const ETIQUETA = {
  nota_minima: 'Nota media mínima',
  edad_max: 'Edad máxima',
  edad_min: 'Edad mínima',
  idioma: 'Idioma',
  titulacion: 'Titulación',
  destino: 'Destino',
  ingresos: 'Ingresos',
  justificacion: 'Documentación',
  importe: 'Importe',
  fecha_limite: 'Plazo',
  duracion_max: 'Duración máxima',
  ects: 'ECTS',
};

let becas = [];

/* ── Arranque ───────────────────────────────────────────────────────────── */

async function cargar() {
  try {
    const r = await fetch('data/becas.json');
    becas = (await r.json()).becas ?? [];
  } catch {
    document.getElementById('zona-lista').innerHTML = `
      <div class="empty">
        <h3>No hay datos cargados</h3>
        <p>Ejecuta <code>node ingest/run.mjs</code> para generar <code>data/becas.json</code>.</p>
      </div>`;
    return;
  }
  rellenarPerfil();
  pintar();
}

function rellenarPerfil() {
  const p = perfil.leer();
  $('#nota').value = p.nota ?? '';
  $('#edad').value = p.edad ?? '';
  $('#nivel').value = p.nivel ?? '';
  $('#pais').value = p.pais ?? '';
}

/* ── Cabecera de sesión ─────────────────────────────────────────────────── */

/** La cabecera espera a la respuesta del servidor: la sesión ya no está en
 *  localStorage, y pintar «entrar» antes de saberlo hace parpadear el botón
 *  en cada carga. */
async function pintarCabecera() {
  const zona = $('#sesion-zona');
  zona.innerHTML = '<span class="pill mono">…</span>';
  const s = await sesion();

  zona.innerHTML = '';
  if (s) {
    const d = document.createElement('div');
    d.className = 'session';
    d.innerHTML = `<span class="session-av">${(s.email[0] ?? '?').toUpperCase()}</span>
                   <span><b>${esc(s.email.split('@')[0])}</b>${s.local ? ' (local)' : ''}</span>`;
    const x = document.createElement('button');
    x.textContent = 'Salir';
    x.onclick = salir;
    d.appendChild(x);
    zona.appendChild(d);
  } else {
    const b = document.createElement('button');
    b.className = 'btn btn-brand';
    b.textContent = 'Crear cuenta';
    b.onclick = () => pedirAcceso().then((s) => s && pintar());
    zona.appendChild(b);
  }
}

/* ── Matching ───────────────────────────────────────────────────────────── */

/**
 * true = lo cumples, false = no lo cumples, null = no se puede saber.
 *
 * `null` no es un fallo del código, es un estado del producto. Un requisito
 * del que la convocatoria no concreta el límite no se puede comprobar, y decir
 * «cumples» o «no cumples»Mentira en ambos casos. El anillo lo cuenta aparte
 * y el interfaz lo pinta en gris.
 */
/**
 * «7,5» y «7.5» son la misma nota. Normalizar en un solo sitio evita que el
 * perfil guarde una cosa y el anillo compare otra: con la coma sin tratar,
 * `Number('6,8')` da NaN y la comparación es siempre falsa, así que el
 * estudiante ve «no cumples» aunque cumpla. Es el tipo de fallo que hace que
 * la gente salga de la página y no vuelva.
 */
function notaNum(v) {
  if (v === '' || v == null) return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function cumple(r) {
  const p = perfil.leer();
  if (r.tipo === 'nota_minima') {
    const n = notaNum(p.nota);
    if (n === null) return null;
    return n >= Number(r.valor);
  }
  if (r.tipo === 'edad_max') {
    if (p.edad === '' || p.edad == null) return null;
    return Number(p.edad) <= Number(r.valor);
  }
  return null;
}

function motivo(r, ok) {
  const p = perfil.leer();
  const n = notaNum(p.nota);
  if (r.tipo === 'nota_minima' && n !== null) {
    return ok ? `Tu nota es ${String(n).replace('.', ',')} y piden ${r.valor}`
              : `Piden ${r.valor} y tu nota es ${String(n).replace('.', ',')}`;
  }
  if (r.tipo === 'edad_max' && p.edad) {
    return ok ? `Tienes ${p.edad} y el máximo es ${r.valor}`
              : `El máximo es ${r.valor} y tienes ${p.edad}`;
  }
  return '';
}

/* ── Render ─────────────────────────────────────────────────────────────── */

async function pintar() {
  // Ojo con cómo se comprueba. `sesion()` devuelve `false` cuando no hay
  // sesión, y `false != null` es `true` en JavaScript —la comparación laxa con
  // `null` solo iguala a `undefined`—. Con esa forma, `abierta` salía siempre
  // cierta, `ponerPuertas()` no se llamaba nunca y las becas se veían todas
  // desbloqueadas sin cuenta: la puerta no era una puerta, era decorado.
  const abierta = Boolean(await sesion());

  // El orden importa más de lo que parece. Ordenando solo por fecha, las
  // fichas de Erasmus Mundus —que sí traen requisitos— caen al
  // fondo, porque su plazo es el de cada programa y aquí no lo hay, y arriba
  // quedan las entradas del BOE, de las cuales muchas ni son becas. El
  // estudiante ve ruido y se va antes de llegar a lo que le sirve.
  //
  // Primero las que tienen requisitos comprobables, luego las que no. Dentro
  // de cada grupo, lo más próximo al cierre primero.
  // No se esconde nada. Se ordenan, pero todas se ven.
  //
  // La versión anterior filtraba `!b.cerrada`, y con la base recién generada
  // casi todo salía marcado como cerrada por no traer fecha de cierre
  // extraída: es decir, cerrada por defecto. El resultado era una web con casi
  // nada y sin explicación de por qué. Una convocatoria sin fecha conocida no
  // está cerrada; simplemente no lo sabemos, que es otra cosa.
  //
  // El filtro de «solo lo que trae ficha BDNS o requisitos» también se quitó, y
  // por lo mismo: quien busca una beca de investigación o una ayuda a una
  // asociación sabe lo que busca, y quitarle la entrada no le ahorra nada, solo
  // le hace perder tiempo. Ordenar sí ayuda; ocultar no.
  const util = (x) => (x.requisitos.length || x.presupuesto != null || x.boeIdBases ? 0 : 1);
  const orden = [...becas].sort((a, b) => {
    const ua = util(a), ub = util(b);
    if (ua !== ub) return ua - ub;
    if (a.cerrada !== b.cerrada) return a.cerrada ? 1 : -1;
    return (a.cierra ?? '9999').localeCompare(b.cierra ?? '9999');
  });

  const conReq = orden.filter((b) => b.requisitos.length).length;

  // Cada cifra va en su `<span>`. Sueltas en el flujo, el punto separador
  // «·» es un nodo de texto más y en móvil el navegador lo deja colgando al
  // principio de la línea siguiente. Con los `<span>` los tres datos son
  // bloques que bajan enteros.
  $('#counts').innerHTML =
    `<span><b>${orden.length}</b> convocatorias</span>
     <span><b>${conReq}</b> con requisitos</span>
     <span><b>${orden.length - conReq}</b> sin requisitos aún</span>`;

  if (!orden.length) {
    $('#zona-lista').innerHTML = `
      <div class="empty">
        <h3>Todavía no hay convocatorias</h3>
        <p>La base se llena con <code>node ingest/run.mjs</code>, que lee el sumario del BOE
           y descarga las Bases completas de las que hay que leer.</p>
      </div>`;
    return;
  }

  const html = `
    <div class="list">
      ${orden.map((b) => `<div class="lock" data-beca>${tarjeta(b)}</div>`).join('')}
    </div>`;

  $('#zona-lista').innerHTML = html;
  if (!abierta) velar();
}

/**
 * Echa el velo por encima. Y nada más.
 *
 * Aquí no hay cartel, ni candado, ni «bloqueado», ni el aviso ámbar de arriba.
 * Se quitó a propósito el 17 de octubre de 2026: cualquier marca de «aquí hay
 * una puerta» convierte la lista en un cartel que dice «c，面向 esto», y quien
 * no tiene cuenta lo lee como una traba puesta para que se dé de alta. Las 85
 * fichas se ven igual que si fueran suyas: mismo sitio, mismo orden, mismo
 * número. Solo que no se leen.
 *
 * El coste de quitarlo es que ya no hay ninguna llamada a la acción dentro de
 * la lista. Se entra por el botón «Crear cuenta» de la cabecera, que es lo
 * único que queda. Es una decisión de producto y es reversible: si dentro de
 * un mes la conversión es cero, el motivo está aquí y no en el resto.
 */
function velar() {
  document.querySelectorAll('[data-beca]').forEach((nodo) => {
    nodo.firstElementChild.classList.add('lock-body');
  });
}

/* ── Tarjeta ────────────────────────────────────────────────────────────── */

function tarjeta(b) {
  const p = perfil.leer();
  const conPerfil = p.nota !== '' || p.edad !== '';

  // El importe y el plazo son datos, no condiciones: no cuentan en el anillo.
  const cond = b.requisitos.filter((r) => r.tipo !== 'importe' && r.tipo !== 'fecha_limite');
  const ok = cond.filter((r) => cumple(r) === true).length;

  return `<article class="beca ${b.cerrada ? 'out' : ''}">
    <div>
      <div class="beca-org">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="2"/>
        </svg>
        <span>${esc(b.organizador)}</span>
      </div>
      <h2 class="beca-h">${esc(b.titulo)}</h2>

      <div class="beca-meta">
        ${b.cierra ? pillPlazo(b.cierra) : '<span class="pill">Plazo no extraído</span>'}
        ${b.presupuesto ? `<span class="pill brand mono">${euros(b.presupuesto)}</span>` : ''}
        ${b.fuente === 'erasmus-mundus' ? '<span class="pill brand">Erasmus Mundus</span>' : ''}
        ${b.id.startsWith('BDNS') ? '<span class="pill mono">BDNS</span>' : ''}
        ${b.pagina ? `<span class="pill mono">BOE p. ${b.pagina}</span>` : ''}
      </div>

      <div class="reqs">
        ${b.requisitos.length
          ? b.requisitos.map(fila).join('')
          : `<p class="req-none">${b.boeIdBases
              ? 'Tenemos las Bases pero aún no hemos sacado los requisitos.'
              : 'Todavía no hemos extraído los requisitos. Puedes leerla entera en la fuente.'}</p>`}
      </div>
    </div>

    ${anillo(ok, cond.length, conPerfil)}

    <div class="beca-foot">
      <span class="pill ${cond.length && conPerfil ? 'brand' : ''}">
        ${cond.length
          ? (conPerfil ? `<b>${ok}</b> de ${cond.length} requisitos cumplidos` : 'Añade tu nota para comprobar')
          : 'Sin requisitos extraídos'}
      </span>
      <a class="src" href="${b.url}" target="_blank" rel="noopener">
        ${b.id.startsWith('BDNS') ? 'Ver convocatoria' : 'Ver en el BOE'}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
    </div>
  </article>`;
}

function fila(r) {
  const ICONO = {
    ok:  '<path d="M4 12.5l5 5L20 6.5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    no:  '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    unk: '<circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8.6v4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.1" fill="currentColor"/>',
  };
  const ok = cumple(r);
  const clase = ok === true ? 'ok' : ok === false ? 'no' : 'unk';

  const valor = r.valor != null && r.tipo !== 'fecha_limite'
    ? ` <span class="req-v">${esc(r.tipo === 'importe' ? `${euros(r.valor)} / mes` : r.valor)}</span>` : '';

  return `<div class="req ${clase}">
    <svg class="req-ico" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">${ICONO[clase]}</svg>
    <span>
      <span class="req-k">${esc(ETIQUETA[r.tipo] ?? r.tipo)}</span>${valor}
      ${motivo(r, ok) ? `<span class="req-why">${esc(motivo(r, ok))}</span>` : ''}
      <span class="req-src">«${esc(corta(r.cita, 170))}»</span>
    </span>
  </div>`;
}

function anillo(ok, total, conPerfil) {
  const pct = total ? ok / total : 0;
  const off = CIRC * (1 - pct);
  const cap = !total ? 'sin datos' : !conPerfil ? 'añade tu nota' : `${pct * 100 | 0}%`;

  return `<div class="ringbox">
    <div class="ring">
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle class="ring-bg" cx="38" cy="38" r="${R}" fill="none" stroke-width="6"/>
        <circle class="ring-fg" cx="38" cy="38" r="${R}" fill="none" stroke-width="6"
                stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
      </svg>
      <div class="ring-n">${total ? `${ok}<small>/${total}</small>` : '—'}</div>
    </div>
    <div class="ring-cap">${cap}</div>
  </div>`;
}

function pillPlazo(cierra) {
  const dias = Math.ceil((new Date(cierra) - Date.now()) / 86400000);
  if (dias < 0) return `<span class="pill rust">Cerrada</span>`;
  const cls = dias <= 15 ? 'amber' : '';
  const txt = dias === 0 ? 'Vence hoy' : dias === 1 ? 'Vence mañana' : `${dias} días`;
  return `<span class="pill ${cls}">${txt}</span>`;
}

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const $ = (s) => document.querySelector(s);
function euros(n) {
  return n >= 1000 ? `${Math.round(n).toLocaleString('es-ES')} €` : `${n} €`;
}
function corta(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Eventos ────────────────────────────────────────────────────────────── */

$('#buscar').addEventListener('click', () => {
  perfil.guardar({
    nota: $('#nota').value.trim(),
    edad: $('#edad').value.trim(),
    nivel: $('#nivel').value,
    pais: $('#pais').value,
  });
  pintar();
});

$('#pais').addEventListener('change', () => $('#buscar').click());
$('#nivel').addEventListener('change', () => $('#buscar').click());

pintarCabecera();
cargar();