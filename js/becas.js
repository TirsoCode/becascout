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

import { sesion, haySesion, pedirAcceso, perfil, salir, abrirAjustes, revisarEncuesta } from './auth.js';
import { CODIGOS, NOMBRES, nombreDe } from './paises.js';

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
  presupuesto: 'Presupuesto de la convocatoria',
  fecha_limite: 'Plazo',
  plazo: 'Plazo de solicitud',
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
  llenarPaises();
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

/**
 * Pone los países en el desplegable de destino.
 *
 * La lista sale de `js/paises.js`, que es la misma que usa el conector de
 * la ingesta. Si el desplegable tuviera su propia lista, se desincronizarían
 * y el estudiante elegiría un país que ningún conector escribe nunca.
 *
 * Los que no tienen ninguna convocatoria **no se enseñan**: un destino que
 * no tiene nada es ruido en un desplegable, y lo que el estudiante quiere es
 * ver que hay algo. Los que sí hay, con el nombre en castellano.
 */
function llenarPaises() {
  const sel = $('#pais');
  if (!sel || sel.dataset.lleno === '1') return;
  sel.dataset.lleno = '1';

  const conBeca = new Set();
  for (const b of becas) {
    for (const c of b.paises ?? []) conBeca.add(c);
  }

  const frag = document.createDocumentFragment();
  for (const cod of CODIGOS) {
    if (!conBeca.has(cod)) continue;
    const o = document.createElement('option');
    o.value = cod;
    o.textContent = NOMBRES[cod] ?? cod;
    frag.append(o);
  }
  sel.append(frag);

  // Si el perfil tenía un país que ya no está —porque su convocatoria se
  // cerró y salió de la ventana—, se deja en «cualquiera» en vez de dejar
  // un valor que no está en la lista y que no filtra nada.
  const elegido = sel.value;
  if (elegido && ![...sel.options].some((o) => o.value === elegido)) {
    sel.value = '';
  }
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
    // El avatar se pinta con `textContent` porque el correo lo elige quien se
    // registra. Interpolado en la plantilla, bastaba un correo que empezara por
    // `<` o por `"` para inyectar HTML. Una sola letra en pantalla no
    // justifica el riesgo.
    const av = document.createElement('span');
    av.className = 'session-av';
    av.textContent = (s.email?.[0] ?? '?').toUpperCase();

    const nombre = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = String(s.email ?? '').split('@')[0];
    nombre.appendChild(b);
    if (s.local) nombre.appendChild(document.createTextNode(' (local)'));

    // El perfil abre los ajustes —salir y borrar la cuenta—, salvo en la
    // sesión de juguete, que no es cuenta y ahí no hay nada que ajustar.
    const d = document.createElement('div');
    d.className = 'session';

    if (!s.local) {
      const pf = document.createElement('button');
      pf.className = 'session-perfil';
      pf.title = 'Ajustes de la cuenta';
      pf.append(av, nombre);
      pf.onclick = abrirAjustes;
      d.append(pf);
    } else {
      d.append(av, nombre);
    }

    const x = document.createElement('button');
    x.textContent = 'Salir';
    x.onclick = salir;

    d.append(x);
    zona.appendChild(d);
  } else {
    const b = document.createElement('button');
    b.className = 'btn btn-brand';
    b.textContent = 'Crear cuenta';
    b.onclick = () => pedirAcceso().then((s) => { if (s) { pintarCabecera(); pintar(); } });
    zona.appendChild(b);
  }
}

/* ── Matching ───────────────────────────────────────────────────────────── */

/**
 * true = lo cumples, false = no lo cumples, null = no se puede saber.
 *
 * `null` no es un fallo del código, es un estado del producto. Un requisito
 * del que la convocatoria no concreta el límite no se puede comprobar, y decir
 * «cumples» o «no cumples» es mentira en ambos casos. El anillo lo cuenta aparte
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
  // Ojo con cómo se comprueba, que aquí ha fallado dos veces.
  //
  // Primero, con `s != null`: `sesion()` devuelve `false` cuando no hay
  // sesión, y `false != null` es `true` en JavaScript —la comparación laxa
  // con `null` solo iguala a `undefined`—, así que `abierta` salía siempre
  // cierta y el velo no se ponía nunca.
  //
  // Después, con `Boolean(await sesion())`: la sesión de juguete del modo
  // local vale `{ email, local: true }`, que también es truthy, así que
  // pasaba por una cuenta. Justo cuando la API está caída —el 17 de octubre
  // de 2026 devolvía FUNCTION_INVOCATION_FAILED en todas las rutas— la lista
  // se veía entera sin cuenta. `haySesion()` es la que distingue una cuenta
  // de la sesión de prueba; el modo local existe para ver la web sin
  // servidor, no para regalar lo único que el producto reserva.
  const abierta = await haySesion();

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

  // ── Los filtros que el estudiante pide ─────────────────────────────────
  //
  // El destino y el nivel se guardaban en el perfil y **no se usaban para
  // nada**: la lista salía entera siempre, y el botón «Comprobar» solo
  // volvía a pintar lo mismo. Un filtro que no filtra es peor que no
  // tenerlo, porque el estudiante cree que ha filtrado y lo que ve es otra
  // cosa.
  //
  // El destino se guarda como **código ISO**, no como nombre: el nombre
  // cambia y el código no, y los datos vienen con el código.
  //
  // Y hay una decisión que conviene que sea explícita: **una convocatoria
  // sin destino conocido no se esconde.** Se quedan todas y se avisa de
  // cuántas son. El motivo es el de siempre: si el filtro aparta algo que
  // sí valía, quien lo buscaba no ve el hueco y no sabe que faltaba.
  // Enseñar de más cuesta un clic; quitar de más pierde la beca sin dejar
  // rastro.
  const p = perfil.leer();
  const paisElegido = p.pais ?? '';
  const nivelElegido = p.nivel ?? '';

  const filtradas = orden.filter((b) => {
    const paises = b.paises ?? [];
    // Sin destino conocido, la convocatoria se queda.
    if (paisElegido && paises.length && !paises.includes(paisElegido)) return false;
    // El nivel solo aparta cuando lo sabemos. Si no lo sabemos, se queda.
    if (nivelElegido && b.nivel && b.nivel !== nivelElegido) return false;
    return true;
  });

  // Cuántas de las que salen son de las que no dicen dónde. Se enseña,
  // porque si no el estudiante cree que la lista entera es de ese país.
  const sinPaisConocido = paisElegido
    ? filtradas.filter((b) => !(b.paises?.length)).length
    : 0;

  // Y lo mismo con el nivel: las que no lo dicen se quedan, y hay que
  // decirlo. Sin este aviso, filtrar por «Grado» parecía no hacer nada,
  // porque la lista apenas cambiaba.
  const sinNivelConocido = nivelElegido
    ? filtradas.filter((b) => !b.nivel).length
    : 0;

  const conReq = filtradas.filter((b) => b.requisitos.length).length;

  // Cada cifra va en su `<span>`. Sueltas en el flujo, el punto separador
  // «·» es un nodo de texto más y en móvil el navegador lo deja colgando al
  // principio de la línea siguiente. Con los `<span>` los tres datos son
  // bloques que bajan enteros.
  const cuenta = [
    `<span><b>${filtradas.length}</b> ${filtradas.length === 1 ? 'convocatoria' : 'convocatorias'}</span>`,
    `<span><b>${conReq}</b> con requisitos</span>`,
    `<span><b>${filtradas.length - conReq}</b> sin requisitos aún</span>`,
  ];
  // Y el aviso de las que no dicen dónde, que es la parte honesta: si no
  // se dice, el estudiante cree que la lista entera es de ese país.
  if (sinPaisConocido) {
    cuenta.push(`<span><b>${sinPaisConocido}</b> sin destino conocido (también salen)</span>`);
  }
  if (sinNivelConocido) {
    cuenta.push(`<span><b>${sinNivelConocido}</b> sin nivel conocido (también salen)</span>`);
  }
  $('#counts').innerHTML = cuenta.join('\n     ');

  if (!filtradas.length) {
    // O no hay nada en la base, o el filtro dejó todo fuera. Son dos
    // cosas distintas y el mensaje tiene que distinguirlas: si el
    // estudiante ha filtrado por un país y no sale nada, lo que ve es
    // «no hay nada», y lo que tiene que entender es «no hay nada *para
    // ese filtro*». En el segundo caso, el aviso de las que no dicen
    // dónde dice cuántas se han quedado fuera.
    const filtrado = paisElegido || nivelElegido;
    $('#zona-lista').innerHTML = `
      <div class="empty">
        <h3>${filtrado ? 'No hay ninguna convocatoria con ese filtro' : 'Todavía no hay convocatorias'}</h3>
        <p>${filtrado
          ? `Prueba con <b>${esc(nombreDe(paisElegido) || paisElegido || 'cualquier destino')}</b> o quita el filtro.
             ${sinPaisConocido ? `Hay ${sinPaisConocido} que no dicen dónde y no se pueden filtrar por país.` : ''}`
          : `La base se llena con <code>node ingest/run.mjs</code>, que lee el sumario del BOE
             y descarga las Bases completas de las que hay que leer.`}</p>
      </div>`;
    return;
  }

  const html = `
    <div class="list">
      ${filtradas.map((b) => `<div class="lock" data-beca>${tarjeta(b)}</div>`).join('')}
    </div>`;

  $('#zona-lista').innerHTML = html;
  if (!abierta) velar();
  cartelAcceso(abierta);
}

/**
 * Echa el velo por encima del contenido. Y solo eso.
 *
 * Dentro de la lista no hay candado ni la palabra «bloqueado»: las fichas se
 * ven igual que si fueran suyas —mismo sitio, mismo orden, mismo número—, solo
 * que borrosas. La llamada a la acción va **fuera** del contenido, en la barra
 * fija de abajo (`cartelAcceso`), y eso es a propósito: un cartel encima de
 * cada ficha convertiría la lista en un anuncio de lo que esconde.
 */
function velar() {
  document.querySelectorAll('[data-beca]').forEach((nodo) => {
    nodo.firstElementChild.classList.add('lock-body');
  });
}

/**
 * La barra de abajo: «Inicia sesión para ver las becas», siempre a la vista.
 *
 * El velo tapa, pero sin una llamada a la acción visible el único camino era
 * el botón «Crear cuenta» de la cabecera, que en móvil se pierde al hacer
 * scroll. Por eso la barra va `position: fixed`: sigue ahí cuando el
 * estudiante lleva media lista bajada, que es justo cuando decide si la cuenta
 * le merece la pena.
 *
 * Se rehace en cada `pintar()` porque la sesión puede cambiar entre pintada y
 * pintada: se quita la anterior y se decide de cero. Con cuenta, no se crea.
 */
function cartelAcceso(abierta) {
  document.getElementById('cartel-acceso')?.remove();
  document.body.classList.toggle('con-cartel', !abierta);
  if (abierta) return;

  const barra = document.createElement('div');
  barra.id = 'cartel-acceso';
  barra.className = 'cartel-acceso';

  const txt = document.createElement('p');
  txt.textContent = 'Inicia sesión para ver las becas';

  const b = document.createElement('button');
  b.className = 'btn cartel-btn';
  b.textContent = 'Crear cuenta gratis';
  b.onclick = () => pedirAcceso().then((s) => { if (s) { pintarCabecera(); pintar(); } });

  barra.append(txt, b);
  document.body.appendChild(barra);
}

/* ── Tarjeta ────────────────────────────────────────────────────────────── */

function tarjeta(b) {
  const p = perfil.leer();
  const conPerfil = p.nota !== '' || p.edad !== '';

  // El importe, el presupuesto y el plazo son datos, no condiciones: no
  // cuentan en el anillo.
  const cond = b.requisitos.filter(
    (r) => r.tipo !== 'importe' && r.tipo !== 'presupuesto' && r.tipo !== 'fecha_limite',
  );

  // Y solo cuentan los que el perfil puede decidir de verdad.
  //
  // `cumple` devuelve tres cosas: `true`, `false` y `null`, que es «no lo
  // sabemos». Antes el denominador era `cond.length` y el numerador contaba
  // solo los `true`, así que un requisito que no se sabe valorarse acababa
  // igual que uno incumplido: en las fichas de Erasmus Mundus salía «0 de 3
  // requisitos cumplidos» y el anillo marcaba 0% a un estudiante que sí
  // cumplía. Y con los datos de hoy ningún registro del fichero tiene
  // `nota_minima` ni `edad_max`, que son los dos únicos tipos que `cumple`
  // sabe valorar: el anillo, que es el argumento de venta del producto, no
  // tenía nada que enseñar y se presentaba como un suspenso.
  //
  // Decir «no cumples» cuando lo que hay es «no lo sabemos» es la peor forma
  // de equivocarse aquí, porque el estudiante se queda sin solicitarla y no
  // vuelve. Los unknown ahora se cuentan como unknown, que es lo que ya hacía
  // cada fila suelta con su icono.
  const sabibles = cond.filter((r) => cumple(r) !== null);
  const ok = sabibles.filter((r) => cumple(r) === true).length;
  const total = sabibles.length;

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
        ${b.fuente === 'daad' ? '<span class="pill brand">DAAD</span>' : ''}
        ${b.fuente === 'ue' ? '<span class="pill brand">UE</span>' : ''}
        ${b.id.startsWith('BDNS') ? '<span class="pill mono">BDNS</span>' : ''}
        ${b.pagina ? `<span class="pill mono">BOE p. ${b.pagina}</span>` : ''}
        ${pillDestino(b)}
      </div>

      <div class="reqs">
        ${b.requisitos.length
          ? b.requisitos.map(fila).join('')
          : `<p class="req-none">${b.boeIdBases
              ? 'Tenemos las Bases pero aún no hemos sacado los requisitos.'
              : 'Todavía no hemos extraído los requisitos. Puedes leerla entera en la fuente.'}</p>`}
      </div>
    </div>

    ${anillo(ok, total, conPerfil)}

    <div class="beca-foot">
      <span class="pill ${total && conPerfil ? 'brand' : ''}">
        ${!cond.length
          ? 'Sin requisitos extraídos'
          : !total
            ? `${cond.length} requisitos, ninguno comprobable todavía`
            : conPerfil
              ? `<b>${ok}</b> de ${total} requisitos comprobados`
              : 'Añade tu nota para comprobar'}
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

  // La unidad **no** se inventa. Antes ponía `/ mes` detrás de cualquier
  // `importe`, y en las fichas del BOE esa cifra es el presupuesto total de la
  // convocatoria, no lo que cobra un beneficiario: se veía «40.670.000 € / mes».
  // La cifra viene con su cita debajo, que es donde se lee de qué va.
  // La cantidad se enseña tal cual y la unidad la deja la cita de al lado.
  const valor = r.valor != null && r.tipo !== 'fecha_limite'
    ? ` <span class="req-v">${esc(r.tipo === 'importe' || r.tipo === 'presupuesto' ? euros(r.valor) : r.valor)}</span>` : '';

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

/**
 * El destino, en una píldora.
 *
 * Solo si el dato existe. Una convocatoria sin destino conocido no
 * inventa uno: no se pone «Europa» ni «Países de la UE», que sería
 * rellenar el hueco con una suposición.
 *
 * Y si son varios, **no se enseñan todos**. Un consorcio de Erasmus puede
 * tener once países, y la píldora se convertía en un muro de texto de 589
 * píxeles —en un móvil, media pantalla—. Se enseñan los tres primeros y el
 * resto va en el `title`, que es donde se lee el detalle.
 *
 * El orden es alfabético, y a propósito. El orden en que vienen los países
 * en el catálogo es el del recorrido por sus 77 filtros, que no dice nada
 * del peso de cada país en el consorcio: el primero no es el principal.
 * Ordenar por nombre da un criterio estable y no finge una jerarquía que
 * no está.
 */
function pillDestino(b) {
  const paises = b.paises ?? [];
  if (!paises.length) return '';

  const ordenados = [...paises].sort((a, b) => {
    const na = nombreDe(a), nb = nombreDe(b);
    return na.localeCompare(nb, 'es');
  });

  const MAX = 3;
  const visibles = ordenados.slice(0, MAX);
  const resto = ordenados.length - visibles.length;

  const texto = visibles.map((c) => nombreDe(c)).join(', ') + (resto ? ` +${resto}` : '');
  const completo = ordenados.map((c) => nombreDe(c)).join(', ');

  return `<span class="pill mono" title="Destino: ${esc(completo)}">${esc(texto)}</span>`;
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

// Si se acaba de crear la cuenta en otro sitio —el callback de Google— la
// página de aterrizaje es esta: la pregunta de llegada sale aquí. Ver
// `revisarEncuesta()` en js/auth.js.
revisarEncuesta();