const express = require("express");
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const META_DATASET_ID = process.env.META_DATASET_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ALERTA_SUBSCRIBER_ID = process.env.ALERTA_SUBSCRIBER_ID;

const INFO_ENCINO = `
PRIVADA ENCINO - INFORMACION OFICIAL

Proyecto campestre en Area de La Morita, Montemorelos, NL.
Frente al Restaurant El Pariente. 5 min de Pueblo Salvaje, 3 min del Rio Blanquillo, 45 min de Monterrey.
Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

Caracteristicas: unico proyecto pavimentado en la zona, acceso controlado, electricidad subterranea, red de agua, encinos centenarios y naranjos en produccion, libertad total de construccion. Quedan 4 lotes de 8 originales.

Lotes:
- Lote 1: 1,648 m2 (38x38m) - $1,600,000 - 24 MSI
- Lote 3: 1,639 m2 (43x38m) - $1,726,200 - 24 MSI
- Lote 3B: 1,700 m2 (43x39m) - $1,785,000 - 24 MSI
- Lote 4 PREMIUM: 1,632 m2 (45x38m) - $1,600,000 - Contado - mejor vista del proyecto

Financiamiento directo sin banco: Enganche $350,000 + 24 mensualidades $75,000 + pago final $350,000. Sin intereses.
Proceso: apartar, contrato notaria, escrituras listas.
Visitas: sabados y domingos.
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos NL. Respondes por WhatsApp como persona real. NUNCA digas que eres IA ni que eres el dueno.

${INFO_ENCINO}

PERSONALIDAD:
Profesional, directo y cordial. Estilo Monterrey. Mensajes cortos, maximo 3 lineas. Sin listas ni bullet points.

COMO RESPONDER:
1. LEE el historial completo antes de responder. Nunca trates un mensaje como si fuera el primero si ya hay conversacion previa.
2. RESPONDE siempre lo que pregunto el cliente aunque escriba mal. "ubaicon"=ubicacion, "financmiento"=financiamiento, "precios"=precios, "medidas"=dimensiones, "etc"=ignoralo.
3. NUNCA digas "no entiendo" o "su mensaje no llego completo". Siempre responde algo util.
4. UNA sola pregunta por mensaje.
5. Precios: siempre "desde $1,600,000".

FLUJO:
- Primer mensaje: saluda brevemente y pregunta para que busca el terreno.
- Mensajes siguientes: continua la conversacion naturalmente sin resetear.
- Si pregunta precio: "desde $1,600,000" y pregunta para que lo busca.
- Si pregunta ubicacion: referencia breve mas link del mapa.
- Si quiere visitar: di "Dejame verificar disponibilidad, en un momento le confirmo" y escribe ALERTA_VISITA_PENDIENTE:[detalle].
- Objetivo: agendar visita sabado o domingo.

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, con gusto le atiendo manana."

CUANDO NO SABES ALGO: "Dejame verificarlo y le confirmo." y escribe ALERTA_NO_SABE al final.

SENALES - escribelas en linea separada al final, el cliente NUNCA las ve:
FOTO_ENCINO: solo en el primer mensaje de la conversacion
ETIQUETA:nuevo-lead: primer mensaje
ETIQUETA:intencion-conocida: cuando dice para que busca
ETIQUETA:calificado: cuando tiene plazo definido
ETIQUETA:visita-agendada: cuando confirma visita
ALERTA_VISITA_PENDIENTE:[detalle]: quiere visitar, pendiente confirmar
ALERTA_VISITA_CONFIRMADA:[nombre] el [dia]: visita confirmada
ALERTA_VISITA_OTRO_DIA:[dia]: quiere visitar dia diferente
ALERTA_AUDIO: mando audio
ALERTA_NO_SABE: no sabes responder`;

const conversaciones = {};

async function mandarAlerta(mensaje) {
  try {
    await fetch("https://api.manychat.com/fb/sending/sendContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + MANYCHAT_API_KEY
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
    await fetch("https://api.manychat.com/fb/subscriber/addTag", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + MANYCHAT_API_KEY
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
    await fetch("https://graph.facebook.com/v18.0/" + META_DATASET_ID + "/events", {
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

    console.log("DATOS:", JSON.stringify({ telefono, mensaje, subscriber_id }));

    if (!telefono || !mensaje) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const clave = telefono || subscriber_id;

    const esNuevo = !conversaciones[clave];
    if (esNuevo) {
      conversaciones[clave] = [];
      await mandarEventoMeta("Lead", telefono || "desconocido");
    }

    conversaciones[clave].push({ role: "user", content: mensaje });

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
        messages: conversaciones[clave]
      })
    });

    const data = await response.json();

    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Error Claude:", JSON.stringify(data));
      return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, alerta: null, foto: false });
    }

    let respuesta = data.content[0].text;
    console.log("RESPUESTA:", respuesta);

    conversaciones[clave].push({ role: "assistant", content: respuesta });

    if (conversaciones[clave].length > 20) {
      conversaciones[clave] = conversaciones[clave].slice(-20);
    }

    let alerta = null;
    let foto = false;

    if (respuesta.includes("FOTO_ENCINO")) {
      foto = true;
      respuesta = respuesta.replace(/FOTO_ENCINO/g, "").trim();
    }

    const etiquetasMatch = respuesta.match(/ETIQUETA:[a-zA-Z0-9_-]+/g);
    if (etiquetasMatch) {
      for (const e of etiquetasMatch) {
        const nombre = e.replace("ETIQUETA:", "");
        if (subscriber_id) await ponerEtiqueta(subscriber_id, nombre);
        if (nombre === "calificado") await mandarEventoMeta("CompleteRegistration", telefono);
      }
      respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();
    }

    if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
      const match = respuesta.match(/ALERTA_VISITA_PENDIENTE:(.+)/);
      alerta = "ALERTA_VISITA_PENDIENTE";
      respuesta = respuesta.replace(/ALERTA_VISITA_PENDIENTE:.+/g, "").trim();
      await mandarAlerta("Visita pendiente\nCliente: " + telefono + "\n" + (match ? match[1] : ""));
    } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
      const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
      alerta = "ALERTA_VISITA_CONFIRMADA";
      respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
      await mandarAlerta("Visita confirmada\n" + (match ? match[1] : telefono));
      await mandarEventoMeta("Schedule", telefono);
    } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
      const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
      alerta = "ALERTA_VISITA_OTRO_DIA";
      respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
      await mandarAlerta("Visita otro dia\nCliente: " + telefono + "\nDia: " + (match ? match[1] : ""));
    } else if (respuesta.includes("ALERTA_AUDIO")) {
      alerta = "ALERTA_AUDIO";
      respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
      await mandarAlerta("Audio recibido\nCliente: " + telefono + "\nResponde tu");
    } else if (respuesta.includes("ALERTA_NO_SABE")) {
      alerta = "ALERTA_NO_SABE";
      respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
      await mandarAlerta("No sabe responder\nCliente: " + telefono + "\nPregunta: " + mensaje);
    }

    const partes = respuesta.split("---");
    const respuesta1 = partes[0].trim();
    const respuesta2 = partes[1] ? partes[1].trim() : null;

    res.json({ respuesta1, respuesta2, alerta: alerta || null, foto });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/reporte", async (req, res) => {
  const total = Object.keys(conversaciones).length;
  const fecha = new Date().toLocaleDateString("es-MX");
  await mandarAlerta("Reporte Privada Encino\nConversaciones: " + total + "\n" + fecha);
  res.json({ status: "Reporte enviado", total: total });
});

app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel - Privada Encino funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("Servidor corriendo en puerto " + PORT);
});
