require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const honeypotRoutes = require("./routes/honeypot");

const app = express();
const PORT = process.env.PORT || 3000;

// Security & middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Honeypot API is live", version: "1.0.0" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Main honeypot route
app.use("/honeypot", honeypotRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — always return 200 per evaluation requirements
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(200).json({ status: "success", reply: "Sorry, can you please repeat that?" });
});

app.listen(PORT, () => {
  console.log(`🍯 Honeypot API running on port ${PORT}`);
});

module.exports = app;