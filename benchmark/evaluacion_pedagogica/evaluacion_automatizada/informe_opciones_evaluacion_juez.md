# INFORME TÉCNICO Y METODOLÓGICO: EVALUACIÓN AUTOMATIZADA (LLM-AS-A-JUDGE)
## Evaluación Exploratoria Narrativa y Pedagógica para 4.°, 5.° y 6.° de Primaria
**Proyecto de Tesis:** Prototipo Interactivo para la Comprensión Lectora Infantil  
**Fecha de Elaboración:** 15 de octubre de 2026  
**Estado:** Preparado y verificado (Llamadas a API bloqueadas a la espera de autorización explícita)

---

### 1. Resumen Ejecutivo

Para complementar la evaluación humana ciega y disponer de una línea base exploratoria sistemática, se ha estructurado un pipeline reproducible de **Evaluación Automatizada Basada en Modelos de Lenguaje (LLM-as-a-Judge)** sobre los 60 cuentos del benchmark.

Se implementaron las siguientes garantías metodológicas y de seguridad:
1. **Integridad del Corpus Anonimizado:** Los 60 cuentos ciegos (`EVAL-01.md` a `EVAL-60.md`) fueron auditados de forma forense; el 100 % cumple con la estructura requerida (análisis narrativo, 4 escenas completas y opciones de decisión) sin ninguna mención de nombres de modelos, proveedores, latencias ni costos.
2. **Adaptación Curricular (4.°, 5.° y 6.° de Primaria):** Se adaptaron los descriptores de la rúbrica al rango de 9 a 12 años, enfatizando la riqueza léxica formativa, la verosimilitud causal, la memoria episódica y los tres niveles de comprensión lectora (literal, inferencial y crítico-reflexivo).
3. **Ceguera Algorítmica Absoluta:** El sistema evaluador automático opera exclusivamente con los archivos anonimizados y desconoce por diseño la correspondencia de la `llave_maestra_ciega.json`.
4. **Validación Automática de Consistencia:** Todo registro pasa por un validador que rechaza puntuaciones fuera de [1.0, 5.0], justificaciones escuetas o vacías, citas textuales ausentes y discrepancias matemáticas en el cálculo ponderado.
5. **Aislamiento Total de Datos:** Los artefactos generados se alojan en `benchmark/evaluacion_pedagogica/evaluacion_automatizada/`, manteniendo intactas las matrices destinadas a los evaluadores humanos.

---

### 2. Auditoría Forense de Integridad de los 60 Cuentos Anonimizados

El script [`verificar_integridad_ciegos.ts`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/evaluacion_automatizada/scripts/verificar_integridad_ciegos.ts) verificó los 60 archivos en [`cuentos_ciegos/`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/cuentos_ciegos/):

| Parámetro Evaluado | Resultado Observado | Estado de Conformidad |
| :--- | :---: | :---: |
| **Archivos verificados** | 60 / 60 archivos (`EVAL-01.md` a `EVAL-60.md`) | 100.0 % Completo |
| **Estructura dramática (4 escenas completas)** | 60 / 60 historias | 100.0 % Válido |
| **Presencia de opciones de ramificación** | 60 / 60 historias | 100.0 % Válido |
| **Presencia de metadatos ciegos (personaje, conflicto)** | 60 / 60 historias | 100.0 % Válido |
| **Ausencia de términos delatores (`gemini`, `qwen`, `openai`, etc.)** | 0 ocurrencias detectadas | 100.0 % Blindado |
| **Extensión media de archivo** | 4,010 bytes / ~656 palabras por archivo | Rango homogéneo |

---

### 3. Ajuste de la Rúbrica para 4.°, 5.° y 6.° de Primaria (9 a 12 años)

La rúbrica actualizada se encuentra formalizada en [`rubrica_evaluacion_pedagogica_4to_6to.md`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/rubrica_evaluacion_pedagogica_4to_6to.md).

#### Principales Ajustes Pedagógicos respecto a la versión de 3.° grado:
1. **Vocabulario Adecuado (20 %):** En 4.° a 6.° grado, el lenguaje excesivamente infantilizado se penaliza (nivel 2); se exige un léxico variado, sinónimos precisos, recursos literarios sencillos (comparaciones, imágenes sensoriales) y vocabulario formativo contextualizado (*caudal, horizonte, engranaje, cooperación*).
2. **Coherencia Narrativa (25 %):** Los lectores de 9 a 12 años rechazan las resoluciones por azar o magia inexplicable (*deus ex machina*); se exige mérito, ingenio y acción causal deliberada del protagonista.
3. **Continuidad entre Escenas (20 %):** Mayor rigor en la memoria episódica; los objetos, descubrimientos y acuerdos de escenas previas deben tener repercusión directa en el clímax y desenlace.
4. **Pertinencia de Decisiones (15 %):** Las 3 alternativas deben representar dilemas estratégicos y éticos reales (no una opción correcta y dos absurdas), estimulando la deliberación y predicción del estudiante.
5. **Potencial Educativo (20 %):** Evaluación explícita de la aptitud del texto para formular preguntas en los tres niveles curriculares: **literal** (datos explícitos), **inferencial** (deducciones causales y estados emocionales) y **crítico-reflexivo** (postura frente al conflicto y valores prosociales).

---

### 4. Opciones de Modelos Juez y Análisis de Conflicto de Interés

En la literatura de procesamiento del lenguaje natural aplicada a evaluación formativa (*LLM-as-a-Judge*), existen sesgos documentados que deben mitigarse:
- **Sesgo de Autorreferencia (*Self-Enhancement Bias*):** Un modelo tiende a calificar con mayores puntajes sus propias generaciones porque reconoce y premia sus patrones léxicos, distribuciones de tokens y estructuras sintácticas familiares (Zheng et al., 2023; Wang et al., 2024).
- **Sesgo de Longitud (*Verbosity Bias*):** Tendencia a calificar mejor respuestas más extensas independientemente de su calidad didáctica.

A continuación se analizan las alternativas evaluadas:

| Opción de Juez | Modelo / Infraestructura | Nivel de Razonamiento | Conflicto de Interés | Idoneidad Metodológica para la Tesis |
| :--- | :--- | :---: | :---: | :--- |
| **Opción 1 (Recomendada)** | **Gemini 2.5 Pro**<br>*(Google AI Studio)* | Muy Alto<br>(Pensamiento complejo y crítica textual) | **Bajo / Neutro** | **Excelente:** Es un modelo de categoría superior (*Frontier Model*) con alta capacidad analítica que no compite en el benchmark de modelos ligeros. |
| **Opción 2** | **Llama 3.3 70B Versatile**<br>*(Groq Cloud)* | Alto<br>(Modelo abierto de 70B) | **Nulo** | **Muy Buena:** Meta Llama es totalmente ajeno a Google y a Qwen, proporcionando un arbitraje neutral en Groq. |
| **Opción 3** | **Gemini 3.8 Flash**<br>*(Google AI Studio)* | Alto<br>(Rápido y económico) | **Bajo** | **Buena:** Muy rápido y de coste casi nulo, aunque con menor profundidad crítica que 2.5 Pro. |
| **Opción 4 (DESACONSEJADA)** | **Uno de los 3 modelos evaluados**<br>*(Gemini 3.5 Lite, Qwen 27B o GPT-OSS)* | Medio / Ligero | **MUY ALTO (Crítico)** | **INADMISIBLE:** Si Gemini 3.5 Flash Lite o Qwen se evalúan a sí mismos, se introduce un sesgo de auto-preferencia invalidante para una tesis académica. |

> **Dictamen Metodológico:** Para la validez de la tesis, **no se debe utilizar ninguno de los tres modelos evaluados como juez**. Se recomienda emplear **Gemini 2.5 Pro** o **Llama 3.3 70B**, o alternativamente una evaluación cruzada entre ambos para medir concordancia inter-modelo.

---

### 5. Estimación de Tokens, Llamadas API y Costos

El pipeline evalúa los 60 cuentos en una sola pasada estructurada por cuento (1 llamada por cuento = 60 llamadas API en total).

#### Desglose de Tokens por Cuento:
- **Tokens de Entrada:** Prompt del sistema (~800 tokens) + Cuento ciego completo (~650 tokens) + Instrucción (~100 tokens) = **~1,550 a 2,120 tokens por cuento** (Media: **2,122 tokens**).
- **Tokens de Salida:** 5 criterios analíticos + 5 citas textuales justificadas + 3 diagnósticos generales en JSON estructurado = **~650 tokens por cuento**.

#### Tabla Comparativa de Costos para los 60 Cuentos:

| Modelo Evaluador | Total Llamadas | Tokens Entrada | Tokens Salida | Tokens Totales | Tarifa Input (USD/M) | Tarifa Output (USD/M) | Costo Total Estimado | Costo por Cuento |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Gemini 2.5 Pro** | 60 | 127,320 | 39,000 | 166,320 | $1.25 | $10.00 | **$0.5492 USD** | $0.00915 USD |
| **Llama 3.3 70B (Groq)** | 60 | 127,320 | 39,000 | 166,320 | $0.59 | $0.79 | **$0.1059 USD** | $0.00177 USD |
| **Gemini 3.8 Flash** | 60 | 127,320 | 39,000 | 166,320 | $0.15 | $0.60 | **$0.0425 USD** | $0.00071 USD |

*Nota sobre Free Tier:* En Google AI Studio y Groq Cloud, estos volúmenes quedan típicamente cubiertos dentro de los límites de cuotas gratuitas diarias (Free Tier), por lo que el costo efectivo real para la investigación podría ser **$0.00 USD**.

---

### 6. Procedimiento para Ejecutar la Evaluación Real (Cuando se Autorice)

El procedimiento está implementado en [`evaluador_automatizado.ts`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/evaluacion_automatizada/scripts/evaluador_automatizado.ts).

Para su ejecución se prevén las siguientes modalidades controladas:

1. **Modo Verificación de Costos (Actual, sin llamadas):**
   ```bash
   npx tsx benchmark/evaluacion_pedagogica/evaluacion_automatizada/scripts/evaluador_automatizado.ts --modo=analisis-costos --modelo=gemini-2.5-pro
   ```

2. **Modo Prueba de Tubería / Simulación Local (Sin llamadas de red):**
   ```bash
   npx tsx benchmark/evaluacion_pedagogica/evaluacion_automatizada/scripts/evaluador_automatizado.ts --modo=simular-pipeline
   ```

3. **Modo Ejecución Real de los 60 Cuentos (Requiere autorización explícita):**
   Una vez aprobada la selección del modelo juez y el presupuesto:
   ```bash
   npx tsx benchmark/evaluacion_pedagogica/evaluacion_automatizada/scripts/evaluador_automatizado.ts --modo=ejecutar-real --modelo=gemini-2.5-pro
   ```
   El script procesará los cuentos en lotes secuenciales con pausas de cortesía (rate-limiting), validará cada JSON retornado con [`validar_esquema_evaluacion.ts`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/evaluacion_automatizada/scripts/validar_esquema_evaluacion.ts) y escribirá automáticamente:
   - Los registros tabulados en [`matriz_evaluacion_automatizada.csv`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/evaluacion_automatizada/resultados/matriz_evaluacion_automatizada.csv).
   - Los informes exhaustivos con citas textuales en [`evaluaciones_detalladas.json`](file:///c:/Users/Ignacia/Documents/ChatGPT/tesis_investigacion/benchmark/evaluacion_pedagogica/evaluacion_automatizada/resultados/evaluaciones_detalladas.json).
