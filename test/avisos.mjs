/**
 * test/avisos.mjs — Los avisos de plazo, de punta a punta.
 *
 * ── Por qué este fichero existe ───────────────────────────────────────────
 *
 * La cuenta de BecasScout existe para una promesa concreta: «avisarte cuando
 * se acerca un plazo». Es la razón por la que alguien da su correo a un
 * desconocido, y es la parte del producto que más caro sale cuando se rompe
 * —y más caro sale porque **los fallos son silenciosos**:
 *
 *   · Marcar antes de enviar agenda avisos para siempre perdidos: el primer
 *     correo que se traga un corte de Resend se convierte en un plazo que
 *     nunca se anuncia, y nadie ve ningún error.
 *   · Marcar sin confirmar el 2xx hace lo contrario: el mismo plazo vuelve
 *     cada mañana, y el correo que llega cinco veces es la razón por la que
 *     alguien apaga los avisos.
 *   · Una cuenta que ha apagado el aviso y sigue recibiendo correos. Eso es
 *     justo lo que el interruptor promete que no pasa.
 *   · Un cron abierto a cualquiera que lo llame.
 *
 * ── Cómo está montado ──────────────────────────────────────────────────────
 *
 * Igual que `test/store.mjs`, pero con las tres piezas montadas a la vez:
 *
 *   1. Un **Supabase de mentira** con las tablas `cuentas`, `sesiones` y
 *      `avisos`, que imita lo justo de la API REST: `GET` con filtro `eq.`,
 *      `POST` (con cuerpo objeto o con lote), `PATCH` y el 409 por violar la
 *      clave única.
 *   2. Un **Resend de mentira** al que apunta `RESEND_API_URL`, que guarda
 *      los envíos en memoria y se puede poner a fallar en caliente.
 *   3. Un **servidor de frente** que sirve `/data/becas.json` y enruta
 *      `/api/*` al handler real de `api/[...ruta].js`, igual que `serve.mjs`.
 *
 * El cron lee la base del día **del anfitrión de la petición**, no del disco:
 * por eso el servidor de frente no es un adorno del test, es lo que permite
 * probarlo sin tocar el `data/becas.json` de verdad.
 *
 * Corre sin red y sin claves:
 *
 *   node test/avisos.mjs
 */

import { createServer } from 'node:http';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

/* ── Un Supabase de mentira ───────────────────────────────────────────────── */

const tablas = {
  cuentas: new Map(),   // correo → { correo, hash, salt, avisos, … }
  sesiones: new Map(),  // token → { token, correo, expira }
  avisos: new Map(),    // "correo|beca" → { correo, beca }
};

/**
 * PostgREST parte el valor del filtro por el **primer** punto.
 *
 * Los correos llevan punto —`ana.maria@ejemplo.com` es un correo
 * perfectamente normal—, así que un simulador que partiera por todos los
 * puntos acabaría buscando `ana.maria@ejemplo` y devolvería una lista vacía
 * sin que nada fallara de forma visible.
 */
function partir(valor) {
  const punto = valor.indexOf('.');
  if (punto === -1) return ['', ''];
  return [valor.slice(0, punto), valor.slice(punto + 1)];
}

/**
 * Comparar un valor de la fila con el del filtro.
 *
 * El caso especial es el booleano: `avisos=eq.true` llega como la cadena
 * `'true'` y la fila lo guarda como `true`. Compararlos con `===` haría que
 * la cuenta con el aviso puesto no apareciese nunca en la lista del cron, y
 * el cron no mandaría nada sin dar ningún error.
 */
function coincide(real, valor) {
  if (typeof real === 'boolean') return String(real) === valor;
  if (real === null || real === undefined) return valor === 'null';
  return String(real) === valor;
}

function filtrar(tabla, params) {
  const filas = [...tablas[tabla].values()];
  // `select` no es un filtro: dice qué columnas se devuelven, no por qué fila.
  const condiciones = [...params.entries()].filter(([k]) => k !== 'select');
  if (!condiciones.length) return filas;

  return filas.filter((fila) => condiciones.every(([k, v]) => {
    const [op, valor] = partir(v);
    const real = fila[k];
    if (op === 'eq') return coincide(real, valor);
    if (op === 'gt') return new Date(real) > new Date(valor);
    throw new Error(`el simulador no sabe interpretar ${k}=${v}`);
  }));
}

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : {};
}

const servidorSupabase = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const tabla = url.pathname.split('/')[3];

  const responde = (codigo, datos) => {
    res.writeHead(codigo, { 'content-type': 'application/json' });
    res.end(datos === undefined ? '' : JSON.stringify(datos));
  };

  if (req.method === 'GET') {
    // PostgREST devuelve SIEMPRE un array, incluso de una fila. `consultar`
    // en lib/store.js coge el primero, así que un objeto suelto lo rompería.
    return responde(200, filtrar(tabla, url.searchParams));
  }

  if (req.method === 'POST') {
    const d = await leerCuerpo(req);
    const prefer = String(req.headers.prefer ?? '');

    // Lote: `avisos` se inserta con un array, porque una pasada del cron
    // escribe todas las fichas de una cuenta de golpe.
    if (Array.isArray(d)) {
      const ignorar = prefer.includes('resolution=ignore-duplicates');
      const nuevas = [];
      for (const fila of d) {
        const clave = `${fila.correo}|${fila.beca}`;
        if (tablas.avisos.has(clave)) {
          // Con `ignore-duplicates` lo repetido se pasa de largo: es el dedupe
          // de la cabecera `prefer`, y sin ella el POST entero reventaría con
          // 409 y el aviso se perdería.
          if (ignorar) continue;
          return responde(409, { message: 'duplicate key value violates unique constraint' });
        }
        const guardada = { ...fila };
        tablas.avisos.set(clave, guardada);
        nuevas.push(guardada);
      }
      // `return=none` es lo que pide `guardarAvisos`: 201 y sin cuerpo.
      if (prefer.includes('return=none')) return responde(201);
      return responde(201, nuevas);
    }

    const clave = tabla === 'cuentas' ? d.correo : d.token;
    if (tablas[tabla].has(clave)) {
      return responde(409, { message: 'duplicate key value violates unique constraint' });
    }
    const fila = {
      id: crypto.randomUUID(),
      // La migración 0003 pone `avisos boolean not null default true`: el
      // aviso es opt-out, así que una cuenta nueva lo trae puesto. Si el
      // simulador no lo imitara, el cron no vería ninguna cuenta y no
      // mandaría nada —sin ningún error, que es lo peor.
      ...(tabla === 'cuentas' ? { avisos: true } : {}),
      ...d,
    };
    tablas[tabla].set(clave, fila);
    return responde(201, [fila]);
  }

  if (req.method === 'PATCH') {
    const d = await leerCuerpo(req);
    const filas = filtrar(tabla, url.searchParams);
    // PostgREST contesta 404 cuando el filtro no toca ninguna fila: es lo
    // que `cambiarAvisos` lee como «esa cuenta no está».
    if (!filas.length) return responde(404, { message: 'no rows found' });
    for (const fila of filas) Object.assign(fila, d);
    return responde(200, filas);
  }

  if (req.method === 'DELETE') {
    const filas = filtrar(tabla, url.searchParams);
    for (const fila of filas) {
      for (const [clave, guardada] of tablas[tabla]) {
        if (guardada === fila) tablas[tabla].delete(clave);
      }
    }
    return responde(204);
  }

  return responde(405);
});

/* ── Un Resend de mentira ────────────────────────────────────────────────── */

/**
 * Los envíos y el modo del servidor.
 *
 * `modo` se cambia en caliente porque el caso que importa —«Resend contesta
 * 500»— no se puede probar con un Resend que siempre va bien: es el fallo
 * que decide si un aviso se pierde para siempre o solo se retrasa un día.
 */
const resend = {
  enviados: [],
  cabeceras: [],
  modo: 'ok',
};

const servidorResend = createServer(async (req, res) => {
  const d = await leerCuerpo(req);
  resend.cabeceras.push(req.headers.authorization ?? '');

  if (resend.modo === 'falla') {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: 'error de mentira' }));
  }

  resend.enviados.push(d);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: `res_${resend.enviados.length}` }));
});

/* ── Las variables de entorno, antes de nada ─────────────────────────────── */

/**
 * `lib/store.js` decide `haySupabase` **al cargarse**, no en cada llamada.
 *
 * Por eso las variables se fijan antes de importar nada del proyecto: si el
 * almacén se cargara sin `SUPABASE_URL`, se quedaría en el modo fichero y
 * escribiría en `data/usuarios.json` —el fichero que lleva correos— en vez
 * de hablar con el simulador. Y el handler se importa con `await import()`,
 * como hace `serve.mjs`.
 */
const PUERTO_SUPABASE = await new Promise((r) => servidorSupabase.listen(0, () => r(servidorSupabase.address().port)));
const PUERTO_RESEND = await new Promise((r) => servidorResend.listen(0, () => r(servidorResend.address().port)));

process.env.SUPABASE_URL = `http://127.0.0.1:${PUERTO_SUPABASE}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';
process.env.RESEND_API_URL = `http://127.0.0.1:${PUERTO_RESEND}/emails`;
process.env.RESEND_API_KEY = 'clave-de-prueba';
process.env.CORREO_DE = 'BecasScout <avisos@ejemplo.com>';
process.env.CRON_SECRET = 'secreto-de-prueba';

const { default: handler, hoyMadrid, fechaDe, seleccionar, redactar } = await import('../api/[...ruta].js');
const { crear, guardarToken, cambiarAvisos } = await import('../lib/store.js');

/* ── La base de mentiras ─────────────────────────────────────────────────── */

/**
 * La base que ve el cron, con fechas relativas a hoy.
 *
 * Las fechas se calculan con el mismo `hoyMadrid()` y el mismo `fechaDe()`
 * que usa el cron, y no con un cálculo propio: el día que se ejecuta el test
 * tiene que ser el día que ve el cron, no el día que el test cree que es.
 */
const HOY = hoyMadrid();
const enDias = (n) => fechaDe(HOY, n);

/**
 * La base que ve el cron hoy.
 *
 * Es una variable y no una constante porque hay un caso que necesita una base
 * sin ninguna convocatoria en la ventana: una cuenta con el aviso puesto y
 * nada que anunciarle no debe recibir un correo vacío.
 */
let BECAS = [
  {
    id: 'BOE-A-2026-00001',
    titulo: 'Beca de movilidad para estudiantes de grado',
    cierra: enDias(0),
    url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-00001',
    cerrada: false,
  },
  {
    id: 'BOE-A-2026-00002',
    titulo: 'Ayudas para la movilidad de jóvenes investigadores',
    cierra: enDias(2),
    url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-00002',
    cerrada: false,
  },
  {
    id: 'BDNS-910610',
    titulo: 'Subvenciones para la participación en programas de intercambio',
    cierra: enDias(5),
    url: 'https://www.boe.es/diario_boe/txt.php?id=BDNS-910610',
    cerrada: false,
  },
  {
    // Marcada cerrada pero con plazo futuro: el cron manda la fecha, no el
    // flag, y por eso esta entra.
    id: 'EMJM-2027-01',
    titulo: 'Erasmus Mundus Joint Master en Desarrollo Sostenible',
    cierra: enDias(7),
    url: 'https://erasmus-plus.ec.europa.eu/programmes/joint-masters',
    cerrada: true,
  },
  { id: 'BOE-A-2026-00004', titulo: 'Convocatoria que cierra fuera de la ventana', cierra: enDias(9), cerrada: false },
  { id: 'BOE-A-2026-00005', titulo: 'Convocatoria ya vencida', cierra: enDias(-3), cerrada: true },
  { titulo: 'Ficha sin identificador, que no se puede deduplicar', cierra: enDias(1) },
  { id: 'BOE-A-2026-00007', cierra: enDias(4) },
  { id: 'BOE-A-2026-00008', titulo: 'Fecha escrita en un formato raro', cierra: '31/12/2026' },
  { id: 'BOE-A-2026-00009', titulo: 'Convocatoria sin fecha de cierre' },
];

/* ── El servidor de frente ───────────────────────────────────────────────── */

/**
 * Sirve la base y enruta la API, igual que `serve.mjs`.
 *
 * El cron lee la base del **anfitrión de la petición** (`baseDe`): en
 * producción, del mismo dominio que sirve la web; en local, del mismo puerto
 * que sirve `serve.mjs`. Por eso este servidor tiene que existir: sin él, el
 * cron no tendría dónde leer la base y la prueba no probaría nada del
 * recorrido real.
 *
 * `baseRota` hace que `/data/becas.json` conteste 500, que es lo que pasa
 * cuando el fichero no se ha subido al despliegue: el cron tiene que
 * responder 200 y decir que no pudo leer la base, no caerse con un 503.
 */
let baseRota = false;

const servidorFrente = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('error');
      }
    });
    return;
  }

  if (url.pathname === '/data/becas.json') {
    if (baseRota) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('500 — la base no se pudo leer');
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      generado: new Date().toISOString(),
      version_reglas: 'test',
      rango: { desde: HOY, hasta: HOY },
      becas: BECAS,
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 — no encontrado');
});

const PUERTO_FRENTE = await new Promise((r) => servidorFrente.listen(0, () => r(servidorFrente.address().port)));
const FRENTE = `http://127.0.0.1:${PUERTO_FRENTE}`;

/* ── Utilidades ──────────────────────────────────────────────────────────── */

/**
 * Deja el mundo como estaba y siembra las cuentas del caso.
 *
 * Cada prueba parte de cero: si no, el dedupe de la pasada anterior dejaría
 * a la cuenta siguiente sin correos y la prueba probaría nada.
 */
async function sembrar(cuentas = []) {
  tablas.cuentas.clear();
  tablas.sesiones.clear();
  tablas.avisos.clear();
  resend.enviados.length = 0;
  resend.cabeceras.length = 0;
  resend.modo = 'ok';

  for (const c of cuentas) {
    await crear(c.correo, 'hash-de-prueba', 'sal-de-prueba');
    if (c.avisos === false) await cambiarAvisos(c.correo, false);
    if (c.token) await guardarToken(c.correo, c.token);
  }
}

/** Llama al cron con el secreto puesto (o sin él). */
async function llamarCron({ autorizado = true } = {}) {
  const cabeceras = {};
  if (autorizado) cabeceras.authorization = `Bearer ${process.env.CRON_SECRET}`;
  const r = await fetch(`${FRENTE}/api/cron-avisos`, { headers: cabeceras });
  return { status: r.status, cuerpo: await r.json() };
}

/** Llama a `POST /api/avisos` con la cookie de sesión, o sin ella. */
async function llamarAvisos(cuerpo, token) {
  const cabeceras = { 'content-type': 'application/json' };
  if (token) cabeceras.cookie = `bs_sesion=${token}`;
  const r = await fetch(`${FRENTE}/api/avisos`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, cuerpo: await r.json() };
}

/* ── La ventana: `seleccionar` ───────────────────────────────────────────── */

test('solo entran las convocatorias que cierran dentro de la ventana', () => {
  const hoy = '2026-10-20';
  const dentro = seleccionar([
    { id: 'a', titulo: 'Cierra hoy', cierra: '2026-10-20' },
    { id: 'b', titulo: 'Cierra dentro de una semana', cierra: '2026-10-27' },
    { id: 'c', titulo: 'Cierra fuera de la ventana', cierra: '2026-10-28' },
    { id: 'd', titulo: 'Ya cerró', cierra: '2026-10-19' },
  ], hoy);

  assert.deepEqual(dentro.map((f) => f.id), ['a', 'b']);
});

test('la fecha manda, no el campo `cerrada`', () => {
  // El flag viene del día en que se generó la base y puede mentir: hay
  // fichas marcadas cerradas que siguen abiertas, y la Comisión marcaba
  // «abierta» un plazo de 2023. La fecha es el dato del documento.
  const dentro = seleccionar([
    { id: 'a', titulo: 'Marcada cerrada pero con plazo futuro', cierra: '2026-10-22', cerrada: true },
    { id: 'b', titulo: 'Marcada abierta pero con plazo pasado', cierra: '2026-10-18', cerrada: false },
  ], '2026-10-20');

  assert.deepEqual(dentro.map((f) => f.id), ['a']);
});

test('una ficha rota no entra: sin id, sin título o con fecha imposible', () => {
  // Sin `id` no hay (correo, beca) que deduplicar, así que la ficha volvería
  // en cada pasada. Sin título no hay nada que anunciar. Y una fecha que no
  // es AAAA-MM-DD no se compara: sale una fecha en un formato raro y se
  // colaría en la ventana.
  const dentro = seleccionar([
    { titulo: 'Sin identificador', cierra: '2026-10-22' },
    { id: 'sin-titulo', cierra: '2026-10-22' },
    { id: 'fecha-rara', titulo: 'Fecha en formato raro', cierra: '22/10/2026' },
    { id: 'sin-fecha', titulo: 'Sin fecha de cierre' },
    { id: 'ok', titulo: 'Esta sí', cierra: '2026-10-22' },
  ], '2026-10-20');

  assert.deepEqual(dentro.map((f) => f.id), ['ok']);
});

test('las más urgentes van primero', () => {
  const dentro = seleccionar([
    { id: 'lejana', titulo: 'Cierra dentro de una semana', cierra: '2026-10-27' },
    { id: 'urgente', titulo: 'Cierra mañana', cierra: '2026-10-21' },
    { id: 'media', titulo: 'Cierra en tres días', cierra: '2026-10-23' },
  ], '2026-10-20');

  assert.deepEqual(dentro.map((f) => f.id), ['urgente', 'media', 'lejana']);
});

test('una convocatoria repetida en la base sale una sola vez', () => {
  // La base se regenera dos veces al día y el BOE republica anuncios: si la
  // misma convocatoria entrara dos veces, el correo la anunciaría dos veces y
  // el dedupe —que es por (correo, beca)— no la distinguiría.
  const dentro = seleccionar([
    { id: 'a', titulo: 'La misma', cierra: '2026-10-22' },
    { id: 'a', titulo: 'La misma, pero otra vez', cierra: '2026-10-22' },
  ], '2026-10-20');

  assert.equal(dentro.length, 1);
});

/* ── El correo: `redactar` ───────────────────────────────────────────────── */

test('el correo lleva el título, la fecha de cierre y el enlace', () => {
  const carta = redactar([
    { id: 'x', titulo: 'Beca para Oleg', cierra: '2026-10-22', url: 'https://ejemplo.org/oleg' },
  ], '2026-10-20', 'https://becascout.vercel.app');

  // El asunto dice cuántas son, no cuáles: un correo con diez títulos en la
  // línea de asunto no lo lee nadie.
  assert.match(carta.asunto, /1 convocatoria cierra esta semana/);

  assert.match(carta.texto, /Beca para Oleg/);
  assert.match(carta.texto, /Cierra el 22\/10\/2026 \(en 2 días\)/);
  assert.match(carta.texto, /https:\/\/ejemplo\.org\/oleg/);

  assert.match(carta.html, /Beca para Oleg/);
  assert.match(carta.html, /22\/10\/2026/);
  assert.match(carta.html, /https:\/\/ejemplo\.org\/oleg/);
});

test('el asunto va en plural cuando son varias', () => {
  const carta = redactar([
    { id: 'a', titulo: 'Una', cierra: '2026-10-21' },
    { id: 'b', titulo: 'Otra', cierra: '2026-10-23' },
  ], '2026-10-20', 'https://becascout.vercel.app');

  assert.match(carta.asunto, /2 convocatorias cierran esta semana/);
});

test('el correo no trae ningún porcentaje de encaje', () => {
  // El producto no enseña probabilidades: no hay histórico de solicitudes ni
  // de adjudicaciones, así que cualquier «85 % de probabilidad» sería una
  // cifra inventada con aspecto de estadística. Ver «El otro límite» de
  // AGENTS.md.
  const carta = redactar([
    { id: 'a', titulo: 'Una', cierra: '2026-10-21' },
    { id: 'b', titulo: 'Otra', cierra: '2026-10-23' },
  ], '2026-10-20', 'https://becascout.vercel.app');

  // Los estilos del HTML llevan porcentajes (`width:100%`), que no son datos:
  // se quitan antes de mirar, que si no la comprobación no distinguiría un
  // «85 %» de un `100%` de una tabla.
  const sinEstilos = carta.html.replace(/style="[^"]*"/g, '');

  for (const parte of [carta.asunto, carta.texto, sinEstilos]) {
    assert.ok(!/\d+\s*%/.test(parte), 'ningún porcentaje en el correo');
    assert.ok(!/probabilidad|encaje|match/i.test(parte), 'el correo no habla de encaje');
  }
});

test('con más de diez fichas se anuncian diez y las demás se cuentan', () => {
  // Lo que se marca en `avisos` es lo que el correo anuncia. Lo que queda
  // detrás del tope es un recuento: si se marcaran todas, lo cortado jamás
  // aparecería por su nombre.
  const muchas = Array.from({ length: 12 }, (_, i) => ({
    id: `X-${i}`,
    titulo: `Convocatoria número ${i}`,
    cierra: `2026-10-${String(20 + i).padStart(2, '0')}`,
    url: `https://ejemplo.org/x-${i}`,
  }));

  const carta = redactar(muchas, '2026-10-20', 'https://becascout.vercel.app');

  assert.equal(carta.anunciadas.length, 10);
  assert.deepEqual(carta.anunciadas.map((f) => f.id), muchas.slice(0, 10).map((f) => f.id));

  assert.match(carta.texto, /y 2 más/);
  assert.match(carta.html, /y 2 más/);

  assert.ok(carta.texto.includes('Convocatoria número 9'), 'la décima sí sale');
  assert.ok(!carta.texto.includes('Convocatoria número 10'), 'la undécima no sale: se cuenta');
  assert.ok(!carta.texto.includes('Convocatoria número 11'));
});

test('el título de un anuncio se escapa en el HTML', () => {
  // Un título del BOE lleva `&` y puede llevar `<`. Sin escapar, el correo
  // es un vector de inyección y, además, el texto sale mal.
  const carta = redactar([
    { id: 'x', titulo: 'Ayudas &<size> para menores de 30 años', cierra: '2026-10-22' },
  ], '2026-10-20', 'https://becascout.vercel.app');

  assert.match(carta.html, /Ayudas &amp;&lt;size&gt;/);
  assert.ok(!/<size>/.test(carta.html), 'la etiqueta no puede colarse tal cual');
});

/* ── El interruptor: `POST /api/avisos` ─────────────────────────────────── */

test('el interruptor apaga el aviso de la cuenta y la web lo ve', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com', token: 'tok-ana' }]);

  const r = await llamarAvisos({ activar: false }, 'tok-ana');
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);
  assert.equal(r.cuerpo.avisos, false);

  // La columna de la cuenta, que es lo que lee el cron con `avisos=eq.true`.
  assert.equal(tablas.cuentas.get('ana@ejemplo.com').avisos, false);

  // Y lo que ve el navegador: `/api/yo` es lo que lee la página de cuenta.
  const yo = await fetch(`${FRENTE}/api/yo`, { headers: { cookie: 'bs_sesion=tok-ana' } });
  assert.equal(yo.status, 200);
  assert.equal((await yo.json()).avisos, false);
});

test('el interruptor se puede volver a encender', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com', token: 'tok-ana' }]);

  await llamarAvisos({ activar: false }, 'tok-ana');
  const r = await llamarAvisos({ activar: true }, 'tok-ana');

  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.avisos, true);
  assert.equal(tablas.cuentas.get('ana@ejemplo.com').avisos, true);
});

test('sin sesión el interruptor no hace nada', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  const r = await llamarAvisos({ activar: false });
  assert.equal(r.status, 401);
  assert.equal(tablas.cuentas.get('ana@ejemplo.com').avisos, true, 'no se toca la cuenta');
});

test('«activar» tiene que ser un booleano', async () => {
  // El navegador manda el estado del interruptor. Un «true» como cadena es
  // un bug del front, no un estado: grabado tal cual se va a la columna, el
  // filtro `avisos=eq.true` del cron no lo encuentra y la cuenta dejaría de
  // recibir avisos en silencio.
  await sembrar([{ correo: 'ana@ejemplo.com', token: 'tok-ana' }]);

  const r = await llamarAvisos({ activar: 'sí' }, 'tok-ana');
  assert.equal(r.status, 400);
  assert.equal(tablas.cuentas.get('ana@ejemplo.com').avisos, true, 'no se toca la cuenta');
});

/* ── La pasada diaria ────────────────────────────────────────────────────── */

test('sin configuración de envío no se manda nada y no se marca nada', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  const antes = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const r = await llamarCron();

    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.ok, true);
    assert.equal(r.cuerpo.motivo, 'sin configuración de envío');
    // `pendientes` cuenta **cuentas**, no fichas: es lo que queda por
    // avisar, que es lo que se le dice al operador.
    assert.equal(r.cuerpo.pendientes, 1);

    assert.equal(resend.enviados.length, 0);
    assert.equal(tablas.avisos.size, 0, 'nada se marca antes de enviar');
  } finally {
    process.env.RESEND_API_KEY = antes;
  }
});

test('la pasada manda un correo por cuenta con el aviso puesto', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  const r = await llamarCron();
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);
  assert.equal(r.cuerpo.emails, 1);
  assert.equal(r.cuerpo.fallidos, 0);

  assert.equal(resend.enviados.length, 1);
  const carta = resend.enviados[0];
  assert.deepEqual(carta.to, ['ana@ejemplo.com']);
  assert.equal(carta.from, process.env.CORREO_DE);
  assert.match(carta.subject, /4 convocatorias cierran esta semana/);

  // El correo lleva la convocatoria que cierra, con su fecha y su enlace.
  assert.match(carta.text, /Beca de movilidad para estudiantes de grado/);
  assert.match(carta.text, /Cierra el \d{2}\/\d{2}\/\d{4} \(hoy\)/);
  assert.match(carta.text, /https:\/\/www\.boe\.es\/diario_boe\/txt\.php\?id=BOE-A-2026-00001/);

  // Y la clave de la API va en la cabecera, no en el cuerpo.
  assert.equal(resend.cabeceras[0], `Bearer ${process.env.RESEND_API_KEY}`);
});

test('lo enviado se marca con la fila (correo, beca)', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com' }]);
  await llamarCron();

  // Las cuatro fichas de la ventana, y solo esas: la que cierra fuera no se
  // marca, porque no se ha anunciado.
  assert.equal(tablas.avisos.size, 4);
  assert.ok(tablas.avisos.has('ana@ejemplo.com|BOE-A-2026-00001'));
  assert.ok(tablas.avisos.has('ana@ejemplo.com|BOE-A-2026-00002'));
  assert.ok(tablas.avisos.has('ana@ejemplo.com|BDNS-910610'));
  assert.ok(tablas.avisos.has('ana@ejemplo.com|EMJM-2027-01'));
  assert.ok(!tablas.avisos.has('ana@ejemplo.com|BOE-A-2026-00004'), 'la que cierra fuera no se marca');
});

test('una segunda pasada seguida no vuelve a mandar nada', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  await llamarCron();
  const enviados = resend.enviados.length;
  const filas = tablas.avisos.size;

  const r = await llamarCron();
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.emails, 0);
  assert.equal(resend.enviados.length, enviados, 'no se manda el mismo correo dos veces');
  assert.equal(tablas.avisos.size, filas, 'la tabla no crece');
});

test('una cuenta que ha apagado el aviso no recibe correo', async () => {
  await sembrar([
    { correo: 'ana@ejemplo.com' },
    { correo: 'bruno@ejemplo.com', avisos: false },
  ]);

  const r = await llamarCron();
  assert.equal(r.cuerpo.emails, 1);
  assert.equal(resend.enviados.length, 1);
  assert.deepEqual(resend.enviados[0].to, ['ana@ejemplo.com']);
});

test('con CRON_SECRET puesto, el cron no responde a cualquiera', async () => {
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  const r = await llamarCron({ autorizado: false });
  assert.equal(r.status, 401);
  assert.equal(resend.enviados.length, 0, 'ni un correo sale sin comprobar el secreto');

  const ok = await llamarCron();
  assert.equal(ok.status, 200);
  assert.equal(ok.cuerpo.emails, 1);
});

test('un envío que falla no marca nada y se reintenta al día siguiente', async () => {
  // Marcar antes de enviar agendaría avisos para siempre perdidos: la fila
  // de `avisos` nace como «ya enviado» y un plazo consumido no vuelve a
  // anunciarse. Si Resend contesta 500, la fila no se escribe y la pasada
  // siguiente lo reintenta.
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  resend.modo = 'falla';
  const r = await llamarCron();
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.emails, 0);
  assert.equal(r.cuerpo.fallidos, 1);
  assert.equal(tablas.avisos.size, 0, 'un envío fallido no se marca');

  resend.modo = 'ok';
  const r2 = await llamarCron();
  assert.equal(r2.cuerpo.emails, 1);
  assert.equal(tablas.avisos.size, 4, 'el reintento sí marca');
});

test('una cuenta sin plazo en la ventana no recibe correo', async () => {
  // Una cuenta con el aviso puesto y ninguna convocatoria que cierre en la
  // ventana no debe recibir un correo vacío: la pasada responde 200 y no
  // manda nada.
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  const original = BECAS;
  BECAS = original.map((b) => ({ ...b, cierra: enDias(30) }));
  try {
    const r = await llamarCron();
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.emails, 0);
    assert.equal(resend.enviados.length, 0);
    assert.equal(tablas.avisos.size, 0);
  } finally {
    BECAS = original;
  }
});

test('si la base no se puede leer, la pasada lo dice y no se cae', async () => {
  // El cron tiene su propio contrato: SIEMPRE 200. Una pasada sin envíos y
  // una función caída tienen que poder distinguirse desde fuera, y si el cron
  // cayera en el `catch` general respondería 503 —igual que cualquier otra
  // ruta— y nadie sabría si el problema era la base o la función.
  await sembrar([{ correo: 'ana@ejemplo.com' }]);

  baseRota = true;
  try {
    const r = await llamarCron();
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.ok, false);
    assert.equal(r.cuerpo.motivo, 'no se pudo leer la base');
    assert.equal(resend.enviados.length, 0);
    assert.equal(tablas.avisos.size, 0, 'sin base no se marca nada');
  } finally {
    baseRota = false;
  }
});

/* ── Cierre ──────────────────────────────────────────────────────────────── */

after(() => {
  servidorFrente.close();
  servidorSupabase.close();
  servidorResend.close();
});
