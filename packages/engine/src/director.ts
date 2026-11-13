import type { MeetingSeat } from "./meeting-types";

/**
 * The director (ADR 0178): the three decisions a meeting makes about itself, kept pure so they can be tested without a
 * database, a model or a clock. Everything that talks to runs, messages or people lives in meetings.ts.
 */

export const MEETING_MODES = ["sequential", "free", "brainstorm", "debate", "host_summary"] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

export interface TurnPlan {
  seatIndex: number;
  round: number;
}

/** One turn per seat, in the order the mode asks for. */
export function planTurns(seats: MeetingSeat[], mode: MeetingMode, round: number): TurnPlan[] {
  const count = seats.length;
  if (count === 0) return [];
  const at = (seatIndex: number): TurnPlan => ({ seatIndex, round });

  switch (mode) {
    case "sequential":
      return seats.map((_, index) => at(index));
    case "free":
      // Everyone may speak, in seat order: the quoting is what makes it a discussion, not the order.
      return seats.map((_, index) => at(index));
    case "brainstorm":
      // Rotated per round so the same seat does not always open.
      return seats.map((_, index) => at((index + round - 1) % count));
    case "debate": {
      // Two halves, alternating: the first half proposes, the second answers.
      const half = Math.ceil(count / 2);
      const order: number[] = [];
      for (let i = 0; i < half; i += 1) {
        order.push(i);
        if (i + half < count) order.push(i + half);
      }
      return order.map(at);
    }
    case "host_summary":
      // Only the chair closes the round.
      return [at(count - 1)];
    default:
      return seats.map((_, index) => at(index));
  }
}

export interface ConvergenceInput {
  round: number;
  maxRounds: number;
  /** Share of the agenda items that got an answer, 0..1. */
  coverage: number;
  /** The chair says the goal is met. */
  goalMet: boolean;
  /** A person stopped it. */
  chairStopped?: boolean;
  /** Below this coverage a meeting may not converge on its own. */
  minCoverage?: number;
}

export interface ConvergenceVerdict {
  stop: boolean;
  reason: "chair_stopped" | "max_rounds" | "converged" | "continue";
}

/** Stop or continue, with the reason a person will read. Never invents a convergence the evidence does not support. */
export function assessConvergence(input: ConvergenceInput): ConvergenceVerdict {
  if (input.chairStopped) return { stop: true, reason: "chair_stopped" };
  if (input.round >= input.maxRounds) return { stop: true, reason: "max_rounds" };
  const minimum = input.minCoverage ?? 0.8;
  if (input.goalMet && input.coverage >= minimum) return { stop: true, reason: "converged" };
  return { stop: false, reason: "continue" };
}

export interface Speech {
  seatName: string;
  text: string;
}

export interface ExtractedDecision {
  decision: string;
  conditions?: string;
  dissent?: string;
}

const OPPOSITION = /(反对|不建议|不同意|风险|隐患|but |however|disagree|would not)/i;
const CONDITION = /(前提|条件|除非|只要|如果|仅当|unless|provided|only if)/i;

/**
 * What the meeting decided, from what was said: the chair's last speech is the decision, the strongest sentence
 * against it is kept as dissent, a condition is kept when the decision itself states one. Nothing is invented: no
 * chair speech, no decision.
 */
export function extractDecision(speeches: Speech[]): ExtractedDecision | null {
  const spoken = speeches.filter((s) => s.text.trim().length > 0);
  if (!spoken.length) return null;
  const chair = spoken[spoken.length - 1]!;
  const decision = chair.text.trim();
  if (decision.length < 8) return null;

  const opposing = spoken
    .slice(0, -1)
    .filter((s) => OPPOSITION.test(s.text))
    .sort((a, b) => b.text.length - a.text.length)[0];

  const conditional = [decision, ...spoken.slice(0, -1).map((s) => s.text)].find((text) => CONDITION.test(text));

  return {
    decision,
    conditions: conditional && conditional !== decision ? conditional.trim().slice(0, 500) : undefined,
    dissent: opposing ? opposing.text.trim().slice(0, 500) : undefined,
  };
}
