import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

export async function getCatalogos(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const [boletas, beneficios, instituciones, carreras, perfilamiento] = await Promise.all([
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
    client.query(`select tipo, nombre, descripcion from catalogo_perfilamiento order by tipo, nombre`),
  ]);

  const porTipo: Record<string, { nombre: string; descripcion: string }[]> = {
    dolor_necesidad: [],
    porque_elige_carrera: [],
    que_busca_universidad: [],
    quien_financia_carrera: [],
    que_falta_para_decision: [],
    que_otras_opciones: [],
  };
  for (const row of perfilamiento.rows) {
    (porTipo[row.tipo] ??= []).push({ nombre: row.nombre, descripcion: row.descripcion });
  }

  return jsonOk({
    data: {
      boletas: boletas.rows,
      beneficios: beneficios.rows,
      institucionesProcedencia: instituciones.rows.map((r) => ({ nombre: r.nombre, tipo: r.tipo })),
      carrerasProcedencia: carreras.rows.map((r) => r.nombre),
      doloresNecesidades: porTipo.dolor_necesidad,
      porQueEligioCarrera: porTipo.porque_elige_carrera,
      queBuscaUniversidad: porTipo.que_busca_universidad,
      quienFinanciaCarrera: porTipo.quien_financia_carrera,
      queFaltaParaDecision: porTipo.que_falta_para_decision,
      queOtrasOpciones: porTipo.que_otras_opciones,
    },
  });
}