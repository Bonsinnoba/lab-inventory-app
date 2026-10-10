CREATE OR REPLACE FUNCTION labos_comment_deleted() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_tombstones(entity_type,entity_id,project_id)
    VALUES('project_comment',OLD.id,OLD.project_id)
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=clock_timestamp();
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS comment_sync_deleted ON project_comments;
CREATE TRIGGER comment_sync_deleted AFTER DELETE ON project_comments
FOR EACH ROW EXECUTE FUNCTION labos_comment_deleted();
