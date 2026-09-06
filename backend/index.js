const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

/* ============================================================
   CONFIG - must match the frontend App.js exactly
   ============================================================ */

const TEAM_NUMBERS = Array.from({ length: 10 }, (_, i) => i + 1);

// The four "decoded digit" answers. Never sent to any client.
const QUESTIONS = [
  { prompt: "Decoded digit 1?", answer: 8 },
  { prompt: "Decoded digit 2?", answer: 3 },
  { prompt: "Decoded digit 3?", answer: 2 },
  { prompt: "Decoded digit 4?", answer: 4 },
];

// Classic phone keypad letters, digit -> letters
const KEYPAD = {
  2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO",
  7: "PQRS", 8: "TUV", 9: "WXYZ",
};

const FINAL_WORD = "TECH";
const COOLDOWN_MS = 2000;

/* ============================================================
   STATE
   ============================================================ */

function makeTeam(number) {
  return {
    number,
    claimed: false,
    deviceToken: null,
    phase: "idle", // idle | digits | cipher | complete
    digitIndex: 0,
    digitsCorrect: [false, false, false, false],
    cipherPositions: [0, 0, 0, 0], // cycle index into KEYPAD[digit] per slot
    cooldownUntil: 0,
    joinedAt: null,
    completedAt: null,
  };
}

const makeInitialState = () => ({
  teams: TEAM_NUMBERS.map(makeTeam),
});

/* ============================================================
   PURE REDUCER, returns { state, result }
   Identical to the copy in frontend App.js
   ============================================================ */

function gameReducer(state, action) {
  switch (action.type) {
    case "CLAIM_TEAM": {
      const { teamNumber, deviceToken } = action;
      const idx = state.teams.findIndex((t) => t.number === teamNumber);
      if (idx === -1 || !deviceToken) return { state, result: { kind: "invalid" } };
      const team = state.teams[idx];

      if (team.claimed) {
        if (team.deviceToken === deviceToken) {
          return { state, result: { kind: "joined", teamNumber } }; // reconnect
        }
        return { state, result: { kind: "team-taken" } };
      }

      const teams = state.teams.map((t, i) =>
        i === idx
          ? { ...t, claimed: true, deviceToken, phase: "digits", joinedAt: Date.now() }
          : t
      );
      return { state: { ...state, teams }, result: { kind: "joined", teamNumber } };
    }

    case "SUBMIT_DIGIT": {
      const { teamNumber, deviceToken, value } = action;
      const idx = state.teams.findIndex((t) => t.number === teamNumber);
      if (idx === -1) return { state, result: null };
      const team = state.teams[idx];
      if (!team.claimed || team.deviceToken !== deviceToken) return { state, result: null };
      if (team.phase !== "digits") return { state, result: { kind: "already-past" } };

      const now = Date.now();
      if (now < team.cooldownUntil) return { state, result: { kind: "cooldown", until: team.cooldownUntil } };

      const q = QUESTIONS[team.digitIndex];
      if (Number(value) === q.answer) {
        const digitsCorrect = team.digitsCorrect.map((v, i) => (i === team.digitIndex ? true : v));
        const nextIndex = team.digitIndex + 1;
        const nextPhase = nextIndex >= QUESTIONS.length ? "cipher" : "digits";
        const teams = state.teams.map((t, i) =>
          i === idx ? { ...t, digitsCorrect, digitIndex: nextIndex, phase: nextPhase } : t
        );
        return { state: { ...state, teams }, result: { kind: "correct" } };
      }

      const teams = state.teams.map((t, i) =>
        i === idx ? { ...t, cooldownUntil: now + COOLDOWN_MS } : t
      );
      return { state: { ...state, teams }, result: { kind: "wrong" } };
    }

    case "CYCLE_LETTER": {
      const { teamNumber, deviceToken, slotIndex } = action;
      const idx = state.teams.findIndex((t) => t.number === teamNumber);
      if (idx === -1) return { state, result: null };
      const team = state.teams[idx];
      if (!team.claimed || team.deviceToken !== deviceToken) return { state, result: null };
      if (team.phase !== "cipher") return { state, result: null };
      if (slotIndex < 0 || slotIndex >= QUESTIONS.length) return { state, result: null };

      const digit = QUESTIONS[slotIndex].answer;
      const letters = KEYPAD[digit] || "";
      if (!letters.length) return { state, result: null };

      const cipherPositions = team.cipherPositions.map((v, i) =>
        i === slotIndex ? (v + 1) % letters.length : v
      );
      const teams = state.teams.map((t, i) => (i === idx ? { ...t, cipherPositions } : t));
      return { state: { ...state, teams }, result: null };
    }

    case "SUBMIT_CIPHER": {
      const { teamNumber, deviceToken } = action;
      const idx = state.teams.findIndex((t) => t.number === teamNumber);
      if (idx === -1) return { state, result: null };
      const team = state.teams[idx];
      if (!team.claimed || team.deviceToken !== deviceToken) return { state, result: null };
      if (team.phase !== "cipher") return { state, result: null };

      const now = Date.now();
      if (now < team.cooldownUntil) return { state, result: { kind: "cooldown", until: team.cooldownUntil } };

      const word = QUESTIONS.map((q, i) => {
        const letters = KEYPAD[q.answer] || "";
        return letters[team.cipherPositions[i] % letters.length] || "";
      }).join("");

      if (word.toUpperCase() === FINAL_WORD) {
        const teams = state.teams.map((t, i) =>
          i === idx ? { ...t, phase: "complete", completedAt: now } : t
        );
        return { state: { ...state, teams }, result: { kind: "complete" } };
      }

      const teams = state.teams.map((t, i) =>
        i === idx ? { ...t, cooldownUntil: now + COOLDOWN_MS } : t
      );
      return { state: { ...state, teams }, result: { kind: "wrong-cipher" } };
    }

    case "RESET_TEAM": {
      const { teamNumber } = action;
      const idx = state.teams.findIndex((t) => t.number === teamNumber);
      if (idx === -1) return { state, result: null };
      const teams = state.teams.map((t, i) => (i === idx ? makeTeam(teamNumber) : t));
      return { state: { ...state, teams }, result: null };
    }

    case "RESET_ALL":
      return { state: makeInitialState(), result: null };

    default:
      return { state, result: null };
  }
}

/* ============================================================
   REDACTION
   Participants never see answers, other teams' data, or tokens.
   Dashboard never sees answers, cipher progress, or tokens.
   ============================================================ */

function snapshotFor(state, role, teamNumber) {
  if (role === "participant") {
    const team = state.teams.find((t) => t.number === teamNumber);
    if (!team) return { team: null, totalQuestions: QUESTIONS.length, prompts: QUESTIONS.map((q) => q.prompt) };
    return {
      team: {
        number: team.number,
        phase: team.phase,
        digitIndex: team.digitIndex,
        digitsCorrect: team.digitsCorrect,
        cipherPositions: team.cipherPositions,
        cooldownUntil: team.cooldownUntil,
        joinedAt: team.joinedAt,
        completedAt: team.completedAt,
      },
      totalQuestions: QUESTIONS.length,
      prompts: QUESTIONS.map((q) => q.prompt),
      keypadDigits: QUESTIONS.map((q) => q.answer),
    };
  }
  if (role === "dashboard") {
    return {
      teams: state.teams.map((t) => ({
        number: t.number,
        claimed: t.claimed,
        phase: t.phase,
        digitIndex: t.digitIndex,
        joinedAt: t.joinedAt,
        completedAt: t.completedAt,
      })),
      totalQuestions: QUESTIONS.length,
    };
  }
  return null;
}

/* ============================================================
   SERVER - one in-memory session for the whole room
   ============================================================ */

let state = makeInitialState();

const app = express();
app.use(cors());
app.get("/", (_req, res) => res.send("Digital Treasure Heist backend is running."));
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    claimed: state.teams.filter((t) => t.claimed).length,
    complete: state.teams.filter((t) => t.phase === "complete").length,
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
  const { role = "participant", teamNumber = null } = socket.data || {};
  socket.emit("state:update", snapshotFor(state, role, teamNumber));
}

function broadcast() {
  for (const [, socket] of io.sockets.sockets) sendTo(socket);
}

io.on("connection", (socket) => {
  socket.data = { role: "participant", teamNumber: null, deviceToken: null };

  socket.on("identify", (payload = {}) => {
    const role = payload.role === "dashboard" ? "dashboard" : "participant";
    const teamNumber =
      typeof payload.teamNumber === "number" && payload.teamNumber >= 1 && payload.teamNumber <= 10
        ? payload.teamNumber
        : null;
    socket.data = { role, teamNumber, deviceToken: payload.deviceToken || null };
    sendTo(socket);
  });

  socket.on("state:request", () => sendTo(socket));

  socket.on("action", (action = {}) => {
    try {
      let safeAction = action;

      // A claim carries its own team number - the socket may not have been
      // re-identified yet at this point, so trusting socket.data here would
      // overwrite the picked team with null and fail the claim.
      if (action.type === "CLAIM_TEAM") {
        const teamNumber = Number(action.teamNumber);
        const deviceToken = action.deviceToken || socket.data.deviceToken;
        safeAction = { ...action, teamNumber, deviceToken };
        socket.data = { ...socket.data, teamNumber, deviceToken };
      } else if (
        socket.data.role === "participant" &&
        action.type !== "RESET_ALL" &&
        action.type !== "RESET_TEAM"
      ) {
        // every other participant action is pinned to the identified team
        safeAction = {
          ...action,
          teamNumber: socket.data.teamNumber,
          deviceToken: socket.data.deviceToken,
        };
      }

      // only the dashboard may reset
      if (
        (action.type === "RESET_TEAM" || action.type === "RESET_ALL") &&
        socket.data.role !== "dashboard"
      ) {
        return;
      }

      const { state: next, result } = gameReducer(state, safeAction);
      const changed = next !== state;
      state = next;
      if (result) socket.emit("action:result", result);
      if (changed) broadcast();
      else sendTo(socket);
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
  const teams = state.teams.map((t) => {
    if (t.cooldownUntil && t.cooldownUntil < now) {
      dirty = true;
      return { ...t, cooldownUntil: 0 };
    }
    return t;
  });
  if (dirty) {
    state = { ...state, teams };
    broadcast();
  }
}, 5000);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log("Digital Treasure Heist backend listening on port " + PORT);
});