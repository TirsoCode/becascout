-- 0005_pregunta_origen.sql
--
-- Anota lo que preguntaste al asistente, para entender el flujo.
-- (null = no lo dijo, no se fuerza nada)
--
-- Se añade después de 0002_origen.sql y 0004_sin_avisos.sql.
--
-- Aplicar con: supabase db push
--
alter table cuentas add column if not exists origen_pregunta text;