import { describe, expect, test } from "bun:test";
import { assessConvergence, extractDecision, planTurns } from "../src/director";

/** The director's three decisions (ADR 0178), pure: turn order, convergence, and what was decided. */

const seats = [{ name: "Ana" }, { name: "Beto" }, { name: "Carla" }, { name: "Davi" }];

describe("planTurns", () => {
  test("sequential follows the seats", () => {
    expect(planTurns(seats, "sequential", 1).map((t) => t.seatIndex)).toEqual([0, 1, 2, 3]);
  });

  test("debate alternates the two halves", () => {
    expect(planTurns(seats, "debate", 1).map((t) => t.seatIndex)).toEqual([0, 2, 1, 3]);
  });

  test("brainstorm rotates who opens", () => {
    expect(planTurns(seats, "brainstorm", 2).map((t) => t.seatIndex)).toEqual([1, 2, 3, 0]);
  });

  test("host_summary lets only the chair close the round", () => {
    expect(planTurns(seats, "host_summary", 1).map((t) => t.seatIndex)).toEqual([3]);
  });

  test("no seats, no turns", () => {
    expect(planTurns([], "debate", 1)).toEqual([]);
  });
});

describe("assessConvergence", () => {
  const base = { round: 2, maxRounds: 6, coverage: 0.9, goalMet: true };

  test("stops when the goal is met and coverage is enough", () => {
    expect(assessConvergence(base)).toEqual({ stop: true, reason: "converged" });
  });

  test("keeps going while coverage is short", () => {
    expect(assessConvergence({ ...base, coverage: 0.4 })).toEqual({ stop: false, reason: "continue" });
  });

  test("stops at the round cap", () => {
    expect(assessConvergence({ ...base, round: 6, goalMet: false })).toEqual({ stop: true, reason: "max_rounds" });
  });

  test("a person stopping wins over everything", () => {
    expect(assessConvergence({ ...base, chairStopped: true })).toEqual({ stop: true, reason: "chair_stopped" });
  });
});

describe("extractDecision", () => {
  test("the chair's last speech is the decision, the strongest opposition is kept", () => {
    const out = extractDecision([
      { seatName: "Ana", text: "We should renew, the price is fine." },
      { seatName: "Beto", text: "I disagree: the SLA has been breached twice and the risk is not priced in." },
      { seatName: "Carla", text: "Do not renew at the current price unless they drop it 15%." },
    ]);
    expect(out?.decision).toContain("Do not renew");
    expect(out?.dissent).toContain("I disagree");
  });

  test("nothing said, nothing decided", () => {
    expect(extractDecision([])).toBeNull();
    expect(extractDecision([{ seatName: "Ana", text: "   " }])).toBeNull();
  });
});
