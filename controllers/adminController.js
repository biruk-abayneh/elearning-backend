// controllers/adminController.js

exports.upsertQuestion = async (req, res) => {
  const { questionId, chapterId, questionText, options, correctAnswer, explanation } = req.body;

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
        is_active: true          // This one is now the "live" version
      }]);

    if (error) throw error;

    res.status(201).json({ message: "Question saved successfully", data });
  } catch (err) {
    // Consistent error format without raw stack traces [cite: 155, 156]
    res.status(500).json({ error: "Failed to save question" });
  }
};