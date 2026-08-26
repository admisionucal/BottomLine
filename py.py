from pathlib import Path

# Carpeta desde donde se ejecuta el script
CARPETA_PRINCIPAL = Path.cwd()

# Archivo de salida
ARCHIVO_SALIDA = CARPETA_PRINCIPAL / "archivos_unificados.txt"

# Archivos o carpetas que quieres excluir.
# Puedes poner nombres completos o rutas relativas.
EXCLUIR = {
    "archivos_unificados.txt",
    "package-lock.json",
    "package.json",
    ".gitignore",
    ".assetsignore",
    "node_modules/*",
    ".wrangler/*",
    "assets/*",
    ".git/*"
}


def esta_excluido(ruta: Path) -> bool:
    ruta_relativa = ruta.relative_to(CARPETA_PRINCIPAL).as_posix()

    for exclusion in EXCLUIR:
        exclusion = exclusion.replace("\\", "/")

        # Excluir todo el contenido de una carpeta
        if exclusion.endswith("/*"):
            carpeta = exclusion[:-2].rstrip("/")
            if ruta_relativa.startswith(carpeta + "/"):
                return True

        # Excluir archivo/carpeta exacto
        elif ruta_relativa == exclusion:
            return True

        # Si es una carpeta, excluir todo su contenido
        elif ruta_relativa.startswith(exclusion + "/"):
            return True

        # Excluir por nombre
        elif ruta.name == exclusion:
            return True

    return False


def main():
    with ARCHIVO_SALIDA.open("w", encoding="utf-8") as salida:
        for ruta in sorted(CARPETA_PRINCIPAL.rglob("*")):

            # Solo archivos
            if not ruta.is_file():
                continue

            # No incluir archivos excluidos
            if esta_excluido(ruta):
                continue

            ruta_relativa = ruta.relative_to(CARPETA_PRINCIPAL).as_posix()

            # Ruta con "principal/" delante
            ruta_mostrada = f"principal/{ruta_relativa}"

            try:
                contenido = ruta.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                # Ignorar archivos binarios
                print(f"Ignorado (binario): {ruta_mostrada}")
                continue
            except Exception as e:
                print(f"Error leyendo {ruta_mostrada}: {e}")
                continue

            salida.write("=" * 80 + "\n")
            salida.write(f"ARCHIVO: {ruta_mostrada}\n")
            salida.write("=" * 80 + "\n\n")
            salida.write(contenido)
            salida.write("\n\n")

            print(f"Agregado: {ruta_mostrada}")

    print(f"\nListo. Todo se guardó en:\n{ARCHIVO_SALIDA}")


if __name__ == "__main__":
    main()