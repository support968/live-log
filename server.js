// server.js
import express from "express";
import { WebSocketServer } from "ws";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    country TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);


const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/messages", async (_, res) => {
  const { rows } = await pool.query(`
    SELECT text, country, created_at
    FROM logs
    ORDER BY created_at DESC
    LIMIT 200
  `);
  res.json(rows);
});

app.get("/health", (_, res) => res.send("ok"));

const server = app.listen(PORT, () => {
  console.log("Server running on", PORT);
});


const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!data.text) return;
    const text = data.text.trim();
    if (!text) return;

    //  (native fetch)
    let country = "UNKNOWN";
    try {
      const r = await fetch(`https://ipapi.co/${ip}/json/`);
      const j = await r.json();
      country = j.country_name || "UNKNOWN";
    } catch {}

    const { rows } = await pool.query(
      `INSERT INTO logs (text, country)
       VALUES ($1, $2)
       RETURNING created_at`,
      [text, country]
    );

    const payload = JSON.stringify({
      text,
      country,
      created_at: rows[0].created_at
    });

    wss.clients.forEach(c => {
      if (c.readyState === 1) c.send(payload);
    });
  });
});
