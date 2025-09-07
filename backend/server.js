require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");

// Routes
const authRoutes = require("./routes/auth");
const specialistRoutes = require("./routes/specialist");
const clientRoutes = require("./routes/client");
const adminRoutes = require("./routes/admin");

const app = express();

// -------------------- Middleware --------------------
// Security & compression
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "'unsafe-inline'"], // allow inline <script>
        "script-src-attr": ["'unsafe-inline'"],      // allow onclick="", onchange="", etc.
      },
    },
  })
);

app.use(compression());

// Enable CORS
app.use(cors());

// Parse JSON requests
app.use(express.json());

// -------------------- Debug Middleware --------------------
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`, req.body || "");
  next();
});

// -------------------- Static Files --------------------
// Serve all files inside ../frontend (HTML, CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, "../frontend")));

// Serve uploaded files (profile pics, work images, etc.)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -------------------- API Routes --------------------
app.use("/api/auth", authRoutes);
app.use("/api/specialist", specialistRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/admin", adminRoutes);

// -------------------- HTML Routes --------------------
// Root → index.html
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/index.html"))
);

// Clean routes (so you don’t need .html in browser)
app.get("/signup", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/signup.html"))
);

app.get("/signin", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/signin.html"))
);

app.get("/specialist", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/specialist.html"))
);

app.get("/reset-password", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/reset-password.html"))
);

app.get("/client", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/client.html"))
);

// -------------------- Fallback (404) --------------------
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "../frontend/index.html"));
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
