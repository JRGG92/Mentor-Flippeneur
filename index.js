const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));


const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));


const PORT = process.env.PORT || 8080;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mentorflippeneur123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => res.send("Mentor Flippeneur activo ✅"));

/** Verificación del webhook (Meta) */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/** Recibe mensajes */
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Esto llega cuando entra un mensaje
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from; // número del usuario (sin +)
    const text = msg?.text?.body || "";

    console.log("Mensaje recibido de:", from, "Texto:", text);

    // ✅ Regla: solo respondo si empieza con "@mentor" (porque en WA Cloud no hay @mention real)
    const shouldReply = text.trim().toLowerCase().startsWith("@mentor");

    if (!shouldReply) return res.sendStatus(200);

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      console.log("❌ Faltan variables WHATSAPP_TOKEN o PHONE_NUMBER_ID");
      return res.sendStatus(200);
    }

    const reply =
      `✅ Mentor Flippeneur aquí.\n\n` +
      `Recibí tu pregunta:\n"${text}"\n\n` +
      `Dime: ¿esto es sobre (1) Infonavit (2) Captación/compra (3) Remodelación (4) Venta?`;

    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      }),
    });

    const data = await resp.json();
    console.log("Respuesta WA:", resp.status, data);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Error webhook:", err);
    return res.sendStatus(200);
  }
});

app.post("/twilio", async (req, res) => {
  const incomingMsg = req.body.Body;
  const from = req.body.From;

  console.log("Mensaje Twilio:", incomingMsg);

  const twilio = require("twilio");
  const client = twilio(
    process.env.TWILIO_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  try {
    await client.messages.create({
      from: "whatsapp:+14155238886", // sandbox Twilio
      to: from,
      body: "Recibimos tu mensaje: " + incomingMsg
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    res.sendStatus(500);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mentor Flippeneur escuchando en puerto ${PORT}`);
});
