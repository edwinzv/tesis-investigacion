export interface CasoEstudio {
  id: string;
  titulo: string;
  genero: string;
  nivelEducativo: string;
  textoFuente: string;
  protagonistaBase: string;
  decisionesFijas: [string, string, string]; // Exactamente 3 decisiones
  origenTexto: string;
  esTextoEmpiricoPdf: boolean;
}

export interface StoryAnalysis {
  titulo: string;
  tituloOriginal: string;
  protagonista: string;
  descripcionProtagonista: string;
  resumen: string;
  escenario: string;
  conflicto: string;
  finalOriginal: string;
}

export interface Escena {
  contenido: string;
  opciones: string[];
  esFinal: boolean;
}

export type EscenaFinal = Escena;

export type CategoriaError =
  | 'none'
  | 'authentication'
  | 'billing'
  | 'rate_limit'
  | 'invalid_request'
  | 'model_not_found'
  | 'network'
  | 'timeout'
  | 'provider_error'
  | 'dependency_failed'
  | 'unknown';

export class ApiCallError extends Error {
  status?: number;
  rawBody?: string;
  latencyMs: number;
  isNonRetryable: boolean;
  categoria: CategoriaError;
  retryAfterMs?: number;

  constructor(params: {
    status?: number;
    message: string;
    rawBody?: string;
    latencyMs: number;
    isNonRetryable: boolean;
    categoria: CategoriaError;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = 'ApiCallError';
    this.status = params.status;
    this.rawBody = params.rawBody;
    this.latencyMs = params.latencyMs;
    this.isNonRetryable = params.isNonRetryable;
    this.categoria = params.categoria;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export interface UsageTokens {
  tokensEntrada: number | null;
  tokensSalida: number | null;
  tokensRazonamiento: number | null;
  tokensSalidaFacturables: number | null;
  tokensTotales: number | null;
  tokensDisponibles: boolean;
  tokensEstimadosLocalmente?: number;
}

export interface RawModelResponse {
  rawText: string;
  status: number;
  latencyMs: number;
  usage: UsageTokens;
  providerRuntime?: string;
  tarifaInputUsdPorMillon?: number | null;
  tarifaOutputUsdPorMillon?: number | null;
  tarifaFuenteRuntime?: string | null;
  structuredOutputMode: 'json_schema' | 'json_object' | 'prompt_only';
  reasoningConfig?: string;
}

export interface ResultadoOperacion {
  id_ejecucion: string;
  proveedor: string;
  modelo: string;
  modelo_runtime: string;
  provider_runtime: string;
  caso: string;
  repeticion: number;
  operacion: string;
  timestamp: string;
  http_status: number | null;
  tiempo_ms: number | null;
  tokens_entrada: number | null;
  tokens_salida: number | null;
  tokens_razonamiento: number | null;
  tokens_salida_facturables: number | null;
  tokens_totales: number | null;
  tokens_disponibles: boolean;
  tokens_estimados_localmente?: number;
  json_valido: boolean;
  estructura_valida: boolean;
  ruta_controlada_valida: boolean | null;
  cumple_primer_intento: boolean;
  numero_reintentos: number;
  numero_solicitudes_http: number;
  error_categoria: string;
  error: string;
  tarifa_input_usd_por_millon: number | null;
  tarifa_output_usd_por_millon: number | null;
  tarifa_fuente_runtime: string | null;
  costo_entrada_usd: number | null;
  costo_salida_usd: number | null;
  costo_teorico_usd: number | null;
  costo_efectivo_experimento_usd: number | null;
  free_tier_activo: boolean;
  reasoning_config: string;
  structured_output_mode: string;
  es_simulado: boolean;
  contenido_generado?: any;
}

export interface ResumenCuento {
  proveedor: string;
  modelo: string;
  caso: string;
  repeticion: number;
  operaciones_totales: number;
  operaciones_exitosas: number;
  tokens_entrada_cuento: number | null;
  tokens_salida_cuento: number | null;
  tokens_razonamiento_cuento: number | null;
  tokens_totales_cuento: number | null;
  tiempo_total_ms: number | null;
  costo_teorico_cuento_usd: number | null;
  costo_efectivo_cuento_usd: number | null;
  errores: number;
  reintentos: number;
  solicitudes_http_totales: number;
  cuento_completo_exitoso: boolean;
  es_simulado: boolean;
}

export interface ResumenModelo {
  proveedor: string;
  modelo: string;
  operaciones_totales: number;
  operaciones_exitosas: number;
  tasa_exito_pct: number;
  json_valido_primer_intento_pct: number;
  estructura_valida_primer_intento_pct: number;
  tokens_entrada_promedio_cuento: number | null;
  tokens_salida_promedio_cuento: number | null;
  tokens_totales_promedio_cuento: number | null;
  latencia_media_ms: number | null;
  latencia_mediana_ms: number | null;
  latencia_p95_ms: number | null;
  reintentos_totales: number;
  solicitudes_http_totales: number;
  costo_teorico_promedio_cuento_usd: number | null;
  costo_teorico_100_cuentos_usd: number | null;
  costo_teorico_1000_cuentos_usd: number | null;
  costo_efectivo_experimento_usd: number | null;
  es_simulado: boolean;
}

export interface ResumenOperacion {
  proveedor: string;
  modelo: string;
  operacion: string;
  operaciones_totales: number;
  operaciones_exitosas: number;
  tasa_exito_pct: number;
  estructura_valida_pct: number;
  tokens_totales_promedio: number | null;
  latencia_media_ms: number | null;
  latencia_mediana_ms: number | null;
  costo_teorico_promedio_usd: number | null;
  reintentos_totales: number;
  solicitudes_http_totales: number;
  es_simulado: boolean;
}

export interface DefinicionLote {
  lote: number;
  casosIds: [string, string];
  repeticion: number;
  operacionesPlanificadas: number;
}

export type EstadoLoteEnum =
  | 'PENDIENTE'
  | 'EN_PROGRESO'
  | 'COMPLETADO'
  | 'INCOMPLETO'
  | 'INTERRUMPIDO'
  | 'FALLO_CUOTA';

export interface EstadoLoteInfo {
  lote: number;
  casos: [string, string];
  repeticion: number;
  estado: EstadoLoteEnum;
  operacionesPlanificadas: number;
  operacionesEjecutadas: number;
  operacionesExitosas: number;
  operacionesFallidas: number;
  operacionesOmitidasPorDependencia: number;
  solicitudesHttpReales: number;
  costoTeoricoTotalUsd: number | null;
  fechaEjecucionUtc?: string;
  carpetaLote: string;
}

export interface EvaluacionPedagogicaItem {
  id_muestra: string;
  id_ejecucion_analisis: string;
  modelo_anonimizado: string;
  caso: string;
  repeticion: number;
  titulo_generado: string;
  historia_completa: string;
  preguntas_u_opciones: string[];
  evaluacion: {
    coherencia_narrativa: number | null;
    claridad_lenguaje: number | null;
    adecuacion_nivel_primaria: number | null;
    riqueza_vocabulario: number | null;
    continuidad_escenas: number | null;
    correspondencia_entrada_estudiante: number | null;
    utilidad_comprension_lectora: number | null;
    estado: 'PENDIENTE_EVALUACION_HUMANA';
    evaluador: string | null;
    observaciones: string | null;
  };
}
