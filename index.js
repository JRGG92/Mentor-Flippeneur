const express = require("express");
const crypto = require("crypto");

// Twilio manda webhooks como x-www-form-urlencoded
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

const BOT_NAME = process.env.BOT_NAME || "Mentor Flippeneur";

// ===== OpenAI (sin SDK para evitar líos de versiones) =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== Twilio =====
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // whatsapp:+14155238886 (sandbox)

// ===== Admin =====
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// ===== Web search (opcional) =====
const ENABLE_WEB_SEARCH = String(process.env.ENABLE_WEB_SEARCH || "").toLowerCase() === "true";
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ===== “DB” súper simple en memoria (para arrancar rápido) =====
// En producción, lo ideal es guardar esto en Postgres/Redis/S3.
// Para tu MVP, lo mantenemos en RAM y lo recargas subiendo VTT cuando reinicie.
let KB_CHUNKS = []; // [{id, text, embedding: number[]}]
let KB_READY = false;

// -------------------- Utils --------------------
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function chunkText(text, chunkSize = 900, overlap = 120) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + chunkSize, clean.length);
    const piece = clean.slice(i, end).trim();
    if (piece.length > 40) chunks.push(piece);
    i = end - overlap;
    if (i < 0) i = 0;
    if (i >= clean.length) break;
  }
  return chunks;
}

function vttToText(vttRaw) {
  // Quita headers, timestamps y numeritos
  const lines = vttRaw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (l === "WEBVTT") continue;
    if (/^\d+$/.test(l)) continue;
    if (l.includes("-->")) continue;
    // Quita tags tipo <c> </c>
    out.push(l.replace(/<[^>]+>/g, "").trim());
  }
  return out.join(" ");
}

// -------------------- OpenAI calls --------------------
async function openaiEmbeddings(input) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI embeddings error: ${r.status} ${t}`);
  }
  const j = await r.json();
  return j.data[0].embedding;
}

async function openaiChat({ system, user, temperature = 0.2 }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI chat error: ${r.status} ${t}`);
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() || "";
}

// -------------------- Web Search (Serper) --------------------
async function serperSearch(query) {
  if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY missing");
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Serper error: ${r.status} ${t}`);
  }
  const j = await r.json();
  const items = (j.organic || []).slice(0, 5).map(x => ({
    title: x.title,
    link: x.link,
    snippet: x.snippet,
  }));
  return items;
}

// -------------------- Policy / Routing --------------------
const ALLOWED_TOPICS = [
  "flipping",
  "infonavit",
  "meta ads",
  "facebook ads",
  "marketing",
  "publicidad",
  "cuentas mancomunadas",
  "crédito hipotecario",
  "remodelación",
  "avaluo",
  "notario",
  "contratos",
];

async function classifyIntent(userText) {
  // Le pedimos al modelo un JSON simple para decidir:
  // - allowed: si es Flipping o temas permitidos
  // - needs_web: si probablemente no esté en KB (p.ej. “cambió algo este año”, “precio actual”, etc.)
  const system = `
Eres un clasificador estricto.
Devuelve SOLO JSON válido (sin markdown) con:
{
 "allowed": boolean,
 "topic": "flipping|meta_ads|infonavit|otro",
 "needs_web": boolean
}
Reglas:
- allowed=true SOLO si es sobre flipping inmobiliario o estos temas: ${ALLOWED_TOPICS.join(", ")}.
- Si la pregunta es de cualquier otra cosa (salud, política, chismes, etc) => allowed=false.
- needs_web=true si la pregunta depende de info actual o externa (precios actuales, reglas recientes, cambios de plataforma, etc),
  o si la KB probablemente no lo cubra.
`;
  const user = `Pregunta: ${userText}`;
  const raw = await openaiChat({ system, user, temperature: 0 });
  try {
    return JSON.parse(raw);
  } catch {
    // fallback ultra simple
    const t = userText.toLowerCase();
    const allowed = ALLOWED_TOPICS.some(k => t.includes(k));
    return { allowed, topic: allowed ? "flipping" : "otro", needs_web: false };
  }
}

async function retrieveContext(userText, topK = 5) {
  if (!KB_READY || KB_CHUNKS.length === 0) return [];
  const qEmb = await openaiEmbeddings(userText);
  const scored = KB_CHUNKS.map(c => ({
    ...c,
    score: cosineSim(qEmb, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// -------------------- Routes --------------------
app.get("/", (req, res) => res.status(200).send(`${BOT_NAME} activo ✅`));
app.get("/health", (req, res) => res.status(200).send("ok"));

// ✅ Admin: subir .vtt (texto crudo) para alimentar KB
// POST /admin/upload-vtt
// Headers: x-admin-token: TU_ADMIN_TOKEN
// Body JSON: { "filename": "clase1.vtt", "vtt": "WEBVTT..." }
app.post("/admin/upload-vtt", async (req, res) => {
  try {
    const token = req.headers["x-admin-token"];
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { filename, vtt } = req.body || {};
    if (!vtt || typeof vtt !== "string") {
      return res.status(400).json({ ok: false, error: "Missing vtt string" });
    }

    const text = vttToText(vtt);
    const chunks = chunkText(text, 900, 120);

    // Embeddings por chunk
    const newChunks = [];
    for (const ch of chunks) {
      const id = sha1((filename || "vtt") + ":" + ch.slice(0, 120));
      const embedding = await openaiEmbeddings(ch);
      newChunks.push({ id, text: ch, embedding });
    }

    // Merge sin duplicados
    const existing = new Set(KB_CHUNKS.map(x => x.id));
    for (const c of newChunks) {
      if (!existing.has(c.id)) KB_CHUNKS.push(c);
    }

    KB_READY = true;

    res.json({
      ok: true,
      filename: filename || null,
      added: newChunks.filter(x => !existing.has(x.id)).length,
      total_chunks: KB_CHUNKS.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ✅ Webhook Twilio
app.post("/twilio", async (req, res) => {
  try {
    const incomingMsg = (req.body.Body || "").trim();
    const from = req.body.From; // "whatsapp:+52..."
    console.log("Mensaje Twilio recibido:", { from, incomingMsg });

    if (!incomingMsg) {
      return res.type("text/xml").status(200).send(`<Response></Response>`);
    }

    // 1) Clasificar si debemos responder
    const intent = await classifyIntent(incomingMsg);

    if (!intent.allowed) {
      const reply =
        `🤖 ${BOT_NAME}\n\n` +
        `Puedo ayudarte con Flipping (captación, análisis, remodelación, venta), ` +
        `y también temas como Meta Ads e Infonavit.\n\n` +
        `Pero no estoy entrenado para responder esa pregunta.`;
      return res.type("text/xml").status(200).send(`
        <Response>
          <Message>${escapeXml(reply)}</Message>
        </Response>
      `);
    }

    // 2) Recuperar contexto desde tus VTT (si ya subiste)
    const ctx = await retrieveContext(incomingMsg, 5);
    const ctxText = ctx.map((c, i) => `Fuente ${i + 1}:\n${c.text}`).join("\n\n");

    // 3) Si hace falta, buscar en internet (opcional)
    let webInfo = "";
    if (ENABLE_WEB_SEARCH && intent.needs_web) {
      try {
        const results = await serperSearch(incomingMsg);
        webInfo = results
          .map((r, i) => `Resultado ${i + 1}: ${r.title}\n${r.snippet}\n${r.link}`)
          .join("\n\n");
      } catch (e) {
        console.log("Web search no disponible o falló:", e.message);
      }
    }

    // 4) Responder con el modelo, priorizando TU conocimiento
    const system = `
Eres ${BOT_NAME}, soporte para alumnos sobre Flipping inmobiliario (México).
Reglas:
- Responde SOLO si el tema es Flipping o temas permitidos (Meta Ads, Infonavit, cuentas mancomunadas, trámites relacionados).
- Usa primero la "Base de Conocimiento" (transcripciones VTT del curso).
- Si la respuesta NO está en la base de conocimiento y hay "Info Web", puedes usarla como apoyo.
- Si NO está en la base y NO hay info web, di la verdad y pide un dato extra o sugiere que el alumno pregunte de otra forma.
- Estilo: claro, directo, accionable. Sin relleno.
- No inventes datos legales/financieros; si es legal, sugiere confirmar con notario/abogado.
`;

    const user = `
Pregunta del alumno:
${incomingMsg}

Base de Conocimiento (si existe):
${ctxText || "(vacía)"}

Info Web (si existe):
${webInfo || "(vacía)"}

Instrucción:
Responde en español. Da pasos concretos. Si aplica, sugiere qué información falta para dar una respuesta exacta.
`;

    const answer = await openaiChat({ system, user, temperature: 0.2 });

    return res.type("text/xml").status(200).send(`
      <Response>
        <Message>${escapeXml(answer)}</Message>
      </Response>
    `);
  } catch (e) {
    console.error("Error en /twilio:", e);
    const reply =
      `⚠️ ${BOT_NAME}\n\n` +
      `Tuve un error procesando tu mensaje. Intenta de nuevo en 30 segundos.`;
    return res.type("text/xml").status(200).send(`
      <Response>
        <Message>${escapeXml(reply)}</Message>
      </Response>
    `);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ ${BOT_NAME} activo en puerto ${PORT}`);
  console.log(`✅ Health: /health`);
  console.log(`✅ Twilio webhook: /twilio`);
  console.log(`✅ Admin upload: /admin/upload-vtt`);
});
