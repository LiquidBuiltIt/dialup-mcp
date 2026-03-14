import { DaemonServer } from './server.js';

const server = new DaemonServer();

server.start()
  .then(() => {
    console.error('[dialup-daemon] started');
  })
  .catch((err) => {
    console.error('[dialup-daemon] failed to start:', err);
    process.exit(1);
  });

process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());
