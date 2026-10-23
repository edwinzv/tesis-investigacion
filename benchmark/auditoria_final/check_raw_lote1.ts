import * as fs from 'fs';
import * as path from 'path';

function checkRaw(subpath: string) {
  const p = path.join(process.cwd(), 'benchmark', 'pruebas_de_modelos', subpath);
  console.log(`\n=== RAW CSV: ${subpath} ===`);
  const lines = fs.readFileSync(p, 'utf-8').trim().split(/\r?\n/);
  const hdr = lines[0].split(',').map(h => h.replace(/"/g, ''));
  lines.slice(1).forEach((l, idx) => {
    const cols = l.split(',').map(c => c.replace(/"/g, ''));
    const op = cols[hdr.indexOf('operacion')];
    const caso = cols[hdr.indexOf('caso')];
    const primer = cols[hdr.indexOf('cumple_primer_intento')];
    const http = cols[hdr.indexOf('http_status')];
    const numHttp = cols[hdr.indexOf('numero_solicitudes_http')];
    const errCat = cols[hdr.indexOf('error_categoria')];
    console.log(`Row ${idx+1}: ${caso} | op:${op} | 1st:${primer} | http:${http} (num:${numHttp}) | errCat:${errCat}`);
  });
}

checkRaw('pruebas_de_gemini_3_5_flash_lite/lotes/lote_01/ejecuciones_raw.csv');
checkRaw('pruebas_de_qwen_3_8_27b/lotes/lote_01/ejecuciones_raw.csv');
