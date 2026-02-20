# 🍯 Honeypot API — AI-Powered Scam Detection & Intelligence Extraction

An autonomous, production-ready honeypot API that detects scams, engages fraudsters in realistic multi-turn conversations, and extracts actionable intelligence — built for the GUVI Hackathon.

---

## 🧠 How It Works

```
Scammer Message → AI Scam Detection → Persona Engine → Intel Extraction → Adaptive Reply
                                                    ↓
                                           Session Memory Update
                                                    ↓
                                     (Threshold met) → Final Callback
```

1. **Scam Detection** — Groq LLM (LLaMA 3.3 70B) classifies message with type + confidence
2. **Persona Engine** — Generates a believable confused Indian victim response to keep scammer engaged
3. **Intelligence Extraction** — AI + Regex extracts phone numbers, UPI IDs, bank accounts, phishing links, emails
4. **Session Memory** — Tracks all extracted data across turns per session
5. **Auto Callback** — Fires final intelligence report when threshold is reached (5+ messages OR intel found)

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **AI Model:** Groq API — `llama-3.3-70b-versatile`
- **HTTP Client:** Axios
- **Security:** Helmet, API key auth
- **Storage:** In-memory (Map) — no database needed

---

## 🚀 Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/honeypot-api.git
cd honeypot-api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
GROQ_API_KEY=your_groq_api_key_here
API_KEY=your_secret_honeypot_api_key
CALLBACK_URL=https://hackathon.guvi.in/api/updateHoneyPotFinalResult
PORT=3000
```

Get your Groq API key free at: https://console.groq.com

### 4. Run the Server

```bash
# Development
npm run dev

# Production
npm start
```

---

## 📡 API Endpoint

| Field | Value |
|-------|-------|
| URL | `https://your-deployed-url.com/honeypot` |
| Method | `POST` |
| Auth | `x-api-key` header |

### Request Format

```json
{
  "sessionId": "uuid-string",
  "message": {
    "sender": "scammer",
    "text": "URGENT: Your SBI account will be blocked. Share OTP immediately.",
    "timestamp": 1769776085000
  },
  "conversationHistory": [],
  "metadata": {
    "channel": "SMS",
    "language": "English",
    "locale": "IN"
  }
}
```

### Response Format

```json
{
  "status": "success",
  "reply": "Oh no... my account? Which branch are you calling from?"
}
```

---

## 🧪 Quick Test (cURL)

```bash
curl -X POST http://localhost:3000/honeypot \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "sessionId": "test-001",
    "message": {
      "sender": "scammer",
      "text": "URGENT: Your SBI account has been compromised. Share OTP immediately to avoid suspension.",
      "timestamp": 1769776085000
    },
    "conversationHistory": [],
    "metadata": {
      "channel": "SMS",
      "language": "English",
      "locale": "IN"
    }
  }'
```

---

## 🧪 Full Test Script

```bash
node test.js
```

---

## ☁️ Deployment

### Deploy on Render (Free)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Set environment variables in Render dashboard
5. Deploy — your URL will be `https://your-app.onrender.com`

### Deploy on Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set env vars in Railway dashboard.

---

## 📊 Scoring Strategy

| Category | Max | Our Approach |
|----------|-----|--------------|
| Scam Detection | 20 pts | AI classifier, always sets `scamDetected: true` when confirmed |
| Intel Extraction | 40 pts | AI + Regex dual-layer extraction across all turns |
| Engagement Quality | 20 pts | Adaptive persona keeps scammer talking 5+ turns |
| Response Structure | 20 pts | Exact JSON format with all required fields |

---

## 🏗️ Project Structure

```
honeypot/
├── server.js                 # Express app entry point
├── routes/
│   └── honeypot.js           # Main orchestration route
├── services/
│   ├── detectionService.js   # AI scam classification
│   ├── personaService.js     # Victim persona response generation
│   ├── extractionService.js  # Intelligence extraction (AI + Regex)
│   └── sessionService.js     # In-memory session management
├── utils/
│   └── callbackService.js    # Final result callback sender
├── test.js                   # Test script
├── .env.example              # Environment variable template
├── package.json
└── README.md
```

---

## 🔒 Security

- All requests require `x-api-key` header
- Helmet.js for HTTP security headers
- No sensitive data in logs
- Environment variables for all secrets

---

## ✅ Acceptable Practices Used

- LLM (Groq/LLaMA) for dynamic conversation and analysis
- Generic regex pattern matching as fallback
- NLP-based intelligence extraction
- In-memory state management for session tracking
- No hardcoded test scenario responses
- Generic detection logic that works for any scam type
