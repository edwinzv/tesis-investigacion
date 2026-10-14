# Benchmark Aislado de Generación Textual para Cuentos Mágicos

Este módulo experimental implementa un benchmark aislado, reproducible y riguroso para comparar tres alternativas de servicio de inferencia de modelos de lenguaje en la generación textual de cuentos infantiles interactivos (8 a 10 años).

---

## 1. Modelos Candidatos y Tarifas

| Candidato | Proveedor | Modelo Lógico / ID | API / Endpoint | Variable de Entorno | Tarifas Oficiales (por 1M tokens) | Régimen Gratuito / Créditos |
|---|---|---|---|---|---|---|
| **Modelo 1** | **Google** | `gemini-3.8-flash` | Gemini Developer API (`:generateContent`) | `GEMINI_API_KEY` | Input: $0.75 USD<br>Output: $3.75 USD<br>*(Vigente al 09/10/2026 hasta 2026-12-31. Fuente: Google AI Gemini 3.8 Flash / Pricing)* | Free Tier en Google AI Studio sujeto a límites RPM/RPD. |
| **Modelo 2** | **Groq** | `qwen/qwen3.8-27b` | GroqCloud Chat Completions (`/chat/completions`) | `GROQ_API_KEY` | Input: $0.80 USD<br>Output: $4.00 USD<br>*(Consulta: 2026-10-09. Fuente: GroqCloud Docs)* | Free Plan (~30 RPM, 1000 RPD, 8000 TPM, 200000 TPD). |
| **Modelo 3** | **Groq** | `openai/gpt-oss-20b` | GroqCloud Chat Completions (`/chat/completions`) | `GROQ_API_KEY` | Input: $0.075 USD<br>Output: $0.30 USD<br>*(Cached: $0.037. Consulta: 2026-10-09. Fuente: GroqDocs GPT OSS 20B)* | Free Plan (30 RPM, 1000 RPD, 8000 TPM, 200000 TPD). |

> **Nota metodologica sobre el Modelo 3:** Hugging Face Inference Providers fue considerado inicialmente para GPT-OSS 20B, pero el preflight del 09/10/2026 no pudo ejecutarse por agotamiento de creditos de la cuenta. Para evitar gasto adicional y conservar el mismo modelo logico, GPT-OSS 20B se evaluo directamente mediante GroqCloud. Esto es una decision previa al experimento definitivo, NO un resultado de calidad.

---

## 2. Alcance Técnico y Operaciones Evaluadas

Se evalúa **exclusivamente** la generación textual del relato. No se incluye generación de imágenes, narración por voz (TTS), quizzes, OCR, almacenamiento ni persistencia en base de datos.

Cada cuento completo consta de **5 operaciones controladas**:
1. **Análisis Estructural:** Extrae 8 campos obligatorios del texto fuente (`titulo`, `tituloOriginal`, `protagonista`, `descripcionProtagonista`, `resumen`, `escenario`, `conflicto`, `finalOriginal`).
2. **Escena 1 (Inicial):** Párrafo introductorio (70–130 palabras) + 3 opciones distintas de decisión + `esFinal: false`.
3. **Escena 2 (Continuación 1):** Párrafo de continuidad que responde a la **Decisión 1** (`decisionesFijas[0]`) + 3 opciones nuevas + `esFinal: false`.
4. **Escena 3 (Continuación 2):** Párrafo de continuidad que responde a la **Decisión 2** (`decisionesFijas[1]`) + 3 opciones nuevas + `esFinal: false`.
5. **Escena 4 (Desenlace Final):** Párrafo de cierre que resuelve el relato respondiendo a la **Decisión 3** (`decisionesFijas[2]`) + opciones vacías `[]` + `esFinal: true`.

---

## 3. Planes Experimentales

- **Piloto Experimental (`--pilot`):**
  - 1 caso × 1 repetición × 3 modelos × 5 operaciones = **15 operaciones experimentales**.
  - Resultados guardados en: `benchmark/resultados_piloto/`
- **Benchmark Definitivo (`--full`):**
  - 5 casos × 2 repeticiones × 3 modelos × 5 operaciones = **150 operaciones experimentales**.
  - Resultados guardados en: `benchmark/resultados/`

---

## 4. Metodología de Medición

### 4.1. Latencia y Transparencia HTTP
- Cada operación registra el número exacto de solicitudes HTTP realizadas (`numero_solicitudes_http`).
- No existen reintentos ocultos ni fallbacks silenciosos tras códigos HTTP 4xx.
- La latencia observada representa la cadena de inferencia completa:
  $$\text{Latencia total} = \text{Modelo} + \text{Infraestructura del proveedor} + \text{Enrutamiento/Router} + \text{Carga de tráfico} + \text{Latencia de red local}$$

### 4.2. Metodología Económica
- **Costo Teórico Recurrente:** Se calcula estrictamente cuando la tarifa y los tokens son conocidos de forma verificable. Si un modelo tiene tarifa dinámica sin provider confirmado (como HF `:cheapest`), el costo teórico se registra como `null` (N/A), **nunca como cero falso**.
- **Costo Efectivo del Experimento:** Registra el gasto real facturado. Permanece en `null` (desconocido) salvo confirmación explícita de cobertura íntegra por cuota gratuita.

### 4.3. Evaluación Ciega
- Las muestras cualitativas para evaluación humana ciega (**Calidad Narrativa 25 %** y **Adecuación Educativa 20 %**) se anonimizan bajo **Modelo A**, **Modelo B** y **Modelo C**.
- La correspondencia se genera de forma **aleatoria única** mediante `llave_maestra.json` solo al ejecutar corridas reales y queda estrictamente excluida de Git.
- En modo simulación (`--dry-run`) **no se genera la llave ni se exportan muestras ciegas**.

---

## 5. Instrucciones de Uso (CLI)

### Protección contra ejecución accidental
Si se invoca sin banderas, aborta de inmediato:
```powershell
npx.cmd tsx benchmark/run_benchmark.ts
```

### Modos de simulación (Dry-Run: 0 red, 0 gasto, métricas reales = N/A)
```powershell
# Simulación del benchmark definitivo (150 operaciones simuladas)
npx.cmd tsx benchmark/run_benchmark.ts --dry-run

# Simulación del piloto (15 operaciones simuladas)
npx.cmd tsx benchmark/run_benchmark.ts --pilot --dry-run
```

### Comprobaciones técnicas previas
```powershell
# Comprobación de conectividad y catálogo (0 tokens de inferencia)
npx.cmd tsx benchmark/run_benchmark.ts --check-providers

# Prueba pre-flight técnica (1 llamada mínima por modelo - requiere autorización)
npx.cmd tsx benchmark/run_benchmark.ts --preflight
```

### Ejecución experimental real (Requiere autorización explícita)
```powershell
# Piloto real (15 operaciones experimentales)
npx.cmd tsx benchmark/run_benchmark.ts --pilot

# Benchmark definitivo real (150 operaciones experimentales)
npx.cmd tsx benchmark/run_benchmark.ts --full
```

### Consolidación de la matriz multicriterio
Rechaza archivos generados mediante dry-run:
```powershell
npx.cmd tsx benchmark/consolidar_matriz.ts --pilot
npx.cmd tsx benchmark/consolidar_matriz.ts
```

---

## 6. Aclaraciones Metodologicas y Estadisticas

- **Reglas Estadisticas (Latencia):**
  - **Mediana:** Para N impar, se toma el valor central exacto sorted[Math.floor(n / 2)]. Para N par, el promedio aritmetico de los dos centrales (sorted[n / 2 - 1] + sorted[n / 2]) / 2.
  - **Percentil 95 (P95):** Regla nearest-rank con indice Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1)).

- **Operaciones vs Solicitudes HTTP:**
  - operaciones_totales: 15 en Piloto, 150 en Benchmark Definitivo.
  - solicitudes_http_totales: Incluye retries correctivos si ocurren.
  - En reintento, se acumula consumo total (tokens, latencia, costo).

- **Facturacion:**
  - Gemini: tokensSalidaFacturables = candidatesTokenCount + (thoughtsTokenCount ?? 0) a 3.75 USD / 1M.
  - Groq (OpenAI-compatible): completion_tokens ya engloba reasoning tokens.

- **Pacing Preventivo Groq:** 15s antes de cada operacion de Groq fuera de tiempo_ms.

- **Preflight:** Maximo 3 HTTP requests, 256 tokens max, schema estado: ok. No cuenta para el benchmark.

## 7. TEST20 — preparación; revisión independiente pendiente

**ENSAYOOPERATIVOREDUCIDO**, no comparación final. Selección ordenada: casos
01 misterio_agua, 02 robot_cielo, 03 arbol_hueco y 04 cometa_viento; una repetición,
análisis + cuatro escenas: 20 operaciones por candidato, 60 previstas. Conserva
IDs, prompts, corpus, contratos y parámetros efectivos del código (2048 tokens;
pacing Google 2 s, Qwen 65 s, GPT-OSS 15 s entre llamadas consecutivas).

Desde la raíz del repositorio, usando exclusivamente el ejecutable local existente:

```powershell
# SAFE por defecto: plan a stdout; sin red, archivos de salida ni carga de .env/credenciales.
& .\node_modules\.bin\tsx.cmd benchmark/run_benchmark.ts --test20
& .\node_modules\.bin\tsx.cmd benchmark/run_benchmark.ts --test20 --dry-run
# Pruebas locales con mocks; no proveedores reales.
& .\node_modules\.bin\tsx.cmd --test benchmark/src/test20.test.ts
```

Estas garantías SAFE corresponden a `--test20` (con o sin `--dry-run`), no al
`--dry-run` histórico invocado solo, que conserva su flujo previo.

**Comando real propuesto, NO ejecutado ni autorizado por TEST20-PREP:**
`& .\node_modules\.bin\tsx.cmd benchmark/run_benchmark.ts --test20 --execute-test20 --budget-validated-external`.
Requiere autorización futura y validación exterior de presupuesto/cuota. La última
bandera es una declaración del operador, no una comprobación automática ni un techo
económico. No hay timeout/duración/presupuesto monetario implementados ni tarifas
verificadas; costos y gratuidad permanecen desconocidos. No cargar .env automáticamente:
la gestión de credenciales para una futura ejecución queda fuera de esta preparación.

TEST20 desactiva retries correctivos y permite como máximo 20 invocaciones HTTP por
candidato/60 totales, reservadas y registradas antes del adaptador. Los adaptadores
inspeccionados hacen un único fetch directo por operación; una guarda adicional
bloquea fetch extra y redirecciones. Sin preflight/catálogo. HTTP 429/400/401/402/403/404
o categorías auth/billing/model_not_found/invalid_request detienen ese candidato;
los otros continúan. Dependencias fallidas y operaciones del candidato detenido se
registran como omitidas con cero llamadas; no se rellenan historias exitosas.

Solo la ejecución real explícita crea `benchmark/resultados_ensayo/<UTC_UID>/`,
sin reutilizar carpeta. Manifiesto con hashes/selección/parámetros/entorno no secreto;
JSONL incremental sincronizado con intentos, respuestas crudas, resultados, omisiones,
paradas y contadores. Interrupción abrupta puede dejar un intento sin respuesta/final:
no se interpreta como éxito. CSV detalle derivado del JSONL al finalizar, con formato
existente y campos económicos/gratuidad vacíos (unknown). No genera C2/C3, C5,
agregaciones, matriz, muestras ciegas ni cambia protocolo o resultados históricos.
Argumentos desconocidos, duplicados y combinaciones incompatibles se rechazan antes
de cargar entorno; los modos válidos pilot/full conservan su flujo existente.

Los contadores del cap son reservas conservadoras antes del adaptador: una excepción
local previa a fetch también ocupa reserva. `http_dispatch` distingue las solicitudes
entregadas al transporte; una interrupción entre registro y envío no acredita recepción
remota. El CSV conserva el contador de intentos del runner histórico. No se declara
facturación ni ejecución remota a partir de esas reservas.

### Ciclo 2 — persistencia fatal y errores HTTP

En TEST20, fallar una escritura de evidencia aborta globalmente: no se invocan
operaciones/candidatos posteriores ni se alcanza `complete` o la derivación CSV.
Esto incluye `attempt_response` y `http_dispatch` antes del envío; el transporte
conserva el fallo fatal aunque un adaptador lo envuelva como error de API.
El evento final de interrupción/fatal es best-effort: si el almacenamiento sigue
fallando no se garantiza su escritura; permanecen los eventos ya sincronizados.
El runner histórico conserva su manejo anterior fuera de la opción TEST20.

`attempt_error_response` vincula id/modelo/caso/operación con status, categoría,
mensaje y cuerpo de error disponible del proveedor. `provider-error-v1` redacta
campos JSON sensibles (key/api_key/password/secret/authorization/tokens), Bearer,
asignaciones textuales y patrones de credenciales conocidos, incluidas repeticiones
de esos valores en mensajes. Conserva diagnósticos no sensibles, metadatos de
redacción y SHA-256/longitud UTF-8 del cuerpo original recibido; no persiste el
original sin sanear ni consulta entorno, claves o request headers. El mensaje de
la operación/CSV también se sanea. Un cuerpo ausente queda distinto de uno vacío.
La redacción es por patrones, no garantía de reconocer credenciales arbitrarias
sin etiquetas; el hash no permite reconstruir/verificar el cuerpo sin disponer de
él y no sustituye una copia cruda. No añade llamadas, retries ni cambios de planes.
Dos hallazgos corregidos por el editor; segunda revisión independiente pendiente.
