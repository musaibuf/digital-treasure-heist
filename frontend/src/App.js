import React, { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import confetti from "canvas-confetti";
import {
  Lock, Wifi, WifiOff, AlertTriangle, CheckCircle2, RotateCcw, Clock,
  ArrowRight, Trophy, Users,
} from "lucide-react";

/* ============================================================
   CONFIG - must match backend index.js exactly (except answers,
   which the backend never sends to any client)
   ============================================================ */

const TEAM_NUMBERS = Array.from({ length: 10 }, (_, i) => i + 1);
const TOTAL_QUESTIONS = 4;

/* ============================================================
   DEVICE TOKEN
   Generated once per phone, persisted, proves "this device
   already claimed this team" across refresh/reconnect.
   ============================================================ */

function getOrCreateDeviceToken() {
  let token = localStorage.getItem("heist-token");
  if (!token) {
    token =
      Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem("heist-token", token);
  }
  return token;
}

/* ============================================================
   SHARED STATE HOOK
   Socket.io backend when REACT_APP_SERVER_URL is set. Each team
   is a single device, so the backend is the only source of
   truth - there is no local reducer here.
   ============================================================ */

function useHeist({ role, teamNumber, deviceToken, onResult }) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const identityRef = useRef({ role, teamNumber, deviceToken });
  identityRef.current = { role, teamNumber, deviceToken };

  const serverUrl = process.env.REACT_APP_SERVER_URL;

  useEffect(() => {
    if (!serverUrl) {
      setConnected(false);
      return;
    }
    const socket = io(serverUrl, { reconnection: true, reconnectionDelay: 800 });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("identify", identityRef.current);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("state:update", (snap) => setState(snap));
    socket.on("action:result", (res) => resultRef.current && resultRef.current(res));
    const poll = setInterval(() => socket.connected && socket.emit("state:request"), 5000);
    return () => {
      clearInterval(poll);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  // re-identify whenever the team/role changes after connecting
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("identify", { role, teamNumber, deviceToken });
    }
  }, [role, teamNumber, deviceToken]);

  const dispatch = useCallback((action) => {
    if (socketRef.current) socketRef.current.emit("action", action);
  }, []);

  return { state, connected, dispatch };
}

/* ============================================================
   ATOMS
   ============================================================ */

function GlowBackdrop() {
  return (
    <>
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />
    </>
  );
}

function BrandMark({ size = 22 }) {
  return (
    <img
      src={process.env.PUBLIC_URL + "/logo.png"}
      alt="Carnelian"
      className="brand-logo"
      style={{ height: size }}
    />
  );
}

function ConnectionBadge({ connected, floating = true }) {
  return (
    <div className={"conn-badge " + (connected ? "ok" : "bad") + (floating ? " floating" : "")}>
      {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
      <span>{connected ? "Live" : "Connecting"}</span>
    </div>
  );
}

const TOAST_COPY = {
  correct: { text: "Correct. Next digit unlocked.", tone: "good" },
  wrong: { text: "Not quite. Check the digit and try again.", tone: "bad" },
  "wrong-cipher": { text: "That word isn't it. Recheck your letters.", tone: "bad" },
  complete: { text: "Cracked it. The word is TECH.", tone: "good" },
  cooldown: { text: "Hold on a moment before trying again.", tone: "warn" },
  "team-taken": { text: "This team has already been claimed on another device.", tone: "bad" },
  "already-past": { text: "Your team has already moved on from this step.", tone: "warn" },
  invalid: { text: "Something went wrong. Try again.", tone: "bad" },
};

function Toast({ toast, onClear }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClear, 3200);
    return () => clearTimeout(t);
  }, [toast, onClear]);

  const copy = toast ? TOAST_COPY[toast.kind] : null;
  if (!copy) return null;

  return (
    <div key={toast.id} className={"toast toast-" + copy.tone}>
      {copy.tone === "bad" ? <AlertTriangle size={20} /> : copy.tone === "warn" ? <Lock size={20} /> : <CheckCircle2 size={20} />}
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

function RoomClock({ startedAt }) {
  useTicker(1000);
  if (!startedAt) return <div className="room-clock">00:00</div>;
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="room-clock">
      <Clock size={17} />
      <span>{mm}:{ss}</span>
    </div>
  );
}

/* ============================================================
   RESET ALL - shared button, used in the top bar and again in
   the summary row so it is never easy to miss
   ============================================================ */

function ResetAllButton({ onResetAll, className }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <button
      className={"reset-all-btn " + (confirmReset ? "danger " : "") + (className || "")}
      onClick={() => {
        if (confirmReset) {
          onResetAll();
          setConfirmReset(false);
        } else {
          setConfirmReset(true);
          setTimeout(() => setConfirmReset(false), 4000);
        }
      }}
    >
      <RotateCcw size={14} /> {confirmReset ? "Tap again to confirm" : "Reset all teams"}
    </button>
  );
}

/* ============================================================
   TOP BAR (dashboard)
   The connection badge lives here, not as the fixed floating
   one, so nothing else can overlap it.
   ============================================================ */

function TopBar({ connected, startedAt, onResetAll }) {
  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <BrandMark size={26} />
        <span className="top-bar-title">Digital Treasure Heist</span>
      </div>
      <div className="top-bar-right">
        <RoomClock startedAt={startedAt} />
        <ConnectionBadge connected={connected} floating={false} />
        <ResetAllButton onResetAll={onResetAll} />
      </div>
    </header>
  );
}

/* ============================================================
   JOIN SCREEN
   ============================================================ */

function JoinScreen({ onJoin, joining }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className="screen join-screen">
      <div className="join-head anim-rise">
        <BrandMark size={54} />
        <h1 className="brand-title">Digital Treasure Heist</h1>
        <p className="brand-sub">One phone per team. Enter your team number to begin.</p>
      </div>

      <div className="team-grid">
        {TEAM_NUMBERS.map((n, i) => (
          <button
            key={n}
            className={"team-pick anim-rise " + (selected === n ? "selected" : "")}
            style={{ animationDelay: i * 40 + "ms" }}
            onClick={() => setSelected(n)}
          >
            <span className="team-pick-num">{n}</span>
          </button>
        ))}
      </div>

      <button
        className="place-btn join-btn"
        disabled={!selected || joining}
        onClick={() => onJoin(selected)}
      >
        {joining ? "Joining..." : (
          <>
            Join as Team {selected || "?"} <ArrowRight size={16} />
          </>
        )}
      </button>
    </div>
  );
}

/* ============================================================
   DIGIT QUESTION SCREEN
   ============================================================ */

function DigitScreen({ teamState, prompts, cooldownRemaining, onSubmit }) {
  const [value, setValue] = useState("");
  const total = TOTAL_QUESTIONS;
  const idx = teamState.digitIndex;
  const prompt = prompts[idx] || "Decoded digit?";

  const submit = () => {
    if (value === "" || cooldownRemaining > 0) return;
    onSubmit(value);
    setValue("");
  };

  return (
    <div className="screen quiz-screen">
      <div className="progress-dots">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={"dot " + (i < idx ? "done" : i === idx ? "active" : "")} />
        ))}
        <span className="dot pill">Cipher</span>
      </div>

      <div className="card question-card anim-rise" key={idx}>
        <span className="q-index">Question {idx + 1} of {total}</span>
        <h2 className="q-prompt">{prompt}</h2>

        <input
          className="digit-input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 1))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="?"
        />

        <button className="place-btn" onClick={submit} disabled={value === "" || cooldownRemaining > 0}>
          {cooldownRemaining > 0 ? "Locked for " + cooldownRemaining + "s" : "Submit answer"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   CIPHER SCREEN
   T9 style: one slot per digit, tap cycles its letter.
   ============================================================ */

const KEYPAD = {
  2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO",
  7: "PQRS", 8: "TUV", 9: "WXYZ",
};

function CipherScreen({ teamState, keypadDigits, cooldownRemaining, onCycle, onSubmit }) {
  const positions = teamState.cipherPositions || keypadDigits.map(() => 0);
  const word = keypadDigits
    .map((d, i) => {
      const letters = KEYPAD[d] || "";
      return letters[positions[i] % letters.length] || "";
    })
    .join("");

  return (
    <div className="screen quiz-screen">
      <div className="progress-dots">
        {keypadDigits.map((_, i) => (
          <span key={i} className="dot done" />
        ))}
        <span className="dot pill active">Cipher</span>
      </div>

      <div className="card question-card anim-rise">
        <span className="q-index">Cypher submission</span>
        <h2 className="q-prompt">Match each digit to its letters and spell the hidden word.</h2>

        <div className="keypad-row">
          {keypadDigits.map((d, i) => {
            const letters = KEYPAD[d] || "";
            const letter = letters[positions[i] % letters.length] || "";
            return (
              <button key={i} className="keypad-slot" onClick={() => onCycle(i)}>
                <span className="keypad-digit">{d}</span>
                <span className="keypad-letters">{letters}</span>
                <span className="keypad-current">{letter}</span>
              </button>
            );
          })}
        </div>

        <div className="word-preview">
          {word.split("").map((ch, i) => (
            <span key={i} className="word-letter">{ch}</span>
          ))}
        </div>

        <button className="place-btn" onClick={onSubmit} disabled={cooldownRemaining > 0}>
          {cooldownRemaining > 0 ? "Locked for " + cooldownRemaining + "s" : "Submit word"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   COMPLETE SCREEN
   ============================================================ */

function CompleteScreen({ teamNumber, completedAt, joinedAt }) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    confetti({ particleCount: 160, spread: 140, origin: { y: 0.5 }, colors: ["#E11D2E", "#B91C1C", "#FFFFFF"] });
  }, []);

  const secs = completedAt && joinedAt ? Math.floor((completedAt - joinedAt) / 1000) : null;
  const mm = secs !== null ? String(Math.floor(secs / 60)).padStart(2, "0") : "--";
  const ss = secs !== null ? String(secs % 60).padStart(2, "0") : "--";

  return (
    <div className="screen join-screen">
      <div className="card complete-card anim-rise">
        <Trophy size={44} />
        <h2>Heist complete</h2>
        <p>Team {teamNumber} cracked the cipher in {mm}:{ss}.</p>
      </div>
    </div>
  );
}

/* ============================================================
   PARTICIPANT ROOT
   ============================================================ */

function ParticipantApp() {
  const [teamNumber, setTeamNumber] = useState(() => {
    const saved = localStorage.getItem("heist-team");
    return saved ? Number(saved) : null;
  });
  const [deviceToken] = useState(getOrCreateDeviceToken);
  const [joining, setJoining] = useState(false);
  const [toast, setToast] = useState(null);
  const toastId = useRef(0);

  const handleResult = useCallback((res) => {
    setJoining(false);
    if (!res) return;
    if (res.kind === "team-taken") {
      localStorage.removeItem("heist-team");
      setTeamNumber(null);
    }
    toastId.current += 1;
    setToast({ ...res, id: toastId.current });
  }, []);

  const { state, connected, dispatch } = useHeist({
    role: "participant",
    teamNumber,
    deviceToken,
    onResult: handleResult,
  });

  const joinTeam = (n) => {
    setJoining(true);
    localStorage.setItem("heist-team", String(n));
    setTeamNumber(n);
    dispatch({ type: "CLAIM_TEAM", teamNumber: n, deviceToken });
  };

  // If a saved team comes back "idle" - either the backend restarted, or the
  // facilitator hit reset on the dashboard - re-send the claim automatically.
  // Same device token, same team, so the server accepts it silently and this
  // phone never sees the team picker again; it just continues from digit 1.
  const autoClaimedRef = useRef(false);
  useEffect(() => {
    if (!teamNumber || !connected || !state) return;
    if (state.team && state.team.phase === "idle") {
      if (!autoClaimedRef.current) {
        autoClaimedRef.current = true;
        dispatch({ type: "CLAIM_TEAM", teamNumber, deviceToken });
      }
    } else {
      autoClaimedRef.current = false;
    }
  }, [teamNumber, connected, state, deviceToken, dispatch]);

  let body;
  if (!teamNumber) {
    body = <JoinScreen onJoin={joinTeam} joining={joining} />;
  } else if (!state || !state.team) {
    body = (
      <div className="screen join-screen">
        <div className="card anim-rise" style={{ textAlign: "center" }}>
          <p>Connecting to Team {teamNumber}...</p>
        </div>
      </div>
    );
  } else {
    const team = state.team;
    const cooldownRemaining = Math.max(0, Math.ceil(((team.cooldownUntil || 0) - Date.now()) / 1000));
    if (team.phase === "digits") {
      body = (
        <DigitScreen
          teamState={team}
          prompts={state.prompts}
          cooldownRemaining={cooldownRemaining}
          onSubmit={(value) => dispatch({ type: "SUBMIT_DIGIT", teamNumber, deviceToken, value })}
        />
      );
    } else if (team.phase === "cipher") {
      body = (
        <CipherScreen
          teamState={team}
          keypadDigits={state.keypadDigits}
          cooldownRemaining={cooldownRemaining}
          onCycle={(slotIndex) => dispatch({ type: "CYCLE_LETTER", teamNumber, deviceToken, slotIndex })}
          onSubmit={() => dispatch({ type: "SUBMIT_CIPHER", teamNumber, deviceToken })}
        />
      );
    } else if (team.phase === "complete") {
      body = <CompleteScreen teamNumber={teamNumber} completedAt={team.completedAt} joinedAt={team.joinedAt} />;
    } else {
      body = (
        <div className="screen join-screen">
          <div className="card anim-rise" style={{ textAlign: "center" }}>
            <p>Waiting for the facilitator...</p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="app-root">
      <GlowBackdrop />
      <ConnectionBadge connected={connected} />
      <Toast toast={toast} onClear={() => setToast(null)} />
      {body}
      <GlobalStyles />
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */

const PHASE_LABEL = {
  idle: "Not joined",
  digits: "In progress",
  cipher: "Cipher",
  complete: "Complete",
};

function TeamCard({ team, onReset }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const stepsDone =
    team.phase === "complete" ? TOTAL_QUESTIONS + 1 : team.phase === "cipher" ? TOTAL_QUESTIONS : team.digitIndex;
  const totalSteps = TOTAL_QUESTIONS + 1;

  return (
    <div className={"team-card " + (team.phase === "complete" ? "glow-complete" : team.claimed ? "glow-active" : "")}>
      <div className="team-card-head">
        <span className="team-card-num">{team.number}</span>
        <span className={"phase-pill phase-" + team.phase}>{PHASE_LABEL[team.phase]}</span>
      </div>

      <div className="team-card-dots">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span key={i} className={"mini-dot " + (i < stepsDone ? "done" : "")} />
        ))}
      </div>

      <div className="team-card-foot">
        <span className="team-card-meta">
          {team.joinedAt ? new Date(team.joinedAt).toLocaleTimeString() : "Waiting to join"}
        </span>
        <button
          className={"card-reset-btn " + (confirmReset ? "danger" : "")}
          onClick={() => {
            if (confirmReset) {
              onReset(team.number);
              setConfirmReset(false);
            } else {
              setConfirmReset(true);
              setTimeout(() => setConfirmReset(false), 3000);
            }
          }}
        >
          {confirmReset ? "Confirm?" : "Reset"}
        </button>
      </div>
    </div>
  );
}

function TeamProgressChart({ teams }) {
  const totalSteps = TOTAL_QUESTIONS + 1; // 4 digits + cipher
  return (
    <div className="card progress-chart">
      <h3 className="chart-title">Team progress</h3>
      <div className="chart-rows">
        {teams.map((t) => {
          const steps =
            t.phase === "complete" ? totalSteps : t.phase === "cipher" ? TOTAL_QUESTIONS : t.digitIndex;
          const pct = Math.round((steps / totalSteps) * 100);
          return (
            <div key={t.number} className="chart-row">
              <span className="chart-label">T{t.number}</span>
              <div className="chart-track">
                <div className={"chart-fill " + (t.phase === "complete" ? "complete" : "")} style={{ width: pct + "%" }} />
              </div>
              <span className="chart-value">{steps}/{totalSteps}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardApp() {
  const { state, connected, dispatch } = useHeist({ role: "dashboard", teamNumber: null, deviceToken: null });
  const teams =
    state && Array.isArray(state.teams)
      ? state.teams
      : TEAM_NUMBERS.map((n) => ({ number: n, claimed: false, phase: "idle", digitIndex: 0, joinedAt: null, completedAt: null }));

  const firstJoin = teams.reduce((min, t) => (t.joinedAt && (!min || t.joinedAt < min) ? t.joinedAt : min), null);
  const claimedCount = teams.filter((t) => t.claimed).length;
  const completeCount = teams.filter((t) => t.phase === "complete").length;

  const resetAll = () => dispatch({ type: "RESET_ALL" });

  return (
    <div className="app-root dashboard-root">
      <GlowBackdrop />
      <TopBar connected={connected} startedAt={firstJoin} onResetAll={resetAll} />

      <div className="dash-summary">
        <div className="summary-chip"><Users size={15} /> {claimedCount}/10 joined</div>
        <div className="summary-chip"><Trophy size={15} /> {completeCount}/10 complete</div>
        <ResetAllButton onResetAll={resetAll} className="summary-reset" />
      </div>

      <TeamProgressChart teams={teams} />

      <div className="dash-grid">
        {teams.map((t) => (
          <TeamCard key={t.number} team={t} onReset={(n) => dispatch({ type: "RESET_TEAM", teamNumber: n })} />
        ))}
      </div>

      <GlobalStyles />
    </div>
  );
}

/* ============================================================
   ROOT
   ============================================================ */

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const isDashboard = params.get("view") === "dashboard";
  return isDashboard ? <DashboardApp /> : <ParticipantApp />;
}

/* ============================================================
   STYLES - white with red glow
   ============================================================ */

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600;700;800&display=swap');

      :root {
        --white: #FFFFFF;
        --off-white: #FAFAFA;
        --red: #E11D2E;
        --red-deep: #B91C1C;
        --red-tint: #FEE2E2;
        --ink: #17181C;
        --muted: #6B6E76;
        --line: rgba(23,24,28,0.09);
        --good: #15803D;
        --bad: #C2261B;
        --warn: #B45309;
      }

      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body, #root { margin: 0; min-height: 100%; }
      body {
        background: var(--off-white);
        color: var(--ink);
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        overflow-x: hidden;
      }
      h1, h2, h3 { font-family: 'Fraunces', Georgia, serif; margin: 0; }

      .app-root { position: relative; min-height: 100vh; min-height: 100dvh; width: 100%; }
      .screen { position: relative; z-index: 2; }

      @keyframes riseIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
      @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(225,29,46,0.28); } 50% { box-shadow: 0 0 0 10px rgba(225,29,46,0); } }
      @keyframes floatGlow { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(3vw,2vw,0) scale(1.1); } }
      .anim-rise { animation: riseIn .5s cubic-bezier(.2,.8,.3,1) both; }

      .glow { position: fixed; border-radius: 50%; filter: blur(120px); z-index: 0; pointer-events: none; }
      .glow-a { width: 46vw; height: 46vw; top: -18vw; left: -14vw; background: var(--red-tint); opacity: 0.85; animation: floatGlow 30s ease-in-out infinite; }
      .glow-b { width: 40vw; height: 40vw; bottom: -18vw; right: -12vw; background: var(--red-tint); opacity: 0.7; animation: floatGlow 36s ease-in-out infinite reverse; }

      .brand-logo { display: block; width: auto; }
      .brand-title { font-size: clamp(26px, 5vw, 44px); font-weight: 800; margin: 14px 0 6px; color: var(--ink); }
      .brand-sub { color: var(--muted); margin: 0; font-size: 14.5px; }

      .conn-badge {
        display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
        background: #fff; border: 1px solid var(--line);
        padding: 5px 11px; border-radius: 999px; color: var(--muted);
        box-shadow: 0 6px 18px -12px rgba(0,0,0,0.2);
      }
      .conn-badge.floating { position: fixed; top: max(10px, env(safe-area-inset-top)); right: 10px; z-index: 60; }
      .conn-badge.ok svg { color: var(--good); }
      .conn-badge.bad svg { color: var(--bad); }
      /* the top bar carries its own non-floating badge on the dashboard, so
         the fixed one is redundant there and would otherwise sit on top of
         whatever the bar places in that corner */
      .dashboard-root > .conn-badge.floating { display: none; }

      .card {
        background: var(--white); border: 1px solid var(--line); border-radius: 20px;
        box-shadow: 0 20px 50px -30px rgba(225,29,46,0.35);
      }

      /* ---------- Join ---------- */
      .join-screen {
        min-height: 100vh; min-height: 100dvh;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        text-align: center; padding: 40px 18px calc(40px + env(safe-area-inset-bottom));
      }
      .join-head { margin-bottom: 24px; display: flex; flex-direction: column; align-items: center; }
      .team-grid {
        display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
        width: 100%; max-width: 420px; margin-bottom: 22px;
      }
      .team-pick {
        aspect-ratio: 1 / 1; border-radius: 16px; border: 1.5px solid var(--line);
        background: var(--white); cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: border-color .15s, box-shadow .15s, transform .15s;
      }
      .team-pick-num { font-size: 22px; font-weight: 800; color: var(--ink); font-family: 'Fraunces', serif; }
      .team-pick:hover { border-color: var(--red); transform: translateY(-2px); }
      .team-pick.selected {
        border-color: var(--red); background: var(--red-tint);
        box-shadow: 0 0 0 3px rgba(225,29,46,0.15);
        animation: pulseGlow 1.6s ease-in-out infinite;
      }
      .team-pick.selected .team-pick-num { color: var(--red-deep); }

      .place-btn {
        width: 100%; max-width: 420px; padding: 15px; font-size: 15px; font-weight: 800; font-family: inherit;
        cursor: pointer; border: none; border-radius: 14px; color: #fff;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        background: linear-gradient(120deg, var(--red), var(--red-deep));
        box-shadow: 0 14px 30px -14px var(--red);
        transition: transform .15s, opacity .2s;
      }
      .place-btn:active:not(:disabled) { transform: scale(0.98); }
      .place-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
      .join-btn { margin-top: 4px; }

      .complete-card { padding: 40px 30px; display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 420px; }
      .complete-card svg { color: var(--red); }
      .complete-card h2 { font-size: 26px; }
      .complete-card p { color: var(--muted); margin: 0; }

      .toast {
        position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
        z-index: 200; display: flex; align-items: center; gap: 11px; text-align: left;
        padding: 18px 24px; border-radius: 16px; font-size: 15.5px; font-weight: 600; line-height: 1.4;
        min-width: 280px; max-width: min(520px, 92vw);
        box-shadow: 0 20px 46px -20px rgba(0,0,0,0.32);
      }
      .toast svg { flex: 0 0 auto; width: 20px; height: 20px; }
      .toast-good { background: #E7F6ED; border: 1px solid rgba(21,128,61,0.4); color: #14532D; }
      .toast-bad { background: var(--red-tint); border: 1px solid rgba(225,29,46,0.4); color: var(--red-deep); }
      .toast-warn { background: #FEF3E2; border: 1px solid rgba(180,83,9,0.4); color: var(--warn); }

      /* ---------- Quiz / cipher ---------- */
      .quiz-screen {
        min-height: 100vh; min-height: 100dvh; max-width: 480px; margin: 0 auto;
        display: flex; flex-direction: column; justify-content: center; gap: 20px;
        padding: 24px 18px calc(40px + env(safe-area-inset-bottom));
      }
      .progress-dots { display: flex; align-items: center; justify-content: center; gap: 8px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
      .dot.done { background: var(--good); }
      .dot.active { background: var(--red); animation: pulseGlow 1.6s ease-in-out infinite; }
      .dot.pill { width: auto; height: auto; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: var(--line); color: var(--muted); }
      .dot.pill.active { background: var(--red); color: #fff; }

      .question-card { padding: 30px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
      .q-index { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--red); font-weight: 700; }
      .q-prompt { font-size: 22px; line-height: 1.3; }
      .digit-input {
        width: 90px; height: 90px; text-align: center; font-size: 44px; font-weight: 800;
        font-family: 'Fraunces', serif; color: var(--ink);
        background: var(--off-white); border: 2px solid var(--line); border-radius: 18px;
      }
      .digit-input:focus { outline: none; border-color: var(--red); box-shadow: 0 0 0 4px rgba(225,29,46,0.15); }

      .keypad-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; width: 100%; }
      .keypad-slot {
        display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 6px;
        border-radius: 14px; border: 1.5px solid var(--line); background: var(--off-white); cursor: pointer;
        transition: border-color .15s, background .15s;
      }
      .keypad-slot:hover { border-color: var(--red); background: var(--red-tint); }
      .keypad-digit { font-size: 20px; font-weight: 800; color: var(--muted); font-family: 'Fraunces', serif; }
      .keypad-letters { font-size: 9px; letter-spacing: 0.1em; color: var(--muted); }
      .keypad-current { font-size: 26px; font-weight: 800; color: var(--red-deep); font-family: 'Fraunces', serif; }
      .word-preview { display: flex; gap: 8px; }
      .word-letter {
        width: 40px; height: 48px; display: flex; align-items: center; justify-content: center;
        font-size: 24px; font-weight: 800; border-bottom: 3px solid var(--red);
        color: var(--ink); font-family: 'Fraunces', serif;
      }

      /* ---------- Top bar (dashboard) ---------- */
      .top-bar {
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
        padding: 14px 22px; background: var(--white); border-bottom: 1px solid var(--line);
        position: sticky; top: 0; z-index: 40;
        box-shadow: 0 1px 0 var(--red), 0 8px 24px -6px rgba(225,29,46,0.4);
      }
      .top-bar-brand { display: flex; align-items: center; gap: 10px; }
      .top-bar-title { font-family: 'Fraunces', serif; font-weight: 700; font-size: 18px; }
      .top-bar-right { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .room-clock { display: flex; align-items: center; gap: 6px; font-weight: 800; font-variant-numeric: tabular-nums; font-family: 'Fraunces', serif; color: var(--red-deep); }
      .reset-all-btn {
        display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; cursor: pointer;
        background: var(--white); border: 1.5px solid var(--red); border-radius: 12px;
        color: var(--red-deep); font-family: inherit; font-size: 12.5px; font-weight: 700;
      }
      .reset-all-btn.danger { background: var(--red); color: #fff; }
      .summary-reset { margin-left: auto; }

      /* ---------- Dashboard grid ---------- */
      .dashboard-root { padding-bottom: 40px; }
      .dash-summary { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 16px 22px 0; }
      .summary-chip {
        display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px;
        background: var(--white); border: 1px solid var(--line); font-size: 12.5px; font-weight: 700; color: var(--ink);
      }
      .summary-chip svg { color: var(--red); }

      .progress-chart { margin: 18px 22px 0; padding: 18px 20px; position: relative; z-index: 2; }
      .chart-title { font-size: 15px; font-weight: 700; margin-bottom: 14px; color: var(--ink); }
      .chart-rows { display: flex; flex-direction: column; gap: 10px; }
      .chart-row { display: flex; align-items: center; gap: 10px; }
      .chart-label { width: 34px; flex: 0 0 auto; font-size: 12px; font-weight: 700; color: var(--muted); }
      .chart-track { flex: 1; height: 14px; border-radius: 999px; background: var(--off-white); border: 1px solid var(--line); overflow: hidden; }
      .chart-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--red), var(--red-deep)); transition: width .6s ease; }
      .chart-fill.complete { background: linear-gradient(90deg, var(--good), #0d5c2c); }
      .chart-value { width: 34px; flex: 0 0 auto; text-align: right; font-size: 11.5px; font-weight: 700; color: var(--muted); }

      .dash-grid {
        position: relative; z-index: 2;
        display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px;
        padding: 18px 22px;
      }
      .team-card {
        background: var(--white); border: 1.5px solid var(--line); border-radius: 18px; padding: 16px;
        display: flex; flex-direction: column; gap: 12px;
        transition: border-color .3s, box-shadow .3s;
      }
      .team-card.glow-active { border-color: rgba(225,29,46,0.4); box-shadow: 0 0 0 3px rgba(225,29,46,0.08), 0 16px 34px -22px var(--red); }
      .team-card.glow-complete { border-color: rgba(21,128,61,0.4); box-shadow: 0 0 0 3px rgba(21,128,61,0.08); }
      .team-card-head { display: flex; align-items: center; justify-content: space-between; }
      .team-card-num { font-size: 26px; font-weight: 800; font-family: 'Fraunces', serif; }
      .phase-pill { font-size: 10.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
      .phase-idle { background: var(--line); color: var(--muted); }
      .phase-digits { background: var(--red-tint); color: var(--red-deep); }
      .phase-cipher { background: #FEF3E2; color: var(--warn); }
      .phase-complete { background: #E7F6ED; color: var(--good); }
      .team-card-dots { display: flex; gap: 5px; }
      .mini-dot { flex: 1; height: 6px; border-radius: 999px; background: var(--line); }
      .mini-dot.done { background: var(--red); }
      .team-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .team-card-meta { font-size: 11px; color: var(--muted); }
      .card-reset-btn {
        font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 9px; cursor: pointer;
        background: var(--off-white); border: 1px solid var(--line); color: var(--muted);
      }
      .card-reset-btn.danger { background: var(--red); border-color: var(--red); color: #fff; }

      @media (max-width: 620px) {
        .team-grid { grid-template-columns: repeat(4, 1fr); }
        .keypad-row { grid-template-columns: repeat(4, 1fr); }
        .top-bar { flex-direction: column; align-items: flex-start; }
        .dash-summary { flex-wrap: wrap; }
        .summary-reset { margin-left: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
      }
    `}</style>
  );
}