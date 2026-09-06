import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb } from './db';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize Database
initDb();

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

import { catalogRoutes } from './adapter-core';
import { acpRoutes } from './acp-server';
import { ap2Routes } from './ap2-layer';
import { trustRoutes } from './trust-layer';
import { runMcpServerStdio } from './mcp-server';

app.use('/catalog', catalogRoutes);
app.use('/acp', acpRoutes);
app.use('/ap2', ap2Routes);
app.use('/trust', trustRoutes);

app.listen(port, () => {
  console.log(`AgentBridge Core running at http://localhost:${port}`);
  
  // Also start the MCP server on stdio if run in a specific mode, or we can just run it alongside.
  // For standard HTTP REST apps, stdio might conflict with console logs, but for a demo it's fine 
  // to initialize it if we start the server with a specific flag.
  if (process.env.START_MCP === 'true') {
    runMcpServerStdio().catch(console.error);
  }
});
