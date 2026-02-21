/**
 * Honeypot Route — Production
 * Fast-response architecture: persona reply first, detection/extraction async
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

// ─── API Key Middleware ────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const providedKey = req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;
  if (!expectedKey || providedKey === expectedKey) return next();
  return res.status(401).json({ error: "Unauthorized: Invalid API key" });
});

// ─── Main Honeypot Endpoint ────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const startTime = Date.now();

  try {
    const { sessionId, message, conversationHistory = [], metadata = {} } = req.body;

    // Input validation — always return 200
    if (!sessionId || !message || !message.text) {
      return res.status(200).json({
        status: "success",
        reply: "Sorry, I didn't understand that. Could you repeat?",
      });
    }

    const messageText = message.text;
    console.log(`\n📨 [${sessionId}] Turn ${Math.floor(conversationHistory.length / 2) + 1} | "${messageText.slice(0, 60)}..."`);

    const session = getOrCreateSession(sessionId);

    // ── Step 1: Generate persona reply FIRST (only blocking LLM call) ──────────
    // Use accumulated session data so persona knows what intel already collected
    const reply = await generatePersonaReply(
      session.scamType || "unknown",
      messageText,
      conversationHistory,
      session
    );

    // ── Step 2: Respond immediately — beat the 30s timeout ─────────────────────
    res.status(200).json({ status: "success", reply });
    console.log(`⚡ Replied in ${Date.now() - startTime}ms | "${reply.slice(0, 60)}..."`);

    // ── Step 3: Detection + Extraction run ASYNC after response sent ───────────
    setImmediate(async () => {
      try {
        // Run both in parallel to save time
        const [detection, extracted] = await Promise.all([
          detectScam(messageText, conversationHistory),
          extractIntelligence(messageText, conversationHistory),
        ]);

        console.log(`🔍 Detection: ${detection.isScam ? "SCAM" : "CLEAN"} | Type: ${detection.scamType} | Confidence: ${detection.confidence}`);
        console.log(`🕵️ Extracted:`, JSON.stringify({
          phones: extracted.phoneNumbers,
          upis: extracted.upiIds,
          accounts: extracted.bankAccounts,
          links: extracted.phishingLinks,
        }));

        updateSession(sessionId, {
          ...(detection?.isScam ? {
            scamConfirmed: true,
            scamType: detection.scamType,
            suspiciousKeywords: Array.isArray(detection.signals) ? detection.signals : [],
            tacticsObserved: [detection.scamType],
          } : {}),
          // Accumulate red flag score across turns
          redFlagScore: detection.redFlagScore || 0,
          ...extracted,
        });

        const updatedSession = getOrCreateSession(sessionId);
        const currentTurn = Math.floor(conversationHistory.length / 2) + 1;
        const isNearEnd = currentTurn >= 8;
        const isDefinitelyEnd = currentTurn >= 10;

        // Fire callback late to ensure full intelligence is captured
        const shouldFire = shouldTriggerCallback(updatedSession) ||
                           (isNearEnd && updatedSession.scamConfirmed && !updatedSession.callbackSent) ||
                           (isDefinitelyEnd && !updatedSession.callbackSent);

        if (shouldFire) {
          console.log(`📡 Firing callback for session ${sessionId}...`);
          await sendFinalCallback(updatedSession);
          updateSession(sessionId, { callbackSent: true });
          console.log(`✅ Callback sent for session ${sessionId}`);
        }

      } catch (asyncErr) {
        console.error("❌ Async processing error:", asyncErr.message);
      }
    });

  } catch (err) {
    console.error("❌ Route error:", err.message);
    return res.status(200).json({
      status: "success",
      reply: "Sorry, could you repeat that?",
    });
  }
});

module.exports = router;