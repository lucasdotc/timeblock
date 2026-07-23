-- Migration 002 — interactive features (notes + task descriptions).
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query -> Run).
-- Safe to run more than once (IF NOT EXISTS). RLS policies from schema.sql
-- already cover these columns.

alter table tasks            add column if not exists description text;
alter table scheduled_blocks add column if not exists note        text;
