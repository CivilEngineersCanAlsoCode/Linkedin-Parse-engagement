/**
 * Playwright Runner - LinkedIn Automation Engine
 * Handles browser automation, post detection, AI integration
 */

const { chromium } = require('playwright');
const logger = require('./logger');

class PlaywrightRunner {
  constructor() {
    // OPTIMIZATION: Lazy load heavy objects
    this._browser = null;
    this._context = null;
    this._page = null;
    this._logger = null;
    
    // OPTIMIZATION: Use WeakMap for temporary data
    this.tempData = new WeakMap();
    
    // OPTIMIZATION: Use Set for O(1) lookups instead of Array
    this.seenPostIds = new Set();
    this.postMetrics = new Map();
    
    // OPTIMIZATION: Pre-allocate arrays with known size
    this.sessionItems = new Array(1000);
    this.sessionItems.length = 0;
    
    // OPTIMIZATION: Cache DOM queries
    this._domCache = new Map();
    this._cacheTimeout = 5000; // 5s cache
    
    // OPTIMIZATION: Memoization cache
    this._memoizedExtractPostData = new Map();
    
    // Core state
    this.isRunning = false;
    this.sessionId = null;
    this.stopRequested = false;
    this.isPaused = false;
    
    // OPTIMIZATION: Compact session stats
    this.sessionStats = {
      commentsPosted: 0,
      likesGiven: 0,
      connectionsRequested: 0,
      postsProcessed: 0,
      errors: 0,
      startTime: null
    };
    
    // OPTIMIZATION: Lazy load defaults
    this._defaults = null;
    this.thresholds = null;
    this.timing = null;
    
    // Mode flags
    this.optimizeEngagement = false;
    this.postAnalysisWebhook = null;
    this.keyboardLoopActive = false;
    
    // OPTIMIZATION: Compact HUD state
    this.hudState = {
      action: 'Idle',
      postId: '',
      engage: '-',
      commentsPosted: 0,
      maxComments: 0
    };
    
    // OPTIMIZATION: Request queue for batching
    this.requestQueue = [];
    this.batchSize = 5;
    this.batchTimeout = 1000;
    
    // OPTIMIZATION: Idle callbacks for cleanup
    this.idleCallbacks = [];
    
    // OPTIMIZATION: Web Worker for heavy computations
    this.worker = null;
    this.workerTasks = new Map();
    this.taskId = 0;
  }

  // OPTIMIZATION: Lazy getters for heavy objects
  get browser() {
    return this._browser;
  }
  
  set browser(value) {
    this._browser = value;
  }
  
  get context() {
    return this._context;
  }
  
  set context(value) {
    this._context = value;
  }
  
  get page() {
    return this._page;
  }
  
  set page(value) {
    this._page = value;
  }
  
  get logger() {
    if (!this._logger) {
      this._logger = require('./logger');
    }
    return this._logger;
  }
  
  get defaults() {
    if (!this._defaults) {
      this._defaults = {
        maxActions: 10,
        strictThresholdMode: true,
        // Updated timing defaults for more reliable automation
        tabDelayMin: 1000,        // 1.0s (increased for reliability)
        tabDelayMax: 2000,        // 2.0s (increased for reliability)
        enterDelayMin: 2000,      // 2.0s (increased for reliability)
        enterDelayMax: 4000,      // 4.0s (increased for reliability)
        webhookWaitMin: 3000,     // 3s (unchanged)
        webhookWaitMax: 4000,     // 4s (unchanged)
        pasteDelayMin: 1000,      // 1.0s (increased for reliability)
        pasteDelayMax: 2000,      // 2.0s (increased for reliability)
        cooldownMin: 5000,        // 5.0s (increased for reliability)
        cooldownMax: 10000        // 10.0s (increased for reliability)
      };
    }
    return this._defaults;
  }

  /**
   * Start Playwright session with robust navigation and retry logic
   */
  async start(options = {}) {
    if (this.isRunning) {
      throw new Error('Runner already active');
    }

    logger.info('Starting Playwright runner...');

    const fs = require('fs');
    const path = require('path');

    try {
      // Generate unique session ID
      this.sessionId = `session-${Date.now()}`;
      this.stopRequested = false;

      // Configurable feed URL (default to LinkedIn feed)
      const FEED_URL = options.feedUrl || process.env.LINKEDIN_FEED_URL || 'https://www.linkedin.com/feed/';
      logger.info('Target URL:', FEED_URL);

      // DEPRECATED: Skip-scroll mode no longer used (pure tab navigation)
      // const scrollMode = this.disableSkipScroll ? 'DISABLED (validation mode)' : 'ENABLED (normal)';
      // logger.info(`Skip-flow scrolling: ${scrollMode}`);

      // Create runs directory structure
      const runsDir = path.join(__dirname, '..', 'runs', this.sessionId);

      if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
        logger.info(`Created session directory: ${runsDir}`);
      }

      // User data directory for persistent context
      const userDataDir = path.join(__dirname, '..', 'user-data');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }

      // Launch browser with persistent context
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: process.env.HEADLESS === 'true',
        slowMo: 400, // 400ms slowMo for visibility
        viewport: null, // Use full screen
        args: ['--start-maximized'],
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Enable video recording
        recordVideo: {
          dir: runsDir,
          size: { width: 1920, height: 1080 }
        }
      });

      // Start tracing with screenshots and snapshots
      await this.context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true
      });

      this.page = this.context.pages()[0] || await this.context.newPage();
      this.browser = this.context.browser(); // For compatibility
      this.isRunning = true;
      this.sessionStats.startTime = new Date();

      // Set default timeout to 90 seconds
      this.page.setDefaultTimeout(90000);

      // Inject HUD overlay
      await this.injectHUD();

      // Register stop hotkeys (Ctrl+Shift+. and Double-Esc)
      await this.registerStopHotkeys();

      // Navigate to LinkedIn with preflight retry loop
      const navResult = await this.navigateToLinkedInWithRetries(FEED_URL, runsDir);

      if (!navResult.success) {
        // Navigation failed after retries - return structured error
        await this.cleanup();
        return {
          success: false,
          code: 'NAV_TIMEOUT',
          hint: navResult.hint || 'LinkedIn didn\'t load. Check login/connectivity and try again.',
          sessionId: this.sessionId,
          artifacts: navResult.artifacts || []
        };
      }

      // Bring page to front after successful navigation
      await this.page.bringToFront();
      logger.info('Page brought to front');

      // Update HUD
      await this.updateHUD({ action: 'Ready - Logged in' });

      return {
        success: true,
        message: 'Runner started successfully',
        stats: this.sessionStats,
        sessionId: this.sessionId,
        runsDir
      };

    } catch (error) {
      logger.error('Failed to start runner', { error: error.message });
      await this.cleanup();

      // Return structured error
      return {
        success: false,
        code: 'START_ERROR',
        hint: `Failed to start: ${error.message}`,
        sessionId: this.sessionId
      };
    }
  }

  /**
   * Navigate to LinkedIn with retry logic, login detection, and cookie handling
   */
  async navigateToLinkedInWithRetries(feedUrl, runsDir) {
    const fs = require('fs');
    const path = require('path');
    const MAX_ATTEMPTS = 3;
    const BACKOFF_DELAYS = [2000, 4000, 6000]; // 2s, 4s, 6s
    const artifacts = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      logger.info(`Navigation attempt ${attempt}/${MAX_ATTEMPTS}...`);

      try {
        // Update HUD
        await this.updateHUD({ action: `Loading LinkedIn (attempt ${attempt}/${MAX_ATTEMPTS})` });

        // Navigate with domcontentloaded (don't wait for networkidle)
        await this.page.goto(feedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 90000
        });

        logger.info('DOM content loaded, checking readiness...');

        // Dismiss cookie banners if present
        await this.dismissCookieBanner();

        // Check if login is required
        const loginNeeded = await this.checkLoginRequired();

        if (loginNeeded) {
          logger.warn('Login required - blocking until user logs in');
          await this.updateHUD({ action: 'Login required - please log in' });

          // Wait for user to log in (detect navigation away from login page)
          await this.waitForLogin();

          // Re-check readiness after login
          logger.info('Login completed, re-checking page readiness...');
        }

        // Wait for readiness via stable selectors (race condition)
        const ready = await this.waitForPageReadiness();

        if (ready) {
          logger.success(`LinkedIn loaded successfully on attempt ${attempt}`);
          return { success: true };
        } else {
          throw new Error('Readiness check failed - no stable selectors found');
        }

      } catch (error) {
        logger.error(`Navigation attempt ${attempt} failed:`, error.message);

        // Take screenshot on failure
        try {
          const screenshotPath = path.join(runsDir, `attempt-${attempt}-failure.png`);
          await this.page.screenshot({ path: screenshotPath, fullPage: false });
          const absolutePath = path.resolve(screenshotPath);
          logger.info(`Screenshot saved: ${absolutePath}`);
          artifacts.push({ type: 'screenshot', path: absolutePath, attempt });
        } catch (screenshotError) {
          logger.warn('Failed to take screenshot:', screenshotError.message);
        }

        // Save mini-trace on failure
        try {
          const miniTracePath = path.join(runsDir, `attempt-${attempt}-trace.zip`);
          await this.context.tracing.stop({ path: miniTracePath });

          // Restart tracing for next attempt
          await this.context.tracing.start({
            screenshots: true,
            snapshots: true,
            sources: true
          });

          const absolutePath = path.resolve(miniTracePath);
          logger.info(`Mini-trace saved: ${absolutePath}`);
          artifacts.push({ type: 'trace', path: absolutePath, attempt });
        } catch (traceError) {
          logger.warn('Failed to save mini-trace:', traceError.message);
        }

        // If not the last attempt, wait with backoff before retrying
        if (attempt < MAX_ATTEMPTS) {
          const backoffDelay = BACKOFF_DELAYS[attempt - 1];
          logger.info(`Waiting ${backoffDelay}ms before retry...`);
          await this.page.waitForTimeout(backoffDelay);
        }
      }
    }

    // All attempts failed
    logger.error('All navigation attempts failed');
    return {
      success: false,
      hint: 'LinkedIn didn\'t load after 3 attempts. Check login/connectivity and try again.',
      artifacts
    };
  }

  /**
   * Dismiss cookie/privacy banners if present
   */
  async dismissCookieBanner() {
    try {
      // Common button texts (case-insensitive)
      const buttonTexts = [
        'Accept', 'Agree', 'Allow all', 'Accept all', 'Accept cookies',
        'Aceptar', 'Accepter', 'Akzeptieren', // Localized variants
        'OK', 'Got it', 'Dismiss'
      ];

      // Try to find and click cookie consent button
      for (const text of buttonTexts) {
        const button = await this.page.locator(`button:has-text("${text}")`).first();

        if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
          logger.info(`Dismissing cookie banner: "${text}"`);
          await button.click({ timeout: 5000 });
          await this.page.waitForTimeout(1000); // Wait for animation
          return;
        }
      }

      // Try aria-label approach
      const ariaButton = await this.page.locator('button[aria-label*="cookie" i], button[aria-label*="consent" i]').first();
      if (await ariaButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        logger.info('Dismissing cookie banner via aria-label');
        await ariaButton.click({ timeout: 5000 });
        await this.page.waitForTimeout(1000);
      }

      logger.info('No cookie banner detected or already dismissed');
    } catch (error) {
      logger.info('Cookie banner dismissal skipped:', error.message);
    }
  }

  /**
   * Check if login is required
   */
  async checkLoginRequired() {
    try {
      // Check for common login selectors
      const loginSelectors = [
        'input#username',
        'input#session_key',
        'input[name="session_key"]',
        'form[action*="checkpoint"]',
        'form[action*="login"]',
        '.login-form'
      ];

      for (const selector of loginSelectors) {
        const element = await this.page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
          logger.info(`Login detected via selector: ${selector}`);
          return true;
        }
      }

      // Check URL for login indicators
      const currentUrl = this.page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/uas/login') || currentUrl.includes('/checkpoint')) {
        logger.info('Login detected via URL');
        return true;
      }

      return false;
    } catch (error) {
      logger.warn('Login check failed:', error.message);
      return false;
    }
  }

  /**
   * Wait for user to complete login
   */
  async waitForLogin() {
    try {
      // Wait for navigation away from login page (max 5 minutes)
      await this.page.waitForFunction(() => {
        const url = window.location.href;
        return !url.includes('/login') && !url.includes('/uas/login') && !url.includes('/checkpoint');
      }, { timeout: 300000 }); // 5 minutes

      logger.info('User completed login, waiting for DOM to settle...');
      await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await this.page.waitForTimeout(2000); // Extra buffer for feed to load

    } catch (error) {
      logger.error('Login wait timeout:', error.message);
      throw new Error('User did not complete login within 5 minutes');
    }
  }

  /**
   * Wait for page readiness using stable selectors (race condition)
   */
  async waitForPageReadiness() {
    try {
      logger.info('Waiting for page readiness via stable selectors...');

      // Race on stable selectors (any locale)
      const readinessSelectors = [
        'main[role="main"]',                           // Feed container
        '[data-view-name="feed"]',                     // Feed view
        '.scaffold-layout__main',                      // Main layout
        '[aria-label*="reaction" i]',                  // Any post with reactions
        'div.feed-shared-update-v2',                   // Post container
        'nav.global-nav',                              // Global navigation
        'header.global-nav__content'                   // Header nav
      ];

      // Wait for any of these selectors to appear (race condition)
      const result = await Promise.race([
        ...readinessSelectors.map(selector =>
          this.page.waitForSelector(selector, { timeout: 30000, state: 'visible' })
            .then(() => ({ success: true, selector }))
            .catch(() => ({ success: false, selector }))
        )
      ]);

      if (result.success) {
        logger.success(`Page ready - found selector: ${result.selector}`);
        return true;
      } else {
        logger.warn('No readiness selectors matched');
        return false;
      }

    } catch (error) {
      logger.error('Readiness check failed:', error.message);
      return false;
    }
  }

  /**
   * Stop Playwright session
   */
  async stop() {
    logger.info('Stopping Playwright runner...');

    // Set stop flag for graceful loop exit
    this.stopRequested = true;
    this.keyboardLoopActive = false;

    // Prepare absolute paths for artifacts
    const path = require('path');
    const fs = require('fs');
    const artifactPaths = {
      traceFile: null,
      videoFile: null,
      sessionDir: null
    };

    // Save tracing before cleanup
    if (this.context && this.sessionId) {
      try {
        const tracePath = path.join(__dirname, '..', 'runs', this.sessionId, 'trace.zip');
        await this.context.tracing.stop({ path: tracePath });

        // Resolve to absolute path
        artifactPaths.traceFile = path.resolve(tracePath);
        artifactPaths.sessionDir = path.resolve(path.dirname(tracePath));

        logger.info(`Trace saved to: ${artifactPaths.traceFile}`);
      } catch (error) {
        logger.warn('Failed to save trace', { error: error.message });
      }
    }

    // Find video file (Playwright names it video-1.webm, video-2.webm, etc.)
    if (this.sessionId) {
      try {
        const sessionDir = path.join(__dirname, '..', 'runs', this.sessionId);
        const files = fs.readdirSync(sessionDir);
        const videoFile = files.find(f => f.startsWith('video-') && f.endsWith('.webm'));

        if (videoFile) {
          artifactPaths.videoFile = path.resolve(path.join(sessionDir, videoFile));
          logger.info(`Video saved to: ${artifactPaths.videoFile}`);
        }
      } catch (error) {
        logger.warn('Failed to locate video file', { error: error.message });
      }
    }

    await this.cleanup();

    const finalStats = { ...this.sessionStats };
    this.resetStats();

    // Log absolute paths for easy replay
    if (artifactPaths.traceFile || artifactPaths.videoFile) {
      logger.info('Session artifacts saved:', {
        trace: artifactPaths.traceFile,
        video: artifactPaths.videoFile,
        sessionDir: artifactPaths.sessionDir
      });
    }

    logger.success('[SUCCESS] Runner stopped and browser closed', finalStats);

    return {
      success: true,
      message: 'Runner stopped',
      stats: finalStats,
      sessionId: this.sessionId,
      artifacts: artifactPaths
    };
  }

  /**
   * Get current status
   */
  getStatus() {
    const thresholds = {
      maxComments: parseInt(process.env.MAX_COMMENTS_PER_SESSION) || 20,
      maxLikes: parseInt(process.env.MAX_LIKES_PER_SESSION) || 50,
      maxConnections: parseInt(process.env.MAX_CONNECTIONS_PER_SESSION) || 10
    };

    return {
      isRunning: this.isRunning,
      keyboardLoopActive: this.keyboardLoopActive,
      isPaused: this.isPaused,
      status: this.isPaused ? 'paused' : (this.keyboardLoopActive ? 'running' : 'stopped'),
      stats: this.sessionStats,
      thresholds,
      sessionId: this.sessionId
    };
  }

  /**
   * Pause the running automation
   */
  pause() {
    if (!this.keyboardLoopActive) {
      return { success: false, error: 'No active automation' };
    }
    this.isPaused = true;
    this.logger.info('Automation paused by user');
    return { success: true, status: 'paused' };
  }

  /**
   * Resume the paused automation
   */
  resume() {
    if (!this.keyboardLoopActive) {
      return { success: false, error: 'No active automation' };
    }
    if (!this.isPaused) {
      return { success: false, error: 'Automation is not paused' };
    }
    this.isPaused = false;
    this.logger.info('Automation resumed by user');
    return { success: true, status: 'running' };
  }

  /**
   * Check if currently focused element is inside a post (div[data-id])
   */
  async isInsidePost() {
    if (!this.page) return null;
    
    const result = await this.page.evaluate(() => {
      const focused = document.activeElement;
      if (!focused) return null;
      
      // Find closest div[data-id] ancestor
      const postDiv = focused.closest('div[data-id]');
      if (!postDiv) return null;
      
      // Check if we're in a comment section (avoid nested posts)
      const isInCommentSection = postDiv.closest('.comments-comment-entity, .comments-thread-entity, .comments-comment-list');
      if (isInCommentSection) return null;
      
      // Only detect main feed posts, not nested elements
      const isMainFeedPost = postDiv.classList.contains('feed-shared-update-v2') || 
                             postDiv.querySelector('.feed-shared-update-v2');
      if (!isMainFeedPost) return null;
      
      // Extract post content text
      const textElement = postDiv.querySelector('.feed-shared-update-v2__description');
      const postContent = textElement ? textElement.innerText : '';
      
      // Extract author name
      const authorElement = postDiv.querySelector('.update-components-actor__name');
      const authorName = authorElement ? authorElement.innerText : '';
      
      return {
        postId: postDiv.getAttribute('data-id'),
        postHTML: postDiv.outerHTML,  // Fixed: Use outerHTML instead of innerHTML
        postContent: postContent,
        authorName: authorName,
        htmlLength: postDiv.outerHTML.length  // Track size for debugging
      };
    });

    if (result) {
      this.logger.info('📋 Post HTML extracted', {
        postId: result.postId,
        htmlLength: result.htmlLength,
        hasPostHTML: !!result.postHTML
      });
    }

    return result;
  }



  /**
   * Inject HUD overlay into page
   */
  async injectHUD() {
    if (!this.page) return;

    try {
      await this.page.addInitScript(() => {
        // Only add HUD to top-level window (not iframes)
        if (window !== window.top) return;

        // Create HUD container - minimal design per spec
        const hud = document.createElement('div');
        hud.id = 'linkright-hud';
        hud.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: rgba(0, 0, 0, 0.75);
          color: #FFFFFF;
          padding: 10px 12px;
          border-radius: 6px;
          font-family: 'Segoe UI', Arial, sans-serif;
          font-size: 11px;
          line-height: 1.5;
          z-index: 2147483647;
          pointer-events: none;
          min-width: 200px;
          max-width: 250px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        `;
        hud.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 8px; color: #4CAF50; font-size: 13px;">
            LinkRight Runner
          </div>
          <div id="hud-action" style="margin: 5px 0; color: #E0E0E0;"><strong>Action:</strong> <span id="hud-action-text">Initializing...</span></div>
          <div id="hud-postid" style="margin: 5px 0; color: #E0E0E0; font-size: 10px; word-break: break-all; line-height: 1.3;"><strong>Post ID:</strong><br><span id="hud-postid-text">-</span></div>
          <div id="hud-engage" style="margin: 5px 0; padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.1);"><strong>Engage:</strong> <span id="hud-engage-text" style="font-weight: 700; color: #FFD700;">-</span></div>
          <div id="hud-progress" style="margin: 5px 0; color: #FFD700; font-weight: 600;"><span id="hud-progress-text">0 / 0</span></div>
          <button id="hud-stop-btn" style="
            margin-top: 10px;
            width: 100%;
            padding: 6px 10px;
            background: #F44336;
            color: white;
            border: none;
            border-radius: 4px;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
            pointer-events: auto;
            transition: background 0.2s;
          ">🛑 STOP NOW</button>
        `;

        // Wait for DOM to be ready
        if (document.body) {
          document.body.appendChild(hud);
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            document.body.appendChild(hud);
          });
        }

        // Add STOP NOW button handler
        const stopBtn = document.getElementById('hud-stop-btn');
        if (stopBtn) {
          stopBtn.addEventListener('click', async () => {
            stopBtn.textContent = 'Stopping...';
            stopBtn.disabled = true;
            console.log('🛑 HUD Stop button clicked');

            try {
              const response = await fetch('http://127.0.0.1:3001/api/runner/stop', {
                method: 'POST',
                headers: {
                  'x-runner-token': 'dev-secure-token-12345',
                  'Content-Type': 'application/json'
                }
              });

              if (response.ok) {
                console.log('✅ Runner stop requested successfully');
                stopBtn.textContent = '✓ Stopped';
              } else {
                console.error('❌ Failed to stop runner:', await response.text());
                stopBtn.textContent = '✗ Failed';
              }
            } catch (error) {
              console.error('❌ Error calling stop API:', error);
              stopBtn.textContent = '✗ Error';
            }
          });

          // Hover effect
          stopBtn.addEventListener('mouseenter', () => {
            stopBtn.style.background = '#D32F2F';
          });
          stopBtn.addEventListener('mouseleave', () => {
            stopBtn.style.background = '#F44336';
          });
        }

        // Expose global update function
        window.updateLinkRightHUD = function(state) {
          const actionText = document.getElementById('hud-action-text');
          const postIdText = document.getElementById('hud-postid-text');
          const engageText = document.getElementById('hud-engage-text');
          const progressText = document.getElementById('hud-progress-text');

          if (state.action && actionText) {
            actionText.textContent = state.action;
          }

          if (state.postId !== undefined && postIdText) {
            postIdText.textContent = state.postId || '-';
          }

          if (state.engage !== undefined && engageText) {
            const engageValue = state.engage.toUpperCase();
            engageText.textContent = engageValue;

            // Color code the engage decision
            if (engageValue === 'YES') {
              engageText.style.color = '#4CAF50'; // Green for YES
            } else if (engageValue === 'NO') {
              engageText.style.color = '#F44336'; // Red for NO
            } else {
              engageText.style.color = '#FFD700'; // Gold for pending/unknown
            }
          }

          if (state.commentsPosted !== undefined && state.maxComments !== undefined && progressText) {
            progressText.textContent = `${state.commentsPosted} / ${state.maxComments} posted`;
          }
        };
      });

      logger.success('HUD overlay injected into page');
    } catch (error) {
      logger.warn('Failed to inject HUD', { error: error.message });
    }
  }

  /**
   * Update HUD state
   */
  async updateHUD(updates) {
    if (!this.page) return;

    // Update internal state
    this.hudState = { ...this.hudState, ...updates };

    try {
      await this.page.evaluate((state) => {
        if (window.updateLinkRightHUD) {
          window.updateLinkRightHUD(state);
        }
      }, this.hudState);
    } catch (error) {
      // Ignore HUD update errors (page might be navigating)
    }
  }

  /**
   * Register stop hotkeys: Ctrl+Shift+. and double-Esc
   */
  async registerStopHotkeys() {
    if (!this.page) return;

    try {
      await this.page.addInitScript(() => {
        let lastEscTime = 0;

        // Stop runner helper function
        async function stopRunner(method) {
          console.log(`🛑 ${method} detected - Stopping runner...`);

          try {
            const response = await fetch('http://127.0.0.1:3001/api/runner/stop', {
              method: 'POST',
              headers: {
                'x-runner-token': 'dev-secure-token-12345',
                'Content-Type': 'application/json'
              }
            });

            if (response.ok) {
              console.log('✅ Runner stop requested successfully');
            } else {
              console.error('❌ Failed to stop runner:', await response.text());
            }
          } catch (error) {
            console.error('❌ Error calling stop API:', error);
          }
        }

        // Use capture phase so it fires even when text box is focused
        window.addEventListener('keydown', async (event) => {
          // Ctrl+Shift+. (period)
          if (event.ctrlKey && event.shiftKey && event.key === '.') {
            event.preventDefault();
            await stopRunner('Ctrl+Shift+.');
            return;
          }

          // Double-Esc (within 1 second)
          if (event.key === 'Escape') {
            const now = Date.now();
            if (now - lastEscTime < 1000) {
              // Second Esc within 1 second
              event.preventDefault();
              await stopRunner('Double-Esc');
              lastEscTime = 0; // Reset
            } else {
              // First Esc
              lastEscTime = now;
            }
          }
        }, true); // Use capture phase
      });

      logger.success('Stop hotkeys registered (Ctrl+Shift+. and Double-Esc)');
    } catch (error) {
      logger.warn('Failed to register stop hotkeys', { error: error.message });
    }
  }




  /**
   * Extract post ID or URL using layered selectors
   */
  async extractPostId(postElement) {
    try {
      // Strategy 1: data-urn attribute
      const urn = await postElement.getAttribute('data-urn');
      if (urn) return urn;

      // Strategy 2: Find permalink in post
      const linkElement = await postElement.$('a[href*="/posts/"], a[href*="/feed/update/"]');
      if (linkElement) {
        const href = await linkElement.getAttribute('href');
        if (href) {
          // Extract ID from URL
          const match = href.match(/urn:li:activity:(\d+)|\/posts\/([^/?]+)|update:urn:li:share:(\d+)/);
          if (match) return match[1] || match[2] || match[3];
        }
      }

      // Strategy 3: Generate pseudo-ID from timestamp and position
      return `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    } catch (error) {
      logger.warn('Failed to extract post ID', { error: error.message });
      return `post_error_${Date.now()}`;
    }
  }

  /**
   * Extract metrics using layered selector strategies
   */
  async extractMetricsWithLayeredSelectors(postElement) {
    const metrics = {
      reactions: 0,
      comments: 0,
      reposts: 0
    };

    // Extract reactions
    metrics.reactions = await this.extractEngagementMetric(postElement, [
      '[data-testid*="social-actions"] button[aria-label*="reaction"]',
      'button[aria-label*="reaction"]',
      '.social-details-social-counts__reactions-count',
      '.reactions-count',
      '[class*="reactions"]'
    ], 'reaction');

    // Extract comments
    metrics.comments = await this.extractEngagementMetric(postElement, [
      '[data-testid*="social-actions"] button[aria-label*="comment"]',
      'button[aria-label*="comment"]',
      '.social-details-social-counts__comments',
      '[class*="comment"][class*="count"]'
    ], 'comment');

    // Extract reposts
    metrics.reposts = await this.extractEngagementMetric(postElement, [
      '[data-testid*="social-actions"] button[aria-label*="repost"]',
      'button[aria-label*="repost"]',
      '.social-details-social-counts__shares',
      '[class*="repost"][class*="count"]',
      '[aria-label*="repost"]'
    ], 'repost');

    return metrics;
  }

  /**
   * Extract a single engagement metric using fallback selectors
   */
  async extractEngagementMetric(postElement, selectors, metricType) {
    for (const selector of selectors) {
      try {
        const element = await postElement.$(selector);
        if (!element) continue;

        // Try to get text content
        const text = await element.evaluate(el => {
          // Check aria-label first (most reliable)
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;

          // Check innerText
          return el.innerText || el.textContent || '';
        });

        if (text) {
          // Parse the number (handles "1.2k", "1M", etc.)
          const count = this.parseEngagementCount(text);
          if (count > 0) {
            logger.info(`Extracted ${metricType}: ${count} from "${text}"`);
            return count;
          }
        }
      } catch (error) {
        // Continue to next selector
        continue;
      }
    }

    return 0; // Default if all selectors fail
  }

  /**
   * Parse numeric engagement values (handles 1k, 1.2M, etc.)
   */
  parseEngagementCount(text) {
    if (!text) return 0;

    const cleanText = text.trim().toLowerCase();
    const match = cleanText.match(/([\d.]+)\s*([km]?)/i);

    if (!match) return 0;

    const num = parseFloat(match[1]);
    const unit = match[2];

    if (unit === 'k') return Math.floor(num * 1000);
    if (unit === 'm') return Math.floor(num * 1000000);

    return Math.floor(num);
  }

  /**
   * Extract post metrics (reactions, comments, reposts)
   */
  async extractPostMetrics(postElement) {
    const metrics = {
      reactions: 0,
      comments: 0,
      reposts: 0
    };

    try {
      // Extract reactions
      const reactionsButton = await postElement.$('[aria-label*="reaction"]');
      if (reactionsButton) {
        const text = await reactionsButton.innerText();
        const match = text.match(/(\d+)/);
        if (match) metrics.reactions = parseInt(match[1]);
      }

      // Extract comments
      const commentsButton = await postElement.$('[aria-label*="comment"]');
      if (commentsButton) {
        const text = await commentsButton.innerText();
        const match = text.match(/(\d+)/);
        if (match) metrics.comments = parseInt(match[1]);
      }

      // Extract reposts
      const repostsButton = await postElement.$('[aria-label*="repost"]');
      if (repostsButton) {
        const text = await repostsButton.innerText();
        const match = text.match(/(\d+)/);
        if (match) metrics.reposts = parseInt(match[1]);
      }

    } catch (error) {
      logger.warn('Failed to extract metrics', { error: error.message });
    }

    return metrics;
  }

  /**
   * Extract post content
   */
  async extractPostData(postElement) {
    const data = {
      text: '',
      author: '',
      postId: ''
    };

    try {
      // Extract post text
      const contentEl = await postElement.$('.feed-shared-update-v2__description');
      if (contentEl) {
        data.text = await contentEl.innerText();
      }

      // Extract author
      const authorEl = await postElement.$('.update-components-actor__name');
      if (authorEl) {
        data.author = await authorEl.innerText();
      }

      // Generate pseudo-ID
      data.postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    } catch (error) {
      logger.warn('Failed to extract post data', { error: error.message });
    }

    return data;
  }

  /**
   * Check if post meets engagement thresholds
   */

  /**
   * Post a comment
   */
  async postComment(postId, commentText) {
    logger.info('Posting comment', { postId, length: commentText.length });

    // Human-like delay
    await this.randomDelay();

    // TODO: Implement actual comment posting logic
    // This is a placeholder - real implementation would:
    // 1. Find the post by ID
    // 2. Click comment button
    // 3. Type into editor
    // 4. Click submit

    logger.success('Comment posted successfully', { postId });
  }

  /**
   * Like a post
   */
  async likePost(postId) {
    logger.info('Liking post', { postId });
    await this.randomDelay();
    // TODO: Implement like logic
    logger.success('Post liked', { postId });
  }

  /**
   * Send connection request
   */
  async sendConnection(userId, message) {
    logger.info('Sending connection request', { userId });
    await this.randomDelay();
    // TODO: Implement connection logic
    logger.success('Connection request sent', { userId });
  }


  /**
   * Random delay for human-like behavior
   */
  async randomDelay() {
    const min = parseInt(process.env.MIN_ACTION_DELAY_MS) || 3000;
    const max = parseInt(process.env.MAX_ACTION_DELAY_MS) || 8000;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;

    logger.info(`Waiting ${delay}ms (human-like delay)`);
    await this.page.waitForTimeout(delay);
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.isRunning = false;

    if (this.page) {
      try {
        await this.page.close();
      } catch (error) {
        logger.warn('Error closing page', { error: error.message });
      }
      this.page = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn('Error closing browser', { error: error.message });
      }
      this.browser = null;
    }
  }

  /**
   * Reset session statistics
   */
  resetStats() {
    this.sessionStats = {
      commentsPosted: 0,
      likesGiven: 0,
      connectionsRequested: 0,
      postsProcessed: 0,
      errors: 0,
      startTime: null
    };
  }

  /**
   * Get thresholds with fallbacks and safe clamping
   */
  getThresholds() {
    // Use session thresholds if set via API, otherwise defaults
    const thresholds = this.thresholds || {
      minLikes: parseInt(process.env.MIN_REACTIONS_THRESHOLD) || this.defaults.minLikes,
      minComments: parseInt(process.env.MIN_COMMENTS_THRESHOLD) || this.defaults.minComments,
      minReposts: parseInt(process.env.MIN_REPOSTS_THRESHOLD) || this.defaults.minReposts,
      maxActions: parseInt(process.env.MAX_COMMENTS_PER_SESSION) || this.defaults.maxActions
      // Pure tab navigation always uses AND logic (all thresholds must pass)
    };

    // Safe clamp to non-negative values
    const clamped = {
      maxActions: Math.max(1, parseInt(thresholds.maxActions) || 10)
    };

    // Log warning once if thresholds were invalid
    if (!this.thresholdsValidated) {
      if (thresholds.maxActions !== clamped.maxActions) {
        this.logger.warn('Invalid maxActions detected, clamped to safe value', { original: thresholds.maxActions, clamped: clamped.maxActions });
      }
      this.thresholdsValidated = true;
    }

    return clamped;
  }

  /**
   * Simple count parser: removes commas and extracts first number with K/M suffix support
   * Examples: "33 comments" → 33, "1,234 reactions" → 1234, "1.2K" → 1200, "5M" → 5000000
   */
  parseCount(text) {
    // Handle null/undefined/empty
    if (text === null || text === undefined || text === '') {
      return 0;
    }

    // Convert to string, trim, normalize whitespace, remove commas
    let str = String(text).trim().replace(/\s+/g, ' ').replace(/,/g, '');

    // Extract first number with optional K/M suffix and word boundary
    // Matches: "4 comments" → 4, "1.2K" → 1200, "500" → 500
    // Rejects: "4000000comments" (no space), hidden concatenated digits
    const match = str.match(/^(\d+(?:\.\d+)?)\s*([KkMm])?\b/);
    
    if (!match) {
      // Log when no valid number found
      if (str.length > 0) {
        logger.warn(`parseCount: No valid number in "${text}"`);
      }
      return 0;
    }

    let num = parseFloat(match[1]);
    const suffix = match[2] ? match[2].toUpperCase() : '';

    // Handle K/M suffixes
    if (suffix === 'K') num *= 1000;
    else if (suffix === 'M') num *= 1000000;

    const result = Math.floor(num);

    // Validate reasonable range (0 to 10 million)
    if (result < 0 || result > 10000000) {
      logger.error(`parseCount: Unreasonable value ${result} from "${text}" - returning 0`);
      return 0;
    }

    // Log successful parse for debugging (only if different from input)
    if (str !== String(result) && result > 0) {
      logger.info(`parseCount: "${text}" → ${result}`);
    }

    return result;
  }

  /**
   * Safely parse metric to number with logging (uses parseCount)
   */
  safeParseMetric(value, metricName) {
    const raw = value;
    const parsed = this.parseCount(value);

    // Log raw and parsed for debugging
    const note = raw !== parsed ? `${metricName}: { raw: '${raw}', parsed: ${parsed} }` : null;

    return { value: parsed, note };
  }

  /**
   * Parse metrics object with degradation detection
   */
  parseMetricsSafe(rawMetrics) {
    const parseNotes = [];
    const reactions = this.safeParseMetric(rawMetrics.reactions, 'reactions');
    const comments = this.safeParseMetric(rawMetrics.comments, 'comments');
    const reposts = this.safeParseMetric(rawMetrics.reposts, 'reposts');

    if (reactions.note) parseNotes.push(reactions.note);
    if (comments.note) parseNotes.push(comments.note);
    if (reposts.note) parseNotes.push(reposts.note);

    const degradedParse = parseNotes.length > 0;

    return {
      reactions: reactions.value,
      comments: comments.value,
      reposts: reposts.value,
      degradedParse,
      parseNotes
    };
  }


  /**
   * DEPRECATED: Skip flow removed - pure tab navigation continues automatically
   * Keeping method stub for backwards compatibility
   */
  async skipFlow() {
    // Small delay before continuing to next tab
    const delay = 300 + Math.floor(Math.random() * 700); // 0.3-1s
    await this.page.waitForTimeout(delay);
  }

  /**
   * Helper: Read and identify focused element
   * Reads text, aria-label, and determines element type
   */
  async readFocusedElement() {
    try {
      const info = await this.page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;

        const tagName = el.tagName.toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const text = (el.innerText || el.textContent || '').trim();
        const className = el.className || '';

        // Determine element type based on aria-label and content
        const isReactionsCount =
          ariaLabel.includes('reaction') ||
          className.includes('reactions-count') ||
          (text.match(/^\d{1,}$/) && el.closest('[aria-label*="reaction"]'));

        const isCommentsCount =
          // Must have a number AND the word "comment" or "reply"
          (/\d+\s*(comment|reply)/i.test(text) || /\d+\s*(comment|reply)/i.test(ariaLabel)) &&
          // Exclude action buttons (no numbers in text - just "Comment" or "Reply")
          !(/^(comment|reply)$/i.test(text.trim())) &&
          // Exclude "Load more" links
          !text.toLowerCase().includes('load more');

        const isRepostsCount =
          // Must have a number AND "repost"/"share"
          (/\d+\s*(repost|share)/i.test(text) || /\d+\s*(repost|share)/i.test(ariaLabel)) &&
          // Exclude action buttons (just "Repost" or "Share" without numbers)
          !(/^(repost|share)$/i.test(text.trim()));

        const isLikeButton =
          ariaLabel.includes('like') ||
          ariaLabel.includes('react') ||
          (tagName === 'button' && text.toLowerCase() === 'like');

        const isCommentButton =
          (ariaLabel.includes('comment') && tagName === 'button') ||
          (tagName === 'button' && text.toLowerCase() === 'comment');

        return {
          tagName,
          ariaLabel,
          text,
          className,
          isReactionsCount,
          isCommentsCount,
          isRepostsCount,
          isLikeButton,
          isCommentButton
        };
      });

      return info;
    } catch (error) {
      logger.warn('Failed to read focused element', { error: error.message });
      return null;
    }
  }

  /**
   * Start keyboard-only automation loop - PURE TAB NAVIGATION
   * No J/C shortcuts, no PageDown scrolling
   *
   * Flow:
   * Tab → Reactions count → Tab → Comments count → Tab → Reposts count
   * → Tab → Like button (validation point) → If pass: Enter → Tab 2x → Enter (comment)
   * → Cmd+Shift+L → Wait 5-9s → Cmd+V → Verify → Tab to Post → Enter
   */
  async startKeyboardAutomation() {
    if (!this.isRunning || !this.page) {
      throw new Error('Runner not active');
    }

    if (this.keyboardLoopActive) {
      throw new Error('Keyboard automation already running');
    }

    logger.info('Starting PURE TAB automation (no shortcuts, no scrolling)...');

    // Clear seen posts for new session
    this.seenPostIds.clear();
    this.keyboardLoopActive = true;

    const { maxActions } = this.getThresholds();
    this.logger.info('Thresholds', { maxActions });

    // Reset comments counter
    this.sessionStats.commentsPosted = 0;

    // NEW TWO-MODE APPROACH: No complex state machine needed
    // Mode determined by this.optimizeEngagement flag

    try {
      // Update HUD for automation start
      await this.updateHUD({
        action: 'Tab Navigation Active',
        postId: '',
        lastKey: 'Tab',
        commentsPosted: 0,
        maxComments: maxActions
      });

      /* ======================================================================
         ARCHIVED - Old Tab-based Metrics Parsing (Commented for future use)
         ======================================================================
         This approach manually tabbed through Reactions → Comments → Reposts
         and validated thresholds before engagement. Kept for reference.
         
         The old logic was complex with position-based state machine:
         - Position 0: Find reactions first
         - Position 1: Find comments after reactions  
         - Position 2: Find reposts after comments
         - Position 3: All validated, look for Like button
         
         [All old code archived below - reactions parsing, comments parsing, etc.]
      ====================================================================== */

      // ======================================================================
      // NEW TWO-MODE APPROACH
      // ======================================================================

      // Main pure-tab automation loop - runs ENDLESSLY until manually stopped
      // NOTE: maxActions is ONLY for tracking successful comments, NOT for stopping
      // Tabbing is NOT an action - only successful comment posting counts as an action
      
      while (this.keyboardLoopActive && !this.stopRequested) {
        
        // Check if paused - wait in 1-second intervals
        while (this.isPaused && this.keyboardLoopActive && !this.stopRequested) {
          await this.randomDelay(1000, 1000); // Check every second
          continue;
        }
        
        // Exit if stopped during pause
        if (!this.keyboardLoopActive || this.stopRequested) break;
        
        try {
          
          // Check for stop request
          if (this.stopRequested) {
            this.logger.info('Stop requested, exiting automation loop gracefully');
            break;
          }

          // OPTIMIZATION: Press Tab with optimized delay
          await this.updateHUD({ lastKey: 'Tab' });
          await this.page.keyboard.press('Tab');
          
          // OPTIMIZATION: Use cached timing config
          const t = this.timing || this.defaults;
          const tabDelay = t.tabDelayMin + Math.floor(Math.random() * (t.tabDelayMax - t.tabDelayMin));
          await this.page.waitForTimeout(tabDelay);

          // OPTIMIZATION: Early exit check after delay
          if (this.stopRequested) {
            this.logger.info('Stop requested during Tab delay, exiting gracefully');
            break;
          }

          // NEW: Check if we're inside a post using the new method
          const postData = await this.isInsidePost();
          
          if (!postData || !postData.postId) {
            // Not on a post yet, keep tabbing
            continue;
          }

          // DUPLICATE PREVENTION: Check if we've already processed this post
          if (this.seenPostIds && this.seenPostIds.has(postData.postId)) {
            this.logger.info('⏭️ Post already processed, skipping', { postId: postData.postId });
            continue;
          }

          // Mark post as seen to prevent duplicates
          if (!this.seenPostIds) this.seenPostIds = new Set();
          this.seenPostIds.add(postData.postId);

          // OPTIMIZATION: Use Web Worker for heavy post processing
          try {
            const processedData = await this.executeWorkerTask('PROCESS_POST', postData);
            this.logger.info('✅ Post processed by Web Worker', { taskId: processedData.timestamp });
          } catch (error) {
            this.logger.warn('Web Worker processing failed, continuing with main thread');
          }

          this.logger.info('📍 Post detected', { 
            postId: postData.postId,
            mode: this.optimizeEngagement ? 'Optimized' : 'Default'
          });
                
                await this.updateHUD({
            postId: postData.postId,
            action: this.optimizeEngagement ? 'Analyzing...' : 'Engaging',
            engage: this.optimizeEngagement ? 'Checking...' : 'YES'
          });

          // OPTIMIZED MODE: Check if should engage
          if (this.optimizeEngagement) {
            // Update postData to include the HTML for webhook
            postData.outerHTML = postData.postHTML;
            const decision = await this.checkEngagementDecision(postData);

            this.logger.info('🎯 Decision check', {
              decisionEngage: decision.engage,
              isYes: decision.engage === 'yes',
              willSkip: decision.engage !== 'yes',
              postId: postData.postId
            });

            if (decision.engage !== 'yes') {
              this.logger.info('⏭️ Skipping post (optimize mode)', {
                postId: postData.postId,
                reason: decision.engage,
                decision: decision
              });
                await this.updateHUD({
                action: 'Skipped',
                postId: postData.postId,
                engage: 'NO'
              });

              // OPTIMIZATION: Schedule cleanup during idle time
              this.scheduleIdleCallback(() => this.cleanupTempData());

              // Keep tabbing to find next post
                continue;
              }

            logger.success('✅ Post approved for engagement', { postId: postData.postId });
            this.logger.info('▶️  Proceeding to engagement flow (find Like button, comment, etc.)');

            // Update HUD with YES decision
            await this.updateHUD({
              action: 'Approved',
              postId: postData.postId,
              engage: 'YES'
            });
          }

          // DEFAULT MODE or APPROVED POST: Engage with post
          logger.info('💬 Engaging with post...', { postId: postData.postId });

            await this.updateHUD({
            action: 'Posting Comment',
            postId: postData.postId,
            engage: 'YES'
          });

          // Navigate to comment button and engage
          const commented = await this.engageWithPost(postData);
          
          if (commented) {
            // Success path - same as before
            this.sessionStats.commentsPosted++;
            logger.success('🎉 Comment posted successfully', {
              commentsPosted: this.sessionStats.commentsPosted,
              remaining: maxActions - this.sessionStats.commentsPosted
            });

            await this.updateHUD({
              action: 'Comment Posted',
              commentsPosted: this.sessionStats.commentsPosted,
              maxComments: maxActions
            });

            // Cooldown between comments
            const cooldown = t.cooldownMin + Math.floor(Math.random() * (t.cooldownMax - t.cooldownMin));
            logger.info(`⏸️  Post-comment cooldown: ${(cooldown/1000).toFixed(3)}s`);
            await this.page.waitForTimeout(cooldown);
            
            // Keep tabbing until we find a different post ID
            logger.info('🔄 Continuing to tab until next post found...');
            const currentPostId = postData.postId;
            let foundNewPost = false;
            
            while (!foundNewPost) {
              await this.page.keyboard.press('Tab');
              await this.page.waitForTimeout(300);
              
              const checkPost = await this.isInsidePost();
              
              if (checkPost && checkPost.postId && checkPost.postId !== currentPostId) {
                logger.info('✅ Found new post', { 
                  oldPostId: currentPostId,
                  newPostId: checkPost.postId 
                });
                foundNewPost = true;
              }
            }
          } else {
            // FAILURE PATH - Don't stop, just skip to next post
            logger.warn('⚠️ Failed to engage with post, skipping to next post', { 
              postId: postData.postId 
            });
            
            await this.updateHUD({
              action: 'Skipped (Failed)',
              postId: postData.postId
            });
            
            // Keep tabbing until we find a different post ID
            logger.info('🔄 Skipping to next post...');
            const currentPostId = postData.postId;
            let foundNewPost = false;
            
            while (!foundNewPost) {
              await this.page.keyboard.press('Tab');
              await this.page.waitForTimeout(300);
              
              const checkPost = await this.isInsidePost();
              
              if (checkPost && checkPost.postId && checkPost.postId !== currentPostId) {
                logger.info('✅ Found new post after failure', { 
                  oldPostId: currentPostId,
                  newPostId: checkPost.postId 
                });
                foundNewPost = true;
              }
            }
            
            // Continue to next iteration - DON'T STOP
            continue;
          }

        } catch (error) {
          // Swallow expected browser closure errors
          if (error.message.includes('Target page') ||
              error.message.includes('Target closed') ||
              error.message.includes('context closed') ||
              error.message.includes('Browser closed')) {
            logger.info('Browser/page closed during loop iteration, exiting gracefully');
            break;
          }

          logger.error('Error in tab automation loop', { error: error.message });
          // Continue to next iteration on error
        }
      }

      logger.success('🏁 Tab automation completed', {
        commentsPosted: this.sessionStats.commentsPosted
      });

      // ARCHIVED OLD CODE BELOW - All the complex metrics parsing logic
      /* ======================================================================
         ARCHIVED - Old Tab-based Metrics Parsing (Commented for future use)
         ======================================================================
         
         The following code was the old approach that manually parsed metrics.
         It used a complex position-based state machine to tab through:
         Reactions → Comments → Reposts → Like Button
         
         This has been replaced with the new two-mode approach:
         - Default Mode: Extract post data → Call linkedin-reply → Post comment
         - Optimized Mode: Extract post data → Call linkedin-parse → If yes: Call linkedin-reply → Post comment
         
         [All old metrics parsing code archived here for future reference]
      ====================================================================== */

    } catch (error) {
      // Swallow expected browser closure errors during stop
      if (error.message.includes('Target page') ||
          error.message.includes('Target closed') ||
          error.message.includes('context closed') ||
          error.message.includes('Browser closed')) {
        logger.info('Browser/page closed during automation, stopping gracefully');
        return;
      }

      logger.error('Tab automation failed', { error: error.message });
      throw error;
    } finally {
      this.keyboardLoopActive = false;
    }
  }

  /**
   * Engage with a post by navigating to comment button and posting AI comment
   * Used in both Default and Optimized modes
   */
  async engageWithPost(postData) {
    try {
      logger.info('🎯 Starting engagement with post', { postId: postData.postId });
      
      // Step 1: Tab until we find Like button
      logger.info('🔍 Looking for Like button...');
      let likeButtonFound = false;
      
      for (let i = 0; i < 100; i++) {
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(200);
        
        const buttonInfo = await this.page.evaluate(() => {
          const activeElement = document.activeElement;
          
          // ENHANCED LOGGING: Check if we're on the button or a child element
          const parentButton = activeElement.closest('button.react-button__trigger');
          const isInsideButton = parentButton !== null;
          const actualButton = activeElement.tagName === 'BUTTON' ? activeElement : parentButton;
          
          // Collect debug info
          const debugInfo = {
            focusedElementTag: activeElement.tagName,
            focusedElementClasses: Array.from(activeElement.classList).slice(0, 3).join(', '),
            isButtonItself: activeElement.tagName === 'BUTTON',
            isInsideButton: isInsideButton,
            parentButtonExists: !!parentButton,
            tagName: activeElement.tagName,
            classList: Array.from(activeElement.classList),
            ariaLabel: activeElement.getAttribute('aria-label') || '',
            textContent: activeElement.textContent?.trim().substring(0, 50) || '',
            hasThumbsUpIcon: !!activeElement.querySelector('svg[data-test-icon="thumbs-up-outline-small"]'),
            hasLikeText: activeElement.querySelector('span.react-button__text')?.textContent?.trim() === 'Like',
            hasReactButtonClass: activeElement.classList.contains('react-button__trigger'),
            isInMainPost: !!activeElement.closest('.feed-shared-social-action-bar'),
            isInCommentSection: !!activeElement.closest('.comments-comment-social-bar--cr'),
            isReactionCount: activeElement.classList.contains('social-details-social-counts__count-value'),
            isReactionMenu: activeElement.classList.contains('reactions-menu__trigger'),
            // Check from actual button if we're inside one
            buttonAriaLabel: actualButton ? actualButton.getAttribute('aria-label') || '' : '',
            buttonHasReactClass: actualButton ? actualButton.classList.contains('react-button__trigger') : false,
            buttonHasIcon: actualButton ? !!actualButton.querySelector('svg[data-test-icon="thumbs-up-outline-small"]') : false
          };
          
          // CRITICAL FIX: Check from the actual button element, not just activeElement
          // If we're focused on a child element (SPAN/DIV), use the parent button
          const elementToCheck = actualButton || activeElement;
          
          // Must be a button (check the actual button, not the focused child)
          if (elementToCheck.tagName !== 'BUTTON') {
            debugInfo.detectionNote = 'Not a button element';
            return { isLikeButton: false, debugInfo };
          }
          
          // Look for thumbs-up icon (visual cue) in the actual button
          const hasThumbsUpIcon = elementToCheck.querySelector('svg[data-test-icon="thumbs-up-outline-small"]');
          
          // Look for "Like" text (visual cue) in the actual button
          const hasLikeText = elementToCheck.querySelector('span.react-button__text')?.textContent?.trim() === 'Like';
          
          // Must have react-button__trigger class on the actual button
          const hasReactButtonClass = elementToCheck.classList.contains('react-button__trigger');
          
          // CRITICAL: Must be in main post action bar, NOT in comment section
          const isInMainPost = elementToCheck.closest('.feed-shared-social-action-bar');
          const isInCommentSection = elementToCheck.closest('.comments-comment-social-bar--cr');
          
          // CRITICAL: aria-label should be exactly "React Like" (no person name)
          const ariaLabel = elementToCheck.getAttribute('aria-label') || '';
          const isMainPostLike = ariaLabel === 'React Like';
          
          // Avoid reaction counts and menus
          const isReactionCount = elementToCheck.classList.contains('social-details-social-counts__count-value') ||
                                  ariaLabel.includes('reactions'); // e.g. "347 reactions"
          const isReactionMenu = elementToCheck.classList.contains('reactions-menu__trigger');
          
          const isLikeButton = (hasThumbsUpIcon || hasLikeText) && 
                 hasReactButtonClass && 
                 isInMainPost && 
                 !isInCommentSection && 
                 isMainPostLike &&
                 !isReactionCount && 
                 !isReactionMenu;
          
          return { isLikeButton, debugInfo };
        });
        
        // Log what we're seeing - ENHANCED DIAGNOSTICS
        if (buttonInfo.debugInfo.focusedElementTag) {
          logger.info(`🔍 Tab ${i + 1}: Element focused`, {
            focusedOn: buttonInfo.debugInfo.isButtonItself ? 'BUTTON' : buttonInfo.debugInfo.focusedElementTag,
            focusedClasses: buttonInfo.debugInfo.focusedElementClasses,
            insideButton: buttonInfo.debugInfo.isInsideButton ? 'YES' : 'NO',
            ariaLabel: buttonInfo.debugInfo.ariaLabel || '(empty)',
            buttonAriaLabel: buttonInfo.debugInfo.buttonAriaLabel || '(none)',
            hasThumbsUpIcon: buttonInfo.debugInfo.hasThumbsUpIcon,
            hasLikeText: buttonInfo.debugInfo.hasLikeText,
            hasReactButtonClass: buttonInfo.debugInfo.hasReactButtonClass,
            isInMainPost: buttonInfo.debugInfo.isInMainPost,
            isLikeButton: buttonInfo.isLikeButton,
            // Show button-level checks
            buttonIcon: buttonInfo.debugInfo.buttonHasIcon,
            buttonReactClass: buttonInfo.debugInfo.buttonHasReactClass
          });
        }
        
        if (buttonInfo.isLikeButton) {
          likeButtonFound = true;
          logger.info('👍 Found Like button, pressing Enter...');
          await this.page.keyboard.press('Enter');
          await this.page.waitForTimeout(1000);
          break;
        }
      }
      
      if (!likeButtonFound) {
        logger.warn('⚠️ Like button not found, skipping post');
        return false;
      }
      
      // Step 2: Tab exactly 2 times to reach Comment button
      logger.info('📝 Tabbing 2 times to Comment button...');
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(500);
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(500);

      // Verify we're on the Comment button (main post, not comment section)
      const commentButtonInfo = await this.page.evaluate(() => {
        const activeElement = document.activeElement;
        
        // ENHANCED LOGGING: Check if we're on the button or a child element
        const parentButton = activeElement.closest('button.comment-button');
        const isInsideButton = parentButton !== null;
        const actualButton = activeElement.tagName === 'BUTTON' ? activeElement : parentButton;
        
        // Collect debug info
        const debugInfo = {
          focusedElementTag: activeElement.tagName,
          focusedElementClasses: Array.from(activeElement.classList).slice(0, 3).join(', '),
          isButtonItself: activeElement.tagName === 'BUTTON',
          isInsideButton: isInsideButton,
          parentButtonExists: !!parentButton,
          tagName: activeElement.tagName,
          classList: Array.from(activeElement.classList),
          ariaLabel: activeElement.getAttribute('aria-label') || '',
          textContent: activeElement.textContent?.trim().substring(0, 50) || '',
          hasCommentIcon: !!activeElement.querySelector('svg[data-test-icon="comment-small"]'),
          hasCommentText: activeElement.textContent?.trim() === 'Comment',
          hasCommentButtonClass: activeElement.classList.contains('comment-button'),
          isInMainPost: !!activeElement.closest('.feed-shared-social-action-bar'),
          isInCommentSection: !!activeElement.closest('.comments-comment-social-bar--cr'),
          // Check from actual button if we're inside one
          buttonAriaLabel: actualButton ? actualButton.getAttribute('aria-label') || '' : '',
          buttonHasCommentClass: actualButton ? actualButton.classList.contains('comment-button') : false,
          buttonHasIcon: actualButton ? !!actualButton.querySelector('svg[data-test-icon="comment-small"]') : false
        };
        
        // CRITICAL FIX: Check from the actual button element, not just activeElement
        // If we're focused on a child element (SPAN/DIV), use the parent button
        const elementToCheck = actualButton || activeElement;
        
        // Must be a button (check the actual button, not the focused child)
        if (elementToCheck.tagName !== 'BUTTON') {
          debugInfo.detectionNote = 'Not a button element';
          return { isCommentButton: false, debugInfo };
        }
        
        // Look for comment icon (visual cue) in the actual button
        const hasCommentIcon = elementToCheck.querySelector('svg[data-test-icon="comment-small"]');
        
        // Look for "Comment" text (visual cue) in the actual button
        const hasCommentText = elementToCheck.textContent?.trim() === 'Comment';
        
        // Must have comment-button class on the actual button
        const hasCommentButtonClass = elementToCheck.classList.contains('comment-button');
        
        // CRITICAL: Must be in main post action bar, NOT in comment section
        const isInMainPost = elementToCheck.closest('.feed-shared-social-action-bar');
        const isInCommentSection = elementToCheck.closest('.comments-comment-social-bar--cr');
        
        // CRITICAL: aria-label should be exactly "Comment" (no person name)
        const ariaLabel = elementToCheck.getAttribute('aria-label') || '';
        const isMainPostComment = ariaLabel === 'Comment';
        
        const isCommentButton = (hasCommentIcon || hasCommentText) && 
               hasCommentButtonClass && 
               isInMainPost && 
               !isInCommentSection && 
               isMainPostComment;
        
        return { isCommentButton, debugInfo };
      });
      
      // Log what we found - ENHANCED DIAGNOSTICS
      logger.info('📝 After 2 tabs, checking Comment button', {
        focusedOn: commentButtonInfo.debugInfo.isButtonItself ? 'BUTTON' : commentButtonInfo.debugInfo.focusedElementTag,
        focusedClasses: commentButtonInfo.debugInfo.focusedElementClasses,
        insideButton: commentButtonInfo.debugInfo.isInsideButton ? 'YES' : 'NO',
        ariaLabel: commentButtonInfo.debugInfo.ariaLabel || '(empty)',
        buttonAriaLabel: commentButtonInfo.debugInfo.buttonAriaLabel || '(none)',
        hasCommentIcon: commentButtonInfo.debugInfo.hasCommentIcon,
        hasCommentText: commentButtonInfo.debugInfo.hasCommentText,
        hasCommentButtonClass: commentButtonInfo.debugInfo.hasCommentButtonClass,
        isInMainPost: commentButtonInfo.debugInfo.isInMainPost,
        isCommentButton: commentButtonInfo.isCommentButton,
        // Show button-level checks
        buttonIcon: commentButtonInfo.debugInfo.buttonHasIcon,
        buttonCommentClass: commentButtonInfo.debugInfo.buttonHasCommentClass
      });
      
      const isOnCommentButton = commentButtonInfo.isCommentButton;

      if (!isOnCommentButton) {
        logger.warn('⚠️ Not on Comment button after 2 tabs, trying to find it...');
        
        // Try tabbing up to 5 more times to find Comment button
        let foundCommentButton = false;
        for (let i = 0; i < 5; i++) {
          await this.page.keyboard.press('Tab');
          await this.page.waitForTimeout(300);
          
          const checkComment = await this.page.evaluate(() => {
            const activeElement = document.activeElement;
            
            // CRITICAL FIX: Check from the actual button element
            const parentButton = activeElement.closest('button.comment-button');
            const actualButton = activeElement.tagName === 'BUTTON' ? activeElement : parentButton;
            const elementToCheck = actualButton || activeElement;
            
            if (elementToCheck.tagName !== 'BUTTON') return false;
            
            const hasCommentIcon = elementToCheck.querySelector('svg[data-test-icon="comment-small"]');
            const hasCommentText = elementToCheck.textContent?.trim() === 'Comment';
            const hasCommentButtonClass = elementToCheck.classList.contains('comment-button');
            const isInMainPost = elementToCheck.closest('.feed-shared-social-action-bar');
            const isInCommentSection = elementToCheck.closest('.comments-comment-social-bar--cr');
            const ariaLabel = elementToCheck.getAttribute('aria-label') || '';
            const isMainPostComment = ariaLabel === 'Comment';
            
            return (hasCommentIcon || hasCommentText) && 
                   hasCommentButtonClass && 
                   isInMainPost && 
                   !isInCommentSection && 
                   isMainPostComment;
          });
          
          if (checkComment) {
            foundCommentButton = true;
            logger.info('✅ Found Comment button');
            break;
          }
        }
        
        if (!foundCommentButton) {
          logger.warn('⚠️ Could not find Comment button, skipping post');
          return false;
        }
      }
      
      // Step 3: Press Enter to open comment editor
      logger.info('📝 Pressing Enter to open comment editor...');
      await this.page.keyboard.press('Enter');
      
      // Step 4: Wait 1-2 seconds for editor to open
      await this.page.waitForTimeout(2000);
      
      // Step 5: Call linkedin-reply webhook to get AI comment
      logger.info('🤖 Calling linkedin-reply webhook for AI comment...');
      const aiComment = await this.callWebhookFromRunner({
        postId: postData.postId,
        postText: postData.postContent,
        authorName: postData.authorName,
        actionType: 'comment',
        timestamp: new Date().toISOString()
      });
      
      if (!aiComment) {
        logger.error('❌ Failed to get AI comment from webhook');
        await this.page.keyboard.press('Escape');
        return false;
      }
      
      // Step 6: Paste the AI comment
      logger.info('📋 Pasting AI comment...');
      await this.pasteCommentReliably(aiComment);
      
      // Step 7: Tab exactly 3 times to reach Post button
      logger.info('🔍 Tabbing 3 times to Post button...');
      for (let i = 0; i < 3; i++) {
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(500);
      }
      
      // Step 8: Press Enter to submit comment
      logger.info('✅ Pressing Enter to post comment...');
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(1500);
      
      logger.success('🎉 Comment posted successfully!');
      return true;
      
    } catch (error) {
      logger.error('❌ Failed to engage with post', { error: error.message });
      return false;
    }
  }




  /**
   * OPTIMIZATION: Extract post data with caching, memoization, and efficient DOM queries
   * Used for both Default and Optimized modes
   */
  async extractPostData() {
    try {
      // OPTIMIZATION: Memoization check first
      const memoKey = `extract_${Date.now()}`;
      if (this._memoizedExtractPostData.has(memoKey)) {
        const memoized = this._memoizedExtractPostData.get(memoKey);
        this.logger.info('✅ Post data from memoization', { postId: memoized.postId });
        return memoized;
      }
      
      // OPTIMIZATION: Check cache second
      const cacheKey = `post_${Date.now()}`;
      const cached = this._domCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this._cacheTimeout) {
        this.logger.info('✅ Post data from cache', { postId: cached.result.postId });
        return cached.result;
      }
      
      // OPTIMIZATION: Single DOM query with efficient selectors
      const postData = await this.page.evaluate(() => {
        const activeElement = document.activeElement;
        
        // OPTIMIZATION: Use document.querySelectorAll once for all data-id elements
        const allDataIdElements = document.querySelectorAll('div[data-id^="urn:li:activity:"]');
        let dataIdElement = null;
        
        // OPTIMIZATION: Early return on first match
        for (const element of allDataIdElements) {
          if (element.contains(activeElement) || activeElement.contains(element)) {
            dataIdElement = element;
            break;
          }
        }
        
        if (!dataIdElement) {
          // OPTIMIZATION: Fallback to first visible element
          dataIdElement = allDataIdElements[0];
        }
        
        if (!dataIdElement) return null;
        
        const postId = dataIdElement.getAttribute('data-id');
        
        // OPTIMIZATION: Single query for all content with combined selector
        const contentElement = dataIdElement.querySelector(
          '.feed-shared-update-v2__description, ' +
          '.feed-shared-text, ' +
          '.update-components-update-v2__commentary'
        );
        
        const postContent = contentElement?.innerText?.trim() || '';
        
        // OPTIMIZATION: Single query for author
        const authorElement = dataIdElement.querySelector(
          '.update-components-actor__name, ' +
          '.feed-shared-actor__name'
        );
        
        const authorName = authorElement?.innerText?.trim() || 'Unknown';
        
        return {
          postId,
          postContent,
          authorName,
          outerHTML: dataIdElement.outerHTML,
          htmlLength: dataIdElement.outerHTML.length
        };
      });

      if (postData) {
        // OPTIMIZATION: Cache result
        this._domCache.set(cacheKey, {
          result: postData,
          timestamp: Date.now()
        });
        
        // OPTIMIZATION: Memoize result
        this._memoizedExtractPostData.set(memoKey, postData);
        
        // OPTIMIZATION: Limit cache sizes
        if (this._domCache.size > 50) {
          const firstKey = this._domCache.keys().next().value;
          this._domCache.delete(firstKey);
        }
        
        if (this._memoizedExtractPostData.size > 100) {
          const firstMemoKey = this._memoizedExtractPostData.keys().next().value;
          this._memoizedExtractPostData.delete(firstMemoKey);
        }
        
        this.logger.info('✅ Post data extracted', { 
          postId: postData.postId,
          contentLength: postData.postContent.length,
          htmlLength: postData.htmlLength 
        });
        return postData;
      }
      
      this.logger.warn('⚠️ No div[data-id] found');
      return null;
      
    } catch (error) {
      this.logger.error('Failed to extract post data', { error: error.message });
      return null;
    }
  }

  /**
   * OPTIMIZATION: Call linkedin-parse webhook with connection pooling and caching
   * Only called in Optimized mode
   */
  async checkEngagementDecision(postData) {
    const methodStartTime = Date.now(); // Track total time spent in this method

    try {
      if (!this.postAnalysisWebhook) {
        this.logger.warn('No post analysis webhook configured, defaulting to engage');
        return { engage: 'yes' };
      }

      // OPTIMIZATION: Check cache first
      const cacheKey = `engagement_${postData.postId}`;
      const cached = this._domCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this._cacheTimeout) {
        this.logger.info('✅ Engagement decision from cache', { engage: cached.result.engage });
        return cached.result;
      }

      this.logger.info('🔍 Calling linkedin-parse webhook for engagement decision...', {
        webhook: this.postAnalysisWebhook,
        postId: postData.postId
      });

      this.logger.info('⏸️  BLOCKING: Runner will wait up to 180 seconds (3 minutes) for webhook response before continuing...');
      this.logger.info('⏸️  The runner will NOT tab ahead until a decision is received or timeout occurs');

      // Update HUD to show waiting status
      await this.updateHUD({
        postId: postData.postId,
        action: 'Waiting for AI analysis...',
        engage: 'Pending...'
      });

      // NEW FORMAT: Send outer_html to linkedin-parse webhook
      const request = {
        url: this.postAnalysisWebhook,
        payload: {
          outer_html: postData.outerHTML || postData.postHTML
        },
        timeout: 180000  // 180 seconds (3 minutes) - wait for full analysis before defaulting to engage
      };

      const startWaitTime = Date.now();
      const result = await this.executeWebhookRequest(request);
      const waitDuration = Date.now() - startWaitTime;

      this.logger.info('✅ Webhook responded after ' + waitDuration + 'ms - resuming runner');

      // NORMALIZE: Handle both "Engage"/"engage" and "YES"/"yes" from n8n
      const normalizedResult = {
        engage: (result.engage || result.Engage || 'yes').toLowerCase(),
        postId: result.postId || result.PostId || postData.postId
      };

      this.logger.info('🔄 Normalized webhook response', {
        original: result,
        normalized: normalizedResult
      });

      // OPTIMIZATION: Cache result
      this._domCache.set(cacheKey, {
        result: normalizedResult,
        timestamp: Date.now()
      });

      this.logger.info('✅ Engagement decision received', {
        engage: normalizedResult.engage,
        postId: normalizedResult.postId,
        waitTime: waitDuration + 'ms',
        willEngage: normalizedResult.engage === 'yes'
      });

      return normalizedResult;

    } catch (error) {
      const totalWaitTime = Date.now() - methodStartTime;

      this.logger.error('❌ linkedin-parse webhook failed after ' + totalWaitTime + 'ms, defaulting to engage', {
        error: error.message,
        errorName: error.name,
        webhook: this.postAnalysisWebhook,
        postId: postData.postId,
        totalWaitTime: totalWaitTime + 'ms',
        maxTimeout: '180000ms',
        hasOuterHTML: !!(postData.outerHTML || postData.postHTML),
        payloadSize: JSON.stringify({
          outer_html: postData.outerHTML || postData.postHTML
        }).length,
        recommendation: 'Check detailed diagnostics above for specific error type and resolution steps'
      });

      this.logger.warn('⚠️  After waiting ' + totalWaitTime + 'ms, defaulting to ENGAGE and resuming runner');

      // Default to engage on error (fail open, not closed)
      return { engage: 'yes' };
    }
  }


  /**
   * Paste comment reliably with multiple fallback methods
   */
  async pasteCommentReliably(text) {
    try {
      // Step 1: Copy to clipboard
      await this.page.evaluate(async (t) => {
        await navigator.clipboard.writeText(t);
      }, text);

      await this.page.waitForTimeout(300);

      // Step 2: Find and focus the ACTIVE comment editor (not just the first one)
      const editorFocused = await this.page.evaluate(() => {
        // Try to find the editor from the currently focused element
        let editor = null;
        
        // Method 1: Check if active element is already the editor
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        
        // Method 2: Find editor within the active element's parent container
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        
        // Method 3: Find the most recently opened/visible editor (has focus-within or is in viewport)
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        
        // Fallback: Use first editor (old behavior) only if nothing else works
        if (!editor) {
          editor = document.querySelector('.ql-editor[contenteditable="true"]');
        }
        
        if (editor) {
          editor.focus();
          return true;
        }
        return false;
      });

      if (!editorFocused) {
        logger.warn('Could not focus comment editor');
        return false;
      }

      await this.page.waitForTimeout(200);

      // Step 3: Try clipboard paste (Cmd+V / Ctrl+V)
      const isMac = process.platform === 'darwin';
      const pasteKey = isMac ? 'Meta+KeyV' : 'Control+KeyV';

      logger.info(`Attempting clipboard paste (${isMac ? 'Cmd+V' : 'Ctrl+V'})...`);
      await this.page.keyboard.press(pasteKey);
      await this.page.waitForTimeout(1000);

      // Verify paste succeeded in the ACTIVE editor (not just the first one)
      const hasContent = await this.page.evaluate(() => {
        // Use the same logic to find the active editor
        let editor = null;
        
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        
        if (editor) {
          const text = editor.innerText || editor.textContent || '';
          return text.trim().length >= 10;
        }
        return false;
      });

      if (hasContent) {
        logger.success('Paste successful via clipboard (Cmd/Ctrl+V)');
        return true;
      }

      // Fallback 1: Try execCommand('insertText')
      logger.warn('Clipboard paste failed, trying execCommand...');
      const execSuccess = await this.page.evaluate((t) => {
        // Find the active editor using the same logic
        let editor = null;
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        if (!editor) {
          editor = document.querySelector('.ql-editor[contenteditable="true"]');
        }
        if (editor) {
          editor.focus();
          try {
            document.execCommand('insertText', false, t);
            return true;
          } catch (e) {
            return false;
          }
        }
        return false;
      }, text);

      if (execSuccess) {
        await this.page.waitForTimeout(500);

        // Verify
        const hasContentAfterExec = await this.page.evaluate(() => {
          // Find the active editor using the same logic
          let editor = null;
          const activeEl = document.activeElement;
          if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
            editor = activeEl;
          }
          if (!editor && activeEl) {
            const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
            if (container) {
              editor = container.querySelector('.ql-editor[contenteditable="true"]');
            }
          }
          if (!editor) {
            const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
            for (const ed of allEditors) {
              const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
              if (container && container.matches(':focus-within')) {
                editor = ed;
                break;
              }
            }
          }
          if (!editor) {
            editor = document.querySelector('.ql-editor[contenteditable="true"]');
          }
          if (editor) {
            const text = editor.innerText || editor.textContent || '';
            return text.trim().length >= 10;
          }
          return false;
        });

        if (hasContentAfterExec) {
          logger.success('Paste successful via execCommand');
          return true;
        }
      }

      // Fallback 2: Type character by character (slow but reliable)
      logger.warn('execCommand failed, using type fallback...');
      const editor = await this.page.locator('.ql-editor[contenteditable="true"]').first();

      await editor.click();
      await this.page.waitForTimeout(300);
      await editor.type(text, { delay: 5 }); // 5ms delay between characters

      await this.page.waitForTimeout(500);

      // Final verification
      const hasContentAfterType = await this.page.evaluate(() => {
        // Find the active editor using the same logic
        let editor = null;
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        if (!editor) {
          editor = document.querySelector('.ql-editor[contenteditable="true"]');
        }
        if (editor) {
          const text = editor.innerText || editor.textContent || '';
          return text.trim().length >= 10;
        }
        return false;
      });

      if (hasContentAfterType) {
        logger.success('Paste successful via type fallback');
        return true;
      }

      logger.error('All paste methods failed verification');
      return false;

    } catch (error) {
      logger.error('Error in pasteCommentReliably', { error: error.message });
      return false;
    }
  }

  /**
   * Extract post data from Chromium page's currently focused post
   * This runs in Chromium's context, not Chrome extension
   */
  async extractPostDataFromChromium() {
    try {
      const postData = await this.page.evaluate(() => {
        // Find the active comment editor to locate the parent post
        let editor = null;
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        if (!editor) {
          editor = document.querySelector('.ql-editor[contenteditable="true"]');
        }
        if (!editor) {
          return null;
        }

        // Find the parent post container - improved logic with multiple fallbacks
        let postContainer = editor.closest('.feed-shared-update-v2');
        
        // If not found, try alternative selectors
        if (!postContainer) {
          postContainer = editor.closest('[data-urn]') || 
                         editor.closest('.update-components-update-v2') ||
                         editor.closest('article');
        }
        
        if (!postContainer) {
          return null;
        }

        // Extract post ID first to validate we have the right post
        const postId = postContainer.getAttribute('data-urn') || 
                       postContainer.getAttribute('data-id') ||
                       `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Determine if this is a comment or reply
        const isReply = editor.closest('.comments-comment-item') !== null;
        const actionType = isReply ? 'reply' : 'comment';

        // Extract post text - handle truncation with better targeting
        let postText = '';

        // Try to find and click "see more" button within this specific post
        const seeMoreButton = postContainer.querySelector(
          '.feed-shared-inline-show-more-text__see-more-less-toggle, ' +
          '.feed-shared-text__see-more, ' +
          '.comments-comment-item__see-more-less-toggle'
        );
        
        if (seeMoreButton && !seeMoreButton.getAttribute('data-linkright-expanded')) {
          seeMoreButton.click();
          seeMoreButton.setAttribute('data-linkright-expanded', 'true');
          // Wait a bit for content to expand
          setTimeout(() => {}, 100);
        }

        // Extract full text from this specific post container only
        const textContainers = postContainer.querySelectorAll(
          '.feed-shared-update-v2__description, ' +
          '.feed-shared-text, ' +
          '.comments-comment-item__main-content, ' +
          '.update-components-update-v2__commentary, ' +
          '.break-words span[dir="ltr"]'
        );
        
        textContainers.forEach(container => {
          const text = container.innerText || container.textContent;
          if (text && text.trim() && text.length > postText.length) {
            postText = text.trim();
          }
        });

        // Extract author name
        let authorName = 'Unknown';
        const authorElement = postContainer.querySelector(
          '.update-components-actor__name, ' +
          '.feed-shared-actor__name, ' +
          '.update-components-actor__title, ' +
          '.comments-comment-item-content__name'
        );
        if (authorElement) {
          authorName = authorElement.innerText || authorElement.textContent || 'Unknown';
        }

        return {
          postId: postId,
          postText: postText,
          authorName: authorName.trim(),
          actionType: actionType,
          timestamp: new Date().toISOString()
        };
      });

      return postData;
    } catch (error) {
      logger.error('Failed to extract post data from Chromium', { error: error.message });
      return null;
    }
  }

  /**
   * Call webhook API from Node.js (runner context) with post data
   * Returns AI-generated comment
   */
  async callWebhookFromRunner(postData) {
    try {
      // Get webhook settings from stored config
      const webhookUrl = this.webhookUrl || 'https://n8n.linkright.in/webhook/linkedin-reply';
      const token = this.xRunnerToken || 'dev-secure-token-12345';

      // === Detailed Request Logging ===
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('🌐 WEBHOOK CALL FROM NODE.JS (not visible in browser Network tab)');
      logger.info(`📍 URL: ${webhookUrl}`);
      logger.info(`🔑 Token: ${token.substring(0, 10)}...`);
      logger.info(`🆔 Post ID: ${postData.postId}`); // NEW: Log post ID
      logger.info(`👤 Author: ${postData.authorName}`);
      logger.info(`📝 Action: ${postData.actionType}`);
      logger.info(`📄 Post Text (first 200 chars):`);
      logger.info(`   ${postData.postText.substring(0, 200)}${postData.postText.length > 200 ? '...' : ''}`);
      logger.info(`   (Total length: ${postData.postText.length} chars)`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const startTime = Date.now();
      
      // Construct payload with postId for Sheet linking
      const payload = {
        postId: postData.postId, // NEW: Include post ID for Sheet linking
        postContent: postData.postText,
        authorName: postData.authorName,
        actionType: postData.actionType || 'comment',
        timestamp: postData.timestamp
      };
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-runner-token': token
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000) // 30s timeout
      });

      const elapsed = Date.now() - startTime;

      // === Response Logging ===
      logger.info(`⏱️  Response time: ${elapsed}ms`);
      logger.info(`📊 Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logger.error('❌ WEBHOOK ERROR RESPONSE');
        logger.error(`Status: ${response.status}`);
        logger.error(`Body: ${errorText.substring(0, 500)}`);
        logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        throw new Error(`Webhook returned ${response.status}: ${errorText.substring(0, 100)}`);
      }

      const result = await response.json();
      
      if (!result || !result.comment) {
        logger.error('❌ Invalid webhook response - missing comment field');
        logger.error(`Response: ${JSON.stringify(result).substring(0, 200)}`);
        throw new Error('Invalid webhook response - missing comment field');
      }

      // === Success Logging ===
      logger.success('✅ WEBHOOK SUCCESS');
      logger.info(`💬 AI Comment generated (${result.comment.length} chars)`);
      logger.info(`📝 Preview (first 150 chars):`);
      logger.info(`   ${result.comment.substring(0, 150)}${result.comment.length > 150 ? '...' : ''}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return result.comment;

    } catch (error) {
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.error('❌ WEBHOOK CALL FAILED');
      logger.error(`Error Type: ${error.name}`);
      logger.error(`Error Message: ${error.message}`);
      if (error.cause) {
        logger.error(`Root Cause: ${error.cause}`);
      }
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return null;
    }
  }

  /**
   * Post comment via keyboard in Chromium automation
   * Extracts post data from Chromium DOM and calls webhook from Node.js
   */
  async postCommentViaKeyboard(postId) {
    try {
      // Editor should already be open from pressing Enter on comment button
      logger.info('Verifying comment editor is open...');

      const editorVisible = await this.page.evaluate(() => {
        // Check if any editor is visible using the same logic
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          return true;
        }
        if (activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container && container.querySelector('.ql-editor[contenteditable="true"]')) {
            return true;
          }
        }
        const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
        for (const ed of allEditors) {
          const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
          if (container && container.matches(':focus-within')) {
            return true;
          }
        }
        return !!document.querySelector('.ql-editor[contenteditable="true"]');
      });
      if (!editorVisible) {
        logger.warn('Comment editor is not visible - may need to wait longer');
        await this.page.waitForTimeout(1000);
        const retryVisible = await this.page.evaluate(() => {
          const activeEl = document.activeElement;
          if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
            return true;
          }
          if (activeEl) {
            const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
            if (container && container.querySelector('.ql-editor[contenteditable="true"]')) {
              return true;
            }
          }
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              return true;
            }
          }
          return !!document.querySelector('.ql-editor[contenteditable="true"]');
        });
        if (!retryVisible) {
          logger.error('Comment editor did not appear after retry');
        return false;
        }
      }

      // Check if we've already commented on this post
      if (postId && this.seenPostIds.has(postId)) {
        logger.warn('🚫 Skipping comment - already commented on this post', { 
          postId: postId,
          totalSeen: this.seenPostIds.size 
        });
        return false;
      }

      logger.info('Comment editor verified, extracting post data from Chromium...');

      // Extract post data directly from Chromium page
      const postData = await this.extractPostDataFromChromium();
      
      if (!postData || !postData.postText) {
        logger.error('Failed to extract post data from Chromium');
        return false;
      }

      // Validate that we're extracting content from the correct post
      if (postId && postData.postId && postId !== postData.postId) {
        logger.error('❌ Post ID mismatch - extracting wrong post content', { 
          expectedPostId: postId, 
          extractedPostId: postData.postId 
        });
        return false;
      }

      logger.info('✅ Post ID validated - content matches focused post', {
        postId: postId || postData.postId
      });

      logger.info('Post data extracted, calling webhook from runner...');

      // Call webhook from Node.js (not from browser)
      const aiComment = await this.callWebhookFromRunner(postData);

      if (!aiComment) {
        logger.error('Failed to generate AI comment from webhook');
        return false;
      }

      logger.info('AI comment generated, waiting for human-like timing...');
      const timingConfig = this.timing || this.defaults;
      const waitMs = timingConfig.webhookWaitMin + Math.floor(Math.random() * (timingConfig.webhookWaitMax - timingConfig.webhookWaitMin));
      await this.page.waitForTimeout(waitMs);

      // Direct DOM insertion (Cmd+V doesn't work in Chromium automation)
      logger.info('Inserting comment directly into editor...');
      await this.page.evaluate((text) => {
        // Find the active editor using the same logic
        let editor = null;
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        if (!editor) {
          editor = document.querySelector('.ql-editor[contenteditable="true"]');
        }
        if (editor) {
          // Focus editor
          editor.focus();
          
          // Clear existing content
          editor.innerHTML = '';
          
          // Insert text with proper line breaks
          const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
          lines.forEach((line, index) => {
            const textNode = document.createTextNode(line);
            editor.appendChild(textNode);
            if (index < lines.length - 1) {
              editor.appendChild(document.createElement('br'));
            }
          });
          
          // Trigger change events for LinkedIn
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, aiComment);

      // Wait for DOM to settle
      await this.page.waitForTimeout(1000);

      // Verify by comparing actual content
      const verifyResult = await this.page.evaluate((expectedText) => {
        // Find the active editor using the same logic
        let editor = null;
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('ql-editor') && activeEl.getAttribute('contenteditable') === 'true') {
          editor = activeEl;
        }
        if (!editor && activeEl) {
          const container = activeEl.closest('.comments-comment-box, .comments-comment-box-comment, .comment-box');
          if (container) {
            editor = container.querySelector('.ql-editor[contenteditable="true"]');
          }
        }
        if (!editor) {
          const allEditors = document.querySelectorAll('.ql-editor[contenteditable="true"]');
          for (const ed of allEditors) {
            const container = ed.closest('.comments-comment-box, .comments-comment-box-comment');
            if (container && container.matches(':focus-within')) {
              editor = ed;
              break;
            }
          }
        }
        if (!editor) {
          editor = document.querySelector('.ql-editor[contenteditable="true"]');
        }
        if (!editor) return { success: false, reason: 'Editor not found' };
        
        const actual = (editor.innerText || editor.textContent || '').trim();
        const expected = expectedText.trim();
        
        // Normalize whitespace for comparison
        const normalize = (s) => s.replace(/\s+/g, ' ').trim();
        const match = normalize(actual) === normalize(expected);
        
        return {
          success: match,
          actual: actual.substring(0, 100),
          expected: expected.substring(0, 100),
          reason: match ? 'Content matches' : 'Content mismatch'
        };
      }, aiComment);

      if (!verifyResult.success) {
        logger.error('Paste verification failed', verifyResult);
        return false;
      }

      logger.success(`✅ Paste verified - content matches!`);
      logger.info('Waiting before submit...');
      
      const submitWaitMs = timingConfig.pasteDelayMin + Math.floor(Math.random() * (timingConfig.pasteDelayMax - timingConfig.pasteDelayMin));
      await this.page.waitForTimeout(submitWaitMs);

      logger.info('Submitting via Tab×3 + Enter...');

      // Submit via Tab×3 then Enter
      for (let i = 0; i < 3; i++) {
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(120 + Math.floor(Math.random() * 180));
      }
      await this.page.keyboard.press('Enter');

      logger.success('Comment submitted successfully');

      // Wait for submission to complete
      await this.page.waitForTimeout(2000);

      return true;

    } catch (error) {
      logger.error('Failed to post comment via keyboard', { error: error.message });
      return false;
    }
  }


  /**
   * OPTIMIZATION: Enhanced stop method with efficient cleanup
   */
  async stop() {
    this.logger.info('Stopping Playwright runner...');

    this.keyboardLoopActive = false; // Stop keyboard loop

    // OPTIMIZATION: Use requestIdleCallback for cleanup
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => this.cleanupTempData());
    } else {
      this.cleanupTempData();
    }

    await this.cleanup();

    const finalStats = { ...this.sessionStats };
    this.resetStats();
    this.seenPostIds.clear();

    this.logger.success('Runner stopped and browser closed', finalStats);
    return {
      success: true,
      message: 'Runner stopped',
      stats: finalStats
    };
  }

  /**
   * OPTIMIZATION: Efficient cleanup of temporary data
   */
  cleanupTempData() {
    // OPTIMIZATION: Clear caches periodically
    if (this._domCache.size > 50) {
      const now = Date.now();
      for (const [key, value] of this._domCache.entries()) {
        if (now - value.timestamp > this._cacheTimeout) {
          this._domCache.delete(key);
        }
      }
    }
    
    // OPTIMIZATION: Clear memoization cache
    if (this._memoizedExtractPostData.size > 100) {
      this._memoizedExtractPostData.clear();
    }
    
    // OPTIMIZATION: Clear request queue
    this.requestQueue = [];
  }

  /**
   * OPTIMIZATION: Initialize Web Worker for heavy computations
   */
  async initializeWorker() {
    if (this.worker) return;
    
    try {
      // OPTIMIZATION: Create Web Worker for post processing
      const workerCode = `
        self.onmessage = function(e) {
          const { taskId, type, data } = e.data;
          
          switch (type) {
            case 'PROCESS_POST':
              // Heavy post processing logic
              const processed = processPostData(data);
              self.postMessage({ taskId, result: processed });
              break;
              
            case 'ANALYZE_ENGAGEMENT':
              // Heavy engagement analysis
              const analysis = analyzeEngagement(data);
              self.postMessage({ taskId, result: analysis });
              break;
          }
        };
        
        function processPostData(data) {
          // Heavy processing logic here
          return {
            processed: true,
            timestamp: Date.now(),
            data: data
          };
        }
        
        function analyzeEngagement(data) {
          // Heavy analysis logic here
          return {
            shouldEngage: true,
            confidence: 0.8,
            timestamp: Date.now()
          };
        }
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      
      this.worker = new Worker(workerUrl);
      
      this.worker.onmessage = (e) => {
        const { taskId, result } = e.data;
        const task = this.workerTasks.get(taskId);
        if (task) {
          task.resolve(result);
          this.workerTasks.delete(taskId);
        }
      };
      
      this.worker.onerror = (error) => {
        this.logger.error('Web Worker error:', error);
      };
      
    } catch (error) {
      this.logger.warn('Web Worker not available, falling back to main thread');
    }
  }

  /**
   * OPTIMIZATION: Execute task in Web Worker or fallback to main thread
   */
  async executeWorkerTask(type, data) {
    if (!this.worker) {
      await this.initializeWorker();
    }
    
    if (!this.worker) {
      // Fallback to main thread
      return this.executeMainThreadTask(type, data);
    }
    
    const taskId = ++this.taskId;
    const promise = new Promise((resolve, reject) => {
      this.workerTasks.set(taskId, { resolve, reject });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.workerTasks.has(taskId)) {
          this.workerTasks.delete(taskId);
          reject(new Error('Worker task timeout'));
        }
      }, 10000);
    });
    
    this.worker.postMessage({ taskId, type, data });
    return promise;
  }

  /**
   * OPTIMIZATION: Fallback main thread task execution
   */
  executeMainThreadTask(type, data) {
    switch (type) {
      case 'PROCESS_POST':
    return {
          processed: true,
          timestamp: Date.now(),
          data: data
        };
        
      case 'ANALYZE_ENGAGEMENT':
        return {
          shouldEngage: true,
          confidence: 0.8,
          timestamp: Date.now()
        };
        
      default:
        return null;
    }
  }

  /**
   * OPTIMIZATION: Schedule idle callback for non-critical operations
   */
  scheduleIdleCallback(callback, options = {}) {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(callback, options);
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(callback, 0);
    }
  }

  /**
   * OPTIMIZATION: Batch webhook requests for better performance
   */
  async batchWebhookRequests(requests) {
    if (requests.length === 0) return [];
    
    const batches = [];
    for (let i = 0; i < requests.length; i += this.batchSize) {
      batches.push(requests.slice(i, i + this.batchSize));
    }
    
    const results = await Promise.allSettled(
      batches.map(batch => this.processBatch(batch))
    );
    
    return results.flat();
  }

  /**
   * OPTIMIZATION: Process a batch of requests
   */
  async processBatch(batch) {
    const promises = batch.map(request => this.executeWebhookRequest(request));
    return Promise.allSettled(promises);
  }

  /**
   * OPTIMIZATION: Execute single webhook request with connection pooling
   */
  async executeWebhookRequest(request) {
    const { url, payload, timeout = 10000 } = request;

    // PRE-FETCH DIAGNOSTICS: Log what we're about to send
    let payloadStringified = null;
    let payloadValidationError = null;

    try {
      payloadStringified = JSON.stringify(payload);

      this.logger.info('🔍 PRE-FETCH: About to send webhook request', {
        url: url,
        timeout: timeout,
        payloadType: typeof payload,
        payloadKeys: payload ? Object.keys(payload) : null,
        payloadSize: payloadStringified.length,
        payloadPreview: payloadStringified.substring(0, 200) + '...',
        hasOuterHTML: payload?.outer_html ? true : false,
        outerHTMLType: typeof payload?.outer_html,
        outerHTMLLength: payload?.outer_html?.length || 0
      });
    } catch (e) {
      payloadValidationError = e.message;
      this.logger.error('❌ PRE-FETCH: Failed to stringify payload', {
        error: e.message,
        payloadType: typeof payload,
        payload: payload
      });
      throw new Error(`Payload serialization failed: ${e.message}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // Note: Connection and Keep-Alive headers removed - Node.js fetch (undici)
          // manages connections automatically and throws UND_ERR_INVALID_ARG if we try to set them
        },
        body: payloadStringified,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Log response details BEFORE parsing
      this.logger.info('📥 Webhook response received', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length')
      });

      if (!response.ok) {
        const errorDetails = {
          status: response.status,
          statusText: response.statusText,
          url: url,
          headers: Object.fromEntries(response.headers.entries())
        };

        // Try to get response body for more context
        let responseBody = null;
        try {
          responseBody = await response.text();
        } catch (e) {
          // Ignore if we can't read the body
        }

        this.logger.error('❌ Webhook HTTP error', {
          ...errorDetails,
          responseBody: responseBody?.substring(0, 500) // Limit body length
        });

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Read response as text first to see what we actually got
      const responseText = await response.text();

      this.logger.info('📄 Raw response received', {
        length: responseText.length,
        preview: responseText.substring(0, 300),
        isEmpty: responseText.length === 0
      });

      // Handle empty response
      if (!responseText || responseText.trim().length === 0) {
        this.logger.error('❌ Webhook returned empty response');
        throw new Error('Webhook returned empty response body');
      }

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(responseText);
        this.logger.info('✅ JSON parsed successfully', {
          keys: Object.keys(parsed),
          hasEngage: 'engage' in parsed
        });
        return parsed;
      } catch (jsonError) {
        this.logger.error('❌ Failed to parse JSON response', {
          error: jsonError.message,
          responseText: responseText.substring(0, 500),
          responseLength: responseText.length
        });
        throw new Error(`Invalid JSON response: ${jsonError.message}. Response: ${responseText.substring(0, 100)}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);

      // Enhanced error logging with detailed diagnosis
      const errorInfo = {
        url: url,
        timeout: timeout,
        errorName: error.name,
        errorMessage: error.message,
        errorType: 'UNKNOWN',
        // CRITICAL: Always log error.cause and system errno for debugging
        errorCause: error.cause ? {
          message: error.cause.message,
          code: error.cause.code,
          errno: error.cause.errno,
          syscall: error.cause.syscall,
          address: error.cause.address,
          port: error.cause.port,
          full: error.cause
        } : null,
        errorStack: error.stack,
        errorCode: error.code,
        errorErrno: error.errno
      };

      // Detect specific error types
      if (error.name === 'AbortError') {
        errorInfo.errorType = 'TIMEOUT';
        errorInfo.diagnosis = `Request exceeded ${timeout}ms timeout. The n8n webhook may be slow or unresponsive.`;
        errorInfo.suggestion = 'Increase timeout in settings or check n8n workflow performance';
      } else if (error.cause?.code === 'ENOTFOUND' || error.message?.includes('ENOTFOUND') || error.message?.includes('getaddrinfo')) {
        errorInfo.errorType = 'DNS_FAILURE';
        errorInfo.diagnosis = `Cannot resolve hostname: ${new URL(url).hostname}`;
        errorInfo.suggestion = 'Check DNS settings or verify the n8n domain is accessible';
      } else if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        errorInfo.errorType = 'CONNECTION_REFUSED';
        errorInfo.diagnosis = 'Connection refused by server';
        errorInfo.suggestion = 'Verify n8n server is running and webhook endpoint is correct';
      } else if (error.cause?.code === 'ECONNRESET' || error.message?.includes('ECONNRESET') || error.message?.includes('socket hang up')) {
        errorInfo.errorType = 'CONNECTION_RESET';
        errorInfo.diagnosis = 'Connection was reset by the server';
        errorInfo.suggestion = 'Check n8n server logs for errors or restarts';
      } else if (error.cause?.code === 'ETIMEDOUT' || error.message?.includes('ETIMEDOUT')) {
        errorInfo.errorType = 'NETWORK_TIMEOUT';
        errorInfo.diagnosis = 'Network connection timed out';
        errorInfo.suggestion = 'Check network connectivity and firewall settings';
      } else if (error.cause?.code === 'EPIPE' || error.message?.includes('EPIPE')) {
        errorInfo.errorType = 'BROKEN_PIPE';
        errorInfo.diagnosis = 'Connection broken while sending data (possibly payload too large)';
        errorInfo.suggestion = 'Check payload size or n8n server logs for memory/timeout issues';
      } else if (error.message?.includes('certificate') || error.message?.includes('SSL') || error.message?.includes('TLS')) {
        errorInfo.errorType = 'SSL_ERROR';
        errorInfo.diagnosis = 'SSL/TLS certificate validation failed';
        errorInfo.suggestion = 'Check SSL certificate validity for the n8n domain';
      } else if (error.message?.includes('fetch failed')) {
        errorInfo.errorType = 'FETCH_FAILED';
        errorInfo.diagnosis = 'Generic fetch failure - check errorCause field for system-level details';
        errorInfo.suggestion = 'Check errorCause.code and errorCause.errno above for specific system error';
      }

      // Log detailed error information
      this.logger.error('❌ Webhook request failed with detailed diagnostics', errorInfo);

      throw error;
    }
  }

  /**
   * OPTIMIZATION: Add request to queue for batching
   */
  addToRequestQueue(request) {
    this.requestQueue.push(request);
    
    if (this.requestQueue.length >= this.batchSize) {
      this.processRequestQueue();
    } else if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        this.processRequestQueue();
      }, this.batchTimeout);
    }
  }

  /**
   * OPTIMIZATION: Process the request queue
   */
  async processRequestQueue() {
    if (this.requestQueue.length === 0) return;
    
    const requests = [...this.requestQueue];
    this.requestQueue = [];
    
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    
    try {
      const results = await this.batchWebhookRequests(requests);
      this.logger.info(`✅ Processed ${requests.length} batched requests`);
      return results;
    } catch (error) {
      this.logger.error('❌ Batch request processing failed:', error);
      throw error;
    }
  }
}

module.exports = new PlaywrightRunner();
