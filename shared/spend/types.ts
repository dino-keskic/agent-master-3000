/**
 * What the Spend panel and a task's spend breakdown are sent: windows, the
 * rankings drawn beside them, the averages history, and one task's phases.
 * The sums behind them are the rest of `shared/spend/`.
 */

/** One row of a spend breakdown — a model, a project, a stage, an agent. */
export interface SpendBucket {
  /** Stable identity for the row (model id, session id, agent name). */
  key: string;
  label: string;
  cost: number;
  tokens?: number;
  /** Assistant messages attributed to this row. */
  messages?: number;
}

/** Spend over a closed time range. */
export interface SpendWindow {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
  cost: number;
  tokens?: number;
  /** Assistant turns in the window — what "11 turns · 3 sessions" counts. */
  messages?: number;
  /** Distinct sessions that spent anything in the window. */
  sessions?: number;
}

/** One calendar month's cost and what it averaged per day. */
export interface MonthlyDailyAverage {
  /** `YYYY-MM` in local time. */
  month: string;
  cost: number;
  avgPerDay: number;
  /** Days divided by: the whole month, or the days elapsed for the current one. */
  days: number;
}

/** One calendar week's cost. The open week is partial, so it is not a full week. */
export interface WeeklySpendAverage {
  /** `YYYY-MM-DD` of the week's first local day. */
  week: string;
  cost: number;
  /** 7 for a finished week; days elapsed for the one still in progress. */
  days: number;
  /** Still in progress — `cost` is not a finished week and stays out of the mean. */
  partial: boolean;
}

/** One row of the "most expensive sessions" ranking. */
export interface SpendSessionRow {
  sessionId: string;
  title: string;
  /** The model that spent the most in this session — a session can switch models. */
  model?: string;
  project?: string;
  cost: number;
  tokens: number;
  messages: number;
}

/**
 * Board-wide spend. Answers "what am I spending this week, and on what" —
 * the question every per-card dollar figure raises and none of them answer.
 */
export interface SpendSummary {
  generatedAt: number;
  today: SpendWindow;
  week: SpendWindow;
  month: SpendWindow;
  /** Highest cost first, over the month window. */
  byModel: SpendBucket[];
  /** Highest cost first, over the month window. Unmatched work is "Other". */
  byProject: SpendBucket[];
  /** Highest cost first, over the month window. Unattributed turns are "Unknown agent". */
  byAgent: SpendBucket[];
  /** The same slice of the previous week, so a part-week compares to a part-week. */
  previousWeek: SpendWindow;
  /** Costliest sessions of the month window, highest first. */
  topSessions: SpendSessionRow[];
  /** Every day of the month window, oldest first, zero-filled. */
  daily: { date: string; cost: number }[];
  /** Past complete months plus the current one, oldest first. Empty when the history read failed. */
  monthly: MonthlyDailyAverage[];
  /**
   * Recent calendar weeks, oldest first, the open week last. The board load
   * only has the weeks its short read covers; the spend panel replaces them
   * with the longer history.
   */
  weekly: WeeklySpendAverage[];
  /** Set when OpenCode's database could not be read. */
  error?: string;
}

/** Per-task spend, broken down the three ways a user reasons about a task. */
export interface TaskSpendBreakdown {
  taskId: string;
  total: number;
  tokens?: number;
  byModel: SpendBucket[];
  /**
   * One row per stage a linked session worked in. A session that spanned Plan
   * and Execute reports two rows, split at the moment it moved.
   */
  byPhase: SpendBucket[];
  byAgent: SpendBucket[];
  generatedAt: number;
  error?: string;
}
