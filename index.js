const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

const app = express();

// Twilio manda webhooks como x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o-mini";
const WEB_SEARCH = (process.env.WEB_SEARCH || "off").toLowerCase() === "on";

const ALLOWED_TOPICS = (process.env.ALLOWED_TOPICS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Storage local para VTT (Railway: /tmp es seguro para runtime, pero se borra si reinicia)
// Para persistencia real luego metemos S3 / Cloudinary / Supabase.
const DATA_DIR = "/tmp/mentor_data";
const VTT_DIR = path.join(DATA_DIR, "vtt");
fs.mkdirSync(VTT_DIR, { recursive: true });

// Multer para upload
const upload = multer({ dest: VTT_DIR });

// “Base de conocimiento” en memoria (simple)
let KB_TEXT = ""; // concatenado de VTT procesados

// Home
app.get("/", (req, res) => {
  res.status(200).send("Mentor Flippeneur activo ✅");
});

// Healthcheck (para Railway)
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// Admin upload (POST) — subir VTT
app.post("/admin/upload-vtt", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded. Field name must be 'file'." });

    const filePath = req.file.path;
    const raw = fs.readFileSync(filePath, "utf8");
    const clean = vttToCleanText(raw);

    // Añadimos a KB
    KB_TEXT += "\n\n" + clean;

    return res.json({
      ok: true,
      filename: req.file.originalname,
      added_chars: clean.length,
      total_chars: KB_TEXT.length
    });
  } catch (e) {
    console.error("upload-vtt error:", e);
    res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

// Twilio webhook (WhatsApp)
app.post("/twilio", async (req, res) => {
  try {
    const incomingMsg = (req.body.Body || "").trim();
    const from = req.body.From || "";

    console.log("Mensaje Twilio recibido:", { from, incomingMsg });

    // 1) Si no hay OpenAI key
    if (!openai) {
      return twiml(res, "⚠️ Falta configurar OPENAI_API_KEY en Railway.");
    }

    // 2) Clasificar si es tema permitido
    const gate = await classifyAllowed(incomingMsg);

    if (!gate.allowed) {
      return twiml(
        res,
        `✅ Mentor Flippeneur\n\n` +
          `Por ahora solo respondo temas de Flipping y temas relacionados (Meta Ads, Infonavit/trámites, captación, remodelación, análisis, venta).\n\n` +
          `Tu pregunta parece ser de otro tema: "${gate.topic}".`
      );
    }

    // 3) Responder con RAG simple (VTT)
    const answer = await answerWithKB(incomingMsg);

    return twiml(res, answer);
  } catch (e) {
    console.error("twilio webhook error:", e);
    return twiml(res, "⚠️ Hubo un error interno. Intenta de nuevo.");
  }
});

// ===== IA =====

async function classifyAllowed(question) {
  // Si no configuraste allowed topics, por defecto permitimos flipping + meta ads + infonavit
  const allowedList = ALLOWED_TOPICS.length
    ? ALLOWED_TOPICS
    : ["flipping", "meta_ads", "infonavit", "tramites", "captacion", "remodelacion", "venta", "analisis"];

  const sys = `Eres un clasificador. Devuelve JSON estricto.
allowed=true si la pregunta es sobre: ${allowedList.join(", ")}.
allowed=false si es otra cosa (salud, política, chismes, etc).
Devuelve: {"allowed": boolean, "topic": "..."}.`;

  const r = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: question }
    ],
    response_format: { type: "json_object" }
  });

  try {
    return JSON.parse(r.choices[0].message.content);
  } catch {
    return { allowed: true, topic: "unknown" };
  }
}

async function answerWithKB(question) {
  const hasKB = KB_TEXT.trim().length > 200;

  // Si no hay VTT cargados, igual responde “general” (y te avisa)
  const kbContext = hasKB ? clipText(KB_TEXT, 12000) : "";

  const sys =
    `Eres Mentor Flippeneur. Respondes en español, directo y útil.\n` +
    `Reglas:\n` +
    `- Solo responde temas permitidos (flipping, meta ads, infonavit/trámites relacionados).\n` +
    `- Si la respuesta NO está soportada por el conocimiento proporcionado, dilo: "No lo vi en mis notas".\n` +
    `- Si WEB_SEARCH=on y no está en notas, sugiere una respuesta general y marca que viene de "conocimiento general". No inventes datos legales.\n` +
    `- Respuestas cortas para WhatsApp: máximo 8-12 líneas.\n`;

  const user =
    (hasKB
      ? `NOTAS (VTT/Zoom):\n${kbContext}\n\n`
      : `NOTAS: (vacías por ahora, no has subido VTT)\n\n`) +
    `PREGUNTA:\n${question}\n\n` +
    `Responde ahora.`;

  const r = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  let out = (r.choices[0].message.content || "").trim();

  if (!hasKB) {
    out = "⚠️ Aún no has subido VTT al mentor.\n\n" + out;
  }

  return `✅ Mentor Flippeneur\n\n${out}`;
}

// ===== helpers =====
function twiml(res, msg) {
  res.type("text/xml").status(200).send(`
    <Response>
      <Message>${escapeXml(msg)}</Message>
    </Response>
  `);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function vttToCleanText(vtt) {
  // Quita timestamps y líneas vacías, y cues numéricos
  return vtt
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.match(/^WEBVTT/i))
    .filter(l => !l.match(/^\d+$/))
    .filter(l => !l.match(/^\d\d:\d\d:\d\d\.\d\d\d\s-->\s\d\d:\d\d:\d\d\.\d\d\d/))
    .join(" ");
}

function clipText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars); // mantiene lo más reciente
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Mentor Flippeneur activo en puerto ${PORT}`);
  console.log(`✅ Health: /health`);
  console.log(`✅ Twilio webhook: /twilio`);
  console.log(`✅ Admin upload: /admin/upload-vtt`);
});
