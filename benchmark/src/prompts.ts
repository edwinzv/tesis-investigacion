import { StoryAnalysis } from "./types.js";

export interface PromptMensajes {
  systemInstruction: string;
  contents: {
    role: "user" | "model";
    parts: { text: string }[];
  }[];
}

export function construirPromptAnalisis(textoFuente: string): PromptMensajes {
  const systemInstruction =
    "Eres un asistente pedagogico experto en analisis de lectura y comprension lectora infantil. Tu tarea es analizar el siguiente texto de forma precisa y estructurada, devolviendo UNICAMENTE un objeto JSON con los 8 campos requeridos.";
  const userText =
    "Analiza cuidadosamente la siguiente lectura infantil:\\n\\n" +
    textoFuente +
    "\\n\\nDebes extraer los siguientes 8 campos obligatorios:\\n" +
    "- titulo: un titulo atractivo sugerido para la historia interactiva\\n" +
    "- tituloOriginal: el titulo original exacto presente al inicio de la lectura fuente\\n" +
    "- protagonista: nombre del personaje principal\\n" +
    "- descripcionProtagonista: breve descripcion fisica y emocional del protagonista\\n" +
    "- resumen: sintesis concisa de la historia (2 a 4 oraciones)\\n" +
    "- escenario: lugar o entorno donde transcurren los hechos\\n" +
    "- conflicto: problema o desafio principal que enfrenta el protagonista\\n" +
    "- finalOriginal: el desenlace original completo y explicitamente deducible del texto fuente";
  return {
    systemInstruction,
    contents: [{ role: "user", parts: [{ text: userText }] }],
  };
}

export function construirPromptEscena1(
  analisis: StoryAnalysis,
  decisionControladaSiguiente?: string
): PromptMensajes {
  const systemInstruction =
    "Eres un narrador de cuentos interactivos infantiles para ninos de 7 a 10 anos. Tu mision es iniciar una aventura ramificada basada en el analisis previo. Debes responder unicamente con el objeto JSON requerido: {\\\"contenido\\\": string, \\\"opciones\\\": [string, string, string], \\\"esFinal\\\": false}.";
  let instruccionOpciones = "Genera exactamente 3 opciones distintas y atractivas.";
  if (decisionControladaSiguiente && decisionControladaSiguiente.trim().length > 0) {
    instruccionOpciones =
      "REGLA EXPERIMENTAL OBLIGATORIA: Entre tus EXACTAMENTE 3 opciones debes incluir obligatoriamente y de forma textual exacta la siguiente opcion: \\\"" +
      decisionControladaSiguiente.trim() +
      "\\\". Las otras 2 opciones puedes crearlas libremente, asegurando que las 3 opciones sean totalmente distintas entre si.";
  }
  const userText =
    "Basandote en el siguiente analisis narrativo:\\n" +
    "- Protagonista: " +
    analisis.protagonista +
    " (" +
    analisis.descripcionProtagonista +
    ")\\n" +
    "- Escenario: " +
    analisis.escenario +
    "\\n" +
    "- Conflicto: " +
    analisis.conflicto +
    "\\n\\nEscribe la Escena 1 de la historia (aprox 70-150 palabras) planteando el inicio de la aventura en el campo \\\"contenido\\\", las 3 alternativas en \\\"opciones\\\" y \\\"esFinal\\\" en false.\\n" +
    instruccionOpciones;
  return {
    systemInstruction,
    contents: [{ role: "user", parts: [{ text: userText }] }],
  };
}

export function construirPromptEscenaIntermedia(
  historiaPrevia: string,
  decisionTomada: string,
  numeroEscena: number,
  decisionControladaSiguiente?: string
): PromptMensajes {
  const systemInstruction =
    "Eres un narrador de cuentos interactivos infantiles para ninos de 7 a 10 anos. Continua la historia respetando la decision tomada por el lector. Debes responder unicamente con el objeto JSON requerido: {\\\"contenido\\\": string, \\\"opciones\\\": [string, string, string], \\\"esFinal\\\": false}.";
  let instruccionOpciones = "Genera exactamente 3 opciones distintas que lleven la aventura hacia nuevas direcciones.";
  if (decisionControladaSiguiente && decisionControladaSiguiente.trim().length > 0) {
    instruccionOpciones =
      "REGLA EXPERIMENTAL OBLIGATORIA: Entre tus EXACTAMENTE 3 opciones debes incluir obligatoriamente y de forma textual exacta la siguiente opcion: \\\"" +
      decisionControladaSiguiente.trim() +
      "\\\". Las otras 2 opciones puedes crearlas libremente, asegurando que las 3 opciones sean totalmente distintas entre si.";
  }
  const userText =
    "Historia ocurrida hasta el momento:\\n" +
    historiaPrevia +
    "\\n\\nEl lector ha elegido: \\\"" +
    decisionTomada +
    "\\\"\\n\\nEscribe la Escena " +
    numeroEscena +
    " (aprox 70-150 palabras) continuando coherentemente las consecuencias de esa decision en el campo \\\"contenido\\\", 3 opciones nuevas en \\\"opciones\\\" y \\\"esFinal\\\" en false.\\n" +
    instruccionOpciones;
  return {
    systemInstruction,
    contents: [{ role: "user", parts: [{ text: userText }] }],
  };
}

export function construirPromptEscenaFinal(
  historiaPrevia: string,
  ultimaDecision: string
): PromptMensajes {
  const systemInstruction =
    "Eres un narrador de cuentos interactivos infantiles. Escribe el desenlace final y satisfactorio de la aventura. Debes responder unicamente con el objeto JSON requerido: {\\\"contenido\\\": string, \\\"opciones\\\": [], \\\"esFinal\\\": true}.";
  const userText =
    "Historia ocurrida hasta el momento:\\n" +
    historiaPrevia +
    "\\n\\nLa ultima decision del lector fue: \\\"" +
    ultimaDecision +
    "\\\"\\n\\nEscribe la escena final de desenlace (aprox 80-160 palabras) en el campo \\\"contenido\\\" cerrando todos los conflictos de forma positiva y emocionante, e integrando naturalmente una reflexion o mensaje final dentro del relato. El campo \\\"opciones\\\" debe ser un array vacio [] y \\\"esFinal\\\" debe ser estrictamente true.";
  return {
    systemInstruction,
    contents: [{ role: "user", parts: [{ text: userText }] }],
  };
}

export function construirPromptPreflight(): PromptMensajes {
  return {
    systemInstruction:
      "Eres un validador de conectividad y schemas JSON. Debes responder UNICAMENTE con un objeto JSON valido con la estructura exacta: {\\\"estado\\\":\\\"ok\\\"}. No agregues explicaciones, markdown ni campos adicionales.",
    contents: [
      {
        role: "user",
        parts: [{ text: "Verifica la conexion respondiendo exactamente {\\\"estado\\\":\\\"ok\\\"}." }],
      },
    ],
  };
}

export function construirPromptRetry(
  promptOriginal: PromptMensajes,
  rawRespuestaAnterior: string,
  errorMensaje: string,
  schemaJson: string,
  decisionControladaSiguiente?: string
): PromptMensajes {
  let instruccionRuta = "";
  if (decisionControladaSiguiente && decisionControladaSiguiente.trim().length > 0) {
    instruccionRuta =
      "\n\nREGLA EXPERIMENTAL OBLIGATORIA DE RUTA CONTROLADA: Entre tus EXACTAMENTE 3 opciones generadas DEBES incluir obligatoriamente y de forma textual exacta la opcion: \"" +
      decisionControladaSiguiente.trim() +
      "\".";
  }

  const feedbackUsuario =
    "Tu respuesta anterior no es valida por el siguiente motivo:\n" +
    errorMensaje +
    "\n\nEsquema JSON estricto requerido:\n" +
    schemaJson +
    instruccionRuta +
    "\n\nPor favor corrige estrictamente tu respuesta anterior devolviendo UNICAMENTE el objeto JSON valido que subsane dicho error, sin texto adicional y sin bloques de codigo markdown.";

  return {
    systemInstruction: promptOriginal.systemInstruction,
    contents: [
      ...promptOriginal.contents,
      {
        role: "model",
        parts: [{ text: rawRespuestaAnterior }],
      },
      {
        role: "user",
        parts: [{ text: feedbackUsuario }],
      },
    ],
  };
}
