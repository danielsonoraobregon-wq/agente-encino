const express = require("express");
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const META_DATASET_ID = process.env.META_DATASET_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ALERTA_SUBSCRIBER_ID = process.env.ALERTA_SUBSCRIBER_ID;

const INFO_ENCINO = `
PRIVADA ENCINO — INFORMACIÓN OFICIAL

Proyecto campestre en Área de La Morita, Montemorelos, NL.
Frente al Restaurant El Pariente. 5 min de Pueblo Salvaje, 3 min del Río Blanquillo, 45 min de Monterrey.
Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

Características: único proyecto pavimentado en la zona, acceso controlado, electricidad subterránea, red de agua, encinos centenarios y naranjos en producción, libertad total de construcción. Quedan 4 lotes de 8 originales.

Lotes:
- Lote 1: 1,648 m² (38x38m) — $1,600,000 — 24 MSI
- Lote 3: 1,639 m² (43x38m) — $1,726,200 — 24 MSI
- Lote 3B: 1,700 m² (43x39m) — $1,785,000 — 24 MSI
- Lote 4 PREMIUM: 1,632 m² (45x38m) — $1,600,000 — Contado — mejor vista del proyecto

Financiamiento directo sin banco: Enganche $350,000 + 24 mensualidades $75,000 + pago final $350,000. Sin intereses.
Proceso: apartar → contrato notaría → escrituras listas.
Visitas: sábados y domingos.
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos NL. Respondes por WhatsApp como persona real. NUNCA digas que eres IA ni que eres el dueño.

${INFO_ENCINO}

PERSONALIDAD:
Profesional, directo y cordial. Estilo Monterrey. Mensajes cortos — máximo 3 líneas. Sin listas ni bullet points. Sin frases como "con gusto", "excelente pregunta", "claro que sí".

CÓMO RESPONDER — LAS REGLAS MÁS IMPORTANTES:
1. LEE el historial completo antes de responder — nunca trates un mensaje como si fuera el primero si ya hay conversación previa
2. RESPONDE siempre lo que preguntó el cliente aunque escriba mal — "ubaicon"=ubicación, "financmiento"=financiamiento, "precios"=precios, "medidas"=dimensiones, "etc"=ignóralo
3. NUNCA digas "no entiendo" o "su mensaje no llegó completo" — siempre responde algo útil
4. UNA sola pregunta por mensaje — nunca dos
5. NO des todos los precios, dimensiones y financiamiento en el mismo mensaje
6. Precios → siempre "desde $1,600,000"

FLUJO NATURAL:
- Si es primer mensaje → saluda brevemente y pregunta para qué busca el terreno
- Si ya hay conversación → continúa naturalmente sin resetear
- Si pregunta precio → da "desde $1,600,000" y pregunta para qué lo busca
- Si pregunta ubicación → da referencia + link del mapa
- Si quiere visitar → di "Déjame verificar disponibilidad, en un momento le confirmo" y escribe ALERTA_VISITA_PENDIENTE:[detalle]
- Objetivo siempre → agendar visita sábado o domingo

HORARIO: L-V 9am-9pm, S-D también. Fuera de horario: "Gracias por escribir, con gusto le atiendo mañana."

CUANDO NO SABES ALGO: "Déjame verificarlo y le confirmo." y escribe ALERTA_NO_SABE al final.

SEÑALES — escríbelas en línea separada al final, el cliente NUNCA las ve:
FOTO_ENCINO → solo en el primer mensaje de la conversación
ETIQUETA:nuevo-lead → primer mensaje
ETIQUETA:intencion-conocida → cuando dice para qué lo busca
ETIQUETA:calificado → cuando tiene plazo definido
ETIQUETA:visita-agendada → cuando confirma visita
ALERTA_VISITA_PENDIENTE:[detalle] → quiere visitar, pendiente confirmar
ALERTA_VISITA_CONFIRMADA:[nombre] el [día] → visita confirmada
ALERTA_VISITA_OTRO_DIA:[día] → quiere visitar día diferente a sábado/domingo
ALERTA_AUDIO → mandó audio
ALERTA_NO_SABE → no sabes responder`;

const conversaciones = {};

async function mandarAlerta(mensaje) {
  try {
    await fetch(`https://api.manychat.com/fb/sending/sendContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MANYCHAT_API_KEY}`
      },
      body: JSON.stringify({
        subscriber_id: ALERTA_SUBSCRIBER_ID,
        data: {
          version: "v2",
          content: {
            messages: [{ type: "text", text: mensaje }]
          }
        }
      })
    });
  } catch (e) {
    console.error("Error alerta:", e);
  }
}

async function ponerEtiqueta(subscriberId, etiqueta) {
  try {
    await fetch(`https://api.manychat.com/fb/subscriber/addTag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MANYCHAT_API_KEY}`
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        tag_name: etiqueta
      })
    });
  } catch (e) {
    console.error("Error etiqueta:", e);
  }
}

async function mandarEventoMeta(evento, telefono) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${META_DATASET_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name: evento,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "other",
          user_data: { ph: [telefono] }
        }],
        access_token: META_ACCESS_TOKEN
      })
    });
  } catch (e) {
    console.error("Error Meta:", e);
  }
}

app.post("/webhook", async (req, res) => {
  try {
    const { telefono, mensaje, subscriber_id } = req.body;

    if (!telefono || !mensaje) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const esNuevo = !conversaciones[telefono];
    if (esNuevo) {
      conversaciones[telefono] = [];
      await mandarEventoMeta("Lead", telefono);
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
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: conversaciones[telefono]
      })
    });

    const data = await response.json();

    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Error Claude:", JSON.stringify(data));
      return res.json({ respuesta1: "Un momento, déjame verificarlo.", respuesta2: null, alerta: null, foto: false });
    }

    let respuesta = data.content[0].text;
    conversaciones[telefono].push({ role: "assistant", content: respuesta });

    if (conversaciones[telefono].length > 20) {
      conversaciones[telefono] = conversaciones[telefono].slice(-20);
    }

    let alerta = null;
    let foto = false;

    // Foto primer mensaje
    if (respuesta.includes("FOTO_ENCINO")) {
      foto = true;
      respuesta = respuesta.replace(/FOTO_ENCINO/g, "").trim();
    }

    // Etiquetas
    const etiquetasMatch = respuesta.match(/ETIQUETA:[a-zA-Z0-9_-]+/g);
    if (etiquetasMatch) {
      for (const e of etiquetasMatch) {
        const nombre = e.replace("ETIQUETA:", "");
        if (subscriber_id) await ponerEtiqueta(subscriber_id, nombre);
        if (nombre === "calificado") await mandarEventoMeta("CompleteRegistration", telefono);
      }
      respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();
    }

    // Alertas
    if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
      const match = respuesta.match(/ALERTA_VISITA_PENDIENTE:(.+)/);
      alerta = "ALERTA_VISITA_PENDIENTE";
      respuesta = respuesta.replace(/ALERTA_VISITA_PENDIENTE:.+/g, "").trim();
      await mandarAlerta(`📅 VISITA PENDIENTE\nCliente: ${telefono}\n${match?.[1] || ""}\n¿Confirmas?`);
    } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
      const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
      alerta = "ALERTA_VISITA_CONFIRMADA";
      respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
      await mandarAlerta(`✅ VISITA CONFIRMADA\n${match?.[1] || telefono}`);
      await mandarEventoMeta("Schedule", telefono);
    } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
      const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
      alerta = "ALERTA_VISITA_OTRO_DIA";
      respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
      await mandarAlerta(`📅 VISITA OTRO DÍA\nCliente: ${telefono}\nDía: ${match?.[1] || "no especificado"}`);
    } else if (respuesta.includes("ALERTA_AUDIO")) {
      alerta = "ALERTA_AUDIO";
      respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
      await mandarAlerta(`🎤 AUDIO\nCliente: ${telefono}\nResponde tú`);
    } else if (respuesta.includes("ALERTA_NO_SABE")) {
      alerta = "ALERTA_NO_SABE";
      respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
      await mandarAlerta(`❓ NO SABE\nCliente: ${telefono}\nPregunta: ${mensaje}`);
    }

    // Dividir en 2 mensajes
    const partes = respuesta.split("---");
    const respuesta1 = partes[0].trim();
    const respuesta2 = partes[1]?.trim() || null;

    res.json({ respuesta1, respuesta2, alerta: alerta || null, foto });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/reporte", async (req, res) => {
  const total = Object.keys(conversacione
