const express = require("express");
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const INFO_ENCINO = `
PRIVADA ENCINO — INFORMACIÓN OFICIAL

Proyecto campestre en Área de La Morita, Montemorelos, NL.
Frente al Restaurant El Pariente. 5 min de Pueblo Salvaje, 3 min del Río Blanquillo, 45 min de Monterrey.
Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

Características: único proyecto pavimentado en la zona, acceso controlado, electricidad subterránea, red de agua, encinos centenarios y naranjos en producción, libertad total de construcción. Quedan 4 lotes de 8 originales.

Lotes disponibles:
- Lote 1: 1,648 m² (38x38m) — $1,600,000 — 24 MSI
- Lote 3: 1,639 m² (43x38m) — $1,726,200 — 24 MSI  
- Lote 3B: 1,700 m² (43x39m) — $1,785,000 — 24 MSI
- Lote 4 PREMIUM: 1,632 m² (45x38m) — $1,600,000 — Contado — en colina con la mejor vista del proyecto

Financiamiento directo con propietarios, sin banco ni intermediarios:
Enganche $350,000 + 24 mensualidades de $75,000 + pago final $350,000. Sin intereses.
Se escuchan propuestas de pago a plazo corto.

Proceso: apartar → contrato en notaría → escrituras listas.
Visitas: sábados y domingos.
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos, NL. Respondes por WhatsApp como una persona real. Nunca menciones que eres IA ni que eres el dueño.

${INFO_ENCINO}

Horario de atención: lunes a viernes 9am-9pm, sábados y domingos también. Fuera de horario: "Gracias por escribir, con gusto le atiendo mañana."

Personalidad: profesional, directo y cordial. Estilo de negocios de Monterrey. Sin frases informales. Mensajes cortos — máximo 3-4 líneas. Sin listas ni bullet points.

Cómo responder:
Siempre responde primero lo que preguntó el cliente, aunque sea brevemente. Nunca ignores una pregunta. Luego haz UNA sola pregunta para avanzar en la conversación. Si pregunta varias cosas, responde lo más importante y pregunta lo siguiente en el flujo.

Flujo natural de la conversación:
Primer mensaje → pregunta para qué busca el terreno.
Sabe para qué → pregunta cuándo piensa invertir.
Tiene plazo definido → pregunta si ya está cotizando o tiene algo más concreto.
Está listo → invita a visitar el fin de semana.

Reglas importantes:
- Solo usa la información de arriba. Si no sabes algo: "Déjame verificarlo y le confirmo."
- No mandes toda la información de golpe. Una cosa a la vez.
- Si pregunta si el precio es negociable: "Hay flexibilidad, eso lo platicamos en persona. ¿Le acomoda visitarnos este fin de semana?"
- Si dice que lo va a pensar: "Claro. ¿Qué le genera duda, el precio o el plazo?"
- El objetivo final siempre es agendar una visita el sábado o domingo.

Escribe al final del mensaje cuando aplique, sin que el cliente lo vea:
Visita confirmada sábado o domingo → ALERTA_VISITA_CONFIRMADA: [nombre] el [día]
Quiere visitar otro día → ALERTA_VISITA_OTRO_DIA: [día]
Mandó audio → ALERTA_AUDIO`;

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
        model: "claude-sonnet-4-6",
        max_tokens: 400,
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
