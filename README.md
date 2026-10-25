# Cuentos Mágicos — aplicación y evidencias de investigación

Repositorio principal de revisión académica. Contiene **la aplicación Flutter para Windows** y el **benchmark textual utilizado en el artículo científico**. No es necesario descargar otro repositorio ni volver a ejecutar las inferencias para consultar las pruebas.

> **Inicio recomendado para el docente:** [Guía de revisión](docs/revision-docente/GUIA_REVISION.md).

## Mapa de navegación

| Componente | Ruta | Qué se puede examinar |
| --- | --- | --- |
| Interfaz y lógica de aplicación | [`lib/`](lib/) | Vistas, controladores, modelos, servicios y repositorios Flutter/Dart |
| Backend | [`supabase/`](supabase/) | Funciones Edge, esquema/migraciones locales e integración |
| Pruebas de aplicación | [`test/`](test/) | Tests automatizados del código Flutter |
| Benchmark realizado | [`benchmark/`](benchmark/) | Ejecutores TypeScript, adaptadores, prompts, validadores y configuración |
| Evidencia original por modelo | [`benchmark/pruebas_de_modelos/`](benchmark/pruebas_de_modelos/) | Logs de las operaciones, lotes, salidas y cuentos |
| Auditoría experimental | [`benchmark/auditoria_final/`](benchmark/auditoria_final/) | Informes y resumen reconstruido de la campaña |
| Evaluación de cuentos | [`benchmark/evaluacion_pedagogica/`](benchmark/evaluacion_pedagogica/) | Rúbrica, cuentos con código ciego, script y correspondencias |
| Diagramas seleccionados | [`docs/revision-docente/diagramas/`](docs/revision-docente/diagramas/) | Fuentes PlantUML de arquitectura y flujos, procedentes del repositorio anterior |

## Qué experimento respalda el artículo

Se compararon los servicios **Gemini 3.5 Flash-Lite (Google)**, **Qwen 3.8 27B (Groq)** y **GPT-OSS 20B (Groq)**. El diseño comprendió 4 casos narrativos sintéticos × 5 repeticiones × 5 operaciones encadenadas × 3 servicios = **300 operaciones lógicas** y **60 cuentos**. La auditoría histórica registra **309 solicitudes HTTP**, pues algunas operaciones tuvieron intentos/reanudaciones. La validez final del contrato técnico no equivale a calidad pedagógica.

- Manifiestos y salidas: [`benchmark/pruebas_de_modelos/`](benchmark/pruebas_de_modelos/).
- Auditoría consolidada: [`benchmark/auditoria_final/auditoria_consolidada.json`](benchmark/auditoria_final/auditoria_consolidada.json).
- La campaña se identifica en los manifiestos con el commit histórico **`af1fb0439c97ba9e2ad853976a3dd0303a88539d`**. Para examinar el código tal como quedó registrado entonces, consultar esa revisión y no asumir que `main` conserva todos los parámetros sin cambios.
- La evaluación humana consistió en 2 evaluadores × 60 relatos = **120 fichas**; la rúbrica y la codificación están aquí, pero los **Excel originales de evaluación humana no se incluyen en este repositorio**. Su trazabilidad se describe en [EVIDENCIAS_Y_LIMITES.md](docs/revision-docente/EVIDENCIAS_Y_LIMITES.md). Solicitarlos al investigador si se requiere comprobación fila a fila.

## Revisión del código sin llamadas de pago

Desde la raíz de un clon local, con Flutter instalado:

```powershell
flutter pub get
flutter test
```

Los comandos anteriores sirven para verificar dependencias y ejecutar tests de Flutter; **no acreditan por sí solos el despliegue remoto**. El benchmark requiere Node/TypeScript y credenciales solamente para inferencia real. Para revisar el flujo sin llamar a las API:

```powershell
npm install
npx tsx benchmark/run_benchmark.ts --model gemini --level 1 --dry-run
```

**No ejecutar** `--authorize-api-calls` ni una nueva campaña salvo autorización expresa: puede consumir cuota o generar cargos y no reproduce automáticamente las condiciones históricas de 2026.

## Estructura general del sistema

Arquitectura conceptual MVC + Services + Repository. El cliente Flutter utiliza servicios y repositorios; parte de la lógica externa está en funciones Supabase. Los diagramas anexos son derivados de revisión del código, **no certificaciones del despliegue**.

## Relación con el otro repositorio

[`edwinzv/CuentosMagicos`](https://github.com/edwinzv/CuentosMagicos) conserva documentos y diseños adicionales. Se compararon las ramas `main`: los archivos versionados de **`lib/`**, **`supabase/`**, **`test/`** y **`windows/`** coinciden. No se han duplicado ni mezclado esos directorios. El diseño `experiments/model_comparison/` del repositorio secundario **no corresponde a esta campaña realizada** y no debe confundirse con ella.

## Datos y seguridad

No incluir claves API, `.env`, credenciales Supabase de servicio, datos identificables de estudiantes ni fichas de docentes con nombres. `.env.example` contiene solo nombres de variables. Los resultados sintéticos son distintos de una validación de mejora lectora realizada con escolares.
