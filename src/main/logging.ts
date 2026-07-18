import log from 'electron-log/main';

export function configureLogging(): void {
  log.initialize();
  log.transports.file.level = 'info';
  log.transports.console.level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [main] {text}';
}

export const logger = log.scope('main');
