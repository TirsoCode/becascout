/**
 * test/sin-avisos.mjs — que la retirada de los avisos se queda retirada.
 *
 * ── Por qué esto existe ──────────────────────────────────────────────────
 *
 * El sistema de avisos por correo existió del 20 al 28 de octubre de 2026 y
 * se retiró entero: el cron (`/api/cron-avisos`), la ruta (`/api/avisos`), el
 * interruptor en ajustes, la tabla `avisos`, la columna `cuentas.avisos` y su
 * prueba (`test/avisos.mjs`). El motivo está en AGENTS.md: sin un dominio
 * verificado en el proveedor de correo, la promesa «te avisamos» no se podía
 * sustentar, y una promesa que no se cumple es peor que ninguna.
 *
 * Una retirada no acaba de morir solo borrando ficheros: lo que sobrevive en
 * una esquina vuelve a colarse, y lo hace en silencio — una ruta viva
 * responde 200, una clave muerta del diccionario no da error, un `cron` en
 * `vercel.json` despliega un endpoint que ya no existe. Este test vigila las
 * puertas por las que el sistema podría volver:
 *
 *   · las rutas retiradas contestan 404 — no 401 ni 503, que delatarían un
 *     handler vivo o un servidor enfermo;
 *   · `/api/yo` ya no trae la clave `avisos` que ya nadie lee;
 *   · el almacén no exporta ninguna función de avisos;
 *   · el diccionario y el front no conservan las claves muertas;
 *   · `vercel.json` no declara `crons` y los ficheros de ignore no mencionan
 *     el `data/avisos.json` que ya no existe;
 *   · y la otra cara de la misma jornada: la etiqueta de Vercel Analytics
 *     está en las ocho páginas públicas y en la plantilla de
 *     `ingest/paginas.mjs` — llegó el mismo día que la retirada, y si una
 *     regeneración de `erasmus-mundus.html` la pierde, nadie lo notaría;
 *   · y nadie vuelve a prometer «no hay analítica», la frase que dejó de ser
 *     verdad el día que la analítica entró.
 *
 * ── Cómo se ejecuta ──────────────────────────────────────────────────────
 *
 *   node test/sin-avisos.mjs
 *
 * Levanta su propio `serve.mjs` en un puerto libre —ni el 5173 de las pruebas
 * de navegador ni el 5174 de la suite e2e—, con `BS_SIN_ENV=1` para que el
 * almacén caiga al fichero y ninguna cuenta de prueba toque la base real. La
 * cuenta que crea se da de baja ella misma; si algo falla a mitad, la
 * limpieza del final la quita de `data/usuarios.json` y lo dice. Sin red más
 * allá de localhost, sin claves y sin dependencias.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

/**
 * Un puerto libre, y no uno fijado. Es la lección de `test/web.mjs`: los
 * puertos conocidos están tomados por quien corre en paralelo —el 5173 lo
 * mira el test del navegador, el 5174 la suite e2e, el 9222 el protocolo de
 * depuración de Chrome—, y atarse a uno ocupado mide una cosa que no es la
 * propia.
 */
async function puertoLibre(base) {
  for (let p = base; p < base + 60; p++) {
    const libre = await new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (libre) return p;
  }
  throw new Error('no hay ningún puerto libre para el servidor');
}

const CORREO = 'prueba-sin-avisos@ejemplo.test';
const CLAVE = 'contraseña-de-prueba';   // ≥ 10: lo que exige la ruta
const PAGINAS = [
  'index.html', 'becas.html', 'cuenta.html', 'sobre.html',
  'erasmus-mundus.html', 'privacidad.html', 'cookies.html', '404.html',
];
const ETIQUETA_ANALYTICS = '/_vercel/insights/script.js';

let hechos = 0;
let fallos = 0;

async function prueba(nombre, fn) {
  try {
    await fn();
    hechos++;
    console.log(`  ok   ${nombre}`);
  } catch (err) {
    fallos++;
    console.error(`  FALLA ${nombre}\n       ${err.message}`);
  }
}

// ── El servidor ──────────────────────────────────────────────────────────

const PUERTO = await puertoLibre(5181);
const BASE = `http://127.0.0.1:${PUERTO}`;

// `BS_SIN_ENV=1` evita que serve.mjs cargue .env.local; y se sueltan las
// variables de Supabase que pudiera traer el entorno del padre, porque el
// modo fichero es lo que hace reproducible la prueba: la cuenta que crea
// nace en data/ y se puede borrar sin daño. Es la misma decisión de la suite
// e2e (ver AGENTS.md): el 22 de octubre de 2026 hubo 61 cuentas de prueba en
// la base real por no hacerlo.
const env = { ...process.env, BS_SIN_ENV: '1' };
delete env.SUPABASE_URL;
delete env.SUPABASE_SERVICE_ROLE_KEY;

const servidor = spawn(process.execPath, [new URL('../serve.mjs', import.meta.url).pathname, String(PUERTO)], {
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
});

const erroresServidor = [];
servidor.stderr.on('data', (t) => {
  erroresServidor.push(t.toString());
  if (erroresServidor.length > 10) erroresServidor.shift();
});

/** El servidor está cuando `/api/config` contesta; no hay que adivinar tiempos. */
async function esperarServidor() {
  for (let i = 0; i < 100; i++) {
    if (servidor.exitCode !== null) return false;
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return true;
    } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const ARRANCA = await esperarServidor();

/**
 * La red de seguridad. La prueba se borra la cuenta ella misma al final del
 * ciclo (DELETE /api/cuenta); esto cubre el caso de que algo falle antes de
 * llegar ahí: la cuenta de prueba no puede quedarse en data/ sin que se sepa.
 */
async function limpiarCuenta() {
  try {
    const ruta = new URL('../data/usuarios.json', import.meta.url);
    const cuentas = JSON.parse(await readFile(ruta, 'utf8').catch(() => '{}'));
    if (!cuentas[CORREO]) return;
    delete cuentas[CORREO];
    await writeFile(ruta, JSON.stringify(cuentas, null, 1));

    // Las sesiones de esa cuenta, fuera también: sin la cuenta no valen nada.
    const rs = new URL('../data/sesiones.json', import.meta.url);
    const sesiones = JSON.parse(await readFile(rs, 'utf8').catch(() => '{}'));
    await writeFile(rs, JSON.stringify(
      Object.fromEntries(Object.entries(sesiones).filter(([, s]) => s.correo !== CORREO)),
      null, 1,
    ));
    console.log(`\n  (limpieza: ${CORREO} se quedó en data/usuarios.json por un fallo a mitad; quitada)`);
  } catch (err) {
    console.error(`\n  (limpieza: no se pudo revisar data/usuarios.json: ${err.message})`);
  }
}

try {
  // ── Lo que habla con el servidor ───────────────────────────────────────

  if (ARRANCA) {
    await prueba('las rutas retiradas contestan 404', async () => {
      const rAvisos = await fetch(`${BASE}/api/avisos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(rAvisos.status, 404, `POST /api/avisos respondió ${rAvisos.status}, no 404`);

      const rCron = await fetch(`${BASE}/api/cron-avisos`);
      assert.equal(rCron.status, 404, `GET /api/cron-avisos respondió ${rCron.status}, no 404`);
    });

    await prueba('/api/yo ya no trae avisos, y la cuenta del alta se va con la baja', async () => {
      const alta = await fetch(`${BASE}/api/registro`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: CLAVE }),
      });
      assert.equal(alta.status, 201, `el registro respondió ${alta.status}: ${await alta.text()}`);

      // La cookie de sesión: `getSetCookie()` donde existe, con el `get()`
      // de siempre de red. El primer trozo, antes del primer `;`, es el par
      // nombre=valor que la petición siguiente necesita.
      const cruda = alta.headers.getSetCookie?.()[0] ?? alta.headers.get('set-cookie') ?? '';
      const galleta = cruda.split(';')[0];
      assert.ok(galleta.startsWith('bs_sesion='), 'el registro no dio cookie de sesión');

      const yo = await fetch(`${BASE}/api/yo`, { headers: { cookie: galleta } });
      assert.equal(yo.status, 200, `/api/yo respondió ${yo.status} con sesión recién creada`);
      const quien = await yo.json();
      assert.ok(!('avisos' in quien), '/api/yo sigue trayendo la clave «avisos» que ya nadie lee');
      assert.equal(quien.correo, CORREO, '/api/yo no devolvió la cuenta recién creada');

      // La baja pide el correo escrito a mano en `confirmar`: es lo que la
      // ruta exige para una acción sin vuelta atrás.
      const baja = await fetch(`${BASE}/api/cuenta`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: galleta },
        body: JSON.stringify({ confirmar: CORREO }),
      });
      assert.equal(baja.status, 200, `el borrado respondió ${baja.status}: ${await baja.text()}`);

      const tras = await fetch(`${BASE}/api/yo`, { headers: { cookie: galleta } });
      assert.equal(tras.status, 401, `la sesión sigue viva tras borrar la cuenta (${tras.status})`);
    });
  } else {
    fallos++;
    console.error('  FALLA el servidor de pruebas no arrancó; las rutas no se pueden mirar');
    if (erroresServidor.length) {
      console.error(`       ${erroresServidor.join('').trimEnd().split('\n').join('\n       ')}`);
    }
  }

  // ── Lo que no necesita servidor ────────────────────────────────────────

  await prueba('el almacén no exporta nada de avisos', async () => {
    const store = await import('../lib/store.js');
    for (const nombre of ['cambiarAvisos', 'correosConAvisos', 'avisosEnviados', 'guardarAvisos']) {
      assert.ok(!(nombre in store), `lib/store.js sigue exportando ${nombre}`);
    }
  });

  await prueba('el diccionario y el front no conservan las claves muertas', async () => {
    for (const fichero of ['js/i18n.js', 'js/auth.js', 'js/cuenta.js', 'js/landing.js', 'js/becas.js']) {
      const texto = await readFile(new URL(`../${fichero}`, import.meta.url), 'utf8');
      for (const clave of ['cuenta.avisos', 'ajs-avisos', 'avisos-fila', 'avisosDePlazo']) {
        assert.ok(!texto.includes(clave), `${fichero} todavía menciona «${clave}»`);
      }
    }
  });

  await prueba('la infraestructura no deja ninguna puerta abierta', async () => {
    const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.ok(!('crons' in vercel), 'vercel.json declara crons: desplegaría un endpoint que ya no existe');

    for (const fichero of ['.gitignore', '.vercelignore']) {
      const texto = await readFile(new URL(`../${fichero}`, import.meta.url), 'utf8');
      assert.ok(!/avisos/i.test(texto), `${fichero} todavía menciona «avisos»`);
    }
  });

  await prueba('la etiqueta de analytics está en las ocho páginas y en la plantilla', async () => {
    for (const fichero of [...PAGINAS, 'ingest/paginas.mjs']) {
      const texto = await readFile(new URL(`../${fichero}`, import.meta.url), 'utf8');
      assert.ok(texto.includes(ETIQUETA_ANALYTICS), `${fichero} no lleva la etiqueta de Vercel Analytics`);
    }
  });

  await prueba('nadie vuelve a prometer que no hay analítica', async () => {
    for (const fichero of [...PAGINAS, 'js/i18n.js']) {
      const texto = await readFile(new URL(`../${fichero}`, import.meta.url), 'utf8');
      assert.ok(!/no hay analítica/i.test(texto), `${fichero} dice «no hay analítica»: la analítica existe y es agregada`);
      assert.ok(!/no analytics/i.test(texto), `${fichero} dice «no analytics»: la analítica existe y es agregada`);
    }
  });
} finally {
  servidor.kill();
  await limpiarCuenta();
}

console.log(`\n${hechos} comprobaciones sobre la retirada de los avisos.`);
if (fallos) {
  console.error(`  ${fallos} fallos.`);
  process.exit(1);
}
