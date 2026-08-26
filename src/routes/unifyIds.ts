import type { Client } from 'pg';
import { jsonOk, jsonError, type JsonBody } from '../types';
import { exigirSesion } from '../lib/session';

// Igual que parsearHistorial() en code.gs: nunca truena si el JSON viene mal.
function parsearHistorial(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

interface SecundarioInput {
  id: string;
  campana: string;
}

// Permite cruzar campañas):
//      { idsSecundarios: [{ id, campana }, ...] }
function normalizarSecundarios(body: JsonBody): SecundarioInput[] {
  const campanaFallback = String(body.campana || body.campanaPrincipal || '').trim();

  if (Array.isArray(body.idsSecundarios) && body.idsSecundarios.length > 0 && typeof body.idsSecundarios[0] === 'object') {
    return body.idsSecundarios
      .map((x: any) => ({ id: String(x.id || '').trim(), campana: String(x.campana || campanaFallback).trim() }))
      .filter((s: SecundarioInput) => s.id && s.campana);
  }

  const idsSecundarios: string[] = Array.isArray(body.idsSecundarios)
    ? body.idsSecundarios.map((x: any) => String(x).trim())
    : [String(body.idSecundario || '').trim()];

  return idsSecundarios.filter((id) => id).map((id) => ({ id, campana: campanaFallback }));
}

export async function unifyIds(client: Client, body: JsonBody) {
  const { sesion, error } = await exigirSesion(client, body, ['SUPERVISOR', 'ADMISION']);
  if (!sesion) return jsonError(error!);

  const idPrincipal = String(body.idPrincipal || '').trim();
  const campanaPrincipal = String(body.campanaPrincipal || body.campana || '').trim();
  const datosPredominantes = body.datosPredominantes || {};
  const confirmado = body.confirmado === true;

  if (!idPrincipal || !campanaPrincipal) return jsonError('Falta idPrincipal o campaña del principal.');

  const existe = await client.query(
    `select 1 from leads where id_prometeo = $1 and campana = $2 and en_base = true`,
    [idPrincipal, campanaPrincipal]
  );
  if (existe.rows.length === 0) return jsonError('El ID Principal debe existir en la hoja base');

  const todosSecundarios = normalizarSecundarios(body);
  const secundariosValidos = todosSecundarios.filter(
    (s) => !(s.id === idPrincipal && s.campana === campanaPrincipal)
  );
  if (secundariosValidos.length === 0) return jsonError('No hay IDs secundarios válidos');

  // ------------------------------------------------------------------
  // ¿algún secundario (en su propia campaña) tiene pagos registrados? 
  // Si sí, el frontend pide confirmación al usuario.
  // ------------------------------------------------------------------
  const idsArr = secundariosValidos.map((s) => s.id);
  const campanasArr = secundariosValidos.map((s) => s.campana);
  const pagosCheck = await client.query(
    `select p.id_prometeo, p.campana
     from leads_pagos p
     join unnest($1::text[], $2::text[]) as t(id_prometeo, campana)
       on p.id_prometeo = t.id_prometeo and p.campana = t.campana`,
    [idsArr, campanasArr]
  );
  const idsConPago = pagosCheck.rows.map((r) => `${r.id_prometeo} (${r.campana})`);

  if (idsConPago.length > 0 && !confirmado) {
    return Response.json({
      success: false,
      requiereConfirmacion: true,
      idsConPago,
      error:
        `El/los ID(s) ${idsConPago.join(', ')} tiene(n) pagos registrados (leads_pagos). ` +
        `Al unificar, ese registro se fusionará con el principal y se eliminará de la base de leads. ` +
        `¿Confirmas que quieres continuar?`,
    });
  }

  try {
    await client.query('begin');

    for (const { id: idSecundario, campana: campanaSecundario } of secundariosValidos) {
      // -------------------- 1) leads_bottom (comentarios/historial) --------------------
      const [principalRes, secundarioRes] = await Promise.all([
        client.query(`select comentarios_historial from leads_bottom where id_prometeo = $1 and campana = $2`, [
          idPrincipal,
          campanaSecundario,
        ]),
        client.query(`select comentarios_historial from leads_bottom where id_prometeo = $1 and campana = $2`, [
          idSecundario,
          campanaSecundario,
        ]),
      ]);

      if (principalRes.rows.length > 0) {
        const historialPrincipal = parsearHistorial(principalRes.rows[0].comentarios_historial);
        const historialSecundario = parsearHistorial(secundarioRes.rows[0]?.comentarios_historial);

        let historialFinal: any[];
        const modo = datosPredominantes.historial;
        if (modo === 'id1') historialFinal = historialPrincipal;
        else if (modo === 'id2') historialFinal = historialSecundario;
        else {
          historialFinal = [...historialPrincipal, ...historialSecundario].sort(
            (a, b) => new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime()
          );
        }

        await client.query(
          `update leads_bottom set comentarios_historial = $1::jsonb, actualizado_en = now()
           where id_prometeo = $2 and campana = $3`,
          [JSON.stringify(historialFinal), idPrincipal, campanaSecundario]
        );
        await client.query(`delete from leads_bottom where id_prometeo = $1 and campana = $2`, [
          idSecundario,
          campanaSecundario,
        ]);
      } else if (secundarioRes.rows.length > 0) {
        await client.query(
          `update leads_bottom set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
          [idPrincipal, idSecundario, campanaSecundario]
        );
      }

      // -------------------- 2) solicitudes (recategorización) --------------------
      // El índice único de PENDIENTE es por (id_prometeo, campana), así que
      // el chequeo de choque también va dentro de la campaña del secundario.
      const pendientePrincipal = await client.query(
        `select 1 from solicitudes where id_prometeo = $1 and campana = $2 and status = 'PENDIENTE'`,
        [idPrincipal, campanaSecundario]
      );
      if (pendientePrincipal.rows.length > 0) {
        await client.query(
          `update solicitudes set status = 'CANCELADO', fecha_resolucion = now(), admin_email = $1
           where id_prometeo = $2 and campana = $3 and status = 'PENDIENTE'`,
          [sesion.email, idSecundario, campanaSecundario]
        );
      }
      // Se reasigna el id_prometeo pero se conserva la campaña original de
      // cada solicitud: así queda registro de en qué campaña ocurrió.
      await client.query(
        `update solicitudes set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
        [idPrincipal, idSecundario, campanaSecundario]
      );

      // -------------------- 3) solicitudes_cc (CC) --------------------
      await client.query(
        `update solicitudes_cc set id_prometeo = $1, actualizado_en = now()
         where id_prometeo = $2 and campana = $3`,
        [idPrincipal, idSecundario, campanaSecundario]
      );

      // -------------------- 4) leads_pagos --------------------
      const [pagoPrincipal, pagoSecundario] = await Promise.all([
        client.query(`select * from leads_pagos where id_prometeo = $1 and campana = $2`, [
          idPrincipal,
          campanaSecundario,
        ]),
        client.query(`select * from leads_pagos where id_prometeo = $1 and campana = $2`, [
          idSecundario,
          campanaSecundario,
        ]),
      ]);

      if (pagoSecundario.rows.length > 0) {
        if (pagoPrincipal.rows.length === 0) {
          await client.query(
            `update leads_pagos set id_prometeo = $1 where id_prometeo = $2 and campana = $3`,
            [idPrincipal, idSecundario, campanaSecundario]
          );
        } else {
          const p = pagoPrincipal.rows[0];
          const s = pagoSecundario.rows[0];
          await client.query(
            `update leads_pagos set
               status_pago_final = $1,
               fecha_pago_completo = $2,
               fecha_promesa_pago = $3,
               actualizado_en = now()
             where id_prometeo = $4 and campana = $5`,
            [
              p.status_pago_final || s.status_pago_final || '',
              p.fecha_pago_completo || s.fecha_pago_completo || '',
              p.fecha_promesa_pago || s.fecha_promesa_pago || '',
              idPrincipal,
              campanaSecundario,
            ]
          );
          await client.query(`delete from leads_pagos where id_prometeo = $1 and campana = $2`, [
            idSecundario,
            campanaSecundario,
          ]);
        }
      }

      // -------------------- 5) eliminar el secundario de `leads` --------------------
      await client.query(`delete from leads where id_prometeo = $1 and campana = $2`, [
        idSecundario,
        campanaSecundario,
      ]);
    }

    const camposAAplicar: Record<string, string> = {};
    if (datosPredominantes.beneficio) camposAAplicar.beneficio = datosPredominantes.beneficio;
    if (datosPredominantes.boleta) camposAAplicar.boleta_final = datosPredominantes.boleta;
    if (datosPredominantes.status) camposAAplicar.estado_aprobacion = datosPredominantes.status;

    if (Object.keys(camposAAplicar).length > 0) {
      const cols = Object.keys(camposAAplicar);
      const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
      await client.query(
        `update leads_bottom set ${sets}, actualizado_en = now() where id_prometeo = $1 and campana = $2`,
        [idPrincipal, campanaPrincipal, ...cols.map((c) => camposAAplicar[c])]
      );
    }

    await client.query('commit');
  } catch (e: any) {
    await client.query('rollback');
    return jsonError('Error al unificar: ' + (e?.message || String(e)));
  }

  return jsonOk({
    message: `Fusión completada: ${secundariosValidos.length} registro(s) unificado(s) al principal ${idPrincipal} (${campanaPrincipal}). Interacciones reasignadas y registro(s) secundario(s) eliminado(s) de leads, sin importar la campaña de origen.`,
  });
}