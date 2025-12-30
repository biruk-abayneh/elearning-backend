const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import the controllers we discussed
const { submitAttempt, getProgress } = require('./controllers/attemptController');
const { getSubjects, getChapters, getQuestions } = require('./controllers/contentController');
const { protect, restrictToAdmin } = require('./middleware/authMiddleware');

const app = express();

// Middleware
app.use(cors()); // Allows your mobile app to talk to this server 
app.use(express.json()); // Allows the server to read JSON data [cite: 155]

// --- API ROUTES ---

// Content (Student)
app.get('/subjects', getSubjects); 
app.get('/chapters', getChapters); 
app.get('/questions', getQuestions); 

// Attempts & Progress (Student - Protected)
app.post('/attempts', protect, submitAttempt); 
app.get('/progress', protect, getProgress); 

// The Server Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});