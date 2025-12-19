import express from "express";
import { WebSocketServer } from "ws";
import pkg from "pg";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

/* ─────────────────────────────
   PostgreSQL
───────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// 테이블 생성
await pool.query(`
  CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    country TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

/* ─────────────────────────────
   Express
───────────────────────────── */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/messages", async (req, res) => {
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

/* ─────────────────────────────
   WebSocket
───────────────────────────── */
const wss = new WebSocketServer({ server });

async function getCountry(ip) {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    const data = await res.json();
    return data.country_name || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

wss.on("connection", async (ws, req) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  const country = await getCountry(ip);

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!data.text || typeof data.text !== "string") return;
    const text = data.text.trim();
    if (!text) return;

    const { rows } = await pool.query(
      `
      INSERT INTO logs (text, country)
      VALUES ($1, $2)
      RETURNING text, country, created_at
    `,
      [text, country]
    );

    const payload = JSON.stringify(rows[0]);

    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  });
});
