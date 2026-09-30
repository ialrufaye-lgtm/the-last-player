import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Client, Room } from "colyseus.js";
import type {
  ConnStatus,
  LobbyMsg,
  PlayerInfo,
  PodiumMsg,
  RoundEndMsg,
  RoundStartMsg,
  RoundTickMsg,
  StandingEntry,
} from "./types";
import { STR } from "./strings";

// Default: same host that served the client, server port 2567.
// Override with VITE_SERVER_URL (e.g. wss://arena.example.com).
// Dev (Vite): game server is on :2567. Prod: the server serves the client
// itself, so use the same origin (wss: under https).
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ||
  (import.meta.env.DEV
    ? `ws://${window.location.hostname}:2567`
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`);

export interface ToastItem {
  id: number;
  text: string;
}

interface GameContextValue {
  status: ConnStatus;
  error: string | null;
  join: (name: string, code: string) => Promise<void>;
  rejoin: () => void;
  send: (type: string, data?: any) => void;
  myId: string | null;
  me: PlayerInfo | null;
  players: PlayerInfo[];
  phase: string;
  roundIndex: number;
  roundType: string;
  endsAt: number;
  aliveCount: number;
  leaderboard: StandingEntry[];
  lobby: LobbyMsg | null;
  currentRound: RoundStartMsg | null;
  tick: RoundTickMsg | null;
  roundEnd: RoundEndMsg | null;
  eliminatedReason: string | null;
  podium: PodiumMsg | null;
  toasts: ToastItem[];
  dismissToast: (id: number) => void;
  lastName: string;
  lastCode: string;
  isHost: boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}

let toastSeq = 1;

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [phase, setPhase] = useState<string>("lobby");
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundType, setRoundType] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [aliveCount, setAliveCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState<StandingEntry[]>([]);
  const [lobby, setLobby] = useState<LobbyMsg | null>(null);
  const [currentRound, setCurrentRound] = useState<RoundStartMsg | null>(null);
  const [tick, setTick] = useState<RoundTickMsg | null>(null);
  const [roundEnd, setRoundEnd] = useState<RoundEndMsg | null>(null);
  const [eliminatedReason, setEliminatedReason] = useState<string | null>(null);
  const [podium, setPodium] = useState<PodiumMsg | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [lastName, setLastName] = useState("");
  const [lastCode, setLastCode] = useState("");

  const roomRef = useRef<Room<any> | null>(null);
  const requestedCodeRef = useRef<string | null>(null);

  const pushToast = useCallback((text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const syncState = useCallback((state: any) => {
    const ps: PlayerInfo[] = [];
    try {
      if (state && state.players) {
        state.players.forEach((p: any, id: string) => {
          ps.push({
            id,
            name: String(p.name ?? "لاعب"),
            alive: !!p.alive,
            score: Number(p.score ?? 0),
            isHost: !!p.isHost,
            connected: p.connected !== false,
            zone: Number(p.zone ?? -1),
            tile: Number(p.tile ?? -1),
          });
        });
      }
    } catch {
      /* ignore malformed patches */
    }
    setPlayers(ps);
    setPhase(String(state?.phase ?? "lobby"));
    setRoundIndex(Number(state?.roundIndex ?? 0));
    setRoundType(String(state?.roundType ?? ""));
    setEndsAt(Number(state?.endsAt ?? 0));
    setAliveCount(Number(state?.aliveCount ?? ps.filter((p) => p.alive).length));

    const lb: StandingEntry[] = [];
    try {
      if (state && state.leaderboard) {
        state.leaderboard.forEach((e: any) => {
          lb.push({
            id: String(e.id ?? ""),
            name: String(e.name ?? "لاعب"),
            score: Number(e.score ?? 0),
            alive: !!e.alive,
          });
        });
      }
    } catch {
      /* ignore */
    }
    setLeaderboard(lb);
  }, []);

  const resetMatch = useCallback(() => {
    setPlayers([]);
    setPhase("lobby");
    setRoundIndex(0);
    setRoundType("");
    setEndsAt(0);
    setAliveCount(0);
    setLeaderboard([]);
    setLobby(null);
    setCurrentRound(null);
    setTick(null);
    setRoundEnd(null);
    setEliminatedReason(null);
    setPodium(null);
    setToasts([]);
  }, []);

  const join = useCallback(
    async (name: string, code: string) => {
      const cleanName = name.trim().slice(0, 20);
      const cleanCode = code.trim().toUpperCase().slice(0, 8);
      if (!cleanName) {
        setError(STR.nameRequired);
        return;
      }
      setStatus("connecting");
      setError(null);
      resetMatch();
      try {
        const client = new Client(SERVER_URL);
        requestedCodeRef.current = cleanCode || null;
        setLastName(cleanName);
        setLastCode(cleanCode);

        // Room codes are resolved server-side via HTTP, then joined by id
        // (Colyseus joinOrCreate cannot filter rooms by metadata code).
        let room: Room<any>;
        if (cleanCode) {
          const httpBase = SERVER_URL.replace(/^ws/, "http");
          try {
            const res = await fetch(
              `${httpBase}/api/room-by-code/${encodeURIComponent(cleanCode)}`
            );
            if (res.ok) {
              const { roomId } = (await res.json()) as { roomId: string };
              room = await client.joinById(roomId, { name: cleanName });
            } else {
              pushToast(STR.codeNotFound);
              requestedCodeRef.current = null;
              room = await client.joinOrCreate("last_player", {
                name: cleanName,
              });
            }
          } catch {
            pushToast(STR.codeNotFound);
            requestedCodeRef.current = null;
            room = await client.joinOrCreate("last_player", {
              name: cleanName,
            });
          }
        } else {
          room = await client.joinOrCreate("last_player", { name: cleanName });
        }
        roomRef.current = room;
        setMyId(room.sessionId);

        room.onStateChange((state: any) => syncState(state));

        room.onMessage("lobby", (msg: LobbyMsg) => {
          setLobby(msg);
          const wanted = requestedCodeRef.current;
          if (wanted && msg.code && msg.code.toUpperCase() !== wanted) {
            pushToast(STR.codeNotFound);
            requestedCodeRef.current = null; // notify once
          }
        });
        room.onMessage("round_start", (msg: RoundStartMsg) => {
          setCurrentRound(msg);
          setTick(null);
          setRoundEnd(null);
        });
        room.onMessage("round_tick", (msg: RoundTickMsg) => {
          setTick(msg);
        });
        room.onMessage("round_end", (msg: RoundEndMsg) => {
          setRoundEnd(msg);
        });
        room.onMessage("eliminated", (msg: { reason: string }) => {
          setEliminatedReason(String(msg?.reason ?? ""));
        });
        room.onMessage("podium", (msg: PodiumMsg) => {
          setPodium(msg);
        });
        room.onMessage("toast", (msg: { text: string }) => {
          pushToast(String(msg?.text ?? ""));
        });

        room.onLeave(() => {
          roomRef.current = null;
          setStatus("left");
        });
        room.onError((code: number, message?: string) => {
          pushToast(`${STR.toastError}: ${message || code}`);
        });

        setStatus("connected");
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        setError(
          msg.includes("room_full") || msg.includes("full")
            ? "الغرفة ممتلئة (١٠٠ لاعب) — جرّب رمزًا آخر"
            : `تعذّر الاتصال بالسيرفر (${SERVER_URL}). تأكد أنه يعمل ثم حاول مجددًا.`
        );
        setStatus("idle");
      }
    },
    [pushToast, resetMatch, syncState]
  );

  const rejoin = useCallback(() => {
    if (lastName) void join(lastName, lastCode);
    else setStatus("idle");
  }, [join, lastCode, lastName]);

  const send = useCallback((type: string, data?: any) => {
    try {
      roomRef.current?.send(type, data);
    } catch {
      /* ignore send failures; server validates anyway */
    }
  }, []);

  const me = useMemo(
    () => players.find((p) => p.id === myId) ?? null,
    [players, myId]
  );

  const value: GameContextValue = {
    status,
    error,
    join,
    rejoin,
    send,
    myId,
    me,
    players,
    phase,
    roundIndex,
    roundType,
    endsAt,
    aliveCount,
    leaderboard,
    lobby,
    currentRound,
    tick,
    roundEnd,
    eliminatedReason,
    podium,
    toasts,
    dismissToast,
    lastName,
    lastCode,
    isHost: !!me?.isHost,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export { SERVER_URL };
