/**
 * test/store.mjs — El almacén contra un Supabase de mentira.
 *
 * ── Por qué esto existe ────────────────────────────────────────────────────
 *
 * El código que habla con Supabase es el único que no se puede probar de otra
 * manera: hace falta una cuenta, un proyecto y tres claves. Y el día que se
 * puso en producción no se había ejecutado ni una vez, porque no había
 * claves —lo que convirtió un `SUPABASE_URL` sin rellenar en un fallo que
 * solo se veía mirando los logs de la función.
 *
 * Así que aquí se levanta un servidor que imita lo justo de la API REST de
 * Supabase —`GET` con filtro `eq.`, `POST`, `PATCH`, `DELETE`, y el 409 por
 * violar la clave única— y se comprueba que el almacén hace las peticiones
 * correctas y devuelve lo que debe. No es un test de red: no sale de aquí,
 * corre sin conexión y sin claves.
 *
 * Lo que NO comprueba, y conviene no confundir: que el SQL de
 * `supabase/migrations/` sea el que Supabase espera. Eso solo se verifica en
 * el SQL Editor, con el proyecto delante.
 *
 *   node test/store.mjs
 */

import { createServer } from 'node:http';
import assert from 'node:assert/strict';

/* ── Un Supabase de mentira ───────────────────────────────────────────────── */

/**
 * Tablas en memoria, con las mismas reglas que las de Postgres: correo único,
 * token de sesión único. `log` guarda cada petición que recibe el servidor
 * para poder afirmar sobre *cómo* se llaman, no solo sobre qué devuelven.
 */
const tablas = {
  cuentas: new Map(),   // correo → { correo, hash, salt, creado, origen?, origen_en? }
  sesiones: new Map(),  // token → { token, correo, expira, creado }
};
const log = [];

/**
 * PostgREST parte el valor por el **primer** punto, no por todos.
 *
 * Esto importa más de lo que parece: los correos llevan punto. Con
 * `'eq.persona@ejemplo.com'.split('.')` salen tres trozos y el filtro acaba
 * buscando `persona@ejemplo`, que no existe, y el `GET` devuelve vacío sin
 * que nada falle de forma visible —la consulta responde 200 con `[]`—. El
 * almacén sí que lo hace bien, porque codifica con `encodeURIComponent`; el
 * simulador es el que tenía que aprender a hacerlo igual.
 *
 * Y desde que el almacén entrecomilla (ver `valor` en lib/store.js), el
 * simulador tiene que quitárselas: el `%40` del `@` se resuelve al leer la
 * query, pero las comillas delimitadoras llegan tal cual, y una fila esa
 * buscada como `"persona@ejemplo.com"` —con comillas— no existe. Otra vez
 * 200 con `[]` y ni un solo error a la vista.
 */
function partir(v) {
  const punto = v.indexOf('.');
  if (punto === -1) return ['', ''];
  const op = v.slice(0, punto);
  let valor = v.slice(punto + 1);
  if (valor.startsWith('"') && valor.endsWith('"') && valor.length > 1) {
    valor = valor.slice(1, -1);
  }
  return [op, valor];
}

function filtrar(tabla, params) {
  const q = new URLSearchParams(params);
  const filas = [...tablas[tabla].values()];
  const condiciones = [...q.entries()].filter(([k]) => k !== 'select');
  if (!condiciones.length) return filas;

  return filas.filter((fila) =>
    condiciones.every(([k, v]) => {
      const [op, valor] = partir(v);
      const real = fila[k];
      if (op === 'eq') return real === valor;
      if (op === 'gt') return new Date(real) > new Date(valor);
      throw new Error(`el simulador no sabe interpretar ${k}=${v}`);
    }));
}

/** Igual que `filtrar`, pero devuelve `null` si no hay filas. Es como lo ve `consultar`. */
function unoOCero(tabla, params) {
  return filtrar(tabla, params)[0] ?? null;
}

async function cuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return trozos.length ? JSON.parse(Buffer.concat(trozos).toString()) : {};
}

function claveUnicaViolada() {
  return 'duplicate key value violates unique constraint';
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // La tabla va en la ruta y los filtros en la query. Partir el pathname en
  // trozos no vale: `url.pathname` no incluye el `?token=eq.…`, así que el
  // simulador acababa respondiendo «dame todas las filas» y ningún filtro se
  // comprobaba. Cuatro pruebas daba por buenas sin haber comprobado nada.
  const tabla = url.pathname.split('/')[3];
  const consulta = url.searchParams.toString();
  log.push({ metodo: req.method, tabla, consulta });

  const responde = (codigo, datos) => {
    res.writeHead(codigo, { 'content-type': 'application/json' });
    res.end(datos === undefined ? '' : JSON.stringify(datos));
  };

  if (req.method === 'GET') {
    const fila = unoOCero(tabla, consulta);
    // PostgREST devuelve 200 con `[]`; el 406 aparece cuando el rango pedido
    // no encaja con las filas. Se prueban las dos formas en `consultar`.
    if (!fila) return responde(200, []);
    return responde(200, [fila]);
  }

  if (req.method === 'POST') {
    const d = await cuerpo(req);
    const clave = tabla === 'cuentas' ? d.correo : d.token;
    if (tablas[tabla].has(clave)) {
      return responde(409, { message: claveUnicaViolada(), code: '23505' });
    }
    // `id` no lo manda quien inserta: lo pone el `default gen_random_uuid()`
    // de la tabla. El simulador tiene que hacer lo mismo o el almacén no ve
    // nunca el `id` que en producción le devolverá Postgres.
    const fila = {
      creado: new Date().toISOString(),
      ...(tabla === 'cuentas' ? { id: crypto.randomUUID() } : {}),
      ...d,
    };
    tablas[tabla].set(clave, fila);
    return responde(201, [fila]);
  }

  if (req.method === 'PATCH') {
    const d = await cuerpo(req);
    const filas = filtrar(tabla, consulta);
    // PostgREST contesta 404 cuando se pide `return=representation` y el
    // filtro no toca ninguna fila. Es lo que el almacén lee como «esa cuenta
    // no está», así que el simulador tiene que hacer lo mismo o `guardarOrigen`
    // parecería funcionar con correos que no existen.
    if (!filas.length) return responde(404, { message: 'no rows found' });
    // `filtrar` devuelve las filas del Map por referencia: actualizarlas en
    // sitio es exactamente lo que hace un `update` de verdad.
    for (const fila of filas) Object.assign(fila, d);
    return responde(200, filas);
  }

  if (req.method === 'DELETE') {
    const q = new URLSearchParams(consulta);
    for (const [k, v] of q) {
      const [, valor] = partir(v);
      for (const [clave, fila] of tablas[tabla]) if (fila[k] === valor) tablas[tabla].delete(clave);
    }
    return responde(204);
  }
  responde(405);
});

/* ── Arranque ─────────────────────────────────────────────────────────────── */

const PUERTO = await new Promise((r) => servidor.listen(0, () => r(servidor.address().port)));

// Se pone antes de importar el almacén, porque `haySupabase` se decide al
// cargarse el módulo y no se vuelve a mirar.
process.env.SUPABASE_URL = `http://127.0.0.1:${PUERTO}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';

const { crear, buscar, guardarOrigen, guardarToken, porToken, quitarToken } =
  await import('../lib/store.js');

/* ── Comprobaciones ───────────────────────────────────────────────────────── */

let hechos = 0;

async function prueba(nombre, fn) {
  tablas.cuentas.clear();
  tablas.sesiones.clear();
  log.length = 0;
  try {
    await fn();
    hechos++;
    console.log(`  ok   ${nombre}`);
  } catch (err) {
    console.error(`  FALLA ${nombre}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

await prueba('crear guarda la cuenta y normaliza el correo', async () => {
  const u = await crear('  Persona@Ejemplo.COM ', 'hash', 'sal');
  assert.equal(u.correo, 'persona@ejemplo.com', 'debe bajar las minúsculas');
  assert.ok(u.id, 'debe traer id');
  assert.equal((await buscar('PERSONA@ejemplo.com')).hash, 'hash');
});

await prueba('crear devuelve null si el correo ya existe', async () => {
  await crear('dup@ejemplo.com', 'hash', 'sal');
  assert.equal(await crear('dup@ejemplo.com', 'otro', 'sal'), null);
  assert.equal((await buscar('dup@ejemplo.com')).hash, 'hash', 'no debe pisar la existente');
});

await prueba('guardarToken crea una fila en sesiones, no toca la cuenta', async () => {
  await crear('a@ejemplo.com', 'hash', 'sal');
  assert.equal(await guardarToken('a@ejemplo.com', 'tok-1'), true);

  const sesion = tablas.sesiones.get('tok-1');
  assert.equal(sesion.correo, 'a@ejemplo.com');
  assert.ok(new Date(sesion.expira) > new Date(), 'la sesión debe venir con caducidad futura');
  assert.ok(!('token' in (await buscar('a@ejemplo.com'))), 'la cuenta no debe llevar el token');
});

await prueba('guardarToken falla si la cuenta no existe', async () => {
  assert.equal(await guardarToken('nadie@ejemplo.com', 'tok-x'), false);
});

await prueba('dos sesiones del mismo correo viven las dos', async () => {
  await crear('m@ejemplo.com', 'hash', 'sal');
  await guardarToken('m@ejemplo.com', 'tok-movil');
  await guardarToken('m@ejemplo.com', 'tok-portatil');

  assert.equal(tablas.sesiones.size, 2, 'deben existir las dos sesiones');
  assert.equal((await porToken('tok-movil')).correo, 'm@ejemplo.com');
  assert.equal((await porToken('tok-portatil')).correo, 'm@ejemplo.com');
});

await prueba('cerrar sesión mata solo esa', async () => {
  await crear('m@ejemplo.com', 'hash', 'sal');
  await guardarToken('m@ejemplo.com', 'tok-movil');
  await guardarToken('m@ejemplo.com', 'tok-portatil');

  assert.equal(await quitarToken('tok-movil'), true);
  assert.equal(await porToken('tok-movil'), null, 'la cerrada debe estar muerta');
  assert.ok(await porToken('tok-portatil'), 'la otra debe seguir viva');
});

await prueba('una sesión caducada no entra', async () => {
  await crear('c@ejemplo.com', 'hash', 'sal');
  await guardarToken('c@ejemplo.com', 'tok-corto', -1);   // -1 días: ya caducó
  assert.equal(await porToken('tok-corto'), null);
});

await prueba('porToken sin token no hace nada', async () => {
  assert.equal(await porToken(undefined), null);
  assert.equal(await porToken(''), null);
});

await prueba('un correo con punto se encuentra igual', async () => {
  // `nombre.apellido@ejemplo.com` es el caso normal de cualquier persona, y es
  // el que rompe un filtro que parte el valor por todos los puntos en vez de
  // por el primero.
  await crear('nombre.apellido@ejemplo.com', 'hash', 'sal');
  assert.equal((await buscar('nombre.apellido@ejemplo.com')).hash, 'hash');
  assert.equal(await buscar('nombre@ejemplo.com'), null, 'otro correo no debe colarse');
});

await prueba('guardarOrigen anota la respuesta en la cuenta, sin tocar el resto', async () => {
  await crear('o@ejemplo.com', 'hash', 'sal');
  assert.equal(await guardarOrigen('O@Ejemplo.com', 'chatgpt'), true);

  const u = await buscar('o@ejemplo.com');
  assert.equal(u.origen, 'chatgpt');
  assert.ok(u.origen_en, 'debe quedar la fecha en que se contestó');
  assert.equal(u.hash, 'hash', 'el PATCH no debe pisar las otras columnas');
  assert.ok(
    log.some((l) => l.metodo === 'PATCH' && l.tabla === 'cuentas'),
    'debe actualizar la fila, no crear una nueva',
  );
});

await prueba('guardarOrigen devuelve false si esa cuenta no existe', async () => {
  assert.equal(await guardarOrigen('nadie@ejemplo.com', 'claude'), false);
});

await prueba('las consultas filtran por eq. y por gt.', async () => {
  await crear('f@ejemplo.com', 'hash', 'sal');
  await guardarToken('f@ejemplo.com', 'tok-1');
  await porToken('tok-1');

  const consulta = log.find((l) => l.metodo === 'GET' && l.tabla === 'sesiones').consulta;
  // Con el entrecomillado del almacén, el token literal va detrás de `%22…%22`
  // en la consulta que se manda. Es lo que evita que un punto dentro del valor
  // —los correos lo llevan— y eso corta el operador. Ver `valor` en lib/store.js.
  assert.match(consulta, /token=eq\.%22tok-1%22/, 'debe filtrar por el token exacto');
  assert.match(consulta, /expira=gt\./, 'debe descartar lo caducado');
});

servidor.close();

console.log(`\n${hechos} pruebas de lib/store.js contra el simulador de Supabase.`);