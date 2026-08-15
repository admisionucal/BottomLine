import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

// snake_case (Postgres) -> encabezado real de la hoja pagos{campaña}.
const MAPEO_PAGOS: Record<string, string> = {
  id_prometeo: 'ID PROMETEO',
  id_campus: 'ID CAMPUS',
  nombre: 'NOMBRE',
  apellidos: 'APELLIDOS',
  dni: 'DNI',
  celular: 'CELULAR',
  correo: 'CORREO',
  carrera: 'CARRERA',
  mundo: 'MUNDO',
  tipo_carrera: 'TIPO DE CARRERA',
  modalidad_ingreso: 'MODALIDAD DE INGRESO',
  modalidad_estudio: 'MODALIDAD DE ESTUDIO',
  horario_estudio: 'HORARIO DE ESTUDIO',
  tipo_ingreso: 'TIPO DE INGRESO',
  tipo_descuento: 'TIPO DE DESCUENTO',
  detalle_tipo_descuento: 'DETALLE TIPO DE DESCUENTO',
  tipo_descuentos_adicionales: 'TIPO DE DESCUENTOS ADICIONALES',
  vb: 'VB',
  fecha_pago: 'FECHA DE PAGO',
  medio_pago: 'MEDIO DE PAGO',
  status_pago: 'STATUS DE PAGO',
  falta_pagar: 'FALTA PAGAR',
  fecha_promesa_pago: 'FECHA DE PROMESA DE PAGO',
  fecha_pago_completo: 'FECHA DE PAGO COMPLETO',
  status_pago_final: 'STATUS DE PAGO FINAL',
  flag_acepto_conva: 'FLAG ACEPTO CONVA',
  status_matricula: 'STATUS MATRICULA',
  pago_admision: 'PAGO DE ADMISION',
  matricula: 'MATRICULA',
  escala_inicial: 'ESCALA INICIAL',
  escala_final: 'ESCALA FINAL',
  boleta_campus: 'BOLETA CAMPUS',
  desertor: 'DESERTOR',
  reserva_prox_campana: 'RESERVA PROX. CAMPAÑA',
  reserva_heredada: 'RESERVA HEREDADA',
  cod_modular: 'COD_MODULAR',
  rango_distancia: 'RANGO DISTANCIA',
  rango_boleta: 'RANGO BOLETA',
  universidad_instituto_procedencia: 'UNIVERSIDAD Y/O INSTITUTO DE PROCEDENCIA',
  boleta_procedencia: 'BOLETA DE PROCEDENCIA',
  anio_fin_colegio: 'AÑO_FIN_COLEGIO',
  fecha_mes_pago: 'FECHA MES PAGO',
  fecha_semana_pago: 'FECHA SEMANA PAGO',
  fecha_registro_lead: 'FECHA DE REGISTRO LEAD',
  fecha_mes_registro: 'FECHA MES REGISTRO',
  fecha_semana_registro: 'FECHA SEMANA REGISTRO',
  dias_maduracion: 'DIAS DE MADURACION',
  agrupacion_canal: 'AGRUPACION CANAL',
  canal: 'CANAL',
  subcanal: 'SUBCANAL',
  flag_master_new: 'FLAG_MASTER_NEW',
  asesor_homologado: 'ASESOR HOMOLOGADO',
  porcentaje_adelanto: '% DE ADELANTO',
  boleta_proyectada: 'BOLETA PROYECTADA',
  rindio_pau: 'RINDIÓ PAU',
  curso_a_nivelar: 'CURSO A NIVELAR',
  tiene_credenciales: 'TIENE CREDENCIALES',
  fecha_programacion_pau: 'FECHA PROGRAMACION PAU',
  fecha_rindio_pau: 'FECHA RINDIO PAU',
  respuestas_nee: 'Respuestas NEE',
  departamento: 'DEPARTAMENTO',
  provincia: 'PROVINCIA',
  distrito: 'DISTRITO',
  tiene_seguro: 'Tiene Seguro',
  validacion_campus: 'VALIDACION CAMPUS',
  comentarios: 'COMENTARIOS',
  monto_pagar_primera_boleta: 'MONTO A PAGAR - PRIMERA BOLETA',
};

export async function getLeadPayments(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ASESOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idBuscar = String(body.idPrometeo || '').trim();
  const campana = String(body.campana || '').trim();
  if (!idBuscar || !campana) return jsonError('Falta idPrometeo o campaña.');

  const result = await client.query(`select * from leads_pagos where id_prometeo = $1 and campana = $2`, [
    idBuscar,
    campana,
  ]);

  const data = result.rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const [colPg, header] of Object.entries(MAPEO_PAGOS)) {
      obj[header] = row[colPg];
    }
    return obj;
  });

  return jsonOk({ data });
}
