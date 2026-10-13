import * as fs from "fs";
import * as path from "path";
import {
  ResultadoOperacion,
  ResumenCuento,
  ResumenModelo,
  ResumenOperacion,
} from "./types.js";

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatNumCsv(val: number | null | undefined, decimals: number = 6): string {
  if (val === null || val === undefined) return "";
  return val.toFixed(decimals);
}

export function calcularMediana(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 !== 0) {
    return sorted[Math.floor(n / 2)];
  }
  return Math.round(((sorted[n / 2 - 1] + sorted[n / 2]) / 2) * 100) / 100;
}

export function calcularP95(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1));
  return sorted[idx];
}

export function exportarEjecucionesCsv(
  ejecuciones: ResultadoOperacion[],
  carpetaSalida: string
): string {
  const headers = [
    "id_ejecucion",
    "proveedor",
    "modelo",
    "modelo_runtime",
    "provider_runtime",
    "caso",
    "repeticion",
    "operacion",
    "timestamp",
    "http_status",
    "tiempo_ms",
    "tokens_entrada",
    "tokens_salida",
    "tokens_salida_facturables",
    "tokens_razonamiento",
    "tokens_totales",
    "tokens_disponibles",
    "json_valido",
    "estructura_valida",
    "ruta_controlada_valida",
    "cumple_primer_intento",
    "numero_reintentos",
    "numero_solicitudes_http",
    "error_categoria",
    "error",
    "tarifa_input_usd_por_millon",
    "tarifa_output_usd_por_millon",
    "tarifa_fuente_runtime",
    "costo_entrada_usd",
    "costo_salida_usd",
    "costo_teorico_usd",
    "costo_efectivo_experimento_usd",
    "free_tier_activo",
    "reasoning_config",
    "structured_output_mode",
    "es_simulado",
  ];

  const rows = [headers.join(",")];

  for (const ej of ejecuciones) {
    const row = [
      escapeCsv(ej.id_ejecucion),
      escapeCsv(ej.proveedor),
      escapeCsv(ej.modelo),
      escapeCsv(ej.modelo_runtime),
      escapeCsv(ej.provider_runtime),
      escapeCsv(ej.caso),
      escapeCsv(ej.repeticion),
      escapeCsv(ej.operacion),
      escapeCsv(ej.timestamp),
      escapeCsv(ej.http_status !== null ? ej.http_status : ""),
      escapeCsv(ej.tiempo_ms !== null ? ej.tiempo_ms : ""),
      escapeCsv(ej.tokens_entrada !== null ? ej.tokens_entrada : ""),
      escapeCsv(ej.tokens_salida !== null ? ej.tokens_salida : ""),
      escapeCsv(ej.tokens_salida_facturables !== null ? ej.tokens_salida_facturables : ""),
      escapeCsv(ej.tokens_razonamiento !== null ? ej.tokens_razonamiento : ""),
      escapeCsv(ej.tokens_totales !== null ? ej.tokens_totales : ""),
      escapeCsv(ej.tokens_disponibles),
      escapeCsv(ej.json_valido),
      escapeCsv(ej.estructura_valida),
      escapeCsv(ej.ruta_controlada_valida !== null ? ej.ruta_controlada_valida : "N/A"),
      escapeCsv(ej.cumple_primer_intento),
      escapeCsv(ej.numero_reintentos),
      escapeCsv(ej.numero_solicitudes_http),
      escapeCsv(ej.error_categoria),
      escapeCsv(ej.error),
      escapeCsv(ej.tarifa_input_usd_por_millon !== null ? ej.tarifa_input_usd_por_millon : ""),
      escapeCsv(ej.tarifa_output_usd_por_millon !== null ? ej.tarifa_output_usd_por_millon : ""),
      escapeCsv(ej.tarifa_fuente_runtime),
      escapeCsv(formatNumCsv(ej.costo_entrada_usd, 6)),
      escapeCsv(formatNumCsv(ej.costo_salida_usd, 6)),
      escapeCsv(formatNumCsv(ej.costo_teorico_usd, 6)),
      escapeCsv(formatNumCsv(ej.costo_efectivo_experimento_usd, 6)),
      escapeCsv(ej.free_tier_activo),
      escapeCsv(ej.reasoning_config),
      escapeCsv(ej.structured_output_mode),
      escapeCsv(ej.es_simulado),
    ];
    rows.push(row.join(","));
  }

  const filePath = path.resolve(carpetaSalida, "ejecuciones_raw.csv");
  fs.writeFileSync(filePath, rows.join("\n"), "utf-8");
  return filePath;
}

export function consolidarResumenCuentos(
  ejecuciones: ResultadoOperacion[],
  carpetaSalida: string
): string {
  const grupos = new Map<string, ResultadoOperacion[]>();
  for (const ej of ejecuciones) {
    const key = [ej.proveedor, ej.modelo, ej.caso, String(ej.repeticion)].join('___');
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(ej);
  }

  const resCuentos: ResumenCuento[] = [];
  for (const [key, ops] of grupos.entries()) {
    const [proveedor, modelo, caso, repStr] = key.split("___");
    const repeticion = parseInt(repStr, 10);
    const operaciones_totales = ops.length;
    const operaciones_exitosas = ops.filter((o) => o.estructura_valida).length;
    const es_simulado = ops.some((o) => o.es_simulado);

    let tokens_entrada_cuento: number | null = 0;
    let tokens_salida_cuento: number | null = 0;
    let tokens_razonamiento_cuento: number | null = 0;
    let tokens_totales_cuento: number | null = 0;

    for (const o of ops) {
      if (o.tokens_entrada !== null && tokens_entrada_cuento !== null) tokens_entrada_cuento += o.tokens_entrada;
      else tokens_entrada_cuento = null;
      if (o.tokens_salida !== null && tokens_salida_cuento !== null) tokens_salida_cuento += o.tokens_salida;
      else tokens_salida_cuento = null;
      if (o.tokens_razonamiento !== null && tokens_razonamiento_cuento !== null) tokens_razonamiento_cuento += o.tokens_razonamiento;
      else if (o.tokens_razonamiento === null && tokens_razonamiento_cuento === 0) tokens_razonamiento_cuento = null;
      if (o.tokens_totales !== null && tokens_totales_cuento !== null) tokens_totales_cuento += o.tokens_totales;
      else tokens_totales_cuento = null;
    }

    const algunTiempoNull = ops.some((o) => o.tiempo_ms === null);
    const tiempo_total_ms = algunTiempoNull ? null : ops.reduce((acc, o) => acc + (o.tiempo_ms || 0), 0);
    const algunCostoTeoricoNull = ops.some((o) => o.costo_teorico_usd === null);
    const costo_teorico_cuento_usd = algunCostoTeoricoNull ? null : ops.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);
    const algunCostoEfectivoNull = ops.some((o) => o.costo_efectivo_experimento_usd === null);
    const costo_efectivo_cuento_usd = algunCostoEfectivoNull ? null : ops.reduce((acc, o) => acc + (o.costo_efectivo_experimento_usd || 0), 0);

    const errores = ops.filter((o) => !o.estructura_valida).length;
    const reintentos = ops.reduce((acc, o) => acc + o.numero_reintentos, 0);
    const solicitudes_http_totales = ops.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);
    const cuento_completo_exitoso = operaciones_totales === 5 && operaciones_exitosas === 5;

    resCuentos.push({
      proveedor,
      modelo,
      caso,
      repeticion,
      operaciones_totales,
      operaciones_exitosas,
      tokens_entrada_cuento,
      tokens_salida_cuento,
      tokens_razonamiento_cuento,
      tokens_totales_cuento,
      tiempo_total_ms,
      costo_teorico_cuento_usd,
      costo_efectivo_cuento_usd,
      errores,
      reintentos,
      solicitudes_http_totales,
      cuento_completo_exitoso,
      es_simulado,
    });
  }

  const headers = [
    "proveedor",
    "modelo",
    "caso",
    "repeticion",
    "operaciones_totales",
    "operaciones_exitosas",
    "tokens_entrada_cuento",
    "tokens_salida_cuento",
    "tokens_razonamiento_cuento",
    "tokens_totales_cuento",
    "tiempo_total_ms",
    "costo_teorico_cuento_usd",
    "costo_efectivo_cuento_usd",
    "errores",
    "reintentos",
    "solicitudes_http_totales",
    "cuento_completo_exitoso",
    "es_simulado",
  ];

  const rows = [headers.join(",")];
  for (const rc of resCuentos) {
    const row = [
      escapeCsv(rc.proveedor),
      escapeCsv(rc.modelo),
      escapeCsv(rc.caso),
      escapeCsv(rc.repeticion),
      escapeCsv(rc.operaciones_totales),
      escapeCsv(rc.operaciones_exitosas),
      escapeCsv(rc.tokens_entrada_cuento !== null ? rc.tokens_entrada_cuento : ""),
      escapeCsv(rc.tokens_salida_cuento !== null ? rc.tokens_salida_cuento : ""),
      escapeCsv(rc.tokens_razonamiento_cuento !== null ? rc.tokens_razonamiento_cuento : ""),
      escapeCsv(rc.tokens_totales_cuento !== null ? rc.tokens_totales_cuento : ""),
      escapeCsv(rc.tiempo_total_ms !== null ? rc.tiempo_total_ms : ""),
      escapeCsv(formatNumCsv(rc.costo_teorico_cuento_usd, 6)),
      escapeCsv(formatNumCsv(rc.costo_efectivo_cuento_usd, 6)),
      escapeCsv(rc.errores),
      escapeCsv(rc.reintentos),
      escapeCsv(rc.solicitudes_http_totales),
      escapeCsv(rc.cuento_completo_exitoso),
      escapeCsv(rc.es_simulado),
    ];
    rows.push(row.join(","));
  }

  const filePath = path.resolve(carpetaSalida, "resumen_cuentos.csv");
  fs.writeFileSync(filePath, rows.join("\n"), "utf-8");
  return filePath;
}

export function consolidarResumenModelos(
  ejecuciones: ResultadoOperacion[],
  carpetaSalida: string
): string {
  const grupos = new Map<string, ResultadoOperacion[]>();
  for (const ej of ejecuciones) {
    const key = [ej.proveedor, ej.modelo].join('___');
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(ej);
  }

  const resModelos: ResumenModelo[] = [];
  for (const [key, ops] of grupos.entries()) {
    const [proveedor, modelo] = key.split("___");
    const operaciones_totales = ops.length;
    const operaciones_exitosas = ops.filter((o) => o.estructura_valida).length;
    const tasa_exito_pct = operaciones_totales > 0 ? (operaciones_exitosas / operaciones_totales) * 100 : 0;
    const json_valido_primer_intento_pct =
      operaciones_totales > 0
        ? (ops.filter((o) => o.json_valido && o.cumple_primer_intento).length / operaciones_totales) * 100
        : 0;
    const estructura_valida_primer_intento_pct =
      operaciones_totales > 0
        ? (ops.filter((o) => o.cumple_primer_intento).length / operaciones_totales) * 100
        : 0;
    const es_simulado = ops.some((o) => o.es_simulado);

    const cuentosMap = new Map<string, ResultadoOperacion[]>();
    for (const o of ops) {
      const cKey = [o.caso, String(o.repeticion)].join('___');
      if (!cuentosMap.has(cKey)) cuentosMap.set(cKey, []);
      cuentosMap.get(cKey)!.push(o);
    }
    const numCuentos = cuentosMap.size;
    let sumTokensEntrada = 0;
    let sumTokensSalida = 0;
    let sumTokensTotales = 0;
    let tokensValidos = true;
    for (const [, cOps] of cuentosMap.entries()) {
      for (const o of cOps) {
        if (o.tokens_entrada !== null && o.tokens_salida !== null && o.tokens_totales !== null) {
          sumTokensEntrada += o.tokens_entrada;
          sumTokensSalida += o.tokens_salida;
          sumTokensTotales += o.tokens_totales;
        } else {
          tokensValidos = false;
        }
      }
    }
    const tokens_entrada_promedio_cuento = tokensValidos && numCuentos > 0 ? Math.round(sumTokensEntrada / numCuentos) : null;
    const tokens_salida_promedio_cuento = tokensValidos && numCuentos > 0 ? Math.round(sumTokensSalida / numCuentos) : null;
    const tokens_totales_promedio_cuento = tokensValidos && numCuentos > 0 ? Math.round(sumTokensTotales / numCuentos) : null;

    const latencias = ops.map((o) => o.tiempo_ms).filter((t): t is number => t !== null);
    const latencia_media_ms = latencias.length > 0 ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;
    const latencia_mediana_ms = calcularMediana(latencias);
    const latencia_p95_ms = calcularP95(latencias);

    const reintentos_totales = ops.reduce((acc, o) => acc + o.numero_reintentos, 0);
    const solicitudes_http_totales = ops.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

    const algunCostoTeoricoNull = ops.some((o) => o.costo_teorico_usd === null);
    const costoTeoricoTotal = algunCostoTeoricoNull ? null : ops.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);
    const costo_teorico_promedio_cuento_usd = costoTeoricoTotal !== null && numCuentos > 0 ? costoTeoricoTotal / numCuentos : null;
    const costo_teorico_100_cuentos_usd = costo_teorico_promedio_cuento_usd !== null ? costo_teorico_promedio_cuento_usd * 100 : null;
    const costo_teorico_1000_cuentos_usd = costo_teorico_promedio_cuento_usd !== null ? costo_teorico_promedio_cuento_usd * 1000 : null;

    const algunCostoEfectivoNull = ops.some((o) => o.costo_efectivo_experimento_usd === null);
    const costo_efectivo_experimento_usd = algunCostoEfectivoNull
      ? null
      : ops.reduce((acc, o) => acc + (o.costo_efectivo_experimento_usd || 0), 0);

    resModelos.push({
      proveedor,
      modelo,
      operaciones_totales,
      operaciones_exitosas,
      tasa_exito_pct,
      json_valido_primer_intento_pct,
      estructura_valida_primer_intento_pct,
      tokens_entrada_promedio_cuento,
      tokens_salida_promedio_cuento,
      tokens_totales_promedio_cuento,
      latencia_media_ms,
      latencia_mediana_ms,
      latencia_p95_ms,
      reintentos_totales,
      solicitudes_http_totales,
      costo_teorico_promedio_cuento_usd,
      costo_teorico_100_cuentos_usd,
      costo_teorico_1000_cuentos_usd,
      costo_efectivo_experimento_usd,
      es_simulado,
    });
  }

  const headers = [
    "proveedor",
    "modelo",
    "operaciones_totales",
    "operaciones_exitosas",
    "tasa_exito_pct",
    "json_valido_primer_intento_pct",
    "estructura_valida_primer_intento_pct",
    "tokens_entrada_promedio_cuento",
    "tokens_salida_promedio_cuento",
    "tokens_totales_promedio_cuento",
    "latencia_media_ms",
    "latencia_mediana_ms",
    "latencia_p95_ms",
    "reintentos_totales",
    "solicitudes_http_totales",
    "costo_teorico_promedio_cuento_usd",
    "costo_teorico_100_cuentos_usd",
    "costo_teorico_1000_cuentos_usd",
    "costo_efectivo_experimento_usd",
    "es_simulado",
  ];

  const rows = [headers.join(",")];
  for (const rm of resModelos) {
    const row = [
      escapeCsv(rm.proveedor),
      escapeCsv(rm.modelo),
      escapeCsv(rm.operaciones_totales),
      escapeCsv(rm.operaciones_exitosas),
      escapeCsv(rm.tasa_exito_pct.toFixed(2)),
      escapeCsv(rm.json_valido_primer_intento_pct.toFixed(2)),
      escapeCsv(rm.estructura_valida_primer_intento_pct.toFixed(2)),
      escapeCsv(rm.tokens_entrada_promedio_cuento !== null ? rm.tokens_entrada_promedio_cuento : ""),
      escapeCsv(rm.tokens_salida_promedio_cuento !== null ? rm.tokens_salida_promedio_cuento : ""),
      escapeCsv(rm.tokens_totales_promedio_cuento !== null ? rm.tokens_totales_promedio_cuento : ""),
      escapeCsv(rm.latencia_media_ms !== null ? rm.latencia_media_ms : ""),
      escapeCsv(rm.latencia_mediana_ms !== null ? rm.latencia_mediana_ms : ""),
      escapeCsv(rm.latencia_p95_ms !== null ? rm.latencia_p95_ms : ""),
      escapeCsv(rm.reintentos_totales),
      escapeCsv(rm.solicitudes_http_totales),
      escapeCsv(formatNumCsv(rm.costo_teorico_promedio_cuento_usd, 6)),
      escapeCsv(formatNumCsv(rm.costo_teorico_100_cuentos_usd, 4)),
      escapeCsv(formatNumCsv(rm.costo_teorico_1000_cuentos_usd, 4)),
      escapeCsv(formatNumCsv(rm.costo_efectivo_experimento_usd, 6)),
      escapeCsv(rm.es_simulado),
    ];
    rows.push(row.join(","));
  }

  const filePath = path.resolve(carpetaSalida, "resumen_modelos.csv");
  fs.writeFileSync(filePath, rows.join("\n"), "utf-8");
  return filePath;
}

export function consolidarResumenOperaciones(
  ejecuciones: ResultadoOperacion[],
  carpetaSalida: string
): string {
  const grupos = new Map<string, ResultadoOperacion[]>();
  for (const ej of ejecuciones) {
    const key = [ej.proveedor, ej.modelo, ej.operacion].join('___');
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(ej);
  }

  const resOperaciones: ResumenOperacion[] = [];
  for (const [key, ops] of grupos.entries()) {
    const [proveedor, modelo, operacion] = key.split("___");
    const operaciones_totales = ops.length;
    const operaciones_exitosas = ops.filter((o) => o.estructura_valida).length;
    const tasa_exito_pct = operaciones_totales > 0 ? (operaciones_exitosas / operaciones_totales) * 100 : 0;
    const estructura_valida_pct =
      operaciones_totales > 0 ? (ops.filter((o) => o.cumple_primer_intento).length / operaciones_totales) * 100 : 0;
    const es_simulado = ops.some((o) => o.es_simulado);

    let sumTokensTotales = 0;
    let tokensValidos = true;
    for (const o of ops) {
      if (o.tokens_totales !== null) sumTokensTotales += o.tokens_totales;
      else tokensValidos = false;
    }
    const tokens_totales_promedio = tokensValidos && operaciones_totales > 0 ? Math.round(sumTokensTotales / operaciones_totales) : null;

    const latencias = ops.map((o) => o.tiempo_ms).filter((t): t is number => t !== null);
    const latencia_media_ms = latencias.length > 0 ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;
    const latencia_mediana_ms = calcularMediana(latencias);

    const algunCostoTeoricoNull = ops.some((o) => o.costo_teorico_usd === null);
    const costoTotal = algunCostoTeoricoNull ? null : ops.reduce((acc, o) => acc + (o.costo_teorico_usd || 0), 0);
    const costo_teorico_promedio_usd = costoTotal !== null && operaciones_totales > 0 ? costoTotal / operaciones_totales : null;
    const reintentos_totales = ops.reduce((acc, o) => acc + o.numero_reintentos, 0);
    const solicitudes_http_totales = ops.reduce((acc, o) => acc + o.numero_solicitudes_http, 0);

    resOperaciones.push({
      proveedor,
      modelo,
      operacion,
      operaciones_totales,
      operaciones_exitosas,
      tasa_exito_pct,
      estructura_valida_pct,
      tokens_totales_promedio,
      latencia_media_ms,
      latencia_mediana_ms,
      costo_teorico_promedio_usd,
      reintentos_totales,
      solicitudes_http_totales,
      es_simulado,
    });
  }

  const headers = [
    "proveedor",
    "modelo",
    "operacion",
    "operaciones_totales",
    "operaciones_exitosas",
    "tasa_exito_pct",
    "estructura_valida_pct",
    "tokens_totales_promedio",
    "latencia_media_ms",
    "latencia_mediana_ms",
    "costo_teorico_promedio_usd",
    "reintentos_totales",
    "solicitudes_http_totales",
    "es_simulado",
  ];

  const rows = [headers.join(",")];
  for (const ro of resOperaciones) {
    const row = [
      escapeCsv(ro.proveedor),
      escapeCsv(ro.modelo),
      escapeCsv(ro.operacion),
      escapeCsv(ro.operaciones_totales),
      escapeCsv(ro.operaciones_exitosas),
      escapeCsv(ro.tasa_exito_pct.toFixed(2)),
      escapeCsv(ro.estructura_valida_pct.toFixed(2)),
      escapeCsv(ro.tokens_totales_promedio !== null ? ro.tokens_totales_promedio : ""),
      escapeCsv(ro.latencia_media_ms !== null ? ro.latencia_media_ms : ""),
      escapeCsv(ro.latencia_mediana_ms !== null ? ro.latencia_mediana_ms : ""),
      escapeCsv(formatNumCsv(ro.costo_teorico_promedio_usd, 6)),
      escapeCsv(ro.reintentos_totales),
      escapeCsv(ro.solicitudes_http_totales),
      escapeCsv(ro.es_simulado),
    ];
    rows.push(row.join(","));
  }

  const filePath = path.resolve(carpetaSalida, "resumen_operaciones.csv");
  fs.writeFileSync(filePath, rows.join("\n"), "utf-8");
  return filePath;
}
