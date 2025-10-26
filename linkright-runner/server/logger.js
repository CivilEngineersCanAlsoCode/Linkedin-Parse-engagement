/**
 * Logger - File-based logging system
 * Writes structured logs to daily log files
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logsDir = path.join(__dirname, '../logs');
    this.ensureLogsDirectory();
  }

  ensureLogsDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getLogFileName() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logsDir, `runner-${date}.log`);
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaString = Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaString}\n`;
  }

  write(level, message, meta = {}) {
    const logFile = this.getLogFileName();
    const formattedMessage = this.formatMessage(level, message, meta);

    fs.appendFileSync(logFile, formattedMessage);

    // Also log to console
    console.log(formattedMessage.trim());
  }

  info(message, meta) {
    this.write('INFO', message, meta);
  }

  warn(message, meta) {
    this.write('WARN', message, meta);
  }

  error(message, meta) {
    this.write('ERROR', message, meta);
  }

  success(message, meta) {
    this.write('SUCCESS', message, meta);
  }

  action(message, meta) {
    this.write('ACTION', message, meta);
  }

  getTodaysLog() {
    const logFile = this.getLogFileName();
    if (fs.existsSync(logFile)) {
      return fs.readFileSync(logFile, 'utf-8');
    }
    return '';
  }
}

module.exports = new Logger();
