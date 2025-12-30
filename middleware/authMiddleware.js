// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// Protect routes for all logged-in users
exports.protect = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "Not authorized to access this route" }); 
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); 
    req.user = decoded; // Contains id and role
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token verification failed" }); 
  }
};

// Restrict access specifically to Admins (Requirement 5.1)
exports.restrictToAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "You do not have permission to perform this action" });
  }
  next();
};