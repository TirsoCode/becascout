-- 0001_cuentas.sql — Alta de las cuentas de BecasScout.
--
-- Dos tablas y no una. La cuenta es una; las sesiones son muchas: alguien
-- puede tener el móvil, el portátil del trabajo y el del casa a la vez, y
-- entrar desde uno no puede cerrar los otros dos. Por eso el token vive en
-- `sesiones` y no como columna en `cuentas` — que era como estaba antes, y
-- hacía que cada login invalidara todos los anteriores.
--
-- El hash de la contraseña y su salt los pone la API con scrypt, no esta
-- tabla. Aquí solo se guarda lo que ya viene hasheado: el fichero con los
-- scrypt se puede perder sin que nadie tenga que cambiar una contraseña.
--
-- Se aplica desde el SQL Editor de Supabase, o con `supabase db push`.

create table if not exists cuentas (
  id      uuid primary key default gen_random_uuid(),
  correo  text        not null unique,
  hash    text        not null,
  salt    text        not null,
  creado  timestamptz not null default now()
);

create table if not exists sesiones (
  token   text        primary key,
  correo  text        not null references cuentas (correo) on delete cascade,
  expira  timestamptz not null,
  creado  timestamptz not null default now()
);

-- El login busca por correo y la sesión se busca por token. Sin estos índices
-- cada petición a /api/yo es un escaneo de la tabla entera.
create unique index if not exists cuentas_correo_key on cuentas (correo);
create index if not exists sesiones_correo on sesiones (correo);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Las reglas están puestas aunque el servidor use la `service_role`, que las
-- salta. El motivo no es el rendimiento: es que si algún día se conecta
-- alguien desde el navegador con la `anon` —que es pública por diseño— las
-- tablas sigan cerradas por defecto en vez de abiertas por descuido.

alter table cuentas enable row level security;
alter table sesiones enable row level security;

-- Ni `anon` ni `authenticated` tienen política alguna, así que les quedan
-- denegadas las cinco operaciones. No se escribe ninguna `for select`
-- explícita: declararla vacía es un error de sintaxis, y declararla con
-- `using (false)` no cambia nada respecto a no declararla.

-- ── Limpieza ───────────────────────────────────────────────────────────────
--
-- Las sesiones caducadas no estorban (la API las filtra por `expira`), pero
-- se pueden borrar cuando quieras:
--
--   delete from sesiones where expira < now();