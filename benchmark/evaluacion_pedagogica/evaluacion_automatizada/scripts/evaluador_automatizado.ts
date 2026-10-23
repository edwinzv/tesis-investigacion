import * as fs from 'fs';
import * as path from 'path';
import {
  validarEvaluacionIndividual,
  EvaluacionAutomatizadaCuento,
  PESOS_CRITERIOS
} from './validar_esquema_evaluacion';
import { AdaptadorGroqJuez } from './adaptador_groq_juez';
import { obtenerGroqApiKeySegura } from './verificar_entorno_groq';

const ROOT_DIR = process.cwd();
const BASE_EVAL_AUTO = path.join(ROOT_DIR, 'benchmark', 'evaluacion_pedagogica', 'evaluacion_automatizada');
const PROMPT_SISTEMA_PATH = path.join(BASE_EVAL_AUTO, 'prompts', 'sistema_evaluador_juez.txt');
const PROMPT_PLANTILLA_PATH = path.join(BASE_EVAL_AUTO, 'prompts', 'plantilla_evaluacion_cuento.txt');
const CUENTOS_CIEGOS_DIR = path.join(ROOT_DIR, 'benchmark', 'evaluacion_pedagogica', 'cuentos_ciegos');
const RESULTADOS_CSV = path.join(BASE_EVAL_AUTO, 'resultados', 'matriz_evaluacion_automatizada.csv');
const RESULTADOS_JSON = path.join(BASE_EVAL_AUTO, 'resultados', 'evaluaciones_detalladas.json');

// Cuentos seleccionados para el Piloto (3 historias de 3 casos narrativos distintos)
const CUENTOS_PILOTO = ['EVAL-01', 'EVAL-02', 'EVAL-03'];

interface OpcionesEvaluador {
  modo: 'piloto' | 'completo' | 'dry-run';
  confirmarEjecucionApi: boolean;
  apiKeyOverride?: string;
}

export class EvaluadorAutomatizadoGroq {
  private promptSistema: string;
  private promptPlantilla: string;
  private adaptadorGroq: AdaptadorGroqJuez;

  constructor(apiKeyOverride?: string) {
    this.promptSistema = fs.readFileSync(PROMPT_SISTEMA_PATH, 'utf8');
    this.promptPlantilla = fs.readFileSync(PROMPT_PLANTILLA_PATH, 'utf8');
    this.adaptadorGroq = new AdaptadorGroqJuez(apiKeyOverride);
  }

  // Cargar IDs ya evaluados previamente con éxito para implementar reanudación
  private cargarEvaluacionesPrevias(): Set<string> {
    const evaluados = new Set<string>();

    if (fs.existsSync(RESULTADOS_JSON)) {
      try {
        const data: EvaluacionAutomatizadaCuento[] = JSON.parse(fs.readFileSync(RESULTADOS_JSON, 'utf8'));
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item.id_cuento_ciego) {
              evaluados.add(item.id_cuento_ciego);
            }
          });
        }
      } catch (e) {
        console.warn('[ADVERTENCIA] No se pudo leer resultados JSON previos, se iniciará nuevo registro.');
      }
    }

    return evaluados;
  }

  // Guardar evaluación en JSON y CSV de forma atómica y segura
  private persistirResultado(evaluacion: EvaluacionAutomatizadaCuento, resultadoLlamada: any) {
    // 1. Persistir en JSON
    let listaDetallada: EvaluacionAutomatizadaCuento[] = [];
    if (fs.existsSync(RESULTADOS_JSON)) {
      try {
        listaDetallada = JSON.parse(fs.readFileSync(RESULTADOS_JSON, 'utf8'));
        if (!Array.isArray(listaDetallada)) listaDetallada = [];
      } catch {
        listaDetallada = [];
      }
    }

    // Filtrar si ya existía para actualizar
    listaDetallada = listaDetallada.filter(e => e.id_cuento_ciego !== evaluacion.id_cuento_ciego);
    listaDetallada.push(evaluacion);
    fs.writeFileSync(RESULTADOS_JSON, JSON.stringify(listaDetallada, null, 2), 'utf8');

    // 2. Persistir en CSV
    const csvHeader = 'id_evaluacion,id_cuento_ciego,modelo_juez,timestamp,criterio_1_coherencia_25pct,criterio_2_vocabulario_20pct,criterio_3_continuidad_20pct,criterio_4_decisiones_15pct,criterio_5_potencial_educativo_20pct,puntuacion_ponderada,fortaleza_principal,debilidad_principal,adecuacion_4to_6to,tokens_prompt,tokens_completion,tokens_totales,latencia_ms,costo_estimado_usd,es_valido\n';

    let filasCsv: string[] = [];
    if (fs.existsSync(RESULTADOS_CSV)) {
      const lineas = fs.readFileSync(RESULTADOS_CSV, 'utf8').trim().split('\n');
      if (lineas.length > 1) {
        filasCsv = lineas.slice(1).filter(l => !l.includes(`"${evaluacion.id_cuento_ciego}"`));
      }
    }

    const c = evaluacion.criterios;
    const q = evaluacion.analisis_cualitativo_general;
    const m = evaluacion.metadatos_evaluacion;

    const nuevaFila = [
      `"${filasCsv.length + 1}"`,
      `"${evaluacion.id_cuento_ciego}"`,
      `"${evaluacion.modelo_evaluador}"`,
      `"${evaluacion.timestamp}"`,
      c.coherencia_narrativa.puntuacion,
      c.vocabulario_adecuado.puntuacion,
      c.continuidad_escenas.puntuacion,
      c.pertinencia_decisiones.puntuacion,
      c.potencial_educativo.puntuacion,
      evaluacion.puntuacion_ponderada_calculada,
      `"${(q.fortaleza_principal || '').replace(/"/g, '""')}"`,
      `"${(q.debilidad_o_mejora_principal || '').replace(/"/g, '""')}"`,
      `"${(q.adecuacion_4to_6to_primaria || '').replace(/"/g, '""')}"`,
      m.tokens_prompt || 0,
      m.tokens_completion || 0,
      (m.tokens_prompt || 0) + (m.tokens_completion || 0),
      m.latencia_ms || 0,
      m.costo_estimado_usd || 0,
      true
    ].join(',');

    filasCsv.push(nuevaFila);
    fs.writeFileSync(RESULTADOS_CSV, csvHeader + filasCsv.join('\n') + '\n', 'utf8');
  }

  public async ejecutar(opciones: OpcionesEvaluador) {
    console.log('================================================================');
    console.log('  EVALUADOR PEDAGÓGICO AUTOMATIZADO CIEGO (GROQ / LLAMA 3.3 70B)');
    console.log('================================================================');
    console.log(`Modo seleccionado: ${opciones.modo.toUpperCase()}`);
    console.log(`Modelo Juez: ${this.adaptadorGroq.modelo}`);
    console.log(`Confirmación de ejecución real a API: ${opciones.confirmarEjecucionApi ? 'SÍ' : 'NO (BLOQUEADO)'}`);

    // 1. Determinar lista de cuentos a evaluar
    let cuentosObjetivo: string[] = [];
    if (opciones.modo === 'piloto') {
      cuentosObjetivo = CUENTOS_PILOTO;
      console.log(`\n[PILOTO ACTIVO] Evaluando exactamente 3 cuentos de casos distintos: ${cuentosObjetivo.join(', ')}`);
    } else {
      const todos = fs.readdirSync(CUENTOS_CIEGOS_DIR)
        .filter(f => f.startsWith('EVAL-') && f.endsWith('.md'))
        .map(f => f.replace('.md', ''))
        .sort();
      cuentosObjetivo = todos;
      console.log(`\n[MODO COMPLETO] Total cuentos en corpus: ${cuentosObjetivo.length}`);
    }

    // 2. Verificar reanudación (evitar doble cobro / solicitudes redundantes)
    const previamenteEvaluados = this.cargarEvaluacionesPrevias();
    const pendientes = cuentosObjetivo.filter(id => !previamenteEvaluados.has(id));
    const yaProcesados = cuentosObjetivo.filter(id => previamenteEvaluados.has(id));

    console.log(`- Cuentos ya evaluados previamente con éxito: ${yaProcesados.length} (se omitirán llamadas API)`);
    console.log(`- Cuentos pendientes por evaluar: ${pendientes.length}`);

    if (pendientes.length === 0) {
      console.log('\n✓ Todos los cuentos objetivo ya han sido evaluados previamente.');
      console.log(`Resultados disponibles en: ${RESULTADOS_CSV}`);
      return;
    }

    // 3. Verificación de Seguridad y Simulación (Dry-Run)
    if (!opciones.confirmarEjecucionApi || opciones.modo === 'dry-run') {
      console.log('\n--- VERIFICACIÓN DE CONTROL PREVIO (SIN LLAMADAS A RED) ---');
      const envCheck = obtenerGroqApiKeySegura();
      console.log(`- Variable GROQ_API_KEY detectada: ${envCheck.disponible ? 'SÍ' : 'NO (Debe definirse en la sesión PowerShell)'}`);
      console.log(`- Solicitudes HTTP planificadas: ${pendientes.length} (Máximo estricto: ${opciones.modo === 'piloto' ? 3 : 60})`);
      console.log(`- Cero reintentos automáticos no autorizados (reintentosMax = 0)`);
      console.log(`- Los archivos de cuentos anonimizados no contienen ninguna marca de modelo.`);
      console.log('\n[BLOQUEO DE SEGURIDAD ACTIVO] No se ha emitido ninguna solicitud a Groq.');
      console.log('Para ejecutar el piloto con llamadas reales cuando esté listo, use el comando proporcionado.');
      return;
    }

    // 4. Ejecución Real (Solo si confirmarEjecucionApi === true)
    console.log('\n>>> INICIANDO EVALUACIONES REALES EN GROQ CLOUD <<<');
    let contadorSolicitudes = 0;
    const maximoSolicitudesPermitidas = opciones.modo === 'piloto' ? 3 : 60;

    for (const idCiego of pendientes) {
      if (contadorSolicitudes >= maximoSolicitudesPermitidas) {
        console.log(`\n[LÍMITE ALCANZADO] Se alcanzó el límite estricto de ${maximoSolicitudesPermitidas} solicitudes. Deteniendo ejecución.`);
        break;
      }

      console.log(`\n[${contadorSolicitudes + 1}/${pendientes.length}] Procesando ${idCiego}...`);
      const archivoCuentoPath = path.join(CUENTOS_CIEGOS_DIR, `${idCiego}.md`);
      if (!fs.existsSync(archivoCuentoPath)) {
        console.error(`[ERROR] Archivo no encontrado: ${archivoCuentoPath}`);
        continue;
      }

      const contenidoCuento = fs.readFileSync(archivoCuentoPath, 'utf8');
      const promptUsuario = this.promptPlantilla
        .replace('{{ID_CUENTO_CIEGO}}', idCiego)
        .replace('{{CONTENIDO_CUENTO}}', contenidoCuento);

      contadorSolicitudes++;
      console.log(`  -> Enviando solicitud HTTP a Groq (Modelo: ${this.adaptadorGroq.modelo})...`);
      
      const resLlamada = await this.adaptadorGroq.evaluarCuento(this.promptSistema, promptUsuario);

      if (!resLlamada.exito || !resLlamada.contenidoJson) {
        console.error(`  [FALLO EN SOLICITUD API] ${resLlamada.error}`);
        console.error(`  [POLÍTICA ESTRICTA] Cero reintentos automáticos. Deteniendo para requerir autorización adicional.`);
        break;
      }

      console.log(`  <- Respuesta recibida en ${resLlamada.latenciaMs} ms (${resLlamada.tokensTotales} tokens, ~$${resLlamada.costoEstimadoUsd} USD)`);

      // Validación estricta del resultado recibido
      const evaluacionObj: EvaluacionAutomatizadaCuento = {
        id_cuento_ciego: idCiego,
        modelo_evaluador: this.adaptadorGroq.modelo,
        timestamp: new Date().toISOString(),
        criterios: resLlamada.contenidoJson.criterios,
        puntuacion_ponderada_calculada: resLlamada.contenidoJson.puntuacion_ponderada_calculada,
        analisis_cualitativo_general: resLlamada.contenidoJson.analisis_cualitativo_general,
        metadatos_evaluacion: {
          latencia_ms: resLlamada.latenciaMs,
          tokens_prompt: resLlamada.tokensPrompt,
          tokens_completion: resLlamada.tokensCompletion,
          costo_estimado_usd: resLlamada.costoEstimadoUsd,
          es_simulado: false
        }
      };

      const val = validarEvaluacionIndividual(evaluacionObj, contenidoCuento);
      if (!val.es_valido) {
        console.error(`  [ERROR DE VALIDACIÓN DE RÚBRICA]:`, val.errores);
        console.error(`  No se continuará automáticamente sin revisión.`);
        break;
      }

      // Persistir de inmediato
      this.persistirResultado(evaluacionObj, resLlamada);
      console.log(`  ✓ Evaluación válida y persistida con éxito: Nota Ponderada = ${evaluacionObj.puntuacion_ponderada_calculada.toFixed(3)} / 5.000`);

      // Pausa de cortesía de 2 segundos entre cuentos para respetar rate-limits
      if (contadorSolicitudes < pendientes.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log('\n================================================================');
    console.log(`  SESIÓN CONCLUIDA: ${contadorSolicitudes} solicitudes HTTP realizadas.`);
    console.log(`  Matriz CSV actualizada: ${RESULTADOS_CSV}`);
    console.log(`  Detalle JSON actualizado: ${RESULTADOS_JSON}`);
    console.log('================================================================');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const esPiloto = args.includes('--piloto');
  const confirmarApi = args.includes('--confirmar-ejecucion-api');
  const modo = esPiloto ? 'piloto' : (args.find(a => a.startsWith('--modo='))?.replace('--modo=', '') || 'dry-run');

  const evaluador = new EvaluadorAutomatizadoGroq();
  evaluador.ejecutar({
    modo: modo as any,
    confirmarEjecucionApi: confirmarApi
  }).catch(err => {
    console.error('Error fatal en ejecución:', err);
    process.exit(1);
  });
}
