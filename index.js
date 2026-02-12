const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();

// Twilio manda webhooks como x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

/**
 * =========================
 * 1) RUTAS BÁSICAS
 * =========================
 */

// Home
app.get("/", (req, res) => {
  res.status(200).send("Mentor Flippeneur activo ✅");
});

// Healthcheck (Railway)
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

/**
 * =========================
 * 2) SUBIDA DE ARCHIVOS .VTT
 * =========================
 * Nota: Railway tiene filesystem EFÍMERO. Esto te sirve “por mientras”.
 * Más adelante lo guardamos en S3 / Supabase Storage / Drive.
 */

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// UI simple para subir .vtt
app.get("/admin/upload-vtt", (req, res) => {
  res
    .status(200)
    .type("text/html")
    .send(`
      <h2>Subir archivo .VTT (Mentor Flippeneur)</h2>
      <form action="/admin/upload-vtt" method="post" enctype="multipart/form-data">
        <input type="file" name="file" accept=".vtt" required />
        <button type="submit">Subir</button>
      </form>
      <p>Tip: Railway guarda esto temporalmente. Luego lo migramos a almacenamiento real.</p>
    `);
});

app.post("/admin/upload-vtt", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No se subió ningún archivo.");
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== ".vtt") return res.status(400).send("Solo se aceptan .vtt");

  console.log("✅ VTT subido:", {
    original: req.file.originalname,
    savedAs: req.file.filename,
    size: req.file.size,
  });

  res.status(200).send(`✅ Subido: ${req.file.originalname}`);
});

/**
 * =========================
 * 3) LÓGICA DEL BOT (MVP)
 * =========================
 * - Detecta si es tema permitido (flipping / Meta Ads / Infonavit / etc.)
 * - Si no, responde que no está entrenado
 *
 * Luego conectamos IA:
 * - RAG con tus .vtt (vector db)
 * - Si no está en VTT pero sí es tema permitido -> buscar web
 */

const ALLOWED_TOPICS_HINTS = [
  "flipping",
  "flip",
  "infonavit",
  "crédito",
  "traspaso",
  "escrituras",
  "notario",
  "remodel",
  "remodelación",
  "presupuesto",
  "obra",
  "contratista",
  "meta ads",
  "facebook ads",
  "publicidad",
  "campaña",
  "leads",
  "whatsapp",
  "kommo",
];

function isAllowedTopic(text) {
  const t = (text || "").toLowerCase();
  return ALLOWED_TOPICS_HINTS.some((k) => t.includes(k));
}

function buildReply(userText) {
  const clean = (userText || "").trim();

  if (!clean) {
    return `✅ Mentor Flippeneur\n\nEscríbeme tu duda (Flipping / Infonavit / Meta Ads / captación / remodelación / venta).`;
  }

  if (!isAllowedTopic(clean)) {
    return (
      `✅ Mentor Flippeneur\n\n` +
      `Ahorita no estoy entrenado para responder eso.\n` +
      `Puedo ayudarte con:\n` +
      `• Flipping (captación, análisis, remodelación, venta)\n` +
      `• Trámites Infonavit / cuentas mancomunadas\n` +
      `• Publicidad (Meta Ads) para captar leads\n\n` +
      `Vuelve a intentar con una pregunta de esos temas.`
    );
  }

  // MVP: respuesta temporal (luego aquí va la IA)
  return (
    `✅ Mentor Flippeneur\n\n` +
    `Entendido. Tu duda sí cae dentro de mis temas.\n\n` +
    `Pregunta recibida:\n"${clean}"\n\n` +
    `Para contestarte perfecto dime 2 cosas:\n` +
    `1) ¿En qué ciudad/estado estás?\n` +
    `2) ¿Es captación, análisis, remodelación o venta?`
  );
}

/**
 * =========================
 * 4) WEBHOOK TWILIO (WhatsApp)
 * =========================
 * Twilio espera TwiML (XML) como respuesta.
 * Configura en Twilio Sandbox:
 * "When a message comes in" -> https://TU-DOMINIO.up.railway.app/twilio (POST)
 */

app.post("/twilio", (req, res) => {
  const incomingMsg = (req.body.Body || "").trim();
  const from = req.body.From; // ej: "whatsapp:+52..."

  console.log("📩 Mensaje Twilio recibido:", { from, incomingMsg });

  const reply = buildReply(incomingMsg);

  res.type("text/xml").status(200).send(`
    <Response>
      <Message>${escapeXml(reply)}</Message>
    </Response>
  `);
});

// Helper para no romper XML
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Mentor Flippeneur activo en puerto ${PORT}`);
  console.log(`✅ Health: /health`);
  console.log(`✅ Twilio webhook: /twilio`);
  console.log(`✅ Admin upload: /admin/upload-vtt`);
});
