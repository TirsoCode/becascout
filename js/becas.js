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

import { sesion, sesionFresca, haySesion, perfil, salir, revisarEncuesta } from './auth.js';
import { CODIGOS, nombreDe } from './paises.js';
import { t, alCambiarIdioma, idiomaActual } from './i18n.js';

/* El nivel del perfil se guarda con su nombre castellano —es el `value` del
   `<select>` y lo que comparan los datos—, pero se enseña en el idioma que
   toque. La clave del diccionario va por nombre y no por posición: si algún
   día hay un nivel nuevo, se queda sin traducir en vez de enseñar otro. */
const CLAVE_NIVEL = {
  Grado: 'nivel.grado',
  'Máster': 'nivel.master',
  Doctorado: 'nivel.doctorado',
};

/* Un tipo de requisito que no esté en el diccionario se enseña tal cual, con
   su nombre técnico. Es feo y se ve, que es lo que se quiere: un hueco en
   blanco en la lista no lo delata nadie. */
function etiqueta(tipo) {
  const clave = `etiqueta.${tipo}`;
  const texto = t(clave);
  return texto === clave ? String(tipo) : texto;
}

function nivelDe(nivel) {
  const clave = CLAVE_NIVEL[nivel];
  return clave ? t(clave) : String(nivel ?? '');
}

/** El nombre de un país en el idioma de la página.
 *
 *  El castellano no se duplica en el diccionario: es el de `js/paises.js`,
 *  que es la lista única. Solo el inglés vive en `i18n.js`, y los países que
 *  se escriben igual —Malta, Austria— no están ahí y caen al castellano, que
 *  en esos casos ya es el nombre inglés. */
function paisDe(cod) {
  if (!cod) return '';
  if (idiomaActual() === 'es') return nombreDe(cod);
  const clave = `pais.${cod}`;
  const texto = t(clave);
  return texto === clave ? nombreDe(cod) : texto;
}

/** El separador de miles y el decimal, según el idioma: «2.619» y «7,5» en
 *  castellano, «2,619» y «7.5» en inglés. */
function num(n) {
  return Number(n).toLocaleString(idiomaActual() === 'en' ? 'en-GB' : 'es-ES');
}

let becas = [];

/**
 * ¿La base que hay en memoria trae los requisitos?
 *
 * El catálogo público no los trae: solo el número. La distinción no es un
 * detalle de implementación, es la puerta. `datosCompletos` decide si hay que
 * volver a pedir la base al recuperar la sesión; sin él, entrar en la otra
 * pestaña desbloquearía una lista de fichas sin requisitos y el estudiante
 * creería que ninguna convocatoria tiene.
 */
let datosCompletos = false;

/** Cuántos requisitos tiene una ficha, sin mirar si los tenemos. */
function nReq(b) {
  return b.oculto ? Number(b.n_requisitos ?? 0) : (b.requisitos?.length ?? 0);
}

/**
 * Trae la lista. Primero la API —la única que tiene requisitos y citas— y,
 * si no hay sesión o la API no está, el catálogo público.
 *
 * El catálogo no es un respaldo de emergencia: es lo que pinta la lista
 * borrosa de quien todavía no tiene cuenta. Tiene títulos, plazos, importes y
 * destinos, que es lo que se ve a través del velo. Lo que no tiene son los
 * requisitos, que es lo que la cuenta abre.
 */
async function cargarDatos() {
  try {
    const r = await fetch('api/becas', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d?.becas)) {
        datosCompletos = true;
        return d.becas;
      }
    }
  } catch { /* API caída o sin red: se sigue con el catálogo */ }

  datosCompletos = false;
  const r = await fetch('data/becas-catalogo.json');
  if (!r.ok) throw new Error(`catálogo ${r.status}`);
  return (await r.json()).becas ?? [];
}

/* El beat del momento de búsqueda: cuánto dura el marco «Buscando N becas…»
 * antes de que llegue la lista.
 *
 * El filtrado es instantáneo —la base entera ya está en el navegador—, así
 * que esa espera no mide trabajo: la sustituye por un relato en cinco
 * entradas —antetítulo, titular, párrafo, pasos y promesa— que en menos de
 * un segundo no se leería. A quien pidió menos movimiento
 * (`prefers-reduced-motion`) los gestos dan igual, y el beat se acorta:
 * que exista, que no maree.
 */
const BEAT_BUSQUEDA = matchMedia('(prefers-reduced-motion: reduce)').matches ? 250 : 1400;
let beatPrevisto = null;
/* Un contador abierto por búsqueda: al reponer el titular, el anterior se
 * queda sin corazón —su `requestAnimationFrame` comprueba la ficha y para. */
let cuentaAbierta = 0;

/* ── Arranque ───────────────────────────────────────────────────────────── */

async function cargar() {
  try {
    becas = await cargarDatos();
  } catch {
    document.getElementById('zona-lista').innerHTML = `
      <div class="empty">
        <h3>${t('error.datos.h')}</h3>
        <p>${t('error.datos.p')}</p>
      </div>`;
    return;
  }
  llenarPaises();
  rellenarPerfil();
  // La primera pintada lleva el momento también: es la primera vez que se ve
  // cuántas convocatorias hay detrás. Sin base no hay titular que contar.
  if (becas.length) {
    cartelBusqueda();
    beatPrevisto = setTimeout(pintar, BEAT_BUSQUEDA);
  } else {
    pintar();
  }
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
 * ver que hay algo. Los que sí hay, con el nombre en el idioma de la página.
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
    o.textContent = paisDe(cod);
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

/**
 * Vuelve a escribir los países del desplegable en el idioma nuevo.
 *
 * `llenarPaises()` solo corre una vez —la lista de destinos no cambia—, así
 * que sin esto el desplegable se quedaría en el idioma con el que se cargó la
 * página mientras el resto ya está en el otro.
 */
function traducirPaises() {
  const sel = $('#pais');
  if (!sel || sel.dataset.lleno !== '1') return;
  for (const o of sel.options) {
    if (o.value) o.textContent = paisDe(o.value);
  }
}

/* ── Cabecera de sesión ─────────────────────────────────────────────────── */

/**
 * El dock de la izquierda, el mismo del perfil.
 *
 * Solo se enciende con una cuenta de verdad. La sesión de juguete vive en
 * memoria y sus enlaces no sobreviven a un cambio de página, así que con
 * ella se queda la cabecera de siempre: un dock que lleva a un perfil que
 * dice «no hay sesión» es peor que no tener dock.
 *
 * El `body` manda sobre la retícula (dos columnas o una); el `hidden` del
 * HTML es la red por si el JavaScript no llega a ejecutarse.
 */
function pintarDock(s) {
  const dock = $('#dock-becas');
  if (!dock) return;

  const conCuenta = Boolean(s && !s.local);
  document.body.classList.toggle('con-dock', conCuenta);
  dock.hidden = !conCuenta;
  if (!conCuenta) return;

  // El correo lo elige quien se registra: `textContent`, nunca una
  // plantilla. Es el mismo motivo que en la cabecera.
  const correo = $('#dock-email');
  if (correo) correo.textContent = s.email ?? '';
}

/** La cabecera espera a la respuesta del servidor: la sesión ya no está en
 *  localStorage, y pintar «entrar» antes de saberlo hace parpadear el botón
 *  en cada carga. */
async function pintarCabecera() {
  const zona = $('#sesion-zona');
  const s = await sesion();
  pintarDock(s);
  // Lo que esta pintada representa es también el estado que `alVolver`
  // compara (declarado más abajo). Empezar en `null` era una trampa: el
  // primer repinte tras el alta en la otra pestaña ve `null`, no repinta, y
  // deja el nuevo valor escrito — el «Crear cuenta» se quedaría ahí para
  // siempre con la cuenta ya hecha.
  vista = s ? (s.local ? 'local' : 'si') : 'no';

  zona.innerHTML = '';
  if (s) {
    // El avatar se pinta con `textContent` porque el correo lo elige quien se
    // registra. Interpolado en la plantilla, bastaba un correo que empezara por
    // `<` o por `"` para inyectar HTML. Una sola letra en pantalla no
    // justifica el riesgo.
    const nombre = document.createElement('span');
    const b = document.createElement('b');
    const parte = String(s.email ?? '').split('@')[0];
    b.textContent = parte.charAt(0).toUpperCase() + parte.slice(1);
    nombre.appendChild(b);
    if (s.local) nombre.appendChild(document.createTextNode(t('cab.local')));

    // El nombre abre la página de perfil, donde están todas las cosas de la
    // cuenta: salir, cerrar las sesiones y borrarla. La sesión de juguete no
    // es cuenta, así que ahí no hay nada que gestionar.
    const d = document.createElement('div');
    d.className = 'session';

    if (!s.local) {
      const pf = document.createElement('a');
      pf.className = 'session-perfil';
      pf.href = '/perfil.html';
      pf.title = t('cuenta.ajustes.tooltip');
      pf.append(nombre);
      d.append(pf);
    } else {
      d.append(nombre);
    }

    // Cerrar sesión ya no está aquí: estaba al lado del nombre y se sale sin
    // querer con el ratón mientras se busca. Ahora vive en perfil.html, con
    // el sitio que se merece para explicar qué cierra y qué no.
    zona.appendChild(d);
  } else {
    // La puerta es un enlace de verdad, no un botón que monta un modal: el
    // alta vive en cuenta.html y este enlace la abre en otra pestaña. El
    // `?desde` dice dónde está esta página, y al terminar el alta la pestaña
    // vuelve aquí sola (ver js/cuenta.js). Que sea un enlace y no un clic
    // programado le quita a la puerta el bloqueo de popups y deja que el
    // navegador la trate como a cualquier enlace.
    const a = document.createElement('a');
    a.className = 'btn btn-brand';
    a.textContent = t('cab.crear');
    a.href = 'cuenta.html?desde=%2Fbecas.html';
    a.target = '_blank';
    a.rel = 'noopener';
    // La marca que comparten las puertas (`data-open-auth`): las pruebas la
    // buscan y en la portada se quita cuando hay sesión. La puerta de la
    // portada la lleva escrita en el HTML; la de aquí nace en JavaScript y
    // sin marca no la encuentra nadie.
    a.setAttribute('data-open-auth', '');
    zona.appendChild(a);
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

/* ── El nivel, en números ───────────────────────────────────────────────── */

/**
 * El rango de cada nivel, para poder compararlos.
 *
 * El perfil guarda el nivel con su nombre («Grado», «Máster», «Doctorado»),
 * que es lo que dicen los datos. Para comparar hacen falta números: tener un
 * máster cumple un requisito de grado, y no al revés.
 */
const RANGO_NIVEL = { Grado: 1, 'Máster': 2, Doctorado: 3 };

/**
 * El nivel que pide un texto de requisito, o `null` si no se sabe.
 *
 * Los requisitos de títuloPrevious titular llegan con la palabra del catálogo:
 * «Grado universitario (o último año de grado)», «Máster», «Doctorado». El
 * primero es un grado, aunque la frase sea larga.
 */
function nivelDeValor(valor) {
  const v = plano(String(valor ?? ''));
  if (!v) return null;
  if (v.includes('doctorado') || v.includes('phd')) return 'Doctorado';
  if (v.includes('master')) return 'Máster';
  if (v.includes('grado') || v.includes('bachelor') || v.includes('licenci')) return 'Grado';
  return null;
}

/**
 * Sin tildes y en minúsculas, para comparar textos.
 *
 * El buscador escribe «alemania» y los datos dicen «Alemania»: sin esto, la
 * búsqueda no encuentra ni las becas de Alemania.
 */
function plano(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * El perfil, leído una sola vez por pintado.
 *
 * `perfil.leer()` va al `localStorage` y lo parsea. `cumple()` se llama una
 * vez por requisito y por ficha, y hay 386 fichas: leer el perfil en cada
 * llamada son cientos de lecturas del almacenamiento local en cada repintado,
 * que es lo que hace que a veces la lista tarde en aparecer.
 */
let perfilCache = null;
function perfilActual() {
  if (!perfilCache) perfilCache = perfil.leer();
  return perfilCache;
}

/**
 * ¿El requisito se cumple con el perfil que hay?
 *
 * `true`, `false` o `null` («no lo sabemos»). Lo tercero no es un detalle: es
 * la diferencia entre «no cumples» y «no hay dato», y confundirlas es la peor
 * forma de equivocarse aquí (ver `tarjeta`).
 *
 * ── Por qué ahora sabe más que antes ──────────────────────────────────────
 *
 * Antes solo miraba la nota y la edad, y con eso solo el 8 % de los requisitos
 * de la base era valorable: los 219 programas de Erasmus Mundus y las 148
 * becas de DAAD tienen requisitos de **título previo**, y el anillo de
 * «requisitos cumplidos» no tenía nada que enseñar. El estudiante veía «0 de
 * 0» en casi todas las fichas y buscaba a ciegas.
 *
 * Ahora el título previo se compara con el nivel del perfil: un Erasmus
 * Mundus pide «grado universitario (o último año de grado)», así que quien
 * busca un máster o un doctorado ya lo cumple, y una beca de DAAD de
 * doctorado no la cumple quien busca un grado.
 */
function cumple(r) {
  const p = perfilActual();
  if (r.tipo === 'nota_minima') {
    const n = notaNum(p.nota);
    if (n === null) return null;
    return n >= Number(r.valor);
  }
  if (r.tipo === 'edad_max') {
    if (p.edad === '' || p.edad == null) return null;
    return Number(p.edad) <= Number(r.valor);
  }
  // El título previo: hay que tener ese título o uno superior.
  if (r.tipo === 'titulacion') {
    const mio = RANGO_NIVEL[p.nivel];
    if (!mio) return null;
    const pide = nivelDeValor(r.valor);
    if (!pide) return null;
    return mio >= RANGO_NIVEL[pide];
  }
  // El nivel del programa: tiene que ser el tuyo. Ni mayor ni menor: quien
  // busca un doctorado no se puede apuntar a una beca de máster.
  if (r.tipo === 'nivel') {
    const mio = RANGO_NIVEL[p.nivel];
    const pide = nivelDeValor(r.valor);
    if (!mio || !pide) return null;
    return mio === RANGO_NIVEL[pide];
  }
  return null;
}

function motivo(r, ok) {
  const p = perfilActual();
  const n = notaNum(p.nota);
  if (r.tipo === 'nota_minima' && n !== null) {
    return ok ? t('motivo.notaOk', { n: num(n), v: r.valor })
              : t('motivo.notaNo', { v: r.valor, n: num(n) });
  }
  if (r.tipo === 'edad_max' && p.edad) {
    return ok ? t('motivo.edadOk', { n: p.edad, v: r.valor })
              : t('motivo.edadNo', { v: r.valor, n: p.edad });
  }
  if ((r.tipo === 'titulacion' || r.tipo === 'nivel') && p.nivel) {
    const pide = nivelDeValor(r.valor);
    if (pide) {
      return ok
        ? t('motivo.nivelOk', { n: nivelDe(p.nivel), v: nivelDe(pide) })
        : t('motivo.nivelNo', { n: nivelDe(p.nivel), v: nivelDe(pide) });
    }
  }
  return '';
}

/* ── El momento de la búsqueda ─────────────────────────────────────────── */

/**
 * La pantalla del titular: «Buscando 390 becas para Alemania».
 *
 * La cifra es de **toda** la base, no del recorte que saldrá después: lo que
 * se está mirando es el corpus entero —igual que la referencia, «Searching
 * 53,481 professors»—, y lo que pasa el filtro es lo que enseña la lista al
 * caer el telón. El número va con el separador de miles del idioma: hoy son
 * 390, y el día que sean 2.619 sale «2.619» en castellano y «2,619» en
 * inglés, que es como se escribe en cada uno.
 *
 * Aquí es donde más tienta copiar a la referencia, y la única parte que no
 * se puede: allí cada ficha lleva un «MATCH 87». Un encaje con porcentaje
 * es exactamente la probabilidad inventada que este producto no enseña (ver
 * «El otro límite» en AGENTS.md). El beat es teatro; la cifra, la única
 * verdad que hay que contar: cuántas hay.
 *
 * Va dentro de `#zona-lista` porque el titular **sustituye** a la lista
 * durante el beat: no hay fichas detrás de él que tapar.
 *
 * ── El desplazamiento, y por qué ya no es `block: 'start'` ───────────────
 *
 * Traer el marco a la vista con `start` parecía inofensivo y no lo era: al
 * entrar en la página dejaba la ventana bajada —607 px medidos en un móvil de
 * 390 × 844— con la barra de filtros por encima del pliegue. Y no se podía
 * bajar, que es lo que se reportó como «no puedo bajar mientras busca»: al
 * sustituir la lista de 390 fichas por el cartel, el documento pasa de 250.000
 * px a 1.700, así que el navegador recorta la posición al nuevo final y el
 * estudiante se queda contra el borde sin haber tocado nada.
 *
 * Y `nearest` tampoco basta, que es lo que se probó primero: el marco es más
 * alto que la ventana, y con un elemento así hasta `nearest` alinea su borde
 * de arriba con el de la ventana. Seguía bajando la página 663 px. Lo que
 * queda es mirar si el titular ya se ve y, solo si no se ve, subir lo justo.
 * Quien lo tenga fuera de la pantalla tiene además el botón «Cambiar filtros»
 * dentro del propio cartel.
 */
function cartelBusqueda() {
  const zona = $('#zona-lista');
  // El alto que tenía la lista antes de sustituirla. Sin esto, el documento
  // pasa de 250.000 px a 1.700 y el navegador recorta la posición al nuevo
  // final: es lo que se sintió como «no puedo bajar mientras busca». Se
  // presta al contenedor durante el beat y se devuelve al pintar.
  const altoAntes = zona.offsetHeight;

  const p = perfil.leer();
  const partes = [];
  if (p.nivel) partes.push(t('buscando.nivel', { n: nivelDe(p.nivel) }));
  if (p.pais) partes.push(t('buscando.pais', { p: paisDe(p.pais) }));
  // Sin filtro se dice el ámbito que sí es verdad: lo que hay en la base
  // es de aquí. No se pone «para ti», que finge un mérito que no hay.
  const objetivo = partes.length ? partes.join(' ') : t('buscando.toda');
  const total = num(becas.length);

  // El filtro, aparte del titular y en píldoras. Dentro de la frase, el
  // titular cambiaba de forma según lo que hubiera puesto —y con dos filtros
  // se iba a tres líneas—; fuera, se lee como lo que es: el estado con el que
  // se ha comprobado. Es la misma píldora que lleva cada ficha para el
  // destino, así que no hay dos maneras de decir lo mismo.
  const activos = [];
  if (p.nivel) activos.push(nivelDe(p.nivel));
  if (p.pais) activos.push(paisDe(p.pais));
  // La búsqueda por texto también es un filtro, y si no sale en las píldoras
  // el estudiante no sabe por qué la lista ha cambiado de golpe.
  const consulta = ($('#q')?.value ?? '').trim();
  if (consulta) activos.push(`«${consulta}»`);
  const filtro = `
      <p class="buscando-filtro" aria-hidden="true">${
        (activos.length ? activos : [t('buscando.todaPill')]).map((x) => `<span>${esc(x)}</span>`).join('')
      }</p>
      <span class="sr-only">${esc(t('buscando.filtros', {
        x: activos.join(', ') || t('buscando.ninguno'),
      }))}</span>`;

  $('#zona-lista').innerHTML = `
    <div class="buscando" role="status">
      <p class="buscando-k">${esc(t('buscando.k'))}</p>
      <p class="buscando-h"><span aria-hidden="true">${esc(t('buscando.verbo'))} <b class="cuenta">0</b> ${esc(t('buscando.sust'))}</span>
        <span class="sr-only">${esc(t('buscando.sr', { n: total, obj: objetivo }))}</span></p>
      ${filtro}
      <p class="buscando-lede">${esc(t('buscando.lede'))}</p>
      <ul class="buscando-pasos">
        <li><span class="n">01</span>${esc(t('buscando.paso1'))}</li>
        <li><span class="n">02</span>${esc(t('buscando.paso2'))}</li>
        <li><span class="n">03</span>${esc(t('buscando.paso3'))}</li>
      </ul>
      <p class="buscando-sub"><span class="buscando-spin"></span>${esc(t('buscando.sub'))}</p>
      <button type="button" class="buscando-volver" id="buscando-volver">${esc(t('buscando.volver'))}</button>
      ${esqueletos()}
    </div>`;

  // El alto, prestado un rato. Al menos pantalla y media: en la primera carga
  // no hay lista anterior que prestar, y sin este suelo el marco se queda solo,
  // el documento encoge y no hay a dónde bajar mientras se busca.
  zona.style.minHeight = `${Math.max(altoAntes, innerHeight * 1.8)}px`;

  // El marco a la vista, pero **solo si no se ve**. `scrollIntoView` no sirve
  // aquí: el marco es más alto que la ventana, y hasta `block: 'nearest'`
  // alinea su borde de arriba con el de arriba y se lleva la página 663 px
  // abajo —el «Convocatorias abiertas» y la barra del perfil quedaban cortados
  // bajo la cabecera—. Mirándolo a mano: en escritorio el titular ya se ve y
  // la página no se toca; en un móvil, donde el formulario ocupa casi la
  // pantalla, se sube lo justo para que el arranque caiga por encima de la
  // barra de abajo. Lo de atrás se alcanza con «Cambiar los filtros».
  const caja = $('#zona-lista .buscando').getBoundingClientRect();
  const cabecera = document.querySelector('header.top')?.getBoundingClientRect().height ?? 0;
  const barraFija = document.querySelector('#cartel-acceso')?.getBoundingClientRect().height ?? 0;
  const seVe = innerHeight - barraFija;
  if (caja.top < cabecera || caja.top + 80 > seVe) {
    window.scrollTo({
      top: Math.max(0, scrollY + caja.top - cabecera - 8),
      behavior: 'instant',
    });
  }

  $('#buscando-volver').onclick = () => {
    document.querySelector('.profile-bar')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  contarHasta($('#zona-lista .buscando-h .cuenta'), becas.length);
}

/**
 * Los huecos de ficha que van debajo del titular.
 *
 * La referencia —ProfScout— los pone ahí, y no son adorno: son la promesa de
 * que la espera acaba en una lista. Aquí no llevan dato dentro ni pueden
 * llevarlo; son huecos. Van `aria-hidden` porque un lector de pantalla no gana
 * nada leyendo tres «cargando», y **no llevan `data-beca`**: el test del velo
 * cuenta esas y un esqueleto no es una convocatoria.
 */
function esqueletos() {
  const uno = `<div class="esq"><span class="esq-l esq-t"></span><span class="esq-l"></span><span class="esq-l esq-c"></span></div>`;
  return `<div class="buscando-esqueletos" aria-hidden="true">${uno.repeat(3)}</div>`;
}

/**
 * El número del titular sube desde 0 hasta el total, y al aterrizar da un
 * pequeño golpe (`.contado`).
 *
 * Es el mismo teatro que el beat (AGENTS.md, «El momento de la búsqueda»):
 * la búsqueda no tarda —todo está en el navegador—, pero una cifra que
 * sube cuenta la historia que un total estático no cuenta: las que va
 * «encontrando». Va con easing hacia fuera —rápido al principio, cuando
 * «encuentra» de muchas en muchas, y frenando hasta exactamente el total—;
 * no es un `setInterval` lineal, que se leería como una cuenta de coche.
 *
 * El valor accesible lo lleva el `.sr-only` del titular (el total, estático);
 * el número que sube es ciego para el lector de pantalla, que es donde
 * debe estar: una cuenta que cambia cada frame es ruido, no información.
 */
function contarHasta(nodo, total, duracion = 1100) {
  if (!nodo) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodo.textContent = num(total);
    return;
  }
  const ficha = ++cuentaAbierta;
  const t0 = performance.now();
  const paso = (t) => {
    if (ficha !== cuentaAbierta) return;        // otra búsqueda lo relevó
    // El `t` del primer fotograma puede ser **anterior** a `t0`: el frame
    // pudo empezar antes de que acabara el clic. Sin el recorte, `p` sale
    // negativo y el easing devuelve un número negativo —«Buscando -798
    // becas»—, que es lo que se vio una vez. El reloj va de 0 a 1 y ni una
    // palabra más.
    const p = Math.min(Math.max((t - t0) / duracion, 0), 1);
    nodo.textContent = num(Math.round(total * (1 - Math.pow(1 - p, 3))));
    if (p === 1) { nodo.classList.add('contado'); return; }
    requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/**
 * Lo que hace «Comprobar»: guarda el perfil, enseña el marco y pinta al
 * final del beat.
 *
 * `clearTimeout` para que dos comprobaciones seguidas no acumulen beats
 * pendientes: el último manda. Y si la base aún no llegó —«Comprobar» antes
 * de que termine el `fetch`—, no hay titular que diga «Buscando 0 becas»:
 * se guarda el perfil y punto, porque cuando la base llegue se pinta sola.
 */
function comprobar() {
  perfil.guardar({
    nota: $('#nota').value.trim(),
    edad: $('#edad').value.trim(),
    nivel: $('#nivel').value,
    pais: $('#pais').value,
  });
  if (!becas.length) return;
  clearTimeout(beatPrevisto);
  cartelBusqueda();
  beatPrevisto = setTimeout(pintar, BEAT_BUSQUEDA);
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

  // El perfil se lee una vez por pintado: `cumple()` lo llama una vez por
  // requisito y por ficha, y leer el `localStorage` en cada llamada son
  // cientos de lecturas por repintado.
  perfilCache = null;

  // ── La misma beca, dos veces ─────────────────────────────────────────────
  //
  // La ingesta ya quita las duplicadas, pero el buscador no se fía de que el
  // fichero venga limpio: si hay dos fichas con el mismo título, se ve una.
  // Es lo que pidió quien usa la web: «si ya hay una beca igual, que no la
  // vuelva a poner».
  const vistas = new Set();
  const sinRepetir = [];
  for (const b of becas) {
    const clave = `${b.id}|${plano(b.titulo ?? '').replace(/\s+/g, ' ').trim()}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    sinRepetir.push(b);
  }

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
  // por el mismo motivo: quien busca una beca de investigación o una ayuda a una
  // asociación sabe lo que busca, y quitarle la entrada no le ahorra nada, solo
  // le hace perder tiempo. Ordenar sí ayuda; ocultar no.
  const util = (x) => (nReq(x) || x.presupuesto != null || x.boeIdBases ? 0 : 1);

  // ── El encaje: primero las que más cumples ──────────────────────────────
  //
  // El buscador ordenaba por fecha, y eso no dice nada de si la beca es para
  // ti. Con el perfil relleno, lo que ordena es **cuántos requisitos
  // cumples**: primero las que cumples más, y dentro de ellas las que se
  // cierran antes.
  //
  // Es un orden, no un filtro: una beca que no cumples sigue ahí, debajo. No
  // se esconde nada —el producto enseña requisitos, no Inner Circle—.
  const encaje = (x) => {
    const sab = (x.requisitos ?? []).filter((r) => cumple(r) !== null);
    if (!sab.length) return -1;
    return sab.filter((r) => cumple(r) === true).length;
  };

  const orden = [...sinRepetir].sort((a, b) => {
    const ea = encaje(a), eb = encaje(b);
    if (ea !== eb) return eb - ea;
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

  // ── La búsqueda por texto ────────────────────────────────────────────────
  //
  // El buscador solo tenía dos filtros —destino y nivel— y con eso no se
  // encuentra una beca: la palabra que uno busca («movilidad», «postgrado»,
  // «emprendimiento») está en el título, en el organizador o en los
  // requisitos, y no había ningún sitio donde escribirla.
  //
  // Se busca en todo lo que la ficha dice de sí misma: el título, quién
  // convoca, el nivel, los países (con su nombre, no con el código) y las
  // etiquetas de los requisitos. Sin tildes y sin distinguir mayúsculas,
  // porque nadie escribe «Alemánía» con el teclado en móvil.
  //
  // Con varias palabras, se pide **todas**: «becas germania» no encuentra
  // nada, pero «movilidad internationally» sí. Y una palabra suelta busca
  // dentro de la palabra, no al principio: «master» encuentra «Máster».
  const consulta = plano($('#q')?.value ?? '').trim();
  const palabras = consulta ? consulta.split(/\s+/).filter(Boolean) : [];

  // El texto de cada ficha se normaliza una vez y se guarda: con 386 fichas
  // y una búsqueda por pulsación, normalizar en cada filtro son 386
  // operaciones por tecla.
  const indice = new Map();
  const textoDe = (b) => {
    let txt = indice.get(b.id);
    if (txt !== undefined) return txt;
    const partes = [
      b.titulo ?? '',
      b.organizador ?? '',
      b.nivel ?? '',
      ...(b.paises ?? []).map((c) => nombreDe(c) ?? c),
      ...(b.requisitos ?? []).map((r) => `${r.etiqueta ?? ''} ${r.tipo ?? ''} ${r.valor ?? ''}`),
    ];
    txt = plano(partes.join(' '));
    indice.set(b.id, txt);
    return txt;
  };

  const filtradas = orden.filter((b) => {
    const paises = b.paises ?? [];
    // Sin destino conocido, la convocatoria se queda.
    if (paisElegido && paises.length && !paises.includes(paisElegido)) return false;
    // El nivel solo aparta cuando lo sabemos. Si no lo sabemos, se queda.
    if (nivelElegido && b.nivel && b.nivel !== nivelElegido) return false;
    // La búsqueda por texto: todas las palabras tienen que aparecer.
    if (palabras.length) {
      const txt = textoDe(b);
      if (!palabras.every((w) => txt.includes(w))) return false;
    }
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

  // El número de fichas con requisitos se cuenta con `nReq`, que sabe del
  // catálogo: allí `requisitos` viene vacío a propósito y el dato verdadero
  // es `n_requisitos`. Contando el array, la web diría «0 con requisitos» de
  // una base entera que sí los tiene.
  const conReq = filtradas.filter((b) => nReq(b)).length;

  // Cada cifra va en su `<span>`. Sueltas en el flujo, el punto separador
  // «·» es un nodo de texto más y en móvil el navegador lo deja colgando al
  // principio de la línea siguiente. Con los `<span>` los tres datos son
  // bloques que bajan enteros.
  const cuenta = [
    `<span><b>${num(filtradas.length)}</b> ${t(filtradas.length === 1 ? 'contador.una' : 'contador.varias')}</span>`,
    `<span><b>${num(conReq)}</b> ${t('contador.conReq')}</span>`,
    `<span><b>${num(filtradas.length - conReq)}</b> ${t('contador.sinReq')}</span>`,
  ];
  // Y el aviso de las que no dicen dónde, que es la parte honesta: si no
  // se dice, el estudiante cree que la lista entera es de ese país.
  if (sinPaisConocido) {
    cuenta.push(`<span><b>${num(sinPaisConocido)}</b> ${t('contador.sinPais')}</span>`);
  }
  if (sinNivelConocido) {
    cuenta.push(`<span><b>${num(sinNivelConocido)}</b> ${t('contador.sinNivel')}</span>`);
  }
  $('#counts').innerHTML = cuenta.join('\n     ');

  if (!filtradas.length) {
    // O no hay nada en la base, o el filtro dejó todo fuera. Son dos
    // cosas distintas y el mensaje tiene que distinguirlas: si el
    // estudiante ha filtrado por un país y no sale nada, lo que ve es
    // «no hay nada», y lo que tiene que entender es «no hay nada *para
    // ese filtro*». En el segundo caso, el aviso de las que no dicen
    // dónde dice cuántas se han quedado fuera.
    //
    // Y la búsqueda por texto es un filtro más: si no dice nada, el
    // estudiante tiene que saber si es que no hay nada o es que ha
    // escrito una palabra que no está.
    const filtrado = paisElegido || nivelElegido;
    const destino = paisDe(paisElegido) || paisElegido || t('vacio.cualquierDestino');
    const porTexto = palabras.length ? t('vacio.texto.p', { q: `<b>${esc($('#q').value.trim())}</b>` }) : '';
    $('#zona-lista').innerHTML = `
      <div class="empty">
        <h3>${t(filtrado || palabras.length ? 'vacio.filtro.h' : 'vacio.base.h')}</h3>
        <p>${porTexto
          ? porTexto
          : filtrado
            ? `${t('vacio.filtro.p', { p: `<b>${esc(destino)}</b>` })}
               ${sinPaisConocido ? t('vacio.filtro.sinPais', { n: num(sinPaisConocido) }) : ''}`
            : t('vacio.base.p')}</p>
      </div>`;
    $('#zona-lista').style.minHeight = '';
    return;
  }

  const html = `
    <div class="list">
      ${filtradas.map((b) => `<div class="lock" data-beca>${tarjeta(b)}</div>`).join('')}
    </div>`;

  $('#zona-lista').innerHTML = html;
  // El alto prestado se devuelve aquí, con la lista ya dentro. Quitarlo antes
  // encogería la página mientras se espera a la sesión, que va por red.
  $('#zona-lista').style.minHeight = '';
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
  txt.textContent = t('velo.texto');

  // La llamada al alta es un enlace a cuenta.html en otra pestaña, como las
  // demás puertas (ver pintarCabecera), no un modal encima de la lista.
  const b = document.createElement('a');
  b.className = 'btn cartel-btn';
  b.textContent = t('velo.btn');
  b.href = 'cuenta.html?desde=%2Fbecas.html';
  b.target = '_blank';
  b.rel = 'noopener';

  barra.append(txt, b);
  document.body.appendChild(barra);
}

/* ── Tarjeta ────────────────────────────────────────────────────────────── */

function tarjeta(b) {
  const p = perfilActual();
  const conPerfil = p.nota !== '' || p.edad !== '';
  // Ficha del catálogo público: tiene lo que se ve a través del velo, pero no
  // los requisitos. No se pinta «sin requisitos» —sería mentira— sino cuántos
  // hay detrás de la cuenta.
  const oculto = Boolean(b.oculto);
  const totalReq = nReq(b);

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
        <span>${esc(b.organizador)}</span>
      </div>
      <h2 class="beca-h">${esc(b.titulo)}</h2>

      <div class="beca-meta">
        ${b.cierra ? pillPlazo(b.cierra) : `<span class="pill">${t('tarjeta.plazoNo')}</span>`}
        ${b.presupuesto ? `<span class="pill brand mono">${euros(b.presupuesto)}</span>` : ''}

        ${b.fuente === 'daad' ? '<span class="pill brand">DAAD</span>' : ''}
        ${b.fuente === 'ue' ? `<span class="pill brand">${t('fuente.ue')}</span>` : ''}
        ${b.fuente === 'erasmus-mundus' ? '<span class="pill brand">Erasmus Mundus</span>' : ''}
        ${b.id.startsWith('BDNS') ? '<span class="pill mono">BDNS</span>' : ''}
        ${b.pagina ? `<span class="pill mono">BOE p. ${b.pagina}</span>` : ''}
        ${pillDestino(b)}
      </div>

      <div class="reqs">
        ${oculto
          ? `<p class="req-none">${esc(t('tarjeta.oculto', { n: num(totalReq) }))}</p>`
          : b.requisitos.length
            ? b.requisitos.map(fila).join('')
            : `<p class="req-none">${t(b.boeIdBases ? 'tarjeta.reqNoneBases' : 'tarjeta.reqNone')}</p>`}
      </div>
    </div>

    ${oculto ? anilloOculto() : anillo(ok, total, conPerfil)}

    <div class="beca-foot">
      <span class="pill ${!oculto && total && conPerfil ? 'brand' : ''}">
        ${oculto
          ? esc(t('tarjeta.ocultoPill', { n: num(totalReq) }))
          : !cond.length
            ? t('tarjeta.sinReq')
            : !total
              ? t(cond.length === 1 ? 'tarjeta.nadaComprobable.una' : 'tarjeta.nadaComprobable', { n: cond.length })
              : conPerfil
                ? `<b>${ok}</b> ${t(total === 1 ? 'tarjeta.de.uno' : 'tarjeta.de', { n: total })}`
                : t('tarjeta.anadeNota')}
      </span>
      <a class="src" href="${b.url}" target="_blank" rel="noopener">
        ${t(b.id.startsWith('BDNS') ? 'tarjeta.verConv' : 'tarjeta.verBoe')}
      </a>
    </div>
  </article>`;
}

function fila(r) {
  const ok = cumple(r);
  const clase = ok === true ? 'ok' : ok === false ? 'no' : 'unk';

  // La unidad **no** se inventa. Antes ponía `/ mes` detrás de cualquier
  // `importe`, y en las fichas del BOE esa cifra es el presupuesto total de la
  // convocatoria, no lo que cobra un beneficiario: se veía «40.670.000 € / mes».
  // La cifra viene con su cita debajo, que es donde se lee de qué va.
  // La cantidad se enseña tal cual y la unidad la deja la cita de al lado.
  const valor = r.valor != null && r.tipo !== 'fecha_limite'
    ? ` <span class="req-v">${esc(r.tipo === 'importe' || r.tipo === 'presupuesto' ? euros(r.valor) : r.valor)}</span>` : '';

  // Sin icono: el estado se dice con palabras. El texto es lo que sobrevive
  // a la traducción y a un lector de pantalla; un check verde no.
  const estado = ok === true ? t('req.ok') : ok === false ? t('req.no') : t('req.unk');

  return `<div class="req ${clase}">
    <span class="req-estado">${estado}</span>
    <span>
      <span class="req-k">${esc(etiqueta(r.tipo))}</span>${valor}
      ${motivo(r, ok) ? `<span class="req-why">${esc(motivo(r, ok))}</span>` : ''}
      <span class="req-src">${comillas(esc(corta(r.cita, 170)))}</span>
    </span>
  </div>`;
}

function anillo(ok, total, conPerfil) {
  const pct = total ? ok / total : 0;
  const cap = !total ? t('anillo.sinDatos') : !conPerfil ? t('anillo.anadeNota') : `${pct * 100 | 0}%`;
  // El anillo se pinta con `conic-gradient` y no con un SVG: el sitio no lleva
  // iconos, y un círculo de progreso no es un icono sino un gráfico. El
  // conic va en el `--pct` y el CSS lo lee para el arco.
  const ang = (pct * 360).toFixed(1);

  return `<div class="ringbox">
    <div class="ring" style="--pct:${ang}deg">
      <div class="ring-n">${total ? `${ok}<small>/${total}</small>` : '—'}</div>
    </div>
    <div class="ring-cap">${cap}</div>
  </div>`;
}

/**
 * El anillo de una ficha que no trae requisitos porque están detrás de la
 * cuenta. No se pinta un 0 %: no hay nada que comparar, y un cero se lee como
 * «no cumples» —justo la conclusión falsa que el producto no puede dar—.
 * Tampoco un «sin datos»: los datos existen, lo que falta es la cuenta.
 */
function anilloOculto() {
  return `<div class="ringbox">
    <div class="ring ring-vacio">
      <div class="ring-n">—</div>
    </div>
    <div class="ring-cap">${esc(t('anillo.oculto'))}</div>
  </div>`;
}

function pillPlazo(cierra) {
  const dias = Math.ceil((new Date(cierra) - Date.now()) / 86400000);
  if (dias < 0) return `<span class="pill rust">${t('tarjeta.cerrada')}</span>`;
  const cls = dias <= 15 ? 'amber' : '';
  const txt = dias === 0 ? t('tarjeta.venceHoy')
    : dias === 1 ? t('tarjeta.venceManana')
    : t('tarjeta.dias', { n: dias });
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

  // Se ordena por el nombre que se está leyendo, no por el castellano: en
  // inglés «Germany» va antes que «Spain», y con el orden castellano la
  // lista parecería desordenada sin motivo.
  const ordenados = [...paises].sort((a, b) => {
    const na = paisDe(a), nb = paisDe(b);
    return na.localeCompare(nb, idiomaActual());
  });

  const MAX = 3;
  const visibles = ordenados.slice(0, MAX);
  const resto = ordenados.length - visibles.length;

  const texto = visibles.map((c) => paisDe(c)).join(', ') + (resto ? ` +${resto}` : '');
  const completo = ordenados.map((c) => paisDe(c)).join(', ');

  return `<span class="pill mono" title="${esc(t('tarjeta.destino', { p: completo }))}">${esc(texto)}</span>`;
}

/* ── Utilidades ─────────────────────────────────────────────────────────── */

const $ = (s) => document.querySelector(s);
/** El importe, con el separador y el sitio del símbolo de cada idioma:
 *  «1.234.568 €» en castellano, «€1,234,568» en inglés. El símbolo solo
 *  cambia de lado; la cifra es la misma. */
function euros(n) {
  const cifra = n >= 1000 ? num(Math.round(n)) : String(n);
  return idiomaActual() === 'en' ? `€${cifra}` : `${cifra} €`;
}
/** Las comillas de la cita, las de cada idioma. El texto citado no se toca:
 *  solo cambia la raya que lo envuelve. */
function comillas(s) {
  return idiomaActual() === 'en' ? `“${s}”` : `«${s}»`;
}
function corta(s, n) {
  const texto = String(s ?? '');
  return texto.length > n ? `${texto.slice(0, n).trimEnd()}…` : texto;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Eventos ────────────────────────────────────────────────────────────── */

$('#buscar').addEventListener('click', comprobar);

// La salida del dock es la misma que la del perfil: cierra la sesión en el
// servidor y recarga. Al volver sin sesión, `pintarCabecera()` retira el
// dock y devuelve la cabecera con la puerta del alta.
$('#dock-salir')?.addEventListener('click', salir);

$('#pais').addEventListener('change', () => $('#buscar').click());
$('#nivel').addEventListener('change', () => $('#buscar').click());

/* La búsqueda por texto filtra la lista mientras se escribe.
 *
 * No pasa por el beat de «Buscando N becas»: ese marco es para comprobar el
 * perfil —un clic, un cálculo— y una palabra no es un clic. Aquí se repinta
 * la lista en cuanto se deja de escribir un momento, que es lo que hace que
 * en un móvil no parezca que la página no responde.
 */
let esperaTexto = null;
$('#q')?.addEventListener('input', () => {
  clearTimeout(esperaTexto);
  esperaTexto = setTimeout(() => {
    if (becas.length) pintar();
  }, 250);
});

/* La pestaña, cuando vuelve del alta.
 *
 * El alta se hace en cuenta.html, en otra pestaña: mientras se creaba la
 * cuenta esta página estuvo al fondo con el velo puesto y «Crear cuenta» en
 * la cabecera. Al recobrar el foco puede tener ya sesion en la cookie y no
 * haberse enterado.
 *
 * Se repregunta sin cache (`sesionFresca`, que además protege la sesión de
 * juguete, que el servidor no conoce) y solo si la firma cambió se repinta
 * la cabecera y la lista. El cuidado del despliegue es el mismo que tiene el
 * cambio de idioma: si el marco de la búsqueda está en pantalla se rehace
 * entero —su beat sigue su curso y no se le salta pintando la lista—. */
let vista = null;
async function alVolver() {
  if (document.visibilityState !== 'visible') return;
  const s = await sesionFresca();
  const ahora = s ? (s.local ? 'local' : 'si') : 'no';
  if (vista !== null && ahora !== vista) {
    // Si acaba de entrar, lo que hay en memoria es el catálogo público: sin
    // requisitos. Repintar sin volver a pedir la base dejaría la lista
    // desbloqueada pero vacía por dentro, que es peor que el velo.
    if (ahora === 'si' && !datosCompletos) {
      try { becas = await cargarDatos(); } catch { /* se queda el catálogo */ }
    }
    pintarCabecera();
    if ($('#zona-lista .buscando')) cartelBusqueda();
    else if (becas.length) pintar();
  }
  vista = ahora;
}
document.addEventListener('visibilitychange', alVolver);
window.addEventListener('focus', alVolver);

/* Al cambiar de idioma hay que repintar lo que nace en este fichero: la
 * cabecera, el desplegable de países, la lista y la barra de abajo. i18n.js
 * solo repinta lo que lleva `data-i18n` en el HTML, y aquí casi todo se
 * construye con plantillas.
 *
 * Si el cartel de la búsqueda está en pantalla se vuelve a montar entero en
 * vez de pintar la lista: el beat sigue corriendo y su temporizador es el que
 * acaba enseñando las fichas. Sustituirlo por la lista ahora convertiría el
 * cambio de idioma en un atajo para saltarse la espera. */
alCambiarIdioma(() => {
  pintarCabecera();
  traducirPaises();
  if ($('#zona-lista .buscando')) cartelBusqueda();
  else if (becas.length) pintar();
});

pintarCabecera();
cargar();

// Si se acaba de crear la cuenta en otro sitio —el callback de Google, o el
// salto de vuelta de cuenta.html con el alta recién hecha—, la página de
// aterrizaje es esta: la pregunta de llegada sale aquí. Ver
// `revisarEncuesta()` en js/auth.js.
revisarEncuesta();