# Spec — BecasScout

> El ProfScout de las becas que nadie lee. Escaneamos las convocatorias
> oficiales, les sacamos los requisitos en lenguaje llano y te decimos
> cuáles cumples y cuánto tiempo te queda.

Estado: MVP en construcción · Ámbito: España (v0), Europa (v1)

---

## 1. El problema

Cada año se dejan sin usar miles de millones de euros en becas
universitarias, de intercambio y de fundaciones privadas. Por dos motivos
que no son el mismo:

1. **No se enteran de que existen.** Se publican en el BOE, en la sede del
   ministerio y en el portal de cada universidad. Nadie mira ninguno de los
   tres.
2. **Cuando las encuentran, no las entienden.** Una convocatoria son 40–80
   páginas de Bases escritas para el funcionario que la redactó y el abogado
   que la revisó, no para el estudiante de segundo año que tiene que decidir
   este mes si se va a Alemania o se queda.

BecasScout ataca sobre todo la segunda. Descubrir que existe una beca es un
problema de búsqueda, y para eso ya hay portales administrativos.
Convertir 60 páginas en «te faltan dos documentos y el plazo acaba el día
14» es un problema de comprensión, y para eso no hay nada.

## 2. Qué es, y qué no

**Es** un buscador que lee la convocatoria, devuelve los requisitos como
lista comprobable y enlaza al original.

**No es** un intermediario. No tramitamos, no gestionamos la solicitud, no
cobramos comisión, no somos ni el ministerio ni la universidad. Si fallamos
en un requisito, la consecuencia la lleva el estudiante; el diseño está
orientado a que eso no pase.

### 2.1 El límite del producto: no hay probabilidades

La idea original era decir «tiene un 85 % de probabilidad de que le den esta
beca de 3.000 € en Alemania». **Se descartó, y no por difícil, sino por
falso.**

No existen datos de solicitudes ni de adjudicaciones de estas convocatorias.
Un 85 % ahí no es una estimación: es una cifra inventada con apariencia de
estadística. Si un estudiante con un 7,5 ve «85 %» y no lo consigue, no hay
defensa posible, porque nunca fue una predicción.

Lo que sí es cierto y verificable es **qué requisitos cumples**:

> Cumples 7 de 8. Los que te faltan: acreditar nivel B2 de inglés y
> presentar un proyecto. El plazo acaba en 10 días.

Cada requisito lleva **la cita literal del párrafo del que salió**, con su
página en el BOE. Eso se comprueba en diez segundos y sirve más que
cualquier porcentaje.

La interfaz habla siempre de requisitos, nunca de probabilidad de obtenerla.
Cuando no sabemos algo, la respuesta es «no lo sabemos», y se dice.

## 3. Alcance

| Versión | Fuentes | Nota |
| --- | --- | --- |
| v0 | BOE | Sin clave, sin coste, datos estructurados |
| v1 | + DAAD, Erasmus Mundus, Campus France, Study in NL | Un conector por semana |

El BOE entra primero porque es la única fuente con API pública real. Los
portales europeos se scraping y cada uno se rompe cada pocos meses, así que
van de uno en uno.

**No entran:** oposiciones (tienen idéntica forma de título que las becas y
son el ruido principal), convocatorias cerradas (se conservan con
`cerrada: true` para el histórico), y becas de investigación y de
contratación, que son otro producto.

## 4. Sistema de datos

```sql
becas (
  id            text primary key,   -- BOE-A-2025-18290
  titulo        text,
  organisador   text,               -- "Universidad de Córdoba"
  ambito        text,               -- "Estatal" | CCAA | municipal
  seccion       text,
  pagina        int,                -- página en el BOE
  publicada     date,
  cierra        date,
  cerrada       bool,
  importe       numeric,
  url           text,               -- siempre al original
  texto         text                -- solo para depuración, no se envía al front entero
)

requisitos (
  beca_id       text references becas,
  tipo          text,               -- nota_minima | edad_max | idioma | …
  etiqueta      text,               -- "Nota media mínima"
  valor         jsonb,
  obligatorio    bool,
  cita          text,               -- literal del documento. NO NULL
  extractor     text                -- 'reglas'. El camino con 'llm' se quitó el
                                    -- 18 de octubre de 2026: añadía requisitos
                                    -- que tampoco se podían enseñar sin cita,
                                    -- así que no resolvía nada y costaba clave
                                    -- y factura
)
```

**`cita` es NOT NULL y es la pieza central del esquema.** Sin ella el
producto no tiene nada que ofrecer frente a un buscador normal.

## 5. Pipeline

```
sumario BOE (JSON, gratis)
   → filtro por título + sección        [barato, descarta el 97 %]
   → descarga del XML del anuncio       [caro, solo los que pasan]
   → extracción de requisitos           [por reglas, con cita]
   → data/becas.json
```

El orden importa: el sumario no trae el texto, y traer el texto de todo lo
que se publica en el BOE cada día es absurdo. Se filtra antes de pagar.

### 5.1 Extracción

Por reglas de expresión regular: deterministas, gratuitas y sin clave. Cada
requisito guarda el fragmento literal del que se sacó, y uno sin cita no se
guarda.

Medición real (BOE, 8–30 sept 2025): 56 becas detectadas en 3 semanas,
~970/año en temporada alta. De 40 fichas, el camino por reglas sacó
**9 requisitos**. El rendimiento es bajo —las Bases son prosa jurídica de
20.000 a 50.000 caracteres— y mejorarlo es trabajo de las reglas. Hubo un
camino con modelo que se quitó el 18 de octubre de 2026: los requisitos que
añadía tampoco se podían enseñar sin cita, así que no resolvía el problema.

## 6. Matching

Por reglas explícitas, sin modelo. El estudiante ve **qué requisitos cumple
y cuáles no**, con el motivo a la vista.

Un requisito es:

- `cumple` — el perfil lo satisface
- `no_cumple` — el perfil lo incumple, con el dato concreto («tu nota es
  6,8 y piden 7,0»)
- `desconocido` — la convocatoria no lo concreta, y el estudiante no lo ha
  dicho

`desconocido` es un estado de primera clase. Un estudiante que ve «cumples
5 de 8» tiene una información falsa; uno que ve «cumples 5, no puedes saber
3» tiene información verdadera.

## 7. Diseño

Arrancamos del tono de [ProfScout](https://profscout.com/), pero la identidad
es otra: papel cálido en vez de verde frío, `--brand` `#12463A` para la acción
primaria y nada más, Instrument Serif para display y una retícula editorial
con filetes en vez de tarjetas con sombra. ProfScout no se copió: copiar la
paleta entera habría hecho la web indistinguible de la referencia.

La marca propia es el **anillo de requisitos cumplidos**: un círculo que
rellena según cuántos requisitos satisface, con el número en el centro.
No es un porcentaje de éxito, es una cuenta de requisitos, y la interfaz lo
distingue en todo momento.

Colores con significado, no decorativos:

| Color | Significado |
| --- | --- |
| verde pino | acción primaria |
| oro | convocatoria en revisión, datos incompletos |
| cielo | el plazo se acaba, menos de 15 días |
| rojo | cerrada o descartada |

Móvil primero, y el anillo está en la esquina superior derecha de la
tarjeta, que es donde cae el pulgar.

## 8. Cuentas

Google OAuth, **solo el scope `email`**, que es el único que no dispara la
revisión de la pantalla de consentimiento de Google. Los scopes sensibles
exigen verificación previa y ralentizan el lanzamiento sin aportar nada
aquí.

El email existe para una cosa: avisar de plazos. Perfil en `localStorage` y
funciona entero sin cuenta; entrar es opcional y solo habilita el aviso.

Con cuentas hay GDPR: política de privacidad y borrado de datos a petición.
La web usa una sola cookie —la de sesión— y no pide consentimiento
(«consentimiento del art. 22.2.c RGPD, exento para el servicio pedido», ver
`cookies.html`). El aviso de plazo es el servicio que una hace al dar el
correo, no una newsletter: por eso se quita con un clic en la cuenta y no
necesita doble opt-in.

## 9. Legal

Se publican datos derivados y un enlace al original. No se republica el
texto íntegro, no se dice que hay acuerdo con nadie, y cada convocatoria
muestra su fuente oficial con fecha y página.

## 10. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Requisito mal extraído | Cita obligatoria; el estudiante verifica |
| Portal europeo cambia | Conectores aislados, degradan en silencio |
| Base demasiado fina | Sin citas, no se guarda nada |
| Producto confundido con un IES oficial | Enlace a la fuente en cada tarjeta |
| Confianza sin base | Se muestra «desconocido», no se rellena el hueco |

## 11. Qué cuenta como terminado

- [ ] Ingesta real del BOE reproducible con un comando
- [ ] Todo requisito mostrado lleva cita comprobable
- [ ] Se lee bien a 390 px
- [ ] Cada dato tiene su enlace a la fuente oficial
- [ ] Funciona sin cuenta