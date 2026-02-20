router.post("/", async (req, res) => {
  const startTime = Date.now();

  try {
    const { sessionId, message, conversationHistory = [], metadata = {} } = req.body;

    if (!sessionId || !message || !message.text) {
      return res.status(200).json({
        status: "success",
        reply: "Sorry, I could not understand that. Can you repeat?",
      });
    }

    const messageText = message.text;
    const session = getOrCreateSession(sessionId);

    // ─────────────────────────────────────────────
    // STEP 1: Generate Persona Reply (ONLY blocking LLM call)
    // ─────────────────────────────────────────────
    const reply = await generatePersonaReply(
      session.scamType || "unknown",
      messageText,
      conversationHistory,
      session
    );

    // ─────────────────────────────────────────────
    // STEP 2: Respond Immediately (FAST)
    // ─────────────────────────────────────────────
    res.status(200).json({
      status: "success",
      reply,
    });

    console.log(`⚡ Responded in ${Date.now() - startTime}ms`);

    // ─────────────────────────────────────────────
    // STEP 3: Run Detection + Extraction ASYNC
    // ─────────────────────────────────────────────
    setImmediate(async () => {
      try {
        const detection = await detectScam(messageText, conversationHistory);
        const extracted = await extractIntelligence(messageText, conversationHistory);

        updateSession(sessionId, {
          ...(detection.isScam ? {
            scamConfirmed: true,
            scamType: detection.scamType,
            suspiciousKeywords: detection.signals || [],
            tacticsObserved: [detection.scamType],
          } : {}),
          ...extracted,
        });

        const updatedSession = getOrCreateSession(sessionId);

        // ─────────────────────────────────────────────
        // STEP 4: Fire Callback If Needed (Async)
        // ─────────────────────────────────────────────
        if (shouldTriggerCallback(updatedSession) && !updatedSession.callbackSent) {
          await sendFinalCallback(updatedSession);
          updateSession(sessionId, { callbackSent: true });
        }

      } catch (asyncErr) {
        console.error("Async processing error:", asyncErr.message);
      }
    });

  } catch (err) {
    console.error("Route error:", err.message);
    return res.status(200).json({
      status: "success",
      reply: "Sorry, could you repeat that?",
    });
  }
});