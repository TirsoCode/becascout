# Prompt para otro modelo de IA

Copia todo lo que hay entre las líneas `---` de este fichero y pásaselo tal cual.

---

Trabajas en el repositorio `/home/tirso/becascout` (proyecto Node.js con módulos ES, sin dependencias en tiempo de ejecución, sin build). **Lee `AGENTS.md` de la raíz antes de tocar nada**: ahí están las reglas del proyecto, las convenciones y las cosas que no se deshacen.

Hay OTRO agente trabajando en paralelo en el mismo repositorio, pero en **ficheros distintos de los tuyos**. Tu trabajo toca EXCLUSIVAMENTE:

- `js/auth.js`
- `js/i18n.js`
- `api/[...ruta].js`
- `lib/store.js`
- `supabase/migrations/0005_pregunta_origen.sql` (fichero nuevo)
- `test/store.mjs`
- `test/idioma.mjs`

**NO toques** `styles.css`, `js/becas.js`, `js/landing.js`, `js/cuenta.js`, `index.html`, `becas.html`, `cuenta.html`, `ingest/`, `test/web.mjs`, `test/filtro.mjs` ni ningún otro fichero. Si crees que hay que tocar uno de esos, NO lo toques: dilo en tu respuesta final. No hagas `git commit`, `git add`, `git checkout` ni `git stash`.

## Contexto: qué hay ahora

El sitio pregunta, **una sola vez**, justo después de crear la cuenta, de dónde nos ha conocido el visitante. La pregunta está en `js/auth.js`, función `abrirEncuesta()`, y el modal se construye con `innerHTML`.

Hoy:

1. Cada opción de la lista lleva el **logotipo SVG de la plataforma** (ChatGPT, Claude, Instagram, TikTok, YouTube, Reddit) más un icono de persona para «Un amigo». Los logotipos están en la constante `ICONOS` de `js/auth.js` (líneas ~192-200). **El sitio ha decidido quitar todos los iconos**: la regla general del proyecto ahora es que no hay ni un SVG en la web. Tienes que borrar `ICONOS` y quitar el `<span class="enc-ico">` del marcado.
2. El modal es pequeño: `.modal` tiene `max-width: 420px` en `styles.css`. **El dueño quiere el panel de la encuesta más grande.** Como no puedes tocar `styles.css`, mete el tamaño con estilos en línea o con propiedades CSS aplicadas desde JS (por ejemplo `caja.style.maxWidth = '560px'` y `caja.style.padding = '40px'`). Deja un comentario en el código explicando que el tamaño va en línea a propósito y que hay que moverlo a `styles.css` cuando el otro agente deje de tocar ese fichero.
3. Para **ChatGPT** y **Claude** el dueño quiere que, al pulsar la opción, se pregunte **qué le preguntaste**: es decir, un segundo paso con un campo de texto libre donde la persona escribe lo que le preguntó al asistente, y esa respuesta se guarda.

## Lo que tienes que hacer

### 1. `js/auth.js` — quitar iconos y ensanchar el panel

- Borra la constante `ICONOS` entera.
- En `abrirEncuesta()`, quita el `<span class="enc-ico">${ICONOS[v]}</span>` del botón de cada opción. El botón queda solo con su texto.
- Ensancha el modal de la encuesta (más ancho y con más aire), con estilos en línea como se explica arriba.
- La aspa de cerrar (`<button class="modal-x">`) también lleva un SVG dentro. **Quítalo** y deja la aspa como texto: usa el carácter `×` (multiplicación) dentro del botón, con `aria-label` intacto. El `.modal-x` ya está posicionado por CSS, así que el texto se ve bien.

### 2. `js/auth.js` — el segundo paso para ChatGPT y Claude

Al pulsar la opción **ChatGPT** o **Claude**, en vez de enviar y cerrar directamente:

- Muestra un **segundo paso dentro del mismo modal**: un `<h3>` con una pregunta tipo «¿Qué le preguntaste?» y un `<input type="text">` (o `textarea`) con un `placeholder` y un botón de enviar. Añade también un enlace o botón de **volver** al paso anterior, porque el paso se puede pasar: quien no quiere escribirlo, pasa.
- Si la persona escribe algo y envía, se guarda `origen` (el valor `chatgpt` o `claude`) **y** la pregunta escrita.
- Si pasa sin escribir, se guarda solo el `origen`, como hasta ahora.
- Los **otros cinco orígenes** (Instagram, TikTok, YouTube, Reddit, amigo) siguen igual: un clic, se guarda y se cierra.

El texto del modal, los `placeholder` y los botones van por el diccionario (`t('clave')`), **no en castellano dentro del código**. Añade las claves nuevas a `js/i18n.js` con su versión `es` y `en`.

La lista `ORIGENES` de `js/auth.js` (los valores `chatgpt`, `claude`, …) y la lista `ORIGENES` de `api/[...ruta].js` (los valores aceptados) **deben seguir siendo las mismas**. Añadir una opción nueva es dos líneas, una en cada sitio; **no añadas ninguna opción nueva**.

### 3. La API y el almacén: guardar la pregunta

La pregunta escrita es texto libre que escribe una persona: **no puede ir en la lista cerrada de orígenes**. Va en su propia columna.

- **Migración nueva** `supabase/migrations/0005_pregunta_origen.sql`: una columna de texto en `cuentas`, `alter table cuentas add column if not exists origen_pregunta text;`. Copia el estilo y los comentarios de las migraciones anteriores (`0002_origen.sql`): explican el porqué, y un `NULL` es un estado legítimo (quien no escribió nada). **No la apliques**: eso lo hace el dueño con `supabase db push`. Déjala solo en el fichero.
- **`lib/store.js`**: `guardarOrigen(correo, origen)` ahora recibe un tercer argumento opcional, la pregunta. Firma: `guardarOrigen(correo, origen, pregunta = null)`. Debe guardar `origen_pregunta` junto a `origen` y `origen_en`, en las dos ramas: la de Supabase (el `PATCH` con `origin`/`origen_pregunta`/`origen_en`) y la del fichero local (`d[c].origen_pregunta = pregunta`). Si la pregunta es `null` o vacía, guarda `null`.
- **`api/[...ruta].js`**: en `anotarOrigen()`, acepta también `pregunta` del cuerpo. **Límite de tamaño**: recorta a 500 caracteres (es texto libre de un formulario; más de eso es un abuse). **Nunca lo interpoles en HTML sin escapar**. Pasa la pregunta a `guardarOrigen`.
- La respuesta que se manda desde el navegador ahora tiene dos campos: `{ origen, pregunta }`. La lista cerrada `ORIGENES` del servidor **no cambia**: sigue validando `origen` igual que ahora.

### 4. Tests

- **`test/store.mjs`**: hay un test de `guardarOrigen` (busca «guardarOrigen anota la respuesta»). Añade uno nuevo que compruebe que la pregunta se guarda en `origen_pregunta` y que no pisa el resto de la fila. **No rompas el test existente**: sigue teniendo que pasar.
- **`test/idioma.mjs`**: hay un bloque «La encuesta de llegada» que comprueba que la encuesta trae **siete** opciones y que la séptima («Un amigo») sale traducida. Los cambios no pueden romperlo: sigue habiendo siete opciones y la séptima sigue siendo «A friend» en inglés. Como ahora la encuesta tiene un segundo paso, **añade una comprobación** de que al pulsar ChatGPT aparece el campo de la pregunta, y que el título del paso sale en inglés (no en castellano) con el idioma puesto en inglés.

## Cómo comprobar que lo hiciste

```bash
cd /home/tirso/becascout
node test/store.mjs
node test/idioma.mjs
```

`test/idioma.mjs` necesita el servidor local:

```bash
node serve.mjs &
node test/idioma.mjs http://localhost:5173
```

(Si el puerto 5173 está ocupado, `test/idioma.mjs` acepta la URL como argumento. Si no puedes levantarlo, dilo.)

Los dos tienen que salir en verde. Si `test/idioma.mjs` falla por algo que **no** sea tuyo (por ejemplo, otra cosa que se esté cambiando a la vez en `styles.css` o en `js/becas.js`), **no lo arregles**: dilo en la respuesta final y sigue.

## Reglas del proyecto que no se rompen

- **Comentarios en español**, y explican **por qué**, no qué. Los comentarios largos van donde una decisión es rara o donde algo se rompió antes.
- **Ningún dato se muestra sin su cita.** (Aquí no aplica: es una respuesta de encuesta.)
- El servidor **nunca confía en el navegador**: por eso la lista de orígenes se comprueba en el servidor aunque el navegador mande lo que quiera.
- **Cero dependencias en tiempo de ejecución.** No añadas ninguna.
- Nombres en español en el dominio (`origen`, `pregunta`) y en inglés en lo técnico.

## Cuando termines, responde con

1. Qué ficheros has tocado y qué has hecho en cada uno (con `fichero:línea`).
2. Las **claves nuevas** que has añadido al diccionario, con sus dos idiomas.
3. La salida de `node test/store.mjs` y de `node test/idioma.mjs` (completa, no resumida).
4. El texto exacto que se le pregunta al visitante en el segundo paso, en castellano y en inglés.
5. Si tuviste que saltarte algo y por qué, y qué necesita el dueño (por ejemplo, aplicar la migración).

---

## Nota para quien lo usa

Si el otro modelo no termina todo, lo que **no** puede faltar para que la web no se rompa es esto:

1. Que `js/auth.js` no referencie `ICONOS` (si lo quitas mal, el JavaScript lanza `ReferenceError` y la encuesta no abre).
2. Que el `PATCH` de `lib/store.js` siga mandando `origen` y `origen_en` (si los quitas, se pierde la respuesta y `test/store.mjs` falla).
3. Que la lista de orígenes del servidor no cambie.
