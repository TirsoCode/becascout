/**
 * i18n.js — Castellano e inglés, sin build y sin recargar.
 *
 * El sitio no tiene plantillas ni compilación, así que el idioma se resuelve en
 * el navegador. Este fichero es todo el mecanismo: un diccionario, dos
 * atributos y un conmutador. Vale para cualquier página.
 *
 * ── Por qué el SEO se queda en castellano ────────────────────────────────
 *
 * `<title>`, `<meta name="description">`, Open Graph, Twitter, el JSON-LD,
 * `canonical` y `hreflang` NO se tocan nunca. Google lee el HTML que sirve el
 * servidor; no ejecuta este módulo para indexar, y menos para indexar dos
 * idiomas. Traducir esas etiquetas solo crearía una versión inglesa que nadie
 * encuentra: ni `sitemap.xml` la anuncia, ni hay URL propia que la sirva. Por
 * eso el idioma es una comodidad para quien está leyendo, no una segunda
 * versión del sitio.
 *
 * ── Cómo engancharlo en una cabecera nueva ───────────────────────────────
 *
 * Dentro de `.top-in`, como hermano de `.top-act` —nunca dentro: al entrar,
 * `pintarCabecera()` deja esa zona con el bloque de sesión y se llevaría por
 * delante lo que hubiera—:
 *
 *     <div class="top-lang" data-lang-switch></div>
 *
 * Y en el `<head>` y al final del `<body>`:
 *
 *     <link rel="stylesheet" href="lang.css">
 *     <script type="module" src="js/i18n.js"></script>
 *
 * Si la página ya carga un módulo propio, basta con las dos líneas de import
 * en ese módulo y no hace falta la etiqueta `<script>`:
 *
 *     import { t, alCambiarIdioma } from './i18n.js';
 *     import './i18n.js';
 *
 * ── Para el buscador (becas.html y js/becas.js) ──────────────────────────
 *
 * La lista no puede repintarse sola: la pinta becas.js. Para que responda al
 * cambio de idioma, al principio del módulo:
 *
 *     import { t, alCambiarIdioma } from './i18n.js';
 *     ...
 *     alCambiarIdioma(() => pintarLista());   // vuelve a pintar con el idioma nuevo
 *
 * `alCambiarIdioma` devuelve una función para desapuntarse, por si algún día
 * hace falta.
 *
 * ── Cómo se marca el texto ───────────────────────────────────────────────
 *
 *   data-i18n="clave"        reemplaza el texto del elemento
 *   data-i18n-html="clave"   reemplaza el HTML (solo para texto con <a>, <strong>…)
 *   data-i18n-title="clave"  reemplaza el atributo `title`
 *   data-i18n-aria="clave"   reemplaza `aria-label`
 *   data-i18n-ph="clave"     reemplaza `placeholder`
 *
 * El castellano vive en el propio HTML y el diccionario solo guarda el inglés:
 * si una clave no trae `es`, al volver se restaura lo que había escrito. Así no
 * hay dos copias del mismo párrafo que se puedan desincronizar. Las cadenas que
 * nacen en JavaScript sí llevan las dos versiones.
 *
 * Ojo con la regla de siempre: **ningún dato sin su cita**. Traducir no cambia
 * ni un requisito, ni una fecha, ni una cifra.
 */

/* ── Diccionario ─────────────────────────────────────────────────────────
   `es` es opcional (ver arriba). `en` falta a propósito en las frases que no
   se traducen: entonces se queda el castellano, que es lo que se quiere. */

const DICC = {
  /* ── Cabecera y pie: comunes a todas las páginas ─────────────────────── */
  'nav.como': { en: 'How it works' },
  'nav.metodo': { en: 'The method' },
  'nav.erasmus': { en: 'Erasmus Mundus' },
  'nav.sobre': { en: 'About' },
  'nav.fuentes': { en: 'Sources' },
  'nav.buscar': { en: 'Find scholarships' },
  'nav.buscarCorto': { en: 'Search' },
  'nav.crear': { en: 'Create account' },
  'nav.portada': { en: 'Home' },
  'pie.buscar': { en: 'Find scholarships' },
  'pie.erasmus': { en: 'Erasmus Mundus' },
  'pie.sobre': { en: 'About' },
  'pie.privacidad': { en: 'Privacy' },
  'pie.cookies': { en: 'Cookies' },
  'pie.independiente': { en: 'BecasScout · An independent project. We are not a ministry or a university.' },
  'pie.solo': { en: 'BecasScout · An independent project.' },
  'pie.revisado': {
    en: 'BecasScout · An independent project. We are not a ministry or a university. Last reviewed: <time datetime="2026-10-22">22 October 2026</time>.',
  },

  /* El botón dice el idioma al que lleva, no el que hay puesto: así se lee
     como una acción y no como un estado. La etiqueta accesible lo dice con
     palabras, porque «EN» a secas se puede leer como «ya estás en inglés». */
  'idioma.cambiar': { es: 'Cambiar a inglés', en: 'Switch to Spanish' },

  /* ── Portada ─────────────────────────────────────────────────────────── */
  'inicio.hero.h1': {
    en: 'Some scholarships go unseen because <em>nobody reads them for you</em>',
  },
  'inicio.hero.lede': {
    en: 'They come out in the official gazette and on each university’s website. When you finally open the rules, they run to 60 pages and the deadline has already started.',
  },
  'inicio.hero.cta': { en: 'Create a free account' },
  'inicio.hero.ver': { en: 'See what it looks like' },
  'inicio.hero.nota': { en: 'No card. Any email works, not just Gmail.' },

  'inicio.panel.l1': { en: 'Resolution … calling for …… places' },
  'inicio.panel.l2': { en: 'Official rules — chapter III, requirements' },
  'inicio.panel.l3': { en: 'Minimum grade: ……… / 10' },
  'inicio.panel.l4': { en: 'Application window: …… working days' },
  'inicio.panel.l5': { en: 'Documents to submit — …… €' },
  'inicio.panel.t1': { en: 'pdf' },
  'inicio.panel.t2': { en: '47 pp' },
  'inicio.panel.t3': { en: 'p. 8' },
  'inicio.panel.t4': { en: 'p. 2' },
  'inicio.panel.t5': { en: 'p. 9' },
  'inicio.panel.velo': { en: 'You need an account to read the scholarships.' },

  'inicio.como.h2': { en: 'Three steps' },
  'inicio.como.p': {
    en: 'We file nothing for you and we take no commission. We read the rules and tell you what they say.',
  },
  'inicio.como.s1.h': { en: 'You tell us four things' },
  'inicio.como.s1.p': {
    en: 'Average grade, age, level and destination. They stay in your browser and go nowhere.',
  },
  'inicio.como.s2.h': { en: 'We read every call' },
  'inicio.como.s2.p': {
    en: 'We download the whole official document and pull out the requirements: minimum grade, age, language, deadline, amount.',
  },
  'inicio.como.s3.h': { en: 'We show what you meet' },
  'inicio.como.s3.p': {
    en: 'A ring counts the requirements you meet and the ones you don’t. Each one carries the quote from the original paragraph.',
  },

  'inicio.metodo.h2': { en: 'Two rules we don’t break' },
  'inicio.metodo.p': { en: 'What the call says, with its quote. What it doesn’t say, left blank.' },
  'inicio.metodo.s1.h': { en: 'Every fact carries its quote' },
  'inicio.metodo.s1.p': {
    en: 'If we say they ask for a 7.0, we show the paragraph that says so and the page of the gazette. It takes ten seconds to check.',
  },
  'inicio.metodo.s2.h': { en: '“We don’t know” is an answer' },
  'inicio.metodo.s2.p': {
    en: 'When the call doesn’t state a requirement, we leave it grey. A visible gap beats a number that looks right and isn’t.',
  },

  'inicio.fuentes.h2': { en: 'Where each line comes from' },
  'inicio.fuentes.p': {
    en: 'Every requirement comes from an official document. There is always a link to check it.',
  },
  'inicio.fuentes.boe.h': { en: 'Boletín Oficial del Estado' },
  'inicio.fuentes.boe.p': {
    en: '<a href="https://www.boe.es/diario_boe/" target="_blank" rel="noopener">Daily summary</a>, open to anyone, plus the XML of every notice. The primary source for state and university calls.',
  },
  'inicio.fuentes.eu.h': { en: 'Erasmus Mundus and the Commission' },
  'inicio.fuentes.eu.p': {
    en: '<a href="https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_es" target="_blank" rel="noopener">Erasmus Mundus</a> and the <a href="https://ec.europa.eu/info/funding-tenders/opportunities/portal/" target="_blank" rel="noopener">EU funding portal</a>. One connector for each, with the quote of what they say.',
  },
  'inicio.fuentes.daad.h': { en: 'DAAD, the German agency' },
  'inicio.fuentes.daad.p': {
    en: '<a href="https://www2.daad.de/deutschland/stipendium/datenbank/en/" target="_blank" rel="noopener">Its scholarship database</a>, with the level of each programme. Every country portal gets its own connector, because each one changes on its own.',
  },

  'inicio.cifras.p1.h': { en: '217 programmes' },
  'inicio.cifras.p1.p': {
    en: 'from the official <a href="https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_es" target="_blank" rel="noopener">Erasmus Mundus</a> catalogue, with the countries of each consortium. <a href="erasmus-mundus.html">All of them are here, with their page.</a>',
  },
  'inicio.cifras.p2.h': { en: '€1,400 a month' },
  'inicio.cifras.p2.p': {
    en: 'for up to 24 months, with a university degree. The same figure for all 217 programmes, which is why it can be quoted once. <a href="erasmus-mundus.html#cuanto">The full quote.</a>',
  },

  'inicio.faq.h2': { en: 'Questions we get a lot' },
  'inicio.faq.p': { en: 'The ones people email us before signing up.' },
  'inicio.faq.q1': { en: 'Does BecasScout submit my application?' },
  'inicio.faq.a1': {
    en: 'No. We read the call and tell you which requirements you meet. You file the application with the body that published it. Every listing links to the original document.',
  },
  'inicio.faq.q2': { en: 'Where does each requirement come from?' },
  'inicio.faq.a2': {
    en: 'From the official document: the Spanish official gazette and other bulletins. Each requirement carries the literal quote from the paragraph it came from and the page it is on, so you can check it in ten seconds.',
  },
  'inicio.faq.q3': { en: 'How much does BecasScout cost?' },
  'inicio.faq.a3': {
    en: 'Nothing. We take no commission and we don’t handle the application. Creating an account is free and does one thing: it lets us warn you when a deadline is close.',
  },
  'inicio.faq.q4': { en: 'Do you need my average grade?' },
  'inicio.faq.a4': {
    en: 'No. Your average grade, age, level and destination country stay in your browser and are never sent to a server. They are only used to work out which requirements you meet, on your screen.',
  },

  /* ── Sobre ───────────────────────────────────────────────────────────── */
  'sobre.meta': { en: 'Last updated: 21 October 2026' },
  'sobre.h1': { en: 'About BecasScout' },
  'sobre.lede': {
    en: 'BecasScout reads official calls and turns them into a list of requirements you can check. This page says where each fact comes from and why none of them is shown without its quote.',
  },
  'sobre.corto': {
    en: '<strong>In short:</strong> we are not a ministry, not a university, and we file nothing for you. We read calls published by others, pull out the requirements and link each one to its source. Every requirement you see carries the literal quote from the paragraph it came from, with the page in the bulletin.',
  },
  'sobre.hacemos.h2': { en: '1. What we do and what we don’t' },
  'sobre.hacemos.p1': {
    en: '<strong>We do</strong> one thing: take 40–80 pages of rules written for a civil servant and answer the question that matters. “Do I qualify, and what am I missing?” We answer it requirement by requirement.',
  },
  'sobre.hacemos.p2': {
    en: '<strong>We don’t do</strong> the rest: we don’t submit your application, we don’t handle the paperwork, we take no commission and we have no agreements with the bodies that publish the calls. A requirement read wrong is paid for by the applicant, so the design is built to make the error visible before it happens.',
  },
  'sobre.cita.h2': { en: '2. The rule that governs everything: the quote' },
  'sobre.cita.p1': {
    en: '<strong>No requirement is stored or shown without the literal fragment of the document it came from.</strong> It is not a matter of style: it is the only thing separating this from a well-designed invention.',
  },
  'sobre.cita.p2': {
    en: 'The reason is practical. If the extraction gets a requirement wrong and there is no quote, the error is invisible and the student can lose the scholarship. With the quote, the error shows up in ten seconds and gets fixed. A fact without a source is not a weak fact: it does damage.',
  },
  'sobre.extraccion.h2': { en: '3. How the requirements are extracted' },
  'sobre.extraccion.p1': {
    en: 'Extraction runs <strong>on rules</strong>, with no language model. It is deterministic, costs nothing and needs no key. We download the whole document and look for the requirements: minimum grade, age, language, deadline, amount. Each one keeps the literal fragment it came from.',
  },
  'sobre.extraccion.p2': {
    en: 'Today the rules cover part of what is in the rules documents. The text runs between 20,000 and 50,000 characters of legal prose, and not all of it fits a pattern. When a call doesn’t state a requirement, it stays at <strong>“we don’t know”</strong> instead of being filled in: a visible gap tells you more than a number that looks right and isn’t. Widening that coverage is work on the rules, not a reason to put a model back in.',
  },
  'sobre.fuentes.h2': { en: '4. Where the data comes from' },
  'sobre.fuentes.boe': {
    en: '<strong>BOE</strong> (Boletín Oficial del Estado): daily summary, open to anyone, and the XML of every notice. It is the primary source for state and university calls.',
  },
  'sobre.fuentes.erasmus': {
    en: '<strong>Erasmus Mundus</strong>: the official catalogue of master’s programmes run by European consortia, with the countries of each consortium.',
  },
  'sobre.fuentes.ue': {
    en: '<strong>The Commission</strong>: the EU funding portal. Only calls open to individuals go in, not the ones addressed to organisations.',
  },
  'sobre.fuentes.daad': {
    en: '<strong>DAAD</strong>: the German agency’s scholarship database, with the level of each programme.',
  },
  'sobre.fuentes.bdns': {
    en: '<strong>BDNS</strong>: the Spanish administrative register, which gives the budget, the deadline and the link to the full rules.',
  },
  'sobre.fuentes.pie': {
    en: 'Every listing links to the original source. We do not republish the full text: we summarise and link.',
  },
  'sobre.corregir.h2': { en: '5. How to correct a requirement' },
  'sobre.corregir.p': {
    en: 'If you see a requirement extracted wrong, a quote that doesn’t match or a deadline that looks off, write to us: <a href="mailto:privacidad@becascout.com">privacidad@becascout.com</a>. The quote is there so you can catch it. The next step is for us to fix it.',
  },
  'sobre.quien.h2': { en: '6. Who is behind this' },
  'sobre.quien.p1': {
    en: 'BecasScout is an independent project. It is not a public body, it represents no education authority and it has no agreement with the bodies that publish the calls. It reads what others publish and puts it in order.',
  },
  'sobre.quien.p2': {
    en: 'For anything at all, write to <a href="mailto:privacidad@becascout.com">privacidad@becascout.com</a>: a quote that doesn’t match, a deadline that looks wrong, a question about a call. The official rules are the source, and the link to them is on every listing so you can check them without trusting anyone.',
  },
  'sobre.quien.p3': {
    en: 'The <a href="https://www.boe.es/" target="_blank" rel="noopener">Boletín Oficial del Estado</a> and the <a href="https://erasmus-plus.ec.europa.eu/opportunities/opportunities-for-individuals" target="_blank" rel="noopener">Erasmus+ portal</a> are the two sources behind everything shown here. No invented data.',
  },
  'sobre.verTambien': {
    en: 'See also the <a href="privacidad.html">privacy policy</a> and the <a href="cookies.html">cookie policy</a>.',
  },

  /* ── Privacidad ──────────────────────────────────────────────────────
     Traducción fiel. No se suaviza ni una obligación: los artículos, los
     plazos y las bases legales van tal cual, solo en inglés. */
  'priv.meta': { en: 'Last updated: 20 October 2026 · Version 1.2' },
  'priv.h1': { en: 'Privacy policy' },
  'priv.lede': {
    en: 'This policy explains what data BecasScout stores, why, for how long, and how to get it deleted. It is written to be read, not to cover us.',
  },
  'priv.corto': {
    en: '<strong>In short:</strong> we keep your email and a session so the site works, and — only if you choose to answer it — the reply to one question we ask once: how you found us. Your average grade, age and destination <strong>stay in your browser and never leave your device</strong>. There is no analytics, no advertising, no profiling, and we sell nothing to anyone.',
  },
  'priv.quien.h2': { en: '1. Who is responsible' },
  'priv.quien.p1': {
    en: 'BecasScout is an independent project. <strong>It is not a ministry, a university or a public body</strong>, and we have no agreement with any of them. BecasScout does not file applications or manage scholarships: it only reads calls published by others and summarises them.',
  },
  'priv.quien.p2': {
    en: 'Data controller: <strong>BecasScout</strong><br>Contact for exercising your rights: <a href="mailto:privacidad@becascout.com">privacidad@becascout.com</a>',
  },
  'priv.quien.nota': {
    en: 'Note for the site owner: before publishing this, replace the name and email with the real details, and add the tax ID and address required by Article 13 GDPR. A legal notice that identifies nobody does not meet the article.',
  },
  'priv.datos.h2': { en: '2. What data we process' },
  'priv.datos.h3a': { en: '2.1 Account data' },
  'priv.datos.li1': {
    en: '<strong>Email address.</strong> It identifies the account and lets us warn you about deadlines.',
  },
  'priv.datos.li2': {
    en: '<strong>A password, but not yours.</strong> We store a hash computed with <code>scrypt</code> and a random salt, different for each user. It is one-way: it cannot be recovered from the hash, only compared. If you lose your password you have to create another account.',
  },
  'priv.datos.li3': { en: '<strong>Account creation date.</strong>' },
  'priv.datos.li4': {
    en: '<strong>How you found us, if you answer.</strong> When you create the account we ask once — and you can skip it — where you came across us (ChatGPT, YouTube, Instagram…). It is stored as a single word on your account, not as a browsing history: one answer per account, and it stays there.',
  },
  'priv.datos.h3b': { en: '2.2 Data that does NOT reach our server' },
  'priv.datos.p1': {
    en: 'Average grade, age, level of study and destination country are stored in your browser’s <code>localStorage</code> and <strong>stay there</strong>. They are used to work out the requirements ring you see on screen, and for nothing else. They do not travel to any server because there is no server for them to travel to: the whole comparison runs on your device.',
  },
  'priv.datos.p2': {
    en: 'That means if you clear your browser data or press “Delete profile”, that information disappears without passing through us. It also means <strong>we cannot recover it</strong> if you lose it: we do not have it.',
  },
  'priv.datos.h3c': { en: '2.3 Connection logs' },
  'priv.datos.p3': {
    en: 'The web host that serves this page logs, as any server does, the IP address, date and browser of each request. It is used to detect attacks and errors. We do not use it for profiling and we do not keep it longer than the hosting provider allows.',
  },
  'priv.base.h2': { en: '3. What for, and on what legal basis' },
  'priv.base.th1': { en: 'Purpose' },
  'priv.base.th2': { en: 'Data' },
  'priv.base.th3': { en: 'Legal basis' },
  'priv.base.f1a': { en: 'Keeping the session open and letting the site know who you are' },
  'priv.base.f1b': { en: 'Email, password hash, session token' },
  'priv.base.f1c': {
    en: 'Art. 6(1)(b) GDPR — performance of the contract you enter into when you create the account',
  },
  'priv.base.f2a': { en: 'Warning you that an application deadline is close' },
  'priv.base.f2b': { en: 'Email' },
  'priv.base.f2c': {
    en: 'Art. 6(1)(b) GDPR — performance of the contract you enter into when you create the account (deadline alerts are the reason the account exists). You can switch them off in your account, and deleting the account ends them for good.',
  },
  'priv.base.f3a': { en: 'Service security and error diagnosis' },
  'priv.base.f3b': { en: 'Connection log' },
  'priv.base.f3c': {
    en: 'Art. 6(1)(f) GDPR — legitimate interest in keeping the service running',
  },
  'priv.base.f4a': {
    en: 'Knowing where people come from, to decide where it is worth pushing',
  },
  'priv.base.f4b': { en: 'How you found us' },
  'priv.base.f4c': {
    en: 'Art. 6(1)(a) GDPR — consent; the question is optional and you can skip it',
  },
  'priv.base.f5a': { en: 'Working out which requirements you meet' },
  'priv.base.f5b': { en: 'Grade, age, level, destination' },
  'priv.base.f5c': {
    en: 'No legal basis because <strong>we do not process it</strong>: it runs in your browser',
  },
  'priv.base.p': {
    en: 'Deadline alerts cover the calls <strong>in our database</strong>, nothing outside it: the ones published on BecasScout, with their closing date and the link to the official call, which is where the application is filed. The email is used only for that. There is no advertising, no tracking and no mailing list belonging to anyone else. You can switch alerts off in your account, and deleting the account also deletes the record of what you were told about.',
  },
  'priv.google.h2': { en: '4. Google as a third party' },
  'priv.google.p1': {
    en: 'You can create the account with Google. If you do, Google opens its own authorisation window and <strong>Google is an independent controller</strong> of the processing it carries out under its own policies.',
  },
  'priv.google.p2': {
    en: 'We ask for <strong>one permission only: your email address</strong>. Specifically:',
  },
  'priv.google.li1': {
    en: 'We do not ask for your name, your profile, your contacts, your files or your location.',
  },
  'priv.google.li2': {
    en: 'We do not store the Google access token. We use it once to read your email, discard it, and all that remains in your browser is the email and a timestamp. There is no Google credential stored on our disk or on yours.',
  },
  'priv.google.li3': {
    en: 'When you open that window, Google may set its own cookies, which are theirs and not ours: they are described in their <a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener">cookie policy</a>.',
  },
  'priv.terceros.h2': { en: '5. Other third parties' },
  'priv.terceros.p': { en: 'There are no others. Specifically:' },
  'priv.terceros.li1': {
    en: '<strong>No analytics.</strong> No Google Analytics, no Plausible, nothing that measures where you go.',
  },
  'priv.terceros.li2': { en: '<strong>No advertising</strong> and no ad networks.' },
  'priv.terceros.li3': {
    en: '<strong>We do not sell, rent or share data.</strong> Ever.',
  },
  'priv.terceros.li4': {
    en: 'The data in the listings (grades, amounts, deadlines) comes from official public sources and is not yours.',
  },
  'priv.conservacion.h2': { en: '6. How long we keep it' },
  'priv.conservacion.th1': { en: 'What' },
  'priv.conservacion.th2': { en: 'How long' },
  'priv.conservacion.f1a': {
    en: 'Account (email, hash and the arrival answer, if you gave one)',
  },
  'priv.conservacion.f1b': { en: 'Until you ask us to delete it' },
  'priv.conservacion.f2a': { en: 'Session cookie' },
  'priv.conservacion.f2b': { en: '30 days, renewed when you sign in' },
  'priv.conservacion.f3a': { en: 'Academic profile (grade, age…)' },
  'priv.conservacion.f3b': { en: 'In your browser, until you delete it' },
  'priv.conservacion.f4a': { en: 'Connection log' },
  'priv.conservacion.f4b': {
    en: 'Whatever the hosting provider sets, usually between 30 and 90 days',
  },
  'priv.derechos.h2': { en: '7. Your rights' },
  'priv.derechos.p1': {
    en: 'You can ask us at any time, and we will answer within a month:',
  },
  'priv.derechos.li1': {
    en: '<strong>Access</strong> (Art. 15): find out what data of yours we hold.',
  },
  'priv.derechos.li2': { en: '<strong>Rectification</strong> (Art. 16): correct a wrong detail.' },
  'priv.derechos.li3': {
    en: '<strong>Erasure</strong> (Art. 17): delete your account and your data.',
  },
  'priv.derechos.li4': {
    en: '<strong>Restriction</strong> (Art. 18): pause processing while a complaint is reviewed.',
  },
  'priv.derechos.li5': {
    en: '<strong>Portability</strong> (Art. 20): take your data away in a machine-readable format.',
  },
  'priv.derechos.li6': {
    en: '<strong>Objection</strong> (Art. 21): object to processing based on legitimate interest.',
  },
  'priv.derechos.li7': {
    en: '<strong>Withdraw consent</strong> once given, without affecting what came before.',
  },
  'priv.derechos.p2': {
    en: 'To exercise them, write to <a href="mailto:privacidad@becascout.com">privacidad@becascout.com</a>. Deleting your account is as easy as writing to us: we will not ask you to justify it.',
  },
  'priv.derechos.p3': {
    en: 'If you think we have not dealt with your request, you can complain to the <a href="https://www.aepd.es" target="_blank" rel="noopener">Spanish Data Protection Agency</a>.',
  },
  'priv.menores.h2': { en: '8. Under 14' },
  'priv.menores.p': {
    en: 'BecasScout is aimed at people aged 14 and over. If you are younger, you need the permission of whoever has parental responsibility in order to create the account. We do not process data from anyone under that age without that consent.',
  },
  'priv.seguridad.h2': { en: '9. Security' },
  'priv.seguridad.p1': {
    en: 'The password is never stored in the clear. The session travels in an <code>HttpOnly</code> cookie, so page JavaScript cannot read it, and <code>SameSite=Lax</code>, which stops it being sent from other sites. The site is served over HTTPS in production.',
  },
  'priv.seguridad.p2': {
    en: 'No measure is absolute. If a breach affects your data, we will report it to the supervisory authority within 72 hours and warn you by email.',
  },
  'priv.cambios.h2': { en: '10. Changes to this policy' },
  'priv.cambios.p': {
    en: 'If we change anything that affects your rights, we publish it here with the date at the top updated and, if the change matters, we tell you by email.',
  },
  'priv.verTambien': {
    en: 'See also the <a href="cookies.html">cookie policy</a>.',
  },

  /* ── Cookies ─────────────────────────────────────────────────────────── */
  'cook.meta': { en: 'Last updated: 18 October 2026 · Version 1.1' },
  'cook.h1': { en: 'Cookie policy' },
  'cook.lede': {
    en: 'We use <strong>one</strong> cookie. The minimum needed to know who you are. No analytics, no advertising, no tracking.',
  },
  'cook.resumen': {
    en: '<strong>Summary:</strong> if you do not sign in, no cookie is stored in your browser. The only one is created when you register, and it disappears after 30 days or when you sign out.',
  },
  'cook.cuales.h2': { en: '1. Which cookies we use' },
  'cook.cuales.th1': { en: 'Name' },
  'cook.cuales.th2': { en: 'What it is' },
  'cook.cuales.th3': { en: 'What for' },
  'cook.cuales.th4': { en: 'Duration' },
  'cook.cuales.tipo': {
    en: 'Technical cookie, <code>HttpOnly</code>, <code>SameSite=Lax</code>',
  },
  'cook.cuales.para': {
    en: 'Keeping the session open. Without it, every reload would ask for your password again.',
  },
  'cook.cuales.dura': { en: '30 days, renewed when you sign in' },
  'cook.cuales.pie': { en: '<strong>That is all.</strong> No other first-party cookies.' },
  'cook.google.h2': { en: '2. Third-party cookies' },
  'cook.google.p1': {
    en: 'When you press <strong>“Continue with Google”</strong>, Google opens its own authorisation window and may set its own cookies. That falls under <a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener">Google’s cookie policy</a>, not ours, and only happens if you press it.',
  },
  'cook.google.p2': {
    en: 'If you register with email and password, <strong>there are no third-party cookies</strong>: the form is ours and calls no external service.',
  },
  'cook.google.h3': { en: 'Source portals' },
  'cook.google.p3': {
    en: 'Loading data for a call sends no cookies to any server of ours: the request goes from your browser to the official portal concerned and we read the response. That portal is the one that may set its own cookies, under its own policy.',
  },
  'cook.local.h2': { en: '3. What we store without cookies' },
  'cook.local.p1': {
    en: 'Your average grade, age, level and destination are stored in the browser’s <code>localStorage</code>. This is local data, not cookies: it does not travel, the server never sees it, and it goes when you clear site data or press “Delete profile”.',
  },
  'cook.local.p2': {
    en: 'Also, when you create the account we ask once — you can skip it — how you found us. The answer, if you give one, is stored <strong>on your account</strong>, on the server, because it helps us see where people come from. The only thing left in the browser is the mark that the question was already asked, so we do not repeat it: <code>becascout.origen</code>, also in <code>localStorage</code>.',
  },
  'cook.rechazar.h2': { en: '4. How to refuse them' },
  'cook.rechazar.p1': {
    en: 'You can delete or block cookies in your browser settings. Note that if you block <code>bs_sesion</code> the site still works: it simply will not remember that you signed in and will ask again each time. No part of the site becomes unavailable because you refuse them.',
  },
  'cook.rechazar.p2': { en: 'In the main browsers:' },
  'cook.rechazar.li1': {
    en: '<strong>Firefox</strong> — Privacy &amp; Security › Cookies and Site Data',
  },
  'cook.rechazar.li2': { en: '<strong>Chrome</strong> — Privacy and security › Third-party cookies' },
  'cook.rechazar.li3': {
    en: '<strong>Safari</strong> — Settings › Privacy › Cookies and website data',
  },
  'cook.base.h2': { en: '5. Legal basis' },
  'cook.base.p': {
    en: '<code>bs_sesion</code> is a cookie strictly necessary to provide a service you have asked for — signing in — so it relies on <strong>Article 22(2)(c) GDPR</strong>: it does not require prior consent. We set no cookies for analytics, which is why there is no consent banner on this site.',
  },
  'cook.verTambien': {
    en: 'See also the <a href="privacidad.html">privacy policy</a>.',
  },

  /* ── 404 ─────────────────────────────────────────────────────────────── */
  'e404.meta': { en: 'Error 404' },
  'e404.h1': { en: 'This page does not exist' },
  'e404.lede': {
    en: 'The link may be mistyped, or we moved something. From here you can reach what does exist.',
  },
  'e404.callout': { en: 'What you were after is on one of these pages:' },
  'e404.portada': { en: 'Home' },
  'e404.becas': { en: 'Find scholarships' },
  'e404.sobre': { en: 'About BecasScout' },
  'e404.privacidad': { en: 'Privacy' },
  'e404.cookies': { en: 'Cookies' },

  /* ── Configuración de Supabase ───────────────────────────────────────── */
  'cfg.h1': { en: 'Supabase is not configured' },
  'cfg.corto': {
    en: 'The site works without Supabase: the landing page and the search load. What is not saved is the email-and-password account. That is why you are seeing this note. For registration, sessions and alerts to work, three keys have to be set in Vercel (see <a href="https://vercel.com/docs/environment-variables" style="color:inherit;text-decoration:underline">Environment Variables</a>):',
  },
  'cfg.donde': {
    en: 'They go in <code>vercel.com</code> → <em>Your project</em> → <em>Environment variables</em> → <em>Add</em>.',
  },
  'cfg.boton': {
    en: 'The <strong>Create account</strong> button in the header stays. With the keys in place, the account confirms itself and you do not have to register twice.',
  },
  'cfg.sesion': {
    en: 'The session is an <code>bs_sesion</code> HttpOnly cookie whose token lives in the <code>sesiones</code> table. Without the three variables, sign-ups are not saved and the API answers “account registration is not available”. Redeploy after adding them: Vercel does not pick them up live.',
  },
  'cfg.contacto': {
    en: 'You can always write to <a href="mailto:privacidad@becascout.com">privacidad@becascout.com</a>.',
  },

  /* ── Cuenta: la página del alta (cuenta.html), la encuesta y los ajustes
     (js/auth.js y js/cuenta.js) ─────────────────────────────────────────── */
  'cuenta.cerrar': { es: 'Cerrar', en: 'Close' },
  'cuenta.pasar': { es: 'Pasar', en: 'Skip' },
  'cuenta.pitch.h': {
    es: 'Cada requisito, con la cita del boletín.',
    en: 'Every requirement, with the quote from the bulletin.',
  },
  'cuenta.pitch.p': {
    es: 'Nada se enseña sin el fragmento que lo sostiene. Lo que la convocatoria no dice, no lo sabemos.',
    en: 'Nothing is shown without the fragment behind it. What the call doesn’t say, we don’t know.',
  },
  'cuenta.stat1': { es: 'requisitos sin cita', en: 'requirements without a quote' },
  'cuenta.stat2': { es: 'analítica y publicidad', en: 'analytics and ads' },
  'cuenta.titulo.registro': { es: 'Crea tu cuenta', en: 'Create your account' },
  'cuenta.titulo.login': { es: 'Inicia sesión', en: 'Sign in' },
  'cuenta.sub.registro': {
    es: 'Te avisamos cuando se acerque el plazo de una beca.',
    en: 'We tell you when a scholarship deadline is close.',
  },
  'cuenta.sub.login': {
    es: 'Entra con tu correo y tu contraseña.',
    en: 'Sign in with your email and password.',
  },
  'cuenta.correo': { es: 'Correo', en: 'Email' },
  'cuenta.pass': { es: 'Contraseña', en: 'Password' },
  'cuenta.correo.ph': { es: 'tu@correo.com', en: 'you@example.com' },
  'cuenta.pass.ph': { es: 'Mínimo 10 caracteres', en: 'At least 10 characters' },
  'cuenta.pass.ph.login': { es: 'Tu contraseña', en: 'Your password' },
  'cuenta.pista': { es: 'Al menos 10 caracteres.', en: 'At least 10 characters.' },
  'cuenta.enviar.registro': { es: 'Crear cuenta', en: 'Create account' },
  'cuenta.enviar.login': { es: 'Iniciar sesión', en: 'Sign in' },
  'cuenta.enviando.registro': { es: 'Creando cuenta…', en: 'Creating account…' },
  'cuenta.enviando.login': { es: 'Entrando…', en: 'Signing in…' },
  'cuenta.alt.login': { es: '¿Ya tienes cuenta?', en: 'Already have an account?' },
  'cuenta.alt.crear': { es: '¿No tienes cuenta?', en: 'No account yet?' },
  'cuenta.alt.login.btn': { es: 'Inicia sesión', en: 'Sign in' },
  'cuenta.alt.crear.btn': { es: 'Crea una', en: 'Create one' },
  'cuenta.fino': {
    es: 'Tu nota, tu edad y tu destino no salen de tu navegador.',
    en: 'Your grade, age and destination never leave your browser.',
  },
  'cuenta.google': { es: 'Continuar con Google', en: 'Continue with Google' },
  'cuenta.sep': { es: 'o con tu correo', en: 'or with your email' },
  'cuenta.google.cargando': { es: 'Conectando…', en: 'Connecting…' },
  'cuenta.google.error': {
    es: 'No se pudo cargar Google. Revisa la conexión.',
    en: 'Google could not load. Check your connection.',
  },
  'cuenta.google.devuelto': {
    es: 'Google devolvió un error: {c}',
    en: 'Google returned an error: {c}',
  },
  'cuenta.google.cancelado': { es: 'Se canceló el acceso.', en: 'Sign-in was cancelled.' },
  'cuenta.error.generico': { es: 'No se pudo completar.', en: 'Couldn’t complete that.' },
  'cuenta.local.aviso': {
    es: 'No hay servidor en marcha. Puedes seguir con una sesión local de prueba, que <b>no es una cuenta</b>: solo vive en este navegador.',
    en: 'No server is running. You can continue with a local test session, which <b>is not an account</b>: it lives in this browser only.',
  },
  'cuenta.local.btn': { es: 'Seguir en modo local', en: 'Continue in local mode' },
  /* Lo que se lee justo después de aceptar el modo de juguete, en la página
     del alta. Hay que decir que la sesión va en la pestaña: si no, quien migre
     al buscador cree que la cuenta le sigue ahí. */
  'cuenta.local.ok': {
    es: 'Sesión local de prueba en marcha. Vive solo en esta pestaña: al cerrarla se acaba.',
    en: 'Local test session running. It lives in this tab only: closing the tab ends it.',
  },
  'cuenta.encuesta.h': { es: '¿Cómo nos has conocido?', en: 'How did you find us?' },
  'cuenta.encuesta.p': {
    es: 'Sirve para saber por dónde llega la gente. Si no quieres contestar, pasa sin más.',
    en: 'It tells us where people come from. If you would rather not answer, just skip it.',
  },
  'cuenta.encuesta.skip': { es: 'Prefiero no contestar', en: 'I’d rather not answer' },
  'cuenta.encuesta.ok': { es: 'Anotado', en: 'Noted' },
  'cuenta.encuesta.gracias': {
    es: 'Gracias. Ya sabemos por dónde llega la gente.',
    en: 'Thanks. Now we know where people come from.',
  },
  'cuenta.origen.amigo': { es: 'Un amigo', en: 'A friend' },
  'cuenta.ajustes.t': { es: 'Tu cuenta', en: 'Your account' },
  'cuenta.avisos.t': { es: 'Avisos de plazo', en: 'Deadline alerts' },
  'cuenta.avisos.p': {
    es: 'Un correo cuando una convocatoria de la lista cierra en los próximos 7 días. Se apaga aquí.',
    en: 'One email when a listed call closes in the next 7 days. Switch it off here.',
  },
  'cuenta.ajustes.salir': { es: 'Cerrar sesión', en: 'Sign out' },
  'cuenta.ajustes.borrar': { es: 'Eliminar la cuenta', en: 'Delete account' },
  'cuenta.ajustes.caducada': {
    es: 'Tu sesión ha caducado. Entra otra vez para cambiar los avisos.',
    en: 'Your session expired. Sign in again to change alerts.',
  },
  'cuenta.avisos.error': {
    es: 'Los avisos no se han podido cambiar ahora mismo.',
    en: 'Alerts couldn’t be changed right now.',
  },
  'cuenta.borrar.h': { es: 'Eliminar la cuenta', en: 'Delete account' },
  'cuenta.borrar.p': {
    es: 'Se borra la cuenta, la sesión y los avisos. No hay vuelta atrás. Para confirmar, escribe tu correo.',
    en: 'This deletes the account, the session and alerts. There is no undo. To confirm, type your email.',
  },
  'cuenta.borrar.lab': { es: 'Tu correo', en: 'Your email' },
  'cuenta.borrar.ph': {
    es: 'El correo con el que creaste la cuenta',
    en: 'The email you signed up with',
  },
  'cuenta.borrar.btn': { es: 'Borrar definitivamente', en: 'Delete for good' },
  'cuenta.borrar.haciendo': { es: 'Borrando…', en: 'Deleting…' },
  'cuenta.borrar.volver': { es: 'Volver', en: 'Back' },
  'cuenta.borrar.error': { es: 'No se pudo borrar la cuenta.', en: 'The account couldn’t be deleted.' },
  'cuenta.ajustes.tooltip': { es: 'Ajustes de la cuenta', en: 'Account settings' },

  /* ── Buscador (becas.html y js/becas.js) ──────────────────────────────
     Todo lo de aquí nace en JavaScript, así que lleva las dos versiones: en
     el HTML el castellano está escrito y el diccionario solo guarda el
     inglés, pero estas cadenas no viven en el HTML. Los nombres de país en
     inglés van sin castellano a propósito: el castellano sale de
     `js/paises.js` y `paisDe()` de becas.js lo elige. Duplicarlo aquí sería
     tener dos listas que se desincronizan, que es justo lo que ese fichero
     evita. */
  'cab.crear': { es: 'Crear cuenta', en: 'Create account' },
  'cab.salir': { es: 'Salir', en: 'Sign out' },
  'cab.local': { es: ' (local)', en: ' (local)' },

  'becas.h1': { en: 'Open calls' },
  'becas.lede': {
    en: 'Fill in your profile and see, requirement by requirement, which ones you meet.',
  },
  'becas.nota': { en: 'Average grade' },
  /* La coma decimal es de la nota castellana. En inglés el ejemplo va con
     punto, que es como se escribe allí; el campo acepta las dos. */
  'becas.nota.ph': { en: '7.5' },
  'becas.edad': { en: 'Age' },
  'becas.nivel': { en: 'Level' },
  'becas.destino': { en: 'Destination' },
  'becas.cualquiera': { en: 'Any' },
  'becas.comprobar': { en: 'Check' },
  'becas.cargando': { en: 'Loading calls…' },
  'becas.pie': {
    en: 'BecasScout · An independent project. Every call links to its official source.',
  },

  'nivel.grado': { en: 'Bachelor’s' },
  'nivel.master': { en: 'Master’s' },
  'nivel.doctorado': { en: 'Doctorate' },

  /* El cartel del momento de búsqueda. El titular va en dos claves porque el
     número es un nodo aparte —el que sube de 0 al total— y no puede ir
     dentro de la cadena. El orden verbo-número-sustantivo es el mismo en los
     dos idiomas, así que dos claves bastan. */
  'buscando.k': { es: 'Convocatorias de Europa', en: 'European calls' },
  'buscando.verbo': { es: 'Buscando', en: 'Searching' },
  'buscando.sust': { es: 'becas', en: 'scholarships' },
  'buscando.nivel': { es: 'de {n}', en: 'at {n} level' },
  'buscando.pais': { es: 'para {p}', en: 'in {p}' },
  'buscando.toda': { es: 'en toda Europa', en: 'across Europe' },
  'buscando.todaPill': { es: 'toda Europa', en: 'all of Europe' },
  'buscando.filtros': { es: 'Filtros: {x}', en: 'Filters: {x}' },
  'buscando.ninguno': { es: 'ninguno', en: 'none' },
  'buscando.sr': { es: 'Buscando {n} becas {obj}', en: 'Searching {n} scholarships {obj}' },
  'buscando.lede': {
    es: 'Leemos las bases oficiales publicadas por el BOE, el catálogo de Erasmus Mundus, el DAAD y la Comisión Europea. De cada convocatoria: los requisitos, los plazos y los importes.',
    en: 'We read the official rules published in the BOE, the Erasmus Mundus catalogue, DAAD and the European Commission. From each call: the requirements, the deadlines and the amounts.',
  },
  'buscando.paso1': { es: 'Las bases, tal como se publican', en: 'The official rules, as published' },
  'buscando.paso2': {
    es: 'Los requisitos, sacados del texto',
    en: 'The requirements, taken from the text',
  },
  'buscando.paso3': { es: 'La cita, en cada dato', en: 'The quote, on every fact' },
  'buscando.sub': {
    es: 'requisito a requisito contra tu perfil',
    en: 'requirement by requirement against your profile',
  },
  'buscando.volver': { es: 'Cambiar los filtros', en: 'Change the filters' },

  'contador.una': { es: 'convocatoria', en: 'call' },
  'contador.varias': { es: 'convocatorias', en: 'calls' },
  'contador.conReq': { es: 'con requisitos', en: 'with requirements' },
  'contador.sinReq': { es: 'sin requisitos aún', en: 'without requirements yet' },
  'contador.sinPais': {
    es: 'sin destino conocido (también salen)',
    en: 'with no known destination (shown too)',
  },
  'contador.sinNivel': {
    es: 'sin nivel conocido (también salen)',
    en: 'with no known level (shown too)',
  },

  'vacio.filtro.h': {
    es: 'No hay ninguna convocatoria con ese filtro',
    en: 'No calls match that filter',
  },
  'vacio.filtro.p': { es: 'Prueba con {p} o quita el filtro.', en: 'Try {p} or clear the filter.' },
  'vacio.filtro.sinPais': {
    es: 'Hay {n} que no dicen dónde y no se pueden filtrar por país.',
    en: '{n} of them don’t say where they take place and can’t be filtered by country.',
  },
  'vacio.cualquierDestino': { es: 'cualquier destino', en: 'any destination' },
  'vacio.base.h': { es: 'Todavía no hay convocatorias', en: 'No calls yet' },
  'vacio.base.p': {
    es: 'La base se llena con <code>node ingest/run.mjs</code>, que lee el sumario del BOE y descarga las Bases completas de las que hay que leer.',
    en: 'The database is filled by <code>node ingest/run.mjs</code>, which reads the BOE summary and downloads the full rules of the calls that need reading.',
  },
  'error.datos.h': { es: 'No hay datos cargados', en: 'No data loaded' },
  'error.datos.p': {
    es: 'Ejecuta <code>node ingest/run.mjs</code> para generar <code>data/becas.json</code>.',
    en: 'Run <code>node ingest/run.mjs</code> to generate <code>data/becas.json</code>.',
  },

  'etiqueta.nota_minima': { es: 'Nota media mínima', en: 'Minimum average grade' },
  'etiqueta.edad_max': { es: 'Edad máxima', en: 'Maximum age' },
  'etiqueta.edad_min': { es: 'Edad mínima', en: 'Minimum age' },
  'etiqueta.idioma': { es: 'Idioma', en: 'Language' },
  'etiqueta.titulacion': { es: 'Titulación', en: 'Degree' },
  'etiqueta.destino': { es: 'Destino', en: 'Destination' },
  'etiqueta.ingresos': { es: 'Ingresos', en: 'Income' },
  'etiqueta.justificacion': { es: 'Documentación', en: 'Documents' },
  'etiqueta.importe': { es: 'Importe', en: 'Amount' },
  'etiqueta.presupuesto': {
    es: 'Presupuesto de la convocatoria',
    en: 'Budget of the call',
  },
  'etiqueta.fecha_limite': { es: 'Plazo', en: 'Deadline' },
  'etiqueta.plazo': { es: 'Plazo de solicitud', en: 'Application window' },
  /* Tipos que solo traen las fichas de Erasmus Mundus y que llegaron antes
     que su entrada: sin clave, la fila enseña «duracion_max» en crudo —en los
     dos idiomas— y «convocatoria» en castellano con EN puesto. */
  'etiqueta.duracion_max': { es: 'Duración máxima', en: 'Maximum duration' },
  'etiqueta.ects': { es: 'Créditos ECTS', en: 'ECTS credits' },
  'etiqueta.convocatoria': { es: 'Identificador de la convocatoria', en: 'Call identifier' },

  'motivo.notaOk': { es: 'Tu nota es {n} y piden {v}', en: 'Your grade is {n} and they ask for {v}' },
  'motivo.notaNo': { es: 'Piden {v} y tu nota es {n}', en: 'They ask for {v} and your grade is {n}' },
  'motivo.edadOk': { es: 'Tienes {n} y el máximo es {v}', en: 'You are {n} and the maximum is {v}' },
  'motivo.edadNo': { es: 'El máximo es {v} y tienes {n}', en: 'The maximum is {v} and you are {n}' },

  'tarjeta.plazoNo': { es: 'Plazo no extraído', en: 'Deadline not extracted' },
  'tarjeta.cerrada': { es: 'Cerrada', en: 'Closed' },
  'tarjeta.venceHoy': { es: 'Vence hoy', en: 'Closes today' },
  'tarjeta.venceManana': { es: 'Vence mañana', en: 'Closes tomorrow' },
  'tarjeta.dias': { es: '{n} días', en: '{n} days' },
  'tarjeta.destino': { es: 'Destino: {p}', en: 'Destination: {p}' },
  'tarjeta.reqNoneBases': {
    es: 'Tenemos las Bases pero aún no hemos sacado los requisitos.',
    en: 'We have the official rules but haven’t pulled out the requirements yet.',
  },
  'tarjeta.reqNone': {
    es: 'Todavía no hemos extraído los requisitos. Puedes leerla entera en la fuente.',
    en: 'We haven’t extracted the requirements yet. You can read the whole call at the source.',
  },
  'tarjeta.sinReq': { es: 'Sin requisitos extraídos', en: 'No requirements extracted' },
  /* El recuento manda en el número del sustantivo, así que el singular va en
     su propia clave: «1 requirements» se lee mal y delata que la frase se
     escribió pensando en el plural. En castellano pasaba lo mismo —«1
     requisitos»—, y de paso se arregla. */
  'tarjeta.nadaComprobable': {
    es: '{n} requisitos, ninguno comprobable todavía',
    en: '{n} requirements, none checkable yet',
  },
  'tarjeta.nadaComprobable.una': {
    es: '1 requisito, ninguno comprobable todavía',
    en: '1 requirement, none checkable yet',
  },
  'tarjeta.de': { es: 'de {n} requisitos comprobados', en: 'of {n} requirements checked' },
  'tarjeta.de.uno': { es: 'de 1 requisito comprobado', en: 'of 1 requirement checked' },
  'tarjeta.anadeNota': { es: 'Añade tu nota para comprobar', en: 'Add your grade to check' },
  'tarjeta.verConv': { es: 'Ver convocatoria', en: 'View call' },
  'tarjeta.verBoe': { es: 'Ver en el BOE', en: 'View in the BOE' },
  'fuente.ue': { es: 'UE', en: 'EU' },

  'anillo.sinDatos': { es: 'sin datos', en: 'no data' },
  'anillo.anadeNota': { es: 'añade tu nota', en: 'add your grade' },

  'velo.texto': {
    es: 'Inicia sesión para ver las becas',
    en: 'Sign in to see the scholarships',
  },
  'velo.btn': { es: 'Crear cuenta gratis', en: 'Create a free account' },

  /* Nombres de país que no se escriben igual en inglés. Los que coinciden
     —Malta, Austria, Portugal…— no están: `paisDe()` cae al castellano de
     `paises.js`, que en esos casos ya es el nombre inglés. */
  'pais.ES': { en: 'Spain' },
  'pais.FR': { en: 'France' },
  'pais.DE': { en: 'Germany' },
  'pais.IT': { en: 'Italy' },
  'pais.NL': { en: 'Netherlands' },
  'pais.BE': { en: 'Belgium' },
  'pais.IE': { en: 'Ireland' },
  'pais.FI': { en: 'Finland' },
  'pais.SE': { en: 'Sweden' },
  'pais.DK': { en: 'Denmark' },
  'pais.PL': { en: 'Poland' },
  'pais.CZ': { en: 'Czechia' },
  'pais.SK': { en: 'Slovakia' },
  'pais.HU': { en: 'Hungary' },
  'pais.RO': { en: 'Romania' },
  'pais.GR': { en: 'Greece' },
  'pais.HR': { en: 'Croatia' },
  'pais.SI': { en: 'Slovenia' },
  'pais.LV': { en: 'Latvia' },
  'pais.LT': { en: 'Lithuania' },
  'pais.CY': { en: 'Cyprus' },
  'pais.LU': { en: 'Luxembourg' },
  'pais.IS': { en: 'Iceland' },
  'pais.NO': { en: 'Norway' },
  'pais.CH': { en: 'Switzerland' },
  'pais.GB': { en: 'United Kingdom' },
  'pais.BA': { en: 'Bosnia and Herzegovina' },
  'pais.MD': { en: 'Moldova' },
  'pais.MK': { en: 'North Macedonia' },
  'pais.TR': { en: 'Turkey' },
  'pais.UA': { en: 'Ukraine' },
  /* «UE» es el único cuyo nombre inglés no se escribe igual que el castellano
     de js/paises.js: ahí va el acrónimo, y su espejo es «EU». */
  'pais.UE': { en: 'EU' },

  /* ── Erasmus Mundus (ingest/paginas.mjs) ─────────────────────────────
     Igual que en las demás páginas: el castellano vive en el HTML que
     genera paginas.mjs. Sin `es` aquí, al volver al castellano se restaura
     lo que había en el HTML, y así no hay dos copias que desincronizar.
     Sin estas claves, la página de Erasmus se quedaba entera en castellano
     con EN puesto: data-i18n apuntaba a claves que nunca llegaron. */

  'em.meta': { en: 'Data from the official EACEA catalogue and the Erasmus+ pages, read on' },
  'em.h1': { en: 'Erasmus Mundus scholarships:' },
  'em.h1.mes': { en: 'a month' },
  'em.h1.dos': { en: 'and a university degree' },
  'em.lede': {
    en: 'The Erasmus Mundus Joint Masters are the European scholarships with the cleanest rule there is: the same amount and the same requirements for every programme. That is what makes it possible to state the figure with its quote, which is exactly what no other scholarship lets you do.',
  },
  'em.corto.h': { en: 'What you need, in short:' },
  'em.corto.p': {
    en: 'You don’t have to be Spanish or submit a project: the application is filled in on the programme’s own website, and that is all.',
  },
  'em.corto.y': { en: 'and between' },
  'em.corto.ects': { en: 'ECTS credits' },
  'em.req.titulacion': { en: 'Previous degree' },
  'em.req.titulacion.valor': { en: 'A university degree (or final year of a degree)' },
  'em.req.plazo': { en: 'Application window' },
  'em.req.plazo.valor': {
    en: 'Between October and January, for the course that starts the following year',
  },
  'em.req.ects': { en: 'ECTS credits' },
  'em.req.ects.valor': { en: '60, 90 or 120' },
  'em.alMes': { en: 'a month, up to' },
  'em.meses': { en: 'months' },
  'em.cuanto.h2': { en: 'What the scholarship pays' },
  'em.cuanto.p1': {
    en: 'The programme doesn’t set the amount: it is the same for every Erasmus Mundus Joint Master, and that is why it can be checked once and applied to all of them. The scholarship covers participation, travel, the visa and a living allowance, but the fine detail of each item is published by the programme.',
  },
  'em.cuanto.cita': {
    en: 'The official Erasmus+ page about the Joint Masters. The quote is in English because it is the source’s literal text; the translation is ours.',
  },
  'em.requisitos.h2': { en: 'What you need' },
  'em.requisitos.p': { en: 'The same requirements for the' },
  'em.requisitos.programas': { en: 'programmes:' },
  'em.requisitos.p2': {
    en: 'Age, average grade and language are nowhere in these rules: the Commission doesn’t set them as a condition of the scholarship. Each programme can also ask for its own things —a portfolio, an interview, a specific language—, and those live on the website of each master, which is the place to look.',
  },
  'em.queEs.h2': { en: 'What they actually are' },
  'em.nota.1': { en: 'Type of programme' },
  'em.nota.1.valor': {
    en: 'A high-level international master, taught in English by a consortium of at least three institutions from three different countries',
  },
  'em.nota.2': { en: 'How many people have been through them' },
  'em.nota.2.valor': { en: 'Almost 50,000 students since 2004' },
  'em.nota.3': { en: 'Where each programme’s requirements are' },
  'em.nota.3.valor': {
    en: 'On the website of each master: the entry requirements, the participating universities and the application steps are all there',
  },
  'em.programas.h2': { en: 'The' },
  'em.programas.h2b': { en: 'programmes' },
  'em.programas.p': {
    en: 'This is the complete list from the official catalogue, with a link to the project record on the Erasmus+ portal and to the website where applications are filed. They are ordered by nothing: the order is the catalogue’s order.',
  },
  'em.tabla.programa': { en: 'Programme' },
  'em.tabla.ficha': { en: 'Official record' },
  'em.tabla.solicitud': { en: 'Apply' },
  'em.tabla.fichaProyecto': { en: 'Project record' },
  'em.tabla.webPrograma': { en: 'Programme website' },
  'em.nosabemos.h2': { en: 'What we don’t know' },
  'em.nosabemos.p1': {
    en: '<strong>The exact dates.</strong> Erasmus+ says applications are made between October and January, but each programme has its own dates and its own way of selecting. We don’t have them, and that is why we don’t write them: an approximate deadline is worse than a gap, because it is the piece of data someone builds their decision on.',
  },
  'em.nosabemos.p2': {
    en: '<strong>The requirements specific to each programme.</strong> The official project record and the website of each master carry them, and that is why we link to both. What is here is what the Commission says for everyone, with its quote.',
  },
  'em.fuentes.h2': { en: 'Where this comes from' },
  'em.fuentes.li1': {
    en: '<a href="https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_es" target="_blank" rel="noopener">Erasmus Mundus Joint Masters catalogue</a> (EACEA): the list of programmes and their links comes from here.',
  },
  'em.fuentes.li2': {
    en: '<a href="https://erasmus-plus.ec.europa.eu/opportunities/organisations/cooperation-among-organisations-and-institutions/erasmus-mundus-joint-masters" target="_blank" rel="noopener">Erasmus Mundus Joint Masters</a> (official Erasmus+ portal, organisations): the amount of the scholarship and its maximum duration come from here.',
  },
  'em.fuentes.li3': {
    en: '<a href="https://erasmus-plus.ec.europa.eu/opportunities/individuals/students/erasmus-mundus-joint-masters" target="_blank" rel="noopener">Erasmus Mundus Joint Masters</a> (official Erasmus+ portal, students): the previous degree, the application window, the ECTS and the type of programme come from here.',
  },
  'em.fuentes.p': {
    en: 'Each programme links to its own website, which is where you apply. The only thing in between is this list.',
  },
};

/* ── Estado ─────────────────────────────────────────────────────────────── */

const CLAVE = 'becascout.idioma';
const SOPORTADOS = ['es', 'en'];

let idioma = 'es';
const oyentes = new Set();

/* El castellano de cada clave, tal y como venía en el HTML. Se guarda la
   primera vez que se aplica para poder volver sin duplicar el texto en el
   diccionario. */
const original = new Map();

const ATRIBUTOS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria', 'aria-label'],
  ['data-i18n-ph', 'placeholder'],
];

export function idiomaActual() {
  return idioma;
}

/**
 * La cadena de una clave en el idioma activo.
 *
 * `t('cuenta.enviando.registro')` → «Creando cuenta…» o «Creating account…».
 * Con parámetros: `t('x', { n: 3 })` sustituye `{n}`. Si la clave no existe
 * devuelve la propia clave, que es feo pero se ve: un hueco silencioso en la
 * interfaz se queda ahí para siempre.
 */
export function t(clave, params) {
  const e = DICC[clave];
  const s = e?.[idioma] ?? e?.es ?? original.get(clave) ?? clave;
  return params ? sustituir(s, params) : s;
}

function sustituir(s, params) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  );
}

/**
 * Avisa cuando cambia el idioma. Devuelve la función para desapuntarse.
 *
 * Lo que está escrito en el HTML se repinta solo. Lo que pinta JavaScript —la
 * lista de becas, sobre todo— no: quien lo pinta tiene que apuntarse aquí y
 * volver a pintarlo. Sin esto, cambiar de idioma dejaría media página en el
 * idioma anterior.
 */
export function alCambiarIdioma(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/** Cambia el idioma, lo recuerda y repinta. Devuelve el idioma que quedó. */
export function cambiarIdioma(nuevo) {
  if (!SOPORTADOS.includes(nuevo) || nuevo === idioma) return idioma;
  idioma = nuevo;
  try { localStorage.setItem(CLAVE, nuevo); } catch { /* modo privado */ }
  aplicar();
  for (const fn of oyentes) {
    try { fn(nuevo); } catch (err) { console.error('[i18n] un oyente falló', err); }
  }
  return idioma;
}

/* ── Pintado ────────────────────────────────────────────────────────────── */

function recordar(clave, texto) {
  if (!original.has(clave)) original.set(clave, texto);
}

function valor(clave) {
  const e = DICC[clave];
  return e?.[idioma] ?? e?.es ?? original.get(clave) ?? clave;
}

function aplicar() {
  // `lang` en el elemento raíz no es decorativo: es lo que hace que un lector
  // de pantalla pronuncie «BecasScout» y «requirements» con la fonética que
  // toca, y lo que permite que el navegador parta las palabras bien.
  document.documentElement.lang = idioma;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const clave = el.dataset.i18n;
    recordar(clave, el.textContent);
    el.textContent = valor(clave);
  }

  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    const clave = el.dataset.i18nHtml;
    recordar(clave, el.innerHTML);
    el.innerHTML = valor(clave);
  }

  for (const [attr, destino] of ATRIBUTOS) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      const clave = el.getAttribute(attr);
      recordar(clave, el.getAttribute(destino) ?? '');
      el.setAttribute(destino, valor(clave));
    }
  }

  pintarConmutadores();
}

/* ── El conmutador ──────────────────────────────────────────────────────
   Un solo botón con el idioma al que se va. Dos segmentos «ES | EN» dirían
   cuál está puesto y cuál no, pero cuestan veinte píxeles más en una cabecera
   que a 390 px ya va justa. El `title` y el `aria-label` dicen la acción con
   palabras, así que el botón no depende de que se entienda la sigla. */

function pintarConmutadores() {
  for (const caja of document.querySelectorAll('[data-lang-switch]')) {
    let boton = caja.querySelector('.lang-btn');

    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'lang-btn';
      boton.addEventListener('click', () => {
        cambiarIdioma(idioma === 'es' ? 'en' : 'es');
      });
      caja.appendChild(boton);
    }

    const otro = idioma === 'es' ? 'en' : 'es';
    boton.textContent = otro.toUpperCase();
    // La sigla se lee en su idioma («EN» como /iː en/), no en el de la página.
    boton.setAttribute('lang', otro);
    boton.title = t('idioma.cambiar');
    boton.setAttribute('aria-label', t('idioma.cambiar'));
  }
}

/* ── Arranque ───────────────────────────────────────────────────────────── */

/**
 * Qué idioma toca al cargar: primero la URL, luego lo recordado, luego español.
 *
 * `?lang=en` se gasta al aplicarlo —se guarda y se quita de la barra— porque
 * si no, el enlace pisaría para siempre la elección de quien después pulse
 * «ES» y recargue. El enlace sigue sirviendo para el primer aterrizaje, que es
 * para lo que está.
 */
function idiomaInicial() {
  let url = null;
  try {
    url = new URLSearchParams(location.search).get('lang');
  } catch { /* location rara */ }

  if (url && SOPORTADOS.includes(url)) {
    try { localStorage.setItem(CLAVE, url); } catch { /* modo privado */ }
    quitarParametroIdioma();
    return url;
  }

  try {
    const guardado = localStorage.getItem(CLAVE);
    if (SOPORTADOS.includes(guardado)) return guardado;
  } catch { /* modo privado: se queda en español */ }

  return 'es';
}

function quitarParametroIdioma() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete('lang');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch { /* sin history: no pasa nada, se queda el parámetro */ }
}

idioma = idiomaInicial();
// El módulo se ejecuta con el documento ya parseado (los `type="module"` son
// diferidos), así que aquí hay DOM que pintar.
aplicar();
