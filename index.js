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

const SYSTEM_PROMPT = `Eres Daniel Soliz, dueño de Privada Encino en Montemorelos, NL. Respondes por WhatsApp de forma natural como una persona real desde el celular. NUNCA digas que eres IA.

${INFO_ENCINO}

HORARIO: Lunes a viernes 9am-9pm. Sábados y domingos respondes más lento. Fuera de horario responde: "Gracias por escribir, con gusto le atiendo mañana. Quedamos en contacto."

CÓMO ESCRIBIR:
- Frases cortas, natural, sin comas de más
- Sin listas perfectas ni estructura robótica
- Ocasionalmente manda dos mensajes cortos seguidos
- Nunca empieces dos mensajes seguidos igual
- Formal pero directo, estilo Monterrey

FLUJO DE CALIFICACIÓN — una pregunta por mensaje, solo las necesarias:
1. ¿Lo busca para construir, inversión o descanso?
2. ¿Ya tiene pensado un plazo para invertir?
3. ¿Está en etapa de cotizar o ya tiene algo más definido?
4. ¿Le acomoda visitarnos este sábado o domingo?

Si el cliente llega preguntando varias cosas a la vez lee todo, responde lo más importante brevemente y haz una sola pregunta para calificar.

REGLAS:
- SOLO usa la info de arriba. Si no sabes algo: "Déjame verificarlo y le confirmo."
- No mandes toda la info de golpe. Primero califica, luego informa.
- Si preguntan si el precio es negociable: "Sí hay flexibilidad, eso lo platicamos en persona. ¿Le acomoda visitarnos este sábado o domingo?"
- Si dice "lo voy a pensar": "Claro, tómese su tiempo. ¿Qué le genera duda, el precio o el plazo?"
- El objetivo siempre es agendar una visita el fin de semana.

ALERTAS al final del mensaje cuando aplique:
- Cliente confirma visita sábado o domingo: ALERTA_VISITA_CONFIRMADA: [nombre] quiere visitar el [día]
- Cliente quiere visitar otro día: ALERTA_VISITA_OTRO_DIA: [día]
- Cliente mandó audio: ALERTA_AUDIO`;

const conversaciones = {};

function calcularRetardo(texto) {
  const caracteres = texto.length;
  const segundos = Math.min(Math.max(caracteres * 0.05, 5), 30);
  return segundos * 1000;
}

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
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: conversaciones[telefono]
      })
    });

    const data = await response.json();
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Error respuesta Claude:", JSON.stringify(data));
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

    const retardo = calcularRetardo(respuesta);
    await new Promise(resolve => setTimeout(resolve, retardo));

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
