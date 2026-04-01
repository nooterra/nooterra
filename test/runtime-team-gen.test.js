import test from "node:test";
import assert from "node:assert/strict";

import {
  detectIndustryFromDescription,
  extractBusinessName,
  TEAM_INDUSTRY_TEMPLATES,
  TEAM_ROLE_DEFINITIONS,
} from "../services/runtime/workers-api.js";

// ---------------------------------------------------------------------------
// detectIndustryFromDescription
// ---------------------------------------------------------------------------

test("detectIndustryFromDescription: identifies dental from keyword", () => {
  assert.equal(detectIndustryFromDescription("We are a dental clinic in Austin"), "dental");
});

test("detectIndustryFromDescription: identifies restaurant from keyword", () => {
  assert.equal(detectIndustryFromDescription("A fast-casual restaurant chain"), "restaurant");
});

test("detectIndustryFromDescription: identifies ecommerce from keyword", () => {
  assert.equal(detectIndustryFromDescription("Our e-commerce store sells sneakers"), "ecommerce");
});

test("detectIndustryFromDescription: identifies legal from keyword", () => {
  assert.equal(detectIndustryFromDescription("Smith & Associates Law Firm"), "legal");
});

test("detectIndustryFromDescription: identifies salon from keyword", () => {
  assert.equal(detectIndustryFromDescription("Downtown beauty salon"), "salon");
});

test("detectIndustryFromDescription: identifies fitness from keyword", () => {
  assert.equal(detectIndustryFromDescription("CrossFit box and personal training"), "fitness");
});

test("detectIndustryFromDescription: identifies realestate from keyword", () => {
  assert.equal(detectIndustryFromDescription("A real estate brokerage in Denver"), "realestate");
});

test("detectIndustryFromDescription: identifies consulting from keyword", () => {
  assert.equal(detectIndustryFromDescription("Management consulting firm"), "consulting");
});

test("detectIndustryFromDescription: identifies medical from keyword", () => {
  assert.equal(detectIndustryFromDescription("Family health clinic"), "medical");
});

test("detectIndustryFromDescription: falls back to general for unknown description", () => {
  assert.equal(detectIndustryFromDescription("We sell widgets and gadgets worldwide"), "general");
});

test("detectIndustryFromDescription: returns general for empty string", () => {
  assert.equal(detectIndustryFromDescription(""), "general");
});

test("detectIndustryFromDescription: returns general for non-string input", () => {
  assert.equal(detectIndustryFromDescription(undefined), "general");
  assert.equal(detectIndustryFromDescription(null), "general");
  assert.equal(detectIndustryFromDescription(42), "general");
});

test("detectIndustryFromDescription: is case-insensitive", () => {
  assert.equal(detectIndustryFromDescription("DENTAL PRACTICE"), "dental");
});

// ---------------------------------------------------------------------------
// TEAM_INDUSTRY_TEMPLATES roles all exist in TEAM_ROLE_DEFINITIONS
// ---------------------------------------------------------------------------

test("every role in TEAM_INDUSTRY_TEMPLATES has a matching TEAM_ROLE_DEFINITIONS entry", () => {
  const definedRoles = new Set(Object.keys(TEAM_ROLE_DEFINITIONS));
  for (const [industry, template] of Object.entries(TEAM_INDUSTRY_TEMPLATES)) {
    for (const role of template.roles) {
      assert.ok(
        definedRoles.has(role),
        `Industry "${industry}" references role "${role}" which is missing from TEAM_ROLE_DEFINITIONS`,
      );
    }
  }
});

test("every TEAM_ROLE_DEFINITIONS entry has required fields", () => {
  for (const [key, def] of Object.entries(TEAM_ROLE_DEFINITIONS)) {
    assert.ok(def.nameTemplate, `Role "${key}" missing nameTemplate`);
    assert.ok(def.purpose, `Role "${key}" missing purpose`);
    assert.ok(Array.isArray(def.canDo), `Role "${key}" missing canDo array`);
    assert.ok(Array.isArray(def.neverDo), `Role "${key}" missing neverDo array`);
    assert.ok(Array.isArray(def.capabilities), `Role "${key}" missing capabilities array`);
    assert.ok(def.schedule, `Role "${key}" missing schedule`);
  }
});

// ---------------------------------------------------------------------------
// extractBusinessName
// ---------------------------------------------------------------------------

test("extractBusinessName: extracts capitalized name from description", () => {
  // The regex finds the first proper-noun phrase with length > 2
  const name = extractBusinessName("Sunrise Dental Clinic in Austin");
  assert.equal(name, "Sunrise Dental Clinic");
});

test("extractBusinessName: falls back to first words when no proper noun found", () => {
  const name = extractBusinessName("a small bakery in town");
  assert.equal(name, "a small bakery");
});

test("extractBusinessName: returns My Business for empty string", () => {
  assert.equal(extractBusinessName(""), "My Business");
});

test("extractBusinessName: returns My Business for non-string input", () => {
  assert.equal(extractBusinessName(undefined), "My Business");
  assert.equal(extractBusinessName(null), "My Business");
  assert.equal(extractBusinessName(123), "My Business");
});
