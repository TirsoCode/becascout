/**
 * daad.mjs — Conector de la base de datos de becas de DAAD (Alemania).
 *
 * ── De dónde sale ─────────────────────────────────────────────────────────
 *
 * DAAD es la agencia alemana de intercambio, y su base de datos de becas es
 * el catálogo oficial de lo que se puede pedir para estudiar o investigar en
 * Alemania:
 *
 *   https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/
 *
 * ── El problema: no se puede bajar con `fetch` ───────────────────────────
 *
 * `www2.daad.de` contesta **403 «Request forbidden by administrative rules»**
 * a cualquier petición que no venga de un navegador de verdad. Se probó
 * con `curl` y con cabeceras completas de Chrome y siempre lo mismo: no es
 * el User-Agent, es la huella de TLS. Un WAF que lee la huella descarta
 * cualquier cliente que no sea un navegador.
 *
 * Por eso este conector usa Chrome, como el de BDNS. La diferencia es que
 * aquí **no hay nada más**: no hay WAF ni SPA, solo un `fetch` que no pasa.
 * Y el coste es de unos seis segundos por página, que es lo que hace que
 * solo se bajen las páginas del listado y no las fichas una a una.
 *
 * ── Qué se guarda y de dónde sale ─────────────────────────────────────────
 *
 * El listado trae, por programa: el título, el **nivel** (undergraduates,
 * graduates, doctoral candidates, postdocs…) y el **país** de destino. Todo
 * eso es metadato estructurado de DAAD, y la cita es el enlace a la ficha
 * del programa, que es donde el estudiante tiene que ir igualmente.
 *
 * El importe y el plazo **no se guardan de aquí**: están en la ficha
 * individual de cada programa, y bajarla sería una petición por programa.
 * Es un coste que no compensa en una ingesta que corre dos veces al día: el
 * dato del plazo y del importe sale mejor y más citable del BOE y de la
 * Comisión.
 *
 * ── El destino ───────────────────────────────────────────────────────────
 *
 * Casi todos los programas de DAAD son para estudiar **en Alemania**, y
 * por eso el destino por defecto es `DE`. Los que son para otro sitio lo
 * dicen en su ficha («Scholarship Value», «Target Group» o el propio
 * título), y esos se detectan por el nombre del país en el texto de la
 * tarjeta.
 *
 * La lista de países de la tarjeta de DAAD es «de dónde vienes», no «a
 * dónde vas»: «Only specified» significa «solo para ciertos solicitantes».
 * Confundir las dos cosas pondría a un estudiante de India
 * buscando una beca para estudiar en India. Por eso el destino no se saca
 * de ahí.
 */

import { render } from './bdns.mjs';
import { codigosEn } from '../js/paises.js';

const BASE = 'https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/';

/**
 * Las tarjetas del listado.
 *
 * El listado trae los 148 programas en una sola página, y cada uno es un
 * `<li class="entry">` con el título en un `<h2>` y el nivel y el país en
 * un `<dl>`.
 */
export function programas(html) {
  const entradas = html.match(/<li class="entry clearfix">[\s\S]*?<\/li>/g) ?? [];
  const salida = [];

  for (const e of entradas) {
    // El id del programa va en el enlace: `…&detail=10000092`. Es lo que
    // hace única la ficha y lo que permite enlazarla.
    const detalle = /detail=(\d+)/.exec(e)?.[1] ?? null;

    // El título, en el `<h2><a>`.
    //
    // El `&nbsp;` que DAAD pone al final del título se quita: se queda
    // pegado al texto y en la web sale como «…&nbsp;» si no se limpia.
    const titulo = /<h2><a[^>]*>([^<]{6,200})/.exec(e)?.[1]
      ?.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!titulo) continue;

    // El nivel: va en el `<dt>Status:</dt><dd>…</dd>`.
    const nivel = /Status:<\/dt><dd>([^<]{3,120})/.exec(e)?.[1]
      ?.replace(/&nbsp;/g, ' ').trim() ?? null;

    // El país de solicitantes: «Country: Only specified». **No** es el
    // destino, y no se usa como tal.
    const paisSolicitantes = /Country:<\/dt><dd>([^<]{3,120})/.exec(e)?.[1]
      ?.replace(/&nbsp;/g, ' ').trim() ?? null;

    const descripcion = /entry-detail">([\s\S]{0,600}?)<\/p>/.exec(e)?.[1]
      ?.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() ?? null;

    salida.push({
      id: detalle,
      titulo,
      nivel,
      paisSolicitantes,
      descripcion,
      url: detalle ? `${BASE}?lang=en&sd=1&detail=${detalle}` : BASE,
    });
  }
  return salida;
}

/**
 * Traduce el nivel de DAAD a los tres del buscador.
 *
 * Devuelve `null` cuando no se sabe: es mejor no saber el nivel que
 * ponerlo mal, porque un filtro por nivel que miente esconde becas.
 *
 * ── «Graduates» no es «grado» ───────────────────────────────────────────
 *
 * En DAAD, «Graduates» quiere decir **quien ya tiene un título** y viene
 * a hacer un posgrado o un máster. No es «undergraduates», que es quien
 * está en su carrera. Traducirlo a «Grado» mandaba a un estudiante de
 * posgrado al filtro equivocado, y le escondía el programa.
 *
 * Por eso el orden de las comprobaciones es el inverso al de las palabras:
 * primero lo que excluye a los demás.
 */
export function nivelDe(texto) {
  if (!texto) return null;
  const t = texto.toLowerCase().replace(/\s+/g, ' ').trim();

  // Doctorado: lo más específico, y va primero porque en DAAD el nivel
  // puede traer varias cosas a la vez («Doctoral candidates, Postdoctoral
  // researchers»).
  if (/postdoctoral|post-doctoral|phd|doctoral/.test(t)) return 'Doctorado';

  // Máster y posgrado. En DAAD, «graduates» es quien ya tiene un título.
  if (/master|graduate/.test(t)) return 'Máster';

  // Grado: quien está en su carrera.
  if (/undergraduate|bachelor/.test(t)) return 'Grado';

  return null;
}

/**
 * El destino del programa.
 *
 * DAAD es Alemania, y eso es lo que se guarda por defecto. Pero hay
 * programas que no son para estudiar en Alemania sino para un país
 * concreto —el de la China Scholarship Council, por ejemplo—, y en la
 * tarjeta se ve en el título y en la descripción.
 *
 * Si en el texto aparece un país **distinto** de Alemania, ese es el
 * destino: el programa lleva ese nombre en voz alta. Si no, Alemania.
 */
function destinoDe(titulo, descripcion) {
  const texto = `${titulo ?? ''} ${descripcion ?? ''}`;
  const paises = codigosEn(texto).filter((c) => c !== 'DE');
  if (paises.length) return paises;
  return ['DE'];
}

/**
 * Trae el listado completo de programas.
 *
 * Solo el listado: 148 programas en una página. Las fichas individuales se
 * dejan para cuando haga falta una cita que no esté en el listado.
 */
export async function recolectar({ alProgresar } = {}) {
  let html = '';
  try {
    html = await render(BASE);
  } catch {
    // DAAD no contesta: se avisa y se sigue sin él. Un portal caído no
    // puede tumbar la ingesta entera.
    console.warn('  DAAD no ha contestado; se sigue sin el.');
    return [];
  }

  if (!html.length || /Request forbidden/i.test(html)) {
    console.warn('  DAAD ha contestado con un bloqueo; se sigue sin él.');
    return [];
  }

  const lista = programas(html);
  alProgresar?.({ fase: 'daad', total: lista.length });

  return lista.map((p) => {
    const nivel = nivelDe(p.nivel);
    const destinos = destinoDe(p.titulo, p.descripcion);

    const requisitos = [];

    // El nivel, con su cita: el texto de DAAD es la cita y el nivel
    // traducido es el valor.
    if (nivel && p.nivel) {
      requisitos.push({
        tipo: 'titulacion',
        etiqueta: 'Nivel al que se puede pedir',
        valor: nivel,
        cita: `Status: ${p.nivel}`,
        obligatorio: true,
        extractor: 'oficial',
      });
    }

    return {
      id: `DAAD-${p.id ?? p.titulo.slice(0, 20)}`,
      titulo: p.titulo,
      organizador: 'DAAD (Agencia Alemana de Intercambio Académico)',
      ambito: 'europeo',
      fuente: 'daad',
      paises: destinos,
      nivel,
      presupuesto: null,
      requisitos,
      url: p.url,
      url_oficial: p.url,
      cierra: null,      // cada programa tiene el suyo, en su ficha
      pagina: null,
    };
  });
}
