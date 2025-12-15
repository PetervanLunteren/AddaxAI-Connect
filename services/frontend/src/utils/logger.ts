/**
 * Frontend logger utility
 *
 * Sends logs to backend /api/logs endpoint for centralized logging.
 * Also logs to console in development mode.
 */

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context?: LogContext;
}

class Logger {
  private apiUrl = '/api/logs';
  private isDevelopment = import.meta.env.DEV;
  private pendingLogs: LogEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private maxBatchSize = 10;
  private batchIntervalMs = 1000;

  constructor() {
    // Send pending logs on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Internal log method
   */
  private log(level: LogEntry['level'], message: string, context?: LogContext): void {
    // Add page context
    const enrichedContext: LogContext = {
      ...context,
      page_url: window.location.href,
      user_agent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };

    // Log to console in development
    if (this.isDevelopment) {
      const consoleMethod = level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log';
      console[consoleMethod](`[${level.toUpperCase()}]`, message, enrichedContext);
    }

    // Add to batch
    this.pendingLogs.push({
      level,
      message,
      context: enrichedContext,
    });

    // Send immediately for errors, otherwise batch
    if (level === 'error') {
      this.flush();
    } else {
      this.scheduleBatch();
    }
  }

  /**
   * Schedule batch send
   */
  private scheduleBatch(): void {
    if (this.batchTimer) {
      return;
    }

    // Send if batch is full
    if (this.pendingLogs.length >= this.maxBatchSize) {
      this.flush();
      return;
    }

    // Schedule batch send
    this.batchTimer = setTimeout(() => {
      this.flush();
    }, this.batchIntervalMs);
  }

  /**
   * Flush pending logs to backend
   */
  private async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingLogs.length === 0) {
      return;
    }

    const logsToSend = [...this.pendingLogs];
    this.pendingLogs = [];

    // Send each log (backend expects individual log entries)
    for (const logEntry of logsToSend) {
      try {
        await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Include cookies for auth
          body: JSON.stringify(logEntry),
        });
      } catch (error) {
        // Failed to send log - log to console only
        if (this.isDevelopment) {
          console.error('Failed to send log to backend:', error);
        }
      }
    }
  }
}

// Export singleton instance
export const logger = new Logger();

/**
 * Log unhandled errors
 */
export function logUnhandledError(error: Error | ErrorEvent, context?: LogContext): void {
  const errorContext: LogContext = {
    ...context,
    error_name: error instanceof Error ? error.name : 'ErrorEvent',
    error_message: error instanceof Error ? error.message : (error as ErrorEvent).message,
    error_stack: error instanceof Error ? error.stack : undefined,
  };

  logger.error('Unhandled error', errorContext);
}

/**
 * Log unhandled promise rejections
 */
export function logUnhandledRejection(event: PromiseRejectionEvent, context?: LogContext): void {
  const errorContext: LogContext = {
    ...context,
    rejection_reason: event.reason?.toString() || 'Unknown',
    rejection_stack: event.reason instanceof Error ? event.reason.stack : undefined,
  };

  logger.error('Unhandled promise rejection', errorContext);
}
