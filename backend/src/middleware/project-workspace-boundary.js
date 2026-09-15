/**
 * Redact cross-domain sections from the compound project workspace response.
 * The workspace itself requires projects.view, but each embedded domain must
 * still respect its own global permission. This keeps the convenience endpoint
 * from becoming a cross-domain data disclosure path.
 */
export function projectWorkspaceBoundary(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (!payload || typeof payload !== 'object' || !req.path.endsWith('/workspace')) {
      return originalJson(payload);
    }

    const permissions = req.permissions || new Set();
    const safe = { ...payload };

    // These sections are project-native and are already covered by projects.view.
    if (!permissions.has('inventory.view')) safe.items = [];
    if (!permissions.has('notes.view')) safe.notes = [];
    if (!permissions.has('resources.view')) safe.resources = [];
    if (!permissions.has('reports.view')) safe.activity = [];

    return originalJson(safe);
  };
  next();
}
