/**
 * Detection Service
 * Uses Groq AI to classify whether a message is a scam.
 * Returns scam type, confidence, and reasoning.
 */

const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DETECTION_SYSTEM_PROMPT = `You are a fraud detection AI focused on Indian financial scams.

Analyze the message and conversation context to determine if it is a scam.

Detect signals such as:
- Urgency or threat language
- OTP or credential requests
- UPI / bank / IFSC details
- Impersonation (bank, government, police, courier, TRAI)
- Lottery, prize, cashback bait
- Phishing links or suspicious URLs
- KYC updates or SIM blocking threats
- Job, investment, or romance scams

Return ONLY valid JSON in this exact format:

{
  "isScam": true or false,
  "scamType": "bank_fraud | upi_fraud | phishing | kyc_scam | lottery | investment | job_scam | courier | impersonation | unknown",
  "confidence": 0.0 to 1.0,
  "signals": ["detected signals"]
}`;

/**
 * Classify a message as scam or not using Groq
 */
async function detectScam(message, conversationHistory = []) {
  try {
    const historyText =
      conversationHistory.length > 0
        ? conversationHistory
            .slice(-6) // Last 6 messages for context
            .map((m) => `${m.sender}: ${m.text}`)
            .join("\n")
        : "No prior history.";

    const userPrompt = `Conversation History:\n${historyText}\n\nLatest Message:\n"${message}"`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-70b-versatile",
      messages: [
        { role: "system", content: DETECTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      isScam: result.isScam === true,
      scamType: result.scamType || "unknown",
      confidence: result.confidence || 0.5,
      signals: result.signals || [],
    };
  } catch (err) {
    console.error("Detection error:", err.message);
    // Fallback: assume scam if detection fails (safer for competition)
    return {
      isScam: true,
      scamType: "unknown",
      confidence: 0.5,
      signals: ["detection_fallback"],
    };
  }
}

module.exports = { detectScam };