const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const router = express.Router();

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "Invalid token" });
        }

        // Check if the user is an admin
        if (decoded.role !== "admin") {
            return res.status(403).json({ error: "Access denied" });
        }

        req.user = decoded;
        next();
    });
};
// Admin signup route (protected by secret key)
router.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;
    const secretKey = req.headers['x-admin-key'];

    // Validate secret key (store this in your environment variables)
    if (secretKey !== process.env.ADMIN_SIGNUP_KEY) {
        return res.status(403).json({ error: "Invalid admin signup key" });
    }

    // Validate input
    if (!full_name || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }

    // Password validation
    if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    try {
        // Check if email exists
        const existingAdmin = await pool.query(
            'SELECT * FROM admin_users WHERE email = $1', 
            [email.toLowerCase()]
        );
        
        if (existingAdmin.rows.length > 0) {
            return res.status(400).json({ error: "Email already registered" });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Create admin
        const newAdmin = await pool.query(
            `INSERT INTO admin_users (full_name, email, password_hash, role)
             VALUES ($1, $2, $3, 'admin')
             RETURNING id, full_name, email, role, created_at`,
            [full_name, email.toLowerCase(), passwordHash]
        );

        res.status(201).json(newAdmin.rows[0]);
    } catch (error) {
        console.error('Admin signup error:', error);
        res.status(500).json({ error: "Server error" });
    }
});
// Admin login
router.post('/login', async (req, res) => {
    // Validate input
    if (!req.body.email || !req.body.password) {
        return res.status(400).json({
            error: "Email and password are required"
        });
    }

    try {
        // Find admin
        const admin = await pool.query(
            'SELECT * FROM admin_users WHERE email = $1',
            [req.body.email.trim().toLowerCase()]
        );

        if (admin.rows.length === 0) {
            return res.status(401).json({
                error: "Invalid credentials"
            });
        }

        // Verify password
        const isValid = await bcrypt.compare(
            req.body.password,
            admin.rows[0].password_hash
        );

        if (!isValid) {
            return res.status(401).json({
                error: "Invalid credentials"
            });
        }

        // Generate token
        const token = jwt.sign(
            {
                id: admin.rows[0].id,
                email: admin.rows[0].email,
                role: admin.rows[0].role
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            admin: {
                id: admin.rows[0].id,
                email: admin.rows[0].email,
                role: admin.rows[0].role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: "Internal server error"
        });
    }
});

// Dashboard statistics
router.get("/dashboard", authenticateAdmin, async (req, res) => {
    try {
        // Get total users count
        const usersCount = await pool.query("SELECT COUNT(*) FROM users WHERE role IN ('client', 'specialist')");
        console.log("Users count:", usersCount.rows[0].count);
        // Get active specialists count
        const specialistsCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'specialist'");
        console.log("Specialists count:", specialistsCount.rows[0].count);
        

        // Get today's bookings count
        const todayBookings = await pool.query(
            `SELECT COUNT(*) FROM sessions 
             WHERE date = CURRENT_DATE 
             AND status IN ('booked', 'accepted')`
        );

        // Get unread messages count
        const unreadMessages = await pool.query(
            "SELECT COUNT(*) FROM messages WHERE is_read = FALSE"
        );

        // Get recent activity
        const recentActivity = await pool.query(`
            (SELECT 
                'booking' as type,
                s.id,
                u1.full_name as client_name,
                u2.full_name as specialist_name,
                s.date,
                s.start_time,
                s.end_time,
                s.status,
                s.created_at
            FROM sessions s
            JOIN users u1 ON s.client_id = u1.id
            JOIN users u2 ON s.specialist_id = u2.id
            ORDER BY s.created_at DESC
            LIMIT 5)
            
            UNION ALL
            
            (SELECT 
                'review' as type,
                r.id,
                u1.full_name as client_name,
                u2.full_name as specialist_name,
                NULL as date,
                NULL as start_time,
                NULL as end_time,
                NULL as status,
                r.created_at
            FROM reviews r
            JOIN users u1 ON r.client_id = u1.id
            JOIN users u2 ON r.specialist_id = u2.id
            ORDER BY r.created_at DESC
            LIMIT 5)
            
            ORDER BY created_at DESC
            LIMIT 10
        `);

        res.json({ 
            
            totalUsers: parseInt(usersCount.rows[0].count),
            activeSpecialists: parseInt(specialistsCount.rows[0].count),
            todayBookings: parseInt(todayBookings.rows[0].count),
            unreadMessages: parseInt(unreadMessages.rows[0].count),
            recentActivity: recentActivity.rows
        });
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// User management
router.get("/users", authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 10, role, search } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query = "SELECT id, full_name, email, phone, role, created_at FROM users WHERE 1=1";
        let params = [];
        let paramCount = 0;

        if (role) {
            query += ` AND role = $${++paramCount}`;
            params.push(role);
        }

        if (search) {
            query += ` AND (full_name ILIKE $${++paramCount} OR email ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);

        const users = await pool.query(query, params);

        // Get total count for pagination
        let countQuery = "SELECT COUNT(*) FROM users WHERE 1=1";
        let countParams = [];
        paramCount = 0;

        if (role) {
            countQuery += ` AND role = $${++paramCount}`;
            countParams.push(role);
        }

        if (search) {
            countQuery += ` AND (full_name ILIKE $${++paramCount} OR email ILIKE $${paramCount})`;
            countParams.push(`%${search}%`);
        }

        const totalCount = await pool.query(countQuery, countParams);

        res.json({
            users: users.rows,
            total: parseInt(totalCount.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.post("/users", authenticateAdmin, async (req, res) => {
    const { full_name, email, password, phone, gender, role, location } = req.body;

    try {
        // Check if email already exists
        const existingUser = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Email already registered" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        const newUser = await pool.query(
            `INSERT INTO users (full_name, email, password, phone, gender, role, location) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, full_name, email, gender, role, location, created_at`,
            [full_name, email, hashedPassword, phone, gender, role, location]
        );

        res.status(201).json(newUser.rows[0]);
    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.put("/users/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { full_name, email, phone, role } = req.body;

    try {
        // Check if user exists
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Update user
        const updatedUser = await pool.query(
            `UPDATE users 
             SET full_name = $1, email = $2, phone = $3, role = $4 
             WHERE id = $5 
             RETURNING id, full_name, email, role, phone`,
            [full_name, email, phone, role, id]
        );

        res.json(updatedUser.rows[0]);
    } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.delete("/users/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // Check if user exists
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Delete user
        await pool.query("DELETE FROM users WHERE id = $1", [id]);

        res.json({ message: "User deleted successfully" });
    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Specialist management
router.get("/specialists", authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 10, availability, search } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query = `
            SELECT 
                u.id, u.full_name, u.email, u.phone, u.created_at,
                s.services, s.experience, s.availability
            FROM users u
            JOIN specialists s ON u.id = s.user_id
            WHERE u.role = 'specialist'
        `;
        let params = [];
        let paramCount = 0;

        if (availability) {
            query += ` AND s.availability = $${++paramCount}`;
            params.push(availability === "available" ? "available" : "not_available");
        }

        if (search) {
            query += ` AND (u.full_name ILIKE $${++paramCount} OR u.email ILIKE $${paramCount} OR s.services ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY u.created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);

        const specialists = await pool.query(query, params);

        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) 
            FROM users u
            JOIN specialists s ON u.id = s.user_id
            WHERE u.role = 'specialist'
        `;
        let countParams = [];
        paramCount = 0;

        if (availability) {
            countQuery += ` AND s.availability = $${++paramCount}`;
            countParams.push(availability === "available" ? "available" : "not_available");
        }

        if (search) {
            countQuery += ` AND (u.full_name ILIKE $${++paramCount} OR u.email ILIKE $${paramCount} OR s.services ILIKE $${paramCount})`;
            countParams.push(`%${search}%`);
        }

        const totalCount = await pool.query(countQuery, countParams);

        // Get ratings for each specialist
        const specialistsWithRatings = await Promise.all(specialists.rows.map(async specialist => {
            const ratingResult = await pool.query(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews 
                 FROM reviews 
                 WHERE specialist_id = $1`,
                [specialist.id]
            );

            return {
                ...specialist,
                avg_rating: ratingResult.rows[0].avg_rating ? parseFloat(ratingResult.rows[0].avg_rating).toFixed(1) : null,
                total_reviews: parseInt(ratingResult.rows[0].total_reviews)
            };
        }));

        res.json({
            specialists: specialistsWithRatings,
            total: parseInt(totalCount.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error("Error fetching specialists:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Booking management
router.get("/bookings", authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 10, status, date, search } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query = `
            SELECT 
                s.id, s.date, s.start_time, s.end_time, s.status, s.created_at,
                u1.full_name as client_name, u1.email as client_email,
                u2.full_name as specialist_name, u2.email as specialist_email
            FROM sessions s
            JOIN users u1 ON s.client_id = u1.id
            JOIN users u2 ON s.specialist_id = u2.id
            WHERE 1=1
        `;
        let params = [];
        let paramCount = 0;

        if (status) {
            query += ` AND s.status = $${++paramCount}`;
            params.push(status);
        }

        if (date) {
            query += ` AND s.date = $${++paramCount}`;
            params.push(date);
        }

        if (search) {
            query += ` AND (u1.full_name ILIKE $${++paramCount} OR u2.full_name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY s.date DESC, s.start_time DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);

        const bookings = await pool.query(query, params);

        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) 
            FROM sessions s
            JOIN users u1 ON s.client_id = u1.id
            JOIN users u2 ON s.specialist_id = u2.id
            WHERE 1=1
        `;
        let countParams = [];
        paramCount = 0;

        if (status) {
            countQuery += ` AND s.status = $${++paramCount}`;
            countParams.push(status);
        }

        if (date) {
            countQuery += ` AND s.date = $${++paramCount}`;
            countParams.push(date);
        }

        if (search) {
            countQuery += ` AND (u1.full_name ILIKE $${++paramCount} OR u2.full_name ILIKE $${paramCount})`;
            countParams.push(`%${search}%`);
        }

        const totalCount = await pool.query(countQuery, countParams);

        res.json({
            bookings: bookings.rows,
            total: parseInt(totalCount.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.put("/bookings/:id/cancel", authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // Check if booking exists
        const booking = await pool.query("SELECT * FROM sessions WHERE id = $1", [id]);
        if (booking.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Only allow cancelling if status is booked or accepted
        if (!["booked", "accepted"].includes(booking.rows[0].status)) {
            return res.status(400).json({ error: "Only booked or accepted bookings can be cancelled" });
        }

        // Update booking status
        await pool.query(
            "UPDATE sessions SET status = 'cancelled' WHERE id = $1",
            [id]
        );

        res.json({ message: "Booking cancelled successfully" });
    } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Review management
router.get("/reviews", authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 10, rating, search } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query = `
            SELECT 
                r.id, r.rating, r.review, r.created_at,
                u1.full_name as client_name,
                u2.full_name as specialist_name
            FROM reviews r
            JOIN users u1 ON r.client_id = u1.id
            JOIN users u2 ON r.specialist_id = u2.id
            WHERE 1=1
        `;
        let params = [];
        let paramCount = 0;

        if (rating) {
            query += ` AND r.rating = $${++paramCount}`;
            params.push(parseInt(rating));
        }

        if (search) {
            query += ` AND (u1.full_name ILIKE $${++paramCount} OR u2.full_name ILIKE $${paramCount} OR r.review ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);

        const reviews = await pool.query(query, params);

        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) 
            FROM reviews r
            JOIN users u1 ON r.client_id = u1.id
            JOIN users u2 ON r.specialist_id = u2.id
            WHERE 1=1
        `;
        let countParams = [];
        paramCount = 0;

        if (rating) {
            countQuery += ` AND r.rating = $${++paramCount}`;
            countParams.push(parseInt(rating));
        }

        if (search) {
            countQuery += ` AND (u1.full_name ILIKE $${++paramCount} OR u2.full_name ILIKE $${paramCount} OR r.review ILIKE $${paramCount})`;
            countParams.push(`%${search}%`);
        }

        const totalCount = await pool.query(countQuery, countParams);

        res.json({
            reviews: reviews.rows,
            total: parseInt(totalCount.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.delete("/reviews/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // Check if review exists
        const review = await pool.query("SELECT * FROM reviews WHERE id = $1", [id]);
        if (review.rows.length === 0) {
            return res.status(404).json({ error: "Review not found" });
        }

        // Delete review
        await pool.query("DELETE FROM reviews WHERE id = $1", [id]);

        res.json({ message: "Review deleted successfully" });
    } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Message monitoring
router.get("/messages", authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 10, date, search } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query = `
            SELECT 
                m.id, m.message, m.is_read, m.timestamp,
                u1.full_name as sender_name,
                u2.full_name as receiver_name
            FROM messages m
            JOIN users u1 ON m.sender_id = u1.id
            JOIN users u2 ON m.receiver_id = u2.id
            WHERE 1=1
        `;
        let params = [];
        let paramCount = 0;

        if (date) {
            query += ` AND DATE(m.timestamp) = $${++paramCount}`;
            params.push(date);
        }

        if (search) {
            query += ` AND (u1.full_name ILIKE $${++paramCount} OR u2.full_name ILIKE $${paramCount} OR m.message ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY m.timestamp DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);

        const messages = await pool.query(query, params);

        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) 
            FROM messages m
            JOIN users u1 ON m.sender_id = u1.id
            JOIN users u2 ON m.receiver_id = u2.id
            WHERE 1=1
        `;
        let countParams = [];
        paramCount = 0;

        if (date) {
            countQuery += ` AND DATE(m.timestamp) = $${++paramCount}`;
            countParams.push(date);
        }

        if (search) {
            countQuery += ` AND (u1.full_name ILIKE $${++paramCount} OR u2.full_name ILIKE $${paramCount} OR m.message ILIKE $${paramCount})`;
            countParams.push(`%${search}%`);
        }

        const totalCount = await pool.query(countQuery, countParams);

        res.json({
            messages: messages.rows,
            total: parseInt(totalCount.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Reports
router.get("/reports/bookings", authenticateAdmin, async (req, res) => {
    const { start_date, end_date } = req.query;

    try {
        // Monthly bookings count
        const monthlyBookings = await pool.query(`
            SELECT 
                DATE_TRUNC('month', date) as month,
                COUNT(*) as count
            FROM sessions
            WHERE date BETWEEN $1 AND $2
            GROUP BY DATE_TRUNC('month', date)
            ORDER BY month
        `, [start_date, end_date]);

        // Bookings by status
        const bookingsByStatus = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM sessions
            WHERE date BETWEEN $1 AND $2
            GROUP BY status
        `, [start_date, end_date]);

        // Bookings by specialist
        const bookingsBySpecialist = await pool.query(`
            SELECT 
                u.full_name as specialist,
                COUNT(*) as count
            FROM sessions s
            JOIN users u ON s.specialist_id = u.id
            WHERE s.date BETWEEN $1 AND $2
            GROUP BY u.full_name
            ORDER BY count DESC
            LIMIT 10
        `, [start_date, end_date]);

        res.json({
            monthlyBookings: monthlyBookings.rows,
            bookingsByStatus: bookingsByStatus.rows,
            bookingsBySpecialist: bookingsBySpecialist.rows
        });
    } catch (error) {
        console.error("Error generating bookings report:", error);
        res.status(500).json({ error: "Server error" });
    }
});

router.get("/reports/users", authenticateAdmin, async (req, res) => {
    const { start_date, end_date } = req.query;

    try {
        // User growth
        const userGrowth = await pool.query(`
            SELECT 
                DATE_TRUNC('month', created_at) as month,
                role,
                COUNT(*) as count
            FROM users
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY DATE_TRUNC('month', created_at), role
            ORDER BY month, role
        `, [start_date, end_date]);

        // Users by type
        const usersByType = await pool.query(`
            SELECT 
                role,
                COUNT(*) as count
            FROM users
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY role
        `, [start_date, end_date]);

        res.json({
            userGrowth: userGrowth.rows,
            usersByType: usersByType.rows
        });
    } catch (error) {
        console.error("Error generating users report:", error);
        res.status(500).json({ error: "Server error" });
    }
});
// Add these routes to admin.js

// Get specialists pending verification
router.get("/verifications", authenticateAdmin, async (req, res) => {
    try {
        const verifications = await pool.query(`
            SELECT v.*, u.full_name, u.email 
            FROM specialist_verification v
            JOIN users u ON v.specialist_id = u.id
            WHERE v.status = 'pending'
        `);

        res.json(verifications.rows);
    } catch (error) {
        console.error("Error fetching verifications:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Update verification status
router.put("/verifications/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    try {
        await pool.query(
            "UPDATE specialist_verification SET status = $1, rejection_reason = $2 WHERE id = $3",
            [status, rejection_reason, id]
        );

        res.json({ message: "Verification status updated" });
    } catch (error) {
        console.error("Error updating verification:", error);
        res.status(500).json({ error: "Server error" });
    }
});
// Get single verification by ID
router.get("/verifications/:id", authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const verification = await pool.query(`
            SELECT v.*, u.full_name, u.email 
            FROM specialist_verification v
            JOIN users u ON v.specialist_id = u.id
            WHERE v.id = $1
        `, [id]);

        if (verification.rows.length === 0) {
            return res.status(404).json({ error: "Verification not found" });
        }

        res.json(verification.rows[0]);
    } catch (error) {
        console.error("Error fetching verification:", error);
        res.status(500).json({ error: "Server error" });
    }
});
// Update the specialists route to include verification status
router.get("/specialists", authenticateAdmin, async (req, res) => {
    const { page = 1, limit = 10, availability, search } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query = `
            SELECT 
                u.id, u.full_name, u.email, u.phone, u.created_at,
                s.services, s.experience, s.availability,
                COALESCE(v.status, 'not_submitted') as verification_status
            FROM users u
            JOIN specialists s ON u.id = s.user_id
            LEFT JOIN specialist_verification v ON u.id = v.specialist_id
            WHERE u.role = 'specialist'
        `;
        
        // ... rest of your existing query code ...

        // Add verification status to the response
        const specialistsWithRatings = await Promise.all(specialists.rows.map(async specialist => {
            const ratingResult = await pool.query(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews 
                 FROM reviews 
                 WHERE specialist_id = $1`,
                [specialist.id]
            );

            return {
                ...specialist,
                avg_rating: ratingResult.rows[0].avg_rating ? parseFloat(ratingResult.rows[0].avg_rating).toFixed(1) : null,
                total_reviews: parseInt(ratingResult.rows[0].total_reviews),
                is_verified: specialist.verification_status === 'approved'
            };
        }));

        res.json({
            specialists: specialistsWithRatings,
            total: parseInt(totalCount.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error("Error fetching specialists:", error);
        res.status(500).json({ error: "Server error" });
    }
});
module.exports = router;