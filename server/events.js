// Server-Sent Events hub shared by all modules: hub.broadcast(event, data).
// hub.onAttach(fn) runs fn(sendTo) for each new client, so a module can send it a first snapshot.

export function createHub() {
  const clients = new Set();
  const attachers = [];

  function attach(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const sendTo = (event, data) => {
      if (clients.has(res)) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    for (const fn of attachers) {
      // One module's failing snapshot must not drop the stream or the other modules' snapshots.
      Promise.resolve()
        .then(() => fn(sendTo))
        .catch((err) => console.error('sse attach failed:', err?.code ?? err?.name));
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function closeAll() {
    for (const res of clients) res.end();
    clients.clear();
  }

  function onAttach(fn) {
    attachers.push(fn);
  }

  // A workspace switch sets the modules up again; their old snapshot senders must go.
  function clearAttachers() {
    attachers.length = 0;
  }

  return { attach, broadcast, closeAll, onAttach, clearAttachers, get size() { return clients.size; } };
}
