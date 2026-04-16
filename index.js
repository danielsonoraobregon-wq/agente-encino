const express = require("express");
const app = express();
app.use(express.json());

const { Redis } = require("@upstash/redis");
const crypto = require("crypto");

const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY    = process.env.MANYCHAT_API_KEY;
const META_DATASET_ID     = process.env.META_DATASET_ID;
const META_ACCESS_TOKEN   = process.env.META_ACCESS_TOKEN;
const UPSTASH_REDIS_REST_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN      = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const ADMIN_SECRET        = process.env.ADMIN_SECRET || "daniel2024";

const CONTENT_VIDEOS = "content20260416013522_274702";
const CONTENT_PDF    = "content20260416014533_080509";
const CONTENT_COLINA = "content20260416171717_406525";
const CONTENT_MAPA   = "content20260416180826_242262";

const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

// FIX #5 — procesando en Redis, no en memoria local (soporta múltiples instancias)
async function setProcesando(clave) {
  const result = await redis.set("proc:" + clave, "1", { nx: true, ex: 12 });
  return result === "OK" || result === 1;
}
async function delProcesando(clave) {
  await redis.del("proc:" + clave).catch(() => {});
}

// FIX #15 — tracking de contenido ya enviado
async function yaEnviadoContenido(clave, tipo) {
  const key = "enviado:" + tipo + ":" + clave;
  const result = await redis.set(key, "1", { nx: true, ex: 2592000 });
  return !(result === "OK" || result === 1); // true = ya fue enviado antes
}

const cooldownMemoria = new Map();

// Limpiar cooldownMemoria cada 10 min
setInterval(() => {
  const limite = Date.now() - 30000;
  for (const [k, ts] of cooldownMemoria.entries()) {
    if (ts < limite) cooldownMemoria.delete(k);
  }
}, 600000);

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

const INFO_ENCINO = `
PRIVADA ENCINO - INFORMACION OFICIAL

Proyecto campestre en Area de La Morita, Montemorelos, NL.
Frente al Restaurant El Pariente. 5 min de Pueblo Salvaje, 3 min del Rio Blanquillo, 45 min de Monterrey.
Maps: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9

Caracteristicas: unico proyecto pavimentado en la zona, acceso controlado, electricidad subterranea, red de agua, encinos y naranjos dentro de los lotes, libertad total de construccion. Solo quedan 3 lotes de los 8 originales.

PROPIEDAD PRIVADA, NO EJIDAL. Cada lote se escritura ante notario una vez liquidado el precio total. El proceso es: apartar con contrato, escrituras listas al liquidar. Sin complicaciones legales.

Lotes disponibles (PRECIO DE LANZAMIENTO - ULTIMOS 3 LOTES):
- Lote 1: 1,648 m2 (38x38m) — Precio original ~$2,000,000~, hoy $1,700,000 (ahorro $300,000) — 18 MSI
- Lote 3B: 1,700 m2 (43x39m) — Precio original ~$2,100,000~, hoy $1,785,000 (ahorro $315,000) — 18 MSI
- Lote 4 PREMIUM: 1,632 m2 (45x38m) — Precio original ~$2,075,000~, hoy $1,800,000 (ahorro $275,000) — 12 MSI — en colina con la mejor vista del proyecto

Plan de pagos (negociable, maximo 18 meses):
- Lote 1 ($1,700,000): precio - $400,000 enganche - $400,000 final = $900,000 / meses = mensualidad
- Lote 3B ($1,785,000): precio - $400,000 enganche - $400,000 final = $985,000 / meses = mensualidad
- Lote 4 PREMIUM ($1,800,000): precio - $400,000 enganche - $400,000 final = $1,000,000 / meses = mensualidad
- SIEMPRE incluir: Enganche $400,000 + mensualidades calculadas + pago final $400,000 al liquidar
- Plazo maximo 18 meses. Si el cliente pide mas, ofrecer 18 como maximo.
- Financiamiento directo sin banco, sin intereses. Negociable.

Proceso de apartar: contrato ante notaria, escrituras al liquidar.
Visitas: sabados y domingos.
`;

const SYSTEM_PROMPT = `Eres Daniel Soliz, asesor de ventas de Privada Encino en Montemorelos NL. Respondes por WhatsApp como persona real. NUNCA digas que eres IA ni que eres el dueno.

${INFO_ENCINO}

PERSONALIDAD:
Profesional, directo y cordial. Estilo Monterrey. Mensajes cortos, maximo 3 lineas. Sin listas ni bullet points. Siempre en espanol sin importar el idioma del cliente.

NOMBRE DEL CLIENTE:
En cuanto tengas oportunidad natural, pregunta el nombre: "Con quien tengo el gusto?" o "Como le llamo?" — una sola vez. Una vez que lo diga, usalo ocasionalmente para personalizar.

PRESENTACION:
En el primer mensaje presentate como: "Hola, soy Daniel Soliz, le estare compartiendo informacion sobre Privada Encino."

URGENCIA REAL — MENCIONAR NATURALMENTE:
Solo quedan 3 lotes de los 8 originales. Usa esto como urgencia genuina cuando el cliente dude o postergue, no en cada mensaje.

REGLA ABSOLUTA - INFORMACION:
SOLO usa la informacion que esta escrita arriba. NUNCA inventes cosas que no esten en el proyecto. Si el cliente pregunta algo que no esta en la informacion di exactamente: "Dejame verificarlo y le confirmo." y escribe ALERTA_NO_SABE al final.

CITAS Y VISITAS - MUY IMPORTANTE:
Si el cliente menciona querer visitar, agendar cita, conocer el terreno, ir a ver, o cualquier variacion — responde UNICAMENTE: "Con gusto, dejeme revisar disponibilidad y en un momento le confirmo." y escribe ALERTA_VISITA_PENDIENTE:[mensaje del cliente] al final. No digas nada mas.

QUIERE APARTAR - MUY IMPORTANTE:
Si el cliente dice "quiero apartar", "como aparto", "quiero el lote", "me lo quedo", "cuanto para apartar", "dame la cuenta", o cualquier variacion de interes en cerrar — responde UNICAMENTE: "Excelente, con mucho gusto le ayudo con eso. Dejeme un momento para coordinar el siguiente paso y le confirmo." y escribe ALERTA_QUIERE_APARTAR:[mensaje del cliente] al final. No des numeros de cuenta ni informacion de pago. No digas nada mas.

RECHAZO EXPLÍCITO:
Si el cliente dice "no me interesa", "ya compre en otro lado", "dejame", "no gracias", "paso", o similar — responde cordialmente: "Entendido, sin problema. Cualquier cosa que necesite con gusto le atiendo." y escribe ETIQUETA:descartado al final. No insistas.

MANEJO DE OBJECIONES:
- "Esta muy lejos" o similar: "Estamos a solo 45 min de Monterrey por carretera, 5 min de Pueblo Salvaje y 3 min del Rio Blanquillo. La mayoria de nuestros clientes vienen de Monterrey."
- "Esta caro" o "es mucho": "Entiendo. Para orientarme mejor, que presupuesto estaria manejando?"
- Si pregunta por plazo o meses: menciona que el maximo son 18 meses sin intereses. Ejemplo: "Manejamos hasta 18 meses sin intereses. En que plazo estaria pensando?"
- "No tengo el enganche" o "no tengo para el enganche": "El plan de pagos es flexible, podemos ajustarlo a su situacion. Que plazo le acomodaria?"
- "Mandame mas informacion": "Con gusto. Que le interesa saber mas, la ubicacion, los precios, las medidas o el financiamiento?"
- "Se lo paso a mi esposa" o familiar: "Con gusto, le puedo compartir el PDF con toda la informacion para que lo revisen juntos."
- "Vi otro proyecto" o competencia: "Privada Encino es el unico proyecto completamente pavimentado en la zona, con electricidad subterranea, acceso controlado y encinos dentro de los lotes. Que fue lo que mas le llamo la atencion del otro?"
- Pregunta por vecinos o quienes han comprado: "Hemos recibido mucho interes de familias de Monterrey que buscan un lugar tranquilo cerca de la ciudad."
- "Lo voy a pensar" o "despues te digo": "Claro, tometelo con calma. Solo le comento que ya solo quedan 3 lotes disponibles de los 8 originales, por si le ayuda a decidir."

PROCESO LEGAL - MUY IMPORTANTE:
Si el cliente pregunta por escrituras, proceso legal, si es ejidal, documentos o cualquier tema legal: responde "Es propiedad privada, no ejidal. Cada lote se escritura ante notario una vez liquidado. El proceso es sencillo: apartar con contrato y escrituras listas al liquidar." y escribe ALERTA_LEGAL al final.

PRECIOS - FORMATO WHATSAPP:
Cuando mencionas precios SIEMPRE usa tachado de WhatsApp para el precio original. Ejemplo: "El Lote 1 esta en $1,700,000, antes ~$2,000,000~."
No preguntes directamente si busca para inversion — deja que el cliente lo mencione.

COMO RESPONDER:
1. LEE el historial completo antes de responder. Nunca trates un mensaje como si fuera el primero si ya hay conversacion previa.
2. Si el cliente retoma un tema diferente sin responder lo anterior, retoma tu pregunta antes de responder lo nuevo.
3. RESPONDE siempre aunque escriba mal. "ubaicon"=ubicacion, "financmiento"=financiamiento.
4. NUNCA digas "no entiendo". Siempre responde algo util.
5. UNA sola pregunta por mensaje.
6. Siempre en espanol aunque el cliente escriba en otro idioma.
7. Si el cliente manda "ok", "si", "👍", "perfecto", "entendido" o similar — interpreta como confirmacion y avanza el flujo natural hacia la siguiente pregunta o hacia agendar visita.

REGLA DE ORO - NUNCA DES TODO JUNTO:
Si el cliente pide precios, ubicacion, medidas y/o financiamiento en el mismo mensaje:
- Mensaje 1: ubicacion con link del mapa
- Mensaje 2: los 3 lotes con medidas, precio tachado y precio actual en lineas separadas (una linea por lote)
- Mensaje 3: pregunta que le interesa mas o siguiente paso
Usa ||| para separar cada bloque. SIEMPRE usa este formato cuando pidan precios o medidas.

FORMATO PRECIOS — SIEMPRE ASI, UNO POR LINEA:
Lote 1: 1,648 m2 — ,700,000 (antes ~,000,000~) — 18 MSI
Lote 3B: 1,700 m2 — ,785,000 (antes ~,100,000~) — 18 MSI
Lote 4 PREMIUM colina: 1,632 m2 — $1,800,000 (antes ~$2,075,000~) — 12 MSI

MENSAJES EN 2 O 3 PARTES:
Cuando necesites dar informacion Y hacer una pregunta, separa con |||
Cuando des ubicacion + precios + pregunta, siempre usa ||| dos veces para hacer 3 mensajes separados.
IMPORTANTE: NUNCA uses ||| dentro de texto normal, solo como separador de mensajes.
NUNCA repitas la misma informacion en dos partes del mismo mensaje.

SENALES — REGLA CRITICA:
Las senales como VIDEO_COLINA, PDF_ENCINO, VIDEOS_ENCINO, ETIQUETA:xxx, ALERTA_xxx van SIEMPRE en una linea separada al FINAL de toda la respuesta. NUNCA en medio del texto.

LOTE 4 PREMIUM:
Cada vez que menciones el Lote 4 PREMIUM o la colina, agrega VIDEO_COLINA al final de la respuesta para que el cliente vea el video.

FLUJO:
- Primer mensaje: presentate como Daniel Soliz y pregunta: Para que esta buscando el terreno, construccion, inversion o descanso?
- Primer mensaje con intencion clara: presentate brevemente y responde directo.
- Mensajes siguientes: continua naturalmente sin resetear.
- Objetivo: agendar visita sabado o domingo o lograr que quiera apartar.

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, con gusto le atiendo manana a primera hora."

SENALES - escribelas en linea separada al final, el cliente NUNCA las ve:
PDF_ENCINO: cuando el cliente tiene intencion clara Y menciona un plazo o meses (ejemplo: 18 meses, 12 meses, 3 años) — mandalo inmediatamente. Tambien cuando pide info para compartir con familiar.
VIDEOS_ENCINO: cuando el cliente pide fotos, imagenes, videos, ver el proyecto, o quiere ver como se ve
VIDEO_COLINA: cuando el cliente menciona o pregunta por el Lote 4 PREMIUM o la colina — SIEMPRE que lo menciones
MAPA_DISPONIBILIDAD: cuando muestres precios o expliques financiamiento — escribela al final en linea separada, NUNCA dentro del texto
ETIQUETA:nuevo-lead: primer mensaje
ETIQUETA:intencion-conocida: cuando dice que busca
ETIQUETA:calificado: cuando tiene plazo definido
ETIQUETA:visita-agendada: cuando confirma visita
ETIQUETA:descartado: cuando rechaza explicitamente
ALERTA_VISITA_PENDIENTE:[detalle]: quiere visitar
ALERTA_VISITA_CONFIRMADA:[nombre] el [dia]: visita confirmada
ALERTA_VISITA_OTRO_DIA:[dia]: quiere visitar dia diferente
ALERTA_QUIERE_APARTAR:[detalle]: quiere apartar o cerrar trato
ALERTA_AUDIO: mando audio
ALERTA_NO_SABE: no sabes responder
ALERTA_LEGAL: pregunta por temas legales o escrituras`;

// ─── HELPERS ────────────────────────────────────────────────────────────────

function hashSHA256(valor) {
  if (!valor) return null;
  return crypto.createHash("sha256").update(valor.toLowerCase().trim()).digest("hex");
}

function dentroDeHorario() {
  const horaMX = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Monterrey" }));
  const hora = horaMX.getHours();
  return hora >= 9 && hora < 21;
}

function authAdmin(req, res) {
  const token = req.query.secret || req.headers["x-admin-secret"];
  if (token !== ADMIN_SECRET) {
    res.status(401).json({ error: "No autorizado" });
    return false;
  }
  return true;
}

// FIX #1 — cursor como Number para evitar loop infinito en Upstash
async function scanKeys(pattern) {
  let cursor = 0;
  const allKeys = [];
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(nextCursor);
    allKeys.push(...keys);
  } while (cursor !== 0);
  return allKeys;
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

// FIX #11 — guardar siempre los primeros 2 mensajes como contexto fijo
async function setConversacion(clave, mensajes) {
  try {
    let guardados = mensajes;
    if (mensajes.length > 14) {
      const cabeza = mensajes.slice(0, 2);   // primeros 2 siempre fijos
      const cola   = mensajes.slice(-12);    // últimos 18
      guardados = [...cabeza, ...cola];
    }
    await redis.setex("conv:" + clave, 86400, JSON.stringify(guardados));
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
    const result = await redis.set("lead:" + clave, "true", { nx: true, ex: 2592000 });
    return result === "OK" || result === 1;
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

async function mandarTelegram(mensaje, reintentos = 2) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  for (let i = 0; i <= reintentos; i++) {
    try {
      const res = await fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensaje })
      });
      if (res.ok) return;
    } catch (e) {
      console.error("Error Telegram intento", i + 1, e.message);
    }
    if (i < reintentos) await new Promise(r => setTimeout(r, 1500));
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
      body: JSON.stringify({ subscriber_id: subscriberId, flow_ns: contentNs })
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
    const claves = await scanKeys("seguimiento:*");
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
    const clavesLeads = await scanKeys("frio:*");
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
    const leads     = await scanKeys("lead:*");
    const visitas   = await scanKeys("visita:*");
    const congelados = await scanKeys("congelado:*");
    const fecha = new Date().toLocaleDateString("es-MX", { timeZone: "America/Monterrey" });

    let lineas = [
      "Reporte diario - Privada Encino",
      fecha, "",
      "Leads totales: " + leads.length,
      "Visitas pendientes: " + visitas.length,
      "Esperando respuesta tuya: " + congelados.length,
    ];

    if (visitas.length > 0) {
      lineas.push("\nVisitas pendientes:");
      for (const clave of visitas) {
        const data = await redis.get(clave);
        if (!data) continue;
        const v = typeof data === "string" ? JSON.parse(data) : data;
        lineas.push("  • " + (v.clave || clave) + ": " + (v.detalle || "sin detalle"));
      }
    }

    await mandarTelegram(lineas.join("\n"));
  } catch (e) {
    console.error("Error reporte:", e);
  }
}

setInterval(verificarSeguimientos, 3600000);
setInterval(() => {
  const horaMX = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Monterrey" }));
  if (horaMX.getHours() === 21 && horaMX.getMinutes() < 5) reporteDiario();
}, 300000);

// ─── WEBHOOK PRINCIPAL ───────────────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  try {
    const { telefono, mensaje, subscriber_id, primer_mensaje } = req.body;
    console.log(new Date().toISOString(), "BODY:", JSON.stringify(req.body));

    if (!mensaje) return res.status(400).json({ error: "Falta mensaje" });

    const clave = subscriber_id || telefono || "desconocido";

    // FIX #5 — anti-duplicado en Redis (multi-instancia safe)
    const puedeProcesar = await setProcesando(clave);
    if (!puedeProcesar) {
      return res.json({ respuesta1: null, respuesta2: null, respuesta3: null, alerta: null });
    }

    const ahoritaCooldown = cooldownMemoria.get(clave);
    if (ahoritaCooldown && Date.now() - ahoritaCooldown < 5000) {
      await delProcesando(clave);
      return res.json({ respuesta1: null, respuesta2: null, respuesta3: null, alerta: null });
    }

    const enCooldown = await redis.get("cooldown:" + clave);
    if (enCooldown) {
      await delProcesando(clave);
      return res.json({ respuesta1: null, respuesta2: null, respuesta3: null, alerta: null });
    }

    try {
      const congelado = await getBotCongelado(clave);
      if (congelado) {
        await delProcesando(clave);
        return res.json({ respuesta1: null, respuesta2: null, respuesta3: null, alerta: "congelado" });
      }

      // FIX #14 — guardar en historial aunque sea fuera de horario
      if (!dentroDeHorario()) {
        let conv = await getConversacion(clave);
        conv.push({ role: "user", content: mensaje });
        conv.push({ role: "assistant", content: "Gracias por escribir, con gusto le atiendo manana a primera hora." });
        await setConversacion(clave, conv);
        await delProcesando(clave);
        return res.json({
          respuesta1: "Gracias por escribir, con gusto le atiendo manana a primera hora.",
          respuesta2: null, respuesta3: null, alerta: null
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
        // Videos en primer mensaje
        if (subscriber_id) await mandarContenido(subscriber_id, CONTENT_VIDEOS);
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

      // FIX #17 — primer_mensaje no duplica texto
      if (primer_mensaje && conversacion.length === 0) {
        conversacion.push({
          role: "user",
          content: "[Cliente llego por anuncio. Mensaje inicial: " + primer_mensaje + "]"
        });
        if (primer_mensaje.trim() !== mensaje.trim()) {
          conversacion.push({ role: "user", content: mensaje });
        }
      } else {
        conversacion.push({ role: "user", content: mensaje });
      }

      // Timeout 25s en Claude
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      let claudeResponse;
      try {
        claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: conversacion
          })
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await claudeResponse.json();

      if (!data.content || !data.content[0] || !data.content[0].text) {
        console.error("Error Claude:", JSON.stringify(data));
        // FIX #3 — guardar conversación aunque Claude falle
        await setConversacion(clave, conversacion);
        await delProcesando(clave);
        return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, respuesta3: null, alerta: null });
      }

      let respuesta = data.content[0].text;
      console.log(new Date().toISOString(), "RESPUESTA RAW:", respuesta);

      // ── Procesar señales ANTES de guardar en historial ────────────────────
      let alerta = null;

      const etiquetasMatch = respuesta.match(/ETIQUETA:[a-zA-Z0-9_-]+/g);
      if (etiquetasMatch) {
        for (const e of etiquetasMatch) {
          const nombre = e.replace("ETIQUETA:", "");
          if (subscriber_id) await ponerEtiqueta(subscriber_id, nombre);
          if (nombre === "calificado") await mandarEventoMeta("CompleteRegistration", telefono || subscriber_id);
        }
        respuesta = respuesta.replace(/ETIQUETA:[a-zA-Z0-9_-]+/g, "").trim();
      }

      // FIX #10 — PDF y Videos no pueden mandarse juntos, PDF tiene prioridad
      const quierePDF    = respuesta.includes("PDF_ENCINO");
      const quiereVideos = respuesta.includes("VIDEOS_ENCINO");

      if (quierePDF) {
        respuesta = respuesta.replace(/PDF_ENCINO/g, "").trim();
        if (subscriber_id) await mandarContenido(subscriber_id, CONTENT_PDF);
        await mandarTelegram("PDF enviado\nCliente: " + (telefono || subscriber_id));
      } else if (quiereVideos) {
        // FIX #15 — no mandar videos si ya los recibio antes
        respuesta = respuesta.replace(/VIDEOS_ENCINO/g, "").trim();
        const yaRecibioVideos = await yaEnviadoContenido(clave, "videos");
        if (!yaRecibioVideos && subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_VIDEOS);
          console.log("Videos enviados a:", subscriber_id);
        } else {
          console.log("Videos ya enviados antes a:", subscriber_id, "— omitiendo");
        }
      }

      if (respuesta.includes("ALERTA_QUIERE_APARTAR")) {
        const match = respuesta.match(/ALERTA_QUIERE_APARTAR:(.+)/);
        alerta = "ALERTA_QUIERE_APARTAR";
        respuesta = respuesta.replace(/ALERTA_QUIERE_APARTAR:.+/g, "").trim();
        const detalle = match ? match[1] : "";
        await mandarTelegram("🔥 QUIERE APARTAR\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + detalle + "\nACTUA AHORA");
        await setBotCongelado(clave, true);
        await mandarEventoMeta("Purchase", telefono || subscriber_id);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "quiere-apartar");

      } else if (respuesta.includes("ALERTA_VISITA_PENDIENTE")) {
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
        await mandarTelegram("No sabe responder\nCliente: " + (telefono || subscriber_id) + "\nPregunta: " + mensaje);
      }

      // FIX #4 — si respuesta queda vacía después de limpiar señales, usar fallback
      respuesta = respuesta.trim();
      if (!respuesta) {
        respuesta = "Con gusto, en un momento le confirmo.";
      }

      // Guardar en historial DESPUÉS de limpiar señales
      conversacion.push({ role: "assistant", content: respuesta });
      await setConversacion(clave, conversacion);

      if (etiquetasMatch && etiquetasMatch.includes("ETIQUETA:calificado")) {
        const resumen = conversacion.filter(m => m.role === "user").map(m => m.content).join(" | ");
        await mandarTelegram("LEAD CALIFICADO\nCliente: " + (telefono || subscriber_id) + "\nResumen: " + resumen);
      }

      // FIX #9 — separador cambiado a ||| en vez de ---
      const partes = respuesta.split("|||");
      const respuesta1 = partes[0].trim();
      const respuesta2 = partes[1] ? partes[1].trim() : null;
      const respuesta3 = partes[2] ? partes[2].trim() : null;

      cooldownMemoria.set(clave, Date.now());
      await redis.setex("cooldown:" + clave, 5, "true");
      await delProcesando(clave);
      res.json({ respuesta1, respuesta2, respuesta3, alerta: alerta || null });

    } catch (innerError) {
      await delProcesando(clave);
      if (innerError.name === "AbortError") {
        console.error("Timeout Claude para:", clave);
        return res.json({ respuesta1: "Un momento, dejame verificarlo.", respuesta2: null, respuesta3: null, alerta: null });
      }
      throw innerError;
    }

  } catch (error) {
    console.error("Error webhook:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── ENDPOINTS ADMIN ─────────────────────────────────────────────────────────

app.post("/descongelar", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { clave } = req.body;
    if (!clave) return res.status(400).json({ error: "Falta clave" });
    await setBotCongelado(clave, false);
    res.json({ status: "Bot descongelado para: " + clave });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/estado/:clave", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const clave = req.params.clave;
    const [congelado, conversacion, lead, visita] = await Promise.all([
      getBotCongelado(clave),
      getConversacion(clave),
      redis.get("lead:" + clave),
      redis.get("visita:" + clave)
    ]);
    res.json({
      clave,
      congelado,
      es_lead: !!lead,
      mensajes_en_historial: conversacion.length,
      tiene_visita_pendiente: !!visita,
      visita_detalle: visita ? (typeof visita === "string" ? JSON.parse(visita) : visita) : null,
      historial: conversacion
    });
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
  if (!authAdmin(req, res)) return;
  await reporteDiario();
  res.json({ status: "Reporte enviado" });
});

app.get("/limpiar", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const prefijos = ["conv:*", "congelado:*", "cooldown:*", "lead:*", "seguimiento:*", "frio:*", "visita:*", "proc:*", "enviado:*"];
    let total = 0;
    for (const p of prefijos) {
      const claves = await scanKeys(p);
      for (const c of claves) await redis.del(c);
      total += claves.length;
    }
    res.json({ status: "Todo limpiado", claves_borradas: total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "Agente Daniel - Privada Encino v3.3 funcionando" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor Daniel v3.3 corriendo en puerto " + PORT));
