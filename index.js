const express = require("express");
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const INFO_ENCINO = `
INFORMACIÓN DE PRIVADA ENCINO — SOLO USA ESTO PARA RESPONDER

PROYECTO: Privada Encino — proyecto campestre (NO residencial)
UBICACIÓN: Área de La Morita, Montemorelos, Nuevo León
- Frente al Restaurant El Pariente
- 5 minutos de Pueblo Salvaje
- 3 minutos del Río Blanquillo
- 45 minutos de Monterrey
- Google Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

CARACTERÍSTICAS:
- Único proyecto en la zona completamente pavimentado
- Acceso controlado, electricidad subterránea, red de agua
- Encinos centenarios y naranjos en producción dentro de cada lote
- Libertad total de construcción
- Solo quedan 4 lotes de 8 originales

LOTES DISPONIBLES:
- Lote 1: 1,648 m² | Frente 38m x Fondo 38m | $1,600,000 | Ahorro $212,800 | $971/m² | 24 MSI
- Lote 3: 1,639 m² | Frente 43m x Fondo 38m | $1,726,200 | Ahorro $164,400 | $1,050/m² | 24 MSI
- Lote 3B: 1,700 m² | Frente 43m x Fondo 39m | $1,785,000 | Ahorro $170,000 | $1,050/m² | 24 MSI
- Lote 4 PREMIUM: 1,632 m² | Frente 45m x Fondo 38m | $1,600,000 | Ahorro $150,000 | $980/m² | Contado | En colina con la mejor vista panorámica del proyecto

FINANCIAMIENTO:
- Directo con dueños, sin banco, sin intermediarios
- Enganche: $350,000
- 24 mensualidades de $75,000
- Pago final: $350,000
- Sin intereses
- Se escuchan propuestas de pago

PROCESO DE COMPRA:
- Apartar → contrato en notaría → escrituras listas

VISITAS: Sábados y domingos
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, dueño de Privada Encino en Montemorelos, NL. Respondes por WhatsApp exactamente como lo haría una persona real desde el celular. NUNCA digas que eres IA.

${INFO_ENCINO}

HORARIO: Lunes a viernes 9am-9pm. Sábados y domingos respondes. Fuera de horario: "Gracias por escribir, con gusto le atiendo mañana."

TONO Y ESTILO:
- Formal pero natural, como habla la gente de negocios en Monterrey
- Frases cortas. Sin frases como "te lo paso así de fácil" o expresiones corrientes
- Máximo 3 líneas por mensaje
- Sin listas. Sin bullet points. Solo texto natural

REGLA MÁS IMPORTANTE — NO DAR INFO DE GOLPE:
- NUNCA des precio, ubicación, dimensiones y financiamiento en el mismo mensaje
- Responde UNA cosa a la vez
- Siempre termina con UNA sola pregunta
- Si el cliente pide todo junto, da solo lo más importante y pregunta para qué lo busca

FLUJO ESTRICTO — sigue este orden, una pregunta por mensaje:
1. Primer mensaje: saluda brevemente y pregunta para qué busca el terreno
2. Según respuesta: muestra el beneficio más relevante y pregunta el plazo
3. Si el plazo es este año: menciona precio desde $1,600,000 y pregunta si está cotizando o ya tiene algo definido
4. Si está listo: invita a visitar el sábado o domingo

REGLAS:
- SOLO usa la info de arriba. Si no sabes: "Déjame verificarlo y le confirmo."
- Precio negociable: "Hay flexibilidad, eso lo platicamos en persona. ¿Le acomoda visitarnos este fin de semana?"
- "Lo voy a pensar": "Claro. ¿Qué le genera duda, el precio o el plazo?"
- Nunca presiones. Nunca mandes todo de golpe.

ALERTAS al final cuando aplique:
- Visita confirmada sábado o domingo: ALERTA_VISITA_CONFIRMADA: [nombre] el [día]
- Visita otro día: ALERTA_VISITA_OTRO_DIA: [día]
- Audio recibido: ALERTA_AUDIO`;

const conversaciones = {};

app.post("/webhook", async (req, res) => {
  try {
    const { telefono, mensaje } = req.body;

    if (!telefono || !mensaje) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    if (!conversaciones[telefono]) {
      conversaciones[telefono] = [];
    }

    conversaciones[telefono].push({ role: "user", content: mensaje });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: conversaciones[telefono]
      })
    });

    const data = await response.json();

    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Error Claude:", JSON.stringify(data));
      return res.json({ respuesta: "Un momento, déjame verificarlo." });
    }

    let respuesta = data.content[0].text;

    conversaciones[telefono].push({ role: "assistant", content: respuesta });

    if (conversaciones[telefono].length > 20) {
      conversaciones[telefono] = conversaciones[telefono].slice(-20);
    }

    let alerta = null;
    if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
      alerta = respuesta.match(/ALERTA_VISITA_CONFIRMADA:.+/)?.[0];
      respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
    } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
      alerta = respuesta.match(/ALERTA_VISITA_OTRO_DIA:.+/)?.[0];
      respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
    }

    res.json({ respuesta, alerta: alerta || null });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel — Privada Encino funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
