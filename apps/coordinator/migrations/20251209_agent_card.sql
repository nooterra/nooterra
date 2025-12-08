-- Add canonical agent_card JSONB column for storing NooterraAgentCard
alter table agents
  add column if not exists agent_card jsonb;

