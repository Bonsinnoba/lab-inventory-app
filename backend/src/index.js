import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { requestId, securityHeaders, apiRateLimit, requestTimeout } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

import { pool } from './db.js';
import { config } from './config.js';
import { authenticateToken, requireRole } from './middleware/auth.js';
import itemsRouter from './routes/items.js';
import transactionsRouter from './routes/transactions.js';
import projectsRouter from './routes/projects.js';
import projectWorkspaceRouter from './routes/project-workspace.js';
import resourcesRouter from './routes/resources.js';
import notesRouter from './routes/notes.js';
import searchRouter from './routes/search.js';
import authRouter from './routes/auth.js';
import fundingSourcesRouter from './routes/funding-sources.js';
import budgetPeriodsRouter from './routes/budget-periods.js';
import assistantRouter from './routes/assistant.js';
import projectBlocksRouter from './routes/project-blocks.js';
import projectConnectorsRouter from './routes/project-connectors.js';
import blocksRouter from './routes/blocks.js';
import connectorsRouter from './routes/connectors.js';
import locationsRouter from './routes/locations.js';
import auditRouter from './routes/audit.js';
import collaborationRouter from './routes/collaboration.js';
import knowledgeRouter from './routes/knowledge.js';
import reportsRouter from './routes/reports.js';
import automationRouter from './routes/automation.js';
import engineeringRouter from './routes/engineering.js';

dotenv.config();

const app = express();

app.disable('x-powered-by');
app.use(requestId);
app.use(securityHeaders);
app.use(requestTimeout(config.requestTimeoutMs));
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

app.use(cors({
  origin(origin, callback) {
    // Non-browser clients (Tauri, curl, native clients) may omit Origin.
    if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  maxAge: 86400,
}));
app.use(express.json({ limit: `${config.maxJsonMb}mb` }));
app.use('/api', apiRateLimit());

app.get('/api/health', async (req, res) => {
  let database = 'ok';
  let storage = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    database = 'error';
  }
  try {
    await fs.access(config.storageDir || './storage');
  } catch {
    storage = 'error';
  }

  const healthy = database === 'ok' && storage === 'ok';
  res.setHeader('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    version: config.apiVersion,
    services: { api: 'ok', database, storage },
    timestamp: new Date().toISOString(),
  });
});

// Authentication endpoints are the only public API routes. Every lab data
// route below requires a valid bearer token.
app.get('/api/meta', authenticateToken, (req, res) => {
  res.json({
    name: 'LabOS API',
    version: config.apiVersion,
    environment: config.nodeEnv,
    server_time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);

// Viewer accounts may inspect lab data but cannot mutate it. The guard is
// centralized so new protected routes inherit the read-only boundary.
app.use('/api', authenticateToken);
app.use('/api', (req, res, next) => {
  if (req.user?.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(403).json({ error: { code: 'READ_ONLY_ROLE', message: 'Viewer accounts have read-only access' } });
  }
  next();
});

app.use('/api/items', authenticateToken, itemsRouter);
app.use('/api/transactions', authenticateToken, transactionsRouter);
app.use('/api/projects', authenticateToken, projectWorkspaceRouter);
app.use('/api/projects', authenticateToken, projectBlocksRouter);
app.use('/api/projects', authenticateToken, projectConnectorsRouter);
app.use('/api/projects', authenticateToken, projectsRouter);
app.use('/api/resources', authenticateToken, resourcesRouter);
app.use('/api/notes', authenticateToken, notesRouter);
app.use('/api/search', authenticateToken, searchRouter);
app.use('/api/funding-sources', authenticateToken, fundingSourcesRouter);
app.use('/api/budget-periods', authenticateToken, budgetPeriodsRouter);
app.use('/api/assistant', authenticateToken, assistantRouter);
app.use('/api/blocks', authenticateToken, blocksRouter);
app.use('/api/connectors', authenticateToken, connectorsRouter);
app.use('/api/locations', authenticateToken, locationsRouter);
app.use('/api/audit', authenticateToken, auditRouter);
app.use('/api/collaboration', authenticateToken, collaborationRouter);
app.use('/api/knowledge', authenticateToken, knowledgeRouter);
app.use('/api/reports', authenticateToken, reportsRouter);
app.use('/api/automation', authenticateToken, automationRouter);
app.use('/api/engineering', authenticateToken, engineeringRouter);

// Destructive endpoints are additionally restricted inside their route files
// where necessary. This top-level reference documents the intended security
// boundary: authentication is mandatory for all lab data.
void requireRole;

app.use('/api', notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.requestTimeoutMs + 5000;
  server.keepAliveTimeout = 5000;
  const address = config.publicBaseUrl || `http://${config.host}:${config.port}`;
  console.log(`LabOS API v${config.apiVersion} running at ${address}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully...`);
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs);
  forceExit.unref();
  server.close(async () => {
    await pool.end();
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
