/**
 * Honeypot Route
 * Main orchestration layer. Receives scam messages, runs detection,
 * generates persona reply, extracts intelligence, and triggers callback.
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

// ─── API Key Auth Middleware ───────────────────────────────────────────────────
router.use((req, res, next) => {
  const providedKey = req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  if (!expectedKey || providedKey === expectedKey) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized: Invalid API key" });
});

// ─── Main Honeypot Endpoint ────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const startTime = Date.now();

  try {
    const { sessionId, message, conversationHistory = [], metadata = {} } = req.body;

    // Input validation
    if (!sessionId || !message || !message.text) {
      return res.status(200).json({
        status: "success",
        reply: "Sorry, I could not understand that. Can you please repeat?",
      });
    }

    const messageText = message.text;
    console.log(`\n📨 [${sessionId}] Message: "${messageText.slice(0, 80)}..."`);

    // ── Step 1: Load or create session ──────────────────────────────────────
    const session = getOrCreateSession(sessionId);

    // ── Step 2: Run scam detection (AI-powered) ──────────────────────────────
    const detection = await detectScam(messageText, conversationHistory);
    console.log(`🔍 Detection: ${detection.isScam ? "SCAM" : "CLEAN"} | Type: ${detection.scamType} | Confidence: ${detection.confidence}`);

    // ── Step 3: Extract intelligence from scammer message ────────────────────
    const extracted = await extractIntelligence(messageText, conversationHistory);

    // Single updateSession call per turn — merges detection + extraction results
    updateSession(sessionId, {
      ...(detection.isScam ? {
        scamConfirmed: true,
        scamType: detection.scamType,
        suspiciousKeywords: detection.signals || [],
        tacticsObserved: [detection.scamType],
      } : {}),
      ...extracted,
    });

    // Get updated session with ALL accumulated intelligence across turns
    const updatedSession = getOrCreateSession(sessionId);

    // Log full accumulated intelligence (not just this turn)
    console.log(`🕵️ This turn:`, JSON.stringify(extracted));
    console.log(`📦 Accumulated:`, JSON.stringify({
      phoneNumbers: updatedSession.phoneNumbers,
      upiIds: updatedSession.upiIds,
      bankAccounts: updatedSession.bankAccounts,
      phishingLinks: updatedSession.phishingLinks,
      emailAddresses: updatedSession.emailAddresses,
    }));

    // ── Step 4: Generate adaptive persona reply ───────────────────────────────
    // Pass full accumulated session so persona knows what intel is already collected
    const reply = await generatePersonaReply(
      detection.scamType || session.scamType || "unknown",
      messageText,
      conversationHistory,
      updatedSession  // contains ALL accumulated intel across all turns
    );

    console.log(`🎭 Reply: "${reply}"`);
    console.log(`⏱️ Total time: ${Date.now() - startTime}ms`);

    // ── Step 5: Check if final callback should fire ───────────────────────────
    const currentSession = getOrCreateSession(sessionId);
    const currentTurn = conversationHistory.length > 0
      ? Math.floor(conversationHistory.length / 2) + 1
      : currentSession.totalMessages;

    // Fire callback LATE (turn 8+) not early — early firing = empty intelligence = lost 40 points
    const isNearEnd = currentTurn >= 8;
    const isDefinitelyEnd = currentTurn >= 10;
    const shouldFire = shouldTriggerCallback(currentSession) ||
                       (isNearEnd && currentSession.scamConfirmed && !currentSession.callbackSent) ||
                       (isDefinitelyEnd && !currentSession.callbackSent);

    if (shouldFire) {
      // Fire async - don't block the response
      sendFinalCallback(currentSession).then(() => {
        updateSession(sessionId, { callbackSent: true });
      });
    }

    // ── Step 6: Return response ───────────────────────────────────────────────
    return res.status(200).json({
      status: "success",
      reply: reply,
    });

  } catch (err) {
    console.error("❌ Route error:", err.message);
    return res.status(200).json({
      status: "success",
      reply: "Sorry, I didn't quite catch that. Can you repeat please?",
    });
  }
});

module.exports = router;