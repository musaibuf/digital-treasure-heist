import React, { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import confetti from "canvas-confetti";
import {
  Shield, Star, Users, Lightbulb, Heart, CheckCircle2, Flame, TrendingUp,
  Smile, Award, Compass, Mountain, Gift, MessageCircle, Trophy, Layers,
  Sparkles, Rocket, Lock, Radio, Inbox, BookOpen, Clock, Hash, KeyRound,
  MapPin, Wifi, WifiOff, Zap, Puzzle, RotateCcw, FastForward, AlertTriangle,
  Sun, Moon, Sunrise, Orbit, Telescope, Satellite, Radar, Atom, Globe, Aperture,
} from "lucide-react";
/* ============================================================
   PALETTE + CONFIG
   Chrome uses the orange ramp. Team colours are darkened so
   they stay legible on the cream background.
   Keep TEAMS names, VALUES, ROCKET_SLOTS matching backend index.js
   ============================================================ */

const BRAND = {
  cream: "#FFF5EB",
  cream2: "#FEE6CE",
  peach: "#FDD0A2",
  peach2: "#FDAE6B",
  orange: "#FD8D3C",
  orange2: "#F16913",
  rust: "#D94801",
  umber: "#8C2D04",
};

const TEAMS = [
  { name: "Aldebaran", colour: "#C2410C", gem: "Carnelian", Icon: Sun },
  { name: "Vega", colour: "#1D4ED8", gem: "Sapphire", Icon: Moon },
  { name: "Altair", colour: "#047857", gem: "Emerald", Icon: Sunrise },
  { name: "Deneb", colour: "#6D28D9", gem: "Amethyst", Icon: Orbit },
  { name: "Rigel", colour: "#B45309", gem: "Topaz", Icon: Telescope },
  { name: "Antares", colour: "#9F1239", gem: "Ruby", Icon: Satellite },
  { name: "Mizar", colour: "#0E7490", gem: "Aquamarine", Icon: Radar },
  { name: "Fomalhaut", colour: "#8A6D00", gem: "Citrine", Icon: Atom },
  { name: "Alnilam", colour: "#BE185D", gem: "Rose Quartz", Icon: Globe },
  { name: "Algol", colour: "#3730A3", gem: "Lapis", Icon: Aperture },
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
    const row = Math.floor((slot - 1) / 10); // 0 for slots 1-10, 1 for slots 11-20
    const rocket = isRocketSlot(slot);
    const value = rocket ? null : VALUES[cursor++];
    let code = randomCode();
    while (used.has(code)) code = randomCode(); // codes must be unique, we match on them
    used.add(code);
    pieces.push({
      slot,
      ownerIdx,
      holderIdx: (ownerIdx + 1 + row * 2) % 10,
      decoderIdx: (ownerIdx + 2 + row * 2) % 10,
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
   ============================================================ */

function useSharedGame({ role, teamIdx, onResult }) {
  const [rawState, setRawState] = useState(makeInitialState);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const channelRef = useRef(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  // identity read at reconnect time, not the value captured on first render
  const identityRef = useRef({ role, teamIdx });
  identityRef.current = { role, teamIdx };

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
      socket.emit("identify", identityRef.current);
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
  if (!name) return <Puzzle {...rest} />;
  const Comp = name === "Rocket" ? Rocket : ICONS[name] || Puzzle;
  return <Comp {...rest} />;
}

/* Drifting jigsaw pieces, drawn on canvas with real tab and blank edges */
function JigsawField() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let pieces = [];
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const TINTS = [BRAND.peach2, BRAND.orange, BRAND.orange2, BRAND.peach, BRAND.rust];

    // one edge of a jigsaw piece: straight, then a knob out (+1), in (-1) or flat (0)
    function edge(L, d) {
      if (d === 0) {
        ctx.lineTo(L, 0);
        return;
      }
      ctx.lineTo(0.36 * L, 0);
      ctx.bezierCurveTo(0.28 * L, d * 0.2 * L, 0.72 * L, d * 0.2 * L, 0.64 * L, 0);
      ctx.lineTo(L, 0);
    }

    function piecePath(size, edges) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i < 4; i++) {
        edge(size, edges[i]);
        ctx.translate(size, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.closePath();
    }

    function seed() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      const count = Math.max(9, Math.min(22, Math.floor((w * h) / 90000)));
      pieces = new Array(count).fill(0).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 34 + Math.random() * 58,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.0022,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -(Math.random() * 0.13 + 0.03),
        tint: TINTS[Math.floor(Math.random() * TINTS.length)],
        alpha: 0.1 + Math.random() * 0.2,
        filled: Math.random() > 0.45,
        edges: [0, 1, 2, 3].map(() => (Math.random() < 0.28 ? 0 : Math.random() < 0.5 ? 1 : -1)),
      }));
    }
    seed();
    window.addEventListener("resize", seed);

    let running = true;
    function tick() {
      if (!running) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        const pad = p.size * 2;
        if (p.y < -pad) {
          p.y = h + pad;
          p.x = Math.random() * w;
        }
        if (p.x < -pad) p.x = w + pad;
        if (p.x > w + pad) p.x = -pad;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.translate(-p.size / 2, -p.size / 2);

        piecePath(p.size, p.edges);

        ctx.globalAlpha = p.alpha;
        if (p.filled) {
          ctx.fillStyle = p.tint;
          ctx.fill();
        }
        ctx.globalAlpha = p.alpha + 0.16;
        ctx.strokeStyle = p.tint;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    // pause when the tab is hidden so a 30 minute run never degrades
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
  return <canvas ref={ref} className="jigsawfield" aria-hidden="true" />;
}

function Backdrop() {
  return (
    <>
      <div className="wash wash-a" aria-hidden="true" />
      <div className="wash wash-b" aria-hidden="true" />
      <div className="wash wash-c" aria-hidden="true" />
      <JigsawField />
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
  if (!copy) return null;

  return (
    <div key={toast.id} className={"toast toast-" + copy.tone}>
      {copy.tone === "bad" ? (
        <AlertTriangle size={16} />
      ) : copy.tone === "warn" ? (
        <Lock size={16} />
      ) : (
        <Sparkles size={16} />
      )}
      <span>{copy.text}</span>
    </div>
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
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(140,45,4,0.16)" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - c * pct}
        transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}
        style={{ transition: "stroke-dashoffset .7s ease" }}
      />
    </svg>
  );
}

/* ============================================================
   JOIN
   ============================================================ */

   function BrandMark({ size = 16 }) {
  return (
    <img
      src={process.env.PUBLIC_URL + "/logo.png"}
      alt="Carnelian"
      className="brand-logo"
      style={{ height: size }}
    />
  );
}

function JoinScreen({ onPick }) {
  return (
    <div className="screen join-screen">
      <div className="join-head anim-rise">
                <BrandMark size={64} />
        <h1 className="brand-title">Cross-Team Jigsaw</h1>
        <p className="brand-sub">Choose your constellation to begin</p>
      </div>

      <div className="team-grid">
        {TEAMS.map((t, i) => (
          <button
            key={t.id}
            className="team-pick anim-rise"
            style={{ "--tc": t.colour, animationDelay: i * 55 + "ms" }}
            onClick={() => onPick(t.id)}
          >
                        <span className="tab-chip">
              <t.Icon size={19} />
            </span>
            <span className="team-pick-name">{t.name}</span>
            <span className="team-pick-meta">
              {t.gem} - Table {t.tableNumber}
            </span>
          </button>
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

function OurBoardTab({ view, state, teamIdx, onSubmit, draft, setDraft }) {
  const code = draft.code;
  const slotNumber = draft.slotNumber;
  const setCode = (v) => setDraft((d) => ({ ...d, code: v }));
  const setSlotNumber = (v) => setDraft((d) => ({ ...d, slotNumber: v }));
  useTicker(1000);

  const team = TEAMS[teamIdx];
  const placed = view.owned.filter((p) => p.placed);
  const remaining = view.owned.filter((p) => !p.placed);
  const hints = view.owned.filter((p) => p.hintCode || p.hintSlot);
  const cooling = Math.max(0, Math.ceil(((state.cooldownUntil || 0) - Date.now()) / 1000));
  const allDone = remaining.length === 0;

  // never let a half filled form reach the server, a rejection costs the team 8 seconds
  const codeReady = /^[A-Z0-9]{4}$/.test(code);
  const slotNum = Number(slotNumber);
  const slotReady = slotNumber !== "" && slotNum >= 1 && slotNum <= 20;

  const submit = () => {
    if (!codeReady || !slotReady) return;
    onSubmit(code, slotNumber);
    setDraft({ code: "", slotNumber: "" });
  };

  return (
    <div className="tab-panel">
      <div className="medallion-row">
        {view.owned.map((p, i) => (
          <div
            key={p.slot + "-" + (p.placed ? "on" : "off")}
            className={"medallion " + (p.placed ? "lit" : "")}
            style={{ "--tc": team.colour }}
          >
            {p.placed ? (
              <>
                <IconFor name={p.icon} size={30} />
                <span className="medallion-slot">Slot {p.slot}</span>
              </>
            ) : (
              <>
                <Puzzle size={26} className="medallion-dim" />
                <span className="medallion-slot">Piece {i + 1}</span>
              </>
            )}
          </div>
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

          <button className="place-btn" onClick={submit} disabled={cooling > 0 || !codeReady || !slotReady}>
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
        <div
          key={h.key}
          className="frag-card anim-slide"
          style={{ "--tc": h.owner.colour, animationDelay: i * 50 + "ms" }}
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
        </div>
      ))}
    </div>
  );
}

function LegendTab({ legend }) {
  return (
    <div className="tab-panel">
      <p className="tab-intro">This maps an icon to its slot on the board. Only your team has these.</p>
      {legend.map((l, i) => (
        <div
          key={l.key}
          className="frag-card anim-slide"
          style={{ "--tc": l.owner.colour, animationDelay: i * 50 + "ms" }}
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
        </div>
      ))}
    </div>
  );
}

function ParticipantApp({ teamIdx, state, submitPiece, onLeave }) {
  const team = TEAMS[teamIdx];
  const [tab, setTab] = useState("board");
  // held here so switching tabs mid entry does not wipe a code someone just collected
  const [draft, setDraft] = useState({ code: "", slotNumber: "" });
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
                    <span className="tab-chip sm">
            <team.Icon size={16} />
          </span>
          <span>
            <span className="p-team">{team.name}</span>
                        <span className="p-table">
              <MapPin size={11} /> Table {team.tableNumber} · change
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
            {tab === id && <span className="tab-underline" />}
          </button>
        ))}
      </nav>

      <div key={tab} className="anim-fade">
        {tab === "board" && (
          <OurBoardTab
            view={view}
            state={state}
            teamIdx={teamIdx}
            onSubmit={(code, slot) => submitPiece(teamIdx, code, slot)}
            draft={draft}
            setDraft={setDraft}
          />
        )}
        {tab === "holding" && <HoldingTab holding={view.holding} />}
        {tab === "legend" && <LegendTab legend={view.legend} />}
      </div>
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
    <div
      key={piece.slot + "-" + (piece.placed ? "on" : "off")}
      className={
        "slot " +
        (piece.placed ? "placed " : "") +
        (locked ? "locked " : "") +
        (piece.rocket ? "rocket" : "")
      }
      style={{ "--tc": team.colour }}
    >
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
    </div>
  );
}

function ZoomOverlay({ piece }) {
  if (!piece) return null;
  const team = TEAMS[piece.ownerIdx];
  return (
    <div className="zoom-overlay" key={piece.slot + "-" + piece.placedAt}>
      <div className="zoom-card" style={{ "--tc": team.colour }}>
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
        <div className="zoom-timer" style={{ animationDuration: ZOOM_MS + "ms" }} />
      </div>
    </div>
  );
}

function ActTwoOverlay({ show }) {
  if (!show) return null;
  return (
    <div className="act2-overlay">
      <div className="act2-rocket">
        <Rocket size={110} />
        <span className="act2-trail" />
      </div>
      <h2>ACT TWO</h2>
      <p>Seventeen pieces are down. The rocket slots are open. Altair and Fomalhaut, to the front.</p>
    </div>
  );
}

function CompleteBanner({ state }) {
  if (state.sessionState !== "complete") return null;
  const secs = Math.floor(((state.completedAt || 0) - (state.startedAt || 0)) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <div className="complete-banner anim-rise">
      <Trophy size={20} />
      <span>
        Board complete in {mm}:{ss}. Every piece came through three teams.
      </span>
    </div>
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
      colors: [team.colour, BRAND.orange2, BRAND.peach2],
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
    let wait;
    if (prevSession.current === "act1" && state.sessionState === "act2") {
      // let the 17th piece finish its zoom before the cinematic takes over
      wait = setInterval(() => {
        if (!busyRef.current && queueRef.current.length === 0) {
          clearInterval(wait);
          setAct2(true);
          setTimeout(() => setAct2(false), 5200);
        }
      }, 300);
    }
    if (prevSession.current !== "complete" && state.sessionState === "complete") {
      let n = 0;
      const burst = setInterval(() => {
        confetti({
          particleCount: 140,
          spread: 160,
          origin: { y: 0.45 },
          colors: [BRAND.rust, BRAND.orange, BRAND.peach2, BRAND.umber],
        });
        n += 1;
        if (n > 5) clearInterval(burst);
      }, 900);
    }
    prevSession.current = state.sessionState;
    return () => clearInterval(wait);
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
                    <BrandMark size={22} />
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
                    <BrandMark size={20} />
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
                                <span className="tab-chip sm">
                  <t.Icon size={15} />
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
    // ?join=1 always forces the team picker, useful in testing and on a reused phone
    if (params.get("join") !== null) {
      localStorage.removeItem("jigsaw-team");
      return null;
    }
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
        --cream: #FFF5EB;
        --cream-2: #FEE6CE;
        --peach: #FDD0A2;
        --peach-2: #FDAE6B;
        --orange: #FD8D3C;
        --orange-2: #F16913;
        --rust: #D94801;
        --umber: #8C2D04;

        --ink: #3F1B06;
        --muted: #8A5C3D;
        --line: rgba(140,45,4,0.16);
        --line-soft: rgba(140,45,4,0.09);
        --card: rgba(255,255,255,0.78);
        --good: #15803D;
        --bad: #C2261B;
        --warn: #B45309;
      }

      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body, #root { margin: 0; min-height: 100%; }
      body {
        background: var(--cream);
        color: var(--ink);
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        overflow-x: hidden;
      }
      h1, h2, h3 { font-family: 'Fraunces', Georgia, serif; margin: 0; }

      .app-root { position: relative; min-height: 100vh; min-height: 100dvh; width: 100%; }
      .screen { position: relative; z-index: 2; }

      /* ---------- shared animations ---------- */
      @keyframes riseIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
      @keyframes slideIn { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes flipIn { 0% { opacity: 0; transform: rotateY(90deg) scale(0.86); } 60% { opacity: 1; transform: rotateY(0deg) scale(1.05); } 100% { transform: rotateY(0deg) scale(1); } }
      @keyframes popIn { from { opacity: 0; transform: scale(0.55) translateY(30px); } to { opacity: 1; transform: none; } }
      @keyframes toastIn { from { opacity: 0; transform: translate(-50%, -60px) scale(0.94); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
      @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
      @keyframes sheen { to { left: 120%; } }
      @keyframes breathe { 0%,100% { opacity: 0.65; } 50% { opacity: 1; } }
      @keyframes pan { to { background-position: 200% center; } }
      @keyframes floatWash { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(3vw,2vw,0) scale(1.14); } }

      .anim-rise { animation: riseIn .55s cubic-bezier(.2,.8,.3,1) both; }
      .anim-slide { animation: slideIn .4s ease-out both; }
      .anim-fade { animation: fadeUp .25s ease-out both; }

      /* ---------- backdrop ---------- */
      .jigsawfield { position: fixed; inset: 0; z-index: 1; pointer-events: none; }
      .wash { position: fixed; border-radius: 50%; filter: blur(120px); z-index: 0; pointer-events: none; }
      .wash-a { width: 52vw; height: 52vw; top: -16vw; left: -14vw; background: var(--peach); opacity: 0.62; animation: floatWash 30s ease-in-out infinite; }
      .wash-b { width: 44vw; height: 44vw; bottom: -16vw; right: -12vw; background: var(--peach-2); opacity: 0.42; animation: floatWash 36s ease-in-out infinite reverse; }
      .wash-c { width: 30vw; height: 30vw; top: 44%; left: 52%; background: var(--cream-2); opacity: 0.7; animation: floatWash 44s ease-in-out infinite; }

      .eyebrow {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; letter-spacing: 0.26em; text-transform: uppercase;
        color: var(--rust); font-weight: 700;
      }
                .brand-logo { display: block; width: auto; max-width: 260px; margin: 0 auto 18px; }
      .proj-brand .brand-logo, .fac-header .brand-logo { margin: 0 0 8px; }
      .brand-title {
        font-size: clamp(30px, 5.6vw, 58px); font-weight: 800; line-height: 1.16; letter-spacing: -0.02em;
        padding-bottom: 0.06em;
        background: linear-gradient(100deg, var(--umber) 0%, var(--rust) 34%, var(--orange) 62%, var(--umber) 100%);
        background-size: 200% auto;
        -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: pan 10s linear infinite;
      }
      .brand-title.small { font-size: clamp(19px, 2.3vw, 30px); }
      .brand-sub { color: var(--muted); margin: 8px 0 0; font-size: 15px; }

      .conn-badge {
        position: fixed; top: max(10px, env(safe-area-inset-top)); right: 10px; z-index: 60;
        display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
        background: rgba(255,255,255,0.86); border: 1px solid var(--line);
        padding: 5px 11px; border-radius: 999px; color: var(--muted);
        backdrop-filter: blur(10px);
      }
      .conn-badge.ok svg { color: var(--good); }
      .conn-badge.bad svg { color: var(--bad); }

      /* jigsaw tab shaped chip */
      .tab-chip {
        display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto;
        color: #fff; background: var(--tc, var(--rust));
        border-radius: 11px;
        box-shadow: 0 6px 16px -8px var(--tc, var(--rust));
      }
      .tab-chip.sm { width: 32px; height: 32px; border-radius: 9px; }

      .gem-card, .frag-card, .fac-card, .p-header, .done-panel {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 18px;
        backdrop-filter: blur(14px);
        box-shadow: 0 14px 34px -26px rgba(140,45,4,0.5);
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
        --tc: var(--rust);
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 20px 10px; cursor: pointer; color: var(--ink);
        background: var(--card); border: 1px solid var(--line); border-radius: 20px;
        font-family: inherit;
        transition: border-color .25s, box-shadow .25s, transform .2s;
      }
      .team-pick:hover { border-color: var(--tc); box-shadow: 0 14px 30px -18px var(--tc); transform: translateY(-4px); }
      .team-pick:active { transform: scale(0.96); }
      .team-pick-name { font-weight: 700; font-size: 16px; }
      .team-pick-meta { font-size: 11px; color: var(--muted); letter-spacing: 0.04em; }

      /* ---------- Participant ---------- */
      .participant-screen {
        --tc: var(--rust);
        max-width: 540px; margin: 0 auto; min-height: 100vh; min-height: 100dvh;
        padding: max(16px, env(safe-area-inset-top)) 14px calc(48px + env(safe-area-inset-bottom));
        display: flex; flex-direction: column; gap: 14px;
      }
      .p-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; gap: 10px; }
      .p-identity { display: flex; align-items: center; gap: 10px; background: none; border: none; color: inherit; cursor: pointer; padding: 0; text-align: left; font-family: inherit; }
      .p-identity > span:last-child { display: flex; flex-direction: column; }
      .p-team { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 700; }
      .p-table { color: var(--muted); font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px; }
      .fac-slot-sub { color: var(--muted); font-size: 11.5px; display: block; }
      .p-progress { display: flex; align-items: center; gap: 9px; }
      .p-act { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--rust); font-weight: 700; }

      .tabs { display: flex; gap: 6px; }
      .tabs button {
        position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;
        padding: 11px 4px; font-size: 11.5px; font-weight: 600; cursor: pointer;
        background: rgba(255,255,255,0.6); border: 1px solid var(--line-soft);
        border-radius: 14px; color: var(--muted); font-family: inherit;
        transition: color .2s, border-color .2s, background .2s;
      }
      .tabs button.active { color: var(--ink); border-color: var(--tc); background: #fff; }
      .tab-underline { position: absolute; left: 22%; right: 22%; bottom: -1px; height: 2px; background: var(--tc); border-radius: 2px; }

      .tab-panel { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
      .tab-intro { color: var(--muted); font-size: 12.5px; margin: 0 2px; line-height: 1.5; }

      .medallion-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .medallion {
        --tc: var(--rust);
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
        padding: 22px 8px; border-radius: 18px; color: var(--muted);
        border: 1.5px dashed rgba(140,45,4,0.24); background: rgba(255,255,255,0.5);
      }
      .medallion.lit {
        color: var(--tc); border: 1.5px solid var(--tc); background: #fff;
        box-shadow: 0 12px 28px -18px var(--tc);
        animation: flipIn .6s ease-out both;
      }
      .medallion-dim { opacity: 0.45; }
      .medallion-slot { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 700; }

      .submit-card { padding: 18px 16px 16px; }
      .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .card-head h3 { font-size: 19px; }
      .count-chip, .cool-chip {
        font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
        background: var(--cream-2); border: 1px solid rgba(217,72,1,0.28); color: var(--umber);
      }
      .cool-chip { background: #FDE6E2; border-color: rgba(194,38,27,0.3); color: var(--bad); }
      .hint-copy { color: var(--muted); font-size: 12.5px; line-height: 1.55; margin: 0 0 14px; }

      .field-label {
        display: flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700;
        letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 7px;
      }
      .code-input { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 16px; }
      .code-input input {
        width: 100%; aspect-ratio: 1 / 1; text-align: center; font-size: clamp(22px, 7vw, 30px);
        font-weight: 800; font-family: inherit; text-transform: uppercase; color: var(--ink);
        background: #fff; border: 1.5px solid var(--line); border-radius: 14px;
        transition: border-color .2s, box-shadow .2s;
      }
      .code-input input:focus { outline: none; border-color: var(--tc); box-shadow: 0 0 0 4px rgba(253,141,60,0.28); }
      .slot-input {
        width: 100%; padding: 14px; font-size: 22px; font-weight: 800; text-align: center;
        font-family: inherit; color: var(--ink); margin-bottom: 16px;
        background: #fff; border: 1.5px solid var(--line); border-radius: 14px;
      }
      .slot-input:focus { outline: none; border-color: var(--tc); box-shadow: 0 0 0 4px rgba(253,141,60,0.28); }

      .place-btn {
        width: 100%; padding: 15px; font-size: 15px; font-weight: 800; font-family: inherit;
        cursor: pointer; border: none; border-radius: 14px; color: #fff;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        background: linear-gradient(120deg, var(--orange), var(--orange-2) 50%, var(--rust));
        box-shadow: 0 12px 26px -14px var(--rust);
        transition: transform .15s, opacity .2s;
      }
      .place-btn:active:not(:disabled) { transform: scale(0.98); }
      .place-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
      .place-btn.inline { width: auto; padding: 12px 18px; }
      .ghost-btn {
        display: inline-flex; align-items: center; gap: 7px; padding: 12px 16px; cursor: pointer;
        background: rgba(255,255,255,0.7); border: 1px solid var(--line); border-radius: 14px;
        color: var(--umber); font-family: inherit; font-size: 13px; font-weight: 600;
      }
      .ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .ghost-btn.danger { color: var(--bad); border-color: rgba(194,38,27,0.45); }
      .cooldown-note { color: var(--warn); font-size: 11.5px; margin: 10px 0 0; text-align: center; }

      .hint-banner {
        display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; line-height: 1.5;
        background: var(--cream-2); border: 1px solid rgba(217,72,1,0.28);
        color: var(--umber); padding: 9px 11px; border-radius: 12px; margin-bottom: 14px;
      }
      .hint-banner b { letter-spacing: 0.08em; }

      .frag-card { display: flex; align-items: center; gap: 13px; padding: 13px; --tc: var(--rust); }
      .frag-icon {
        display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 auto;
        color: #fff; background: var(--tc); border-radius: 12px;
      }
      .frag-body { min-width: 0; }
      .frag-code { font-size: 21px; font-weight: 800; letter-spacing: 0.16em; font-family: 'Fraunces', serif; color: var(--ink); }
      .frag-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 3px; font-size: 11.5px; color: var(--muted); }
      .frag-owner { color: var(--tc); font-weight: 700; }
      .frag-table { display: inline-flex; align-items: center; gap: 3px; }

      .done-panel { padding: 26px 18px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .done-panel svg { color: var(--good); }
      .done-panel p { color: var(--muted); font-size: 13px; margin: 0; line-height: 1.6; }

      .toast {
        position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%;
        z-index: 200; display: flex; align-items: center; gap: 9px; text-align: left;
        padding: 13px 17px; border-radius: 14px; font-size: 13.5px; font-weight: 600;
        max-width: min(460px, 92vw);
        box-shadow: 0 18px 40px -20px rgba(140,45,4,0.55);
      }
      .toast svg { flex: 0 0 auto; }
      .toast-good { background: #E7F6ED; border: 1px solid rgba(21,128,61,0.4); color: #14532D; }
      .toast-bad { background: #FDE7E3; border: 1px solid rgba(194,38,27,0.4); color: #7F1D1D; }
      .toast-warn { background: var(--cream-2); border: 1px solid rgba(217,72,1,0.4); color: var(--umber); }

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
        background: var(--cream-2); border: 1px solid rgba(217,72,1,0.3); color: var(--umber);
      }
      .act-badge.act-act2 { background: var(--peach-2); border-color: var(--rust); color: #5C1D02; animation: pulseBadge 1.8s ease-in-out infinite; }
      .act-badge.act-complete { background: #DCF3E5; border-color: rgba(21,128,61,0.4); color: #14532D; }
      @keyframes pulseBadge { 0%,100% { box-shadow: 0 0 0 0 rgba(217,72,1,0.35); } 50% { box-shadow: 0 0 0 12px rgba(217,72,1,0); } }
      .placed-badge { font-size: 13px; color: var(--muted); font-weight: 600; }
      .room-clock {
        display: flex; align-items: center; gap: 8px; font-size: clamp(20px, 2.4vw, 30px);
        font-weight: 800; font-variant-numeric: tabular-nums; font-family: 'Fraunces', serif; color: var(--umber);
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
        --tc: var(--rust);
        position: relative; display: grid; place-items: center; overflow: hidden;
        border-radius: clamp(10px, 1.1vw, 18px);
        background: rgba(255,255,255,0.55);
        border: 1.5px solid var(--line-soft);
      }
      .slot.locked { border-style: dashed; border-color: rgba(217,72,1,0.5); animation: breathe 3.4s ease-in-out infinite; }
      .slot.placed {
        border: 2px solid var(--tc);
        background: #fff;
        box-shadow: 0 10px 26px -14px var(--tc);
        animation: flipIn .75s ease-out both;
      }
      .slot-sheen {
        position: absolute; top: 0; left: -60%; width: 55%; height: 100%; pointer-events: none;
        background: linear-gradient(100deg, transparent, rgba(253,174,107,0.55), transparent);
        animation: sheen 2.4s ease-out 1 forwards;
      }
      .slot-icon { width: clamp(22px, 3.4vw, 56px); height: clamp(22px, 3.4vw, 56px); color: var(--tc); }
      .slot-number { font-size: clamp(15px, 2.1vw, 34px); font-weight: 800; color: rgba(140,45,4,0.24); font-family: 'Fraunces', serif; }
      .slot-tag { position: absolute; bottom: 5px; right: 8px; font-size: clamp(9px, 0.85vw, 13px); color: var(--muted); font-weight: 700; }
      .slot-lock { position: absolute; bottom: 7px; right: 8px; color: var(--rust); }

      .complete-banner {
        display: flex; align-items: center; gap: 10px; font-size: clamp(13px, 1.3vw, 17px); font-weight: 700;
        padding: 12px 20px; border-radius: 999px; color: #14532D; text-align: center;
        background: #DCF3E5; border: 1px solid rgba(21,128,61,0.35);
      }
      .is-complete .board-grid { animation: warmPulse 3.5s ease-in-out infinite; }
      @keyframes warmPulse { 0%,100% { filter: saturate(1); } 50% { filter: saturate(1.18) brightness(1.03); } }

      .sidebar { width: clamp(180px, 16vw, 250px); display: flex; flex-direction: column; gap: 7px; justify-content: center; }
      .side-row {
        --tc: var(--rust);
        display: flex; align-items: center; gap: 10px; padding: 8px 13px; border-radius: 14px;
        background: rgba(255,255,255,0.62); border: 1px solid var(--line-soft);
        transition: border-color .3s, background .3s, box-shadow .3s;
      }
      .side-row.full { border-color: var(--tc); background: #fff; box-shadow: 0 10px 22px -16px var(--tc); }
      .side-name { flex: 1; font-size: clamp(12px, 1.05vw, 15px); font-weight: 600; }
      .side-count { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--tc); font-size: clamp(12px, 1.05vw, 15px); }
      .ring { flex: 0 0 auto; }

      .zoom-overlay {
        position: fixed; inset: 0; z-index: 150; display: grid; place-items: center; padding: 5vw;
        background: rgba(255,240,225,0.94);
        backdrop-filter: blur(8px);
        animation: fadeUp .3s ease-out both;
      }
      .zoom-card {
        --tc: var(--rust);
        position: relative; display: flex; flex-direction: column; align-items: center; gap: clamp(16px, 2.4vw, 30px);
        text-align: center; max-width: 1000px; width: 100%; padding: clamp(26px, 4vw, 56px);
        border: 2px solid var(--tc); border-radius: 30px; overflow: hidden; background: #fff;
        box-shadow: 0 30px 70px -30px rgba(140,45,4,0.55);
        animation: popIn .5s cubic-bezier(.2,1.2,.35,1) both;
      }
      .zoom-gem {
        display: grid; place-items: center; width: clamp(110px, 15vw, 200px); height: clamp(110px, 15vw, 200px);
        color: #fff; background: var(--tc); border-radius: 26px;
        box-shadow: 0 18px 40px -20px var(--tc);
      }
      .zoom-icon { width: 52%; height: 52%; }
      .zoom-text { font-family: 'Fraunces', serif; font-size: clamp(22px, 3.6vw, 52px); font-weight: 800; line-height: 1.2; margin: 0; color: var(--ink); }
      .zoom-foot { display: flex; align-items: center; gap: 9px; font-size: clamp(12px, 1.2vw, 18px); color: var(--muted); }
      .zoom-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--tc); }
      .zoom-timer {
        position: absolute; left: 0; bottom: 0; height: 5px; width: 100%; background: var(--tc);
        transform-origin: left center; animation: drain linear forwards;
      }

      .act2-overlay {
        position: fixed; inset: 0; z-index: 160; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 6vw;
        overflow: hidden;
        background: linear-gradient(160deg, var(--cream) 0%, var(--peach) 100%);
        animation: fadeUp .4s ease-out both;
      }
      .act2-rocket {
        position: relative; color: var(--rust);
        animation: rocketRise 1.6s cubic-bezier(.2,.7,.3,1) both;
      }
      @keyframes rocketRise { from { opacity: 0; transform: translateY(220px) scale(0.6); } to { opacity: 1; transform: translateY(-40px) scale(1); } }
      .act2-trail {
        position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
        width: 12px; height: 40vh; border-radius: 999px;
        background: linear-gradient(to bottom, var(--orange), transparent);
        opacity: 0.7; filter: blur(6px);
      }
      .act2-overlay h2 {
        font-size: clamp(34px, 7vw, 90px); color: var(--umber);
        animation: letterSpread 1s .5s both;
      }
      @keyframes letterSpread { from { opacity: 0; letter-spacing: .6em; } to { opacity: 1; letter-spacing: .16em; } }
      .act2-overlay p {
        color: var(--rust); font-size: clamp(14px, 1.8vw, 22px); max-width: 720px; margin: 0;
        animation: fadeUp .6s 1.1s both;
      }

      /* ---------- Facilitator ---------- */
      .facilitator-screen { min-height: 100vh; padding: max(20px, env(safe-area-inset-top)) clamp(14px, 2.4vw, 32px) 44px; }
      .fac-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
      .fac-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }
      .fac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 12px; }
      .fac-card { --tc: var(--rust); padding: 14px; }
      .fac-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .fac-card-head h3 { font-size: 17px; }
      .fac-card-head .cool-chip { margin-left: auto; }
      .fac-slot {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
        padding: 9px 0; border-top: 1px solid var(--line-soft);
      }
      .fac-slot.done { opacity: 0.5; }
      .fac-slot-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .fac-slot-title { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700; }
      .fac-slot-title svg { color: var(--good); }
      .fac-hints { display: flex; gap: 6px; }
      .hint-btn {
        display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; cursor: pointer;
        font-size: 10.5px; font-weight: 700; font-family: inherit; border-radius: 9px;
        background: var(--cream-2); border: 1px solid rgba(217,72,1,0.3); color: var(--umber);
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