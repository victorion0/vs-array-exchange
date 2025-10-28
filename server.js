import express from "express";
import axios from "axios";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const db = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ============= Helper Functions =============

// Fetch all countries
async function fetchCountries() {
  const url = "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies";
  const { data } = await axios.get(url);
  return data;
}

// Fetch exchange rates (USD base)
async function fetchExchangeRates() {
  const url = "https://open.er-api.com/v6/latest/USD";
  const { data } = await axios.get(url);
  return data.rates;
}

// ============= ROUTES =============

// POST /countries/refresh
app.post("/countries/refresh", async (req, res) => {
  try {
    const countries = await fetchCountries();
    const rates = await fetchExchangeRates();

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
    res.json({ message: "Countries refreshed successfully" });
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "External data source unavailable" });
  }
});

// GET /countries
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
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /countries/:name
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
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /countries/:name
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
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /status
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
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Fallback route
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Start server
app.listen(process.env.PORT, () =>
  console.log(`Server running on port ${process.env.PORT}`)
);
