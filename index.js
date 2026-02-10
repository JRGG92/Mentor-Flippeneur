const express = require("express");
const app = express();

// Middleware para leer JSON
app.use(express.json());

// Puerto que usa Railway
const PORT = process.env.PORT || 8080;

// ✅ Ruta principal
app.get("/", (req, res) => {
  res.send("Mentor Flippeneur activo");
});

// ✅ WEBHOOK DE VERIFICACIÓN (ESTO ES CLAVE)
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

// ✅ WEBHOOK PARA MENSAJES (POST)
app.post("/webhook", (req, res) => {
  console.log("Evento recibido:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Mentor Flippeneur escuchando en puerto ${PORT}`);
});
