const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Mentor Flippeneur activo");
});

app.listen(PORT, () => {
  console.log("Mentor Flippeneur escuchando en puerto " + PORT);
});
app.use(express.json());

app.post("/webhook", (req, res) => {
  console.log("Webhook recibido:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});
const express = require("express");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mentorflippeneur123";
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Mentor Flippeneur activo"));

// ✅ VERIFICACIÓN DE META (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ✅ RECEPCIÓN DE EVENTOS (POST)
app.post("/webhook", (req, res) => {
  console.log("Webhook recibido:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("Mentor Flippeneur escuchando en puerto " + PORT);
});
