# Guía de revisión para el docente

Esta guía dirige la revisión **desde un único repositorio**, sin repetir pruebas experimentales. Las carpetas originales de aplicación y benchmark no se han modificado ni fusionado entre sí.

## 1. Revisar la aplicación

1. Punto de entrada: [`lib/main.dart`](../../lib/main.dart) y dependencias: [`pubspec.yaml`](../../pubspec.yaml).
2. Interfaz de usuario: [`lib/views/`](../../lib/views/).
3. Flujo de actividades: [`lib/controllers/`](../../lib/controllers/) y entidades en [`lib/models/`](../../lib/models/).
4. Integraciones y datos: [`lib/services/`](../../lib/services/), [`lib/repositories/`](../../lib/repositories/).
5. Funciones de servidor y esquema SQL local: [`supabase/functions/`](../../supabase/functions/) y [`supabase/migrations/`](../../supabase/migrations/).
6. Tests automatizados: [`test/`](../../test/); desde un entorno Flutter compatible, `flutter pub get` y `flutter test`. El docente puede inspeccionar código sin conectarse a los servicios externos.

Los archivos PlantUML en [`diagramas/`](diagramas/) ofrecen una vista rápida: casos de uso, secuencia de creación demo, esquema de datos y despliegue lógico. Sus notas identifican funciones previstas o aspectos remotos no comprobados; **no presentar diagramas como pruebas de funcionamiento**.

## 2. Revisar el benchmark que respalda el artículo

**Campaña:** cuatro casos sintéticos × cinco repeticiones × tres servicios × cinco operaciones por cuento.

| Elemento | Ruta |
| --- | --- |
| Código del ejecutor | [`benchmark/run_benchmark.ts`](../../benchmark/run_benchmark.ts) |
| Construcción de operaciones | [`benchmark/src/runner.ts`](../../benchmark/src/runner.ts) |
| Plantillas de prompts | [`benchmark/src/prompts.ts`](../../benchmark/src/prompts.ts) |
| Validación de esquemas | [`benchmark/src/contratos.ts`](../../benchmark/src/contratos.ts) |
| API Google | [`benchmark/src/adaptadores/google.ts`](../../benchmark/src/adaptadores/google.ts) |
| API Groq Qwen | [`benchmark/src/adaptadores/groq.ts`](../../benchmark/src/adaptadores/groq.ts) |
| API Groq GPT-OSS | [`benchmark/src/adaptadores/groq_gpt_oss.ts`](../../benchmark/src/adaptadores/groq_gpt_oss.ts) |
| Casos fuente | [`benchmark/casos/`](../../benchmark/casos/) |
| Logs y cuentos por servicio | [`benchmark/pruebas_de_modelos/`](../../benchmark/pruebas_de_modelos/) |
| Auditoría forense | [`benchmark/auditoria_final/`](../../benchmark/auditoria_final/) |

**Proveniencia:** los tres manifiestos de octubre de 2026 consignan el commit de campaña `af1fb0439c97ba9e2ad853976a3dd0303a88539d`. El árbol de trabajo `main` puede incluir ajustes posteriores. Por ejemplo, la configuración de razonamiento de Qwen cambió en versiones más recientes; verificar el commit anterior para juzgar las condiciones efectivas y evitar mezclar campañas.

### Qué significan las cifras

- **300 operaciones lógicas**: entradas del diseño para las que finalmente existe salida estructural válida tras la recuperación auditada.
- **60 cuentos estructuralmente completos**: 20 salidas por modelo, según la auditoría.
- **309 HTTP registrados en total**: las solicitudes de red no tienen una correspondencia 1:1 con las operaciones lógicas por errores, reintentos y reanudaciones.
- **Evaluación humana**: se realizó independientemente sobre 60 cuentos (120 fichas). Las 5 alertas compartidas pertenecen a Qwen. Los Excel originales humanos se manejan por separado, no están adjuntos a este repositorio; no confundir matrices vacías de plantilla o juicios automatizados con las valoraciones docentes.

Los criterios ponderados exploratorios C1–C5 (25 % / 25 % / 20 % / 20 % / 10 %) no demuestran mejoras directas de comprensión lectora en estudiantes. El ranking depende de la normalización, en particular de latencia y costo.

## 3. Comprobaciones de trazabilidad

- Manifestar versión/código y parámetros históricos desde los manifiestos de cada servicio, no solo desde la configuración actual.
- Comprobar `events.jsonl`, lotes y `auditoria_consolidada.json` antes de reconstruir fallos o tasas.
- Comparar los 60 IDs ciegos usando [`preparar_evaluacion_pedagogica.ts`](../../benchmark/evaluacion_pedagogica/scripts/preparar_evaluacion_pedagogica.ts) y la semilla `20261015`. El script emplea barajado seudoaleatorio determinista.
- La `llave_maestra_ciega.json` está en el repositorio **después** de la construcción de las fichas ciegas; el archivo público contiene la correspondencia código-modelo. No enviarlo a docentes durante una nueva evaluación ciega.
- Repetir pruebas en vivo **no es necesario** para revisar las evidencias existentes y podría generar costo o cambiar los resultados.

## 4. Documentos que no deben confundirse con el experimento

En el otro repositorio, `experiments/model_comparison/` contiene un protocolo diferente cuya documentación declara resultados pendientes. **No forma parte de esta campaña ya realizada** ni de los 60 cuentos evaluados. Tampoco el módulo de imágenes, el TTS o el quiz estuvieron dentro del benchmark comparativo textual.

## 5. Pendientes documentales explícitos

Los Excel originales de dos docentes y el manuscrito presentado a Edutec se conservan fuera de esta rama de código. Pueden facilitarse por separado al docente con medidas de privacidad. El enlace de envío a la revista y el correo de confirmación pertenecen al expediente editorial, no se incorporan automáticamente a GitHub.

**Precaución:** este repositorio es público. Antes de adjuntar datos adicionales, revisar secretos, perfiles infantiles o nombres de los evaluadores.
