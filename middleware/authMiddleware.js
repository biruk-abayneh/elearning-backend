// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabaseClient');

// Protect routes for all logged-in users
exports.protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    // This asks Supabase: "Is this token valid and which user does it belong to?"
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) throw new Error("Invalid token");

    req.user = user; // Add the user object to the request
    next();
  } catch (error) {
    res.status(401).json({ error: "Not authorized" });
  }
};

// Restrict access specifically to Admins (Requirement 5.1)
exports.restrictToAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: "You do not have permission to perform this action" });
  }
  next();
};

exports.adminOnly = async (req, res, next) => {
  // Option A: Hardcoded Admin Email (Quickest)
  const adminEmails = ['admin@test.com'];

  if (adminEmails.includes(req.user.email)) {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admins only." });
  }
};


