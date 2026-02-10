const express = require("express");
const app = express();

// Middleware para JSON
app.use(express.json());

// Ruta raíz (healthcheck)
app.get("/", (req, res) => {
  res.send("Mentor Flippeneur activo");
});

// Webhook de verificación (Meta)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "mentorflippeneur123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook para mensajes entrantes
app.post("/webhook", (req, res) => {
  console.log("Mensaje recibido:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Puerto Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Mentor Flippeneur escuchando en puerto ${PORT}`);
});
