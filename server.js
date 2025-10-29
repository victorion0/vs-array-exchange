import express from "express";
import axios from "axios";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import cors from "cors";
import { createCanvas } from "canvas";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  console.log('Health check hit');
  res.json({ 
    status: 'API ALIVE!', 
    port: process.env.PORT,
    time: new Date().toISOString()
  });
});

// ================= Database =================
let db;  // GLOBAL

(async () => {
  try {
    console.log('Connecting to DB...');
    console.log('Host:', process.env.MYSQLHOST || 'MISSING');
    console.log('User:', process.env.MYSQLUSER || 'MISSING');
    console.log('DB:', process.env.MYSQLDATABASE || 'MISSING');
    
    db = await mysql.createPool({
      host: process.env.MYSQLHOST,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl: { rejectUnauthorized: false }
    });
    
    const [result] = await db.query('SELECT 1 as test');
    console.log('DB Test Query OK:', result[0].test);
    console.log("Database connected");
  } catch (err) {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  }
})();

// ================= Helper Functions =================
async function fetchCountries() {
  const url =
    "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies";
  const { data } = await axios.get(url);
  return data;
}

async function fetchExchangeRates() {
  const url = "https://open.er-api.com/v6/latest/USD";
  const { data } = await axios.get(url);
  return data.rates;
}

// ================= Image Generation =================
async function generateSummaryImage() {
  try {
    console.log('Generating image...');
    const [countries] = await db.query(
      "SELECT name, estimated_gdp FROM countries ORDER BY estimated_gdp DESC LIMIT 5"
    );
    const [countResult] = await db.query("SELECT COUNT(*) AS total FROM countries");
    const totalCountries = countResult[0].total;

    const [metaResult] = await db.query(
      "SELECT last_refreshed_at FROM meta ORDER BY id DESC LIMIT 1"
    );
    const lastRefreshed = metaResult[0]?.last_refreshed_at || new Date();

    const width = 600;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#000";
    ctx.font = "bold 24px Arial";
    ctx.fillText("Country Summary", 20, 40);

    ctx.font = "18px Arial";
    ctx.fillText(`Total countries: ${totalCountries}`, 20, 80);

    ctx.fillText("Top 5 countries by estimated GDP:", 20, 120);
    countries.forEach((c, i) => {
      ctx.fillText(`${i + 1}. ${c.name} - ${c.estimated_gdp.toFixed(2)}`, 40, 150 + i * 30);
    });

    ctx.fillText(`Last refreshed: ${lastRefreshed}`, 20, height - 40);

    // Railway-friendly cache folder
    const cacheDir = path.join(process.cwd(), "cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

    const outputPath = path.join(cacheDir, "summary.png");
    fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
    console.log("Summary image generated at cache/summary.png");
  } catch (err) {
    console.error("Error generating summary image:", err.message);
  }
}

// ================= Routes =================
app.post("/countries/refresh", async (req, res) => {
  console.log('Refresh started');
  try {
    const countries = await fetchCountries();
    const rates = await fetchExchangeRates();
    console.log(`Fetched ${countries.length} countries, ${Object.keys(rates).length} rates`);

    for (const c of countries) {
      const currency = c.currencies?.[0]?.code || null;
      const exchangeRate = currency && rates[currency] ? rates[currency] : null;

      let estimatedGDP = 0;
      if (exchangeRate) {
        const multiplier = Math.random() * (2000 - 1000) + 1000;
        estimatedGDP = (c.population * multiplier) / exchangeRate;
      }

      await db.query(
        `INSERT INTO countries (name, capital, region, population, currency_code, exchange_rate, estimated_gdp, flag_url, last_refreshed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           capital = VALUES(capital),
           region = VALUES(region),
           population = VALUES(population),
           currency_code = VALUES(currency_code),
           exchange_rate = VALUES(exchange_rate),
           estimated_gdp = VALUES(estimated_gdp),
           flag_url = VALUES(flag_url),
           last_refreshed_at = NOW()`,
        [c.name, c.capital, c.region, c.population, currency, exchangeRate, estimatedGDP, c.flag]
      );
    }

    await db.query("INSERT INTO meta (last_refreshed_at) VALUES (NOW())");
    await generateSummaryImage();

    console.log('Refresh completed');
    res.json({ message: "Countries refreshed successfully" });
  } catch (err) {
    console.error('Refresh error:', err.message);
    res.status(503).json({ error: "External data source unavailable", details: err.message });
  }
});
console.log("/countries/refresh route registered");

app.get("/countries", async (req, res) => {
  try {
    let sql = "SELECT * FROM countries WHERE 1=1";
    const params = [];

    if (req.query.region) {
      sql += " AND region = ?";
      params.push(req.query.region);
    }

    if (req.query.currency) {
      sql += " AND currency_code = ?";
      params.push(req.query.currency);
    }

    if (req.query.sort === "gdp_desc") {
      sql += " ORDER BY estimated_gdp DESC";
    }

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Countries error:', err.message);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});
console.log("/countries route registered");

app.get("/countries/:name", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM countries WHERE LOWER(name) = LOWER(?)",
      [req.params.name]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Country not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error('Single country error:', err.message);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});
console.log("/countries/:name route registered");

app.delete("/countries/:name", async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM countries WHERE LOWER(name) = LOWER(?)",
      [req.params.name]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Country not found" });
    res.json({ message: "Country deleted" });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});
console.log("DELETE /countries/:name route registered");

app.get("/status", async (req, res) => {
  try {
    const [count] = await db.query("SELECT COUNT(*) AS total FROM countries");
    const [meta] = await db.query(
      "SELECT last_refreshed_at FROM meta ORDER BY id DESC LIMIT 1"
    );
    res.json({
      total_countries: count[0].total,
      last_refreshed_at: meta[0]?.last_refreshed_at || null,
    });
  } catch (err) {
    console.error('Status error:', err.message);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});
console.log("/status route registered");

app.get("/countries/image", (req, res) => {
  const imagePath = path.join(process.cwd(), "cache", "summary.png");
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: "Summary image not found. Run /countries/refresh first." });
  }
});
console.log("/countries/image route registered");

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
console.log("Fallback 404 route registered");

// ================= Start Server AFTER DB =================
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    console.log('Waiting for DB...');
    while (!db) {
      await new Promise(r => setTimeout(r, 100));
    }
    console.log('DB ready! Starting server...');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server LIVE on port ${PORT} — API READY!`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
})();