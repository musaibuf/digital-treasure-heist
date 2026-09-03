const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

/* ============================================================
   CONFIG - must match the frontend App.js exactly
   ============================================================ */

const TEAMS = [
  { name: "Aldebaran", colour: "#D94A2B", gem: "Carnelian" },
  { name: "Vega", colour: "#2E7DD1", gem: "Sapphire" },
  { name: "Altair", colour: "#12A37B", gem: "Emerald" },
  { name: "Deneb", colour: "#8B5CF6", gem: "Amethyst" },
  { name: "Rigel", colour: "#E08A1E", gem: "Topaz" },
  { name: "Antares", colour: "#B4243B", gem: "Ruby" },
  { name: "Mizar", colour: "#1FA5B8", gem: "Aquamarine" },
  { name: "Fomalhaut", colour: "#D4A017", gem: "Citrine" },
  { name: "Alnilam", colour: "#D9628C", gem: "Rose Quartz" },
  { name: "Algol", colour: "#4C56C0", gem: "Lapis" },
].map((t, i) => ({ ...t, id: i, tableNumber: i + 1 }));

const VALUES = [
  { icon: "Shield", text: "Integrity guides every decision we make." },
  { icon: "Star", text: "Excellence is the standard, not the exception." },
  { icon: "Users", text: "Teamwork turns individual effort into shared wins." },
  { icon: "Lightbulb", text: "Innovation means questioning how things have always been done." },
  { icon: "Heart", text: "Empathy comes before judgment." },
  { icon: "CheckCircle2", text: "Accountability means owning outcomes, not excuses." },
  { icon: "Flame", text: "Passion is what makes good work great." },
  { icon: "TrendingUp", text: "Growth is a daily practice, not a milestone." },
  { icon: "Smile", text: "Positivity is contagious, so choose to spread it." },
  { icon: "Award", text: "Recognition should be given as freely as it is earned." },
  { icon: "Compass", text: "Purpose keeps us pointed in the right direction." },
  { icon: "Mountain", text: "Resilience is built one setback at a time." },
  { icon: "Gift", text: "Generosity costs little and returns a lot." },
  { icon: "MessageCircle", text: "Honest conversations build trust faster than comfortable silence." },
  { icon: "Trophy", text: "Ambition without collaboration is just noise." },
  { icon: "Layers", text: "Diversity of thought makes better decisions." },
  { icon: "Sparkles", text: "Curiosity is the beginning of every good idea." },
];

const ROCKET_SLOTS = [3, 8, 13];
const CODE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const COOLDOWN_MS = 8000;

const isRocketSlot = (slot) => ROCKET_SLOTS.includes(slot);

function randomCode() {
  let c = "";
  for (let i = 0; i < 4; i++) c += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  return c;
}

function buildPieces() {
  let cursor = 0;
  const pieces = [];
  const used = new Set();
  for (let slot = 1; slot <= 20; slot++) {
    const ownerIdx = (slot - 1) % 10;
    const rocket = isRocketSlot(slot);
    const value = rocket ? null : VALUES[cursor++];
    let code = randomCode();
    while (used.has(code)) code = randomCode(); // codes are the match key, keep them unique
    used.add(code);
    pieces.push({
      slot,
      ownerIdx,
      holderIdx: (ownerIdx + 3) % 10,
      decoderIdx: (ownerIdx + 7) % 10,
      rocket,
      icon: value ? value.icon : "Rocket",
      valueText: value ? value.text : null,
      code,
      placed: false,
      placedAt: null,
      hintCode: false,
      hintSlot: false,
    });
  }
  return pieces;
}

const makeInitialState = () => ({
  sessionState: "idle", // idle | act1 | act2 | complete
  startedAt: null,
  completedAt: null,
  pieces: buildPieces(),
  cooldowns: {},
});

/* ============================================================
   PURE REDUCER, returns { state, result }
   Identical to the copy in frontend App.js
   ============================================================ */

const nonRocketPlaced = (pieces) => pieces.filter((p) => !p.rocket && p.placed).length;
const rocketsUnlocked = (s) => s.sessionState === "act2" || s.sessionState === "complete";

function gameReducer(state, action) {
  switch (action.type) {
    case "START_SESSION": {
      if (state.sessionState !== "idle") return { state, result: null };
      return {
        state: { ...makeInitialState(), sessionState: "act1", startedAt: Date.now() },
        result: null,
      };
    }
    case "RESET_SESSION":
      return { state: makeInitialState(), result: null };

    case "FORCE_ACT2": {
      if (state.sessionState !== "act1") return { state, result: null };
      return { state: { ...state, sessionState: "act2" }, result: null };
    }

    case "SUBMIT_PIECE": {
      const { teamIdx } = action;
      const now = Date.now();

      if (typeof teamIdx !== "number" || teamIdx < 0 || teamIdx > 9) {
        return { state, result: null };
      }
      if (state.sessionState === "idle") {
        return { state, result: { kind: "not-started" } };
      }

      const cooling = state.cooldowns[teamIdx] || 0;
      if (now < cooling) return { state, result: { kind: "cooldown", until: cooling } };

      const code = String(action.code || "").trim().toUpperCase();
      const slotNumber = Number(action.slotNumber);
      const owned = state.pieces.filter((p) => p.ownerIdx === teamIdx);
      const match = owned.find((p) => p.code === code);

      if (!match) {
        return {
          state: { ...state, cooldowns: { ...state.cooldowns, [teamIdx]: now + COOLDOWN_MS } },
          result: { kind: "wrong-code", until: now + COOLDOWN_MS },
        };
      }
      // second teammate tapping at the same moment: no-op, never an error
      if (match.placed) return { state, result: { kind: "already" } };

      if (match.rocket && !rocketsUnlocked(state)) {
        return { state, result: { kind: "locked" } };
      }
      if (slotNumber !== match.slot) {
        return {
          state: { ...state, cooldowns: { ...state.cooldowns, [teamIdx]: now + COOLDOWN_MS } },
          result: { kind: "wrong-slot", until: now + COOLDOWN_MS },
        };
      }

      const pieces = state.pieces.map((p) =>
        p.slot === match.slot ? { ...p, placed: true, placedAt: now } : p
      );

      let sessionState = state.sessionState;
      let completedAt = state.completedAt;
      if (sessionState === "act1" && nonRocketPlaced(pieces) === 17) sessionState = "act2";
      if (pieces.every((p) => p.placed)) {
        sessionState = "complete";
        completedAt = now;
      }

      return {
        state: { ...state, pieces, sessionState, completedAt },
        result: { kind: "placed", slot: match.slot },
      };
    }

    case "HINT": {
      const { slot, field } = action;
      const pieces = state.pieces.map((p) =>
        p.slot === slot
          ? {
              ...p,
              hintCode: field === "code" ? true : p.hintCode,
              hintSlot: field === "slot" ? true : p.hintSlot,
            }
          : p
      );
      return { state: { ...state, pieces }, result: null };
    }

    case "CLEAR_COOLDOWN":
      return {
        state: { ...state, cooldowns: { ...state.cooldowns, [action.teamIdx]: 0 } },
        result: null,
      };

    default:
      return { state, result: null };
  }
}

/* ============================================================
   REDACTION
   A participant phone must never receive its own piece codes.
   ============================================================ */

function snapshotFor(state, role, teamIdx) {
  if (role !== "participant" || teamIdx === null || teamIdx === undefined) return state;
  const pieces = state.pieces.map((p) => {
    const isHolder = p.holderIdx === teamIdx;
    const isDecoder = p.decoderIdx === teamIdx;
    const isOwner = p.ownerIdx === teamIdx;
    return {
      slot: p.slot,
      ownerIdx: p.ownerIdx,
      holderIdx: p.holderIdx,
      decoderIdx: p.decoderIdx,
      rocket: p.rocket,
      placed: p.placed,
      placedAt: p.placedAt,
      icon: p.placed || isHolder || isDecoder ? p.icon : null,
      valueText: p.placed ? p.valueText : null,
      code: isHolder || (isOwner && p.hintCode) ? p.code : null,
      hintCode: isOwner ? p.hintCode : false,
      hintSlot: isOwner ? p.hintSlot : false,
      hintedSlot: isOwner && p.hintSlot ? p.slot : null,
    };
  });
  return { ...state, pieces, cooldownUntil: state.cooldowns[teamIdx] || 0 };
}

/* ============================================================
   SERVER - one in-memory session for the whole room
   ============================================================ */

let state = makeInitialState();

const app = express();
app.use(cors());
app.get("/", (_req, res) => res.send("Cross-Team Jigsaw backend is running."));
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    sessionState: state.sessionState,
    placed: state.pieces.filter((p) => p.placed).length,
    clients: io ? io.engine.clientsCount : 0,
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 20000,
  pingTimeout: 25000,
});

function sendTo(socket) {
  const { role = "participant", teamIdx = null } = socket.data || {};
  socket.emit("state:update", snapshotFor(state, role, teamIdx));
}

function broadcast() {
  for (const [, socket] of io.sockets.sockets) sendTo(socket);
}

io.on("connection", (socket) => {
  socket.data = { role: "participant", teamIdx: null };

  socket.on("identify", (payload = {}) => {
    const role = ["projector", "facilitator", "participant"].includes(payload.role)
      ? payload.role
      : "participant";
    const teamIdx =
      typeof payload.teamIdx === "number" && payload.teamIdx >= 0 && payload.teamIdx <= 9
        ? payload.teamIdx
        : null;
    socket.data = { role, teamIdx };
    sendTo(socket);
  });

  socket.on("state:request", () => sendTo(socket));

  socket.on("action", (action = {}) => {
    try {
      // a participant socket can only ever act as its own team
      const safeAction =
        action.type === "SUBMIT_PIECE" && socket.data.role === "participant"
          ? { ...action, teamIdx: socket.data.teamIdx }
          : action;

      const { state: next, result } = gameReducer(state, safeAction);
      const changed = next !== state;
      state = next;
      if (result) socket.emit("action:result", result);
      if (changed) broadcast();
    } catch (err) {
      console.error("Bad action", action, err);
    }
  });

  sendTo(socket);
});

// clear expired cooldowns so a stale lockout never survives a long session
setInterval(() => {
  const now = Date.now();
  let dirty = false;
  for (const k of Object.keys(state.cooldowns)) {
    if (state.cooldowns[k] && state.cooldowns[k] < now) {
      state.cooldowns[k] = 0;
      dirty = true;
    }
  }
  if (dirty) broadcast();
}, 5000);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log("Cross-Team Jigsaw backend listening on port " + PORT);
});