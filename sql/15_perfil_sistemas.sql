insert into usuarios (usuario, password_hash, nombre, nombre_aux, rol, campana, cargo, email, activo)
values ('sistemas.pruebas', 'CAMBIAR_ESTA_CLAVE', 'Usuario Sistemas', 'Sistemas', 'SISTEMAS', 'todas', 'Sistemas', '', true)
on conflict (usuario) do nothing;
