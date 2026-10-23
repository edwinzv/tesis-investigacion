import * as fs from 'fs';
import * as path from 'path';

const PRUEBAS_DIR = path.join(process.cwd(), 'benchmark', 'pruebas_de_modelos');

function inspeccionarLote(relPath: string) {
  const dir = path.join(PRUEBAS_DIR, relPath);
  console.log(`\n================================================================`);
  console.log(`INSPECCIONANDO: ${relPath}`);
  console.log(`================================================================`);

  const eventsPath = path.join(dir, 'events.jsonl');
  if (fs.existsSync(eventsPath)) {
    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split(/\r?\n/);
    console.log(`Total lineas en events.jsonl: ${lines.length}`);
    lines.forEach((l, i) => {
      try {
        const ev = JSON.parse(l);
        if (ev.type === 'operation_result') {
          const r = ev.result;
          console.log(`  [Op ${i+1}] ${r.caso} | rep:${r.repeticion} | op:${r.operacion} | http:${r.http_status} | numHttp:${r.numero_solicitudes_http} | valid:${r.estructura_valida} | 1st:${r.cumple_primer_intento} | errCat:${r.error_categoria} | err:${(r.error||'').slice(0, 50)} | time:${r.tiempo_ms}ms | cost:$${r.costo_teorico_usd}`);
        } else if (ev.type === 'batch_start' || ev.type === 'batch_end' || ev.type === 'error') {
          console.log(`  [Ev ${i+1}] TYPE=${ev.type} | phase=${ev.phase} | error=${ev.error}`);
        }
      } catch (e) {}
    });
  }

  // Backups
  const files = fs.readdirSync(dir);
  const backups = files.filter(f => f.includes('original'));
  if (backups.length > 0) {
    console.log(`\nArchivos de respaldo encontrados:`, backups);
    for (const b of backups) {
      if (b.endsWith('.jsonl')) {
        const bLines = fs.readFileSync(path.join(dir, b), 'utf-8').trim().split(/\r?\n/);
        console.log(`  Respaldo ${b}: ${bLines.length} líneas`);
        bLines.forEach((l, i) => {
          try {
            const ev = JSON.parse(l);
            if (ev.type === 'operation_result') {
              const r = ev.result;
              console.log(`    [Resp ${i+1}] ${r.caso} | rep:${r.repeticion} | op:${r.operacion} | http:${r.http_status} | numHttp:${r.numero_solicitudes_http} | valid:${r.estructura_valida} | 1st:${r.cumple_primer_intento} | errCat:${r.error_categoria}`);
            }
          } catch {}
        });
      }
    }
  }

  const rawPath = path.join(dir, 'ejecuciones_raw.csv');
  if (fs.existsSync(rawPath)) {
    console.log(`\nejecuciones_raw.csv:`);
    const lines = fs.readFileSync(rawPath, 'utf-8').trim().split(/\r?\n/);
    lines.forEach((l, i) => {
      if (i === 0) console.log(`  HDR: ${l}`);
      else console.log(`  ROW: ${l}`);
    });
  }
}

// Inspeccionar los lotes clave
inspeccionarLote('pruebas_de_gemini_3_5_flash_lite/lotes/lote_01');
inspeccionarLote('pruebas_de_qwen_3_8_27b/lotes/lote_01');
inspeccionarLote('pruebas_de_gpt_oss_20b/lotes/lote_05');
inspeccionarLote('pruebas_de_gpt_oss_20b/lotes/lote_06');
inspeccionarLote('pruebas_de_gpt_oss_20b/lotes/lote_07');
