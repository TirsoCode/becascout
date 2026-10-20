-- 0003_avisos.sql — Los avisos de plazo: la promesa de la cuenta, hecha tabla.
--
-- La cuenta de BecasScout existe para una promesa concreta —«avisarte cuando
-- se acerca un plazo», que es la que está en el FAQ de la portada—. Esta
-- migración es la mitad que no se ve: la que evita que el mismo plazo llegue
-- cinco veces.
--
-- ── `avisos` es un registro de lo enviado, no una cola ─────────────────────
--
-- La tabla no dice *qué* hay que mandar —eso lo saca el cron de la base
-- diaria— dice *qué ya se mandó*. Si el envío falla, la fila no se escribe y
-- la pasada del día siguiente reintenta. Marcar antes de enviar agendaría
-- avisos para siempre perdidos: el primer correo que se pierde por un corté
-- de Resend se convertiría en un plazo que nunca se anuncia.
--
-- ── Por qué `default true` en cuentas.avisos ───────────────────────────────
--
-- Opt-out, no opt-in. La promesa del aviso es la razón por la que alguien da
-- su correo: pedirle permiso para avisar en el mismo formulario sería pedirle
-- el producto que ya está pidiendo. Desactivarlo es un clic en la cuenta, y
-- el primer correo que recibe lo recuerda en el pie.
--
-- El `default true` rellena también las filas anteriores a esta columna en el
-- mismo `alter`. Que una cuenta antigua herede el aviso es intencionado: era
-- de quien ya había dado su correo por la promesa. La normalización en JS es
-- `usuario.avisos !== false` —lib/store.js y api/[...ruta].js— porque el modo
-- fichero, que respalda al servidor sin Supabase, no ejecuta migraciones.
--
-- ── La diseño de la tabla ──────────────────────────────────────────────────
--
-- La clave doble (correo, beca) ES la deduplicación: una fila por
-- convocatoria avisada a cada cuenta, para siempre. Postgres rechaza la fila
-- repetida sin que el cron tenga que mirar antes, y el `POST` en bloque va
-- con `resolution=ignore-duplicates` por si a mitad de lote se colara algo ya
-- mandado —ver `guardarAvisos` en lib/store.js—.
--
-- `on delete cascade` por la misma razón que en `sesiones`: los avisos de
-- una cuenta borrada no deben quedar huérfanos apuntando a una fila que ya
-- no existe.
--
-- `beca` guarda el identificador de la ficha (BOE-A-…, BDNS-…), no el título:
-- el identificador es estable y el título cambia con cada republicación.
--
-- Se aplica desde el SQL Editor de Supabase, o con `supabase db push`.

alter table cuentas add column if not exists avisos boolean not null default true;

create table if not exists avisos (
  correo  text        not null references cuentas (correo) on delete cascade,
  beca    text        not null,
  enviado timestamptz not null default now(),
  primary key (correo, beca)
);

-- La pasada del cron lista lo enviado por cuenta para saber si ya se avisó de
-- una ficha. Sin índice, cada pasada escanea la tabla entera.
create index if not exists avisos_correo on avisos (correo);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Igual que en `0001`: las reglas están puestas aunque el servidor use la
-- `service_role`, que las salta. Sin políticas, `anon` y `authenticated` se
-- quedan denegadas: la tabla solo contiene correos y fichas ya avisadas, pero
-- cerrada por defecto cuesta menos que abierta por descuido.

alter table avisos enable row level security;
