const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Mentor Flippeneur activo");
});

app.listen(PORT, () => {
  console.log("Mentor Flippeneur escuchando en puerto " + PORT);
});
