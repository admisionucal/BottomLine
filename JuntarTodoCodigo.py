import os

# Nombre del archivo maestro que vamos a generar
archivo_salida = "codigo_nuevo.txt"

# Lista de tus módulos para asegurar que solo procese estos archivos
modulos_validos = ["code", "condiciones-comerciales", "cc-template", "components", "constants", "ui-kit", "utils",
                   "api", "auth", "config", "sidebar", "index", "dashboard", "asistencia", "lead-detail", 
                   "unificar-ids", "usuario"]

# Extensiones que nos interesan
extensiones_validas = [".html", ".js", ".css", ".gs"]

print("Iniciando la consolidación de archivos...")

def procesar_directorio(directorio_actual, destino, profundidad=0):
    """Procesa recursivamente todos los archivos en un directorio y sus subdirectorios"""
    archivos_procesados = 0
    
    try:
        # Listar todos los elementos en el directorio actual
        for elemento in sorted(os.listdir(directorio_actual)):
            ruta_completa = os.path.join(directorio_actual, elemento)
            
            # Si es un directorio, procesarlo recursivamente
            if os.path.isdir(ruta_completa):
                # Ignorar directorios ocultos y comunes como node_modules, .git, etc.
                if not elemento.startswith('.') and elemento not in ['node_modules', '__pycache__', 'dist', 'build']:
                    archivos_procesados += procesar_directorio(ruta_completa, destino, profundidad + 1)
            else:
                # Si es un archivo, verificar si coincide con nuestros criterios
                nombre_base, extension = os.path.splitext(elemento)
                
                # Verificar si el archivo pertenece a tus módulos y tiene la extensión correcta
                if nombre_base in modulos_validos and extension in extensiones_validas:
                    # Mostrar la ruta relativa para mejor identificación
                    ruta_relativa = os.path.relpath(ruta_completa)
                    print(f"Procesando: {ruta_relativa}")
                    
                    # Escribir la etiqueta de separación con la ruta completa
                    destino.write(f"\n=== ARCHIVO: {ruta_relativa} ===\n")
                    
                    # Leer el contenido del archivo original e insertarlo en el maestro
                    try:
                        with open(ruta_completa, "r", encoding="utf-8") as origen:
                            destino.write(origen.read())
                        destino.write("\n")  # Línea en blanco de separación al final
                        archivos_procesados += 1
                    except UnicodeDecodeError:
                        print(f"  ⚠️  Advertencia: No se pudo leer {ruta_relativa} (posiblemente archivo binario)")
                    except Exception as e:
                        print(f"  ❌ Error al leer {ruta_relativa}: {e}")
                        
    except PermissionError:
        print(f"  ⚠️  Permiso denegado para acceder a {directorio_actual}")
    except Exception as e:
        print(f"  ❌ Error al procesar {directorio_actual}: {e}")
    
    return archivos_procesados

try:
    with open(archivo_salida, "w", encoding="utf-8") as destino:
        # Comenzar desde el directorio actual
        directorio_inicio = "."
        
        print(f"Buscando archivos en: {os.path.abspath(directorio_inicio)}")
        print("Carpetas que se revisarán de forma recursiva...")
        
        total_archivos = procesar_directorio(directorio_inicio, destino)
        
    print(f"\n¡Éxito! Se creó '{archivo_salida}' correctamente unificando {total_archivos} archivos.")
    print(f"Ubicación: {os.path.abspath(archivo_salida)}")

except Exception as e:
    print(f"Ocurrió un error al procesar los archivos: {e}")