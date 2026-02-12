const express = require("express");

const app = express();

// Twilio manda webhooks como x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Home
app.get("/", (req, res) => {
  res.status(200).send("Mentor Flippeneur activo ✅");
});

// Healthcheck (para Railway)
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// Webhook de Twilio (WhatsApp Sandbox o número real)
app.post("/twilio", (req, res) => {
  const incomingMsg = (req.body.Body || "").trim();
  const from = req.body.From; // ej: "whatsapp:+52...."

  console.log("Mensaje Twilio recibido:", { from, incomingMsg });

  // ✅ Ya NO hace falta @mentor.
  // Aquí metes tu lógica: si quieres, detecta palabras clave, etc.
  const reply =
    `✅ Mentor Flippeneur\n\n` +
    `Recibí: "${incomingMsg}"\n\n` +
    `Dime tu duda con más detalle (captación, análisis, remodelación o venta).`;

  // Responder con TwiML (XML) — Twilio lo manda a WhatsApp
  res.type("text/xml").status(200).send(`
    <Response>
      <Message>${escapeXml(reply)}</Message>
    </Response>
  `);
});

// Helper para evitar que el XML se rompa por caracteres raros
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
});
