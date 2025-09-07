require("dotenv").config();
const { Pool } = require("pg");

// Debugging: Check if environment variables are loaded correctly
console.log("Database Config:", {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD ? "********" : "NOT SET",
  port: process.env.DB_PORT,
});
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }, // ✅ Required for Render PostgreSQL
});


pool.connect((err) => {
  if (err) {
    console.error("Database connection error:", err.stack);
  } else {
    console.log("Connected to PostgreSQL database ✅");
  }
});

module.exports = pool;
