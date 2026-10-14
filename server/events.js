// Server-Sent Events hub: every connected browser hears about new data instantly.
const clients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), clients: clients.size + 1 })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

export const clientCount = () => clients.size;
