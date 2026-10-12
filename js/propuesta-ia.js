import { API_URL, puedeVerPropuestaIA } from '../core/constants.js';
import { getCurrentUser, getSessionToken, escapeHtml, getUserCampanas } from '../core/utils.js';

const estado = { campana: null, cargando: false, abiertos: new Set(), ultimo: null, puedeGenerar: false };

async function callAPI(action, data = {}) {
    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, sessionToken: getSessionToken(), ...data }),
        });
        return JSON.parse(await resp.text());
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function iniciar() {
    const user = getCurrentUser();
    const btn = document.getElementById('indTabBtnPropuesta');
    if (!user || !btn) return;
    if (!puedeVerPropuestaIA(user.rol)) {
        btn.remove();
        document.getElementById('indTab-propuesta')?.remove();
        return;
    }
    btn.style.display = '';
    btn.addEventListener('click', () => {
        if (!estado.campana) {
            const campanas = getUserCampanas() || [];
            estado.campana = campanas[campanas.length - 1] || null;
        }
        cargar();
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();

function contenedor() {
    return document.getElementById('indTab-propuesta');
}

function fechaHora(valor) {
    if (!valor) return '';
    const d = new Date(valor);
    return d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function cargar(generar = false) {
    const cont = contenedor();
    if (!cont || estado.cargando) return;
    if (!estado.campana) {
        cont.innerHTML = '<div class="loading">No tienes campañas asignadas.</div>';
        return;
    }
    estado.cargando = true;
    cont.innerHTML = `<div class="loading">${generar ? 'Generando propuesta con IA… (puede tardar hasta un minuto)' : 'Cargando propuesta…'}</div>`;
    const r = await callAPI(generar ? 'generarPropuestaAbordajeAhora' : 'getPropuestaAbordaje', { campana: estado.campana });
    estado.cargando = false;
    if (!r.success) {
        cont.innerHTML = `<div class="loading" style="color:#d32f2f;">${escapeHtml(r.error || 'No se pudo cargar la propuesta.')}</div>`;
        return;
    }
    estado.ultimo = r.data;
    estado.puedeGenerar = !!r.puedeGenerar;
    pintar(r.data, r.puedeGenerar);
}

function pintar(p, puedeGenerar) {
    const cont = contenedor();
    const campanas = getUserCampanas() || [];

    let html = `
    <style>
        .prop-bar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin:6px 0 14px; }
        .prop-bar select { padding:7px 10px; border:1px solid var(--color-border); border-radius:var(--radius); font-size:13px; }
        .prop-meta { font-size:12px; color:var(--color-text-secondary); }
        .prop-card { background:#fff; border:1px solid var(--color-border); border-radius:10px; padding:14px 16px; margin-bottom:12px; box-shadow:var(--shadow-card); }
        .prop-card h4 { margin:0 0 8px; font-size:14px; display:flex; align-items:center; gap:6px; }
        .prop-macro { background:var(--color-info-bg); border-color:#c9dbff; }
        .prop-macro p { font-size:14px; line-height:1.55; margin:0; white-space:pre-wrap; }
        .prop-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:12px; }
        .prop-total { margin-left:auto; font-size:12px; font-weight:700; background:var(--color-primary-light); color:var(--color-primary); border-radius:20px; padding:2px 10px; }
        .prop-regla { font-size:11.5px; color:var(--color-text-muted); margin-bottom:8px; }
        .prop-accion { font-size:13.5px; line-height:1.5; margin:0 0 8px; white-space:pre-wrap; }
        .prop-ids { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
        .prop-ids a { font-size:12px; background:#f3f5f9; border-radius:6px; padding:3px 8px; color:var(--color-primary); text-decoration:none; }
        .prop-ids a:hover { background:var(--color-primary-light); }
        .prop-toggle { background:none; border:none; color:var(--color-primary); font-weight:600; font-size:12.5px; cursor:pointer; padding:0; font-family:inherit; }
        .prop-tabla { width:100%; border-collapse:collapse; font-size:13px; }
        .prop-tabla th, .prop-tabla td { text-align:left; padding:8px 6px; border-bottom:1px solid #eee; vertical-align:top; }
        .prop-tabla th { color:var(--color-text-secondary); font-weight:600; font-size:12px; }
        .prop-error { color:#b71c1c; background:var(--color-danger-bg); border-radius:8px; padding:8px 12px; font-size:13px; margin-bottom:12px; }
    </style>
    <div class="prop-bar">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <label style="font-size:12px; font-weight:600;">Campaña
                <select id="propCampana">${campanas.map((c) => `<option ${c === estado.campana ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
            </label>
            <span class="prop-meta">${p ? `Generada el ${escapeHtml(fechaHora(p.generadoEn))} · ${p.origen === 'manual' ? 'a demanda' + (p.generadoPor ? ' por ' + escapeHtml(p.generadoPor) : '') : 'automática'}` : ''}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
            <span class="prop-meta">Se actualiza a las 10:10, 12:00, 15:00 y 17:00</span>
            ${puedeGenerar ? `<button class="btn-export" id="propGenerar"><span class="material-symbols-outlined" style="font-size:16px;">auto_awesome</span> Generar ahora</button>` : ''}
        </div>
    </div>`;

    if (!p) {
        html += `<div class="loading">Todavía no hay una propuesta para esta campaña. ${puedeGenerar ? 'Usa "Generar ahora" o espera al próximo horario.' : 'Se generará en el próximo horario.'}</div>`;
        cont.innerHTML = html;
        conectar();
        return;
    }

    if (p.error) html += `<div class="prop-error">${escapeHtml(p.error)} Las listas de leads sí están actualizadas.</div>`;

    const r = p.resumen || {};
    html += `<div class="prop-card prop-macro">
        <h4><span class="material-symbols-outlined" style="font-size:18px;">public</span> Para todo el equipo</h4>
        <p>${escapeHtml(p.macro || '—')}</p>
        <div class="prop-meta" style="margin-top:8px;">Bandeja: ${r.leads_gestionables ?? 0} leads gestionables · VP Viva ${r.vp_viva ?? 0} · PP Viva ${r.pp_viva ?? 0} · Volver a llamar ${r.volver_a_llamar ?? 0} · Sin contacto ${r.sin_contacto ?? 0}</div>
    </div>`;

    const grupos = (p.grupos || []).filter((g) => g.total > 0);
    html += `<h4 style="margin:18px 0 10px; font-size:14px;">Por grupo de leads</h4>`;
    html += grupos.length ? '<div class="prop-grid">' + grupos.map((g) => {
        const abierto = estado.abiertos.has(g.clave);
        const ids = g.ids || [];
        return `<div class="prop-card">
            <h4>${escapeHtml(g.titulo)}<span class="prop-total">${g.total}</span></h4>
            <div class="prop-regla">${escapeHtml(g.regla || '')}</div>
            <p class="prop-accion">${escapeHtml(g.accion || 'Sin acción sugerida (revisar manualmente).')}</p>
            <button class="prop-toggle" data-grupo="${escapeHtml(g.clave)}">${abierto ? 'Ocultar leads' : `Ver ${ids.length < g.total ? ids.length + ' de ' + g.total : g.total} ${g.total === 1 ? 'lead' : 'leads'}`}</button>
            ${abierto ? `<div class="prop-ids">${ids.map((x) => `<a href="#" data-lead="${escapeHtml(x.id)}" title="${escapeHtml(x.asesor || '')}">${escapeHtml(x.id)}</a>`).join('')}</div>` : ''}
        </div>`;
    }).join('') + '</div>' : '<div class="cap-empty" style="font-size:13px;color:#888;">No hay leads en ningún grupo.</div>';

    const titulos = Object.fromEntries((p.grupos || []).map((g) => [g.clave, g.titulo]));
    const asesores = p.porAsesor || [];
    html += `<h4 style="margin:18px 0 10px; font-size:14px;">Por asesor</h4>`;
    html += asesores.length ? `<div class="prop-card" style="overflow-x:auto;"><table class="prop-tabla">
        <thead><tr><th>Asesor</th><th>Leads a atender</th><th>Qué hacer primero</th></tr></thead><tbody>
        ${asesores.map((a) => `<tr>
            <td><b>${escapeHtml(a.asesor)}</b><br><span class="prop-meta">${a.total} ${a.total === 1 ? 'lead' : 'leads'} distintos</span></td>
            <td>${Object.entries(a.conteos || {}).map(([k, n]) => `<div class="prop-meta">${escapeHtml(titulos[k] || k)}: <b>${n}</b></div>`).join('')}</td>
            <td>${escapeHtml(a.accion || '—')}</td>
        </tr>`).join('')}
        </tbody></table></div>` : '<div style="font-size:13px;color:#888;">Sin datos por asesor.</div>';

    if (p.modelo) html += `<p class="prop-meta" style="margin-top:10px;">Generada con ${escapeHtml(p.proveedor === 'claude' ? 'Claude' : 'Workers AI')} (${escapeHtml(p.modelo)}).</p>`;

    cont.innerHTML = html;
    conectar();
}

function conectar() {
    const cont = contenedor();
    cont.querySelector('#propCampana')?.addEventListener('change', (e) => {
        estado.campana = e.target.value;
        estado.abiertos.clear();
        cargar();
    });
    cont.querySelector('#propGenerar')?.addEventListener('click', () => cargar(true));
    cont.querySelectorAll('[data-grupo]').forEach((b) => b.addEventListener('click', async () => {
        const k = b.dataset.grupo;
        if (estado.abiertos.has(k)) estado.abiertos.delete(k); else estado.abiertos.add(k);
        pintar(estado.ultimo, estado.puedeGenerar);
    }));
    cont.querySelectorAll('[data-lead]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = `lead-detail.html?id=${encodeURIComponent(a.dataset.lead)}&campana=${encodeURIComponent(estado.campana)}`;
    }));
}
