const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { protect, adminOnly } = require('./middleware/authMiddleware');
const adminController = require('./controllers/adminController');

// Import the controllers
const { submitAttempt, getProgress } = require('./controllers/attemptController');
const { getSubjects, getChapters, getQuestions, getExplanations } = require('./controllers/contentController');
const { createQuestion } = require('./controllers/contentController');

const app = express();

// Middleware
app.use(cors()); // Allows your mobile app to talk to this server 
app.use(express.json()); // Allows the server to read JSON data [cite: 155]

// --- API ROUTES ---

// Content (Student)
app.get('/subjects', getSubjects);
app.get('/chapters', getChapters);
app.get('/questions', getQuestions);
app.get('/chapters/:chapterId/explanations', protect, getExplanations); // Protected route

// Attempts & Progress (Student - Protected)
app.post('/attempts', protect, submitAttempt);
app.get('/progress', protect, getProgress);


app.post('/questions', createQuestion);
app.post('/questions/bulk-upload', protect, adminOnly, adminController.bulkUploadQuestions);
app.post('/subjects', protect, adminOnly, adminController.createSubject);
app.post('/chapters', protect, adminOnly, adminController.createChapter);
// The Server Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});