// controllers/attemptController.js

exports.submitAttempt = async (req, res) => {
  const { userId, questionId, selectedOption, chapterId } = req.body;

  try {
    // 1. Fetch the question to check correctness (Requirement 6.4 & 6.5)
    const { data: question, error: qError } = await supabase
      .from('questions')
      .select('correct_answer')
      .eq('id', questionId)
      .single();

    if (qError || !question) return res.status(404).json({ error: "Question not found" });

    const isCorrect = (selectedOption === question.correct_answer);

    // 2. Record the Immutable Attempt (Requirement 6.4 & 9.3)
    const { error: attemptError } = await supabase
      .from('attempts')
      .insert([{ 
        user_id: userId, 
        question_id: questionId, 
        selected_option: selectedOption, 
        is_correct: isCorrect,
        chapter_id: chapterId 
      }]);

    // 3. Update the Summary Progress Table (Requirement 3.2 & 6.4)
    // Using PostgreSQL upsert to maintain performance < 500ms
    const { error: progressError } = await supabase.rpc('update_user_progress', {
      p_user_id: userId,
      p_chapter_id: chapterId,
      p_is_correct: isCorrect
    });

    return res.status(200).json({ 
      correct: isCorrect, 
      explanation: question.explanation // Requirement 10.2
    });

  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" }); // Requirement 15.4
  }
};

exports.getProgress = async (req, res) => {
  const { userId } = req.user; // We get the ID from the secure JWT token

  try {
    const { data, error } = await supabase
      .from('progress')
      .select(`
        total_attempts,
        correct_attempts,
        chapters (
          name,
          subjects (name)
        )
      `) // This "joins" the tables so we see the Chapter & Subject names too
      .eq('user_id', userId);

    if (error) throw error;
    
    // We send this back to the phone to show the progress bars
    res.status(200).json(data); 
  } catch (err) {
    res.status(500).json({ error: "Could not fetch progress" });
  }
};