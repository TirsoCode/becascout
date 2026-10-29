# AGENTS.md — BecasScout

Instrucciones para el agente que trabaje en este repositorio.
Léelas antes de tocar nada.

## Qué es esto

Buscador de becas europeas que lee la convocatoria oficial y devuelve los
requisitos como lista comprobable, cada uno con la cita literal del párrafo
del que salió.

## La regla que gobierna todo

**Ningún dato se muestra sin su cita.**

Si un requisito no viene acompañado del fragmento literal del documento
oficial del que se extrajo, no se guarda ni se enseña. No es una preferencia
estilística: es lo único que separa esto de un invento con buena interfaz.

La razón es práctica. Si el LLM extrae mal un requisito, el estudiante
pierde una beca. Con la cita, el error es visible y el estudiante lo
corrige; sin cita, el error es invisible y además le arruinamos la
convocatoria. Un dato sin fuente no es un dato flojo, es un dato que
perjudica.

## El otro límite: no inventamos probabilidades

En el diseño original se iba a mostrar «85 % de probabilidad de que te den
esta beca». **No existe tal dato.** No hay histórico de solicitudes ni de
adjudicaciones, así que cualquier porcentaje sería una cifra inventada con
apariencia de estadística.

Por eso el producto habla de **requisitos que cumples**, nunca de
probabilidad de obtenerla. Si no sabemos algo, la respuesta es «no lo
sabemos», y se dice en la interfaz.

## Stack

- **Front:** HTML, CSS y JavaScript sin framework ni build. Se despliega
  tal cual a Vercel, Netlify, Cloudflare Pages o GitHub Pages.
- **Datos:** Postgres en Neon, cuando haya backend. Antes de eso, un JSON.
- **Ingesta:** Node 18+, módulos ES, sin dependencias.
- **Extracción:** por reglas, sin LLM. Determinista y sin clave. Ver
  `ingest/extract.mjs`.

Cero dependencias en tiempo de ejecución. Si añades una, justifica aquí por
qué no se puede evitar.

La única dependencia del proyecto es de desarrollo: `@playwright/test`, para
las pruebas de navegador de `test/e2e/`. No la carga la web, no entra en el
despliegue —`.vercelignore` saca `node_modules/` y `test/`— y en el
repositorio solo está el `package.json` con la versión. Existe porque las
pruebas de antes, que hablan con Chrome por el protocolo de depuración, se
medían a mitad de carga cuando la máquina iba cargada: el titular salía
vacío y el chip de idioma no existía todavía, y eso se leía como un fallo
del sitio. Playwright espera a que la página esté de verdad.

## Estructura

```
index.html            portada. No enseña ni una beca
becas.html            buscador. Contenido pixelado hasta tener cuenta
cuenta.html           la página del alta. A pantalla entera, abierta en otra pestaña
sobre.html            qué es esto, cómo se extrae y con qué reglas. Indexable
erasmus-mundus.html   las becas Erasmus Mundus. Indexable. La genera paginas.mjs
privacidad.html       política de privacidad
cookies.html          política de cookies
404.html              cuando la URL no existe. Vercel la sirve con estado 404
styles.css            sistema de diseño
lang.css              el chip de idioma. Aparte porque lo cargan todas las páginas
robots.txt            quién puede rastrear. Los bots de IA, permitidos a propósito
sitemap.xml           las páginas indexables (portada, sobre.html y erasmus-mundus)
llms.txt              resumen del sitio para modelos, formato de llmstxt.org
llms-full.txt         el texto de las páginas, sin repetir lo que ya dice llms.txt
feed.xml              las convocatorias en RSS. Lo genera paginas.mjs
.well-known/ai.txt    dónde buscan los agentes: apunta a los de abajo
ai/summary.json       quién es BecasScout, en JSON, para asistentes de IA
ai/faq.json           las preguntas frecuentes, en JSON, para asistentes de IA
logo.png              logo cuadrado del JSON-LD. Sale de tools/
vercel.json           redirección de /index.html, cabeceras de seguridad y CSP
tools/                HTML que Chrome headless convierte en el logo. No se despliega
serve.mjs             servidor estático para desarrollo
js/
  landing.js          portada
  becas.js            buscador, matching y el bloqueo
  auth.js             sesión, encuesta de llegada y ajustes (el alta ya no vive aquí)
  cuenta.js           la página del alta: ?desde, vuelta al origen y Google
  i18n.js             castellano e inglés: el diccionario, t() y el chip
js/
  config.js           URL de la API y configuración pública
  supabase.js         inicio de sesión con Google vía Supabase
  supabase-client.js  cliente de Supabase desde CDN, sin build
api/
  [...ruta].js        la API entera como una función (ver más abajo)
auth/
  callback.html       receptor del token de Google
  callback.js         su lógica. Aparte porque la CSP no deja guiones inline
lib/
  store.js            cuentas y sesiones. Postgres, con fichero de respaldo
ingest/
  boe.mjs             Boletín Oficial del Estado (sin clave, sin coste)
  xml.mjs             parser de XML mínimo, sin dependencias
  consultas.mjs       las piezas de red que se repiten en los conectores
  extract.mjs         requisitos, por reglas
  ensamblar.mjs       qué se escribe en becas.json. Fuera de run.mjs para poder probarlo
  run.mjs             orquesta la ingesta
  bdns.mjs            registro administrativo. Da presupuesto, plazo y Bases
  daad.mjs            catálogo de becas de Alemania. Solo pasa con Chrome
  ue.mjs              convocatorias de la Comisión (SEDIA), en nombre propio
  erasmus.mjs         catálogo de Erasmus Mundus. También refresca sus hechos
  erasmus-paises.mjs  los países de cada programa. A mano, no en cada pasada
  paginas.mjs         genera erasmus-mundus.html, feed.xml y llms-full.txt
supabase/migrations/  SQL de las tablas
test/
  store.mjs           el almacén contra un Supabase de mentira
  extract.mjs         las reglas de extracción
  filtro.mjs          qué es una beca y qué no
  ensamblar.mjs       lo que llega a data/becas.json
  pais.mjs            el filtro de destino y de nivel
  web.mjs             lo que se ve en el navegador
  idioma.mjs          el cambio castellano/inglés, de punta a punta
  sin-avisos.mjs      que la retirada de los avisos se queda retirada
  e2e/                el sitio entero, con Playwright y el Chrome del sistema
data/becas.json       salida de la ingesta
auditor-diario/       el auditor con IA: Playwright + informe .md en reports/.
                      No se despliega (.vercelignore). Corre en GitHub Actions
                      cada 3 días, o a mano con `node auditor.mjs`
reports/              los informes que genera el auditor. Se commitean a propósito
```

### Dos cosas de `api/` que no son obvias

**`api/[...ruta].js` es un comodín a propósito.** Un solo fichero maneja todas las
rutas (`/api/registro`, `/api/login`, `/api/salir`, `/api/yo`, `/api/config`,
`/api/origen`, `/api/registro-google` y el `DELETE /api/cuenta`).
Vercel mapea cada fichero de `api/` a su propia ruta, así que un `api/auth.js`
solo respondería en `/api/auth` y lo demás sería un 404 — que en el navegador se
ve como «no hay servidor» y cae al modo local de juguete.

**Su `handler` es un `export default`.** Vercel invoca la exportación por
defecto. Con `export function handler` el despliegue sale `Ready`, la web carga
y todas las rutas devuelven `FUNCTION_INVOCATION_FAILED` sin más explicación.
Ocurrió el 17 de octubre de 2026 y solo se veía en los logs de la función.

## Convenciones

- Comentarios en español, y explican **por qué**, no qué. Si el código hace
  algo evidente, no lleva comentario.
- Los comentarios largos van en los dos casos que importan: por qué una
  decisión es rara, y qué se rompió antes. Esos son los que nadie
  redescubre solo.
- Las funciones que hablan con la red llevan timeout y `catch`. Un conector
  caído no puede tumbar la ingesta entera.
- Nombres en español en el dominio (`beca`, `requisito`, `convocatoria`) y en
  inglés en lo técnico (`fetch`, `parse`, `cache`). La mezcla es
  intencionada: el dominio es de quien lee el código después, no de quien
  escribe las funciones.

## Diseño

Partimos de [ProfScout](https://profscout.com/) como referencia de tono, pero
la identidad es **otra**: papel cálido en vez de verde frío, Instrument Serif
en vez de Fraunces, y una retícula editorial con filetes en vez de tarjetas
con sombra sobre fondo gris. Copiar la paleta entera habría sido rápido y
habría hecho la web indistinguible de la referencia.

Reglas que no se rompen:

- `--brand` (`#12463A`) es la acción primaria. Nada más lo usa.
- Los estados son semánticos: ámbar = plazo corto o aviso, óxido = no cumples
  o cerrada, marca = registro.
- Nada de gradientes donde bastaba un color plano.
- Móvil primero. El estudiante está en el tren, no en su escritorio.

## La puerta de las becas

Las becas **no** son visibles sin cuenta. Es una decisión de producto, no un
adorno: la cuenta es lo que abre el buscador entero —cada convocatoria con
sus requisitos y sus citas—, y eso es lo que se pide a cambio del correo.

El bloqueo es visual, no una comprobación de permiso. El contenido se pinta
entero y se cubre con `filter: blur()` más una retícula de píxeles. El texto
está en el DOM y se puede leer en el inspector.

**El velo no lleva ninguna marca dentro de la lista.** Ni candado, ni la
palabra «bloqueado», ni un botón encima de cada ficha. Las 85 salen igual que
si fueran de quien las está mirando: mismo orden, mismo número, misma retícula,
solo que borrosas. Lo que sí hay es **una barra fija abajo de todo**, fuera del
contenido, con «Inicia sesión para ver las becas» y su botón.

El 17 de octubre de 2026 el velo se quedó sin ninguna marca, y el 18 volvió el
cartel en esa forma. El motivo del cambio: sin una llamada a la acción a la
vista, el único camino era el botón «Crear cuenta» de la cabecera, que en móvil
se pierde al bajar. La marca va **fuera** de la lista —una sola barra en el
borde inferior— y no encima de las fichas, porque un cartel sobre cada ficha
convierte la lista en un anuncio de lo que esconde; una barra al pie dice para
qué hace falta la cuenta sin señalar cada hueco.

Se podría «proteger» ocultando los datos y pidiéndolos después, pero entonces
la página sería un formulario en blanco, se pierde la sensación de que hay
algo detrás, y el servidor tendría que filtrar la lista, que es más trabajo
para un resultado peor. El contenido es público: lo que se esconde es la
lista, no un secreto.

**Entre-cards hay un filete.** Una línea de `--rule-2` en el hueco, no un
borde en la tarjeta. Sin ella las 85 fichas pixeladas se leen como una sola
mancha y no se distingue que hay más debajo, que es lo que hace que alguien
siga bajando. Va en la retícula editorial y no como marco, y por eso es un
`.lock + .lock::before` y no un `border` en `.beca`.

### El alta vive en cuenta.html, en otra pestaña

Desde el 22 de octubre de 2026 crear cuenta **no es un modal flotante sobre
la página que lo pidió**: es una página propia, `cuenta.html` + `js/cuenta.js`,
a pantalla entera, que las puertas abren con `target="_blank"`. Los motivos
prácticos: un enlace no se puede bloquear (un botón que llama `window.open`
era presa del bloqueador de ventanas), en móvil el modal sobre el buscador
apretaba, y a pantalla entera la página se puede repartir en dos columnas en
escritorio, con la promesa del producto a la izquierda y el formulario a la
derecha. Las puertas —todas llevan la marca `data-open-auth`— son la
cabecera y el héroe de la portada, la cabecera del buscador y la barra fija
del velo. Es un **enlace**, no un botón que monta un modal: el navegador la
trata como a cualquier otro enlace.

Lo que conviene no deshacer:

- **El `?desde` viaja en la URL y se valida contra una lista cerrada**
  (`DESTINOS` en `js/cuenta.js`: `/`, `/becas.html`,
  `/erasmus-mundus.html`). Un `?desde` inventado no lleva a un 404 ni a un
  sitio ajeno: cae al buscador. La puerta de la portada vendió «esta
  página»; la del buscador, el buscador.
- **Al terminar el alta, la pestaña vuelve sola** (`location.replace` al
  `?desde`) y antes de saltar pone la bandera `bs.encuesta` en
  `sessionStorage`, que gasta `revisarEncuesta()` en la página de llegada.
  Es el mismo mecanismo que usa `auth/callback.js` para Google, con el
  mismo literal repartido entre tres ficheros a propósito.
- **La pestaña de origen no sabe nada del alta hasta que recobra el
  foco.** Al volver, `alVolver()` —escuchado en `visibilitychange` y
  `focus` en `js/landing.js` y `js/becas.js`— repregunta sin cache
  (`sesionFresca()`) y repinta solo si la firma de la sesión cambió
  (`'no' | 'si' | 'local'`). En el buscador, si el marco de la búsqueda está
  en pantalla se rehace entero y no se pinta la lista por debajo, para no
  saltarse el beat.
- **La firma arranca con lo pintado, no con `null`.** `pintarCabecera()`
  deja escrito qué pinta (`vista = s ? … : 'no'`). Empezar en `null` era una
  trampa: el primer `alVolver()` tras el alta veía `null`, no repintaba, y
  dejaba el nuevo valor escrito — el «Crear cuenta» se quedaba ahí para
  siempre con la cuenta ya hecha. Un centinela que traga el primer cambio
  es un centinela que nunca pinta el cambio que importa: el único.
- **La puerta del buscador nace en JavaScript y tiene que llevar la marca
  a mano** (`a.setAttribute('data-open-auth', '')` en `js/becas.js`). La de
  la portada la lleva escrita en el HTML; si la de aquí se olvida, las
  pruebas la buscan y no está.
- **Con sesión, la puerta grande del héroe pasa a «Buscar becas»**
  (`nav.buscar` en i18n, enlace a `/becas.html`). Un «Crear cuenta gratis»
  de cara a quien ya tiene cuenta manda al alta como si no hubiera pasado
  nada.
- **La sesión de juguete no vuelve a ninguna parte.** Vive solo en la
  memoria del módulo; redirigir al buscador la perdería al instante. Se
  queda en la página, con el aviso (`cuenta.local.ok`) de que se acaba al
  cerrar la pestaña.
- **Los ids del formulario conservan el nombre del modal de antes**
  (`#modal-t`, `#f-correo`, `#f-pass`, `#f-enviar`, `#f-hint`,
  `#modal-alt`, `#modal-cambia`, `.modal-msg`): los escribe `js/cuenta.js`
  y los apuntan las pruebas. Renombrarlos es romperlas a la vez.

### La encuesta de llegada

Al crear la cuenta —y solo entonces— sale una pregunta que se puede pasar: de
dónde nos ha conocido (ChatGPT, Claude, Instagram, TikTok, YouTube, Reddit, un
amigo), cada una con el logotipo de la plataforma a color. La respuesta vive
en `cuentas.origen` y no en el navegador: lo que se quiere saber es por dónde
llega la gente, y eso en `localStorage` no se puede contar. Se pregunta una
vez, se conteste o se pase, y a quien vuelve a entrar no se le pregunta.

Dos cosas que no son obvias y conviene no deshacer:

- **`registro-google` responde `nuevo`**, y con eso decide la web si pregunta.
  El callback de Google (`auth/callback.html`) deja la bandera en
  `sessionStorage` porque la página que crea la cuenta no es la que aterriza.
- **La lista de respuestas está en dos sitios**: `ORIGENES` en `js/auth.js` (lo
  que se enseña) y `ORIGENES` en `api/[...ruta].js` (lo que se acepta). El
  filtro del servidor no es paranoia: la columna es un texto que el navegador
  manda, y sin lista cerrada entraría lo que a alguien le apeteciera escribir.

La columna llegó a existir el 20 de octubre de 2026, con la migración
`0002_origen.sql` aplicada en el proyecto: hasta entonces la pregunta se
enseñaba igual, pero la respuesta se perdía en silencio al no existir la
columna. `NULL` es un estado legítimo —hay cuentas anteriores a la pregunta y
gente que pasa sin contestar—, y «no lo sabemos» no se rellena con un valor
por defecto.

## Los avisos de plazo (retirados)

El sistema de avisos por correo existió del 20 al 28 de octubre de 2026: un
cron diario mandaba un correo cuando una convocatoria de la base cerraba en
los próximos 7 días. Se retiró entero —el cron (`/api/cron-avisos`), el
interruptor de la cuenta, la tabla `avisos`, la columna `cuentas.avisos`
(migración `0004_sin_avisos.sql`), `test/avisos.mjs` y las claves de
Resend—. El motivo: sin un dominio verificado en el proveedor de correo, la
promesa «te avisamos» no se podía sustentar, y una promesa que no se cumple
es peor que ninguna. La cuenta vuelve a prometer lo único que cumple: abrir
el buscador entero, con los requisitos y sus citas.

Tres cosas de aquella época que conviene recordar si algún día vuelve:

- **La base legal del aviso era el art. 6.1.b, no el 6.1.a.** Era opt-out
  (`cuentas.avisos` nacía `true`): pedir permiso para lo que ya es el
  producto no es un consentimiento. `privacidad.html` volvió a su estado
  anterior cuando el sistema se fue; si vuelve el aviso, vuelve esa regla.
- **Se marcaba DESPUÉS de enviar, no antes.** La tabla `avisos` era el
  registro de lo ya salido: si el envío fallaba, la fila no se escribía y la
  pasada del día siguiente reintentaba. Marcar antes de enviar agendaría
  avisos perdidos para siempre.
- **PostgREST trunca a 1000 filas sin decir nada.** `max-rows` es 1000 por
  defecto: una consulta que devuelve más sale recortada y sin error. Toda
  lectura de tabla entera tiene que paginar con la cabecera `Range` y leer
  hasta el `Content-Range`.

## El momento de la búsqueda

Al comprobar, la lista se sustituye un beat (~1,4 s) por un marco a página
entera. Contenido: antetítulo, titular («Buscando 390 becas», con el formato
castellano de número), una fila de píldoras con el nivel y el destino con los
que se ha comprobado, un párrafo con las fuentes que se leen (BOE, Erasmus
Mundus, DAAD, Comisión), los tres pasos del método, una promesa, la salida
«Cambiar los filtros» y tres fichas de esqueleto. Cuatro decisiones que
convienen no deshacer:

- **La cifra es de toda la base, no del recorte del filtro.** Lo que se está
  buscando es el corpus entero —igual que en la referencia, «Searching
  53,481 professors»—, y lo que pasa el filtro es lo que la lista enseña al
  terminar.
- **La espera es teatro, y así se queda.** El filtrado es instantáneo: todo
  está ya en el navegador. El marco entra en cadena —titular, párrafo,
  pasos, promesa— con sus retardos (`backwards` + delay), y el número del
  titular **sube de 0 al total** (`contarHasta`, con easing y un pequeño
  golpe al aterrizar): una cifra que avanza cuenta «las que va encontrando»,
  lo que un total estático no cuenta. Por eso el beat es 1,4 s: no hay beat
  que lea un marco entero. Va en `BEAT_BUSQUEDA` (js/becas.js) y se acorta
  para quien pidió menos movimiento —con `animation-delay: 0` en la regla de
  *reduced motion*, que sin él los bloques con retardo aparecerían tarde y de
  golpe, y el contador fijo en el total. El valor que lee un lector de
  pantalla va estático en `.sr-only` (la cuenta que cambia cada frame es
  ruido, no información).
- **Al empezar la búsqueda la página no se queda sin sitio.** El 21 de
  octubre de 2026 se reportó como «no puedo bajar mientras está buscando», y
  no era el scroll del navegador: el cartel sustituye a las 390 fichas, así
  que el documento pasa de 250.000 px a 1.700 y el navegador recorta la
  posición al nuevo final. Hacen falta las dos cosas: `#zona-lista` recibe
  prestado el alto que tenía (`min-height`, con un suelo de pantalla y media
  porque en la primera carga no hay lista que prestar) y se devuelve al
  pintar; y el marco **no** se trae con `scrollIntoView` —ni `start` ni
  `nearest`: con un elemento más alto que la ventana, los dos bajan la página
  663 px y cortan el «Convocatorias abiertas» bajo la cabecera—, sino con una
  comprobación: si el titular ya se ve no se toca, y si no se sube lo justo
  para que caiga por encima de la barra fija. En escritorio no se mueve nada.
  Lo vigilan dos bloques de `test/web.mjs`: «El momento de la búsqueda» (se
  puede bajar de verdad, el cartel no nace tapado y hay esqueletos) y «En
  escritorio» (la página no se mueve y el titular no se corta).
- **Este es el sitio donde NO se imita del todo a la referencia.**
  ProfScout acompaña el titular con un «MATCH 87» en cada ficha y con un
  «RANKING BY WHO'S LIKELY TO REPLY» sobre la lista. Aquí jamás: un encaje
  con porcentaje sería la probabilidad inventada que este producto no enseña
  (ver «El otro límite»). Lo que sí se copia es la forma —titular grande,
  píldoras del filtro y fichas de esqueleto debajo—, que no afirma nada. El
  momento acaba en requisitos y citas, no en un número de suerte.

## Fuentes de datos

| Fuente | Acceso | Notas |
| --- | --- | --- |
| BOE | API abierta, sin clave | `datosabiertos/api/boe/sumario/{fecha}` |
| BOE (texto) | XML por documento | `diario_boe/xml.php?id=...` |
| DAAD | Chrome (WAF) | 153 programas de Alemania, con su nivel |
| Erasmus Mundus | HTML con `fetch` | 217 programas, con los países del consorcio |
| Comisión (SEDIA) | API con `multipart` | Convocatorias de la UE que se piden en nombre propio |
| BDNS | Chrome (WAF) | `infosubvenciones.es`. Da presupuesto, plazo y el enlace a las Bases |

Al añadir un conector nuevo, que degrade en silencio: si el portal cambia,
que devuelva vacío y avise por log, pero no rompa la web.

### Las fuentes de fuera de España

El 19 de octubre de 2026 el sitio prometía «becas de Europa» y solo tenía
España. Ahora hay cuatro fuentes más, y cada una tiene su trampa:

**Erasmus Mundus** (`ingest/erasmus.mjs`). El catálogo de EACEA sirve el
HTML plano, pero **parte los atributos en varias líneas**: `<article
class="ecl-card">` no casa con nada y el conector devolvía una lista vacía
sin dar ningún error. Todos los atributos van con espacios en blanco
flexibles. Y hay **dos catálogos** con marcado distinto: el de Joint
Masters pone el título en un `<span class="ecl-link__label">` y el de
Intra-Africa en un `<div class="ecl-content-block__title">`, sin enlace.
Con solo el primero se perdía la mitad de la cuarta página.

Los **países** no salen en la tarjeta, y la ficha de cada programa contesta
«Sorry» (protección anti-bot). La salida es cruzar el filtro de países del
propio catálogo, que trae 77 con su código ISO. Eso son 92 peticiones, así
que va en un fichero aparte —`data/paises-erasmus.json`— que se regenera a
mano con `node ingest/erasmus-paises.mjs`. Los países de un programa no
cambian, y bajarlos en cada pasada es tirar ancho de banda.

**DAAD** (`ingest/daad.mjs`). `www2.daad.de` contesta 403 a cualquier
`fetch`, aunque lleven las cabeceras completas de un navegador: el WAF lee
la huella de TLS. Solo pasa con Chrome. Ojo con su campo «Country»: es **de
dónde vienes**, no a dónde vas. El destino es Alemania salvo que el
programa diga otra cosa.

Ojo también con su nivel: «Graduates» quiere decir **quien ya tiene un
título**, no «grado». Traducirlo a «Grado» mandaba a un posgraduado al
filtro equivocado.

**La Comisión** (`ingest/ue.mjs`). La API de búsqueda del portal de
financiación (`api.tech.ec.europa.eu/search-api`) **exige `multipart`**.
Con un cuerpo JSON responde 200 y trae 213.936 resultados: el cuerpo se
ignora en silencio. Con `multipart` y una query de Elasticsearch filtra de
verdad. Y el `apiKey=SEDIA` va **una sola vez** en la URL: duplicado sale
con dos `apiKey` y el API contesta 200 con la lista vacía.

Ojo con el estado: «Open for submission» no significa «el plazo está
dentro». Hay convocatoria marcada como abierta con fecha de cierre de 2023.
**La fecha es la verdad** y el conector la mira siempre.

Y solo entra lo que se pide **en nombre propio**. El portal mezcla las
becas de doctorado y postdoctorado con las llamadas a organizaciones, que
son licitaciones. Enseñar una licitación en un buscador de becas miente,
porque quien lo lee no se puede apuntar.

### El filtro de destino y de nivel

El `<select>` de destino guardaba el país en el perfil y **no lo usaba para
nada**: la lista salía entera siempre. Ahora filtra, con dos decisiones
que conviene no deshacer:

- **El destino se guarda como código ISO**, no como nombre. El nombre
  cambia y el código no. `js/paises.js` es la lista única: la usan el
  desplegable y los conectores, y si son dos se desincronizan.
- **Una convocatoria sin destino conocido no se esconde.** Se queda y se
  avisa de cuántas son («N sin destino conocido (también salen)»). Si el
  filtro aparta una beca que sí valía, quien la buscaba no ve el hueco y no
  sabe que faltaba. Enseñar de más cuesta un clic; quitar de más pierde la
  beca sin dejar rastro.
- **La píldora de destino enseña tres países y un «+N».** Un consorcio de
  Erasmus puede tener once, y la píldora se convertía en un muro de texto
  de 589 píxeles. Los que no caben van en el `title`, que es donde se lee
  el detalle. Y el orden es alfabético a propósito: el del catálogo es el
  del recorrido por sus 77 filtros, no el del peso de cada país en el
  consorcio, así que ordenar por nombre no finge una jerarquía que no está.

El **nivel** solo lo traen las fuentes que lo dan como dato estructural
(DAAD). Las Bases del BOE no lo dan: therein «grado» es «grado de
cumplimiento de los objetivos» y «Máster, Doctorado, cursos» es la lista
de cosas que se puede financiar. Buscarlo ahí producía un nivel
inventado para la mitad de las fichas, así que se busca **solo en el
anuncio**, que es donde sí lo dice.

### El WAF de BDNS y el límite de navegadores

BDNS está detrás de un WAF que **no dice que no**: contesta «Acceso
Denegado» a unas peticiones y deja pasar otras. El programa se lo come
como si la ficha no trajera nada, y la consecuencia es una base a la que
le faltan presupuesto, plazo y Bases en una parte de las fichas, **sin
ningún error que lo delate**.

Por eso `bdns.mjs` limita los navegadores abiertos a la vez
(`MAX_NAVEGADORES`, tres). Con seis a la vez, la mitad de las fichas se
quedaban fuera: de seis, entraban una o dos. Con el límite dentro de
`render()`, el orquestador puede pedir seis fichas y tres esperan su turno
en vez de pedirle al WAF que corte.

Y el límite va **dentro** de `render()` y no en el orquestador a propósito:
así vale para todas las fuentes, incluidas las que no conoce quien
orquesta.

### La versión de las reglas de extracción

La caché guarda el **resultado** de extraer, no el texto. El BOE es
inmutable, pero **las reglas cambian**, y entonces la caché se queda con
datos viejos y el fichero sale con una mezcla de dos versiones. Pasó el
19 de octubre de 2026: se añadió el destino y el nivel, y las fichas del
BOE que venían de la caché siguieron sin ellos porque el conector ni se los
descargó. La web enseñaba 390 fichas y el filtro de destino no filtraba
ninguna, sin que nada fallara.

Por eso la caché lleva la versión de las reglas con la que se extrajo
(`VERSION_REGLAS` en `run.mjs`, y `version_reglas` en el propio
`data/becas.json`). Cuando el número cambia, la caché **no vale** y se
vuelve a bajar todo. El número se sube **a mano** cuando cambia una regla
de extracción, y por eso está escrito en mayúsculas: si se olvida, la web
enseña una mezcla de dos versiones y no hay ningún error que lo delate.

### La caché, el pool y el invariante

Tres cosas de la ingesta que no se deducen del código y que costaron un
día cada una.

**La caché se carga ANTES de `recolectar`, y se le pasa como `omitir`.** Es
un detalle de orden, no un ahorro: si se cargara después no habría forma de
saltarse nada, porque para descartar la descarga de un anuncio ya guardado
hay que saber que estaba guardado antes de empezar. Con la caché delante, una
pasada diaria solo baja lo nuevo —unas pocas fichas— en vez de las 577 que
hay en tres días.

**La clave es el id del anuncio del BOE**, no el del registro. Al enriquecer
con BDNS el registro pasa a llamarse `BDNS-910610` aunque venga del anuncio
`BOE-A-2026-8122`, así que con la clave equivocada la caché no acertaba
nunca: **de 577 fichas, 0 reutilizadas**. Y `boeIdBases` es el id del
documento de **Bases**, que no es el anuncio que recorre el sumario.

**Lo que la caché perdona vuelve al fichero.** El conector no baja los
anuncios que ya tiene, así que esas fichas no pasan por `procesar` y nunca
están en `registros`: si al escribir solo se escriben las de `registros`, la
caché se come las fichas. El 19 de octubre de 2026 pasó —la base pasó de
2.626 fichas a 76 y la web se quedó con el 3 % de lo que tenía— y el paso
siguiente salió en verde. `recolectar` devuelve ahora `omitidas` (los ids
que la caché perdonó) y `run.mjs` los vuelve a poner, con `cerrada`
recalculada, porque el de la caché tiene la fecha del día en que se extrajo.

**El pool va por tandas, no con un semáforo**, para que `data/becas.json`
salga siempre con las filas en el mismo orden: el fichero se commitea dos
veces al día, y un diff que reordena las filas enteras cada vez no dice nada
de qué ha cambiado. Subir la concurrencia **no sale gratis** (ver «El WAF de
BDNS»): por eso el número está en una bandera y no escrito en el código.

**Hay un invariante: ni una ficha menos.** Toda convocatoria que el BOE ha
publicado en la ventana y ha pasado el filtro tiene que estar en el fichero.
Si el BOE da N y en el fichero hay menos, `run.mjs` sale con error y **no
escribe el fichero**: la web sigue con el último `becas.json` bueno. La regla
vive en `ingest/ensamblar.mjs` —fuera de `run.mjs` para poder probarla—
y la vigila `test/ensamblar.mjs`. Y `data/becas.json` es **la foto de la
ventana, no un archivo**: contiene lo publicado en los últimos `--dias`
días, más el catálogo de Erasmus Mundus. Lo que se sale de la ventana, fuera.

## El filtro: qué es una beca y qué no

El BOE publica cada día unas 230 noticias y unas 5 convocatorias. Sin filtro,
la base es un periódico. El filtro vive en `ingest/boe.mjs` (`motivoDescarte`)
y se aplica **antes de bajar el texto**, que es una petición por anuncio.

Tres reglas, y **en este orden**:

1. **El veto.** Si el título dice que el documento da fe de algo ya ocurrido o
   que fija una norma, no es una convocatoria. Se acabó el 19 de octubre de
   2026.
2. **La señal del BOE.** El sumario agrupa cada anuncio bajo un `epígrafe`
   («Becas», «Ayudas», «Subvenciones», «Premios»). Es la clasificación del
   propio boletín, y manda.
3. **La señal del título.** «se convocan», «convocatoria», «bases reguladoras»
   —pero solo si van **cerca de una palabra de dinero**.

Tres cosas que no hay que deshacer:

- **El veto va antes que el epígrafe.** Estaba al revés y por eso entraban
  «Orden … por la que se designa el jurado para la concesión del Premio de
  Literatura» (epígrafe «Premios») y los «Real Decreto … por el que se regula
  la concesión directa de una subvención al Obispado de …» (epígrafe
  «Subvenciones»). El epígrafe dice de qué tema va el documento, no de qué
  clase es; la lista de ruido dice de qué clase es. Cuando las dos se
  contradicen, gana la segunda.
- **«Convocatoria» sola no significa «convocatoria de dinero».** El BOE la
  usa también para las juntas de regantes, y en la ventana de 21 días hubo 93
  «convocatoria de Junta General ordinaria» de comunidades de regantes. Por eso
  la señal de llamada solo cuenta si a menos de 110 caracteres hay una palabra
  de dinero. «Se convocan ayudas» sí; «convocatoria de Junta» no.
- **La lista de palabras del título es corta a propósito.** Antes llevaba
  «movilidad» (que está en «Transportes y **Movilidad** Sostenible»), «estancia»
  (dentro de «const**ancia**») y «prácticas». Cada una de esas matchea en un
  documento que no convoca a nadie. Lo que decide es la forma de la
  convocatoria, no un sustantivo suelto.

**Las leyes también se descartan**, y con un patrón anclado: `^ley`, no
`ley`. Una convocatoria de verdad puede citar la ley que la habilita («ayudas
al amparo de la Ley 8/2025»), y vetar eso sería tirar una beca.

Cada descarte se cuenta **con su motivo** en el log de la pasada (`[ruido: N]`,
`[sin señal de convocatoria: N]`). Un descarte con volumen raro se ve ahí y se
revisa; un descarte mudo, no. Los 1.364 descartados de la ventana del 19 de
octubre de 2026 se revisaron uno a uno: 93 juntas de regantes, levantamientos
de actas y dos casos más. **Ninguna beca perdida.**

## Comprobaciones

```bash
node ingest/run.mjs --desde 2025-09-01 --hasta 2025-09-30   # ingesta real
node test/store.mjs                                            # cuentas, sin red
node test/extract.mjs                                          # reglas de extracción
node test/filtro.mjs                                           # qué es una beca y qué no
node test/ensamblar.mjs                                        # lo que llega al fichero
node test/pais.mjs                                             # el filtro de destino
node test/web.mjs                                              # lo que se ve en el navegador
node test/idioma.mjs                                           # el cambio castellano/inglés
node test/sin-avisos.mjs                                       # la retirada de los avisos se queda retirada
npm run test:e2e                                               # todo el sitio, con Playwright
```

La suite de Playwright (`test/e2e/`) es la que mira **el sitio entero**: las
ocho páginas en móvil y en escritorio, el interruptor de idioma en todas
ellas, el buscador con sus filtros y su cartel, la cuenta —la puerta que abre
`cuenta.html` en otra pestaña, el `?desde` que decide la vuelta del alta, la
encuesta de llegada y los ajustes— y la página de Erasmus. Levanta su
propio servidor en el 5174 y no necesita el 5173.

**El servidor de la suite arranca con `BS_SIN_ENV=1`** (en el `webServer` de
`playwright.config.js`) y por eso `serve.mjs` no carga `.env.local`. Sin el
flag, las claves del fichero ponían el almacén en modo Supabase y el alta de
las pruebas nacía en la base real: el 22 de octubre de 2026 había 61 cuentas
de prueba en producción y un corte de red durante la suite salía como 503 del
registro —«el registro de cuentas no está disponible»— que se leía como un
fallo del test. El modo es el del fichero por partida doble: es el que
describe la cabecera de `cuenta.spec.js`, y `data/` se puede borrar sin daño.

```bash
npm install          # solo para las pruebas: @playwright/test
npm run test:e2e     # las dos vistas: móvil (390×844) y escritorio (1280×900)
```

Usa el Chrome del sistema (`channel: 'chrome'`), así que no hace falta
`npx playwright install`.

`test/store.mjs` levanta un Supabase de mentira y comprueba que el almacén
forma bien las peticiones REST; si algún día se cambia una consulta, esa es la
red que lo pilla. Corre sin conexión y sin claves.

`test/extract.mjs` sí existe (desde el 19 de octubre de 2026; antes se
anunciaba aquí y no estaba escrito). Comprueba las reglas de extracción sobre
un XML embebido, sin red, y que la base publicada no tenga requisitos sin cita
ni confunda un presupuesto con el importe de una beca. Es la prueba que
sostiene la regla de que **ningún requisito se muestra sin su cita**.

`test/pais.mjs` comprueba el **filtro de destino y de nivel**: que el
destino aparta lo que debe, que una convocatoria sin destino conocido se
queda, y que la píldora no se convierte en un muro de texto. El filtro
**no filtraba** —guardaba el país en el perfil y no lo usaba para nada— y
no había ninguna prueba que lo dijera.

`test/web.mjs` mide lo que se ve en el navegador: abre Chrome con el
protocolo de depuración, carga la página en un viewport de 390 × 844 y
comprueba que nada se sale de la pantalla, que el filtro recorta de verdad
y que el velo tapa todas las fichas. Es el único test que pilla lo que
solo se ve mirando: una cita con un identificador de 40 caracteres que
empuja la tarjeta fuera de la pantalla, un desplegable con 37 países que no
cabe, una píldora de 589 píxeles. Nada de eso falla en los tests de
lógica, y las dos reglas del proyecto —«¿se lee bien en 390 px?» y «¿hay
una fuente para cada dato?»— son de la página.

Necesita el servidor local:

```bash
node serve.mjs &
node test/web.mjs http://localhost:5173
```

**Si el test falla con cosas raras —«el titular no se lee», un
`Cannot set properties of null»—, mira antes el puerto de depuración.** El
protocolo de Chrome se elige por puerto, y si otro Chrome lo tiene tomado —una
pasada anterior que se quedó colgada, o una captura— el test se engancha a
**ese** navegador y mide una pestaña que no es la suya. Pasó: el test daba
«75 fichas» con la base de 390, porque estaba mirando la pestaña de otro
Chrome que estaba en mitad de su propio bucle de filtros. Fallaba como si
fuera un fallo de la web, y no lo era.

Por eso `test/web.mjs` **busca un puerto libre** antes de abrir el navegador,
en vez de confiar en que el anterior soltó el suyo. Si aun así falla raro,
`ss -ltnp | grep 9222` y, si hay un Chrome ahí, matarlo: la página puede
estar perfectamente bien.

`test/filtro.mjs` comprueba **qué es una beca y qué no**, con títulos
reales del BOE y el epígrafe que les puso el boletín: que un «Real Decreto
por el que se designa el jurado» no entre, y que una «convocatoria de Junta
General» tampoco. Salen del BOE de verdad, no de la red.

`test/ensamblar.mjs` comprueba la regla que se rompió el 19 de octubre de
2026: **ni una ficha menos**. La caché no ahorra solo descargas, decide qué
fichas existen, y un fallo ahí se ve como un número más en el log.

`test/sin-avisos.mjs` guarda la retirada de los avisos. Una retirada no acaba
de morir borrando ficheros: lo que sobrevive en una esquina vuelve a colarse,
y en silencio — una ruta viva responde 200, una clave muerta del diccionario
no da error, un `cron` en `vercel.json` despliega un endpoint que ya no
existe. La prueba levanta su propio servidor y vigila todas las puertas: las
rutas retiradas contestan 404, `/api/yo` no trae la clave que ya nadie lee, el
almacén no exporta sus funciones, el diccionario no conserva sus claves y la
infraestructura no deja puerta abierta. Y la otra cara de la misma jornada: la
etiqueta de Vercel Analytics tiene que seguir en las ocho páginas públicas y
en la plantilla de `ingest/paginas.mjs` — llegó el mismo día que la retirada,
y una regeneración de `erasmus-mundus.html` no puede perderla.

Lo que **no** hay todavía es un test del **filtro** (`motivoDescarte` en
`ingest/boe.mjs`). Hoy se comprueba a mano, mirando el log de la pasada y
revisando la carpeta «sin señal de convocatoria» uno a uno. Es el siguiente
paso natural: las reglas del filtro son las que más se han tocado, y las que
deciden qué ve el estudiante.

### Desplegar

```bash
vercel build --yes --target production
vercel deploy --prod --prebuilt --yes
```

**El commit tiene que estar en GitHub antes de desplegar.** Vercel comprueba
quién es el autor del commit contra el repositorio conectado, y si el commit
solo está en local no lo encuentra: bloquea el despliegue con «the commit
author doesn't have permission to create deployments for this project». Pasó
el 19 de octubre de 2026 tres veces seguidas, y el mensaje no dice nada de que
falte un `git push`. El orden correcto es **commit → push → deploy**.

**`.gitignore` decide lo que sube, y no solo lo que se versiona.** La regla
`*.png` apartaba `og.png` y `logo.png`, así que ni entraron en el repositorio
ni se sirvieron: la tarjeta social y el logo del JSON-LD daban 404 en
producción. Para los ficheros que hay que servir y además versionar, la
excepción va **después** de la regla.

**Y `.vercelignore` es un fichero distinto del `.gitignore`, y el que manda
al desplegar.** Se dio por resuelto dos veces y las dos estaba mal: el 17 de
octubre de 2026 se metieron `data/usuarios.json` y `data/sesiones.json` en el
`.gitignore` —que protege del git, no del despliegue— y el 18 de octubre
resultó que `https://becascout.vercel.app/data/sesiones.json` se servía en
abierto, con las sesiones de las cuentas de prueba dentro. Lo que decide qué
sube a Vercel es `.vercelignore`, y ahí faltaban.

La regla que se queda: **todo lo que no deba leerse por URL va en
`.vercelignore`; el `.gitignore` no lo cubre.** Son dos listas distintas y
una no sustituye a la otra. Los tres ficheros con correos dentro —
`data/usuarios.json`, `data/sesiones.json` y `data/avisos.json` — están en
las dos, y `data/becas.json` en ninguna: ese sí va, porque es el producto.

**Comprobar lo que se sirve, no lo que hay en el disco.** Un despliegue puede
dejar fuera ficheros sin avisar: el 19 de octubre de 2026 un despliegue hecho
desde un *worktree* se llevó por delante `auth/callback.js` y con él el login
con Google, que la CSP bloquea por ser un guion inline. Antes de dar un
despliegue por bueno, pedir las rutas una a una.

Las claves van aparte y una sola vez, con `vercel env add … production`. Cada
cambio de entorno **exige un redesplie**: Vercel no las injecta en caliente, y
una función que se desplegó sin ellas sigue sin ellas dando 503 aunque las
añadas después. Para reventar una clave: `vercel env rm CLAVE production`.

## El idioma: castellano e inglés

El 21 de octubre de 2026 entró un interruptor de idioma. La razón no es
decorativa: buena parte del tráfico de un sitio así llega desde ChatGPT o
Claude, y llega en inglés. Un sitio que solo habla castellano les pide que
se lean una nota antes de ver nada.

Cuatro decisiones que conviene no deshacer:

- **El chip va como hermano de `.top-act`, nunca dentro.** Las dos
  implementaciones de `pintarCabecera()` —la de `js/landing.js` y la de
  `js/becas.js`— vacían ese contenedor con `innerHTML = ''`. Un chip dentro
  desaparece en el primer repintado, sin error y sin que se note hasta que
  alguien pasa el ratón por donde ya no está.
- **Los metadatos no se traducen.** El `<title>`, la `meta description`, los
  `og:*`, el `canonical` y el JSON-LD se quedan en castellano, escritos a
  mano. El rastreo no ejecuta JavaScript: un título traducido en el
  navegador no lo ve nadie de Google. El inglés es para quien lee; el
  castellano es para quien indexa.
- **`?lang=en` se consume una vez y desaparece de la URL.** Si el
  parámetro se queda, cada página compartida con él es una URL distinta y el
  `canonical` deja de ser canónico. De ahí en adelante manda lo que hay
  guardado en `localStorage`.
- **El inglés no suaviza ni inventa obligaciones.** En `privacidad.html` y
  `cookies.html` el castellano se traduce literal: si aquí se dice «no
  vendemos tus datos», allí se dice que no se venden. Un resumen cómodo de
  la política de privacidad es una violation de la política de privacidad.

Y dos cosas de mecanismo:

- **`js/i18n.js` es el diccionario y el que pinta.** `t(clave)` devuelve el
  texto del idioma actual y `alCambiarIdioma(fn)` avisa a lo que tenga que
  repintarse. Lo que se genera en JavaScript —la lista, el cartel de la
  búsqueda, el velo, la barra de abajo— no pasa por `data-i18n`: va por `t()`
  y se repinta con `alCambiarIdioma(() => pintar())`.
- **Los nombres propios no se traducen.** Los programas de Erasmus Mundus,
  los países, los importes y las fechas son del catálogo oficial: se citan
  tal cual.

Lo vigila `test/idioma.mjs`, que además barre los anchos de las seis
páginas. Y `erasmus-mundus.html`, que la genera `ingest/paginas.mjs`, no es
una excepción: su plantilla lleva los mismos `data-i18n` que las demás.

## SEO: lo que se decidió y por qué

El sitio no tiene build, así que el SEO vive en ficheros estáticos: `robots.txt`,
`sitemap.xml`, `llms.txt` y las etiquetas de dentro de cada `.html`. Cuatro cosas
que no son obvias y conviene no deshacer.

**La base canónica es `https://becascout.vercel.app`.** El `rel="canonical"`, el
`og:url` y el `og:image` de las cinco páginas la llevan escrita a mano, porque no
hay motor de plantillas que la rellene. **Si algún día el sitio pasa a un dominio
propio, hay que cambiar esas URLs en las cinco páginas el mismo día**: un
canonical que siga apuntando a vercel.app le dice a Google que el dominio bueno
es el viejo.

**`/index.html` redirige a `/` con un 301** (`vercel.json`), en vez de servirse
las dos. Hasta el 18 de octubre de 2026 el mismo contenido respondía en las dos
direcciones, con el mismo título y la misma descripción: dos copias de la portada
compitiendo entre sí.

**Solo la portada y `sobre.html` son indexables.** `becas.html` va con `noindex`
porque la lista se lee con cuenta —dejarla indexar sería publicar en Google una
lista borrosa, justo lo contrario de lo que enseña la página—, y las de
privacidad y cookies son utilidad, no contenido que deba competir. Por eso el
`sitemap.xml` solo lista esas dos: un sitemap que anuncia URLs `noindex` se
contradice solo.

**Los bots de búsqueda de IA se permiten a propósito**, uno a uno, aunque la
regla general ya los cubra: aparecer citado en una respuesta de ChatGPT o
Perplexity es el objetivo, no el riesgo. Los de entrenamiento también pasan hoy;
para cerrarlos hay un bloque comentado al final de `robots.txt`.

El logo `logo.png` se genera con Chrome headless desde el HTML de `tools/` (que no
se despliega). No es una dependencia en tiempo de ejecución: es una tarea manual,
y si se rediseña la cabecera hay que relanzarlo. La tarjeta social `og.png` se
retiró el 28 de octubre de 2026 a petición del dueño: su generador
(`tools/og.html`) sigue en el repo por si vuelve, y las referencias `og:image` y
`twitter:image` se quitaron de todas las páginas — una meta que apunta a un 404
no anuncia nada.

**La CSP obliga a que no haya JavaScript inline.** `vercel.json` manda una
`Content-Security-Policy` con `script-src 'self'`; por eso el guion de
`auth/callback.html` vive en `auth/callback.js` y no dentro de un `<script>` en
la página. Un bloque inline justo en la que cierra el login se bloquea sin
avisar y el usuario se queda fuera sin ver ningún error. El único inline que
queda es el JSON-LD, que no es código y la CSP no lo toca. Si algún día hay que
añadir otro origen externo (un CDN, un formulario), se añade a la CSP **antes**
de usarlo o deja de funcionar en silencio.

**Las fechas se cambian a mano.** `dateModified` en el JSON-LD y la fecha del pie
de la portada no las calcula nadie: no hay build. Al tocar la portada o
`sobre.html` hay que subir las dos, o el sitio se declara más viejo de lo que es.

**Vercel Analytics lleva una etiqueta propia.** Desde el 29 de octubre de 2026
las páginas públicas llevan `<script defer src="/_vercel/insights/script.js">` —
mismo origen, así que la CSP no se toca. La plantilla de `ingest/paginas.mjs`
también la lleva: si `erasmus-mundus.html` se regenera, sale sola. El interruptor
para contar está en el panel de Vercel (Analytics → Enable), la CLI no lo tiene.
Y las políticas se reescribieron el mismo día para seguir diciendo la verdad:
la analítica es agregada y sin cookies, y «no hay analítica» ya no se dice en
ningún sitio — la estadística de `cuenta.html` pasó a «0 cookies de rastreo»,
que es lo que sigue siendo cero.

## Como configurar Supabase en Vercel

El sitio puede funcionar sin Supabase (la portada y el buscador con cuentas
registradas), pero la cuenta con correo y contraseña no se guarda. Para que el flujo de registro
funcione, hay que añadir tres variables en Vercel (en `vercel.com` → Tu proyecto
→ Variables de entorno → Añadir):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Después de añadirlas, la aplicación podrá confirmar automáticamente una cuenta al
registrarse y mantener las sesiones. Mientras no estén puestas, la página
supabase-config.html se enseña al que llega.

**Las migraciones se aplican con `supabase db push`, y aquí hay que ir por el
pooler.** El proyecto es `pvyszdazcqsynvnkbeme` (eu-west-1) y la contraseña
de Postgres está en `.env.local` (nunca en el repositorio). La conexión
directa a `db.pvyszdazcqsynvnkbeme.supabase.co` **no funciona desde esta
máquina**: el host resuelve solo a IPv6 y aquí no hay ruta, así que sale un
`ECONNREFUSED` que no dice nada del problema. La que sí va es la del pooler
de sesión, que está en `supabase/.temp/pooler-url`:

```bash
supabase db push --db-url "postgresql://postgres.pvyszdazcqsynvnkbeme:$PASS@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
```

El pooler en modo sesión permite DDL y el historial de migraciones sin
problemas. Y para comprobar una migración a mano, `psql` **no está
instalado**: la CLI de Supabase lo hace con `supabase db query`.

Las cuatro migraciones aplicadas hasta el 28 de octubre de 2026: `0001`
(cuentas y sesiones), `0002` (la columna `origen` de la encuesta de llegada),
`0003` (la columna `avisos` y la tabla `avisos`) y `0004` (las suelta: el
sistema de avisos se retiró ese día).

## Lo que no se hace

- No se cobra comisión ni se tramita nada.
- No se republica texto oficial: se enlaza y se resume.
- No se dice que somos oficiales con nadie.
- No se muestran porcentajes de éxito.

## Antes de dar algo por terminado

1. ¿Todo requisito mostrado tiene su cita?
2. ¿La fecha límite viene del documento, no de un cálculo mío?
3. ¿Se lee bien en 390 px?
4. ¿Hay una fuente pública para cada dato, y es un enlace que funciona?


---

## Tareas para la próxima sesión

Estado a cierre del 28 de octubre de 2026: la web funciona, hay cuentas
registradas, la base tiene 390 convocatorias reales y **el sistema de avisos
por correo se retiró** (ver «Los avisos de plazo (retirados)»). Lo que queda,
en orden.

### 1. Las claves de Google — lo único que no se puede hacer desde el repo

La parte que falta es **el proveedor de Google dentro de Supabase**, y es un
panel: no hay fichero que tocar.

**La vía que se eligió: Firebase da las credenciales, Supabase sigue siendo
quien autentica.** No se migra la autenticación a Firebase, y no hace falta:
la sesión de BecasScout la emite el servidor (`bs_sesion`, tabla `sesiones`),
el JWT de Supabase solo sirve para que el backend sepa quién es, y las
tablas están en Postgres. Firebase entra solo como la forma más rápida de
conseguir un *client id* y un *secret* de Google OAuth sin pelearse con la
pantalla de consentimiento.

Los pasos, que están en el panel y no en el repositorio:

1. [console.firebase.google.com](https://console.firebase.google.com) → un
   proyecto nuevo → **Authentication → Sign-in method → Google → Habilitar**.
   Firebase crea solo la pantalla de consentimiento y el cliente OAuth.
2. El **client id** se ve ahí mismo. El **client secret** está en
   [console.cloud.google.com](https://console.cloud.google.com) → APIs &
   Services → Credentials → «Web client (auto-created by Google Service for
   Firebase)».
3. En ese cliente OAuth, **Authorized redirect URIs** tiene que estar
   `https://pvyszdazcqsynvnkbeme.supabase.co/auth/v1/callback` —esta es la
   que Google recibe de verdad, la que canjea el código por el token— y, por
   si acaso, también `https://becascout.vercel.app/auth/callback` y
   `http://localhost:5173/auth/callback`, que son a dónde vuelve el usuario.
4. Supabase → **Authentication → Providers → Google → Enable**, con el id y
   el secret.
5. `vercel env add GOOGLE_CLIENT_ID production` con el client id, y
   redesplegar. La API lo usa para comprobar el `aud` del token de Google.

Sin el paso 3, el flujo muere en Google con un error que no dice que falta
una URL. Ese es el fallo que más tiempo cuesta cuando aparece.

### 2. Desplegar

Hay mucho pushed y nada en producción todavía. El orden es **commit → push →
deploy**, y el commit tiene que estar en GitHub antes del despliegue: Vercel
comprueba el autor contra el repositorio conectado y, si el commit solo
existe en local, bloquea el despliegue con «the commit author doesn't have
permission to create deployments for this project».

**Y `privacidad.html` sigue sin los datos completos del responsable.** La nota
editorial que lo recordaba —«antes de publicar esto hay que sustituir el
nombre y el correo…»— se quedó visible en producción hasta el 29 de octubre
de 2026, que es cuando se quitó de la página pública. El hueco que apuntaba
sigue ahí: el art. 13 del RGPD exige identificación fiscal y domicilio, y la
política solo lleva «BecasScout» y `privacidad@becascout.com`. Es un trámite
del dueño, no del código.

### 3. La cobertura de la extracción

Con reglas salen pocos requisitos de las Bases del BOE: el texto son
20.000–50.000 caracteres de prosa jurídica y las expresiones regulares no
llegan a todo. Mejorar esa cobertura es trabajo de las reglas, no de volver
a meter un modelo. Y cuando cambie una regla, **hay que subir
`VERSION_REGLAS` a mano**: la caché guarda el resultado de extraer, no el
texto, así que con el número viejo el fichero sale con una mezcla de dos
versiones y no hay ningún error que lo delate.

### 4. Lo que sigue abierto de la ingesta

**Cobertura territorial.** De las fichas del BOE salen ministerios y ninguna
de comunidades autónomas, provincias o ayuntamientos. **No es un fallo del
conector:** el sumario del BOE solo trae `metadatos` y `diario`, el boletín
del Estado. Las autonómicas viven en 17 webs y las provinciales en otras 50.

El atajo sería **BDNS**, que es nacional y sí cubre todo el Estado, pero hoy
solo se usa para enriquecer lo que ya viene del BOE. BDNS es una SPA de
Angular que carga de una API interna sin documentar; desmontarla da todos los
municipios y el riesgo de que se rompa sin avisar. Descartado de momento, y
anotado aquí para que no se reintente a ciegas.

Descartada también **EUR-Lex**, que parecía el BOE de la UE: al buscar
becas devuelve contratos de suministros franceses —«Rue de la Bourse», «750
Bourses CFBE»— donde «bourse» es una calle y una compra de software. Es
legislación y contratas, no convocatorias.
