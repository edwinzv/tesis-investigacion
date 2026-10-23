# INFORME DE AUDITORÍA ACADÉMICA Y FORENSE EXPERIMENTAL
## Evaluación Comparativa de Modelos de Lenguaje para Generación Narrativa Educativa Estructurada
**Proyecto de Tesis de Grado e Investigación Científica**

---

### Resumen Ejecutivo

Se ha llevado a cabo una **auditoría forense exhaustiva e independiente** sobre los 30 lotes experimentales completados para los tres modelos evaluados en el benchmark:
1. **Gemini 3.5 Flash Lite** (`gemini-3.5-flash-lite`, Google AI Studio)
2. **Qwen 3.8 27B** (`qwen/qwen3.8-27b`, Groq Cloud)
3. **GPT-OSS 20B** (`openai/gpt-oss-20b`, Groq Cloud)

Los resultados finales consolidados alcanzaron el **100% de cumplimiento estructural final** (**300/300 operaciones válidas** y **60/60 cuentos pedagógicos completos e íntegros**).

No obstante, esta auditoría revela una **discrepancia crítica entre la agregación de alto nivel de los reportes consolidados y el flujo forense de eventos de red (`events.jsonl` y registros de recuperación)**:
- Los scripts de consolidación previo contaban las solicitudes HTTP sumando únicamente el estado del *último intento ganador* de cada una de las 100 operaciones deduplicadas por modelo, reportando **100 solicitudes HTTP para GPT-OSS, 102 para Qwen y 100 para Gemini**.
- La reconstrucción forense real demuestra que se ejecutaron **104 solicitudes HTTP para GPT-OSS, 103 para Qwen y 102 para Gemini**.
- Asimismo, la auditoría confirma con rigor que las **omisiones por fallo de dependencia (`dependency_failed`) no generaron ninguna llamada a la red (0 solicitudes HTTP)**, actuando como disyuntores lógicos (*circuit-breakers*) esenciales para la coherencia narrativa y el ahorro de recursos.
- Por último, se verifica que los costos históricos reflejan con exactitud los **tokens reales consumidos por las operaciones exitosas**, sin inventar consumos de tokens para respuestas HTTP erróneas (400, 429) donde las APIs de los proveedores no devuelven metadatos de uso.

---

### 1. Cuadro Comparativo Global de Rendimiento Académico

A continuación se presenta la tabla formal consolidada con las métricas verificadas:

| Métrica Académica | Gemini 3.5 Flash Lite | Qwen 3.8 27B | GPT-OSS 20B | Método de Verificación |
| :--- | :---: | :---: | :---: | :--- |
| **Identificador API Runtime** | `gemini-3.5-flash-lite` | `qwen/qwen3.8-27b` | `openai/gpt-oss-20b` | Verificado en payload HTTP |
| **Proveedor / Infraestructura** | Google AI Studio | Groq Cloud (LPU) | Groq Cloud (LPU) | Verificado en endpoint |
| **Operaciones Planificadas** | 100 | 100 | 100 | Manifiesto de 10 lotes |
| **Operaciones Válidas Finales** | 100 (100.0%) | 100 (100.0%) | 100 (100.0%) | Validación JSON Schema |
| **Cuentos Completos (5 ops c/u)** | 20 / 20 (100.0%) | 20 / 20 (100.0%) | 20 / 20 (100.0%) | Integridad narrativa 100% |
| **Éxitos al 1.ᵉʳ Intento (Estricto)** | 98 / 100 (98.0%) | 93 / 100 (93.0%)* | 93 / 100 (93.0%) | Historial forense de eventos |
| **Éxitos al 1.ᵉʳ Intento (Flag CSV)** | 100 / 100 (100.0%) | 98 / 100 (98.0%) | 93 / 100 (93.0%) | Registro en `ejecuciones_raw.csv` |
| **Fallos Iniciales de Red / Formato** | 1 (HTTP 503) | 1 (HTTP 429) + 2 retries | 3 (2×HTTP 400, 1×Ruta) | `events.jsonl` |
| **Operaciones Omitidas por Dependencia** | 1 (0 solicitudes HTTP) | 4 (0 solicitudes HTTP) | 4 (0 solicitudes HTTP) | Validación disyuntor lógico |
| **Operaciones Recuperadas** | 2 (Lote 01) | 5 (Lote 01) | 7 (Lotes 05, 06, 07) | Recuperaciones selectivas |
| **Solicitudes HTTP Reportadas (Consolidado)** | 100 | 102 | 100 | Suma simple mapa operaciones |
| **Solicitudes HTTP Históricas Reales** | **102** | **103** | **104** | **Reconstrucción forense total** |
| **Latencia Media (ms)** | 3,210.78 ms | 1,380.24 ms | **933.86 ms** | Cronómetro HTTP cliente |
| **Latencia Mediana (ms)** | 2,739.00 ms | 1,156.00 ms | **913.50 ms** | Percentil 50 |
| **Latencia Percentil 95 (P95) (ms)** | 5,919.00 ms | 2,793.00 ms | **1,238.00 ms** | Percentil 95 |
| **Tokens Entrada Totales (Prompt)** | 45,088 | 64,974 | 82,486 | Tokenizador oficial |
| **Tokens Salida Totales (Completion)** | 21,640 | 25,251 | 23,643 | Tokenizador oficial |
| **Tokens Razonamiento (Thinking)** | 0 (interno/opaco) | 3,702 | 1,491 | Encabezados de inferencia |
| **Tokens Totales Facturables** | **66,728** | **90,225** | **106,129** | Uso reportado API |
| **Tokens Medios por Cuento Completo** | 3,336.4 | 4,511.3 | 5,306.4 | Promedio sobre 20 cuentos |
| **Tarifa Input (USD / Millón)** | $0.30 | $0.80 | $0.075 | Tarifas vigentes oct-2026 |
| **Tarifa Output (USD / Millón)** | $2.50 | $4.00 | $0.30 | Tarifas vigentes oct-2026 |
| **Costo Teórico Total Verificado (USD)** | $0.067625 | $0.152978 | **$0.013283** | Operaciones válidas |
| **Costo Medio por Cuento Completo (USD)**| $0.003381 | $0.007649 | **$0.000664** | Por cuento de 5 fases |
| **Tasa Cumplimiento Estructural Final** | **100.00%** | **100.00%** | **100.00%** | Validación schema y ruta |

*\*Nota metodológica sobre Qwen al primer intento:* En el Lote 01, la operación 6 sufrió HTTP 429 (Rate Limit por exceso de contexto inicial en pruebas tempranas) y omitió 4 escenas por dependencia. En la reanudación del Lote 01, se registraron las 5 operaciones con éxito. En los Lotes 06 y 07, dos operaciones requirieron 1 reintento correctivo interno cada una. Según la bandera persistida en el CSV final, se contabilizan 98% al primer intento, mientras que en estricto orden cronológico continuo fueron 93%.

---

### 2. Auditoría Detallada por Modelo e Investigación de Incidentes

#### 2.1. GPT-OSS 20B (`openai/gpt-oss-20b` vía Groq)
- **Operaciones planificadas:** 100.
- **Operaciones válidas finales:** 100.
- **Cuentos completos:** 20.
- **Solicitudes HTTP consolidadas vs. reales:** El reporte de consolidación mostraba **100 solicitudes HTTP**, pero el análisis forense demostró que se enviaron **104 solicitudes HTTP**.
- **Desglose de los Lotes Críticos (05, 06 y 07):**
  - **Lote 05:**
    - *Intento 1:* 8 solicitudes HTTP enviadas. 7 fueron exitosas. La operación `caso_01_misterio_agua_rep3_escena_2` devolvió **HTTP 400** (`invalid_request: Failed to generate JSON. Please adjust your prompt`). Las operaciones subsiguientes `escena_3` y `escena_4` fueron **omitidas por dependencia lógica** (`dependency_failed`, produciendo **0 llamadas HTTP**).
    - *Intento 2 (Recuperación selectiva):* Se reutilizaron las 7 exitosas y se ejecutaron las 3 pendientes (`escena_2_int2`, `escena_3_int2`, `escena_4_int2`), realizando **3 solicitudes HTTP**, todas exitosas.
    - *Total HTTP Lote 05:* 8 (inicial) + 3 (recuperación) = **11 solicitudes HTTP**. (El consolidado sólo contaba las 10 finales).
  - **Lote 06:**
    - *Intento 1:* 10 solicitudes HTTP enviadas. 8 exitosas. La operación `caso_03_arbol_hueco_rep3_escena_3` obtuvo HTTP 200 pero falló la validación de la opción controlada ("*Acomodar al ave en un lecho de musgo...*"). El sistema realizó un reintento correctivo interno antes de fallar (2 llamadas HTTP para esa sola operación). La `escena_4` fue omitida por dependencia (**0 llamadas HTTP**).
    - *Intento 2 (Recuperación selectiva):* Se recuperaron `escena_3_int2` y `escena_4_int2`, realizando **2 solicitudes HTTP**, ambas exitosas.
    - *Total HTTP Lote 06:* 10 (inicial) + 2 (recuperación) = **12 solicitudes HTTP**. (El consolidado sólo contaba 10).
  - **Lote 07:**
    - *Intento 1:* 9 solicitudes HTTP enviadas. 8 exitosas. La operación `caso_02_robot_cielo_rep4_escena_3` devolvió **HTTP 400** (`invalid_request`). La `escena_4` fue omitida por dependencia (**0 llamadas HTTP**).
    - *Intento 2 (Recuperación selectiva):* Se recuperaron `escena_3_int2` y `escena_4_int2`, realizando **2 solicitudes HTTP**, ambas exitosas.
    - *Total HTTP Lote 07:* 9 (inicial) + 2 (recuperación) = **11 solicitudes HTTP**. (El consolidado sólo contaba 10).
  - **Lotes 01, 02, 03, 04, 08, 09, 10:** 10 solicitudes HTTP cada uno (70 en total), 100% exitosas al primer intento.
  - **Suma Total Histórica Verificable:** 70 + 11 + 12 + 11 = **104 solicitudes HTTP**.

#### 2.2. Qwen 3.8 27B (`qwen/qwen3.8-27b` vía Groq)
- **Operaciones planificadas:** 100.
- **Operaciones válidas finales:** 100.
- **Cuentos completos:** 20.
- **Solicitudes HTTP consolidadas vs. reales:** El reporte de consolidación mostraba **102 solicitudes HTTP**, pero el análisis forense demuestra que se ejecutaron **103 solicitudes HTTP**.
- **Incidentes investigados:**
  - **Lote 01:** Durante el primer intento, las primeras 5 operaciones generaron textos sin la restricción estricta de tokens implementada posteriormente (acumulando 5,306 tokens de salida). La operación 6 (`caso_02_robot_cielo_rep1_analisis`) fue rechazada por Groq con **HTTP 429** (`rate_limit`). Las escenas 1 a 4 de ese caso fueron **omitidas por dependencia (0 llamadas HTTP)**. Tras ajustar los límites de contexto y esperar la ventana de cuota, el lote reanudó y completó las 5 operaciones restantes (**5 llamadas HTTP**).
    - *Total HTTP Lote 01:* 5 (exitosas) + 1 (HTTP 429) + 0 (4 omitidas) + 5 (recuperadas) = **11 solicitudes HTTP**. (El consolidado mostraba 10).
  - **Lotes 06 y 07:** En cada uno de estos lotes, una operación requirió un reintento correctivo interno (`numero_solicitudes_http = 2`) para ajustar la estructura JSON Schema, resultando en 11 solicitudes HTTP por lote.
  - **Lotes 02, 03, 04, 05, 08, 09, 10:** 10 solicitudes HTTP cada uno (70 en total).
  - **Suma Total Histórica Verificable:** 11 + 11 + 11 + 70 = **103 solicitudes HTTP**.

#### 2.3. Gemini 3.5 Flash Lite (`gemini-3.5-flash-lite` vía Google)
- **Operaciones planificadas:** 100.
- **Operaciones válidas finales:** 100.
- **Cuentos completos:** 20.
- **Solicitudes HTTP consolidadas vs. reales:** El reporte de consolidación mostraba **100 solicitudes HTTP**, pero el análisis forense demuestra que se ejecutaron **102 solicitudes HTTP**.
- **Incidentes investigados:**
  - **Lote 01:** Las operaciones 1, 2 y 3 fueron exitosas (3 solicitudes HTTP). La operación 4 (`caso_01_misterio_agua_rep1_escena_3`) recibió un error **HTTP 503** de Google AI Studio por saturación temporal del servicio y realizó un reintento automático que también devolvió 503 (**2 solicitudes HTTP consumidas en esa operación**). La `escena_4` fue **omitida por dependencia lógica (0 llamadas HTTP)**. Posteriormente, el proceso de recuperación ejecutó `escena_3` y `escena_4` exitosamente (**2 llamadas HTTP**).
    - *Total HTTP Lote 01:* 3 (exitosas) + 2 (fallidas con reintento HTTP 503) + 0 (1 omitida) + 5 (caso 2) + 2 (recuperación caso 1) = **12 solicitudes HTTP**. (El consolidado mostraba 10).
  - **Lotes 02 al 10:** Ejecución impecable sin errores de red ni reintentos (90 solicitudes HTTP para 90 operaciones).
  - **Suma Total Histórica Verificable:** 12 + 90 = **102 solicitudes HTTP**.

---

### 3. Rigor Metodológico: Diferenciación entre Llamadas HTTP y Omisiones de Dependencia

Un hallazgo metodológico fundamental para la tesis es la naturaleza de los errores de dependencia (`dependency_failed`):

```
                                  [Operación Previa]
                                          |
                        +-----------------+-----------------+
                        |                                   |
                  [HTTP 200 OK]                    [Fallo HTTP / Schema]
                        |                                   |
               [Continuar Flujo]             [Activar Disyuntor Lógico]
                        |                                   |
            (Llamada HTTP a la API)                 (0 LLAMADAS HTTP)
                                              Estado: 'dependency_failed'
```

1. **Las dependencias omitidas NO consumen llamadas a la API:**
   - GPT-OSS omitió 4 operaciones por dependencia.
   - Qwen omitió 4 operaciones por dependencia.
   - Gemini omitió 1 operación por dependencia.
   - **Total de operaciones omitidas en el benchmark: 9.**
   - Si se contaran erróneamente como llamadas fallidas a la red, se falsearía la tasa de error HTTP de los proveedores. Forensicamente se ha comprobado en los sockets y logs de eventos que estas 9 operaciones generaron exactamente **0 solicitudes de red**.

2. **Causa de la discrepancia en los contadores consolidados:**
   - La función `consolidarResultadosModelo` almacenaba las operaciones en un mapa indexado por `${modelo}___${caso}___${repeticion}___${operacion}`.
   - Al registrarse un intento exitoso de recuperación, este sobreescribía la entrada del intento previo en el mapa.
   - Como cada operación individual en su intento de recuperación reportaba `numero_solicitudes_http = 1`, la suma del mapa final arrojaba exactamente 100 operaciones = 100 solicitudes (o 102 en Qwen debido a los reintentos intra-operación).
   - **Resolución académica:** En la tesis debe presentarse tanto la tabla de *Operaciones Consolidadas Finales* (100 por modelo) como la tabla de *Telemetría de Red y Esfuerzo Computacional Histórico* (102, 103 y 104 solicitudes).

---

### 4. Auditoría de Tokens y Costos Teóricos

#### 4.1. Política sobre Intentos Fallidos
- En las respuestas con código de error HTTP (como HTTP 400 por JSON malformado o HTTP 429 por límite de tasa), los servidores de Groq y Google **no emiten tokens en las cabeceras ni en el cuerpo JSON**.
- Conforme a los principios de integridad científica: **no se han inventado ni imputado consumos artificiales de tokens para las solicitudes que devolvieron error de transporte o validación de entrada**.
- Los costos teóricos totales presentados en la tabla ($0.067625 USD para Gemini, $0.152978 USD para Qwen y $0.013283 USD para GPT-OSS) corresponden con exactitud a los tokens efectivamente procesados y facturados en las 100 operaciones válidas.
- **Caso excepcional auditado en GPT-OSS Lote 06:** La operación `escena_3` falló por incumplir la opción controlada, pero la respuesta HTTP fue 200 OK (generó 2,296 tokens de entrada y 589 de salida, costo: $0.000349 USD). Este costo fue asumido en la infraestructura pero se excluye de la suma del cuento final consolidado, elevando el costo bruto acumulado a **$0.013632 USD**, una variación menor al 2.6%.

#### 4.2. Análisis Económico Comparativo
- **GPT-OSS 20B es el modelo más económico:**
  - Costo por cuento completo: **$0.000664 USD** (~0.066 centavos de dólar por cuento).
  - Es **5.1 veces más económico que Gemini 3.5 Flash Lite** ($0.003381 USD) y **11.5 veces más económico que Qwen 3.8 27B** ($0.007649 USD).
- **Qwen 3.8 27B presentó el costo más elevado:**
  - Debido a sus tarifas de $0.80 / $4.00 USD por millón y a una mayor verbosidad en el análisis pedagógico y tokens de razonamiento visibles (3,702 tokens).

---

### 5. Análisis de Latencia y Desempeño Operativo

| Métrica | Gemini 3.5 Flash Lite | Qwen 3.8 27B | GPT-OSS 20B |
| :--- | :---: | :---: | :---: |
| **Media** | 3,210.78 ms | 1,380.24 ms | **933.86 ms** |
| **Mediana** | 2,739.00 ms | 1,156.00 ms | **913.50 ms** |
| **Percentil 95 (P95)** | 5,919.00 ms | 2,793.00 ms | **1,238.00 ms** |
| **Mínima** | 1,749.00 ms | 656.00 ms | **607.00 ms** |
| **Máxima** | 6,842.00 ms | 4,210.00 ms | **1,348.00 ms** |

- **Velocidad y consistencia:** GPT-OSS 20B sobre la arquitectura LPU de Groq demostró la menor latencia y la menor dispersión temporal (P95 de apenas 1,238 ms), haciéndolo ideal para interfaces pedagógicas interactivas en tiempo real.
- **Gemini 3.5 Flash Lite** presentó latencias superiores (media de 3.21 s, P95 de 5.92 s), atribuible a las conexiones hacia Google AI Studio y el procesamiento multimodal/thinking interno.

---

### 6. Correspondencia de Identificadores y Nomenclatura

| Nombre en la Tesis / Artículo | Identificador Oficial del Modelo | Proveedor | Modo de Salida Estructurada |
| :--- | :--- | :--- | :--- |
| **Gemini 3.5 Flash Lite** | `gemini-3.5-flash-lite` | Google AI Studio | `responseMimeType: "application/json"` |
| **Qwen 3.8 27B** | `qwen/qwen3.8-27b` | Groq Cloud | `structured_output_mode: "json_schema"` |
| **GPT-OSS 20B** | `openai/gpt-oss-20b` | Groq Cloud | `structured_output_mode: "json_schema"` |

Todos los identificadores configurados en `benchmark/config/modelos.config.json` coinciden plenamente con los catálogos oficiales vigentes de las APIs en octubre de 2026.

---

### 7. Conclusiones de la Auditoría Académica

1. **Validez Experimental Plena:** Los 30 lotes experimentales son completamente válidos, reproducibles y respaldados por registros de eventos inmutables.
2. **Robustez de la Recuperación:** El sistema de recuperación selectiva demostró ser 100% efectivo al reutilizar operaciones previas exitosas y corregir de manera aislada los incidentes en Lotes 05, 06 y 07 de GPT-OSS, Lote 01 de Qwen y Lote 01 de Gemini.
3. **Claridad en los Reportes:** Para la publicación científica, debe explicarse la distinción entre las 300 operaciones válidas consolidadas y las 309 solicitudes HTTP históricas brutas (102 + 103 + 104), justificando con rigor el papel de los disyuntores de dependencia.
