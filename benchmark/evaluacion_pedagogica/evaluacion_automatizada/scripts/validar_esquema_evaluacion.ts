export interface EvaluacionCriterio {
  puntuacion: number;
  justificacion: string;
  cita_textual_evidencia: string;
}

export interface EvaluacionAutomatizadaCuento {
  id_cuento_ciego: string;
  modelo_evaluador: string;
  timestamp: string;
  criterios: {
    coherencia_narrativa: EvaluacionCriterio;
    vocabulario_adecuado: EvaluacionCriterio;
    continuidad_escenas: EvaluacionCriterio;
    pertinencia_decisiones: EvaluacionCriterio;
    potencial_educativo: EvaluacionCriterio;
  };
  puntuacion_ponderada_calculada: number;
  analisis_cualitativo_general: {
    fortaleza_principal: string;
    debilidad_o_mejora_principal: string;
    adecuacion_4to_6to_primaria: string;
  };
  metadatos_evaluacion: {
    latencia_ms?: number;
    tokens_prompt?: number;
    tokens_completion?: number;
    costo_estimado_usd?: number;
    es_simulado: boolean;
  };
}

export interface ResultadoValidacion {
  es_valido: boolean;
  errores: string[];
  advertencias: string[];
  detallesCalculo?: {
    c1: number;
    c2: number;
    c3: number;
    c4: number;
    c5: number;
    ponderado_esperado: number;
    ponderado_reportado: number;
  };
}

export const PESOS_CRITERIOS = {
  coherencia_narrativa: 0.25,
  vocabulario_adecuado: 0.20,
  continuidad_escenas: 0.20,
  pertinencia_decisiones: 0.15,
  potencial_educativo: 0.20
};

export function validarEvaluacionIndividual(
  evaluacion: any,
  textoCuentoOriginal?: string
): ResultadoValidacion {
  const errores: string[] = [];
  const advertencias: string[] = [];

  if (!evaluacion || typeof evaluacion !== 'object') {
    return {
      es_valido: false,
      errores: ['La evaluación es nula o no es un objeto JSON válido.'],
      advertencias
    };
  }

  // 1. Validar ID Ciego
  if (!evaluacion.id_cuento_ciego || !/^EVAL-\d{2}$/.test(evaluacion.id_cuento_ciego)) {
    errores.push(`ID de cuento inválido o ausente: "${evaluacion.id_cuento_ciego}". Debe coincidir con formato EVAL-XX.`);
  }

  // 2. Validar Criterios
  if (!evaluacion.criterios || typeof evaluacion.criterios !== 'object') {
    errores.push('El objeto "criterios" está ausente o no es un objeto válido.');
    return { es_valido: false, errores, advertencias };
  }

  const clavesRequeridas: (keyof typeof PESOS_CRITERIOS)[] = [
    'coherencia_narrativa',
    'vocabulario_adecuado',
    'continuidad_escenas',
    'pertinencia_decisiones',
    'potencial_educativo'
  ];

  let sumaPonderadaEsperada = 0;

  for (const clave of clavesRequeridas) {
    const crit = evaluacion.criterios[clave];
    if (!crit || typeof crit !== 'object') {
      errores.push(`Falta el criterio requerido: "${clave}".`);
      continue;
    }

    // Puntuación en rango 1.0 a 5.0
    if (typeof crit.puntuacion !== 'number' || isNaN(crit.puntuacion)) {
      errores.push(`Puntuación no numérica en "${clave}": ${crit.puntuacion}`);
    } else if (crit.puntuacion < 1.0 || crit.puntuacion > 5.0) {
      errores.push(`Puntuación fuera de rango en "${clave}": ${crit.puntuacion}. Debe ser entre 1.0 y 5.0.`);
    } else {
      sumaPonderadaEsperada += crit.puntuacion * PESOS_CRITERIOS[clave];
    }

    // Justificación textual
    if (!crit.justificacion || typeof crit.justificacion !== 'string') {
      errores.push(`Justificación vacía o ausente en "${clave}".`);
    } else if (crit.justificacion.trim().length < 25) {
      errores.push(`Justificación demasiado escueta en "${clave}" (${crit.justificacion.trim().length} caracteres). Se requiere mínimo 25 caracteres fundamentados.`);
    }

    // Cita textual de evidencia
    if (!crit.cita_textual_evidencia || typeof crit.cita_textual_evidencia !== 'string') {
      errores.push(`Cita textual de evidencia ausente en "${clave}".`);
    } else if (crit.cita_textual_evidencia.trim().length < 10) {
      errores.push(`Cita textual demasiado corta en "${clave}". Debe contener un fragmento observable.`);
    } else if (textoCuentoOriginal) {
      // Comprobar que la cita exista en el cuento (o palabras clave significativas de ella)
      const citaLimpia = crit.cita_textual_evidencia.replace(/["'«»]/g, '').trim().toLowerCase();
      const palabrasClave = citaLimpia.split(/\s+/).filter((w: string) => w.length > 4);
      const coincide = palabrasClave.some((w: string) => textoCuentoOriginal.toLowerCase().includes(w));
      if (!coincide && palabrasClave.length > 0) {
        advertencias.push(`La cita textual en "${clave}" parece no encontrarse literalmente en el cuento evaluado.`);
      }
    }
  }

  // 3. Validar Puntuación Ponderada
  const ponderadaReportada = evaluacion.puntuacion_ponderada_calculada;
  sumaPonderadaEsperada = Math.round(sumaPonderadaEsperada * 100) / 100;

  if (typeof ponderadaReportada !== 'number' || isNaN(ponderadaReportada)) {
    errores.push('La puntuación ponderada calculada está ausente o no es un número.');
  } else {
    const diferencia = Math.abs(ponderadaReportada - sumaPonderadaEsperada);
    if (diferencia > 0.05) {
      errores.push(`Discrepancia en puntuación ponderada: reportada=${ponderadaReportada}, esperada=${sumaPonderadaEsperada} (dif=${diferencia.toFixed(3)}).`);
    }
  }

  // 4. Validar Análisis Cualitativo General
  if (!evaluacion.analisis_cualitativo_general || typeof evaluacion.analisis_cualitativo_general !== 'object') {
    errores.push('Falta el objeto "analisis_cualitativo_general".');
  } else {
    const q = evaluacion.analisis_cualitativo_general;
    if (!q.fortaleza_principal || q.fortaleza_principal.trim().length < 15) {
      errores.push('La fortaleza principal está ausente o es muy corta.');
    }
    if (!q.debilidad_o_mejora_principal || q.debilidad_o_mejora_principal.trim().length < 15) {
      errores.push('La debilidad o mejora principal está ausente o es muy corta.');
    }
    if (!q.adecuacion_4to_6to_primaria || q.adecuacion_4to_6to_primaria.trim().length < 15) {
      errores.push('El diagnóstico de adecuación a 4to-6to de primaria está ausente o es muy corto.');
    }
  }

  return {
    es_valido: errores.length === 0,
    errores,
    advertencias,
    detallesCalculo: {
      c1: evaluacion.criterios?.coherencia_narrativa?.puntuacion,
      c2: evaluacion.criterios?.vocabulario_adecuado?.puntuacion,
      c3: evaluacion.criterios?.continuidad_escenas?.puntuacion,
      c4: evaluacion.criterios?.pertinencia_decisiones?.puntuacion,
      c5: evaluacion.criterios?.potencial_educativo?.puntuacion,
      ponderado_esperado: sumaPonderadaEsperada,
      ponderado_reportado: ponderadaReportada
    }
  };
}
