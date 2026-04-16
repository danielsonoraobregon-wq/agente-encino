const express = require("express");
const app = express();
app.use(express.json());

const { Redis } = require("@upstash/redis");
const crypto = require("crypto");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const META_DATASET_ID = process.env.META_DATASET_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const ALERTA_SUBSCRIBER_ID = process.env.ALERTA_SUBSCRIBER_ID;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const CONTENT_VIDEOS = "content20260416013522_274702";
const CONTENT_PDF = "content20260416014533_080509";

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

const procesando = new Set();
const cooldownMemoria = new Map();

const INFO_ENCINO = `
PRIVADA ENCINO - INFORMACION OFICIAL

Proyecto campestre en Area de La Morita, Montemorelos, NL.
Frente al Restaurant El Pariente. 5 min de Pueblo Salvaje, 3 min del Rio Blanquillo, 45 min de Monterrey.
Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

Caracteristicas: unico proyecto pavimentado en la zona, acceso controlado, electricidad subterranea, red de agua, encinos y naranjos dentro de los lotes, libertad total de construccion. Ultimos 3 lotes de 8 originales.

PROPIEDAD PRIVADA, NO EJIDAL. Cada lote se escritura ante notario una vez liquidado el precio total. El proceso es: apartar con contrato, escrituras listas al liquidar. Sin complicaciones legales.

Lotes disponibles (PRECIO DE LANZAMIENTO - ULTIMOS 3 LOTES):
- Lote 1: 1,648 m2 (38x38m) - Precio original $2,000,000, hoy en $1,700,000 (ahorro $300,000) - 18 MSI
- Lote 3B: 1,700 m2 (43x39m) - Precio original $2,100,000, hoy en $1,785,000 (ahorro $315,000) - 18 MSI
- Lote 4 PREMIUM: 1,632 m2 (45x38m) - Precio original $2,075,000, hoy en $1,800,000 (ahorro $275,000) - 12 MSI - en colina con la mejor vista del proyecto

Plan de pagos SUGERIDO (negociable segun situacion del cliente):
- Lote 1 y 3B (18 MSI): Enganche $400,000 + 18 mensualidades iguales + pago final $400,000 al liquidar
- Lote 4 PREMIUM (12 MSI): Enganche $400,000 + 12 mensualidades iguales
- El enganche, mensualidades y plazos son negociables. Se escuchan propuestas.
- Financiamiento directo sin banco, sin intereses.

Proceso: apartar, contrato notaria, escrituras al liquidar.
Visitas: sabados y domingos.
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos NL. Respondes por WhatsApp como persona real. NUNCA digas que eres IA ni que eres el dueno.

${INFO_ENCINO}

PERSONALIDAD:
Profesional, directo y cordial. Estilo Monterrey. Mensajes cortos, maximo 3 lineas. Sin listas ni bullet points. Siempre en espanol sin importar el idioma del cliente.

PRESENTACION:
En el primer mensaje presentate como: "Hola, soy Daniel Soliz, le estare compartiendo informacion sobre Privada Encino."

REGLA ABSOLUTA - INFORMACION:
SOLO usa la informacion que esta escrita arriba. NUNCA inventes cosas que no esten en el proyecto. Si el cliente pregunta algo que no esta en la informacion di exactamente: "Dejame verificarlo y le confirmo." y escribe ALERTA_NO_SABE al final.

CITAS Y VISITAS - MUY IMPORTANTE:
Si el cliente menciona querer visitar, agendar cita, conocer el terreno, ir a ver, o cualquier variacion — responde UNICAMENTE: "Con gusto, dejeme revisar disponibilidad y en un momento le confirmo." y escribe ALERTA_VISITA_PENDIENTE:[mensaje del cliente] al final. No digas nada mas.

MANEJO DE OBJECIONES:
- "Esta muy lejos" o similar: "Estamos a solo 45 min de Monterrey por carretera, 5 min de Pueblo Salvaje y 3 min del Rio Blanquillo. La mayoria de nuestros clientes vienen de Monterrey."
- "Esta caro" o "es mucho": "Entiendo. Para orientarme mejor, que presupuesto estaria manejando?"
- "No tengo el enganche" o "no tengo para el enganche": "El plan de pagos es flexible, podemos ajustarlo a su situacion. Que plazo le acomodaria?"
- "Mandame mas informacion": "Con gusto. Que le interesa saber mas, la ubicacion, los precios, las medidas o el financiamiento?"
- "Se lo paso a mi esposa" o familiar: "Con gusto, le puedo compartir el PDF con toda la informacion para que lo revisen juntos."
- "Vi otro proyecto" o competencia: "Privada Encino es el unico proyecto completamente pavimentado en la zona, con electricidad subterranea, acceso controlado y encinos dentro de los lotes. Que fue lo que mas le llamo la atencion del otro?"
- Pregunta por vecinos o quienes han comprado: "Hemos recibido mucho interes de familias de Monterrey que buscan un lugar tranquilo cerca de la ciudad."

PROCESO LEGAL - MUY IMPORTANTE:
Si el cliente pregunta por escrituras, proceso legal, si es ejidal, documentos o cualquier tema legal: responde "Es propiedad privada, no ejidal. Cada lote se escritura ante notario una vez liquidado. El proceso es sencillo: apartar con contrato y escrituras listas al liquidar." y escribe ALERTA_LEGAL al final.

UBICACION:
Cuando el cliente pida ubicacion, SIEMPRE incluye el link de Google Maps. Ejemplo:
"Estamos en La Morita, Montemorelos, frente al Restaurant El Pariente. A 45 min de Monterrey, 5 min de Pueblo Salvaje y 3 min del Rio Blanquillo.
Aqui le dejo la ubicacion: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9"
NUNCA des la ubicacion sin el link.

PRECIOS - MUY IMPORTANTE:
Cuando el cliente pida precios, SIEMPRE lista los 3 lotes con el precio original tachado usando ~ de WhatsApp. Ejemplo exacto:
"Estos son los 3 lotes disponibles:
Lote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*
Lote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*
Lote 4 Premium - 1,632 m2, ~$2,075,000~ hoy en *$1,800,000*"
NUNCA des un rango generico como "van desde $1.7M hasta $1.8M". SIEMPRE detalla cada lote con el formato de arriba.
No preguntes directamente si busca para inversion — deja que el cliente lo mencione.

FINANCIAMIENTO (PLAN DE PAGOS) - DIFERENTE A PRECIOS:
Financiamiento NO es lo mismo que precios. Financiamiento es COMO se paga. Cuando el cliente pregunte por financiamiento, plan de pagos, mensualidades, enganche o como se paga, responde con el plan de pagos:
"Manejamos financiamiento directo sin banco y sin intereses.
Lotes 1 y 3B: Enganche $400,000 + 18 mensualidades + pago final de $400,000
Lote 4 Premium: Enganche $400,000 + 12 mensualidades
El plan es flexible, podemos ajustarlo a su situacion."
NUNCA respondas con precios cuando pregunten por financiamiento. Son cosas diferentes.

REGLA CRITICA - NO ALUCINAR INFORMACION ENVIADA:
La informacion de arriba (precios, lotes, ubicacion) es TU conocimiento interno. El cliente NO la ha visto a menos que TU la hayas escrito en un mensaje anterior en esta conversacion. NUNCA digas "ya se los mande", "como le mencione", "arriba le puse" ni nada similar a menos que puedas ver que TU realmente escribiste esa informacion en tus mensajes anteriores del historial. Si el cliente pide algo que no le has dado, DASELO aunque tu ya lo "sepas".

COMO RESPONDER:
1. LEE el historial completo antes de responder. Revisa TUS mensajes anteriores para saber que ya le diste y que no.
2. LEE el primer mensaje con atencion — si dice precios responde precios, si dice ubicacion responde ubicacion. No saludes generico si ya hay intencion clara.
3. RESPONDE siempre aunque escriba mal. "ubaicon"=ubicacion, "financmiento"=financiamiento.
4. NUNCA digas "no entiendo". Siempre responde algo util.
5. UNA sola pregunta por mensaje.
6. Siempre en espanol aunque el cliente escriba en otro idioma.

REGLA DE ORO - NO SATURES PERO RESPONDE LO QUE PIDEN:
Si el cliente pide 1 cosa, responde esa cosa.
Si el cliente pide 2 cosas (ej: "ubicacion y precios"), responde AMBAS pero separadas con --- para que lleguen como mensajes diferentes.
Si el cliente pide 3 o mas cosas a la vez, responde las 2 mas importantes separadas con --- y pregunta por el resto.
NUNCA ignores algo que el cliente pidio explicitamente.

MENSAJES EN 2 PARTES:
Cuando necesites dar informacion Y hacer una pregunta, separa con ---

FLUJO:
- Si el historial esta vacio (primer mensaje del cliente): presentate como Daniel Soliz y pregunta que busca.
- Si el historial esta vacio y el mensaje tiene intencion clara (precios, ubicacion, etc): presentate BREVEMENTE en 1 linea y responde directo lo que pidio.
- Si YA HAY mensajes previos en el historial: NUNCA te presentes de nuevo, NUNCA digas "Hola soy Daniel Soliz" otra vez. Continua la conversacion naturalmente respondiendo lo que el cliente pidio.
- Objetivo: agendar visita sabado o domingo.

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, con gusto le atiendo manana a primera hora."

PRESUPUESTO Y FINANCIAMIENTO:
Cuando el cliente confirme que el financiamiento le funciona, que si esta dentro de su presupuesto, que si le alcanza, o cualquier respuesta positiva sobre los precios o el plan de pagos, escribe ALERTA_PRESUPUESTO_OK al final.
Si el cliente dice que su presupuesto es menor a $1,000,000 o que no le alcanza, responde amablemente: "Entiendo, por el momento los lotes estan en ese rango de precio. Si mas adelante ajusta su presupuesto con gusto le atendemos." y escribe ALERTA_PRESUPUESTO_BAJO al final.

SENALES - escribelas en linea separada al final, el cliente NUNCA las ve:
PDF_ENCINO: cuando el cliente califica (tiene intencion clara y plazo definido) o pide info para compartir con familiar
ETIQUETA:nuevo-lead: primer mensaje
ETIQUETA:intencion-conocida: cuando dice que busca
ETIQUETA:calificado: cuando tiene plazo definido
ETIQUETA:visita-agendada: cuando confirma visita
ALERTA_VISITA_PENDIENTE:[detalle]: quiere visitar
ALERTA_VISITA_CONFIRMADA:[nombre] el [dia]: visita confirmada
ALERTA_VISITA_OTRO_DIA:[dia]: quiere visitar dia diferente
ALERTA_AUDIO: mando audio
ALERTA_NO_SABE: no sabes responder
ALERTA_LEGAL: pregunta por temas legales o escrituras
ALERTA_PDF_ENVIADO: cuando mandas el PDF
ALERTA_PRESUPUESTO_OK: cliente confirma que el financiamiento/precio le funciona
ALERTA_PRESUPUESTO_BAJO: cliente dice que no le alcanza o su presupuesto es muy bajo`;

function hashSHA256(valor) {
  if (!valor) return null;
  return crypto.createHash("sha256").update(valor.toLowerCase().trim()).digest("hex");
}

function dentroDeHorario() {
  const ahora = new Date();
  const horaMX = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Monterrey" }));
  const hora = horaMX.getHours();
  return hora >= 9 && hora < 21;
}

async function getConversacion(clave) {
  try {
    const data = await redis.get("conv:" + clave);
    if (!data) return [];
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch (e) {
    console.error("Error Redis get:", e);
    return [];
  }
}

async function setConversacion(clave, mensajes) {
  try {
    await redis.setex("conv:" + clave, 86400, JSON.stringify(mensajes));
  } catch (e) {
    console.error("Error Redis set:", e);
  }
}

async function getBotCongelado(clave) {
  try {
    const val = await redis.get("congelado:" + clave);
    return val === "true" || val === true;
  } catch (e) {
    return false;
  }
}

async function setBotCongelado(clave, valor) {
  try {
    if (valor) {
      await redis.setex("congelado:" + clave, 86400, "true");
    } else {
      await redis.del("congelado:" + clave);
    }
  } catch (e) {
    console.error("Error Redis congelado:", e);
  }
}

async function esNuevoLead(clave) {
  try {
    const val = await redis.get("lead:" + clave);
    if (!val) {
      await redis.setex("lead:" + clave, 2592000, "true");
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function guardarVisita(clave, detalle) {
  try {
    const visita = { clave, detalle, timestamp: Date.now() };
    await redis.setex("visita:" + clave, 604800, JSON.stringify(visita));
  } catch (e) {
    console.error("Error guardar visita:", e);
  }
}

async function mandarTelegram(mensaje) {
  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensaje })
    });
  } catch (e) {
    console.error("Error Telegram:", e);
  }
}

async function ponerEtiqueta(subscriberId, etiqueta) {
  try {
    await fetch("https://api.manychat.com/fb/subscriber/addTag", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MANYCHAT_API_KEY },
      body: JSON.stringify({ subscriber_id: subscriberId, tag_name: etiqueta })
    });
  } catch (e) {
    console.error("Error etiqueta:", e);
  }
}

async function mandarContenido(subscriberId, contentNs) {
  try {
    const response = await fetch("https://api.manychat.com/fb/sending/sendFlow", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MANYCHAT_API_KEY },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        flow_ns: contentNs
      })
    });
    const data = await response.json();
    console.log("SEND FLOW RESPONSE:", JSON.stringify(data));
  } catch (e) {
    console.error("Error mandar contenido:", e);
  }
}

async function mandarEventoMeta(evento, telefono) {
  try {
    const telefonoHash = hashSHA256(telefono);
    if (!telefonoHash) return;
    await fetch("https://graph.facebook.com/v18.0/" + META_DATASET_ID + "/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name: evento,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "other",
          user_data: { ph: [telefonoHash] }
        }],
        access_token: META_ACCESS_TOKEN
      })
    });
  } catch (e) {
    console.error("Error Meta:", e);
  }
}

async function verificarSeguimientos() {
  try {
    const claves = await redis.keys("seguimiento:*");
    const ahora = Date.now();
    for (const clave of claves) {
      const data = await redis.get(clave);
      if (!data) continue;
      const seg = typeof data === "string" ? JSON.parse(data) : data;
      if (!seg.alertaEnviada && ahora - seg.timestamp > 172800000) {
        await mandarTelegram("Lead sin respuesta 48hrs\nSubscriber: " + seg.subscriberId + "\nUltimo mensaje: " + seg.ultimoMensaje);
        seg.alertaEnviada = true;
        await redis.setex(clave, 604800, JSON.stringify(seg));
      }
    }
    const clavesLeads = await redis.keys("frio:*");
    for (const clave of clavesLeads) {
      const data = await redis.get(clave);
      if (!data) continue;
      const lead = typeof data === "string" ? JSON.parse(data) : data;
      if (!lead.alertaEnviada && ahora - lead.timestamp > 604800000) {
        await mandarTelegram("Lead frio 7 dias\nSubscriber: " + lead.subscriberId + "\nConsiderar reactivar");
        lead.alertaEnviada = true;
        await redis.setex(clave, 604800, JSON.stringify(lead));
      }
    }
  } catch (e) {
    console.error("Error seguimientos:", e);
  }
}

async function reporteDiario() {
  try {
    const leads = await redis.keys("lead:*");
    const visitas = await redis.keys("visita:*");
    const fecha = new Date().toLocaleDateString("es-MX");
    await mandarTelegram("Reporte diario Privada Encino\n" + fecha + "\n\nLeads totales: " + leads.length + "\nVisitas pendientes: " + visitas.length);
  } catch (e) {
    console.error("Error reporte:", e);
  }
}

setInterval(verificarSeguimientos, 3600000);
setInterval(() => {
  const ahora = new Date();
  const horaMX = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Monterrey" }));
  if (horaMX.getHours() === 21 && horaMX.getMinutes() < 5) {
    reporteDiario();
  }
}, 300000);

app.post("/webhook", async (req, res) => {
  try {
    const { telefono, mensaje, subscriber_id, primer_mensaje } = req.body;
    console.log("BODY COMPLETO:", JSON.stringify(req.body));

    if (!mensaje) return res.status(400).json({ error: "Falta mensaje" });

    const clave = subscriber_id || telefono || "desconocido";

    if (procesando.has(clave)) {
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    const ahoritaCooldown = cooldownMemoria.get(clave);
    if (ahoritaCooldown && Date.now() - ahoritaCooldown < 5000) {
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    const cooldownKey = "cooldown:" + clave;
    const enCooldown = await redis.get(cooldownKey);
    if (enCooldown) {
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    procesando.add(clave);

    try {
      const congelado = await getBotCongelado(clave);
      if (congelado) {
        console.log("Bot congelado para:", clave);
        procesando.delete(clave);
        return res.json({ respuesta1: null, respuesta2: null, alerta: "congelado", foto: false });
      }

      if (!dentroDeHorario()) {
        procesando.delete(clave);
        return res.json({
          respuesta1: "Gracias por escribir, con gusto le atiendo manana a primera hora.",
          respuesta2: null, alerta: null, foto: false
        });
      }

      const esNuevo = await esNuevoLead(clave);
      if (esNuevo) {
        await mandarEventoMeta("Lead", telefono || subscriber_id || "desconocido");
        await redis.setex("seguimiento:" + clave, 604800, JSON.stringify({
          subscriberId: subscriber_id, timestamp: Date.now(), ultimoMensaje: mensaje, alertaEnviada: false
        }));
        await redis.setex("frio:" + clave, 1209600, JSON.stringify({
          subscriberId: subscriber_id, timestamp: Date.now(), alertaEnviada: false
        }));

        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_VIDEOS);
        }
      } else {
        const segData = await redis.get("seguimiento:" + clave);
        if (segData) {
          const seg = typeof segData === "string" ? JSON.parse(segData) : segData;
          seg.ultimoMensaje = mensaje;
          seg.timestamp = Date.now();
          seg.alertaEnviada = false;
          await redis.setex("seguimiento:" + clave, 604800, JSON.stringify(seg));
        }
      }

      let conversacion = await getConversacion(clave);
      console.log("HISTORIAL:", clave, "mensajes:", conversacion.length);

      if (primer_mensaje && conversacion.length === 0) {
        conversacion.push({
          role: "user",
          content: "[El cliente llego por un anuncio y su primer mensaje fue: " + primer_mensaje + "] " + mensaje
        });
      } else if (conversacion.length > 0) {
        conversacion.push({
          role: "user",
          content: "[Conversacion en curso, mensaje #" + (Math.floor(conversacion.length / 2) + 1) + " del cliente. NO te presentes de nuevo.] " + mensaje
        });
      } else {
        conversacion.push({ role: "user", content: mensaje });
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 16000,
          thinking: {
            type: "enabled",
            budget_tokens: 4096
          },
          system: SYSTEM_PROMPT,
          messages: conversacion
        })
      });

      const data = await response.json();

      if (data.content) {
        const tipos = data.content.map(b => b.type);
        console.log("CLAUDE BLOQUES:", tipos.join(", "), "| clave:", clave);
      }

      const textBlocks = data.content ? data.content.filter(b => b.type === "text") : [];
      if (!textBlocks.length) {
        console.error("Error Claude:", JSON.stringify(data));
        procesando.delete(clave);
        return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, alerta: null, foto: false });
      }

      let respuesta = textBlocks.map(b => b.text).join("\n").trim();
      console.log("RESPUESTA:", respuesta);

      conversacion.push({ role: "assistant", content: respuesta });
      if (conversacion.length > 20) conversacion = conversacion.slice(-20);
      await setConversacion(clave, conversacion);
      console.log("GUARDADO:", clave, "total mensajes:", conversacion.length);

      let alerta = null;
      let foto = false;
      let mandarPDF = false;

      const etiquetasMatch = respuesta.match(/ETIQUETA:[a-zA-Z0-9_-]+/g);
      if (etiquetasMatch) {
        for (const e of etiquetasMatch) {
          const nombre = e.replace("ETIQUETA:", "");
          if (subscriber_id) await ponerEtiqueta(subscriber_id, nombre);
          if (nombre === "calificado") await mandarEventoMeta("CompleteRegistration", telefono || subscriber_id);
        }
        respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();
      }

      if (respuesta.includes("PDF_ENCINO")) {
        mandarPDF = true;
        respuesta = respuesta.replace(/PDF_ENCINO/g, "").trim();
        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_PDF);
        }
        await mandarTelegram("PDF enviado\nCliente: " + (telefono || subscriber_id));
      }

      if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
        const match = respuesta.match(/ALERTA_VISITA_PENDIENTE:(.+)/);
        alerta = "ALERTA_VISITA_PENDIENTE";
        respuesta = respuesta.replace(/ALERTA_VISITA_PENDIENTE:.+/g, "").trim();
        const detalle = match ? match[1] : "";
        await mandarTelegram("VISITA PENDIENTE\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + detalle + "\nResponde TU para confirmar");
        await guardarVisita(clave, detalle);
        await setBotCongelado(clave, true);
        await mandarEventoMeta("InitiateCheckout", telefono || subscriber_id);

      } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
        const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
        alerta = "ALERTA_VISITA_CONFIRMADA";
        respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
        await mandarTelegram("VISITA CONFIRMADA\n" + (match ? match[1] : telefono));
        await mandarEventoMeta("Schedule", telefono || subscriber_id);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "visita-agendada");

      } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
        const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
        alerta = "ALERTA_VISITA_OTRO_DIA";
        respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
        await mandarTelegram("Visita otro dia\nCliente: " + (telefono || subscriber_id) + "\nDia: " + (match ? match[1] : ""));

      } else if (respuesta.includes("ALERTA_AUDIO")) {
        alerta = "ALERTA_AUDIO";
        respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
        await mandarTelegram("AUDIO recibido\nCliente: " + (telefono || subscriber_id) + "\nResponde TU");
        await setBotCongelado(clave, true);

      } else if (respuesta.includes("ALERTA_LEGAL")) {
        alerta = "ALERTA_LEGAL";
        respuesta = respuesta.replace(/ALERTA_LEGAL/g, "").trim();
        await mandarTelegram("ALERTA LEGAL - Cliente muy cercano a cerrar\nCliente: " + (telefono || subscriber_id) + "\nPregunta: " + mensaje);

      } else if (respuesta.includes("ALERTA_NO_SABE")) {
        alerta = "ALERTA_NO_SABE";
        respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
        await mandarTelegram("No sabe responder\nCliente: " + (telefono || subscriber_id) + "\nPregunta exacta: " + mensaje);

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_OK")) {
        alerta = "ALERTA_PRESUPUESTO_OK";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_OK/g, "").trim();
        await mandarEventoMeta("Lead", telefono || subscriber_id);
        await mandarTelegram("PRESUPUESTO OK - Cliente confirma que le funciona el financiamiento\nCliente: " + (telefono || subscriber_id) + "\nMensaje: " + mensaje);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "presupuesto-ok");

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_BAJO")) {
        alerta = "ALERTA_PRESUPUESTO_BAJO";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_BAJO/g, "").trim();
        await mandarTelegram("PRESUPUESTO BAJO - Cliente no alcanza\nCliente: " + (telefono || subscriber_id) + "\nMensaje: " + mensaje);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "fuera-de-presupuesto");
      }

      if (respuesta.includes("ALERTA_PDF_ENVIADO")) {
        respuesta = respuesta.replace(/ALERTA_PDF_ENVIADO/g, "").trim();
      }

      const resumenConversacion = conversacion
        .filter(m => m.role === "user")
        .map(m => m.content)
        .join(" | ");

      if (etiquetasMatch && etiquetasMatch.includes("ETIQUETA:calificado")) {
        await mandarTelegram("LEAD CALIFICADO\nCliente: " + (telefono || subscriber_id) + "\nResumen: " + resumenConversacion);
      }

      const partes = respuesta.split("---");
      const respuesta1 = partes[0].trim();
      const respuesta2 = partes[1] ? partes[1].trim() : null;

      cooldownMemoria.set(clave, Date.now());
      await redis.setex("cooldown:" + clave, 5, "true");
      procesando.delete(clave);
      res.json({ respuesta1, respuesta2, alerta: alerta || null, foto });

    } catch (innerError) {
      procesando.delete(clave);
      throw innerError;
    }

  } catch (error) {
    console.error("Error webhook:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/descongelar", async (req, res) => {
  try {
    const { clave } = req.body;
    if (!clave) return res.status(400).json({ error: "Falta clave" });
    await setBotCongelado(clave, false);
    res.json({ status: "Bot descongelado para: " + clave });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    const horaMX = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Monterrey" }));
    res.json({ status: "ok", redis: "conectado", hora: horaMX.toLocaleTimeString("es-MX"), dentroHorario: dentroDeHorario() });
  } catch (e) {
    res.status(500).json({ status: "error", redis: "desconectado" });
  }
});

app.get("/reporte", async (req, res) => {
  await reporteDiario();
  res.json({ status: "Reporte enviado" });
});

app.get("/limpiar", async (req, res) => {
  try {
    const claves = await redis.keys("conv:*");
    for (const c of claves) await redis.del(c);
    const congelados = await redis.keys("congelado:*");
    for (const c of congelados) await redis.del(c);
    const cooldowns = await redis.keys("cooldown:*");
    for (const c of cooldowns) await redis.del(c);
    res.json({ status: "Historial limpiado y bot descongelado", conversaciones_borradas: claves.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel - Privada Encino v3.4 (ultrathink) funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor Daniel v3.4 (ultrathink) corriendo en puerto " + PORT);
});
