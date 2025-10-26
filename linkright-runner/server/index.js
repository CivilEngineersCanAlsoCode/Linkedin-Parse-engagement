/**
 * LinkRight Runner - Express API Server
 * Localhost HTTP API for controlling LinkedIn automation
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const authMiddleware = require('./auth');
const runner = require('./playwright-runner');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost', 'https://www.linkedin.com'],
  credentials: true
}));
app.use(express.json());

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// All API routes require authentication
app.use('/api', authMiddleware);

/**
 * POST /api/runner/start
 * Start the Playwright automation session
 */
app.post('/api/runner/start', async (req, res) => {
  try {
    logger.info('API: Start runner requested');

    if (runner.isRunning) {
      return res.status(400).json({
        error: 'Runner already active',
        status: runner.getStatus()
      });
    }

    const result = await runner.start();
    res.json(result);

  } catch (error) {
    logger.error('API: Failed to start runner', { error: error.message });
    res.status(500).json({
      error: 'Failed to start runner',
      message: error.message
    });
  }
});

/**
 * POST /api/runner/stop
 * Stop the Playwright automation session
 */
app.post('/api/runner/stop', async (req, res) => {
  try {
    logger.info('API: Stop runner requested');

    if (!runner.isRunning) {
      return res.status(400).json({
        error: 'Runner not active'
      });
    }

    const result = await runner.stop();
    res.json(result);

  } catch (error) {
    logger.error('API: Failed to stop runner', { error: error.message });
    res.status(500).json({
      error: 'Failed to stop runner',
      message: error.message
    });
  }
});

/**
 * POST /api/runner/pause
 * Pause the running automation
 */
app.post('/api/runner/pause', async (req, res) => {
  try {
    logger.info('API: Pause automation requested');

    if (!runner.isRunning || !runner.keyboardLoopActive) {
      return res.status(400).json({
        error: 'No active automation to pause',
        status: runner.getStatus()
      });
    }

    const result = runner.pause();
    
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Automation paused',
      status: runner.getStatus()
    });

  } catch (error) {
    logger.error('API: Failed to pause automation', { error: error.message });
    res.status(500).json({
      error: 'Failed to pause automation',
      message: error.message
    });
  }
});

/**
 * POST /api/runner/resume
 * Resume the paused automation
 */
app.post('/api/runner/resume', async (req, res) => {
  try {
    logger.info('API: Resume automation requested');

    if (!runner.isRunning || !runner.keyboardLoopActive) {
      return res.status(400).json({
        error: 'No active automation to resume',
        status: runner.getStatus()
      });
    }

    if (!runner.isPaused) {
      return res.status(400).json({
        error: 'Automation is not paused',
        status: runner.getStatus()
      });
    }

    const result = runner.resume();
    
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Automation resumed',
      status: runner.getStatus()
    });

  } catch (error) {
    logger.error('API: Failed to resume automation', { error: error.message });
    res.status(500).json({
      error: 'Failed to resume automation',
      message: error.message
    });
  }
});


/**
 * GET /api/runner/status
 * Get current runner status and statistics
 */
app.get('/api/runner/status', (req, res) => {
  try {
    const status = runner.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('API: Failed to get status', { error: error.message });
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message
    });
  }
});


/**
 * POST /api/runner/start-keyboard
 * Start keyboard-only automation (after 3-min countdown)
 */
app.post('/api/runner/start-keyboard', async (req, res) => {
  try {
    logger.info('API: Start keyboard automation requested');

    if (!runner.isRunning) {
      return res.status(400).json({
        error: 'Runner not active. Start runner first with POST /api/runner/start'
      });
    }

    if (runner.keyboardLoopActive) {
      return res.status(400).json({
        error: 'Keyboard automation already running'
      });
    }

    // Extract timing config, webhook settings, thresholds, and new mode settings from request body
    const { 
      timing, 
      webhookUrl, 
      xRunnerToken, 
      thresholds,
      optimizeEngagement,  // NEW: Mode flag
      postAnalysisWebhook  // NEW: linkedin-parse URL
    } = req.body || {};
    
    if (timing) {
      runner.timing = {
        tabDelayMin: timing.waitAction?.min || runner.defaults.tabDelayMin,
        tabDelayMax: timing.waitAction?.max || runner.defaults.tabDelayMax,
        pasteDelayMin: timing.waitAfterComment?.min || runner.defaults.pasteDelayMin,
        pasteDelayMax: timing.waitAfterComment?.max || runner.defaults.pasteDelayMax,
        cooldownMin: timing.waitBetweenComments?.min || runner.defaults.cooldownMin,
        cooldownMax: timing.waitBetweenComments?.max || runner.defaults.cooldownMax,
        webhookWaitMin: runner.defaults.webhookWaitMin, // Keep 5-6s for AI
        webhookWaitMax: runner.defaults.webhookWaitMax
      };
      logger.info('Timing config applied', runner.timing);
    }
    
    // Set thresholds from request body if provided
    if (thresholds) {
      runner.thresholds = {
        minLikes: parseInt(thresholds.minReactions) || runner.defaults.minLikes,
        minComments: parseInt(thresholds.minComments) || runner.defaults.minComments,
        minReposts: parseInt(thresholds.minReposts) || runner.defaults.minReposts,
        maxActions: parseInt(thresholds.maxActions) || runner.defaults.maxActions
      };
      logger.info('Thresholds config applied', runner.thresholds);
    }
    
    // Store webhook settings for runner to use
    if (webhookUrl) runner.webhookUrl = webhookUrl;
    if (xRunnerToken) runner.xRunnerToken = xRunnerToken;
    
    // Set new mode settings
    runner.optimizeEngagement = optimizeEngagement || false;
    runner.postAnalysisWebhook = postAnalysisWebhook;
    
    logger.info('Optimization mode', { 
      enabled: runner.optimizeEngagement,
      webhook: runner.postAnalysisWebhook 
    });

    // Start keyboard automation in background (non-blocking)
    runner.startKeyboardAutomation().catch(error => {
      logger.error('Keyboard automation failed', { error: error.message });
    });

    res.json({
      success: true,
      message: 'Keyboard automation started',
      mode: runner.optimizeEngagement ? 'Optimized' : 'Default',
      thresholds: runner.getThresholds(),
      timing: runner.timing,
      stats: runner.sessionStats
    });

  } catch (error) {
    logger.error('API: Failed to start keyboard automation', { error: error.message });
    res.status(500).json({
      error: 'Failed to start keyboard automation',
      message: error.message
    });
  }
});


/**
 * GET /api/logs
 * Get today's log file
 */
app.get('/api/logs', (req, res) => {
  try {
    const logs = logger.getTodaysLog();
    res.type('text/plain').send(logs);
  } catch (error) {
    logger.error('API: Failed to get logs', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve logs',
      message: error.message
    });
  }
});

/**
 * GET /api/settings
 * Retrieve stored settings from backend
 */
app.get('/api/settings', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const settingsPath = path.join(__dirname, '..', 'settings.json');
    
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      res.json({ success: true, settings });
    } else {
      res.json({ success: false, message: 'No settings found' });
    }
  } catch (error) {
    logger.error('API: Failed to get settings', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve settings',
      message: error.message
    });
  }
});

/**
 * POST /api/settings
 * Save settings to backend storage
 */
app.post('/api/settings', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const settingsPath = path.join(__dirname, '..', 'settings.json');
    
    fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2));
    logger.info('Settings saved to backend', req.body);
    
    res.json({ success: true, message: 'Settings saved' });
  } catch (error) {
    logger.error('API: Failed to save settings', { error: error.message });
    res.status(500).json({
      error: 'Failed to save settings',
      message: error.message
    });
  }
});


// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');

  if (runner.isRunning) {
    await runner.stop();
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down server...');

  if (runner.isRunning) {
    await runner.stop();
  }

  process.exit(0);
});

// Start server
app.listen(PORT, HOST, () => {
  logger.success(`LinkRight Runner API listening on http://${HOST}:${PORT}`);
  logger.info('Environment:', {
    port: PORT,
    host: HOST,
    headless: process.env.HEADLESS,
    maxComments: process.env.MAX_COMMENTS_PER_SESSION
  });
  logger.info('Ready to accept requests with x-runner-token authentication');
});
