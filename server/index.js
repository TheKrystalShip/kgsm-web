// KGSM API Server
const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Promisify exec command
const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Allow cross-origin requests
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
    const output = await runKgsmCommand('--instances --json --detailed');
    res.json(JSON.parse(output));
  } catch (error) {
    res.status(500).json({ error: `Failed to get instances: ${error.message}` });
  }
});

// Install a new instance
app.post('/api/kgsm/instances', async (req, res) => {
  try {
    const { blueprint, instanceId, installDir, version } = req.body;
    
    if (!blueprint) {
      return res.status(400).json({ error: 'Blueprint name is required' });
    }
    
    let command = `--install ${blueprint}`;
    
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

// Get instance logs
app.get('/api/kgsm/instances/:name/logs', async (req, res) => {
  try {
    const name = req.params.name;
    const output = await runKgsmCommand(`-i ${name} --logs`);
    res.send(output); // Send as plain text
  } catch (error) {
    res.status(500).json({ error: `Failed to get logs: ${error.message}` });
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

// Get system metrics
app.get('/api/system/metrics', async (req, res) => {
  try {
    // CPU usage (percentage)
    const cpuLoad = os.loadavg()[0]; // 1 minute load average
    const cpuCount = os.cpus().length;
    const cpuUsage = (cpuLoad / cpuCount) * 100; // Convert to percentage
    
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
      cpu: Math.min(cpuUsage, 100), // Cap at 100%
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
        cpuCores: cpuCount
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
app.listen(PORT, () => {
  console.log(`KGSM API server running on port ${PORT}`);
});
