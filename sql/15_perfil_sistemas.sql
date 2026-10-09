-- ================================================================
-- PERFIL SISTEMAS (pruebas)
-- ================================================================
-- SISTEMAS tiene todos los permisos de ADMISION y, además, ve las
-- funciones que todavía están en prueba (hoy: Capacitación IA).
-- Asesores, supervisores y admisión NO ven esas funciones.
--
-- No se puede crear desde la pantalla de usuarios (a propósito):
-- solo desde aquí, en el SQL Editor de Supabase.
--
-- Recomendado: un usuario APARTE para pruebas, así tu usuario de
-- Admisión queda igual que siempre.

-- Opción A: crear un usuario nuevo de pruebas.
-- Cambia usuario, nombre, email y la contraseña temporal. La contraseña
-- se guarda en texto plano solo hasta el primer login: en ese momento
-- Rumbo la convierte a hash automáticamente.
insert into usuarios (usuario, password_hash, nombre, nombre_aux, rol, campana, cargo, email, activo)
values ('sistemas.pruebas', 'CAMBIAR_ESTA_CLAVE', 'Usuario Sistemas', 'Sistemas', 'SISTEMAS', 'todas', 'Sistemas', '', true)
on conflict (usuario) do nothing;

-- Opción B: convertir un usuario existente en SISTEMAS (descomentar).
-- update usuarios set rol = 'SISTEMAS' where usuario = 'TU_USUARIO';

-- Para volver un usuario a su perfil anterior:
-- update usuarios set rol = 'ADMISION' where usuario = 'TU_USUARIO';

-- El perfil se toma al iniciar sesión: después de cambiarlo, cerrar
-- sesión y volver a entrar.
