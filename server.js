import express from "express";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import crypto from "crypto";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



const PORT = process.env.PORT || 8080;
const MAX_LEN = 140;
const RATE_MS = 4000;

// DB
const db = new Database("./data.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    text TEXT NOT NULL,
    ip_hash TEXT
  );
`);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "20kb" }));

// 초기 로그 API
app.get("/api/messages", (req, res) => {
  const rows = db
    .prepare("SELECT id, ts, text FROM messages ORDER BY ts DESC LIMIT 200")
    .all();
  res.json(rows.reverse());
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// 헬스체크
app.get("/health", (_, res) => res.send("ok"));

// HTTP 서버 시작
const server = app.listen(PORT, () => {
  console.log("Listening :" + PORT);
});

// WebSocket 서버
const wss = new WebSocketServer({ server, path: "/ws" });
const lastPostByIp = new Map();

function sanitizeText(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

function ipHash(req) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "";
  return crypto
    .createHash("sha256")
    .update(ip)
    .digest("hex")
    .slice(0, 16);
}





wss.on("connection", (ws, req) => {
  const ipH = ipHash(req);

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (payload.type !== "post") return;

    const text = sanitizeText(payload.text);
    if (!text) return;

    const now = Date.now();
    const last = lastPostByIp.get(ipH) || 0;
    if (now - last < RATE_MS) return;

    lastPostByIp.set(ipH, now);

    const info = db
      .prepare("INSERT INTO messages (ts, text, ip_hash) VALUES (?, ?, ?)")
      .run(now, text, ipH);

    const msg = {
      type: "message",
      id: info.lastInsertRowid,
      ts: now,
      text,
    };

    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  });
});
