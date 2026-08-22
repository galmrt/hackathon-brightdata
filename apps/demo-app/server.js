const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`demo-app listening on http://localhost:${PORT}`);
});
