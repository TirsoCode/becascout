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

## Estructura

```
index.html            portada. No enseña ni una beca
becas.html            buscador. Contenido pixelado hasta tener cuenta
styles.css            sistema de diseño
serve.mjs             servidor estático para desarrollo
js/
  landing.js          portada
  becas.js            buscador, matching y el bloqueo
  auth.js             Google OAuth y sesión
js/
  config.js           URL de la API y configuración pública
  supabase.js         inicio de sesión con Google vía Supabase
  supabase-client.js  cliente de Supabase desde CDN, sin build
api/
  [...ruta].js        la API entera como una función (ver más abajo)
auth/
  callback.html       receptor del token de Google
lib/
  store.js            cuentas y sesiones. Postgres, con fichero de respaldo
ingest/
  boe.mjs             Boletín Oficial del Estado (sin clave, sin coste)
  xml.mjs             parser de XML mínimo, sin dependencias
  extract.mjs         requisitos, con LLM o por reglas
  run.mjs             orquesta la ingesta
supabase/migrations/  SQL de las tablas
test/
  store.mjs           el almacén contra un Supabase de mentira
data/becas.json       salida de la ingesta
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
adorno: la cuenta es lo único que permite avisar de plazos, que es la razón
por la que alguien daría su correo a un desconocido.

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

## Fuentes de datos

| Fuente | Acceso | Notas |
| --- | --- | --- |
| BOE | API abierta, sin clave | `datosabiertos/api/boe/sumario/{fecha}` |
| BOE (texto) | XML por documento | `diario_boe/xml.php?id=...` |
| DAAD | HTML | Conector pendiente, se rompe seguido |
| Erasmus Mundus | JSON de la aplicación | Conector pendiente |

Al añadir un conector nuevo, que degrade en silencio: si el portal cambia,
que devuelva vacío y avise por log, pero que no rompa la web.

## Comprobaciones

```bash
node ingest/run.mjs --desde 2025-09-01 --hasta 2025-09-30   # ingesta real
node test/store.mjs                                            # cuentas, sin red
```

`test/store.mjs` es la única prueba que hay. Levanta un Supabase de mentira y
comprueba que el almacén forma bien las peticiones REST; si algún día se cambia
una consulta, esa es la red que lo pilla. Corre sin conexión y sin claves.

**`test/extract.mjs` y el test de `xml.mjs` que se anunciaban aquí no existen.**
Se documentaron y no se escribieron. Son el siguiente paso natural: las reglas
de extracción son justo lo que más se ha tocado y lo que menos se ha probado, y
el requisito de que cada uno lleve su cita es la regla que sostiene el producto.
Salen de un XML embebido, sin red.

### Desplegar

```bash
vercel build --yes --target production
vercel deploy --prod --prebuilt --yes
```

Las claves van aparte y una sola vez, con `vercel env add … production`. Cada
cambio de entorno **exige un redesplie**: Vercel no las injecta en caliente, y
una función que se desplegó sin ellas sigue sin ellas dando 503 aunque las
añadas después. Para reventar una clave: `vercel env rm CLAVE production`.

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

Estado a cierre del 16 de octubre de 2026: la web funciona, hay cuentas con
contraseña y hay 78 convocatorias reales. Lo que queda, en orden.

### 1. La extracción por reglas — resuelto quitando el modelo

**Hecho el 18 de octubre de 2026.** `extract.mjs` va por reglas, que es
determinista y no necesita ninguna clave. Se quitó el camino con modelo (vía
OpenRouter): añadía una clave, una dependencia externa y una factura para unos
pocos requisitos más, y como nada se enseña sin su cita, no arreglaba el
problema del producto —solo lo movía de sitio—.

Con reglas salen pocos requisitos de las Bases del BOE: el texto son
20.000–50.000 caracteres de prosa jurídica y las expresiones regulares no llegan
a todo. Mejorar esa cobertura es trabajo de las reglas, no de volver a meter un
modelo.

### 2. Terminar Supabase — la base está hecha, falta el botón de Google

**Hecho el 17 de octubre de 2026.** Proyecto `pvyszdazcqsynvnkbeme`
(eu-west-1), tablas `cuentas` y `sesiones` creadas con `supabase db push` desde
`supabase/migrations/0001_cuentas.sql`, y las tres variables en Vercel
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Las claves
están también en `.env.local`, que no se sube a ningún sitio.

**Lo que falta** es solo el proveedor de Google dentro de Supabase:
Authentication → Providers → Google → meter el client id y el secret de Google
Cloud. Redirect URIs a autorizar:
`https://becascout.vercel.app/auth/callback` y
`http://localhost:5173/auth/callback`.

Hasta entonces el botón de Google usa el flujo antiguo con Google Identity
Services, que funciona. El correo y la contraseña ya van contra Postgres.

### 3. Ampliar la ingesta

**Lo que ya no es el problema: la concurrencia.** El bucle de fichas iba
secuencial, una detrás de otra, y ahí se iba el tiempo. Ahora va en pool, a 6 a
la vez por defecto, con `--concurrencia N` para cambiarlo. Dos cosas de ahí que
no son óbvies:

- El pool va **por tandas**, no con un semáforo, para que `data/becas.json` salga
  siempre con las filas en el mismo orden. El fichero se commitea y un diff que
  reordena las 85 entradas cada vez no dice nada de qué ha cambiado.
- Subir la concurrencia **no sale gratis**. BDNS va detrás de un WAF y cuando
  te corta contesta «Acceso Denegado» **sin dar error**: el programa lo trata
  como «esta ficha no trae nada» y la beca se queda sin presupuesto ni plazo
  sin que nada se caiga. Ese es el motivo de que el número esté en una bandera
  y no sea un 20 escrito en el código.

**La descarga también está cacheada (esto era el bloqueo).** Antes la caché
solo guardaba los requisitos, y se consultaba *después* de haber bajado el
texto, que es lo caro. Una pasada de tres días bajaba 577 XML cada vez. Ahora:

- La caché se carga **antes** de `recolectar` y se le pasa como `omitir`, para
  que el conector no baje lo que ya tiene. Si se cargara después no habría
  forma de saltarse nada.
- Se indexa por `boeIdBases ?? id`, no por `id`. Al enriquecer con BDNS el
  registro pasa a llamarse `BDNS-910610` aunque venga del anuncio
  `BOE-A-2026-8122`, así que con la clave anterior la caché no acertaba nunca:
  **de 577 fichas, 0 reutilizadas.**
- Lo que ya estaba guardado y cae fuera de la ventana **se arrastra**. Por eso
  `--dias` decide qué se mira hoy, no qué sobrevive, y una única pasada
  profunda rellena el archivo entero para siempre. Sin esto habría que repetir
  la pasada de seis meses cada día para no perder nada.

### Cobertura: lo que hay y lo que no

A 17 de octubre de 2026, de las fichas del BOE salen ministerios y ninguna de
comunidades autónomas, provincias o ayuntamientos. **No es un fallo del
conector:** el sumario del BOE solo trae `metadatos` y `diario`, el boletín del
Estado. Las autonómicas viven en 17 webs y las provinciales en otras 50.

El atajo sería **BDNS**, que es nacional y sí cubre todo el Estado, pero hoy
solo se usa para enriquecer lo que ya viene del BOE. BDNS es una SPA de Angular
que carga de una API interna sin documentar; desmontarla da todos los municipios
y el riesgo de que se rompa sin avisar. Descartado de momento, y anotado aquí
para que no se reintente a ciegas.

Descartada también **EUR-Lex**, que parecía el BOE de la UE: al buscar
becas devuelve contratos de suministros franceses —«Rue de la Bourse», «750
Bourses CFBE»— donde «bourse» es una calle y una compra de software. Es
legislación y contratas, no convocatorias.

### 4. Avisos de plazo

Es la razón por la que alguien daría su correo, y no está hecho. Necesita
tabla `avisos`, cron diario y envío de correo (Resend o SES). Solo tiene
sentido cuando haya plazos reales en la base, que depende del punto 1.

### 5. Limpiar las cuentas de prueba

Resuelto. `data/usuarios.json` y `data/sesiones.json` están en el `.gitignore`,
igual que sus `.tmp.json`. Los ficheros con cuentas de prueba que había se
borraron al migrar a Postgres: ahora las cuentas de verdad viven en
Supabase, y en la base solo hay lo que alguien se ha registrado de verdad.

### 6. `SPEC.md` y `AGENTS.md` estaban desfasados

- La sección de cookies de `SPEC.md` decía que la pantalla de consentimiento
  iba primero y luego pasó al final del pie. El aviso ya no existe: se quitó el
  18 de octubre de 2026. La web usa una sola cookie —la de sesión—, su política
  está enlazada en el pie y no hay consentimiento que pedir
  (`cookies.html`, art. 22.2.c del RGPD).
- El árbol de `AGENTS.md` ya incluye `api/`, `lib/`, `auth/`, `test/` y
  `supabase/migrations/`. **Resuelto el 17 de octubre de 2026.**

### 7. Encuesta de llegada — hecho el 18 de octubre de 2026

Al crear la cuenta —y solo entonces— sale una pregunta que se puede pasar: de
dónde nos ha conocido (ChatGPT, Claude, Instagram, TikTok, YouTube, Reddit, un
amigo), cada una con el logotipo de la plataforma a color. La
respuesta vive en `cuentas.origen` y no en el navegador: lo que se quiere saber
es por dónde llega la gente, y eso en `localStorage` no se puede contar. Se
pregunta una vez, se conteste o se pase, y a quien vuelve a entrar no se le
pregunta.

Dos cosas que no son obvias y conviene no deshacer:

- **`registro-google` responde `nuevo`**, y con eso decide la web si pregunta.
  El callback de Google (`auth/callback.html`) deja la bandera en
  `sessionStorage` porque la página que crea la cuenta no es la que aterriza.
- **La lista de respuestas está en dos sitios**: `ORIGENES` en `js/auth.js` (lo
  que se enseña) y `ORIGENES` en `api/[...ruta].js` (lo que se acepta). El
  filtro del servidor no es paranoia: la columna es un texto que el navegador
  manda, y sin lista cerrada entraría lo que a alguien le apeteciera escribir.

**Falta aplicar la migración `supabase/migrations/0002_origen.sql`** en el
proyecto de Supabase (`supabase db push`, o pegarla en el SQL Editor). Hasta
entonces la pregunta se enseña igual, pero la respuesta se pierde en silencio
al no existir la columna.
