const express = require("express");
const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '32kb' }));

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

// FIX: Limpiar cooldownMemoria cada 10 min para evitar memory leak
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

Caracteristicas: unico proyecto pavimentado en la zona, acceso controlado, electricidad subterranea, red de agua, encinos y naranjos dentro de los lotes, libertad total de construccion. NO cuenta con alumbrado publico. No cuenta con drenaje publico, cada lote maneja fosa septica individual. Internet: se puede contratar servicio de Telcel o Starlink. Ultimos 2 lotes de 8 originales.

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
Cuando el cliente se despida con algo corto como "Gracias", "Ok gracias", "Muchas gracias", "Sale gracias" sin preguntar nada mas, responde SOLO con 👍. Nada mas. Sin texto adicional.

REGLA ABSOLUTA - INFORMACION:
SOLO usa la informacion que esta escrita TEXTUALMENTE arriba. NUNCA inventes, deduzcas ni inferas nada. Si la informacion no esta escrita palabra por palabra arriba, NO LA SABES. Ejemplos: si el cliente pregunta sobre tala de arboles, regulaciones, permisos, animales, clima, escuelas cercanas, hospitales, seguridad de la zona, plusvalia, reglamento interno, o CUALQUIER cosa que no este arriba — NO respondas sobre ese tema. NUNCA conectes datos para crear respuestas nuevas (ejemplo: NO combines "encinos dentro de los lotes" + "libertad de construccion" para inventar que se pueden talar arboles). Simplemente ignora esa parte de la pregunta, responde lo que SI puedas con la informacion que tienes, y escribe ALERTA_NO_SABE al final para que se revise internamente. Si NADA de lo que pregunto esta en la informacion, responde con algo natural como "Con gusto le ayudo, que otra duda tiene sobre el proyecto?" y escribe ALERTA_NO_SABE al final. NUNCA des respuestas largas sobre temas que no dominas. Maximo 2 lineas cuando ignoras algo.

CITAS Y VISITAS - MUY IMPORTANTE:
Si el cliente menciona querer visitar, agendar cita, conocer el terreno, ir a ver, o cualquier variacion — responde UNICAMENTE: "Con gusto, dejeme revisar disponibilidad y en un momento le confirmo." y escribe ALERTA_VISITA_PENDIENTE:[mensaje del cliente] al final. No digas nada mas.

MANEJO DE OBJECIONES:
- "Esta muy lejos" o similar: "Estamos a solo 45 min de Monterrey por carretera, 5 min de Pueblo Salvaje y 3 min del Rio Blanquillo. La mayoria de nuestros clientes vienen de Monterrey."
- "Esta caro" o "es mucho": "Entiendo. Para orientarme mejor, que presupuesto estaria manejando?"
- "No tengo el enganche" o "no tengo para el enganche": "El plan de pagos es flexible, podemos ajustarlo a su situacion. Que monto de enganche le acomodaria?"
- "Mandame mas informacion" o "mandame info" o "mandame algo": Responde con los precios de los 2 lotes (usando MAPA_DISPONIBILIDAD seguido inmediatamente del listado completo de Lote 1 y Lote 3B con precios) + "Contamos con financiamiento directo sin intereses. Le gustaria conocer el plan de pagos?"
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
MAPA_DISPONIBILIDAD nunca va solo. SIEMPRE va seguido inmediatamente del listado completo de Lote 1 y Lote 3B con precios. Si solo escribes el token sin la lista, la respuesta es invalida.
MAPA_DISPONIBILIDAD y la lista de precios van SIEMPRE en el mismo bloque (despues del --- si hay presentacion previa). NUNCA separar el token del listado con ---.
Formato de precios con ~ tachado y * negritas:
"Estos son los 2 lotes disponibles:
Lote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*
Lote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*
Contamos con financiamiento directo sin intereses."
Despues de escribir ESA lista exacta de los 2 lotes con precios, SIEMPRE agrega --- y luego escribe: "Le gustaria conocer el plan de pagos? 💳" para que llegue como mensaje separado. SOLO agrega esa pregunta cuando acabas de escribir la lista completa de los 2 lotes. NUNCA en el saludo inicial, NUNCA en respuestas cortas, NUNCA cuando no mostraste la lista de precios. NUNCA EN NINGUNA PARTE DE LA CONVERSACION preguntes "cual le llama la atencion", "cual le interesa mas", "cual prefiere" ni ninguna variacion. El cliente NO ha visto los lotes fisicamente, no puede elegir entre ellos.
NUNCA repitas "que le interesa mas" / "que informacion le interesa" / "que le gustaria conocer" una vez que ya enviaste cualquier bloque de informacion (ubicacion, precios, mapa, financiamiento). Avanza al siguiente paso del flujo.
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
0. Post-mapa → Si ya enviaste MAPA_DISPONIBILIDAD en un turno anterior, en el siguiente turno NUNCA preguntes que le interesa. El siguiente paso natural es "Le gustaria conocer el plan de pagos? 💳" si el cliente no lo ha visto, o avanzar a presupuesto/visita.
1. Precios → la lista de precios termina con "Contamos con financiamiento directo sin intereses." y DESPUES en mensaje separado (usando ---): "Le gustaria conocer el plan de pagos? 💳"
2. Financiamiento → termina con "Se le acomoda este plan?"
3. Presupuesto OK → manda PDF_ENCINO y responde: "Le comparto el folleto con todo el detalle. Lo ideal es conocer el terreno en persona, tenemos disponibilidad sabados y domingos. Le gustaria visitarnos?"
4. Visita → ALERTA_VISITA_PENDIENTE
Cada paso lleva al siguiente. NUNCA saltes pasos ni des todo junto.

REGLA CRITICA - NUNCA REFERENCIAR MENSAJES ANTERIORES:
NUNCA digas "ya le comparti", "como le mencione", "arriba le puse", "los precios que le mande", "ya se los di" ni NINGUNA variacion. Si el cliente pide algo, SIEMPRE daselo de nuevo completo aunque creas que ya se lo mandaste. El cliente puede no haberlo recibido. Es mejor repetir que decir "ya te lo mande" y que el cliente no lo tenga. SIEMPRE responde como si fuera la primera vez que te pide esa informacion.
IMPORTANTE: Repetir aplica cuando el cliente PIDE algo de nuevo. Si el cliente solo afirma/acepta ("ok", "va", "si", "perfecto", "gracias"), avanza al siguiente paso del flujo de venta. NUNCA repitas la pregunta de que le interesa cuando el cliente solo esta aceptando o confirmando.

COMO RESPONDER:
1. LEE el historial completo antes de responder. Revisa TUS mensajes anteriores para saber que ya le diste y que no.
2. LEE el primer mensaje con atencion — si dice una palabra clave especifica (precios, ubicacion, financiamiento, etc.) responde eso. Si dice algo generico como "informacion", "info", "quiero saber mas", "me interesa el proyecto" — NO es intencion clara, trata como mensaje generico y pregunta que le interesa.
3. RESPONDE siempre aunque escriba mal. "ubaicon"=ubicacion, "financmiento"=financiamiento.
4. NUNCA digas "no entiendo". Siempre responde algo util.
5. UNA sola pregunta por mensaje.
6. Siempre en espanol aunque el cliente escriba en otro idioma.

REGLA DE ORO - NO SATURES PERO RESPONDE LO QUE PIDEN:
Si el cliente pide 1 cosa, responde esa cosa.
Si el cliente pide 2 cosas (ej: "ubicacion y precios"), responde primero lo que NO son precios (ubicacion, amenidades, medidas, etc.) usando ---, y deja los precios con la pregunta de plan de pagos SIEMPRE AL FINAL. Los precios van siempre al ultimo cuando hay multiples temas.
Si el cliente pide 3 o mas cosas a la vez, responde las 2 mas importantes separadas con --- (precios siempre al final) y pregunta por el resto.
NUNCA ignores algo que el cliente pidio explicitamente.
EXTENSION: Si tu mensaje anterior ofreció 2 o mas opciones (ej: "la ubicacion, los precios o el plan de financiamiento?") y el cliente responde con una afirmacion inclusiva (si, sí, todo, las 3, todos, ambos, los tres, claro, dale, ok, va, si me interesa, si por favor, las tres cosas), trata esa afirmacion como si el cliente hubiera pedido TODAS las opciones explicitamente. Aplica la misma regla de arriba para multiples temas.

MENSAJES EN 2 PARTES:
Usa --- SOLO cuando des un bloque grande de informacion (precios, ubicacion, financiamiento) Y ademas quieras hacer una pregunta. Para respuestas cortas conversacionales NUNCA uses ---. Ejemplo CORRECTO sin separar: "Claro, con gusto le escribo la proxima semana. Que dia le vendria mejor?"

FLUJO:
- DEFINICION DE MENSAJE GENERICO: cualquier primer mensaje que NO mencione una palabra clave especifica como "precios", "precio", "ubicacion", "financiamiento", "plan de pagos", "mensualidades", "enganche", "medidas", "lotes", "metros" o "escrituras". Ejemplos de mensajes genericos: "hola", "buenas", "info", "informacion", "quiero informacion", "quiero mas informacion", "me interesa Privada Encino", "quiero saber sobre el proyecto", "me pueden dar informacion", "hola quiero mas informacion sobre Privada Encino". TODOS estos son genericos porque NO especifican QUE informacion quieren.
- Si el historial esta vacio Y el mensaje es GENERICO (segun la definicion de arriba): responde en 2 partes con ---. Primera parte: "Hola, soy Daniel Soliz, con gusto. Privada Encino es un proyecto campestre en Montemorelos NL, a 45 min de Monterrey. Contamos con los ultimos 2 lotes disponibles desde $1.7M con financiamiento directo sin intereses." Segunda parte: "Que le interesa conocer mas, la ubicacion, los precios o el plan de financiamiento?" NADA MAS despues de eso.
- REGLA INTERMEDIA - AFIRMACION GENERICA AL TURNO 2: Si tu mensaje anterior fue la pregunta de que le interesa (ubicacion/precios/financiamiento) y el cliente responde con una afirmacion generica (Si, si me interesa, todo, las 3, todos, ambos, los tres, claro, dale, ok, va, si por favor), entrega las 3 cosas en partes separadas con ---: ubicacion (link de Google Maps) --- MAPA_DISPONIBILIDAD con la lista completa de precios de los 2 lotes --- "Le gustaria conocer el plan de pagos? 💳". NUNCA repitas la pregunta de que le interesa.
- REGLA CRITICA - PRIMER MENSAJE CON CONTEXTO ESPECIFICO (OBLIGATORIA): Cuando el historial esta vacio Y el cliente pide algo ESPECIFICO en su primer mensaje (usa alguna palabra clave de la definicion de arriba), tu respuesta DEBE tener exactamente esta estructura: PARTE 1: "Hola, soy Daniel Soliz, con gusto. Le comparto [lo que pidio]:" NADA MAS. CERO contenido. --- PARTE 2: El contenido real (links, precios, datos). NUNCA agregues preguntas finales de cierre como "Le gustaria conocer el plan de pagos?" o "Tiene alguna otra duda?" — el sistema las anexa automaticamente. NUNCA juntes la parte 1 con la parte 2 en un solo bloque. El --- entre ambas es OBLIGATORIO. Ejemplos: Cliente dice "me pasas la ubicacion y precios" → PARTE1: "Hola, soy Daniel Soliz, con gusto. Le comparto la ubicacion y los precios:" --- PARTE2: link + MAPA_DISPONIBILIDAD + lotes. Cliente dice "quiero saber el financiamiento" → PARTE1: "Hola, soy Daniel Soliz, con gusto. Le comparto el plan de financiamiento:" --- PARTE2: plan de pagos. Cliente dice "ubicacion" → PARTE1: "Hola, soy Daniel Soliz, con gusto. Le comparto la ubicacion:" --- PARTE2: link.
- Si YA HAY mensajes previos en el historial: NUNCA te presentes de nuevo. Continua la conversacion respondiendo lo que el cliente pidio.
- Objetivo: agendar visita sabado o domingo.

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, con gusto le atiendo manana a primera hora."

PRESUPUESTO:
Cuando el cliente confirme que el financiamiento le funciona, que si esta dentro de su presupuesto, que si le alcanza, o cualquier respuesta positiva sobre los precios o el plan de pagos: manda PDF_ENCINO y responde "Le comparto el folleto con todo el detalle. Lo ideal es conocer el terreno en persona, tenemos disponibilidad sabados y domingos. Le gustaria visitarnos?" y escribe ALERTA_PRESUPUESTO_OK al final.
Si el cliente dice que su presupuesto es menor a $1,000,000 o que no le alcanza, responde amablemente: "Entiendo, por el momento los lotes estan en ese rango de precio. Si mas adelante ajusta su presupuesto con gusto le atendemos." y escribe ALERTA_PRESUPUESTO_BAJO al final.

SEGUIMIENTO:
Si el cliente dice que va a revisar, que escribe despues, por la tarde, la proxima semana, mas adelante, o cualquier variacion de "luego te busco": responde algo corto y amable como "Perfecto, aqui le atiendo." o "Claro, con gusto. Aqui estare." NADA MAS. No preguntes dia, hora ni fecha. No seas intenso. Escribe ALERTA_SEGUIMIENTO:[detalle] al final.

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
MAPA_DISPONIBILIDAD: antes de mostrar precios, para que el cliente vea el mapa de lotes. SIEMPRE debe ir seguido del listado completo de precios de Lote 1 y Lote 3B en el MISMO bloque. Nunca escribas solo MAPA_DISPONIBILIDAD sin la lista de precios.`;

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
    const acquired = await redis.set("lead:" + clave, "true", { nx: true, ex: 2592000 });
    return acquired !== null;
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

// FIX: Wrapper con timeout para todas las llamadas externas
async function fetchConTimeout(url, opts, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function mandarTelegram(mensaje, chatIdDestino = null) {
  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
    const targetChatId = chatIdDestino || process.env.TELEGRAM_CHAT_ID;
    if (!TELEGRAM_TOKEN || !targetChatId) return;
    await fetchConTimeout("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
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
    await fetchConTimeout("https://api.manychat.com/fb/subscriber/addTag", {
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
    const response = await fetchConTimeout("https://api.manychat.com/fb/sending/sendFlow", {
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

// ============================================================
// MANDAR TEXTO — envia mensaje de texto via API de ManyChat
// Se usa para mandar la respuesta de Claude en background
// despues de haber respondido el webhook inmediatamente
// ============================================================
async function mandarTexto(subscriberId, texto) {
  try {
    if (!subscriberId || !texto) {
      console.error("mandarTexto: falta subscriberId o texto");
      return;
    }
    const response = await fetchConTimeout("https://api.manychat.com/fb/sending/sendContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MANYCHAT_API_KEY },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        data: {
          version: "v2",
          content: {
            messages: [{ type: "text", text: texto }]
          }
        }
      })
    }, 10000);
    const data = await response.json();
    console.log("MANYCHAT TEXTO:", data.status, "→", texto.substring(0, 60));
    if (data.status !== "success") {
      console.error("MANYCHAT TEXTO ERROR:", JSON.stringify(data));
    }
  } catch (e) {
    console.error("Error mandarTexto:", e.message);
  }
}

// ============================================================
// MAPEO DE EVENTOS CAPI → ETIQUETAS MANYCHAT
// Cada evento que antes se enviaba directo a Facebook CAPI
// ahora se convierte en una etiqueta en ManyChat.
// ManyChat detecta la etiqueta y dispara el evento de Facebook.
// ============================================================
const EVENTO_A_ETIQUETA = {
  "ViewContent":          "capi_view_content",
  "InitiateCheckout":     "capi_initiate_checkout",
  "Schedule":             "capi_schedule",
  "CompleteRegistration":  "capi_complete_registration",
  "Purchase":             "capi_purchase"
};

// CAPI DIRECTO: Railway → Facebook (sin pasar por ManyChat)
async function mandarEventoViaManyChat(evento, telefono, value, subscriberId, nombre) {
  console.log("CAPI DIRECTO:", evento, "tel:", telefono, "subscriber:", subscriberId);
  await mandarEventoMetaDirecto(evento, telefono, value, subscriberId, nombre);
}

// FALLBACK: CAPI directo (se usa solo si ManyChat falla o no hay subscriber_id)
async function mandarEventoMetaDirecto(evento, telefono, value, subscriberId, nombre) {
  try {
    const telefonoLimpio = limpiarTelefono(telefono);
    if (!telefonoLimpio) {
      console.error("META CAPI DIRECTO: teléfono inválido:", telefono);
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
    const metaRes = await fetchConTimeout("https://graph.facebook.com/v19.0/" + META_DATASET_ID + "/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [eventoData], access_token: META_ACCESS_TOKEN })
    });
    const metaData = await metaRes.json();
    console.log("META CAPI DIRECTO (fallback):", evento, "tel:", telefonoLimpio);
    console.log("META CAPI RESPUESTA:", JSON.stringify(metaData));
  } catch (e) {
    console.error("Error Meta directo:", e);
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

// Drena pendientes huerfanos: los procesa con Claude y le responde al cliente.
// Usado por (a) PUNTO B al cierre de un ciclo, y (b) PUNTO A tras expirar cooldown.
async function drainPendientesConClaude(clave, subscriber_id, telefono) {
  if (!subscriber_id) return;
  const lockKey = "lock:" + clave;
  const drainId = "drain-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  // Adquirir el lock principal para serializar con cualquier ejecucion activa.
  // Si falla, esa ejecucion vera los pending en su paso 6 (ventana de acumulacion).
  const got = await redis.set(lockKey, drainId, { nx: true, ex: 30 });
  if (!got) {
    console.log("DRAIN cede lock (hay ejecucion activa):", clave);
    return;
  }

  try {
    const raw = await redis.get("pending:" + clave);
    if (!raw) return;

    let msgs;
    try { msgs = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { msgs = null; }
    if (!Array.isArray(msgs) || !msgs.length) {
      await redis.del("pending:" + clave);
      return;
    }
    // Apropiarse de los mensajes (otro drain/ciclo no debe volver a verlos)
    await redis.del("pending:" + clave);
    console.log("DRAIN con Claude:", clave, msgs.length, "msg(s)");

    // Releer historial: el ciclo principal lo escribio hace milisegundos
    const conv = await getConversacion(clave);
    conv.push({ role: "user", content: msgs.join(" ") });

    let respuestaLimpia = "";
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 30000);
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          system: SYSTEM_PROMPT,
          messages: conv
        })
      });
      clearTimeout(tid);
      if (!resp.ok) throw new Error("Claude HTTP " + resp.status);
      const data = await resp.json();
      const texto = (data.content && data.content[0] && data.content[0].text) || "";
      respuestaLimpia = texto
        .replace(/MAPA_DISPONIBILIDAD/g, "")
        .replace(/PDF_ENCINO/g, "")
        .replace(/ALERTA_[A-Z_]+:?[^\n]*/g, "")
        .replace(/ETIQUETA:\S*/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!respuestaLimpia) throw new Error("respuesta vacia tras limpieza");
    } catch (e) {
      console.error("DRAIN Claude FALLO:", e.message);
      await mandarTelegram(
        "DRAIN sin respuesta (Claude fallo)\n" +
        "Cliente: " + (telefono || subscriber_id) + "\n" +
        "Mensajes: " + msgs.join(" | ") + "\n" +
        "Error: " + e.message
      );
      return;
    }

    try {
      await mandarTexto(subscriber_id, respuestaLimpia);
      conv.push({ role: "assistant", content: respuestaLimpia });
      await setConversacion(clave, conv);
    } catch (e) {
      console.error("DRAIN envio/save FALLO:", e.message);
      await mandarTelegram(
        "DRAIN no entregado al cliente\n" +
        "Cliente: " + (telefono || subscriber_id) + "\n" +
        "Error: " + e.message
      );
    }
  } finally {
    // Liberar lock solo si sigue siendo nuestro
    try {
      const cur = await redis.get(lockKey);
      if (cur === drainId) await redis.del(lockKey);
    } catch (_) {}
    // Cooldown post-respuesta para frenar retries inmediatos
    try {
      cooldownMemoria.set(clave, Date.now());
      await redis.setex("cooldown:" + clave, 5, "true");
    } catch (_) {}
  }
}

app.post("/webhook", async (req, res) => {
  // FIX #3: Rechazar requests durante shutdown
  if (shuttingDown) {
    return res.status(503).json({ error: "Servidor reiniciando" });
  }

  const requestId = Math.random().toString(36).slice(2, 8);
  activeRequests.add(requestId);

  let dedupKey = null;

  try {
    const { telefono, mensaje, subscriber_id, primer_mensaje, nombre } = req.body;
    console.log("BODY COMPLETO:", JSON.stringify(req.body));

    if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim() || mensaje.length > 4000) {
      activeRequests.delete(requestId);
      return res.status(400).json({ error: "Mensaje inválido" });
    }

    if (!subscriber_id && !telefono) {
      activeRequests.delete(requestId);
      return res.status(400).json({ error: "Falta subscriber_id o telefono" });
    }
    const clave = subscriber_id || telefono;
    console.log("=== WEBHOOK ===", "clave:", clave, "subscriber_id:", subscriber_id, "telefono:", telefono, "mensaje:", mensaje);

    // ============================================================
    // FIX: cooldown ya NO descarta. Acumula como pending y agenda drenado tardio.
    // Los retries de ManyChat traen mismo texto y los filtramos por includes(mensaje).
    // El dedup por hash que viene despues sigue cubriendo cualquier retry que pase.
    // ============================================================
    const cooldownKey = "cooldown:" + clave;
    const ahoritaCooldown = cooldownMemoria.get(clave);
    const enCooldownMem = ahoritaCooldown && Date.now() - ahoritaCooldown < 5000;
    const enCooldownRedis = enCooldownMem ? null : await redis.get(cooldownKey);

    if (enCooldownMem || enCooldownRedis) {
      console.log("EN COOLDOWN -> guardar pending:", clave, enCooldownMem ? "(mem)" : "(redis)");

      const pendingKey = "pending:" + clave;
      const existente = await redis.get(pendingKey);
      let arr = [];
      if (existente) {
        try {
          arr = typeof existente === "string" ? JSON.parse(existente) : existente;
          if (!Array.isArray(arr)) arr = [];
        } catch { arr = []; }
      }
      // Idempotencia frente a retries: mismo texto no se duplica
      if (!arr.includes(mensaje)) {
        arr.push(mensaje);
        await redis.setex(pendingKey, 60, JSON.stringify(arr));
      } else {
        console.log("COOLDOWN: retry mismo texto, ya estaba en pending");
      }

      // Agenda drenado tras expirar cooldown. Multiples drains agendados son seguros:
      // solo el primero toma el lock; los demas salen.
      backgroundTask("late-drain-" + clave, (async () => {
        await new Promise(r => setTimeout(r, 5500));
        await drainPendientesConClaude(clave, subscriber_id, telefono);
      })());

      activeRequests.delete(requestId);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    // ============================================================
    // FIX: Dedup por contenido — si el mismo mensaje ya se procesó
    // recientemente para este subscriber, ignorar (double tap)
    // ============================================================
    const msgHash = crypto.createHash("md5").update(clave + ":" + mensaje).digest("hex").slice(0, 12);
    dedupKey = "dedup:" + msgHash;
    const dedupOk = await redis.set(dedupKey, "1", { nx: true, ex: 90 });
    if (!dedupOk) {
      console.log("BLOQUEADO (dedup mensaje):", clave, "mensaje ya procesado");
      activeRequests.delete(requestId);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    // ============================================================
    // Lock distribuido en Redis
    // ============================================================
    const lockKey = "lock:" + clave;
    const lockAcquired = await redis.set(lockKey, requestId, { nx: true, ex: 120 });
    if (!lockAcquired) {
      // Guardar mensaje como pendiente en vez de tirarlo
      try {
        const pendingKey = "pending:" + clave;
        const pendingRaw = await redis.get(pendingKey);
        const pending = pendingRaw ? (typeof pendingRaw === "string" ? JSON.parse(pendingRaw) : pendingRaw) : [];
        pending.push(mensaje);
        await redis.setex(pendingKey, 120, JSON.stringify(pending));
        console.log("MENSAJE GUARDADO COMO PENDIENTE:", clave, "total pendientes:", pending.length);
      } catch (e) {
        console.error("Error guardando pendiente:", e);
      }
      activeRequests.delete(requestId);
      return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
    }

    // Función para liberar el lock de forma segura
    async function releaseLock() {
      try {
        const script = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
        await redis.eval(script, [lockKey], [requestId]);
      } catch (e) {
        console.error("Error releasing lock:", e);
      }
    }

    // Helper: liberar lock + poner cooldown en todas las rutas de salida
    async function releaseConCooldown() {
      cooldownMemoria.set(clave, Date.now());
      await redis.setex(cooldownKey, 5, "true");
      await releaseLock();
    }

    try {
      const congelado = await getBotCongelado(clave);
      if (congelado) {
        console.log("Bot congelado para:", clave);
        await releaseConCooldown();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: null, respuesta2: null, alerta: "congelado", foto: false });
      }

      const esDaniel = telefono === "5218123793904" || subscriber_id === "5218123793904";
      if (!esDaniel && !dentroDeHorario()) {
        await releaseConCooldown();
        activeRequests.delete(requestId);
        return res.json({
          respuesta1: "Gracias por escribir, con gusto le atiendo mañana a primera hora.",
          respuesta2: null, alerta: null, foto: false
        });
      }

      const esNuevo = await esNuevoLead(clave);
      if (esNuevo) {
        backgroundTask("CAPI-ViewContent", mandarEventoViaManyChat("ViewContent", telefono || null, null, subscriber_id, nombre));
        await redis.setex("seguimiento:" + clave, 604800, JSON.stringify({
          subscriberId: subscriber_id, telefono: telefono || null, timestamp: Date.now(), ultimoMensaje: mensaje, alertaEnviada: false
        }));
        backgroundTask("frio", redis.setex("frio:" + clave, 1209600, JSON.stringify({
          subscriberId: subscriber_id, timestamp: Date.now(), alertaEnviada: false
        })));

        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_VIDEOS);
          backgroundTask("etiqueta", ponerEtiqueta(subscriber_id, "conversacion privada encino"));
          console.log("VIDEOS enviados + etiqueta en background para:", clave);
        } else {
          console.error("NO SE MANDARON VIDEOS: subscriber_id es null para clave:", clave);
        }
      } else {
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
        console.log("BOT SILENCIADO: conversacion expirada para:", clave);
        backgroundTask("lead-volvio", mandarTelegram("LEAD VOLVIO A ESCRIBIR (bot silenciado)\nCliente: " + (telefono || subscriber_id) + "\nNombre: " + (nombre || "sin nombre") + "\nMensaje: " + mensaje + "\n\nEl bot ya no responde. Escribele manualmente si quieres."));
        await releaseConCooldown();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
      }
      
      console.log("HISTORIAL:", clave, "esNuevo:", esNuevo, "mensajes:", conversacion.length);

      // ============================================================
      // VENTANA DE ACUMULACION — esperar 3s para que si el cliente
      // manda varios mensajes seguidos, se acumulen como pendientes
      // y Claude los procese todos juntos en una sola respuesta
      // ============================================================
      await new Promise(r => setTimeout(r, 3000));

      let mensajesPendientes = [];
      try {
        const pendingKey = "pending:" + clave;
        const pendingRaw = await redis.get(pendingKey);
        if (pendingRaw) {
          mensajesPendientes = typeof pendingRaw === "string" ? JSON.parse(pendingRaw) : pendingRaw;
          await redis.del(pendingKey);
          console.log("MENSAJES PENDIENTES RECUPERADOS:", clave, "cantidad:", mensajesPendientes.length);
        }
      } catch (e) {
        console.error("Error leyendo pendientes:", e);
      }

      let mensajeCompleto = mensaje;
      if (mensajesPendientes.length > 0) {
        mensajeCompleto = mensaje + "\n" + mensajesPendientes.join("\n");
        console.log("MENSAJE COMBINADO para Claude:", mensajeCompleto);
      }

      if (primer_mensaje && conversacion.length === 0) {
        let contexto = "[PRIMERA INTERACCION - El cliente NO ha recibido ninguna informacion tuya aun. Debes presentarte como Daniel Soliz. El historial esta vacio.]";
        if (primer_mensaje !== mensajeCompleto && primer_mensaje !== mensaje) {
          contexto += " [Llego por un anuncio, su primer mensaje del anuncio fue: " + primer_mensaje + "]";
        }
        conversacion.push({
          role: "user",
          content: contexto + " " + mensajeCompleto
        });
      } else if (conversacion.length > 0) {
        // Construir contexto enriquecido inspeccionando historial
        let contextoExtra = "";
        
        // BUG 3 FIX: Detectar qué activos ya se entregaron
        const activosEntregados = [];
        for (const msg of conversacion) {
          if (msg.role === "assistant") {
            if (msg.content.includes("[Mapa de disponibilidad enviado]") || msg.content.includes("$1,700,000") || /\$\s*1[.,]?7\d{2}[.,]?\d{3}/.test(msg.content)) activosEntregados.push("precios+mapa");
            if (msg.content.includes("[PDF folleto enviado]")) activosEntregados.push("PDF folleto");
            if (msg.content.includes("maps.app.goo.gl")) activosEntregados.push("ubicacion");
            if (msg.content.includes("Manejamos financiamiento") || msg.content.includes("mensualidades")) activosEntregados.push("financiamiento");
          }
        }
        if (activosEntregados.length > 0) {
          contextoExtra += " [Ya entregaste: " + [...new Set(activosEntregados)].join(", ") + ". NO repitas la pregunta de que le interesa. Avanza al siguiente paso del flujo.]";
        }
        
        // BUG 1 FIX: Detectar si el último mensaje del assistant fue la pregunta multi-opción
        const ultimoAssistant = [...conversacion].reverse().find(m => m.role === "assistant");
        if (ultimoAssistant && /qu[eé] le interesa/i.test(ultimoAssistant.content)) {
          const afirmacionInclusiva = /^(s[ií]|todo|las\s*3|todos|ambos|los\s*tres|claro|dale|ok|va|s[ií]\s*(me\s+interesa|por\s+favor|claro|todo|las\s*3)|las\s*tres\s*cosas|s[ií]\s*,?\s*todo)[.,!?\s]*$/i;
          if (afirmacionInclusiva.test(mensajeCompleto.trim())) {
            contextoExtra += " [El cliente afirmo querer TODA la informacion ofrecida. Entrega ubicacion (link Google Maps) + MAPA_DISPONIBILIDAD con lista completa de precios + pregunta de plan de pagos. NO repitas la pregunta de que le interesa.]";
          }
        }
        
        conversacion.push({
          role: "user",
          content: "[Conversacion en curso, mensaje #" + (Math.floor(conversacion.length / 2) + 1) + " del cliente. NO te presentes de nuevo.]" + contextoExtra + " " + mensajeCompleto
        });
      } else {
        conversacion.push({ role: "user", content: mensajeCompleto });
      }

      // ============================================================
      // CLAUDE — timeout de 15s, 2 reintentos
      // ============================================================
      let data = null;
      let claudeOk = false;
      for (let intento = 1; intento <= 2; intento++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
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
          if (intento < 2) await new Promise(r => setTimeout(r, response.status === 529 ? 3000 : 1000));
        } catch (claudeErr) {
          console.error("Claude intento", intento, "excepcion:", claudeErr.message);
          if (intento < 2) await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (!claudeOk) {
        backgroundTask("claude-fallo-telegram", mandarTelegram("CLAUDE FALLO (API caida)\nCliente: " + (telefono || subscriber_id) + "\nNombre: " + (nombre || "sin nombre") + "\nMensaje: " + mensaje + "\n\nEl bot le dijo 'Dame un momento'. Respondele manualmente."));
        await releaseConCooldown();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: "Claro, con gusto le atiendo. Dame un momento.", respuesta2: null, alerta: null, foto: false });
      }
      if (data.content) { console.log("CLAUDE BLOQUES:", data.content.map(b => b.type).join(", "), "| clave:", clave); }
      const textBlocks = data.content ? data.content.filter(b => b.type === "text") : [];
      if (!textBlocks.length) {
        console.error("Error Claude (sin bloques):", JSON.stringify(data));
        backgroundTask("claude-sinbloques-telegram", mandarTelegram("CLAUDE FALLO (sin bloques)\nCliente: " + (telefono || subscriber_id) + "\nNombre: " + (nombre || "sin nombre") + "\nMensaje: " + mensaje + "\n\nEl bot le dijo 'Un momento'. Respondele manualmente."));
        await releaseConCooldown();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, alerta: null, foto: false });
      }

      let respuesta = textBlocks.map(b => b.text).join("\n").trim();
      console.log("RESPUESTA:", respuesta);

      // ============================================================
      // VALIDADOR POST-RESPUESTA
      // Tipo A: "referencia info ausente" → REGENERAR (la info falta)
      // Tipo B: "preguntas de cierre malas" → LIMPIAR (el resto está bien)
      // ============================================================
      const referenciaAusente = [
        /ya le (compart[ií]|envi[eé]|mand[eé]|puse|mencion[eé])/i,
        /como le (mencion[eé]|dije|coment[eé]|expliqu[eé])/i,
        /arriba le (puse|envi[eé]|compart[ií])/i,
      ];
      const preguntaMala = [
        /cu[aá]l le llama la atenci[oó]n/i,
        /cu[aá]l (prefiere|le gusta m[aá]s|le interesa m[aá]s)/i,
      ];
      // BUG 3 FIX: En turno 2+, también prohibir repetir la pregunta de bienvenida
      if (conversacion.length > 2) {
        preguntaMala.push(/qu[eé] le interesa (conocer )?m[aá]s/i);
        preguntaMala.push(/qu[eé] (informaci[oó]n )?le (gustar[ií]a|interesa)/i);
        preguntaMala.push(/qu[eé] le gustar[ií]a conocer/i);
      }

      const refAusente = referenciaAusente.find(r => r.test(respuesta));
      if (refAusente) {
        console.log("VALIDADOR TIPO A: referencia info ausente, regenerando | clave:", clave);
        backgroundTask("validador-regen-telegram", mandarTelegram("VALIDADOR: Claude referenció info no enviada\nCliente: " + (telefono || subscriber_id) + "\nRespuesta original: " + respuesta.substring(0, 200)));
        // Regenerar con feedback explícito
        try {
          const convRetry = [...conversacion, {
            role: "user",
            content: "[SISTEMA: Tu respuesta anterior dijo 'ya le comparti' sin incluir la informacion real. Vuelve a redactar incluyendo TODOS los datos completos. NUNCA referenciar mensajes anteriores.]"
          }];
          const ctrlRetry = new AbortController();
          const tRetry = setTimeout(() => ctrlRetry.abort(), 15000);
          const retryRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST", signal: ctrlRetry.signal,
            headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, system: SYSTEM_PROMPT, messages: convRetry })
          });
          clearTimeout(tRetry);
          const retryData = await retryRes.json();
          if (retryRes.ok && retryData.content) {
            const retryBlocks = retryData.content.filter(b => b.type === "text");
            if (retryBlocks.length) {
              respuesta = retryBlocks.map(b => b.text).join("\n").trim();
              console.log("RESPUESTA REGENERADA:", respuesta);
            }
          }
        } catch (retryErr) {
          console.error("Error regenerando respuesta:", retryErr.message);
        }
        // Si sigue con referencia ausente, devolver null
        if (referenciaAusente.some(r => r.test(respuesta))) {
          console.log("VALIDADOR: regeneración falló | clave:", clave);
          backgroundTask("validador-falla-telegram", mandarTelegram("VALIDADOR fallback\nCliente: " + (telefono || subscriber_id) + "\nMensaje: " + mensaje));
          await releaseConCooldown();
          activeRequests.delete(requestId);
          return res.json({ respuesta1: "Permítame un momento, le confirmo enseguida.", respuesta2: null, alerta: null, foto: false });
        }
      }

      // Tipo B: preguntas de cierre malas — solo limpiar
      const pregMala = preguntaMala.find(r => r.test(respuesta));
      if (pregMala) {
        console.log("VALIDADOR TIPO B: pregunta mala limpiada | clave:", clave);
        respuesta = respuesta.replace(/cu[aá]l le llama la atenci[oó]n[^.!?\n]*/gi, "")
          .replace(/cu[aá]l (prefiere|le gusta m[aá]s|le interesa m[aá]s)[^.!?\n]*/gi, "")
          .replace(/qu[eé] le interesa (conocer )?m[aá]s[^.!?\n]*/gi, "")
          .replace(/qu[eé] (informaci[oó]n )?le (gustar[ií]a|interesa)[^.!?\n]*/gi, "")
          .replace(/qu[eé] le gustar[ií]a conocer[^.!?\n]*/gi, "")
          .replace(/\n{2,}/g, "\n").trim();
      }

      // ============================================================
      // BUG 2 FIX: Mover TODA la limpieza de tokens ANTES del validador
      // de respuestas basura, para que la validación se haga sobre
      // el texto limpio (sin MAPA_DISPONIBILIDAD, PDF_ENCINO, etc.)
      // ============================================================
      let alerta = null;
      let foto = false;
      let enviarMapa = false;
      let enviarPDF = false;

      respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();

      // BUG 2 FIX: Detectar y strippear MAPA_DISPONIBILIDAD + guard de precios
      if (respuesta.includes("MAPA_DISPONIBILIDAD")) {
        // Guard: si tiene MAPA_DISPONIBILIDAD pero NO tiene precios, inyectar bloque canónico
        const tieneAlgunPrecio = /\$\s*1[.,]?7\d{2}[.,]?\d{3}/.test(respuesta);
        if (!tieneAlgunPrecio) {
          console.log("GUARD: MAPA_DISPONIBILIDAD sin precios, inyectando bloque canónico | clave:", clave);
          respuesta = respuesta.replace(/MAPA_DISPONIBILIDAD/g, "").trim();
          const bloquePreciosCanonicos = "Estos son los 2 lotes disponibles:\nLote 1 - 1,648 m2, ~$2,000,000~ hoy en *$1,700,000*\nLote 3B - 1,700 m2, ~$2,100,000~ hoy en *$1,785,000*\nContamos con financiamiento directo sin intereses.";
          respuesta = respuesta ? respuesta + "\n" + bloquePreciosCanonicos : bloquePreciosCanonicos;
        } else {
          respuesta = respuesta.replace(/MAPA_DISPONIBILIDAD/g, "").trim();
        }
        if (subscriber_id) enviarMapa = true;
      }

      if (respuesta.includes("PDF_ENCINO")) {
        respuesta = respuesta.replace(/PDF_ENCINO/g, "").trim();
        if (subscriber_id) enviarPDF = true;
      }

      if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
        const match = respuesta.match(/ALERTA_VISITA_PENDIENTE:?\s*(.*)/);
        alerta = "ALERTA_VISITA_PENDIENTE";
        respuesta = respuesta.replace(/ALERTA_VISITA_PENDIENTE:?.*$/gm, "").trim();
        const detalle = match ? match[1] : "";
        backgroundTask("visita-telegram", mandarTelegram("VISITA PENDIENTE\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + detalle + "\nResponde TU para confirmar"));
        backgroundTask("visita-save", guardarVisita(clave, detalle));
        backgroundTask("visita-congelar", setBotCongelado(clave, true));
        const schedKey = "capi_sched:" + clave;
        const schedEnviado = await redis.get(schedKey);
        if (!schedEnviado) {
          await redis.setex(schedKey, 2592000, "true");
          backgroundTask("visita-capi", mandarEventoViaManyChat("Schedule", telefono || null, null, subscriber_id, nombre));
        }
        if (subscriber_id) backgroundTask("visita-etiqueta", ponerEtiqueta(subscriber_id, "cita privada encino"));

      } else if (respuesta.includes("ALERTA_VISITA_CONFIRMADA")) {
        const match = respuesta.match(/ALERTA_VISITA_CONFIRMADA:?\s*(.*)/);
        alerta = "ALERTA_VISITA_CONFIRMADA";
        respuesta = respuesta.replace(/ALERTA_VISITA_CONFIRMADA:?.*$/gm, "").trim();
        backgroundTask("confirmada-telegram", mandarTelegram("VISITA CONFIRMADA\n" + (match ? match[1] : telefono)));
        if (subscriber_id) backgroundTask("confirmada-etiqueta", ponerEtiqueta(subscriber_id, "cita privada encino"));

      } else if (respuesta.includes("ALERTA_VISITA_OTRO_DIA")) {
        const match = respuesta.match(/ALERTA_VISITA_OTRO_DIA:?\s*(.*)/);
        alerta = "ALERTA_VISITA_OTRO_DIA";
        respuesta = respuesta.replace(/ALERTA_VISITA_OTRO_DIA:?.*$/gm, "").trim();
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
          backgroundTask("presupuesto-capi", mandarEventoViaManyChat("CompleteRegistration", telefono || null, null, subscriber_id, nombre));
        }

      } else if (respuesta.includes("ALERTA_PRESUPUESTO_BAJO")) {
        alerta = "ALERTA_PRESUPUESTO_BAJO";
        respuesta = respuesta.replace(/ALERTA_PRESUPUESTO_BAJO/g, "").trim();

      } else if (respuesta.includes("ALERTA_SEGUIMIENTO")) {
        const match = respuesta.match(/ALERTA_SEGUIMIENTO:?\s*(.*)/);
        alerta = "ALERTA_SEGUIMIENTO";
        respuesta = respuesta.replace(/ALERTA_SEGUIMIENTO:?.*$/gm, "").trim();
        const detalle = match ? match[1] : "";
        backgroundTask("seguimiento-telegram", mandarTelegram("SEGUIMIENTO\nCliente: " + (telefono || subscriber_id) + "\nPide contacto: " + detalle));

      } else if (respuesta.includes("ALERTA_CIERRE_VENTA")) {
        alerta = "ALERTA_CIERRE_VENTA";
        respuesta = respuesta.replace(/ALERTA_CIERRE_VENTA/g, "").trim();
        const purchKey = "capi_purch:" + clave;
        const purchEnviado = await redis.get(purchKey);
        if (!purchEnviado) {
          await redis.setex(purchKey, 2592000, "true");
          backgroundTask("cierre-capi", mandarEventoViaManyChat("Purchase", telefono || null, 1700000, subscriber_id, nombre));
        }
        backgroundTask("cierre-telegram", mandarTelegram("CIERRE DE VENTA\nCliente: " + (telefono || subscriber_id)));
      }

      if (respuesta.includes("ALERTA_PDF_ENVIADO")) {
        respuesta = respuesta.replace(/ALERTA_PDF_ENVIADO/g, "").trim();
      }

      // BUG 2 FIX: Guard final de respuestas basura DESPUÉS de limpiar tokens
      const limpia = respuesta.trim();
      const empiezaMal = /^[,;:.\s]|^(y |pero |son |está |los |las )/i.test(limpia);
      const esSoloEmoji = /^[\p{Extended_Pictographic}\s]+$/u.test(limpia);
      const muyCorta = !esSoloEmoji && limpia.length < 10;
      if (empiezaMal || muyCorta || !limpia) {
        console.log("VALIDADOR: respuesta basura detectada, devolviendo null | clave:", clave);
        await releaseConCooldown();
        activeRequests.delete(requestId);
        return res.json({ respuesta1: null, respuesta2: null, alerta: null, foto: false });
      }

      if (conversacion.length >= 5) {
        const icKey = "capi_ic:" + clave;
        const icEnviado = await redis.get(icKey);
        if (!icEnviado) {
          await redis.setex(icKey, 2592000, "true");
          backgroundTask("CAPI-InitiateCheckout", mandarEventoViaManyChat("InitiateCheckout", telefono || null, null, subscriber_id, nombre));
          console.log("CAPI InitiateCheckout disparado para:", clave, "mensajes:", conversacion.length);
        }
      }

      const PREG_FINANC = "\u00bfLe gustar\u00eda conocer el plan de pagos? \uD83D\uDCB3";
      const PREG_PLAN   = "\u00bfSe le acomoda este plan?";

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
          .replace(/(?<!\n)(Lote [\d\w]+)/g, "\n$1")
          .replace(/(Contamos con)/g, "\n$1")
          .replace(/^\n+/, "").trim();
      }

      // EXTRA FIX: Regex más laxo para detectar precios (cubre $1.700.000, $1,700,000 MXN, etc.)
      const regexPrecio1 = /\$\s*1[.,]?7[0O]0[.,]?\d{3}/i;
      const regexPrecio2 = /\$\s*1[.,]?78[5S][.,]?\d{3}/i;
      const tienePrecios = regexPrecio1.test(respuesta) || regexPrecio2.test(respuesta);
      if (tienePrecios) {
        const idxP = partes.findIndex(p => regexPrecio1.test(p) || regexPrecio2.test(p));
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

      const tieneFinanciamiento = !tienePrecios && (respuesta.includes("Manejamos financiamiento") || /mensualidades\s+(de|desde)/i.test(respuesta));
      if (tieneFinanciamiento) {
        const idxF   = partes.findIndex(p => p.includes("Manejamos financiamiento") || /mensualidades\s+(de|desde)/i.test(p));
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

      console.log("FINAL r1:", respuesta1 ? respuesta1.substring(0,50) : "VACIA", "| r2:", respuesta2 || "null");

      // BUG 3 FIX: guardar en historial lo que REALMENTE se envió + marcar activos entregados
      let textoEnviado = (respuesta1 || "") + (respuesta2 ? "\n" + respuesta2 : "");
      if (enviarMapa) textoEnviado += "\n[Mapa de disponibilidad enviado al cliente]";
      if (enviarPDF) textoEnviado += "\n[PDF folleto enviado al cliente]";
      conversacion.push({ role: "assistant", content: textoEnviado });
      if (conversacion.length > 20) {
        conversacion = conversacion.slice(-20);
        if (conversacion[0].role === "assistant") conversacion = conversacion.slice(1);
      }
      await setConversacion(clave, conversacion);

      // Fix #6 actualizado: drenar pendientes huerfanos PROCESANDO con Claude
      // (no solo alerta a Telegram). El delay deja al ciclo principal liberar su
      // lock via releaseConCooldown antes de que el drain intente tomarlo.
      backgroundTask("pending-drain", (async () => {
        await new Promise(r => setTimeout(r, 300));
        await drainPendientesConClaude(clave, subscriber_id, telefono);
      })());

      await releaseConCooldown();
      activeRequests.delete(requestId);
      
      // BUG 2 FIX: Enviar res.json PRIMERO, luego mapa/PDF en background
      // Esto evita que sendFlow de ManyChat bloquee/interrumpa la respuesta del webhook
      res.json({ respuesta1, respuesta2, alerta, foto: false });
      
      // Mapa y PDF se envían DESPUÉS del res.json para que ManyChat procese
      // primero la respuesta del webhook y luego la inyección de contenido
      if (enviarMapa) {
        backgroundTask("mapa-envio", mandarContenido(subscriber_id, CONTENT_MAPA));
        console.log("MAPA programado en background para:", subscriber_id);
      }
      if (enviarPDF) {
        backgroundTask("pdf-envio", mandarContenido(subscriber_id, CONTENT_PDF));
        console.log("PDF programado en background para:", subscriber_id);
      }
      return;

    } catch (error) {
      console.error("Error webhook procesamiento:", error);
      try {
        cooldownMemoria.set(clave, Date.now());
        await redis.setex(cooldownKey, 5, "true");
        if (dedupKey) await redis.del(dedupKey);
        const script = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
        await redis.eval(script, ["lock:" + clave], [requestId]);
      } catch (e) { /* ignore */ }
      activeRequests.delete(requestId);
      if (!res.headersSent) {
        return res.json({ respuesta1: "Claro, con gusto le atiendo. Dame un momento.", respuesta2: null, alerta: null, foto: false });
      }
    }

  } catch (error) {
    console.error("Error webhook:", error);
    if (dedupKey) { try { await redis.del(dedupKey); } catch(e){} }
    activeRequests.delete(requestId);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno" });
    }
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
    const pendientes = await redis.keys("pending:*");
    for (const c of pendientes) await redis.del(c);
    // FIX: Limpiar keys de dedup de mensajes
    const dedups = await redis.keys("dedup:*");
    for (const c of dedups) await redis.del(c);
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
      await redis.del("pending:" + c);
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
  res.json({ status: "Agente Daniel - Privada Encino v3.8 funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log("Servidor Daniel v3.8 corriendo en puerto " + PORT);
});
