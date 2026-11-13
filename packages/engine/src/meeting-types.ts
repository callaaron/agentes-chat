/**
 * The meeting's own shapes (ADR 0178). Kept here rather than in the db package: the tables are the storage, these are
 * what the director and the tools pass around, and the engine may not depend on drizzle's inferred types.
 */

/** One seat at the table. */
export interface MeetingSeat {
  name: string;
  role?: string;
  /** The agent that answers for this seat here. */
  agentId?: string;
}

/** What would prove a decision done: a person checks it, then it counts. */
export interface DecisionAcceptance {
  criteria: string[];
  evidence?: string[];
}
