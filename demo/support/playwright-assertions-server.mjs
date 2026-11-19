import { createServer } from 'node:http';

/** Track only this fixture's sockets so incomplete HTTP requests cannot hold cleanup open. */
export function assertionServer(handler) {
  const sockets = new Set();
  const server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const close = (graceMs = 2_000) =>
    new Promise((resolve, reject) => {
      let forced = false;
      let finalDeadline;
      const force = setTimeout(() => {
        forced = true;
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
        finalDeadline = setTimeout(
          () => reject(new Error('Assertion HTTP fixture did not close')),
          1_000,
        );
      }, graceMs);
      server.close((error) => {
        clearTimeout(force);
        clearTimeout(finalDeadline);
        if (error) reject(error);
        else resolve({ closed: true, forced });
      });
    });
  return { server, close };
}
