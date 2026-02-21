/**
 * Detection Service
 * Dual-layer: deterministic red-flag scoring + LLM classification
 * Guarantees obvious scams are never missed.
 */

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DETECTION_SYSTEM_PROMPT = `You are an elite fraud detection AI. Analyze messages for ANY scam or social engineering attempt worldwide.

RED FLAGS:
URGENCY: "act now", "expires", "immediately", "blocked", "suspended", "frozen", "within X minutes"
CREDENTIALS: OTP, PIN, password, CVV, security code, verification code
FINANCIAL: bank account, UPI, wire transfer, gift cards, cryptocurrency, "send money"
IMPERSONATION: bank, government, police, courier, tech support, utility company, employer, RBI, TRAI
PHISHING: suspicious links, fake login pages, "verify your account", lookalike domains
LOTTERY/PRIZE: "you won", "claim your prize", "lucky winner", "cashback", "refund pending"
INVESTMENT: guaranteed returns, crypto opportunity, "double your money", forex
JOB SCAMS: work from home, easy money, upfront fee required
ROMANCE: quick emotional attachment, money requests, "stuck abroad"
KYC: "update KYC", "submit Aadhaar", "verify PAN"
TECH SUPPORT: "virus detected", "account hacked", "remote access needed"
COURIER: "package held", "customs fee", "delivery failed", pay to release

Return ONLY valid JSON:
{
  "isScam": true or false,
  "scamType": "bank_fraud | upi_fraud | phishing | kyc_scam | lottery | investment | job_scam | courier | impersonation | tech_support | romance | unknown",
  "confidence": 0.0 to 1.0,
  "signals": ["specific", "red", "flags", "detected"]
}`;

// ─── Deterministic Red Flag Scoring ───────────────────────────────────────────
function computeRedFlagScore(messageText) {
  let score = 0;
  const patterns = [
    { regex: /urgent|immediate|within \d+ (minutes?|hours?)/i, weight: 2 },
    { regex: /\botp\b|one[- ]?time password/i, weight: 3 },
    { regex: /upi|@okaxis|@ybl|@okicici|@paytm|@upi/i, weight: 3 },
    { regex: /account blocked|suspended|frozen|compromised/i, weight: 3 },
    { regex: /lottery|cashback|reward|prize|you won|lucky winner/i, weight: 2 },
    { regex: /click here|https?:\/\//i, weight: 2 },
    { regex: /kyc update|verify kyc|update your kyc/i, weight: 2 },
    { regex: /guaranteed returns|investment opportunity|double your money/i, weight: 2 },
    { regex: /call me|contact immediately|call back/i, weight: 1 },
    { regex: /share your|send your|provide your/i, weight: 2 },
    { regex: /bank account|account number|ifsc/i, weight: 2 },
    { regex: /customs fee|delivery failed|package held/i, weight: 2 },
    { regex: /virus detected|remote access|tech support/i, weight: 2 },
    { regex: /gift card|bitcoin|crypto|wallet address/i, weight: 3 },
  ];

  for (const p of patterns) {
    if (p.regex.test(messageText)) score += p.weight;
  }
  return score;
}

// ─── Main Detection Function ───────────────────────────────────────────────────
async function detectScam(message, conversationHistory = []) {
  // Step 1: Deterministic scoring — never misses obvious scams
  const redFlagScore = computeRedFlagScore(message);
  const highRiskKeyword = /\botp\b|upi|cashback|account blocked|click here|verify.*account/i.test(message);

  // Force scam if deterministic score is high enough
  if (redFlagScore >= 4 || highRiskKeyword) {
    let scamType = "unknown";
    if (/upi|@/i.test(message)) scamType = "upi_fraud";
    else if (/otp|account|bank|ifsc/i.test(message)) scamType = "bank_fraud";
    else if (/http|click here|verify.*link/i.test(message)) scamType = "phishing";
    else if (/lottery|prize|cashback|winner/i.test(message)) scamType = "lottery";
    else if (/kyc/i.test(message)) scamType = "kyc_scam";
    else if (/invest|returns|crypto/i.test(message)) scamType = "investment";
    else if (/customs|delivery|package/i.test(message)) scamType = "courier";
    else if (/job|work from home|earn/i.test(message)) scamType = "job_scam";

    const confidence = redFlagScore >= 8 ? 0.95 : 0.85;

    // Still run LLM in background for better scamType — but return deterministic result
    try {
      const llmResult = await runLLMDetection(message, conversationHistory);
      return {
        isScam: true,
        scamType: llmResult.scamType !== "unknown" ? llmResult.scamType : scamType,
        confidence: Math.max(confidence, llmResult.confidence),
        signals: [...new Set([...llmResult.signals, `redFlagScore:${redFlagScore}`])],
        redFlagScore,
      };
    } catch {
      return { isScam: true, scamType, confidence, signals: [`redFlagScore:${redFlagScore}`], redFlagScore };
    }
  }

  // Step 2: Low red flag score — rely on LLM
  try {
    const llmResult = await runLLMDetection(message, conversationHistory);
    return { ...llmResult, redFlagScore };
  } catch (err) {
    console.error("Detection error:", err.message);
    return { isScam: true, scamType: "unknown", confidence: 0.5, signals: ["detection_fallback"], redFlagScore };
  }
}

async function runLLMDetection(message, conversationHistory) {
  const historyText = conversationHistory.length > 0
    ? conversationHistory
        .filter(m => m.sender === "scammer")
        .slice(-4)
        .map(m => m.text)
        .join(" | ")
    : "No prior history.";

  const userPrompt = `Scammer messages: ${historyText}\n\nLatest: "${message}"`;

  // Timeout wrapper — never block response for more than 8 seconds
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("LLM timeout")), 8000)
  );

  const llmPromise = groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: DETECTION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 150,
    response_format: { type: "json_object" },
  });

  const response = await Promise.race([llmPromise, timeoutPromise]);
  const raw = JSON.parse(response.choices[0].message.content);

  // Validate LLM output — never trust raw output
  return {
    isScam: typeof raw.isScam === "boolean" ? raw.isScam : false,
    scamType: typeof raw.scamType === "string" ? raw.scamType : "unknown",
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    signals: Array.isArray(raw.signals) ? raw.signals : [],
  };
}

module.exports = { detectScam, computeRedFlagScore };