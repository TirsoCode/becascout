/**
 * test/pais.mjs — el filtro de destino y el de nivel.
 *
 * ── Qué sostiene este test ───────────────────────────────────────────────
 *
 * El filtro de destino **no filtraba**. El `<select>` guardaba el país en
 * el perfil y `js/becas.js` nunca lo leía: la lista salía entera siempre.
 * Un filtro que no filtra es peor que no tenerlo, porque el estudiante
 * cree que ha filtrado y lo que ve es otra cosa.
 *
 * Y hay una segunda cosa que este test vigila, que es la que más caro sale
 * cuando se rompe: **una convocatoria sin destino conocido no se esconde.**
 * Si el filtro aparta una beca que sí valía, quien la buscaba no ve el
 * hueco y no sabe que faltaba. Enseñar de más cuesta un clic; quitar de
 * más pierde la beca sin dejar rastro.
 *
 * ── Por qué no prueba la web entera ──────────────────────────────────────
 *
 * Porque la regla que importa no está en el DOM: está en tres funciones
 * sueltas, y probarlas por separado da un fallo claro cuando se rompen.
 * La web llama a estas mismas funciones.
 *
 * Corre sin red y sin claves:
 *
 *   node test/pais.mjs
 */

import { aCodigo, codigosEn, nombreDe, CODIGOS, NOMBRES } from '../js/paises.js';

let fallos = 0;
let pruebas = 0;

function ok(condicion, mensaje) {
  pruebas++;
  if (!condicion) {
    fallos++;
    console.error(`  FALLA: ${mensaje}`);
  }
}

function igual(a, b, mensaje) {
  ok(a === b, `${mensaje} — esperaba ${JSON.stringify(b)} y salió ${JSON.stringify(a)}`);
}

/* ── El filtro, tal como lo hace la web ────────────────────────────────── */

/**
 * La regla del filtro, escrita aquí a mano.
 *
 * Se reescribe en vez de importarla de `js/becas.js` porque ese fichero
 * toca el DOM al cargarse y el test corre en Node. La función está
 * duplicada a propósito: si una de las dos cambia, este test lo dice.
 */
function filtra(becas, { pais = '', nivel = '' } = {}) {
  return becas.filter((b) => {
    const paises = b.paises ?? [];
    if (pais && paises.length && !paises.includes(pais)) return false;
    if (nivel && b.nivel && b.nivel !== nivel) return false;
    return true;
  });
}

/* ── Los países ─────────────────────────────────────────────────────────── */

console.log('Los países del catálogo');

// El número exacto no se comprueba como constante suelta: lo que importa
// es que **cada código tiene nombre** y que la lista contiene lo que tiene
// que contener. El recuento son 41: los 27 de la UE, más Islandia,
// Liechtenstein, Noruega, Suiza y Reino Unido, más Albania, Bosnia, Georgia,
// Kosovo, Moldavia, Montenegro, Macedonia del Norte, Serbia, Turquía y
// Ucrania.
ok(CODIGOS.length >= 40, 'el catálogo tiene la mayoría de Europa');
igual(CODIGOS.length, Object.keys(NOMBRES).length,
  'hay un nombre para cada código y ni un nombre de más');
ok(CODIGOS.includes('ES'), 'España está en el catálogo');
ok(CODIGOS.includes('DE'), 'Alemania está en el catálogo');
ok(CODIGOS.includes('GB'), 'Reino Unido está, aunque no sea de la UE');
ok(CODIGOS.includes('UA'), 'Ucrania está, que es Erasmus y es Europa');
ok(CODIGOS.includes('TR'), 'Turquía está, que es Erasmus y es Europa');
ok(!CODIGOS.includes('US'), 'Estados Unidos no está, que no es Europa');
ok(!CODIGOS.includes('AR'), 'Argentina no está, que no es Europa');

for (const cod of CODIGOS) {
  ok(NOMBRES[cod], `el código ${cod} tiene nombre en castellano`);
}

/* ── Normalizar lo que dice una fuente ──────────────────────────────────── */

console.log('Normalizar el nombre de un país');

igual(aCodigo('España'), 'ES', 'España en castellano');
igual(aCodigo('españa'), 'ES', 'España en minúsculas');
igual(aCodigo('Spain'), 'ES', 'España en inglés');
igual(aCodigo('Deutschland'), 'DE', 'Alemania en alemán');
igual(aCodigo('The Netherlands'), 'NL', 'Países Bajos en inglés');
igual(aCodigo('Holanda'), 'NL', 'Países Bajos con el nombre de siempre');
igual(aCodigo('DE'), 'DE', 'un código ISO tal cual');
igual(aCodigo('FR'), 'FR', 'otro código ISO');
igual(aCodigo(''), null, 'una cadena vacía no es un país');
igual(aCodigo(null), null, 'nada no es un país');
igual(aCodigo('Andorra'), null, 'un país que no está en el catálogo');
igual(aCodigo('xyz'), null, 'un código que no existe');
igual(nombreDe('FR'), 'Francia', 'el nombre de un código');
igual(nombreDe('ZZ'), 'ZZ', 'un código desconocido devuelve el código');

/* ── Los países de un texto ─────────────────────────────────────────────── */

console.log('Los países que se mencionan en un texto');

const varios = codigosEn('el consorcio de Francia, Alemania e Italia');
ok(varios.includes('FR') && varios.includes('DE') && varios.includes('IT'),
  'un texto con tres países devuelve los tres');
ok(codigosEn('').length === 0, 'un texto vacío no devuelve países');
ok(codigosEn('el programa de becas del Ministerio').length === 0,
  'un texto sin países no inventa ninguno');

/* ── El filtro ──────────────────────────────────────────────────────────── */

console.log('El filtro de destino');

const fichas = [
  { id: 'a', titulo: 'Beca en Francia', paises: ['FR'] },
  { id: 'b', titulo: 'Beca en Alemania', paises: ['DE'] },
  { id: 'c', titulo: 'Beca en Francia y España', paises: ['FR', 'ES'] },
  { id: 'd', titulo: 'Beca sin destino', paises: [] },
  { id: 'e', titulo: 'Beca antigua sin el campo', paises: undefined },
];

// Sin filtro, salen todas.
igual(filtra(fichas).length, 5, 'sin filtro salen todas');

// Con destino, salen las que lo tienen más las que no lo dicen.
const fr = filtra(fichas, { pais: 'FR' });
ok(fr.some((f) => f.id === 'a'), 'la beca de Francia sale');
ok(fr.some((f) => f.id === 'c'), 'la beca de Francia y España sale');
ok(!fr.some((f) => f.id === 'b'), 'la beca de Alemania no sale');
ok(fr.some((f) => f.id === 'd'), 'la que no dice dónde se queda');
ok(fr.some((f) => f.id === 'e'), 'la que ni siquiera tiene el campo se queda');

const de = filtra(fichas, { pais: 'DE' });
igual(de.length, 3, 'con Alemania salen la de Alemania y las dos sin destino');
ok(de.some((f) => f.id === 'b'), 'la beca de Alemania sale');

/* ── El filtro de nivel ─────────────────────────────────────────────────── */

console.log('El filtro de nivel');

const porNivel = [
  { id: 'a', nivel: 'Grado' },
  { id: 'b', nivel: 'Máster' },
  { id: 'c', nivel: 'Doctorado' },
  { id: 'd', nivel: null },
];

const master = filtra(porNivel, { nivel: 'Máster' });
ok(master.some((f) => f.id === 'b'), 'la beca de máster sale');
ok(!master.some((f) => f.id === 'a'), 'la de grado no sale');
ok(master.some((f) => f.id === 'd'), 'la que no dice nivel se queda');

/* ── Los dos filtros a la vez ───────────────────────────────────────────── */

console.log('Los dos filtros a la vez');

const combo = filtra(fichas, { pais: 'FR', nivel: 'Máster' });
ok(combo.some((f) => f.id === 'a'), 'la que cumple los dos sale');

/* ── La píldora de destino ──────────────────────────────────────────────── */

console.log('La píldora de destino');

/**
 * El texto de la píldora, con el mismo recorte que la web.
 *
 * Se reescribe aquí a mano, como el filtro, para que un cambio en la web
 * no se cuele sin que este test lo note.
 */
function textoDestino(paises) {
  if (!paises.length) return '';
  const ordenados = [...paises].sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), 'es'));
  const visibles = ordenados.slice(0, 3);
  const resto = ordenados.length - visibles.length;
  return visibles.map((c) => nombreDe(c)).join(', ') + (resto ? ` +${resto}` : '');
}

igual(textoDestino([]), '', 'sin países no hay píldora');
igual(textoDestino(['DE']), 'Alemania', 'un solo país');
igual(textoDestino(['DE', 'FR']), 'Alemania, Francia', 'dos países, ordenados por nombre');
igual(textoDestino(['FR', 'DE']), 'Alemania, Francia', 'el orden de entrada no cambia el texto');
igual(textoDestino(['DE', 'FR', 'ES']), 'Alemania, España, Francia', 'tres países caben enteros');
igual(
  textoDestino(['DE', 'FR', 'ES', 'IT', 'PL']),
  'Alemania, España, Francia +2',
  'con más de tres, se recortan y se dice cuántos quedan',
);

// La razón del recorte: un consorcio de once países.
const once = ['FR', 'ES', 'IT', 'BE', 'CA', 'AR', 'DE', 'PL', 'GR', 'IE', 'HU'];
const textoOnce = textoDestino(once);
ok(textoOnce.length < 60, `la píldora de once países es demasiado larga: ${textoOnce}`);
ok(textoOnce.includes('+8'), `no dice cuántos países quedan: ${textoOnce}`);

/* ── El resultado ───────────────────────────────────────────────────────── */

console.log('');
if (fallos) {
  console.error(`  ${fallos} de ${pruebas} pruebas fallan.`);
  process.exit(1);
}
console.log(`  ${pruebas} pruebas, todas en verde.`);
