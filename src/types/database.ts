// Generated from the Supabase schema (supabase gen types). Regenerate after migrations.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Rel = {
  foreignKeyName: string
  columns: string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: string[]
}

type GameMode = "casual" | "ranked" | "friend"
type LedgerReason = "signup_bonus" | "daily_bonus" | "stake" | "payout"
type MatchStatus = "active" | "finished"
type MoveEnum = "rock" | "paper" | "scissors"

type ChallengesRow = {
  code: string
  created_at: string
  creator: string
  expires_at: string
  id: string
  match_id: string | null
  stake: number
}
type ChipLedgerRow = {
  balance_after: number
  created_at: string
  delta: number
  id: number
  match_id: string | null
  reason: LedgerReason
  user_id: string
}
type MatchesRow = {
  created_at: string
  elo_delta_a: number | null
  elo_delta_b: number | null
  finished_at: string | null
  id: string
  mode: GameMode
  moved_a: boolean
  moved_b: boolean
  player_a: string
  player_b: string
  rematch_id: string | null
  rematch_of: string | null
  rematch_vote_a: boolean | null
  rematch_vote_b: boolean | null
  round_deadline: string | null
  round_no: number
  round_starts_at: string | null
  score_a: number
  score_b: number
  stake: number
  status: MatchStatus
  winner: string | null
}
type QueueRow = {
  elo: number
  joined_at: string
  last_seen: string
  mode: GameMode
  stake: number
  user_id: string
}
type ProfilesRow = {
  avatar_url: string | null
  chips: number
  created_at: string
  elo: number
  games_played: number
  id: string
  last_daily_claim: string | null
  losses: number
  ranked_games: number
  updated_at: string
  username: string
  wins: number
}
type RoundMovesRow = {
  created_at: string
  match_id: string
  move: MoveEnum
  player_id: string
  round_no: number
}
type RoundsRow = {
  auto_a: boolean
  auto_b: boolean
  match_id: string
  move_a: MoveEnum
  move_b: MoveEnum
  resolved_at: string
  round_no: number
  winner: string | null
}

// Clients cannot write tables directly (RLS + revoked grants), so Insert
// types are intentionally loose; all writes go through RPC functions.
type T<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: Rel[] }

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      challenges: T<ChallengesRow>
      chip_ledger: T<ChipLedgerRow>
      matches: T<MatchesRow>
      matchmaking_queue: T<QueueRow>
      profiles: T<ProfilesRow>
      round_moves: T<RoundMovesRow>
      rounds: T<RoundsRow>
    }
    Views: { [_ in never]: never }
    Functions: {
      accept_challenge: { Args: { p_code: string }; Returns: Json }
      cancel_challenge: { Args: never; Returns: undefined }
      claim_daily: { Args: never; Returns: Json }
      create_challenge: { Args: { p_stake?: number }; Returns: Json }
      get_challenge: { Args: { p_code: string }; Returns: Json }
      get_match_state: { Args: { p_match: string }; Returns: Json }
      join_queue: { Args: { p_mode: GameMode; p_stake?: number }; Returns: Json }
      leave_queue: { Args: never; Returns: undefined }
      poll_queue: { Args: never; Returns: Json }
      submit_move: { Args: { p_match: string; p_move: MoveEnum }; Returns: Json }
      tick_match: { Args: { p_match: string }; Returns: Json }
      vote_rematch: { Args: { p_accept: boolean; p_match: string }; Returns: Json }
    }
    Enums: {
      game_mode: GameMode
      ledger_reason: LedgerReason
      match_status: MatchStatus
      move: MoveEnum
    }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<N extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][N]["Row"]
export type Enums<N extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][N]
