# Revisión de tesis: observaciones del docente (25/10/2026)

Esta carpeta **no modifica los experimentos ejecutados** ni la configuración de producción. Se añadió documentación y **fuentes PlantUML corregidas** para apoyar la actualización del documento Word. El archivo Word principal corregido se entregó separadamente al autor para inspección.

## Diagrama de casos de uso

`uml/06-casos-uso.puml` identifica `CU08 Escuchar` como caso que **extiende** a `CU07 Leer`. La dirección es `CU08 ..> CU07 : <<extend>>`. La fuente proviene del repositorio anterior y se conserva sin cambios por corresponder a esa relación correcta. Reemplazar la Figura 6 incrustada en Word después del render.

## Diagrama de interfaces

`uml/08-realizacion-interfaces.puml` deriva de las clases Dart existentes, no de pseudocódigo:
- `SupabaseAiService implements AiService`
- `CuentoRepositoryMemoria implements CuentoRepository`
- `CuentoRepositorySupabase implements CuentoRepository`

En UML, la realización va con línea discontinua y triángulo hueco hacia las interfaces. La fuente debe renderizarse y contrastarse con Figura 8 antes de sustituirla; no incorpora todos los métodos ni asociaciones de clases del diagrama completo de la tesis.

## Criterios experimentales: diferencias que no deben ocultarse

1. La campaña de cuatro casos, cinco repeticiones y cinco operaciones por cuento dejó **300 operaciones lógicas**, **309 HTTP** históricos y **60 cuentos** tras reanudaciones.
2. Gemini `gemini-3.5-flash-lite` es distinto del Gemini `gemini-3.8-flash` de piloto.
3. El análisis exploratorio min–max del artículo ordena GPT-OSS, Gemini, Qwen (4,290 / 3,648 / 3,514). Los cortes absolutos originales de la tesis, aplicados como escenario condicional, producen **Gemini 91; GPT-OSS 81; Qwen 66** sobre escala equivalente 20–100. Son métricas distintas y NO permiten seleccionar un ganador definitivo sin justificar las reglas.
4. Los Excel originales de las evaluaciones docentes **no están completos en los CSV de GitHub**. Se conservan fuera; requieren vinculación de hashes, versión de rúbrica y control de sesgos.

## Pendientes técnicos que NO se afirman ejecutados

- Actualizar imágenes incrustadas de Figuras 6, 8, 16 y secuencias Quiz/PDF tras render de PlantUML.
- Diseñar y probar localmente persistencia experimental de crudos inmutables, sin desplegar migraciones remotas sin autorización.
- Auditar y retirar credenciales fijas de staging; solicitar revocación de las activas. No incluir secretos en commits ni reescribir el historial sin estrategia previa.
- Completar prueba automatizada Flutter de bloqueo duplicado, payload, persistencia y retroalimentación.
- Validar equivalencias de C1–C5, incluyendo la distinción original/cuento aceptado y costos teóricos.

El artículo de Edutec no forma parte de estas modificaciones.
