const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db.js");
const router = express.Router();
const crypto = require("crypto");
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// -------------------- SIGNUP --------------------
router.post("/signup", async (req, res) => {
    const { full_name, email, password, role } = req.body;

    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert only the fields provided by the form
        await pool.query(
            "INSERT INTO users (full_name, email, password, role) VALUES ($1, $2, $3, $4)",
            [full_name, email, hashedPassword, role]
        );

        res.json({ message: "User registered successfully!" });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ error: "Signup failed. Please try again." });
    }
});

// -------------------- SIGNIN --------------------
router.post("/signin", async (req, res) => {
    const { email, password } = req.body;
    const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    if (user.rows.length === 0 || !(await bcrypt.compare(password, user.rows[0].password))) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
        { userId: user.rows[0].id, role: user.rows[0].role },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
    );
    res.json({ token, role: user.rows[0].role });
});

// -------------------- FORGOT PASSWORD --------------------
router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        
        if (user.rows.length === 0) {
            return res.json({ message: "If an account exists with this email, a reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000);

        await pool.query(
            "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
            [user.rows[0].id, resetToken, expiresAt]
        );

        const resetLink = `http://localhost:8080/reset-password.html?token=${resetToken}`;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <p>You requested a password reset. Click the link below to reset your password:</p>
                <a href="${resetLink}">${resetLink}</a>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.json({ message: "If an account exists with this email, a reset link has been sent." });
    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ error: "An error occurred. Please try again." });
    }
});

// -------------------- RESET PASSWORD --------------------
router.post("/reset-password", async (req, res) => {
    const { token, password } = req.body;
    
    try {
        const tokenRecord = await pool.query(
            "SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()",
            [token]
        );

        if (tokenRecord.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired token." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            "UPDATE users SET password = $1 WHERE id = $2",
            [hashedPassword, tokenRecord.rows[0].user_id]
        );

        await pool.query("DELETE FROM password_reset_tokens WHERE token = $1", [token]);

        res.json({ message: "Password reset successfully!" });
    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ error: "An error occurred. Please try again." });
    }
});

module.exports = router;
