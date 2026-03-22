const express = require("express");
const app = express();
app.use(express.json());

// ============================================================
// VARIABLES — todas vienen de Railway, nunca en el código
// ============================================================
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const META_DATASET_ID = process.env.META_DATASET_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ALERTA_SUBSCRIBER_ID = process.env.ALERTA_SUBSCRIBER_ID; // 518309613

// ============================================================
// INFORMACIÓN DE PRIVADA ENCINO
// ============================================================
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

Financiamiento directo con propietarios, sin banco ni intermediarios.
Enganche $350,000 + 24 mensualidades de $75,000 + pago final $350,000. Sin intereses.
Se escuchan propuestas de pago.

Proceso: apartar → contrato en notaría → escrituras listas.
Visitas: sábados y domingos.
`;

// ============================================================
// PROMPT — instrucciones para Daniel
// ============================================================
const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos, NL. Respondes por WhatsApp como una persona real desde el celular. Nunca menciones que eres IA ni que eres el dueño.

${INFO_ENCINO}

HORARIO: Lunes a viernes 9am-9pm. Sábados y domingos también. Fuera de horario: "Gracias por escribir, con gusto le atiendo mañana."

TONO:
- Profesional y cordial, estilo de negocios de Monterrey
- Frases cortas y directas. Sin frases informales como "buena onda" o "te lo paso así de fácil"
- Sin listas ni bullet points
- Nunca empieces dos mensajes seguidos igual

MENSAJES EN 2 PARTES:
Cuando necesites dar información Y hacer una pregunta, separa los dos mensajes con ---
El primer mensaje da la información. El segundo hace la pregunta.
Ejemplo:
Estamos en Área de La Morita, Montemorelos, frente al Restaurant El Pariente. Le dejo el mapa: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9
---
¿Lo busca para construir, inversión o descanso?

REGLA DE ORO:
Si el cliente pide varias cosas a la vez — responde solo lo más importante en el primer mensaje y haz una sola pregunta en el segundo. Nunca des precios, dimensiones y financiamiento en el mismo mensaje.
Si el cliente usa palabras como "etc", "y más", "entre otras" — ignóralas y responde solo lo que sí mencionó claramente. NUNCA digas que no entiendes el mensaje, siempre intenta responder algo útil.

FLUJO DE CONVERSACIÓN:
1. Primer contacto → escribe FOTO_ENCINO al final, saluda brevemente
2. Cliente pregunta info → responde lo más importante + pregunta para qué busca el terreno
3. Sabe el propósito → pregunta plazo
4. Dice que quiere verlo → responde: "Déjeme verificar disponibilidad y le confirmo." Escribe ALERTA_VISITA_PENDIENTE:[detalle]
5. Cuando agenda visita confirmada → manda ubicación y cierra con nombre
6. Pregunta el nombre cuando ya está casi cerrado

DISPONIBILIDAD:
NUNCA confirmes hora ni día de visita sin antes decir: "Déjeme verificar disponibilidad y le confirmo en un momento." Luego escribe la alerta y espera.

CUANDO NO SABES ALGO:
Di exactamente: "Déjame verificarlo y le confirmo en un momento." y escribe al final: ALERTA_NO_SABE

REGLAS ADICIONALES:
- Precio negociable: "Hay algo de flexibilidad, eso lo platicamos en persona. ¿Le acomoda visitarnos este fin de semana?"
- "Lo voy a pensar": "Claro. ¿Qué le genera duda, el precio o el plazo?"
- Precios → siempre "desde $1,600,000" no todos juntos
- El objetivo siempre es agendar una visita el sábado o domingo

ETIQUETAS — en línea separada al final, el cliente nunca las ve:
- Cliente llega por primera vez: ETIQUETA:nuevo-lead
- Dice para qué busca: ETIQUETA:intencion-conocida
- Tiene plazo definido: ETIQUETA:calificado
- Confirma visita: ETIQUETA:visita-agendada

ALERTAS — en línea separada al final:
- Primer mensaje: FOTO_ENCINO
- Quiere visitar, pendiente confirmar: ALERTA_VISITA_PENDIENTE:[nombre] [día] [hora]
- Visita confirmada sábado o domingo: ALERTA_VISITA_CONFIRMADA:[nombre] el [día] a las [hora]
- Quiere visitar otro día: ALERTA_VISITA_OTRO_DIA:[día]
- Mandó audio: ALERTA_AUDIO
- No sabe responder: ALERTA_NO_SABE`;

// ============================================================
// HISTORIAL DE CONVERSACIONES por teléfono
// ============================================================
const conversaciones = {};

// ============================================================
// FUNCIÓN: Mandar alerta a Daniel por WhatsApp
// ============================================================
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
    console.error("Error mandando alerta:", e);
  }
}

// ============================================================
// FUNCIÓN: Poner etiqueta en ManyChat
// ============================================================
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
    console.error("Error poniendo etiqueta:", e);
  }
}

// ============================================================
// FUNCIÓN: Mandar evento a Meta CAPI
// ============================================================
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
    console.error("Error mandando evento Meta:", e);
  }
}

// ============================================================
// WEBHOOK PRINCIPAL — recibe mensajes de ManyChat
// ============================================================
app.post("/webhook", async (req, res) => {
  try {
    const { telefono, mensaje, subscriber_id } = req.body;

    if (!telefono || !mensaje) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // Nuevo contacto — mandar evento Lead a Meta
    const esNuevo = !conversaciones[telefono];
    if (esNuevo) {
      conversaciones[telefono] = [];
      await mandarEventoMeta("Lead", telefono);
    }

    conversaciones[telefono].push({ role: "user", content: mensaje });

    // Llamar a Claude Sonnet
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

    // ============================================================
    // PROCESAR SEÑALES
    // ============================================================
    let alerta = null;
    let foto = false;

    // Foto primer mensaje
    if (respuesta.includes("FOTO_ENCINO")) {
      foto = true;
      respuesta = respuesta.replace(/FOTO_ENCINO/g, "").trim();
    }

    // Etiquetas — quitar del mensaje y aplicar en ManyChat
    const etiquetasMatch = respuesta.match(/ETIQUETA:[a-zA-Z0-9_-]+/g);
    if (etiquetasMatch) {
      for (const etiqueta of etiquetasMatch) {
        const nombre = etiqueta.replace("ETIQUETA:", "");
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
      await mandarAlerta(`📅 VISITA PENDIENTE DE CONFIRMAR\nCliente: ${telefono}\nDetalle: ${match?.[1] || "sin detalle"}\n¿Confirmas disponibilidad?`);
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
      await mandarAlerta(`🎤 AUDIO RECIBIDO\nCliente: ${telefono}\nResponde tú manualmente`);
    } else if (respuesta.includes("ALERTA_NO_SABE")) {
      alerta = "ALERTA_NO_SABE";
      respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
      await mandarAlerta(`❓ NO SABE RESPONDER\nCliente: ${telefono}\nPregunta: ${mensaje}`);
    }

    // ============================================================
    // DIVIDIR EN 2 MENSAJES si hay separador ---
    // ============================================================
    const partes = respuesta.split("---");
    const respuesta1 = partes[0].trim();
    const respuesta2 = partes[1]?.trim() || null;

    res.json({ respuesta1, respuesta2, alerta: alerta || null, foto });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// ============================================================
// REPORTE DIARIO — abre en navegador para recibir en WhatsApp
// ============================================================
app.get("/reporte", async (req, res) => {
  const total = Object.keys(conversaciones).length;
  const reporte = `📊 Reporte Privada Encino\nConversaciones activas: ${total}\nFecha: ${new Date().toLocaleDateString('es-MX')}`;
  await mandarAlerta(reporte);
  res.json({ status: "Reporte enviado", total });
});

// ============================================================
// VERIFICACIÓN DEL SERVIDOR
// ============================================================
app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel — Privada Encino funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
