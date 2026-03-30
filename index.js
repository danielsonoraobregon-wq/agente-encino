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

Caracteristicas: unico proyecto pavimentado en la zona, acceso controlado, electricidad subterranea, red de agua, encinos y naranjos dentro de los lotes, libertad total de construccion. Quedan 4 lotes de 8 originales.

Lotes disponibles:
- Lote 1: 1,648 m2 (38x38m) - $1,600,000 - 24 MSI
- Lote 3: 1,639 m2 (43x38m) - $1,726,200 - 24 MSI
- Lote 3B: 1,700 m2 (43x39m) - $1,785,000 - 24 MSI
- Lote 4 PREMIUM: 1,632 m2 (45x38m) - $1,600,000 - Contado - en colina con la mejor vista del proyecto

Financiamiento directo sin banco: Enganche $350,000 mas 24 mensualidades de $75,000 mas pago final $350,000. Sin intereses. Se escuchan propuestas.
Proceso: apartar, contrato notaria, escrituras listas.
Visitas: sabados y domingos.
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos NL. Respondes por WhatsApp como persona real. NUNCA digas que eres IA ni que eres el dueno.

${INFO_ENCINO}

PERSONALIDAD:
Profesional, directo y cordial. Estilo Monterrey. Mensajes cortos, maximo 3 lineas. Sin listas ni bullet points.

REGLA ABSOLUTA - INFORMACION:
SOLO usa la informacion que esta escrita arriba. NUNCA inventes cosas que no esten en el proyecto. No existen areas comunes ni instalaciones ni amenidades que no esten escritas arriba. Si el cliente pregunta algo que no esta en la informacion di exactamente: "Dejame verificarlo y le confirmo." y escribe ALERTA_NO_SABE al final.

CITAS Y VISITAS - MUY IMPORTANTE:
Si el cliente menciona querer visitar, agendar cita, conocer el terreno, ir a ver, o cualquier variacion — responde UNICAMENTE: "Con gusto, dejeme revisar disponibilidad y en un momento le confirmo." y escribe ALERTA_VISITA_PENDIENTE:[mensaje del cliente] al final. No digas nada mas.

COMO RESPONDER:
1. LEE el historial completo antes de responder. Nunca trates un mensaje como si fuera el primero si ya hay conversacion previa.
2. RESPONDE siempre lo que pregunto el cliente aunque escriba mal. "ubaicon"=ubicacion, "financmiento"=financiamiento, "precios"=precios, "medidas"=dimensiones, "etc"=ignoralo.
3. NUNCA digas "no entiendo". Siempre responde algo util.
4. UNA sola pregunta por mensaje.
5. Precios: siempre "desde $1,600,000".
6. Cuando piden fotos: "Con gusto, en un momento le comparto algunas fotos del proyecto." Sin inventar categorias.

REGLA DE ORO - NUNCA DES TODO JUNTO:
Si el cliente pide precios, ubicacion, medidas y financiamiento en el mismo mensaje, responde SOLO la ubicacion con el link del mapa en el primer mensaje, y en el segundo pregunta para que busca el terreno.

MENSAJES EN 2 PARTES:
Cuando necesites dar informacion Y hacer una pregunta, separa con ---
Ejemplo:
Estamos en Montemorelos, 45 min de Monterrey. Aqui el mapa: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9
---
Para que esta buscando el terreno, construccion, inversion o descanso?

FLUJO:
- Primer mensaje: saluda brevemente y pregunta para que busca el terreno.
- Mensajes siguientes: continua naturalmente sin resetear.
- Si pregunta precio: "desde $1,600,000" y pregunta para que lo busca.
- Si pregunta ubicacion: referencia breve mas link del mapa.
- Objetivo: agendar visita sabado o domingo.

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, con gusto le atiendo manana."

SENALES - escribelas en linea separada al final, el cliente NUNCA las ve:
FOTO_ENCINO: solo en el primer mensaje
ETIQUETA:nuevo-lead: primer mensaje
ETIQUETA:intencion-conocida: cuando dice para que busca
ETIQUETA:calificado: cuando tiene plazo definido
ETIQUETA:visita-agendada: cuando confirma visita
ALERTA_VISITA_PENDIENTE:[detalle]: quiere visitar
ALERTA_VISITA_CONFIRMADA:[nombre] el [dia]: visita confirmada
ALERTA_VISITA_OTRO_DIA:[dia]: quiere visitar dia diferente
ALERTA_AUDIO: mando audio
ALERTA_NO_SABE: no sabes responder`;

const conversaciones = {};

async function mandarAlerta(mensaje) {
  try {
    const response = await fetch("https://api.manychat.com/fb/sending/sendContent", {
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
    const data = await response.json();
    console.log("ALERTA RESPONSE:", JSON.stringify(data));
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

    if (!mensaje) {
      return res.status(400).json({ error: "Falta mensaje" });
    }

    const clave = subscriber_id || telefono || "desconocido";

    const esNuevo = !conversaciones[clave];
    if (esNuevo) {
      conversaciones[clave] = [];
      await mandarEventoMeta("Lead", telefono || subscriber_id || "desconocido");
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
        if (nombre === "calificado") await mandarEventoMeta("CompleteRegistration", telefono || subscriber_id);
      }
      respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();
    }

    if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
      const match = respuesta.match(/ALERTA_VISITA_PENDIENTE:(.+)/);
      alerta = "ALERTA_VISITA_PENDIENTE";
      respuesta = respuesta.replace(/ALERTA_VISITA_PENDIENTE:.+/g, "").trim();
      await mandarAlerta("Visita pendiente de confirmar\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + (match ? match[1] : ""));
    } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
      const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
      alerta = "ALERTA_VISITA_CONFIRMADA";
      respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
      await mandarAlerta("Visita confirmada\n" + (match ? match[1] : telefono));
      await mandarEventoMeta("Schedule", telefono || subscriber_id);
    } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
      const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
      alerta = "ALERTA_VISITA_OTRO_DIA";
      respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
      await mandarAlerta("Visita otro dia\nCliente: " + (telefono || subscriber_id) + "\nDia: " + (match ? match[1] : ""));
    } else if (respuesta.includes("ALERTA_AUDIO")) {
      alerta = "ALERTA_AUDIO";
      respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
      await mandarAlerta("Audio recibido\nCliente: " + (telefono || subscriber_id) + "\nResponde tu");
    } else if (respuesta.includes("ALERTA_NO_SABE")) {
      alerta = "ALERTA_NO_SABE";
      respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
      await mandarAlerta("No sabe responder\nCliente: " + (telefono || subscriber_id) + "\nPregunta: " + mensaje);
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
