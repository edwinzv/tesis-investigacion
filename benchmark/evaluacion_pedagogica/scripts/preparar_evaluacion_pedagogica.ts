import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const BENCHMARK_DIR = path.join(ROOT_DIR, 'benchmark');
const PRUEBAS_DIR = path.join(BENCHMARK_DIR, 'pruebas_de_modelos');
const EVAL_DIR = path.join(BENCHMARK_DIR, 'evaluacion_pedagogica');
const CUENTOS_CIEGOS_DIR = path.join(EVAL_DIR, 'cuentos_ciegos');

const MODELOS = [
  {
    id: 'gemini-3.5-flash-lite',
    nombreCorto: 'Gemini 3.5 Flash Lite',
    proveedor: 'Google',
    aliasCiegoBase: 'Modelo_GMN',
    carpeta: 'pruebas_de_gemini_3_5_flash_lite'
  },
  {
    id: 'qwen/qwen3.8-27b',
    nombreCorto: 'Qwen 3.8 27B',
    proveedor: 'Groq',
    aliasCiegoBase: 'Modelo_QWN',
    carpeta: 'pruebas_de_qwen_3_8_27b'
  },
  {
    id: 'openai/gpt-oss-20b',
    nombreCorto: 'GPT-OSS 20B',
    proveedor: 'Groq',
    aliasCiegoBase: 'Modelo_GPT',
    carpeta: 'pruebas_de_gpt_oss_20b'
  }
];

const CASOS = [
  'caso_01_misterio_agua',
  'caso_02_robot_cielo',
  'caso_03_arbol_hueco',
  'caso_04_cometa_viento'
];

interface Escena {
  numero: number;
  tipo: string;
  contenido: string;
  opcionesPresentadas?: string[];
  esFinal?: boolean;
}

interface CuentoRaw {
  caso: string;
  repeticion: number;
  modelo: string;
  titulo: string;
  protagonista: string;
  descripcionProtagonista?: string;
  escenario: string;
  conflicto: string;
  resumenAnalisis?: string;
  escenas: Escena[];
}

interface CuentoCatalogo {
  id_maestro: string;
  id_ciego: string;
  modelo_id: string;
  modelo_nombre: string;
  proveedor: string;
  caso_id: string;
  repeticion: number;
  titulo: string;
  protagonista: string;
  escenario: string;
  conflicto: string;
  num_escenas: number;
  palabras_totales: number;
  ubicacion_original_json: string;
  ubicacion_original_md: string;
  ubicacion_ciega_md: string;
}

// Algoritmo PRNG determinista (Mulberry32) para barajado ciego 100% reproducible
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

async function main() {
  console.log('=== VERIFICANDO LOS 60 CUENTOS DEL BENCHMARK ===');

  if (!fs.existsSync(EVAL_DIR)) {
    fs.mkdirSync(EVAL_DIR, { recursive: true });
  }
  if (!fs.existsSync(CUENTOS_CIEGOS_DIR)) {
    fs.mkdirSync(CUENTOS_CIEGOS_DIR, { recursive: true });
  }

  const cuentosRecopilados: CuentoCatalogo[] = [];
  let contadorMaestro = 1;

  for (const mod of MODELOS) {
    const dirCuentos = path.join(PRUEBAS_DIR, mod.carpeta, 'cuentos_generados');
    if (!fs.existsSync(dirCuentos)) {
      throw new Error(`Directorio no encontrado: ${dirCuentos}`);
    }

    let cuentosDelModelo = 0;

    for (const caso of CASOS) {
      for (let rep = 1; rep <= 5; rep++) {
        const jsonName = `${caso}_rep${rep}.json`;
        const mdName = `${caso}_rep${rep}.md`;
        const jsonPath = path.join(dirCuentos, jsonName);
        const mdPath = path.join(dirCuentos, mdName);

        if (!fs.existsSync(jsonPath)) {
          throw new Error(`Falta archivo JSON: ${jsonPath}`);
        }
        if (!fs.existsSync(mdPath)) {
          throw new Error(`Falta archivo MD: ${mdPath}`);
        }

        const rawData: CuentoRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        if (!rawData.escenas || rawData.escenas.length !== 4) {
          throw new Error(`El cuento ${jsonName} no tiene 4 escenas completas.`);
        }

        // Conteo de palabras en las 4 escenas
        const textoEscenas = rawData.escenas.map(e => e.contenido).join(' ');
        const palabras = textoEscenas.trim().split(/\s+/).length;

        const idMaestro = `MAE-${String(contadorMaestro).padStart(2, '0')}`;
        contadorMaestro++;

        cuentosRecopilados.push({
          id_maestro: idMaestro,
          id_ciego: '', // Se asignará en el paso de aleatorización
          modelo_id: mod.id,
          modelo_nombre: mod.nombreCorto,
          proveedor: mod.proveedor,
          caso_id: caso,
          repeticion: rep,
          titulo: rawData.titulo,
          protagonista: rawData.protagonista,
          escenario: rawData.escenario,
          conflicto: rawData.conflicto,
          num_escenas: rawData.escenas.length,
          palabras_totales: palabras,
          ubicacion_original_json: path.relative(ROOT_DIR, jsonPath).replace(/\\/g, '/'),
          ubicacion_original_md: path.relative(ROOT_DIR, mdPath).replace(/\\/g, '/'),
          ubicacion_ciega_md: ''
        });

        cuentosDelModelo++;
      }
    }

    console.log(`✓ Modelo ${mod.nombreCorto}: 20 cuentos completos verificados con éxito.`);
    if (cuentosDelModelo !== 20) {
      throw new Error(`El modelo ${mod.nombreCorto} tiene ${cuentosDelModelo} cuentos, se esperaban exactamente 20.`);
    }
  }

  console.log(`Total cuentos verificados: ${cuentosRecopilados.length} / 60`);

  // Paso de Barajado Ciego Determinista (Semilla: 20261015)
  // El orden aleatorizado mezcla los 3 modelos y 4 casos de forma uniforme
  const rng = mulberry32(20261015);
  const indices = cuentosRecopilados.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // Asignar IDs ciegos EVAL-01 a EVAL-60
  const cuentosOrdenCiego: CuentoCatalogo[] = [];
  indices.forEach((origIdx, orderIndex) => {
    const idCiego = `EVAL-${String(orderIndex + 1).padStart(2, '0')}`;
    const cuento = cuentosRecopilados[origIdx];
    cuento.id_ciego = idCiego;
    cuento.ubicacion_ciega_md = `benchmark/evaluacion_pedagogica/cuentos_ciegos/${idCiego}.md`;
    cuentosOrdenCiego.push(cuento);
  });

  // Reordenar la lista según el orden ciego (EVAL-01 a EVAL-60)
  cuentosOrdenCiego.sort((a, b) => a.id_ciego.localeCompare(b.id_ciego));

  // Generar archivos de cuentos ciegos (Markdown limpios sin marcas de modelo ni telemetría técnica)
  for (const c of cuentosOrdenCiego) {
    const origJsonPath = path.join(ROOT_DIR, c.ubicacion_original_json);
    const data: CuentoRaw = JSON.parse(fs.readFileSync(origJsonPath, 'utf8'));

    let mdCiego = `# ${data.titulo}\n\n`;
    mdCiego += `**Código de Evaluación Ciega:** \`${c.id_ciego}\`\n`;
    mdCiego += `**Tema Narrativo:** ${c.caso_id.replace(/^caso_\d+_/, '').replace(/_/g, ' ').toUpperCase()}\n`;
    mdCiego += `**Personaje Principal:** ${data.protagonista} ${data.descripcionProtagonista ? `— ${data.descripcionProtagonista}` : ''}\n`;
    mdCiego += `**Entorno / Escenario:** ${data.escenario}\n`;
    mdCiego += `**Conflicto Inicial:** ${data.conflicto}\n\n`;
    mdCiego += `---\n\n`;

    data.escenas.forEach((escena, idx) => {
      const tipoEscena = idx === 0 ? 'Inicio' : idx === 1 ? 'Desarrollo' : idx === 2 ? 'Clímax' : 'Desenlace';
      mdCiego += `## Escena ${escena.numero}: ${tipoEscena}\n\n`;
      mdCiego += `${escena.contenido}\n\n`;

      if (escena.opcionesPresentadas && escena.opcionesPresentadas.length > 0) {
        mdCiego += `*Opciones de decisión presentadas al lector:*\n`;
        const letras = ['A', 'B', 'C', 'D'];
        escena.opcionesPresentadas.forEach((opc, opcIdx) => {
          mdCiego += `  ${letras[opcIdx]}) ${opc}\n`;
        });
        mdCiego += `\n`;
      }
    });

    mdCiego += `---\n`;
    mdCiego += `*Instrucciones para el evaluador:* Califique este cuento según los 5 criterios de la rúbrica pedagógica (1 a 5) registrando su dictamen en la matriz de evaluación para el código \`${c.id_ciego}\`.\n`;

    const destMdPath = path.join(ROOT_DIR, c.ubicacion_ciega_md);
    fs.writeFileSync(destMdPath, mdCiego, 'utf8');
  }

  console.log('✓ 60 versiones de cuentos ciegos generadas en cuentos_ciegos/');

  // 1. Guardar Catálogo Maestro (con correspondencia ciego <-> real)
  const catalogoMaestroCsvHeader = 'id_maestro,id_ciego,modelo_id,modelo_nombre,proveedor,caso_id,repeticion,titulo,protagonista,escenario,palabras_totales,ubicacion_original_json,ubicacion_original_md,ubicacion_ciega_md\n';
  const catalogoMaestroCsvRows = cuentosOrdenCiego.map(c => 
    `"${c.id_maestro}","${c.id_ciego}","${c.modelo_id}","${c.modelo_nombre}","${c.proveedor}","${c.caso_id}",${c.repeticion},"${c.titulo.replace(/"/g, '""')}","${c.protagonista.replace(/"/g, '""')}","${c.escenario.replace(/"/g, '""')}",${c.palabras_totales},"${c.ubicacion_original_json}","${c.ubicacion_original_md}","${c.ubicacion_ciega_md}"`
  ).join('\n');

  fs.writeFileSync(path.join(EVAL_DIR, 'catalogo_maestro_60_cuentos.csv'), catalogoMaestroCsvHeader + catalogoMaestroCsvRows, 'utf8');
  fs.writeFileSync(path.join(EVAL_DIR, 'catalogo_maestro_60_cuentos.json'), JSON.stringify(cuentosOrdenCiego, null, 2), 'utf8');

  // 2. Guardar Llave Maestra Confidencial
  const llaveMaestra = {
    generadoEl: new Date().toISOString(),
    descripcion: 'Llave maestra de correspondencia ciega para la evaluacion pedagogica y narrativa de los 60 cuentos',
    semillaAleatoria: 20261015,
    totalCuentos: 60,
    distribucionPorModelo: {
      'Gemini 3.5 Flash Lite': cuentosOrdenCiego.filter(c => c.modelo_id === 'gemini-3.5-flash-lite').length,
      'Qwen 3.8 27B': cuentosOrdenCiego.filter(c => c.modelo_id === 'qwen/qwen3.8-27b').length,
      'GPT-OSS 20B': cuentosOrdenCiego.filter(c => c.modelo_id === 'openai/gpt-oss-20b').length
    },
    mapeo: cuentosOrdenCiego.map(c => ({
      id_ciego: c.id_ciego,
      id_maestro: c.id_maestro,
      modelo: c.modelo_nombre,
      modelo_id: c.modelo_id,
      caso: c.caso_id,
      repeticion: c.repeticion,
      titulo: c.titulo
    }))
  };
  fs.writeFileSync(path.join(EVAL_DIR, 'llave_maestra_ciega.json'), JSON.stringify(llaveMaestra, null, 2), 'utf8');

  // 3. Guardar Catálogo Ciego para Evaluadores (sin nombres de modelos)
  const catalogoCiegoCsvHeader = 'id_ciego,titulo,tema_narrativo,personaje_principal,escenario,palabras_totales,archivo_lectura\n';
  const catalogoCiegoCsvRows = cuentosOrdenCiego.map(c => 
    `"${c.id_ciego}","${c.titulo.replace(/"/g, '""')}","${c.caso_id.replace(/^caso_\d+_/, '').replace(/_/g, ' ')}","${c.protagonista.replace(/"/g, '""')}","${c.escenario.replace(/"/g, '""')}",${c.palabras_totales},"${c.ubicacion_ciega_md}"`
  ).join('\n');
  fs.writeFileSync(path.join(EVAL_DIR, 'catalogo_ciego_evaluadores.csv'), catalogoCiegoCsvHeader + catalogoCiegoCsvRows, 'utf8');

  // Catálogo Ciego en Markdown
  let catalogoCiegoMd = `# Catálogo de Cuentos para Evaluación Ciega\n\n`;
  catalogoCiegoMd += `**Proyecto:** Evaluación Narrativa y Pedagógica de Cuentos Interactivos para Comprensión Lectora\n`;
  catalogoCiegoMd += `**Total de Cuentos:** 60 historias completas\n`;
  catalogoCiegoMd += `**Instrucción:** Los evaluadores deben acceder a cada cuento a través de su identificador ciego (\`EVAL-01\` a \`EVAL-60\`) ubicado en la carpeta \`cuentos_ciegos/\`.\n\n`;
  catalogoCiegoMd += `| ID Ciego | Título | Tema Narrativo | Personaje | Palabras | Archivo |\n`;
  catalogoCiegoMd += `| :---: | :--- | :--- | :--- | :---: | :--- |\n`;
  cuentosOrdenCiego.forEach(c => {
    catalogoCiegoMd += `| **${c.id_ciego}** | ${c.titulo} | ${c.caso_id.replace(/^caso_\d+_/, '').replace(/_/g, ' ')} | ${c.protagonista} | ${c.palabras_totales} | [\`${c.id_ciego}.md\`](cuentos_ciegos/${c.id_ciego}.md) |\n`;
  });
  fs.writeFileSync(path.join(EVAL_DIR, 'catalogo_ciego_evaluadores.md'), catalogoCiegoMd, 'utf8');

  // 4. Guardar Plantilla de Matriz de Evaluación Ciega en CSV (Vacía, sin calificaciones inventadas)
  const matrizCsvHeader = 'id_evaluacion,id_cuento_ciego,id_evaluador,fecha_evaluacion,criterio_1_coherencia_25pct,criterio_2_vocabulario_20pct,criterio_3_continuidad_20pct,criterio_4_decisiones_15pct,criterio_5_potencial_educativo_20pct,puntuacion_ponderada_preliminar,observaciones_cualitativas\n';
  const matrizCsvRows = cuentosOrdenCiego.map((c, i) => 
    `"${i + 1}","${c.id_ciego}","","","","","","","","",""`
  ).join('\n');
  fs.writeFileSync(path.join(EVAL_DIR, 'matriz_evaluacion_ciega.csv'), matrizCsvHeader + matrizCsvRows, 'utf8');

  // 5. Matriz Maestra de Registro (Con mapeo a modelo para consolidación posterior a la apertura de plicas)
  const matrizMaestraHeader = 'id_evaluacion,id_cuento_ciego,id_maestro,modelo_id,modelo_nombre,caso_id,repeticion,id_evaluador,fecha_evaluacion,criterio_1_coherencia_25pct,criterio_2_vocabulario_20pct,criterio_3_continuidad_20pct,criterio_4_decisiones_15pct,criterio_5_potencial_educativo_20pct,puntuacion_ponderada_preliminar,observaciones_cualitativas\n';
  const matrizMaestraRows = cuentosOrdenCiego.map((c, i) => 
    `"${i + 1}","${c.id_ciego}","${c.id_maestro}","${c.modelo_id}","${c.modelo_nombre}","${c.caso_id}",${c.repeticion},"","","","","","","","",""`
  ).join('\n');
  fs.writeFileSync(path.join(EVAL_DIR, 'matriz_evaluacion_maestra.csv'), matrizMaestraHeader + matrizMaestraRows, 'utf8');

  console.log('✓ Archivos generados exitosamente en benchmark/evaluacion_pedagogica/:');
  console.log('  - catalogo_maestro_60_cuentos.csv');
  console.log('  - catalogo_maestro_60_cuentos.json');
  console.log('  - catalogo_ciego_evaluadores.csv');
  console.log('  - catalogo_ciego_evaluadores.md');
  console.log('  - llave_maestra_ciega.json');
  console.log('  - matriz_evaluacion_ciega.csv');
  console.log('  - matriz_evaluacion_maestra.csv');
  console.log('  - cuentos_ciegos/ (60 archivos)');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
