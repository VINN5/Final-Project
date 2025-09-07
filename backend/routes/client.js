const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db"); // Assuming db.js handles database connection
const path = require('path');
const router = express.Router();
const multer = require('multer');

// 🔹 Secret key for JWT (Store this in an environment variable)
const JWT_SECRET = "mysecret";
// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        // Only accept image files
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // Remove the duplicate jwt require and use the one at the top
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "Invalid token" });
        }
        req.user = { id: decoded.userId, role: decoded.role };
        next();
    });
};
// ✅ 1. Client Registration Route
router.post("/register", async (req, res) => {
    const { first_name, last_name, email, password, phone, location } = req.body;

    try {
        // Check if email already exists
        const existingUser = await pool.query("SELECT * FROM clients WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Email already registered" });
        }

        // Hash password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new client into database
        const newClient = await pool.query(
            "INSERT INTO clients (first_name, last_name, email, password, phone, location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, first_name, email",
            [first_name, last_name, email, hashedPassword, phone, location]
        );

        res.status(201).json({ message: "Client registered successfully", client: newClient.rows[0] });
    } catch (error) {
        console.error("Error registering client:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ✅ 2. Client Login Route
router.post("/signin", async (req, res) => {
    const { email, password } = req.body;

    try {
        const client = await pool.query("SELECT * FROM clients WHERE email = $1", [email]);

        if (client.rows.length === 0) {
            return res.status(400).json({ error: "Invalid email or password" });
        }

        const isMatch = await bcrypt.compare(password, client.rows[0].password);
        if (!isMatch) {
            return res.status(400).json({ error: "Invalid email or password" });
        }

        // Ensure the token payload includes userId and role
        const token = jwt.sign(
            { userId: client.rows[0].id, role: "Client" }, // Use userId here
            JWT_SECRET,
            { expiresIn: "24h" }
        );

        res.json({ token, role: "Client" });
    } catch (error) {
        console.error("Sign-in error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// router.get("/specialists", async (req, res) => {
//     const { location, availability, services, experience, price_min, price_max } = req.query;

//     try {
//         let query = `
//             SELECT
//                 u.id,
//                 u.full_name,
//                 u.email,
//                 u.location,
//                 s.services,
//                 s.experience,
//                 u.profile_photo,
//                 COALESCE((
//                     SELECT AVG(pw.price)
//                     FROM previous_works pw
//                     WHERE pw.specialist_id = s.id
//                 ), 0) AS avg_price,
//                 COALESCE((
//                     SELECT MIN(pw.price)
//                     FROM previous_works pw
//                     WHERE pw.specialist_id = s.id
//                 ), 0) AS min_price,
//                 COALESCE((
//                     SELECT MAX(pw.price)
//                     FROM previous_works pw
//                     WHERE pw.specialist_id = s.id
//                 ), 0) AS max_price
//             FROM users u
//             INNER JOIN specialists s ON u.id = s.user_id
//             WHERE u.role = 'Specialist'
//         `;

//         let values = [];
//         let paramCount = 1;

//         if (location) {
//             values.push(location);
//             query += ` AND u.location = $${paramCount++}`;
//         }

//         if (services) {
//             values.push(`%${services}%`);
//             query += ` AND s.services LIKE $${paramCount++}`;
//         }

//         if (experience) {
//             values.push(parseInt(experience));
//             query += ` AND s.experience >= $${paramCount++}`;
//         }

//         // Price range filter
//         if (price_min || price_max) {
//             const min = price_min ? parseFloat(price_min) : 0;
//             const max = price_max ? parseFloat(price_max) : Number.MAX_SAFE_INTEGER;

//             query += ` AND EXISTS (
//                 SELECT 1 FROM previous_works pw
//                 WHERE pw.specialist_id = s.id
//                 AND pw.price BETWEEN ${min} AND ${max}
//             )`;
//         }

//         // Availability filter
//         if (availability) {
//             if (availability === "morning") {
//                 query += ` AND EXISTS (
//                     SELECT 1 FROM sessions
//                     WHERE sessions.specialist_id = s.id
//                     AND start_time::time >= '08:00:00'::time
//                     AND start_time::time < '12:00:00'::time
//                     AND status = 'available'
//                 )`;
//             } else if (availability === "afternoon") {
//                 query += ` AND EXISTS (
//                     SELECT 1 FROM sessions
//                     WHERE sessions.specialist_id = s.id
//                     AND start_time::time >= '12:00:00'::time
//                     AND start_time::time < '16:00:00'::time
//                     AND status = 'available'
//                 )`;
//             } else if (availability === "evening") {
//                 query += ` AND EXISTS (
//                     SELECT 1 FROM sessions
//                     WHERE sessions.specialist_id = s.id
//                     AND start_time::time >= '16:00:00'::time
//                     AND start_time::time < '20:00:00'::time
//                     AND status = 'available'
//                 )`;
//             }
//         }

//         query += " ORDER BY avg_price DESC";

//         const result = await pool.query(query, values);

//         if (result.rows.length === 0) {
//             return res.json({ message: "No specialists match your criteria." });
//         }

//         res.json(result.rows);
//     } catch (error) {
//         console.error("Error fetching specialists:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });

router.get("/specialists", async (req, res) => {
    const { location, availability, services, experience, price_min, price_max } = req.query;

    try {
        let query = `
            SELECT
                u.id,
                u.full_name,
                u.email,
                u.location,
                s.services,
                s.experience,
                (
                    SELECT COALESCE(AVG(pw.price), 0)
                    FROM previous_works pw
                    WHERE pw.specialist_id = s.id
                ) AS avg_price,
                (
                    SELECT COALESCE(MIN(pw.price), 0)
                    FROM previous_works pw
                    WHERE pw.specialist_id = s.id
                ) AS min_price,
                (
                    SELECT COALESCE(MAX(pw.price), 0)
                    FROM previous_works pw
                    WHERE pw.specialist_id = s.id
                ) AS max_price
            FROM users u
            INNER JOIN specialists s ON u.id = s.user_id
            WHERE 1=1
        `;
        let values = [];

        if (location) {
            values.push(location);
            query += ` AND u.location = $${values.length}`;
        }

        if (services) {
            values.push(`%${services}%`);
            query += ` AND s.services LIKE $${values.length}`;
        }

        if (experience) {
            values.push(parseInt(experience));
            query += ` AND s.experience >= $${values.length}`;
        }

        // Availability filter
        if (availability) {
            if (availability === "morning") {
                query += ` AND EXISTS (SELECT 1 FROM sessions WHERE sessions.specialist_id = s.id AND start_time >= '06:00:00' AND start_time < '12:00:00' AND status = 'available')`;
            } else if (availability === "afternoon") {
                query += ` AND EXISTS (SELECT 1 FROM sessions WHERE sessions.specialist_id = s.id AND start_time >= '12:00:00' AND start_time < '18:00:00' AND status = 'available')`;
            } else if (availability === "evening") {
                query += ` AND EXISTS (SELECT 1 FROM sessions WHERE sessions.specialist_id = s.id AND start_time >= '18:00:00' AND start_time <= '23:59:59' AND status = 'available')`;
            }
        }

        // Price range filter
        if (price_min && price_max) {
            values.push(parseFloat(price_min), parseFloat(price_max));
            query += ` AND (
                SELECT COALESCE(AVG(pw.price), 0)
                FROM previous_works pw
                WHERE pw.specialist_id = s.id
            ) BETWEEN $${values.length - 1} AND $${values.length}`;
        }

        const specialists = await pool.query(query, values);

        if (specialists.rows.length === 0) {
            return res.json({ message: "No specialists match your criteria." });
        }

        res.json(specialists.rows);
    } catch (error) {
        console.error("Error fetching specialists:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get("/specialists/by-price-range", async (req, res) => {
    const { min_price, max_price } = req.query;

    try {
        const min = min_price ? parseFloat(min_price) : 0;
        const max = max_price ? parseFloat(max_price) : Number.MAX_SAFE_INTEGER;

        const query = `
            SELECT
                u.id,
                u.full_name,
                u.email,
                u.location,
                u.profile_photo,
                s.services,
                s.experience,
                COALESCE((SELECT AVG(pw.price) FROM previous_works pw WHERE pw.specialist_id = u.id), 0) AS avg_price,
                COALESCE((SELECT MIN(pw.price) FROM previous_works pw WHERE pw.specialist_id = u.id), 0) AS min_price,
                COALESCE((SELECT MAX(pw.price) FROM previous_works pw WHERE pw.specialist_id = u.id), 0) AS max_price
            FROM users u
            INNER JOIN specialists s ON u.id = s.user_id
            WHERE u.role = 'specialist'
            AND EXISTS (
                SELECT 1 FROM previous_works pw
                WHERE pw.specialist_id = u.id
                AND pw.price BETWEEN $1 AND $2
            )
            ORDER BY avg_price DESC
        `;

        const result = await pool.query(query, [min, max]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: `No specialists found with services priced between ${min} and ${max}`,
                price_range: { min, max }
            });
        }

        res.json({
            count: result.rows.length,
            price_range: { min, max },
            specialists: result.rows
        });
    } catch (error) {
        console.error("Price filter error:", error);
        res.status(500).json({
            error: "Failed to filter by price",
            details: error.message
        });
    }
});


router.get("/specialists/locations", async (req, res) => {
    try {
        const result = await pool.query("SELECT DISTINCT location FROM users WHERE location IS NOT NULL");
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/book-session", authenticateUser, async (req, res) => {
    const { sessionId } = req.body;

    try {
        // Check if session is available
        const session = await pool.query(
            "SELECT * FROM sessions WHERE id = $1 AND status = 'available'",
            [sessionId]
        );

        if (session.rows.length === 0) {
            return res.status(400).json({ error: "Session is no longer available" });
        }

        // Create booking record - using req.user.id which comes from users table
        const booking = await pool.query(
            `INSERT INTO bookings (client_id, session_id, status)
             VALUES ($1, $2, 'pending')
             RETURNING *`,
            [req.user.id, sessionId]  // req.user.id is from users table
        );

        // Update session status
        await pool.query(
            "UPDATE sessions SET status = 'booked' WHERE id = $1",
            [sessionId]
        );

        res.json({ 
            message: "Session booked successfully!",
            booking: booking.rows[0]
        });
    } catch (error) {
        console.error("Error booking session:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/sessions/:specialistId", async (req, res) => {
    const { specialistId } = req.params;
    const now = new Date(); // Current date and time

    try {
        const result = await pool.query(
            `SELECT id,
                    CONCAT(date, ' ', start_time) AS start_time,
                    CONCAT(date, ' ', end_time) AS end_time,
                    status
             FROM sessions
             WHERE specialist_id = $1 
             AND status = 'available'
             AND (date || ' ' || start_time)::timestamp > $2
             ORDER BY date, start_time`,
            [specialistId, now]
        );

        res.json({ sessions: result.rows });
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// In specialist.js
router.get("/unread-messages-count", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND is_read = FALSE",
            [req.user.id]
        );

        res.json({ unreadCount: result.rows[0].count });
    } catch (error) {
        console.error("Error fetching unread messages count:", error);
        res.status(500).json({ error: "Failed to fetch unread messages count." });
    }
});
// In client.js or specialist.js
router.post("/mark-messages-as-read", authenticateUser, async (req, res) => {
    const { sender_id } = req.body;

    try {
        await pool.query(
            "UPDATE messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2",
            [req.user.id, sender_id]
        );

        res.json({ message: "Messages marked as read!" });
    } catch (error) {
        console.error("Error marking messages as read:", error);
        res.status(500).json({ error: "Failed to mark messages as read." });
    }
});


// Message routes (Add this in client.js)
router.get("/messages", authenticateUser, async (req, res) => {
    const { other_user_id } = req.query;
    if (!other_user_id) {
        return res.status(400).json({ error: "Missing other_user_id" });
    }

    try {

        const messages = await pool.query(
            `SELECT * FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1) ORDER BY "timestamp" ASC`,
            [req.user.id, other_user_id]
        );

        res.json(messages.rows);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/send-message", authenticateUser, async (req, res) => {
    const { receiver_id, message } = req.body;
    if (!receiver_id || !message) {
        return res.status(400).json({ error: "Missing fields" });
    }

    try {
        await pool.query(
            "INSERT INTO messages (sender_id, receiver_id, message, timestamp) VALUES ($1, $2, $3, NOW())",
            [req.user.id, receiver_id, message] // Corrected to req.user.id
        );
        res.json({ success: true, message: "Message sent" });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/specialists/:specialistId/previous-works", async (req, res) => {
    const { specialistId } = req.params;

    try {
        const result = await pool.query(
            `SELECT id, image_path, price
             FROM previous_works
             WHERE specialist_id = $1`,
            [specialistId]
        );

        res.json({ previousWorks: result.rows });
    } catch (error) {
        console.error("Error fetching previous works:", error);
        res.status(500).json({ error: "Failed to fetch previous works" });
    }
});


router.post("/rate-specialist", authenticateUser, async (req, res) => {
    const { specialist_id, rating, comment } = req.body;

    if (!specialist_id || !rating) {
        return res.status(400).json({ error: "Specialist ID and rating are required." });
    }

    try {
        // Insert or update the rating (one client can rate a specialist once)
        await pool.query(
            `INSERT INTO ratings (client_id, specialist_id, rating, comment)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (client_id, specialist_id)
             DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment`,
            [req.user.id, specialist_id, rating, comment]
        );

        res.json({ message: "Rating submitted successfully!" });
    } catch (error) {
        console.error("Error submitting rating:", error);
        res.status(500).json({ error: "Server error, could not submit rating." });
    }
});
router.post("/add-review", authenticateUser, async (req, res) => {
    const { specialist_id, rating, review } = req.body;

    // Validate input
    if (!specialist_id || !rating || !review) {
        return res.status(400).json({ error: "All fields are required" });
    }

    try {
        // Verify the specialist exists
        const specialist = await pool.query(
            "SELECT id FROM users WHERE id = $1 AND role = 'specialist'", 
            [specialist_id]
        );
        
        if (specialist.rows.length === 0) {
            return res.status(404).json({ error: "Specialist not found" });
        }

        // Insert review
        const result = await pool.query(
            `INSERT INTO reviews (specialist_id, client_id, rating, review) 
             VALUES ($1, $2, $3, $4) 
             RETURNING *`,
            [specialist_id, req.user.id, rating, review]
        );

        res.json({ 
            message: "Review added successfully!", 
            review: result.rows[0] 
        });
    } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).json({ 
            error: "Internal server error",
            details: error.message 
        });
    }
});
router.get("/specialists/:specialistId/reviews", async (req, res) => {
    const { specialistId } = req.params;

    try {
        const result = await pool.query(
            `SELECT 
                r.id, 
                r.rating, 
                r.review, 
                r.created_at as timestamp,
                c.full_name AS client_name
             FROM reviews r
             INNER JOIN users c ON r.client_id = c.id
             WHERE r.specialist_id = $1
             ORDER BY r.created_at DESC`,
            [specialistId]
        );

        // Format the date before sending to frontend
        const reviews = result.rows.map(review => ({
            ...review,
            // Convert to ISO string for consistent parsing
            created_at: new Date(review.timestamp).toISOString()
        }));

        res.json({ reviews });
    } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ error: "Failed to fetch reviews" });
    }
});
// Add this route to your client.js file
router.get("/specialists/:specialistId/ratings", async (req, res) => {
    const { specialistId } = req.params;

    try {
        // Calculate average rating and total reviews
        const result = await pool.query(
            `SELECT
                AVG(rating) as avg_rating,
                COUNT(*) as total_reviews
             FROM reviews
             WHERE specialist_id = $1`,
            [specialistId]
        );

        const ratingData = result.rows[0];

        res.json({
            avg_rating: ratingData.avg_rating ? parseFloat(ratingData.avg_rating).toFixed(1) : null,
            total_reviews: parseInt(ratingData.total_reviews)
        });
    } catch (error) {
        console.error("Error fetching ratings:", error);
        res.status(500).json({ error: "Failed to fetch ratings" });
    }
});

router.get("/bookings", authenticateUser, async (req, res) => {
    try {
        const bookings = await pool.query(`
            SELECT
                b.id,
                b.status,
                b.created_at,
                b.updated_at,
                s.id as session_id,
                -- Combine date and time into ISO format strings
                (s.date || ' ' || s.start_time)::timestamp as start_time,
                (s.date || ' ' || s.end_time)::timestamp as end_time,
                s.date,
                u.full_name as specialist_name,
                u.profile_photo as specialist_photo
            FROM bookings b
            JOIN sessions s ON b.session_id = s.id
            JOIN users u ON s.specialist_id = u.id
            WHERE b.client_id = $1
            ORDER BY s.date DESC, s.start_time DESC
        `, [req.user.id]);

        // Convert to ISO strings for consistent parsing
        const formattedBookings = bookings.rows.map(booking => ({
            ...booking,
            start_time: booking.start_time.toISOString(),
            end_time: booking.end_time.toISOString(),
            date: booking.date.toISOString().split('T')[0] // Just the date part
        }));

        res.json(formattedBookings);
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Book a session
router.post("/book-session", authenticateUser, async (req, res) => {
    const { sessionId } = req.body;

    try {
        // Check if session is available
        const session = await pool.query(
            "SELECT * FROM sessions WHERE id = $1 AND status = 'available'",
            [sessionId]
        );

        if (session.rows.length === 0) {
            return res.status(400).json({ error: "Session is no longer available" });
        }

        // Create booking record
        await pool.query(
            "INSERT INTO bookings (client_id, session_id) VALUES ($1, $2)",
            [req.user.id, sessionId]
        );

        // Update session status
        await pool.query(
            "UPDATE sessions SET status = 'booked' WHERE id = $1",
            [sessionId]
        );

        res.json({ message: "Session booked successfully!" });
    } catch (error) {
        console.error("Error booking session:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Cancel a booking
router.post("/cancel-booking", authenticateUser, async (req, res) => {
    const { bookingId } = req.body;

    try {
        // Get the booking
        const booking = await pool.query(
            `UPDATE bookings 
             SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1 AND client_id = $2
             RETURNING *`,
            [bookingId, req.user.id]
        );

        if (booking.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Update session status back to available
        await pool.query(
            "UPDATE sessions SET status = 'available' WHERE id = $1",
            [booking.rows[0].session_id]
        );

        res.json({ 
            message: "Booking cancelled successfully",
            booking: booking.rows[0]
        });
    } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Export the router

// Add this route to client.js for updating profile
router.post("/update-profile", authenticateUser, upload.single("profile_photo"), async (req, res) => {
    const { phone, location, gender } = req.body;
    const profilePhoto = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        // Update client profile
        await pool.query(
            "UPDATE users SET phone = $1, location = $2, gender = $3, profile_photo = COALESCE($4, profile_photo) WHERE id = $5",
            [phone, location, gender, profilePhoto, req.user.id]
        );

        res.json({ 
            message: "Profile updated successfully!",
            profilePhoto: profilePhoto 
        });
    } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Server error, could not update profile." });
    }
});

// Add this route to get client details
router.get("/details", authenticateUser, async (req, res) => {
    try {
        const client = await pool.query(
            "SELECT full_name, email, phone, location, gender, profile_photo FROM users WHERE id = $1",
            [req.user.id]
        );

        if (client.rows.length === 0) {
            return res.status(404).json({ error: "Client not found" });
        }

        res.json(client.rows[0]);
    } catch (error) {
        console.error("Error fetching client details:", error);
        res.status(500).json({ error: "Server error, could not fetch details." });
    }
});
router.get("/specialists/:specialistId/verification-status", async (req, res) => {
    const { specialistId } = req.params;

    try {
        const result = await pool.query(
            "SELECT status FROM specialist_verification WHERE specialist_id = $1",
            [specialistId]
        );

        if (result.rows.length === 0) {
            return res.json({ status: "not_submitted" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching verification status:", error);
        res.status(500).json({ error: "Failed to fetch verification status" });
    }
});
module.exports = router;
