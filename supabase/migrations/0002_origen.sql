-- 0002_origen.sql — De dónde llega quien se registra.
--
-- Una columna en `cuentas` y no una tabla aparte: la respuesta es una por
-- cuenta —se pregunta una vez, al crearla— y no hay serie histórica que
-- guardar. `origen_en` solo dice cuándo se contestó.
--
-- NULL es un estado legítimo: hay cuentas anteriores a esta pregunta y gente
-- que pasa sin contestar. «No lo sabemos» no se rellena con un valor por
-- defecto, igual que una convocatoria sin plazo no se marca como cerrada.
--
-- La lista de respuestas permitidas vive en la API (`ORIGENES` en
-- api/[...ruta].js) y no como `check` aquí: añadir una opción nueva no debería
-- exigir migrar la tabla, y un `check` desincronizado rechazaría en silencio
-- —la web escribe sin esperar respuesta— una respuesta que la interfaz sí
-- ofrecía.
--
-- Se aplica desde el SQL Editor de Supabase, o con `supabase db push`.

alter table cuentas add column if not exists origen text;
alter table cuentas add column if not exists origen_en timestamptz;
