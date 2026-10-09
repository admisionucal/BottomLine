#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Importador de chats de WhatsApp para el simulador de Rumbo.

Lee los .txt exportados de WhatsApp (Android, iPhone en español e
iPhone en inglés), quita duplicados, ANONIMIZA el contenido y genera
archivos .sql para cargar en Supabase (tabla sim_chats_fuente, ver
sql/13_simulador.sql).

Uso (desde la carpeta RumboCRM):

    python scripts/importar_chats.py "C:\\ruta\\a\\chats"
    python scripts/importar_chats.py "C:\\ruta\\a\\chats" --salida "C:\\otra\\carpeta"

Por defecto la salida queda en una carpeta "salida_simulador" AL LADO de
la carpeta de chats (fuera de RumboCRM), porque todo lo que está dentro
de RumboCRM se publica como archivo estático en Cloudflare.

Salida:
  - 14_seed_chats_parteNN.sql  -> ejecutar en orden en el SQL Editor
  - resumen_importacion.csv    -> para revisar qué se detectó de cada chat

Solo usa la librería estándar de Python (3.8+).
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import unicodedata

# ----------------------------------------------------------------------
# 1. LECTURA DE FORMATOS
# ----------------------------------------------------------------------

LRM = "\u200e"

# Android:  18/5/2026, 8:42 p. m. - Nombre: texto
RE_ANDROID = re.compile(
    r"^(\d{1,2}/\d{1,2}/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[ap]\.?\s?m\.?)\s+-\s+(.*)$",
    re.IGNORECASE,
)
# iPhone:   [4/06/26, 11:10:12 a. m.] Nombre: texto   |   [10/1/26, 9:45:49 AM] Tú: texto
RE_IOS = re.compile(
    r"^\[(\d{1,2}/\d{1,2}/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?|AM|PM)?)\]\s+(.*)$",
    re.IGNORECASE,
)

SISTEMA = [
    "cifrados de extremo a extremo",
    "messages and calls are end-to-end encrypted",
    "eliminaste este mensaje",
    "se eliminó este mensaje",
    "this message was deleted",
    "cambió su número",
    "creó el grupo",
    "te añadió",
    "fijaste un mensaje",
    "mensajes temporales",
    "llamada perdida",
    "llamada de voz perdida",
    "videollamada perdida",
    "es un contacto",
    "missed voice call",
]


def limpiar(linea):
    return linea.replace(LRM, "").replace("\ufeff", "").rstrip("\r\n")


def leer_mensajes(ruta):
    """Devuelve [(remitente, texto)] respetando mensajes de varias líneas."""
    with open(ruta, "r", encoding="utf-8", errors="replace") as f:
        lineas = [limpiar(l) for l in f]

    mensajes = []
    actual = None
    for linea in lineas:
        m = RE_IOS.match(linea.strip()) or RE_ANDROID.match(linea.strip())
        if m:
            if actual:
                mensajes.append(actual)
            resto = m.group(3)
            if ": " in resto:
                remitente, texto = resto.split(": ", 1)
            elif resto.endswith(":"):
                remitente, texto = resto[:-1], ""
            else:
                remitente, texto = "", resto  # línea de sistema sin remitente
            actual = [remitente.strip(), texto]
        elif actual is not None:
            actual[1] += "\n" + linea
        # líneas antes del primer mensaje (encabezados) se ignoran
    if actual:
        mensajes.append(actual)

    salida = []
    for remitente, texto in mensajes:
        t = texto.strip()
        bajo = t.lower()
        if not remitente:
            continue
        if any(s in bajo for s in SISTEMA):
            continue
        t = normalizar_adjuntos(t)
        if not t:
            continue
        salida.append((remitente, t))
    return salida


def normalizar_adjuntos(t):
    t = re.sub(r"<Se editó este mensaje\.?>", "", t, flags=re.IGNORECASE).strip()
    bajo = t.lower()
    if re.search(r"\.(opus|ogg|m4a|mp3|aac)\b", bajo) or "mensaje de voz omitido" in bajo or "audio omitido" in bajo:
        return "[audio]"
    if re.search(r"\.(jpe?g|png|webp|heic)\b", bajo) or "imagen omitida" in bajo:
        return "[imagen]"
    if re.search(r"\.(mp4|mov|3gp)\b", bajo) or "video omitido" in bajo:
        return "[video]"
    if "sticker omitido" in bajo or re.search(r"\.webp\b", bajo):
        return "[sticker]"
    if "(archivo adjunto)" in bajo or "<adjunto:" in bajo or "documento omitido" in bajo or re.search(r"\.(pdf|docx?|xlsx?|pptx?)\b", bajo):
        return "[documento]"
    if "<multimedia omitido>" in bajo or "<media omitted>" in bajo:
        return "[archivo]"
    return t


# ----------------------------------------------------------------------
# 2. ROLES (quién es asesor y quién es lead)
# ----------------------------------------------------------------------

PISTAS_ASESOR = re.compile(r"\b(ucal|asesor[a]?|te saluda|universidad de ciencias|asesora educativa|asesor educativo)\b", re.IGNORECASE)


def asignar_roles(mensajes, asesor_archivo):
    puntajes = {}
    conteo = {}
    for rem, t in mensajes:
        conteo[rem] = conteo.get(rem, 0) + 1
        p = puntajes.get(rem, 0)
        if PISTAS_ASESOR.search(rem):
            p += 5
        if PISTAS_ASESOR.search(t):
            p += 1
        if rem.lower() in ("tú", "tu", "you"):
            p += 3
        if asesor_archivo and any(w and w.lower() in rem.lower() for w in asesor_archivo.split()[:1]):
            p += 5
        puntajes[rem] = p
    if not puntajes:
        return {}
    asesor = max(puntajes, key=lambda k: (puntajes[k], conteo[k]))
    roles = {}
    for rem in conteo:
        roles[rem] = "asesor" if rem == asesor else "lead"
    return roles


# ----------------------------------------------------------------------
# 3. METADATOS DESDE EL NOMBRE DEL ARCHIVO Y EL CONTENIDO
# ----------------------------------------------------------------------

CARRERAS = [
    "Arquitectura de Interiores",
    "Arquitectura",
    "Diseño Digital de Interiores",
    "Diseño Gráfico Publicitario",
    "Diseño Gráfico y Marketing Digital",
    "Comunicación Audiovisual y Cine",
    "Comunicación y Publicidad Transmedia",
    "Comunicación y Marketing Digital",
    "Psicología",
    "Administración y Dirección de Empresas",
    "Marketing e Innovación",
    "Administración y Marketing",
    "Administración y Negocios Internacionales",
    "Ingeniería de Sistemas",
    "Contabilidad",
]

ABREVIATURAS = [
    (r"\bDGP\b", "Diseño Gráfico Publicitario"),
    (r"\bDGM(KT)?\b", "Diseño Gráfico y Marketing Digital"),
    (r"\bDDI\b", "Diseño Digital de Interiores"),
    (r"\bADM\s*Y\s*MKT\b|\bAYM\b", "Administración y Marketing"),
    (r"\bANI\b", "Administración y Negocios Internacionales"),
    (r"\bPSICO", "Psicología"),
    (r"\bCAC\b", "Comunicación Audiovisual y Cine"),
    (r"\bCMKT\b|\bCMD\b", "Comunicación y Marketing Digital"),
    (r"\bAI\b", "Arquitectura de Interiores"),
    (r"ARQUI+TECTURA", "Arquitectura"),
]


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def partes_archivo(nombre):
    """Devuelve (etiqueta_contacto, asesor) a partir del nombre del archivo."""
    base = os.path.splitext(nombre)[0]
    base = base.replace("\ufffd", "")
    asesor = ""
    m = re.search(r"ASESOR[A]?\s+([A-ZÁÉÍÓÚÑa-záéíóúñ ]+?)(?:\(\d+\))?(?:_|$)", base, re.IGNORECASE)
    if m:
        asesor = re.sub(r"\s+", " ", m.group(1)).strip().title()
    contacto = base
    m2 = re.search(r"(?:Chat de WhatsApp con|WhatsApp Chat -)\s*(.+?)(?:_|$)", base)
    if m2:
        contacto = m2.group(1)
    contacto = re.sub(r"\(\d+\)", "", contacto).strip()
    return contacto, asesor


def etiqueta_sin_nombre(contacto):
    """'Christopher - DGP +2' -> 'DGP +2'.  '+51 916 210 174' -> ''."""
    if re.search(r"\+?\d[\d ]{7,}", contacto) or contacto.startswith("@"):
        return ""
    if " - " in contacto:
        return contacto.split(" - ", 1)[1].strip()
    if "-" in contacto:
        return contacto.split("-", 1)[1].strip()
    return ""


def detectar_carrera(texto_total, etiqueta):
    plano = sin_tildes(texto_total.lower())
    conteo = {}
    for c in CARRERAS:
        n = plano.count(sin_tildes(c.lower()))
        if n:
            conteo[c] = n
    # "Arquitectura" también aparece dentro de "Arquitectura de Interiores"
    if "Arquitectura" in conteo and "Arquitectura de Interiores" in conteo:
        conteo["Arquitectura"] -= conteo["Arquitectura de Interiores"]
        if conteo["Arquitectura"] <= 0:
            del conteo["Arquitectura"]
    if conteo:
        return max(conteo, key=conteo.get)
    for patron, carrera in ABREVIATURAS:
        if re.search(patron, etiqueta, re.IGNORECASE):
            return carrera
    return ""


def detectar_tipo(marcas, texto_total):
    """Primero manda la etiqueta que puso el asesor; si no hay, el contenido."""
    e = " " + marcas.upper() + " "
    t = sin_tildes(texto_total.lower())
    if "+2" in e:
        return "programa_mas2"
    if re.search(r"\bCO[N]?VA\b", e):
        return "traslado_con_convalidacion"
    if re.search(r"\bCPA\b", e):
        return "cpa"
    if re.search(r"\bNUEVO\b", e):
        return "nuevo"
    if "programa +2" in t or "programa mas 2" in t:
        return "programa_mas2"
    if "convalid" in t or "traslado" in t:
        return "traslado_con_convalidacion"
    if "colegio" in t and "egreso" in t:
        return "nuevo"
    return ""


def detectar_modalidad(etiqueta, texto_total):
    e = etiqueta.upper()
    t = sin_tildes(texto_total.lower())
    if "SEMI" in e:
        return "semipresencial"
    if "CPA" in e or "+2" in e:
        return "virtual"
    v = t.count("virtual") + t.count("100% online") + t.count("a distancia")
    s = t.count("semipresencial") + t.count("semi presencial")
    if v == 0 and s == 0:
        return ""
    return "virtual" if v > s else "semipresencial"


def telefono_de(*textos):
    for tx in textos:
        m = re.search(r"\+?51\s?(9\d{2})\s?(\d{3})\s?(\d{3})", tx or "")
        if m:
            return "".join(m.groups())
    return ""


def nivel_interaccion(prom_palabras):
    if prom_palabras >= 14:
        return "conversador"
    if prom_palabras >= 7:
        return "normal"
    if prom_palabras >= 3.5:
        return "cortante"
    return "muy_cortante"


# ----------------------------------------------------------------------
# 4. ANONIMIZACIÓN
# ----------------------------------------------------------------------

PALABRAS_NO_NOMBRE = {
    "chat", "whatsapp", "con", "asesor", "asesora", "universidad", "ucal", "conva", "cova", "cpa", "semi",
    "nuevo", "dgp", "dgm", "dgmkt", "adm", "mkt", "ani", "psico", "cac", "ddi", "etu", "papa", "papá",
    "mama", "mamá", "de", "del", "la", "el", "los", "las", "y", "tú", "tu", "you", "hola", "buenas",
    "buenos", "noches", "tardes", "dias", "días", "señorita", "señor", "cibertec", "senati", "certus",
    "toulouse", "zegel", "isil", "sise", "arquitectura", "arquiitectura", "educativo", "educativa",
    "ciencias", "artes", "america", "américa", "latina", "nos", "que", "muy", "buen", "día", "dia",
    "por", "para", "bienvenido", "bienvenida", "perfecto", "listo", "gracias", "claro", "como", "estas",
    "espero", "comentame", "cuentame", "soy", "aqui", "aquí", "info", "informacion", "información",
    "consulta", "carrera", "convalidacion", "convalidación", "beca", "virtual", "semipresencial",
}

RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
RE_TEL = re.compile(r"(?:\+?51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}\b")
RE_DNI = re.compile(r"\b\d{8}\b")
RE_URL = re.compile(r"https?://\S+|www\.\S+")
RE_SALUDO = re.compile(
    r"(?i:hola|buen[oa]s?\s+(?:d[ií]as|tardes|noches)|estimad[oa]|querid[oa])[,!¡\s]+"
    r"([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+)?)"
)
RE_TE_SALUDA = re.compile(r"(?i:te saluda)\s+\*?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})")
RE_ARROBA = re.compile(r"@\w+")


def tokens_nombre(texto):
    out = set()
    for w in re.split(r"[\s,\-_~:()\[\]/.!¡¿?*]+", texto or ""):
        w = w.strip("@~*").strip()
        if len(w) < 3 or not re.match(r"^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$", w):
            continue
        if w.lower() in PALABRAS_NO_NOMBRE:
            continue
        out.add(w)
    return out


def anonimizar(texto, nombres_lead, nombres_asesor):
    # 1) Líneas que son solo un nombre completo en mayúsculas (respuesta a "NOMBRES Y APELLIDOS:")
    lineas = []
    for linea in texto.split("\n"):
        l = linea.strip()
        if re.fullmatch(r"[A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){2,5}", l) and not re.search(
            r"COLEGIO|INSTITUTO|UNIVERSIDAD|I\.?E\.?|CARRERA|ESCUELA|MATR[IÍ]CULA|BECA|MODALIDAD", l
        ):
            linea = "[NOMBRE COMPLETO]"
        lineas.append(linea)
    t = "\n".join(lineas)
    # 2) Datos de contacto
    t = RE_EMAIL.sub("[EMAIL]", t)
    t = RE_URL.sub("[ENLACE]", t)
    t = RE_TEL.sub("[TELÉFONO]", t)
    t = RE_DNI.sub("[DNI]", t)
    t = RE_ARROBA.sub("[USUARIO]", t)
    # 3) Nombres conocidos del asesor y del lead
    for n in sorted(nombres_asesor, key=len, reverse=True):
        t = re.sub(r"\b" + re.escape(n) + r"\b", "[ASESOR]", t, flags=re.IGNORECASE)
    for n in sorted(nombres_lead, key=len, reverse=True):
        t = re.sub(r"\b" + re.escape(n) + r"\b", "[NOMBRE]", t, flags=re.IGNORECASE)
    t = re.sub(r"(\[(?:NOMBRE|ASESOR)\])(\s+\[(?:NOMBRE|ASESOR)\])+", r"\1", t)
    return t


# ----------------------------------------------------------------------
# 5. PROCESO PRINCIPAL
# ----------------------------------------------------------------------


def procesar_archivo(ruta):
    nombre = os.path.basename(ruta)
    contacto, asesor_archivo = partes_archivo(nombre)
    etiqueta = etiqueta_sin_nombre(contacto)
    crudos = leer_mensajes(ruta)
    if len(crudos) < 2:
        return None, "menos de 2 mensajes"

    roles = asignar_roles(crudos, asesor_archivo)
    if "lead" not in roles.values():
        return None, "no se pudo identificar al lead"

    nombres_asesor, nombres_lead = set(), set()
    nombres_asesor |= tokens_nombre(asesor_archivo)
    for rem, rol in roles.items():
        (nombres_asesor if rol == "asesor" else nombres_lead).update(tokens_nombre(rem))
    nombres_lead |= tokens_nombre(contacto.split(" - ")[0] if " - " in contacto else contacto)
    for rem, t in crudos:
        for m in RE_TE_SALUDA.finditer(t):
            nombres_asesor |= tokens_nombre(m.group(1))
        if roles.get(rem) == "asesor":
            for m in RE_SALUDO.finditer(t):
                nombres_lead |= tokens_nombre(m.group(1))

    mensajes = []
    for rem, t in crudos:
        mensajes.append({"r": roles.get(rem, "lead"), "t": anonimizar(t, nombres_lead, nombres_asesor)})

    texto_total = "\n".join(m["t"] for m in mensajes)
    # Las etiquetas (DGP, CONVA, +2, CPA...) vienen en el nombre del contacto
    marcas = " ".join([contacto] + [rem for rem, rol in roles.items() if rol == "lead"])
    lead_txt = [m["t"] for m in mensajes if m["r"] == "lead" and not m["t"].startswith("[")]
    palabras = [len(x.split()) for x in lead_txt]
    prom = round(sum(palabras) / len(palabras), 2) if palabras else 0.0

    contenido_hash = hashlib.sha1("\n".join(f"{r}|{t}" for r, t in crudos).encode("utf-8")).hexdigest()

    return {
        "hash": contenido_hash,
        "archivo": nombre[:250],
        "asesor_real": asesor_archivo,
        "etiqueta": etiqueta[:120],
        "carrera": detectar_carrera(texto_total, marcas),
        "tipo_ingreso": detectar_tipo(marcas, texto_total),
        "modalidad": detectar_modalidad(marcas, texto_total),
        "telefono": telefono_de(contacto, *(r for r, _ in crudos)),
        "nivel_interaccion": nivel_interaccion(prom),
        "n_mensajes": len(mensajes),
        "n_mensajes_lead": sum(1 for m in mensajes if m["r"] == "lead"),
        "prom_palabras_lead": prom,
        "mensajes": mensajes,
    }, ""


def sql_texto(v):
    return "'" + str(v).replace("'", "''") + "'"


def fila_sql(c):
    return "(" + ", ".join([
        sql_texto(c["hash"]), sql_texto(c["archivo"]), sql_texto(c["asesor_real"]), sql_texto(c["etiqueta"]),
        sql_texto(c["carrera"]), sql_texto(c["tipo_ingreso"]), sql_texto(c["modalidad"]), sql_texto(c["telefono"]),
        sql_texto(c["nivel_interaccion"]), str(c["n_mensajes"]), str(c["n_mensajes_lead"]), str(c["prom_palabras_lead"]),
        sql_texto(json.dumps(c["mensajes"], ensure_ascii=False)) + "::jsonb",
    ]) + ")"


CABECERA_INSERT = (
    "insert into sim_chats_fuente (hash, archivo, asesor_real, etiqueta, carrera, tipo_ingreso, modalidad, telefono,\n"
    "  nivel_interaccion, n_mensajes, n_mensajes_lead, prom_palabras_lead, mensajes)\nvalues\n"
)
PIE_INSERT = (
    "\non conflict (hash) do update set\n"
    "  archivo = excluded.archivo, asesor_real = excluded.asesor_real, etiqueta = excluded.etiqueta,\n"
    "  carrera = excluded.carrera, tipo_ingreso = excluded.tipo_ingreso, modalidad = excluded.modalidad,\n"
    "  telefono = excluded.telefono, nivel_interaccion = excluded.nivel_interaccion,\n"
    "  n_mensajes = excluded.n_mensajes, n_mensajes_lead = excluded.n_mensajes_lead,\n"
    "  prom_palabras_lead = excluded.prom_palabras_lead, mensajes = excluded.mensajes;\n"
)


def main():
    ap = argparse.ArgumentParser(description="Importa chats de WhatsApp al simulador de Rumbo.")
    ap.add_argument("carpeta", help="Carpeta con los .txt exportados de WhatsApp")
    ap.add_argument("--salida", help="Carpeta de salida (por defecto: <carpeta>/../salida_simulador)")
    ap.add_argument("--por-archivo", type=int, default=15, help="Chats por cada .sql (default 15)")
    args = ap.parse_args()

    carpeta = os.path.abspath(args.carpeta)
    if not os.path.isdir(carpeta):
        sys.exit(f"No existe la carpeta: {carpeta}")
    salida = os.path.abspath(args.salida or os.path.join(os.path.dirname(carpeta), "salida_simulador"))
    os.makedirs(salida, exist_ok=True)

    archivos = sorted(f for f in os.listdir(carpeta) if f.lower().endswith(".txt"))
    chats, vistos, resumen = [], set(), []
    for f in archivos:
        try:
            chat, motivo = procesar_archivo(os.path.join(carpeta, f))
        except Exception as e:  # un archivo raro no debe frenar al resto
            chat, motivo = None, f"error: {e}"
        if not chat:
            resumen.append([f, "OMITIDO", motivo, "", "", "", "", "", ""])
            continue
        if chat["hash"] in vistos:
            resumen.append([f, "DUPLICADO", "mismo contenido que otro archivo", "", "", "", "", "", ""])
            continue
        vistos.add(chat["hash"])
        chats.append(chat)
        resumen.append([
            f, "OK", "", chat["carrera"], chat["tipo_ingreso"], chat["modalidad"], chat["nivel_interaccion"],
            chat["n_mensajes_lead"], "sí" if chat["telefono"] else "no",
        ])

    # Borrar salidas anteriores para no mezclar corridas
    for f in os.listdir(salida):
        if f.startswith("14_seed_chats_parte") and f.endswith(".sql"):
            os.remove(os.path.join(salida, f))

    n = max(1, args.por_archivo)
    partes = [chats[i:i + n] for i in range(0, len(chats), n)]
    for i, parte in enumerate(partes, 1):
        ruta = os.path.join(salida, f"14_seed_chats_parte{i:02d}.sql")
        with open(ruta, "w", encoding="utf-8") as out:
            out.write(f"-- Simulador Rumbo: chats de referencia (parte {i} de {len(partes)})\n")
            out.write("-- Generado por scripts/importar_chats.py. Contenido anonimizado.\n")
            out.write("-- NO subir este archivo a git ni dejarlo dentro de RumboCRM.\n\n")
            out.write(CABECERA_INSERT)
            out.write(",\n".join(fila_sql(c) for c in parte))
            out.write(PIE_INSERT)

    with open(os.path.join(salida, "resumen_importacion.csv"), "w", encoding="utf-8-sig", newline="") as out:
        w = csv.writer(out)
        w.writerow(["archivo", "estado", "motivo", "carrera", "tipo_ingreso", "modalidad", "nivel_interaccion",
                    "mensajes_lead", "telefono_detectado"])
        w.writerows(resumen)

    ok = len(chats)
    dup = sum(1 for r in resumen if r[1] == "DUPLICADO")
    omit = sum(1 for r in resumen if r[1] == "OMITIDO")
    print(f"Archivos leídos: {len(archivos)} | importados: {ok} | duplicados: {dup} | omitidos: {omit}")
    print(f"SQL generado en: {salida} ({len(partes)} archivo(s))")
    print("Revisa resumen_importacion.csv y luego ejecuta los .sql en orden en Supabase.")


if __name__ == "__main__":
    main()
