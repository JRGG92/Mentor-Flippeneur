// index.js
"use strict";

const express = require("express");
const twilio = require("twilio");

const app = express();

// Twilio manda por defecto x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
// Por si luego usas JSON
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ✅ Variables necesarias para Twilio
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Opcional: si quieres “forzar” que solo responda si llega al número correcto
// const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // ej: "whatsapp:+14155238886"

function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Falta variable de entorno: ${name}`);
    return false;
  }
  return true;
}

// Healthcheck Railway
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ✅ Webhook para Twilio WhatsApp (Sandbox o número real)
app.post("/twilio", async (req, res) => {
  try {
    // Si quieres ver todo lo que llega:
    // console.log("📩 Twilio payload:", req.body);

    const from = req.body.From; // ej "whatsapp:+52...."
    const body = (req.body.Body || "").trim();

    console.log(`📩 Mensaje Twilio de ${from}: ${body}`);

    // Validar credenciales Twilio
    const ok1 = requireEnv("TWILIO_SID", TWILIO_SID);
    const ok2 = requireEnv("TWILIO_AUTH_TOKEN", TWILIO_AUTH_TOKEN);
    if (!ok1 || !ok2) {
      return res.status(500).send("Missing Twilio credentials");
    }

    // ✅ Respuesta (aquí luego conectamos con IA / base de conocimiento)
    const replyText =
      `Mentor Flippeneur 🤖\n` +
      `Recibí tu mensaje: "${body}"\n\n` +
      `Dime:\n` +
      `1) Ciudad\n` +
      `2) Presupuesto aproximado\n` +
      `3) Tipo de propiedad (casa/depa)\n` +
      `y te doy una guía rápida.`;

    // Opción A (simple): responder con TwiML (lo más estable para webhook)
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);

    res.set("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());

    // Opción B: responder enviando mensaje con la API (NO necesario aquí)
    // const client = twilio(TWILIO_SID, TWILIO_AUTH_TOKEN);
    // await client.messages.create({
    //   from: req.body.To, // el número de Twilio (whatsapp:+1415...)
    //   to: from,
    //   body: replyText,
    // });
    // return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error en /twilio:", err);
    return res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Mentor Flippeneur activo en puerto ${PORT}`);
  console.log(`✅ Health: /health`);
  console.log(`✅ Twilio webhook: /twilio`);
});
