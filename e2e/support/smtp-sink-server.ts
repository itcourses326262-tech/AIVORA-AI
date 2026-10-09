import { startSmtpSink } from './smtp-sink';

/**
 * Entry point of the sink as a Playwright `webServer` (see `playwright.config.ts`):
 * `SMTP_SINK_PORT` and `SMTP_SINK_FILE` say where to listen and where to write.
 */
const port = Number(process.env.SMTP_SINK_PORT);
const file = process.env.SMTP_SINK_FILE;

if (!Number.isInteger(port) || port <= 0 || !file) {
  console.error('SMTP_SINK_PORT and SMTP_SINK_FILE must be set');
  process.exit(2);
}

const sink = await startSmtpSink({ port, file });
console.log(`[smtp-sink] listening on 127.0.0.1:${sink.port}, writing ${file}`);

const stop = () => {
  void sink.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
