import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  consolidarResultadosModelo,
  reconstruirYExportarCuentos,
} from '../benchmark/src/pruebas_modelos.js';
import { cargarOperacionesPrevias } from '../benchmark/src/lotes.js';

function sha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  const rootDir = process.cwd();
  const dirLote3 = path.resolve(rootDir, 'benchmark/pruebas_de_modelos/pruebas_de_gpt_oss_20b/lotes/lote_03');
  const dirCuentos = path.resolve(rootDir, 'benchmark/pruebas_de_modelos/pruebas_de_gpt_oss_20b/cuentos_generados');

  if (!fs.existsSync(dirLote3)) {
    throw new Error(`Directorio Lote 3 no encontrado: ${dirLote3}`);
  }

  console.log('========================================================================');
  console.log('AUDITORÍA Y CORRECCIÓN DE METADATOS DE REPETICIÓN — LOTE 3 GPT-OSS 20B');
  console.log('========================================================================\n');

  // 1. Respaldar archivos originales antes de cualquier cambio
  const archivosARespaldar = [
    'events.jsonl',
    'ejecuciones_raw.csv',
    'manifest.json',
    'resumen_cuentos.csv',
    'resumen_operaciones.csv',
  ];

  const hashesOriginales: Record<string, string> = {};
  for (const f of archivosARespaldar) {
    const full = path.join(dirLote3, f);
    if (fs.existsSync(full)) {
      hashesOriginales[f] = sha256(full);
      const backupPath = path.join(dirLote3, `${f}.original`);
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(full, backupPath);
        console.log(`[RESPALDO CREADO] ${f} -> ${path.basename(backupPath)} (SHA-256: ${hashesOriginales[f]})`);
      } else {
        console.log(`[RESPALDO EXISTENTE] ${path.basename(backupPath)} conservado.`);
      }
    }
  }

  // 2. Corregir events.jsonl
  const rutaEvents = path.join(dirLote3, 'events.jsonl');
  const lineasEvents = fs.readFileSync(rutaEvents, 'utf-8').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const nuevasLineasEvents: string[] = [];

  for (const l of lineasEvents) {
    const ev = JSON.parse(l);
    if (ev.id && typeof ev.id === 'string') {
      ev.id = ev.id.replace(/_rep1_/, '_rep2_');
    }
    if (ev.result) {
      if (ev.result.id_ejecucion && typeof ev.result.id_ejecucion === 'string') {
        ev.result.id_ejecucion = ev.result.id_ejecucion.replace(/_rep1_/, '_rep2_');
      }
      if (ev.result.repeticion === 1) {
        ev.result.repeticion = 2;
      }
    }
    nuevasLineasEvents.push(JSON.stringify(ev));
  }
  fs.writeFileSync(rutaEvents, nuevasLineasEvents.join('\n') + '\n', 'utf-8');
  console.log(`\n[CORREGIDO] events.jsonl: ${nuevasLineasEvents.length} eventos actualizados con repeticion = 2 e IDs actualizados.`);

  // 3. Corregir ejecuciones_raw.csv
  const rutaCsv = path.join(dirLote3, 'ejecuciones_raw.csv');
  const lineasCsv = fs.readFileSync(rutaCsv, 'utf-8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = lineasCsv[0];
  const colIndices = header.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const idxId = colIndices.indexOf('id_ejecucion');
  const idxRep = colIndices.indexOf('repeticion');

  const nuevasLineasCsv: string[] = [header];
  for (let i = 1; i < lineasCsv.length; i++) {
    const cols = lineasCsv[i].split(',');
    if (idxId !== -1 && cols[idxId]) {
      cols[idxId] = cols[idxId].replace(/_rep1_/, '_rep2_');
    }
    if (idxRep !== -1) {
      cols[idxRep] = '2';
    }
    nuevasLineasCsv.push(cols.join(','));
  }
  fs.writeFileSync(rutaCsv, nuevasLineasCsv.join('\n') + '\n', 'utf-8');
  console.log(`[CORREGIDO] ejecuciones_raw.csv: 10 filas de operaciones actualizadas con repeticion = 2.`);

  // 4. Corregir resumen_cuentos.csv
  const rutaResumenCuentos = path.join(dirLote3, 'resumen_cuentos.csv');
  if (fs.existsSync(rutaResumenCuentos)) {
    const linesCuentos = fs.readFileSync(rutaResumenCuentos, 'utf-8').trim().split(/\r?\n/);
    const headerCuentos = linesCuentos[0];
    const colsH = headerCuentos.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
    const idxRepC = colsH.indexOf('repeticion');
    const nuevasLinesCuentos: string[] = [headerCuentos];
    for (let i = 1; i < linesCuentos.length; i++) {
      const cols = linesCuentos[i].split(',');
      if (idxRepC !== -1) {
        cols[idxRepC] = '2';
      }
      nuevasLinesCuentos.push(cols.join(','));
    }
    fs.writeFileSync(rutaResumenCuentos, nuevasLinesCuentos.join('\n') + '\n', 'utf-8');
    console.log(`[CORREGIDO] resumen_cuentos.csv: Casos actualizados a repeticion = 2.`);
  }

  // 5. Corregir manifest.json
  const rutaManifest = path.join(dirLote3, 'manifest.json');
  const manifestData = JSON.parse(fs.readFileSync(rutaManifest, 'utf-8'));
  manifestData.repeticion = 2;
  manifestData.auditoriaCorreccionMetadata = {
    fechaCorreccionUtc: new Date().toISOString(),
    motivo:
      'Corrección de metadatos de repetición experimental: El Lote 3 corresponde según el diseño a la repetición 2 de los casos 1 y 2. Las operaciones ejecutadas son auténticas, realizadas entre 00:09:37 y 00:12:17 UTC del 2026-10-15, e independientes de la repetición 1 (Lote 1). Se preservaron intactos los archivos originales con extensión .original y se actualizaron id_ejecucion y repeticion.',
    archivosOriginalesSha256: hashesOriginales,
    archivosRespaldo: {
      events: 'events.jsonl.original',
      ejecucionesCsv: 'ejecuciones_raw.csv.original',
      manifest: 'manifest.json.original',
    },
  };
  fs.writeFileSync(rutaManifest, JSON.stringify(manifestData, null, 2), 'utf-8');
  console.log(`[CORREGIDO] manifest.json: Registrada repeticion = 2 y bloque de auditoría formal.`);

  // 6. Hashes corregidos y registro de auditoría independiente
  const hashesCorregidos: Record<string, string> = {};
  for (const f of archivosARespaldar) {
    const full = path.join(dirLote3, f);
    if (fs.existsSync(full)) {
      hashesCorregidos[f] = sha256(full);
    }
  }

  const registroAuditoria = {
    lote: 3,
    modelo: 'openai/gpt-oss-20b',
    fechaCorreccionUtc: new Date().toISOString(),
    motivo:
      'Corrección de metadatos de repetición experimental: Lote 3 ejecutó 10 operaciones auténticas en Groq correspondientes a la repetición 2 de casos 1 y 2, pero fueron registradas con repeticion = 1 debido a un desacoplamiento entre el conteo y el índice experimental en runner.ts.',
    cambiosAplicados: {
      campoRepeticionAnterior: 1,
      campoRepeticionNuevo: 2,
      patronIdEjecucionAnterior: '_rep1_',
      patronIdEjecucionNuevo: '_rep2_',
    },
    hashesOriginalesSha256: hashesOriginales,
    hashesCorregidosSha256: hashesCorregidos,
  };

  const rutaAuditoriaDoc = path.join(dirLote3, 'AUDITORIA_CORRECCION_REPETICION_LOTE_03.json');
  fs.writeFileSync(rutaAuditoriaDoc, JSON.stringify(registroAuditoria, null, 2), 'utf-8');
  console.log(`[REGISTRO CREADO] ${path.basename(rutaAuditoriaDoc)} con trazabilidad completa.`);

  // 7. Reconstruir cuentos pedagógicos de Lote 1, Lote 2 y Lote 3
  console.log('\n========================================================================');
  console.log('RECONSTRUYENDO CUENTOS PEDAGÓGICOS (LOTES 1, 2 Y 3)');
  console.log('========================================================================');
  const dirLotesGpt = path.resolve(rootDir, 'benchmark/pruebas_de_modelos/pruebas_de_gpt_oss_20b/lotes');
  const todasOps: any[] = [];

  for (const lNum of [1, 2, 3]) {
    const pad = String(lNum).padStart(2, '0');
    const pLote = path.join(dirLotesGpt, `lote_${pad}`);
    if (fs.existsSync(pLote)) {
      const { operacionesMap } = cargarOperacionesPrevias(pLote, true);
      for (const op of operacionesMap.values()) {
        todasOps.push(op);
      }
    }
  }

  const cuentosExportados = reconstruirYExportarCuentos(todasOps, dirCuentos);
  console.log(`[CUENTOS EXPORTADOS] Total cuentos completos reconstruidos: ${cuentosExportados}`);

  // 8. Re-consolidar métricas a nivel de modelo para GPT-OSS
  console.log('\n========================================================================');
  console.log('RE-CONSOLIDANDO MÉTRICAS DE GPT-OSS 20B');
  console.log('========================================================================');
  const resConsol = consolidarResultadosModelo('openai/gpt-oss-20b', rootDir);
  console.log(`[CONSOLIDACIÓN COMPLETADA]`);
  console.log(`- Operaciones ejecutadas: ${resConsol.totalEjecutadas}`);
  console.log(`- Operaciones exitosas:   ${resConsol.totalExitosas}`);
  console.log(`- Solicitudes HTTP:       ${resConsol.totalSolicitudesHttp}`);
  console.log(`- Costo teórico total:    $${resConsol.costoTeoricoTotalUsd?.toFixed(6)} USD`);
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
