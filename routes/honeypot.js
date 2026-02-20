/**
 * Honeypot Route
 * Fast-response architecture (<10s)
 * Persona reply first, heavy analysis async
 */

const express = require("express");
const router = express.Router();

const { detectScam } = require("../services/detectionService");
const { generatePersonaReply } = require("../services/personaService");
const { extractIntelligence } = require("../services/extractionService");
const {
  getOrCreateSession,
  updateSession,
  shouldTriggerCallback,
} = require("../services/sessionService");
const { sendFinalCallback } = require("../utils/callbackService");


// ─────────────────────────────────────────────────────────
// API Key Middleware
// ─────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const providedKey = req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (!expectedKey || providedKey === expectedKey) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized: Invalid API key" });
});


// ─────────────────────────────────────────────────────────
// MAIN HONEYPOT ENDPOINT
// ─────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      sessionId,
      message,
      conversationHistory = [],
      metadata = {},
    } = req.body;

    if (!sessionId || !message || !message.text) {
      return res.status(200).json({
        status: "success",
        reply: "Sorry, I didn't understand that. Could you repeat?",
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
      conversationHistory.slice(-6), // trim context for speed
      session
    );

    // ─────────────────────────────────────────────
    // STEP 2: Respond Immediately (FAST RESPONSE)
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
        const detection = await detectScam(
          messageText,
          conversationHistory
        );

        const extracted = await extractIntelligence(
          messageText,
          conversationHistory
        );

        updateSession(sessionId, {
          ...(detection?.isScam
            ? {
                scamConfirmed: true,
                scamType: detection.scamType,
                suspiciousKeywords: detection.signals || [],
                tacticsObserved: [detection.scamType],
              }
            : {}),
          ...extracted,
        });

        const updatedSession = getOrCreateSession(sessionId);

        // ─────────────────────────────────────────────
        // STEP 4: Trigger Callback if Required
        // ─────────────────────────────────────────────
        if (
          shouldTriggerCallback(updatedSession) &&
          !updatedSession.callbackSent
        ) {
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


// ─────────────────────────────────────────────────────────
// EXPORT ROUTER (IMPORTANT - FIXES YOUR ERROR)
// ─────────────────────────────────────────────────────────
module.exports = router;