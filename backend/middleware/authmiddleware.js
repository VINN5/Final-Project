const jwt = require("jsonwebtoken");

// Secret key for JWT (should be stored in an environment variable)
const JWT_SECRET = process.env.JWT_SECRET || "mysecret"; 

const authenticateUser = (req, res, next) => {
    const token = req.header("Authorization");

    if (!token) {
        return res.status(401).json({ error: "Access denied. No token provided." });
    }

    try {
        const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(400).json({ error: "Invalid token" });
    }
};

module.exports = authenticateUser;
