import express from "express";
import { WebSocketServer } from "ws";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

/* ─────────────────────────────
   PostgreSQL 연결 (Render 전용)
───────────────────────────── */
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    country TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

/* ─────────────────────────────
   Express
───────────────────────────── */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/messages", async (_, res) => {
  const { rows } = await pool.query(`
    SELECT text, country, created_at
    FROM logs
    ORDER BY created_at DESC
    LIMIT 500
  `);
  res.json(rows);
});

app.get("/health", (_, res) => res.send("ok"));

const server = app.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});

/* ─────────────────────────────
   WebSocket
───────────────────────────── */
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const country =
    req.headers["x-vercel-ip-country"] ||
    req.headers["cf-ipcountry"] ||
    "UNKNOWN";

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
      `INSERT INTO logs (text, country)
       VALUES ($1, $2)
       RETURNING text, country, created_at`,
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
