import test from "node:test";
import assert from "node:assert/strict";
import { generateTeam } from "../services/runtime/team-generator.ts";

test("generateTeam: generates workers for a plumbing business", () => {
  const team = generateTeam("I run a plumbing company in Denver with 8 technicians");
  assert.ok(team.workers.length >= 3);
  assert.equal(team.industry, "trades");
  assert.ok(team.workers.some(w => w.name.toLowerCase().includes("reception") || w.name.toLowerCase().includes("scheduling")));
  for (const w of team.workers) {
    assert.ok(w.charter.canDo.length > 0);
    assert.ok(w.charter.neverDo.length > 0);
    assert.ok(w.model);
  }
});

test("generateTeam: generates workers for a restaurant", () => {
  const team = generateTeam("Small Italian restaurant in Brooklyn, 20 seats");
  assert.equal(team.industry, "food_service");
  assert.ok(team.workers.length >= 3);
});

test("generateTeam: generates workers for unknown industry", () => {
  const team = generateTeam("My company does various things");
  assert.equal(team.industry, "general_business");
  assert.ok(team.workers.length >= 3);
});

test("generateTeam: extracts business name", () => {
  const team = generateTeam("Denver Plumbing Co handles residential and commercial plumbing");
  assert.ok(team.businessName.length > 0);
});

test("generateTeam: all workers have neverDo safety rules", () => {
  const team = generateTeam("A dental clinic in Austin");
  for (const w of team.workers) {
    assert.ok(w.charter.neverDo.some(r => r.toLowerCase().includes("pii") || r.toLowerCase().includes("delete")));
  }
});

test("generateTeam: healthcare industry detected for clinic", () => {
  const team = generateTeam("Family health clinic in Portland");
  assert.equal(team.industry, "healthcare");
  assert.ok(team.workers.some(w => w.name.toLowerCase().includes("appointment")));
});

test("generateTeam: legal industry detected for law firm", () => {
  const team = generateTeam("Smith & Associates law firm downtown");
  assert.equal(team.industry, "legal");
  assert.ok(team.workers.some(w => w.name.toLowerCase().includes("intake")));
});

test("generateTeam: retail industry detected for ecommerce", () => {
  const team = generateTeam("Our ecommerce store sells handmade jewelry");
  assert.equal(team.industry, "retail");
  assert.ok(team.workers.some(w => w.name.toLowerCase().includes("customer service")));
});

test("generateTeam: professional services detected for consulting", () => {
  const team = generateTeam("A small consulting agency for startups");
  assert.equal(team.industry, "professional_services");
  assert.ok(team.workers.some(w => w.name.toLowerCase().includes("client")));
});

test("generateTeam: all workers have model set", () => {
  const team = generateTeam("A plumbing company");
  for (const w of team.workers) {
    assert.equal(w.model, "openai/gpt-4o-mini");
  }
});

test("generateTeam: schedule is continuous or cron for each worker", () => {
  const team = generateTeam("A dental clinic");
  for (const w of team.workers) {
    assert.ok(
      w.schedule === "continuous" || w.schedule === null || /^[\d*/ ,-]+$/.test(w.schedule),
      `Unexpected schedule value: ${w.schedule}`
    );
  }
});
