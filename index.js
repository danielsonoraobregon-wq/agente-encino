const express = require("express");
const app = express();
app.use(express.json());

// ============================================================
// VARIABLES DEL SERVIDOR — todas vienen de Railway
// ============================================================
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const META_DATASET_ID = process.env.META_DATASET_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ALERTA_NUMERO = process.env.ALERTA_NUMERO; // 5218123793904

// ============================================================
// INFORMACIÓN DE PRIVADA ENCINO
// Solo Claude puede ver esto — el cliente nunca lo ve
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
Se escuchan propuestas de pago a plazo corto.

Proceso: apartar → contrato en notaría → escrituras listas.
Visitas: sábados y domingos.
`;

// ============================================================
// PROMPT — instrucciones para Daniel
// ============================================================
const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos, NL. Respondes por WhatsApp como una persona real. Nunca menciones que eres IA ni que eres el dueño.

${INFO_ENCINO}

HORARIO: Lunes a viernes 9am-9pm. Sábados y domingos también. Fuera de horario: "Gracias por escribir, con gusto le atiendo mañana."

TONO:
- Profesional y cordial, estilo de negocios de Monterrey
- Frases cortas y directas. Sin frases informales
- Máximo 3-4 líneas por mensaje
- Sin listas ni bullet points
- Nunca empieces dos mensajes seguidos igual

FLUJO DE CONVERSACIÓN:
Primer contacto → escribe FOTO_ENCINO al final, luego saluda brevemente
Después de saludar → pregunta para qué busca el terreno
Sabe el propósito → pregunta plazo: ¿ya tiene algo definido o está cotizando?
Plazo definido → menciona precio desde $1,600,000 e invita a visitar
Listo para visitar → agenda sábado o domingo

REGLA PRINCIPAL:
Siempre responde primero lo que preguntó el cliente. Nunca ignores una pregunta. Luego haz UNA sola pregunta.
Precios → di siempre "desde $1,600,000" no todos los precios juntos.
Ubicación → referencia breve + link del mapa.
Financiamiento → menciona opciones y que se platica en persona.

CUANDO NO SABES ALGO:
Responde: "Déjame verificarlo y le confirmo en un momento." y escribe al final: ALERTA_NO_SABE

REGLAS ADICIONALES:
- Si preguntan si el precio es negociable: "Hay algo de flexibilidad, eso lo platicamos en persona. ¿Le acomoda visitarnos este fin de semana?"
- Si dice "lo voy a pensar": "Claro. ¿Qué le genera duda, el precio o el plazo?"
- Nunca mandes todos los precios, dimensiones y financiamiento en el mismo mensaje
- El objetivo siempre es agendar una visita el sábado o domingo

ETIQUETAS — escribe al final cuando aplique:
- Cliente llega por primera vez: ETIQUETA:nuevo-lead
- Dice para qué busca: ETIQUETA:intencion-conocida
- Tiene plazo definido: ETIQUETA:calificado
- Confirma visita: ETIQUETA:visita-agendada

ALERTAS — escribe al final cuando aplique:
- Primer mensaje: FOTO_ENCINO
- Visita confirmada sábado o domingo: ALERTA_VISITA_CONFIRMADA:[nombre] el [día]
- Quiere visitar otro día: ALERTA_VISITA_OTRO_DIA:[día]
- Mandó audio: ALERTA_AUDIO
- No sabe responder: ALERTA_NO_SABE`;

// ============================================================
// HISTORIAL DE CONVERSACIONES
// Se guarda por número de teléfono en memoria
// ============================================================
const conversaciones = {};

// ============================================================
// FUNCIÓN: Mandar alerta a Daniel por WhatsApp via ManyChat
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
        subscriber_id: ALERTA_NUMERO,
        data: {
          version: "v2",
          content: {
            messages: [{
              type: "text",
              text: mensaje
            }]
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
          user_data: {
            ph: [telefono]
          }
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

    // Iniciar historial si es nuevo contacto
    const esNuevo = !conversaciones[telefono];
    if (esNuevo) {
      conversaciones[telefono] = [];
      // Mandar evento Lead a Meta CAPI
      await mandarEventoMeta("Lead", telefono);
    }

    conversaciones[telefono].push({ role: "user", content: mensaje });

    // Llamar a Claude
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
      return res.json({ respuesta: "Un momento, déjame verificarlo.", alerta: null, foto: false });
    }

    let respuesta = data.content[0].text;

    conversaciones[telefono].push({ role: "assistant", content: respuesta });

    // Limitar historial a 20 mensajes
    if (conversaciones[telefono].length > 20) {
      conversaciones[telefono] = conversaciones[telefono].slice(-20);
    }

    // ============================================================
    // PROCESAR SEÑALES — foto, alertas, etiquetas
    // ============================================================
    let alerta = null;
    let foto = false;

    // Foto en primer mensaje
    if (respuesta.includes("FOTO_ENCINO")) {
      foto = true;
      respuesta = respuesta.replace(/FOTO_ENCINO/g, "").trim();
    }

    // Etiquetas automáticas
    if (subscriber_id) {
      const etiquetaMatch = respuesta.match(/ETIQUETA:([a-z-]+)/);
      if (etiquetaMatch) {
        await ponerEtiqueta(subscriber_id, etiquetaMatch[1]);
        respuesta = respuesta.replace(/ETIQUETA:[a-z-]+/g, "").trim();
      }
    }

    // Alertas
    if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
      const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
      alerta = "ALERTA_VISITA_CONFIRMADA";
      respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
      await mandarAlerta(`✅ VISITA CONFIRMADA\n${match?.[1] || telefono}\nResponde para coordinar detalles`);
      await mandarEventoMeta("Schedule", telefono);
    } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
      const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
      alerta = "ALERTA_VISITA_OTRO_DIA";
      respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
      await mandarAlerta(`📅 VISITA OTRO DÍA\nCliente: ${telefono}\nDía solicitado: ${match?.[1] || "no especificado"}\nConfirma disponibilidad`);
    } else if (respuesta.includes("ALERTA_AUDIO")) {
      alerta = "ALERTA_AUDIO";
      respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
      await mandarAlerta(`🎤 AUDIO RECIBIDO\nCliente: ${telefono}\nNo puedo escuchar audios — responde tú`);
    } else if (respuesta.includes("ALERTA_NO_SABE")) {
      alerta = "ALERTA_NO_SABE";
      respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
      await mandarAlerta(`❓ NO SABE RESPONDER\nCliente: ${telefono}\nPregunta: ${mensaje}\nEntra al chat y responde tú`);
    }

    res.json({ respuesta, alerta: alerta || null, foto });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// ============================================================
// REPORTE DIARIO — se activa manualmente con /reporte
// ============================================================
app.get("/reporte", async (req, res) => {
  const total = Object.keys(conversaciones).length;
  const reporte = `📊 Reporte Privada Encino\nConversaciones activas: ${total}\nFecha: ${new Date().toLocaleDateString('es-MX')}`;
  await mandarAlerta(reporte);
  res.json({ status: "Reporte enviado", total });
});

// ============================================================
// RUTA DE VERIFICACIÓN
// ============================================================
app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel — Privada Encino funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
