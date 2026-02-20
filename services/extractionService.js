/**
 * Extraction Service
 * Extracts structured intelligence from scammer messages using AI + regex fallback.
 * Captures: UPI IDs, phone numbers, bank accounts, phishing links, emails, IFSC codes.
 */

const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EXTRACTION_SYSTEM_PROMPT = `You are an intelligence extraction AI for anti-scam operations.

Extract all identifiable data points from the given scammer message.

Look for:
- Phone numbers (Indian format: +91XXXXXXXXXX, 91XXXXXXXXXX, 10-digit starting with 6-9)
- UPI IDs (format: name@bank, number@bank e.g. scammer@okicici, fraud@ybl)
- Bank account numbers (9-18 digit numeric strings)
- IFSC codes (format: XXXX0XXXXXX, 11 characters)
- URLs and links (http://, https://, bit.ly, t.me, wa.me etc.)
- Email addresses
- Organization names being impersonated (SBI, HDFC, TRAI, police, etc.)

Return ONLY this exact JSON:
{
  "phoneNumbers": [],
  "upiIds": [],
  "bankAccounts": [],
  "ifscCodes": [],
  "phishingLinks": [],
  "emailAddresses": [],
  "orgNames": [],
  "suspiciousKeywords": []
}

If nothing found for a field, return empty array. No explanations.`;

/**
 * Extract intelligence from a message using AI
 */
async function extractIntelligence(message, conversationHistory = []) {
  const extracted = {
    phoneNumbers: [],
    upiIds: [],
    bankAccounts: [],
    ifscCodes: [],
    phishingLinks: [],
    emailAddresses: [],
    orgNames: [],
    suspiciousKeywords: [],
  };

  try {
    // Use FULL conversation history for extraction — never miss intelligence from early turns
    // Only extract from SCAMMER messages (sender: scammer) not our own replies
    const allScammerMessages = conversationHistory
      .filter((m) => m.sender === "scammer")
      .map((m) => m.text)
      .concat([message])
      .join(" | ");

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: `Extract from ALL scammer messages: "${allScammerMessages}"` },
      ],
      temperature: 0.1,
      max_tokens: 350,
      response_format: { type: "json_object" },
    });

    const aiResult = JSON.parse(response.choices[0].message.content);

    // Merge AI results using strict canonical key mapping
    // This prevents typos in AI output (e.g. "susspiciousKeywords") from breaking extraction
    const canonicalKeys = {
      phoneNumbers: ["phoneNumbers", "phone_numbers", "phones"],
      upiIds: ["upiIds", "upi_ids", "upis", "upiID", "upiId"],
      bankAccounts: ["bankAccounts", "bank_accounts", "accounts"],
      ifscCodes: ["ifscCodes", "ifsc_codes", "ifsc"],
      phishingLinks: ["phishingLinks", "phishing_links", "links", "urls"],
      emailAddresses: ["emailAddresses", "email_addresses", "emails"],
      orgNames: ["orgNames", "org_names", "organizations", "orggNames"],
      suspiciousKeywords: ["suspiciousKeywords", "suspicious_keywords", "keywords", "susspiciousKeywords"],
    };

    Object.entries(canonicalKeys).forEach(([canonical, aliases]) => {
      aliases.forEach((alias) => {
        if (aiResult[alias] && Array.isArray(aiResult[alias])) {
          // Filter out any non-string or nested array values
          const cleanValues = aiResult[alias]
            .filter(v => v && typeof v === "string" && v.trim().length > 0);
          extracted[canonical] = [...new Set([...extracted[canonical], ...cleanValues])];
        }
      });
    });
  } catch (err) {
    console.error("AI extraction error:", err.message);
  }

  // Always run regex as fallback/supplement
  const regexExtracted = extractWithRegex(message);
  Object.keys(extracted).forEach((key) => {
    if (regexExtracted[key]) {
      extracted[key] = [
        ...new Set([...extracted[key], ...regexExtracted[key]]),
      ];
    }
  });

  return extracted;
}

/**
 * Regex-based extraction as fallback and supplement
 */
function extractWithRegex(text) {
  const result = {
    phoneNumbers: [],
    upiIds: [],
    bankAccounts: [],
    ifscCodes: [],
    phishingLinks: [],
    emailAddresses: [],
    orgNames: [],
    suspiciousKeywords: [],
  };

  if (!text) return result;

  // Phone numbers: Indian format — normalize all to +91XXXXXXXXXX format
  const phoneRegex =
    /(?:\+91|91)?[\s\-]?[6-9]\d{9}|\b[6-9]\d{9}\b/g;
  const phones = text.match(phoneRegex) || [];
  const normalizedPhones = phones.map((p) => {
    const digits = p.replace(/[\s\-]/g, "");
    if (digits.startsWith("+91")) return digits;
    if (digits.startsWith("91") && digits.length === 12) return "+" + digits;
    if (digits.length === 10) return "+91" + digits;
    return digits;
  });
  result.phoneNumbers = [...new Set(normalizedPhones)]; // dedupe after normalizing

  // UPI IDs — catches formats like scammer.fraud@fakebank, name@ybl, number@okicici
  const upiRegex = /[a-zA-Z0-9._\-+]+@[a-zA-Z][a-zA-Z0-9]{2,}/g;
  const upis = text.match(upiRegex) || [];
  // Filter out standard emails but keep UPI IDs
  // UPI handles don't have TLDs (.com .in .org) after the bank name
  result.upiIds = upis.filter((u) => {
    const afterAt = u.split("@")[1] || "";
    const hasCommonTLD = /\.(com|in|org|net|io|co)$/i.test(afterAt);
    const isCommonEmail = /gmail|yahoo|hotmail|outlook|rediff/i.test(afterAt);
    return !hasCommonTLD && !isCommonEmail;
  });

  // Email addresses
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  result.emailAddresses = text.match(emailRegex) || [];

  // IFSC codes
  const ifscRegex = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
  result.ifscCodes = text.match(ifscRegex) || [];

  // Bank account numbers (9-18 digits, standalone)
  // Must be purely numeric — reject text strings like "SBI account number"
  const accountRegex = /\b\d{9,18}\b/g;
  const potentialAccounts = text.match(accountRegex) || [];
  result.bankAccounts = potentialAccounts.filter((a) => {
    // Must be purely numeric 11-18 digits, not a phone number
    const isPhone = result.phoneNumbers.some((p) => p.replace(/\D/g, "").includes(a));
    const isPureNumeric = /^\d+$/.test(a);
    return isPureNumeric && a.length >= 11 && a.length <= 18 && !isPhone;
  });

  // URLs and phishing links
  const urlRegex =
    /https?:\/\/[^\s]+|bit\.ly\/[^\s]+|t\.me\/[^\s]+|wa\.me\/[^\s]+/g;
  result.phishingLinks = text.match(urlRegex) || [];

  // Generic suspicious keyword patterns — language/scenario agnostic
  const suspiciousChecks = [
    ["urgent", /urgent/i],
    ["immediately", /immediately/i],
    ["limited time", /limited.?time/i],
    ["expire", /expir/i],
    ["blocked", /block/i],
    ["suspended", /suspend/i],
    ["arrest", /arrest/i],
    ["freeze", /freeze/i],
    ["OTP", /OTP/i],
    ["password", /password/i],
    ["verify", /verif/i],
    ["confirm", /confirm/i],
    ["cashback", /cashback/i],
    ["refund", /refund/i],
    ["reward", /reward/i],
    ["prize", /prize/i],
    ["winner", /winner/i],
    ["lottery", /lottery/i],
    ["claim", /claim/i],
    ["KYC", /KYC/i],
    ["compromised", /compromis/i],
    ["official", /official/i],
    ["helpline", /helpline/i],
  ];
  result.suspiciousKeywords = suspiciousChecks
    .filter(([label, pattern]) => pattern.test(text))
    .map(([label]) => label);

  return result;
}

module.exports = { extractIntelligence };