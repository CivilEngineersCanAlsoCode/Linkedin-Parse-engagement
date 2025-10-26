/**
 * LinkRight Job Search CRM Configuration
 * 
 * IMPORTANT: Replace placeholder values with your actual URLs
 */

const LINKRIGHT_CONFIG = {
  // n8n Webhook URL for AI comment generation
  WEBHOOK_URL: 'https://n8n.linkright.in/webhook/linkedin-reply',

  // Privacy Policy URL
  PRIVACY_POLICY_URL: 'https://www.linkright.in/privacy',

  // Request timeout in milliseconds
  WEBHOOK_TIMEOUT: 10000,

  // Extension settings
  EXTENSION_NAME: 'LinkRight',
  EXTENSION_ID: 'linkright-job-search-crm',

  // Runner API settings (localhost automation backend)
  RUNNER_API_URL: 'http://127.0.0.1:3001/api',
  RUNNER_TOKEN: 'dev-secure-token-12345',

  // Color palette configuration
  COLORS: {
    PRIMARY: '#006666',
    PRIMARY_LIGHT: '#2699B8',
    PRIMARY_DARK: '#004D4D',
    GOLD: '#FFD700',
    CORAL: '#E87D63',
    SUCCESS: '#22C55E',
    DESTRUCTIVE: '#EF4444'
  }
};

// Make config available globally
if (typeof window !== 'undefined') {
  window.LINKRIGHT_CONFIG = LINKRIGHT_CONFIG;
}
