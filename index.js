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
const CONTENT_MAPA = "content20260416180826_242262";
const CONTENT_LOTE_PREMIUM = "content20260416171717_406525";

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

const procesando = new Set();
const cooldownMemoria = new Map();

// Limpiar cooldownMemoria cada hora para evitar memory leak
setInterval(() => {
  const hace5min = Date.now() - 300000;
  for (const [clave, ts] of cooldownMemoria.entries()) {
    if (ts < hace5min) cooldownMemoria.delete(clave);
  }
}, 3600000);

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
Profesional, directo y cordial. Estilo Monterrey. Mensajes cortos en conversacion normal (maximo 3 lineas). Cuando des informacion especifica (precios, ubicacion, financiamiento) puedes usar las lineas que necesites. Sin listas ni bullet points. Siempre en espanol sin importar el idioma del cliente.

REGLA ABSOLUTA - INFORMACION:
SOLO usa la informacion que esta escrita arriba. NUNCA inventes cosas que no esten en el proyecto. Si el cliente pregunta algo que no esta en la informacion di exactamente: "Dejame verificarlo y le confirmo." y escribe ALERTA_NO_SABE al final.

CITAS Y VISITAS - MUY IMPORTANTE:
Si el cliente menciona querer visitar, agendar cita, conocer el terreno, ir a ver, o cualquier variacion — responde UNICAMENTE: "Con gusto, dejeme revisar disponibilidad y en un momento le confirmo." y escribe ALERTA_VISITA_PENDIENTE:[mensaje del cliente] al final. No digas nada mas.

MANEJO DE OBJECIONES:
- "Esta muy lejos" o similar: "Estamos a solo 45 min de Monterrey por carretera, 5 min de Pueblo Salvaje y 3 min del Rio Blanquillo. La mayoria de nuestros clientes vienen de Monterrey."
- "Esta caro" o "es mucho": "Entiendo. Para orientarme mejor, que presupuesto estaria manejando?"
- "No tengo el enganche" o "no tengo para el enganche": "El plan de pagos es flexible, podemos ajustarlo a su situacion. Que monto de enganche le acomodaria?"
- "Mandame mas informacion" o "mandame info" o "mandame algo": Responde con los precios de los 3 lotes (usando MAPA_DISPONIBILIDAD) + "Contamos con financiamiento directo sin intereses. Le gustaria conocer el plan de pagos?"
- "Se lo paso a mi esposa" o familiar o socio: "Con gusto, le comparto el folleto con toda la informacion para que lo revisen juntos. Lo ideal es conocer el terreno en persona, tenemos visitas sabados y domingos. Le gustaria que agendemos?" y escribe PDF_ENCINO al final.
- "Vi otro proyecto" o competencia: "Privada Encino es el unico proyecto completamente pavimentado en la zona, con electricidad subterranea, acceso controlado y encinos dentro de los lotes. Que fue lo que mas le llamo la atencion del otro?"
- Pregunta por vecinos o quienes han comprado: "Hemos recibido mucho interes de familias de Monterrey que buscan un lugar tranquilo cerca de la ciudad."
- "Tienes folleto" o "tienen pagina" o "tienes algo que pueda ver": "Claro, le comparto el folleto completo. Lo ideal es conocer el terreno en persona, tenemos visitas sabados y domingos. Le gustaria que agendemos?" y escribe PDF_ENCINO al final.

PROCESO LEGAL - MUY IMPORTANTE:
Si el cliente pregunta por escrituras, proceso legal, si es ejidal, documentos o cualquier tema legal: responde "Es propiedad privada, no ejidal. Cada lote se escritura ante notario una vez liquidado. El proceso es sencillo: apartar con contrato y escrituras listas al liquidar." y escribe ALERTA_LEGAL al final.

UBICACION:
Cuando el cliente pida ubicacion, SIEMPRE incluye el link de Google Maps. Ejemplo:
"Estamos en La Morita, Montemorelos, frente al Restaurant El Pariente. A 45 min de Monterrey, 5 min de Pueblo Salvaje y 3 min del Rio Blanquillo.
Aqui le dejo la ubicacion: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9"
NUNCA des la ubicacion sin el link.

PRECIOS - MUY IMPORTANTE:
Cuando el cliente pida precios Y vas a listar los 3 lotes, escribe MAPA_DISPONIBILIDAD en linea separada ANTES de la lista. SOLO escribe MAPA_DISPONIBILIDAD cuando vayas a poner la lista de precios inmediatamente despues. NUNCA lo escribas en el primer mensaje de presentacion ni cuando no vas a listar precios.
Formato de precios con ~ tachado y * negritas. SIEMPRE pon una linea en blanco entre cada lote:
"Estos son los 3 lotes disponibles:

Lote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*

Lote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*

Lote 4 Premium - 1,632 m2, ~$2,075,000~ hoy en *$1,800,000*

Contamos con financiamiento directo sin intereses."
Despues de listar los precios, pregunta: "Le gustaria conocer el plan de pagos?" NUNCA preguntes "cual le llama la atencion" porque el cliente aun no ha visto los lotes fisicamente.
NUNCA des un rango generico como "van desde $1.7M hasta $1.8M". SIEMPRE detalla cada lote.
No preguntes directamente si busca para inversion — deja que el cliente lo mencione.

LOTE 4 PREMIUM:
Cuando el cliente pregunte especificamente por el Lote 4, la colina, la vista, o el lote premium, escribe VIDEO_COLINA en linea separada antes de responder sobre ese lote.

FINANCIAMIENTO (PLAN DE PAGOS) - DIFERENTE A PRECIOS:
Financiamiento NO es lo mismo que precios. Financiamiento es COMO se paga. Cuando el cliente pregunte por financiamiento, plan de pagos, mensualidades, enganche o como se paga, responde con el plan de pagos:
"Manejamos financiamiento directo sin banco y sin intereses.
Lotes 1 y 3B: Enganche $400,000 + 18 mensualidades desde $50,000 + pago final de $400,000
Lote 4 Premium: Enganche $400,000 + 12 mensualidades desde $55,000
El plan es flexible, podemos ajustarlo a su situacion."
Despues de dar el financiamiento, pregunta: "Se le acomoda este plan?" para saber si esta dentro de su presupuesto.
NUNCA respondas con precios cuando pregunten por financiamiento. Son cosas diferentes.

ESCALAMIENTO - FLUJO NATURAL DE VENTA:
Sigue este orden natural en la conversacion:
1. Precios → termina con "Contamos con financiamiento sin intereses. Le gustaria conocer el plan de pagos?"
2. Financiamiento → termina con "Se le acomoda este plan?"
3. Presupuesto OK → manda PDF_ENCINO y responde: "Le comparto el folleto con todo el detalle. Lo ideal es conocer el terreno en persona, tenemos disponibilidad sabados y domingos. Le gustaria visitarnos?"
4. Visita → ALERTA_VISITA_PENDIENTE
Cada paso lleva al siguiente. NUNCA saltes pasos ni des todo junto.

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
Usa --- SOLO cuando des un bloque grande de informacion (precios, ubicacion, financiamiento) Y ademas quieras hacer una pregunta. Para respuestas cortas conversacionales NUNCA uses ---. Ejemplo CORRECTO sin separar: "Claro, con gusto le escribo la proxima semana. Que dia le vendria mejor?"

FLUJO:
- Si el historial esta vacio y el cliente solo dice "hola" o saludo sin pedir nada: responde UNICAMENTE "Hola, soy Daniel Soliz. ¿En qué le puedo ayudar?" — nada mas, no agregues nada extra.
- Si el historial esta vacio y el cliente PIDE ALGO CONCRETO (precios, ubicacion, financiamiento, informes): di "Hola, soy Daniel Soliz, con gusto." en UNA linea y luego responde DIRECTAMENTE con lo que pidio. NUNCA preguntes "que busca" si ya te dijo que busca.
- Si YA HAY mensajes previos en el historial: NUNCA te presentes de nuevo, NUNCA digas "Hola soy Daniel Soliz" otra vez. Continua la conversacion naturalmente respondiendo lo que el cliente pidio.
- Objetivo: agendar visita sabado o domingo.

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, con gusto le atiendo manana a primera hora."

PRESUPUESTO:
Cuando el cliente confirme que el financiamiento le funciona, que si esta dentro de su presupuesto, que si le alcanza, o cualquier respuesta positiva sobre los precios o el plan de pagos: manda PDF_ENCINO y responde "Le comparto el folleto con todo el detalle. Lo ideal es conocer el terreno en persona, tenemos disponibilidad sabados y domingos. Le gustaria visitarnos?" y escribe ALERTA_PRESUPUESTO_OK al final.
Si el cliente dice que su presupuesto es menor a $1,000,000 o que no le alcanza, responde amablemente: "Entiendo, por el momento los lotes estan en ese rango de precio. Si mas adelante ajusta su presupuesto con gusto le atendemos." y escribe ALERTA_PRESUPUESTO_BAJO al final.

SEGUIMIENTO:
Si el cliente dice que quiere que le escribas despues, la proxima semana, mas adelante, o pide que lo contactes en otro momento, preguntale que dia le viene bien y escribe ALERTA_SEGUIMIENTO:[detalle] al final.

SENALES - escribelas en linea separada al final, el cliente NUNCA las ve:
PDF_ENCINO: cuando el cliente confirma presupuesto OK, pide info para compartir con alguien, dice "mandame info/folleto/algo", o pide material para revisar.
ALERTA_VISITA_PENDIENTE:[detalle]: quiere visitar
ALERTA_VISITA_CONFIRMADA:[nombre] el [dia]: visita confirmada
ALERTA_VISITA_OTRO_DIA:[dia]: quiere visitar dia diferente
ALERTA_AUDIO: mando audio
ALERTA_NO_SABE: no sabes responder
ALERTA_LEGAL: pregunta por temas legales o escrituras
ALERTA_PRESUPUESTO_OK: cliente confirma que el financiamiento/precio le funciona
ALERTA_PRESUPUESTO_BAJO: cliente dice que no le alcanza o su presupuesto es muy bajo
ALERTA_SEGUIMIENTO:[detalle]: cliente pide que lo contactes despues
MAPA_DISPONIBILIDAD: antes de mostrar precios, para que el cliente vea el mapa de lotes
VIDEO_COLINA: cuando preguntan por el Lote 4 Premium o la colina`;

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
    if (!data) {
      console.log("REDIS GET: conv:" + clave + " → VACIO (no existe)");
      return [];
    }
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    console.log("REDIS GET: conv:" + clave + " → " + parsed.length + " mensajes");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("REDIS GET ERROR:", clave, e.message);
    return [];
  }
}

async function setConversacion(clave, mensajes) {
  try {
    const key = "conv:" + clave;
    await redis.setex(key, 86400, JSON.stringify(mensajes));
    
    // Verificar que se guardo
    const check = await redis.get(key);
    if (check) {
      console.log("REDIS SAVE OK:", key, "mensajes:", mensajes.length);
    } else {
      console.error("REDIS SAVE FALLÓ:", key);
    }
  } catch (e) {
    console.error("REDIS SAVE ERROR:", clave, e.message);
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

const OWNER_SUBSCRIBER_ID = "187186203";

async function alertaOwner(titulo, leadId, conversacion) {
  try {
    if (!MANYCHAT_API_KEY) return;
    const ultimos = conversacion.slice(-6).map(m =>
      (m.role === "user" ? "Cliente: " : "Daniel: ") + m.content.slice(0, 150)
    ).join("\n");
    const texto = `🔥 LEAD CALIENTE - LLAMA HOY GOLÓN 🐔\n\nNombre/Teléfono: ${leadId}\n\nContexto:\n${ultimos}`;
    const res = await fetch("https://api.manychat.com/fb/sending/sendContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MANYCHAT_API_KEY },
      body: JSON.stringify({
        subscriber_id: OWNER_SUBSCRIBER_ID,
        data: {
          version: "v2",
          content: {
            messages: [{ type: "text", text: texto }]
          }
        }
      })
    });
    const result = await res.json();
    console.log("ALERTA OWNER RESPONSE:", JSON.stringify(result));
    console.log("ALERTA OWNER enviada:", titulo);
  } catch (e) {
    console.error("Error alerta owner:", e.message);
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
    console.log("MANDANDO CONTENIDO:", contentNs, "a subscriber:", subscriberId);
    if (!subscriberId) {
      console.error("ERROR: subscriber_id es null/undefined, no se puede mandar contenido");
      return;
    }
    if (!MANYCHAT_API_KEY) {
      console.error("ERROR: MANYCHAT_API_KEY no configurada");
      return;
    }
    const response = await fetch("https://api.manychat.com/fb/sending/sendFlow", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MANYCHAT_API_KEY },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        flow_ns: contentNs
      })
    });
    const data = await response.json();
    console.log("SEND FLOW RESPONSE:", contentNs, "status:", data.status, "respuesta:", JSON.stringify(data));
  } catch (e) {
    console.error("Error mandar contenido:", contentNs, e.message);
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
    const hoy = new Date().toISOString().slice(0, 10);
    const yaEnviado = await redis.get("reporte_diario:" + hoy);
    if (yaEnviado) return;
    await redis.setex("reporte_diario:" + hoy, 86400, "true");
    const leads = await redis.keys("lead:*");
    const visitas = await redis.keys("visita:*");
    const fecha = new Date().toLocaleDateString("es-MX");
    await mandarTelegram("Reporte diario Privada Encino\n" + fecha + "\n\nLeads totales: " + leads.length + "\nVisitas pendientes: " + visitas.length);
  } catch (e) {
    console.error("Error reporte:", e);
  }
}

async function reporteCitas() {
  try {
    const claves = await redis.keys("visita:*");
    if (claves.length === 0) {
      await mandarTelegram("RECORDATORIO DE CITAS\nViernes " + new Date().toLocaleDateString("es-MX") + "\n\nNo hay citas pendientes este fin de semana.");
      return;
    }
    let mensaje = "RECORDATORIO DE CITAS\nViernes " + new Date().toLocaleDateString("es-MX") + "\n";
    for (const clave of claves) {
      const data = await redis.get(clave);
      if (!data) continue;
      const visita = typeof data === "string" ? JSON.parse(data) : data;
      const clienteId = visita.clave || clave.replace("visita:", "");
      const detalle = visita.detalle || "sin detalle";
      mensaje += "\n- Cliente: " + clienteId + " | " + detalle;
    }
    mensaje += "\n\nTotal: " + claves.length + " cita(s) pendientes";
    await mandarTelegram(mensaje);
    console.log("REPORTE CITAS enviado:", claves.length, "citas");
  } catch (e) {
    console.error("Error reporte citas:", e);
  }
}

setInterval(verificarSeguimientos, 3600000);
setInterval(() => {
  const ahora = new Date();
  const horaMX = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Monterrey" }));
  if (horaMX.getHours() === 21 && horaMX.getMinutes() < 5) {
    reporteDiario();
  }
  // Reporte de citas los viernes a las 10am
  if (horaMX.getDay() === 5 && horaMX.getHours() === 10 && horaMX.getMinutes() < 5) {
    const semana = new Date().toISOString().slice(0, 10);
    redis.get("reporte_citas:" + semana).then(yaEnviado => {
      if (!yaEnviado) {
        redis.setex("reporte_citas:" + semana, 86400, "true");
        reporteCitas();
      }
    });
  }
}, 300000);

app.post("/webhook", async (req, res) => {
  try {
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    if (WEBHOOK_SECRET) {
      const token = req.headers["x-webhook-secret"] || req.body.secret;
      if (token !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: "No autorizado" });
      }
    }

    const { telefono, mensaje, subscriber_id, primer_mensaje } = req.body;
    console.log("BODY COMPLETO:", JSON.stringify(req.body));

    if (!mensaje) return res.status(400).json({ error: "Falta mensaje" });

    const clave = subscriber_id || telefono || "desconocido";
    console.log("=== WEBHOOK ===", "clave:", clave, "subscriber_id:", subscriber_id, "telefono:", telefono, "mensaje:", mensaje);

    if (procesando.has(clave)) {
      console.log("BLOQUEADO (procesando):", clave);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    // BLOQUEAR INMEDIATAMENTE antes de cualquier await
    procesando.add(clave);

    const ahoritaCooldown = cooldownMemoria.get(clave);
    if (ahoritaCooldown && Date.now() - ahoritaCooldown < 5000) {
      console.log("BLOQUEADO (cooldown memoria):", clave);
      procesando.delete(clave);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    const cooldownKey = "cooldown:" + clave;
    const enCooldown = await redis.get(cooldownKey);
    if (enCooldown) {
      console.log("BLOQUEADO (cooldown redis):", clave);
      procesando.delete(clave);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

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
          await ponerEtiqueta(subscriber_id, "conversacion privada encino");
          console.log("VIDEOS enviados + etiqueta conversacion para:", clave);
        } else {
          console.error("NO SE MANDARON VIDEOS: subscriber_id es null para clave:", clave);
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
      
      // DIAGNÓSTICO: si el lead no es nuevo pero la conversación está vacía, algo borró Redis
      if (!esNuevo && conversacion.length === 0) {
        console.error("⚠️ ALERTA: Lead NO es nuevo pero conversación está VACÍA para:", clave, "— Redis perdió el historial");
      }
      
      console.log("HISTORIAL:", clave, "esNuevo:", esNuevo, "mensajes:", conversacion.length);

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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-opus-4-7",
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages: conversacion
        })
      });
      
      clearTimeout(timeoutId);

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

      // Limpiar cualquier ETIQUETA que Claude escriba por inercia
      respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();

      if (respuesta.includes("MAPA_DISPONIBILIDAD")) {
        respuesta = respuesta.replace(/MAPA_DISPONIBILIDAD/g, "").trim();
        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_MAPA);
          console.log("MAPA enviado a:", subscriber_id);
        }
      }

      if (respuesta.includes("VIDEO_COLINA")) {
        respuesta = respuesta.replace(/VIDEO_COLINA/g, "").trim();
        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_LOTE_PREMIUM);
          console.log("VIDEO COLINA enviado a:", subscriber_id);
        }
      }

      if (respuesta.includes("PDF_ENCINO")) {
        mandarPDF = true;
        respuesta = respuesta.replace(/PDF_ENCINO/g, "").trim();
        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_PDF);
        }
        console.log("PDF enviado a:", telefono || subscriber_id);
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
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "cita privada encino");

      } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
        const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
        alerta = "ALERTA_VISITA_CONFIRMADA";
        respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
        await mandarTelegram("VISITA CONFIRMADA\n" + (match ? match[1] : telefono));
        await mandarEventoMeta("Schedule", telefono || subscriber_id);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "cita privada encino");

      } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
        const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
        alerta = "ALERTA_VISITA_OTRO_DIA";
        respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
        await mandarTelegram("Visita otro dia\nCliente: " + (telefono || subscriber_id) + "\nDia: " + (match ? match[1] : ""));

      } else if (respuesta.includes("ALERTA_AUDIO")) {
        alerta = "ALERTA_AUDIO";
        respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
        await setBotCongelado(clave, true);

      } else if (respuesta.includes("ALERTA_LEGAL")) {
        alerta = "ALERTA_LEGAL";
        respuesta = respuesta.replace(/ALERTA_LEGAL/g, "").trim();

      } else if (respuesta.includes("ALERTA_NO_SABE")) {
        alerta = "ALERTA_NO_SABE";
        respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
        await mandarTelegram("No sabe responder\nCliente: " + (telefono || subscriber_id) + "\nPregunta: " + mensaje);

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_OK")) {
        alerta = "ALERTA_PRESUPUESTO_OK";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_OK/g, "").trim();
        await mandarEventoMeta("CompleteRegistration", telefono || subscriber_id);
        await alertaOwner("💰 LEAD CON PRESUPUESTO OK — PRIORITARIO", telefono || subscriber_id, conversacion);

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_BAJO")) {
        alerta = "ALERTA_PRESUPUESTO_BAJO";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_BAJO/g, "").trim();

      } else if (respuesta.includes("ALERTA_SEGUIMIENTO")) {
        const match = respuesta.match(/ALERTA_SEGUIMIENTO:(.+)/);
        alerta = "ALERTA_SEGUIMIENTO";
        respuesta = respuesta.replace(/ALERTA_SEGUIMIENTO:.+/g, "").trim();
        const detalle = match ? match[1] : "";
        await mandarTelegram("SEGUIMIENTO\nCliente: " + (telefono || subscriber_id) + "\nPide contacto: " + detalle);
      }

      if (respuesta.includes("ALERTA_PDF_ENVIADO")) {
        respuesta = respuesta.replace(/ALERTA_PDF_ENVIADO/g, "").trim();
      }

      const partes = respuesta.split("---");
      const respuesta1 = partes[0].trim().replace(/\n{3,}/g, "\n\n");
      const respuesta2 = partes[1] ? partes[1].trim().replace(/\n{3,}/g, "\n\n") : null;

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

app.get("/citas", async (req, res) => {
  if (req.query.secret !== "daniel2024") {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  await reporteCitas();
  res.json({ status: "Reporte de citas enviado a Telegram" });
});

app.get("/limpiar", async (req, res) => {
  if (req.query.secret !== "daniel2024") {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  try {
    const claves = await redis.keys("conv:*");
    for (const c of claves) await redis.del(c);
    const congelados = await redis.keys("congelado:*");
    for (const c of congelados) await redis.del(c);
    const cooldowns = await redis.keys("cooldown:*");
    for (const c of cooldowns) await redis.del(c);
    const leads = await redis.keys("lead:*");
    for (const c of leads) await redis.del(c);
    const seguimientos = await redis.keys("seguimiento:*");
    for (const c of seguimientos) await redis.del(c);
    const frios = await redis.keys("frio:*");
    for (const c of frios) await redis.del(c);
    res.json({ 
      status: "Todo limpiado", 
      conversaciones: claves.length, 
      leads: leads.length,
      seguimientos: seguimientos.length 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/estado/:clave", async (req, res) => {
  if (req.query.secret !== "daniel2024") {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  try {
    const clave = req.params.clave;
    const conv = await redis.get("conv:" + clave);
    const lead = await redis.get("lead:" + clave);
    const congelado = await redis.get("congelado:" + clave);
    const seguimiento = await redis.get("seguimiento:" + clave);
    const visita = await redis.get("visita:" + clave);
    
    let convParsed = null;
    if (conv) {
      convParsed = typeof conv === "string" ? JSON.parse(conv) : conv;
    }
    
    res.json({
      clave,
      conversacion: convParsed ? { mensajes: convParsed.length, contenido: convParsed } : null,
      esLead: !!lead,
      congelado: !!congelado,
      seguimiento: seguimiento ? (typeof seguimiento === "string" ? JSON.parse(seguimiento) : seguimiento) : null,
      visita: visita ? (typeof visita === "string" ? JSON.parse(visita) : visita) : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel - Privada Encino v3.6 funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor Daniel v3.6 corriendo en puerto " + PORT);
});
