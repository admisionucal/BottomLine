// ============================================================
// BOTTOM LINE — Backend
// ============================================================

var SS = SpreadsheetApp.getActiveSpreadsheet();

var SESSION_TTL_SECONDS = 32400; // 9 horas
var LOGIN_MAX_INTENTOS = 5;
var LOGIN_BLOQUEO_SEGUNDOS = 60;

var CAMPOS_PERFIL = ['POR_QUE_ELIGIO_CARRERA', 'QUE_BUSCA_UNIVERSIDAD', 'QUIEN_FINANCIARA',
                      'ACCIONES_DEFINIDAS', 'QUE_LE_FALTA', 'OTRAS_OPCIONES', 'COMENTARIOS_PERFIL'];
var VALORES_NO_MERGE = ['', 'NO DEFINIDO', '-', 'SIN INFORMACION', 'SIN INFORMACIÓN'];
var TIPOS_INSTITUCION_PROCEDENCIA = ['UNIVERSIDAD', 'INSTITUTO'];

// Asistencia (Sheets externo, solo base de datos)
var ASISTENCIA_SPREADSHEET_ID = '1Zuww3H8GCR5_5i7bOVPAIc9nDgjMkNojzBpnHiIRhBY';
var ASISTENCIA_HEADERS = ["Usuario","Fecha","Nombre","Campaña","Cargo","DNI",
  "Entrada","Almuerzo","Regreso","Salida","H_Trabajo","H_Almuerzo",
  "Latitud","Longitud","Dirección","Estado","IP","Tipo","Timestamp"];

// ============================================================
// ROLES
// ============================================================
// ADMISION tiene los mismos permisos base que SUPERVISOR.
function esRolSupervisorOAdmision(rol) {
  return rol === 'SUPERVISOR' || rol === 'ADMISION';
}

// ============================================================
// ENDPOINTS PRINCIPALES
// ============================================================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    var handlers = {
      'login': login,
      'logout': logout,
      'getCatalogos': getCatalogos,
      'getLeads': getLeads,
      'getLeadsConAprobacion': getLeadsConAprobacion,
      'getLeadDetail': getLeadDetail,
      'saveBottom': saveBottom,
      'addComment': addComment,
      'getLeadPayments': getLeadPayments,
      'createSolicitud': createSolicitud,
      'resolveSolicitud': resolveSolicitud,
      'searchLeads': searchLeads,
      'unifyIds': unifyIds,
      'getSolicitudPendiente': getSolicitudPendiente,
      'getSolicitudesPendientesCampana': getSolicitudesPendientesCampana,
      'cancelarSolicitud': cancelarSolicitud,
      'marcarAsistencia': marcarAsistencia,
      'getAsistenciaRegistroHoy': getAsistenciaRegistroHoy,
      'getAsistenciaRegistros': getAsistenciaRegistros,
      'getAsistenciaEmpleados': getAsistenciaEmpleados,
      'getSolicitudCC': getSolicitudCC,
      'solicitarCC': solicitarCC,
      'cancelarSolicitudCC': cancelarSolicitudCC,
      'getSolicitudesCCCount': getSolicitudesCCCount,
      'getSolicitudesCC': getSolicitudesCC,
      'enviarCC': enviarCC,
      'generarPreviewPDF': generarPreviewPDF,
      'rechazarCC': rechazarCC,
      'getResumenVpPp': getResumenVpPp,
    };

    if (!handlers[action]) {
      return json({ success: false, error: 'Acción desconocida: ' + action });
    }

    return handlers[action](body);

  } catch (err) {
    return json({ success: false, error: err.message });
  }
}

function doGet(e) {
  return ContentService.createTextOutput('BottomLine API OK');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SESIONES
// ============================================================

function crearSesion(user) {
  var token = Utilities.getUuid();
  var payload = JSON.stringify({ email: user.email, rol: user.rol, nombre: user.nombre, usuario: user.usuario });
  try { CacheService.getScriptCache().put('session_' + token, payload, SESSION_TTL_SECONDS); } catch (e) {}
  return token;
}

function obtenerSesion(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw;
  try { raw = cache.get('session_' + token); } catch (e) { return null; }
  if (!raw) return null;

  var sesion;
  try { sesion = JSON.parse(raw); } catch (e) { return null; }

  try { cache.put('session_' + token, raw, SESSION_TTL_SECONDS); } catch (e) {}
  return sesion;
}

function logout(body) {
  if (body && body.sessionToken) {
    try { CacheService.getScriptCache().remove('session_' + body.sessionToken); } catch (e) {}
  }
  return json({ success: true });
}

// ============================================================
// LOCKS
// ============================================================

function conLock(fn) {
  var lock = LockService.getScriptLock();
  var obtenido = false;
  try { obtenido = lock.tryLock(15000); } catch (e) {}
  if (!obtenido) {
    return json({ success: false, error: 'El sistema está ocupado procesando otro cambio. Intenta de nuevo en unos segundos.' });
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Lock propio: evita competir con el lock global de saveBottom/addComment/etc.
function conLockAsistencia(fn) {
  var cache = CacheService.getScriptCache();
  var lockKey = 'lock_asistencia_activo';
  var intentos = 0;
  var maxIntentos = 20;
  var esperaMs = 250;

  while (intentos < maxIntentos) {
    if (!cache.get(lockKey)) {
      try { cache.put(lockKey, '1', 15); } catch (e) {}
      break;
    }
    Utilities.sleep(esperaMs);
    intentos++;
  }
  if (intentos >= maxIntentos) {
    return json({ success: false, error: 'El sistema de asistencia está ocupado. Intenta de nuevo en unos segundos.' });
  }

  try {
    return fn();
  } finally {
    try { cache.remove(lockKey); } catch (e) {}
  }
}

function exigirSesion(body, rolesPermitidos, motivo) {
  var sesion = obtenerSesion(body && body.sessionToken);
  if (!sesion) {
    motivo.error = 'Sesión inválida o expirada. Vuelve a iniciar sesión.';
    return null;
  }
  if (rolesPermitidos && rolesPermitidos.indexOf(sesion.rol) === -1) {
    motivo.error = 'Acceso denegado: privilegios insuficientes.';
    return null;
  }
  return sesion;
}

// ============================================================
// LOGIN — por "Usuario"
// ============================================================

function hashPassword(password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password), Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function migrarPasswordAHash(usuario, passwordPlano) {
  var sheet = SS.getSheetByName('USUARIOS');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var usuarioIdx = headers.indexOf('Usuario');
  var passIdx = headers.indexOf('Contraseña');
  if (usuarioIdx === -1 || passIdx === -1) return;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][usuarioIdx]).trim().toLowerCase() === String(usuario).trim().toLowerCase()) {
      sheet.getRange(i + 1, passIdx + 1).setValue('sha256:' + hashPassword(passwordPlano));
      break;
    }
  }
}

function verificarYMigrarPassword(user, passwordIngresada) {
  var guardada = String(user['Contraseña'] || '').trim();
  var ingresada = String(passwordIngresada || '').trim();

  if (guardada.indexOf('sha256:') === 0) {
    return guardada === ('sha256:' + hashPassword(ingresada));
  }
  if (guardada !== '' && guardada === ingresada) {
    migrarPasswordAHash(user.Usuario, ingresada);
    return true;
  }
  return false;
}

function loginIntentosKey(usuario) {
  return 'login_intentos_' + String(usuario || '').trim().toLowerCase();
}

function loginBloqueado(usuario) {
  var raw;
  try { raw = CacheService.getScriptCache().get(loginIntentosKey(usuario)); } catch (e) { return false; }
  if (!raw) return false;
  var data;
  try { data = JSON.parse(raw); } catch (e) { return false; }
  return (data.count || 0) >= LOGIN_MAX_INTENTOS;
}

function registrarIntentoFallido(usuario) {
  var cache = CacheService.getScriptCache();
  var key = loginIntentosKey(usuario);
  var raw = cache.get(key);
  var data = raw ? JSON.parse(raw) : { count: 0 };
  data.count = (data.count || 0) + 1;
  try { cache.put(key, JSON.stringify(data), LOGIN_BLOQUEO_SEGUNDOS); } catch (e) {}
}

function limpiarIntentosFallidos(usuario) {
  try { CacheService.getScriptCache().remove(loginIntentosKey(usuario)); } catch (e) {}
}

// ============================================================
// HELPERS DE LECTURA
// ============================================================

function columnToLetter(column) {
  var letter = '';
  while (column > 0) {
    var temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

function leerColumnasOptimizado(sheet, columnas, lastRow) {
  var spreadsheetId = SS.getId();
  var sheetName = sheet.getName();

  var ranges = columnas.map(function(col) {
    var letra = columnToLetter(col);
    return "'" + sheetName + "'!" + letra + '1:' + letra + lastRow;
  });

  var response = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, { ranges: ranges });
  var columnasValores = response.valueRanges.map(function(vr) { return vr.values || []; });

  var data = [];
  for (var i = 0; i < lastRow; i++) {
    var fila = [];
    for (var c = 0; c < columnas.length; c++) {
      var colVals = columnasValores[c];
      fila.push(colVals[i] !== undefined && colVals[i][0] !== undefined ? colVals[i][0] : '');
    }
    data.push(fila);
  }
  return data;
}

function sheetToObjects(sheetName) {
  var sheet = SS.getSheetByName(sheetName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var isEmpty = row.every(function(cell) { return cell === ''; });
    if (isEmpty) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (val instanceof Date) val = val.toISOString().split('T')[0];
      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  return result;
}

function esValorMerge(valor) {
  if (valor === undefined || valor === null) return false;
  var v = String(valor).trim().toUpperCase();
  return VALORES_NO_MERGE.indexOf(v) === -1;
}

// Override cuando el registro de hoy está en STATUS DE GESTION = VP VIVA o PP VIVA 
// y el ASESOR ULT TIP DF SN CONTC de ese registro es el mismo que ya está en la hoja base
function hoyOverrideEsConfiable(hoyOverride, asesorBaseRaw, encontradoEnBase) {
  if (!hoyOverride) return false;
  var status = String(hoyOverride['STATUS DE GESTION'] || '').trim();
  var esViva = status === 'VALORES_VALORACIONES_POSITIVAS_VIVA' || status === 'VALORES_PROMESA_DE_PAGO_VIVA';
  if (!esViva) return false;

  if (!encontradoEnBase) return true;

  var asesorBase = String(asesorBaseRaw || '').trim().toLowerCase();
  if (!asesorBase) return false;

  var asesorHoy = String(hoyOverride['ASESOR ULT TIP DF SN CONTC'] || '').trim().toLowerCase();
  return asesorHoy !== '' && asesorHoy === asesorBase;
}

function permitirActualizarAsignacionDetail(hoyOverride, asesorBaseRaw, encontradoEnBase) {
  if (!hoyOverride) return false;

  var status = String(hoyOverride['STATUS DE GESTION'] || '').trim();
  var esViva = status === 'VALORES_VALORACIONES_POSITIVAS_VIVA' || status === 'VALORES_PROMESA_DE_PAGO_VIVA';

  if (!esViva) return true; // fuera de VP/PP Viva: siempre se confía en hoy{campana}
  if (!encontradoEnBase) return true; // SOLO_HOY

  var asesorBase = String(asesorBaseRaw || '').trim().toLowerCase();
  var asesorHoy = String(hoyOverride['ASESOR ULT TIP DF SN CONTC'] || '').trim().toLowerCase();
  return asesorHoy !== '' && asesorHoy === asesorBase;
}

// ============================================================
// AUTENTICACIÓN Y CATÁLOGOS
// ============================================================

function login(body) {
  var usuarioNorm = String(body.usuario || '').trim().toLowerCase();

  if (loginBloqueado(usuarioNorm)) {
    return json({ success: false, error: 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.' });
  }

  var usuarios = sheetToObjects('USUARIOS');
  var user = usuarios.find(function(u) {
    return String(u.Usuario || '').trim().toLowerCase() === usuarioNorm;
  });

  if (!user) {
    registrarIntentoFallido(usuarioNorm);
    return json({ success: false, error: 'Usuario no encontrado' });
  }
  if (!verificarYMigrarPassword(user, body.password)) {
    registrarIntentoFallido(usuarioNorm);
    return json({ success: false, error: 'Contraseña incorrecta' });
  }

  limpiarIntentosFallidos(usuarioNorm);

  var campanas = [];
  var raw = String(user['Campaña'] || '');

  if (raw.toLowerCase() === 'todas') {
    SS.getSheets().forEach(function(s) {
      var name = s.getName();
      if (name.indexOf('bbdd') === 0) campanas.push(name.replace('bbdd', ''));
    });
  } else {
    campanas = raw.split(',').map(function(item) { return item.trim(); }).filter(Boolean);
  }

  var emailUser = String(user.Email || '').trim().toLowerCase();
  var token = crearSesion({
    email: emailUser,
    rol: user.Rol,
    nombre: user.Nombre_Aux || user.Nombre,
    usuario: user.Usuario
  });

  return json({
    success: true,
    user: {
      usuario: user.Usuario || '',
      email: emailUser,
      nombre: user.Nombre_Aux || user.Nombre || '',
      nombre_completo: user.Nombre || '',
      rol: user.Rol || '',
      campanas: campanas,
      nombre_asesor: user.Nombre_Aux || '',
      cargo: user.Cargo || '',
      dni: user.DNI || '',
      foto: user.Foto || '',
      token: token
    }
  });
}

function getCatalogos(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var shInst = getCatalogoProcedenciaSheet('INSTITUCIONES_PROCEDENCIA', ['NOMBRE', 'TIPO']);
  var dataInst = shInst.getDataRange().getValues();
  var instituciones = [];
  for (var i = 1; i < dataInst.length; i++) {
    if (!dataInst[i][0]) continue;
    instituciones.push({ nombre: dataInst[i][0], tipo: dataInst[i][1] });
  }

  var shCarr = getCatalogoProcedenciaSheet('CARRERAS_PROCEDENCIA', ['NOMBRE']);
  var dataCarr = shCarr.getDataRange().getValues();
  var carrerasProcedencia = [];
  for (var j = 1; j < dataCarr.length; j++) {
    if (!dataCarr[j][0]) continue;
    carrerasProcedencia.push(dataCarr[j][0]);
  }

  return json({
    success: true,
    data: {
      boletas: sheetToObjects('BOLETAS'),
      beneficios: sheetToObjects('BENEFICIOS'),
      institucionesProcedencia: instituciones,
      carrerasProcedencia: carrerasProcedencia
    }
  });
}

// ============================================================
// LEADS
// ============================================================

function getHoyMap(campana) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'hoyMap_' + campana;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var filas = sheetToObjects('hoy' + campana);
  var map = {};
  filas.forEach(function(f) {
    var id = String(f['ID PROMETEO'] || '').trim();
    if (id) map[id] = f;
  });

  try { cache.put(cacheKey, JSON.stringify(map), 30); } catch (e) {}
  return map;
}

// PP Muerta con pago real en pagos{campana} pasa a su status real (solo SUPERVISOR/ADMISION)
function getPagosMapPorId(campana) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'pagosMap_' + campana;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var filas = sheetToObjects('pagos' + campana);
  var map = {};
  filas.forEach(function(f) {
    var id = String(f['ID PROMETEO'] || '').trim();
    if (id) map[id] = f;
  });

  try { cache.put(cacheKey, JSON.stringify(map), 30); } catch (e) {}
  return map;
}

function getLeads(body) {
  var t0 = Date.now();

  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var esAdmin = esRolSupervisorOAdmision(sesion.rol);
  var nombreAsesor = esAdmin ? null : getNombreAsesorPorEmail(sesion.email);

  var campana = body.campana;
  var filtros = body.filtros || {};

  var sheet = SS.getSheetByName(campana);
  if (!sheet) {
    return json({ success: false, error: 'No se encontró la pestaña de campaña: ' + campana });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return json({ success: true, data: [] });

  var NOMBRES_COLUMNAS_NECESARIAS = [
    'CAMPAÑA', 'ID PROMETEO', 'NOMBRES', 'TELEFONO 2', 'TELEFONO 3', 'EMAIL',
    'NOMBRE DEL COLEGIO', 'BOLETA DE COLEGIO', 'SUBCANAL 2', 'PROGRAMA', 'MODALIDAD',
    'FECHA HORA DE REGISTRO', 'ASESOR ULT TIP DF SN CONTC', 'STATUS DE GESTION',
    'MODALIDAD INGRESO', '# DE VPs DIF TI INTE', 'FECHA COMPROMISO DE PAGO'
  ];

  var headerRowCompleto = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });

  var columnasFaltantes = [];
  var columnasNecesarias = NOMBRES_COLUMNAS_NECESARIAS.map(function(nombre) {
    var idx = headerRowCompleto.indexOf(nombre);
    if (idx === -1) { columnasFaltantes.push(nombre); return null; }
    return idx + 1;
  }).filter(function(col) { return col !== null; });

  if (columnasFaltantes.length > 0) {
    Logger.log('getLeads: columnas no encontradas en "' + campana + '": ' + columnasFaltantes.join(', '));
  }

  var data = leerColumnasOptimizado(sheet, columnasNecesarias, lastRow);

  var tLecturaCompleta = Date.now() - t0;
  if (data.length <= 1) return json({ success: true, data: [] });

  var headers = data[0].map(function(h) { return String(h).trim(); });

  var idxId = headers.indexOf('ID PROMETEO');
  var idxStatus = headers.indexOf('STATUS DE GESTION');
  var idxAsesor = headers.indexOf('ASESOR ULT TIP DF SN CONTC');
  var idxCarrera = headers.indexOf('CARRERA');
  if (idxCarrera === -1) idxCarrera = headers.indexOf('PROGRAMA');
  var idxIngreso = headers.indexOf('MODALIDAD INGRESO');
  var idxModalidad = headers.indexOf('MODALIDAD');
  var idxVPsDif = headers.indexOf('# DE VPs DIF TI INTE');
  var idxColegio = headers.indexOf('NOMBRE DEL COLEGIO');
  var idxFechaCompromiso = headers.indexOf('FECHA COMPROMISO DE PAGO');
  var idxBoletaColegio = headers.indexOf('BOLETA DE COLEGIO');
  var idxNombres = headers.indexOf('NOMBRES');
  var idxTelefono3 = headers.indexOf('TELEFONO 3');
  var idxEmail = headers.indexOf('EMAIL');

  var tResolver0 = Date.now();
  var resolverBottom = getBottomMapActivo(campana);
  var tResolverBottom = Date.now() - tResolver0;

  var nombreAuxMap = getAsesorNombreAuxMap();

  var hoyMap = getHoyMap(campana);
  var pagosMap = esAdmin ? getPagosMapPorId(campana) : {};
  var idsEnBase = {};

  var leads = [];
  var filasEvaluadas = 0;
  var filasMatch = 0;

  for (var i = 1; i < data.length; i++) {
    filasEvaluadas++;
    var row = data[i];
    var idValue = idxId !== -1 ? String(row[idxId]).trim() : '';
    if (!idValue) continue;
    idsEnBase[idValue] = true;

    var statusValue = idxStatus !== -1 && row[idxStatus] ? row[idxStatus].toString().trim() : '';
    var asesorValue = idxAsesor !== -1 && row[idxAsesor] ? row[idxAsesor].toString().trim() : '';
    var carreraValue = idxCarrera !== -1 ? String(row[idxCarrera] || '') : '';
    var ingresoValue = idxIngreso !== -1 ? String(row[idxIngreso] || '') : '';
    var modalidadValue = idxModalidad !== -1 ? String(row[idxModalidad] || '') : '';
    var colegioValue = idxColegio !== -1 ? String(row[idxColegio] || '') : '';
    var fechaCompromisoValue = idxFechaCompromiso !== -1 ? row[idxFechaCompromiso] : '';
    var boletaColegioValue = idxBoletaColegio !== -1 ? row[idxBoletaColegio] : '';
    var nombreLead = idxNombres !== -1 ? row[idxNombres] : '';
    var telefono3Value = idxTelefono3 !== -1 ? row[idxTelefono3] : '';
    var emailValue = idxEmail !== -1 ? row[idxEmail] : '';

    var hoyOverride = hoyMap[idValue];
    if (hoyOverride) {
      if (esValorMerge(hoyOverride['STATUS DE GESTION'])) statusValue = hoyOverride['STATUS DE GESTION'];
      if (esValorMerge(hoyOverride['ASESOR ULT TIP DF SN CONTC'])) asesorValue = hoyOverride['ASESOR ULT TIP DF SN CONTC'];
      if (esValorMerge(hoyOverride['PROGRAMA'])) carreraValue = hoyOverride['PROGRAMA'];
      if (esValorMerge(hoyOverride['MODALIDAD INGRESO'])) ingresoValue = hoyOverride['MODALIDAD INGRESO'];
      if (esValorMerge(hoyOverride['MODALIDAD'])) modalidadValue = hoyOverride['MODALIDAD'];
      if (esValorMerge(hoyOverride['NOMBRE DEL COLEGIO'])) colegioValue = hoyOverride['NOMBRE DEL COLEGIO'];
      if (esValorMerge(hoyOverride['FECHA COMPROMISO DE PAGO'])) fechaCompromisoValue = hoyOverride['FECHA COMPROMISO DE PAGO'];
      if (esValorMerge(hoyOverride['BOLETA DE COLEGIO'])) boletaColegioValue = hoyOverride['BOLETA DE COLEGIO'];
      if (esValorMerge(hoyOverride['NOMBRES'])) nombreLead = hoyOverride['NOMBRES'];
      if (esValorMerge(hoyOverride['TELEFONO 3'])) telefono3Value = hoyOverride['TELEFONO 3'];
      if (esValorMerge(hoyOverride['EMAIL'])) emailValue = hoyOverride['EMAIL'];
    }

    var pagoInfo = null;
    if (esAdmin) {
      pagoInfo = pagosMap[idValue] || null;
      if (pagoInfo) {
        var statusPagoFinal = String(pagoInfo['STATUS DE PAGO FINAL'] || '').trim().toUpperCase();
        if (statusPagoFinal === 'PAGO COMPLETO' || statusPagoFinal === 'PAGO FRACCIONADO') {
          statusValue = statusPagoFinal;
        }
      }
    }

    if (esAdmin) {
      var vpsDifValue = idxVPsDif !== -1 ? Number(row[idxVPsDif]) || 0 : 0;
      var visibleParaAdmin = vpsDifValue !== 0 ||
        (hoyOverride && (statusValue === 'VALORES_VALORACIONES_POSITIVAS_VIVA' || statusValue === 'VALORES_PROMESA_DE_PAGO_VIVA'));
      if (!visibleParaAdmin) continue;
    } else {
      if (statusValue !== 'VALORES_VALORACIONES_POSITIVAS_VIVA' && statusValue !== 'VALORES_PROMESA_DE_PAGO_VIVA') continue;
      if (nombreAsesor && asesorValue.toLowerCase() !== nombreAsesor.toLowerCase()) continue;
    }

    if (filtros.carrera && filtros.carrera !== 'Todas' && carreraValue !== filtros.carrera) continue;
    if (filtros.ingreso && filtros.ingreso !== 'Todos' && ingresoValue !== filtros.ingreso) continue;
    if (filtros.modalidad && filtros.modalidad !== 'Todas' && modalidadValue !== filtros.modalidad) continue;
    if (filtros.status && filtros.status !== 'Todos' && statusValue !== filtros.status) continue;

    var leadObj = {};
    for (var h = 0; h < headers.length; h++) leadObj[headers[h]] = row[h];
    leadObj['ID PROMETEO'] = idValue;
    leadObj['STATUS DE GESTION'] = statusValue;
    if (pagoInfo) {
      if (esValorMerge(pagoInfo['FECHA DE PAGO COMPLETO'])) leadObj['FECHA DE PAGO COMPLETO'] = pagoInfo['FECHA DE PAGO COMPLETO'];
      if (esValorMerge(pagoInfo['FECHA DE PROMESA DE PAGO'])) leadObj['FECHA DE PROMESA DE PAGO'] = pagoInfo['FECHA DE PROMESA DE PAGO'];
    }
    // Nombre crudo para filtrar/comparar (ver getAsesorNombreAuxMap para la regla completa)
    leadObj['ASESOR_NOMBRE_RAW'] = asesorValue || '';
    leadObj['ASESOR ULT TIP DF SN CONTC'] = asesorValue ? aNombreAuxParaMostrar(asesorValue, nombreAuxMap) : '-';
    leadObj['CARRERA'] = carreraValue;
    leadObj['PROGRAMA'] = carreraValue;
    leadObj['MODALIDAD INGRESO'] = ingresoValue;
    leadObj['MODALIDAD'] = modalidadValue;
    leadObj['NOMBRE DEL COLEGIO'] = colegioValue;
    leadObj['FECHA COMPROMISO DE PAGO'] = fechaCompromisoValue;
    leadObj['BOLETA DE COLEGIO'] = boletaColegioValue;
    leadObj['NOMBRES'] = nombreLead
    leadObj['TELEFONO 3'] = telefono3Value;
    leadObj['EMAIL'] = emailValue;
    if (hoyOverride) leadObj['ACTUALIZADO_HOY'] = true;

    var bottomRow = resolverBottom(idValue, asesorValue);
    for (var bk in bottomRow) {
      if (bottomRow.hasOwnProperty(bk) && esValorMerge(bottomRow[bk])) leadObj[bk] = bottomRow[bk];
    }
    leadObj['BENEFICIO'] = bottomRow['BENEFICIO'] || 'NO';
    leadObj['BENEFICIO_ADICIONAL'] = bottomRow['BENEFICIO_ADICIONAL'] || 'NO';
    leadObj['PERFILAMIENTO_COMPLETO'] = calcularPerfilamientoCompleto(bottomRow);

    if (filtros.beneficio && filtros.beneficio !== 'Todos' && leadObj['BENEFICIO'] !== filtros.beneficio) continue;

    filasMatch++;
    leads.push(leadObj);
  }

  for (var idHoy in hoyMap) {
    if (idsEnBase[idHoy]) continue;
    var h2 = hoyMap[idHoy];

    var statusHoy = h2['STATUS DE GESTION'] || '';
    var asesorHoy = h2['ASESOR ULT TIP DF SN CONTC'] || '';
    var carreraHoy = h2['CARRERA'] || h2['PROGRAMA'] || '';
    var ingresoHoy = h2['MODALIDAD INGRESO'] || '';
    var modalidadHoy = h2['MODALIDAD'] || '';

    if (statusHoy !== 'VALORES_VALORACIONES_POSITIVAS_VIVA' && statusHoy !== 'VALORES_PROMESA_DE_PAGO_VIVA') continue;
    if (!esAdmin && nombreAsesor && asesorHoy.toLowerCase() !== nombreAsesor.toLowerCase()) continue;

    if (filtros.carrera && filtros.carrera !== 'Todas' && carreraHoy !== filtros.carrera) continue;
    if (filtros.ingreso && filtros.ingreso !== 'Todos' && ingresoHoy !== filtros.ingreso) continue;
    if (filtros.modalidad && filtros.modalidad !== 'Todas' && modalidadHoy !== filtros.modalidad) continue;
    if (filtros.status && filtros.status !== 'Todos' && statusHoy !== filtros.status) continue;

    var leadObjHoy = {
      'ID PROMETEO': idHoy,
      'NOMBRES': h2['NOMBRES'] || '',
      'TELEFONO 2': h2['TELEFONO 2'] || '',
      'TELEFONO 3': h2['TELEFONO 3'] || '',
      'EMAIL': h2['EMAIL'] || '',
      'NOMBRE DEL COLEGIO': h2['NOMBRE DEL COLEGIO'] || '',
      'CAMPAÑA': campana,
      'CARRERA': carreraHoy,
      'PROGRAMA': carreraHoy,
      'MODALIDAD': modalidadHoy,
      'MODALIDAD INGRESO': ingresoHoy,
      'BOLETA DE COLEGIO': h2['BOLETA DE COLEGIO'] || '',
      'FECHA HORA DE REGISTRO': h2['FECHA HORA DE REGISTRO'] || '',
      'ASESOR_NOMBRE_RAW': asesorHoy || '',
      'ASESOR ULT TIP DF SN CONTC': asesorHoy ? aNombreAuxParaMostrar(asesorHoy, nombreAuxMap) : '-',
      'STATUS DE GESTION': statusHoy,
      'ACTUALIZADO_HOY': true,
      'SOLO_HOY': true
    };

    var bottomRowHoy = resolverBottom(idHoy, asesorHoy);
    for (var bk2 in bottomRowHoy) if (bottomRowHoy.hasOwnProperty(bk2)) leadObjHoy[bk2] = bottomRowHoy[bk2];
    leadObjHoy['BENEFICIO'] = bottomRowHoy['BENEFICIO'] || 'NO';
    leadObjHoy['BENEFICIO_ADICIONAL'] = bottomRowHoy['BENEFICIO_ADICIONAL'] || 'NO';
    leadObjHoy['PERFILAMIENTO_COMPLETO'] = calcularPerfilamientoCompleto(bottomRowHoy);

    if (filtros.beneficio && filtros.beneficio !== 'Todos' && leadObjHoy['BENEFICIO'] !== filtros.beneficio) continue;

    filasMatch++;
    leads.push(leadObjHoy);
  }

  var tTotal = Date.now() - t0;

  return json({
    success: true,
    data: leads,
    timings: {
      esAdmin: esAdmin,
      filasEnHoja: data.length - 1,
      filasEvaluadas: filasEvaluadas,
      filasQueHicieronMatch: filasMatch,
      leadsFinal: leads.length,
      msLecturaHojaCompleta: tLecturaCompleta,
      msConstruirResolverBottom: tResolverBottom,
      msTotal: tTotal
    }
  });
}

function calcularPerfilamientoCompleto(bottomRow) {
  var campos = ['POR_QUE_ELIGIO_CARRERA', 'QUE_BUSCA_UNIVERSIDAD', 'QUIEN_FINANCIARA', 'ACCIONES_DEFINIDAS', 'QUE_LE_FALTA', 'OTRAS_OPCIONES'];
  var respondidas = 0;
  campos.forEach(function(c) {
    if (bottomRow[c] && String(bottomRow[c]).trim() !== '') respondidas++;
  });
  return { respondidas: respondidas, total: campos.length, completo: respondidas === campos.length };
}

function getLeadsConAprobacion(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });
  return getLeads(body);
}

// ============================================================
// FICHA DE LEAD
// ============================================================

function getLeadDetail(body) {
  var t0 = Date.now();
  var timings = [];
  function marcar(label) { timings.push({ label: label, ms: Date.now() - t0 }); }

  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var idTarget = String(body.id).trim();
  var campana = body.campana;
  var email = sesion.email.trim().toLowerCase();
  var rol = sesion.rol;

  var leadObj = {};
  var sheetBase = SS.getSheetByName(campana);
  marcar('abrió spreadsheet + hoja base');

  if (sheetBase) {
    var headersBase = sheetBase.getRange(1, 1, 1, sheetBase.getLastColumn()).getValues()[0];
    var idIndexBase = headersBase.indexOf('ID PROMETEO');
    if (idIndexBase === -1) idIndexBase = headersBase.indexOf('ID_PROMETEO');
    marcar('leyó headers base');

    if (idIndexBase !== -1) {
      var colLetter = columnToLetter(idIndexBase + 1);
      var rangoColumna = sheetBase.getRange(colLetter + '2:' + colLetter);
      var encontrado = rangoColumna.createTextFinder(idTarget)
                          .matchEntireCell(true)
                          .findNext();
      marcar('buscó fila base (TextFinder)');

      var rowIndexBase = encontrado ? encontrado.getRow() : -1;

      if (rowIndexBase !== -1) {
        var rowDataBase = sheetBase.getRange(rowIndexBase, 1, 1, sheetBase.getLastColumn()).getValues()[0];
        for (var j = 0; j < headersBase.length; j++) leadObj[headersBase[j]] = rowDataBase[j];
        marcar('leyó fila base completa');
      }
    }
  }

  var encontradoEnBaseDetail = (typeof rowIndexBase !== 'undefined') && rowIndexBase !== -1;

  leadObj['ID PROMETEO'] = idTarget;
  leadObj['ID_PROMETEO'] = idTarget;
  if (leadObj['NOMBRE DEL COLEGIO'] && !leadObj['COLEGIO']) leadObj['COLEGIO'] = leadObj['NOMBRE DEL COLEGIO'];
  if (leadObj['PROGRAMA'] && !leadObj['CARRERA']) leadObj['CARRERA'] = leadObj['PROGRAMA'];
  else if (leadObj['CARRERA'] && !leadObj['PROGRAMA']) leadObj['PROGRAMA'] = leadObj['CARRERA'];

  // Se muestra como Nombre_Aux (ver getAsesorNombreAuxMap); mismo criterio que getLeads().
  if (leadObj['ASESOR ULT TIP DF SN CONTC']) {
    leadObj['ASESOR_NOMBRE_RAW'] = leadObj['ASESOR ULT TIP DF SN CONTC'];
    leadObj['ASESOR ULT TIP DF SN CONTC'] = aNombreAuxParaMostrar(leadObj['ASESOR ULT TIP DF SN CONTC'], getAsesorNombreAuxMap());
  }

  var hoyOverrideDetail = getHoyMap(campana)[idTarget];

  // Si el lead no existe en la hoja base, hoy{campana} es la ÚNICA fuente de datos — se copia la fila completa (STATUS, COLEGIO, CODIGO MODULAR, etc.)
  if (!encontradoEnBaseDetail && hoyOverrideDetail) {
    for (var kHoy in hoyOverrideDetail) {
      if (hoyOverrideDetail.hasOwnProperty(kHoy)) leadObj[kHoy] = hoyOverrideDetail[kHoy];
    }
    if (leadObj['NOMBRE DEL COLEGIO'] && !leadObj['COLEGIO']) leadObj['COLEGIO'] = leadObj['NOMBRE DEL COLEGIO'];
  }

  // Identidad (nombre/teléfono/email/DNI/carrera): solo se confía en
  // hoy{campana} si es VP/PP Viva Y coincide el asesor.
  if (hoyOverrideEsConfiable(hoyOverrideDetail, leadObj['ASESOR_NOMBRE_RAW'], encontradoEnBaseDetail)) {
    if (esValorMerge(hoyOverrideDetail['NOMBRES'])) leadObj['NOMBRES'] = hoyOverrideDetail['NOMBRES'];
    if (esValorMerge(hoyOverrideDetail['TELEFONO 2'])) leadObj['TELEFONO 2'] = hoyOverrideDetail['TELEFONO 2'];
    if (esValorMerge(hoyOverrideDetail['TELEFONO 3'])) leadObj['TELEFONO 3'] = hoyOverrideDetail['TELEFONO 3'];
    if (esValorMerge(hoyOverrideDetail['EMAIL'])) leadObj['EMAIL'] = hoyOverrideDetail['EMAIL'];
    // Antes leía la llave 'DNI', que no existe en hoy{campana} (la columna real es
    // 'NUMERO DE DOCUMENTO'), así que este override nunca se aplicaba.
    if (esValorMerge(hoyOverrideDetail['NUMERO DE DOCUMENTO'])) leadObj['NUMERO DE DOCUMENTO'] = hoyOverrideDetail['NUMERO DE DOCUMENTO'];
    // CARRERA/PROGRAMA se mantienen sincronizados (ver normalización unas líneas arriba).
    var carreraHoyDetail = hoyOverrideDetail['PROGRAMA'] || hoyOverrideDetail['CARRERA'];
    if (esValorMerge(carreraHoyDetail)) {
      leadObj['CARRERA'] = carreraHoyDetail;
      leadObj['PROGRAMA'] = carreraHoyDetail;
    }
  }

  // Asignación (ASESOR / MODALIDAD / MODALIDAD INGRESO): se calcula acá pero
  // se aplica al final de la función — después del merge de bottom/masReciente
  // en la rama SUPERVISOR/ADMISION — para que ese merge no lo vuelva a pisar.
  var permitirAsignacion = permitirActualizarAsignacionDetail(hoyOverrideDetail, leadObj['ASESOR_NOMBRE_RAW'], encontradoEnBaseDetail);
  var asignacionOverride = {};
  if (permitirAsignacion) {
    if (esValorMerge(hoyOverrideDetail['ASESOR ULT TIP DF SN CONTC'])) {
      asignacionOverride.asesorRaw = hoyOverrideDetail['ASESOR ULT TIP DF SN CONTC'];
    }
    if (esValorMerge(hoyOverrideDetail['MODALIDAD'])) asignacionOverride.modalidad = hoyOverrideDetail['MODALIDAD'];
    if (esValorMerge(hoyOverrideDetail['MODALIDAD INGRESO'])) asignacionOverride.modalidadIngreso = hoyOverrideDetail['MODALIDAD INGRESO'];
  }

  function aplicarAsignacionOverride(obj) {
    if (asignacionOverride.asesorRaw) {
      var nombreMostrar = aNombreAuxParaMostrar(asignacionOverride.asesorRaw, getAsesorNombreAuxMap());
      obj['ASESOR_NOMBRE_RAW'] = asignacionOverride.asesorRaw;
      obj['ASESOR ULT TIP DF SN CONTC'] = nombreMostrar;
      obj['ASESOR_NOMBRE'] = nombreMostrar; // el header de SUPERVISOR/ADMISION prioriza este campo
    }
    if (asignacionOverride.modalidad !== undefined) obj['MODALIDAD'] = asignacionOverride.modalidad;
    if (asignacionOverride.modalidadIngreso !== undefined) obj['MODALIDAD INGRESO'] = asignacionOverride.modalidadIngreso;
  }

  if (leadObj['TELEFONO 2'] && !leadObj['TELEFONO']) leadObj['TELEFONO'] = leadObj['TELEFONO 2'];

  var filasBottomDelLead = getBottomRowsPorId(campana, idTarget);
  marcar('terminó hoja bottom (' + filasBottomDelLead.length + ' filas)');

  if (esRolSupervisorOAdmision(rol)) {
    var asesorEmailMap = getAsesorEmailMap();
    var nombreAuxMapDetail = getAsesorNombreAuxMap();
    marcar('terminó getAsesorEmailMap');

    // Email -> Nombre_Aux (ASESOR_NOMBRE es un campo de visualización).
    var emailToNombre = {};
    for (var nombre in asesorEmailMap) {
      emailToNombre[String(asesorEmailMap[nombre]).trim().toLowerCase()] = nombreAuxMapDetail[nombre] || nombre;
    }

    var historiales = filasBottomDelLead.map(function(fila) {
      var copia = {};
      for (var k in fila) copia[k] = fila[k];
      copia['ASESOR_NOMBRE'] = emailToNombre[String(fila.ASESOR_EMAIL || '').trim().toLowerCase()] || fila.ASESOR_EMAIL || 'Desconocido';
      return copia;
    });

    var masReciente = historiales.slice().sort(function(a, b) {
      return new Date(b.FECHA_ULT_MODIFICACION || 0) - new Date(a.FECHA_ULT_MODIFICACION || 0);
    })[0];
    if (masReciente) for (var k2 in masReciente) leadObj[k2] = masReciente[k2];

    aplicarAsignacionOverride(leadObj);

    marcar('TOTAL (SUPERVISOR/ADMISION)');
    return json({ success: true, data: leadObj, historialAsesores: historiales, timings: timings });

  } else {
    var filaPropia = filasBottomDelLead.filter(function(r) {
      return String(r.ASESOR_EMAIL || '').trim().toLowerCase() === email;
    })[0];
    if (filaPropia) for (var k3 in filaPropia) leadObj[k3] = filaPropia[k3];

    aplicarAsignacionOverride(leadObj);

    marcar('TOTAL (ASESOR)');
    return json({ success: true, data: leadObj, timings: timings });
  }
}

function getLeadPayments(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var idBuscar = String(body.idPrometeo).trim();
  var pName = 'pagos' + body.campana;
  var pagos = sheetToObjects(pName);
  var filtrados = pagos.filter(function(p) {
    return String(p['ID PROMETEO'] || p.id_prometeo || '').trim() === idBuscar;
  });
  return json({ success: true, data: filtrados });
}

// ============================================================
// BÚSQUEDA Y UNIFICACIÓN
// ============================================================

function searchLeads(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var campana = body.campana;
  var searchType = body.searchType;
  var searchValue = String(body.searchValue || '').toLowerCase().trim();

  var sheetBase = SS.getSheetByName(campana);
  if (!sheetBase) return json({ success: false, error: 'Hoja de campaña no encontrada' });

  var resultados = [];
  var idsActivos = {};
  var lastRow = sheetBase.getLastRow();

  if (lastRow >= 2) {
    var headersCompletos = sheetBase.getRange(1, 1, 1, sheetBase.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
    var idIdx1 = headersCompletos.indexOf('ID PROMETEO') + 1;
    var nombreIdx1 = headersCompletos.indexOf('NOMBRES') + 1;
    var dniIdx1 = headersCompletos.indexOf('NUMERO DE DOCUMENTO') + 1;
    var celularIdx1 = headersCompletos.indexOf('TELEFONO 2') + 1;

    var columnas = [idIdx1, nombreIdx1, dniIdx1, celularIdx1].filter(function(c){ return c > 0; });

    if (columnas.length > 0) {
      var data = leerColumnasOptimizado(sheetBase, columnas, lastRow);
      var headers = data[0].map(function(h){ return String(h).trim(); });

      var idIdx = headers.indexOf('ID PROMETEO');
      var nombreIdx = headers.indexOf('NOMBRES');
      var dniIdx = headers.indexOf('NUMERO DE DOCUMENTO');
      var celularIdx = headers.indexOf('TELEFONO 2');

      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var idValue = idIdx !== -1 ? String(row[idIdx]).trim() : '';
        if (!idValue) continue;
        idsActivos[idValue] = true;

        var campoValor = '';
        if (searchType === 'nombre' && nombreIdx !== -1) campoValor = String(row[nombreIdx] || '');
        else if (searchType === 'dni' && dniIdx !== -1) campoValor = String(row[dniIdx] || '');
        else if (searchType === 'celular' && celularIdx !== -1) campoValor = String(row[celularIdx] || '');

        if (campoValor.toLowerCase().indexOf(searchValue) !== -1) {
          resultados.push({
            'ID PROMETEO': idValue,
            'ID_PROMETEO': idValue,
            'NOMBRES': nombreIdx !== -1 ? row[nombreIdx] : '',
            'NUMERO DE DOCUMENTO': dniIdx !== -1 ? row[dniIdx] : '',
            'TELEFONO 2': celularIdx !== -1 ? row[celularIdx] : '',
            'activo': true
          });
        }
      }
    }
  }

  var idsVistos = {};
  resultados.forEach(function(r) { idsVistos[r['ID PROMETEO']] = true; });

  var filasBottom = getBottomRows(campana);
  filasBottom.forEach(function(fila) {
    var id = String(fila.ID_PROMETEO || '').trim();
    if (!id) return;
    if (idsActivos[id]) return;
    if (idsVistos[id]) return;

    var campoValor = '';
    if (searchType === 'nombre') campoValor = String(fila.NOMBRE_LEAD || '');
    else if (searchType === 'dni') campoValor = String(fila.DNI_LEAD || '');
    else if (searchType === 'celular') campoValor = String(fila.CELULAR_LEAD || '');

    if (campoValor.toLowerCase().indexOf(searchValue) !== -1) {
      idsVistos[id] = true;
      resultados.push({
        'ID PROMETEO': id,
        'ID_PROMETEO': id,
        'NOMBRES': fila.NOMBRE_LEAD || '[Sin nombre registrado]',
        'NUMERO DE DOCUMENTO': fila.DNI_LEAD || '',
        'TELEFONO 2': fila.CELULAR_LEAD || '',
        'activo': false
      });
    }
  });

  return json({ success: true, data: resultados });
}

function unifyIds(body) {
  return conLock(function() { return unifyIdsInterno(body); });
}

function unifyIdsInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var idPrincipal = String(body.idPrincipal).trim();
  var idsSecundarios = Array.isArray(body.idsSecundarios)
    ? body.idsSecundarios.map(function(id){ return String(id).trim(); })
    : [String(body.idSecundario).trim()];
  var campana = body.campana;
  var datosPredominantes = body.datosPredominantes || {};

  if (!existeEnBase(campana, idPrincipal)) {
    return json({ success: false, error: 'El ID Principal debe existir en la hoja base' });
  }

  idsSecundarios = idsSecundarios.filter(function(id) { return id && id !== idPrincipal; });
  if (idsSecundarios.length === 0) {
    return json({ success: false, error: 'No hay IDs secundarios válidos' });
  }

  var sheetBottom = SS.getSheetByName('bottom' + campana);
  if (!sheetBottom) return json({ success: false, error: 'Hoja de gestión (bottom) no encontrada' });

  var data = sheetBottom.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idIdx = headers.indexOf('ID_PROMETEO');
  var asesorIdx = headers.indexOf('ASESOR_EMAIL');
  var historialIdx = headers.indexOf('COMENTARIOS_HISTORIAL');
  if (idIdx === -1 || asesorIdx === -1) {
    return json({ success: false, error: 'Faltan columnas ID_PROMETEO/ASESOR_EMAIL' });
  }

  idsSecundarios.forEach(function(idSecundario) {
    var dataActual = sheetBottom.getDataRange().getValues();

    var filasPrincipalPorAsesor = {};
    for (var i = 1; i < dataActual.length; i++) {
      if (String(dataActual[i][idIdx]).trim() === idPrincipal) {
        filasPrincipalPorAsesor[String(dataActual[i][asesorIdx]).trim().toLowerCase()] = i;
      }
    }

    var filasSecundario = [];
    for (var r = 1; r < dataActual.length; r++) {
      if (String(dataActual[r][idIdx]).trim() === idSecundario) filasSecundario.push(r);
    }

    filasSecundario.forEach(function(rIdx) {
      var asesorKey = String(dataActual[rIdx][asesorIdx]).trim().toLowerCase();
      var choqueIdx = filasPrincipalPorAsesor[asesorKey];

      if (choqueIdx !== undefined) {
        var historialPrincipal = historialIdx !== -1 ? String(dataActual[choqueIdx][historialIdx] || '') : '';
        var historialSecundario = historialIdx !== -1 ? String(dataActual[rIdx][historialIdx] || '') : '';
        if (historialIdx !== -1) {
          sheetBottom.getRange(choqueIdx + 1, historialIdx + 1)
            .setValue(mergeHistorial(historialPrincipal, historialSecundario, datosPredominantes.historial));
        }
      } else {
        sheetBottom.getRange(rIdx + 1, idIdx + 1).setValue(idPrincipal);
      }
    });

    var dataParaBorrar = sheetBottom.getDataRange().getValues();
    for (var d = dataParaBorrar.length - 1; d >= 1; d--) {
      if (String(dataParaBorrar[d][idIdx]).trim() === idSecundario) sheetBottom.deleteRow(d + 1);
    }
  });

  var camposAAplicar = {};
  if (datosPredominantes.beneficio) camposAAplicar['BENEFICIO'] = datosPredominantes.beneficio;
  if (datosPredominantes.boleta) camposAAplicar['BOLETA_FINAL'] = datosPredominantes.boleta;
  if (datosPredominantes.status) camposAAplicar['ESTADO_APROBACION'] = datosPredominantes.status;

  if (Object.keys(camposAAplicar).length > 0) {
    var dataFinal = sheetBottom.getDataRange().getValues();
    for (var f = 1; f < dataFinal.length; f++) {
      if (String(dataFinal[f][idIdx]).trim() === idPrincipal) {
        for (var campo in camposAAplicar) {
          var colIdx = headers.indexOf(campo);
          if (colIdx !== -1) sheetBottom.getRange(f + 1, colIdx + 1).setValue(camposAAplicar[campo]);
        }
      }
    }
  }

  try { CacheService.getScriptCache().remove('bottomRows_' + campana); } catch (e) {}

  return json({ success: true, message: 'Fusión completada: ' + idsSecundarios.length + ' registro(s) unificado(s) al principal ' + idPrincipal });
}

// ============================================================
// SOLICITUDES
// ============================================================

function getSolicitudPendiente(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var sheet = SS.getSheetByName('SOLICITUDES');
  if (!sheet) return json({ success: false, error: 'Hoja SOLICITUDES no encontrada' });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return json({ success: true, data: null });

  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idIdx = headers.indexOf('ID_PROMETEO');
  var campanaIdx = headers.indexOf('CAMPANA');
  var statusIdx = headers.indexOf('STATUS');

  var candidatas = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.idPrometeo).trim() &&
        String(data[i][campanaIdx]).trim() === String(body.campana).trim()) {
      var status = String(data[i][statusIdx]).trim();
      if (status === 'PENDIENTE' || status === 'RECHAZADO') {
        var obj = {};
        for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
        candidatas.push(obj);
      }
    }
  }
  if (candidatas.length === 0) return json({ success: true, data: null });

  candidatas.sort(function(a, b) { return new Date(b.FECHA_SOLICITUD || 0) - new Date(a.FECHA_SOLICITUD || 0); });
  return json({ success: true, data: candidatas[0] });
}

// Solicitudes PENDIENTE de una campaña (campanita del dashboard supervisor/admisión)
function getSolicitudesPendientesCampana(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var sheet = SS.getSheetByName('SOLICITUDES');
  if (!sheet) return json({ success: true, data: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return json({ success: true, data: [] });

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var campanaIdx = headers.indexOf('CAMPANA');
  var statusIdx = headers.indexOf('STATUS');

  var resultados = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][campanaIdx]).trim() === String(body.campana).trim() &&
        String(data[i][statusIdx]).trim() === 'PENDIENTE') {
      var obj = {};
      for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
      resultados.push(obj);
    }
  }

  return json({ success: true, data: resultados });
}

// No se registra en doPost; usado por saveBottomInterno
function haySolicitudPendiente(idPrometeo, campana) {
  var sheet = SS.getSheetByName('SOLICITUDES');
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idIdx = headers.indexOf('ID_PROMETEO');
  var campanaIdx = headers.indexOf('CAMPANA');
  var statusIdx = headers.indexOf('STATUS');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(idPrometeo).trim() &&
        String(data[i][campanaIdx]).trim() === String(campana).trim() &&
        String(data[i][statusIdx]).trim() === 'PENDIENTE') return true;
  }
  return false;
}

function createSolicitud(body) {
  return conLock(function() { return createSolicitudInterno(body); });
}

function createSolicitudInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  if (!body.boletaActual || String(body.boletaActual).trim() === '') {
    return json({ success: false, error: 'Debes guardar la boleta del lead antes de solicitar una recategorización.' });
  }

  var sheet = SS.getSheetByName('SOLICITUDES');
  if (!sheet) return json({ success: false, error: 'Hoja SOLICITUDES no encontrada' });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h){ return String(h).trim(); });

  var dataExistente = sheet.getDataRange().getValues();
  var idIdxE = headers.indexOf('ID_PROMETEO');
  var campanaIdxE = headers.indexOf('CAMPANA');
  var statusIdxE = headers.indexOf('STATUS');
  for (var e = 1; e < dataExistente.length; e++) {
    if (String(dataExistente[e][idIdxE]).trim() === String(body.idPrometeo).trim() &&
        String(dataExistente[e][campanaIdxE]).trim() === String(body.campana).trim() &&
        String(dataExistente[e][statusIdxE]).trim() === 'PENDIENTE') {
      return json({ success: false, error: 'Ya existe una solicitud pendiente para este lead.' });
    }
  }

  var asesorEmail = esRolSupervisorOAdmision(sesion.rol) ? (body.asesorEmail || sesion.email) : sesion.email;
  var asesorNombre = esRolSupervisorOAdmision(sesion.rol) ? (body.asesorNombre || sesion.nombre) : sesion.nombre;

  var idSolicitud = Utilities.getUuid();
  var nuevaFila = {
    ID_SOLICITUD: idSolicitud,
    ID_PROMETEO: body.idPrometeo,
    CAMPANA: body.campana,
    ASESOR_EMAIL: asesorEmail,
    ASESOR_NOMBRE: asesorNombre || '',
    BOLETA_ACTUAL: body.boletaActual,
    BENEFICIO_ACTUAL: body.beneficioActual,
    BOLETA_CON_BECA_ACTUAL: body.boletaConBecaActual,
    BOLETA_SOLICITADA: body.boletaSolicitada,
    BENEFICIO_SOLICITADO: body.beneficioSolicitado,
    BOLETA_CON_BECA_SOLICITADA: body.boletaConBecaSolicitada,
    STATUS: 'PENDIENTE',
    FECHA_SOLICITUD: new Date().toISOString(),
    FECHA_RESOLUCION: '',
    ADMIN_EMAIL: ''
  };

  var fila = headers.map(function(h) {
    return nuevaFila[h] !== undefined ? nuevaFila[h] : '';
  });
  sheet.appendRow(fila);

  // Fuerza texto plano: Sheets auto-detecta "26.2" como fecha y corrompe el dato
  var campanaColIdx = headers.indexOf('CAMPANA');
  if (campanaColIdx !== -1) {
    var filaNueva = sheet.getLastRow();
    sheet.getRange(filaNueva, campanaColIdx + 1)
      .setNumberFormat('@')
      .setValue(body.campana);
  }

  return json({ success: true, idSolicitud: idSolicitud });
}

function resolveSolicitud(body) {
  return conLock(function() { return resolveSolicitudInterno(body); });
}

function resolveSolicitudInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });
  var adminEmail = sesion.email;

  var sheet = SS.getSheetByName('SOLICITUDES');
  if (!sheet) return json({ success: false, error: 'Hoja SOLICITUDES no encontrada' });

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idIdx = headers.indexOf('ID_SOLICITUD');
  var statusIdx = headers.indexOf('STATUS');
  var fechaResIdx = headers.indexOf('FECHA_RESOLUCION');
  var adminIdx = headers.indexOf('ADMIN_EMAIL');

  var rowIndex = -1;
  var solicitud = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.id).trim()) {
      rowIndex = i;
      solicitud = {};
      for (var j = 0; j < headers.length; j++) solicitud[headers[j]] = data[i][j];
      break;
    }
  }
  if (rowIndex === -1) return json({ success: false, error: 'Solicitud no encontrada' });

  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue(body.status);
  sheet.getRange(rowIndex + 1, fechaResIdx + 1).setValue(new Date().toISOString());
  sheet.getRange(rowIndex + 1, adminIdx + 1).setValue(adminEmail);

  if (body.status === 'APROBADO') {
    // saveBottomInterno() para no re-adquirir el lock (deadlock)
    saveBottomInterno({
      idPrometeo: solicitud.ID_PROMETEO,
      campana: solicitud.CAMPANA,
      sessionToken: body.sessionToken,
      data: {
        BOLETA: solicitud.BOLETA_SOLICITADA,
        BENEFICIO: solicitud.BENEFICIO_SOLICITADO,
        BOLETA_CON_BECA: solicitud.BOLETA_CON_BECA_SOLICITADA,
        FECHA_ULT_MODIFICACION: new Date().toISOString()
      },
      asesorEmail: solicitud.ASESOR_EMAIL
    });
  }

  return json({ success: true });
}

function cancelarSolicitud(body) {
  return conLock(function() { return cancelarSolicitudInterno(body); });
}

function cancelarSolicitudInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var sheet = SS.getSheetByName('SOLICITUDES');
  if (!sheet) return json({ success: false, error: 'Hoja SOLICITUDES no encontrada' });

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idIdx = headers.indexOf('ID_SOLICITUD');
  var statusIdx = headers.indexOf('STATUS');
  var asesorIdx = headers.indexOf('ASESOR_EMAIL');
  var fechaResIdx = headers.indexOf('FECHA_RESOLUCION');

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.id).trim()) { rowIndex = i; break; }
  }
  if (rowIndex === -1) return json({ success: false, error: 'Solicitud no encontrada' });

  var esDueño = String(data[rowIndex][asesorIdx]).trim().toLowerCase() === sesion.email.trim().toLowerCase();
  if (!esRolSupervisorOAdmision(sesion.rol) && !esDueño) {
    return json({ success: false, error: 'No puedes cancelar una solicitud que no es tuya' });
  }
  if (String(data[rowIndex][statusIdx]).trim() !== 'PENDIENTE') {
    return json({ success: false, error: 'Esta solicitud ya fue resuelta y no se puede cancelar' });
  }

  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue('CANCELADO');
  sheet.getRange(rowIndex + 1, fechaResIdx + 1).setValue(new Date().toISOString());
  return json({ success: true });
}

// ============================================================
// CONDICIONES COMERCIALES — Solicitudes de envío (CC)
// ============================================================

// TODO: reemplaza con el ID de la carpeta de Drive donde se guardarán
// los DNI / Certificados / Boletas de Procedencia adjuntados por el asesor.
var CARPETA_ADJUNTOS_CC = '1c1Db4C3PqTyH64nscvtejLfBOwADm-yM';

function getHojaSolicitudesCC() {
  var sheet = SS.getSheetByName('SOLICITUDES_CC');
  var COLUMNAS_ESPERADAS = [
    'ID_SOLICITUD', 'FECHA_SOLICITUD', 'CAMPANA', 'ID_PROMETEO',
    'ASESOR_EMAIL', 'ASESOR_NOMBRE', 'CORREOS_ADICIONALES',
    'DNI_FILE_ID', 'DNI_FILE_NOMBRE',
    'CERTIFICADO_FILE_ID', 'CERTIFICADO_FILE_NOMBRE',
    'BOLETA_PROCEDENCIA_FILE_ID', 'BOLETA_PROCEDENCIA_FILE_NOMBRE',
    'STATUS', 'FECHA_RESOLUCION', 'ADMIN_EMAIL', 'MOTIVO_RECHAZO',
    'TIPO_REFERIDO', 'PERSONAS_REFERIDO_JSON'
  ];
  if (!sheet) {
    sheet = SS.insertSheet('SOLICITUDES_CC');
    sheet.appendRow(COLUMNAS_ESPERADAS);
  } else {
    // Migración: agrega cualquier columna nueva que la hoja ya existente no tenga aún
    var headersActuales = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function(h) { return String(h).trim(); });
    COLUMNAS_ESPERADAS.forEach(function(col) {
      if (headersActuales.indexOf(col) === -1) {
        headersActuales.push(col);
        sheet.getRange(1, headersActuales.length).setValue(col);
      }
    });
  }
  return sheet;
}

function getSolicitudesCC(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var sheet = getHojaSolicitudesCC();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return json({ success: true, data: [] });

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idxStatus = headers.indexOf('STATUS');
  var idxCampana = headers.indexOf('CAMPANA');
  var idxId = headers.indexOf('ID_PROMETEO');

  var campanasPermitidas = null;
  if (sesion.rol === 'SUPERVISOR') {
    campanasPermitidas = (body.campanas || []).map(function(c) { return String(c).trim(); });
  }

  var soloPendientes = !body.incluirResueltas;

  var resultados = [];
  for (var i = 1; i < data.length; i++) {
    var fila = data[i];
    var status = String(fila[idxStatus]).trim();
    if (status === 'CANCELADO') continue;
    if (soloPendientes && status !== 'PENDIENTE') continue;

    var campanaFila = String(fila[idxCampana]).trim();
    if (campanasPermitidas && campanasPermitidas.indexOf(campanaFila) === -1) continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = fila[j];

    var basicos = capturarIdentidadBase(campanaFila, String(fila[idxId]).trim());
    obj['NOMBRE_LEAD'] = basicos.nombre || '';
    obj['CARRERA_LEAD'] = basicos.carrera || '';

    resultados.push(obj);
  }

  resultados.sort(function(a, b) { return new Date(b.FECHA_SOLICITUD || 0) - new Date(a.FECHA_SOLICITUD || 0); });

  return json({ success: true, data: resultados });
}

function getSolicitudesCCCount(body) {
    var motivo = {};
    var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
    if (!sesion) return json({ success: false, error: motivo.error });

    var hoja = getHojaSolicitudesCC();
    var datos = hoja.getDataRange().getValues();
    var headers = datos[0];
    var idxStatus = headers.indexOf('STATUS');
    var idxCampana = headers.indexOf('CAMPANA');

    var campanasPermitidas = null;
    if (sesion.rol === 'SUPERVISOR') {
        campanasPermitidas = (body.campanas || []).map(function(c) { return String(c).trim(); });
    }
    // ADMISION: campanasPermitidas queda null => sin filtro, ve todo

    var count = 0;
    for (var i = 1; i < datos.length; i++) {
        var fila = datos[i];
        if (fila[idxStatus] !== 'PENDIENTE') continue;
        if (campanasPermitidas && campanasPermitidas.indexOf(String(fila[idxCampana]).trim()) === -1) continue;
        count++;
    }

    return json({ success: true, count: count });
}

function limpiarNombreDrive(texto) {
  return String(texto || '').replace(/[\/\\:*?"<>|]/g, '-').trim();
}

function obtenerOCrearCarpetaCampanaCC(carpetaRaiz, campana) {
  var nombreCarpeta = limpiarNombreDrive(campana || 'SIN-CAMPANA');
  var existentes = carpetaRaiz.getFoldersByName(nombreCarpeta);
  if (existentes.hasNext()) return existentes.next();
  return carpetaRaiz.createFolder(nombreCarpeta);
}

function obtenerOCrearSubcarpetaAlumnoCC(carpetaPadre, dni, nombreCompleto, campana) {
  var nombreCarpeta = limpiarNombreDrive(dni + ' - ' + nombreCompleto + ' - ' + campana);
  var existentes = carpetaPadre.getFoldersByName(nombreCarpeta);
  if (existentes.hasNext()) return existentes.next();
  return carpetaPadre.createFolder(nombreCarpeta);
}

function decodificarArchivoCC(archivo) {
  var bytes = Utilities.base64Decode(archivo.base64);
  return Utilities.newBlob(bytes, archivo.mimeType || 'application/octet-stream', archivo.nombre || 'archivo');
}

function esImagenMimeCC(mimeType) {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg';
}

// Combina 1 o más imágenes en una sola hoja PDF vertical (Carta, 8.5x11 —
// el tamaño por defecto de un Documento nuevo), apiladas en filas, una
// debajo de otra (para el DNI: anverso/reverso en la misma hoja, sin
// importar que las fotos en sí sean verticales u horizontales). Se usa un
// Documento temporal como "lienzo" — una tabla de N filas x 1 columna — y
// se borra apenas se exporta a PDF.
function combinarImagenesEnPdfCC(blobsImagenes, nombreArchivo) {
  var doc = DocumentApp.create('tmp_cc_' + Utilities.getUuid());
  try {
    var body = doc.getBody();
    var margen = 24; // puntos (~0.33in), márgenes chicos para aprovechar la hoja
    body.setMarginTop(margen).setMarginBottom(margen).setMarginLeft(margen).setMarginRight(margen);

    var n = blobsImagenes.length;
    var gap = 10;
    var anchoUtil = body.getPageWidth() - margen * 2;
    var altoUtil = body.getPageHeight() - margen * 2;
    var altoSlot = (altoUtil - gap * (n - 1)) / n; // cada imagen se reparte la altura en partes iguales

    var table = body.appendTable();
    table.setBorderWidth(0); // sin líneas de grilla, es solo un layout, no una tabla visible

    for (var i = 0; i < n; i++) {
      var row = table.appendTableRow();
      var cell = row.appendTableCell();
      table.setColumnWidth(0, anchoUtil); // recién existe la columna una vez creada la 1ra fila/celda
      cell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
      cell.setPaddingTop(0).setPaddingLeft(0).setPaddingRight(0)
          .setPaddingBottom(i < n - 1 ? gap : 0);
      cell.clear(); // quita el párrafo vacío por defecto de la celda

      var imagen = cell.appendImage(blobsImagenes[i]);
      // se capturan el ancho/alto originales ANTES de tocar nada — si se
      // llama a getWidth()/getHeight() después de un setWidth()/setHeight(),
      // se corre el riesgo de leer un valor ya afectado por ese cambio y
      // terminar reduciendo la imagen dos veces.
      var wOriginal = imagen.getWidth();
      var hOriginal = imagen.getHeight();
      var escala = Math.min(anchoUtil / wOriginal, altoSlot / hOriginal);
      imagen.setWidth(wOriginal * escala);
      imagen.setHeight(hOriginal * escala);
      // centrada horizontalmente (el ancho completo de la hoja es su casillero)
      cell.getChild(cell.getNumChildren() - 1).asParagraph()
          .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }
    // no se fuerza altura de fila: cada una se ajusta a su imagen (ya acotada
    // a altoSlot), así la suma de filas no desborda a una segunda hoja
    body.getParagraphs()[0].removeFromParent(); // el párrafo vacío inicial del documento, antes de la tabla

    doc.saveAndClose();
    var pdfBlob = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF);
    pdfBlob.setName(nombreArchivo);
    return pdfBlob;
  } finally {
    DriveApp.getFileById(doc.getId()).setTrashed(true);
  }
}

// Garantiza que un archivo (imagen o PDF) termine como blob PDF con el
// nombre indicado. Si ya es PDF, se deja tal cual; si es imagen, se
// convierte usando el mismo "lienzo" que combinarImagenesEnPdfCC.
function asegurarBlobPdfCC(archivo, nombreArchivo) {
  var blob = decodificarArchivoCC(archivo);
  if (archivo.mimeType === 'application/pdf') {
    blob.setName(nombreArchivo);
    return blob;
  }
  if (esImagenMimeCC(archivo.mimeType)) {
    return combinarImagenesEnPdfCC([blob], nombreArchivo);
  }
  // Tipo no reconocido (no debería llegar aquí, el input del frontend solo
  // acepta pdf/png/jpg): se guarda tal cual, sin forzar conversión.
  blob.setName(nombreArchivo);
  return blob;
}

// Certificado / Boleta de Procedencia: un solo archivo, siempre se guarda como PDF.
function guardarArchivoAlumnoCC(carpetaAlumno, archivo, etiqueta, dni) {
  if (!archivo || !archivo.base64) return { id: '', nombre: '' };
  var nombreFinal = limpiarNombreDrive(etiqueta + ' - ' + dni) + '.pdf';
  var blobPdf = asegurarBlobPdfCC(archivo, nombreFinal);
  var file = carpetaAlumno.createFile(blobPdf);
  return { id: file.getId(), nombre: file.getName() };
}

// DNI: admite 1 o más archivos (ej. anverso/reverso). Si son 2+ y todos son
// imágenes, se combinan en una sola hoja PDF en horizontal. Si viene un solo
// archivo, o si alguno de los archivos ya es un PDF (no se puede fusionar
// una página de PDF existente con imágenes sin una librería externa), se usa
// solo el primer archivo tal cual — no se pierde el flujo, pero en ese caso
// puntual no hay fusión de varias fotos en una hoja.
function guardarArchivoDniCC(carpetaAlumno, archivosDni, dni) {
  var lista = Array.isArray(archivosDni)
    ? archivosDni.filter(function(a) { return a && a.base64; })
    : (archivosDni && archivosDni.base64 ? [archivosDni] : []);
  if (lista.length === 0) return { id: '', nombre: '' };

  var nombreFinal = limpiarNombreDrive('DNI - ' + dni) + '.pdf';
  var todasImagenes = lista.every(function(a) { return esImagenMimeCC(a.mimeType); });

  var blobPdf;
  if (lista.length > 1 && todasImagenes) {
    var blobsImagenes = lista.map(decodificarArchivoCC);
    blobPdf = combinarImagenesEnPdfCC(blobsImagenes, nombreFinal);
  } else {
    blobPdf = asegurarBlobPdfCC(lista[0], nombreFinal);
  }

  var file = carpetaAlumno.createFile(blobPdf);
  return { id: file.getId(), nombre: file.getName() };
}

// ===== getSolicitudCC =====
// Trae la solicitud CC más reciente (no cancelada) de este lead, o null si nunca solicitó.
function getSolicitudCC(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var sheet = getHojaSolicitudesCC();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return json({ success: true, data: null });

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idIdx = headers.indexOf('ID_PROMETEO');
  var campanaIdx = headers.indexOf('CAMPANA');
  var statusIdx = headers.indexOf('STATUS');

  var candidatas = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.idPrometeo).trim() &&
        String(data[i][campanaIdx]).trim() === String(body.campana).trim() &&
        String(data[i][statusIdx]).trim() !== 'CANCELADO') {
      var obj = {};
      for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
      candidatas.push(obj);
    }
  }
  if (candidatas.length === 0) return json({ success: true, data: null });

  candidatas.sort(function(a, b) { return new Date(b.FECHA_SOLICITUD || 0) - new Date(a.FECHA_SOLICITUD || 0); });
  return json({ success: true, data: candidatas[0] });
}

// ===== solicitarCC =====
function solicitarCC(body) {
  return conLock(function() { return solicitarCCInterno(body); });
}

function solicitarCCInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var sheet = getHojaSolicitudesCC();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });

  var dataExistente = sheet.getDataRange().getValues();
  var idIdxE = headers.indexOf('ID_PROMETEO');
  var campanaIdxE = headers.indexOf('CAMPANA');
  var statusIdxE = headers.indexOf('STATUS');
  for (var e = 1; e < dataExistente.length; e++) {
    if (String(dataExistente[e][idIdxE]).trim() === String(body.idPrometeo).trim() &&
        String(dataExistente[e][campanaIdxE]).trim() === String(body.campana).trim() &&
        String(dataExistente[e][statusIdxE]).trim() === 'PENDIENTE') {
      return json({ success: false, error: 'Ya existe una solicitud de Condiciones Comerciales pendiente para este lead.' });
    }
  }

  var asesorEmail = esRolSupervisorOAdmision(sesion.rol) ? (body.asesorEmail || sesion.email) : sesion.email;
  var asesorNombre = esRolSupervisorOAdmision(sesion.rol) ? (body.asesorNombre || sesion.nombre) : sesion.nombre;

  // No se puede solicitar el envío de Condiciones Comerciales si el lead
  // todavía no tiene la boleta guardada en bottom{campana} — el frontend ya
  // bloquea esto (botón oculto + confirmación al abrir el modal), pero esa
  // validación se puede saltar (DevTools, llamada directa a la API), así
  // que se repite acá como última barrera contra solicitudes con datos vacíos.
  var filasBottomLead = getBottomRowsPorId(body.campana, String(body.idPrometeo).trim());
  var filaBottomAsesor = filasBottomLead.filter(function(r) {
    return String(r.ASESOR_EMAIL || '').trim().toLowerCase() === String(asesorEmail).trim().toLowerCase();
  })[0];
  var boletaGuardada = filaBottomAsesor && String(filaBottomAsesor.BOLETA || '').trim() !== '';
  if (!boletaGuardada) {
    return json({ success: false, error: 'No se puede solicitar el envío de Condiciones Comerciales: primero debes guardar los datos de la boleta en la ficha del lead.' });
  }

  var carpetaRaiz = DriveApp.getFolderById(CARPETA_ADJUNTOS_CC);
  var carpetaCampana = obtenerOCrearCarpetaCampanaCC(carpetaRaiz, body.campana);
  var dni = body.dni || 'SIN-DNI';
  var nombreCompleto = body.nombreCompleto || 'SIN-NOMBRE';
  var carpetaAlumno = obtenerOCrearSubcarpetaAlumnoCC(carpetaCampana, dni, nombreCompleto, body.campana);

  var archivos = body.archivos || {};
  var dniArchivo = guardarArchivoDniCC(carpetaAlumno, archivos.dni, dni);
  var certificado = guardarArchivoAlumnoCC(carpetaAlumno, archivos.certificado, 'CERTIFICADO DE ESTUDIOS', dni);
  var boletaProcedencia = guardarArchivoAlumnoCC(carpetaAlumno, archivos.boletaProcedencia, 'BOLETA PROCEDENCIA', dni);

  var idSolicitud = Utilities.getUuid();
  var nuevaFila = {
    ID_SOLICITUD: idSolicitud,
    FECHA_SOLICITUD: new Date().toISOString(),
    CAMPANA: body.campana,
    ID_PROMETEO: body.idPrometeo,
    ASESOR_EMAIL: asesorEmail,
    ASESOR_NOMBRE: asesorNombre || '',
    CORREOS_ADICIONALES: (body.correosAdicionales || []).join(','),
    DNI_FILE_ID: dniArchivo.id,
    DNI_FILE_NOMBRE: dniArchivo.nombre,
    CERTIFICADO_FILE_ID: certificado.id,
    CERTIFICADO_FILE_NOMBRE: certificado.nombre,
    BOLETA_PROCEDENCIA_FILE_ID: boletaProcedencia.id,
    BOLETA_PROCEDENCIA_FILE_NOMBRE: boletaProcedencia.nombre,
    STATUS: 'PENDIENTE',
    FECHA_RESOLUCION: '',
    ADMIN_EMAIL: '',
    TIPO_REFERIDO: '',
    PERSONAS_REFERIDO_JSON: ''
  };

  var fila = headers.map(function(h) { return nuevaFila[h] !== undefined ? nuevaFila[h] : ''; });
  sheet.appendRow(fila);

  // Fuerza texto plano: Sheets auto-detecta "26.2" como fecha y corrompe el dato
  var campanaColIdx = headers.indexOf('CAMPANA');
  if (campanaColIdx !== -1) {
    var filaNueva = sheet.getLastRow();
    sheet.getRange(filaNueva, campanaColIdx + 1).setNumberFormat('@').setValue(body.campana);
  }

  return json({ success: true, idSolicitud: idSolicitud });
}

// ===== cancelarSolicitudCC =====
function cancelarSolicitudCC(body) {
  return conLock(function() { return cancelarSolicitudCCInterno(body); });
}

function cancelarSolicitudCCInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var sheet = getHojaSolicitudesCC();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idIdx = headers.indexOf('ID_SOLICITUD');
  var statusIdx = headers.indexOf('STATUS');
  var asesorIdx = headers.indexOf('ASESOR_EMAIL');
  var fechaResIdx = headers.indexOf('FECHA_RESOLUCION');

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.id).trim()) { rowIndex = i; break; }
  }
  if (rowIndex === -1) return json({ success: false, error: 'Solicitud no encontrada' });

  var esDueño = String(data[rowIndex][asesorIdx]).trim().toLowerCase() === sesion.email.trim().toLowerCase();
  if (!esRolSupervisorOAdmision(sesion.rol) && !esDueño) {
    return json({ success: false, error: 'No puedes cancelar una solicitud que no es tuya' });
  }
  if (String(data[rowIndex][statusIdx]).trim() !== 'PENDIENTE') {
    return json({ success: false, error: 'Esta solicitud ya fue procesada y no se puede cancelar' });
  }

  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue('CANCELADO');
  sheet.getRange(rowIndex + 1, fechaResIdx + 1).setValue(new Date().toISOString());
  return json({ success: true });
}

// ============================================================
// CONDICIONES COMERCIALES — Envío y Rechazo (Parte 6)
// ============================================================

// TODO: confirma/ajusta el correo remitente real para el envío de CC.
var CORREO_ADMISION_CC = 'admisionucal@ucal.edu.pe';

// Mismo logo y mismo ID de Drive que usaba el script antiguo de Cargos
// para la imagen de la firma (inline, vía cid:logo_firma). Si este backend
// no tiene acceso a ese archivo, el correo sale sin imagen (ver getLogoFirmaBlob).
var ID_LOGO_FIRMA_CC = '1ueKQuzXUEmrCZmhn9X2g8kR3PI8YeF3b';

// Periodo legible por campaña para el asunto del correo — mismo criterio
// que CONFIG_CC en cc-template.js (frontend).
var PERIODO_POR_CAMPANA_CC = {
  '26.2': '2026-2',
  '27.1': '2027-1'
};

// NOTA: el catálogo de BCC por campaña (incluido onboarding) vive solo en
// core/constants.js (BCC_DEFAULT_CC). Este backend no lo duplica ni fuerza
// nada — confía en lo que manda el frontend (correosCopiaOverride), que ya
// viene con exactamente los checkboxes que el supervisor dejó marcados.

// Firma HTML del correo. Réplica del formato original del Apps Script de
// Cargos, con el logo inline (cid:logo_firma) en vez de solo texto.
function getFirmaHTML() {
  return `
  <table style="border-collapse: collapse; font-family: sans-serif; font-size: 12px;">
    <tr>
      <td rowspan="7" style="padding-right:18px; vertical-align: top;">
        <img src="cid:logo_firma" alt="LOGO" width="160" style="display:block;">
      </td>
      <td rowspan="10" style="width:1px; background-color: purple;"></td>
      <td style="height:14px;"></td>

      <td style="padding-left:18px; vertical-align: middle;">
      <b>Equipo de Admisión</b><br><br>
      Av. La Molina 3755, Sol de La Molina, Lima, Perú<br>
      www.ucal.edu.pe
    </td>
    </tr>
  </table>
  `;
}

// Blob del logo de firma (mismo Drive ID que usaba el script de Cargos).
// Se degrada con logging en vez de romper el envío si falla el acceso.
function getLogoFirmaBlob() {
  try {
    return DriveApp.getFileById(ID_LOGO_FIRMA_CC).getBlob();
  } catch (e) {
    Logger.log('No se pudo obtener el logo de firma (' + ID_LOGO_FIRMA_CC + '): ' + e.message);
    return null;
  }
}

// Arma la lista de BCC a partir de lo que mande el frontend
// (correosCopiaOverride) — Vista 2 ya envía exactamente los checkboxes
// marcados, tomados del catálogo único en core/constants.js (que incluye
// onboarding como una opción más, marcada por defecto pero desmarcable).
// Este backend no fuerza ni agrega nada: respeta la selección del supervisor.
function getCorreosCopiaCC(overrideCsv) {
  if (!overrideCsv || !String(overrideCsv).trim()) return [];
  return String(overrideCsv).split(',').map(function(c) { return c.trim(); }).filter(Boolean);
}

// Trae el email del alumno (columna EMAIL) desde la hoja base de campaña,
// aplicando el mismo override de "hoy{campana}" que usa getLeadDetail
// (solo si el registro de hoy está en VP/PP VIVA con el mismo asesor).
function getEmailLeadCC(campana, idPrometeo) {
  var sheetBase = SS.getSheetByName(campana);
  if (!sheetBase) return '';

  var headersBase = sheetBase.getRange(1, 1, 1, sheetBase.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
  var idIdx = headersBase.indexOf('ID PROMETEO');
  var emailIdx = headersBase.indexOf('EMAIL');
  var asesorIdx = headersBase.indexOf('ASESOR ULT TIP DF SN CONTC');
  if (idIdx === -1 || emailIdx === -1) return '';

  var lastRow = sheetBase.getLastRow();
  if (lastRow < 2) return '';

  var colLetter = columnToLetter(idIdx + 1);
  var encontrado = sheetBase.getRange(colLetter + '2:' + colLetter)
                      .createTextFinder(String(idPrometeo).trim())
                      .matchEntireCell(true)
                      .findNext();

  var emailBase = '';
  var asesorBase = '';
  if (encontrado) {
    emailBase = sheetBase.getRange(encontrado.getRow(), emailIdx + 1).getValue();
    asesorBase = asesorIdx !== -1 ? sheetBase.getRange(encontrado.getRow(), asesorIdx + 1).getValue() : '';
  }

  var hoyOverride = getHoyMap(campana)[String(idPrometeo).trim()];
  if (hoyOverrideEsConfiable(hoyOverride, asesorBase, !!encontrado) && esValorMerge(hoyOverride['EMAIL'])) return hoyOverride['EMAIL'];

  return emailBase || '';
}

// ===== VISTA PREVIA EN PDF (exportar, sin enviar correo) =====
// Convierte el HTML canónico (el mismo que arma el frontend para enviarCC)
// a PDF usando el mismo motor que el correo real (Apps Script), y lo
// devuelve en base64 para que el frontend lo descargue directo. No toca
// STATUS ni la hoja SOLICITUDES_CC, no envía ningún correo — es de solo
// lectura salvo por el gasto de cuota de conversión a PDF.
function generarPreviewPDF(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  if (!body.htmlFinal) return json({ success: false, error: 'Falta el HTML de Condiciones Comerciales' });

  try {
    var htmlBlob = Utilities.newBlob(body.htmlFinal, MimeType.HTML, 'temp_preview.html');
    var pdfBlob = htmlBlob.getAs(MimeType.PDF);
    var base64 = Utilities.base64Encode(pdfBlob.getBytes());
    return json({ success: true, pdfBase64: base64 });
  } catch (e) {
    return json({ success: false, error: 'No se pudo generar el PDF: ' + e.message });
  }
}

// ===== ENVIAR CC (en 2 fases) =====
// Fase 1 (con lock): reclama la solicitud (STATUS=PROCESANDO) para soltar el lock rápido.
// Fase 2 (sin lock): genera PDF y envía correos. Si falla, revierte STATUS a PENDIENTE.
function enviarCC(body) {
  var claim = conLock(function() { return enviarCCClaim(body); });
  if (!claim.success) return json(claim);

  var resultado;
  try {
    resultado = enviarCCProcesar(body, claim);
  } catch (e) {
    resultado = { success: false, error: 'Error inesperado al enviar: ' + e.message };
  }

  if (!resultado.success) {
    conLock(function() {
      revertirClaimCC(claim.rowIndex, claim.headers, claim.statusPrevio);
      return { success: true };
    });
  }

  return json(resultado);
}

function enviarCCClaim(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
  if (!sesion) return { success: false, error: motivo.error };

  if (!body.htmlFinal) return { success: false, error: 'Falta el HTML de Condiciones Comerciales' };

  var sheet = getHojaSolicitudesCC();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idIdx = headers.indexOf('ID_SOLICITUD');
  var statusIdx = headers.indexOf('STATUS');
  var fechaResIdx = headers.indexOf('FECHA_RESOLUCION');
  var adminIdx = headers.indexOf('ADMIN_EMAIL');

  var rowIndex = -1;
  var solicitud = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.idSolicitud).trim()) {
      rowIndex = i;
      solicitud = {};
      for (var j = 0; j < headers.length; j++) solicitud[headers[j]] = data[i][j];
      break;
    }
  }
  if (rowIndex === -1) return { success: false, error: 'Solicitud no encontrada' };

  var statusActual = String(solicitud.STATUS).trim();
  var esReenvio = !!body.reenvio;

  // Revalida el estado justo antes de enviar: evita doble envío por doble
  // clic o dos pestañas abiertas del mismo supervisor.
  // - PENDIENTE: flujo normal de primer envío, siempre permitido.
  // - ENVIADO: solo se permite si el frontend pidió explícitamente reenviar
  //   (body.reenvio === true) — así un reenvío es siempre una acción
  //   intencional, no un accidente de doble clic sobre un botón viejo.
  // - PROCESANDO / cualquier otro estado: bloqueado siempre (hay un envío
  //   en curso o la solicitud está en un estado que no admite envío).
  if (statusActual === 'PROCESANDO') {
    return { success: false, error: 'Esta solicitud se está enviando en este momento. Espera unos segundos.' };
  }
  if (statusActual === 'ENVIADO' && !esReenvio) {
    return { success: false, error: 'Esta solicitud ya fue enviada. Usa la opción de reenviar si necesitas mandarla de nuevo.' };
  }
  if (statusActual !== 'PENDIENTE' && statusActual !== 'ENVIADO') {
    return { success: false, error: 'Esta solicitud ya fue procesada (estado actual: ' + solicitud.STATUS + ')' };
  }

  // Reclama la fila de inmediato para soltar el lock cuanto antes.
  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue('PROCESANDO');

  return {
    success: true,
    sesion: sesion,
    solicitud: solicitud,
    rowIndex: rowIndex,
    headers: headers,
    statusIdx: statusIdx,
    fechaResIdx: fechaResIdx,
    adminIdx: adminIdx,
    statusPrevio: statusActual // para revertir al estado correcto si falla el envío/reenvío
  };
}

function revertirClaimCC(rowIndex, headers, statusPrevio) {
  var sheet = getHojaSolicitudesCC();
  var statusIdx = headers.indexOf('STATUS');
  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue(statusPrevio || 'PENDIENTE');
}

function enviarCCProcesar(body, claim) {
  var sesion = claim.sesion;
  var solicitud = claim.solicitud;
  var rowIndex = claim.rowIndex;
  var headers = claim.headers;
  var statusIdx = claim.statusIdx;
  var fechaResIdx = claim.fechaResIdx;
  var adminIdx = claim.adminIdx;
  var esReenvioProcesar = claim.statusPrevio === 'ENVIADO';
  var sheet = getHojaSolicitudesCC();

  var periodo = PERIODO_POR_CAMPANA_CC[String(solicitud.CAMPANA).trim()] || solicitud.CAMPANA;
  var logoBlob = getLogoFirmaBlob();
  var bccList = getCorreosCopiaCC(body.correosCopiaOverride);

  var identidad = capturarIdentidadBase(solicitud.CAMPANA, solicitud.ID_PROMETEO);
  // El supervisor puede editar el nombre en Vista 2 (todo excepto
  // ID_PROMETEO/CAMPANA es editable) — si mandó un override, prevalece
  // sobre el nombre tal como está guardado en la hoja base.
  var nombreCompleto = (body.nombreCompletoOverride && String(body.nombreCompletoOverride).trim())
    || identidad.nombre || solicitud.ID_PROMETEO;

  var htmlBlob = Utilities.newBlob(body.htmlFinal, MimeType.HTML, 'temp_' + nombreCompleto + '.html');
  var pdfCC;
  try {
    pdfCC = htmlBlob.getAs(MimeType.PDF);
  } catch (e) {
    return { success: false, error: 'No se pudo generar el PDF: ' + e.message };
  }
  pdfCC.setName('CC - ' + nombreCompleto + '.pdf');

  var adjuntos = [pdfCC];

  // Lineamientos (5 cuotas): llega en base64 desde el frontend (assets/),
  // opcional — si falla o no llega, se envía solo con el PDF de CC.
  var incluyeLineamientos = false;
  if (body.lineamientosBase64) {
    try {
      var bytesLineamientos = Utilities.base64Decode(body.lineamientosBase64);
      var pdfLineamientos = Utilities.newBlob(bytesLineamientos, MimeType.PDF, body.lineamientosNombre || 'Lineamientos de Admision.pdf');
      adjuntos.push(pdfLineamientos);
      incluyeLineamientos = true;
    } catch (e) {
      Logger.log('No se pudo adjuntar Lineamientos: ' + e.message);
    }
  }

  // Destinatarios: por defecto, email del lead + CORREOS_ADICIONALES de la
  // solicitud. El supervisor puede editarlos en Vista 2 (correosDestinoOverride);
  // ese override es solo para este envío puntual, no se guarda en la hoja.
  var destinatarios;
  if (body.correosDestinoOverride && String(body.correosDestinoOverride).trim()) {
    var listaOverride = String(body.correosDestinoOverride).split(',')
      .map(function(c) { return c.trim(); }).filter(Boolean);
    var invalidos = listaOverride.filter(function(c) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c); });
    if (invalidos.length) {
      return { success: false, error: 'Correo(s) inválido(s): ' + invalidos.join(', ') };
    }
    destinatarios = listaOverride.join(',');
  } else {
    var emailAlumno = getEmailLeadCC(solicitud.CAMPANA, solicitud.ID_PROMETEO);
    var correosAdicionales = String(solicitud.CORREOS_ADICIONALES || '')
      .split(',').map(function(c) { return c.trim(); }).filter(Boolean);
    destinatarios = [emailAlumno].concat(correosAdicionales).filter(Boolean).join(',');
  }

  if (!destinatarios) {
    return { success: false, error: 'No hay correos de destino para enviar las Condiciones Comerciales' };
  }

  // El supervisor también puede editar el nombre del asesor (Vista 2)
  // antes de enviar el correo — si mandó override, prevalece.
  var asesorNombre = (body.asesorNombreOverride && String(body.asesorNombreOverride).trim())
    || solicitud.ASESOR_NOMBRE || '';
  var asesorEmail = solicitud.ASESOR_EMAIL || '';
  var FIRMA_HTML = getFirmaHTML();

  // ===== REFERIDOS / REFERENTES =====
  // Se captura recién al momento de enviar (Vista 2 del supervisor), no en
  // la solicitud del asesor. Validación server-side de las personas, igual
  // que el resto de inputs de este backend.
  var tipoReferido = (body.tipoReferido === 'REFERIDO' || body.tipoReferido === 'REFERENTE') ? body.tipoReferido : '';
  var personasReferido = Array.isArray(body.personasReferido) ? body.personasReferido : [];
  personasReferido = personasReferido.filter(function(p) {
    return p && p.nombre && p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.email));
  });
  if (tipoReferido && personasReferido.length === 0) {
    return { success: false, error: 'Debes indicar al menos una persona (Referente/Referido) para este beneficio.' };
  }

  var incluyeTerminosReferido = false;
  var pdfTerminosReferido = null;
  if (body.terminosReferidoBase64) {
    try {
      var bytesRef = Utilities.base64Decode(body.terminosReferidoBase64);
      pdfTerminosReferido = Utilities.newBlob(bytesRef, MimeType.PDF, body.terminosReferidoNombre || 'Terminos y Condiciones - Referido.pdf');
    } catch (e) {
      Logger.log('No se pudo decodificar Términos y Condiciones - Referido: ' + e.message);
    }
  }

  var pdfTerminosReferente = null;
  if (body.terminosReferenteBase64) {
    try {
      var bytesRefte = Utilities.base64Decode(body.terminosReferenteBase64);
      pdfTerminosReferente = Utilities.newBlob(bytesRefte, MimeType.PDF, body.terminosReferenteNombre || 'Terminos y Condiciones - Referente.pdf');
    } catch (e) {
      Logger.log('No se pudo decodificar Términos y Condiciones - Referente: ' + e.message);
    }
  }

  // Si el alumno FUE referido, su propio correo lleva también el doc de
  // Referido (además de CC + Lineamientos).
  if (tipoReferido === 'REFERIDO' && pdfTerminosReferido) {
    adjuntos.push(pdfTerminosReferido);
    incluyeTerminosReferido = true;
  }

  var asuntoPrincipal = 'Proceso de Admisión UCAL ' + periodo +
    (tipoReferido === 'REFERIDO' ? ' - Programa de Referidos' : '');


  var cuerpoHTML =
    '<p>Estimado/a <b>' + nombreCompleto + '</b>,</p>' +
    '<p>Deseando te encuentres bien, de acuerdo con lo conversado con tu asesor/a educativo/a ' + asesorNombre + ', por medio de este correo, te hacemos llegar los siguientes documentos adjuntos:</p>' +
    '<ol><li>Condiciones Comerciales</li>' +
      (incluyeLineamientos ? '<li>Lineamientos de Admisión</li>' : '') +
      (incluyeTerminosReferido ? '<li>Términos y Condiciones - Referido</li>' : '') +
    '</ol>' +
    '<p>Cada uno de ellos son documentos que resumen la información brindada respecto a tu proceso de matrícula.</p>' +
    (incluyeTerminosReferido && personasReferido.length > 0
      ? '<p>El documento de Términos y Condiciones - Referido resume la información brindada respecto a los beneficios que se te otorgarán por ser referido/a por la persona:</p>' +
        '<ol>' +
          '<li><b>Nombres: </b>' + personasReferido[0].nombre + '</li>' +
          '<li><b>DNI: </b>' + (personasReferido[0].dni || '—') + '</li>' +
        '</ol>'
      : '') +
    '<p>Una vez revisados, deberás responder a este correo con la palabra <b>"Conforme"</b> para continuar con tu proceso de matrícula. Al hacerlo, declaras haber leído, comprendido y aceptado la información contenida en los documentos adjuntos.</p>' +
    '<p><b>¡Ya estás camino a transformar el mundo!</b></p>' +
    '<p>Saludos cordiales,</p>' +
    FIRMA_HTML;

  try {
    GmailApp.sendEmail(destinatarios, asuntoPrincipal, '', {
      htmlBody: cuerpoHTML,
      attachments: adjuntos,
      cc: asesorEmail || undefined,
      bcc: bccList.length ? bccList.join(',') : undefined,
      inlineImages: logoBlob ? { logo_firma: logoBlob } : undefined,
      from: CORREO_ADMISION_CC
    });
  } catch (e) {
    return { success: false, error: 'Error al enviar el correo: ' + e.message };
  }

  // Si el alumno ES REFERENTE, cada persona es un REFERIDO suyo (recibe doc de Referido).
  // Si el alumno FUE REFERIDO, cada persona es su REFERENTE (recibe doc de Referente).
  if (tipoReferido && personasReferido.length > 0) {
    var docParaPersonas = tipoReferido === 'REFERENTE' ? pdfTerminosReferido : pdfTerminosReferente;
    var asuntoReferidos = 'Programa de Referidos UCAL ' + periodo + ' - Términos y Condiciones';

    personasReferido.forEach(function(persona) {
      var cuerpoPersona = tipoReferido === 'REFERENTE'
        ? '<p>Buen día estimado/a <b>' + persona.nombre + '</b>,</p>' +
          '<p>Por medio de este correo, te hacemos llegar el siguiente documento adjunto:</p>' +
          '<ul><li>Términos y Condiciones - Referido</li></ul>' +
          '<p>Este documento resume la información brindada respecto a los beneficios que se te otorgarán por ser referido/a de:</p>' +
          '<p><b>Nombre:</b> ' + nombreCompleto + '</p>' +
          '<p>Una vez revisado, deberás responder a este correo con la palabra <b>"Conforme"</b> para seguir con el proceso.</p>' +
          '<p>Saludos cordiales,</p>' + FIRMA_HTML
        : '<p>Buen día estimado/a <b>' + persona.nombre + '</b>,</p>' +
          '<p>Por medio de este correo, te hacemos llegar el siguiente documento adjunto:</p>' +
          '<ul><li>Términos y Condiciones - Referente</li></ul>' +
          '<p>Este documento resume la información brindada respecto a los beneficios que se te otorgarán por ser referente de:</p>' +
          '<p><b>Nombre:</b> ' + nombreCompleto + '</p>' +
          '<p>Una vez revisado, deberás responder a este correo con la palabra <b>"Conforme"</b> para seguir con el proceso.</p>' +
          '<p>Saludos cordiales,</p>' + FIRMA_HTML;

      try {
        GmailApp.sendEmail(persona.email, asuntoReferidos, '', {
          htmlBody: cuerpoPersona,
          attachments: docParaPersonas ? [docParaPersonas] : [],
          inlineImages: logoBlob ? { logo_firma: logoBlob } : undefined,
          from: CORREO_ADMISION_CC
        });
      } catch (e) {
        Logger.log('Error enviando a persona referida/referente ' + persona.email + ': ' + e.message);
      }
    });
  }

  // Si es un reenvío, primero deja rastro del envío anterior (fecha + quién lo
  // mandó) en HISTORIAL_ENVIOS antes de pisar FECHA_RESOLUCION/ADMIN_EMAIL.
  // Columna opcional: si no existe en la hoja SOLICITUDES_CC, simplemente no
  // se guarda historial — no rompe el envío.
  var historialEnviosIdx = headers.indexOf('HISTORIAL_ENVIOS');
  if (esReenvioProcesar && historialEnviosIdx !== -1) {
    var historialPrevio = [];
    try { historialPrevio = JSON.parse(solicitud.HISTORIAL_ENVIOS || '[]'); } catch (e) { historialPrevio = []; }
    if (!Array.isArray(historialPrevio)) historialPrevio = [];
    historialPrevio.push({ fecha: solicitud.FECHA_RESOLUCION || '', admin: solicitud.ADMIN_EMAIL || '' });
    sheet.getRange(rowIndex + 1, historialEnviosIdx + 1).setValue(JSON.stringify(historialPrevio));
  }

  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue('ENVIADO');
  sheet.getRange(rowIndex + 1, fechaResIdx + 1).setValue(new Date().toISOString());
  sheet.getRange(rowIndex + 1, adminIdx + 1).setValue(sesion.email);

  var tipoReferidoIdx = headers.indexOf('TIPO_REFERIDO');
  var personasReferidoIdx = headers.indexOf('PERSONAS_REFERIDO_JSON');
  if (tipoReferidoIdx !== -1) sheet.getRange(rowIndex + 1, tipoReferidoIdx + 1).setValue(tipoReferido);
  if (personasReferidoIdx !== -1) sheet.getRange(rowIndex + 1, personasReferidoIdx + 1).setValue(personasReferido.length ? JSON.stringify(personasReferido) : '');

  return { success: true };
}

// ===== RECHAZAR CC =====
function rechazarCC(body) {
  return conLock(function() { return rechazarCCInterno(body); });
}

function rechazarCCInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  if (!body.motivo || String(body.motivo).trim() === '') {
    return json({ success: false, error: 'Debes indicar un motivo de rechazo.' });
  }

  var sheet = getHojaSolicitudesCC();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idIdx = headers.indexOf('ID_SOLICITUD');
  var statusIdx = headers.indexOf('STATUS');
  var fechaResIdx = headers.indexOf('FECHA_RESOLUCION');
  var adminIdx = headers.indexOf('ADMIN_EMAIL');
  var motivoIdx = headers.indexOf('MOTIVO_RECHAZO');

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(body.id).trim()) { rowIndex = i; break; }
  }
  if (rowIndex === -1) return json({ success: false, error: 'Solicitud no encontrada' });
  if (String(data[rowIndex][statusIdx]).trim() !== 'PENDIENTE') {
    return json({ success: false, error: 'Esta solicitud ya fue procesada y no se puede rechazar' });
  }

  sheet.getRange(rowIndex + 1, statusIdx + 1).setValue('RECHAZADO');
  sheet.getRange(rowIndex + 1, fechaResIdx + 1).setValue(new Date().toISOString());
  sheet.getRange(rowIndex + 1, adminIdx + 1).setValue(sesion.email);
  if (motivoIdx !== -1) sheet.getRange(rowIndex + 1, motivoIdx + 1).setValue(body.motivo);

  return json({ success: true });
}

// ============================================================
// GUARDADO Y COMENTARIOS
// ============================================================

function saveBottom(body) {
  return conLock(function() { return saveBottomInterno(body); });
}

// Sin lock propio: ya se llama desde dentro de otros locks (deadlock si lo tuviera)
function saveBottomInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  if (!esRolSupervisorOAdmision(sesion.rol) && haySolicitudPendiente(body.idPrometeo, body.campana)) {
    return json({ success: false, error: 'No puedes modificar la ficha: tienes una solicitud de recategorización pendiente.' });
  }

  var sheet = SS.getSheetByName('bottom' + body.campana);
  if (!sheet) return json({ success: false, error: 'Hoja bottom no existe' });

  var asesorEmail = esRolSupervisorOAdmision(sesion.rol)
    ? String(body.asesorEmail || sesion.email).trim()
    : sesion.email.trim();
  if (!asesorEmail) return json({ success: false, error: 'Falta el email del asesor' });

  var errorTipoInstitucion = validarTipoInstitucionProcedencia(body);
  if (errorTipoInstitucion) return json({ success: false, error: errorTipoInstitucion });

  if (body.data.INSTITUCION_PROCEDENCIA !== undefined && String(body.data.INSTITUCION_PROCEDENCIA).trim() !== '') {
    body.data.INSTITUCION_PROCEDENCIA = upsertInstitucionProcedencia(
      body.data.INSTITUCION_PROCEDENCIA, body.data.TIPO_INSTITUCION_PROCEDENCIA
    );
  }
  if (body.data.CARRERA_PROCEDENCIA !== undefined && String(body.data.CARRERA_PROCEDENCIA).trim() !== '') {
    body.data.CARRERA_PROCEDENCIA = upsertCarreraProcedencia(body.data.CARRERA_PROCEDENCIA);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idColIdx = headers.indexOf('ID_PROMETEO');
  var asesorColIdx = headers.indexOf('ASESOR_EMAIL');
  if (idColIdx === -1 || asesorColIdx === -1) {
    return json({ success: false, error: 'Faltan columnas ID_PROMETEO/ASESOR_EMAIL en bottom' });
  }

  var idTarget = String(body.idPrometeo).trim();
  var emailTarget = asesorEmail.toLowerCase();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx]).trim() === idTarget &&
        String(data[i][asesorColIdx]).trim().toLowerCase() === emailTarget) {
      rowIndex = i + 1;
      break;
    }
  }

  var identidad = capturarIdentidadBase(body.campana, idTarget);

  var rowPayload = headers.map(function(h) {
    if (h === 'ID_PROMETEO') return body.idPrometeo;
    if (h === 'ASESOR_EMAIL') return asesorEmail;
    if (h === 'CAMPAÑA') return body.campana;
    if (h === 'NOMBRE_LEAD') return identidad.nombre || (rowIndex !== -1 ? data[rowIndex - 1][headers.indexOf(h)] : '');
    if (h === 'DNI_LEAD') return identidad.dni || (rowIndex !== -1 ? data[rowIndex - 1][headers.indexOf(h)] : '');
    if (h === 'CELULAR_LEAD') return identidad.celular || (rowIndex !== -1 ? data[rowIndex - 1][headers.indexOf(h)] : '');
    if (body.data[h] !== undefined) return body.data[h];
    return rowIndex !== -1 ? data[rowIndex - 1][headers.indexOf(h)] : '';
  });

  // Se registra un snapshot en el historial en TODO guardado que toque algún
  // campo de perfilamiento — incluido el primer guardado de la fila (antes
  // solo se registraba a partir del segundo guardado en adelante). El
  // snapshot captura lo que se acaba de enviar en ESTE guardado (body.data),
  // no lo que había antes — así cada entrada refleja realmente lo que esa
  // persona escribió, en vez de mostrar "Sin respuesta" cuando es la primera
  // vez que se llena el perfilamiento.
  var tocaPerfil = CAMPOS_PERFIL.some(function(c) { return body.data[c] !== undefined; });
  if (tocaPerfil) {
      var histIdx = headers.indexOf('COMENTARIOS_HISTORIAL');
      if (histIdx !== -1) {
          var historialPrevioRaw = rowIndex !== -1 ? data[rowIndex - 1][histIdx] : '';
          var historialActual = parsearHistorial(historialPrevioRaw);
          var snapshotNuevo = {};
          CAMPOS_PERFIL.forEach(function(c) {
              // Prioriza lo recién enviado en este guardado; si ese campo puntual
              // no vino en este body.data, cae al valor que ya estaba guardado
              // (o '' si la fila recién se está creando).
              snapshotNuevo[c] = body.data[c] !== undefined
                  ? body.data[c]
                  : (rowIndex !== -1 ? (data[rowIndex - 1][headers.indexOf(c)] || '') : '');
          });
          historialActual.push({
              tipo: 'perfil_snapshot',
              fecha: new Date().toISOString(),
              usuario: sesion.nombre || sesion.email,
              datos: snapshotNuevo
          });
          rowPayload[histIdx] = JSON.stringify(historialActual);
      }
  }

  if (rowIndex !== -1) {
      sheet.getRange(rowIndex, 1, 1, rowPayload.length).setValues([rowPayload]);
  } else {
      sheet.appendRow(rowPayload);
  }

  try { CacheService.getScriptCache().remove('bottomRows_' + body.campana); } catch (e) {}

  return json({ success: true });
}

function addComment(body) {
  return conLock(function() {
    var motivo = {};
    var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
    if (!sesion) return json({ success: false, error: motivo.error });

    var campana = body.campana;
    var idTarget = String(body.id).trim();
    var asesorEmail = esRolSupervisorOAdmision(sesion.rol)
      ? String(body.asesorEmail || sesion.email).trim()
      : sesion.email.trim();
    if (!asesorEmail) return json({ success: false, error: 'Falta el email del asesor' });

    var filaPropia = getBottomRows(campana).filter(function(r) {
      return String(r.ID_PROMETEO).trim() === idTarget &&
             String(r.ASESOR_EMAIL || '').trim().toLowerCase() === asesorEmail.toLowerCase();
    })[0];

    var historial = parsearHistorial(filaPropia ? filaPropia.COMENTARIOS_HISTORIAL : '');
    historial.push({
      tipo: 'comentario',
      fecha: new Date().toISOString(),
      usuario: body.usuario,
      texto: body.comentario
    });

    return saveBottomInterno({
      idPrometeo: body.id,
      campana: campana,
      asesorEmail: asesorEmail,
      sessionToken: body.sessionToken,
      data: { 'COMENTARIOS_HISTORIAL': JSON.stringify(historial) }
    });
  });
}

function parsearHistorial(raw) {
    if (!raw) return [];
    try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function mergeHistorial(historial1Raw, historial2Raw, modo) {
  var h1 = parsearHistorial(historial1Raw);
  var h2 = parsearHistorial(historial2Raw);
  if (modo === 'id1') return JSON.stringify(h1);
  if (modo === 'id2') return JSON.stringify(h2);
  var combinado = h1.concat(h2).sort(function(a, b) {
    return new Date(a.fecha || 0) - new Date(b.fecha || 0);
  });
  return JSON.stringify(combinado);
}

// ============================================================
// CATÁLOGOS DE PROCEDENCIA (instituciones / carreras)
// ============================================================

function getCatalogoProcedenciaSheet(nombreHoja, headers) {
  var sheet = SS.getSheetByName(nombreHoja);
  if (!sheet) { sheet = SS.insertSheet(nombreHoja); sheet.appendRow(headers); }
  return sheet;
}

function normalizarNombreCatalogo(valor) {
  return String(valor || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function upsertInstitucionProcedencia(nombre, tipo) {
  var nombreNorm = normalizarNombreCatalogo(nombre);
  if (!nombreNorm) return '';
  var sheet = getCatalogoProcedenciaSheet('INSTITUCIONES_PROCEDENCIA', ['NOMBRE', 'TIPO']);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (normalizarNombreCatalogo(data[i][0]) === nombreNorm) return data[i][0];
  }
  sheet.appendRow([nombreNorm, String(tipo || '').trim().toUpperCase()]);
  return nombreNorm;
}

function upsertCarreraProcedencia(nombre) {
  var nombreNorm = normalizarNombreCatalogo(nombre);
  if (!nombreNorm) return '';
  var sheet = getCatalogoProcedenciaSheet('CARRERAS_PROCEDENCIA', ['NOMBRE']);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (normalizarNombreCatalogo(data[i][0]) === nombreNorm) return data[i][0];
  }
  sheet.appendRow([nombreNorm]);
  return nombreNorm;
}

function validarTipoInstitucionProcedencia(body) {
  if (body.data.TIPO_INSTITUCION_PROCEDENCIA === undefined) return null;
  var valor = String(body.data.TIPO_INSTITUCION_PROCEDENCIA).trim().toUpperCase();
  if (valor === '') return null;
  if (TIPOS_INSTITUCION_PROCEDENCIA.indexOf(valor) === -1) {
    return 'TIPO_INSTITUCION_PROCEDENCIA debe ser UNIVERSIDAD o INSTITUTO';
  }
  body.data.TIPO_INSTITUCION_PROCEDENCIA = valor;
  return null;
}

// ============================================================
// HELPERS DE VALIDACIÓN Y BOTTOM
// ============================================================

function existeEnBase(campana, idPrometeo) {
  var sheet = SS.getSheetByName(campana);
  if (!sheet) return false;

  var headersBase = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
  var idIdx = headersBase.indexOf('ID PROMETEO');
  if (idIdx === -1) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  var colLetter = columnToLetter(idIdx + 1);
  var encontrado = sheet.getRange(colLetter + '2:' + colLetter)
                      .createTextFinder(String(idPrometeo).trim())
                      .matchEntireCell(true)
                      .findNext();
  return !!encontrado;
}

function capturarIdentidadBase(campana, idPrometeo) {
  var vacio = { nombre: '', dni: '', celular: '', carrera: '' };
  var idTarget = String(idPrometeo).trim();

  var nombre = '', dni = '', celular = '', carrera = '', asesorBase = '';
  var encontradoEnBase = false;

  var sheetBase = SS.getSheetByName(campana);
  if (sheetBase) {
    var headersBase = sheetBase.getRange(1, 1, 1, sheetBase.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
    var idIdx = headersBase.indexOf('ID PROMETEO');
    var lastRow = sheetBase.getLastRow();
    if (idIdx !== -1 && lastRow >= 2) {
      var colLetter = columnToLetter(idIdx + 1);
      var encontrado = sheetBase.getRange(colLetter + '2:' + colLetter)
                          .createTextFinder(idTarget).matchEntireCell(true).findNext();
      if (encontrado) {
        encontradoEnBase = true;
        var rowValues = sheetBase.getRange(encontrado.getRow(), 1, 1, headersBase.length).getValues()[0];
        var nombreIdx = headersBase.indexOf('NOMBRES');
        var dniIdx = headersBase.indexOf('NUMERO DE DOCUMENTO');
        var celularIdx = headersBase.indexOf('TELEFONO 2');
        var carreraIdx = headersBase.indexOf('CARRERA');
        if (carreraIdx === -1) carreraIdx = headersBase.indexOf('PROGRAMA');
        var asesorIdx = headersBase.indexOf('ASESOR ULT TIP DF SN CONTC');

        nombre = nombreIdx !== -1 ? rowValues[nombreIdx] : '';
        dni = dniIdx !== -1 ? rowValues[dniIdx] : '';
        celular = celularIdx !== -1 ? rowValues[celularIdx] : '';
        carrera = carreraIdx !== -1 ? rowValues[carreraIdx] : '';
        asesorBase = asesorIdx !== -1 ? rowValues[asesorIdx] : '';
      }
    }
  }

  // Override de hoy{campana} — solo si el registro de hoy está en VP/PP VIVA
  // y es del mismo asesor que ya está en la hoja base (ver hoyOverrideEsConfiable).
  var hoyOverride = getHoyMap(campana)[idTarget];
  if (hoyOverrideEsConfiable(hoyOverride, asesorBase, encontradoEnBase)) {
    if (esValorMerge(hoyOverride['NOMBRES'])) nombre = hoyOverride['NOMBRES'];
    if (esValorMerge(hoyOverride['NUMERO DE DOCUMENTO'])) dni = hoyOverride['NUMERO DE DOCUMENTO'];
    if (esValorMerge(hoyOverride['TELEFONO 2'])) celular = hoyOverride['TELEFONO 2'];
    var carreraHoy = hoyOverride['PROGRAMA'] || hoyOverride['CARRERA'];
    if (esValorMerge(carreraHoy)) carrera = carreraHoy;
  }

  if (!encontradoEnBase && !hoyOverride) return vacio;

  return { nombre: nombre, dni: dni, celular: celular, carrera: carrera };
}

// Email es el identificador único; Nombre_Aux es solo visual
function getNombreAsesorPorEmail(email) {
  if (!email) return '';
  var usuarios = sheetToObjects('USUARIOS');
  var emailNorm = String(email).trim().toLowerCase();
  var user = usuarios.find(function(u) { return String(u.Email).trim().toLowerCase() === emailNorm; });
  return user ? String(user.Nombre || '').trim() : '';
}

function getAsesorEmailMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('asesorEmailMap');
  if (cached) return JSON.parse(cached);

  var usuarios = sheetToObjects('USUARIOS');
  var map = {};
  usuarios.forEach(function(u) {
    var nombreAsesor = String(u.Nombre || '').trim().toLowerCase();
    if (nombreAsesor) map[nombreAsesor] = u.Email;
  });

  try { cache.put('asesorEmailMap', JSON.stringify(map), 300); } catch (e) {}
  return map;
}

// Regla del sistema: comparar/filtrar SIEMPRE con "Nombre"; mostrar SIEMPRE "Nombre_Aux".
// Este mapa (Nombre -> Nombre_Aux) se usa solo para convertir el valor antes de devolverlo
// al frontend, nunca para comparar/filtrar.
function getAsesorNombreAuxMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('asesorNombreAuxMap');
  if (cached) return JSON.parse(cached);

  var usuarios = sheetToObjects('USUARIOS');
  var map = {};
  usuarios.forEach(function(u) {
    var nombreCompleto = String(u.Nombre || '').trim().toLowerCase();
    if (nombreCompleto) map[nombreCompleto] = u.Nombre_Aux || u.Nombre || '';
  });

  try { cache.put('asesorNombreAuxMap', JSON.stringify(map), 300); } catch (e) {}
  return map;
}

// Convierte un Nombre completo (tal como está en {campana}/hoy{campana}) a
// su Nombre_Aux para mostrarlo. Si no hay match en USUARIOS, devuelve el
// valor original tal cual (nunca deja el campo vacío).
function aNombreAuxParaMostrar(nombreCompleto, nombreAuxMap) {
  var valor = String(nombreCompleto || '').trim();
  if (!valor) return valor;
  return nombreAuxMap[valor.toLowerCase()] || valor;
}

function invalidarCacheAsesores() {
  CacheService.getScriptCache().remove('asesorEmailMap');
  CacheService.getScriptCache().remove('asesorNombreAuxMap');
}

function getBottomRows(campana) {
  var sheet = SS.getSheetByName('bottom' + campana);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
    rows.push(obj);
  }
  return rows;
}

function indexBottomRows(rows) {
  var map = {};
  rows.forEach(function(r) {
    var key = String(r.ID_PROMETEO || '').trim() + '||' + String(r.ASESOR_EMAIL || '').trim().toLowerCase();
    map[key] = r;
  });
  return map;
}

function getBottomMapActivo(campana) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'bottomRows_' + campana;
  var index;

  var cached = cache.get(cacheKey);
  if (cached) {
    index = JSON.parse(cached);
  } else {
    index = indexBottomRows(getBottomRows(campana));
    try { cache.put(cacheKey, JSON.stringify(index), 45); } catch (e) {}
  }

  var asesorEmailMap = getAsesorEmailMap();

  return function(idValue, nombreAsesorAsignado) {
    var email = asesorEmailMap[String(nombreAsesorAsignado || '').trim().toLowerCase()];
    if (!email) return {};
    var key = String(idValue).trim() + '||' + String(email).trim().toLowerCase();
    return index[key] || {};
  };
}

function getBottomRowsPorId(campana, idTarget) {
  var sheet = SS.getSheetByName('bottom' + campana);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
  var idColIdx = headers.indexOf('ID_PROMETEO');
  if (idColIdx === -1) return [];

  var idValues = sheet.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues();
  var filasMatch = [];
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]).trim() === idTarget) filasMatch.push(i + 2);
  }
  if (filasMatch.length === 0) return [];

  var resultados = [];
  filasMatch.forEach(function(rowNum) {
    var rowValues = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = rowValues[j];
    resultados.push(obj);
  });
  return resultados;
}

// ============================================================
// ASISTENCIA (Sheets externo, solo BD)
// ============================================================

function getAsistenciaSheet() {
  var ss = SpreadsheetApp.openById(ASISTENCIA_SPREADSHEET_ID);
  var sh = ss.getSheetByName('Asistencia');
  if (!sh) sh = ss.insertSheet('Asistencia');
  if (sh.getLastRow() === 0) {
    sh.appendRow(ASISTENCIA_HEADERS);
  } else {
    var firstRow = sh.getRange(1, 1, 1, ASISTENCIA_HEADERS.length).getValues()[0];
    var necesitaHeaders = ASISTENCIA_HEADERS.some(function(h, i) { return firstRow[i] !== h; });
    if (necesitaHeaders) { sh.insertRowBefore(1); sh.getRange(1, 1, 1, ASISTENCIA_HEADERS.length).setValues([ASISTENCIA_HEADERS]); }
  }
  return sh;
}

function formatTimeAsistencia(dateObj) {
  if (!dateObj || !(dateObj instanceof Date)) return "";
  return Utilities.formatDate(dateObj, 'America/Lima', 'HH:mm:ss');
}

function normalizarFechaAsistencia(fechaStr) {
  if (!fechaStr) return "";
  var fecha = String(fechaStr).trim();
  if (fecha.indexOf('T') !== -1) {
    var d = new Date(fecha);
    if (!isNaN(d.getTime())) fecha = Utilities.formatDate(d, 'America/Lima', 'dd/MM/yyyy');
  }
  var m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) fecha = m[3] + '/' + m[2] + '/' + m[1];
  var p = fecha.split('/');
  return p.length === 3 ? p[0].padStart(2,'0') + '/' + p[1].padStart(2,'0') + '/' + p[2] : fecha;
}

function marcarAsistencia(body) {
  return conLockAsistencia(function() { return marcarAsistenciaInterno(body); });
}

// usuario||fecha -> fila, cacheado 60s
function getAsistenciaIndexMap(sh) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'asistenciaIndexMap';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var lastRow = sh.getLastRow();
  var map = {};
  if (lastRow > 1) {
    var rows = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      var usuario = String(rows[i][0]).trim();
      var fecha = normalizarFechaAsistencia(String(rows[i][1]));
      if (!usuario) continue;
      map[usuario + '||' + fecha] = i + 2;
    }
  }

  try { cache.put(cacheKey, JSON.stringify(map), 60); } catch (e) {}
  return map;
}

function invalidarAsistenciaIndexMap() {
  try { CacheService.getScriptCache().remove('asistenciaIndexMap'); } catch (e) {}
  try { CacheService.getScriptCache().remove('asistenciaRegistrosRaw'); } catch (e) {}
}

function marcarAsistenciaInterno(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });
  if (!sesion.usuario) return json({ success: false, error: 'Tu sesión no tiene usuario asociado. Vuelve a iniciar sesión.' });

  var colMap = { entrada: 7, almuerzo: 8, regreso: 9, salida: 10, horasTrab: 11, horasAlm: 12, lat: 13, lng: 14, direccion: 15, estado: 16, ip: 17, tipo: 18 };
  var campo = body.campo;
  if (!campo || colMap[campo] === undefined) return json({ success: false, error: 'Campo inválido: ' + campo });

  var sh = getAsistenciaSheet();
  var col = colMap[campo];
  var usuarioBuscar = String(sesion.usuario).trim();
  var fechaBuscar = normalizarFechaAsistencia(String(body.fecha || ''));

  var indexMap = getAsistenciaIndexMap(sh);
  var rowNum = indexMap[usuarioBuscar + '||' + fechaBuscar];

  if (!rowNum) {
    sh.appendRow([usuarioBuscar, body.fecha || '', sesion.nombre || '', body.campaña || '', body.cargo || '', body.dni || '',
      '', '', '', '', '', '', '', '', '', '', '', '', new Date().toISOString()]);
    rowNum = sh.getLastRow();
    invalidarAsistenciaIndexMap();
  }

  var filaActual = sh.getRange(rowNum, 1, 1, ASISTENCIA_HEADERS.length).getValues()[0];

  var rawValue = filaActual[col - 1];
  var valorActual = rawValue instanceof Date ? formatTimeAsistencia(rawValue) : String(rawValue || '').trim();
  if (valorActual !== '') return json({ success: false, error: campo + ' ya fue registrado anteriormente a las ' + valorActual });

  filaActual[col - 1] = String(body.valor || '');
  if (body.lat)       filaActual[colMap.lat - 1] = String(body.lat);
  if (body.lng)       filaActual[colMap.lng - 1] = String(body.lng);
  if (body.direccion) filaActual[colMap.direccion - 1] = body.direccion;
  if (body.horasTrab) filaActual[colMap.horasTrab - 1] = String(body.horasTrab);
  if (body.horasAlm)  filaActual[colMap.horasAlm - 1] = String(body.horasAlm);
  if (body.estado)    filaActual[colMap.estado - 1] = body.estado;
  if (body.ip)        filaActual[16] = body.ip;
  if (body.tipo)      filaActual[17] = body.tipo;
  filaActual[18] = new Date().toISOString();

  var rango = sh.getRange(rowNum, 1, 1, ASISTENCIA_HEADERS.length);
  rango.setNumberFormats([[
    '@','@','@','@','@','@',
    '@STRING@','@STRING@','@STRING@','@STRING@','@STRING@','@STRING@',
    '@STRING@','@STRING@','@','@','@','@','@'
  ]]);
  rango.setValues([filaActual]);

  invalidarAsistenciaIndexMap();

  return json({ success: true, message: campo + ' registrado correctamente a las ' + body.valor });
}

function formatCellValueAsistencia(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (value.getFullYear() === 1899) return formatTimeAsistencia(value);
    return Utilities.formatDate(value, 'America/Lima', 'dd/MM/yyyy');
  }
  return String(value).trim();
}

function filaAsistenciaAObjeto(r) {
  return {
    usuario: r[0], fecha: formatCellValueAsistencia(r[1]), nombre: r[2], campaña: r[3], cargo: r[4], dni: r[5],
    entrada: formatCellValueAsistencia(r[6]), almuerzo: formatCellValueAsistencia(r[7]),
    regreso: formatCellValueAsistencia(r[8]), salida: formatCellValueAsistencia(r[9]),
    horasTrab: r[10], horasAlm: r[11], lat: r[12], lng: r[13], direccion: r[14], estado: r[15], tipo: r[17] || ''
  };
}

// Cacheado 20s para evitar reabrir el spreadsheet externo en cada request
function getAsistenciaRowsCacheadas() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'asistenciaRegistrosRaw';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var sh = getAsistenciaSheet();
  var rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, ASISTENCIA_HEADERS.length).getValues();

  var rowsSerializables = rows.map(function(r) {
    return r.map(function(cell) {
      if (cell instanceof Date) return { __isDate: true, __iso: cell.toISOString() };
      return cell;
    });
  });

  try { cache.put(cacheKey, JSON.stringify(rowsSerializables), 20); } catch (e) {}
  return rowsSerializables;
}

function reconstruirCeldaAsistencia(cell) {
  if (cell && typeof cell === 'object' && cell.__isDate) return new Date(cell.__iso);
  return cell;
}

function getAsistenciaRegistroHoy(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var rowsRaw = getAsistenciaRowsCacheadas();
  var fechaBuscada = normalizarFechaAsistencia(String(body.fecha || ''));

  for (var i = 0; i < rowsRaw.length; i++) {
    var r = rowsRaw[i].map(reconstruirCeldaAsistencia);
    if (String(r[0]).trim() === String(sesion.usuario).trim() && normalizarFechaAsistencia(String(r[1])) === fechaBuscada) {
      return json({ success: true, record: filaAsistenciaAObjeto(r) });
    }
  }
  return json({ success: true, record: null });
}

// Un ASESOR solo ve sus propios registros; un SUPERVISOR/ADMISION puede filtrar por cualquiera.
function getAsistenciaRegistros(body) {
  try {
    var motivo = {};
    var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
    if (!sesion) return json({ success: false, error: motivo.error });

    var rowsRaw = getAsistenciaRowsCacheadas();
    var filtroEmpleado = esRolSupervisorOAdmision(sesion.rol) ? (body.empleado || '') : sesion.usuario;
    var campañaFiltro = body.campaña || '';
    var resultado = [];

    for (var i = 0; i < rowsRaw.length; i++) {
      var r = rowsRaw[i].map(reconstruirCeldaAsistencia);
      if (!r[0]) continue;
      if (filtroEmpleado && String(r[0]).trim() !== filtroEmpleado) continue;
      if (campañaFiltro && String(r[3]).trim() !== campañaFiltro) continue;
      resultado.push(filaAsistenciaAObjeto(r));
    }
    return json({ success: true, data: resultado });
  } catch (e) {
    return json({ success: false, error: e.message, stack: e.stack });
  }
}

function getAsistenciaEmpleados(body) {
  var motivo = {};
  if (!exigirSesion(body, ['SUPERVISOR', 'ADMISION'], motivo)) return json({ success: false, error: motivo.error });

  var usuarios = sheetToObjects('USUARIOS');
  var data = usuarios
    .filter(function(u) { return String(u.Rol || '').trim().toUpperCase() === 'ASESOR'; })
    .map(function(u) {
    var campanasArr = String(u['Campaña'] || '').split(',').map(function(c){ return c.trim(); }).filter(Boolean);
    return {
      usuario: u.Usuario || '',
      nombre: u.Nombre_Aux || u.Nombre || '',
      rol: String(u.Rol || '').toLowerCase(),
      cargo: u.Cargo || '',
      dni: u.DNI || '',
      campaña: campanasArr[0] || '',
      foto: u.Foto || ''
    };
  }).filter(function(u) { return u.usuario; });

  return json({ success: true, data: data });
}

// ================================================================
// RESUMEN VP/PP (liviano — usado en usuario.html, no manda leads completos)
// ================================================================
function getResumenVpPp(body) {
  var motivo = {};
  var sesion = exigirSesion(body, ['SUPERVISOR', 'ASESOR', 'ADMISION'], motivo);
  if (!sesion) return json({ success: false, error: motivo.error });

  var esAdmin = esRolSupervisorOAdmision(sesion.rol);
  var nombreAsesor = esAdmin ? null : getNombreAsesorPorEmail(sesion.email);
  var campanas = Array.isArray(body.campanas) ? body.campanas : (body.campana ? [body.campana] : []);

  var resumen = {};
  campanas.forEach(function(campana) {
    resumen[campana] = calcularResumenVpPpCampana(campana, esAdmin, nombreAsesor);
  });

  return json({ success: true, data: resumen });
}

function calcularResumenVpPpCampana(campana, esAdmin, nombreAsesor) {
  var vacio = { vpTotal: 0, vpCompletos: 0, ppTotal: 0, ppCompletos: 0 };
  var sheet = SS.getSheetByName(campana);
  if (!sheet) return vacio;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return vacio;

  var NOMBRES_COLUMNAS_NECESARIAS = ['ID PROMETEO', 'ASESOR ULT TIP DF SN CONTC', 'STATUS DE GESTION', '# DE VPs DIF TI INTE'];
  var headerRowCompleto = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); });

  var columnasNecesarias = NOMBRES_COLUMNAS_NECESARIAS.map(function(nombre) {
    var idx = headerRowCompleto.indexOf(nombre);
    return idx === -1 ? null : idx + 1;
  }).filter(function(col) { return col !== null; });

  var data = leerColumnasOptimizado(sheet, columnasNecesarias, lastRow);
  if (data.length <= 1) return vacio;

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idxId = headers.indexOf('ID PROMETEO');
  var idxStatus = headers.indexOf('STATUS DE GESTION');
  var idxAsesor = headers.indexOf('ASESOR ULT TIP DF SN CONTC');
  var idxVPsDif = headers.indexOf('# DE VPs DIF TI INTE');

  var resolverBottom = getBottomMapActivo(campana);
  var hoyMap = getHoyMap(campana);
  var pagosMap = esAdmin ? getPagosMapPorId(campana) : {};
  var idsEnBase = {};

  var vpTotal = 0, vpCompletos = 0, ppTotal = 0, ppCompletos = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var idValue = idxId !== -1 ? String(row[idxId]).trim() : '';
    if (!idValue) continue;
    idsEnBase[idValue] = true;

    var statusValue = idxStatus !== -1 && row[idxStatus] ? row[idxStatus].toString().trim() : '';
    var asesorValue = idxAsesor !== -1 && row[idxAsesor] ? row[idxAsesor].toString().trim() : '';

    var hoyOverride = hoyMap[idValue];
    if (hoyOverride) {
      if (esValorMerge(hoyOverride['STATUS DE GESTION'])) statusValue = hoyOverride['STATUS DE GESTION'];
      if (esValorMerge(hoyOverride['ASESOR ULT TIP DF SN CONTC'])) asesorValue = hoyOverride['ASESOR ULT TIP DF SN CONTC'];
    }

    if (esAdmin) {
      var pagoInfo = pagosMap[idValue] || null;
      if (pagoInfo) {
        var statusPagoFinal = String(pagoInfo['STATUS DE PAGO FINAL'] || '').trim().toUpperCase();
        if (statusPagoFinal === 'PAGO COMPLETO' || statusPagoFinal === 'PAGO FRACCIONADO') statusValue = statusPagoFinal;
      }
      var vpsDifValue = idxVPsDif !== -1 ? Number(row[idxVPsDif]) || 0 : 0;
      var visibleParaAdmin = vpsDifValue !== 0 ||
        (hoyOverride && (statusValue === 'VALORES_VALORACIONES_POSITIVAS_VIVA' || statusValue === 'VALORES_PROMESA_DE_PAGO_VIVA'));
      if (!visibleParaAdmin) continue;
    } else {
      if (statusValue !== 'VALORES_VALORACIONES_POSITIVAS_VIVA' && statusValue !== 'VALORES_PROMESA_DE_PAGO_VIVA') continue;
      if (nombreAsesor && asesorValue.toLowerCase() !== nombreAsesor.toLowerCase()) continue;
    }

    var bottomRow = resolverBottom(idValue, asesorValue);
    var completo = calcularPerfilamientoCompleto(bottomRow).completo;

    if (statusValue === 'VALORES_VALORACIONES_POSITIVAS_VIVA') { vpTotal++; if (completo) vpCompletos++; }
    if (statusValue === 'VALORES_PROMESA_DE_PAGO_VIVA') { ppTotal++; if (completo) ppCompletos++; }
  }

  for (var idHoy in hoyMap) {
    if (idsEnBase[idHoy]) continue;
    var h2 = hoyMap[idHoy];
    var statusHoy = h2['STATUS DE GESTION'] || '';
    var asesorHoy = h2['ASESOR ULT TIP DF SN CONTC'] || '';
    if (statusHoy !== 'VALORES_VALORACIONES_POSITIVAS_VIVA' && statusHoy !== 'VALORES_PROMESA_DE_PAGO_VIVA') continue;
    if (!esAdmin && nombreAsesor && asesorHoy.toLowerCase() !== nombreAsesor.toLowerCase()) continue;

    var bottomRowHoy = resolverBottom(idHoy, asesorHoy);
    var completoHoy = calcularPerfilamientoCompleto(bottomRowHoy).completo;

    if (statusHoy === 'VALORES_VALORACIONES_POSITIVAS_VIVA') { vpTotal++; if (completoHoy) vpCompletos++; }
    if (statusHoy === 'VALORES_PROMESA_DE_PAGO_VIVA') { ppTotal++; if (completoHoy) ppCompletos++; }
  }

  return { vpTotal: vpTotal, vpCompletos: vpCompletos, ppTotal: ppTotal, ppCompletos: ppCompletos };
}