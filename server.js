import express from "express";
import { WebSocketServer } from "ws";
import pkg from "pg";
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
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// 테이블 초기화 (최초 1회 자동 실행)
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
}
initDB();

/* ─────────────────────────────
   Express
───────────────────────────── */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 기존 로그 불러오기
app.get("/api/messages", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT text, created_at FROM logs ORDER BY created_at ASC LIMIT 500"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// 헬스체크
app.get("/health", (_, res) => res.send("ok"));

const server = app.listen(PORT, () => {
  console.log("Server running on", PORT);
});

/* ─────────────────────────────
   WebSocket
───────────────────────────── */
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
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

    const createdAt = Date.now();

    try {
      // DB 저장
      await pool.query(
        "INSERT INTO logs (text, created_at) VALUES ($1, $2)",
        [text, createdAt]
      );

      const payload = JSON.stringify({
        text,
        created_at: createdAt,
      });

      // 모든 클라이언트에 브로드캐스트
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(payload);
        }
      });
    } catch (err) {
      console.error(err);
    }
  });
});
