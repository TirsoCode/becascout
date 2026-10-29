-- El sistema de avisos de plazo se retiró el 28 de octubre de 2026: sin
-- proveedor de correo configurado, la promesa «te avisamos» no se podía
-- sustentar, y una promesa que no se cumple es peor que ninguna. La cuenta
-- sigue existiendo para lo suyo: abrir el buscador.
--
-- `sesiones` y `avisos` referencian `cuentas` con `on delete cascade`, así
-- que soltar la tabla no deja filas huérfanas detrás.
drop table if exists avisos;
alter table cuentas drop column if exists avisos;
