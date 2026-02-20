/**
 * Session Service
 * Manages in-memory session storage for multi-turn conversations.
 */

const sessions = new Map();

/**
 * Get or create a session for a given sessionId
 */
function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      totalMessages: 0,
      scamConfirmed: false,
      scamType: null,
      callbackSent: false,
      upiIds: [],
      phoneNumbers: [],
      phishingLinks: [],
      bankAccounts: [],
      emailAddresses: [],
      ifscCodes: [],
      orgNames: [],
      suspiciousKeywords: [],
      tacticsObserved: [],
      conversationSummary: "",
    });
  }
  return sessions.get(sessionId);
}

/**
 * Update session with new extracted intelligence
 */
function updateSession(sessionId, updates) {
  const session = getOrCreateSession(sessionId);

  // Merge arrays (no duplicates)
  const arrayFields = [
    "upiIds",
    "phoneNumbers",
    "phishingLinks",
    "bankAccounts",
    "emailAddresses",
    "ifscCodes",
    "orgNames",
    "suspiciousKeywords",
    "tacticsObserved",
  ];

  arrayFields.forEach((field) => {
    if (updates[field] && Array.isArray(updates[field])) {
      updates[field].forEach((val) => {
        if (val && !session[field].includes(val)) {
          session[field].push(val);
        }
      });
    }
  });

  // Scalar updates
  if (updates.scamConfirmed !== undefined)
    session.scamConfirmed = updates.scamConfirmed;
  if (updates.scamType) session.scamType = updates.scamType;
  if (updates.callbackSent !== undefined)
    session.callbackSent = updates.callbackSent;
  if (updates.conversationSummary)
    session.conversationSummary = updates.conversationSummary;

  session.totalMessages += 1;
  session.lastUpdated = Date.now();

  sessions.set(sessionId, session);
  return session;
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * Check if callback should be triggered
 * Only fire at end of conversation (8+ messages) to ensure ALL intelligence is captured
 * Firing too early = empty intelligence arrays = lost points
 */
function shouldTriggerCallback(session) {
  if (session.callbackSent) return false;
  if (!session.scamConfirmed) return false;

  // Wait until at least 8 messages exchanged — ensures full conversation data
  // The hackathon runs up to 10 turns so 8+ means we are near the end
  const nearEnd = session.totalMessages >= 8;

  return nearEnd;
}

/**
 * Cleanup old sessions (older than 1 hour) to prevent memory leak
 */
function cleanupSessions() {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastUpdated > ONE_HOUR) {
      sessions.delete(id);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupSessions, 30 * 60 * 1000);

module.exports = {
  getOrCreateSession,
  updateSession,
  getSession,
  shouldTriggerCallback,
};