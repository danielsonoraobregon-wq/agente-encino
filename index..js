const express = require("express");
const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
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
const TELEGRAM_CHAT_ID_ANGEL = process.env.TELEGRAM_CHAT_ID_ANGEL;

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
- Lote 4 PREMIUM: 1,632 m2 (45x38m) - Precio original $2,075,000, hoy en $1,900,000 (ahorro $175,000) - 12 MSI - en colina con la mejor vista del proyecto

Plan de pagos SUGERIDO (negociable segun situacion del cliente):
- Lote 1 y 3B (18 MSI): Enganche $400,000 + 18 mensualidades iguales + pago final $400,000 al liquidar
- Lote 4 PREMIUM (12 MSI): Enganche $400,000 + 12 mensualidades de $91,666 + pago final $400,000
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
- "Se lo paso a mi esposa" o familiar o socio: "Con gusto, le comparto el folleto con toda la informacion para que lo revisen juntos." y escribe PDF_ENCINO al final.
- "Vi otro proyecto" o competencia: "Privada Encino es el unico proyecto completamente pavimentado en la zona, con electricidad subterranea, acceso controlado y encinos dentro de los lotes. Que fue lo que mas le llamo la atencion del otro?"
- Pregunta por vecinos o quienes han comprado: "Hemos recibido mucho interes de familias de Monterrey que buscan un lugar tranquilo cerca de la ciudad."
- "Tienes folleto" o "tienen pagina" o "tienes algo que pueda ver": "Claro, le comparto el folleto completo." y escribe PDF_ENCINO al final.

PROCESO LEGAL - MUY IMPORTANTE:
Si el cliente pregunta por escrituras, proceso legal, si es ejidal, documentos o cualquier tema legal: responde "Es propiedad privada, no ejidal. Cada lote se escritura ante notario una vez liquidado. El proceso es sencillo: apartar con contrato y escrituras listas al liquidar." y escribe ALERTA_LEGAL al final.

UBICACION:
Cuando el cliente pida ubicacion, responde UNICAMENTE: "Le comparto la ubicacion de Google Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9"
NADA MAS. Sin descripcion de distancias ni referencias. Solo esa frase y el link.

PRECIOS vs FINANCIAMIENTO - DISTINCION ABSOLUTA:
PRECIO = cuanto CUESTA el lote (el valor en pesos). Palabras clave: "precio", "precios", "cuanto cuesta", "cuanto vale", "cuanto esta", "cuanto son".
FINANCIAMIENTO = COMO se paga (enganche, mensualidades, plazos). Palabras clave: "financiamiento", "plan de pagos", "mensualidades", "enganche", "como se paga", "plazos".
Si preguntan por PRECIOS → muestra la lista de lotes. JAMAS respondas con el plan de pagos cuando pidan precios.
Si preguntan por FINANCIAMIENTO → muestra el plan de pagos. JAMAS respondas con precios cuando pidan financiamiento.
Son cosas completamente distintas. NUNCA las mezcles ni las confundas.

PRECIOS - MUY IMPORTANTE:
Cuando el cliente pida precios Y vas a listar los 3 lotes, escribe MAPA_DISPONIBILIDAD en linea separada ANTES de la lista. SOLO escribe MAPA_DISPONIBILIDAD cuando vayas a poner la lista de precios inmediatamente despues. NUNCA lo escribas en el primer mensaje de presentacion ni cuando no vas a listar precios.
Formato de precios con ~ tachado y * negritas:
"Estos son los 3 lotes disponibles:

Lote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*

Lote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*

Lote 4 Premium - 1,632 m2, ~$2,075,000~ hoy en *$1,900,000*

Contamos con financiamiento directo sin intereses."
Despues de escribir ESA lista exacta, SIEMPRE agrega --- y luego: "Le gustaria conocer el plan de pagos? 💳" como mensaje separado.
NUNCA des un rango generico como "van desde $1.7M hasta $1.8M". SIEMPRE detalla cada lote.
No preguntes directamente si busca para inversion — deja que el cliente lo mencione.

LOTE 4 PREMIUM:
Cuando el cliente pregunte ESPECIFICAMENTE por el Lote 4, la colina, la vista, o el lote premium (no cuando muestras todos los precios), escribe VIDEO_COLINA en linea separada antes de responder sobre ese lote.
IMPORTANTE: Cuando muestres la lista general de precios de los 3 lotes, NUNCA escribas VIDEO_COLINA. VIDEO_COLINA SOLO aplica cuando el cliente pregunta exclusivamente por el Lote 4. Si el cliente pide "precios" o "cuanto cuestan", muestra la lista completa SIN escribir VIDEO_COLINA.

FINANCIAMIENTO (PLAN DE PAGOS) - DIFERENTE A PRECIOS:
Financiamiento es COMO se paga, no cuanto cuesta. Cuando el cliente pregunte por financiamiento, plan de pagos, mensualidades, enganche o como se paga, responde UNICAMENTE con el plan de pagos:
"Manejamos financiamiento directo sin banco y sin intereses.

Lotes 1 y 3B: Enganche $400,000 + 18 mensualidades desde $50,000 + pago final de $400,000

Lote 4 Premium: Enganche $400,000 + 12 mensualidades de $91,666 + pago final de $400,000

El plan es flexible, podemos ajustarlo a su situacion."
Despues de dar el financiamiento, pregunta: "¿Qué le parece este plan?"
NUNCA respondas con precios cuando pregunten por financiamiento. NUNCA respondas con financiamiento cuando pregunten por precios.

ESCALAMIENTO - FLUJO NATURAL DE VENTA:
Sigue este orden natural en la conversacion:
1. Precios → la lista de precios termina con "Contamos con financiamiento directo sin intereses." y DESPUES en mensaje separado (usando ---): "Le gustaria conocer el plan de pagos? 💳"
2. Financiamiento → termina con "¿Qué le parece este plan?"
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
Si el cliente pide 2 cosas (ej: "ubicacion y precios"), responde primero lo que NO son precios (ubicacion, amenidades, medidas, etc.) usando ---, y deja los precios con la pregunta de plan de pagos SIEMPRE AL FINAL. Los precios van siempre al ultimo cuando hay multiples temas.
Si el cliente pide 3 o mas cosas a la vez, responde las 2 mas importantes separadas con --- (precios siempre al final) y pregunta por el resto.
NUNCA ignores algo que el cliente pidio explicitamente.

MENSAJES EN 2 PARTES:
Usa --- SOLO cuando des un bloque grande de informacion (precios, ubicacion, financiamiento) Y ademas quieras hacer una pregunta. Para respuestas cortas conversacionales NUNCA uses ---. Ejemplo CORRECTO sin separar: "Claro, con gusto le escribo la proxima semana. Que dia le vendria mejor?"

FLUJO:
- Si el historial esta vacio Y el cliente NO dio contexto (solo dice "hola", "buenas", "info", "informacion" o algo generico): responde en 2 partes con ---. Primera parte: "Hola, soy Daniel Soliz, le estare compartiendo la informacion de Privada Encino." Segunda parte: "Que informacion buscaba sobre el proyecto?"
- Si el historial esta vacio Y el cliente PIDE ALGO CONCRETO (precios, ubicacion, financiamiento, fotos, medidas): di "Hola, soy Daniel Soliz, con gusto." en una sola linea, responde directamente lo que pidio, y al final agrega: "Le comparto lo que me pidio, si tiene alguna duda adicional estoy a sus ordenes." NUNCA preguntes "que informacion buscaba" si ya te dijo que busca. NUNCA uses este cierre en conversaciones donde el cliente empezo con saludo generico.
- Si YA HAY mensajes previos en el historial: NUNCA te presentes de nuevo. Continua la conversacion respondiendo lo que el cliente pidio.
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

async function mandarTelegram(mensaje, chatIdDestino = null) {
  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const targetChatId = chatIdDestino || process.env.TELEGRAM_CHAT_ID;
    if (!TELEGRAM_TOKEN || !targetChatId) return;
    await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: targetChatId, text: mensaje })
    });
  } catch (e) {
    console.error("Error Telegram:", e);
  }
}

async function mandarTelegramAngel(mensaje) {
  if (!TELEGRAM_CHAT_ID_ANGEL) {
    console.error("TELEGRAM_CHAT_ID_ANGEL no configurado");
    return;
  }
  await mandarTelegram(mensaje, TELEGRAM_CHAT_ID_ANGEL);
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
    // Notificar a Angel si lead dijo que le parece bien pero no agendo visita en 48h
    const clavesPresupuesto = await redis.keys("presupuesto_ok:*");
    for (const clave of clavesPresupuesto) {
      const data = await redis.get(clave);
      if (!data) continue;
      const pok = typeof data === "string" ? JSON.parse(data) : data;
      if (!pok.alertaAngelEnviada && ahora - pok.timestamp > 172800000) {
        const tieneVisita = await redis.get("visita:" + pok.clave);
        if (!tieneVisita) {
          const msg = (
            "SEGUIMIENTO PRESUPUESTO OK - SIN CITA
" +
            "Cliente: " + (pok.telefono || pok.subscriberId || pok.clave) + "
" +
            "Dijo que el plan le parece bien hace 48hrs pero no ha agendado visita.
" +
            "Se recomienda contactar para cerrar cita."
          );
          await mandarTelegramAngel(msg);
          console.log("ALERTA ANGEL enviada para:", pok.clave);
        }
        pok.alertaAngelEnviada = true;
        await redis.setex(clave, 259200, JSON.stringify(pok));
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
    reporteCitas();
  }
}, 300000);

app.post("/webhook", async (req, res) => {
  try {
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

      const esDaniel = telefono === "5218123793904" || subscriber_id === "5218123793904";
      if (!esDaniel && !dentroDeHorario()) {
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
          subscriberId: subscriber_id, telefono: telefono || null, timestamp: Date.now(), ultimoMensaje: mensaje, alertaEnviada: false
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

      // Llamada a Claude con reintentos automáticos (hasta 3 intentos)
      let data = null;
      let claudeOk = false;
      for (let intento = 1; intento <= 3; intento++) {
        try {
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
              model: "claude-sonnet-4-6",
              max_tokens: 800,
              system: SYSTEM_PROMPT,
              messages: conversacion
            })
          });
          clearTimeout(timeoutId);
          data = await response.json();
          if (response.ok && data.content && !data.error && data.type !== "error") {
            claudeOk = true;
            console.log("Claude OK en intento", intento, "| clave:", clave);
            break;
          }
          console.error("Claude intento", intento, "falló:", response.status, JSON.stringify(data));
          if (intento < 3) await new Promise(r => setTimeout(r, 1500 * intento));
        } catch (claudeErr) {
          console.error("Claude intento", intento, "excepción:", claudeErr.message);
          if (intento < 3) await new Promise(r => setTimeout(r, 1500 * intento));
        }
      }

      if (!claudeOk) {
        procesando.delete(clave);
        return res.json({ respuesta1: "Claro, con gusto le atiendo. Dame un momento.", respuesta2: null, alerta: null, foto: false });
      }

      if (data.content) {
        const tipos = data.content.map(b => b.type);
        console.log("CLAUDE BLOQUES:", tipos.join(", "), "| clave:", clave);
      }

      const textBlocks = data.content ? data.content.filter(b => b.type === "text") : [];
      if (!textBlocks.length) {
        console.error("Error Claude (sin bloques de texto):", JSON.stringify(data));
        procesando.delete(clave);
        return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, alerta: null, foto: false });
      }

      let respuesta = textBlocks.map(b => b.text).join("\n").trim();

      // Forzar saltos de linea correctos en la lista de precios
      if (respuesta.includes("Lote 1") && respuesta.includes("Lote 3B")) {
        respuesta = respuesta
          .replace(/(disponibles:)\s*(Lote)/g, "$1\n$2")
          .replace(/(\*\$[\d,]+\*)\s*(Lote)/g, "$1\n$2")
          .replace(/(\*\$[\d,]+\*)\s*(Contamos)/g, "$1\n$2")
          .replace(/(~\$[\d,]+~[^\n]*\*\$[\d,]+\*)\s*(Lote)/g, "$1\n$2")
          .replace(/(~\$[\d,]+~[^\n]*\*\$[\d,]+\*)\s*(Contamos)/g, "$1\n$2");
      }
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
        // Solo mandar video aqui si es pregunta especifica del Lote 4, NO lista general de precios
        // (la lista general lo maneja tienePrecios mas abajo)
        const esListaGeneral = respuesta.includes("Lote 1") && respuesta.includes("Lote 3B");
        if (!esListaGeneral && subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_LOTE_PREMIUM);
          console.log("VIDEO COLINA especifico Lote 4 enviado a:", subscriber_id);
        } else {
          console.log("VIDEO_COLINA ignorado: es lista general, tienePrecios lo manejara");
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
        // Guardar para notificar a Angel si en 48h no hay cita
        await redis.setex("presupuesto_ok:" + clave, 259200, JSON.stringify({
          clave, subscriberId: subscriber_id, telefono: telefono || null,
          timestamp: Date.now(), alertaAngelEnviada: false
        }));
        console.log("PRESUPUESTO_OK guardado para seguimiento Angel:", clave);

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

      // SAFETY NET: Si el usuario pidio precios y Claude no los incluyo, inyectar lista
      const usuarioPidioPrecios = /\bprecio|\bcuanto.*(cuesta|vale|son)|\bcuestan\b/i.test(mensaje);
      const claudeIncluyoPrecios = respuesta.includes("Lote 1") && respuesta.includes("Lote 3B");
      if (usuarioPidioPrecios && !claudeIncluyoPrecios) {
        console.error("SAFETY NET: usuario pidio precios pero Claude no los mando. Inyectando lista.");
        respuesta = "Estos son los 3 lotes disponibles:\n\nLote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*\n\nLote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*\n\nLote 4 Premium - 1,632 m2, ~$2,075,000~ hoy en *$1,900,000*\n\nContamos con financiamiento directo sin intereses.";
        if (subscriber_id) await mandarContenido(subscriber_id, CONTENT_MAPA);
        if (subscriber_id) await mandarContenido(subscriber_id, CONTENT_LOTE_PREMIUM);
      }

      const partes = respuesta.split("---");
      let respuesta1 = partes[0].trim();
      let respuesta2 = partes[1] ? partes[1].trim() : null;

      // Si la respuesta incluye la lista de precios, SIEMPRE forzar la pregunta de financiamiento como mensaje separado
      const tienePrecios = respuesta.includes("Lote 1") && respuesta.includes("Lote 3B") && respuesta.includes("Lote 4");
      if (tienePrecios) {
        // Auto-enviar video del lote premium antes de los precios
        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_LOTE_PREMIUM);
          console.log("VIDEO LOTE PREMIUM auto-enviado con precios a:", subscriber_id);
        }
        // Buscar la parte que realmente contiene los precios (Claude a veces pone --- antes de la lista)
        const parteConPrecios = partes.find(p => p.includes("Lote 1") && p.includes("Lote 3B")) || partes[0];
        respuesta1 = parteConPrecios
          .replace(/[\u00bf]?Le\s+gustar[\u00ed]a\s+conocer[^\n?]*\??\s*💳?/gi, "")
          .trim();
        // Siempre poner la pregunta fija como segundo mensaje
        respuesta2 = "¿Le gustaría conocer el plan de financiamiento? 💳";
        console.log("PRECIOS enviados, respuesta1 largo:", respuesta1.length, "chars");
      }

      console.log("ENVIANDO respuesta1:", respuesta1 ? respuesta1.substring(0, 120).replace(/\n/g, " | ") : "VACIA");
      console.log("ENVIANDO respuesta2:", respuesta2 || "null");
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

app.delete("/historial/:clave", async (req, res) => {
  const tel = req.query.telefono;
  if (tel !== "5218123793904") return res.status(403).json({ error: "No autorizado" });
  try {
    // Borrar por la clave recibida Y buscar en seguimientos si hay otra clave con ese teléfono
    const clave = req.params.clave;
    const clavesABorrar = new Set([clave]);

    // Buscar en seguimientos por teléfono o subscriber_id
    const todasClaves = await redis.keys("seguimiento:*");
    for (const k of todasClaves) {
      const seg = await redis.get(k);
      if (seg) {
        const s = typeof seg === "string" ? JSON.parse(seg) : seg;
        if (s.telefono === "5218123793904" || s.subscriberId === "5218123793904" || k.includes("5218123793904")) {
          clavesABorrar.add(k.replace("seguimiento:", ""));
        }
      }
    }

    for (const c of clavesABorrar) {
      await redis.del("conv:" + c);
      await redis.del("congelado:" + c);
      await redis.del("cooldown:" + c);
      await redis.del("lead:" + c);
      await redis.del("seguimiento:" + c);
      await redis.del("frio:" + c);
      await redis.del("visita:" + c);
    }
    res.json({ status: "Historial borrado", claves: [...clavesABorrar] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/dashboard", async (req, res) => {
  if (req.query.secret !== "daniel2024") return res.status(403).json({ error: "Acceso denegado" });
  try {
    const claves = await redis.keys("lead:*");
    const ahora = Date.now();
    const leads = [];

    for (const k of claves) {
      const clave = k.replace("lead:", "");
      const [convRaw, segRaw, congRaw, visitaRaw] = await Promise.all([
        redis.get("conv:" + clave),
        redis.get("seguimiento:" + clave),
        redis.get("congelado:" + clave),
        redis.get("visita:" + clave)
      ]);

      const conv = convRaw ? (typeof convRaw === "string" ? JSON.parse(convRaw) : convRaw) : [];
      const seg = segRaw ? (typeof segRaw === "string" ? JSON.parse(segRaw) : segRaw) : null;
      const visita = visitaRaw ? (typeof visitaRaw === "string" ? JSON.parse(visitaRaw) : visitaRaw) : null;
      const congelado = congRaw === "true" || congRaw === true;

      const mensajes = conv.length;
      const ultimoMensaje = seg ? seg.ultimoMensaje : (conv.length ? conv[conv.length - 1].content.slice(0, 80) : "");
      const timestamp = seg ? seg.timestamp : ahora;

      let score = "D", scoreColor = "#aaa", scoreLabel = "Frio", estado = "nuevo";
      if (visita) { score = "A+"; scoreColor = "#00b85a"; scoreLabel = "Visita pendiente"; estado = "visita_pendiente"; }
      else if (congelado) { score = "A"; scoreColor = "#00b85a"; scoreLabel = "Caliente"; estado = "visita_pendiente"; }
      else if (mensajes >= 10) { score = "B"; scoreColor = "#c8a96e"; scoreLabel = "Interesado"; estado = "interesado"; }
      else if (mensajes >= 4) { score = "C"; scoreColor = "#7b9fff"; scoreLabel = "Explorando"; estado = "nuevo"; }

      leads.push({
        clave,
        nombre: clave,
        telefono: clave.match(/^\d+$/) ? clave : null,
        score, scoreColor, scoreLabel, estado,
        mensajes, ultimoMensaje, timestamp,
        congelado,
        historial: conv.slice(-10)
      });
    }

    leads.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ leads, total: leads.length });
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
