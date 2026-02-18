const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { protect, adminOnly } = require('./middleware/authMiddleware');
const adminController = require('./controllers/adminController');
const contentController = require('./controllers/contentController');

// Import the controllers
const { submitAttempt, getProgress } = require('./controllers/attemptController');
const { getSubjects, getChapters, getQuestions, getExplanations, saveAttempt, getUserDashboard } = require('./controllers/contentController');
const { createQuestion } = require('./controllers/contentController');

const app = express();

// Middleware
app.use(cors()); // Allows your mobile app to talk to this server 
app.use(express.json({ limit: '50mb' })); // Allows the server to read JSON data 

// --- API ROUTES ---

// Content (Student)
app.get('/subjects', getSubjects);
app.get('/chapters', getChapters);
app.get('/questions', protect, getQuestions);
app.get('/dashboard', protect, getUserDashboard);
app.get('/chapters/:chapterId/explanations', protect, getExplanations); // Protected route
// --- FLASHCARD ROUTES ---
app.get('/flashcards/subjects', protect, contentController.getFlashcardSubjects);
app.get('/flashcards/chapters/:subjectId', protect, contentController.getFlashcardChapters);
app.get('/flashcards/deck/:chapterId', protect, contentController.getFlashcardsForChapter);
app.post('/flashcards/interact', protect, contentController.trackFlashcardInteraction);
// Attempts & Progress (Student - Protected)
app.post('/attempts', protect, submitAttempt);
app.get('/progress', protect, getProgress);


app.post('/questions', adminOnly, createQuestion);
app.post('/questions/bulk-upload', protect, adminOnly, adminController.bulkUploadQuestions);
app.post('/subjects', protect, adminOnly, adminController.createSubject);
app.post('/chapters', protect, adminOnly, adminController.createChapter);
app.post('/attempts/save', protect, saveAttempt);
app.post('/flashcards/bulk-upload', protect, adminOnly, adminController.bulkUploadFlashcards);
app.post('/flashcards/create', protect, adminOnly, adminController.createSingleFlashcard);
// The Server Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});