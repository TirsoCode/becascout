/**
 * erasmus-paises.mjs — saca el país de cada programa de Erasmus Mundus.
 *
 * ── El problema ──────────────────────────────────────────────────────────
 *
 * El catálogo de EACEA (`www.eacea.ec.europa.eu/scholarships/erasmus-mundus-
 * catalogue_en`) lista los programas en tarjetas, y en la tarjeta **no viene
 * el país**: solo el título, la web del programa y el enlace a su ficha de
 * proyecto. Sin país, el filtro «Destino» del buscador no puede decir nada
 * de estos programas, y son de los únicos que no son de España.
 *
 * ── La salida ────────────────────────────────────────────────────────────
 *
 * El catálogo **sí** tiene un filtro por país, con los 77 países en un
 * `<select>` (`oe_project_locations_country[]`, con código ISO). Y filtrar
 * funciona: la URL con `?f[0]=oe_project_locations_country:FR` devuelve solo
 * los programas con Francia en el consorcio.
 *
 * La manera de quedarse con el país de cada programa es, entonces, la
 * inversa de lo habitual: en vez de mirar la ficha de cada programa —que
 * bloquea con «Sorry», una protección anti-bot—, se pregunta al catálogo
 * «¿qué programas hay en Francia?», «¿y en Alemania?», y se cruzan las
 * respuestas. Cada programa sale tantas veces como países tiene en el
 * consorcio, que es lo que hace falta: son tres o más.
 *
 * ── El coste, y por qué no se hace en cada pasada ────────────────────────
 *
 * Son 77 peticiones al catálogo, y cada una devuelve una página de veinte
 * programas. Es un minuto, más o menos. Es demasiado para una ingesta que
 * corre dos veces al día, y no hace falta: **los países de un programa no
 * cambian**. Se calculan una vez, se guardan en `data/paises-erasmus.json`
 * y la ingesta los lee de ahí.
 *
 * El fichero se regenera a mano cuando el catálogo cambia:
 *
 *   node ingest/erasmus-paises.mjs
 *
 * ── Lo que no se hace ────────────────────────────────────────────────────
 *
 * No se cruza con el nombre del programa para adivinar el país. El nombre
 * dice «Law and Gender» y el país es Serbia; el título no lo dice nunca, y
 * un programa de consorcios puede tener a España y no estar en la web del
 * país. El país sale del catálogo o no sale.
 */

import { readFile, writeFile } from 'node:fs/promises';

const CATALOGO = 'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SALIDA = new URL('../data/paises-erasmus.json', import.meta.url);

/**
 * Las cabeceras de un navegador.
 *
 * Sin ellas el catálogo contesta con una página de «Sorry» —su protección
 * anti-bot— en vez de la lista. Con `curl` a pelo salía una de las dos
 * cosas según el día, y por eso el conector parece funcionar y a la vez no.
 */
const CABECERAS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

/** Una petición al catálogo, con su cookie de sesión. */
async function pedir(url, cookie) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { ...CABECERAS, ...(cookie ? { cookie } : {}) },
    });
    const setCookie = res.headers.get('set-cookie');
    return { html: await res.text(), setCookie };
  } catch {
    return { html: '', setCookie: null };
  } finally {
    clearTimeout(t);
  }
}

/** Los ids de los programas de una página de resultados. */
function idsDe(html) {
  const tarjetas = html.match(/<article\s+class="ecl-card"[\s\S]*?<\/article>/g) ?? [];
  const salida = [];
  for (const t of tarjetas) {
    const titulo = /ecl-link__label[^>]*>([^<]{6,180})</.exec(t)?.[1]?.trim();
    const proyecto = /href="(https:\/\/erasmus-plus\.ec\.europa\.eu\/projects\/search\/details\/\d+)"/.exec(t)?.[1] ?? null;
    const web = /<a\s+href="(https?:\/\/(?!erasmus-plus\.ec)[^"]+)"[^>]*>\s*<span\s+class="ecl-link__label"/.exec(t)?.[1] ?? null;
    if (!titulo) continue;
    salida.push({ titulo, proyecto, web });
  }
  return salida;
}

/** Los códigos de país del `<select>` del catálogo. */
function paisesDisponibles(html) {
  const m = /<select[^>]*name="oe_project_locations_country\[\]"[\s\S]*?<\/select>/.exec(html);
  if (!m) return [];
  const opciones = m[0].match(/<option[^>]*value="([A-Z]{2})"/g) ?? [];
  return opciones.map((o) => /value="([A-Z]{2})"/.exec(o)?.[1]).filter(Boolean);
}

async function main() {
  console.log('  Leyendo el catálogo de EACEA…');
  const primera = await pedir(CATALOGO, null);
  if (!primera.html.length) {
    console.error('  El catálogo no ha contestado. No se toca el fichero.');
    process.exit(1);
  }

  const paises = paisesDisponibles(primera.html);
  if (!paises.length) {
    console.error('  No se ha encontrado el filtro de países. No se toca el fichero.');
    process.exit(1);
  }
  console.log(`  ${paises.length} países en el catálogo.`);

  // El mapa: id del programa → países en los que aparece.
  const mapa = new Map();
  let peticiones = 0;

  for (const cod of paises) {
    // El catálogo pagina: veinte programas por página y hasta once páginas
    // en total. Con solo la primera se perdían 42 de los 218 programas, y
    // el programario de un país grande —que es el que más páginas tiene—
    // es justo el que se queda a medias.
    for (let pagina = 0; pagina < 12; pagina++) {
      const sufijo = pagina === 0 ? '' : `&page=${pagina}`;
      const url = `${CATALOGO}?f%5B0%5D=oe_project_locations_country%3A${cod}${sufijo}`;
      const res = await pedir(url, primera.setCookie);
      peticiones++;
      if (!res.html.length) break;

      const programas = idsDe(res.html);
      if (!programas.length) break;      // última página

      for (const p of programas) {
        // La clave es el id del proyecto, que es único y estable. El título
        // podría repetirse entre dos consorcios.
        const clave = p.proyecto?.split('/').pop() ?? p.titulo;
        if (!mapa.has(clave)) {
          mapa.set(clave, { titulo: p.titulo, proyecto: p.proyecto, web: p.web, paises: [] });
        }
        const v = mapa.get(clave);
        // Un programa puede salir en varias páginas del mismo país: el
        // mismo país se añade una vez, que para lo que sirve es lo mismo.
        if (!v.paises.includes(cod)) v.paises.push(cod);
      }
      // Menos de veinte: última página de ese país.
      if (programas.length < 20) break;
    }
    process.stdout.write(`\r  ${cod}: ${mapa.size} programas   `);
  }
  process.stdout.write('\n');

  const salida = [...mapa.entries()].map(([id, v]) => ({ id, ...v }));
  const conPaises = salida.filter((s) => s.paises.length).length;

  await writeFile(SALIDA, JSON.stringify({
    generado: new Date().toISOString(),
    total: salida.length,
    programas: salida,
  }, null, 1));

  console.log(`  ${salida.length} programas · ${conPaises} con país · ${peticiones} peticiones`);
  console.log(`  → data/paises-erasmus.json`);

  // Un programa sin país es un programa que no se puede filtrar. Si son
  // muchos, algo ha ido mal y el fichero no sirve.
  if (salida.length && conPaises / salida.length < 0.5) {
    console.error('\n  Menos de la mitad de los programas tiene país. Revisa el catálogo.');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
