/**
 * Runner Control Module
 * Handles communication between extension and local Playwright runner API
 */

class RunnerControl {
  constructor() {
    this.apiUrl = window.LINKRIGHT_CONFIG.RUNNER_API_URL;
    this.token = window.LINKRIGHT_CONFIG.RUNNER_TOKEN;
    this.status = {
      isRunning: false,
      stats: null,
      lastUpdate: null
    };
    this.pollInterval = null;
  }

  /**
   * Make authenticated API request
   */
  async apiRequest(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-runner-token': this.token,
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      console.error('LinkRight Runner API Error:', error);
      throw error;
    }
  }

  /**
   * Start the runner
   */
  async start() {
    console.log('LinkRight: Starting runner...');

    try {
      const result = await this.apiRequest('/runner/start', {
        method: 'POST'
      });

      this.status.isRunning = true;
      this.status.stats = result.stats;
      this.status.lastUpdate = new Date();

      // Start polling for status updates
      this.startPolling();

      return result;

    } catch (error) {
      console.error('LinkRight: Failed to start runner:', error);
      throw error;
    }
  }

  /**
   * Stop the runner
   */
  async stop() {
    console.log('LinkRight: Stopping runner...');

    try {
      const result = await this.apiRequest('/runner/stop', {
        method: 'POST'
      });

      this.status.isRunning = false;
      this.status.stats = result.stats;
      this.status.lastUpdate = new Date();

      // Stop polling
      this.stopPolling();

      return result;

    } catch (error) {
      console.error('LinkRight: Failed to stop runner:', error);
      throw error;
    }
  }

  /**
   * Get current status
   */
  async getStatus() {
    try {
      const result = await this.apiRequest('/runner/status', {
        method: 'GET'
      });

      this.status.isRunning = result.isRunning;
      this.status.stats = result.stats;
      this.status.thresholds = result.thresholds;
      this.status.lastUpdate = new Date();

      return result;

    } catch (error) {
      console.error('LinkRight: Failed to get status:', error);
      throw error;
    }
  }

}

// Initialize global runner control
if (typeof window !== 'undefined') {
  window.runnerControl = new RunnerControl();
}
