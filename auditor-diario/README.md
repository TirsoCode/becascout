# Auditor diario (IA) para BecasScout

Corre **una vez cada 3 días** con GitHub Actions. Usa **Playwright** para recorrer el
sitio, recopila errores de consola, recursos rotos, desbordes, enlaces muertos y el
flujo completo de crear cuenta, y pide a una IA en la nube que genere un informe
`.md` detallado para pasárselo a `opencode`.

## Cómo funciona

```
GitHub Actions (cada 3 días, 03:00 UTC)
→ Playwright recorre las 7 páginas en móvil (390px) y escritorio (1280px), 2 rondas
→ Prueba el flujo de cuenta: puerta → cuenta.html → alta/entrada → encuesta → sesión
→ Revisa el buscador AUTENTICADO (sin velo, requisitos con cita, beat de búsqueda)
→ Si la cuenta la creó él mismo, la BORRA al final (no queda rastro)
→ Elige el mejor modelo VIVO del día en OpenRouter y en Google AI Studio
→ Genera reports/bug-report-*.md + reports/raw-*.json (datos en crudo)
→ Lo commitea al repo y avisa por ntfy (opcional)
```

## Los modelos: elegidos cada pasada, no escritos a mano

Los ids de modelos rotan —se ha comprobado con el catálogo real: en una semana los
free de OpenRouter cambiaron todos—. Un id escrito a mano es una escritura que
muere sin avisar. Por eso **cada pasada pregunta al propio proveedor qué modelos
viven HOY** y elige el mejor de los que hay:

- **NVIDIA (primero)**: el pedido fue explícito — MiniMax vía
  [build.nvidia.com](https://build.nvidia.com). El catálogo (`/v1/models`) se baja
  en cada pasada, se descartan embeddings/rerankers/visión, y manda todo lo que
  sea `minimaxai/` (hoy `minimax-m3.1-flash`). Si el catálogo no contesta, relevo
  con ids completos verificados.
- **OpenRouter (segundo)**: filtra los gratis (precio 0/0 o `:free`) con contexto
  ≥ 64k, **excluye Gemini-Flash a propósito** (su free se agota a diario y en
  Google AI Studio va mejor de fuente), y ordena por lista de preferencia +
  heurística de calidad. Prueba hasta 3 candidatos distintos.
- **Google AI Studio (tercero)**: pregunta con `ListModels` qué modelos aceptan
  `generateContent` hoy y ordena por preferencia (`gemini-flash-latest`,
  `gemini-2.5-flash`…). Si el preferido ya no está, pasa al siguiente.
- **Cadena**: NVIDIA → OpenRouter → Gemini → informe determinista (con los datos
  en crudo) si la nube entera falla. El job sale en rojo, pero el informe SIEMPRE
  se escribe.

## Qué revisa

- Estado HTTP, título, errores de consola y `pageerror` en cada página
- Recursos del propio origen que responden 4xx/5xx o no cargan
- Desborde horizontal en 390px y 1280px, con los elementos culpables
- Enlaces internos rotos (GET con timeout, tope 25/página para no machacar)
- Botones mudos, `href` vacíos, imágenes sin `alt` o rotas, ids repetidos
- **becas.html sin sesión**: fichas tapiadas por el velo, barra de acceso al pie,
  píldoras de menos de 320px
- **El alta de verdad**: la puerta abre `cuenta.html` en OTRA pestaña, el
  formulario funciona, la encuesta sale y se puede pasar, la cabecera pinta la
  sesión y las puertas desaparecen
- **becas.html con sesión**: sin velo, con fichas, y **cada requisito con su cita**
  (`.req-src`) — la regla que gobierna todo el proyecto
- El beat de búsqueda termina y la sesión muere con la cuenta borrada

## Por qué no tumba la web

Todo va en serie, con `timeout` en todo, esperas entre páginas, cabecera
identificativa y **una sola cuenta efímera por pasada** (`auditor.<fecha>@bs-auditor.test`,
contraseña aleatoria que no se registra en ningún sitio) que se borra al terminar
con `DELETE /api/cuenta`. No hay bucle infinito: 2 rondas y 3 reintentos por página.
Si hay secrets de cuenta permanente, ENTRA con ella y no crea ni borra nada.

## Secretos necesarios

En `Settings > Secrets and variables > Actions`:

| Secreto | Requerido | Notas |
| --- | --- | --- |
| `SITE_URL` | Sí | La web a auditar: `https://becascout.vercel.app` |
| `NVIDIA_API_KEY` | Recomendado | [build.nvidia.com](https://build.nvidia.com) — MiniMax va por aquí |
| `OPENROUTER_API_KEY` | No | [openrouter.ai/keys](https://openrouter.ai/keys) — segundo de la cadena |
| `GEMINI_API_KEY` | No | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — tercero |
| `NVIDIA_MODEL` | No | Clava UN modelo de NVIDIA; si muere, cae al dinámico |
| `TEST_EMAIL` | No | Cuenta permanente para ENTRAR (no se crea ni borra nada) |
| `TEST_PASSWORD` | No | Su contraseña (≥ 10 caracteres) |
| `OPENROUTER_MODEL` | No | Ídem para OpenRouter |
| `GEMINI_MODEL` | No | Ídem para Google AI Studio |
| `NTFY_TOPIC` | No | Topic de [ntfy.sh](https://ntfy.sh/) para el aviso al móvil |

Sin `TEST_EMAIL`/`TEST_PASSWORD` el auditor crea su propia cuenta efímera en cada
pasada — que es como se prueba el alta entera de verdad — y la borra al final.

## Ejecutarlo

Desde GitHub: `Actions > Auditor Diario IA > Run workflow`.

En local (contra el servidor de desarrollo):

```bash
cd auditor-diario
npm install
SITE_URL=http://localhost:5173 \
NVIDIA_API_KEY=xxx OPENROUTER_API_KEY=xxx GEMINI_API_KEY=xxx \
node auditor.mjs
```

El informe queda en `../reports/`, listo para pasárselo a `opencode`.
