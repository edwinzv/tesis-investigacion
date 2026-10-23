import * as fs from 'fs';
import * as path from 'path';

const PRUEBAS_DIR = path.join(process.cwd(), 'benchmark', 'pruebas_de_modelos');

function mostrarDetalle(rel: string) {
  const p = path.join(PRUEBAS_DIR, rel, 'events.jsonl');
  console.log(`\n=== ${rel} ===`);
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf-8').trim().split(/\r?\n/);
  lines.forEach((l, idx) => {
    try {
      const e = JSON.parse(l);
      if (e.type === 'operation_result') {
        const r = e.result;
        console.log(`[${idx+1}] ${r.caso} rep:${r.repeticion} op:${r.operacion} | HTTP:${r.http_status} (num:${r.numero_solicitudes_http}) | val:${r.estructura_valida} 1st:${r.cumple_primer_intento} | errCat:${r.error_categoria} | tokensIn:${r.tokens_entrada} out:${r.tokens_salida} | cost:$${r.costo_teorico_usd}`);
      }
    } catch {}
  });
}

mostrarDetalle('pruebas_de_gemini_3_5_flash_lite/lotes/lote_01');
mostrarDetalle('pruebas_de_qwen_3_8_27b/lotes/lote_01');
mostrarDetalle('pruebas_de_gpt_oss_20b/lotes/lote_05');
mostrarDetalle('pruebas_de_gpt_oss_20b/lotes/lote_06');
