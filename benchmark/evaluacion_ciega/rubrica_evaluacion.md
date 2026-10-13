# Rúbrica de Evaluación Ciega de Salidas Anonimizadas
**Proyecto:** Cuentos Mágicos  
**Propósito:** Selección del componente de generación textual para el prototipo interactivo.

---

## 1. Metodología de Evaluación Ciega
Para evitar sesgos de confirmación respecto a proveedores comerciales y modelos de lenguaje, la evaluación cualitativa de las historias generadas se realiza bajo el protocolo de **evaluación ciega de salidas anonimizadas**.
- Los modelos se identifican exclusivamente como **Modelo A**, **Modelo B** y **Modelo C**.
- La correspondencia real entre alias y arquitectura se conserva de forma confidencial en `llave_maestra.json`, archivo que no debe consultarse hasta haber completado la asignación de puntajes humanos.
- Los evaluadores reciben las salidas completas de cada cuento ordenadas por caso y escena.

---

## 2. Dimensiones y Ponderaciones del Experimento

| Dimensión | Ponderación | Tipo de Evaluación | Instrumento / Métrica |
|---|---|---|---|
| **Estructura Técnica** | 25 % | Automática objetiva | Tasa de validez de esquema al 1.er intento (`estructura_valida_primer_intento_pct`) |
| **Calidad Narrativa** | 25 % | Humana ciega | Rúbrica cualitativa de 5 criterios (Escala 1 a 5) |
| **Adecuación Educativa** | 20 % | Humana ciega | Rúbrica pedagógica de 5 criterios (Escala 1 a 5) |
| **Tiempo (Latencia)** | 20 % | Automática objetiva | Media, Mediana y Percentil 95 (ms) |
| **Costo Económico** | 10 % | Automática objetiva | Costo teórico API y costo efectivo con Free Tier (USD) |

---

## 3. Criterio de Estructura Técnica (25 %)
Se evalúa de manera determinista y estricta en el primer intento (sin considerar respuestas corregidas mediante reintento):

| Cumplimiento al 1.er intento | Puntuación (1 a 5) | Equivalente Ponderado (máx. 25 pts) |
|---|---|---|
| 100 % de operaciones válidas | **5** | 25.0 pts |
| 95.0 % a < 100 % de operaciones | **4** | 20.0 pts |
| 90.0 % a < 95.0 % de operaciones | **3** | 15.0 pts |
| 80.0 % a < 90.0 % de operaciones | **2** | 10.0 pts |
| < 80.0 % de operaciones válidas | **1** | 5.0 pts |

---

## 4. Criterio de Calidad Narrativa (25 %) – Evaluacion Humana Ciega\nCada cuento completo se califica de **1 a 5** promediando exactamente los siguientes 5 descriptores:\n\n1. **Fidelidad del analisis inicial al texto fuente:** Precision y fidelidad del analisis estructural extraido frente a la lectura fuente comun (protagonista, escenario, conflicto, resumen y final original explicitamente deducible).\n2. **Coherencia y continuidad de la historia generada:** Las escenas mantienen el hilo argumental, la progresion dramatica logica y la memoria de eventos previos.\n3. **Respeto a las decisiones seleccionadas por el estudiante:** La escena subsiguiente refleja directamente la opcion elegida previamente en la ruta controlada.\n4. **Consistencia del protagonista/escenario y ausencia de contradicciones:** El personaje y su entorno conservan sus atributos y motivaciones sin saltos ilogicos ni incoherencias espacio-temporales.\n5. **Calidad y coherencia del cierre final:** El desenlace de la Escena 4 concluye satisfactoriamente la trama, resolviendo el conflicto planteado y brindando un mensaje de cierre reflexivo y constructivo.\n\n---\n\n## 5. Criterio de Adecuación Educativa (20 %) — Evaluación Humana
Cada cuento completo se califica de **1 a 5** promediando los siguientes 5 descriptores:

1. **Vocabulario apropiado (8 a 10 años):** Lenguaje accesible, rico pero comprensible para nivel de educación primaria.
2. **Claridad expositiva:** Oraciones bien construidas, sintaxis fluida y párrafos bien cohesionados.
3. **Longitud adecuada:** Extensión equilibrada (70 a 130 palabras por escena) que previene la fatiga lectora.
4. **Seguridad infantil y tono constructivo:** Ausencia total de violencia explícita, mensajes dañinos o situaciones de angustia no resueltas.
5. **Alternativas comprensibles y atractivas:** Las 3 opciones ofrecidas en cada escena intermedia son claras, distintas y despiertan curiosidad formativa.

---

## 6. Criterio de Tiempo / Latencia (20 %)
- Se registran la media, mediana y P95 en milisegundos para cada modelo.
- Se documenta que la latencia representa la cadena completa de inferencia:
  $$\text{Latencia} = \text{Modelo} + \text{Infraestructura Proveedor} + \text{Routing} + \text{Carga de Red}$$
- La escala 1 a 5 se normaliza formalmente una vez consolidados los resultados empíricos reales para no imponer umbrales artificiales a priori.

---

## 7. Criterio de Costo Económico (10 %)
- Se diferencian rigurosamente:
  - **Costo Teórico Recurrente:** Gasto calculado según la tarifa oficial publicada por millón de tokens de entrada y salida. Es la métrica base para la sostenibilidad a largo plazo.
  - **Costo Efectivo del Experimento:** Monto real facturado al investigador (US$ 0.00 cuando queda cubierto por planes gratuitos o créditos promocionales).
- La normalización formal se aplica tras contrastar las tarifas empíricas observadas.

---

## 8. Fórmula de Consolidación Final
$$\text{TOTAL (sobre 100)} = \left(\frac{\text{Estructura}}{5} \times 25\right) + \left(\frac{\text{Narrativa}}{5} \times 25\right) + \left(\frac{\text{Adecuación}}{5} \times 20\right) + \left(\frac{\text{Tiempo}}{5} \times 20\right) + \left(\frac{\text{Costo}}{5} \times 10\right)$$
