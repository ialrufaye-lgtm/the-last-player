// Shared client-side types. Payload shapes mirror PROTOCOL.md; where the protocol
// leaves payload detail open, we defensively accept the shapes documented in CLIENT_NOTES.md.

export interface PlayerInfo {
  id: string;
  name: string;
  alive: boolean;
  score: number;
  isHost: boolean;
  connected: boolean;
  zone: number; // survival grid zone 0..24, -1 when n/a
  tile: number; // hide_seek tile 0..63, -1 when n/a
}

export interface StandingEntry {
  id: string;
  name: string;
  score: number;
  alive: boolean;
}

export interface LobbyMsg {
  code: string;
  players: { id: string; name: string }[];
  count: number;
  canStart: boolean;
}

export interface RoundStartMsg {
  roundIndex: number;
  type: string;
  title: string;
  rules: string;
  endsAt: number;
  payload: any;
}

export interface RoundTickMsg {
  type: string;
  endsAt: number;
  data: any;
}

export interface RoundEndMsg {
  eliminated: string[];
  survivors: number;
  standings: StandingEntry[];
}

export interface PodiumMsg {
  winner: { id: string; name: string };
  top: StandingEntry[];
}

export interface QuizQuestion {
  qid: number;
  q: string; // server field; some builds used `question`
  question?: string;
  choices: string[];
}

export type ConnStatus = "idle" | "connecting" | "connected" | "left";
