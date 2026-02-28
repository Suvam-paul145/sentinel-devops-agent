const WINDOW_SIZE = 720; // 1 hour at 5s interval = 720 points

class MetricsStore {
  constructor() {
    this.data = new Map(); // containerId -> CircularBuffer
  }

  push(containerId, metrics) {
    if (!this.data.has(containerId)) {
      this.data.set(containerId, []);
    }
    const buf = this.data.get(containerId);
    buf.push({ ...metrics, ts: Date.now() });
    if (buf.length > WINDOW_SIZE) buf.shift();
  }

  getWindow(containerId, points = 60) {
    return (this.data.get(containerId) || []).slice(-points);
  }

  clear(containerId) {
    this.data.delete(containerId);
  }
}

module.exports = new MetricsStore();
