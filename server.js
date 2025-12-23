const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.db');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
});

// 메시지 목록
app.get('/api/messages', (req, res) => {
  db.all('SELECT * FROM messages ORDER BY created_at ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read messages' });
    }
    res.json(rows);
  });
});

// 카운터 API 추가
app.get('/api/count', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM messages', [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to count messages' });
    }
    res.json({ count: row.count });
  });
});

app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
             req.connection.remoteAddress || 
             'unknown';
  
  let country = 'KR';
  
  if (ip !== 'unknown' && !ip.includes('127.0.0.1') && !ip.includes('::1')) {
    try {
      const response = await fetch(`https://ipapi.co/${ip}/json/`);
      const data = await response.json();
      country = data.country_code || 'KR';
    } catch (error) {
      console.log('Country detection failed:', error);
    }
  }
  
  const created_at = Date.now();

  db.run(
    'INSERT INTO messages (country, text, created_at) VALUES (?, ?, ?)',
    [country, text, created_at],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to save message' });
      }

      const newMessage = {
        id: this.lastID,
        country,
        text,
        created_at
      };

      // 현재 총 카운트 조회 후 브로드캐스트
      db.get('SELECT COUNT(*) as count FROM messages', [], (err, row) => {
        const count = row ? row.count : 0;
        
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ 
              type: 'message', 
              data: newMessage,
              count: count
            }));
          }
        });
      });

      res.json(newMessage);
    }
  );
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});