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
