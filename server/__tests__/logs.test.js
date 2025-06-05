const axios = require('axios');
const { spawn } = require('child_process');

const SERVER_URL = 'http://localhost:3001';

describe('KGSM Logs Endpoint', () => {
  let factorioProcess = null;

  beforeAll(async () => {
    // First check if server is running
    try {
      await axios.get(`${SERVER_URL}/api/kgsm/instances`);
      console.log('✅ Server is running');
    } catch (error) {
      console.error('❌ Server is not running. Please start the server first.');
      process.exit(1);
    }

    // Start Factorio server if not running
    try {
      // Get Factorio status
      const statusProcess = spawn('kgsm', ['-i', 'factorio', '--status']);
      const status = await new Promise((resolve) => {
        let output = '';
        statusProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        statusProcess.on('close', () => resolve(output));
      });

      if (!status.includes('active')) {
        console.log('Starting Factorio server...');
        factorioProcess = spawn('kgsm', ['-i', 'factorio', '--start']);
        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (error) {
      console.error('Failed to start Factorio server:', error);
      process.exit(1);
    }
  });

  afterAll(async () => {
    if (factorioProcess) {
      try {
        // Stop Factorio server if we started it
        await new Promise((resolve) => {
          const stopProcess = spawn('kgsm', ['-i', 'factorio', '--stop']);
          stopProcess.on('close', resolve);
        });
      } catch (error) {
        console.error('Failed to stop Factorio server:', error);
      }
    }
  });

  test('should receive continuous log output', async () => {
    // Make the logs request with a timeout to ensure we get some data
    const response = await axios.get(
      `${SERVER_URL}/api/kgsm/instances/factorio/logs?timeout=5000`,
      { timeout: 6000 } // Slightly longer than the server timeout
    );

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    expect(typeof response.data).toBe('string');
    expect(response.data.length).toBeGreaterThan(0);

    console.log('First 200 characters of logs:');
    console.log('----------------------------');
    console.log(response.data.substring(0, 200));
    console.log('----------------------------');

    // Test that we can get multiple log entries over time
    try {
      // Get initial logs
      const initialResponse = await axios.get(
        `${SERVER_URL}/api/kgsm/instances/factorio/logs?timeout=3000`,
        { timeout: 4000 }
      );

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get logs again
      const newResponse = await axios.get(
        `${SERVER_URL}/api/kgsm/instances/factorio/logs?timeout=3000`,
        { timeout: 4000 }
      );

      expect(newResponse.status).toBe(200);
      expect(newResponse.data).toBeDefined();
      expect(typeof newResponse.data).toBe('string');
      expect(newResponse.data.length).toBeGreaterThan(0);
      
      // We should get some server log entries
      expect(newResponse.data).toMatch(/Info|Server|Factorio/i);

    } catch (error) {
      console.error('Failed to test command generation:', error);
      throw error;
    }
  }, 20000); // Increase timeout to 20 seconds for this test
});
