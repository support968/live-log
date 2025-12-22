const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'data.db');


const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      country TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});


app.get('/api/logs', (req, res) => {
  db.all('SELECT * FROM logs ORDER BY id ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read logs' });
    }
    res.json(rows);
  });
});


app.post('/api/logs', (req, res) => {
  const { timestamp, country, text } = req.body;
  
  db.run(
    'INSERT INTO logs (timestamp, country, text) VALUES (?, ?, ?)',
    [timestamp, country, text],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to save log' });
      }
      
      db.get('SELECT * FROM logs WHERE id = ?', [this.lastID], (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve log' });
        }
        res.json(row);
      });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});