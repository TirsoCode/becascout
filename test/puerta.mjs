/**
 * test/puerta.mjs — La puerta de las becas, comprobada donde de verdad se
 * cierra: en la red.
 *
 * ── Por qué esto existe ──────────────────────────────────────────────────
 *
 * El 30 de octubre de 2026 la auditoría abrió un `curl` y se llevó
 * `data/becas.json` entero sin cuenta: 236 convocatorias con sus requisitos y
 * sus citas. El velo de la web tapaba la lista, pero el dato estaba en un
 * fichero público, así que la cuenta no protegía nada.
 *
 * La solución parte el fichero en dos: el catálogo público
 * (`data/becas-catalogo.json`) y la base completa, que solo sirve
 * `/api/becas` con sesión. Esta prueba vigila las dos mitades:
 *
 *   · el catálogo se sirve y **no** lleva requisitos ni citas;
 *   · `/api/becas` sin cookie contesta 401 y no deja cachear la respuesta;
 *   · con cookie contesta 200 y los requisitos siguen teniendo su cita;
 *   · el login no acepta un correo que no es un correo ni una contraseña
 *     gigante, que era la forma de hacer trabajar a scrypt de balde;
 *   · cerrar todas las sesiones las mata de verdad, no solo la del navegador
 *     desde el que se pulsa.
 *
 * Corre contra `serve.mjs` en modo fichero (`BS_SIN_ENV=1`), así que la
 * cuenta de prueba nace en `data/` y se borra al final. Nunca toca Supabase.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';

/** Un puerto libre, para no chocar con otra prueba ni con un Chrome colgado. */
async function puertoLibre(desde) {
  for (let p = desde; p < desde + 40; p++) {
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

const CORREO = 'prueba-puerta@ejemplo.test';
const CLAVE = 'contraseña-de-prueba';   // ≥ 10: lo que exige la ruta

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

const PUERTO = await puertoLibre(5191);
const BASE = `http://127.0.0.1:${PUERTO}`;

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
 * La red de seguridad: si algo falla antes del borrado normal, la cuenta no
 * puede quedarse en `data/usuarios.json` sin que nadie lo sepa.
 */
async function limpiarCuenta() {
  try {
    const ruta = new URL('../data/usuarios.json', import.meta.url);
    const cuentas = JSON.parse(await readFile(ruta, 'utf8').catch(() => '{}'));
    if (!cuentas[CORREO]) return;
    delete cuentas[CORREO];
    await writeFile(ruta, JSON.stringify(cuentas, null, 1));

    const rs = new URL('../data/sesiones.json', import.meta.url);
    const sesiones = JSON.parse(await readFile(rs, 'utf8').catch(() => '{}'));
    await writeFile(rs, JSON.stringify(
      Object.fromEntries(Object.entries(sesiones).filter(([, s]) => s.correo !== CORREO)),
      null, 1,
    ));
    console.log(`\n  (limpieza: ${CORREO} se quedó en data/usuarios.json; quitada)`);
  } catch (err) {
    console.error(`\n  (limpieza: no se pudo revisar data/usuarios.json: ${err.message})`);
  }
}

/** El par `nombre=valor` de una respuesta, que es lo que se manda de vuelta. */
function galleta(res) {
  const cruda = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
  return cruda.split(';')[0];
}

try {
  if (!ARRANCA) {
    fallos++;
    console.error('  FALLA el servidor de pruebas no arrancó; la puerta no se puede mirar');
    if (erroresServidor.length) {
      console.error(`       ${erroresServidor.join('').trimEnd().split('\n').join('\n       ')}`);
    }
  } else {
    await prueba('el catálogo público se sirve y no lleva requisitos ni citas', async () => {
      const r = await fetch(`${BASE}/data/becas-catalogo.json`);
      assert.equal(r.status, 200, `el catálogo respondió ${r.status}`);
      const d = await r.json();
      assert.ok(Array.isArray(d.becas) && d.becas.length > 0, 'el catálogo está vacío');

      const conRequisitos = d.becas.filter((b) => (b.requisitos ?? []).length);
      assert.equal(conRequisitos.length, 0, `${conRequisitos.length} fichas del catálogo llevan requisitos`);

      const conCita = d.becas.filter((b) => JSON.stringify(b).includes('"cita"'));
      assert.equal(conCita.length, 0, `${conCita.length} fichas del catálogo llevan una cita`);

      assert.ok(d.becas.some((b) => b.n_requisitos > 0), 'el catálogo no dice cuántos requisitos hay');
      assert.ok(d.becas.every((b) => b.oculto === true), 'una ficha del catálogo no está marcada como oculta');
    });

    await prueba('la base completa no se sirve por URL', async () => {
      const r = await fetch(`${BASE}/data/becas.json`);
      assert.equal(r.status, 404, `/data/becas.json respondió ${r.status}, no 404`);
    });

    await prueba('/api/becas sin sesión contesta 401 y no se cachea', async () => {
      const r = await fetch(`${BASE}/api/becas`);
      assert.equal(r.status, 401, `/api/becas respondió ${r.status} sin cookie`);
      assert.match(String(r.headers.get('cache-control')), /no-store/, 'la respuesta se puede cachear');
      assert.match(String(r.headers.get('vary')).toLowerCase(), /cookie/, 'la respuesta no varía por cookie');
      const d = await r.json();
      assert.ok(!Array.isArray(d.becas), 'sin sesión ha devuelto la base');
    });

    await prueba('el alta da una cookie HttpOnly y SameSite=Lax', async () => {
      const r = await fetch(`${BASE}/api/registro`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: CLAVE }),
      });
      assert.equal(r.status, 201, `el registro respondió ${r.status}: ${await r.text()}`);

      const cruda = r.headers.getSetCookie?.()[0] ?? r.headers.get('set-cookie') ?? '';
      assert.match(cruda, /HttpOnly/i, 'la cookie no es HttpOnly');
      assert.match(cruda, /SameSite=Lax/i, 'la cookie no es SameSite=Lax');
      assert.ok(galleta(r).startsWith('bs_sesion='), 'la cookie local no se llama bs_sesion');
    });

    await prueba('con sesión, /api/becas trae los requisitos con su cita', async () => {
      const alta = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: CLAVE }),
      });
      assert.equal(alta.status, 200, `el login respondió ${alta.status}: ${await alta.text()}`);
      const cookie = galleta(alta);

      const r = await fetch(`${BASE}/api/becas`, { headers: { cookie } });
      assert.equal(r.status, 200, `/api/becas respondió ${r.status} con sesión`);
      const d = await r.json();
      assert.ok(Array.isArray(d.becas) && d.becas.length > 0, 'la base completa está vacía');

      const reqs = d.becas.flatMap((b) => b.requisitos ?? []);
      assert.ok(reqs.length > 0, 'la base completa no trae ningún requisito');
      const sinCita = reqs.filter((x) => !String(x.cita ?? '').trim());
      assert.equal(sinCita.length, 0, `${sinCita.length} requisitos de la base completa no tienen cita`);
    });

    await prueba('el login no trabaja con un correo inválido ni con una contraseña gigante', async () => {
      const malo = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: 'esto no es un correo', password: CLAVE }),
      });
      assert.equal(malo.status, 401, `un correo inválido respondió ${malo.status}, no 401`);

      const largo = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: 'x'.repeat(4096) }),
      });
      assert.equal(largo.status, 401, `una contraseña gigante respondió ${largo.status}, no 401`);
    });

    await prueba('cerrar todas las sesiones mata también la que se usó para pedirlo', async () => {
      const uno = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: CLAVE }),
      });
      const dos = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: CLAVE }),
      });
      const c1 = galleta(uno);
      const c2 = galleta(dos);

      const cierra = await fetch(`${BASE}/api/sesiones`, {
        method: 'DELETE',
        headers: { cookie: c1 },
      });
      assert.equal(cierra.status, 200, `cerrar sesiones respondió ${cierra.status}: ${await cierra.text()}`);

      for (const [nombre, cookie] of [['la primera', c1], ['la segunda', c2]]) {
        const r = await fetch(`${BASE}/api/yo`, { headers: { cookie } });
        assert.equal(r.status, 401, `${nombre} sigue viva tras cerrar todas (${r.status})`);
      }
    });

    await prueba('la cuenta de prueba se va con su baja', async () => {
      const alta = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ correo: CORREO, password: CLAVE }),
      });
      const cookie = galleta(alta);
      const baja = await fetch(`${BASE}/api/cuenta`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ confirmar: CORREO }),
      });
      assert.equal(baja.status, 200, `la baja respondió ${baja.status}: ${await baja.text()}`);
    });
  }
} finally {
  servidor.kill('SIGTERM');
  await limpiarCuenta();
}

console.log(`\n${hechos} pruebas de la puerta de las becas.\n`);
if (fallos) {
  console.error(`${fallos} fallaron.\n`);
  process.exit(1);
}
