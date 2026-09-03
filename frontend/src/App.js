import React, { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import {
  Shield, Star, Users, Lightbulb, Heart, CheckCircle2, Flame, TrendingUp,
  Smile, Award, Compass, Mountain, Gift, MessageCircle, Trophy, Layers,
  Sparkles, Rocket, Lock, Radio, Inbox, BookOpen, Clock, Hash, KeyRound,
  MapPin, Wifi, WifiOff, Zap, Gem, RotateCcw, FastForward, AlertTriangle,
} from "lucide-react";

/* ============================================================
   CARNELIAN THEME + CONFIG
   Keep TEAMS, VALUES, ROCKET_SLOTS identical to backend index.js
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

const ICONS = {
  Shield, Star, Users, Lightbulb, Heart, CheckCircle2, Flame, TrendingUp,
  Smile, Award, Compass, Mountain, Gift, MessageCircle, Trophy, Layers, Sparkles,
};

// 17 non-rocket pieces, consumed in ascending slot order (1-20 excluding 3, 8, 13)
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
const COOLDOWN_MS = 8000; // anti guess lockout after a wrong entry
const ZOOM_MS = 6000;

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
    while (used.has(code)) code = randomCode(); // codes must be unique, we match on them
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
   Mirror of the copy in backend index.js
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

      if (state.sessionState === "idle") {
        return { state, result: { kind: "not-started" } };
      }

      const cooling = state.cooldowns[teamIdx] || 0;
      if (now < cooling) {
        return { state, result: { kind: "cooldown", until: cooling } };
      }

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
      // Two teammates tapping at once: the second one is a silent no-op, never an error
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
      const { slot, field } = action; // field: "code" | "slot"
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
   A participant must never receive their own piece codes.
   The same function runs on the server before every emit.
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
   SHARED STATE HOOK
   Socket.io backend when REACT_APP_SERVER_URL is set.
   Otherwise the same reducer locally, synced across tabs.
   ============================================================ */

function useSharedGame({ role, teamIdx, onResult }) {
  const [rawState, setRawState] = useState(makeInitialState);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const channelRef = useRef(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const serverUrl = process.env.REACT_APP_SERVER_URL;
  const useSocket = Boolean(serverUrl);

  useEffect(() => {
    if (!useSocket) {
      setConnected(true);
      try {
        const saved = localStorage.getItem("jigsaw-state");
        if (saved) setRawState(JSON.parse(saved));
      } catch (e) {
        /* ignore */
      }
      const channel = new BroadcastChannel("jigsaw-demo");
      channelRef.current = channel;
      channel.onmessage = (e) => setRawState(e.data);
      return () => channel.close();
    }

    // default transports let socket.io fall back to polling on bad venue wifi
    const socket = io(serverUrl, { reconnection: true, reconnectionDelay: 800 });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("identify", { role, teamIdx });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("state:update", (snap) => setRawState(snap));
    socket.on("action:result", (res) => resultRef.current && resultRef.current(res));
    const poll = setInterval(() => socket.connected && socket.emit("state:request"), 5000);
    return () => {
      clearInterval(poll);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSocket, serverUrl]);

  // re-identify when the team is chosen after connecting
  useEffect(() => {
    if (useSocket && socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("identify", { role, teamIdx });
    }
  }, [useSocket, role, teamIdx]);

  const dispatch = useCallback(
    (action) => {
      if (useSocket) {
        if (socketRef.current) socketRef.current.emit("action", action);
        return;
      }
      setRawState((prev) => {
        const { state: next, result } = gameReducer(prev, action);
        try {
          localStorage.setItem("jigsaw-state", JSON.stringify(next));
        } catch (e) {
          /* ignore */
        }
        if (channelRef.current) channelRef.current.postMessage(next);
        if (result && resultRef.current) resultRef.current(result);
        return next;
      });
    },
    [useSocket]
  );

  // in demo mode redact locally so the UI behaves exactly like production
  const state = useSocket ? rawState : snapshotFor(rawState, role, teamIdx);

  return {
    state,
    connected,
    useSocket,
    startSession: useCallback(() => dispatch({ type: "START_SESSION" }), [dispatch]),
    resetSession: useCallback(() => dispatch({ type: "RESET_SESSION" }), [dispatch]),
    forceAct2: useCallback(() => dispatch({ type: "FORCE_ACT2" }), [dispatch]),
    submitPiece: useCallback(
      (tIdx, code, slotNumber) =>
        dispatch({ type: "SUBMIT_PIECE", teamIdx: tIdx, code, slotNumber }),
      [dispatch]
    ),
    giveHint: useCallback((slot, field) => dispatch({ type: "HINT", slot, field }), [dispatch]),
  };
}

/* ============================================================
   SELECTORS
   ============================================================ */

const teamPlaced = (state, idx) => state.pieces.filter((p) => p.ownerIdx === idx && p.placed).length;
const totalPlaced = (state) => state.pieces.filter((p) => p.placed).length;

function getTeamView(state, teamIdx) {
  return {
    owned: state.pieces.filter((p) => p.ownerIdx === teamIdx),
    holding: state.pieces
      .filter((p) => p.holderIdx === teamIdx)
      .map((p) => ({ key: p.slot, icon: p.icon, code: p.code, owner: TEAMS[p.ownerIdx] })),
    legend: state.pieces
      .filter((p) => p.decoderIdx === teamIdx)
      .map((p) => ({ key: p.slot, icon: p.icon, slot: p.slot, owner: TEAMS[p.ownerIdx] })),
  };
}

/* ============================================================
   ATOMS
   ============================================================ */

function IconFor({ name, ...rest }) {
  if (!name) return <Gem {...rest} />;
  const Comp = name === "Rocket" ? Rocket : ICONS[name] || Gem;
  return <Comp {...rest} />;
}

function EmberField() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let embers = [];
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function seed() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(110, Math.floor((w * h) / 16000));
      embers = new Array(count).fill(0).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.8 + 0.4,
        vy: -(Math.random() * 0.22 + 0.05),
        drift: (Math.random() - 0.5) * 0.14,
        hue: 12 + Math.random() * 30,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.02 + 0.006,
      }));
    }
    seed();
    window.addEventListener("resize", seed);

    let t = 0;
    let running = true;
    function tick() {
      if (!running) return;
      t += 1;
      ctx.clearRect(0, 0, w, h);
      for (const e of embers) {
        e.y += e.vy;
        e.x += e.drift + Math.sin(t * e.speed + e.phase) * 0.18;
        if (e.y < -10) {
          e.y = h + 10;
          e.x = Math.random() * w;
        }
        const glow = 0.35 + 0.45 * Math.sin(t * e.speed + e.phase);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(" + e.hue + ", 88%, 62%, " + (0.18 + 0.4 * glow) + ")";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "hsla(" + e.hue + ", 90%, 55%, 0.55)";
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    }
    tick();

    // pause when the tab is hidden so a 30 minute run never drifts
    const onVis = () => {
      running = !document.hidden;
      if (running) raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", seed);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return <canvas ref={ref} className="emberfield" aria-hidden="true" />;
}

function Backdrop() {
  return (
    <>
      <div className="veil" aria-hidden="true" />
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />
      <div className="glow glow-c" aria-hidden="true" />
      <EmberField />
      <div className="grain" aria-hidden="true" />
    </>
  );
}

function ConnectionBadge({ connected, useSocket }) {
  return (
    <div className={"conn-badge " + (connected ? "ok" : "bad")}>
      {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
      <span>{useSocket ? (connected ? "Live" : "Reconnecting") : "Demo mode"}</span>
    </div>
  );
}

const TOAST_COPY = {
  placed: { text: "Piece placed. Read your value out to the room.", tone: "good" },
  "wrong-code": { text: "That code is not right. Check with the team holding it.", tone: "bad" },
  "wrong-slot": { text: "That slot number is not right. Check with the team decoding it.", tone: "bad" },
  locked: { text: "This one stays locked until the rest of the board is done.", tone: "warn" },
  cooldown: { text: "Hold on a moment before trying again.", tone: "warn" },
  "not-started": { text: "The facilitator has not started the session yet.", tone: "warn" },
};

function Toast({ toast, onClear }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClear, 3600);
    return () => clearTimeout(t);
  }, [toast, onClear]);
  const copy = toast ? TOAST_COPY[toast.kind] : null;
  return (
    <AnimatePresence>
      {copy && (
        <motion.div
          key={toast.id}
          initial={{ y: -60, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className={"toast toast-" + copy.tone}
        >
          {copy.tone === "bad" ? (
            <AlertTriangle size={16} />
          ) : copy.tone === "warn" ? (
            <Lock size={16} />
          ) : (
            <Sparkles size={16} />
          )}
          <span>{copy.text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useTicker(ms = 1000) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(i);
  }, [ms]);
}

function RoomClock({ startedAt, completedAt, sessionState }) {
  useTicker(1000);
  if (!startedAt || sessionState === "idle") return <div className="room-clock">00:00</div>;
  const end = completedAt || Date.now();
  const elapsed = Math.max(0, Math.floor((end - startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className={"room-clock " + (completedAt ? "stopped" : "")}>
      <Clock size={18} />
      <span>
        {mm}:{ss}
      </span>
    </div>
  );
}

function ProgressRing({ value, max, colour, size = 34 }) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const pct = max ? value / max : 0;
  return (
    <svg width={size} height={size} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c - c * pct }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}
      />
    </svg>
  );
}

/* ============================================================
   JOIN
   ============================================================ */

function JoinScreen({ onPick }) {
  return (
    <div className="screen join-screen">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="join-head"
      >
        <span className="eyebrow">
          <Gem size={13} /> Carnelian
        </span>
        <h1 className="brand-title">Cross-Team Jigsaw</h1>
        <p className="brand-sub">Choose your constellation to begin</p>
      </motion.div>

      <div className="team-grid">
        {TEAMS.map((t, i) => (
          <motion.button
            key={t.id}
            className="team-pick"
            style={{ "--tc": t.colour }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, type: "spring", stiffness: 220, damping: 22 }}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onPick(t.id)}
          >
            <span className="facet-chip">
              <Gem size={18} />
            </span>
            <span className="team-pick-name">{t.name}</span>
            <span className="team-pick-meta">
              {t.gem} - Table {t.tableNumber}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   PARTICIPANT
   ============================================================ */

function CodeInput({ value, onChange }) {
  const refs = useRef([]);
  const chars = (value + "    ").slice(0, 4).split("");

  const setChar = (i, ch) => {
    const next = chars
      .map((c, idx) => (idx === i ? ch : c))
      .join("")
      .replace(/\s+$/, "");
    onChange(next.toUpperCase());
    if (ch.trim() && i < 3 && refs.current[i + 1]) refs.current[i + 1].focus();
  };

  return (
    <div className="code-input">
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={chars[i].trim()}
          maxLength={1}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          onChange={(e) => setChar(i, e.target.value.slice(-1) || " ")}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !chars[i].trim() && i > 0 && refs.current[i - 1]) {
              refs.current[i - 1].focus();
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const t = (e.clipboardData.getData("text") || "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "")
              .slice(0, 4);
            if (t) {
              onChange(t);
              const target = refs.current[Math.min(t.length, 3)];
              if (target) target.focus();
            }
          }}
        />
      ))}
    </div>
  );
}

function OurBoardTab({ view, state, teamIdx, onSubmit }) {
  const [code, setCode] = useState("");
  const [slotNumber, setSlotNumber] = useState("");
  useTicker(1000);

  const team = TEAMS[teamIdx];
  const placed = view.owned.filter((p) => p.placed);
  const remaining = view.owned.filter((p) => !p.placed);
  const hints = view.owned.filter((p) => p.hintCode || p.hintSlot);
  const cooling = Math.max(0, Math.ceil(((state.cooldownUntil || 0) - Date.now()) / 1000));
  const allDone = remaining.length === 0;

  const submit = () => {
    if (code.length < 4 || !slotNumber) return;
    onSubmit(code, slotNumber);
    setCode("");
    setSlotNumber("");
  };

  return (
    <div className="tab-panel">
      <div className="medallion-row">
        {view.owned.map((p, i) => (
          <motion.div
            key={p.slot}
            className={"medallion " + (p.placed ? "lit" : "")}
            style={{ "--tc": team.colour }}
            animate={p.placed ? { rotateY: [90, 0], scale: [0.8, 1] } : {}}
            transition={{ duration: 0.6 }}
          >
            {p.placed ? (
              <>
                <IconFor name={p.icon} size={30} />
                <span className="medallion-slot">Slot {p.slot}</span>
              </>
            ) : (
              <>
                <Gem size={26} className="medallion-dim" />
                <span className="medallion-slot">Piece {i + 1}</span>
              </>
            )}
          </motion.div>
        ))}
      </div>

      {allDone ? (
        <div className="done-panel">
          <CheckCircle2 size={30} />
          <h3>Both pieces placed</h3>
          <p>Stay in the room. Other teams still need you for their codes and slot numbers.</p>
        </div>
      ) : (
        <div className="gem-card submit-card">
          <div className="card-head">
            <h3>Place a piece</h3>
            <span className="count-chip">{placed.length}/2 done</span>
          </div>
          <p className="hint-copy">
            Get the 4 character code from the team holding your piece, and the slot number from the team
            that decodes its icon. You need both before this will accept anything.
          </p>

          {hints.map((p) => (
            <div key={p.slot} className="hint-banner">
              <Zap size={14} />
              <span>
                Facilitator hint:
                {p.hintCode && (
                  <>
                    {" "}
                    code <b>{p.code}</b>
                  </>
                )}
                {p.hintCode && p.hintSlot && " and"}
                {p.hintSlot && (
                  <>
                    {" "}
                    slot <b>{p.hintedSlot}</b>
                  </>
                )}
              </span>
            </div>
          ))}

          <label className="field-label">
            <KeyRound size={13} /> Transfer code
          </label>
          <CodeInput value={code} onChange={setCode} />

          <label className="field-label">
            <Hash size={13} /> Slot number
          </label>
          <input
            className="slot-input"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="1 - 20"
            value={slotNumber}
            onChange={(e) => setSlotNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
          />

          <button
            className="place-btn"
            onClick={submit}
            disabled={cooling > 0 || code.length < 4 || !slotNumber}
          >
            {cooling > 0 ? "Locked for " + cooling + "s" : "Place piece"}
          </button>
          {cooling > 0 && (
            <p className="cooldown-note">Wrong entries pause your team briefly. Go and check again.</p>
          )}
        </div>
      )}
    </div>
  );
}

function HoldingTab({ holding }) {
  return (
    <div className="tab-panel">
      <p className="tab-intro">
        Other teams will come to you for these. Read the code out loud, do not hand your phone over.
      </p>
      {holding.map((h, i) => (
        <motion.div
          key={h.key}
          className="frag-card"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          style={{ "--tc": h.owner.colour }}
        >
          <span className="frag-icon">
            <IconFor name={h.icon} size={24} />
          </span>
          <div className="frag-body">
            <div className="frag-code">{h.code}</div>
            <div className="frag-meta">
              <span className="frag-owner">{h.owner.name}</span>
              <span className="frag-table">
                <MapPin size={11} /> Table {h.owner.tableNumber}
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function LegendTab({ legend }) {
  return (
    <div className="tab-panel">
      <p className="tab-intro">This maps an icon to its slot on the board. Only your team has these.</p>
      {legend.map((l, i) => (
        <motion.div
          key={l.key}
          className="frag-card"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          style={{ "--tc": l.owner.colour }}
        >
          <span className="frag-icon">
            <IconFor name={l.icon} size={24} />
          </span>
          <div className="frag-body">
            <div className="frag-code">Slot {l.slot}</div>
            <div className="frag-meta">
              <span className="frag-owner">{l.owner.name}</span>
              <span className="frag-table">
                <MapPin size={11} /> Table {l.owner.tableNumber}
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ParticipantApp({ teamIdx, state, submitPiece, onLeave }) {
  const team = TEAMS[teamIdx];
  const [tab, setTab] = useState("board");
  const view = getTeamView(state, teamIdx);
  const placed = teamPlaced(state, teamIdx);

  const actLabel =
    state.sessionState === "idle"
      ? "Waiting to start"
      : state.sessionState === "act1"
      ? "Act One"
      : state.sessionState === "act2"
      ? "Act Two"
      : "Complete";

  return (
    <div className="screen participant-screen" style={{ "--tc": team.colour }}>
      <header className="p-header">
        <button className="p-identity" onClick={onLeave} title="Change team">
          <span className="facet-chip sm">
            <Gem size={15} />
          </span>
          <span>
            <span className="p-team">{team.name}</span>
            <span className="p-table">
              <MapPin size={11} /> Table {team.tableNumber}
            </span>
          </span>
        </button>
        <div className="p-progress">
          <ProgressRing value={placed} max={2} colour={team.colour} />
          <span className="p-act">{actLabel}</span>
        </div>
      </header>

      <nav className="tabs">
        {[
          { id: "board", label: "Our board", Icon: Layers },
          { id: "holding", label: "We hold", Icon: Inbox },
          { id: "legend", label: "Our legend", Icon: BookOpen },
        ].map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={16} />
            <span>{label}</span>
            {tab === id && <motion.span layoutId="tab-underline" className="tab-underline" />}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "board" && (
            <OurBoardTab
              view={view}
              state={state}
              teamIdx={teamIdx}
              onSubmit={(code, slot) => submitPiece(teamIdx, code, slot)}
            />
          )}
          {tab === "holding" && <HoldingTab holding={view.holding} />}
          {tab === "legend" && <LegendTab legend={view.legend} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
   PROJECTOR
   ============================================================ */

function BoardSlot({ piece, unlocked }) {
  const team = TEAMS[piece.ownerIdx];
  const locked = piece.rocket && !unlocked;
  return (
    <motion.div
      className={
        "slot " +
        (piece.placed ? "placed " : "") +
        (locked ? "locked " : "") +
        (piece.rocket ? "rocket" : "")
      }
      style={{ "--tc": team.colour }}
      initial={false}
      animate={piece.placed ? { rotateY: [90, 0], scale: [0.86, 1.04, 1] } : {}}
      transition={{ duration: 0.75, ease: "easeOut" }}
    >
      <span className="slot-facets" />
      {piece.placed ? (
        <>
          <span className="slot-sheen" />
          <IconFor name={piece.icon} className="slot-icon" />
          <span className="slot-tag">{piece.slot}</span>
        </>
      ) : (
        <>
          <span className="slot-number">{piece.slot}</span>
          {locked && <Lock className="slot-lock" size={16} />}
        </>
      )}
    </motion.div>
  );
}

function ZoomOverlay({ piece }) {
  const team = piece ? TEAMS[piece.ownerIdx] : null;
  return (
    <AnimatePresence>
      {piece && team && (
        <motion.div
          key={piece.slot + "-" + piece.placedAt}
          className="zoom-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <motion.div
            className="zoom-card"
            style={{ "--tc": team.colour }}
            initial={{ scale: 0.5, opacity: 0, rotateX: 30 }}
            animate={{ scale: 1, opacity: 1, rotateX: 0 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: "spring", stiffness: 130, damping: 16 }}
          >
            <div className="zoom-gem">
              <IconFor name={piece.icon} className="zoom-icon" />
            </div>
            {piece.valueText && <p className="zoom-text">{piece.valueText}</p>}
            <div className="zoom-foot">
              <span className="zoom-dot" />
              <span>
                Slot {piece.slot} - read aloud by {team.name}
              </span>
            </div>
            <motion.div
              className="zoom-timer"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: ZOOM_MS / 1000, ease: "linear" }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ActTwoOverlay({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="act2-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ y: 220, opacity: 0, scale: 0.6 }}
            animate={{ y: -40, opacity: 1, scale: 1 }}
            transition={{ duration: 1.6, ease: "easeOut" }}
            className="act2-rocket"
          >
            <Rocket size={110} />
            <span className="act2-trail" />
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, letterSpacing: "0.6em" }}
            animate={{ opacity: 1, letterSpacing: "0.16em" }}
            transition={{ delay: 0.5, duration: 1 }}
          >
            ACT TWO
          </motion.h2>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
            Seventeen pieces are down. The rocket slots are open. Altair and Fomalhaut, to the front.
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CompleteBanner({ state }) {
  if (state.sessionState !== "complete") return null;
  const secs = Math.floor(((state.completedAt || 0) - (state.startedAt || 0)) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <motion.div
      className="complete-banner"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <Trophy size={20} />
      <span>
        Board complete in {mm}:{ss}. Every piece came through three teams.
      </span>
    </motion.div>
  );
}

function ProjectorApp({ state }) {
  const [zoom, setZoom] = useState(null);
  const [act2, setAct2] = useState(false);
  const seenRef = useRef(null);
  const queueRef = useRef([]);
  const busyRef = useRef(false);
  const prevSession = useRef(state.sessionState);

  const drain = useCallback(() => {
    if (busyRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    busyRef.current = true;
    setZoom(next);
    const team = TEAMS[next.ownerIdx];
    confetti({
      particleCount: 110,
      spread: 78,
      origin: { y: 0.62 },
      colors: [team.colour, "#E0A458", "#F7F0E8"],
    });
    setTimeout(() => {
      setZoom(null);
      busyRef.current = false;
      setTimeout(drain, 450);
    }, ZOOM_MS);
  }, []);

  // queue newly placed pieces, and never replay history on a projector refresh
  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(state.pieces.filter((p) => p.placed).map((p) => p.slot));
      return;
    }
    const fresh = state.pieces.filter((p) => p.placed && !seenRef.current.has(p.slot));
    if (fresh.length) {
      fresh.forEach((p) => seenRef.current.add(p.slot));
      queueRef.current.push(...fresh.sort((a, b) => (a.placedAt || 0) - (b.placedAt || 0)));
      drain();
    }
  }, [state.pieces, drain]);

  useEffect(() => {
    if (prevSession.current === "act1" && state.sessionState === "act2") {
      setAct2(true);
      setTimeout(() => setAct2(false), 5200);
    }
    if (prevSession.current !== "complete" && state.sessionState === "complete") {
      let n = 0;
      const burst = setInterval(() => {
        confetti({
          particleCount: 140,
          spread: 160,
          origin: { y: 0.45 },
          colors: ["#D94A2B", "#E0A458", "#F7F0E8", "#12A37B"],
        });
        n += 1;
        if (n > 5) clearInterval(burst);
      }, 900);
    }
    prevSession.current = state.sessionState;
  }, [state.sessionState]);

  const unlocked = rocketsUnlocked(state);
  const actLabel = {
    idle: "Waiting to start",
    act1: "Act One - seventeen pieces",
    act2: "Act Two - the rocket",
    complete: "Complete",
  }[state.sessionState];

  return (
    <div className={"screen projector-screen " + (state.sessionState === "complete" ? "is-complete" : "")}>
      <ZoomOverlay piece={zoom} />
      <ActTwoOverlay show={act2} />

      <header className="proj-header">
        <div className="proj-brand">
          <span className="eyebrow">
            <Gem size={12} /> Carnelian
          </span>
          <h1 className="brand-title small">Cross-Team Jigsaw</h1>
        </div>
        <div className="proj-status">
          <span className={"act-badge act-" + state.sessionState}>{actLabel}</span>
          <span className="placed-badge">{totalPlaced(state)} / 20 placed</span>
          <RoomClock
            startedAt={state.startedAt}
            completedAt={state.completedAt}
            sessionState={state.sessionState}
          />
        </div>
      </header>

      <div className="proj-body">
        <div className="board-wrap">
          <div className="board-grid">
            {state.pieces.map((p) => (
              <BoardSlot key={p.slot} piece={p} unlocked={unlocked} />
            ))}
          </div>
          <CompleteBanner state={state} />
        </div>

        <aside className="sidebar">
          {TEAMS.map((t) => {
            const n = teamPlaced(state, t.id);
            return (
              <div key={t.id} className={"side-row " + (n === 2 ? "full" : "")} style={{ "--tc": t.colour }}>
                <ProgressRing value={n} max={2} colour={t.colour} size={30} />
                <span className="side-name">{t.name}</span>
                <span className="side-count">{n}/2</span>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

/* ============================================================
   FACILITATOR
   ============================================================ */

function FacilitatorApp({ state, startSession, resetSession, forceAct2, giveHint }) {
  const [confirmReset, setConfirmReset] = useState(false);
  useTicker(1000);

  return (
    <div className="screen facilitator-screen">
      <header className="fac-header">
        <div>
          <span className="eyebrow">
            <Gem size={12} /> Carnelian
          </span>
          <h1 className="brand-title small">Facilitator console</h1>
        </div>
        <RoomClock
          startedAt={state.startedAt}
          completedAt={state.completedAt}
          sessionState={state.sessionState}
        />
      </header>

      <div className="fac-controls">
        <button className="place-btn inline" onClick={startSession} disabled={state.sessionState !== "idle"}>
          <Radio size={15} /> Start session
        </button>
        <button className="ghost-btn" onClick={forceAct2} disabled={state.sessionState !== "act1"}>
          <FastForward size={15} /> Force Act Two
        </button>
        <button
          className={"ghost-btn " + (confirmReset ? "danger" : "")}
          onClick={() => {
            if (confirmReset) {
              resetSession();
              setConfirmReset(false);
            } else {
              setConfirmReset(true);
              setTimeout(() => setConfirmReset(false), 4000);
            }
          }}
        >
          <RotateCcw size={15} /> {confirmReset ? "Tap again to confirm" : "Reset and regenerate codes"}
        </button>
        <span className={"act-badge act-" + state.sessionState}>{state.sessionState}</span>
        <span className="placed-badge">{totalPlaced(state)} / 20</span>
      </div>

      <div className="fac-grid">
        {TEAMS.map((t) => {
          const owned = state.pieces.filter((p) => p.ownerIdx === t.id);
          const cooling = Math.max(
            0,
            Math.ceil((((state.cooldowns || {})[t.id] || 0) - Date.now()) / 1000)
          );
          return (
            <div key={t.id} className="fac-card" style={{ "--tc": t.colour }}>
              <div className="fac-card-head">
                <span className="facet-chip sm">
                  <Gem size={14} />
                </span>
                <div>
                  <h3>{t.name}</h3>
                  <span className="p-table">
                    <MapPin size={11} /> Table {t.tableNumber}
                  </span>
                </div>
                {cooling > 0 && <span className="cool-chip">{cooling}s</span>}
              </div>

              {owned.map((p) => (
                <div key={p.slot} className={"fac-slot " + (p.placed ? "done" : "")}>
                  <div className="fac-slot-info">
                    <span className="fac-slot-title">
                      Slot {p.slot} {p.rocket && <Rocket size={12} />} {p.placed && <CheckCircle2 size={13} />}
                    </span>
                    <span className="fac-slot-sub">
                      code {p.code} - held by {TEAMS[p.holderIdx].name} - decoded by {TEAMS[p.decoderIdx].name}
                    </span>
                  </div>
                  {!p.placed && (
                    <div className="fac-hints">
                      <button className="hint-btn" disabled={p.hintCode} onClick={() => giveHint(p.slot, "code")}>
                        <Zap size={12} /> {p.hintCode ? "Code sent" : "Reveal code"}
                      </button>
                      <button className="hint-btn" disabled={p.hintSlot} onClick={() => giveHint(p.slot, "slot")}>
                        <Zap size={12} /> {p.hintSlot ? "Slot sent" : "Reveal slot"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   ROOT
   ============================================================ */

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const role = ["projector", "facilitator"].includes(params.get("view"))
    ? params.get("view")
    : "participant";
  const urlTeam = params.get("team");

  const [teamIdx, setTeamIdx] = useState(() => {
    if (role !== "participant") return null;
    if (urlTeam !== null && urlTeam !== "" && !Number.isNaN(Number(urlTeam))) return Number(urlTeam);
    const saved = localStorage.getItem("jigsaw-team");
    return saved !== null && saved !== "" ? Number(saved) : null;
  });

  const [toast, setToast] = useState(null);
  const toastId = useRef(0);

  const handleResult = useCallback((res) => {
    if (!res || res.kind === "already") return; // simultaneous teammate submit, stay silent
    toastId.current += 1;
    setToast({ ...res, id: toastId.current });
    if (navigator.vibrate) navigator.vibrate(res.kind === "placed" ? [25, 40, 25] : 60);
  }, []);

  const game = useSharedGame({ role, teamIdx, onResult: handleResult });

  const pickTeam = (idx) => {
    localStorage.setItem("jigsaw-team", String(idx));
    setTeamIdx(idx);
  };
  const leaveTeam = () => {
    localStorage.removeItem("jigsaw-team");
    setTeamIdx(null);
  };

  let body;
  if (role === "projector") {
    body = <ProjectorApp state={game.state} />;
  } else if (role === "facilitator") {
    body = (
      <FacilitatorApp
        state={game.state}
        startSession={game.startSession}
        resetSession={game.resetSession}
        forceAct2={game.forceAct2}
        giveHint={game.giveHint}
      />
    );
  } else if (teamIdx === null) {
    body = <JoinScreen onPick={pickTeam} />;
  } else {
    body = (
      <ParticipantApp
        teamIdx={teamIdx}
        state={game.state}
        submitPiece={game.submitPiece}
        onLeave={leaveTeam}
      />
    );
  }

  return (
    <div className={"app-root role-" + role}>
      <Backdrop />
      <ConnectionBadge connected={game.connected} useSocket={game.useSocket} />
      <Toast toast={toast} onClear={() => setToast(null)} />
      {body}
      <GlobalStyles />
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600;700;800&display=swap');

      :root {
        --obsidian: #100907;
        --carnelian: #D94A2B;
        --carnelian-deep: #A32E17;
        --ember: #F0873C;
        --gold: #E0A458;
        --ivory: #F7EFE7;
        --muted: #B9A196;
        --line: rgba(224,164,88,0.18);
        --good: #2FB37E;
        --bad: #E0533F;
        --warn: #E0A458;
      }

      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body, #root { margin: 0; min-height: 100%; }
      body {
        background: radial-gradient(120% 90% at 50% 0%, #24110B 0%, var(--obsidian) 55%, #0A0504 100%);
        background-attachment: fixed;
        color: var(--ivory);
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        overflow-x: hidden;
      }
      h1, h2, h3 { font-family: 'Fraunces', Georgia, serif; margin: 0; }

      .app-root { position: relative; min-height: 100vh; min-height: 100dvh; width: 100%; }
      .screen { position: relative; z-index: 2; }

      .veil, .emberfield, .grain { position: fixed; inset: 0; pointer-events: none; }
      .veil { background: radial-gradient(70% 55% at 50% 8%, rgba(217,74,43,0.16), transparent 70%); z-index: 0; }
      .glow { position: fixed; border-radius: 50%; filter: blur(110px); opacity: 0.5; z-index: 0; pointer-events: none; }
      .glow-a { width: 46vw; height: 46vw; top: -14vw; left: -12vw; background: #A32E17; animation: drift 26s ease-in-out infinite; }
      .glow-b { width: 40vw; height: 40vw; bottom: -14vw; right: -10vw; background: #7A3410; animation: drift 32s ease-in-out infinite reverse; }
      .glow-c { width: 30vw; height: 30vw; top: 40%; left: 55%; background: #4A1D3F; opacity: 0.35; animation: drift 40s ease-in-out infinite; }
      .emberfield { z-index: 1; }
      .grain {
        z-index: 1; opacity: 0.16; mix-blend-mode: overlay;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
      }
      @keyframes drift {
        0%,100% { transform: translate3d(0,0,0) scale(1); }
        50% { transform: translate3d(4vw,3vw,0) scale(1.12); }
      }

      .eyebrow {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; letter-spacing: 0.26em; text-transform: uppercase;
        color: var(--gold); font-weight: 700;
      }
      .brand-title {
        font-size: clamp(30px, 5.6vw, 58px); font-weight: 800; line-height: 1.02; letter-spacing: -0.02em;
        background: linear-gradient(100deg, #FFD9A8 0%, var(--ember) 38%, var(--carnelian) 70%, #FFC98A 100%);
        background-size: 200% auto;
        -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: pan 9s linear infinite;
      }
      .brand-title.small { font-size: clamp(19px, 2.3vw, 30px); }
      @keyframes pan { to { background-position: 200% center; } }
      .brand-sub { color: var(--muted); margin: 8px 0 0; font-size: 15px; }

      .conn-badge {
        position: fixed; top: max(10px, env(safe-area-inset-top)); right: 10px; z-index: 60;
        display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
        background: rgba(16,9,7,0.72); border: 1px solid var(--line);
        padding: 5px 11px; border-radius: 999px; color: var(--muted);
        backdrop-filter: blur(10px);
      }
      .conn-badge.ok svg { color: var(--good); }
      .conn-badge.bad svg { color: var(--bad); }

      .facet-chip {
        display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto;
        color: var(--tc, var(--gold));
        background: linear-gradient(150deg, rgba(255,255,255,0.16), rgba(255,255,255,0.02));
        border: 1px solid rgba(255,255,255,0.14);
        clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
        box-shadow: 0 0 22px -6px var(--tc, var(--gold));
      }
      .facet-chip.sm { width: 32px; height: 32px; }

      .gem-card, .frag-card, .fac-card, .p-header, .done-panel {
        background: linear-gradient(155deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
        border: 1px solid var(--line);
        border-radius: 18px;
        backdrop-filter: blur(12px);
        box-shadow: 0 18px 40px -28px #000;
      }

      /* ---------- Join ---------- */
      .join-screen {
        min-height: 100vh; min-height: 100dvh;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        text-align: center; padding: 40px 18px calc(40px + env(safe-area-inset-bottom));
      }
      .join-head { margin-bottom: 26px; }
      .team-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
        gap: 12px; width: 100%; max-width: 820px;
      }
      .team-pick {
        --tc: var(--gold);
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 20px 10px; cursor: pointer; color: var(--ivory);
        background: linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
        border: 1px solid var(--line); border-radius: 20px; font-family: inherit;
        transition: border-color .25s, box-shadow .25s;
      }
      .team-pick:hover { border-color: var(--tc); box-shadow: 0 12px 40px -18px var(--tc); }
      .team-pick-name { font-weight: 700; font-size: 16px; }
      .team-pick-meta { font-size: 11px; color: var(--muted); letter-spacing: 0.04em; }

      /* ---------- Participant ---------- */
      .participant-screen {
        --tc: var(--carnelian);
        max-width: 540px; margin: 0 auto; min-height: 100vh; min-height: 100dvh;
        padding: max(16px, env(safe-area-inset-top)) 14px calc(48px + env(safe-area-inset-bottom));
        display: flex; flex-direction: column; gap: 14px;
      }
      .p-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; gap: 10px; }
      .p-identity { display: flex; align-items: center; gap: 10px; background: none; border: none; color: inherit; cursor: pointer; padding: 0; text-align: left; font-family: inherit; }
      .p-identity > span:last-child { display: flex; flex-direction: column; }
      .p-team { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 700; }
      .p-table, .fac-slot-sub { color: var(--muted); font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px; }
      .fac-slot-sub { display: block; }
      .p-progress { display: flex; align-items: center; gap: 9px; }
      .p-act { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--gold); font-weight: 700; }

      .tabs { display: flex; gap: 6px; }
      .tabs button {
        position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;
        padding: 11px 4px; font-size: 11.5px; font-weight: 600; cursor: pointer;
        background: rgba(255,255,255,0.04); border: 1px solid var(--line);
        border-radius: 14px; color: var(--muted); font-family: inherit;
      }
      .tabs button.active { color: var(--ivory); border-color: var(--tc); background: rgba(255,255,255,0.09); }
      .tab-underline { position: absolute; left: 22%; right: 22%; bottom: -1px; height: 2px; background: var(--tc); border-radius: 2px; }

      .tab-panel { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
      .tab-intro { color: var(--muted); font-size: 12.5px; margin: 0 2px; line-height: 1.5; }

      .medallion-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .medallion {
        --tc: var(--carnelian);
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
        padding: 22px 8px; border-radius: 18px; color: var(--muted);
        border: 1px dashed rgba(255,255,255,0.16); background: rgba(255,255,255,0.025);
      }
      .medallion.lit {
        color: var(--tc); border: 1px solid var(--tc);
        background: linear-gradient(160deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02));
        box-shadow: 0 0 34px -12px var(--tc);
      }
      .medallion-dim { opacity: 0.4; }
      .medallion-slot { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 700; }

      .submit-card { padding: 18px 16px 16px; }
      .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .card-head h3 { font-size: 19px; }
      .count-chip, .cool-chip {
        font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
        background: rgba(224,164,88,0.14); border: 1px solid rgba(224,164,88,0.34); color: var(--gold);
      }
      .cool-chip { background: rgba(224,83,63,0.15); border-color: rgba(224,83,63,0.4); color: var(--bad); }
      .hint-copy { color: var(--muted); font-size: 12.5px; line-height: 1.55; margin: 0 0 14px; }

      .field-label {
        display: flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700;
        letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 7px;
      }
      .code-input { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 16px; }
      .code-input input {
        width: 100%; aspect-ratio: 1 / 1; text-align: center; font-size: clamp(22px, 7vw, 30px);
        font-weight: 800; font-family: inherit; text-transform: uppercase; color: var(--ivory);
        background: rgba(0,0,0,0.35); border: 1.5px solid var(--line); border-radius: 14px;
        transition: border-color .2s, box-shadow .2s;
      }
      .code-input input:focus { outline: none; border-color: var(--tc); box-shadow: 0 0 0 4px rgba(217,74,43,0.16); }
      .slot-input {
        width: 100%; padding: 14px; font-size: 22px; font-weight: 800; text-align: center;
        font-family: inherit; color: var(--ivory); margin-bottom: 16px;
        background: rgba(0,0,0,0.35); border: 1.5px solid var(--line); border-radius: 14px;
      }
      .slot-input:focus { outline: none; border-color: var(--tc); box-shadow: 0 0 0 4px rgba(217,74,43,0.16); }

      .place-btn {
        width: 100%; padding: 15px; font-size: 15px; font-weight: 800; font-family: inherit;
        cursor: pointer; border: none; border-radius: 14px; color: #20100A;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        background: linear-gradient(120deg, var(--gold), var(--ember) 45%, var(--carnelian));
        box-shadow: 0 12px 30px -14px var(--carnelian);
      }
      .place-btn:disabled { opacity: 0.42; cursor: not-allowed; box-shadow: none; }
      .place-btn.inline { width: auto; padding: 12px 18px; }
      .ghost-btn {
        display: inline-flex; align-items: center; gap: 7px; padding: 12px 16px; cursor: pointer;
        background: rgba(255,255,255,0.04); border: 1px solid var(--line); border-radius: 14px;
        color: var(--muted); font-family: inherit; font-size: 13px; font-weight: 600;
      }
      .ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .ghost-btn.danger { color: var(--bad); border-color: rgba(224,83,63,0.5); }
      .cooldown-note { color: var(--warn); font-size: 11.5px; margin: 10px 0 0; text-align: center; }

      .hint-banner {
        display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; line-height: 1.5;
        background: rgba(224,164,88,0.13); border: 1px solid rgba(224,164,88,0.34);
        color: var(--gold); padding: 9px 11px; border-radius: 12px; margin-bottom: 14px;
      }
      .hint-banner b { color: var(--ivory); letter-spacing: 0.08em; }

      .frag-card { display: flex; align-items: center; gap: 13px; padding: 13px; --tc: var(--gold); }
      .frag-icon {
        display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 auto; color: var(--tc);
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
        clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
      }
      .frag-body { min-width: 0; }
      .frag-code { font-size: 21px; font-weight: 800; letter-spacing: 0.16em; font-family: 'Fraunces', serif; }
      .frag-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 3px; font-size: 11.5px; color: var(--muted); }
      .frag-owner { color: var(--tc); font-weight: 700; }
      .frag-table { display: inline-flex; align-items: center; gap: 3px; }

      .done-panel { padding: 26px 18px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .done-panel svg { color: var(--good); }
      .done-panel p { color: var(--muted); font-size: 13px; margin: 0; line-height: 1.6; }

      .toast {
        position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
        z-index: 200; display: flex; align-items: center; gap: 9px; text-align: left;
        padding: 13px 17px; border-radius: 14px; font-size: 13.5px; font-weight: 600;
        max-width: min(460px, 92vw); backdrop-filter: blur(14px);
        box-shadow: 0 20px 44px -18px rgba(0,0,0,0.85);
      }
      .toast svg { flex: 0 0 auto; }
      .toast-good { background: rgba(23,74,55,0.94); border: 1px solid rgba(47,179,126,0.5); color: #C6F2DF; }
      .toast-bad { background: rgba(78,22,15,0.94); border: 1px solid rgba(224,83,63,0.5); color: #FFD6CE; }
      .toast-warn { background: rgba(74,48,12,0.94); border: 1px solid rgba(224,164,88,0.5); color: #FBE6C2; }

      /* ---------- Projector ---------- */
      .projector-screen {
        min-height: 100vh; min-height: 100dvh; padding: clamp(16px, 2vw, 30px);
        display: flex; flex-direction: column; gap: clamp(14px, 1.8vw, 24px);
      }
      .proj-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .proj-status { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .act-badge {
        padding: 7px 17px; border-radius: 999px; font-size: 13px; font-weight: 700;
        letter-spacing: 0.06em; text-transform: uppercase;
        background: rgba(224,164,88,0.13); border: 1px solid rgba(224,164,88,0.36); color: var(--gold);
      }
      .act-badge.act-act2 { background: rgba(217,74,43,0.18); border-color: rgba(217,74,43,0.5); color: #FFB69A; animation: pulseBadge 1.8s ease-in-out infinite; }
      .act-badge.act-complete { background: rgba(47,179,126,0.16); border-color: rgba(47,179,126,0.45); color: #9FE7C6; }
      @keyframes pulseBadge { 0%,100% { box-shadow: 0 0 0 0 rgba(217,74,43,0.4); } 50% { box-shadow: 0 0 0 12px rgba(217,74,43,0); } }
      .placed-badge { font-size: 13px; color: var(--muted); font-weight: 600; }
      .room-clock {
        display: flex; align-items: center; gap: 8px; font-size: clamp(20px, 2.4vw, 30px);
        font-weight: 800; font-variant-numeric: tabular-nums; font-family: 'Fraunces', serif;
      }
      .room-clock.stopped { color: var(--good); }

      .proj-body { display: flex; gap: clamp(16px, 2vw, 30px); flex: 1; align-items: stretch; }
      .board-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-width: 0; }
      .board-grid {
        display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(4, 1fr);
        gap: clamp(7px, 1.1vw, 18px);
        width: 100%; aspect-ratio: 5 / 4;
        max-height: calc(100dvh - 210px);
        max-width: calc((100dvh - 210px) * 1.25);
      }
      .slot {
        --tc: var(--gold);
        position: relative; display: grid; place-items: center; overflow: hidden;
        border-radius: clamp(10px, 1.1vw, 18px);
        background: linear-gradient(155deg, rgba(255,255,255,0.05), rgba(255,255,255,0.012));
        border: 1.5px solid rgba(255,255,255,0.09);
        transform-style: preserve-3d;
      }
      .slot::after {
        content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        background: linear-gradient(160deg, rgba(255,255,255,0.14), transparent 42%);
      }
      .slot-facets {
        position: absolute; inset: 0; opacity: 0.5; pointer-events: none;
        background:
          linear-gradient(135deg, transparent 47%, rgba(255,255,255,0.07) 50%, transparent 53%),
          linear-gradient(45deg, transparent 47%, rgba(255,255,255,0.05) 50%, transparent 53%);
      }
      .slot.locked { border-style: dashed; border-color: rgba(224,164,88,0.45); animation: breathe 3.4s ease-in-out infinite; }
      @keyframes breathe { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
      .slot.placed {
        border-color: var(--tc);
        background: linear-gradient(155deg, rgba(255,255,255,0.14), rgba(255,255,255,0.02));
        box-shadow: 0 0 clamp(18px, 2.4vw, 44px) -8px var(--tc), inset 0 0 40px -22px var(--tc);
      }
      .slot.placed.rocket { box-shadow: 0 0 60px -10px var(--tc), inset 0 0 50px -18px var(--tc); }
      .slot-sheen {
        position: absolute; top: 0; left: -60%; width: 55%; height: 100%; pointer-events: none;
        background: linear-gradient(100deg, transparent, rgba(255,255,255,0.4), transparent);
        animation: sheen 2.4s ease-out 1 forwards;
      }
      @keyframes sheen { to { left: 120%; } }
      .slot-icon { width: clamp(22px, 3.4vw, 56px); height: clamp(22px, 3.4vw, 56px); color: var(--ivory); filter: drop-shadow(0 0 12px var(--tc)); }
      .slot-number { font-size: clamp(15px, 2.1vw, 34px); font-weight: 800; color: rgba(255,255,255,0.2); font-family: 'Fraunces', serif; }
      .slot-tag { position: absolute; bottom: 5px; right: 8px; font-size: clamp(9px, 0.85vw, 13px); color: rgba(255,255,255,0.45); font-weight: 700; }
      .slot-lock { position: absolute; bottom: 7px; right: 8px; color: var(--gold); }

      .complete-banner {
        display: flex; align-items: center; gap: 10px; font-size: clamp(13px, 1.3vw, 17px); font-weight: 700;
        padding: 12px 20px; border-radius: 999px; color: #9FE7C6; text-align: center;
        background: rgba(47,179,126,0.12); border: 1px solid rgba(47,179,126,0.4);
      }
      .is-complete .board-grid { animation: goldPulse 3.5s ease-in-out infinite; }
      @keyframes goldPulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.14) saturate(1.1); } }

      .sidebar { width: clamp(180px, 16vw, 250px); display: flex; flex-direction: column; gap: 7px; justify-content: center; }
      .side-row {
        --tc: var(--gold);
        display: flex; align-items: center; gap: 10px; padding: 8px 13px; border-radius: 14px;
        background: rgba(255,255,255,0.04); border: 1px solid var(--line);
        transition: border-color .3s, background .3s;
      }
      .side-row.full { border-color: var(--tc); background: rgba(255,255,255,0.08); box-shadow: 0 0 26px -14px var(--tc); }
      .side-name { flex: 1; font-size: clamp(12px, 1.05vw, 15px); font-weight: 600; }
      .side-count { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--tc); font-size: clamp(12px, 1.05vw, 15px); }
      .ring { flex: 0 0 auto; }

      .zoom-overlay {
        position: fixed; inset: 0; z-index: 150; display: grid; place-items: center; padding: 5vw;
        background: radial-gradient(60% 60% at 50% 50%, rgba(20,8,4,0.9), rgba(6,3,2,0.97));
        backdrop-filter: blur(10px);
      }
      .zoom-card {
        --tc: var(--gold);
        position: relative; display: flex; flex-direction: column; align-items: center; gap: clamp(16px, 2.4vw, 30px);
        text-align: center; max-width: 1000px; width: 100%; padding: clamp(26px, 4vw, 56px);
        border: 2px solid var(--tc); border-radius: 30px; overflow: hidden;
        background: linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.015));
        box-shadow: 0 0 110px -18px var(--tc);
      }
      .zoom-gem {
        display: grid; place-items: center; width: clamp(110px, 15vw, 200px); height: clamp(110px, 15vw, 200px);
        color: var(--tc);
        background: linear-gradient(150deg, rgba(255,255,255,0.2), rgba(255,255,255,0.03));
        border: 2px solid var(--tc);
        clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
        box-shadow: 0 0 70px -14px var(--tc);
      }
      .zoom-icon { width: 52%; height: 52%; }
      .zoom-text { font-family: 'Fraunces', serif; font-size: clamp(22px, 3.6vw, 52px); font-weight: 800; line-height: 1.2; margin: 0; }
      .zoom-foot { display: flex; align-items: center; gap: 9px; font-size: clamp(12px, 1.2vw, 18px); color: var(--muted); }
      .zoom-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--tc); box-shadow: 0 0 14px var(--tc); }
      .zoom-timer { position: absolute; left: 0; bottom: 0; height: 4px; width: 100%; background: var(--tc); transform-origin: left center; }

      .act2-overlay {
        position: fixed; inset: 0; z-index: 160; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 6vw;
        overflow: hidden;
        background: radial-gradient(60% 60% at 50% 60%, rgba(60,16,6,0.96), rgba(5,2,1,0.99));
      }
      .act2-rocket { position: relative; color: var(--ember); filter: drop-shadow(0 0 40px var(--carnelian)); }
      .act2-trail {
        position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
        width: 10px; height: 40vh; border-radius: 999px;
        background: linear-gradient(to bottom, var(--ember), transparent);
        opacity: 0.65; filter: blur(6px);
      }
      .act2-overlay h2 { font-size: clamp(34px, 7vw, 90px); color: var(--ivory); }
      .act2-overlay p { color: var(--gold); font-size: clamp(14px, 1.8vw, 22px); max-width: 720px; margin: 0; }

      /* ---------- Facilitator ---------- */
      .facilitator-screen { min-height: 100vh; padding: max(20px, env(safe-area-inset-top)) clamp(14px, 2.4vw, 32px) 44px; }
      .fac-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
      .fac-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }
      .fac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 12px; }
      .fac-card { --tc: var(--gold); padding: 14px; }
      .fac-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .fac-card-head h3 { font-size: 17px; }
      .fac-card-head .cool-chip { margin-left: auto; }
      .fac-slot {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
        padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.07);
      }
      .fac-slot.done { opacity: 0.5; }
      .fac-slot-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .fac-slot-title { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700; }
      .fac-slot-title svg { color: var(--good); }
      .fac-hints { display: flex; gap: 6px; }
      .hint-btn {
        display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; cursor: pointer;
        font-size: 10.5px; font-weight: 700; font-family: inherit; border-radius: 9px;
        background: rgba(224,164,88,0.13); border: 1px solid rgba(224,164,88,0.36); color: var(--gold);
      }
      .hint-btn:disabled { opacity: 0.35; cursor: not-allowed; }

      /* ---------- Responsive ---------- */
      @media (max-width: 1000px) {
        .proj-body { flex-direction: column; }
        .board-grid { max-height: none; max-width: 100%; }
        .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; }
        .side-row { flex: 1 1 150px; }
      }
      @media (max-width: 620px) {
        .proj-header { flex-direction: column; align-items: flex-start; gap: 10px; }
        .side-row { flex: 1 1 45%; padding: 7px 10px; }
        .medallion-row { grid-template-columns: 1fr; }
        .fac-grid { grid-template-columns: 1fr; }
        .fac-controls > * { flex: 1 1 100%; justify-content: center; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
    `}</style>
  );
}