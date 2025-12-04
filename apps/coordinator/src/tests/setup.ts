/**
 * Test Setup
 * 
 * Mocks database and external dependencies for unit testing.
 */

import { vi, beforeEach } from "vitest";

// Mock the pool for database queries
vi.mock("../db.js", () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(() => ({
      query: vi.fn(),
      release: vi.fn(),
    })),
  },
  migrate: vi.fn(),
}));

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
