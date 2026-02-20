/**
 * Callback Service
 * Sends the final intelligence report to the hackathon evaluation endpoint.
 * Triggered automatically when engagement threshold is met.
 */

const axios = require("axios");

const CALLBACK_URL =
  process.env.CALLBACK_URL ||
  "https://hackathon.guvi.in/api/updateHoneyPotFinalResult";

/**
 * Send final result to evaluation endpoint
 */
async function sendFinalCallback(session) {
  const engagementDuration = Math.floor(
    (session.lastUpdated - session.createdAt) / 1000
  );

  const payload = {
    sessionId: session.sessionId,
    status: "completed",
    scamDetected: session.scamConfirmed,
    scamType: session.scamType || "unknown",
    totalMessagesExchanged: session.totalMessages,
    extractedIntelligence: {
      phoneNumbers: session.phoneNumbers || [],
      bankAccounts: session.bankAccounts || [],
      upiIds: session.upiIds || [],
      phishingLinks: session.phishingLinks || [],
      emailAddresses: session.emailAddresses || [],
      ifscCodes: session.ifscCodes || [],
      suspiciousKeywords: session.suspiciousKeywords || [],
    },
    engagementMetrics: {
      totalMessagesExchanged: session.totalMessages,
      engagementDurationSeconds: engagementDuration,
    },
    agentNotes: buildAgentNotes(session),
  };

  // Retry logic — try up to 3 times with delay to guarantee delivery
  // Doc says system waits 10 seconds after conversation ends — we must land within that
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`📡 Callback attempt ${attempt}/${MAX_RETRIES} for session ${session.sessionId}...`);

      const response = await axios.post(CALLBACK_URL, payload, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.API_KEY,
        },
        timeout: 8000, // 8s per attempt — stays well within the 10s window
      });

      console.log(`✅ Callback sent. Status: ${response.status}`);
      return { success: true, status: response.status };
    } catch (err) {
      console.error(`❌ Callback attempt ${attempt} failed:`, err.message);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.error("❌ All callback attempts failed for session:", session.sessionId);
  return { success: false, error: "All retries exhausted" };
}

/**
 * Build a human-readable agent notes summary
 */
function buildAgentNotes(session) {
  const notes = [];

  notes.push(
    `Scam type identified: ${session.scamType || "unknown"}.`
  );

  if (session.tacticsObserved?.length) {
    notes.push(`Tactics observed: ${session.tacticsObserved.join(", ")}.`);
  }

  if (session.orgNames?.length) {
    notes.push(`Impersonated organizations: ${session.orgNames.join(", ")}.`);
  }

  if (session.phoneNumbers?.length) {
    notes.push(`Scammer phone numbers collected: ${session.phoneNumbers.join(", ")}.`);
  }

  if (session.upiIds?.length) {
    notes.push(`UPI IDs extracted: ${session.upiIds.join(", ")}.`);
  }

  if (session.bankAccounts?.length) {
    notes.push(`Bank accounts extracted: ${session.bankAccounts.join(", ")}.`);
  }

  if (session.phishingLinks?.length) {
    notes.push(`Phishing links found: ${session.phishingLinks.join(", ")}.`);
  }

  if (session.suspiciousKeywords?.length) {
    notes.push(
      `Suspicious keywords flagged: ${session.suspiciousKeywords.slice(0, 8).join(", ")}.`
    );
  }

  notes.push(
    `Honeypot engaged scammer for ${session.totalMessages} messages.`
  );

  return notes.join(" ");
}

module.exports = { sendFinalCallback };