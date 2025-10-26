/**
 * Authentication Middleware
 * Validates x-runner-token header for API security
 */

const logger = require('./logger');

function authMiddleware(req, res, next) {
  const token = req.headers['x-runner-token'];
  const expectedToken = process.env.RUNNER_TOKEN;

  if (!expectedToken) {
    logger.error('RUNNER_TOKEN not configured in .env');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!token) {
    logger.warn('Auth failed: No token provided', { ip: req.ip });
    return res.status(401).json({ error: 'Authentication required. Provide x-runner-token header.' });
  }

  if (token !== expectedToken) {
    logger.warn('Auth failed: Invalid token', { ip: req.ip, token: token.substring(0, 5) + '...' });
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

module.exports = authMiddleware;
