import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { AppContext } from '../context.js';
import type { Agent } from '../domain/types.js';
import { AppError } from '../lib/errors.js';
import { safeEqual } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { authenticateAgent } from '../services/agents.js';

declare module 'express-serve-static-core' {
  interface Request {
    agent?: Agent;
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(
      'validation_error',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}

/** Agents authenticate with an API key issued by the merchant: `Authorization: Bearer ak_...`. */
export function requireAgent(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const key = bearer(req);
    if (!key) return next(new AppError('unauthorized', 'Missing agent API key (Authorization: Bearer <key>)'));
    const agent = await authenticateAgent(ctx.db, key);
    if (!agent) return next(new AppError('unauthorized', 'Unknown or disabled agent API key'));
    req.agent = agent;
    next();
  };
}

/** The merchant console's server calls admin routes with a shared secret. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const key = req.header('x-admin-key') ?? bearer(req);
  if (!key || !safeEqual(key, env.ADMIN_API_KEY)) return next(new AppError('unauthorized', 'Admin key required'));
  next();
}

export const agentRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.headers.authorization ?? req.ip ?? 'anon',
  handler: (_req, _res, next) => next(new AppError('rate_limited', 'Too many requests')),
});

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info({ method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) }, 'http');
  });
  next();
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'validation_error', message: 'Malformed JSON body' } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
}
