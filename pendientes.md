# Pendientes

Estado a 21 de octubre de 2026, al cierre de la sesión. Lo que está hecho y
funcionando está en `AGENTS.md`; aquí solo lo que falta.

Los tres agentes que hay trabajando ahora mismo tienen cada uno sus ficheros,
para que no se pisen entre ellos. Si algo de esta lista lo hace otro, se
tacha de aquí y no se vuelve a escribir.

## 1. En marcha (tres agentes en paralelo)

- [~] **Buscador** — el chip de idioma en `becas.html`, los textos de
      `js/becas.js` por `t()`, las claves nuevas en `js/i18n.js` y el
      desbordamiento de la cabecera con un correo de 27 caracteres
      (`styles.css`, bloque `.session`).
      **El agente se cayó por límite de peticiones**: dejó el trabajo hecho
      (396 claves, 78 llamadas a `t()`, el chip y el `alCambiarIdioma` en su
      sitio) pero sin informe. Falta revisar que no dejara nada a medias.
- [~] **QA del idioma** — `test/idioma.mjs` de punta a punta, barrido de
      anchos (320, 360, 390, 480, 768 y 1200) en las seis páginas, el modal
      de acceso en inglés mirado a ojo y el botón de Google según
      `googleId`.
      **El agente se cayó por límite de peticiones**. Dejó `test/idioma.mjs`
      escrito y en verde; falta el barrido de anchos a 320 y 360, que ahora
      hace la suite de Playwright.
- [~] **Erasmus y pie** — **se cayó por límite de peticiones**, pero dejó lo
      suyo hecho: la negrita del pie fuera, la plantilla de Erasmus con el
      chip y los `data-i18n`, y `erasmus-mundus.html`, `feed.xml` y
      `llms-full.txt` regenerados. Comprobado: los 390 ítems del feed
      intactos, `sitemap.xml` y `robots.txt` sin tocar.

## 1 bis. Las pruebas de navegador

- [~] Suite de Playwright en `test/e2e/`: las ocho páginas en móvil y
      escritorio, el idioma, el buscador, la cuenta y Erasmus. **En marcha.**
      Faltan los fallos que encuentre por arreglar.
- [x] `test/web.mjs` y `test/idioma.mjs` en verde. Los dos fallaban a
      ratos: `ir()` esperaba 1200 ms fijos y medía la página a medio cargar
      cuando el equipo iba cargado. Ahora esperan a `document.readyState`.

## 2. Lo que me toca a mí

- [x] La sección «El idioma» de `AGENTS.md`: por qué hay interruptor, por
      qué los metadatos se quedan en español, por qué el chip no puede ir
      dentro de `.top-act` (las dos implementaciones de `pintarCabecera()`
      lo vacían con `innerHTML = ''`).
- [x] `node test/web.mjs` y `node test/idioma.mjs` en verde.
- [ ] Revisar lo que dejaron los tres agentes a medias, sobre todo
      `js/i18n.js` y `js/becas.js`, que los dos agents tocaron hasta el
      final.
- [ ] Mirar el buscador en inglés: que el cartel de la búsqueda, la píldora
      de destino y el velo siga cabiendo a 390 px.
- [ ] **Commit → push → deploy**, en ese orden. El commit tiene que estar
      en GitHub antes de desplegar: Vercel comprueba el autor y bloquea el
      despliegue si el commit solo existe en local.

## 3. Hecho en esta sesión (para no repetirlo)

- [x] El momento de la búsqueda, al estilo de la referencia: titular
      grande con el número subiendo, píldoras del filtro, los tres pasos, la
      promesa, la salida «Cambiar los filtros» y las fichas de esqueleto.
- [x] «No puedo bajar mientras está buscando»: `#zona-lista` recibe
      prestado el alto que tenía y el marco solo se sube si no se ve.
- [x] La negrita de Privacidad y Cookies en el pie de `becas.html`.
- [x] Las celdas vacías de las rejillas de la portada: eran rectángulos
      marrones sin nada (la rejilla es de tres columnas y había dos
      tarjetas). Ahora `.steps-2` las pone a dos columnas.
- [x] Los botones se levantan al pasar por encima, los de todos los tipos.

## 4. Fallos abiertos que se sabían

- [ ] `erasmus-mundus.html` sigue solo en español hasta que el agente de
      Erasmus lo arregle: es de las tres páginas indexables.
- [ ] La cabecera desborda con un correo de 27 caracteres. Es anterior a
      esta sesión: lo causa el ancho de `.session`.
- [ ] Sin barrido de anchos a 320 y 360: no se puede afirmar que ninguna
      página quepa ahí.
- [ ] El modal de acceso en inglés está traducido en código, pero nadie lo
      ha mirado a ojo.

## 5. Antes de desplegar

- [ ] `vercel env add GOOGLE_CLIENT_ID production` y **redesplegar**: las
      variables no se inyectan en caliente.
- [ ] `vercel env add RESEND_API_KEY production`, `CORREO_DE production` y
      `CRON_SECRET production`. Sin `CRON_SECRET`, `/api/cron-avisos`
      responde sin comprobar a nadie.
- [ ] Verificar el dominio del remitente en Resend. Sin eso, la API
      contesta 403 y solo sale al correo de la propia cuenta.
- [ ] Comprobar que se sirve `auth/callback.js`: un despliegue hecho desde
      un *worktree* se llevó por delante el login con Google, que la CSP
      bloquea por ser un guion inline.
- [ ] Comprobar que `/data/becas.json` se sirve y que `data/usuarios.json`,
      `data/sesiones.json` y `data/avisos.json` **no** se sirven. Lo que
      decide qué sube a Vercel es `.vercelignore`, no `.gitignore`.

## 6. De sesiones anteriores, sin tocar

- [ ] Test del filtro `motivoDescarte` de `ingest/boe.mjs`. Hoy se
      comprueba a mano, mirando el log de la pasada: es lo que decide qué
      ve el estudiante.
- [ ] Cobertura de la extracción: con reglas salen pocos requisitos de las
      Bases del BOE. Cuando cambie una regla, **hay que subir
      `VERSION_REGLAS` a mano**, o el fichero sale con una mezcla de dos
      versiones y no hay ningún error que lo delate.
- [ ] Cobertura territorial: del BOE salen ministerios y ninguna comunidad
      autónoma, provincia ni ayuntamiento. BDNS está descartado (SPA de
      Angular con API interna sin documentar) y EUR-Lex también (devuelve
      contratos, no convocatorias).
- [ ] Las claves de Google: es lo único que no se puede hacer desde el
      repositorio. Los pasos, en `AGENTS.md`, en «Tareas para la próxima
      sesión».
