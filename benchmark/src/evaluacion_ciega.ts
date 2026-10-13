import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CasoEstudio, ResultadoOperacion } from './types.js';

export interface LlaveMaestra {
  version: string;
  generadoEl: string;
  descripcion: string;
  mapeoAnonimo: {
    'Modelo A': { proveedor: string; modelo: string };
    'Modelo B': { proveedor: string; modelo: string };
    'Modelo C': { proveedor: string; modelo: string };
  };
  hashSeguridad: string;
}

const RUTA_LLAVE_MAESTRA = path.resolve(process.cwd(), 'benchmark/evaluacion_ciega/llave_maestra.json');

function mezclarArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function obtenerOInicializarLlaveMaestra(esSimulado = false, rutaLlavePersonalizada?: string): LlaveMaestra {
  if (esSimulado) {
    return {
      version: '2.0.0-dry-run',
      generadoEl: new Date().toISOString(),
      descripcion: 'Llave simulada en memoria para dry-run (no persistida en disco)',
      mapeoAnonimo: {
        'Modelo A': { proveedor: 'Google', modelo: 'gemini-3.8-flash' },
        'Modelo B': { proveedor: 'Groq', modelo: 'qwen/qwen3.8-27b' },
        'Modelo C': { proveedor: 'Groq', modelo: 'openai/gpt-oss-20b' },
      },
      hashSeguridad: 'simulada-dry-run-no-guardar',
    };
  }

  const rutaDestino = rutaLlavePersonalizada || RUTA_LLAVE_MAESTRA;
  if (fs.existsSync(rutaDestino)) {
    try {
      const data = JSON.parse(fs.readFileSync(rutaDestino, 'utf-8').replace(/^\uFEFF/, ''));
      return data as LlaveMaestra;
    } catch {
    }
  }

  const candidatos = [
    { proveedor: 'Google', modelo: 'gemini-3.8-flash' },
    { proveedor: 'Groq', modelo: 'qwen/qwen3.8-27b' },
    { proveedor: 'Groq', modelo: 'openai/gpt-oss-20b' },
  ];

  const asignados = mezclarArray(candidatos);

  const mapeoAnonimo: LlaveMaestra['mapeoAnonimo'] = {
    'Modelo A': asignados[0],
    'Modelo B': asignados[1],
    'Modelo C': asignados[2],
  };

  const hashSeguridad = crypto
    .createHash('sha256')
    .update(JSON.stringify(mapeoAnonimo))
    .digest('hex');

  const llave: LlaveMaestra = {
    version: '2.0.0',
    generadoEl: new Date().toISOString(),
    descripcion: 'Llave maestra confidencial y aleatoria para evaluacion ciega de salidas anonimizadas (Cuentos Magicos)',
    mapeoAnonimo,
    hashSeguridad,
  };

  const dir = path.dirname(rutaDestino);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(rutaDestino, JSON.stringify(llave, null, 2), 'utf-8');
  return llave;
}

export function obtenerAliasAnonimo(llave: LlaveMaestra, proveedor: string, modelo: string): string {
  for (const [alias, info] of Object.entries(llave.mapeoAnonimo)) {
    if (
      info.proveedor.toLowerCase() === proveedor.toLowerCase() &&
      info.modelo.toLowerCase() === modelo.toLowerCase()
    ) {
      return alias;
    }
  }
  return 'Modelo Desconocido';
}

export function generarMuestrasAnonimizadas(
  ejecuciones: ResultadoOperacion[],
  carpetaSalida: string,
  casos: CasoEstudio[] = [],
  esSimulado = false
): string {
  const rutaLlaveLocal = path.resolve(carpetaSalida, 'muestras_ciegas', 'llave_maestra.json');
  const llave = obtenerOInicializarLlaveMaestra(esSimulado, rutaLlaveLocal);
  const dirAnonimo = path.resolve(carpetaSalida, 'muestras_ciegas');
  if (!fs.existsSync(dirAnonimo)) {
    fs.mkdirSync(dirAnonimo, { recursive: true });
  }

  const mapaCasos = new Map<string, CasoEstudio>();
  for (const c of casos) {
    mapaCasos.set(c.id, c);
  }

  const grupos: Record<string, ResultadoOperacion[]> = {};
  for (const ej of ejecuciones) {
    const key = ej.caso + '_rep' + ej.repeticion;
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(ej);
  }

  let mdContent = '# Muestras Anonimizadas para Evaluacion Ciega Humana\n\n';
  mdContent += '> Metodologia: Evaluacion ciega de salidas anonimizadas (Modelo A, Modelo B, Modelo C).\n';
  mdContent += '> El evaluador humano no conoce que proveedor o arquitectura genero cada respuesta.\n';
  mdContent += '> Escala de calificacion: 1 a 5 en 5 criterios narrativos.\n';
  mdContent += '> Fecha de generacion: ' + new Date().toISOString() + '\n\n';
  mdContent += '---\n\n';

  for (const [grupoKey, ops] of Object.entries(grupos)) {
    const casoId = ops[0]?.caso || grupoKey.split('_rep')[0];
    const casoData = mapaCasos.get(casoId);

    mdContent += '## Caso: ' + grupoKey + '\n\n';

    if (casoData) {
      mdContent += '### TEXTO FUENTE COMUN (' + casoData.id + ': "' + casoData.titulo + '")\n\n';
      mdContent += '> **Genero:** ' + casoData.genero + ' | **Nivel Educativo:** ' + casoData.nivelEducativo + '\n';
      mdContent += '> **Origen:** ' + casoData.origenTexto + ' (esTextoEmpiricoPdf: ' + casoData.esTextoEmpiricoPdf + ')\n\n';
      mdContent += '`	ext\n' + casoData.textoFuente + '\n`\n\n';
      mdContent += '**Ruta de Decisiones Fijas Seleccionadas:**\n';
      mdContent += '1. ' + casoData.decisionesFijas[0] + '\n';
      mdContent += '2. ' + casoData.decisionesFijas[1] + '\n';
      mdContent += '3. ' + casoData.decisionesFijas[2] + '\n\n';
      mdContent += '---\n\n';
    }

    const aliasSet = new Set<string>();
    for (const op of ops) {
      aliasSet.add(obtenerAliasAnonimo(llave, op.proveedor, op.modelo));
    }

    for (const alias of Array.from(aliasSet).sort()) {
      mdContent += '### ' + alias + '\n\n';
      const opsDelModelo = ops.filter(
        (op) => obtenerAliasAnonimo(llave, op.proveedor, op.modelo) === alias
      );

      for (const op of opsDelModelo) {
        mdContent += '#### Operacion: ' + op.operacion + '\n\n';
        if (op.error) {
          mdContent += '*Error en generacion: ' + op.error + '*\n\n';
        } else if (op.contenido_generado) {
          if (op.operacion === 'analisis') {
            mdContent += '**Analisis Estructural Extraido del Texto Fuente (8 campos):**\n\n';
            mdContent += '- **titulo:** ' + (op.contenido_generado.titulo || 'N/A') + '\n';
            mdContent += '- **tituloOriginal:** ' + (op.contenido_generado.tituloOriginal || 'N/A') + '\n';
            mdContent += '- **protagonista:** ' + (op.contenido_generado.protagonista || 'N/A') + '\n';
            mdContent += '- **descripcionProtagonista:** ' + (op.contenido_generado.descripcionProtagonista || 'N/A') + '\n';
            mdContent += '- **resumen:** ' + (op.contenido_generado.resumen || 'N/A') + '\n';
            mdContent += '- **escenario:** ' + (op.contenido_generado.escenario || 'N/A') + '\n';
            mdContent += '- **conflicto:** ' + (op.contenido_generado.conflicto || 'N/A') + '\n';
            mdContent += '- **finalOriginal:** ' + (op.contenido_generado.finalOriginal || 'N/A') + '\n\n';
          } else {
            mdContent += '**Texto de la Escena:**\n\n';
            mdContent += (op.contenido_generado.contenido || 'N/A') + '\n\n';
            if (op.contenido_generado.opciones && Array.isArray(op.contenido_generado.opciones) && op.contenido_generado.opciones.length > 0) {
              mdContent += '**Opciones de decision ofrecidas:**\n';
              for (let i = 0; i < op.contenido_generado.opciones.length; i++) {
                mdContent += (i + 1) + '. ' + op.contenido_generado.opciones[i] + '\n';
              }
              mdContent += '\n';
            } else {
              mdContent += '*(Escena final de cierre - sin opciones nuevas)*\n\n';
            }
          }
        }
        mdContent += '---\n\n';
      }
    }
  }

  const rutaFinal = path.resolve(dirAnonimo, 'cuentos_anonimizados.md');
  fs.writeFileSync(rutaFinal, mdContent, 'utf-8');
  return rutaFinal;
}
