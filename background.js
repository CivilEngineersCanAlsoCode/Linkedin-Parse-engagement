/**
 * LinkRight - Job Search CRM Background Service Worker
 * Handles keyboard shortcuts and state management for job search automation
 */

// OPTIMIZATION: Storage manager for batch operations
class StorageManager {
  constructor() {
    this._cache = new Map();
    this._writeQueue = [];
    this._batchWriteTimer = null;
    this._batchTimeout = 100; // 100ms batch window
  }
  
  // OPTIMIZATION: Batch storage writes
  async set(key, value) {
    this._cache.set(key, value);
    this._writeQueue.push({ key, value });
    
    if (this._batchWriteTimer) {
      clearTimeout(this._batchWriteTimer);
    }
    
    this._batchWriteTimer = setTimeout(() => {
      this.flushWriteQueue();
    }, this._batchTimeout);
  }
  
  async flushWriteQueue() {
    if (this._writeQueue.length === 0) return;
    
    const batch = {};
    this._writeQueue.forEach(({ key, value }) => {
      batch[key] = value;
    });
    
    await chrome.storage.local.set(batch);
    this._writeQueue = [];
  }
  
  // OPTIMIZATION: Lazy loading with cache
  async get(key) {
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }
    
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    
    if (value !== undefined) {
      this._cache.set(key, value);
    }
    
    return value;
  }
  
  // OPTIMIZATION: Batch get operations
  async getMultiple(keys) {
    const result = {};
    const uncachedKeys = [];
    
    for (const key of keys) {
      if (this._cache.has(key)) {
        result[key] = this._cache.get(key);
      } else {
        uncachedKeys.push(key);
      }
    }
    
    if (uncachedKeys.length > 0) {
      const storageResult = await chrome.storage.local.get(uncachedKeys);
      for (const [key, value] of Object.entries(storageResult)) {
        result[key] = value;
        this._cache.set(key, value);
      }
    }
    
    return result;
  }
}

// OPTIMIZATION: Initialize storage manager
const storageManager = new StorageManager();

// Runner state management
let runnerState = 'idle'; // 'idle' | 'starting' | 'running' | 'stopping'
let toggleLock = false;
let lastToggleTs = 0;

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('LinkRight Job Search CRM extension installed');

  // OPTIMIZATION: Batch initial state setup
  await storageManager.set('engagementMode', false);
  await storageManager.set('jobAutomationMode', false);
  await storageManager.set('networkingMode', false);
  await storageManager.set('coldEmailMode', false);
  await storageManager.set('extensionActive', false);
  await storageManager.set('runnerState', 'idle');

  // Default toolbar icon to grayscale on install
  try {
    updateExtensionIcon(false);
    await storageManager.set('linkright.iconActive', false);
  } catch (e) {
    console.warn('LinkRight: Failed to set default icon on install');
  }
});

// OPTIMIZATION: Restore runner state on service worker startup
(async () => {
  try {
    const saved = await storageManager.get('runnerState');
    if (saved) {
      runnerState = saved;
      console.log('LinkRight: Restored runner state:', runnerState);
    }
  } catch (error) {
    console.error('LinkRight: Failed to restore state:', error);
  }
})();

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-engagement') {
    toggleEngagementMode();
  } else if (command === 'toggle-runner') {
    toggleRunner();
  } else if (command === 'toggle-automation') {
    toggleAutomation();
  } else if (command === 'open-settings') {
    openSettings();
  }
});

/**
 * Toggle Engagement Mode on/off
 */
// OPTIMIZATION: Toggle engagement mode with optimized storage
async function toggleEngagementMode() {
  try {
    const currentState = await storageManager.get('engagementMode');
    const newState = !currentState;
    
    await storageManager.set('engagementMode', newState);
    
    // Notify all LinkedIn tabs about the state change
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'ENGAGEMENT_MODE_CHANGED',
          enabled: newState
        });
      } catch (error) {
        // Tab might not be ready or content script not loaded
        console.log('Could not notify tab:', tab.id);
      }
    }
  } catch (error) {
    console.error('Error toggling engagement mode:', error);
  }
}

/**
 * Toggle Runner ON/OFF (Alt+R)
 */
async function toggleRunner() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*', active: true });

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'TOGGLE_RUNNER'
        });
      } catch (error) {
        console.log('Could not toggle runner on tab:', tab.id);
      }
    }
  } catch (error) {
    console.error('Error toggling runner:', error);
  }
}

/**
 * Toggle Automation Start/Stop (Alt+A)
 */
async function toggleAutomation() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*', active: true });

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'TOGGLE_AUTOMATION'
        });
      } catch (error) {
        console.log('Could not toggle automation on tab:', tab.id);
      }
    }
  } catch (error) {
    console.error('Error toggling automation:', error);
  }
}

/**
 * Open Settings (Alt+S)
 */
async function openSettings() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*', active: true });

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'OPEN_SETTINGS'
        });
      } catch (error) {
        console.log('Could not open settings on tab:', tab.id);
      }
    }
  } catch (error) {
    console.error('Error opening settings:', error);
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // Only work on LinkedIn pages
  if (tab.url && tab.url.includes('linkedin.com')) {
    try {
      // Always send message to content script to toggle/open sidebar
      await chrome.tabs.sendMessage(tab.id, {
        type: 'OPEN_SIDEBAR_FROM_EXTENSION'
      });
    } catch (error) {
      console.log('Could not send message to tab (will inject content):', tab.id, error);
      try {
        await ensureContentInjected(tab.id);
        await chrome.tabs.sendMessage(tab.id, {
          type: 'OPEN_SIDEBAR_FROM_EXTENSION'
        });
      } catch (e) {
        console.error('LinkRight: Failed to inject content scripts:', e);
      }
    }
  }
});

// Close sticky tab when extension is disabled or unpinned
chrome.runtime.onSuspend.addListener(async () => {
  console.log('LinkRight: Service worker suspending, closing sticky tabs');
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'CLOSE_STICKY_TAB'
        });
      } catch (error) {
        // Tab might not be ready
        console.log('Could not close sticky tab on:', tab.id);
      }
    }
  } catch (error) {
    console.error('Error closing sticky tabs:', error);
  }
});

// Detect when popup closes (if extension action has popup)
// This will close sticky tab when user clicks extension icon and then closes it
let popupOpenTime = null;

chrome.action.onClicked.addListener(() => {
  popupOpenTime = Date.now();
});

// Listen for window focus change to detect popup close
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // No window has focus - might mean popup closed
    return;
  }

  // If popup was recently open and focus changed, assume popup closed
  if (popupOpenTime && Date.now() - popupOpenTime < 5000) {
    // Popup was open recently, might have closed
    // Don't close sticky tab here as user might still want it open
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ENGAGEMENT_STATE') {
    chrome.storage.local.get(['engagementMode'], (result) => {
      sendResponse({ engagementMode: result.engagementMode || false });
    });
    return true;
  } else if (message.type === 'UPDATE_ICON_STATE') {
    updateExtensionIcon(message.active);
    try {
      chrome.storage.local.set({ 'linkright.iconActive': !!message.active });
    } catch (e) {
      // no-op
    }
    sendResponse({ success: true });
    return true;
  } else if (message.type === 'LR_START_RUNNER_AFTER_COUNTDOWN') {
    // Handle countdown completion - start keyboard automation
    startKeyboardAutomation();
    sendResponse({ success: true });
    return true;
  } else if (message.type === 'SAVE_SETTINGS') {
    // Handle settings save with dual-persistence
    saveSettings(message.settings).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('LinkRight: Failed to save settings:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.type === 'LOAD_SETTINGS') {
    // Handle settings load with dual-persistence
    loadSettings().then((settings) => {
      sendResponse({ success: true, settings });
    }).catch((error) => {
      console.error('LinkRight: Failed to load settings:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

/**
 * Safe toggle runner with debounce and state locking
 */
async function safeToggleRunner() {
  // Check toggle lock
  if (toggleLock) {
    console.log('LinkRight: Toggle in progress, ignoring');
    return;
  }

  // Debounce check (1.5 seconds)
  const now = Date.now();
  if (now - lastToggleTs < 1500) {
    console.log('LinkRight: Debounce - ignoring rapid toggle');
    return;
  }

  // Check if in transition state
  if (runnerState === 'starting' || runnerState === 'stopping') {
    console.log('LinkRight: Runner in transition state, ignoring');
    return;
  }

  // Acquire lock
  toggleLock = true;
  lastToggleTs = now;

  try {
    console.log('LinkRight: Toggle runner command received, state:', runnerState);

    // Determine action based on current state
    if (runnerState === 'running') {
      console.log('LinkRight: Runner is running, stopping...');
      runnerState = 'stopping';
      await chrome.storage.local.set({ runnerState });

      await stopRunner();

      runnerState = 'idle';
      await chrome.storage.local.set({ runnerState });
    } else {
      console.log('LinkRight: Runner is idle, starting...');
      runnerState = 'starting';
      await chrome.storage.local.set({ runnerState });

      await startRunner();

      runnerState = 'running';
      await chrome.storage.local.set({ runnerState });
    }
  } catch (error) {
    console.error('LinkRight: Error toggling runner:', error);
    runnerState = 'idle';
    await chrome.storage.local.set({ runnerState });
  } finally {
    toggleLock = false;
  }
}

/**
 * Save settings to BOTH chrome.storage AND backend
 */
async function saveSettings(settings) {
  // 1. Save to chrome.storage.local
  await chrome.storage.local.set({ 'linkright.settings': settings });
  
  // 2. Sync to backend
  try {
    const baseUrl = settings.runnerBaseUrl || 'http://127.0.0.1:3001';
    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-runner-token': settings.xRunnerToken || 'dev-secure-token-12345'
      },
      body: JSON.stringify(settings)
    });
    console.log('LinkRight: Settings synced to backend');
  } catch (error) {
    console.warn('LinkRight: Failed to sync settings to backend:', error);
  }
}

/**
 * Load settings with backend fallback
 */
async function loadSettings() {
  // 1. Try chrome.storage first
  const local = await chrome.storage.local.get('linkright.settings');
  
  if (local['linkright.settings']) {
    return local['linkright.settings'];
  }
  
  // 2. Fallback to backend
  try {
    const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';
    const response = await fetch(`${DEFAULT_BASE_URL}/api/settings`, {
      headers: { 'x-runner-token': 'dev-secure-token-12345' }
    });
    const data = await response.json();
    
    if (data.success && data.settings) {
      // Restore to chrome.storage
      await chrome.storage.local.set({ 'linkright.settings': data.settings });
      console.log('LinkRight: Settings restored from backend');
      return data.settings;
    }
  } catch (error) {
    console.warn('LinkRight: Failed to load from backend:', error);
  }
  
  // 3. Return defaults
  return getDefaultSettings();
}

/**
 * Get default settings
 */
function getDefaultSettings() {
  return {
    engagementMode: false,
    xRunnerToken: 'dev-secure-token-12345',
    webhookUrl: 'https://n8n.linkright.in/webhook/linkedin-reply',
    runnerBaseUrl: 'http://127.0.0.1:3001',
    privacyPolicyUrl: 'https://linkright.in/privacy',
    maxActions: 10,
    waitActionMinMs: 500,
    waitActionMaxMs: 1000,
    waitAfterCommentMinMs: 1000,
    waitAfterCommentMaxMs: 2000,
    waitBetweenCommentsMinMs: 5000,
    waitBetweenCommentsMaxMs: 10000
  };
}

/**
 * Get latest settings from chrome.storage
 */
async function getLatestSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['linkright.settings'], (result) => {
      const defaults = getDefaultSettings();
      const settings = result['linkright.settings'] || defaults;
      resolve({ ...defaults, ...settings });
    });
  });
}

/**
 * Build payload for runner API
 */
function buildRunnerPayload(settings) {
  return {
    // Core settings
    enableEngagementMode: settings.engagementMode,
    webhookUrl: settings.webhookUrl,
    xRunnerToken: settings.xRunnerToken,
    
    // NEW: Two-mode engagement settings
    optimizeEngagement: settings.optimizeEngagement || false,
    postAnalysisWebhook: settings.postAnalysisWebhook || 'https://n8n.linkright.in/webhook/linkedin-parse',

    // Thresholds
    thresholds: {
      maxActions: settings.maxActions
    },

    // Timing ranges (milliseconds)
    timing: {
      waitAction: {
        min: settings.waitActionMinMs,
        max: settings.waitActionMaxMs
      },
      waitAfterComment: {
        min: settings.waitAfterCommentMinMs,
        max: settings.waitAfterCommentMaxMs
      },
      waitBetweenComments: {
        min: settings.waitBetweenCommentsMinMs,
        max: settings.waitBetweenCommentsMaxMs
      }
    },

    // Scroll settings
    scrollJitter: {
      min: settings.scrollJitterCountMin,
      max: settings.scrollJitterCountMax
    }
  };
}

/**
 * Show warning toast (via content script)
 */
async function showWarningToast(message, highlightToken = false) {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_TOAST',
        message,
        toastType: 'warning'
      });

      // Optionally highlight token field
      if (highlightToken) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'HIGHLIGHT_TOKEN_FIELD'
        });
      }
    } catch (error) {
      console.log('Could not show toast on tab:', tab.id);
    }
  }
}

/**
 * Reset countdown UI to initial state (broadcasts to all LinkedIn tabs)
 */
async function resetCountdownUI() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'RESET_COUNTDOWN_UI'
        });
      } catch (error) {
        console.log('Could not reset countdown on tab:', tab.id);
      }
    }

    // Clear countdown state from storage
    await chrome.storage.local.remove(['linkright.countdownState']);
  } catch (error) {
    console.error('Error resetting countdown UI:', error);
  }
}

/**
 * Start the runner
 */
async function startRunner() {
  const settingsForBase = await getLatestSettings();
  const baseUrl = (settingsForBase.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const RUNNER_API_URL = `${baseUrl}/api`;

  try {
    // Get latest settings
    const settings = await getLatestSettings();

    // Build headers
    const headers = {
      'Content-Type': 'application/json'
    };

    // Add token if present
    if (settings.xRunnerToken) {
      headers['x-runner-token'] = settings.xRunnerToken;
    } else {
      console.warn('LinkRight: No runner token configured');
      await showWarningToast('⚠️ Runner token missing! Check Settings.', true);
    }

    const response = await fetch(`${RUNNER_API_URL}/runner/start`, {
      method: 'POST',
      headers
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const result = await response.json();

    // Check for navigation timeout error
    if (!result.success && result.code === 'NAV_TIMEOUT') {
      console.error('LinkRight: Navigation timeout -', result.hint);

      // Log artifact paths if available
      if (result.artifacts && result.artifacts.length > 0) {
        console.log('LinkRight: Failure artifacts:', result.artifacts);
      }

      // Reset countdown UI
      await resetCountdownUI();

      // Show error toast with hint
      await showWarningToast(`❌ ${result.hint || 'LinkedIn didn\'t load. Check login/connectivity and try again.'}`, false);

      // Reset runner state
      runnerState = 'idle';
      await chrome.storage.local.set({ runnerState, runnerActive: false });

      throw new Error(result.hint || 'Navigation timeout');
    }

    // Check for other startup errors
    if (!result.success) {
      console.error('LinkRight: Startup error -', result.hint || result.message);

      // Reset countdown UI
      await resetCountdownUI();

      // Show error toast
      await showWarningToast(`❌ ${result.hint || result.message || 'Failed to start runner'}`, false);

      // Reset runner state
      runnerState = 'idle';
      await chrome.storage.local.set({ runnerState, runnerActive: false });

      throw new Error(result.hint || result.message || 'Failed to start');
    }

    console.log('LinkRight: Runner started', result);

    // Update storage
    await chrome.storage.local.set({ runnerActive: true });

    return result;

  } catch (error) {
    console.error('LinkRight: Failed to start runner:', error);
    runnerState = 'idle';
    await chrome.storage.local.set({ runnerState });

    // Reset countdown UI on error
    await resetCountdownUI();

    throw error;
  }
}

/**
 * Stop the runner
 */
async function stopRunner() {
  const settingsForBase = await getLatestSettings();
  const baseUrl = (settingsForBase.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const RUNNER_API_URL = `${baseUrl}/api`;
  const RUNNER_TOKEN = 'dev-secure-token-12345';

  try {
    const response = await fetch(`${RUNNER_API_URL}/runner/stop`, {
      method: 'POST',
      headers: {
        'x-runner-token': RUNNER_TOKEN
      }
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const result = await response.json();
    console.log('LinkRight: Runner stopped', result);

    // Update storage
    await chrome.storage.local.set({ runnerActive: false });

    return result;

  } catch (error) {
    console.error('LinkRight: Failed to stop runner:', error);
    runnerState = 'idle';
    await chrome.storage.local.set({ runnerState });
    throw error;
  }
}

/**
 * Get runner status
 */
async function getRunnerStatus() {
  const settingsForBase = await getLatestSettings();
  const baseUrl = (settingsForBase.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const RUNNER_API_URL = `${baseUrl}/api`;
  const RUNNER_TOKEN = 'dev-secure-token-12345';

  try {
    const response = await fetch(`${RUNNER_API_URL}/runner/status`, {
      headers: {
        'x-runner-token': RUNNER_TOKEN
      }
    });

    const status = await response.json();
    console.log('LinkRight: Current status', status);

    return status;

  } catch (error) {
    console.error('LinkRight: Failed to get status:', error);
    // Return default status if API is unreachable
    return { isRunning: false };
  }
}


/**
 * Start keyboard-only automation
 */
async function startKeyboardAutomation() {
  const settingsForBase = await getLatestSettings();
  const baseUrl = (settingsForBase.runnerBaseUrl || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const RUNNER_API_URL = `${baseUrl}/api`;

  try {
    console.log('LinkRight: Starting keyboard automation...');

    // Get latest settings
    const settings = await getLatestSettings();

    // Build headers
    const headers = {
      'Content-Type': 'application/json'
    };

    // Add token if present, otherwise warn
    if (settings.xRunnerToken) {
      headers['x-runner-token'] = settings.xRunnerToken;
    } else {
      console.warn('LinkRight: No runner token configured');
      await showWarningToast('⚠️ Runner token missing! Check Settings.', true);
    }

    // First ensure runner is started
    const status = await getRunnerStatus();
    if (!status.isRunning) {
      console.log('LinkRight: Runner not active, starting first...');
      await startRunner();
      // Wait for browser to be ready
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Build payload
    const payload = buildRunnerPayload(settings);

    console.log('LinkRight: Payload (token redacted)', {
      ...payload,
      token: settings.xRunnerToken ? '[REDACTED]' : '[MISSING]'
    });

    // Now start keyboard automation
    const response = await fetch(`${RUNNER_API_URL}/runner/start-keyboard`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('LinkRight: Keyboard automation started', result);

    return result;

  } catch (error) {
    console.error('LinkRight: Failed to start keyboard automation:', error);
    await showWarningToast(`Start failed: ${error.message}`);
    throw error;
  }
}

// Update extension icon on state change
async function updateExtensionIcon(active) {
  try {
    // Use colored icons when active, grayscale when inactive
    const iconSuffix = active ? '.png' : '_gray.png';

    chrome.action.setIcon({
      path: {
        16: `icons/icon16${iconSuffix}`,
        48: `icons/icon48${iconSuffix}`,
        128: `icons/icon128${iconSuffix}`
      }
    });

    console.log(`LinkRight: Icon updated to ${active ? 'active' : 'inactive'} state`);
  } catch (error) {
    console.log('Could not update icon:', error);
  }
}

// Listen for extension enable/disable events
chrome.management.onEnabled.addListener((info) => {
  if (info.id === chrome.runtime.id) {
    console.log('LinkRight: Extension enabled');
    // Always default to grayscale; actual color reflects UI visibility
    updateExtensionIcon(false);
    chrome.storage.local.set({ 'linkright.iconActive': false });
  }
});

chrome.management.onDisabled.addListener((info) => {
  if (info.id === chrome.runtime.id) {
    console.log('LinkRight: Extension disabled');
    updateExtensionIcon(false);
    chrome.storage.local.set({ 'linkright.iconActive': false });
  }
});

// Set initial icon state based on extension status
// Default to grayscale icon on service worker start
(async () => {
  try {
    updateExtensionIcon(false);
    chrome.storage.local.set({ 'linkright.iconActive': false });
  } catch (error) {
    console.error('LinkRight: Could not set default icon:', error);
  }
})();

/**
 * Ensure content scripts and styles are injected into the tab
 */
async function ensureContentInjected(tabId) {
  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['sidebar.css']
    });

    // Inject scripts in correct order
    await chrome.scripting.executeScript({ target: { tabId }, files: ['config.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['runner-control.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (error) {
    console.error('LinkRight: ensureContentInjected failed:', error);
    throw error;
  }
}
