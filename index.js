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

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

const cooldownMemoria = new Map();

// FIX: Limpiar entradas viejas del Map cada 10 minutos para evitar memory leak
setInterval(() => {
  const ahora = Date.now();
  for (const [clave, timestamp] of cooldownMemoria) {
    if (ahora - timestamp > 60000) cooldownMemoria.delete(clave);
  }
}, 600000);

// ============================================================
// FIX #3: GRACEFUL SHUTDOWN — manejar SIGTERM correctamente
// ============================================================
let shuttingDown = false;
const activeRequests = new Set();

function gracefulShutdown(signal) {
  console.log(`Recibido ${signal}, cerrando gracefully...`);
  shuttingDown = true;
  
  // Dar 5 segundos para que terminen requests activas
  const forceExit = setTimeout(() => {
    console.log("Forzando cierre después de 5s");
    process.exit(0);
  }, 5000);
  forceExit.unref();
  
  // Si no hay requests activas, salir de inmediato
  if (activeRequests.size === 0) {
    console.log("Sin requests activas, cerrando ya");
    process.exit(0);
  }
  
  // Esperar a que terminen las requests activas
  const checkInterval = setInterval(() => {
    if (activeRequests.size === 0) {
      console.log("Requests activas terminaron, cerrando");
      clearInterval(checkInterval);
      process.exit(0);
    }
  }, 200);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const INFO_ENCINO = `
PRIVADA ENCINO - INFORMACION OFICIAL

Proyecto campestre en Area de La Morita, Montemorelos, NL.
Frente al Restaurant El Pariente. 5 min de Pueblo Salvaje, 3 min del Rio Blanquillo, 45 min de Monterrey.
Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

Caracteristicas: unico proyecto pavimentado en la zona, acceso controlado, electricidad subterranea, red de agua, encinos y naranjos dentro de los lotes, libertad total de construccion. Ultimos 2 lotes de 8 originales.

PROPIEDAD PRIVADA, NO EJIDAL. Cada lote se escritura ante notario una vez liquidado el precio total. El proceso es: apartar con contrato, escrituras listas al liquidar. Sin complicaciones legales.

Lotes disponibles (PRECIO DE LANZAMIENTO - ULTIMOS 2 LOTES):
- Lote 1: 1,648 m2 (38x38m) - Precio original $2,000,000, hoy en $1,700,000 (ahorro $300,000) - 18 MSI
- Lote 3B: 1,700 m2 (43x39m) - Precio original $2,100,000, hoy en $1,785,000 (ahorro $315,000) - 18 MSI

Plan de pagos SUGERIDO (negociable segun situacion del cliente):
- Lote 1 y 3B (18 MSI): Enganche $400,000 + 18 mensualidades iguales + pago final $400,000 al liquidar
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
- "Mandame mas informacion" o "mandame info" o "mandame algo": Responde con los precios de los 2 lotes (usando MAPA_DISPONIBILIDAD) + "Contamos con financiamiento directo sin intereses. Le gustaria conocer el plan de pagos?"
- "Se lo paso a mi esposa" o familiar o socio: "Con gusto, le comparto el folleto con toda la informacion para que lo revisen juntos." y escribe PDF_ENCINO al final.
- "Vi otro proyecto" o competencia: "Privada Encino es el unico proyecto completamente pavimentado en la zona, con electricidad subterranea, acceso controlado y encinos dentro de los lotes. Que fue lo que mas le llamo la atencion del otro?"
- Pregunta por vecinos o quienes han comprado: "Hemos recibido mucho interes de familias de Monterrey que buscan un lugar tranquilo cerca de la ciudad."
- "Tienes folleto" o "tienen pagina" o "tienes algo que pueda ver": "Claro, le comparto el folleto completo." y escribe PDF_ENCINO al final.

PROCESO LEGAL - MUY IMPORTANTE:
Si el cliente pregunta por escrituras, proceso legal, si es ejidal, documentos o cualquier tema legal: responde "Es propiedad privada, no ejidal. Cada lote se escritura ante notario una vez liquidado. El proceso es sencillo: apartar con contrato y escrituras listas al liquidar." y escribe ALERTA_LEGAL al final.

UBICACION:
Cuando el cliente pida ubicacion, responde UNICAMENTE: "Le comparto la ubicacion de Google Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9"
NADA MAS. Sin descripcion de distancias ni referencias. Solo esa frase y el link.

PRECIOS - MUY IMPORTANTE:
Cuando el cliente pida precios Y vas a listar los 2 lotes, escribe MAPA_DISPONIBILIDAD en linea separada ANTES de la lista. SOLO escribe MAPA_DISPONIBILIDAD cuando vayas a poner la lista de precios inmediatamente despues. NUNCA lo escribas en el primer mensaje de presentacion ni cuando no vas a listar precios.
Formato de precios con ~ tachado y * negritas:
"Estos son los 2 lotes disponibles:
Lote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*
Lote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*
Contamos con financiamiento directo sin intereses."
Despues de escribir ESA lista exacta de los 2 lotes con precios, SIEMPRE agrega --- y luego escribe: "Le gustaria conocer el plan de pagos? 💳" para que llegue como mensaje separado. SOLO agrega esa pregunta cuando acabas de escribir la lista completa de los 2 lotes. NUNCA en el saludo inicial, NUNCA en respuestas cortas, NUNCA cuando no mostraste la lista de precios. NUNCA preguntes "cual le llama la atencion" porque el cliente aun no ha visto los lotes fisicamente.
NUNCA des un rango generico como "van desde $1.7M hasta $1.8M". SIEMPRE detalla cada lote.
No preguntes directamente si busca para inversion — deja que el cliente lo mencione.

LOTE 4:
Si el cliente pregunta por el Lote 4, el lote premium, la colina o la vista, responde: "Ese lote ya se vendio. Tenemos disponibles el Lote 1 y el Lote 3B, ambos excelentes opciones." y continua normalmente.

FINANCIAMIENTO (PLAN DE PAGOS) - DIFERENTE A PRECIOS:
Financiamiento NO es lo mismo que precios. Financiamiento es COMO se paga. Cuando el cliente pregunte por financiamiento, plan de pagos, mensualidades, enganche o como se paga, responde con el plan de pagos:
"Manejamos financiamiento directo sin banco y sin intereses.
Lotes 1 y 3B: Enganche $400,000 + 18 mensualidades desde $50,000 + pago final de $400,000
El plan es flexible, podemos ajustarlo a su situacion."
Despues de dar el financiamiento, pregunta: "Se le acomoda este plan?" para saber si esta dentro de su presupuesto.
NUNCA respondas con precios cuando pregunten por financiamiento. Son cosas diferentes.

ESCALAMIENTO - FLUJO NATURAL DE VENTA:
Sigue este orden natural en la conversacion:
1. Precios → la lista de precios termina con "Contamos con financiamiento directo sin intereses." y DESPUES en mensaje separado (usando ---): "Le gustaria conocer el plan de pagos? 💳"
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
Si el cliente pide 2 cosas (ej: "ubicacion y precios"), responde primero lo que NO son precios (ubicacion, amenidades, medidas, etc.) usando ---, y deja los precios con la pregunta de plan de pagos SIEMPRE AL FINAL. Los precios van siempre al ultimo cuando hay multiples temas.
Si el cliente pide 3 o mas cosas a la vez, responde las 2 mas importantes separadas con --- (precios siempre al final) y pregunta por el resto.
NUNCA ignores algo que el cliente pidio explicitamente.

MENSAJES EN 2 PARTES:
Usa --- SOLO cuando des un bloque grande de informacion (precios, ubicacion, financiamiento) Y ademas quieras hacer una pregunta. Para respuestas cortas conversacionales NUNCA uses ---. Ejemplo CORRECTO sin separar: "Claro, con gusto le escribo la proxima semana. Que dia le vendria mejor?"

FLUJO:
- Si el historial esta vacio Y el cliente NO dio contexto (solo dice "hola", "buenas", "info", "informacion" o algo generico): responde en 2 partes con ---. Primera parte: "Hola, soy Daniel Soliz, le estare compartiendo la informacion de Privada Encino." Segunda parte: "Que informacion buscaba sobre el proyecto?"
- REGLA CRITICA - PRIMER MENSAJE CON CONTEXTO (OBLIGATORIA): Cuando el historial esta vacio Y el cliente pide algo concreto en su primer mensaje, tu respuesta DEBE tener exactamente esta estructura: PARTE 1: "Hola, soy Daniel Soliz, con gusto. Le comparto [lo que pidio]:" NADA MAS. CERO contenido. CERO links. CERO precios. CERO datos. Solo el saludo y una frase corta que diga QUE le vas a compartir usando las mismas palabras del cliente. --- PARTE 2: El contenido real. Links, precios, datos, todo va aqui. Si NO incluye la lista de los 2 lotes con precios, termina con "¿Tiene alguna otra duda?" Si SI incluye precios, NO pongas esa pregunta. NUNCA juntes la parte 1 con la parte 2 en un solo bloque. El --- entre ambas es OBLIGATORIO. Ejemplos: Cliente dice "me pasas la ubicacion y precios" → PARTE1: "Hola, soy Daniel Soliz, con gusto. Le comparto la ubicacion y los precios:" --- PARTE2: link + MAPA_DISPONIBILIDAD + lotes. Cliente dice "quiero saber el financiamiento" → PARTE1: "Hola, soy Daniel Soliz, con gusto. Le comparto el plan de financiamiento:" --- PARTE2: plan de pagos + "¿Tiene alguna otra duda?" Cliente dice "ubicacion" → PARTE1: "Hola, soy Daniel Soliz, con gusto. Le comparto la ubicacion:" --- PARTE2: link + "¿Tiene alguna otra duda?" Esta regla NO aplica si el cliente solo dice "hola", "buenas", "info" o algo generico.
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
MAPA_DISPONIBILIDAD: antes de mostrar precios, para que el cliente vea el mapa de lotes`;

function hashSHA256(valor) {
  if (!valor) return null;
  return crypto.createHash("sha256").update(String(valor).toLowerCase().trim()).digest("hex");
}

function limpiarTelefono(telefono) {
  if (!telefono) return null;
  const limpio = String(telefono).replace(/\D/g, "");
  if (limpio.length < 10) return null;
  return limpio;
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
    console.log("REDIS SAVE OK:", key, "mensajes:", mensajes.length);
    // FIX: Eliminado el re-read de verificación — gasta tiempo y no aporta
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
      // Guardar timestamp de inicio del bot para ventana de 24h
      await redis.setex("bot_inicio:" + clave, 172800, String(Date.now()));
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function botExpirado(clave) {
  try {
    const inicio = await redis.get("bot_inicio:" + clave);
    if (!inicio) return false; // Si no hay registro, es lead viejo pre-fix — dejar pasar
    const transcurrido = Date.now() - Number(inicio);
    return transcurrido > 86400000; // 24 horas en ms
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
  if (!TELEGRAM_CHAT_ID_ANGEL) { console.error("TELEGRAM_CHAT_ID_ANGEL no configurado"); return; }
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

async function mandarEventoMeta(evento, telefono, value, subscriberId, nombre) {
  try {
    const telefonoLimpio = limpiarTelefono(telefono);
    if (!telefonoLimpio) {
      console.error("META CAPI: teléfono inválido:", telefono);
      return;
    }
    const userData = {
      ph: [hashSHA256(telefonoLimpio)],
      country: [hashSHA256("mx")],
      st: [hashSHA256("nuevo leon")],
      ct: [hashSHA256("monterrey")]
    };
    if (subscriberId) userData.external_id = [hashSHA256(String(subscriberId))];
    if (nombre) {
      const partes = String(nombre).trim().split(" ");
      userData.fn = [hashSHA256(partes[0].toLowerCase())];
      if (partes.length > 1) userData.ln = [hashSHA256(partes.slice(1).join(" ").toLowerCase())];
    }
    const eventoData = {
      event_name: evento,
      event_time: Math.floor(Date.now() / 1000),
      action_source: "other",
      user_data: userData
    };
    if (value && value > 0) eventoData.custom_data = { value, currency: "MXN" };
    const metaRes = await fetch("https://graph.facebook.com/v19.0/" + META_DATASET_ID + "/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [eventoData], access_token: META_ACCESS_TOKEN })
    });
    const metaData = await metaRes.json();
    console.log("META CAPI:", evento, "tel:", telefonoLimpio, "nombre:", nombre || "sin nombre");
    console.log("META CAPI RESPUESTA:", JSON.stringify(metaData));
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
  if (horaMX.getDay() === 5 && horaMX.getHours() === 10 && horaMX.getMinutes() < 5) {
    reporteCitas();
  }
}, 300000);

// ============================================================
// FIX #4: Tareas background — fire-and-forget con logging
// ============================================================
function backgroundTask(nombre, promesa) {
  promesa.catch(e => console.error("BG ERROR [" + nombre + "]:", e.message));
}

app.post("/webhook", async (req, res) => {
  // FIX #3: Rechazar requests durante shutdown
  if (shuttingDown) {
    return res.status(503).json({ error: "Servidor reiniciando" });
  }

  const requestId = Math.random().toString(36).slice(2, 8);
  activeRequests.add(requestId);

  try {
    const { telefono, mensaje, subscriber_id, primer_mensaje, nombre } = req.body;
    console.log("BODY COMPLETO:", JSON.stringify(req.body));

    if (!mensaje) {
      activeRequests.delete(requestId);
      return res.status(400).json({ error: "Falta mensaje" });
    }

    const clave = subscriber_id || telefono || "desconocido";
    console.log("=== WEBHOOK ===", "clave:", clave, "subscriber_id:", subscriber_id, "telefono:", telefono, "mensaje:", mensaje);

    // ============================================================
    // FIX #2: Lock distribuido en Redis en lugar de Set in-memory
    // ============================================================
    const lockKey = "lock:" + clave;
    const lockAcquired = await redis.set(lockKey, requestId, { nx: true, ex: 45 });
    if (!lockAcquired) {
      console.log("BLOQUEADO (lock redis):", clave);
      activeRequests.delete(requestId);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    // Función para liberar el lock de forma segura
    async function releaseLock() {
      try {
        const currentVal = await redis.get(lockKey);
        if (currentVal === requestId) {
          await redis.del(lockKey);
        }
      } catch (e) {
        console.error("Error releasing lock:", e);
      }
    }

    // Cooldown in-memory (backup rápido, no crítico)
    const ahoritaCooldown = cooldownMemoria.get(clave);
    if (ahoritaCooldown && Date.now() - ahoritaCooldown < 5000) {
      console.log("BLOQUEADO (cooldown memoria):", clave);
      await releaseLock();
      activeRequests.delete(requestId);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    const cooldownKey = "cooldown:" + clave;
    const enCooldown = await redis.get(cooldownKey);
    if (enCooldown) {
      console.log("BLOQUEADO (cooldown redis):", clave);
      await releaseLock();
      activeRequests.delete(requestId);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    // FIX COOLDOWN: Activar cooldown AQUÍ (al inicio), no al final.
    // Así los 5s se miden desde que llegó el mensaje del cliente,
    // no desde que terminó el procesamiento de Claude (3-15s después).
    cooldownMemoria.set(clave, Date.now());
    backgroundTask("cooldown-inicio", redis.setex(cooldownKey, 5, "true"));

    try {
      const congelado = await getBotCongelado(clave);
      if (congelado) {
        console.log("Bot congelado para:", clave);
        await releaseLock();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: null, respuesta2: null, alerta: "congelado", foto: false });
      }

      const esDaniel = telefono === "5218123793904" || subscriber_id === "5218123793904";

      // Bot solo activo 24 horas desde el primer mensaje del cliente
      if (!esDaniel && await botExpirado(clave)) {
        console.log("BOT EXPIRADO (24h):", clave, "— humano toma el control");
        await releaseLock();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: null, respuesta2: null, alerta: "expirado_24h", foto: false });
      }

      if (!esDaniel && !dentroDeHorario()) {
        // FIX: Guardar el mensaje del cliente + respuesta fuera de horario
        // para que no se pierda el contexto al día siguiente
        let convFueraHorario = await getConversacion(clave);
        convFueraHorario.push({ role: "user", content: mensaje });
        convFueraHorario.push({ role: "assistant", content: "Gracias por escribir, con gusto le atiendo manana a primera hora." });
        await setConversacion(clave, convFueraHorario);
        await releaseLock();
        activeRequests.delete(requestId);
        return res.json({
          respuesta1: "Gracias por escribir, con gusto le atiendo manana a primera hora.",
          respuesta2: null, alerta: null, foto: false
        });
      }

      const esNuevo = await esNuevoLead(clave);
      if (esNuevo) {
        // FIX #1 (ya estaba): CAPI no bloqueante
        backgroundTask("CAPI-ViewContent", mandarEventoMeta("ViewContent", telefono || null, null, subscriber_id, nombre));
        await redis.setex("seguimiento:" + clave, 604800, JSON.stringify({
          subscriberId: subscriber_id, telefono: telefono || null, timestamp: Date.now(), ultimoMensaje: mensaje, alertaEnviada: false
        }));
        // FIX: frio se puede hacer en paralelo con seguimiento
        backgroundTask("frio", redis.setex("frio:" + clave, 1209600, JSON.stringify({
          subscriberId: subscriber_id, timestamp: Date.now(), alertaEnviada: false
        })));

        if (subscriber_id) {
          // FIX #4: Videos y etiqueta en background — NO bloquean antes de Claude
          backgroundTask("videos", mandarContenido(subscriber_id, CONTENT_VIDEOS));
          backgroundTask("etiqueta", ponerEtiqueta(subscriber_id, "conversacion privada encino"));
          console.log("VIDEOS + etiqueta lanzados en background para:", clave);
        } else {
          console.error("NO SE MANDARON VIDEOS: subscriber_id es null para clave:", clave);
        }
      } else {
        // Actualizar seguimiento en background
        backgroundTask("seguimiento-update", (async () => {
          const segData = await redis.get("seguimiento:" + clave);
          if (segData) {
            const seg = typeof segData === "string" ? JSON.parse(segData) : segData;
            seg.ultimoMensaje = mensaje;
            seg.timestamp = Date.now();
            seg.alertaEnviada = false;
            await redis.setex("seguimiento:" + clave, 604800, JSON.stringify(seg));
          }
        })());
      }

      let conversacion = await getConversacion(clave);
      
      if (!esNuevo && conversacion.length === 0) {
        console.error("⚠️ ALERTA: Lead NO es nuevo pero conversación está VACÍA para:", clave, "— Redis perdió el historial");
      }
      
      console.log("HISTORIAL:", clave, "esNuevo:", esNuevo, "mensajes:", conversacion.length);

      if (primer_mensaje && conversacion.length === 0) {
        conversacion.push({
          role: "user",
          content: (primer_mensaje && primer_mensaje !== mensaje ? "[El cliente llego por un anuncio y su primer mensaje fue: " + primer_mensaje + "] " : "") + mensaje
        });
      } else if (conversacion.length > 0) {
        conversacion.push({
          role: "user",
          content: "[Conversacion en curso, mensaje #" + (Math.floor(conversacion.length / 2) + 1) + " del cliente. NO te presentes de nuevo.] " + mensaje
        });
      } else {
        conversacion.push({ role: "user", content: mensaje });
      }

      // ============================================================
      // FIX #1: Claude con timeout agresivo de 15s, solo 1 retry
      // Razonamiento: ManyChat tiene ~10s timeout. Con 2 intentos de
      // 15s cada uno, el segundo intento ya no sirve porque ManyChat
      // ya cortó. Mejor 1 intento rápido + fallback inmediato.
      // ============================================================
      let data = null;
      let claudeOk = false;
      for (let intento = 1; intento <= 2; intento++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s en vez de 30s
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, system: SYSTEM_PROMPT, messages: conversacion })
          });
          clearTimeout(timeoutId);
          data = await response.json();
          if (response.ok && data.content && !data.error && data.type !== "error") {
            claudeOk = true;
            console.log("Claude OK en intento", intento, "| clave:", clave);
            break;
          }
          console.error("Claude intento", intento, "fallo:", response.status, JSON.stringify(data));
          if (intento < 2) await new Promise(r => setTimeout(r, 1000));
        } catch (claudeErr) {
          console.error("Claude intento", intento, "excepcion:", claudeErr.message);
          if (intento < 2) await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (!claudeOk) {
        // FIX: Guardar el mensaje del cliente aunque Claude haya fallado,
        // para que no se pierda en el historial
        conversacion.push({ role: "assistant", content: "Claro, con gusto le atiendo. Dame un momento." });
        await setConversacion(clave, conversacion);
        await releaseLock();
        // Cooldown ya fue activado al inicio (FIX COOLDOWN)
        activeRequests.delete(requestId);
        return res.json({ respuesta1: "Claro, con gusto le atiendo. Dame un momento.", respuesta2: null, alerta: null, foto: false });
      }
      if (data.content) { console.log("CLAUDE BLOQUES:", data.content.map(b => b.type).join(", "), "| clave:", clave); }
      const textBlocks = data.content ? data.content.filter(b => b.type === "text") : [];
      if (!textBlocks.length) {
        console.error("Error Claude (sin bloques):", JSON.stringify(data));
        // FIX: Guardar el mensaje del cliente aunque Claude no devolvió bloques
        conversacion.push({ role: "assistant", content: "Un momento, dejame verificarlo." });
        await setConversacion(clave, conversacion);
        await releaseLock();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, alerta: null, foto: false });
      }

      let respuesta = textBlocks.map(b => b.text).join("\n").trim();
      console.log("RESPUESTA:", respuesta);

      conversacion.push({ role: "assistant", content: respuesta });
      if (conversacion.length > 20) {
        conversacion = conversacion.slice(-20);
        if (conversacion[0].role === "assistant") conversacion = conversacion.slice(1);
      }
      
      // Guardar conversación antes de responder para evitar race condition
      await setConversacion(clave, conversacion);

      // CAPI: InitiateCheckout a los 6 mensajes con anti-duplicado
      if (conversacion.length >= 6) {
        const icKey = "capi_ic:" + clave;
        const icEnviado = await redis.get(icKey);
        if (!icEnviado) {
          await redis.setex(icKey, 2592000, "true"); // 30 días
          backgroundTask("CAPI-InitiateCheckout", mandarEventoMeta("InitiateCheckout", telefono || null, null, subscriber_id, nombre));
          console.log("CAPI InitiateCheckout disparado para:", clave, "mensajes:", conversacion.length);
        }
      }

      let alerta = null;
      let foto = false;
      let mandarPDF = false;

      respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();

      // ============================================================
      // FIX #4: Todas las llamadas a mandarContenido en background
      // ============================================================
      if (respuesta.includes("MAPA_DISPONIBILIDAD")) {
        respuesta = respuesta.replace(/MAPA_DISPONIBILIDAD/g, "").trim();
        if (subscriber_id) {
          backgroundTask("mapa", mandarContenido(subscriber_id, CONTENT_MAPA));
          console.log("MAPA lanzado en background:", subscriber_id);
        }
      }

      if (respuesta.includes("PDF_ENCINO")) {
        mandarPDF = true;
        respuesta = respuesta.replace(/PDF_ENCINO/g, "").trim();
        if (subscriber_id) {
          backgroundTask("pdf", mandarContenido(subscriber_id, CONTENT_PDF));
        }
        console.log("PDF lanzado en background:", telefono || subscriber_id);
      }

      if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
        const match = respuesta.match(/ALERTA_VISITA_PENDIENTE:(.+)/);
        alerta = "ALERTA_VISITA_PENDIENTE";
        respuesta = respuesta.replace(/ALERTA_VISITA_PENDIENTE:.+/g, "").trim();
        const detalle = match ? match[1] : "";
        // Background: telegram, visita, congelado, CAPI, etiqueta
        backgroundTask("visita-telegram", mandarTelegram("VISITA PENDIENTE\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + detalle + "\nResponde TU para confirmar"));
        backgroundTask("visita-save", guardarVisita(clave, detalle));
        backgroundTask("visita-congelar", setBotCongelado(clave, true));
        const schedKey = "capi_sched:" + clave;
        const schedEnviado = await redis.get(schedKey);
        if (!schedEnviado) {
          await redis.setex(schedKey, 2592000, "true");
          backgroundTask("visita-capi", mandarEventoMeta("Schedule", telefono || null, null, subscriber_id, nombre));
        }
        if (subscriber_id) backgroundTask("visita-etiqueta", ponerEtiqueta(subscriber_id, "cita privada encino"));

      } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
        const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
        alerta = "ALERTA_VISITA_CONFIRMADA";
        respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "").trim();
        backgroundTask("confirmada-telegram", mandarTelegram("VISITA CONFIRMADA\n" + (match ? match[1] : telefono)));
        if (subscriber_id) backgroundTask("confirmada-etiqueta", ponerEtiqueta(subscriber_id, "cita privada encino"));

      } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
        const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:(.+)/);
        alerta = "ALERTA_VISITA_OTRO_DIA";
        respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "").trim();
        backgroundTask("otroDia-telegram", mandarTelegram("Visita otro dia\nCliente: " + (telefono || subscriber_id) + "\nDia: " + (match ? match[1] : "")));

      } else if (respuesta.includes("ALERTA_AUDIO")) {
        alerta = "ALERTA_AUDIO";
        respuesta = respuesta.replace(/ALERTA_AUDIO/g, "").trim();
        backgroundTask("audio-congelar", setBotCongelado(clave, true));

      } else if (respuesta.includes("ALERTA_LEGAL")) {
        alerta = "ALERTA_LEGAL";
        respuesta = respuesta.replace(/ALERTA_LEGAL/g, "").trim();

      } else if (respuesta.includes("ALERTA_NO_SABE")) {
        alerta = "ALERTA_NO_SABE";
        respuesta = respuesta.replace(/ALERTA_NO_SABE/g, "").trim();
        backgroundTask("noSabe-telegram", mandarTelegram("No sabe responder\nCliente: " + (telefono || subscriber_id) + "\nPregunta: " + mensaje));

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_OK")) {
        alerta = "ALERTA_PRESUPUESTO_OK";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_OK/g, "").trim();
        const crKey = "capi_cr:" + clave;
        const crEnviado = await redis.get(crKey);
        if (!crEnviado) {
          await redis.setex(crKey, 2592000, "true");
          backgroundTask("presupuesto-capi", mandarEventoMeta("CompleteRegistration", telefono || null, null, subscriber_id, nombre));
        }

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_BAJO")) {
        alerta = "ALERTA_PRESUPUESTO_BAJO";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_BAJO/g, "").trim();

      } else if (respuesta.includes("ALERTA_SEGUIMIENTO")) {
        const match = respuesta.match(/ALERTA_SEGUIMIENTO:(.+)/);
        alerta = "ALERTA_SEGUIMIENTO";
        respuesta = respuesta.replace(/ALERTA_SEGUIMIENTO:.+/g, "").trim();
        const detalle = match ? match[1] : "";
        backgroundTask("seguimiento-telegram", mandarTelegram("SEGUIMIENTO\nCliente: " + (telefono || subscriber_id) + "\nPide contacto: " + detalle));

      } else if (respuesta.includes("ALERTA_CIERRE_VENTA")) {
        alerta = "ALERTA_CIERRE_VENTA";
        respuesta = respuesta.replace(/ALERTA_CIERRE_VENTA/g, "").trim();
        const purchKey = "capi_purch:" + clave;
        const purchEnviado = await redis.get(purchKey);
        if (!purchEnviado) {
          await redis.setex(purchKey, 2592000, "true");
          backgroundTask("cierre-capi", mandarEventoMeta("Purchase", telefono || null, 1700000, subscriber_id, nombre));
        }
        backgroundTask("cierre-telegram", mandarTelegram("🔥 CIERRE DE VENTA\nCliente: " + (telefono || subscriber_id)));
      }

      if (respuesta.includes("ALERTA_PDF_ENVIADO")) {
        respuesta = respuesta.replace(/ALERTA_PDF_ENVIADO/g, "").trim();
      }

      const PREG_FINANC = "\u00bfLe gustar\u00eda conocer el plan de financiamiento? \uD83D\uDCB3";
      const PREG_PLAN   = "\u00bfQu\u00e9 le parece este plan?";

      const partes = respuesta.split("---");
      let respuesta1 = partes[0].trim();
      let respuesta2 = partes.length > 1 ? partes.slice(1).join("\n").trim() : null;

      function sinPreguntas(txt, tipo) {
        return txt.split("\n").filter(function(l) {
          var ll = l.toLowerCase();
          if (tipo === "financ") return ll.indexOf("le gustaria conocer") < 0 && ll.indexOf("le parece") < 0 && l.trim() !== "\uD83D\uDCB3";
          return ll.indexOf("le parece") < 0 && ll.indexOf("se le acomoda") < 0;
        }).join("\n").trim();
      }

      function formatearPrecios(txt) {
        return sinPreguntas(txt, "financ")
          .replace(/(Lote [\d\w]+)/g, "\nLote $1")
          .replace(/(Contamos con)/g, "\n$1")
          .replace(/^\n+/, "").trim();
      }

      const tienePrecios = respuesta.includes("1,648 m2") || (respuesta.includes("Lote 1") && respuesta.includes("Lote 3B"));
      if (tienePrecios) {
        const idxP = partes.findIndex(p => p.includes("1,648 m2") || (p.includes("Lote 1") && p.includes("Lote 3B")));
        const idx  = idxP >= 0 ? idxP : 0;
        if (idx === 0) {
          respuesta1 = formatearPrecios(partes[0]);
          respuesta2 = PREG_FINANC;
        } else {
          respuesta1 = partes.slice(0, idx).join("\n").trim() + "\n\n" + formatearPrecios(partes[idx]);
          respuesta2 = PREG_FINANC;
        }
        console.log("PRECIOS OK r1:", respuesta1.length, "r2:", respuesta2);
      }

      const tieneFinanciamiento = !tienePrecios && (respuesta.includes("Manejamos financiamiento") || respuesta.includes("mensualidades de"));
      if (tieneFinanciamiento) {
        const idxF   = partes.findIndex(p => p.includes("Manejamos financiamiento") || p.includes("mensualidades de"));
        const idxFin = idxF >= 0 ? idxF : 0;
        if (idxFin === 0) {
          respuesta1 = sinPreguntas(partes[0], "plan");
          respuesta2 = PREG_PLAN;
        } else {
          respuesta1 = partes.slice(0, idxFin).join("\n").trim() + "\n\n" + sinPreguntas(partes[idxFin], "plan");
          respuesta2 = PREG_PLAN;
        }
        console.log("FINANCIAMIENTO OK r1:", respuesta1.length, "r2:", respuesta2);
      }

      // FIX: Solo usar respuesta2 separada para precios y financiamiento,
      // que son los únicos casos donde el código controla r2 explícitamente.
      // Para todo lo demás (saludos, respuestas genéricas), combinar en un
      // solo mensaje para evitar que WhatsApp los entregue desordenados.
      if (!tienePrecios && !tieneFinanciamiento && respuesta2) {
        respuesta1 = respuesta1 + "\n\n" + respuesta2;
        respuesta2 = null;
      }

      console.log("FINAL r1:", respuesta1 ? respuesta1.substring(0,50) : "VACIA", "| r2:", respuesta2 || "null");
      // Cooldown ya fue activado al inicio del procesamiento (FIX COOLDOWN)
      
      await releaseLock();
      res.json({ respuesta1, respuesta2: respuesta2 || null, alerta: alerta || null, foto });
      activeRequests.delete(requestId);

    } catch (innerError) {
      // Liberar lock en caso de error
      const lockKey2 = "lock:" + clave;
      redis.del(lockKey2).catch(() => {});
      activeRequests.delete(requestId);
      throw innerError;
    }

  } catch (error) {
    console.error("Error webhook:", error);
    activeRequests.delete(requestId);
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

// Reiniciar las 24 horas del bot para un cliente específico
app.post("/reactivar", async (req, res) => {
  try {
    const { clave } = req.body;
    if (!clave) return res.status(400).json({ error: "Falta clave" });
    await redis.setex("bot_inicio:" + clave, 172800, String(Date.now()));
    await setBotCongelado(clave, false);
    res.json({ status: "Bot reactivado 24h para: " + clave });
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
  if (req.query.secret !== "daniel2024") return res.status(403).json({ error: "Acceso denegado" });
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
    // FIX: Limpiar también los locks
    const locks = await redis.keys("lock:*");
    for (const c of locks) await redis.del(c);
    const inicios = await redis.keys("bot_inicio:*");
    for (const c of inicios) await redis.del(c);
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
    const clave = req.params.clave;
    const clavesABorrar = new Set([clave]);

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
      await redis.del("lock:" + c);
      await redis.del("capi_ic:" + c);
      await redis.del("capi_sched:" + c);
      await redis.del("capi_cr:" + c);
      await redis.del("capi_purch:" + c);
      await redis.del("bot_inicio:" + c);
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
  res.json({ status: "Agente Daniel - Privada Encino v3.7 funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor Daniel v3.7 corriendo en puerto " + PORT);
});
