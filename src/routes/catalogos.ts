import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

export async function getCatalogos(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const [boletas, beneficios, instituciones, carreras] = await Promise.all([
    client.query(
      `select tipo_ingreso as "TIPO_INGRESO",
              boleta_procedencia_min as "BOLETA_PROCEDENCIA_MIN",
              boleta_procedencia_max as "BOLETA_PROCEDENCIA_MAX",
              boleta_base as "BOLETA_BASE",
              beca_aplicable as "BECA_APLICABLE",
              boleta_con_beca as "BOLETA_CON_BECA"
       from catalogo_boletas order by id`
    ),
    client.query(
      `select tipo as "TIPO", valor as "VALOR", label as "LABEL", modo as "MODO"
       from catalogo_beneficios order by id`
    ),
    client.query(`select nombre, tipo from catalogo_instituciones_procedencia order by nombre`),
    client.query(`select nombre from catalogo_carreras_procedencia order by nombre`),
  ]);

  return jsonOk({
    data: {
      boletas: boletas.rows,
      beneficios: beneficios.rows,
      institucionesProcedencia: instituciones.rows.map((r) => ({ nombre: r.nombre, tipo: r.tipo })),
      carrerasProcedencia: carreras.rows.map((r) => r.nombre),
    },
  });
}
