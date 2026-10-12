-- ON DELETE SET NULL must not violate block_content_matches_type. Preserve
-- the authored canvas node and connectors instead of cascading their deletion.
CREATE OR REPLACE FUNCTION preserve_canvas_block_on_resource_removal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resource_id IS NOT NULL AND NEW.resource_id IS NULL
     AND NEW.block_type <> 'text' THEN
    NEW.block_type := 'text';
    NEW.text_content := COALESCE(NULLIF(NEW.text_content, ''), 'Resource removed');
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_canvas_resource_removal ON project_blocks;
CREATE TRIGGER preserve_canvas_resource_removal
BEFORE UPDATE OF resource_id ON project_blocks
FOR EACH ROW EXECUTE FUNCTION preserve_canvas_block_on_resource_removal();
