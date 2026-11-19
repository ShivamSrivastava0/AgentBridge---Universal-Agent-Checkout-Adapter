import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Logs always go to stderr (fd 2). stdout is reserved so the MCP stdio
 * transport can use it for JSON-RPC without being corrupted by log lines.
 */
export const logger = pino(
  {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: 'agentbridge' },
    redact: ['req.headers.authorization', 'req.headers["x-admin-key"]', '*.apiKey', '*.secret'],
  },
  pino.destination(2),
);
