/**
 * paginas.mjs — genera las páginas estáticas que salen de los datos.
 *
 * Escribe `feed.xml` y `llms-full.txt` en la raíz. No hay build: los
 * ficheros se suben tal cual a Vercel.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('..', import.meta.url);
const BASE = 'https://becascout.vercel.app';
const RUTA_DATOS = new URL('data/becas.json', RAIZ);

/** Escapa lo que va dentro de HTML/XML. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return 'sin fecha';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

function rssFecha(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

async function main() {
  const datos = JSON.parse(await readFile(RUTA_DATOS, 'utf8'));
  const todas = datos.becas ?? [];
  const generado = datos.generado ?? new Date().toISOString();

  const feedXml = await feed(todas, generado);
  await writeFile(new URL('feed.xml', RAIZ), feedXml, 'utf8');
  console.log(`  feed.xml · ${(feedXml.match(/<item>/g) ?? []).length} items`);

  const full = await llmsFull(generado);
  await writeFile(new URL('llms-full.txt', RAIZ), full, 'utf8');
  console.log('  llms-full.txt');
}

async function llmsFull(generado) {
  const fecha = fechaLarga(generado);
  return `# BecasScout — texto completo

> Becas de Europa leídas de la convocatoria oficial, con los requisitos como
> lista comprobable y la cita literal de cada uno.

Actualizado el ${fecha}. El mapa del sitio, con las páginas y las fuentes, está
en https://becascout.vercel.app/llms.txt

## Cómo se extrae

Del sumario oficial se baja el documento entero y se buscan los requisitos —
nota mínima, edad, idioma, plazo, importe— por reglas, sin modelo de
lenguaje: determinista, gratuito y sin depender de ninguna clave. Cada
requisito guarda el fragmento literal del que se sacó. Si la cita no se
puede comprobar, el requisito no se guarda.
`;
}

async function feed(todas, generado) {
  const items = [];

  for (const b of todas) {
    const desc = [
      b.organizador ? `Convoca: ${b.organizador}.` : '',
      b.cierra ? `Cierra el ${b.cierra}.` : '',
      b.url ? `Documento oficial: ${b.url}` : '',
      'Los requisitos, con su cita literal, se ven en la web con cuenta.',
    ].filter(Boolean).join(' ');

    const publicada = b.publicada
      ? `${String(b.publicada).slice(0, 4)}-${String(b.publicada).slice(4, 6)}-${String(b.publicada).slice(6, 8)}`
      : generado;

    const link = b.url || `${BASE}/becas.html`;
    items.push(`    <item>
      <title>${esc(b.titulo)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="false">${esc(b.id)}</guid>
      <pubDate>${rssFecha(publicada)}</pubDate>
      <description>${esc(desc)}</description>
    </item>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Feed de las convocatorias de la base. Se genera con
  \`node ingest/paginas.mjs\`.
-->
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>BecasScout — convocatorias</title>
    <link>${BASE}/</link>
    <description>Becas leídas de la convocatoria oficial: quién convoca, cuándo cierra y el enlace al documento.</description>
    <language>es</language>
    <lastBuildDate>${rssFecha(generado)}</lastBuildDate>
    <atom:link href="${BASE}/feed.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
}

export async function regenerarFeed() {
  const datos = JSON.parse(await readFile(RUTA_DATOS, 'utf8'));
  const todas = datos.becas ?? [];
  const xml = await feed(todas, datos.generado ?? new Date().toISOString());
  await writeFile(new URL('feed.xml', RAIZ), xml, 'utf8');
  return (xml.match(/<item>/g) ?? []).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--solo-feed')) {
    const n = await regenerarFeed();
    console.log(`  feed.xml · ${n} items`);
  } else {
    await main();
  }
}
