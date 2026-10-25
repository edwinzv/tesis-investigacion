# Inventario de evidencias y límites de reproducibilidad

Documento de orientación para revisión académica. No altera registros ni sustituye la auditoría original.

## Evidencias ya versionadas en `tesis-investigacion`

| Material | Ruta | Estado / límite |
| --- | --- | --- |
| Código del benchmark | `benchmark/run_benchmark.ts`, `benchmark/src/` | Disponible; código actual puede diferir de la revisión ejecutada |
| Versión histórica asociada a campaña | commit `af1fb0439c97ba9e2ad853976a3dd0303a88539d` | Identificado por los manifiestos de los tres servicios |
| 4 casos de la campaña | `benchmark/casos/` | Casos sintéticos utilizados; otros casos adicionales en la carpeta no implican que entraran en esta campaña |
| Resultados por servicio | `benchmark/pruebas_de_modelos/pruebas_de_*/` | Registros por lote, `events.jsonl`, manifiestos y cuentos generados |
| Consolidación | `benchmark/auditoria_final/auditoria_consolidada.json` | Reporte de 300 operaciones finales válidas y 60 cuentos; reconstruye intentos históricos |
| Evaluación ciega | `benchmark/evaluacion_pedagogica/` | Cuentos sin marcas del modelo, protocolos, rúbricas, clave de correspondencia y scripts |
| Documentación adicional para el docente | `docs/revision-docente/` | Guías y diagramas derivados del otro repositorio |

## Evidencia humana adicional

Los dos docentes calificaron independientemente 60 cuentos (120 fichas), con rúbrica común y códigos ciegos. Resumen numérico previamente utilizado en el manuscrito:

| Servicio | Media pedagógica en escala 1–5 | Cuentos con alertas de ambos |
| --- | ---: | ---: |
| Gemini 3.5 Flash-Lite | 4,586 | 0/20 |
| Qwen 3.8 27B | 3,933 | 5/20 |
| GPT-OSS 20B | 4,529 | 0/20 |

**Los archivos Excel originales de puntuación humana no se encuentran en este GitHub.** Solicitar al investigador los dos archivos originales y el consolidado si se necesita replicar agregaciones o acuerdo entre jueces. Esta tabla es descriptiva y no permite una revalidación fila a fila sin dichos archivos. No publicar nombres ni datos personales.

Las alertas comunes por código fueron `EVAL-26`, `EVAL-57`, `EVAL-58`, `EVAL-59` y `EVAL-60`. La asignación se genera mediante Mulberry32 y semilla `20261015`; el código de correspondencia se conserva en `benchmark/evaluacion_pedagogica/llave_maestra_ciega.json`.

## Precauciones metodológicas

- La prueba mide **generación textual y validación de contratos**, no el funcionamiento integral del producto ni resultados de aprendizaje en estudiantes.
- Los 60 relatos son completos **a nivel estructural**; esa propiedad no descarta errores narrativos o lingüísticos, como muestran las cinco alertas.
- El costo de inferencia es **teórico según tokens y tarifas registradas**, no necesariamente igual a facturación efectiva.
- La matriz C1–C5 se usa **exploratoriamente**; sus niveles de costo y latencia se mapearon después de las mediciones.
- No se necesitan claves ni nuevas llamadas API para auditar la campaña. Los logs de inferencia y los parámetros históricos deben leerse desde la campaña y su commit.

## Información editorial separada

El artículo fue presentado a **Edutec** con número de envío `5611`; el acuse de recibo y los formatos del manuscrito deben guardarse en el expediente del envío, no en la carpeta de código. Un acuse de recibo no equivale a aceptación editorial.
