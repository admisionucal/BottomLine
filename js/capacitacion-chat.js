import { API_URL, esRolSupervisorOAdmision, puedeVerCapacitacionIA } from '../core/constants.js';
import { getCurrentUser, getSessionToken, escapeHtml, formatearFecha } from '../core/utils.js';
import { Sidebar, renderTable, Toast } from '../core/components.js';

const ESPERA_ANTES_DE_RESPONDER_MS = 2500;
const SILENCIO_FIN_TURNO_MS = 1300;
const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOZ_SOPORTADA = !!Reconocedor && 'speechSynthesis' in window;
const HINT_CHAT = 'También puedes escribir <b>FINALIZAR SIMULACIÓN</b> en el chat. Tú inicias la conversación, como en la bandeja real.';
const HINT_LLAMADA = 'Habla con normalidad: cuando haces una pausa, el cliente te responde. Usa audífonos para que el micrófono no capte su voz. También puedes decir <b>FINALIZAR SIMULACIÓN</b>.';
const FRASE_FIN = 'FINALIZAR SIMULACION';

const state = {
    user: null,
    esAdmin: false,
    panel: null,
    sesionId: null,
    encabezado: null,
    ficha: null,
    cola: [],
    timer: null,
    esperando: false,
    finalizando: false,
    canal: 'chat',
    ultimaSesion: null,
    escenarios: [],
    asignacion: { escenarioId: null, asesores: [], marcados: new Set() },
};

let toast = null;

const voz = { activa: false, rec: null, escuchando: false, pausado: false, hablando: false, bloqueado: false, buffer: '', parcial: '', timer: null, voz: null };

async function callAPI(action, data = {}) {
    const payload = { action, sessionToken: getSessionToken(), ...data };
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
        });
        return JSON.parse(await response.text());
    } catch (error) {
        return { success: false, error: error.message };
    }
}

const $ = (id) => document.getElementById(id);
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const horaAhora = () => new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const claseScore = (v, umbralAlto, umbralMedio) => (v >= umbralAlto ? 'sc-alta' : v >= umbralMedio ? 'sc-media' : 'sc-baja');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

document.addEventListener('DOMContentLoaded', () => init(false));

window.initCapacitacionEmbebido = function () {
    return init(true);
};

let eventosConectados = false;

async function init(embebido) {
    if (!$('capacitacionApp')) return;
    state.user = getCurrentUser();
    if (!state.user) {
        window.location.href = 'index.html';
        return;
    }
    state.esAdmin = esRolSupervisorOAdmision(state.user.rol);
    if (!puedeVerCapacitacionIA(state.user.rol)) {
        if (!embebido && !document.querySelector('.sidebar-nav')) {
            new Sidebar({ active: 'usuario' });
        }
        $('capacitacionApp').innerHTML = '<div class="loading">Capacitación IA aún no está disponible para tu perfil.</div>';
        return;
    }

    if (eventosConectados) {
        if (!state.sesionId && !state.finalizando) {
            mostrarVista('inicio');
            await cargarPanel();
        }
        return;
    }
    eventosConectados = true;

    if (!embebido && !document.querySelector('.sidebar-nav')) {
        new Sidebar({ active: 'usuario', activeSubitem: 'navUsuarioCapacitacion' });
    }
    toast = new Toast();

    const root = $('capacitacionApp');
    root.querySelectorAll('.admin-only').forEach((el) => { el.style.display = state.esAdmin ? '' : 'none'; });
    root.querySelectorAll('.cap-tab').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));
    root.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => $(b.dataset.cerrar).classList.remove('show')));

    const ta = $('chatTexto');
    ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarDesdeInput(); }
    });
    ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
        if (state.cola.length) programarEnvio();
    });
    $('chatEnviar').addEventListener('click', enviarDesdeInput);
    $('chatFinalizar').addEventListener('click', finalizar);
    $('chatSalir').addEventListener('click', salirSinEvaluar);

    $('eqFiltrar').addEventListener('click', cargarEquipo);
    $('escNuevo').addEventListener('click', () => abrirEscenario(null));
    $('escGuardar').addEventListener('click', guardarEscenario);
    $('asigGuardar').addEventListener('click', guardarAsignacion);
    $('asigBuscar').addEventListener('input', pintarListaAsignacion);
    $('asigTodos').addEventListener('click', () => { filtrarAsesores().forEach((a) => state.asignacion.marcados.add(a.usuario)); pintarListaAsignacion(); });
    $('asigNinguno').addEventListener('click', () => { state.asignacion.marcados.clear(); pintarListaAsignacion(); });

    $('llamadaListo').addEventListener('click', cerrarTurnoVoz);
    $('llamadaMic').addEventListener('click', alternarMicrofono);
    if (VOZ_SOPORTADA) speechSynthesis.addEventListener?.('voiceschanged', () => { if (voz.activa) elegirVoz(state.ficha?.nombre); });

    window.addEventListener('beforeunload', (e) => {
        if (state.sesionId && (state.cola.length || state.esperando)) { e.preventDefault(); e.returnValue = ''; }
    });

    await cargarPanel();
}

function mostrarVista(v) {
    if (v !== 'chat') detenerLlamada();
    $('vistaInicio').style.display = v === 'inicio' ? '' : 'none';
    $('vistaChat').style.display = v === 'chat' ? '' : 'none';
    $('vistaFeedback').style.display = v === 'feedback' ? '' : 'none';
    window.scrollTo(0, 0);
}

function cambiarTab(tab) {
    $('capacitacionApp').querySelectorAll('.cap-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('tabPracticar').style.display = tab === 'practicar' ? '' : 'none';
    $('tabHistorial').style.display = tab === 'historial' ? '' : 'none';
    $('tabEquipo').style.display = tab === 'equipo' ? '' : 'none';
    $('tabEscenarios').style.display = tab === 'escenarios' ? '' : 'none';
    if (tab === 'equipo') cargarEquipo();
    if (tab === 'escenarios') cargarEscenarios();
}

async function cargarPanel() {
    const r = await callAPI('simGetPanel');
    if (!r.success) {
        $('tabPracticar').innerHTML = `<div class="loading">Error: ${escapeHtml(r.error || 'No se pudo cargar')}</div>`;
        return;
    }
    state.panel = r;
    const chip = $('capProveedor');
    chip.style.display = '';
    chip.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">memory</span> ${r.proveedor === 'claude' ? 'Claude' : 'Workers AI (prueba)'}`;
    pintarPracticar();
    pintarHistorial();
}

function pintarPracticar() {
    const p = state.panel;
    let html = '';

    if (p.enCurso) {
        html += `<div class="cap-banner">
            <span><b>Tienes una práctica sin terminar</b> (${escapeHtml(p.enCurso.escenarioPublico || p.enCurso.titulo)}).</span>
            <span style="display:flex; gap:8px;">
                <button class="btn-primary" data-continuar="${escapeHtml(p.enCurso.id)}">Continuar</button>
                <button class="btn-secundario" data-descartar="${escapeHtml(p.enCurso.id)}">Descartar</button>
            </span></div>`;
    }

    html += `<div class="cap-section-title"><span class="material-symbols-outlined">assignment</span> Asignadas a ti</div>`;
    if (!p.asignaciones.length) {
        html += `<div class="cap-empty">No tienes prácticas asignadas por ahora.</div>`;
    } else {
        html += '<div class="cap-grid">' + p.asignaciones.map((a) => {
            const hecho = !!a.finalizadoEn;
            const limite = a.fechaLimite ? `Hasta el ${escapeHtml(formatearFecha(a.fechaLimite))}` : '';
            return `<div class="cap-card ${hecho ? 'done' : ''}">
                <span class="cap-nivel">Nivel ${a.nivel} ${hecho ? '· Completada' : '· Pendiente'}</span>
                <h4>${escapeHtml(a.titulo)}</h4>
                <p>${escapeHtml(a.objetivo || '')}${limite ? `<br><small>${limite}</small>` : ''}
                   ${hecho ? `<br><small>Último resultado: Conversación ${Number(a.conversacion).toFixed(0)} · Precisión ${Number(a.precision).toFixed(0)}</small>` : ''}</p>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn-primary" data-asignacion="${a.id}">${hecho ? 'Practicar de nuevo' : 'Empezar'}</button>
                    ${botonLlamada(`data-asignacion-llamada="${a.id}"`)}
                    ${hecho ? `<button class="btn-secundario" data-ver="${escapeHtml(a.sesionId)}">Ver feedback</button>` : ''}
                </div>
            </div>`;
        }).join('') + '</div>';
    }

    html += `<div class="cap-section-title"><span class="material-symbols-outlined">sports_esports</span> Práctica libre</div>`;
    html += '<div class="cap-grid">' + p.escenarios.map((e) => `
        <div class="cap-card">
            <span class="cap-nivel">Nivel ${e.nivel} · ${escapeHtml(p.niveles[e.nivel]?.nombre || '')}</span>
            <h4>${escapeHtml(e.titulo)}</h4>
            <p>${escapeHtml(e.objetivo || p.niveles[e.nivel]?.detalle || '')}</p>
            <div class="cap-acciones">
                <button class="btn-primary" data-escenario="${e.id}">Practicar</button>
                ${botonLlamada(`data-escenario-llamada="${e.id}"`)}
            </div>
        </div>`).join('') + '</div>';

    const cont = $('tabPracticar');
    cont.innerHTML = html;
    cont.querySelectorAll('[data-escenario]').forEach((b) => b.addEventListener('click', () => iniciar({ escenarioId: Number(b.dataset.escenario) })));
    cont.querySelectorAll('[data-asignacion]').forEach((b) => b.addEventListener('click', () => iniciar({ asignacionId: Number(b.dataset.asignacion) })));
    cont.querySelectorAll('[data-escenario-llamada]').forEach((b) => b.addEventListener('click', () => iniciar({ escenarioId: Number(b.dataset.escenarioLlamada) }, 'llamada')));
    cont.querySelectorAll('[data-asignacion-llamada]').forEach((b) => b.addEventListener('click', () => iniciar({ asignacionId: Number(b.dataset.asignacionLlamada) }, 'llamada')));
    cont.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verFeedback(b.dataset.ver)));
    cont.querySelectorAll('[data-continuar]').forEach((b) => b.addEventListener('click', () => continuar(b.dataset.continuar)));
    cont.querySelectorAll('[data-descartar]').forEach((b) => b.addEventListener('click', async () => {
        await callAPI('simAbandonar', { sesionId: b.dataset.descartar });
        cargarPanel();
    }));
}

function pintarHistorial() {
    const filas = (state.panel.historial || []).filter((h) => h.estado === 'finalizada');
    const cont = $('tabHistorial');
    cont.innerHTML = '<div id="histTabla"></div>';
    renderTable('histTabla', ['Fecha', 'Práctica', 'Nivel', 'Conversación', 'Precisión', 'Habilitado', ''], filas.map((h) => [
        escapeHtml(formatearFecha(h.finalizadoEn)),
        escapeHtml(h.escenarioPublico || h.titulo),
        String(h.nivel),
        `<b class="${claseScore(h.conversacion, 75, 60)}">${Number(h.conversacion).toFixed(0)}</b>`,
        `<b class="${claseScore(h.precision, 85, 70)}">${Number(h.precision).toFixed(0)}</b>`,
        h.habilitado ? '✔' : '—',
        `<button class="link" data-ver="${escapeHtml(h.id)}">Ver</button>`,
    ]));
    cont.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verFeedback(b.dataset.ver)));
}

function botonLlamada(atributo) {
    if (!VOZ_SOPORTADA) return '';
    return `<button class="btn-secundario" ${atributo} title="Practicar hablando, como en una llamada"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;">call</span> Llamada</button>`;
}

async function iniciar(params, canal = 'chat') {
    mostrarVista('feedback');
    $('vistaFeedback').innerHTML = `<div class="loading-ia"><div class="spinner"></div>Preparando a tu cliente simulado…</div>`;
    const r = await callAPI('simIniciar', { ...params, canal });
    if (!r.success) {
        toast.show(r.error || 'No se pudo iniciar la práctica', 'err');
        mostrarVista('inicio');
        return;
    }
    state.ultimaSesion = params;
    abrirChat(r.sesionId, r.encabezado, r.ficha, [], canal);
}

async function continuar(sesionId) {
    const r = await callAPI('simDetalle', { sesionId });
    if (!r.success) { toast.show(r.error, 'err'); return; }
    const d = r.data;
    abrirChat(d.id, { escenario: d.escenarioPublico, nivel: d.nivel, nivelNombre: d.nivelNombre, objetivo: d.objetivo }, d.ficha, d.mensajes, d.canal);
}

function abrirChat(sesionId, encabezado, ficha, mensajes, canal = 'chat') {
    detenerLlamada();
    state.canal = canal === 'llamada' ? 'llamada' : 'chat';
    state.sesionId = sesionId;
    state.encabezado = encabezado;
    state.ficha = ficha;
    state.cola = [];
    state.esperando = false;
    state.finalizando = false;

    $('chatNombre').textContent = ficha.nombre || 'Postulante';
    $('chatAvatar').textContent = (ficha.nombre || '?').charAt(0).toUpperCase();
    $('chatEstado').textContent = '';
    $('sideEscenario').textContent = encabezado.escenario || '';
    $('sideNivel').textContent = `${encabezado.nivel} · ${encabezado.nivelNombre || ''}`;
    $('sideObjetivo').textContent = encabezado.objetivo || '';
    $('fichaNombre').textContent = ficha.nombre || '';
    $('fichaCarrera').textContent = ficha.carrera || '';
    $('fichaCanal').textContent = ficha.canal || '';
    $('fichaMsg').textContent = ficha.mensajeFormulario || '';
    $('fichaMsgRow').style.display = ficha.mensajeFormulario ? '' : 'none';
    $('chatFinalizar').disabled = false;

    const box = $('chatMsgs');
    box.innerHTML = `<div class="msg-sistema">Inicia la conversación. El cliente no sabe que es una práctica.</div>`;
    (mensajes || []).forEach((m) => {
        if (m.sinRespuesta) agregarSistema('El cliente vio tu mensaje y no respondió.');
        else agregarBurbuja(m.r, m.t, '');
    });
    const esLlamada = state.canal === 'llamada';
    $('chatInput').style.display = esLlamada ? 'none' : '';
    $('llamadaBar').style.display = esLlamada ? '' : 'none';
    $('sideHint').innerHTML = esLlamada ? HINT_LLAMADA : HINT_CHAT;
    $('chatFinalizar').innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">${esLlamada ? 'call_end' : 'flag'}</span> ${esLlamada ? 'Colgar y evaluar' : 'Finalizar simulación'}`;
    mostrarVista('chat');
    if (esLlamada) {
        box.querySelector('.msg-sistema').textContent = 'Llamada en curso. Tú inicias: saluda al cliente. El cliente no sabe que es una práctica.';
        iniciarLlamada();
    } else {
        $('chatTexto').focus();
    }
}

function iniciarLlamada() {
    if (!VOZ_SOPORTADA) {
        estadoLlamada('Tu navegador no permite llamadas de práctica. Usa Google Chrome o Microsoft Edge.', 'error');
        return;
    }
    voz.activa = true;
    voz.pausado = false;
    voz.bloqueado = false;
    voz.buffer = '';
    voz.parcial = '';
    elegirVoz(state.ficha?.nombre);
    escuchar();
}

function detenerLlamada() {
    voz.activa = false;
    dejarDeEscuchar();
    if (VOZ_SOPORTADA) speechSynthesis.cancel();
    voz.hablando = false;
}

function estadoLlamada(texto, clase = '') {
    $('llamadaEstado').textContent = texto;
    $('llamadaInd').className = 'llamada-ind' + (clase ? ' ' + clase : '');
    const icono = { escuchando: 'mic', hablando: 'volume_up', pensando: 'hourglass_top', error: 'error' }[clase] || 'mic_off';
    $('llamadaInd').innerHTML = `<span class="material-symbols-outlined">${icono}</span>`;
    $('llamadaListo').disabled = clase !== 'escuchando';
    $('llamadaMic').innerHTML = voz.pausado
        ? '<span class="material-symbols-outlined">mic</span> Reanudar'
        : '<span class="material-symbols-outlined">mic_off</span> Pausar';
}

function puedeEscuchar() {
    return voz.activa && !voz.pausado && !voz.hablando && !voz.bloqueado && !state.esperando && !state.finalizando
        && $('vistaChat')?.offsetParent !== null;
}

function crearReconocedor() {
    const rec = new Reconocedor();
    rec.lang = 'es-PE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
        if (!puedeEscuchar()) return;
        let parcial = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) voz.buffer += ' ' + res[0].transcript;
            else parcial += res[0].transcript;
        }
        voz.parcial = parcial;
        $('llamadaParcial').textContent = (voz.buffer + ' ' + voz.parcial).trim();
        clearTimeout(voz.timer);
        voz.timer = setTimeout(cerrarTurnoVoz, SILENCIO_FIN_TURNO_MS);
    };
    rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
            voz.bloqueado = true;
            estadoLlamada('No hay acceso al micrófono. Permítelo en el candado de la barra de direcciones y vuelve a entrar.', 'error');
        }
    };
    rec.onend = () => {
        voz.escuchando = false;
        if (puedeEscuchar()) setTimeout(escuchar, 200);
    };
    return rec;
}

function escuchar() {
    if (!puedeEscuchar()) return;
    if (!voz.rec) voz.rec = crearReconocedor();
    if (!voz.escuchando) {
        try { voz.rec.start(); voz.escuchando = true; } catch (e) { voz.escuchando = true; }
    }
    estadoLlamada('Te escucho… habla con normalidad', 'escuchando');
}

function dejarDeEscuchar() {
    clearTimeout(voz.timer);
    if (voz.rec && voz.escuchando) {
        try { voz.rec.abort(); } catch (e) { }
    }
    voz.escuchando = false;
}

function alternarMicrofono() {
    if (!voz.activa) return;
    voz.pausado = !voz.pausado;
    if (voz.pausado) {
        dejarDeEscuchar();
        voz.buffer = '';
        voz.parcial = '';
        $('llamadaParcial').textContent = '';
        estadoLlamada('Micrófono en pausa');
    } else {
        escuchar();
    }
}

function cerrarTurnoVoz() {
    clearTimeout(voz.timer);
    if (!voz.activa || state.esperando || state.finalizando) return;
    const texto = (voz.buffer + ' ' + voz.parcial).replace(/\s+/g, ' ').trim();
    if (!texto) return;
    voz.buffer = '';
    voz.parcial = '';
    $('llamadaParcial').textContent = '';
    dejarDeEscuchar();
    if (normalizar(texto).includes(FRASE_FIN)) { finalizar(); return; }
    enviarTurnoVoz(texto);
}

async function enviarTurnoVoz(texto) {
    const burbuja = agregarBurbuja('asesor', texto, horaAhora(), true);
    state.esperando = true;
    estadoLlamada('El cliente está pensando…', 'pensando');
    const r = await callAPI('simEnviar', { sesionId: state.sesionId, textos: [texto] });
    burbuja.classList.remove('pendiente');

    if (!r.success) {
        state.esperando = false;
        agregarSistema(r.error || 'No se pudo enviar. Vuelve a decirlo.');
        escuchar();
        return;
    }

    const respuesta = (r.respuestas || []).join(' ').trim();
    if (respuesta && voz.activa) {
        agregarBurbuja('lead', respuesta, horaAhora());
        await hablar(respuesta);
    }
    state.esperando = false;

    if (r.colgo) {
        agregarSistema('El cliente colgó la llamada.');
        await esperar(800);
        finalizar();
        return;
    }
    escuchar();
}

function elegirVoz(nombre) {
    const voces = speechSynthesis.getVoices().filter((v) => /^es([-_]|$)/i.test(v.lang));
    if (!voces.length) { voz.voz = null; return; }
    const primerNombre = String(nombre || '').trim().split(' ')[0].toLowerCase();
    const esMujer = /a$/.test(primerNombre) && !/^(luca|nicola|joshua|garcia)$/.test(primerNombre);
    const femeninas = /(sabina|helena|laura|paulina|dalia|elvira|elena|luc[ií]a|m[oó]nica|paloma|camila|ximena|valentina|catalina|estados unidos|female|mujer)/i;
    const masculinas = /(ra[uú]l|pablo|jorge|[aá]lvaro|diego|juan|gonzalo|alonso|tom[aá]s|male|hombre)/i;
    const prioridadIdioma = ['es-PE', 'es-MX', 'es-US', 'es-419', 'es-CO', 'es-AR', 'es-CL', 'es-ES'];
    const rango = (v) => { const i = prioridadIdioma.indexOf(v.lang.replace('_', '-')); return i === -1 ? 99 : i; };
    const genero = (v) => (esMujer ? femeninas.test(v.name) : masculinas.test(v.name)) ? 0 : (esMujer ? masculinas : femeninas).test(v.name) ? 2 : 1;
    voces.sort((a, b) => genero(a) - genero(b) || rango(a) - rango(b) || (b.localService ? 0 : 1) - (a.localService ? 0 : 1));
    voz.voz = voces[0];
}

function hablar(texto) {
    return new Promise((resolve) => {
        if (!VOZ_SOPORTADA || !voz.activa) { resolve(); return; }
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(texto);
        if (voz.voz) { u.voice = voz.voz; u.lang = voz.voz.lang; } else { u.lang = 'es-PE'; }
        u.rate = 1.05;
        let listo = false;
        const terminar = () => { if (listo) return; listo = true; voz.hablando = false; clearTimeout(t); resolve(); };
        const t = setTimeout(terminar, Math.max(6000, texto.length * 110));
        u.onend = terminar;
        u.onerror = terminar;
        voz.hablando = true;
        estadoLlamada('El cliente está hablando…', 'hablando');
        speechSynthesis.speak(u);
    });
}

function agregarBurbuja(rol, texto, hora, pendiente = false) {
    const box = $('chatMsgs');
    const div = document.createElement('div');
    div.className = `msg ${rol === 'asesor' ? 'asesor' : 'lead'}${pendiente ? ' pendiente' : ''}`;
    div.innerHTML = `${escapeHtml(texto)}<span class="hora">${escapeHtml(hora || '')}</span>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function agregarSistema(texto) {
    const box = $('chatMsgs');
    const div = document.createElement('div');
    div.className = 'msg-sistema';
    div.textContent = texto;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function enviarDesdeInput() {
    if (state.finalizando) return;
    const ta = $('chatTexto');
    const texto = ta.value.trim();
    if (!texto) return;
    ta.value = '';
    ta.style.height = 'auto';

    if (normalizar(texto) === FRASE_FIN) { finalizar(); return; }

    const burbuja = agregarBurbuja('asesor', texto, horaAhora(), true);
    state.cola.push({ texto, burbuja });
    programarEnvio();
}

function programarEnvio() {
    clearTimeout(state.timer);
    state.timer = setTimeout(enviarCola, ESPERA_ANTES_DE_RESPONDER_MS);
}

async function enviarCola() {
    if (state.esperando || !state.cola.length) return;
    if ($('chatTexto').value.trim()) { programarEnvio(); return; }
    const lote = state.cola.splice(0);
    state.esperando = true;
    $('chatEstado').textContent = 'en línea';

    const r = await callAPI('simEnviar', { sesionId: state.sesionId, textos: lote.map((m) => m.texto) });
    lote.forEach((m) => m.burbuja.classList.remove('pendiente'));

    if (!r.success) {
        state.esperando = false;
        $('chatEstado').textContent = '';
        agregarSistema(r.error || 'No se pudo enviar. Intenta otra vez.');
        return;
    }

    if (r.sinRespuesta) {
        await esperar(1200);
        $('chatEstado').textContent = '';
        agregarSistema('El cliente vio tu mensaje y no respondió.');
    } else {
        for (const t of r.respuestas || []) {
            $('chatEstado').textContent = 'escribiendo…';
            await esperar(Math.min(3500, 700 + t.length * 30));
            agregarBurbuja('lead', t, horaAhora());
        }
        $('chatEstado').textContent = 'en línea';
        setTimeout(() => { if (!state.esperando) $('chatEstado').textContent = ''; }, 4000);
    }
    state.esperando = false;
    if (state.cola.length) programarEnvio();
}

async function salirSinEvaluar() {
    if (!confirm('¿Salir sin evaluar? La práctica se descartará.')) return;
    clearTimeout(state.timer);
    detenerLlamada();
    await callAPI('simAbandonar', { sesionId: state.sesionId });
    state.sesionId = null;
    mostrarVista('inicio');
    cargarPanel();
}

async function finalizar() {
    if (state.finalizando) return;
    state.finalizando = true;
    clearTimeout(state.timer);
    $('chatFinalizar').disabled = true;
    const eraLlamada = state.canal === 'llamada';
    detenerLlamada();

    while (state.esperando) await esperar(300);
    const pendientes = state.cola.splice(0).map((m) => m.texto);

    mostrarVista('feedback');
    $('vistaFeedback').innerHTML = `<div class="loading-ia"><div class="spinner"></div>Evaluando tu conversación con la rúbrica UCAL…<small>Puede tardar hasta un minuto.</small></div>`;

    let r;
    if (pendientes.length) {
        r = await callAPI('simEnviar', { sesionId: state.sesionId, textos: [...pendientes, 'FINALIZAR SIMULACIÓN'] });
    } else {
        r = await callAPI('simFinalizar', { sesionId: state.sesionId });
    }
    state.finalizando = false;

    if (!r.success) {
        toast.show(r.error || 'No se pudo evaluar', 'err');
        mostrarVista('chat');
        $('chatFinalizar').disabled = false;
        if (eraLlamada) iniciarLlamada();
        return;
    }
    state.sesionId = null;
    $('vistaFeedback').innerHTML = renderFeedback(r.data, true);
    conectarAccionesFeedback($('vistaFeedback'), r.data);
    cargarPanel();
}

async function verFeedback(sesionId, enModal = false) {
    const r = await callAPI('simDetalle', { sesionId });
    if (!r.success) { toast.show(r.error, 'err'); return; }
    if (!r.data.evaluacion) { toast.show('Esta práctica todavía no tiene evaluación.', 'info'); return; }
    if (enModal) {
        $('capDetalleContenido').innerHTML = renderFeedback(r.data, false);
        conectarAccionesFeedback($('capDetalleContenido'), r.data);
        $('capDetalleModal').classList.add('show');
        return;
    }
    mostrarVista('feedback');
    $('vistaFeedback').innerHTML = renderFeedback(r.data, true);
    conectarAccionesFeedback($('vistaFeedback'), r.data);
}

function renderFeedback(d, esPropio) {
    const ev = d.evaluacion || {};
    const ej = ev.ejecutivo || {};
    const conv = Number(ev.conversacion ?? d.conversacion ?? 0);
    const prec = Number(ev.precision ?? d.precision ?? 0);
    const lista = (arr) => (Array.isArray(arr) && arr.length ? '<ul>' + arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('') + '</ul>' : '<p class="cap-sub">—</p>');

    let html = `<div class="fb-wrap">`;
    if (esPropio) html += `<button class="link" data-accion="volver" style="margin-bottom:10px;">← Volver</button>`;
    html += `<h3 style="font-family:var(--font-family-heading);">Resultado de tu práctica</h3>
        <p class="cap-sub">${escapeHtml(d.nombre && !esPropio ? d.nombre + ' · ' : '')}${escapeHtml(d.escenarioPublico || d.titulo)} · Nivel ${d.nivel} ${escapeHtml(d.nivelNombre || '')} · ${escapeHtml(formatearFecha(d.finalizadoEn))}</p>
        <div class="fb-scores">
            <div class="fb-score"><div class="lbl">Conversación</div><div class="val ${claseScore(conv, 75, 60)}">${conv.toFixed(0)}</div><div class="banda">${escapeHtml(ev.bandaConversacion || '')}</div></div>
            <div class="fb-score"><div class="lbl">Precisión</div><div class="val ${claseScore(prec, 85, 70)}">${prec.toFixed(0)}</div><div class="banda">${escapeHtml(ev.bandaPrecision || '')}</div></div>
            <div class="fb-score" style="display:flex; align-items:center;">
                <span class="fb-hab ${ev.habilitado ? 'si' : 'no'}"><span class="material-symbols-outlined" style="font-size:16px;">${ev.habilitado ? 'verified' : 'pending'}</span>
                ${ev.habilitado ? 'Habilitado para leads reales' : 'Aún no habilitado'}</span>
            </div>
        </div>
        ${ej.frase ? `<p style="font-size:14px; margin-bottom:12px;"><b>${escapeHtml(ej.frase)}</b></p>` : ''}

        <div class="fb-block"><h4><span class="material-symbols-outlined" style="color:var(--color-success)">check_circle</span> Lo hiciste bien</h4>${lista((ej.bien || []).slice(0, 3))}</div>

        <div class="fb-block"><h4><span class="material-symbols-outlined" style="color:var(--color-accent)">target</span> Tus 2 prioridades</h4>
            ${(ej.prioridades || []).slice(0, 2).map((p, i) => `<div class="fb-prio">
                <div class="t">Prioridad ${i + 1}: ${escapeHtml(p.nombre || '')}</div>
                <p>${escapeHtml(p.que_ocurrio || '')}</p>
                <p><b>Qué hacer:</b> ${escapeHtml(p.que_hacer || '')}</p>
                ${p.ejemplo ? `<div class="fb-ej">${escapeHtml(p.ejemplo)}</div>` : ''}
            </div>`).join('') || '<p class="cap-sub">—</p>'}
        </div>`;

    const ojo = ej.ojo && ej.ojo.texto ? ej.ojo : (ev.errores && ev.errores[0] ? { codigo: ev.errores[0].codigo, texto: ev.errores[0].explicacion || ev.errores[0].definicion } : null);
    if (ojo) {
        html += `<div class="fb-block ojo"><h4><span class="material-symbols-outlined" style="color:var(--color-danger)">error</span> Ojo con esto ${ojo.codigo ? `<small>(${escapeHtml(ojo.codigo)})</small>` : ''}</h4>
            <p>${escapeHtml(ojo.texto)}</p>
            ${(ev.errores || []).length > 1 ? `<p class="cap-sub">Hay ${ev.errores.length - 1} punto(s) más en la evaluación completa.</p>` : ''}</div>`;
    }

    html += `<div class="fb-block"><h4><span class="material-symbols-outlined" style="color:var(--color-primary)">lightbulb</span> Lo que realmente necesitaba el cliente</h4><p>${escapeHtml(ej.necesidad_real || '')}</p></div>
        <div class="fb-block next"><h4><span class="material-symbols-outlined">rocket_launch</span> Para tu próxima práctica</h4><p>${escapeHtml(ej.proxima_practica || '')}</p></div>`;

    const pr = ev.perfil_revelado || {};
    const po = d.perfilOculto || {};
    html += `<details class="fb-det"><summary>🔎 Lo que había detrás del cliente</summary>
        <p style="margin-top:10px;"><b>Necesidad:</b> ${escapeHtml(pr.necesidad || po.necesidad_principal || '')}</p>
        <p><b>Principal preocupación:</b> ${escapeHtml(pr.preocupacion || po.objecion_principal?.de_fondo || '')}</p>
        <p><b>Tipo de lead:</b> ${escapeHtml([po.tipo_ingreso, po.modalidad_final, po.nivel_interaccion].filter(Boolean).join(' · '))}
           · <b>Decide:</b> ${escapeHtml(po.decisor || '')} · <b>Paga:</b> ${escapeHtml(po.responsable_pago || '')}</p>
        <p><b>Objeción declarada:</b> ${escapeHtml(po.objecion_principal?.declarada || '')} → <b>de fondo:</b> ${escapeHtml(po.objecion_principal?.de_fondo || '')}</p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div><b style="font-size:13px;">Descubriste</b>${lista(pr.descubierto)}</div>
            <div><b style="font-size:13px;">No descubriste</b>${lista(pr.no_descubierto)}</div>
        </div>
    </details>`;

    const crit = ev.criterios || {};
    html += `<details class="fb-det"><summary>📋 Ver evaluación completa</summary>
        <table class="crit-table"><thead><tr><th>Criterio</th><th>Nota</th><th>Evidencia y comentario</th></tr></thead><tbody>
        ${(d.criterios || []).map((c) => {
            const x = crit[c.clave] || {};
            return `<tr><td><b>${escapeHtml(c.nombre)}</b><br><small class="cap-sub">${escapeHtml(c.etapa)}</small></td>
                <td><span class="nota n${x.nota}">${x.nota ?? '—'}</span></td>
                <td>${x.evidencia ? `<div class="fb-ej">${escapeHtml(x.evidencia)}</div>` : ''}<div style="margin-top:4px;">${escapeHtml(x.comentario || '')}</div></td></tr>`;
        }).join('')}
        </tbody></table>
        <h4 style="margin:16px 0 6px; font-size:14px;">Errores críticos</h4>
        ${(ev.errores || []).length ? '<ul>' + ev.errores.map((e) => `<li><b>${escapeHtml(e.codigo)} (−${e.puntos})</b> ${escapeHtml(e.definicion)}<br>${e.evidencia ? `<span class="fb-ej" style="display:inline-block;">${escapeHtml(e.evidencia)}</span><br>` : ''}${escapeHtml(e.explicacion || '')}</li>`).join('') + '</ul>' : '<p class="cap-sub">Ninguno.</p>'}
        <h4 style="margin:16px 0 6px; font-size:14px;">Diagnóstico</h4>
        <ul>
            <li>¿Descubrió la necesidad real? <b>${ev.diagnostico?.necesidad_descubierta ? 'Sí' : 'No'}</b></li>
            <li>Objeción: ${escapeHtml(ev.diagnostico?.objecion || '')}</li>
            <li>¿Identificó decisor y responsable de pago? <b>${ev.diagnostico?.decisor_y_pagador ? 'Sí' : 'No'}</b></li>
            <li>Adaptación al lead: ${escapeHtml(ev.diagnostico?.adaptacion || '')}</li>
            ${ev.diagnostico?.recategorizacion ? `<li>Recategorización: ${escapeHtml(ev.diagnostico.recategorizacion)}</li>` : ''}
        </ul>
        ${d.precioCorrecto ? `<h4 style="margin:16px 0 6px; font-size:14px;">Precio que le correspondía</h4><p>${escapeHtml(resumenPrecio(d.precioCorrecto))}</p>` : ''}
        <p class="cap-sub" style="margin-top:10px;">Evaluado con ${escapeHtml(ev.proveedor === 'claude' ? 'Claude' : 'Workers AI')} (${escapeHtml(ev.modelo || '')}).</p>
    </details>

    <details class="fb-det"><summary>💬 Ver conversación</summary>
        <div class="fb-chatlog">${(d.mensajes || []).map((m) => m.sinRespuesta
            ? '<div class="msg-sistema">El cliente no respondió.</div>'
            : `<div class="msg ${m.r === 'asesor' ? 'asesor' : 'lead'}">${escapeHtml(m.t)}</div>`).join('')}</div>
    </details>`;

    if (esPropio) {
        html += `<div class="fb-block"><h4>¿Qué quieres practicar ahora?</h4>
            <div class="fb-actions">
                <button class="btn-primary" data-accion="repetir">Repetir una simulación completa</button>
                <button class="btn-secundario" data-accion="prioridad">Practicar mi principal oportunidad</button>
                <button class="btn-secundario" data-accion="dificil">Probar un cliente más difícil</button>
                <button class="btn-secundario" data-accion="inicio">Volver al inicio</button>
            </div></div>`;
    }
    html += '</div>';
    return html;
}

function resumenPrecio(p) {
    if (!p) return '';
    const partes = [`Modalidad ${p.modalidad}`, `tipo de ingreso ${p.tipo_ingreso}`];
    if (p.monto_referencia) partes.push(p.monto_referencia);
    if (p.escala_cuota != null) partes.push(`escala S/ ${p.escala_cuota}`);
    if (p.cuota_con_beca != null) partes.push(`con ${p.beca_aplicable || 'beca'} S/ ${p.cuota_con_beca}`);
    partes.push(`matrícula S/ ${p.matricula}`, `examen de admisión S/ ${p.examen_admision}`);
    return partes.join(' · ') + (p.nota ? `. ${p.nota}` : '');
}

function conectarAccionesFeedback(cont, d) {
    const nivelSig = Math.min(4, Number(d.nivel || 1) + 1);
    const libre = (nivel) => {
        const e = (state.panel?.escenarios || []).find((x) => Number(x.nivel) === nivel) || null;
        return e ? { escenarioId: e.id } : { nivel };
    };
    cont.querySelectorAll('[data-accion]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.accion;
        if (a === 'volver' || a === 'inicio') { mostrarVista('inicio'); return; }
        if (a === 'repetir') { iniciar(state.ultimaSesion || libre(Number(d.nivel))); return; }
        if (a === 'dificil') { iniciar(libre(nivelSig)); return; }
        if (a === 'prioridad') {
            const p = d.evaluacion?.ejecutivo?.prioridades?.[0];
            iniciar({ ...libre(Number(d.nivel)), enfoque: p ? `${p.nombre}: ${p.que_hacer}` : '' });
        }
    }));
}

async function cargarEquipo() {
    const cont = $('eqTabla');
    cont.innerHTML = '<div class="loading">Cargando…</div>';
    const r = await callAPI('simResultados', { desde: $('eqDesde').value || null, hasta: $('eqHasta').value || null });
    if (!r.success) { cont.innerHTML = `<div class="loading">Error: ${escapeHtml(r.error)}</div>`; return; }
    const q = $('eqBuscar').value.trim().toLowerCase();
    const filas = (r.data || []).filter((f) => !q || String(f.nombre || f.usuario).toLowerCase().includes(q));
    renderTable('eqTabla', ['Fecha', 'Asesor', 'Práctica', 'Nivel', 'Conversación', 'Precisión', 'EC', 'Habilitado', ''], filas.map((f) => [
        escapeHtml(formatearFecha(f.finalizadoEn)),
        escapeHtml(f.nombre || f.usuario),
        escapeHtml(f.titulo) + (f.asignada ? ' <small class="cap-sub">(asignada)</small>' : ''),
        String(f.nivel),
        `<b class="${claseScore(f.conversacion, 75, 60)}">${Number(f.conversacion).toFixed(0)}</b>`,
        `<b class="${claseScore(f.precision, 85, 70)}">${Number(f.precision).toFixed(0)}</b>`,
        String(f.erroresCriticos || 0),
        f.habilitado ? '✔' : '—',
        `<button class="link" data-ver="${escapeHtml(f.id)}">Ver</button>`,
    ]));
    cont.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verFeedback(b.dataset.ver, true)));
}

async function cargarEscenarios() {
    const cont = $('escTabla');
    cont.innerHTML = '<div class="loading">Cargando…</div>';
    const r = await callAPI('simGetEscenarios');
    if (!r.success) { cont.innerHTML = `<div class="loading">Error: ${escapeHtml(r.error)}</div>`; return; }
    state.escenarios = r.data || [];
    const total = (r.chats || []).reduce((s, c) => s + c.n, 0);
    $('escChatsInfo').textContent = total
        ? `Chats reales cargados: ${total} (${r.chats.map((c) => `${c.tipo_ingreso || 'sin tipo'}: ${c.n}`).join(', ')})`
        : 'Aún no hay chats reales cargados: el lead se generará sin ejemplos de estilo.';
    const sel = $('escCarrera');
    sel.innerHTML = '<option value="">Cualquiera</option>' + (r.carreras || []).map((c) => `<option>${escapeHtml(c)}</option>`).join('');

    renderTable('escTabla', ['Escenario', 'Nivel', 'Filtros', 'Asignados', 'Estado', ''], state.escenarios.map((e) => [
        `<b>${escapeHtml(e.titulo)}</b><br><small class="cap-sub">${escapeHtml(e.objetivo || '')}</small>`,
        String(e.nivel),
        escapeHtml(Object.entries(e.filtros || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'),
        String(e.asignados),
        e.activo ? 'Activo' : 'Inactivo',
        `<button class="link" data-editar="${e.id}">Editar</button> · <button class="link" data-asignar="${e.id}">Asignar</button>`,
    ]));
    cont.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => abrirEscenario(state.escenarios.find((x) => x.id === Number(b.dataset.editar)))));
    cont.querySelectorAll('[data-asignar]').forEach((b) => b.addEventListener('click', () => abrirAsignacion(Number(b.dataset.asignar))));
}

let escEditando = null;
function abrirEscenario(e) {
    escEditando = e ? e.id : null;
    $('escModalTitulo').textContent = e ? 'Editar escenario' : 'Nuevo escenario';
    $('escTitulo').value = e?.titulo || '';
    $('escNivel').value = String(e?.nivel || 1);
    $('escActivo').value = String(e ? e.activo : true);
    $('escObjetivo').value = e?.objetivo || '';
    $('escTipo').value = e?.filtros?.tipo_ingreso || '';
    $('escModalidad').value = e?.filtros?.modalidad || '';
    $('escCarrera').value = e?.filtros?.carrera || '';
    $('escInstr').value = e?.instrucciones_extra || '';
    $('escDesc').value = e?.descripcion || '';
    $('escOrden').value = String(e?.orden ?? 0);
    $('escModal').classList.add('show');
}

async function guardarEscenario() {
    const r = await callAPI('simGuardarEscenario', {
        id: escEditando,
        titulo: $('escTitulo').value,
        nivel: Number($('escNivel').value),
        activo: $('escActivo').value === 'true',
        objetivo: $('escObjetivo').value,
        filtros: { tipo_ingreso: $('escTipo').value, modalidad: $('escModalidad').value, carrera: $('escCarrera').value },
        instruccionesExtra: $('escInstr').value,
        descripcion: $('escDesc').value,
        orden: Number($('escOrden').value) || 0,
    });
    if (!r.success) { toast.show(r.error, 'err'); return; }
    $('escModal').classList.remove('show');
    toast.show('Escenario guardado', 'ok');
    cargarEscenarios();
    cargarPanel();
}

async function abrirAsignacion(escenarioId) {
    const esc = state.escenarios.find((e) => e.id === escenarioId);
    $('asigTitulo').textContent = `Asignar: ${esc?.titulo || ''}`;
    $('asigLista').innerHTML = '<div class="loading">Cargando…</div>';
    $('asigModal').classList.add('show');
    const r = await callAPI('simGetAsignaciones', { escenarioId });
    if (!r.success) { $('asigLista').innerHTML = escapeHtml(r.error); return; }
    state.asignacion = {
        escenarioId,
        asesores: r.asesores || [],
        marcados: new Set((r.asignados || []).map((a) => a.usuario)),
        completados: new Set((r.asignados || []).filter((a) => a.completado).map((a) => a.usuario)),
    };
    const f = (r.asignados || []).find((a) => a.fechaLimite);
    $('asigFecha').value = f ? String(f.fechaLimite).slice(0, 10) : '';
    $('asigBuscar').value = '';
    pintarListaAsignacion();
}

function filtrarAsesores() {
    const q = $('asigBuscar').value.trim().toLowerCase();
    return state.asignacion.asesores.filter((a) => !q || `${a.nombre} ${a.usuario} ${a.campana}`.toLowerCase().includes(q));
}

function pintarListaAsignacion() {
    const lista = filtrarAsesores();
    $('asigLista').innerHTML = lista.length ? lista.map((a) => `
        <label><input type="checkbox" value="${escapeHtml(a.usuario)}" ${state.asignacion.marcados.has(a.usuario) ? 'checked' : ''}>
        ${escapeHtml(a.nombre || a.usuario)} <small class="cap-sub">${escapeHtml(a.campana || '')}</small>
        ${state.asignacion.completados?.has(a.usuario) ? '<small class="sc-alta">✔ completó</small>' : ''}</label>`).join('')
        : '<div class="cap-empty">Sin resultados.</div>';
    $('asigLista').querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) state.asignacion.marcados.add(c.value); else state.asignacion.marcados.delete(c.value);
    }));
}

async function guardarAsignacion() {
    const r = await callAPI('simGuardarAsignaciones', {
        escenarioId: state.asignacion.escenarioId,
        usuarios: Array.from(state.asignacion.marcados),
        fechaLimite: $('asigFecha').value || null,
    });
    if (!r.success) { toast.show(r.error, 'err'); return; }
    $('asigModal').classList.remove('show');
    toast.show(`Asignado a ${r.asignados} asesor(es)`, 'ok');
    cargarEscenarios();
}
