// KGSM API Server
const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Promisify exec command
const execPromise = promisify(exec);

const app = express();
const server = createServer(app);

// CORS configuration for development - allow local network access
const allowedOrigins = [
  'http://localhost:3000',
  /^http:\/\/localhost:\d+$/,              // Allow localhost on any port
  /^http:\/\/127\.0\.0\.1:\d+$/,           // Allow 127.0.0.1 on any port
  /^http:\/\/192\.168\.\d+\.\d+:3000$/,    // Allow any 192.168.x.x:3000
  /^http:\/\/10\.\d+\.\d+\.\d+:3000$/,     // Allow any 10.x.x.x:3000
  /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:3000$/ // Allow 172.16-31.x.x:3000
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Check if origin matches allowed patterns
    const allowed = allowedOrigins.some(pattern => {
      if (typeof pattern === 'string') {
        return pattern === origin;
      } else {
        return pattern.test(origin);
      }
    });

    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
})); // Allow cross-origin requests with dynamic origin checking
app.use(express.json()); // Parse JSON request bodies

/**
 * Execute KGSM commands
 * @param {string} command - KGSM command to run
 * @returns {Promise<string>} - Command output
 */
async function runKgsmCommand(command) {
  try {
    const { stdout, stderr } = await execPromise(`kgsm ${command}`);
    if (stderr) {
      console.error(`stderr: ${stderr}`);
    }
    return stdout;
  } catch (error) {
    console.error(`Error executing command: ${error}`);
    throw error;
  }
}

// Routes

// Get all blueprints
app.get('/api/kgsm/blueprints', async (req, res) => {
  try {
    const output = await runKgsmCommand('--blueprints --detailed --json');
    res.json(JSON.parse(output));
  } catch (error) {
    res.status(500).json({ error: `Failed to get blueprints: ${error.message}` });
  }
});

// Get all instances
app.get('/api/kgsm/instances', async (req, res) => {
  try {
    const output = await runKgsmCommand('--instances --detailed --json');
    res.json(JSON.parse(output));
  } catch (error) {
    res.status(500).json({ error: `Failed to get instances: ${error.message}` });
  }
});

// Get instance status
app.get('/api/kgsm/instances/:name/status', async (req, res) => {
  try {
    const name = req.params.name;
    const fast = req.query.fast === 'true';

    let command = `--instance ${name} --status`;
    if (fast) {
      command += ' --fast';
    }
    command += ' --json';

    const output = await runKgsmCommand(command);
    res.json(JSON.parse(output));
  } catch (error) {
    res.status(500).json({ error: `Failed to get instance status: ${error.message}` });
  }
});

// Install a new instance
app.post('/api/kgsm/instances', async (req, res) => {
  try {
    const { blueprint, instanceId, installDir, version } = req.body;

    if (!blueprint) {
      return res.status(400).json({ error: 'Blueprint name is required' });
    }

    let command = `--create ${blueprint}`;

    if (instanceId) {
      command += ` --id ${instanceId}`;
    }

    if (installDir) {
      command += ` --install-dir "${installDir}"`;
    }

    if (version) {
      command += ` --version ${version}`;
    }

    const output = await runKgsmCommand(command);
    res.json({ success: true, message: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to install instance: ${error.message}` });
  }
});

// Uninstall an instance
app.delete('/api/kgsm/instances/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const output = await runKgsmCommand(`--uninstall ${name}`);
    res.json({ success: true, message: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to uninstall instance: ${error.message}` });
  }
});

// Start an instance
app.post('/api/kgsm/instances/:name/start', async (req, res) => {
  try {
    const name = req.params.name;
    const output = await runKgsmCommand(`-i ${name} --start`);
    res.json({ success: true, message: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to start instance: ${error.message}` });
  }
});

// Stop an instance
app.post('/api/kgsm/instances/:name/stop', async (req, res) => {
  try {
    const name = req.params.name;
    const output = await runKgsmCommand(`-i ${name} --stop`);
    res.json({ success: true, message: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to stop instance: ${error.message}` });
  }
});

// Restart an instance
app.post('/api/kgsm/instances/:name/restart', async (req, res) => {
  try {
    const name = req.params.name;
    const output = await runKgsmCommand(`-i ${name} --restart`);
    res.json({ success: true, message: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to restart instance: ${error.message}` });
  }
});

// Store active log processes for cleanup
const activeLogProcesses = new Map();

/**
 * Execute KGSM logs command with a timeout to prevent hanging
 * @param {string} instanceName - Instance name to get logs for
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} clientId - Unique client identifier for tracking
 * @returns {Promise<string>} - Command output
 */
async function runKgsmLogsCommand(instanceName, timeoutMs = 3000, clientId = null) {
  return new Promise((resolve, reject) => {
    // Use child_process.spawn for better control over the process
    const { spawn } = require('child_process');
    let output = '';

    // Use --tail to limit the number of log lines returned
    const process = spawn('kgsm', ['-i', instanceName, '--logs', '--follow']);

    // Track the process if clientId is provided
    if (clientId) {
      activeLogProcesses.set(clientId, process);
    }

    // Set a timeout to kill the process after the specified time
    const timeout = setTimeout(() => {
      process.kill();
      if (clientId) {
        activeLogProcesses.delete(clientId);
      }
      resolve(output); // Resolve with whatever output we have so far
    }, timeoutMs);

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    process.on('close', (code) => {
      clearTimeout(timeout);
      if (clientId) {
        activeLogProcesses.delete(clientId);
      }
      if (code !== 0 && code !== null) { // null means process was killed
        reject(new Error(`Process exited with code ${code}`));
      } else {
        resolve(output);
      }
    });

    process.on('error', (err) => {
      clearTimeout(timeout);
      if (clientId) {
        activeLogProcesses.delete(clientId);
      }
      reject(err);
    });
  });
}

// Per-instance log state tracking
const instanceLogState = new Map();

/**
 * Get or create log state for an instance
 * @param {string} instanceName - Instance name
 * @returns {Object} - Log state object
 */
function getInstanceLogState(instanceName) {
  if (!instanceLogState.has(instanceName)) {
    instanceLogState.set(instanceName, {
      process: null,
      buffer: [],
      lastActivity: Date.now(),
      clients: new Set(),
      maxBufferLines: 1000,
      isActive: false
    });
  }
  return instanceLogState.get(instanceName);
}

/**
 * Start log process for an instance
 * @param {string} instanceName - Instance name
 * @param {Object} state - Instance log state
 */
function startLogProcess(instanceName, state) {
  if (state.isActive) {
    return; // Already active
  }

  const { spawn } = require('child_process');
  const process = spawn('kgsm', ['-i', instanceName, '--logs', '--follow']);

  state.process = process;
  state.isActive = true;

  console.log(`Started log process for instance: ${instanceName}`);

  process.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());

    // Add new lines to buffer
    state.buffer.push(...lines);

    // Maintain rolling buffer size
    if (state.buffer.length > state.maxBufferLines) {
      const excess = state.buffer.length - state.maxBufferLines;
      state.buffer.splice(0, excess);
    }

    // Update activity timestamp
    state.lastActivity = Date.now();
  });

  process.stderr.on('data', (data) => {
    console.error(`Log process stderr for ${instanceName}:`, data.toString());
  });

  process.on('close', (code) => {
    console.log(`Log process for ${instanceName} closed with code ${code}`);
    state.isActive = false;
    state.process = null;

    // If process died unexpectedly and we still have clients, restart it
    if (code !== 0 && state.clients.size > 0) {
      console.log(`Restarting log process for ${instanceName} due to unexpected exit`);
      setTimeout(() => startLogProcess(instanceName, state), 1000);
    }
  });

  process.on('error', (err) => {
    console.error(`Log process error for ${instanceName}:`, err);
    state.isActive = false;
    state.process = null;
  });
}

/**
 * Stop log process for an instance
 * @param {string} instanceName - Instance name
 * @param {Object} state - Instance log state
 */
function stopLogProcess(instanceName, state) {
  if (state.process && state.isActive) {
    console.log(`Stopping log process for instance: ${instanceName}`);
    state.process.kill();
    state.process = null;
    state.isActive = false;
    state.buffer = []; // Clear buffer when stopping
  }
}

/**
 * Cleanup inactive log processes
 */
function cleanupInactiveProcesses() {
  const now = Date.now();
  const inactiveThreshold = 30000; // 30 seconds

  for (const [instanceName, state] of instanceLogState.entries()) {
    // Check if instance has been inactive and has no clients
    if (state.clients.size === 0 && (now - state.lastActivity) > inactiveThreshold) {
      console.log(`Cleaning up inactive log process for instance: ${instanceName}`);
      stopLogProcess(instanceName, state);
      instanceLogState.delete(instanceName);
    }
  }
}

// Run cleanup every 30 seconds
setInterval(cleanupInactiveProcesses, 30000);

// WebSocket-based log streaming system
const logStreams = new Map(); // instanceName -> { process, sockets: Set(), buffer: Array }

/**
 * Get or create a log stream for an instance
 * @param {string} instanceName - Instance name
 * @returns {Object} - Log stream object
 */
function getOrCreateLogStream(instanceName) {
  if (!logStreams.has(instanceName)) {
    logStreams.set(instanceName, {
      process: null,
      sockets: new Set(),
      buffer: [], // Keep last 100 lines for new connections
      maxBufferLines: 100,
      isActive: false
    });
  }
  return logStreams.get(instanceName);
}

/**
 * Start log process and stream to WebSocket clients
 * @param {string} instanceName - Instance name
 * @param {Object} stream - Log stream object
 */
function startLogStream(instanceName, stream) {
  if (stream.isActive) {
    return; // Already active
  }

  const { spawn } = require('child_process');
  const process = spawn('kgsm', ['-i', instanceName, '--logs', '--follow']);

  stream.process = process;
  stream.isActive = true;

  console.log(`🚀 Started WebSocket log stream for instance: ${instanceName}`);

  process.stdout.on('data', (data) => {
    const logData = data.toString();

    // Add to buffer for new connections (keep last N lines)
    const lines = logData.split('\n').filter(line => line.trim());
    stream.buffer.push(...lines);

    // Maintain rolling buffer size
    if (stream.buffer.length > stream.maxBufferLines) {
      const excess = stream.buffer.length - stream.maxBufferLines;
      stream.buffer.splice(0, excess);
    }

    // Broadcast to all connected WebSocket clients
    stream.sockets.forEach(socket => {
      if (socket.connected) {
        socket.emit('log-data', logData);
      } else {
        // Remove disconnected sockets
        stream.sockets.delete(socket);
      }
    });
  });

  process.stderr.on('data', (data) => {
    const errorData = `[ERROR] ${data.toString()}`;
    console.error(`Log stream stderr for ${instanceName}:`, data.toString());

    // Broadcast errors to clients as well
    stream.sockets.forEach(socket => {
      if (socket.connected) {
        socket.emit('log-data', errorData);
      }
    });
  });

  process.on('close', (code) => {
    console.log(`📡 Log stream for ${instanceName} closed with code ${code}`);
    stream.isActive = false;
    stream.process = null;

    // Notify clients that stream ended
    const endMessage = `\n[${new Date().toISOString()}] Log stream ended (exit code: ${code})\n`;
    stream.sockets.forEach(socket => {
      if (socket.connected) {
        socket.emit('log-data', endMessage);
        socket.emit('stream-ended', { instanceName, exitCode: code });
      }
    });

    // If process died unexpectedly and we still have clients, restart it
    if (code !== 0 && stream.sockets.size > 0) {
      console.log(`🔄 Restarting log stream for ${instanceName} due to unexpected exit`);
      setTimeout(() => startLogStream(instanceName, stream), 1000);
    }
  });

  process.on('error', (err) => {
    console.error(`❌ Log stream error for ${instanceName}:`, err);
    stream.isActive = false;
    stream.process = null;

    // Notify clients of error
    const errorMessage = `\n[${new Date().toISOString()}] Log stream error: ${err.message}\n`;
    stream.sockets.forEach(socket => {
      if (socket.connected) {
        socket.emit('log-data', errorMessage);
        socket.emit('stream-error', { instanceName, error: err.message });
      }
    });
  });
}

/**
 * Stop log stream for an instance
 * @param {string} instanceName - Instance name
 */
function stopLogStream(instanceName) {
  const stream = logStreams.get(instanceName);
  if (stream && stream.process && stream.isActive) {
    console.log(`🛑 Stopping log stream for instance: ${instanceName}`);
    stream.process.kill();
    stream.process = null;
    stream.isActive = false;
    stream.buffer = []; // Clear buffer when stopping

    // Notify remaining clients
    stream.sockets.forEach(socket => {
      if (socket.connected) {
        socket.emit('stream-ended', { instanceName, reason: 'manual_stop' });
      }
    });

    logStreams.delete(instanceName);
  }
}

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Handle log subscription
  socket.on('subscribe-logs', (instanceName) => {
    console.log(`📡 Client ${socket.id} subscribing to logs for: ${instanceName}`);

    // Get or create log stream
    const stream = getOrCreateLogStream(instanceName);

    // Add socket to stream
    stream.sockets.add(socket);

    // Send recent log history to new client
    if (stream.buffer.length > 0) {
      const historyData = stream.buffer.join('\n') + '\n';
      socket.emit('log-history', historyData);
    }

    // Start log stream if not already active
    if (!stream.isActive) {
      startLogStream(instanceName, stream);
    }

    // Send connection confirmation
    socket.emit('subscription-confirmed', { instanceName, bufferSize: stream.buffer.length });
  });

  // Handle unsubscription
  socket.on('unsubscribe-logs', (instanceName) => {
    console.log(`📡 Client ${socket.id} unsubscribing from logs for: ${instanceName}`);

    const stream = logStreams.get(instanceName);
    if (stream) {
      stream.sockets.delete(socket);

      // If no more clients, stop the stream
      if (stream.sockets.size === 0) {
        console.log(`🧹 No more clients for ${instanceName}, stopping stream`);
        stopLogStream(instanceName);
      }
    }
  });

  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);

    // Remove socket from all streams
    logStreams.forEach((stream, instanceName) => {
      if (stream.sockets.has(socket)) {
        stream.sockets.delete(socket);
        console.log(`🧹 Removed ${socket.id} from ${instanceName} stream`);

        // If no more clients, stop the stream
        if (stream.sockets.size === 0) {
          console.log(`🧹 No more clients for ${instanceName}, stopping stream`);
          stopLogStream(instanceName);
        }
      }
    });
  });

  // Handle ping for connection health
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Get instance logs
app.get('/api/kgsm/instances/:name/logs', async (req, res) => {
  try {
    const instanceName = req.params.name;
    const clientId = req.query.clientId || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Get or create instance state
    const state = getInstanceLogState(instanceName);

    // Add client to tracking
    state.clients.add(clientId);
    state.lastActivity = Date.now();

    // Start log process if not already running
    if (!state.isActive) {
      startLogProcess(instanceName, state);

      // Give the process a moment to start and collect initial logs
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Return current buffer contents
    const logs = state.buffer.length > 0 ? state.buffer.join('\n') : 'No logs available or server is not running';

    // Set response headers to help with client tracking
    res.setHeader('X-Client-Id', clientId);
    res.send(logs);

  } catch (error) {
    console.error(`Error getting logs for ${req.params.name}:`, error);
    res.status(500).json({ error: `Failed to get logs: ${error.message}` });
  }
});

// Client disconnect endpoint
app.post('/api/kgsm/instances/:name/logs/disconnect', async (req, res) => {
  try {
    const instanceName = req.params.name;
    const { clientId } = req.body;

    if (instanceLogState.has(instanceName)) {
      const state = instanceLogState.get(instanceName);
      state.clients.delete(clientId);

      console.log(`Client ${clientId} disconnected from ${instanceName}. Remaining clients: ${state.clients.size}`);

      // If no more clients, the cleanup process will handle stopping the log process
    }

    res.json({ success: true, message: 'Client disconnected' });
  } catch (error) {
    res.status(500).json({ error: `Failed to disconnect client: ${error.message}` });
  }
});

// New endpoint to terminate log processes for a specific instance
app.post('/api/kgsm/instances/:name/logs/stop', async (req, res) => {
  try {
    const instanceName = req.params.name;

    if (instanceLogState.has(instanceName)) {
      const state = instanceLogState.get(instanceName);
      stopLogProcess(instanceName, state);
      instanceLogState.delete(instanceName);

      res.json({
        success: true,
        message: `Stopped log process for ${instanceName}`
      });
    } else {
      res.json({
        success: true,
        message: `No active log process found for ${instanceName}`
      });
    }
  } catch (error) {
    res.status(500).json({ error: `Failed to stop log process: ${error.message}` });
  }
});

// Cleanup endpoint to terminate all log processes (useful for debugging)
app.post('/api/kgsm/logs/cleanup', async (req, res) => {
  try {
    let stoppedCount = 0;

    for (const [instanceName, state] of instanceLogState.entries()) {
      stopLogProcess(instanceName, state);
      stoppedCount++;
    }

    instanceLogState.clear();

    res.json({
      success: true,
      message: `Stopped ${stoppedCount} log processes`
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to cleanup log processes: ${error.message}` });
  }
});

// Get log process status (useful for debugging)
app.get('/api/kgsm/logs/status', async (req, res) => {
  try {
    const status = {};

    for (const [instanceName, state] of instanceLogState.entries()) {
      status[instanceName] = {
        isActive: state.isActive,
        bufferSize: state.buffer.length,
        clientCount: state.clients.size,
        lastActivity: new Date(state.lastActivity).toISOString(),
        clients: Array.from(state.clients)
      };
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: `Failed to get log status: ${error.message}` });
  }
});

// Get WebSocket stream status (useful for debugging)
app.get('/api/kgsm/streams/status', async (req, res) => {
  try {
    const status = {};

    for (const [instanceName, stream] of logStreams.entries()) {
      status[instanceName] = {
        isActive: stream.isActive,
        bufferSize: stream.buffer.length,
        socketCount: stream.sockets.size,
        socketIds: Array.from(stream.sockets).map(socket => socket.id),
        maxBufferLines: stream.maxBufferLines
      };
    }

    res.json({
      totalStreams: logStreams.size,
      activeStreams: Array.from(logStreams.values()).filter(s => s.isActive).length,
      totalConnections: Array.from(logStreams.values()).reduce((sum, s) => sum + s.sockets.size, 0),
      streams: status
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to get stream status: ${error.message}` });
  }
});

// Force stop all WebSocket streams (useful for debugging)
app.post('/api/kgsm/streams/cleanup', async (req, res) => {
  try {
    let stoppedCount = 0;

    for (const [instanceName] of logStreams.entries()) {
      stopLogStream(instanceName);
      stoppedCount++;
    }

    res.json({
      success: true,
      message: `Stopped ${stoppedCount} WebSocket streams`
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to cleanup streams: ${error.message}` });
  }
});

// Send command to instance
app.post('/api/kgsm/instances/:name/command', async (req, res) => {
  try {
    const name = req.params.name;
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    const output = await runKgsmCommand(`-i ${name} --input "${command}"`);
    res.json({ success: true, message: output });
  } catch (error) {
    res.status(500).json({ error: `Failed to send command: ${error.message}` });
  }
});

// Store previous network stats for calculating deltas
let prevNetStats = null;
let prevNetStatsTime = null;
let networkHistory = {
  rx: [],
  tx: []
};

/**
 * Get network traffic statistics
 * @returns {Promise<Object>} - Network usage stats
 */
async function getNetworkUsage() {
  try {
    // This works on Linux systems to get network traffic stats
    const { stdout } = await execPromise('cat /proc/net/dev');
    const lines = stdout.trim().split('\n');

    // Get total network stats from all interfaces except loopback
    let totalRxBytes = 0;
    let totalTxBytes = 0;

    // Start from line 2 to skip headers
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(/\s+/);
      const iface = parts[0].replace(':', '');

      // Skip loopback interface
      if (iface === 'lo') continue;

      // Bytes received is at index 1, bytes transmitted at index 9
      const rxBytes = parseInt(parts[1], 10);
      const txBytes = parseInt(parts[9], 10);

      totalRxBytes += rxBytes;
      totalTxBytes += txBytes;
    }

    // Calculate network speed in KB/s
    const now = Date.now();
    let rxSpeed = 0;
    let txSpeed = 0;

    if (prevNetStats && prevNetStatsTime) {
      const timeDiffSeconds = (now - prevNetStatsTime) / 1000;
      if (timeDiffSeconds > 0) {
        // Calculate speed in KB/s
        rxSpeed = Math.round((totalRxBytes - prevNetStats.rx) / timeDiffSeconds / 1024);
        txSpeed = Math.round((totalTxBytes - prevNetStats.tx) / timeDiffSeconds / 1024);

        // Ensure values are non-negative (can happen on interface reset)
        rxSpeed = Math.max(0, rxSpeed);
        txSpeed = Math.max(0, txSpeed);
      }
    }

    // Store current stats for next calculation
    prevNetStats = { rx: totalRxBytes, tx: totalTxBytes };
    prevNetStatsTime = now;

    // Convert bytes to MB
    const totalRxMB = Math.round(totalRxBytes / (1024 * 1024) * 100) / 100;
    const totalTxMB = Math.round(totalTxBytes / (1024 * 1024) * 100) / 100;

    // Keep track of network speeds
    networkHistory.rx.push({ timestamp: now, value: rxSpeed });
    networkHistory.tx.push({ timestamp: now, value: txSpeed });

    // Only keep last 300 data points (5 minutes at 1s interval)
    if (networkHistory.rx.length > 300) {
      networkHistory.rx.shift();
      networkHistory.tx.shift();
    }

    return {
      rx: networkHistory.rx,
      tx: networkHistory.tx,
      total: {
        rx: totalRxMB, // Total received in MB
        tx: totalTxMB, // Total transmitted in MB
        rxSpeed: rxSpeed, // Current rx speed in KB/s
        txSpeed: txSpeed  // Current tx speed in KB/s
      }
    };
  } catch (error) {
    console.error(`Error getting network usage: ${error}`);
    // Return empty arrays for first run or error
    return {
      rx: networkHistory.rx,
      tx: networkHistory.tx,
      total: { rx: 0, tx: 0, rxSpeed: 0, txSpeed: 0 }
    };
  }
}

// Track previous CPU time info for calculating per-core usage
let prevCpuInfo = null;
let cpuCoreHistory = [];

/**
 * Get CPU usage for each core and total
 * @returns {Object} - CPU usage stats for total and per-core
 */
async function getCpuUsage() {
  const cpus = os.cpus();
  const cpuCount = cpus.length;
  const now = Date.now();

  // Get CPU model name from the first core (all cores are typically the same)
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';

  // Get overall CPU usage from load average
  const cpuLoad = os.loadavg()[0]; // 1 minute load average
  const cpuUsagePercent = (cpuLoad / cpuCount) * 100; // Convert to percentage

  // Calculate per-core usage
  let coreUsage = [];

  if (prevCpuInfo) {
    coreUsage = cpus.map((cpu, index) => {
      const prev = prevCpuInfo[index];

      // Calculate delta times
      const prevTotal = Object.values(prev.times).reduce((acc, time) => acc + time, 0);
      const currentTotal = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);

      const prevIdle = prev.times.idle;
      const currentIdle = cpu.times.idle;

      // Calculate deltas
      const totalDelta = currentTotal - prevTotal;
      const idleDelta = currentIdle - prevIdle;

      // Calculate usage percentage (time spent not idle)
      const usagePercent = totalDelta > 0 ? 100 - (idleDelta / totalDelta * 100) : 0;

      return {
        core: index,
        usage: Math.min(Math.round(usagePercent * 100) / 100, 100), // Round to 2 decimal points and cap at 100%
        model: cpu.model,
        speed: cpu.speed
      };
    });
  } else {
    // First run, initialize with zeros
    coreUsage = cpus.map((cpu, index) => ({
      core: index,
      usage: 0,
      model: cpu.model,
      speed: cpu.speed
    }));
  }

  // Store current CPU info for next calculation
  prevCpuInfo = cpus;

  // Add current timestamp to each data point
  const currentData = {
    timestamp: now,
    cores: coreUsage,
    average: Math.min(cpuUsagePercent, 100) // Cap at 100%
  };

  // Add to history
  cpuCoreHistory.push(currentData);

  // Limit history size (keep last 300 points - 5 minutes at 1s interval)
  if (cpuCoreHistory.length > 300) {
    cpuCoreHistory.shift();
  }

  return {
    current: Math.min(cpuUsagePercent, 100), // Overall CPU usage
    cores: coreUsage, // Per-core usage
    history: cpuCoreHistory, // Historical data
    model: cpuModel // CPU model name
  };
}

// Get system metrics
app.get('/api/system/metrics', async (req, res) => {
  try {
    // CPU usage (percentage) - now with per-core stats
    const cpuUsage = await getCpuUsage();

    // Memory usage (percentage and raw)
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;
    const totalMemoryMB = Math.round(totalMemory / (1024 * 1024));
    const usedMemoryMB = Math.round(usedMemory / (1024 * 1024));

    // Disk usage
    const diskUsage = await getDiskUsage();

    // Network usage
    const networkUsage = await getNetworkUsage();

    res.json({
      cpu: cpuUsage.current, // Overall CPU percentage
      cpuCores: cpuUsage.cores, // Per-core usage
      cpuHistory: cpuUsage.history, // CPU history data
      cpuModel: cpuUsage.model, // CPU model name
      memory: {
        percent: memoryUsage,
        total: totalMemoryMB, // Total memory in MB
        used: usedMemoryMB, // Used memory in MB
        free: totalMemoryMB - usedMemoryMB, // Free memory in MB
      },
      disk: diskUsage,
      network: networkUsage,
      systemInfo: {
        totalMemory: totalMemoryMB, // Total memory in MB
        totalDisk: diskUsage.total || 0, // Total disk in GB
        cpuCores: cpuUsage.cores.length,
        cpuModel: cpuUsage.model // CPU model included in system info
      }
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to get system metrics: ${error.message}` });
  }
});

/**
 * Get disk usage statistics
 * @returns {Promise<Object>} - Disk usage stats
 */
async function getDiskUsage() {
  try {
    // This works on Linux systems
    const { stdout } = await execPromise('df -k / | tail -1');
    const parts = stdout.trim().split(/\s+/);

    // Parse disk usage in KB
    const totalKB = parseInt(parts[1], 10);
    const usedKB = parseInt(parts[2], 10);
    const freeKB = parseInt(parts[3], 10);

    // Convert to GB
    const totalGB = Math.round(totalKB / (1024 * 1024) * 100) / 100;
    const usedGB = Math.round(usedKB / (1024 * 1024) * 100) / 100;
    const freeGB = Math.round(freeKB / (1024 * 1024) * 100) / 100;

    // Calculate percentages
    const usedPercent = Math.round((usedKB / totalKB) * 100);
    const freePercent = 100 - usedPercent;

    return {
      used: usedPercent,
      free: freePercent,
      totalGB,
      usedGB,
      freeGB,
      total: totalGB // For convenience
    };
  } catch (error) {
    console.error(`Error getting disk usage: ${error}`);
    // Default fallback values
    return { used: 50, free: 50, totalGB: 500, usedGB: 250, freeGB: 250, total: 500 };
  }
}

// Start the server
server.listen(PORT, () => {
  console.log(`KGSM API server running on port ${PORT}`);
});
