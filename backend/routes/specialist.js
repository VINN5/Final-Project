const express = require("express");
const multer = require("multer");
const pool = require("../config/db");
const router = express.Router();

// Setup file upload
const upload = multer({ dest: "uploads/" });

const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        console.error("No token provided");
        return res.status(401).json({ error: "Unauthorized" });
    }

    const jwt = require("jsonwebtoken");
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error("Invalid token:", err);
            return res.status(403).json({ error: "Invalid token" });
        }
        req.userId = decoded.userId;
        console.log("Decoded User ID:", req.userId); // Debugging log
        next();
    });
};

router.post("/update-profile", authenticateUser, upload.single("profile_photo"), async (req, res) => {
    const { services, experience, skills } = req.body;
    const profilePhoto = req.file ? `http://localhost:8080/uploads/${req.file.filename}` : null;

    try {
        console.log("Updating profile for user ID:", req.userId);

        const specialist = await pool.query("SELECT * FROM specialists WHERE user_id = $1", [req.userId]);

        if (specialist.rows.length === 0) {
            await pool.query(
                "INSERT INTO specialists (user_id, profile_photo, services, experience, skills) VALUES ($1, $2, $3, $4, $5)",
                [req.userId, profilePhoto, services, experience, skills]
            );
        } else {
            await pool.query(
                "UPDATE specialists SET profile_photo = COALESCE($1, profile_photo), services = $2, experience = $3, skills = $4 WHERE user_id = $5",
                [profilePhoto, services, experience, skills, req.userId]
            );
        }

        res.json({ message: "Profile updated successfully!" });
    } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Server error, could not update profile." });
    }
});




// Upload Previous Work
router.post("/upload-work", upload.single("work_photo"), async (req, res) => {
    res.json({ imageUrl: `/uploads/${req.file.filename}` });
});


router.get("/details", authenticateUser, async (req, res) => {
    try {
        console.log("Fetching details for user ID:", req.userId); // Debugging log

        // Fetch user details from `users` table
        const userResult = await pool.query(
            "SELECT full_name, email, phone, gender, location, role FROM users WHERE id = $1",
            [req.userId]
        );

        if (userResult.rows.length === 0) {
            console.error("User not found:", req.userId);
            return res.status(404).json({ error: "User not found" });
        }

        // Fetch specialist details from `specialists` table
        const specialistResult = await pool.query(
            "SELECT COALESCE(profile_photo, 'default.jpg') AS profile_photo, COALESCE(NULLIF(services, ''), 'Not set') AS services, COALESCE(NULLIF(skills, ''), 'Not set') AS skills, COALESCE(experience, 0) AS experience FROM specialists WHERE user_id = $1",
            [req.userId]
        );

        // Merge both results
        const userDetails = userResult.rows[0];
        const specialistDetails = specialistResult.rows.length > 0 ? specialistResult.rows[0] : {
            profile_photo: 'default.jpg',
            services: 'Not set',
            skills: 'Not set',
            experience: 0
        };

        res.json({ ...userDetails, ...specialistDetails });

    } catch (error) {
        console.error("Error fetching specialist details:", error);
        res.status(500).json({ error: "Server error, could not fetch details." });
    }
});
router.post("/update-availability", authenticateUser, async (req, res) => {
    const { status } = req.body;
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

    try {
        // Update specialist availability
        await pool.query(
            "UPDATE specialists SET availability = $1 WHERE user_id = $2",
            [status, req.userId]
        );

        if (status === "available") {
            // Check if sessions already exist for today
            const existingSessions = await pool.query(
                "SELECT * FROM sessions WHERE specialist_id = $1 AND date = $2",
                [req.userId, today]
            );

            if (existingSessions.rows.length === 0) {
                // Generate sessions only if they don't already exist
                const sessions = generateSessions();
                for (const session of sessions) {
                    await pool.query(
                        "INSERT INTO sessions (specialist_id, start_time, end_time, date) VALUES ($1, $2, $3, $4)",
                        [req.userId, session.start_time, session.end_time, today]
                    );
                }
            }
        } else if (status === "not_available") {
            // Delete sessions for today if specialist is not available
            await pool.query(
                "DELETE FROM sessions WHERE specialist_id = $1 AND date = $2",
                [req.userId, today]
            );
        }

        res.json({ message: "Availability updated successfully!" });
    } catch (error) {
        console.error("Error updating availability:", error);
        res.status(500).json({ error: "Server error, could not update availability." });
    }
});

// Helper function to generate sessions
function generateSessions() {
    const sessions = [];
    let startHour = new Date().getDay() === 0 ? 14 : 8; // Sunday starts at 2 PM, other days at 8 AM
    let endHour = 18; // 6 PM

    for (let hour = startHour; hour < endHour; hour++) {
        if (hour === 13) continue; // Skip lunch break (1 PM - 2 PM)

        sessions.push({
            start_time: `${hour}:00`,
            end_time: `${hour + 1}:00`,
        });
    }

    return sessions;
}
router.get("/sessions", authenticateUser, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const currentTime = new Date().toTimeString().split(' ')[0]; // Get current time in HH:MM:SS format

        const sessions = await pool.query(
            "SELECT * FROM sessions WHERE specialist_id = $1 AND date = $2 AND start_time > $3 ORDER BY start_time ASC",
            [req.userId, today, currentTime]
        );

        res.json({ sessions: sessions.rows });
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ error: "Server error, could not retrieve sessions." });
    }
});

router.get("/bookings", authenticateUser, async (req, res) => {
    try {
        // Fetch all bookings for the logged-in specialist
        const bookings = await pool.query(
            `SELECT 
                b.id AS booking_id,
                b.status AS booking_status,
                b.created_at AS booking_created,
                b.updated_at AS booking_updated,
                s.id AS session_id, 
                s.date, 
                s.start_time, 
                s.end_time, 
                s.status AS session_status,
                u.full_name AS client_name, 
                u.email AS client_email, 
                u.phone AS client_phone,
                u.profile_photo AS client_photo
             FROM bookings b
             JOIN sessions s ON b.session_id = s.id
             JOIN users u ON b.client_id = u.id
             WHERE s.specialist_id = $1
             ORDER BY s.date DESC, s.start_time DESC`,
            [req.userId] // Now using req.user.id consistently
        );

        res.json({ bookings: bookings.rows });
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ 
            error: "Internal server error",
            details: error.message 
        });
    }
});

router.post("/upload-previous-work", authenticateUser, upload.single("previous-work"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = `/uploads/${req.file.filename}`;

        // Insert into the "Previous Works" table
        await pool.query(
            "INSERT INTO previous_works (specialist_id, image_path, price) VALUES ($1, $2, NULL)",
            [req.userId, filePath]
        );

        res.json({ message: "Previous work uploaded successfully", filePath });
    } catch (error) {
        console.error("Error uploading previous work:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

router.get("/get-previous-works", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, image_path, price FROM previous_works WHERE specialist_id = $1",
            [req.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching previous works:", error);
        res.status(500).json({ error: "Failed to fetch previous works" });
    }
});

router.post("/update-work-price/:workId", authenticateUser, async (req, res) => {
    const { workId } = req.params;
    const { price } = req.body;

    try {
        await pool.query(
            "UPDATE previous_works SET price = $1 WHERE id = $2 AND specialist_id = $3",
            [price, workId, req.userId]
        );
        res.json({ message: "Price updated successfully" });
    } catch (error) {
        console.error("Error updating price:", error);
        res.status(500).json({ error: "Failed to update price" });
    }
});
router.delete("/delete-previous-work/:workId", authenticateUser, async (req, res) => {
    const { workId } = req.params;

    try {
        await pool.query(
            "DELETE FROM previous_works WHERE id = $1 AND specialist_id = $2",
            [workId, req.userId]
        );
        res.json({ message: "Previous work deleted successfully" });
    } catch (error) {
        console.error("Error deleting previous work:", error);
        res.status(500).json({ error: "Failed to delete previous work" });
    }
});
// Accept a booking
router.post("/accept-booking/:bookingId", authenticateUser, async (req, res) => {
    const { bookingId } = req.params;

    try {
        // Verify the booking belongs to this specialist
        const booking = await pool.query(
            `SELECT b.id, s.specialist_id 
             FROM bookings b
             JOIN sessions s ON b.session_id = s.id
             WHERE b.id = $1 AND s.specialist_id = $2`,
            [bookingId, req.userId]
        );

        if (booking.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found or not authorized" });
        }

        // Update the booking status to 'accepted'
        await pool.query(
            "UPDATE bookings SET status = 'accepted', updated_at = NOW() WHERE id = $1",
            [bookingId]
        );

        // Update the session status to 'booked' (not 'accepted' as sessions have different statuses)
        await pool.query(
            "UPDATE sessions SET status = 'booked' WHERE id IN (SELECT session_id FROM bookings WHERE id = $1)",
            [bookingId]
        );

        res.json({ message: "Booking accepted successfully!" });
    } catch (error) {
        console.error("Error accepting booking:", error);
        res.status(500).json({ error: "Failed to accept booking." });
    }
});

// Reject a booking
router.post("/reject-booking/:bookingId", authenticateUser, async (req, res) => {
    const { bookingId } = req.params;

    try {
        // Verify the booking belongs to this specialist
        const booking = await pool.query(
            `SELECT b.id, s.specialist_id 
             FROM bookings b
             JOIN sessions s ON b.session_id = s.id
             WHERE b.id = $1 AND s.specialist_id = $2`,
            [bookingId, req.userId]
        );

        if (booking.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found or not authorized" });
        }

        // Update the booking status to 'rejected'
        await pool.query(
            "UPDATE bookings SET status = 'rejected', updated_at = NOW() WHERE id = $1",
            [bookingId]
        );

        // Update the session status back to 'available'
        await pool.query(
            "UPDATE sessions SET status = 'available' WHERE id IN (SELECT session_id FROM bookings WHERE id = $1)",
            [bookingId]
        );

        res.json({ message: "Booking rejected successfully!" });
    } catch (error) {
        console.error("Error rejecting booking:", error);
        res.status(500).json({ error: "Failed to reject booking." });
    }
});


router.post("/send-message", authenticateUser, async (req, res) => {
    const { receiver_id, message } = req.body;

    try {
        await pool.query(
            "INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)",
            [req.userId, receiver_id, message]  // ✅ Use req.userId instead of req.user.id
        );

        res.json({ message: "Message sent successfully!" });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send message." });
    }
});
router.get("/messages", authenticateUser, async (req, res) => {
    const { other_user_id } = req.query;

    try {
        const messages = await pool.query(
            `SELECT sender_id, receiver_id, message, timestamp 
             FROM messages 
             WHERE (sender_id = $1 AND receiver_id = $2) 
             OR (sender_id = $2 AND receiver_id = $1) 
             ORDER BY timestamp ASC`,
            [req.userId, other_user_id]
        );

        res.json({ messages: messages.rows });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages." });
    }
});


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


 router.get("/unread-messages-count", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND is_read = FALSE",
            [req.userId]  // ✅ Corrected from `req.user.id` to `req.userId`
        );

        res.json({ unreadCount: result.rows[0].count });
    } catch (error) {
        console.error("Error fetching unread messages count:", error);
        res.status(500).json({ error: "Failed to fetch unread messages count." });
    }
});

router.get("/chat-list", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT u.id, u.full_name
             FROM messages m
             JOIN users u ON (m.sender_id = u.id OR m.receiver_id = u.id)
             WHERE (m.sender_id = $1 OR m.receiver_id = $1) AND u.id != $1`,
            [req.userId]
        );

        if (result.rows.length === 0) {
            return res.json({ clients: [] });
        }

        res.json({ clients: result.rows });
    } catch (error) {
        console.error("Error fetching chat list:", error);
        res.status(500).json({ error: "Failed to fetch chat list." });
    }
});
router.get("/reviews", authenticateUser, async (req, res) => {
    try {
        // Fetch reviews with client names and dates
        const reviews = await pool.query(
            `SELECT r.id, r.rating, r.review, r.created_at, 
                    u.full_name AS client_name
             FROM reviews r
             JOIN users u ON r.client_id = u.id
             WHERE r.specialist_id = $1
             ORDER BY r.created_at DESC`,
            [req.userId]
        );

        // Calculate average rating
        const avgRating = await pool.query(
            `SELECT AVG(rating) as average, COUNT(*) as count 
             FROM reviews 
             WHERE specialist_id = $1`,
            [req.userId]
        );

        res.json({
            reviews: reviews.rows,
            averageRating: parseFloat(avgRating.rows[0].average || 0).toFixed(1),
            totalReviews: avgRating.rows[0].count
        });

    } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ error: "Failed to fetch reviews" });
    }
});

// specialist.js
router.get("/average-rating", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT COALESCE(AVG(r.rating), 0) AS average_rating, COUNT(r.id) AS total_reviews
             FROM reviews r
             WHERE r.specialist_id = $1`,
            [req.userId]
        );

        res.json({
            average_rating: parseFloat(result.rows[0].average_rating).toFixed(1),
            total_reviews: result.rows[0].total_reviews
        });
    } catch (error) {
        console.error("Error fetching average rating:", error);
        res.status(500).json({ error: "Failed to fetch average rating" });
    }
});

router.get("/specialists/:id/ratings", async (req, res) => {
    const specialistId = req.params.id;

    try {
        const result = await pool.query(
            "SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS total_reviews FROM ratings WHERE specialist_id = $1",
            [specialistId]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching ratings:", error);
        res.status(500).json({ error: "Failed to fetch ratings." });
    }
});
// Add these routes to specialist.js

router.post("/upload-verification", authenticateUser, upload.fields([
    { name: 'front_image', maxCount: 1 },
    { name: 'back_image', maxCount: 1 }
]), async (req, res) => {
    try {
        // Get the base URL (you might want to configure this properly for production)
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        
        const frontImage = req.files['front_image'] ? 
            `${baseUrl}/uploads/${req.files['front_image'][0].filename}` : null;
        const backImage = req.files['back_image'] ? 
            `${baseUrl}/uploads/${req.files['back_image'][0].filename}` : null;

        if (!frontImage || !backImage) {
            return res.status(400).json({ error: "Both front and back images are required" });
        }

        // Check if verification already exists
        const existingVerification = await pool.query(
            "SELECT * FROM specialist_verification WHERE specialist_id = $1",
            [req.userId]
        );

        if (existingVerification.rows.length > 0) {
            // Delete old images if they exist
            if (existingVerification.rows[0].front_image) {
                const oldFrontPath = path.join(uploadsDir, path.basename(existingVerification.rows[0].front_image));
                if (fs.existsSync(oldFrontPath)) {
                    fs.unlinkSync(oldFrontPath);
                }
            }
            if (existingVerification.rows[0].back_image) {
                const oldBackPath = path.join(uploadsDir, path.basename(existingVerification.rows[0].back_image));
                if (fs.existsSync(oldBackPath)) {
                    fs.unlinkSync(oldBackPath);
                }
            }

            // Update existing verification
            await pool.query(
                "UPDATE specialist_verification SET front_image = $1, back_image = $2, status = 'pending' WHERE specialist_id = $3",
                [frontImage, backImage, req.userId]
            );
        } else {
            // Create new verification
            await pool.query(
                "INSERT INTO specialist_verification (specialist_id, front_image, back_image, status) VALUES ($1, $2, $3, 'pending')",
                [req.userId, frontImage, backImage]
            );
        }

        res.json({ 
            message: "Verification documents uploaded successfully",
            frontImage,
            backImage
        });
    } catch (error) {
        console.error("Error uploading verification:", error);
        res.status(500).json({ error: "Failed to upload verification documents" });
    }
});
// Get verification status
router.get("/verification-status", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT status, rejection_reason FROM specialist_verification WHERE specialist_id = $1",
            [req.userId]
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
router.get("/details", authenticateUser, async (req, res) => {
    try {
        // Fetch user details
        const userResult = await pool.query(
            "SELECT full_name, email, phone, gender, location, role FROM users WHERE id = $1",
            [req.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Fetch specialist details
        const specialistResult = await pool.query(
            `SELECT 
                COALESCE(profile_photo, 'default.jpg') AS profile_photo, 
                COALESCE(NULLIF(services, ''), 'Not set') AS services, 
                COALESCE(NULLIF(skills, ''), 'Not set') AS skills, 
                COALESCE(experience, 0) AS experience,
                availability
             FROM specialists WHERE user_id = $1`,
            [req.userId]
        );

        // Fetch verification status
        const verificationResult = await pool.query(
            "SELECT status FROM specialist_verification WHERE specialist_id = $1",
            [req.userId]
        );

        // Merge results
        const userDetails = userResult.rows[0];
        const specialistDetails = specialistResult.rows.length > 0 ? specialistResult.rows[0] : {
            profile_photo: 'default.jpg',
            services: 'Not set',
            skills: 'Not set',
            experience: 0,
            availability: 'not_available'
        };

        // Include verification status in response
        const responseData = { 
            ...userDetails, 
            ...specialistDetails,
            verification_status: verificationResult.rows.length > 0 ? verificationResult.rows[0].status : 'not_submitted',
            is_verified: verificationResult.rows.length > 0 && verificationResult.rows[0].status === 'approved'
        };

        res.json(responseData);

    } catch (error) {
        console.error("Error fetching specialist details:", error);
        res.status(500).json({ error: "Server error" });
    }
});


router.get("/verification-status-only", authenticateUser, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT status, rejection_reason FROM specialist_verification WHERE specialist_id = $1",
            [req.userId]
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
