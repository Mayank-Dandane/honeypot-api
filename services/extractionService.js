/**
 * Extraction Service
 * Dual-layer: AI + deterministic regex
 * Format-agnostic, multi-country, normalized, deduplicated
 */

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EXTRACTION_SYSTEM_PROMPT = `You are an intelligence extraction AI for anti-scam operations.

Extract ALL identifiable data from scammer messages. Be aggressive.

Look for:
- Phone numbers (any country: +91, +1, +44, 10-digit, etc.)
- UPI IDs (name@bank, e.g. scammer@ybl, fraud@okicici)
- Bank account numbers (any numeric string 9-18 digits)
- IFSC codes (format: XXXX0XXXXXX)
- URLs and phishing links (http, https, bit.ly, t.me, wa.me)
- Email addresses
- Organization names being impersonated
- Cryptocurrency wallet addresses
- Employee/agent IDs or case reference numbers

Return ONLY valid JSON, no explanations:
{
  "phoneNumbers": [],
  "upiIds": [],
  "bankAccounts": [],
  "ifscCodes": [],
  "phishingLinks": [],
  "emailAddresses": [],
  "orgNames": [],
  "suspiciousKeywords": []
}`;

// ─── Normalizers ───────────────────────────────────────────────────────────────
function normalizePhone(phone) {
  const digits = phone.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91") && digits.length === 13) return digits;
  if (digits.startsWith("91") && digits.length === 12) return "+" + digits;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return "+91" + digits;
  return digits; // return as-is for non-Indian numbers
}

function normalizeLink(link) {
  return link.trim().replace(/[;,]$/, "").toLowerCase();
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// ─── Main Extraction Function ──────────────────────────────────────────────────
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
    // Scan ALL scammer messages — never miss early-turn intelligence
    const allScammerMessages = conversationHistory
      .filter(m => m.sender === "scammer")
      .map(m => m.text)
      .concat([message])
      .join(" | ");

    // Timeout wrapper
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Extraction timeout")), 8000)
    );

    const llmPromise = groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: `Extract from ALL scammer messages: "${allScammerMessages}"` },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    const response = await Promise.race([llmPromise, timeoutPromise]);
    const aiResult = JSON.parse(response.choices[0].message.content);

    // Canonical key mapping — handles AI typos
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
      aliases.forEach(alias => {
        if (aiResult[alias] && Array.isArray(aiResult[alias])) {
          const cleanValues = aiResult[alias]
            .filter(v => v && typeof v === "string" && v.trim().length > 0);
          extracted[canonical] = [...new Set([...extracted[canonical], ...cleanValues])];
        }
      });
    });

  } catch (err) {
    console.error("AI extraction error:", err.message);
  }

  // Always run regex — catches what AI misses
  const regexExtracted = extractWithRegex(message);
  Object.keys(extracted).forEach(key => {
    if (regexExtracted[key] && regexExtracted[key].length > 0) {
      extracted[key] = [...new Set([...extracted[key], ...regexExtracted[key]])];
    }
  });

  // Normalize all extracted values
  extracted.phoneNumbers = [...new Set(extracted.phoneNumbers.map(normalizePhone))];
  extracted.phishingLinks = [...new Set(extracted.phishingLinks.map(normalizeLink))];
  extracted.emailAddresses = [...new Set(extracted.emailAddresses.map(normalizeEmail))];

  return extracted;
}

// ─── Regex Extraction ──────────────────────────────────────────────────────────
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

  // Phone — broad international format
  const phoneRegex = /\+?\d[\d\s\-().]{7,14}\d/g;
  const phones = text.match(phoneRegex) || [];
  result.phoneNumbers = [...new Set(phones.map(normalizePhone))];

  // UPI IDs
  const upiRegex = /[a-zA-Z0-9._\-+]{2,256}@[a-zA-Z]{2,64}/g;
  const upis = text.match(upiRegex) || [];
  result.upiIds = upis.filter(u => {
    const afterAt = u.split("@")[1] || "";
    const hasCommonTLD = /\.(com|in|org|net|io|co)$/i.test(afterAt);
    const isCommonEmail = /gmail|yahoo|hotmail|outlook|rediff/i.test(afterAt);
    return !hasCommonTLD && !isCommonEmail;
  });

  // Email
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  result.emailAddresses = (text.match(emailRegex) || []).map(normalizeEmail);

  // IFSC
  const ifscRegex = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
  result.ifscCodes = text.match(ifscRegex) || [];

  // Bank accounts — purely numeric 11-18 digits
  const accountRegex = /\b\d{11,18}\b/g;
  const potentialAccounts = text.match(accountRegex) || [];
  result.bankAccounts = potentialAccounts.filter(a => {
    const isPhone = result.phoneNumbers.some(p => p.replace(/\D/g, "").includes(a));
    return /^\d+$/.test(a) && !isPhone;
  });

  // Crypto wallets (bonus)
  const cryptoRegex = /0x[a-fA-F0-9]{40}/g;
  const cryptos = text.match(cryptoRegex) || [];
  if (cryptos.length > 0) result.phishingLinks.push(...cryptos);

  // URLs
  const urlRegex = /https?:\/\/[^\s]+|bit\.ly\/[^\s]+|t\.me\/[^\s]+|wa\.me\/[^\s]+/g;
  const urls = (text.match(urlRegex) || []).map(normalizeLink);
  result.phishingLinks = [...new Set([...result.phishingLinks, ...urls])];

  // Suspicious keywords
  const suspiciousChecks = [
    ["urgent", /urgent/i],
    ["immediately", /immediately/i],
    ["blocked", /block/i],
    ["suspended", /suspend/i],
    ["verify", /verif/i],
    ["OTP", /\bOTP\b/i],
    ["prize", /prize|winner|lottery/i],
    ["refund", /refund/i],
    ["KYC", /\bKYC\b/i],
    ["compromised", /compromis/i],
    ["arrest", /arrest/i],
    ["freeze", /freeze/i],
    ["claim", /\bclaim\b/i],
    ["invest", /invest/i],
    ["guaranteed", /guaranteed/i],
    ["customs", /customs/i],
    ["delivery failed", /delivery failed|package held/i],
    ["gift card", /gift card/i],
    ["crypto", /bitcoin|crypto|wallet/i],
  ];
  result.suspiciousKeywords = suspiciousChecks
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);

  return result;
}

module.exports = { extractIntelligence };