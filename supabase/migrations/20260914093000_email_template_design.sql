-- Block layout behind the drag-and-drop email designer.
--
-- The compiled HTML stays the source of truth for sending; this column only
-- lets the designer reopen a layout it built. A template edited by hand in the
-- HTML tab clears it, so the editor never silently overwrites hand-written
-- markup with a stale layout.
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS design jsonb;
