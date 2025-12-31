const supabase = require('../config/supabaseClient');

exports.submitAttempt = async (req, res) => {
  try {
    const { questionId, selectedOption, chapterId } = req.body;

    // 1. Fetch the correct answer from the database to compare
    const { data: question, error: qError } = await supabase
      .from('questions')
      .select('correct_answer, explanation')
      .eq('id', questionId)
      .single();

    if (qError) throw qError;

    const isCorrect = (question.correct_answer === selectedOption);

    // 2. Save the attempt to the 'progress' table
    // Note: Since we haven't finished the User Login, we'll use a placeholder 'user_id' for now
    const { error: pError } = await supabase
      .from('progress')
      .insert([
        { 
          question_id: questionId, 
          is_correct: isCorrect,
          chapter_id: chapterId
        }
      ]);

    if (pError) throw pError;

    // 3. Send the result back to the mobile app
    res.status(200).json({
      correct: isCorrect,
      explanation: question.explanation
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error saving attempt" });
  }
};