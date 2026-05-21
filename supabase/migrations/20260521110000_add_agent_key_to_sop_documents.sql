-- Add agent_key to sop_documents so SOP files can be grouped per AI agent.
-- Nullable — knowledge docs and general SOPs have no agent assignment.
alter table sop_documents
  add column if not exists agent_key text;
