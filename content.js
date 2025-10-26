/**
 * LinkRight - Job Search CRM Content Script
 * Implements Simplify Copilot-style sidebar functionality
 */

class LinkRightWidget {
  constructor() {
    // OPTIMIZATION: Core state with minimal memory footprint
    this.engagementMode = false;
    this.sidebarOpen = false;
    this.miniIconVisible = false;
    this.extensionActive = false;
    this.activeCommentBox = null;
    this.pendingRequest = null;
    this.currentView = 'main';
    this.miniIconPosition = { top: 200 };
    this.automationRunning = false;

    // OPTIMIZATION: Webhook throttling with efficient guards
    this.webhookInFlight = false;
    this.lastWebhookAt = 0;
    this.webhookCooldownMs = 10000;

    // OPTIMIZATION: DOM caching system
    this._cachedElements = new Map();
    this._observer = null;
    this._cacheTimeout = 5000; // 5s cache

    // OPTIMIZATION: Settings management with lazy loading
    this._settings = null;
    this.saveDebounceTimer = null;
    this.validationErrors = {};
    this.settingsWarnings = {};

    // OPTIMIZATION: Batch DOM updates
    this._pendingUpdates = [];
    this._updateTimer = null;

    this.init();
  }

  // OPTIMIZATION: Lazy getter for settings
  get settings() {
    if (!this._settings) {
      this._settings = this.getDefaultSettings();
    }
    return this._settings;
  }

  set settings(value) {
    this._settings = value;
  }

  /**
   * OPTIMIZATION: Efficient DOM element querying with caching
   */
  querySelector(selector) {
    if (this._cachedElements.has(selector)) {
      const cached = this._cachedElements.get(selector);
      if (document.contains(cached)) {
        return cached;
      }
    }
    
    const element = document.querySelector(selector);
    if (element) {
      this._cachedElements.set(selector, element);
    }
    
    return element;
  }

  /**
   * OPTIMIZATION: Setup DOM observer for efficient DOM watching
   */
  setupDOMObserver() {
    if (this._observer) return;
    
    this._observer = new MutationObserver((mutations) => {
      // OPTIMIZATION: Batch DOM updates
      const updates = [];
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          updates.push(...mutation.addedNodes);
        }
      });
      
      if (updates.length > 0) {
        this.handleDOMUpdates(updates);
      }
    });
    
    this._observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false // OPTIMIZATION: Only watch for new elements
    });
  }

  /**
   * OPTIMIZATION: Handle DOM updates efficiently
   */
  handleDOMUpdates(updates) {
    // OPTIMIZATION: Batch updates to avoid excessive reflows
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
    }
    
    this._updateTimer = setTimeout(() => {
      this._pendingUpdates.push(...updates);
      this.processPendingUpdates();
      this._pendingUpdates = [];
    }, 16); // 60fps
  }

  /**
   * OPTIMIZATION: Process pending DOM updates
   */
  processPendingUpdates() {
    // OPTIMIZATION: Clear cache for invalidated elements
    for (const [selector, element] of this._cachedElements.entries()) {
      if (!document.contains(element)) {
        this._cachedElements.delete(selector);
      }
    }
  }

  /**
   * Initialize the widget
   */
  async init() {
    // Wait for page to be fully loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  /**
   * OPTIMIZATION: Setup the widget UI and listeners with DOM observer
   */
  async setup() {
    console.log('LinkRight: Setting up widget...');

    // OPTIMIZATION: Setup DOM observer first
    this.setupDOMObserver();

    // Wait a bit to ensure LinkedIn is fully loaded
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Load settings first
    await this.loadSettings();

    // Load current engagement state and position
    await this.loadState();

    // Create sidebar (mini icon will be created when sidebar is closed)
    this.createSidebar();

    // Setup event listeners
    this.setupEventListeners();

    // Start monitoring LinkedIn for comment/reply buttons
    if (this.engagementMode) {
      this.startMonitoring();
    }

    console.log('LinkRight Job Search CRM widget initialized successfully');
  }

  /**
   * Load state from storage
   */
  async loadState() {
    return new Promise((resolve) => {
      // Always start fresh on page load
      chrome.storage.local.set({
        engagementMode: false,
        extensionActive: false,
        miniIconVisible: false
      }, () => {
        this.engagementMode = false;
        this.extensionActive = false;
        this.miniIconVisible = false;
        this.miniIconPosition = { top: 200 };
        console.log('LinkRight: State reset on page load');
        resolve();
      });
    });
  }

  /**
   * Save state to storage
   */
  async saveState() {
    return new Promise((resolve) => {
      chrome.storage.local.set({
        engagementMode: this.engagementMode,
        miniIconPosition: this.miniIconPosition,
        extensionActive: this.extensionActive
      }, resolve);
    });
  }

  /**
   * Show mini icon (sticky tab)
   */
  showMiniIcon() {
    if (this.miniIconVisible) return; // Already visible
    
    console.log('LinkRight: Showing mini icon...');
    
    // Remove existing mini icon if it exists
    const existingIcon = document.getElementById('linkright-mini-icon');
    if (existingIcon) {
      existingIcon.remove();
    }
    
    const miniIcon = document.createElement('div');
    miniIcon.id = 'linkright-mini-icon';
    miniIcon.className = 'linkright-mini-icon';
    miniIcon.innerHTML = `
      <div class="linkright-mini-icon-main">
        <div class="linkright-mini-logo">😊</div>
        <button class="linkright-mini-close-btn" title="Close LinkRight">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="linkright-drag-handle-separate">
        <div class="linkright-drag-indicator">
          <div class="linkright-drag-dot"></div>
          <div class="linkright-drag-dot"></div>
          <div class="linkright-drag-dot"></div>
          <div class="linkright-drag-dot"></div>
          <div class="linkright-drag-dot"></div>
          <div class="linkright-drag-dot"></div>
        </div>
      </div>
    `;

    // Add active class ONLY if engagement mode is on
    miniIcon.classList.remove('active');
    if (this.engagementMode) {
      miniIcon.classList.add('active');
    }
    
    // Position the mini icon
    miniIcon.style.top = `${this.miniIconPosition.top}px`;
    
    // Add click handler for X button
    const closeBtn = miniIcon.querySelector('.linkright-mini-close-btn');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('LinkRight: Mini icon X button clicked');
      this.closeStickyTab();
    });
    
    // Add click handler for main icon area
    miniIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('LinkRight: Mini icon clicked');
      this.openSidebarFromMiniIcon();
    });
    
    // Add drag functionality
    this.addDragFunctionality(miniIcon);
    
    document.body.appendChild(miniIcon);
    this.miniIcon = miniIcon;
    this.miniIconVisible = true;
    
    console.log('LinkRight: Mini icon shown successfully');
  }

  /**
   * Hide mini icon
   */
  hideMiniIcon() {
    if (!this.miniIconVisible) return; // Already hidden
    
    console.log('LinkRight: Hiding mini icon...');
    
    const miniIcon = document.getElementById('linkright-mini-icon');
    if (miniIcon) {
      miniIcon.remove();
    }
    
    this.miniIcon = null;
    this.miniIconVisible = false;
    
    console.log('LinkRight: Mini icon hidden successfully');
  }

  /**
   * Close sticky tab completely (X button clicked)
   */
  closeStickyTab() {
    console.log('LinkRight: Closing sticky tab completely');
    this.hideMiniIcon();
    
    // Close sidebar if it's open
    const sidebar = document.getElementById('linkright-sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      sidebar.style.right = '-352px';
    }
    
    // Reset ALL state to pristine
    this.extensionActive = false;
    this.miniIconVisible = false;
    this.sidebarOpen = false;
    this.currentView = 'main';
    
    // Force save clean state and gray out toolbar icon
    chrome.storage.local.set({
      extensionActive: false,
      miniIconVisible: false,
      engagementMode: this.engagementMode,
      miniIconPosition: this.miniIconPosition
    }, () => {
      console.log('LinkRight: All state reset and saved');
      // Send message to background to update icon to gray
      chrome.runtime.sendMessage({
        type: 'UPDATE_ICON_STATE',
        active: false
      }).catch(() => {
        console.log('Background not available yet');
      });
    });
  }

  /**
   * Add drag functionality to mini icon
   */
  addDragFunctionality(element) {
    let isDragging = false;
    let startY = 0;
    let startTop = 0;
    let startX = 0;

    element.addEventListener('mousedown', (e) => {
      // Don't start drag if clicking close button
      if (e.target.closest('.linkright-mini-close-btn')) {
        return;
      }
      
      // Allow dragging from anywhere on the sticky tab or drag handle
      isDragging = true;
      startY = e.clientY;
      startX = e.clientX;
      startTop = parseInt(element.style.top) || 0;
      element.style.cursor = 'grabbing';
      element.classList.add('dragging'); // Keep drag handle expanded
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaY = e.clientY - startY;
      const deltaX = Math.abs(e.clientX - startX);
      
      // Only respond to vertical dragging (if vertical movement > 5px, start dragging)
      if (Math.abs(deltaY) > 5) {
        let newTop = startTop + deltaY;
        
        // Constrain to viewport
        const maxTop = window.innerHeight - element.offsetHeight;
        newTop = Math.max(0, Math.min(newTop, maxTop));
        
        element.style.top = `${newTop}px`;
        this.miniIconPosition.top = newTop;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.style.cursor = 'grab';
        element.classList.remove('dragging'); // Remove dragging class
        this.saveState();
      }
    });
  }

  /**
   * Create the main sidebar
   */
  createSidebar() {
    console.log('LinkRight: Creating sidebar...');
    
    // Remove existing sidebar if it exists
    const existingSidebar = document.getElementById('linkright-sidebar');
    if (existingSidebar) {
      existingSidebar.remove();
    }
    
    const sidebar = document.createElement('div');
    sidebar.id = 'linkright-sidebar';
    sidebar.className = 'linkright-sidebar';
    
    this.updateSidebarContent(sidebar);
    
    document.body.appendChild(sidebar);
    this.sidebar = sidebar;
    
    console.log('LinkRight: Sidebar created successfully');
  }

  /**
   * Update sidebar content based on current view
   */
  updateSidebarContent(sidebar) {
    // Preserve scroll position
    const contentArea = sidebar.querySelector('.linkright-sidebar-content');
    const scrollTop = contentArea ? contentArea.scrollTop : 0;

    const headerContent = this.getHeaderContent();
    const mainContent = this.getMainContent();

    sidebar.innerHTML = `
      <div class="linkright-sidebar-header">
        ${headerContent}
      </div>
      <div class="linkright-sidebar-content">
        ${mainContent}
      </div>
    `;

    // Re-add event listeners after content update
    this.addSidebarEventListeners(sidebar);

    // Restore scroll position
    const newContentArea = sidebar.querySelector('.linkright-sidebar-content');
    if (newContentArea && scrollTop > 0) {
      setTimeout(() => {
        newContentArea.scrollTop = scrollTop;
      }, 0);
    }

    // Render Home controls (Start 1:00 + Pause/Resume) on Home
    if (this.currentView === 'main') {
      this.renderHomeControls();
    }
  }

  /**
   * Render Home controls: Start (1:00) + Pause/Resume with storage-backed timer
   */
  renderHomeControls() {
    try {
      const mount = document.getElementById('lr-controls');
      if (!mount) return;

      mount.innerHTML = `
        <div style="margin-bottom:12px;padding:12px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
          <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
            <button id="lr-home-start" class="linkright-btn linkright-btn-primary" style="padding:10px;background:#10B981;color:white;border:none;border-radius:6px;font-weight:600;" aria-label="Start 10-second timer">▶️ Start (0:10)</button>
            <button id="lr-home-pause" class="linkright-btn" style="padding:10px;background:#F59E0B;color:white;border:none;border-radius:6px;font-weight:600;min-width:80px;" aria-label="Pause automation" data-state="pause" disabled>⏸️ Pause</button>
          </div>
          <div id="lr-home-label" style="margin-top:8px;font-size:12px;color:#6B7280;text-align:center;min-height:18px;"></div>
        </div>
      `;

      const startBtn = mount.querySelector('#lr-home-start');
      const pauseBtn = mount.querySelector('#lr-home-pause');
      const label = mount.querySelector('#lr-home-label');

      let state = null; // { startedAt, pausedAt, durationMs }
      let intervalId = null;

      const save = (s) => {
        try { chrome.storage.local.set({ 'linkright.timerState': s }); } catch (_) {}
      };

      const load = async () => {
        try {
          state = await new Promise(res => chrome.storage.local.get(['linkright.timerState'], r => res(r['linkright.timerState'] || null)));
        } catch (_) { state = null; }
        tick();
      };

      const remainingMs = () => {
        if (!state) return 10000;
        const elapsed = state.pausedAt ? (state.pausedAt - state.startedAt) : (Date.now() - state.startedAt);
        return Math.max(0, (state.durationMs || 10000) - elapsed);
      };

      const fmt = (ms) => {
        const s = Math.ceil(ms / 1000);
        const m = Math.floor(s / 60);
        const r = String(s % 60).padStart(2, '0');
        return { s, label: `${m}:${r}` };
      };

      const setLabel = (ms) => {
        const { s, label: t } = fmt(ms);
        label.textContent = s > 0 ? `Starting (${t})` : '';
        startBtn.textContent = s > 0 ? `Starting (${t})` : 'Start (0:10)';
      };

      const tick = () => {
        const ms = remainingMs();
        setLabel(ms);
        pauseBtn.disabled = !state;
        if (state && state.pausedAt) {
          pauseBtn.textContent = '▶️ Resume';
          pauseBtn.style.background = '#10B981';
          pauseBtn.setAttribute('data-state', 'resume');
        } else {
          pauseBtn.textContent = '⏸️ Pause';
          pauseBtn.style.background = '#F59E0B';
          pauseBtn.setAttribute('data-state', 'pause');
        }

        if (state && !state.pausedAt && ms === 0) {
          // Fire start
          clearInterval(intervalId); intervalId = null;
          state = null; save(null);
          label.textContent = 'Launching…';
          try {
            chrome.runtime.sendMessage({ type: 'LR_START_RUNNER_AFTER_COUNTDOWN' });
          } catch (_) {}
          setTimeout(() => { label.textContent = ''; }, 1500);
          startBtn.textContent = 'Start (0:10)';
          pauseBtn.disabled = false; // Keep enabled so user can pause automation
        }
      };

      const preflight = async () => {
        try {
          const settings = await new Promise(res => chrome.storage.local.get(['linkright.settings'], r => res(r['linkright.settings'] || {})));
          const base = (settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 2500);
          const resp = await fetch(`${base}/health`, { signal: controller.signal }).catch(() => null);
          clearTimeout(t);
          if (!resp || !resp.ok) {
            this.showToastWithAria(`Runner not reachable at ${base}`, 'error');
            return false;
          }
          return true;
        } catch {
          this.showToastWithAria('Runner health check failed', 'error');
          return false;
        }
      };

      const start = async () => {
        if (!(await preflight())) return;
        state = { startedAt: Date.now(), pausedAt: null, durationMs: 10000 };
        save(state);
        if (!intervalId) intervalId = setInterval(tick, 1000);
        tick();
      };

      const pauseOrResume = async () => {
        if (!state) return;
        if (state.pausedAt) {
          // Resume automation
          const pausedDuration = Date.now() - state.pausedAt;
          state.startedAt += pausedDuration;
          state.pausedAt = null;
          // Call resume automation API
          try {
            const settings = await new Promise(res => chrome.storage.local.get(['linkright.settings'], r => res(r['linkright.settings'] || {})));
            const base = (settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
            await fetch(`${base}/api/runner/resume`, {
              method: 'POST',
              headers: {
                'x-runner-token': settings.xRunnerToken || 'dev-secure-token-12345'
              }
            });
          } catch (error) {
            console.warn('Failed to resume automation:', error);
          }
        } else {
          // Pause automation
          state.pausedAt = Date.now();
          // Call pause automation API
          try {
            const settings = await new Promise(res => chrome.storage.local.get(['linkright.settings'], r => res(r['linkright.settings'] || {})));
            const base = (settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
            await fetch(`${base}/api/runner/pause`, {
              method: 'POST',
              headers: {
                'x-runner-token': settings.xRunnerToken || 'dev-secure-token-12345'
              }
            });
          } catch (error) {
            console.warn('Failed to pause automation:', error);
          }
        }
        save(state);
        tick();
      };

      startBtn.onclick = () => start();
      pauseBtn.onclick = () => pauseOrResume();

      if (!intervalId) intervalId = setInterval(tick, 1000);
      load();
    } catch (error) {
      console.error('LinkRight: renderHomeControls failed', error);
    }
  }

  /**
   * Get header content
   */
  getHeaderContent() {
    const showHomeButton = this.currentView !== 'main';
    const isAutomationRunning = this.automationRunning || false;
    return `
      <div class="linkright-header-left">
        <div class="linkright-title" style="font-size:14px;font-weight:700;">LR</div>
      </div>
      <div class="linkright-header-right">
        ${showHomeButton ? `
          <button class="linkright-header-btn" data-action="home" title="Back to Home">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            </svg>
          </button>
        ` : ''}
        <button class="linkright-header-btn" data-action="runner" title="Runner Control (Alt+4)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </button>
        <button class="linkright-header-btn" data-action="help" title="Keyboard Shortcuts (Alt+5)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
          </svg>
        </button>
        <!-- ARCHIVED - Results/Reports tab removed (data now in Google Sheets)
        <button class="linkright-header-btn" data-action="report" title="Session Reports (Alt+3)">
          <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
          </svg>
        </button>
        -->
        <button class="linkright-header-btn" data-action="settings" title="Settings (Alt+2)" ${isAutomationRunning ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.82,11.69,4.82,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
          </svg>
        </button>
        <button class="linkright-header-btn" data-action="close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    `;
  }

  /**
   * Get main content based on current view
   */
  getMainContent() {
    switch (this.currentView) {
      case 'settings':
        return this.getSettingsContent();
      // ARCHIVED - Results/Reports tab removed (data now in Google Sheets)
      // case 'report':
      //   return this.getReportContent();
      case 'runner':
        return this.getRunnerContent();
      default:
        return this.getMainContentDefault();
    }
  }

  /**
   * Get default main content
   */
  getMainContentDefault() {
    return `
      <!-- Tabs component - commented out for future use -->
      <!--
      <div class="linkright-tabs">
        <button class="linkright-tab active" data-tab="engagement">
          <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" class="linkright-tab-icon" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
            <path d="M8.707 19.707 18 10.414 13.586 6l-9.293 9.293a1.003 1.003 0 0 0-.263.464L3 21l5.242-1.03c.176-.044.337-.135.465-.263zM21 7.414a2 2 0 0 0 0-2.828L19.414 3a2 2 0 0 0-2.828 0L15 4.586 19.414 9 21 7.414z"></path>
          </svg>
          Engagement
        </button>
        <button class="linkright-tab" data-tab="jobs">
          <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" class="linkright-tab-icon" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
            <path d="M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zM227.314 387.314l184-184c6.248-6.248 6.248-16.379 0-22.627l-22.627-22.627c-6.248-6.249-16.379-6.249-22.628 0L216 308.118l-70.059-70.059c-6.248-6.248-16.379-6.248-22.628 0l-22.627 22.627c-6.248 6.248-6.248 16.379 0 22.627l104 104c6.249 6.249 16.379 6.249 22.628.001z"></path>
          </svg>
          Keywords Score
        </button>
        <button class="linkright-tab" data-tab="profile">
          <svg class="linkright-tab-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M7.50017 1.66683C6.56734 1.66666 5.65078 1.91115 4.84198 2.37591C4.03318 2.84067 3.36041 3.50944 2.89085 4.31546C2.42128 5.12149 2.17133 6.03657 2.16595 6.96939C2.16057 7.9022 2.39994 8.82011 2.86017 9.6315C3.17124 9.22721 3.57112 8.89989 4.02889 8.67482C4.48666 8.44974 4.99006 8.33296 5.50017 8.3335H9.50017C10.0103 8.33296 10.5137 8.44974 10.9714 8.67482C11.4292 8.89989 11.8291 9.22721 12.1402 9.6315C12.6004 8.82011 12.8398 7.9022 12.8344 6.96939C12.829 6.03657 12.5791 5.12149 12.1095 4.31546C11.6399 3.50944 10.9672 2.84067 10.1584 2.37591C9.34956 1.91115 8.433 1.66666 7.50017 1.66683ZM12.7955 11.0508C13.6869 9.88881 14.169 8.46468 14.1668 7.00016C14.1668 3.31816 11.1822 0.333496 7.50017 0.333496C3.81817 0.333496 0.833504 3.31816 0.833504 7.00016C0.831303 8.46468 1.31344 9.88883 2.20484 11.0508L2.2015 11.0628L2.43817 11.3382C3.06343 12.0692 3.83976 12.6559 4.71366 13.0579C5.58756 13.4599 6.53824 13.6677 7.50017 13.6668C8.85172 13.6693 10.1718 13.2588 11.2835 12.4902C11.7575 12.1627 12.1872 11.7755 12.5622 11.3382L12.7988 11.0628L12.7955 11.0508ZM7.50017 3.00016C6.96974 3.00016 6.46103 3.21088 6.08596 3.58595C5.71088 3.96102 5.50017 4.46973 5.50017 5.00016C5.50017 5.5306 5.71088 6.0393 6.08596 6.41438C6.46103 6.78945 6.96974 7.00016 7.50017 7.00016C8.0306 7.00016 8.53931 6.78945 8.91438 6.41438C9.28946 6.0393 9.50017 5.5306 9.50017 5.00016C9.50017 4.46973 9.28946 3.96102 8.91438 3.58595C8.53931 3.21088 8.0306 3.00016 7.50017 3.00016Z" fill="currentColor"></path>
          </svg>
          Profile
        </button>
      </div>
      -->
      
      <div class="linkright-content-area">
        <div id="lr-controls"></div>
        
        <!-- Mode Indicator -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:${this.settings.optimizeEngagement ? '#DBEAFE' : '#F0FDF4'};border-radius:6px;border:1px solid ${this.settings.optimizeEngagement ? '#BFDBFE' : '#BBF7D0'};">
          <h2 style="margin:0;font-size:16px;font-weight:600;color:#111827;">LinkRight Automation</h2>
          <span style="padding:4px 8px;background:${this.settings.optimizeEngagement ? '#DBEAFE' : '#F0FDF4'};
            color:${this.settings.optimizeEngagement ? '#1E40AF' : '#15803D'};
            border-radius:4px;font-size:10px;font-weight:600;">
            ${this.settings.optimizeEngagement ? 'OPTIMIZED' : 'DEFAULT'}
          </span>
        </div>
        
        <div class="linkright-features">
          <button class="linkright-feature-btn linkright-feature-btn-primary ${this.engagementMode ? 'active' : ''}" data-feature="engagement">
            <div class="linkright-feature-icon" style="color: #0EA5E9;">💬</div>
            <div class="linkright-feature-text">
              <div class="linkright-feature-title">Smart Engagement</div>
              <div class="linkright-feature-desc">AI-powered comments</div>
            </div>
            <svg class="linkright-feature-arrow" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M7.5 15l5-5-5-5" stroke="currentColor" stroke-width="2" fill="none"/>
            </svg>
        </button>
      </div>

      </div>
    `;
  }

  /**
   * Get default settings
   */
  getDefaultSettings() {
    return {
      // Core settings
      engagementMode: false,
      xRunnerToken: 'dev-secure-token-12345',
      webhookUrl: 'https://n8n.linkright.in/webhook/linkedin-reply',
      runnerBaseUrl: 'http://127.0.0.1:3001',
      privacyPolicyUrl: 'https://linkright.in/privacy',
      
      // NEW: Two-mode engagement settings
      optimizeEngagement: false, // Default to aggressive mode
      postAnalysisWebhook: 'https://n8n.linkright.in/webhook/linkedin-parse',

      // Threshold settings
      maxActions: 10,
      // Pure tab navigation always uses AND logic (all thresholds must pass)

      // Timing settings (milliseconds) - Pure Tab Navigation
      waitActionMinMs: 2000,        // Tab: 2-4s (increased for reliability)
      waitActionMaxMs: 4000,
      waitAfterCommentMinMs: 2000,   // Enter: 2-4s (increased for reliability)
      waitAfterCommentMaxMs: 4000,
      waitBetweenCommentsMinMs: 5000,   // Cooldown: 5-10s (unchanged)
      waitBetweenCommentsMaxMs: 10000

      // DEPRECATED: Scroll/jitter settings removed - pure tab navigation only
      // scrollJitterCountMin: 1,
      // scrollJitterCountMax: 3
    };
  }

  /**
   * Load settings from chrome.storage
   */
  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'LOAD_SETTINGS'
      });
      
      if (response && response.success && response.settings) {
        this.settings = { ...this.getDefaultSettings(), ...response.settings };
      } else {
        this.settings = this.getDefaultSettings();
      }
    } catch (error) {
      console.warn('LinkRight: Failed to load settings from background:', error);
      // Fallback to chrome.storage.local
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['linkright.settings'], (result) => {
          resolve(result['linkright.settings'] || null);
        });
      });
      
      if (result) {
        this.settings = { ...this.getDefaultSettings(), ...result };
      } else {
        this.settings = this.getDefaultSettings();
      }
    }
  }

  /**
   * Validate URL
   */
  isValidUrl(url) {
    if (!url || url.trim() === '') return true; // Empty is OK
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Sanitize and validate settings
   */
  sanitizeSettings(settings) {
    const sanitized = { ...settings };
    const warnings = {};

    // Clamp all numeric values to >= 0
    const numericFields = [
      'maxActions',
      'waitActionMinMs', 'waitActionMaxMs',
      'waitAfterCommentMinMs', 'waitAfterCommentMaxMs',
      'waitBetweenCommentsMinMs', 'waitBetweenCommentsMaxMs'
      // DEPRECATED: scrollJitterCountMin, scrollJitterCountMax removed
    ];

    numericFields.forEach(field => {
      if (sanitized[field] !== undefined) {
        sanitized[field] = Math.max(0, parseInt(sanitized[field]) || 0);
      }
    });

    // Auto-swap min/max pairs if min > max
    const minMaxPairs = [
      { min: 'waitActionMinMs', max: 'waitActionMaxMs', label: 'Action Wait' },
      { min: 'waitAfterCommentMinMs', max: 'waitAfterCommentMaxMs', label: 'After Comment Wait' },
      { min: 'waitBetweenCommentsMinMs', max: 'waitBetweenCommentsMaxMs', label: 'Between Comments Wait' }
      // DEPRECATED: scrollJitterCountMin/Max validation removed
    ];

    minMaxPairs.forEach(pair => {
      const minVal = sanitized[pair.min];
      const maxVal = sanitized[pair.max];

      if (minVal > maxVal) {
        // Swap values
        sanitized[pair.min] = maxVal;
        sanitized[pair.max] = minVal;
        warnings[pair.min] = `${pair.label}: Min/Max values were swapped`;
      }
    });

    return { sanitized, warnings };
  }

  /**
   * Validate settings (URL validation only)
   */
  validateSettings(settings) {
    const errors = {};

    if (settings.webhookUrl && !this.isValidUrl(settings.webhookUrl)) {
      errors.webhookUrl = 'Invalid webhook URL. Must start with http:// or https://';
    }

    if (settings.privacyPolicyUrl && !this.isValidUrl(settings.privacyPolicyUrl)) {
      errors.privacyPolicyUrl = 'Invalid privacy policy URL. Must start with http:// or https://';
    }

    if (settings.runnerBaseUrl && !this.isValidUrl(settings.runnerBaseUrl)) {
      errors.runnerBaseUrl = 'Invalid Runner Base URL. Must start with http:// or https://';
    }

    return errors;
  }

  /**
   * Get settings content
   */
  getSettingsContent() {
    const webhookError = this.validationErrors.webhookUrl || '';
    const privacyError = this.validationErrors.privacyPolicyUrl || '';
    const runnerBaseError = this.validationErrors.runnerBaseUrl || '';
    const hasErrors = Object.keys(this.validationErrors).length > 0;

    // Build error summary
    const errorSummary = hasErrors ? Object.values(this.validationErrors).join('; ') : '';

    return `
      <div class="linkright-settings">
        <h3>Settings</h3>

        ${hasErrors ? `
          <div class="linkright-error-summary" role="alert" aria-live="assertive">
            <strong>⚠ Cannot save:</strong> ${errorSummary}
          </div>
        ` : ''}


        <!-- Engagement Mode Toggle Section -->
        <div class="linkright-settings-section">
          <h4 class="linkright-section-title">Engagement Mode</h4>
          
          <div style="margin-top:20px;padding:12px;background:#F0F9FF;border-radius:6px;border:1px solid #BFDBFE;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <label style="font-size:13px;font-weight:600;color:#1E40AF;">
                🎯 Optimize Engagement
              </label>
              <label class="linkright-switch">
                <input type="checkbox" id="setting-optimize-engagement" data-setting="optimizeEngagement" ${this.settings.optimizeEngagement ? 'checked' : ''}>
                <span class="linkright-slider"></span>
              </label>
            </div>
            <p style="font-size:11px;color:#3B82F6;margin:0;line-height:1.4;">
              <strong>OFF (Default):</strong> Comment on every post for maximum reach<br>
              <strong>ON (Optimized):</strong> Only engage with high-value posts based on metrics
            </p>
          </div>
          
          <div style="margin-top:12px;">
            <label style="display:block;margin-bottom:4px;font-size:12px;font-weight:500;color:#374151;">
              Post Analysis Webhook URL
            </label>
            <input type="url" id="setting-post-analysis-webhook" 
              class="linkright-setting-input" 
              placeholder="https://n8n.linkright.in/webhook/linkedin-parse" 
              value="${this.settings.postAnalysisWebhook || ''}" 
              data-setting="postAnalysisWebhook">
            <span style="font-size:10px;color:#6B7280;">Used in Optimized mode only</span>
          </div>
        </div>

        <!-- API Configuration Section -->
        <div class="linkright-settings-section">
          <h4 class="linkright-section-title">API Configuration</h4>
          
          <div class="linkright-setting-group">
            <label class="linkright-setting-label" for="setting-api-token">API Token</label>
            <input
              type="password"
              id="setting-api-token"
              class="linkright-setting-input"
              placeholder="dev-secure-token-12345"
              value="${this.settings.xRunnerToken || ''}"
              data-setting="xRunnerToken"
              aria-label="API Token">
            <span class="linkright-help-text">Runner API authentication</span>
          </div>

          <div class="linkright-setting-group">
            <label class="linkright-setting-label" for="setting-webhook-url">Webhook URL (linkedin-reply)</label>
            <input
              type="url"
              id="setting-webhook-url"
              class="linkright-setting-input"
              placeholder="https://your-webhook.com/endpoint"
              value="${this.settings.webhookUrl || ''}"
              data-setting="webhookUrl"
              aria-label="Webhook URL">
            <span class="linkright-help-text">AI comment endpoint</span>
          </div>

          <div class="linkright-setting-group">
            <label class="linkright-setting-label" for="setting-runner-base">Runner Base URL</label>
            <input
              type="url"
              id="setting-runner-base"
              class="linkright-setting-input"
              placeholder="http://127.0.0.1:3001"
              value="${this.settings.runnerBaseUrl || 'http://127.0.0.1:3001'}"
              data-setting="runnerBaseUrl"
              aria-label="Runner Base URL">
            <span class="linkright-help-text">Local runner URL for health and API calls</span>
          </div>

          <div class="linkright-setting-group">
            <label class="linkright-setting-label" for="setting-privacy-url">Privacy Policy URL</label>
            <input
              type="url"
              id="setting-privacy-url"
              class="linkright-setting-input"
              placeholder="https://your-site.com/privacy"
              value="${this.settings.privacyPolicyUrl || ''}"
              data-setting="privacyPolicyUrl"
              aria-label="Privacy Policy URL">
            <span class="linkright-help-text">Privacy policy link</span>
          </div>
        </div>

        <!-- Max Actions Setting -->
        <div class="linkright-settings-section">
          <h4 class="linkright-section-title">Automation Limits</h4>

          <div class="linkright-setting-group">
            <label class="linkright-setting-label" for="setting-max-actions">Max Actions</label>
            <input
              type="number"
              id="setting-max-actions"
              class="linkright-setting-input"
              min="0"
              value="${this.settings.maxActions || 10}"
              data-setting="maxActions"
              aria-label="Maximum actions">
            <span class="linkright-help-text">Stop after this many actions</span>
          </div>
        </div>

        <!-- Timing Settings Section -->
        <div class="linkright-settings-section">
          <h4 class="linkright-section-title">Timing (ms)</h4>

          <div class="linkright-setting-row">
            <div class="linkright-setting-group">
              <label class="linkright-setting-label" for="setting-wait-action-min">Tab Min</label>
              <input
                type="number"
                id="setting-wait-action-min"
                class="linkright-setting-input"
                min="0"
                value="${this.settings.waitActionMinMs || 2000}"
                data-setting="waitActionMinMs"
                aria-label="Minimum Tab wait">
              ${this.settingsWarnings.waitActionMinMs ? `<span class="linkright-warning-message">${this.settingsWarnings.waitActionMinMs}</span>` : ''}
            </div>

            <div class="linkright-setting-group">
              <label class="linkright-setting-label" for="setting-wait-action-max">Tab Max</label>
              <input
                type="number"
                id="setting-wait-action-max"
                class="linkright-setting-input"
                min="0"
                value="${this.settings.waitActionMaxMs || 4000}"
                data-setting="waitActionMaxMs"
                aria-label="Maximum Tab wait">
            </div>
          </div>
          <span class="linkright-help-text">Wait 2-4s after each Tab press</span>

          <div class="linkright-setting-row">
            <div class="linkright-setting-group">
              <label class="linkright-setting-label" for="setting-wait-after-min">Enter Min</label>
              <input
                type="number"
                id="setting-wait-after-min"
                class="linkright-setting-input"
                min="0"
                value="${this.settings.waitAfterCommentMinMs || 2000}"
                data-setting="waitAfterCommentMinMs"
                aria-label="Minimum Enter wait">
              ${this.settingsWarnings.waitAfterCommentMinMs ? `<span class="linkright-warning-message">${this.settingsWarnings.waitAfterCommentMinMs}</span>` : ''}
            </div>

            <div class="linkright-setting-group">
              <label class="linkright-setting-label" for="setting-wait-after-max">Enter Max</label>
              <input
                type="number"
                id="setting-wait-after-max"
                class="linkright-setting-input"
                min="0"
                value="${this.settings.waitAfterCommentMaxMs || 4000}"
                data-setting="waitAfterCommentMaxMs"
                aria-label="Maximum Enter wait">
            </div>
          </div>
          <span class="linkright-help-text">Wait 2-4s after each Enter press</span>

          <div class="linkright-setting-row">
            <div class="linkright-setting-group">
              <label class="linkright-setting-label" for="setting-wait-between-min">Cooldown Min</label>
              <input
                type="number"
                id="setting-wait-between-min"
                class="linkright-setting-input"
                min="0"
                value="${this.settings.waitBetweenCommentsMinMs || 5000}"
                data-setting="waitBetweenCommentsMinMs"
                aria-label="Minimum cooldown">
              ${this.settingsWarnings.waitBetweenCommentsMinMs ? `<span class="linkright-warning-message">${this.settingsWarnings.waitBetweenCommentsMinMs}</span>` : ''}
            </div>

            <div class="linkright-setting-group">
              <label class="linkright-setting-label" for="setting-wait-between-max">Cooldown Max</label>
              <input
                type="number"
                id="setting-wait-between-max"
                class="linkright-setting-input"
                min="0"
                value="${this.settings.waitBetweenCommentsMaxMs || 10000}"
                data-setting="waitBetweenCommentsMaxMs"
                aria-label="Maximum cooldown">
            </div>
          </div>
          <span class="linkright-help-text">Rest between comments</span>
        </div>

        <div class="linkright-sticky-actions">
          <div class="linkright-setting-actions">
            <button
              class="linkright-btn linkright-btn-primary"
              data-action-type="save"
              ${hasErrors ? 'disabled' : ''}
              aria-label="Save settings">
              Save Settings
            </button>
            <button
              class="linkright-btn linkright-btn-secondary"
              data-action-type="reset"
              aria-label="Reset to default settings">
              Reset to Default
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get report content
   */
  getReportContent() {
    return `
      <div class="linkright-reports-container" style="padding:12px;font-size:13px;">
        <!-- Session Summary -->
        <div id="lr-session-summary" style="margin-bottom:16px;padding:12px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;">
          <h4 style="margin:0 0 8px;font-size:14px;font-weight:600;">📊 Session Summary</h4>
          <div id="lr-summary-content" style="font-size:12px;color:#6B7280;">
            <div style="text-align:center;padding:20px;">
              <div style="color:#9CA3AF;">Loading session data...</div>
            </div>
          </div>
        </div>

        <!-- Filters & Search -->
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <!-- Filter Chips -->
          <div style="display:flex;gap:4px;">
            <button class="lr-filter-chip active" data-filter="all" style="padding:6px 12px;border-radius:16px;border:1px solid #d1d5db;background:#006666;color:white;cursor:pointer;font-size:11px;font-weight:600;">
              All
            </button>
            <button class="lr-filter-chip" data-filter="commented" style="padding:6px 12px;border-radius:16px;border:1px solid #d1d5db;background:white;color:#374151;cursor:pointer;font-size:11px;font-weight:600;">
              Commented
            </button>
            <button class="lr-filter-chip" data-filter="skipped" style="padding:6px 12px;border-radius:16px;border:1px solid #d1d5db;background:white;color:#374151;cursor:pointer;font-size:11px;font-weight:600;">
              Skipped
            </button>
          </div>

          <!-- Search Box -->
          <div style="flex:1;min-width:200px;">
            <input
              type="text"
              id="lr-search-posts"
              placeholder="Search posts..."
              style="width:100%;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;"
              aria-label="Search posts">
          </div>

          <!-- Download CSV Button -->
          <button id="lr-download-csv"
            style="padding:6px 12px;border-radius:6px;border:1px solid #10B981;background:#10B981;color:white;cursor:pointer;font-size:12px;font-weight:600;"
            aria-label="Download CSV report">
            ⬇️ Download CSV
          </button>
        </div>

        <!-- Posts Table -->
        <div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:6px;">
          <table id="lr-posts-table" style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead style="background:#f3f4f6;">
              <tr>
                <th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;font-weight:600;width:50px;">Sr.</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;font-weight:600;">Reactions</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;font-weight:600;">Comments</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #e5e7eb;font-weight:600;">Reposts</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;font-weight:600;">Action</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;font-weight:600;">Timestamp</th>
              </tr>
            </thead>
            <tbody id="lr-posts-tbody">
              <tr>
                <td colspan="6" style="padding:20px;text-align:center;color:#9CA3AF;">
                  No data available
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="margin-top:12px;font-size:11px;color:#9CA3AF;text-align:center;">
          Showing <span id="lr-visible-count">0</span> of <span id="lr-total-count">0</span> posts
        </div>
      </div>
    `;
  }

  /**
   * Add event listeners to sidebar
   */
  addSidebarEventListeners(sidebar) {
    console.log('LinkRight: Adding sidebar event listeners');
    
    // Header buttons
    const headerButtons = sidebar.querySelectorAll('[data-action]');
    console.log('LinkRight: Found', headerButtons.length, 'header buttons');
    
    headerButtons.forEach(btn => {
      const action = btn.dataset.action;
      console.log('LinkRight: Adding event listener for action:', action);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = e.currentTarget.dataset.action;
        console.log('LinkRight: Header button clicked:', action);
        this.handleHeaderAction(action);
      });
    });
    
    // Tab buttons
    sidebar.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.handleTabClick(tab);
      });
    });
    
    // Feature buttons
    sidebar.querySelectorAll('[data-feature]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const feature = e.currentTarget.dataset.feature;
        this.handleFeatureClick(feature);
      });
    });
    
    // Privacy policy link
    const privacyLink = sidebar.querySelector('#linkright-privacy-link');
    if (privacyLink) {
    privacyLink.addEventListener('click', (e) => {
      e.preventDefault();
        const url = window.LINKRIGHT_CONFIG?.PRIVACY_POLICY_URL;
        if (url && url !== '[PRIVACY_POLICY_URL]') {
          window.open(url, '_blank');
        }
      });
    }
    
    // Settings form handling
    if (this.currentView === 'settings') {
      this.attachSettingsHandlers(sidebar);
    }

    // ARCHIVED - Results/Reports tab removed (data now in Google Sheets)
    // Reports page handling
    // if (this.currentView === 'report') {
    //   this.attachReportsHandlers(sidebar);
    // }

    // Runner page handling
    if (this.currentView === 'runner') {
      this.attachRunnerHandlers(sidebar);
      // loadRunnerThresholds() removed - settings now only in Settings tab
    }
  }

  /**
   * Handle header action clicks
   */
  handleHeaderAction(action) {
    console.log('LinkRight: Header action clicked:', action);
    switch (action) {
      case 'close':
        console.log('LinkRight: Close button clicked - closing sidebar');
        this.closeSidebar();
        break;
      case 'home':
        console.log('LinkRight: Home button clicked');
        this.currentView = 'main';
        this.updateSidebarContent(this.sidebar);
        break;
      case 'settings':
        if (this.automationRunning) {
          this.showToastWithAria('Settings disabled during automation', 'warning');
          return;
        }
        console.log('LinkRight: Settings button clicked');
        this.currentView = 'settings';
        this.updateSidebarContent(this.sidebar);
        break;
      // ARCHIVED - Results/Reports tab removed (data now in Google Sheets)
      // case 'report':
      //   console.log('LinkRight: Report button clicked');
      //   this.currentView = 'report';
      //   this.updateSidebarContent(this.sidebar);
      //   break;
      case 'runner':
        console.log('LinkRight: Runner button clicked');
        this.currentView = 'runner';
        this.updateSidebarContent(this.sidebar);
        break;
    }
  }

  /**
   * Open settings and highlight token field
   */
  openSettingsAndHighlightToken() {
    // Open sidebar if not already open
    if (!this.sidebarOpen) {
      this.openSidebar();
    }

    // Switch to settings view
    this.currentView = 'settings';
    this.updateSidebarContent(this.sidebar);

    // Wait for render, then highlight token field
    setTimeout(() => {
      const tokenInput = document.getElementById('setting-token');
      if (tokenInput) {
        tokenInput.style.borderColor = '#EF4444';
        tokenInput.style.backgroundColor = '#FEF2F2';
        tokenInput.focus();

        // Remove highlight after 3 seconds
        setTimeout(() => {
          tokenInput.style.borderColor = '';
          tokenInput.style.backgroundColor = '';
        }, 3000);
      }
    }, 100);
  }

  /**
   * Handle tab clicks
   */
  handleTabClick(tab) {
    // Update active tab
    this.sidebar.querySelectorAll('.linkright-tab').forEach(t => t.classList.remove('active'));
    this.sidebar.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    
    // Handle tab-specific logic
    switch (tab) {
      case 'engagement':
        // Already showing engagement content
        break;
      case 'jobs':
        // Show job search content
        break;
      case 'profile':
        // Show profile content
        break;
    }
  }

  /**
   * Handle feature clicks
   */
  handleFeatureClick(feature) {
    switch (feature) {
      case 'engagement':
        this.toggleEngagementMode();
        this.showToastWithAria(this.engagementMode ? 'Engagement enabled' : 'Engagement disabled', this.engagementMode ? 'success' : 'info');
        break;
      default:
        console.log(`Feature ${feature} clicked (coming soon)`);
    }
  }


  /**
   * Toggle sidebar open/closed
   */
  toggleSidebar() {
    if (this.sidebarOpen) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  }

  /**
   * Open sidebar
   */
  openSidebar() {
    console.log('LinkRight: Opening sidebar');
    
    this.currentView = 'main';
    this.extensionActive = true;
    this.miniIconVisible = false;
    this.sidebarOpen = true;
    
    this.sidebar.classList.add('open');
    this.sidebar.style.right = '0';
    
    this.hideMiniIcon();
    this.saveState();
    
    // Notify background to update icon to active/teal (UI visible)
    chrome.runtime.sendMessage({ type: 'UPDATE_ICON_STATE', active: true }).catch(() => {});
    
    console.log('LinkRight: Sidebar opened successfully');
  }

  /**
   * Open sidebar from mini icon click
   */
  openSidebarFromMiniIcon() {
    console.log('LinkRight: Opening sidebar from mini icon');
    this.currentView = 'main'; // Reset to main view
    this.openSidebar();
  }

  /**
   * Close sidebar
   */
  closeSidebar() {
    console.log('LinkRight: Closing sidebar...');
    
    this.sidebar.classList.remove('open');
    this.sidebarOpen = false;
    this.currentView = 'main'; // Reset to main view
    
    // Ensure sidebar is properly hidden
    this.sidebar.style.right = '-352px'; // Use actual pixel value instead of CSS variable
    this.sidebar.style.top = '0px';
    this.sidebar.style.transform = 'translateY(0)';
    
    console.log('LinkRight: Sidebar closed, showing mini icon...');
    
    // Create mini icon when sidebar is closed and keep toolbar icon colored (still visible)
    this.showMiniIcon();
    this.extensionActive = true; // Extension is still active (sticky tab visible)
    this.saveState();
    chrome.runtime.sendMessage({ type: 'UPDATE_ICON_STATE', active: true }).catch(() => {});
    
    console.log('LinkRight: Sidebar close complete');
  }

  /**
   * Toggle Engagement Mode
   */
  async toggleEngagementMode() {
    this.engagementMode = !this.engagementMode;
    
    // Save state
    await this.saveState();
    
    // Update sticky tab active state if mini icon is visible
    if (this.miniIconVisible) {
      const miniIcon = document.getElementById('linkright-mini-icon');
      if (miniIcon) {
        miniIcon.classList.toggle('active', this.engagementMode);
      }
    }
    
    // Do not update toolbar icon from engagement toggle — icon reflects UI visibility only
    
    // Update UI
    this.updateUIState();
    
    // Start or stop monitoring
    if (this.engagementMode) {
      this.startMonitoring();
    } else {
      this.stopMonitoring();
    }
  }

  /**
   * Update UI to reflect current state
   */
  updateUIState() {
    console.log('LinkRight: Updating UI state, engagement mode:', this.engagementMode);
    
    // Update mini icon active state (for golden border)
    if (this.miniIcon) {
      this.miniIcon.classList.toggle('active', this.engagementMode);
      console.log('LinkRight: Mini icon active state updated:', this.engagementMode);
    }
    
    // Update sidebar content if open
    if (this.sidebarOpen) {
      this.updateSidebarContent(this.sidebar);
      
      // Update engagement status message
      const statusMsg = this.sidebar.querySelector('.linkright-status-message');
      if (statusMsg) {
        statusMsg.textContent = this.engagementMode ? 'Engagement mode is On' : 'Engagement mode is Off';
        statusMsg.classList.toggle('show', this.engagementMode);
        console.log('LinkRight: Status message updated');
      }
      
      // Toggle golden border on Smart Engagement button when active
    const engagementBtn = this.sidebar.querySelector('[data-feature="engagement"]');
    if (engagementBtn) {
        engagementBtn.classList.toggle('active', this.engagementMode);
      }
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Global hotkey: Cmd+Shift+L (mac) / Ctrl+Shift+L (win)
    const hotkeyHandler = (e) => {
      // Only when engagement mode is ON and editor is focused
      if (!this.engagementMode) return;
      const ae = document.activeElement;
      if (!this.isEditorElement(ae)) return;
      
      const isL = (e.key === 'l' || e.key === 'L' || e.code === 'KeyL' || e.keyCode === 76);
      const hasCmdOrCtrl = (e.metaKey || e.ctrlKey);
      const isCombo = hasCmdOrCtrl && isL && e.shiftKey; // require Shift
      if (!isCombo) return;
      
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      this.handleHotkeyGeneratePasteSubmit(ae);
    };
    
    // Use capture to preempt site handlers
    window.addEventListener('keydown', hotkeyHandler, true);

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'ENGAGEMENT_MODE_CHANGED') {
        this.engagementMode = message.enabled;
        this.updateUIState();

        if (message.enabled) {
          this.startMonitoring();
      } else {
          this.stopMonitoring();
        }
      } else if (message.type === 'SHOW_TOAST') {
        // Show toast from background script
        this.showToastWithAria(message.message, message.toastType || 'info');
        sendResponse({ success: true });
      } else if (message.type === 'HIGHLIGHT_TOKEN_FIELD') {
        // Open settings and highlight token field
        this.openSettingsAndHighlightToken();
        sendResponse({ success: true });
      } else if (message.type === 'CLOSE_STICKY_TAB') {
        // Close sticky tab when extension is disabled/unpinned
        console.log('LinkRight: Received request to close sticky tab');
        const miniIcon = document.getElementById('linkright-mini-icon');
        if (miniIcon && !this.sidebarOpen) {
          miniIcon.remove();
          this.miniIconVisible = false;
          this.extensionActive = false;
          this.saveState();
        }
        sendResponse({ success: true });
      } else if (message.type === 'RESET_COUNTDOWN_UI') {
        // Reset countdown UI to initial state (called on NAV_TIMEOUT)
        console.log('LinkRight: Resetting countdown UI');

        // Find countdown elements
        const startBtn = document.getElementById('lr-start-countdown');
        const cancelBtn = document.getElementById('lr-cancel-countdown');
        const scanOnlyCheckbox = document.getElementById('lr-scan-only');
        const label = document.getElementById('lr-countdown-label');

        if (startBtn) {
          startBtn.textContent = 'Start (3:00)';
          startBtn.disabled = false;
        }
        if (scanOnlyCheckbox) {
          scanOnlyCheckbox.disabled = false;
        }
        if (cancelBtn) {
          cancelBtn.style.display = 'none';
        }
        if (label) {
          label.textContent = '';
        }

        sendResponse({ success: true });
      } else if (message.type === 'OPEN_SIDEBAR_FROM_EXTENSION') {
        console.log('LinkRight: Extension icon clicked');
        
        // CRITICAL: Always proceed if nothing is open OR if only sticky tab is open
        const sidebarElement = document.getElementById('linkright-sidebar');
        const miniIconElement = document.getElementById('linkright-mini-icon');
        
        // If neither element exists, recreate them
        if (!sidebarElement && !miniIconElement) {
          console.log('LinkRight: DOM elements missing, creating new ones');
          this.setup(); // Reinitialize from scratch
          this.openSidebar();
          chrome.runtime.sendMessage({ type: 'UPDATE_ICON_STATE', active: true }).catch(() => {});
        }
        // If only sticky tab is visible, open sidebar
        else if (miniIconElement && !sidebarElement) {
          console.log('LinkRight: Only sticky tab visible, opening sidebar');
          this.currentView = 'main';
          this.openSidebar();
          chrome.runtime.sendMessage({ type: 'UPDATE_ICON_STATE', active: true }).catch(() => {});
        }
        // If sidebar exists and is open, do nothing
        else if (sidebarElement && sidebarElement.classList.contains('open')) {
          console.log('LinkRight: Sidebar already open');
        }
        // Otherwise open sidebar
        else {
          console.log('LinkRight: Opening sidebar from extension click');
          this.currentView = 'main';
          this.openSidebar();
          chrome.runtime.sendMessage({ type: 'UPDATE_ICON_STATE', active: true }).catch(() => {});
        }
      } else if (message.type === 'TOGGLE_RUNNER') {
        // Alt+R - Toggle Runner Start/Stop
        if (!this.sidebarOpen) {
          this.openSidebar();
        }
        this.currentView = 'runner';
        this.updateSidebarContent(this.sidebar);

        // Check if runner is running and toggle
        const startBtn = document.querySelector('#lr-start-runner');
        const stopBtn = document.querySelector('#lr-stop-runner');
        if (stopBtn && !stopBtn.disabled) {
          this.stopRunner();
        } else if (startBtn && !startBtn.disabled) {
          this.startRunner();
        }
        sendResponse({ success: true });
      } else if (message.type === 'TOGGLE_AUTOMATION') {
        // Alt+A - Toggle Start Automation button
        const startAutomationBtn = document.querySelector('#lr-start-countdown');
        if (startAutomationBtn && !startAutomationBtn.disabled) {
          startAutomationBtn.click();
        }
        sendResponse({ success: true });
      } else if (message.type === 'OPEN_SETTINGS') {
        // Alt+S - Open Settings
        if (!this.sidebarOpen) {
          this.openSidebar();
        }
        this.currentView = 'settings';
        this.updateSidebarContent(this.sidebar);
        sendResponse({ success: true });
      }
    });
  }

  /**
   * Normalize text for comparison
   */
  normalizeTextForCompare(str) {
    return (str || '')
      .replace(/\r\n|\r/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/[\t ]+/g, ' ')
      .trim();
  }

  /**
   * Paste via clipboard if possible, fallback to programmatic insert, then verify
   */
  async pasteViaClipboardAndVerify(editor, text) {
    const expected = this.normalizeTextForCompare(text);

    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}

    // Focus editor
    if (editor && editor.focus) editor.focus();
    await new Promise(r => setTimeout(r, 50));

    // Attempt native paste
    try {
      const pasteOk = document.execCommand && document.execCommand('paste');
      await new Promise(r => setTimeout(r, 100));
    } catch (_) {}

    // Read current text
    const current1 = this.normalizeTextForCompare(editor ? (editor.innerText || editor.textContent || '') : '');
    if (current1 === expected) return true;

    // Fallback: programmatic insert
    if (editor) {
      // Clear existing content
      editor.innerHTML = '';
      const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
      lines.forEach((line, index) => {
        const textNode = document.createTextNode(line);
        editor.appendChild(textNode);
        if (index < lines.length - 1) editor.appendChild(document.createElement('br'));
      });
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await new Promise(r => setTimeout(r, 50));
    const current2 = this.normalizeTextForCompare(editor ? (editor.innerText || editor.textContent || '') : '');
    return current2 === expected;
  }

  /**
   * Cmd+Shift+L flow: generate → paste immediately → verify → Tab×3 → Enter
   */
  async handleHotkeyGeneratePasteSubmit(ae) {
    try {
      // Find the active editor again in case focus changed
      const editor = this.findActiveEditor();
      if (!editor) {
        this.showToastWithAria('Open a comment editor, then press Cmd+Shift+L', 'warning');
        return;
      }

      // Extract post data from nearest post
      const postData = this.extractPostData(editor);
      if (!postData) {
        this.showToastWithAria('Could not find post context', 'error');
        return;
      }

      // Show loader
      this.showLoader(editor);

      // Generate via webhook
      let aiComment;
      try {
        const response = await this.sendToWebhook(postData);
        aiComment = response && response.comment ? response.comment : '';
      } finally {
        this.hideLoader(editor);
      }

      if (!aiComment) {
        this.showToastWithAria('Failed to generate comment', 'error');
        return;
      }

      // Paste immediately (no delay) in Chrome extension
      const pasted = await this.pasteViaClipboardAndVerify(editor, aiComment);
      if (!pasted) {
        this.showToastWithAria('Paste failed. Please paste manually and retry.', 'error');
        return;
      }

      // Tab ×3 then Enter to submit (best-effort)
      try {
        const dispatchKey = (key) => {
          const ev = new KeyboardEvent('keydown', { key, bubbles: true });
          document.activeElement && document.activeElement.dispatchEvent(ev);
        };
        dispatchKey('Tab');
        await new Promise(r => setTimeout(r, 150));
        dispatchKey('Tab');
        await new Promise(r => setTimeout(r, 150));
        dispatchKey('Tab');
        await new Promise(r => setTimeout(r, 150));
        dispatchKey('Enter');
      } catch (_) {
        // Fallback: try clicking a Post/Submit button
        try {
          const btn = editor.closest('form')?.querySelector('button[aria-label*="post" i],button[type="submit"],button[data-control-name*="comment"]');
          if (btn) btn.click();
        } catch (_) {}
      }

    } catch (error) {
      console.error('Cmd+Shift+L flow failed', error);
      this.showToastWithAria('Comment flow failed. Try again.', 'error');
    }
  }

  /**
   * Start monitoring LinkedIn for comment/reply interactions
   */
  startMonitoring() {
    console.log('Starting LinkedIn monitoring...');
    
    // Use MutationObserver to detect when comment boxes appear
    this.observer = new MutationObserver((mutations) => {
      this.checkForCommentBoxes();
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Initial check
    this.checkForCommentBoxes();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    console.log('Stopping LinkedIn monitoring...');
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Remove all listeners from comment boxes
    this.removeAllCommentListeners();
  }

  /**
   * Check for comment/reply boxes and attach listeners
   */
  checkForCommentBoxes() {
    // We no longer auto-trigger on button click; only prepare elements if needed
    const commentButtons = document.querySelectorAll(`
      button[aria-label*="comment" i]:not([data-linkright-processed]),
      button[aria-label*="reply" i]:not([data-linkright-processed])
    `);
    
    commentButtons.forEach(button => {
      button.setAttribute('data-linkright-processed', 'true');
      // Do NOT attach click handler; webhook only via hotkey
    });
  }

  /**
   * Remove all comment listeners (when disabling mode)
   */
  removeAllCommentListeners() {
    const processedElements = document.querySelectorAll('[data-linkright-processed]');
    processedElements.forEach(el => {
      el.removeAttribute('data-linkright-processed');
    });
  }

  /**
   * Handle when user clicks comment/reply button
   */
  async handleCommentClick(clickedElement) {
    if (!this.engagementMode) return;
    
    // Cooldown / in-flight guards
    if (this.webhookInFlight) {
      console.log('LinkRight: Skip webhook - request already in flight');
      return;
    }
    if (Date.now() - this.lastWebhookAt < this.webhookCooldownMs) {
      console.log('LinkRight: Skip webhook - cooldown active');
      return;
    }
    this.webhookInFlight = true;
    
    console.log('Comment/reply clicked');
    
    // Find the active comment/reply editor that just appeared
    const editor = this.findActiveEditor();
    if (!editor) {
      console.log('Could not find active editor');
      this.webhookInFlight = false;
      return;
    }
    
    this.activeCommentBox = editor;
    
    // Find the post or comment being replied to
    const postData = this.extractPostData(editor);
    if (!postData) {
      console.log('Could not extract post data');
      this.webhookInFlight = false;
      return;
    }
    
    // Show loader
    this.showLoader(editor);
    
    // Send to webhook
    try {
      const response = await this.sendToWebhook(postData);
      
      if (response && response.comment) {
        // Auto-paste the comment
        await this.pasteComment(editor, response.comment);
      } else {
        throw new Error('Invalid response from webhook');
      }
    } catch (error) {
      console.error('Error generating comment:', error);
      this.showError(editor, 'Failed to generate comment. Try again.');
    } finally {
      this.hideLoader(editor);
      this.lastWebhookAt = Date.now();
      this.webhookInFlight = false;
    }
  }

  /**
   * Find the currently active comment/reply editor
   */
  findActiveEditor() {
    // Try different selectors for LinkedIn's comment editors
    const selectors = [
      '.comments-comment-box__form .ql-editor',
      '.comments-comment-texteditor .ql-editor',
      '.comments-comment-box-comment__text-editor .ql-editor',
      '[contenteditable="true"][role="textbox"]',
      '.ql-editor[contenteditable="true"]'
    ];
    
    for (const selector of selectors) {
      const editors = document.querySelectorAll(selector);
      // Get the last one (most recently opened)
      if (editors.length > 0) {
        return editors[editors.length - 1];
      }
    }
    
    return null;
  }

  /**
   * Extract post data from the DOM
   */
  extractPostData(editorElement) {
    // Find the parent post or comment container
    const postContainer = editorElement.closest('.feed-shared-update-v2') || 
                         editorElement.closest('.comments-comment-item') ||
                         editorElement.closest('[data-id]');
    
    if (!postContainer) {
      console.log('Could not find post container');
      return null;
    }
    
    // Determine if this is a comment or reply
    const isReply = editorElement.closest('.comments-comment-item') !== null;
    const actionType = isReply ? 'reply' : 'comment';
    
    // Extract post text - handle truncation
    let postText = '';
    
    // Try to find and click "see more" button to expand truncated content
    const seeMoreButton = postContainer.querySelector(
      '.feed-shared-inline-show-more-text__see-more-less-toggle, ' +
      '.feed-shared-text__see-more, ' +
      '.comments-comment-item__see-more-less-toggle'
    );
    
    if (seeMoreButton && !seeMoreButton.getAttribute('data-linkright-expanded')) {
      seeMoreButton.click();
      seeMoreButton.setAttribute('data-linkright-expanded', 'true');
    }
    
    // Now extract the full text
    const textContainers = postContainer.querySelectorAll(
      '.feed-shared-update-v2__description, ' +
      '.feed-shared-text, ' +
      '.comments-comment-item__main-content, ' +
      '.break-words span[dir="ltr"]'
    );
    
    textContainers.forEach(container => {
      const text = container.innerText || container.textContent;
      if (text && text.trim() && text.length > postText.length) {
        postText = text.trim();
      }
    });
    
    // Fallback: get all text from container if still empty
    if (!postText) {
      postText = postContainer.innerText || postContainer.textContent;
      postText = postText.trim();
    }
    
    console.log('Extracted post text:', postText.substring(0, 100) + '...');
    
    return {
      post_text: postText,
      action_type: actionType
    };
  }

  /**
   * Send post data to webhook
   */
  async sendToWebhook(data) {
    const webhookUrl = window.LINKRIGHT_CONFIG.WEBHOOK_URL;
    
    if (webhookUrl === '[WEBHOOK_URL]') {
      throw new Error('Webhook URL not configured. Please set WEBHOOK_URL in config.js');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), window.LINKRIGHT_CONFIG.WEBHOOK_TIMEOUT);
    
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Auto-copy to clipboard and paste comment into editor
   * Uses Cmd+Shift+L (already copied to clipboard)
   * If paste fails, focuses field and triggers Cmd+V once as fallback
   */
  async pasteComment(editor, comment) {
    // Format the comment - handle line breaks
    const formattedComment = comment
      .replace(/\\n/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\r/g, '\n');

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(formattedComment);
      console.log('Comment copied to clipboard');
    } catch (error) {
      console.warn('Could not copy to clipboard:', error);
    }

    // Store initial content length to detect paste success
    const initialContent = editor.textContent || '';
    const initialLength = initialContent.trim().length;

    // Paste into editor
    if (editor.hasAttribute('contenteditable')) {
      // Clear existing content
      editor.innerHTML = '';

      // Insert formatted text with line breaks
      const lines = formattedComment.split('\n');
      lines.forEach((line, index) => {
        const textNode = document.createTextNode(line);
        editor.appendChild(textNode);

        if (index < lines.length - 1) {
          editor.appendChild(document.createElement('br'));
        }
      });

      // Trigger input event to notify LinkedIn's editor
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));

      // Focus the editor
      editor.focus();

      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // Wait a moment to check if paste succeeded
      await new Promise(resolve => setTimeout(resolve, 100));

      const afterContent = editor.textContent || '';
      const afterLength = afterContent.trim().length;

      // If paste failed (content didn't change), trigger Cmd+V fallback
      if (afterLength <= initialLength) {
        console.log('LinkRight: Paste may have failed, triggering Cmd+V fallback');

        // Focus the editor again
        editor.focus();

        // Simulate Cmd+V (Meta key on Mac, Ctrl on Windows)
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const pasteEvent = new KeyboardEvent('keydown', {
          key: 'v',
          code: 'KeyV',
          keyCode: 86,
          which: 86,
          metaKey: isMac,
          ctrlKey: !isMac,
          bubbles: true,
          cancelable: true
        });

        editor.dispatchEvent(pasteEvent);

        // Also try execCommand as additional fallback
        try {
          document.execCommand('paste');
        } catch (e) {
          console.log('LinkRight: execCommand paste not available');
        }
      } else {
        console.log('Comment pasted successfully');
      }
    }
  }

  /**
   * Show loader animation in comment box (wave dots)
   */
  showLoader(editor) {
    const loader = document.createElement('div');
    loader.className = 'linkright-loader';
    loader.style.cssText = `
      display: inline-flex;
      gap: 4px;
      align-items: center;
      margin: 8px;
      padding: 4px;
    `;

    // Create 3 dots
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.style.cssText = `
        width: 8px;
        height: 8px;
        background-color: #006666;
        border-radius: 50%;
        animation: linkright-wave 1.4s ease-in-out ${i * 0.2}s infinite;
      `;
      loader.appendChild(dot);
    }

    // Add animation if not already added
    if (!document.getElementById('linkright-loader-styles')) {
      const style = document.createElement('style');
      style.id = 'linkright-loader-styles';
      style.textContent = `
        @keyframes linkright-wave {
          0%, 60%, 100% {
            transform: translateY(0);
            opacity: 0.6;
          }
          30% {
            transform: translateY(-10px);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }

    loader.setAttribute('data-linkright-loader', 'true');
    editor.parentElement.insertBefore(loader, editor);
  }

  /**
   * Hide loader animation
   */
  hideLoader(editor) {
    const loader = editor.parentElement.querySelector('[data-linkright-loader]');
    if (loader) {
      loader.remove();
    }
  }

  /**
   * Show error message
   */
  showError(editor, message) {
    const error = document.createElement('div');
    error.className = 'linkright-error';
    error.textContent = message;
    error.style.cssText = `
      color: var(--destructive);
      font-size: 12px;
      padding: 8px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--destructive);
      border-radius: 6px;
      margin: 8px 0;
    `;
    
    error.setAttribute('data-linkright-error', 'true');
    editor.parentElement.insertBefore(error, editor);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      error.remove();
    }, 5000);
  }

  /**
   * Show a toast message with enhanced formatting
   * Supports both string messages and object with {title, details, duration}
   */
  showToast(message, type = 'info') {
    let toastContainer = document.getElementById('linkright-toast-container');
    if (!toastContainer) {
      const container = document.createElement('div');
      container.id = 'linkright-toast-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000001;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
      toastContainer = container;
    }

    const toast = document.createElement('div');
    toast.className = `linkright-toast ${type}`;
    toast.setAttribute('role', 'status');

    // Color mapping
    const colorMap = {
      success: '#10B981',
      error: '#EF4444',
      info: '#3B82F6',
      warning: '#F59E0B'
    };

    toast.style.cssText = `
      padding: 12px 16px;
      border-radius: 8px;
      color: white;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      background-color: ${colorMap[type] || colorMap.info};
      max-width: 360px;
      opacity: 1;
      transition: opacity 0.3s ease;
      word-wrap: break-word;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      font-weight: 500;
      pointer-events: auto;
      line-height: 1.4;
    `;

    // Handle both string and object messages
    let duration = 3000; // default
    if (typeof message === 'object' && message.title) {
      // Enhanced format with title and details
      const title = document.createElement('div');
      title.style.cssText = 'font-weight: 700; margin-bottom: 4px; font-size: 14px;';
      title.textContent = message.title;
      toast.appendChild(title);

      if (message.details) {
        const details = document.createElement('div');
        details.style.cssText = 'font-size: 12px; opacity: 0.95; line-height: 1.5;';
        details.textContent = message.details;
        toast.appendChild(details);
      }

      if (message.duration) {
        duration = message.duration;
      }
    } else {
      // Simple text message
      toast.textContent = message;
    }

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Show toast with ARIA live region announcement
   */
  showToastWithAria(message, type = 'info') {
    // Show visual toast
    this.showToast(message, type);

    // Announce to screen readers
    this.announceToScreenReader(message);
  }

  /**
   * Announce message to screen readers via aria-live
   */
  announceToScreenReader(message) {
    let liveRegion = document.getElementById('linkright-aria-live');

    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'linkright-aria-live';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.style.cssText = `
        position: absolute;
        left: -10000px;
        width: 1px;
        height: 1px;
        overflow: hidden;
      `;
      document.body.appendChild(liveRegion);
    }

    // Clear and set message
    liveRegion.textContent = '';
    setTimeout(() => {
      liveRegion.textContent = message;
    }, 100);

    // Clear after announcement
    setTimeout(() => {
      liveRegion.textContent = '';
    }, 5000);
  }

  /**
   * Attach settings event handlers
   */
  attachSettingsHandlers(sidebar) {
    // Get all setting inputs
    const settingInputs = sidebar.querySelectorAll('[data-setting]');

    // Add input listeners with debounced validation
    settingInputs.forEach(input => {
      input.addEventListener('input', () => {
        this.debouncedValidateSettings();
      });

      input.addEventListener('change', () => {
        this.debouncedValidateSettings();
      });
    });

    // Save button
    const saveBtn = sidebar.querySelector('[data-action-type="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleSaveSettings(sidebar);
      });
    }

    // Reset button
    const resetBtn = sidebar.querySelector('[data-action-type="reset"]');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleResetSettings();
      });
    }
  }

  /**
   * Debounced validation (300ms)
   */
  debouncedValidateSettings() {
    clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.validateAndUpdateUI();
    }, 300);
  }

  /**
   * Validate settings and update UI
   */
  validateAndUpdateUI() {
    // Only validate if we're still on settings view
    if (this.currentView !== 'settings') {
      return;
    }

    // Get current form values
    const formSettings = this.getFormSettings();

    // Sanitize and get warnings
    const { sanitized, warnings } = this.sanitizeSettings(formSettings);

    // Validate URLs
    this.validationErrors = this.validateSettings(sanitized);
    this.settingsWarnings = warnings;

    // Update settings with sanitized values (in memory only, not saved)
    this.settings = sanitized;

    // Re-render settings view to show/hide errors and warnings
    this.updateSidebarContent(this.sidebar);
  }

  /**
   * Get current form settings
   */
  getFormSettings() {
    const sidebar = this.sidebar;
    if (!sidebar) return this.settings;

    const formSettings = { ...this.settings };

    // Get all inputs
    const inputs = sidebar.querySelectorAll('[data-setting]');
    inputs.forEach(input => {
      const key = input.getAttribute('data-setting');
      if (input.type === 'checkbox') {
        formSettings[key] = input.checked;
      } else if (input.type === 'number') {
        formSettings[key] = parseInt(input.value) || 0;
      } else {
        formSettings[key] = input.value.trim();
      }
    });

    return formSettings;
  }

  /**
   * Handle Save Settings
   */
  async handleSaveSettings(sidebar) {
    const formSettings = this.getFormSettings();

    // Sanitize settings (clamp numbers, swap min/max)
    const { sanitized, warnings } = this.sanitizeSettings(formSettings);

    // Final URL validation
    const errors = this.validateSettings(sanitized);
    if (Object.keys(errors).length > 0) {
      this.showToastWithAria('Cannot save: Please fix validation errors', 'error');
      return;
    }

    try {
      // Save to chrome.storage and sync to backend
      await chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        settings: sanitized
      });

      // Update instance settings
      this.settings = sanitized;
      this.settingsWarnings = {}; // Clear warnings after save

      // Update LINKRIGHT_CONFIG for backward compatibility
      if (window.LINKRIGHT_CONFIG) {
        window.LINKRIGHT_CONFIG.WEBHOOK_URL = sanitized.webhookUrl;
        window.LINKRIGHT_CONFIG.PRIVACY_POLICY_URL = sanitized.privacyPolicyUrl;
      }

      // Update engagement mode if changed
      if (sanitized.engagementMode !== this.engagementMode) {
        this.engagementMode = sanitized.engagementMode;
        await this.saveState();
        this.updateUIState();
      }

      // Show success message with warnings if any
      this.showToastWithAria({
        title: '✅ Settings Saved',
        details: Object.keys(warnings).length > 0
          ? 'Configuration saved with auto-corrections applied.'
          : 'All settings saved successfully.',
        duration: 3000
      }, 'success');
      console.log('LinkRight: Settings saved', sanitized);

    } catch (error) {
      console.error('Error saving settings:', error);
      this.showToastWithAria({
        title: '❌ Save Failed',
        details: 'Could not save settings. Check console for details.',
        duration: 3500
      }, 'error');
    }
  }

  /**
   * Handle Reset Settings
   */
  async handleResetSettings() {
    // Confirmation dialog
    const confirmed = confirm('Restore all settings to defaults? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    try {
      // Get default settings
      const defaults = this.getDefaultSettings();

      // Save to chrome.storage
      await new Promise((resolve) => {
        chrome.storage.local.set({
          'linkright.settings': defaults
        }, resolve);
      });

      // Update instance settings
      this.settings = defaults;
      this.validationErrors = {};

      // Update LINKRIGHT_CONFIG
      if (window.LINKRIGHT_CONFIG) {
        window.LINKRIGHT_CONFIG.WEBHOOK_URL = defaults.webhookUrl;
        window.LINKRIGHT_CONFIG.PRIVACY_POLICY_URL = defaults.privacyPolicyUrl;
      }

      // Preserve current scroll and focus when re-rendering
      const contentEl = this.sidebar.querySelector('.linkright-sidebar-content');
      const prevScrollTop = contentEl ? contentEl.scrollTop : 0;
      const activeId = document.activeElement && document.activeElement.id;

      // Re-render settings view
      this.updateSidebarContent(this.sidebar);

      // Restore scroll and focus
      const newContentEl = this.sidebar.querySelector('.linkright-sidebar-content');
      if (newContentEl) newContentEl.scrollTop = prevScrollTop;
      if (activeId) {
        const toFocus = document.getElementById(activeId);
        if (toFocus) toFocus.focus();
      }

      this.showToastWithAria({
        title: '✅ Settings Reset',
        details: 'All settings restored to factory defaults.',
        duration: 3000
      }, 'success');
      console.log('LinkRight: Settings reset to defaults', defaults);

    } catch (error) {
      console.error('Error resetting settings:', error);
      this.showToastWithAria({
        title: '❌ Reset Failed',
        details: 'Could not reset settings. Try reloading the page.',
        duration: 3500
      }, 'error');
    }
  }

  /**
   * Attach Reports page handlers
   */
  attachReportsHandlers(sidebar) {
    // Fetch and display session data
    this.fetchSessionData();

    // Filter chips
    const filterChips = sidebar.querySelectorAll('.lr-filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', (e) => {
        // Update active state
        filterChips.forEach(c => {
          c.classList.remove('active');
          c.style.background = 'white';
          c.style.color = '#374151';
        });
        e.target.classList.add('active');
        e.target.style.background = '#006666';
        e.target.style.color = 'white';

        // Apply filter
        this.currentFilter = e.target.dataset.filter;
        this.filterReportsTable();
      });
    });

    // Search box
    const searchBox = sidebar.querySelector('#lr-search-posts');
    if (searchBox) {
      searchBox.addEventListener('input', (e) => {
        this.currentSearchQuery = e.target.value.toLowerCase();
        this.filterReportsTable();
      });
    }

    // Download CSV
    const downloadBtn = sidebar.querySelector('#lr-download-csv');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        this.downloadReportsCSV();
      });
    }
  }

  /**
   * Attach event handlers for Runner tab
   */
  attachRunnerHandlers(sidebar) {
    // Start Runner button
    const startBtn = sidebar.querySelector('#lr-start-runner');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.startRunner());
    }

    // Pause/Resume Runner button
    const pauseBtn = sidebar.querySelector('#lr-pause-runner');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePauseRunner());
    }

    // Stop Runner button
    const stopBtn = sidebar.querySelector('#lr-stop-runner');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.stopRunner());
    }

    // Open LinkedIn button
    const openLinkedInBtn = sidebar.querySelector('#lr-open-linkedin');
    if (openLinkedInBtn) {
      openLinkedInBtn.addEventListener('click', () => this.openLinkedInTab());
    }

    // Start polling runner status
    this.startRunnerStatusPolling();
  }

  /**
   * Fetch session data from runner API
   */
  async fetchSessionData() {
    try {
      const base = (this.settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
      const response = await fetch(`${base}/api/runner/status?last=1`, {
        headers: {
          'x-runner-token': this.settings.xRunnerToken || 'dev-secure-token-12345'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      console.log('LinkRight: Session data fetched', data);

      // Store session data
      this.sessionData = data;
      this.allPosts = this.parseSessionPosts(data);
      this.currentFilter = 'all';
      this.currentSearchQuery = '';

      // Render session summary
      this.renderSessionSummary(data);

      // Render posts table
      this.filterReportsTable();

    } catch (error) {
      console.error('LinkRight: Failed to fetch session data', error);
      const summaryContent = document.getElementById('lr-summary-content');
      if (summaryContent) {
        summaryContent.innerHTML = `
          <div style="text-align:center;padding:20px;color:#EF4444;">
            <div style="font-weight:600;">Failed to load session data</div>
            <div style="font-size:11px;margin-top:4px;">${error.message}</div>
          </div>
        `;
      }
    }
  }

  /**
   * Parse session data into posts array
   */
  parseSessionPosts(data) {
    // If API returns posts array directly
    if (data.posts && Array.isArray(data.posts)) {
      return data.posts.map(post => {
        const postId = post.postId || post.id || 'N/A';
        // Use toLinkedInUrl() to generate proper permalink
        const postUrl = post.postUrl || post.url || this.toLinkedInUrl(postId) || `https://www.linkedin.com/feed/`;

        return {
          postId,
          postUrl,
          reactions: post.reactions || 0,
          comments: post.comments || 0,
          reposts: post.reposts || 0,
          action: post.action || (post.commented ? 'Commented' : 'Skipped'),
          timestamp: post.timestamp || post.itemTimestamp || new Date().toISOString()
        };
      });
    }

    // Fallback: generate mock data from stats
    const posts = [];
    const stats = data.stats || data.sessionStats || {};
    const commentsPosted = stats.commentsPosted || 0;

    for (let i = 0; i < commentsPosted; i++) {
      const mockPostId = `urn:li:activity:${Date.now()}${i}`;
      posts.push({
        postId: mockPostId,
        postUrl: this.toLinkedInUrl(mockPostId),
        reactions: Math.floor(Math.random() * 500) + 50,
        comments: Math.floor(Math.random() * 50) + 10,
        reposts: Math.floor(Math.random() * 10) + 1,
        action: 'Commented',
        timestamp: new Date(Date.now() - i * 60000).toISOString()
      });
    }

    return posts;
  }

  /**
   * Render session summary
   */
  renderSessionSummary(data) {
    const summaryContent = document.getElementById('lr-summary-content');
    if (!summaryContent) return;

    const stats = data.stats || data.sessionStats || {};
    const startTime = stats.startTime || data.startedAt || 'N/A';
    const endTime = stats.endTime || data.endedAt || 'Running';
    const commentsPosted = stats.commentsPosted || 0;

    summaryContent.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:#9CA3AF;margin-bottom:4px;">Comments Posted</div>
          <div style="font-size:20px;font-weight:700;color:#374151;">${commentsPosted}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:#9CA3AF;margin-bottom:4px;">Session Start</div>
          <div style="font-size:12px;font-weight:600;color:#374151;">${this.formatTimestamp(startTime)}</div>
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;color:#9CA3AF;margin-bottom:4px;">Session End</div>
          <div style="font-size:12px;font-weight:600;color:#374151;">${this.formatTimestamp(endTime)}</div>
        </div>
      </div>
    `;
  }

  /**
   * Filter and render reports table
   */
  filterReportsTable() {
    let filteredPosts = [...(this.allPosts || [])];

    // Apply filter
    if (this.currentFilter === 'commented') {
      filteredPosts = filteredPosts.filter(p => p.action === 'Commented');
    } else if (this.currentFilter === 'skipped') {
      filteredPosts = filteredPosts.filter(p => p.action === 'Skipped');
    }

    // Apply search
    if (this.currentSearchQuery) {
      filteredPosts = filteredPosts.filter(p =>
        p.postId.toLowerCase().includes(this.currentSearchQuery)
      );
    }

    // Store filtered posts for CSV export
    this.filteredPosts = filteredPosts;

    // Render table
    this.renderPostsTable(filteredPosts);

    // Update counts
    const visibleCount = document.getElementById('lr-visible-count');
    const totalCount = document.getElementById('lr-total-count');
    if (visibleCount) visibleCount.textContent = filteredPosts.length;
    if (totalCount) totalCount.textContent = (this.allPosts || []).length;
  }

  /**
   * Render posts table
   */
  renderPostsTable(posts) {
    const tbody = document.getElementById('lr-posts-tbody');
    if (!tbody) return;

    if (posts.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding:20px;text-align:center;color:#9CA3AF;">
            No posts match the current filter
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = posts.map((post, index) => {
      // Display plain serial number with post ID in tooltip
      const serialNumber = index + 1;

      return `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:8px;text-align:center;">
          <span title="Post ID: ${post.postId}" style="color:#111827;font-size:12px;font-weight:600;cursor:help;">
            ${serialNumber}
          </span>
        </td>
        <td style="padding:8px;text-align:right;">${post.reactions.toLocaleString()}</td>
        <td style="padding:8px;text-align:right;">${post.comments.toLocaleString()}</td>
        <td style="padding:8px;text-align:right;">${post.reposts.toLocaleString()}</td>
        <td style="padding:8px;">
          <span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;${
            post.action === 'Commented'
              ? 'background:#D1FAE5;color:#065F46;'
              : 'background:#FEE2E2;color:#991B1B;'
          }">
            ${post.action}
          </span>
        </td>
        <td style="padding:8px;font-size:10px;color:#6B7280;">
          ${this.formatTimestamp(post.timestamp)}
        </td>
      </tr>
    `;
    }).join('');
  }

  /**
   * Download CSV of visible posts
   */
  downloadReportsCSV() {
    const posts = this.filteredPosts || [];
    const sessionData = this.sessionData || {};
    const stats = sessionData.stats || sessionData.sessionStats || {};

    if (posts.length === 0) {
      this.showToastWithAria('No data to export', 'warning');
      return;
    }

    // CSV Headers (postUrl removed - see URL_conversion.md)
    const headers = [
      'sessionId',
      'postId',
      'reactions',
      'comments',
      'reposts',
      'actionTaken',
      'itemTimestamp',
      'startedAt',
      'endedAt'
    ];

    // CSV Rows (RFC 4180 compliant)
    const sessionId = sessionData.sessionId || `session_${Date.now()}`;
    const startedAt = stats.startTime || sessionData.startedAt || '';
    const endedAt = stats.endTime || sessionData.endedAt || '';

    const rows = posts.map(post => [
      this.escapeCSV(sessionId),
      this.escapeCSV(post.postId),
      // postUrl removed
      post.reactions,
      post.comments,
      post.reposts,
      this.escapeCSV(post.action),
      this.escapeCSV(post.timestamp),
      this.escapeCSV(startedAt),
      this.escapeCSV(endedAt)
    ]);

    // Build CSV with CRLF line endings
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\r\n');

    // Create UTF-8 BOM + CSV
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

    // Download
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `linkright-report-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.showToastWithAria({
      title: '✅ CSV Exported',
      details: `${posts.length} posts downloaded. File saved to Downloads folder.`,
      duration: 3500
    }, 'success');
  }

  /**
   * Escape CSV field (RFC 4180)
   */
  escapeCSV(field) {
    if (field == null) return '';
    const str = String(field);
    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Start the automation runner
   */
  async startRunner() {
    try {
      const base = (this.settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
      const startBtn = document.querySelector('#lr-start-runner');
      const pauseBtn = document.querySelector('#lr-pause-runner');
      const stopBtn = document.querySelector('#lr-stop-runner');

      if (startBtn) startBtn.disabled = true;
      if (startBtn) startBtn.textContent = '⏳ Starting...';

      // Load runner thresholds from storage
      const thresholds = await new Promise((resolve) => {
        chrome.storage.local.get(['linkright.runnerThresholds'], (result) => {
          resolve(result['linkright.runnerThresholds'] || {
            minReactions: 500,
            minComments: 20,
            minReposts: 20,
            maxActions: 10
          });
        });
      });

      const response = await fetch(`${base}/api/runner/start`, {
        method: 'POST',
        headers: {
          'x-runner-token': this.settings.xRunnerToken || 'dev-secure-token-12345',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          thresholds: {
            maxActions: thresholds.maxActions
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to start runner: ${response.status}`);
      }

      const data = await response.json();
      console.log('LinkRight: Runner started', data);

      this.showToastWithAria({
        title: '✅ Runner Started',
        details: 'Chrome browser is now active. Navigate to LinkedIn feed to begin automation.',
        duration: 4000
      }, 'success');

      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = '▶️ Start Runner';
      }
      if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.setAttribute('data-state', 'pause');
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.style.background = '#F59E0B';
      }
      if (stopBtn) stopBtn.disabled = false;

      this.automationRunning = true;
      this.updateRunnerStatus('running');
      this.updateSidebarContent(this.sidebar); // Refresh to disable Settings
    } catch (error) {
      console.error('LinkRight: Failed to start runner', error);
      this.showToastWithAria(`❌ Error: ${error.message}`, 'error');

      const startBtn = document.querySelector('#lr-start-runner');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = '▶️ Start Runner';
      }
    }
  }

  /**
   * Stop the automation runner
   */
  async stopRunner() {
    try {
      const confirmed = confirm('Stop automation? Current session will end.');
      if (!confirmed) return;

      const base = (this.settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
      const startBtn = document.querySelector('#lr-start-runner');
      const pauseBtn = document.querySelector('#lr-pause-runner');
      const stopBtn = document.querySelector('#lr-stop-runner');

      if (stopBtn) stopBtn.disabled = true;
      if (stopBtn) stopBtn.textContent = '⏳ Stopping...';

      const response = await fetch(`${base}/api/runner/stop`, {
        method: 'POST',
        headers: {
          'x-runner-token': this.settings.xRunnerToken || 'dev-secure-token-12345',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to stop runner: ${response.status}`);
      }

      const data = await response.json();
      console.log('LinkRight: Runner stopped', data);

      this.showToastWithAria({
        title: '✅ Runner Stopped',
        details: 'Chrome browser closed. Session data saved.',
        duration: 3000
      }, 'success');

      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.textContent = '⏹️ Stop';
      }
      if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.setAttribute('data-state', 'pause');
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.style.background = '#F59E0B';
      }
      if (startBtn) startBtn.disabled = false;

      this.automationRunning = false;
      this.updateRunnerStatus('stopped');
      this.updateSidebarContent(this.sidebar); // Refresh to enable Settings
    } catch (error) {
      console.error('LinkRight: Failed to stop runner', error);
      this.showToastWithAria(`❌ Error: ${error.message}`, 'error');

      const stopBtn = document.querySelector('#lr-stop-runner');
      if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.textContent = '⏹️ Stop Runner';
      }
    }
  }

  /**
   * Toggle pause/resume automation runner
   */
  async togglePauseRunner() {
    try {
      const pauseBtn = document.querySelector('#lr-pause-runner');
      if (!pauseBtn) return;

      const currentState = pauseBtn.getAttribute('data-state'); // 'pause' or 'resume'
      const action = currentState === 'pause' ? 'pause' : 'resume';

      pauseBtn.disabled = true;
      pauseBtn.textContent = action === 'pause' ? '⏳ Pausing...' : '⏳ Resuming...';

      const base = (this.settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
      const response = await fetch(`${base}/api/runner/${action}`, {
        method: 'POST',
        headers: {
          'x-runner-token': this.settings.xRunnerToken || 'dev-secure-token-12345',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} runner: ${response.status}`);
      }

      const data = await response.json();
      console.log(`LinkRight: Runner ${action}d`, data);

      if (action === 'pause') {
        pauseBtn.setAttribute('data-state', 'resume');
        pauseBtn.textContent = '▶️ Resume';
        pauseBtn.style.background = '#10B981'; // Green for resume
        this.showToastWithAria({
          title: '⏸️ Automation Paused',
          details: 'Automation paused. Click Resume to continue.',
          duration: 3000
        }, 'info');
        this.updateRunnerStatus('paused');
      } else {
        pauseBtn.setAttribute('data-state', 'pause');
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.style.background = '#F59E0B'; // Orange for pause
        this.showToastWithAria({
          title: '▶️ Automation Resumed',
          details: 'Automation resumed. Running...',
          duration: 3000
        }, 'success');
        this.updateRunnerStatus('running');
      }

      pauseBtn.disabled = false;
    } catch (error) {
      console.error('LinkRight: Failed to toggle pause', error);
      this.showToastWithAria(`❌ Error: ${error.message}`, 'error');

      const pauseBtn = document.querySelector('#lr-pause-runner');
      if (pauseBtn) {
        pauseBtn.disabled = false;
        const state = pauseBtn.getAttribute('data-state');
        pauseBtn.textContent = state === 'pause' ? '⏸️ Pause' : '▶️ Resume';
      }
    }
  }

  /**
   * Open LinkedIn in a new tab
   */
  openLinkedInTab() {
    try {
      chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' }, (tab) => {
        if (chrome.runtime.lastError) {
          console.error('LinkRight: Failed to open tab', chrome.runtime.lastError);
          this.showToastWithAria('❌ Failed to open tab. Please open LinkedIn manually.', 'error');
        } else {
          this.showToastWithAria({
            title: '✅ LinkedIn Opened',
            details: 'New tab created. Ready for automation.',
            duration: 2500
          }, 'success');
        }
      });
    } catch (error) {
      console.error('LinkRight: Error opening tab', error);
      this.showToastWithAria('❌ Failed to open tab. Please open LinkedIn manually.', 'error');
    }
  }

  /**
   * DEPRECATED: Load saved runner thresholds into input fields
   * Settings now only exist in Settings tab, not Runner tab
   */
  // async loadRunnerThresholds() {
  //   try {
  //     const result = await new Promise((resolve) => {
  //       chrome.storage.local.get(['linkright.runnerThresholds'], (result) => {
  //         resolve(result['linkright.runnerThresholds'] || null);
  //       });
  //     });
  //
  //     if (result) {
  //       const minReactionsInput = document.querySelector('#lr-min-reactions');
  //       const minCommentsInput = document.querySelector('#lr-min-comments');
  //       const minRepostsInput = document.querySelector('#lr-min-reposts');
  //       const maxActionsInput = document.querySelector('#lr-max-actions');
  //
  //       if (minReactionsInput) minReactionsInput.value = result.minReactions || 50;
  //       if (minCommentsInput) minCommentsInput.value = result.minComments || 10;
  //       if (minRepostsInput) minRepostsInput.value = result.minReposts || 1;
  //       if (maxActionsInput) maxActionsInput.value = result.maxActions || 10;
  //
  //       console.log('LinkRight: Loaded runner thresholds', result);
  //     }
  //   } catch (error) {
  //     console.error('LinkRight: Failed to load runner thresholds', error);
  //   }
  // }

  /**
   * DEPRECATED: Apply runner settings
   * Settings now only exist in Settings tab, not Runner tab
   */
  // async applyRunnerSettings() {
  //   try {
  //     // Get values from Runner tab inputs
  //     const minReactions = parseInt(document.querySelector('#lr-min-reactions')?.value || '50');
  //     const minComments = parseInt(document.querySelector('#lr-min-comments')?.value || '10');
  //     const minReposts = parseInt(document.querySelector('#lr-min-reposts')?.value || '1');
  //     const maxActions = parseInt(document.querySelector('#lr-max-actions')?.value || '10');
  //
  //     // Validate values
  //     if (minReactions < 0 || minComments < 0 || minReposts < 0 || maxActions < 1) {
  //       throw new Error('All values must be non-negative (Max Actions >= 1)');
  //     }
  //
  //     // Store in extension settings (will be sent to runner on next start)
  //     await new Promise((resolve, reject) => {
  //       chrome.storage.local.set({
  //         'linkright.runnerThresholds': {
  //           minReactions,
  //           minComments,
  //           minReposts,
  //           maxActions
  //         }
  //       }, () => {
  //         if (chrome.runtime.lastError) {
  //           reject(new Error(chrome.runtime.lastError.message));
  //         } else {
  //           resolve();
  //         }
  //       });
  //     });
  //
  //     console.log('LinkRight: Runner thresholds saved', { minReactions, minComments, minReposts, maxActions });
  //
  //     this.showToastWithAria({
  //       title: '✅ Settings Saved',
  //       details: 'Thresholds updated. Will apply on next automation start.',
  //       duration: 3500
  //     }, 'success');
  //   } catch (error) {
  //     console.error('LinkRight: Failed to save runner settings', error);
  //     this.showToastWithAria(`❌ Error: ${error.message}`, 'error');
  //   }
  // }

  /**
   * Start polling runner status
   */
  startRunnerStatusPolling() {
    // Clear any existing interval
    if (this.runnerStatusInterval) {
      clearInterval(this.runnerStatusInterval);
    }

    // Poll every 3 seconds
    this.runnerStatusInterval = setInterval(() => {
      this.updateRunnerStatusFromAPI();
    }, 3000);

    // Initial update
    this.updateRunnerStatusFromAPI();
  }

  /**
   * Update runner status from API
   */
  async updateRunnerStatusFromAPI() {
    try {
      const base = (this.settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
      const response = await fetch(`${base}/api/runner/status`, {
        headers: {
          'x-runner-token': this.settings.xRunnerToken || 'dev-secure-token-12345'
        }
      });

      if (!response.ok) {
        console.log('LinkRight: Runner API not reachable');
        this.updateRunnerStatus('stopped');
        return;
      }

      const data = await response.json();

      // Update UI
      const statusText = data.isRunning ? 'Running' : 'Stopped';
      const statusDot = document.querySelector('#lr-status-dot');
      const statusTextEl = document.querySelector('#lr-status-text');
      const sessionIdEl = document.querySelector('#lr-session-id');
      const commentsPosted = document.querySelector('#lr-comments-posted');
      const postsProcessed = document.querySelector('#lr-posts-processed');
      const errors = document.querySelector('#lr-errors');
      const maxComments = document.querySelector('#lr-max-comments');

      // Update automation running state
      if (data.isRunning !== this.automationRunning) {
        this.automationRunning = data.isRunning;
        this.updateSidebarContent(this.sidebar); // Refresh header to disable/enable Settings
      }

      if (statusDot) {
        statusDot.style.background = data.isRunning ? '#10B981' : '#9CA3AF';
        if (data.isRunning) {
          statusDot.style.animation = 'pulse 2s infinite';
        } else {
          statusDot.style.animation = 'none';
        }
      }

      if (statusTextEl) statusTextEl.textContent = statusText;
      if (sessionIdEl) sessionIdEl.textContent = data.sessionId || '-';
      if (commentsPosted) commentsPosted.textContent = data.stats?.commentsPosted || 0;
      if (postsProcessed) postsProcessed.textContent = data.stats?.postsProcessed || 0;
      if (errors) errors.textContent = data.stats?.errors || 0;
      if (maxComments) maxComments.textContent = data.thresholds?.maxActions || 10;

      // Update button states
      const startBtn = document.querySelector('#lr-start-runner');
      const stopBtn = document.querySelector('#lr-stop-runner');
      if (startBtn) startBtn.disabled = data.isRunning;
      if (stopBtn) stopBtn.disabled = !data.isRunning;

    } catch (error) {
      console.log('LinkRight: Failed to fetch runner status (API may be down)', error);
    }
  }

  /**
   * Update runner status manually
   */
  updateRunnerStatus(status) {
    const statusDot = document.querySelector('#lr-status-dot');
    const statusText = document.querySelector('#lr-status-text');

    if (statusDot) {
      statusDot.style.background = status === 'running' ? '#10B981' : '#9CA3AF';
      if (status === 'running') {
        statusDot.style.animation = 'pulse 2s infinite';
      } else {
        statusDot.style.animation = 'none';
      }
    }

    if (statusText) {
      statusText.textContent = status === 'running' ? 'Running' : 'Stopped';
    }
  }

  /**
   * DEPRECATED: URL conversion removed - See URL_conversion.md for archived logic
   * Convert LinkedIn URN to permalink
   * @param {string} urn - LinkedIn URN (e.g., "urn:li:activity:123" or just "123")
   * @returns {string|null} - LinkedIn permalink URL or null if invalid
   */
  // toLinkedInUrl(urn) {
  //   if (!urn || typeof urn !== 'string') return null;
  //   urn = urn.trim();
  //
  //   // If just a numeric ID, convert to activity URN
  //   if (/^\d+$/.test(urn)) {
  //     urn = `urn:li:activity:${urn}`;
  //   }
  //
  //   // Handle activity and ugcPost URNs (must have ID after prefix)
  //   if (urn.startsWith('urn:li:activity:')) {
  //     const id = urn.substring('urn:li:activity:'.length);
  //     if (id.length > 0) {
  //       return `https://www.linkedin.com/feed/update/${urn}/`;
  //     }
  //   } else if (urn.startsWith('urn:li:ugcPost:')) {
  //     const id = urn.substring('urn:li:ugcPost:'.length);
  //     if (id.length > 0) {
  //       return `https://www.linkedin.com/feed/update/${urn}/`;
  //     }
  //   }
  //
  //   return null;
  // }

  /**
   * Truncate Post ID for display
   * Strip URN prefix and show first 10 chars + ellipsis
   */
  truncatePostId(postId) {
    if (!postId) return 'N/A';
    // Strip URN prefix (e.g., "urn:li:activity:" or "urn:li:ugcPost:")
    const stripped = postId.replace(/^urn:li:[^:]+:/, '');
    if (stripped.length <= 10) return stripped;
    return stripped.slice(0, 10) + '…';
  }

  /**
   * Format timestamp
   */
  formatTimestamp(timestamp) {
    if (!timestamp || timestamp === 'N/A' || timestamp === 'Running') return timestamp;
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return timestamp;
    }
  }

  /**
   * Get Runner Control tab content
   */
  getRunnerContent() {
    return `
      <div class="linkright-runner-container" style="padding:16px;font-size:13px;">
        <!-- Quick Actions -->
        <div style="margin-bottom:20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">⚡ Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button id="lr-start-runner" class="linkright-btn linkright-btn-primary" style="width:100%;padding:10px;background:#10B981;color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;">
              ▶️ Start Runner <span style="opacity:0.8;font-size:11px;font-weight:normal;">(Alt+Shift+S)</span>
            </button>
            <button id="lr-stop-runner" class="linkright-btn linkright-btn-danger" style="width:100%;padding:10px;background:#EF4444;color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;" disabled>
              ⏹️ Stop Runner
            </button>
            <button id="lr-open-linkedin" class="linkright-btn linkright-btn-secondary" style="width:100%;padding:10px;background:#3B82F6;color:white;border:none;border-radius:6px;font-weight:600;cursor:pointer;">
              🌐 Open LinkedIn Tab <span style="opacity:0.8;font-size:11px;font-weight:normal;">(Alt+Shift+L)</span>
            </button>
          </div>
        </div>


        <!-- Runner Status -->
        <div style="margin-bottom:20px;padding:12px;background:#F9FAFB;border-radius:6px;border:1px solid #E5E7EB;">
          <h3 style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111827;">📡 Runner Status</h3>
          <div id="lr-runner-status" style="font-size:12px;color:#6B7280;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span id="lr-status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#9CA3AF;"></span>
              <span id="lr-status-text">Stopped</span>
            </div>
            <div style="margin-top:4px;font-size:11px;">
              <div>Session ID: <span id="lr-session-id">-</span></div>
              <div>Uptime: <span id="lr-uptime">-</span></div>
            </div>
          </div>
        </div>

        <!-- Live Stats -->
        <div id="lr-live-stats" style="padding:12px;background:#F9FAFB;border-radius:6px;border:1px solid #E5E7EB;">
          <h3 style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111827;">📊 Live Stats</h3>
          <div style="font-size:12px;color:#6B7280;">
            <div>Comments Posted: <strong id="lr-comments-posted">0</strong> / <span id="lr-max-comments">10</span></div>
            <div>Posts Processed: <strong id="lr-posts-processed">0</strong></div>
            <div>Errors: <strong id="lr-errors">0</strong></div>
          </div>
          <p style="margin:8px 0 0;font-size:10px;color:#9CA3AF;">Updates every 3s when running</p>
        </div>
      </div>
    `;
  }


  /**
   * Utility: determine if element is an editor we can paste into
   */
  isEditorElement(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
    if (el.classList && el.classList.contains('ql-editor')) return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
    return false;
  }
}

// Initialize the widget when script loads
const linkRightWidget = new LinkRightWidget();

// Test bridge for E2E (window message API)
window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'LR_TEST_OPEN_SIDEBAR') {
    try { linkRightWidget.openSidebar(); } catch (_) {}
  } else if (data.type === 'LR_TEST_GET_ICON_ACTIVE') {
    try {
      chrome.storage.local.get(['linkright.iconActive'], (result) => {
        window.postMessage({ type: 'LR_TEST_ICON_ACTIVE', active: !!result['linkright.iconActive'] }, '*');
      });
    } catch (_) {}
  } else if (data.type === 'LR_TEST_SET_STORAGE') {
    try {
      const payload = {};
      payload[data.key] = data.value;
      chrome.storage.local.set(payload, () => {
        window.postMessage({ type: 'LR_TEST_SET_STORAGE_DONE', key: data.key }, '*');
      });
    } catch (_) {}
  } else if (data.type === 'LR_TEST_GET_STORAGE') {
    try {
      chrome.storage.local.get([data.key], (result) => {
        window.postMessage({ type: 'LR_TEST_GET_STORAGE_DONE', key: data.key, value: result[data.key] }, '*');
      });
    } catch (_) {}
  } else if (data.type === 'LR_TEST_TOAST') {
    try { linkRightWidget.showToastWithAria(data.message || 'Test toast', data.toastType || 'info'); } catch (_) {}
  } else if (data.type === 'LR_TEST_OPEN_SETTINGS') {
    try { linkRightWidget.currentView = 'settings'; linkRightWidget.updateSidebarContent(linkRightWidget.sidebar); } catch (_) {}
  } else if (data.type === 'LR_TEST_OPEN_REPORTS') {
    try { linkRightWidget.currentView = 'report'; linkRightWidget.updateSidebarContent(linkRightWidget.sidebar); } catch (_) {}
  } else if (data.type === 'LR_TEST_GO_HOME') {
    try { linkRightWidget.currentView = 'main'; linkRightWidget.updateSidebarContent(linkRightWidget.sidebar); } catch (_) {}
  } else if (data.type === 'LR_TEST_CLOSE_STICKY') {
    try { linkRightWidget.closeStickyTab(); } catch (_) {}
  }
});

/**
 * Add 3-minute countdown UI for keyboard automation
 */
/* Removed legacy addRunnerCountdownUI (countdown/run plan) */
/* async function addRunnerCountdownUI() {
  const panel = document.querySelector('.linkright-sidebar-content') || document.querySelector('#linkright-sidebar') || document.body;
  const wrap = document.getElementById('lr-countdown') || document.createElement('div');
  wrap.id = 'lr-countdown';
  wrap.style.cssText = 'margin:12px 0;font:14px/1.4 system-ui;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;';

  // Get current settings for run plan
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(['linkright.settings'], (result) => {
      const defaults = {
        engagementMode: false,
        xRunnerToken: 'dev-secure-token-12345',
        webhookUrl: 'https://n8n.linkright.in/webhook/linkedin-reply',
        maxActions: 10,
        waitActionMinMs: 2000,
        waitActionMaxMs: 4000,
        waitAfterCommentMinMs: 2000,
        waitAfterCommentMaxMs: 4000,
        waitBetweenCommentsMinMs: 5000,
        waitBetweenCommentsMaxMs: 10000
        // DEPRECATED: scrollJitter removed
      };
      resolve(result['linkright.settings'] || defaults);
    });
  });

  // Extract webhook host
  let webhookHost = 'Not configured';
  try {
    const url = new URL(settings.webhookUrl);
    webhookHost = url.hostname;
  } catch (e) {
    webhookHost = 'Invalid URL';
  }

  const hasToken = settings.xRunnerToken && settings.xRunnerToken.length > 0;

  wrap.innerHTML = `
    <!-- ARIA live region for countdown announcements -->
    <div id="lr-aria-countdown" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;"></div>

    <!-- Run Plan Summary -->
    <div style="margin-bottom:12px;padding:10px;background:white;border-radius:6px;border:1px solid #d1d5db;">
      <h4 style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">📋 Run Plan</h4>
      <div style="font-size:11px;color:#6B7280;line-height:1.6;">
        <div><strong>Mode:</strong> ${settings.engagementMode ? '✅ Engagement ON' : '❌ Engagement OFF'}</div>
        <div><strong>Max Actions:</strong> ${settings.maxActions} comments per session</div>
        <div><strong>Timing:</strong> ${settings.waitActionMinMs}-${settings.waitActionMaxMs}ms action wait, ${settings.waitBetweenCommentsMinMs}-${settings.waitBetweenCommentsMaxMs}ms between comments</div>
        <div><strong>Webhook:</strong> ${webhookHost} ${!hasToken ? '<span style="color:#EF4444;font-weight:600;">(⚠️ No token)</span>' : ''}</div>
      </div>
    </div>

    <!-- Mode Toggle -->
    <div style="margin-bottom:12px;padding:8px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;user-select:none;">
        <input type="checkbox" id="lr-scan-only" style="cursor:pointer;" aria-label="Scan only mode (no actions)">
        <span><strong>Scan only</strong> (no actions) — Test feed parsing</span>
      </label>
    </div>

    <!-- Countdown Controls -->
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button id="lr-start-countdown"
        style="flex:1;padding:10px 16px;border-radius:8px;border:1px solid #ccc;cursor:pointer;background:#006666;color:white;font-weight:600;font-size:14px;"
        aria-label="Start 3-minute countdown">
        Start (3:00)
      </button>
      <button id="lr-cancel-countdown"
        style="padding:10px 16px;border-radius:8px;border:1px solid #ccc;cursor:pointer;background:#EF4444;color:white;font-weight:600;display:none;font-size:14px;"
        aria-label="Cancel countdown">
        Cancel
      </button>
    </div>

    <!-- Emergency Stop Button (Always Visible) -->
    <div style="margin-bottom:12px;">
      <button id="lr-stop-runner-now"
        style="width:100%;padding:12px 16px;border-radius:8px;border:2px solid #DC2626;cursor:pointer;background:#FEE2E2;color:#DC2626;font-weight:700;font-size:14px;transition:all 0.2s;"
        aria-label="Stop runner immediately"
        title="Immediately stop the runner">
        🛑 STOP RUNNER NOW
      </button>
    </div>

    <!-- Status Label -->
    <div id="lr-countdown-label" style="font-size:12px;color:#666;min-height:18px;text-align:center;"></div>

    <!-- Payload Preview (Collapsed) -->
    <details style="margin-top:12px;">
      <summary style="cursor:pointer;font-size:12px;color:#6B7280;user-select:none;padding:4px;">
        <span style="font-weight:500;">📦 Payload Preview</span> (collapsed)
      </summary>
      <pre id="lr-payload-preview" style="margin:8px 0 0;padding:10px;background:#1F2937;color:#D1D5DB;border-radius:4px;font-size:11px;overflow-x:auto;line-height:1.5;white-space:pre-wrap;">Loading...</pre>
    </details>
  `;

  if (!wrap.parentNode) panel.prepend(wrap);

  // Elements
  const startBtn = wrap.querySelector('#lr-start-countdown');
  const cancelBtn = wrap.querySelector('#lr-cancel-countdown');
  const stopNowBtn = wrap.querySelector('#lr-stop-runner-now');
  const label = wrap.querySelector('#lr-countdown-label');
  const scanOnlyCheckbox = wrap.querySelector('#lr-scan-only');
  const ariaLive = wrap.querySelector('#lr-aria-countdown');
  const payloadPreview = wrap.querySelector('#lr-payload-preview');
  if (payloadPreview) {
    payloadPreview.style.maxHeight = '240px';
    payloadPreview.style.overflow = 'auto';
  }

  // Stop Now button handler
  stopNowBtn.onclick = async () => {
    console.log('LinkRight: Stop Now button clicked');
    stopNowBtn.disabled = true;
    stopNowBtn.textContent = 'Stopping...';

    try {
      // Get runner base URL from settings
      const settingsResult = await chrome.storage.local.get(['linkright.settings']);
      const settings = settingsResult['linkright.settings'] || {};
      const base = (settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');

      const response = await fetch(`${base}/api/runner/stop`, {
        method: 'POST',
        headers: {
          'x-runner-token': settings.xRunnerToken || 'dev-secure-token-12345',
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        linkRightWidget.showToastWithAria('✅ Runner stopped successfully', 'success');
        console.log('LinkRight: Runner stopped', result);

        // Reset countdown UI if active
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        saveCountdownState(false);

        startBtn.textContent = 'Start (3:00)';
        startBtn.disabled = false;
        scanOnlyCheckbox.disabled = false;
        cancelBtn.style.display = 'none';
        label.textContent = 'Runner stopped';
      } else {
        const errorText = await response.text();
        linkRightWidget.showToastWithAria(`Failed to stop runner: ${errorText}`, 'error');
      }
    } catch (error) {
      console.error('LinkRight: Error stopping runner:', error);
      linkRightWidget.showToastWithAria(`Error stopping runner: ${error.message}`, 'error');
    } finally {
      stopNowBtn.disabled = false;
      stopNowBtn.textContent = '🛑 STOP RUNNER NOW';
    }
  };

  // Restore countdown state from storage
  const savedState = await new Promise((resolve) => {
    chrome.storage.local.get(['linkright.countdownState'], (result) => {
      resolve(result['linkright.countdownState'] || null);
    });
  });

  // State
  let countdownInterval = null;
  let secondsRemaining = 0;
  let isScanOnlyMode = false;

  // Restore state if countdown was active
  if (savedState && savedState.isActive) {
    const elapsed = Math.floor((Date.now() - savedState.startTime) / 1000);
    secondsRemaining = Math.max(0, savedState.totalSeconds - elapsed);
    isScanOnlyMode = savedState.isScanOnly;
    scanOnlyCheckbox.checked = isScanOnlyMode;

    if (secondsRemaining > 0) {
      // Resume countdown
      console.log('LinkRight: Resuming countdown with', secondsRemaining, 'seconds remaining');
      startCountdownWithSeconds(secondsRemaining, isScanOnlyMode);
    } else {
      // Countdown expired while navigating - clear state
      chrome.storage.local.remove(['linkright.countdownState']);
    }
  }

  // Save countdown state
  const saveCountdownState = (isActive, totalSec = 0, isScan = false) => {
    if (isActive) {
      chrome.storage.local.set({
        'linkright.countdownState': {
          isActive: true,
          startTime: Date.now(),
          totalSeconds: totalSec,
          isScanOnly: isScan
        }
      });
    } else {
      chrome.storage.local.remove(['linkright.countdownState']);
    }
  };

  // Update payload preview
  const updatePayloadPreview = () => {
    const isScanOnly = scanOnlyCheckbox.checked;
    const tokenPreview = hasToken ? `"${settings.xRunnerToken.substring(0, 8)}...${settings.xRunnerToken.slice(-4)}"` : '<span style="color:#EF4444;font-weight:600;">[MISSING]</span>';

    payloadPreview.innerHTML = `{
  "mode": "${isScanOnly ? 'SCAN' : 'RUN'}",
  "token": ${tokenPreview},
  "thresholds": {
    "maxActions": ${settings.maxActions}
  },
  "timing": {
    "waitAction": { "min": ${settings.waitActionMinMs}, "max": ${settings.waitActionMaxMs} },
    "waitAfterComment": { "min": ${settings.waitAfterCommentMinMs}, "max": ${settings.waitAfterCommentMaxMs} },
    "waitBetweenComments": { "min": ${settings.waitBetweenCommentsMinMs}, "max": ${settings.waitBetweenCommentsMaxMs} }
  }
}`;
  };

  // Initialize payload preview
  updatePayloadPreview();

  // Update preview when toggle changes
  scanOnlyCheckbox.addEventListener('change', updatePayloadPreview);

  // Function to start countdown with given seconds
  const startCountdownWithSeconds = (initialSeconds, isScan) => {
    secondsRemaining = initialSeconds;
    const totalSeconds = initialSeconds;
    startBtn.disabled = true;
    scanOnlyCheckbox.disabled = true;
    cancelBtn.style.display = 'inline-block';

    // Save state
    saveCountdownState(true, totalSeconds, isScan);

    const tick = () => {
      const m = String(Math.floor(secondsRemaining / 60)).padStart(1, '0');
      const s = String(secondsRemaining % 60).padStart(2, '0');
      startBtn.textContent = `Starting (${m}:${s})`;
      label.textContent = 'Refresh LinkedIn & ensure keyboard shortcuts are enabled (Shift+?)';

      // Announce every 30 seconds
      if (secondsRemaining % 30 === 0 && secondsRemaining > 0) {
        ariaLive.textContent = `${secondsRemaining} seconds remaining`;
      }
    };

    tick();
    countdownInterval = setInterval(() => {
      secondsRemaining -= 1;
      tick();

      if (secondsRemaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        label.textContent = 'Launching…';
        ariaLive.textContent = 'Launching automation';

        // Clear saved state
        saveCountdownState(false);

        // Fire the selected API call
        if (isScan) {
          chrome.runtime.sendMessage({
            type: 'LR_START_SCAN',
            limit: 3
          });
        } else {
          chrome.runtime.sendMessage({
            type: 'LR_START_RUNNER_AFTER_COUNTDOWN'
          });
        }

        // Reset UI after launch
        setTimeout(() => {
          startBtn.textContent = 'Start (3:00)';
          startBtn.disabled = false;
          scanOnlyCheckbox.disabled = false;
          cancelBtn.style.display = 'none';
          label.textContent = '';
        }, 2000);
      }
    }, 1000);
  };

  // Start countdown button handler with runner preflight
  startBtn.onclick = async () => {
    const isScanOnly = scanOnlyCheckbox.checked;

    // Preflight runner health check
    try {
      const base = (settings.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);

      let healthResp = null;
      let fetchError = null;

      try {
        healthResp = await fetch(`${base}/health`, { signal: controller.signal });
      } catch (err) {
        fetchError = err;
      }

      clearTimeout(timeout);

      // Check if runner is not reachable or returns non-OK status
      if (!healthResp || !healthResp.ok || fetchError) {
        const errorMsg = fetchError && fetchError.name === 'AbortError'
          ? `⚠️ Runner timeout at ${base}. Check if runner is running.`
          : healthResp && healthResp.status === 404
            ? `🔴 Runner service not found (404). Start the local runner and try again.`
            : `🔴 Cannot reach runner at ${base}. Start the local runner and try again.`;

        linkRightWidget.showToastWithAria(errorMsg, 'error');

        // Reset button state
        startBtn.textContent = 'Start (3:00)';
        startBtn.disabled = false;
        scanOnlyCheckbox.disabled = false;
        cancelBtn.style.display = 'none';
        label.textContent = 'Runner connection failed';

        // Clear label after 3 seconds
        setTimeout(() => {
          label.textContent = '';
        }, 3000);

        return;
      }
    } catch (e) {
      console.error('LinkRight: Health check error:', e);
      linkRightWidget.showToastWithAria('🔴 Runner connection error. Start the local runner and try again.', 'error');

      // Reset button state
      startBtn.textContent = 'Start (3:00)';
      startBtn.disabled = false;
      scanOnlyCheckbox.disabled = false;
      cancelBtn.style.display = 'none';
      label.textContent = '';
      return;
    }

    // Health check passed, start countdown
    startCountdownWithSeconds(180, isScanOnly); // 3 minutes
  };

  // Cancel countdown
  cancelBtn.onclick = () => {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    // Clear saved state
    saveCountdownState(false);

    startBtn.textContent = 'Start (3:00)';
    startBtn.disabled = false;
    scanOnlyCheckbox.disabled = false;
    cancelBtn.style.display = 'none';
    label.textContent = 'Countdown cancelled';
    ariaLive.textContent = 'Countdown cancelled';

    setTimeout(() => {
      label.textContent = '';
    }, 2000);
  };

  // Keyboard support
  startBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      startBtn.click();
    }
  });

  cancelBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cancelBtn.click();
    }
  });
} */

// Add countdown UI when page loads
/* Countdown UI removed */