import { Escena, StoryAnalysis } from "./types.js";

export const STORY_ANALYSIS_KEYS: (keyof StoryAnalysis)[] = [
  "titulo",
  "tituloOriginal",
  "protagonista",
  "descripcionProtagonista",
  "resumen",
  "escenario",
  "conflicto",
  "finalOriginal",
];

export const ESCENA_KEYS: (keyof Escena)[] = ["contenido", "opciones", "esFinal"];

export function validarStoryAnalysis(data: unknown): {
  valido: boolean;
  error?: string;
  parsed?: StoryAnalysis;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valido: false, error: "La respuesta no es un objeto JSON valido" };
  }

  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  for (const expectedKey of STORY_ANALYSIS_KEYS) {
    if (!(expectedKey in obj)) {
      return { valido: false, error: "Campo requerido faltante: " + expectedKey };
    }
    const val = obj[expectedKey];
    if (typeof val !== "string" || val.trim().length === 0) {
      return { valido: false, error: "El campo " + expectedKey + " debe ser un string no vacio" };
    }
  }

  const extraKeys = keys.filter((k) => !STORY_ANALYSIS_KEYS.includes(k as keyof StoryAnalysis));
  if (extraKeys.length > 0) {
    return {
      valido: false,
      error: "Se encontraron campos adicionales no permitidos: " + extraKeys.join(", "),
    };
  }

  return { valido: true, parsed: obj as unknown as StoryAnalysis };
}

export function validarRutaControlada(opciones: string[], decisionControlada?: string): boolean {
  if (!decisionControlada || decisionControlada.trim().length === 0) return true;
  const target = decisionControlada.trim();
  return opciones.some((op) => typeof op === "string" && op.trim() === target);
}

export function validarEscenaIntermedia(
  data: unknown,
  decisionControladaSiguiente?: string
): { valido: boolean; error?: string; parsed?: Escena; rutaControladaValida: boolean | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valido: false, error: "La respuesta no es un objeto JSON valido", rutaControladaValida: null };
  }

  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  for (const expectedKey of ESCENA_KEYS) {
    if (!(expectedKey in obj)) {
      return { valido: false, error: "Campo requerido faltante: " + expectedKey, rutaControladaValida: null };
    }
  }

  const extraKeys = keys.filter((k) => !ESCENA_KEYS.includes(k as keyof Escena));
  if (extraKeys.length > 0) {
    return {
      valido: false,
      error: "Se encontraron campos adicionales no permitidos: " + extraKeys.join(", "),
      rutaControladaValida: null,
    };
  }

  if (typeof obj.contenido !== "string" || obj.contenido.trim().length === 0) {
    return { valido: false, error: "El campo contenido debe ser un string no vacio", rutaControladaValida: null };
  }

  if (!Array.isArray(obj.opciones)) {
    return { valido: false, error: "El campo opciones debe ser un array", rutaControladaValida: null };
  }

  if (obj.opciones.length !== 3) {
    return {
      valido: false,
      error: "Se requieren exactamente 3 opciones, se recibieron " + obj.opciones.length,
      rutaControladaValida: null,
    };
  }

  for (let i = 0; i < 3; i++) {
    const op = obj.opciones[i];
    if (typeof op !== "string" || op.trim().length === 0) {
      return { valido: false, error: "La opcion en indice " + i + " debe ser un string no vacio", rutaControladaValida: null };
    }
  }

  const opsNormalizadas = (obj.opciones as string[]).map((o) => o.trim());
  const setOps = new Set(opsNormalizadas);
  if (setOps.size !== 3) {
    return { valido: false, error: "Las 3 opciones deben ser distintas entre si", rutaControladaValida: null };
  }

  if (obj.esFinal !== false) {
    return { valido: false, error: "El campo esFinal debe ser estrictamente false en escenas intermedias", rutaControladaValida: null };
  }

  let rutaControladaValida: boolean | null = null;
  if (decisionControladaSiguiente && decisionControladaSiguiente.trim().length > 0) {
    const cumpleRuta = validarRutaControlada(obj.opciones as string[], decisionControladaSiguiente);
    rutaControladaValida = cumpleRuta;
    if (!cumpleRuta) {
      return {
        valido: false,
        error: "Incumplimiento de ruta controlada: la opcion controlada " + decisionControladaSiguiente.trim() + " no se encontro exactamente entre las opciones generadas",
        rutaControladaValida: false,
      };
    }
  }

  return { valido: true, parsed: obj as unknown as Escena, rutaControladaValida };
}

export function validarEscenaFinal(data: unknown): {
  valido: boolean;
  error?: string;
  parsed?: Escena;
} {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valido: false, error: "La respuesta no es un objeto JSON valido" };
  }

  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  for (const expectedKey of ESCENA_KEYS) {
    if (!(expectedKey in obj)) {
      return { valido: false, error: "Campo requerido faltante: " + expectedKey };
    }
  }

  const extraKeys = keys.filter((k) => !ESCENA_KEYS.includes(k as keyof Escena));
  if (extraKeys.length > 0) {
    return {
      valido: false,
      error: "Se encontraron campos adicionales no permitidos: " + extraKeys.join(", "),
    };
  }

  if (typeof obj.contenido !== "string" || obj.contenido.trim().length === 0) {
    return { valido: false, error: "El campo contenido debe ser un string no vacio" };
  }

  if (!Array.isArray(obj.opciones) || obj.opciones.length !== 0) {
    return { valido: false, error: "El campo opciones debe ser un array vacio [] en la escena final" };
  }

  if (obj.esFinal !== true) {
    return { valido: false, error: "El campo esFinal debe ser estrictamente true en la escena final" };
  }

  return { valido: true, parsed: obj as unknown as Escena };
}

export function validarPreflight(data: unknown): { valido: boolean; error?: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valido: false, error: "La respuesta no es un objeto JSON valido" };
  }
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (!("estado" in obj)) {
    return { valido: false, error: "Campo requerido faltante: estado" };
  }
  if (keys.length !== 1) {
    return {
      valido: false,
      error: "Se encontraron campos adicionales no permitidos: " + keys.filter((k) => k !== "estado").join(", "),
    };
  }
  if (obj.estado !== "ok") {
    return { valido: false, error: "El campo estado debe ser exactamente ok, se recibio: " + obj.estado };
  }
  return { valido: true };
}

export const SCHEMAS = {
  analisis: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Titulo sugerido para la historia interactiva" },
      tituloOriginal: { type: "string", description: "Titulo original extraido directamente del texto fuente" },
      protagonista: { type: "string", description: "Nombre del personaje principal" },
      descripcionProtagonista: { type: "string", description: "Breve descripcion del protagonista" },
      resumen: { type: "string", description: "Resumen conciso del texto inicial" },
      escenario: { type: "string", description: "Lugar donde transcurren los hechos" },
      conflicto: { type: "string", description: "Problema o situacion que detona la accion" },
      finalOriginal: { type: "string", description: "Desenlace original explicitamente deducible del texto fuente" },
    },
    required: STORY_ANALYSIS_KEYS,
    additionalProperties: false,
  },
  escena: {
    type: "object",
    properties: {
      contenido: { type: "string", description: "Texto narrativo de la escena (aprox 70-150 palabras)" },
      opciones: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description: "Exactamente 3 opciones que continuan la historia",
      },
      esFinal: { type: "boolean", enum: [false], description: "Debe ser false en escenas intermedias" },
    },
    required: ESCENA_KEYS,
    additionalProperties: false,
  },
  escenaFinal: {
    type: "object",
    properties: {
      contenido: { type: "string", description: "Texto narrativo del desenlace final (aprox 80-160 palabras)" },
      opciones: {
        type: "array",
        items: { type: "string" },
        maxItems: 0,
        description: "Array vacio [] en la escena final",
      },
      esFinal: { type: "boolean", enum: [true], description: "Debe ser true en la escena final" },
    },
    required: ESCENA_KEYS,
    additionalProperties: false,
  },
  preflight: {
    type: "object",
    properties: {
      estado: { type: "string", enum: ["ok"], description: "Estado de verificacion del preflight" },
    },
    required: ["estado"],
    additionalProperties: false,
  },
};

export function sanitizarSchemaParaGoogle(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const clone = JSON.parse(JSON.stringify(schema));
  function limpiar(node: any) {
    if (!node || typeof node !== "object") return;
    delete node.additionalProperties;
    // La documentacion de Gemini soporta boolean pero enum solo esta documentado para strings y numeros.
    // Si un nodo tiene type: "boolean" con enum ([true] o [false]), se elimina enum preservando type: "boolean".
    if (node.type === "boolean" && "enum" in node) {
      delete node.enum;
    }
    if (node.properties) {
      for (const key of Object.keys(node.properties)) {
        limpiar(node.properties[key]);
      }
    }
    if (node.items) {
      limpiar(node.items);
    }
  }
  limpiar(clone);
  return clone;
}
