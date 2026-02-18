// controllers/adminController.js

const supabase = require('../config/supabaseClient');

exports.upsertQuestion = async (req, res) => {
  const { questionId, chapterId, questionText, options, correctAnswer, explanation, questionImage, explanationImage } = req.body;

  try {
    // 1. If we are "editing" (questionId exists), we Soft Delete the old one
    if (questionId) {
      await supabase
        .from('questions')
        .update({ is_active: false }) // Hide it from future users [cite: 91]
        .eq('id', questionId);
    }

    // 2. Create the new (or updated) version of the question
    // This allows up to 5 options (A, B, C, D, E) 
    const { data, error } = await supabase
      .from('questions')
      .insert([{
        chapter_id: chapterId,
        question_text: questionText,
        options: options,        // Array of strings
        correct_answer: correctAnswer,
        explanation: explanation, // Static admin-authored text [cite: 102, 104]
        is_active: true,          // This one is now the "live" version
        question_image: questionImage || null, // Optional image URL
        explanation_image: explanationImage || null // Optional explanation image URL
      }]);

    if (error) throw error;

    res.status(201).json({ message: "Question saved successfully", data });
  } catch (err) {
    // Consistent error format without raw stack traces [cite: 155, 156]
    res.status(500).json({ error: "Failed to save question" });
  }
};

// backend/controllers/adminController.js

exports.createSubject = async (req, res) => {
  try {
    // 1. Remove the 'const headers = ...' line entirely
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Subject name is required" });
    }

    const { data, error } = await supabase
      .from('subjects')
      .insert([{ name }])
      .select();

    if (error) throw error;

    // 2. Send the response back
    res.status(201).json(data[0]);
  } catch (error) {
    console.error("Admin Controller Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.createChapter = async (req, res) => {
  const { subject_id, name } = req.body;
  const { data, error } = await supabase
    .from('chapters')
    .insert([{ subject_id, name }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
};

exports.bulkUploadQuestions = async (req, res) => {
  try {
    const { chapter_id, questions } = req.body;

    // Mapping the data to match your Supabase column names
    const formattedQuestions = Object.values(questions).map(q => {
      // Map the string "option A", "option B" etc., to the actual text content
      const answerKey = q["correct answer"];
      const correctAnswerText = q[answerKey];

      return {
        chapter_id: chapter_id,
        question_text: q.question,
        options: [q["option A"], q["option B"], q["option C"], q["option D"]],
        correct_answer: correctAnswerText, // Updated to your DB column name
        explanation: q.explanation || "",
        question_image: q.question_image || null, // Optional image URL
        explanation_image: q.explanation_image || null // Optional explanation image URL
      };
    });

    const { data, error } = await supabase
      .from('questions')
      .insert(formattedQuestions)
      .select();

    if (error) throw error;

    res.status(201).json({ message: `Successfully uploaded ${data.length} questions` });
  } catch (error) {
    console.error("Bulk Upload Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.bulkUploadFlashcards = async (req, res) => {
  const { chapterId, flashcardsJson } = req.body;

  try {
    // Transform the "card 1": {front, back} format into an array for Supabase
    const cardsArray = Object.keys(flashcardsJson).map(key => ({
      chapter_id: chapterId,
      front_text: flashcardsJson[key].front,
      back_text: flashcardsJson[key].back
    }));

    const { data, error } = await supabase
      .from('flashcards')
      .insert(cardsArray);

    if (error) throw error;
    res.json({ message: `Successfully uploaded ${cardsArray.length} flashcards.` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.createSingleFlashcard = async (req, res) => {
  const { chapterId, front, back } = req.body;
  const { data, error } = await supabase
    .from('flashcards')
    .insert([{ chapter_id: chapterId, front_text: front, back_text: back }]);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Flashcard created successfully!' });
};