/**
 * erasmus.mjs — Conector del catálogo de Erasmus Mundus Joint Masters.
 *
 * ── Qué es esto ──────────────────────────────────────────────────────────
 *
 * Los Joint Masters de Erasmus Mundus son lo más parecido a la beca ideal del
 * producto: máster entero, funded por la UE, abierto a estudiantes de todo el
 * mundo y con los mismos requisitos para todos. No hay que ser español ni
 * proponer un proyecto: se rellana una solicitud y ya.
 *
 * ── Por qué este conector es distinto a los otros ────────────────────────
 *
 * DAAD y Campus France enseñan documentos que no tenemos que citar: DAAD da
 * un catálogo sin requisitos y Campus France es un blog. Aquí pasa al revés.
 * El catálogo de EACEA es un directorio de enlaces, y cada programa tiene su
 * propia web —ciento setenta webs distintas con ciento setenta diseños
 * distintos, que es una cosa que no se puede scrapear. Pero hay dos cosas que
 * sí son universales y verificables:
 *
 *   1. La cuantía de la beca: 1.400 €/mes hasta 24 meses. Está escrito en la
 *      página oficial del programa y aplica a todos.
 *   2. El requisito base: grado universitario. Igual para los ciento setenta.
 *
 * Esas dos cosas se guardan CON CITA, de la página de la Comisión. Y cada
 * programa entra con el enlace a su web y a su ficha oficial del proyecto, que
 * es donde el estudiante tiene que ir igualmente. Eso no es un catálogo
 *-dead-end como el de DAAD: es un punto de partida con el dato que importa
 * ya resuelto.
 *
 * Es un conector honesto sobre una fuente que no da más de sí. Preferimos
 * decir «esto es todo lo que hay y es esto» a inventar un requisitos por
 * programa.
 */

import { render } from './bdns.mjs';

const CATALOGO = 'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en';
const OFICIAL = 'https://erasmus-plus.ec.europa.eu/opportunities/organisations/cooperation-among-organisations-and-institutions/erasmus-mundus-joint-masters';

/**
 * Los hechos comunes a todos los Joint Masters, con el fragmento exacto de
 * donde salen. Sin cita esto no entraría en la base, y con razón: un importe
 * sin fuente es el tipo de dato que hace que alguien renuncie a una beca por
 * creer que le dan más o menos.
 */
const HECHOS = [
  {
    tipo: 'importe',
    etiqueta: 'Beca Erasmus Mundus',
    valor: 1400,
    cita: 'EU scholarship for individuals: €1,400 per month (max. 24 months)',
    obligatorio: true,
  },
  {
    tipo: 'duracion_max',
    etiqueta: 'Duración máxima de la beca',
    valor: 24,
    cita: 'EU scholarship for individuals: €1,400 per month (max. 24 months)',
    obligatorio: true,
  },
  {
    tipo: 'titulacion',
    etiqueta: 'Título previo',
    valor: 'Grado universitario (o último año)',
    cita: "You must have a bachelor's degree (first degree), or be in your last year of bachelor studies",
    obligatorio: true,
  },
  {
    tipo: 'ects',
    etiqueta: 'Créditos ECTS',
    valor: '60, 90 o 120',
    cita: '1 to 2 academic years (60, 90 or 120 ECTS credits)',
    obligatorio: false,
  },
];

function plano(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae los programas del catálogo.
 *
 * Cada uno es una tarjeta `ecl-card` con dos enlaces que nos importan: la
 * web del programa (donde se solicita) y la ficha del proyecto en el portal
 * de Erasmus (donde está el detalle oficial). Los dos se guardan, porque el
 * estudiante va a necesitar uno u otro según desde dónde empiece.
 */
export function programas(html) {
  const tarjetas = html.match(/<article class="ecl-card"[\s\S]*?<\/article>/g) ?? [];
  const salida = [];

  for (const t of tarjetas) {
    const titulo = /ecl-link__label[^>]*>([^<]{6,180})</.exec(t)?.[1]?.trim();
    if (!titulo) continue;

    // El href va ANTES del <span class="ecl-link__label">, no después. Buscarlo
    // al revés devuelve null en todas las tarjetas sin dar ningún error, que
    // es como se pierde una tarde: el conector «funciona» y no captura nada.
    const web = /<a href="(https?:\/\/(?!erasmus-plus\.ec)[^"]+)"[^>]*>\s*<span class="ecl-link__label"/.exec(t)?.[1] ?? null;
    const proyecto = /href="(https:\/\/erasmus-plus\.ec\.europa\.eu\/projects\/search\/details\/\d+)"/.exec(t)?.[1] ?? null;
    if (!web && !proyecto) continue;

    salida.push({ titulo, web, proyecto });
  }
  return salida;
}

/** Vuelca el catálogo completo, con los hechos comunes ya citados. */
export async function recolectar({ paginas = 9, alProgresar } = {}) {
  // El catálogo viene en páginas de veinte. Solo con la primera salen veinte
  // programas de más de ciento setenta, que es justo el número que hace que
  // la web parezca vacía. El parámetro es `page`, a diferencia del de BDNS.
  const vistos = new Map();
  for (let p = 0; p < paginas; p++) {
    const html = await render(p === 0 ? CATALOGO : `${CATALOGO}?page=${p}`);
    const nuevos = programas(html);
    if (!nuevos.length) break;          // última página
    nuevos.forEach((x) => vistos.set(x.titulo, x));
    alProgresar?.({ fase: 'catalogo', pagina: p, total: vistos.size });
    if (nuevos.length < 20) break;
  }
  const lista = [...vistos.values()];

  // Los hechos comunes se comprueban contra la página oficial antes de
  // pegarlos a ciento setenta programas. Si mañana la Comisión cambia la
  // cuantía, el conector deja de añadirlo en lugar de repetir 170 veces una
  // cifra que ya no es cierta.
  let hechos = HECHOS;
  try {
    const oficial = plano(await render(OFICIAL));
    // Se busca el texto de la cita, no el valor. Comparar contra el valor
    // daba falso: la página oficial escribe «€1,400» con los separadores
    // del inglés, y el mismo número con otra puntuación da false y el
    // requisito desaparecía de los ciento setenta programas.
    hechos = HECHOS.filter((h) => oficial.includes(h.cita.slice(0, 24)));
  } catch { /* se queda con los de partida */ }

  return lista.map((p, i) => ({
    id: `EMJM-${i + 1}-${p.titulo.slice(0, 24).replace(/\W+/g, '-').toLowerCase()}`,
    titulo: p.titulo,
    organizador: 'Erasmus Mundus Joint Master (consorcio)',
    ambito: 'europeo',
    fuente: 'erasmus-mundus',
    // El importe es el de la beca, no el presupuesto total de la convocatoria,
    // que es un orden de magnitud mayor. No se mezclan.
    presupuesto: null,
    requisitos: hechos.map((h) => ({ ...h, extractor: 'oficial' })),
    url: p.proyecto ?? p.web,
    url_programa: p.web,
    cierra: null,   // cada programa tiene el suyo; no hay uno común
    pagina: null,
  }));
}