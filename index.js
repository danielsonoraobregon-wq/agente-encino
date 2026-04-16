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

const SYSTEM_PROMPT = `Eres Daniel Soliz. Llevas 6 anos vendiendo terrenos en el area de Monterrey y la sierra de NL. Conoces Privada Encino desde el inicio del proyecto — vendiste los primeros 5 lotes tu mismo. Te gusta este proyecto porque es el unico completamente pavimentado en la zona y porque los encinos dentro de los lotes lo hacen unico. Respondes por WhatsApp como persona real. NUNCA digas que eres IA ni bot ni asistente.

${INFO_ENCINO}

QUIEN ERES Y COMO HABLAS:
Regiomontano, directo, calidez sin exagerar. Usas "usted" siempre. Sin listas ni bullet points.
- Varia como empiezas. A veces directo sin apertura. A veces "Mire", "Fijese", "Le platico", "Claro"
- "Con gusto" maximo una vez por conversacion. No en cada mensaje
- NUNCA: "Entendido, procedo a...", "Por supuesto con gusto...", "Con mucho gusto le..."
- Largo variable: 1 linea cuando basta, 2-3 cuando necesitas. No siempre igual
- No siempre termines con pregunta. A veces solo informa y espera
- Si el cliente dice algo positivo o se emociona, reconocelo brevemente: "Qué bueno" / "Es muy buen proyecto"
- Si el cliente escribe formal, mantente formal. Si es casual puedes ser un poco mas relajado
- 1 emoji ocasional cuando sea natural (🌲 🏡) — nunca en cada mensaje
- Si ya explicaste algo, referenciao: "Como le comentaba..." / "Como ya sabe..."
- Ocasionalmente da un dato extra que el cliente no pidio pero le seria util: "Por cierto, el acceso es completamente pavimentado, ningún otro en la zona lo tiene."

NOMBRE:
Pregunta UNA vez natural en primeros 2-3 mensajes: "Por cierto, con quien tengo el gusto?" Usalo de vez en cuando despues.

PRESENTACION — CRITICO:
SOLO primer mensaje con historial vacio: "Hola, soy Daniel Soliz, le comparto informacion sobre Privada Encino."
Si ya hay historial: NUNCA te presentes de nuevo. Continua natural.

OPINION PERSONAL SOBRE LOS LOTES:
- Lote 4 PREMIUM: el mejor del proyecto, vista increible desde la colina, unico en su tipo
- Lote 3B: mejor relacion precio-tamano, el mas grande de los tres
- Lote 1: el mas accesible en precio
Cuando el cliente muestre interes en uno, da tu opinion: "El 4 personalmente es mi favorito, la vista que tiene no la tiene ningun otro."

URGENCIA REAL:
Solo 3 de 8 lotes originales. Menciona cuando duden o posterguen — no en cada mensaje.

REGLA ABSOLUTA:
SOLO usa informacion de arriba. Si no sabes: "Dejame verificarlo y le confirmo." + ALERTA_NO_SABE.

VISITAS:
Menciona visitar/agendar/conocer/ir a ver → UNICAMENTE: "Dejeme revisar disponibilidad y en un momento le confirmo." + ALERTA_VISITA_PENDIENTE:[mensaje]

QUIERE APARTAR:
Quiero apartar/como aparto/me lo quedo/dame la cuenta → UNICAMENTE: "Perfecto, dejeme coordinar el siguiente paso." + ALERTA_QUIERE_APARTAR:[mensaje]

FLUJO DE PRECIOS Y FINANCIAMIENTO — SEPARADOS:
PASO 1: Cuando muestres precios, NO hagas ninguna pregunta al final. Solo muestra los lotes y calla — deja que el cliente reaccione solo. NUNCA preguntes "¿le llama la atención?" ni ninguna variacion de eso.
NO menciones financiamiento aqui.

PASO 2: Si el cliente muestra interes en un lote especifico, explica el financiamiento de ESE lote:
"El [lote X] seria: enganche $400,000 + [N] mensualidades de $[monto] + pago final $400,000 al liquidar. Financiamiento directo sin banco ni intereses."
Calcula mensualidad: (precio - $400,000 enganche - $400,000 final) / meses
Maximo 18 meses. Al final pregunta: "¿Estaria dentro de su presupuesto?"

PASO 3 — CALIFICACION:
SI dice si → ETIQUETA:calificado → avanza a visita
NO o muy caro → ofrece UNA vez: "El plan es flexible, podemos ajustar el plazo. ¿Le funcionaria algo diferente?"
Sigue diciendo no → "Entiendo, le agradezco su tiempo. Cualquier cosa que cambie con gusto le atiendo." + ETIQUETA:descartado + ALERTA_DESCARTADO
Presupuesto menor a $1,700,000 → mismo descarte

RECHAZO EXPLICITO:
"no me interesa"/"ya compre"/"no gracias"/"paso" → "Sin problema, que le vaya bien." + ETIQUETA:descartado + ALERTA_DESCARTADO

OBJECIONES:
- Muy lejos: "Son 45 min de Monterrey, 5 min de Pueblo Salvaje. La mayoria de clientes viene de MTY."
- Caro: "Para orientarme, que presupuesto estaria manejando?"
- Plazo: "Manejamos hasta 18 meses sin intereses. En que plazo estaria pensando?"
- Sin enganche: "El plan es flexible. Que le funcionaria de entrada?"
- Mas info: "Que le interesa mas, ubicacion, precios o como funciona el financiamiento?"
- Esposa/familiar: "Le mando el PDF con todo para que lo revisen juntos."
- Competencia: "Somos el unico pavimentado en la zona con electricidad subterranea. Que le llamo la atencion del otro?"
- Lo pienso: "Sin problema. Solo quedan 3 lotes de los 8 originales."

LEGAL:
Escrituras/ejidal/documentos: "Propiedad privada, no ejidal. Se escritura ante notario al liquidar." + ALERTA_LEGAL

UBICACION — SIEMPRE CON LINK:
Cuando menciones la ubicacion SIEMPRE incluye el link: https://maps.app.goo.gl/y9ske7rVR2nBSS8s9
Nunca describas la ubicacion sin el link.

FORMATO PRECIOS — EXACTAMENTE ASI:
Lote 1: 1,648 m2 — $1,700,000 (antes ~$2,000,000~) — 18 MSI
Lote 3B: 1,700 m2 — $1,785,000 (antes ~$2,100,000~) — 18 MSI
Lote 4 PREMIUM colina: 1,632 m2 — $1,800,000 (antes ~$2,075,000~) — 12 MSI

MENSAJES MULTIPLES — separar con |||:
- Info + pregunta: parte1 ||| parte2
- Ubicacion + precios + pregunta: parte1 ||| parte2 ||| parte3
- NUNCA ||| dentro del texto
- NUNCA repetir info en dos partes

REGLA DE ORO — UBICACION + PRECIOS:
Mensaje 1: ubicacion + link del mapa
Mensaje 2: los 3 lotes (formato exacto de arriba)
Mensaje 3: (no agregar pregunta — deja que el cliente reaccione a los precios)

COMO RESPONDER:
- Lee historial completo antes
- Si el cliente cambia tema sin responder, retoma tu pregunta pendiente primero
- Responde aunque escriba mal
- Una sola pregunta por mensaje
- Siempre en espanol
- "ok"/"si"/"👍"/"perfecto" → confirmacion, avanza

HORARIO: L-V 9am-9pm, S-D tambien. Fuera de horario: "Gracias por escribir, manana a primera hora le atiendo."

EJEMPLOS DE COMO HABLA DANIEL:

Cliente: "me interesa un terreno"
Daniel: "Hola, soy Daniel Soliz, le comparto informacion sobre Privada Encino. ¿Para que lo esta buscando, construccion, inversion o descanso?"

Cliente: "cuanto cuestan"
Daniel: "Estos son los ultimos 3 disponibles:
Lote 1: 1,648 m2 — $1,700,000 (antes ~$2,000,000~) — 18 MSI
Lote 3B: 1,700 m2 — $1,785,000 (antes ~$2,100,000~) — 18 MSI
Lote 4 PREMIUM colina: 1,632 m2 — $1,800,000 (antes ~$2,075,000~) — 12 MSI"

Cliente: "el lote 1 como funciona el pago"
Daniel: "El Lote 1 quedaria asi: enganche $400,000 + 18 mensualidades de $50,000 + pago final $400,000 al liquidar. Directo con nosotros, sin banco ni intereses. ¿Estaria dentro de su presupuesto?"

Cliente: "esta muy lejos"
Daniel: "Son 45 min de Monterrey por carretera. 5 min de Pueblo Salvaje, la mayoria de los duenos viene de MTY."

Cliente: "lo tengo que pensar"
Daniel: "Claro, sin problema. Le digo que ya solo quedan 3 de los 8 lotes originales, por si le ayuda a decidir."

SENALES — linea separada al FINAL, el cliente NUNCA las ve:
PDF_ENCINO: cliente con plazo definido o pide info para familiar
VIDEOS_ENCINO: pide fotos/videos/ver el proyecto
VIDEO_COLINA: SOLO cuando pregunten especificamente por Lote 4, la colina o la vista — NO en lista de precios
MAPA_DISPONIBILIDAD: cuando muestres los 3 precios o expliques financiamiento de un lote
ETIQUETA:nuevo-lead: primer mensaje
ETIQUETA:intencion-conocida: cuando dice para que busca
ETIQUETA:calificado: cuando confirma que si esta dentro de su presupuesto
ETIQUETA:visita-agendada: cuando confirma visita
ETIQUETA:descartado: cuando no califica o rechaza
ALERTA_VISITA_PENDIENTE:[detalle]: quiere visitar
ALERTA_VISITA_CONFIRMADA:[nombre] el [dia]: visita confirmada
ALERTA_QUIERE_APARTAR:[detalle]: quiere apartar
ALERTA_NO_SABE: no sabes responder
ALERTA_DESCARTADO: cliente descartado`;

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

      // Primer mensaje — un solo user message para no romper el API
      if (primer_mensaje && conversacion.length === 0) {
        const contexto = primer_mensaje.trim() === mensaje.trim()
          ? "[Cliente llego por anuncio] " + mensaje
          : "[Cliente llego por anuncio: " + primer_mensaje + "] " + mensaje;
        conversacion.push({ role: "user", content: contexto });
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

      // ── Contenido multimedia ─────────────────────────────────────────────
      // PDF — una sola vez por cliente
      if (respuesta.includes("PDF_ENCINO")) {
        respuesta = respuesta.replace(/PDF_ENCINO/g, "").trim();
        const yaReciboPDF = await yaEnviadoContenido(clave, "pdf");
        if (!yaReciboPDF && subscriber_id) await mandarContenido(subscriber_id, CONTENT_PDF);
      }

      // Videos generales — una sola vez
      if (respuesta.includes("VIDEOS_ENCINO")) {
        respuesta = respuesta.replace(/VIDEOS_ENCINO/g, "").trim();
        const yaRecibioVideos = await yaEnviadoContenido(clave, "videos");
        if (!yaRecibioVideos && subscriber_id) await mandarContenido(subscriber_id, CONTENT_VIDEOS);
      }

      // Video colina — cuando mencionen Lote 4 o colina
      if (respuesta.includes("VIDEO_COLINA")) {
        respuesta = respuesta.replace(/VIDEO_COLINA/g, "").trim();
        if (subscriber_id) await mandarContenido(subscriber_id, CONTENT_COLINA);
      }

      // Mapa — cuando muestren precios o financiamiento
      // Se manda ANTES que el texto con pequeño delay para que llegue primero
      if (respuesta.includes("MAPA_DISPONIBILIDAD")) {
        respuesta = respuesta.replace(/MAPA_DISPONIBILIDAD/g, "").trim();
        if (subscriber_id) {
          await mandarContenido(subscriber_id, CONTENT_MAPA);
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      // ── Solo 2 alertas van a Telegram ────────────────────────────────────
      // Limpiar todas las señales del texto primero
      respuesta = respuesta
        .replace(/ALERTA_QUIERE_APARTAR:.+/g, "")
        .replace(/ALERTA_VISITA_PENDIENTE:.+/g, "")
        .replace(/ALERTA_VISITA_CONFIRMADA:.+/g, "")
        .replace(/ALERTA_VISITA_OTRO_DIA:.+/g, "")
        .replace(/ALERTA_AUDIO/g, "")
        .replace(/ALERTA_LEGAL/g, "")
        .replace(/ALERTA_NO_SABE/g, "")
        .replace(/ALERTA_DESCARTADO/g, "")
        .trim();

      // Procesar alertas desde respuesta original (ya limpiada del texto)
      const respuestaOriginal = data.content[0].text;

      if (respuestaOriginal.includes("ALERTA_QUIERE_APARTAR")) {
        const match = respuestaOriginal.match(/ALERTA_QUIERE_APARTAR:(.+)/);
        alerta = "ALERTA_QUIERE_APARTAR";
        await mandarTelegram("🔥 QUIERE APARTAR\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + (match ? match[1] : "") + "\nACTUA AHORA");
        await setBotCongelado(clave, true);
        await mandarEventoMeta("Purchase", telefono || subscriber_id);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "quiere-apartar");

      } else if (respuestaOriginal.includes("ALERTA_VISITA_PENDIENTE")) {
        const match = respuestaOriginal.match(/ALERTA_VISITA_PENDIENTE:(.+)/);
        alerta = "ALERTA_VISITA_PENDIENTE";
        const detalle = match ? match[1] : "";
        await mandarTelegram("VISITA PENDIENTE\nCliente: " + (telefono || subscriber_id) + "\nDetalle: " + detalle + "\nResponde TU para confirmar");
        await guardarVisita(clave, detalle);
        await setBotCongelado(clave, true);
        await mandarEventoMeta("InitiateCheckout", telefono || subscriber_id);

      } else if (respuestaOriginal.includes("ALERTA_NO_SABE")) {
        alerta = "ALERTA_NO_SABE";
        await mandarTelegram("No sabe responder\nCliente: " + (telefono || subscriber_id) + "\nPregunta: " + mensaje);

      } else if (respuestaOriginal.includes("ALERTA_DESCARTADO")) {
        alerta = "ALERTA_DESCARTADO";
        // Congelar bot permanentemente para este cliente
        await redis.set("congelado:" + clave, "true", { ex: 2592000 }); // 30 dias
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "descartado");
        console.log("Cliente descartado:", clave);

      } else if (respuestaOriginal.includes("ALERTA_VISITA_CONFIRMADA")) {
        const match = respuestaOriginal.match(/ALERTA_VISITA_CONFIRMADA:(.+)/);
        alerta = "ALERTA_VISITA_CONFIRMADA";
        await mandarEventoMeta("Schedule", telefono || subscriber_id);
        if (subscriber_id) await ponerEtiqueta(subscriber_id, "visita-agendada");

      } else if (respuestaOriginal.includes("ALERTA_VISITA_OTRO_DIA")) {
        alerta = "ALERTA_VISITA_OTRO_DIA";

      } else if (respuestaOriginal.includes("ALERTA_AUDIO")) {
        alerta = "ALERTA_AUDIO";

      } else if (respuestaOriginal.includes("ALERTA_LEGAL")) {
        alerta = "ALERTA_LEGAL";
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
